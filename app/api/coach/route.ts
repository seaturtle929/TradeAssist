import {authorize,errorResponse} from "../../../lib/ai-server";
import {coachResponse} from "../../../lib/coach-server";
export async function POST(request:Request):Promise<Response>{
 try{await authorize(request);return await coachResponse(request);}
 catch(error){return errorResponse(error);}
}
