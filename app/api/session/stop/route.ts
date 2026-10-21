import { AppError, authorize, errorResponse, openAI } from "../../../../lib/ai-server";
import { readCallHandle } from "../../../../lib/call-handle";
export async function POST(request:Request) {
  try {
    const user=await authorize(request), body=await request.json() as {handle?:unknown};
    if(typeof body.handle!=="string")throw new AppError("A call handle is required.");
    const callId=await readCallHandle(body.handle,user.userId);
    try { await openAI(`realtime/calls/${callId}/hangup`,{},false,8000); }
    catch(error) { if(!(error instanceof AppError && [400,404,409].includes(error.status)))throw error; }
    return Response.json({stopped:true},{headers:{"Cache-Control":"private, no-store"}});
  }catch(error){return errorResponse(error);}
}
