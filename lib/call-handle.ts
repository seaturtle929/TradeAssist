import { apiKey, AppError } from "./ai-server";
const encode=(value:Uint8Array)=>btoa(String.fromCharCode(...value)).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
const decode=(value:string)=>Uint8Array.from(atob(value.replace(/-/g,"+").replace(/_/g,"/")),c=>c.charCodeAt(0));
async function signingKey() { return crypto.subtle.importKey("raw",new TextEncoder().encode(apiKey()),{name:"HMAC",hash:"SHA-256"},false,["sign","verify"]); }
export async function makeCallHandle(callId:string,userId:string) {
  const body=encode(new TextEncoder().encode(JSON.stringify({callId,userId,expires:Date.now()+60*60*1000})));
  const signature=await crypto.subtle.sign("HMAC",await signingKey(),new TextEncoder().encode(body));
  return body+"."+encode(new Uint8Array(signature));
}
export async function readCallHandle(handle:string,userId:string) {
  if(handle.length>2500)throw new AppError("Invalid call handle.",403);
  try {
    const [body,signature]=handle.split(".");
    if(!body || !signature || !(await crypto.subtle.verify("HMAC",await signingKey(),decode(signature),new TextEncoder().encode(body))))throw Error();
    const data=JSON.parse(new TextDecoder().decode(decode(body)));
    if(data.userId!==userId || data.expires<Date.now() || !/^rtc_[a-zA-Z0-9_-]+$/.test(data.callId))throw Error();
    return data.callId as string;
  } catch { throw new AppError("This call handle is invalid or expired.",403); }
}
