import type {CallRecord,Turn} from './trade';
import type {CallParticipant} from './call-participant';
import {deriveBuyerDeferral} from './buyer-deferral.ts';

export type ReviewCall=Pick<CallRecord,'turns'|'outcome'|'notes'>&Partial<Pick<CallRecord,'id'|'manufacturerId'|'clientId'|'startedAt'|'preparation'>>;
const clean=(text:string)=>text.replace(/[‘’]/g,"'").replace(/\s+/g,' ').trim();
const sameName=(a:string,b:string)=>{
 const left=clean(a).toLocaleLowerCase(),right=clean(b).toLocaleLowerCase();
 return left===right||!left.includes(' ')&&right.startsWith(left+' ')||!right.includes(' ')&&left.startsWith(right+' ');
};
const title=(text:string)=>text.replace(/\b\w/g,letter=>letter.toUpperCase());
const uncertain=/\b(?:maybe|perhaps|might|may|not sure|unsure|if|unless|haven't|have not|hasn't|has not|didn't|did not|not|never)\b/i;
const clauses=(text:string)=>clean(text).split(/(?<=[.!?;])\s+|\s+(?:but|however)\s+/i);
const materialKinds=(text:string)=>[
 /\bcompany profile\b/i.test(text)?'company profile':'',
 /\b(?:spec|specification) sheets?\b/i.test(text)?'spec sheets':'',
 /\bcatalog(?:ue)?\b/i.test(text)?'catalog':'',
 /\bbrochure\b/i.test(text)?'brochure':'',
].filter(Boolean);
const backup=/\b(?:second|backup|back-up|alternative|alternate|additional)\s+(?:source|supplier)|\b(?:a|another)\s+backup\b/i;
function activeBackupClause(text:string):string|undefined {
 return clauses(text).find(part=>{
  const move=/\b(?:explor\w*|look\w*|want|need|consider\w*|evaluat\w*)\b/i.exec(part);
  if(!move||!backup.test(part)||part.includes('?'))return false;
  // A condition describing *why* a backup is wanted can follow the actual
  // intent. A hypothetical/negated intent itself is never active discovery.
  const before=part.slice(0,move.index);
  return !/\b(?:not|never|no longer|don't|do not|isn't|aren't|might|may|could|would|should|maybe|perhaps|if|unless)\b/i.test(before);
 });
}

/** A spoken, present evaluation is different from a proposed or hypothetical one. */
function activeEvaluation(text:string):{owner:string;object:string}|undefined {
 for(const part of clauses(text)){
  if(part.includes('?'))continue;
  const match=/\b(our engineering team|engineering(?: team)?|our engineer|we)(?:'re|'s| are| is)?\s+(?:evaluating|testing|assessing)\s+(.+?)[.!]?$/i.exec(part);
  if(!match||/\b(?:if|unless|maybe|perhaps|might|may|could|would|should|not|never|no longer)\b/i.test(part.slice(0,match.index)))continue;
  const object=match[2].replace(/[.!]+$/,'').trim();
  if(object&&object.length<=180)return {owner:/^we$/i.test(match[1])?'the buyer':'engineering',object};
 }
}
function drawingEmailOffer(buyer:Turn[]):{turn:Turn;conditional:boolean;preference?:Turn;alreadySent?:Turn;withdrawal?:{turn:Turn;text:string};otherCondition?:string}|undefined {
 let offer:{turn:Turn;text:string}|undefined,withdrawal:{turn:Turn;text:string}|undefined,hasDrawing=false;
 for(const row of buyer){
  for(const part of clauses(row.text)){
   hasDrawing ||= /\bdrawing\b/i.test(part);
   if(!hasDrawing||part.includes('?'))continue;
   const target='(?:it|that|the drawing|a drawing|our drawing)';
   const withdrawn=new RegExp("\\b(?:I|we)\\s+(?:won't|will not|can't|cannot|can no longer|am not going to|are not going to)\\s+(?:email|send)\\s+"+target+"\\b",'i').test(part);
   if(withdrawn){if(offer)withdrawal={turn:row,text:part};continue;}
   const offered=new RegExp("\\b(?:I|we)(?:'ll| will| can)\\s+email\\s+"+target+"\\b",'i').test(part);
   if(offered&&!/\b(?:won't|will not|can't|cannot|not going to)\b/i.test(part)){offer={turn:row,text:part};withdrawal=undefined;}
  }
 }
 if(!offer)return;
 const {turn,text}=offer;
 const preference=buyer.find(row=>{const text=clean(row.text);return /\b(?:prefer|rather|best|easier)\b/i.test(text)&&/\b(?:email|e-mail)\b/i.test(text)&&!/\b(?:not|never|don't|do not|wouldn't|would not)\b.{0,45}\b(?:email|e-mail)\b/i.test(text)&&!/\b(?:prefer|rather)\b.{0,35}\b(?:phone|telephone|call|text)\b/i.test(text);});
 const sent=buyer.slice(buyer.indexOf(turn)+1).find(row=>/\b(?:I|we)(?:'ve| have)?\s+(?:emailed|sent)\s+(?:it|the drawing)\b/i.test(clean(row.text))&&!uncertain.test(clean(row.text)));
 const conditional=/\b(?:when|once|if)\b.{0,55}\bready\b/i.test(text);
 return {turn,conditional,preference,alreadySent:sent,withdrawal,...(/\b(?:if|unless|provided|until)\b/i.test(text)||!conditional&&/\b(?:when|once)\b/i.test(text))?{otherCondition:text}:{}};
}

/** Track only explicitly stated drawing status. A later correction wins over
 * an earlier completed status; a question or hypothetical is not progress. */
function latestDrawingStatus(buyer:Turn[]):{turn:Turn;finished:boolean;time?:string}|undefined {
 let latest:{turn:Turn;finished:boolean;time?:string}|undefined;
 for(const turn of buyer){
  for(const part of clauses(turn.text)){
   if(!/\bdrawing\b/i.test(part)||part.includes('?')||/\b(?:if|unless|when|once|might|maybe|perhaps|would|could)\b/i.test(part))continue;
   if(/\b(?:drawing\b.{0,40}\b(?:isn't|is not|not yet|no longer|never|has not|hasn't|is still being|still being|unfinished)|(?:haven't|have not|hasn't|has not|didn't|did not)\s+(?:yet\s+)?(?:finish(?:ed)?|complet(?:e|ed))\b.{0,30}\bdrawing)\b/i.test(part)){latest={turn,finished:false};continue;}
   const completion=part.match(/\bdrawing\b.{0,30}\b(?:is|was|has been|'s)\s+(?:finished|completed|ready)\b|\b(?:finished|completed)\s+(?:the|our|a)\s+drawing\b/i);
   if(completion){
    const following=part.slice((completion.index||0)+completion[0].length);
    const time=following.match(/^\s+(this morning|this afternoon|this evening|today|yesterday)\b/i)?.[1];
    latest={turn,finished:true,...time?{time}:{}};
   }
  }
 }
 return latest;
}

/** Preserve the actual spoken report commitment, including any conditions in
 * the same turn. A generated suggestion is deliberately not an input. */
function spokenReportCommitment(segment:Turn[]):Turn|undefined {
 return segment.findLast(turn=>turn.role==='you'&&clauses(turn.text).some(part=>
  /\b(?:I|we)(?:'ll| will)\s+(?:(?:be sure to|make sure (?:to|that I|that we)|ensure (?:that )?(?:I|we))\s+)?(?:include|attach|send|share|provide)\b/i.test(part)
  && /\b(?:material|test|testing|inspection|quality)\s+(?:test\s+)?reports?\b/i.test(part)
  && !/\b(?:won't|will not|cannot|can't|not going to)\b/i.test(part)
 ));
}

/** Prior responsibility is reusable only after this call identifies that same
 * person. The intended target, company route and current edited recap are not
 * participant evidence. The frozen pre-call snapshot also prevents future data
 * from leaking into historical replay. */
export function reviewedPurchasingContact(call:ReviewCall,participant:CallParticipant):{name:string;role:'Purchasing'}|undefined {
 const prep=call.preparation,standing=prep?.standing,contact=standing?.contact;
 if(!participant.speakerName||participant.role==='routing'||!prep?.reviewedAt||!call.startedAt||prep.reviewedAt>call.startedAt||prep.callId!==call.id||prep.companyId!==call.manufacturerId||prep.clientId!==call.clientId)return;
 if(!standing?.source||standing.companyId!==call.manufacturerId||standing.clientId!==call.clientId||standing.source.callId===call.id||standing.source.at>=call.startedAt||standing.source.reviewedAt>call.startedAt||!contact||!sameName(contact.name,participant.speakerName)||!/^(?:purchasing|procurement)$/i.test(contact.role||''))return;
 const segment=call.turns.slice(Math.max(0,call.turns.findIndex(turn=>turn.id===participant.segmentStartTurnId))).filter(turn=>turn.role==='buyer'&&!turn.transcriptionUncertainty);
 if(segment.some(turn=>/\b(?:no longer|don't|do not|not)\b.{0,35}\b(?:purchasing|procurement)\b/i.test(clean(turn.text))))return;
 return {name:contact.name,role:'Purchasing'};
}

type Accomplishment={outcome:string;recap:string;sourceTurnIds:string[];unknowns:string[]};
/** A bounded factual discovery digest. This uses buyer speech, its immediate
 * spoken context, and a matched prior identity. Unsaid coaching and the final
 * reviewed recap are deliberately absent from the input contract. */
export function deriveCallAccomplishment(call:ReviewCall,participant:CallParticipant,knownContact?:{name:string;role:string}):Accomplishment|undefined {
 if(participant.role==='routing'||participant.transferPending)return;
 const turns=call.turns.filter(turn=>!turn.transcriptionUncertainty&&turn.role!=='conversation');
 const start=participant.afterTransfer?turns.findIndex(turn=>turn.id===participant.segmentStartTurnId):0;
 const segment=turns.slice(Math.max(0,start)),buyer=segment.filter(turn=>turn.role==='buyer');
 const sourceIds=new Set<string>();
 const mark=(turn:Turn|undefined)=>{if(turn)sourceIds.add(turn.id);};
 const backupTurn=buyer.find(turn=>activeBackupClause(turn.text));
 const evaluationTurn=buyer.find(turn=>activeEvaluation(turn.text)),evaluation=evaluationTurn?activeEvaluation(evaluationTurn.text):undefined;
 if(!backupTurn&&!evaluation)return;
 const person=knownContact?.name||(participant.speakerName?title(participant.speakerName):'The buyer');
 const purchasing=knownContact?.role==='Purchasing'||participant.role==='purchasing';
 const pickup=segment.find(turn=>turn.id===participant.segmentStartTurnId);mark(pickup);
 const lines=[`Spoke with ${person}${purchasing?' in purchasing':''}${participant.afterTransfer?' after a transfer':''}.`];
 let outcome:string;const discoveryUnknowns:string[]=[];
 if(backupTurn){
 mark(backupTurn);
 const backupStatement=activeBackupClause(backupTurn.text)!;
 const itemWithUse=backupStatement.match(/\b(?:second|backup|back-up|alternative|alternate|additional)\s+(?:source|supplier)\s+for\s+(?:the\s+)?(.+?)(?=\s+(?:we (?:use|buy|need)|used (?:in|for))\b|[,.;!?]|$)/i)?.[1]?.trim();
 const item=itemWithUse?.replace(/\s+(?:in|for)\s+(?:our|my)\s+.*$/i,'');
 const motive=buyer.find(turn=>activeBackupClause(turn.text)&&/\b(?:in case|if)\s+(?:our\s+)?(?:deliveries|shipments|supply|orders?)\s+(?:slip|are late|is late|are delayed|is delayed|gets? delayed|is interrupted)\b/i.test(activeBackupClause(turn.text)!));
 const motiveClause=motive?clean(motive.text).match(/\b(?:in case|if)\s+((?:our\s+)?(?:deliveries|shipments|supply|orders?)\s+(?:slip|are late|is late|are delayed|is delayed|gets? delayed|is interrupted))/i)?.[1]:undefined;
 mark(motive);
 outcome=`Discovery — exploring a backup source${item?' for '+item:''}${motiveClause?' in case '+motiveClause:''}.`;
 const receiptClause=(text:string)=>clauses(text).flatMap(part=>part.split(/\s+and\s+(?=(?:not|haven't|have not|hasn't|has not)\b)/i)).find(part=>/\b(?:I|we)(?:'ve| have)?\s+(?:got|received)\s+(?:only\s+)?(?:those|them|the|your|our)\b/i.test(part)&&!uncertain.test(part));
 const receipt=buyer.find(turn=>receiptClause(turn.text));
 if(receipt){
  const before=turns.slice(0,turns.indexOf(receipt));
  const documentContext=before.findLast(turn=>/\b(?:company profile|spec sheets?|specification sheets?|catalog(?:ue)?|brochure|documents?)\b/i.test(turn.text));
  const receiptText=receiptClause(receipt.text)!,explicit=materialKinds(receiptText);
  // Explicit buyer document names outrank a larger earlier sending bundle.
  // Only a pronoun such as “those/them” resolves against preceding speech.
  const referential=!explicit.length&&/\b(?:got|received)\s+(?:those|them|the documents|your documents)\b/i.test(receiptText);
  const documents=explicit.length?explicit:referential?materialKinds(documentContext?.text||''):[];
  if(documents.length){mark(receipt);if(referential)mark(documentContext);lines.push(`${person} confirmed receipt of the ${documents.join(' and ')}.`);}
 }
 const pendingReview=buyer.find(turn=>/\b(?:haven't|have not|hasn't|has not|not yet)\b.{0,60}\breview\w*\b|\byet to review\b/i.test(clean(turn.text)));
 if(pendingReview){mark(pendingReview);lines.push(`${person} had not yet reviewed the documents${/\bclosely\b/i.test(pendingReview.text)?' closely':''}.`);}
 const use=clean(backupTurn.text).match(/\bwe use\s+((?:in|for)\s+.+?)(?=[.;!?]|$)/i)?.[1]||itemWithUse?.match(/\b((?:in|for)\s+(?:our|my)\s+.+)$/i)?.[1];
 if(item&&use)lines.push(`The buyer uses ${item} ${use.replace(/\bour\b/gi,'their').replace(/\bmy\b/gi,'their')}.`);
 const singleStatement=buyer.flatMap(turn=>clauses(turn.text).map(part=>({turn,part,stated:/\b(?:rely\w*|relying|depend\w*|using|use|have)\b.{0,35}\b(?:one|single) supplier\b/i.exec(part)}))).filter(row=>row.stated).at(-1);
 const single=singleStatement&&!singleStatement.part.includes('?')&&!/\b(?:not|never|don't|do not|didn't|did not|haven't|have not|might|may|could|would|if|unless)\b/i.test(singleStatement.part.slice(0,singleStatement.stated!.index+singleStatement.stated![0].length))?singleStatement.turn:undefined;
 if(single){mark(single);lines.push('The buyer currently relies on one supplier.');}
 lines.push(`${/\bengineering(?:'s| is| team)\b/i.test(backupTurn.text)?'Engineering is':'The buyer is'} exploring a backup source${item?' for '+item:''}${motiveClause?' in case '+motiveClause:''}.`);
 }else{
  mark(evaluationTurn);
  const subject=evaluation!.owner==='engineering'?'Engineering':'The buyer';
  outcome=`Discovery — ${evaluation!.owner} is evaluating ${evaluation!.object}.`;
  lines.push(`${subject} is evaluating ${evaluation!.object}.`);
  const offer=drawingEmailOffer(buyer);
  const drawingStatus=latestDrawingStatus(buyer);
  if(drawingStatus?.finished){mark(drawingStatus.turn);lines.push(`${person} said the drawing was finished${drawingStatus.time?' '+drawingStatus.time:''}.`);}
  if(offer){
   mark(offer.turn);mark(offer.preference);mark(offer.alreadySent);mark(offer.withdrawal?.turn);
   const emailTime=clean(offer.turn.text).match(/\b(?:today|tomorrow|this (?:morning|afternoon|evening)|next week|on (?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday))\b/i)?.[0];
   if(offer.withdrawal)lines.push(`${person} later said: “${offer.withdrawal.text}”`);
   else if(offer.otherCondition)lines.push(`${person} made a conditional offer: “${offer.otherCondition}”`);
   else lines.push(`${person} offered to email the drawing${offer.conditional&&!drawingStatus?.finished?' when it is ready':emailTime?' '+emailTime:''}.`);
   if(offer.preference)lines.push(`${person} prefers follow-up by email.`);
   if(offer.alreadySent){lines.push(`${person} later said the drawing had been sent.`);discoveryUnknowns.push('Receipt of the drawing remains unconfirmed.');}
   else {discoveryUnknowns.push('Sending and receipt of the drawing remain unconfirmed.');if(offer.conditional&&!drawingStatus?.finished)discoveryUnknowns.push('Drawing readiness timing remains open.');}
  }
  const reportCommitment=spokenReportCommitment(segment);
  if(reportCommitment){mark(reportCommitment);lines.push(`Salesperson's stated next step: “${clean(reportCommitment.text)}”`);}
 }
 const boundary=deriveBuyerDeferral(segment),deferral=boundary?buyer.find(turn=>turn.id===boundary.sourceTurnId):undefined;
 if(boundary&&deferral){
  const earlier=segment.slice(0,segment.indexOf(deferral)),context=earlier.findLast(turn=>turn.role==='you');
  mark(deferral);mark(context);
  lines.push(`${person} deferred ${boundary.topic==='technical_requirements'?'technical details':boundary.topic==='current_topic'?'the preceding topic':boundary.topicLabel}${boundary.delegatedTo?' to '+boundary.delegatedTo:''}.`);
 }
 const finalAuthority=buyer.find(turn=>/\bI\s+(?:have (?:the )?final (?:say|approval)|make (?:the )?final (?:purchase|purchasing) decision|am (?:the )?(?:final|sole) decision maker)\b/i.test(clean(turn.text))&&!uncertain.test(clean(turn.text)));
 if(finalAuthority){mark(finalAuthority);lines.push(`${person} confirmed final purchase authority.`);}
 const unknowns=[...discoveryUnknowns,...finalAuthority?[]:['Final purchase authority remains unconfirmed.']];
 // A rep-proposed date is not an agreement. Require either a buyer's explicit
 // callback request or direct assent to the immediately preceding date proposal.
 const day=/\b(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|tomorrow|next week|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\b/ig;
 const dates=(text:string)=>[...new Set([...text.matchAll(day)].map(match=>match[0]))];
 const followUp=/\b(?:call(?:ed|ing)?|check(?:ed|ing)? back|follow(?:ed|ing)?[- ]up|speak(?:ing)?|talk(?:ed|ing)?)\b/i;
 let agreedDate:string|undefined;
 for(let index=0;index<segment.length;index++){
  const turn=segment[index];if(turn.role!=='buyer')continue;
  const text=clean(turn.text),prior=segment[index-1],priorText=clean(prior?.text||'');
  const buyerDates=dates(text),proposedDates=dates(priorText);
  if(uncertain.test(text)||/\b(?:cannot|can't|not agreed|don't know)\b/i.test(text)){if(agreedDate&&buyerDates.length)agreedDate=undefined;continue;}
  if(buyerDates.length===1&&followUp.test(text)&&/\b(?:please|can you|could you|let's|call me|works|agreed)\b/i.test(text)){agreedDate=buyerDates[0];mark(turn);}
  else if(prior?.role==='you'&&proposedDates.length&&followUp.test(priorText)){
   const affirmative=/^(?:yes|yeah|sure|okay|ok|that works|sounds good|please do)\b/i.test(text);
   const selectsDate=buyerDates.length===1&&(/\b(?:works|agreed|please|fine|good|yes|sure|okay|ok|let's)\b/i.test(text)||text.replace(/[.! ]+$/,'').toLowerCase()===buyerDates[0].toLowerCase());
   // “Yes” to two alternatives grants permission, not a chosen date.
   const selected=selectsDate?buyerDates[0]:affirmative&&!buyerDates.length&&proposedDates.length===1?proposedDates[0]:undefined;
   if(selected){agreedDate=selected;mark(prior);mark(turn);}
  }
 }
 if(agreedDate)lines.push(`A follow-up was agreed for ${agreedDate}.`);else unknowns.push('No follow-up date was agreed.');
 lines.push(...unknowns);
 return {outcome,recap:lines.join(' '),sourceTurnIds:turns.filter(turn=>sourceIds.has(turn.id)).map(turn=>turn.id),unknowns};
}
