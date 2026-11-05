/** Locate actual future outgoing predicates, including coordinated actions.
 * Incoming email/reply nouns, negated sends and approval-only gerunds are
 * not delivery commitments. This locates actions; it grants no permission. */
export function affirmativeOutgoingDocumentActions(text:string):{start:number;end:number;text:string}[]{
 const line=text.replace(/[’‘]/g,"'"),found:{start:number;end:number;text:string}[]=[];
 for(const future of line.matchAll(/\b(?:I|we)(?:'ll|\s+(?:will|can|would|won't|cannot|can't))\b/gi)){
  const offset=(future.index||0)+future[0].length,action=line.slice(offset).split(/[.!?;]/,1)[0];
  for(const verb of action.matchAll(/\b(?:send(?:ing)?|email(?:ing)?|shar(?:e|ing)|forward(?:ing)?|includ(?:e|ing)|attach(?:ing)?|reply(?:ing)?|respond(?:ing)?)\b/gi)){
   const before=action.slice(0,verb.index),coordinator=[...before.matchAll(/\b(?:and|but|then|however)\b/gi)].at(-1);
   const governing=coordinator?before.slice((coordinator.index||0)+coordinator[0].length):before;
   if(!coordinator&&/\b(?:won't|cannot|can't)\b/i.test(future[0])||/\b(?:not|never|don't|won't|cannot|can't)\s+(?:\w+\s+)?$/i.test(governing))continue;
   if(/ing$/i.test(verb[0])&&!/\b(?:be|start|begin|continue)\s+(?:\w+ly\s+)*$/i.test(governing))continue;
   if(/\b(?:before|until)\s+(?:I|we)\s*$/i.test(governing))continue;
   if(/^(?:email|reply)$/i.test(verb[0])&&/\b(?:a|an|the|your|our|my|their|his|her|this|that|for|from|by)\s+(?:\w+\s+)?$/i.test(before))continue;
   const start=offset+(verb.index||0);found.push({start,end:start+verb[0].length,text:verb[0]});
  }
 }
 for(const passive of line.matchAll(/\b(?:report|documents?)\s+will\s+be\s+(sent|emailed|shared|forwarded|included|attached)\b/gi)){
  const start=(passive.index||0)+passive[0].lastIndexOf(passive[1]);found.push({start,end:start+passive[1].length,text:passive[1]});
 }
 return found.filter((value,index)=>found.findIndex(other=>other.start===value.start&&other.end===value.end)===index).sort((one,two)=>one.start-two.start);
}
export function hasAffirmativeOutgoingDocumentAction(text:string):boolean {return affirmativeOutgoingDocumentActions(text).length>0;}
