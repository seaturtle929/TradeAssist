import { authorize, errorResponse } from "../../../lib/ai-server";
export async function GET() {
  try { await authorize(); return Response.json({ configured: Boolean(process.env.OPENAI_API_KEY), audio: "Microphone / speakerphone", storage: "This browser", model: process.env.OPENAI_TEXT_MODEL || "gpt-4.1-mini" }, { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return errorResponse(error); }
}
