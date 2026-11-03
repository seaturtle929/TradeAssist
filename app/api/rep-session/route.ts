import { AppError, authorize, errorResponse, openAI } from "../../../lib/ai-server";
import { makeCallHandle } from "../../../lib/call-handle";
import { representativeTranscriptionConfig } from "../../../lib/english-transcription";

/** Separate microphone connection: transcribe the representative, never generate replies. */
export async function POST(request: Request) {
  try {
    const user = await authorize(request);
    const body = await request.json() as {sdp?:unknown};
    if (typeof body.sdp !== "string" || !body.sdp.startsWith("v=0") || body.sdp.length > 100_000) throw new AppError("A valid microphone connection is required.");
    const form = new FormData();
    form.set("sdp",body.sdp);
    const model=process.env.OPENAI_REALTIME_MODEL || "gpt-realtime";
    const transcription=representativeTranscriptionConfig();
    form.set("session",JSON.stringify({
      type:"realtime",model,output_modalities:["text"],max_output_tokens:16,
      instructions:"This connection is for microphone transcription only. Never generate a response, tool call, script, analysis or audio.",
      tools:[],
      ...transcription,
    }));
    const response=await openAI("realtime/calls",form,true);
    const callId=response.headers.get("Location")?.split("/").pop();
    if(request.signal.aborted && callId && /^rtc_[a-zA-Z0-9_-]+$/.test(callId)) {
      await openAI(`realtime/calls/${callId}/hangup`,{},false,8000).catch(()=>{});
      throw new AppError("Microphone setup was cancelled.",499);
    }
    const handle=callId && /^rtc_[a-zA-Z0-9_-]+$/.test(callId) ? await makeCallHandle(callId,user.userId) : "";
    return new Response(await response.text(),{headers:{"Content-Type":"application/sdp","Cache-Control":"no-store","X-Trade-Call":handle,"X-Trade-Model":model,"X-Trade-Transcription-Model":transcription.audio.input.transcription.model}});
  } catch(error) { return errorResponse(error); }
}
