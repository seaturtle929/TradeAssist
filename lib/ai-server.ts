import { getChatGPTUser } from "../app/chatgpt-auth";
import {upstreamFailure} from './upstream-error';
export class AppError extends Error { constructor(message: string, public status = 400, public code = "request_error",public requestId?:string) { super(message); } }
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
export async function openAI(path: string, body: unknown, isForm = false, timeout = 35_000, parentSignal?:AbortSignal) {
  const response = await fetch(`https://api.openai.com/v1/${path}`, {
    method: "POST", headers: { Authorization: `Bearer ${apiKey()}`, ...(!isForm ? { "Content-Type": "application/json" } : {}) },
    body: isForm ? body as FormData : JSON.stringify(body), signal: parentSignal ? AbortSignal.any([parentSignal,AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout),
  });
  if (!response.ok) {
    const failure=upstreamFailure(response.status,await response.text(),path,response.headers.get('x-request-id')||response.headers.get('openai-request-id'));
    console.warn('[Trade Assist AI]',JSON.stringify({path,...failure}));
    throw new AppError(failure.message,failure.status,failure.code,failure.requestId);
  }
  return response;
}
export function errorResponse(error: unknown) {
  if (error instanceof AppError) return Response.json({ error: error.message, code: error.code,...error.requestId?{requestId:error.requestId}:{} }, { status: error.status });
  if (error instanceof SyntaxError) return Response.json({ error: "The request was not valid JSON." }, { status: 400 });
  if (error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name)) return Response.json({ error: "The AI request took too long. Please try again.", code: "timeout" }, { status: 504 });
  return Response.json({ error: "The connection failed. Check your connection and try again." }, { status: 502 });
}
export type AIResponse = { id?:string; model?:string; usage?:unknown; status?: string; output?: { content?: { text?: string }[] }[] };
export function outputText(result: AIResponse) { return result.output?.flatMap(item => item.content || []).map(item => item.text || "").join("") || ""; }
