import type {Manufacturer,CallRecord} from './trade';
import {defaultCallContext,normalizeCallContext} from './call-purpose.ts';
import {deriveConversationState} from './conversation-state.ts';
import {captureLearning,rateLearning,rememberBuyer,recordDecisions,type CompanyBrainRecord} from './company-brain.ts';

type LegacyCall=Pick<CallRecord,'manufacturerId'|'buyer'|'turns'|'suggestions'|'startedAt'|'callContext'>&Partial<CallRecord>;
/** Narrow evidence repair for legacy auto-extraction. Preserve the original
 * fact as an excluded audit entry; never alter client updates, calls or other
 * buyer facts. Ambiguous origins and manually supplied facts are left alone. */
export function excludeRepEmailEchoFacts(brain:CompanyBrainRecord,calls:CallRecord[],now=Date.now()):CompanyBrainRecord {
 let changed=false;
 const addresses=(text:string)=>text.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/ig)?.map(value=>value.toLowerCase())||[];
 const buyers=brain.buyers.map(memory=>{
  const fact=memory.facts.email;if(fact?.source!=='transcript'||!fact.turnId||!fact.quote||!fact.value)return memory;
  const linked=new Set(memory.history.map(row=>row.callId));
  const matches=calls.filter(call=>call.manufacturerId===brain.companyId&&linked.has(call.id)).flatMap(call=>call.turns.filter(turn=>turn.id===fact.turnId&&turn.role==='buyer'&&turn.text===fact.quote&&/\byour (?:e-?mail(?: address)?|address)\b/i.test(turn.text)&&addresses(turn.text).includes(fact.value.toLowerCase())).map(turn=>({call,turn})));
  if(matches.length!==1)return memory;
  const {call,turn}=matches[0],index=call.turns.indexOf(turn);
  if(!call.turns.slice(0,index).some(row=>row.role==='you'&&addresses(row.text).includes(fact.value.toLowerCase())))return memory;
  const facts={...memory.facts};delete facts.email;changed=true;
  const excluded=memory.excludedFacts||[],already=excluded.some(row=>row.field==='email'&&row.callId===call.id&&row.sourceTurnId===turn.id&&row.original.value===fact.value);
  return {...memory,facts,excludedFacts:already?excluded:[...excluded,{field:'email' as const,reason:'salesperson_email_read_back' as const,callId:call.id,sourceTurnId:turn.id,original:structuredClone(fact),excludedAt:now}],updatedAt:now};
 });
 return changed?{...brain,buyers,updatedAt:now}:brain;
}
/** Preserve existing rated rows. Original prompts cannot be recovered and are explicitly marked as unavailable. */
export function migrateBrainHistory(company:Manufacturer,brain:CompanyBrainRecord,calls:CallRecord[],draft?:LegacyCall):CompanyBrainRecord {
 let next=excludeRepEmailEchoFacts(brain,calls);
 for(const call of [...calls,...draft?[draft]:[]]){
  if(call.manufacturerId!==company.id)continue;
  const turns=call.turns||[],callContext=normalizeCallContext(call.callContext||defaultCallContext()),callId=call.id||`draft-${call.startedAt||0}`;
  for(const row of call.suggestions||[]){
   if(row.coachingIssue)continue; // An audit-only rejected draft is not user feedback.
   if(!['used','edited','ignored'].includes(row.status)||next.learning.some(pair=>pair.suggestionId===row.id))continue;
   const index=turns.findIndex(turn=>turn.id===row.triggerTurnId||!row.triggerTurnId&&turn.role!=='you'&&turn.text===(row.buyerQuote||row.guidance.questionEcho));
   if(index<0)continue; // Never misattribute a historical row to today's latest buyer turn.
   const window=turns.slice(0,index+1),state=deriveConversationState({turns:window,callContext,stageMap:brain.playbook.stages});
   const original=row.originalSay||row.guidance.say,actual=row.status==='used'?(row.actualSpoken||row.guidance.say):row.status==='edited'?(row.originalSay?row.guidance.say:row.actualSpoken||''):'';
   const capture={companyId:company.id,callId,buyer:call.buyer||'',buyerWindow:window.slice(-16),stageId:state.stageId,moment:state.moment,callContext,state,prompt:'Legacy record: original generation prompt was not captured. Context below is reconstructed from actual saved turns.',requestContext:{legacy:true,manufacturer:{id:company.id,name:company.name,products:company.products},callContext,turns:window}};
   const verdict=row.status==='used'?'Used':row.status==='edited'?'Edited':'Ignored';
   next=rateLearning(captureLearning(next,row.id,original,capture),row.id,verdict,actual,undefined,row.feedbackSource==='manual'?'edited':'speech');
   next={...next,learning:next.learning.map(pair=>pair.suggestionId===row.id?{...pair,at:row.at,outcome:call.outcome||''}:pair)};
  }
  // Canonical client calls already have an explicitly scoped, reviewed memory
  // path. Rebuilding the legacy buyer cache from their raw turns would bypass
  // unchecked wrap-up items and revive facts the salesperson did not retain.
  if(!call.clientId&&call.id&&call.buyer&&!next.buyers.some(buyer=>buyer.history.some(item=>item.callId===call.id))){
   next=rememberBuyer(next,call.buyer,deriveConversationState({turns,callContext,stageMap:next.playbook.stages}),call as CallRecord);
  }
  if(call.id&&(call.decisionsNeeded||[]).some(item=>!next.decisionLog.some(decision=>decision.id===`${call.id}:${item.id}`)))next=recordDecisions(next,call as CallRecord);
 }
 return next;
}
