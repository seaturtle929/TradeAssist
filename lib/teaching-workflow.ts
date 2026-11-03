import type {CallRecord} from './trade';
import type {CompanyBrainRecord} from './company-brain';
import type {TeachingActor,TeachingMoment,TeachingProposal} from './company-teaching';
import type {SuggestionRecord} from './phase1-types';
import {addClientContextEntry,type ContactEvidenceReview} from './client-records.ts';

export function teachingMomentFor(call:CallRecord,suggestion?:SuggestionRecord,turnId?:string):TeachingMoment {
 const turnIndex=turnId?call.turns.findIndex(turn=>turn.id===turnId):-1;
 const transcript=turnIndex>=0?call.turns.slice(0,turnIndex+1):suggestion?.learningCapture?.buyerWindow||call.turns.filter(turn=>!suggestion||turn.at<=suggestion.at);
 return {callId:call.id,clientId:call.clientId,suggestionId:suggestion?.id,stageId:suggestion?.learningCapture?.stageId||call.companyConfiguration?.selectedStageId||call.callContext?.stageId||'cold_call',turns:structuredClone(transcript),suggestedLine:suggestion?.originalSay||suggestion?.guidance.say||'',actualLine:suggestion?.status==='edited'?suggestion.guidance.say:suggestion?.actualSpoken,at:suggestion?.at||transcript.at(-1)?.at||call.startedAt};
}
function authorize(proposal:TeachingProposal,companyId:string,actor:TeachingActor) {
 if(actor!=='manager')throw Error('A manager must review and apply this correction.');
 if(proposal.companyId!==companyId)throw Error('This feedback belongs to a different company.');
 if(!proposal.instruction.trim())throw Error('Enter the corrected information before applying.');
}
export function applyTeachingClientMemory(brain:CompanyBrainRecord,proposal:TeachingProposal,actor:TeachingActor,now=Date.now()):CompanyBrainRecord {
 authorize(proposal,brain.companyId,actor);
 if(proposal.destination!=='client_memory')throw Error('This proposal is not a client-memory update.');
 const client=brain.clients?.find(item=>item.id===proposal.moment.clientId&&item.companyId===brain.companyId);
 if(!client)throw Error('Associate the saved call with the correct client before adding client memory.');
 const updated=addClientContextEntry(client,{id:proposal.id,kind:'update',text:proposal.instruction,source:'manager',scope:'client',callId:proposal.moment.callId},now);
 return {...brain,updatedAt:now,clients:brain.clients?.map(item=>item.id===client.id?updated:item)};
}
/** Preserve the original transcript and all old reviews. Derived summaries are
 * marked stale so a corrected word cannot coexist with trusted old conclusions. */
export function applyTeachingTranscript(call:CallRecord,proposal:TeachingProposal,actor:TeachingActor,now=Date.now()):CallRecord {
 authorize(proposal,call.manufacturerId,actor);
 if(proposal.destination!=='transcript'||proposal.moment.callId!==call.id)throw Error('Select the saved call for this transcript correction.');
 const turn=call.turns.find(item=>item.id===proposal.correctionTurnId);
 if(!turn)throw Error('The transcript line to correct was not found.');
 return {...call,derivedReviewStale:true,turns:call.turns.map(item=>item.id!==turn.id?item:{...item,text:proposal.instruction.trim(),translationZh:undefined,corrections:[...(item.corrections||[]),{originalText:item.text,originalRole:item.role,text:proposal.instruction.trim(),role:item.role,reason:proposal.explanation,at:now,source:'manager_review'}]})};
}
export function markCorrectedClientEvidence(brain:CompanyBrainRecord,call:CallRecord,turnId:string,now=Date.now()):CompanyBrainRecord {
 if(brain.companyId!==call.manufacturerId)return brain;
 return {...brain,updatedAt:now,clients:brain.clients?.map(client=>client.id!==call.clientId?client:{...client,updatedAt:now,contacts:client.contacts.map(contact=>{
  if(contact.provenance?.callId!==call.id||contact.provenance.sourceTurnId&&contact.provenance.sourceTurnId!==turnId)return contact;
  const review:ContactEvidenceReview={required:true,reason:'The transcript supporting these contact details was corrected. Review every field before reusing it.',callId:call.id,sourceTurnId:turnId,markedAt:now,original:{name:contact.name,role:contact.role,email:contact.email,phone:contact.phone,meetingLink:contact.meetingLink,otherMethods:contact.otherMethods?structuredClone(contact.otherMethods):undefined}};
  return {...contact,review,reviewHistory:[...(contact.reviewHistory||[]),...contact.review?[structuredClone(contact.review)]:[]],updatedAt:now};
 }),context:client.context.map(entry=>entry.callId===call.id&&(!entry.sourceTurnId||entry.sourceTurnId===turnId)?{...entry,needsReview:true,updatedAt:now}:entry)})};
}
