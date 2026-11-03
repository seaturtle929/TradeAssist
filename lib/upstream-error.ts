/** Error bodies differ between the text and WebRTC endpoints. Never discard a plain-text failure. */
export function upstreamFailure(status:number,raw:string,path:string,requestId:string|null) {
  let value:unknown;try{value=JSON.parse(raw);}catch{}
  const object=(data:unknown):Record<string,unknown>=>data&&typeof data==='object'?data as Record<string,unknown>:{};
  const payload=object(value),error=object(payload.error);
  const code=String(error.code||error.type||payload.code||payload.type||'upstream_error').slice(0,100);
  const detail=[error.message,typeof payload.error==='string'?payload.error:'',payload.message,payload.detail].find(item=>typeof item==='string'&&item.trim());
  const plain=!value&&!/^\s*</.test(raw)&&raw.trim().length<2000?raw.trim():'';
  const redact=(text:string)=>text.replace(/sk-[\w-]+/g,'[redacted]').replace(/Bearer\s+[^\s"<>]+/gi,'Bearer [redacted]').slice(0,1000);
  const description=redact(String(detail||plain||''));
  const live=path.startsWith('realtime/');
  const message=code==='insufficient_quota'?'Your API project needs available credits. Add credits in OpenAI Platform, then try again.'
    :status===401?'The AI connection was rejected. Reconnect your API key.'
    :status===429?'The AI service is busy. Wait a moment and try again.'
    :status===403?'Your API project does not have access to this model. Check its model permissions.'
    :description||`${live?'The live AI connection':'The AI request'} failed (HTTP ${status}). Please try connecting again.`;
  return {code,message,status:status>=500?502:status,upstreamStatus:status,requestId:requestId||undefined};
}
