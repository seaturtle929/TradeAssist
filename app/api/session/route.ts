import { AppError, authorize, errorResponse, openAI } from "../../../lib/ai-server";
import { CoachInput, cleanReferenceText } from "../../../lib/coach";
import { liveBootstrapInstructions } from "../../../lib/live-bootstrap";
import { makeCallHandle } from "../../../lib/call-handle";
import { buyerAudioMode, buyerTranscriptionConfig } from "../../../lib/buyer-transcription-config";
export async function POST(request: Request) {
  try {
    const user = await authorize(request);
    const body = await request.json() as Record<string,unknown>;
    const { sdp } = body;
    const audioMode = buyerAudioMode(body.audioMode);
    const transcriptionConfig = buyerTranscriptionConfig(audioMode);
    if (typeof sdp !== "string" || !sdp.startsWith("v=0") || sdp.length > 100_000) throw new AppError("A valid audio connection is required.");
    const parsed = CoachInput.safeParse({manufacturer:{name:"Your company",products:""},sources:[],turns:[],...body});
    if (!parsed.success) throw new AppError("The company context could not be read. Review the selected materials.");
    const context = parsed.data;
    if (context.sources.reduce((n,s) => n+s.text.length,0) > 60_000) throw new AppError("Live mode supports 60,000 characters of source material. Shorten this manufacturer's materials; verified text answers support 160,000.");
    context.sources = context.sources.map(s => ({...s,text:cleanReferenceText(s.text)}));
    const form = new FormData();
    form.set("sdp", sdp);
    const model=process.env.OPENAI_REALTIME_MODEL || "gpt-realtime";
    form.set("session", JSON.stringify({ type: "realtime", model,max_output_tokens:900,truncation:{type:"retention_ratio",retention_ratio:.8}, output_modalities:["text"], instructions:liveBootstrapInstructions(context.manufacturer,audioMode), tools:[{type:"function",name:"lookup_company_knowledge",description:"Search the representative's saved company and product documents for original factual excerpts.",parameters:{type:"object",properties:{query:{type:"string",description:"The specific buyer question or product terms to look up."}},required:["query"],additionalProperties:false}}], ...transcriptionConfig }));
    const response = await openAI("realtime/calls", form, true);
    const callId=response.headers.get("Location")?.split("/").pop();
    const handle=callId && /^rtc_[a-zA-Z0-9_-]+$/.test(callId) ? await makeCallHandle(callId,user.userId) : "";
    return new Response(await response.text(), { headers: { "Content-Type": "application/sdp", "Cache-Control": "no-store", "X-Trade-Model":model,"X-Trade-Transcription-Model":transcriptionConfig.audio.input.transcription.model,"X-Trade-Call":handle } });
  } catch (error) { return errorResponse(error); }
}
