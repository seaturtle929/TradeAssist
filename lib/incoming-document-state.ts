type Turn={id?:string;role:string;text:string;transcriptionUncertainty?:unknown};
type Context={turns?:Turn[]};
export type IncomingDrawingState={state:'unconfirmed'|'promised'|'buyer_reports_sent'|'received';sourceTurnIds:string[];evidence:string[]};
const drawing=/\b(?:drawings?|blueprints?|diagrams?)\b/i;
const normalize=(text:string)=>text.replace(/[’‘]/g,"'");
/** Track actions actually spoken, not suggested wording. A buyer's past send
 * report and the rep's receipt are distinct. A future/subordinate prerequisite
 * (“once we receive it”) cannot become completed receipt. */
export function incomingDrawingState(context:Context):IncomingDrawingState{
 let result:IncomingDrawingState={state:'unconfirmed',sourceTurnIds:[],evidence:[]};
 for(const turn of context.turns||[]){
  if(turn.transcriptionUncertainty||!['buyer','customer','you'].includes(turn.role))continue;
  for(const sentence of normalize(turn.text).split(/(?<=[.!?;])\s+/)){
   if(!drawing.test(sentence))continue;
   const prefix='(?:I|we)';
   const object='[^.!?;]{0,55}\\b(?:drawings?|blueprints?|diagrams?)\\b';
   const future=!sentence.includes('?')&&new RegExp('\\b'+prefix+'(?:\\x27ll|\\s+(?:will|can|could|would|plan to|intend to))\\s+(?:send|email|forward|share)\\b'+object,'i').test(sentence);
   const sent=!sentence.includes('?')&&new RegExp('^\\s*(?:(?:yes|okay|ok|sure)[,.!]\\s*)?'+prefix+'(?:\\x27ve| have)?\\s+(?:already\\s+)?(?:sent|emailed|forwarded|shared)\\b'+object,'i').test(sentence);
   const received=!sentence.includes('?')&&/^\s*(?:(?:yes|okay|ok|great)[,.!]\s*)?(?:I|we)(?:'ve| have)?\s+(?:already\s+)?(?:received|got)\s+(?:your|the|that|this)\s+(?:drawing|blueprint|diagram)\b/i.test(sentence);
   const denied=/\b(?:I|we)\s+(?:haven't|have not|didn't|did not)\s+(?:received?|got)\b/i.test(sentence);
   const state=turn.role==='you'?(denied?'unconfirmed':received?'received':undefined):sent?'buyer_reports_sent':future?'promised':undefined;
   if(state)result={state,sourceTurnIds:turn.id?[turn.id]:[],evidence:[sentence.trim()]};
  }
 }
 return result;
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
