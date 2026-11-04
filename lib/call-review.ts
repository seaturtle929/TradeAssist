import type {Turn} from './trade';
import {deriveCallParticipant} from './call-participant.ts';
import {deriveCallAccomplishment,reviewedPurchasingContact,type ReviewCall} from './call-accomplishment.ts';
import {deriveSpokenDocumentEvidence,isRepContactDetailRequest} from './document-call-evidence.ts';

export type CallReview={recap:string;outcome:string;sourceTurnIds:string[];unknowns:string[]};
const clean=(text:string)=>text.replace(/[’‘]/g,"'").replace(/\s+/g,' ').trim();
const email=/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/ig;
const message=/\b(?:message|note|pass (?:that|it|this) along|relay|callback|call(?:ing)? back)\b/i;
const unavailable=/\b(?:unavailable|not available|isn't available|not in|isn't in|out of (?:the )?office|not here)\b/i;
const actualPromise=/\b(?:I|we)(?:'ll| will)\s+(?:pass|relay|forward|give|send|email|share|review|check|confirm|call|contact)\b/i;
const possibleAction=/\b(?:I|we)\s+(?:can|could|may|might)\s+(?:pass|take|relay|forward|send|email|share|review|call)\b/i;
const actionRequest=/\b(?:please|can you|could you|would you|how about|you can)\b.{0,70}\b(?:include|attach|send|email|share|leave|call|contact|quote)\b/i;
const conditional=/\b(?:if|unless|might|maybe|perhaps|not|never|haven't|have not|didn't|did not|no confirmation|no record)\b/i;
const refusal=/\b(?:do not call|don't call|stop calling|not interested|remove (?:me|us)|take (?:me|us) off)\b/i;
const housekeeping=/^(?:start call|sure|okay|ok|yeah|yes|ja|got it|thanks|thank you|you're welcome|you are welcome|you too|have a good one|bye(?:-bye)?|goodbye)[,.! ]*$/i;
const identity=/\b(?:my name is|I'm|I am|this is)\s+([A-Z][a-z'-]+(?:\s+[A-Z][a-z'-]+)?)(?=[,.!]|\s+(?:from|with|at|in|and)|$)/;
const requestedTarget=(text:string)=>text.match(/\b(?:check if|see if|speak (?:to|with)|ask for|pass (?:that|it|this) along to)\s+([A-Z][a-z'-]+)(?:'s| is|\b)/)?.[1]||text.match(/\b([A-Z][a-z'-]+)(?:'s| is)\s+(?:not available|unavailable|not in|out of)/)?.[1];
const excerpt=(text:string)=>clean(text).slice(0,650);
const quote=(turn:Turn)=>`“${excerpt(turn.text)}”`;
const assignedOutcome=(value:string|undefined)=>!!value?.trim()&&!/^(?:unrated|unknown|not rated|not selected)$/i.test(value.trim());

/** Extractive review of finalized speech only. Suggestions, stage goals and
 * preparation can resolve a role only after a matching spoken identity; it
 * cannot become an event that happened on the call.
 * Every selected detail keeps an actual turn ID; the full transcript survives. */
export function deriveCallReview(call:ReviewCall):CallReview {
 const captured=call.turns.filter(turn=>turn.text.trim()),uncertain=captured.filter(turn=>turn.transcriptionUncertainty),turns=captured.filter(turn=>!turn.transcriptionUncertainty),buyer=turns.filter(turn=>turn.role==='buyer'),rep=turns.filter(turn=>turn.role==='you');
 const captureWarning='Transcription was uncertain for part of this call. Those words remain in the transcript for review and were not treated as established facts.';
 if(!turns.length)return {recap:uncertain.length?captureWarning+' No reliable finalized conversation was captured. Review or correct the transcript before relying on the call result.':'No finalized conversation was captured. Review the salesperson notes and add the call result if known.',outcome:assignedOutcome(call.outcome)?call.outcome:uncertain.length?'Call result unclear — transcription needs review':'No spoken conversation captured',sourceTurnIds:[],unknowns:[uncertain.length?captureWarning:'The conversation result is not established by a transcript.']};
 const participant=deriveCallParticipant(turns),knownContact=reviewedPurchasingContact(call,participant),documents=deriveSpokenDocumentEvidence(captured),used=new Set<string>(),unknowns:string[]=uncertain.length?[captureWarning]:[],lines:string[]=[];
 const markEvidence=(turn:Turn|undefined)=>{if(turn)used.add(turn.id);return turn;};
 const routingTurns=buyer.filter(turn=>unavailable.test(clean(turn.text))||message.test(turn.text)||/\b(?:connect|transfer) you\b/i.test(turn.text));
 const targets=[...new Set(buyer.map(turn=>requestedTarget(clean(turn.text))).filter((name):name is string=>!!name))];
 const transfer=participant.transfer,target=transfer?.targetName||targets.at(-1),targetPickup=transfer?.status==='completed'||!!target&&buyer.some(turn=>identity.exec(clean(turn.text))?.[1].toLowerCase()===target.toLowerCase());
 const routing=participant.role==='routing'||routingTurns.length>0&&!targetPickup&&participant.role!=='purchasing';
 const purchasingReached=participant.role==='purchasing'||!!knownContact||targetPickup;
 if(routing&&!purchasingReached){lines.push(`Participants: salesperson and a routing contact. ${target?target+' was':'The purchasing contact was'} not reached in the captured conversation.`);for(const turn of routingTurns)markEvidence(turn);unknowns.push('Purchasing needs and buying interest remain unconfirmed.');}
 else if(participant.role==='purchasing')lines.push(`Participants: salesperson and a contact who confirmed purchasing responsibility${participant.speakerName?' ('+participant.speakerName+')':''}.`);
 else if(knownContact)lines.push(`Participants: salesperson and ${knownContact.name} in purchasing. The speaker identified themselves on this call; purchasing responsibility was established in the reviewed prior call.`);
 else if(targetPickup){lines.push(`Participants: salesperson and ${target||participant.speakerName||'a new contact'}, following the earlier routing exchange.`);unknowns.push('The new contact’s purchasing responsibility was not confirmed; an introduction alone does not establish authority.');}
 else lines.push('Participants: salesperson and the person answering; purchasing responsibility was not confirmed in the captured conversation.');
 if(transfer){
  const conditionTurn=buyer.find(turn=>/\b(?:(?:connect|transfer) you|put you through|pass you (?:over|through|to))\b/i.test(turn.text)&&/\b(?:if|unless|once|when|provided|assuming|might|maybe)\b/i.test(clean(turn.text)));
  if(conditionTurn){markEvidence(conditionTurn);lines.push('Conditional transfer offered: '+quote(conditionTurn));}
  const transferTurn=buyer.find(turn=>turn.id===transfer.evidence.turnId);markEvidence(transferTurn);
  const evidence=transferTurn?quote(transferTurn):`“${excerpt(transfer.evidence.quote)}”`;
  if(transfer.status==='intended'){
   if(!conditionTurn)lines.push('Transfer intended, not confirmed as completed: '+evidence);
   unknowns.push(`The conditional transfer to ${target||'the intended contact'} was not confirmed as completed; no conversation with that contact was captured.`);
  }else if(transfer.status==='pending'){
   lines.push('Transfer in progress at the end of captured routing speech: '+evidence);
   unknowns.push(`Connection to ${target||'the intended contact'} was not confirmed; a transfer attempt is not a completed handoff.`);
  }else if(transfer.status==='unavailable')lines.push('Transfer attempt ended with the contact unavailable: '+evidence);
  else lines.push('A new contact actually joined after the routing exchange: '+evidence);
 }
 const repIntent=rep.find(turn=>/\b(?:manufactur\w*|export\w*|supply|supplies|supplier|calling (?:from|about|regarding)|represent|offer|company profile)\b/i.test(turn.text)&&!housekeeping.test(clean(turn.text)));
 if(repIntent){markEvidence(repIntent);lines.push('Reason for calling, as spoken by the salesperson: '+quote(repIntent));}
 const namedRole=buyer.find(turn=>/\b(?:handles?|responsible for|in charge of)\b.{0,65}\b(?:purchasing|procurement|production|materials?)\b/i.test(turn.text));
 if(namedRole){markEvidence(namedRole);lines.push('Contact information reported: '+quote(namedRole));}
 const unavailableTurn=buyer.findLast(turn=>unavailable.test(clean(turn.text)));
 if(unavailableTurn&&routing&&!purchasingReached){markEvidence(unavailableTurn);lines.push('Availability: '+quote(unavailableTurn));}
 const buyerAction=buyer.findLast(turn=>actualPromise.test(clean(turn.text))&&!conditional.test(clean(turn.text)));
 const offer=buyer.findLast(turn=>possibleAction.test(clean(turn.text)));
 const messagePromise=buyerAction&&message.test(buyerAction.text),repMessage=rep.find(turn=>/\b(?:leave a (?:brief )?message|please let|please tell)\b/i.test(turn.text));
 const messageAccepted=!!messagePromise&&!!repMessage&&turns.indexOf(buyerAction)>turns.indexOf(repMessage);
 if(buyerAction){markEvidence(buyerAction);lines.push((messageAccepted?'Agreed follow-up: the contact accepted the message and said ':'Contact’s stated next step: ')+quote(buyerAction));if(messagePromise)unknowns.push(`${target||'The intended contact'} receiving the message is not confirmed; a promise to pass it along is not delivery.`);}
 else if(offer){markEvidence(offer);lines.push('Offered follow-up, not confirmed as completed: '+quote(offer));unknowns.push('Acceptance or completion of the offered follow-up was not captured.');}
 const repAction=rep.findLast(turn=>actualPromise.test(clean(turn.text))&&!conditional.test(clean(turn.text))&&!/\b(?:hold on|while you check)\b/i.test(turn.text));
 if(repAction&&!documents.agreements.some(item=>item.turnId===repAction.id)){markEvidence(repAction);lines.push('Salesperson’s stated next step: '+quote(repAction));}
 const repEmails=new Set(rep.flatMap(turn=>clean(turn.text).match(email)||[]).map(value=>value.toLowerCase()));
 const buyerEmails=buyer.flatMap(turn=>clean(turn.text).match(email)||[]).filter(address=>!repEmails.has(address.toLowerCase()));
 const documentLines:string[]=[],documentUnknowns:string[]=[];
 for(const request of documents.requests){used.add(request.turnId);documentLines.push(`Buyer requested the ${request.documents.join(' and ')}: “${excerpt(request.quote)}”`);}
 for(const agreement of documents.agreements){used.add(agreement.turnId);documentLines.push(`Salesperson’s stated next step: agreed to send the ${agreement.documents.join(' and ')}. Spoken: “${excerpt(agreement.quote)}”`);}
 for(const cancellation of documents.cancellations){used.add(cancellation.turnId);documentLines.push(`Buyer cancelled the ${cancellation.documents.join(' and ')}: “${excerpt(cancellation.quote)}”`);}
 if(documents.requests.length||documents.agreements.length){
  documentLines.push(documents.activeDocuments.length?`Current requested document bundle: ${documents.activeDocuments.join(' and ')}.`:'No requested documents remain.');
  documentLines.push('A document request or send agreement alone does not confirm completed sending or receipt.');
  if(documents.activeDocuments.length&&!buyerEmails.length)documentUnknowns.push('The destination email address remains unconfirmed.');
 }
 lines.push(...documentLines);unknowns.push(...documentUnknowns);
 const offeredAddress=buyer.find(turn=>/\b(?:(?:our|their|the)\s+)?(?:purchasing|general|direct|shared|department(?:al)?)\s+(?:email|inbox)\b|\b(?:our|their|his|her)\s+(?:email(?: address)?|inbox)\b/i.test(turn.text));
 if(offeredAddress&&!buyerEmails.length){markEvidence(offeredAddress);unknowns.push('A purchasing email route was mentioned, but no buyer email address was captured.');}
 if(repEmails.size&&buyer.some(turn=>/\byour email\b/i.test(turn.text)))lines.push('The salesperson’s email was repeated by the contact; it is not a captured buyer email address.');
 // Select substantive middle-of-call evidence from the whole transcript. Short
 // courtesy endings must not crowd out the opening, requirements or constraints.
 const evidence=buyer.filter(turn=>!used.has(turn.id)&&!housekeeping.test(clean(turn.text))&&!isRepContactDetailRequest(turn.text)&&!/\b(?:how can I help|what.*call.*regarding)\b/i.test(turn.text)&&(/\b(?:needs?|require\w*|uses?|current|suppliers?|grades?|spec(?:s|ifications?)?|reports?|volumes?|quantit\w*|applications?|tests?|criteria|evaluation|engineer\w*|budget|cost|prices?|concern|problem|risk|timeline|schedule|approval|interested|defer)\b/i.test(turn.text)||actionRequest.test(clean(turn.text))));
 for(const turn of evidence.slice(0,5)){markEvidence(turn);lines.push('Discussed, from the contact: '+quote(turn));}
 const noThanks=buyer.findLast(turn=>refusal.test(clean(turn.text)));
 if(noThanks){markEvidence(noThanks);lines.push('Contact’s final boundary: '+quote(noThanks));}
 if(!buyerAction&&!repAction&&!offer&&!documents.agreements.length)unknowns.push(transfer?'No further agreed follow-up beyond the recorded transfer exchange was captured.':'No agreed next step was captured.');
 if(!buyer.length)unknowns.push('No confirmed buyer speech was captured.');
 if(turns.some(turn=>turn.role==='conversation'))unknowns.push('Some audio has no confirmed speaker attribution; review the original transcript.');
 if(lines.length===1){for(const turn of turns.filter(turn=>!housekeeping.test(clean(turn.text))).slice(0,5)){markEvidence(turn);lines.push(`${turn.role==='you'?'Salesperson':turn.role==='buyer'?'Contact':'Speaker uncertain'}: ${quote(turn)}`);}}
 if(unknowns.length)lines.push('Still unconfirmed: '+unknowns.join(' '));
 const accomplished=deriveCallAccomplishment(call,participant,knownContact);
 if(accomplished&&!noThanks){
  return {recap:[accomplished.recap,...documentLines,...documentUnknowns,...uncertain.length?[captureWarning]:[]].join('\n\n'),outcome:assignedOutcome(call.outcome)?call.outcome:accomplished.outcome,sourceTurnIds:[...new Set([...accomplished.sourceTurnIds,...documents.requests.map(item=>item.turnId),...documents.agreements.map(item=>item.turnId),...documents.cancellations.map(item=>item.turnId)])],unknowns:[...accomplished.unknowns,...documentUnknowns,...uncertain.length?[captureWarning]:[]]};
 }
 const derivedOutcome=noThanks?'Contact declined further discussion':routing&&!purchasingReached?messageAccepted?`Message left with routing contact — ${target||'purchasing contact'} not reached`:offer?`Follow-up offered — ${target||'purchasing contact'} not reached`:transfer?.status==='intended'?`Conditional transfer offered — ${target||'purchasing contact'} not reached`:transfer?.status==='pending'?`Transfer attempted — ${target||'purchasing contact'} connection unconfirmed`:`${target||'Purchasing contact'} not reached`:documents.agreements.length?'Document follow-up agreed':documents.requests.length?'Document request captured':buyerAction?'Next step stated — completion not confirmed':repAction?'Salesperson follow-up promised':targetPickup&&participant.role!=='purchasing'&&!knownContact?'New contact reached — purchasing responsibility unconfirmed':knownContact?'Existing purchasing contact reached — no agreed next step':buyer.length?'Talked, no agreed next step':'No buyer speech captured';
 return {recap:lines.join('\n\n').slice(0,12000),outcome:assignedOutcome(call.outcome)?call.outcome:derivedOutcome,sourceTurnIds:turns.filter(turn=>used.has(turn.id)).map(turn=>turn.id),unknowns};
}
