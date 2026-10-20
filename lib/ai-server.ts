import { getChatGPTUser } from "../app/chatgpt-auth";
export class AppError extends Error { constructor(message: string, public status = 400, public code = "request_error") { super(message); } }
export async function authorize(request?: Request) {
  const user = await getChatGPTUser();
  if (!user) throw new AppError("Sign in to your private workspace to continue.", 401, "unauthorized");
  if (request) {
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin) throw new AppError("This request must come from your workspace.", 403);
    if (Number(request.headers.get("content-length") || 0) > 13_000_000) throw new AppError("This file is too large. Use a PDF under 8 MB.", 413);
  }
  return user;
}
export function apiKey() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new AppError("AI is not connected on this server. Open the local app where your key was securely saved.", 503, "not_configured");
  return key;
}
export async function openAI(path: string, body: unknown, isForm = false, timeout = 35_000) {
  const response = await fetch(`https://api.openai.com/v1/${path}`, {
    method: "POST", headers: { Authorization: `Bearer ${apiKey()}`, ...(!isForm ? { "Content-Type": "application/json" } : {}) },
    body: isForm ? body as FormData : JSON.stringify(body), signal: AbortSignal.timeout(timeout),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { error?: { code?: string; type?: string; message?: string } };
    const code = payload.error?.code || payload.error?.type || "upstream_error";
    const message = code === "insufficient_quota" ? "Your API project needs available credits. Add credits in OpenAI Platform, then try again."
      : response.status === 401 ? "The AI connection was rejected. Reconnect your API key."
      : response.status === 429 ? "The AI service is busy. Wait a moment and try again."
      : response.status === 403 ? "Your API project does not have access to this model. Check its model permissions."
      : (payload.error?.message || "The AI service could not complete this request.").replace(/sk-[\w-]+/g, "[redacted]");
    throw new AppError(message, response.status >= 500 ? 502 : response.status, code);
  }
  return response;
}
export function errorResponse(error: unknown) {
  if (error instanceof AppError) return Response.json({ error: error.message, code: error.code }, { status: error.status });
  if (error instanceof SyntaxError) return Response.json({ error: "The request was not valid JSON." }, { status: 400 });
  if (error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name)) return Response.json({ error: "The AI request took too long. Please try again.", code: "timeout" }, { status: 504 });
  return Response.json({ error: "The connection failed. Check your connection and try again." }, { status: 502 });
}
export type AIResponse = { status?: string; output?: { content?: { text?: string }[] }[] };
export function outputText(result: AIResponse) { return result.output?.flatMap(item => item.content || []).map(item => item.text || "").join("") || ""; }
