import { AppError, authorize, errorResponse, openAI } from "../../../lib/ai-server";
export async function POST(request: Request) {
  try {
    await authorize(request);
    const { sdp } = await request.json() as {sdp?:unknown};
    if (typeof sdp !== "string" || !sdp.startsWith("v=0") || sdp.length > 100_000) throw new AppError("A valid microphone connection is required.");
    const form = new FormData();
    form.set("sdp", sdp);
    form.set("session", JSON.stringify({ type: "transcription", audio: { input: {
      transcription: { model: "gpt-4o-mini-transcribe", language: "en", prompt: "An English business-to-business sales call between a manufacturer representative and a potential US buyer. Transcribe actual words, including product names, measurements and quantities." },
      noise_reduction: { type: "far_field" },
      turn_detection: { type: "server_vad", threshold: 0.5, prefix_padding_ms: 300, silence_duration_ms: 550 },
    } } }));
    const response = await openAI("realtime/calls", form, true);
    return new Response(await response.text(), { headers: { "Content-Type": "application/sdp", "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
