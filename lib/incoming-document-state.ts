import {deriveDocumentState} from './document-state.ts';
import {reviewedClientContext,type ClientContextCarrier} from './client-coaching-context.ts';
type Turn={id?:string;role:string;text:string;transcriptionUncertainty?:unknown};
type Context=ClientContextCarrier&{turns?:Turn[]};
export type IncomingDrawingState={state:'unconfirmed'|'promised'|'buyer_reports_sent'|'received';sourceTurnIds:string[];evidence:string[]};
const normalize=(text:string)=>text.replace(/[’‘]/g,"'");
/** Track actions actually spoken, not suggested wording. A buyer's past send
 * report and the rep's receipt are distinct. A future/subordinate prerequisite
 * (“once we receive it”) cannot become completed receipt. */
export function incomingDrawingState(context:Context):IncomingDrawingState{
 const client=reviewedClientContext(context);
 const record=deriveDocumentState({turns:context.turns,seed:client?.standing?.documentState}).transfers.find(row=>row.document==='drawings'&&row.sender==='buyer');
 if(!record)return {state:'unconfirmed',sourceTurnIds:[],evidence:[]};
 const state:IncomingDrawingState['state']=record.events.at(-1)?.kind==='restricted'?'unconfirmed':record.receiptStatus==='confirmed'?'received':record.sendStatus==='reported_sent'?'buyer_reports_sent':['promised','offered'].includes(record.phase)?'promised':'unconfirmed';
 const last=record.events.at(-1);return {state,sourceTurnIds:last?[last.turnId]:[],evidence:last?[last.quote]:[]};
}
export function incomingDocumentWordingEffects(say:string,context:Context):{problems:string[];qualityFeedback:string[]}{
 const incoming=incomingDrawingState(context),problems:string[]=[],qualityFeedback:string[]=[];
 for(const sentence of normalize(say).split(/(?<=[.!?;])\s+/)){
  const receipt=/^\s*(?:(?:thanks|thank you|great|okay|ok)[,.!]\s*)?(?:I|we)(?:'ve| have)?\s+(?:already\s+)?(?:received|got)\s+(?:your|the|that|this)\s+(?:drawing|blueprint|diagram)\b/i.test(sentence);
  if(receipt&&incoming.state!=='received')problems.push('The incoming drawing has not been confirmed received in the actual conversation. A buyer’s offer, future send or reported send does not prove receipt. Acknowledge the pending action and its useful next step without claiming it arrived.');
  if(incoming.state==='promised'&&/^(?:thanks|thank you)\s+for\s+(?:sending|emailing|forwarding)\s+(?:that|this|it|(?:your|the) drawing)[.!]?$/i.test(sentence.trim()))qualityFeedback.push('The buyer offered a future send. Prefer future-accurate gratitude such as “Thanks, that would help”; this anticipatory courtesy alone is not evidence of receipt or a reason for remote verification.');
 }
 return {problems,qualityFeedback};
}
