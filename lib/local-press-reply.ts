import type {CoachingContext} from './call-coaching';
import type {Guidance} from './trade';
import {coachingRequestFocus} from './coaching-context-snapshot.ts';
import {callRouteAtRequest} from './call-route.ts';
import {deriveCallParticipant,currentParticipantPickup,isParticipantIntroduction} from './call-participant.ts';
import {representativeIdentityFor} from './representative-identity.ts';
import {buyerReferenceExplicitlyConfirmed,buyerProductIdentifierReferences} from './product-identity-evidence.ts';
import {hasClearConversationRefusal} from './conversation-boundary.ts';
import {requestsDocumentProductCoverage} from './document-product-evidence.ts';
import {deriveBuyerDeferral} from './buyer-deferral.ts';

/** Leave render headroom inside the 1.8s speech-end target. This is a local
 * completion deadline, not a claim about provider or transcription speed. */
export const PRESS_REPLY_DEADLINE_MS=1500;

function ready(say:string,context:CoachingContext,origin:'generated'|'local',reason?:string):Guidance {
 return {say,ask:'',intent:'Respond to the current buyer',nextStep:'Follow through on the spoken response',caution:'',evidence:[],missing:[],verified:true,verificationStatus:'not_required',phase:'answer',analysisReady:true,scriptComplete:true,replyOrigin:origin,...reason?{localReason:reason}:{},questionEcho:coachingRequestFocus(context).displayText};
}

const cleanLabel=(text?:string)=>text?.replace(/[\r\n]+/g,' ').trim().slice(0,120)||'';
function introduction(context:CoachingContext){
 const rep=representativeIdentityFor(context)?.name,company=cleanLabel(context.manufacturer?.name);
 if((context.interactionType||context.clientContext?.interactionType)==='text_email')return company?`Hello, I'm with ${company}.`:rep?`Hello, this is ${rep}.`:'Hello.';
 return rep&&company?`Hi, this is ${rep} from ${company}.`:company?`Hi, I'm with ${company}.`:rep?`Hi, this is ${rep}.`:'Hi, thanks for taking my call.';
}

/** A controlled response never borrows facts, promises or references from a
 * rejected draft. It offers an investigation, not document sending, coverage,
 * product performance, a deadline, or completion of a buyer's future action. */
export function makeLocalPressReply(context:CoachingContext,reason='generation_failed'):Guidance {
 const focus=coachingRequestFocus(context),text=focus.text;
 let say:string;
 if(reason==='transcription_incomplete'||focus.kind==='partial'||focus.kind==='pending')say='Sorry, could you repeat that last part?';
 else if(focus.role==='conversation')say='Could you clarify that last point for me?';
 else {
  const turns=context.turns||[],participant=deriveCallParticipant(turns),route=callRouteAtRequest(context);
  const channel=context.interactionType||context.clientContext?.interactionType||'call_meeting',written=channel==='text_email';
  const pickup=currentParticipantPickup({text,id:focus.turnId},participant);
  const greeting=pickup?.kind==='greeting_only'||isParticipantIntroduction(text);
  const identityQuestion=/\bwho(?:['’]s| is) (?:this|calling)|\bwho are you\b|\bwhat(?:['’]s| is) (?:this(?: call)?|your call) (?:about|regarding)|\bhow (?:can|may) I help\b/i.test(text);
  if(hasClearConversationRefusal(text))say='Understood. Thank you for your time.';
  else if(!written&&participant.transferPending&&!pickup)say="Thank you, I'll hold.";
  else if((!text||greeting||identityQuestion)&&route?.routingNeeded){
   const target=cleanLabel(route.target?.name),role=cleanLabel(route.target?.role);
   say=introduction(context)+' '+(target?`Could you put me through to ${target}${role?` in ${role}`:''}, please?`:'Could I speak with the person who handles purchasing, please?');
  }
  else if(identityQuestion)say=introduction(context)+(written?" I’d like to understand what you need.":channel==='in_person'?" I’d like to introduce our company.":" I'm calling to introduce our company.");
  else if(!text||greeting||/^(?:hi|hello|hey|good (?:morning|afternoon|evening))[!,.\s]*$/i.test(text))say=introduction(context)+(written?' How can I help with what you’re working on?':context.manufacturer?.name||representativeIdentityFor(context)?channel==='in_person'?' Thanks for taking the time.':' Thanks for taking my call.':'');
  else if(deriveBuyerDeferral(turns)?.nextMove==='acknowledge_and_offer_next_step')say='Of course. Would it be alright if I followed up with you?';
  else if(/\b(?:goodbye|bye|have a (?:good|great|nice) (?:day|one))\b/i.test(text)&&!text.includes('?'))say='Thank you for your time. Have a good day.';
  else if(/\b(?:report|document|certificate|certification)\b/i.test(text))say="I'll check the details and get back to you.";
  else if(/\b(?:send|email|share)\b[^.!?]{0,90}\b(?:drawing|requirements|specifications)\b/i.test(text))say="Thanks, that would help. I'll review the details when you send them.";
  else if(/\b(?:what|which|how|why|does|can|could|would|is|are|price|cost|spec|stock|lead time)\b|\?/i.test(text))say='Let me check that and get back to you.';
  else if(/\b(?:unclear|couldn't hear|could not hear|not sure what|sorry)\b/i.test(text))say='Could you clarify that last point for me?';
  else say='Could you tell me a little more about what you need?';
 }
 return ready(say,context,'local',reason);
}

/** Deliberately narrow whole-reply fast acceptance. The entire spoken reply
 * must be a future check, optionally followed by getting back to the buyer.
 * A mixed factual assertion or a promise to send cannot enter this path.
 * This does not replace the normal grounding checks for substantive claims. */
export function readyNonAssertiveInquiry(say:string,context:CoachingContext):Guidance|undefined {
 const normalized=say.trim().replace(/[’‘]/g,"'").replace(/\s+/g,' ');
 const match=/^(?:(?:Thanks|Thank you)[,.!]\s*)?(?:I'll|I will|Let me) (?:check|verify|find out)(?: (?:whether|if) (?:the|this|that|our) (?:material test report|test report|report|document) (?:covers|matches|applies to) ([A-Za-z0-9][A-Za-z0-9 ,’'—–-]{0,90})| (?:that|the details|those details|the coverage|coverage))(?: and (?:get|come) back to you)?[.!]?$/i.exec(normalized);
 if(!match)return;
 const reference=match[1];
 // The reference capture cannot swallow another action or assertion.
 if(reference&&/\b(?:and|but|then|will|send|forward|ship|certified|guarantee|tomorrow|today|soon|shortly|asap|within)\b/i.test(reference.replace(/ and (?:get|come) back to you$/i,'')))return;
 const focus=coachingRequestFocus(context);
 if(focus.kind==='partial'||focus.kind==='pending'||focus.role==='conversation')return;
 // This fast path is for an actual open question/check, not a greeting,
 // refusal, already-completed close, or a historical request after restart.
 if(!focus.text||hasClearConversationRefusal(focus.text)||!(/\?|\b(?:check|verify|find out|whether|confirm|tell me|let me know)\b/i.test(focus.text)||requestsDocumentProductCoverage(focus.text)))return;
 let spoken=normalized;
 if(reference){
  const target=reference.replace(/ and (?:get|come) back to you$/i,'').trim();
  // An asserted company-owned product is not merely an uncertain customer
  // reference. Keep that premise on the normal factual-validation path.
  if(/\b(?:our|we|company['’]s|manufacturer['’]s)\b/i.test(target))return;
  const generic=/^(?:your (?:exact )?(?:requirements|mesh|reference|drawing)|it|that)$/i.test(target);
  const current=buyerProductIdentifierReferences(focus.text,focus.text);
  const literalCurrent=current.some(item=>item.text===target)&&new Set(current.map(item=>item.text)).size===1;
  if(!generic&&!literalCurrent&&!buyerReferenceExplicitlyConfirmed(target,context.turns||[]))spoken=normalized.replace(target,'your requirements');
 }
 return ready(spoken,context,'generated');
}
