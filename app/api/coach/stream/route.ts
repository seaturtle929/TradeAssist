import {CoachingPhaseClock} from '../../../../lib/coaching-timing';
import { AppError, authorize, errorResponse, openAI } from '../../../../lib/ai-server';
import { CoachInput, cleanReferenceText } from '../../../../lib/coach';
import { checkSuggestion, safePurposeReply } from '../../../../lib/call-purpose';
import { responseCharge } from '../../../../lib/usage-server';
import { MANUAL_TEXT_MODEL, manualRequestFor, streamManualCoaching, immediateManualReply, type ManualCoachingEvent } from '../../../../lib/manual-coaching';
import type { UsageEntry } from '../../../../lib/costs';
import type { Guidance } from '../../../../lib/trade';
import { coachResponse as verifyCoach } from '../../../../lib/coach-server';

export const runtime = 'nodejs';

export async function POST(request: Request): Promise<Response> {
  const phaseClock=new CoachingPhaseClock();
  try {
    await authorize(request);
    const parsed = CoachInput.safeParse(await request.json());
    if (!parsed.success) throw new AppError('Please check the manufacturer, source material, and conversation details.');
    const input = parsed.data;
    if (!['coach', 'opening'].includes(input.mode)) throw new AppError('This endpoint streams manual call replies only.');
    if (input.sources.reduce((total, source) => total + source.text.length, 0) > 160_000) throw new AppError('Source material exceeds 160,000 characters. Shorten or split the materials.');
    input.sources = input.sources.map(source => ({ ...source, text: cleanReferenceText(source.text) }));
    const immediate:ManualCoachingEvent[]=[];
    if(immediateManualReply(input,event=>immediate.push(event)))return new Response(immediate.map(event=>JSON.stringify(event)+'\n').join(''),{headers:{'Content-Type':'application/x-ndjson; charset=utf-8','Cache-Control':'no-store, no-transform','X-Accel-Buffering':'no'}});
    const aborter = new AbortController(), signal = AbortSignal.any([request.signal, aborter.signal]);
    const encoder = new TextEncoder(), charges: UsageEntry[] = [];
    let closed = false;
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const startedAt = phaseClock.startedAt;
        const emit = (event: ManualCoachingEvent) => { if (!closed && !signal.aborted) controller.enqueue(encoder.encode(JSON.stringify(event) + '\n')); };
        emit({ type: 'start', model: MANUAL_TEXT_MODEL, source: 'real_model',requestedServiceTier:'default', startedAt: Date.now() });
        try {
          const generationRequest=manualRequestFor(input);
          phaseClock.providerStarted(JSON.stringify(generationRequest).length);
          const response = await openAI('responses', generationRequest, false, 35_000, signal);
          await streamManualCoaching({
            input, response, signal, emit, charges, startedAt,phaseClock,
            repair:async repairedInput=>openAI('responses',manualRequestFor(repairedInput),false,35_000,signal),
            charge: result => responseCharge(result, 'coach', MANUAL_TEXT_MODEL),
            verify: async (candidate, verifySignal) => {
              const headers = new Headers(request.headers);
              headers.set('content-type', 'application/json'); headers.delete('content-length');
              // Authorization already ran before streaming began. Reuse the
              // unchanged coaching core without re-reading Next headers() after
              // the outer route has returned its streamed response.
              const response = await verifyCoach(new Request(new URL('/api/coach', request.url), {
                method: 'POST', headers, signal: verifySignal,
                body: JSON.stringify({ ...input, mode: 'verify', proposedGuidance: candidate }),
              }));
              const verified = await response.json() as Guidance & { error?: string; code?: string; _charges?: UsageEntry[] };
              if (!response.ok) {
                if (Array.isArray(verified._charges)) charges.push(...verified._charges);
                console.warn('[Trade Assist manual verification]', JSON.stringify({ status: response.status, code: verified.code || 'verification_request_failed' }));
                throw new AppError(verified.error || 'The factual check could not finish.', response.status, verified.code);
              }
              const verdict = checkSuggestion(verified, input, { landing: true, factChecked: true });
              if(verdict.ok)return verified;
              if(input.coachingRequest)throw new AppError('The suggestion did not pass the company and conversation checks. Request another next move.',502,'suggestion_rejected');
              const safe=safePurposeReply(input,{landing:true});
              const safeVerdict=checkSuggestion(safe,input,{landing:true,factChecked:true});
              if(!safeVerdict.ok){
                if(Array.isArray(verified._charges))charges.push(...verified._charges);
                throw new AppError("The checked reply repeated a rejected move and was withheld.",502,'suggestion_rejected');
              }
              return {...safe,_charges:verified._charges};
            },
          });
        } catch (error) {
          if (!signal.aborted) {
            if (!(error instanceof AppError)) console.warn('[Trade Assist manual stream]', JSON.stringify({ name: error instanceof Error ? error.name : 'UnknownError', message: (error instanceof Error ? error.message : 'Unknown streaming failure').replace(/\bsk-[A-Za-z0-9_-]+/g, '[redacted]').slice(0, 300) }));
            const failure = errorResponse(error), data = await failure.json() as { error: string; code?: string };
            emit({ type: 'error', error: data.error, code: data.code, _charges: charges });
          }
        } finally { if (!closed) { closed = true; controller.close(); } }
      },
      cancel() { closed = true; aborter.abort(); },
    });
    return new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store, no-transform', 'X-Accel-Buffering': 'no' } });
  } catch (error) { return errorResponse(error); }
}
