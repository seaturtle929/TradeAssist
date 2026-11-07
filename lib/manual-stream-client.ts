import type {CoachingPhaseTiming} from './coaching-timing';
import type {Guidance} from './trade';
import type {UsageEntry} from './costs';
export type ManualStreamEvent={type:string;rejectedSay?:string;reasons?:string[];model?:string;serviceTier?:string;requestedServiceTier?:string;source?:string;guidance?:Guidance;replaced?:boolean;originalSay?:string;error?:string;message?:string;_charges?:UsageEntry[];timing?:{verificationFinishedMs?:number;usageUnconfirmed?:boolean;phases?:CoachingPhaseTiming}};
/** Transport chunks may split a UTF-8 character or several NDJSON events. */
export async function readManualStream(response:Response,onEvent:(event:ManualStreamEvent)=>void,signal?:AbortSignal) {
 if(!response.ok){const data=await response.json().catch(()=>({error:'Could not start manual guidance.'})) as {error?:string;_charges?:UsageEntry[]};if(Array.isArray(data._charges))onEvent({type:'charges',_charges:data._charges});throw new Error(data.error||'Could not start manual guidance.');}
 if(!response.body)throw new Error('The suggestion stream was empty.');
 const reader=response.body.getReader(),decoder=new TextDecoder();let buffered='';
 const consume=(line:string)=>{if(line.trim())onEvent(JSON.parse(line));};
 const cancel=()=>{void reader.cancel().catch(()=>{});};signal?.addEventListener('abort',cancel,{once:true});
 try{while(true){if(signal?.aborted)return;const {value,done}=await reader.read();if(signal?.aborted)return;buffered+=decoder.decode(value,{stream:!done});let end;while((end=buffered.indexOf('\n'))>=0){consume(buffered.slice(0,end));buffered=buffered.slice(end+1);}if(done)break;}consume(buffered);}
 finally{signal?.removeEventListener('abort',cancel);reader.releaseLock();}
}
