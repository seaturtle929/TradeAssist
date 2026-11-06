import {deriveSpokenDocumentEvidence} from './document-call-evidence.ts';
import {reportDeliveryCondition} from './document-delivery-condition.ts';
import {analyzeDocumentActionMeaning,literalDocumentScopeEvidence,type DocumentProductSource} from './document-product-evidence.ts';
import {analyzeDocumentActionSyntax,directDocumentActionObject,type DocumentActionSyntax} from './document-action-syntax.ts';
import {affirmativeMaterialAction,materialRefusal} from './material-request-meaning.ts';
import {fieldEvidence} from './buyer-facts.ts';

export type DocumentActor='you'|'buyer';
export type DocumentKind='company profile'|'spec sheets'|'test reports'|'drawings'|'catalog'|'brochure'|'website link';
export type DocumentEvent={kind:'requested'|'offered'|'promised'|'sent'|'received'|'check_promised'|'coverage_question'|'restricted'|'cancelled';actor:DocumentActor;turnId:string;quote:string;source:'transcript'|'reviewed_recap'|'rep_update'};
export type DocumentTransfer={id:string;document:DocumentKind;label?:string;sender:DocumentActor;recipient:DocumentActor;phase:'inquiry'|'checking'|'requested'|'offered'|'promised'|'sent'|'received'|'cancelled';sendStatus:'pending'|'reported_sent'|'unconfirmed';receiptStatus:'unconfirmed'|'confirmed';coverage:'unknown'|'verified';coverageEvidence:{sourceId:string;quote:string}[];condition?:{kind:'coverage_positive'|'unresolved';text:string;turnId:string};events:DocumentEvent[]};
export type DocumentState={version:1;transfers:DocumentTransfer[];processedTurnIds:string[]};
type DocumentTurn={id?:string;role:string;text:string;transcriptionUncertainty?:unknown;source?:DocumentEvent['source']};
const normalize=(s:string)=>s.replace(/[‘’]/g,"'");
export function documentKindsForState(text:string):DocumentKind[]{return ([
 ['company profile',/\b(?:company\s+)?profiles?\b/i],['spec sheets',/\b(?:spec(?:ification)?\s+sheets?|specifications?|specs?|data sheets?)\b/i],['test reports',/\b(?:(?:material|inspection|quality)\s+)?test reports?\b|\b(?:inspection|quality) reports?\b|\breports?\b/i],['drawings',/\b(?:drawings?|blueprints?|diagrams?)\b/i],['catalog',/\bcatalog(?:ue)?s?\b/i],['brochure',/\bbrochures?\b/i],['website link',/\b(?:website|web site)(?: link)?\b/i],
] as [DocumentKind,RegExp][]).filter(([,pattern])=>pattern.test(text)).map(([kind])=>kind);}
const senderPrefix=/\b(?:I|we)(?:'ll|\s+(?:will|can|could|would|plan to|intend to))\s+(?:send|email|forward|share|attach|include)\b/i;
const ownSendQuestion=/^\s*(?:(?:please|also|just)\s+)*(?:(?:can|could|may|should|would|shall)\s+(?:I|we)\s+(?:(?:please|also|just)\s+)*(?:send|email|forward|share|attach|include)|would you\s+(?:like|want|prefer)\s+(?:me|us)\s+to\s+(?:send|email|forward|share|attach|include))\b/i;
/** A buyer's own first-person send is not a request for the rep to send. */
export function isBuyerOwnedDocumentSend(text:string):boolean {const s=normalize(text);return ownSendQuestion.test(s)||senderPrefix.test(s)&&!/^\s*(?:once|when|if|after|before|until)\b/i.test(s);}
const request=/\b(?:please\s+(?:send|email|share|forward|attach|include)|(?:can|could|would|will) you\s+(?:please\s+)?(?:send|email|share|forward|attach|include)|(?:send|email|share|forward)\s+(?:me|us)|you\s+(?:can|could|should)\s+(?:send|email|share|forward))\b|^(?:(?:okay|ok|sure|yes)[,. ]+)?(?:send|email|share|forward|attach|include)\b/i;
const negated=/\b(?:I|we)\s+(?:haven't|have not|didn't|did not|won't|will not|cannot|can't)\s+(?:send|sent|email|emailed|receive|received|get|got)\b/i;
const pastSend=/^\s*(?:(?:yes|okay|ok|sure)[,.!]\s*)?(?:I|we)(?:'ve| have)?\s+(?:already\s+)?(?:sent|emailed|forwarded|shared)\b/i;
const receipt=/^\s*(?:(?:yes|okay|ok|great)[,.!]\s*)?(?:I|we)(?:'ve| have)?\s+(?:already\s+)?(?:received\s+|got\s+(?=(?:your|the|that|this|those|these|both|them)\b))/i;
const other=(actor:DocumentActor):DocumentActor=>actor==='you'?'buyer':'you';
const documentActionClauses=(text:string)=>normalize(text).split(/(?<=[.!?;])\s+|\s+(?=(?:Once|When|After|Before)\b)/)
 .flatMap(part=>part.split(/\s+(?:and|but)\s+(?=(?:(?:can|could|would|will|may|should)\s+(?:you|I|we)\s+(?:(?:please|also|just)\s+)*(?:send|email|forward|share|attach|include)|please\s+(?:send|email|forward|share|attach|include))\b)/i)).filter(Boolean);
type DocumentCompletion={actor:DocumentActor;kind:'sent'|'received';object:DocumentActionSyntax['object'];quote:string};
function completedDocumentAction(part:string,actor:DocumentActor):DocumentCompletion|undefined{
 if(part.includes('?')||negated.test(part))return;
 const sent=pastSend.exec(part),received=!sent&&receipt.exec(part),match=sent||received;if(!match)return;
 return {actor,kind:sent?'sent':'received',object:directDocumentActionObject(part,match[0].length,part.length,sent?'send':'receive'),quote:part};
}
/** Completed main actions use the same anchored assertion and direct object
 * as the canonical ledger. This also represents an existing generic material
 * such as “product information” without inventing a new stored document kind. */
export function attributedDocumentCompletions(turn:DocumentTurn):DocumentCompletion[]{
 if(turn.transcriptionUncertainty||!['buyer','customer','you'].includes(turn.role))return [];
 const actor=turn.role==='you'?'you':'buyer';return documentActionClauses(turn.text).map(part=>completedDocumentAction(part,actor)).filter((action):action is DocumentCompletion=>!!action);
}
/** Only the direct object belongs to a delivery. A document mentioned in a
 * recipient, purpose or an indirect inquiry is not another promised item. */
function ownActionDocuments(action:DocumentActionSyntax,part:string):DocumentKind[]{
 if(action.object.kind==='document')return documentKindsForState(action.object.text);
 if(action.object.kind!=='pronoun')return [];
 const preceding=[...part.slice(0,action.start).matchAll(/\b(?:(?:material test|inspection|quality|test) reports?|drawings?|specification sheets?|spec sheets?|profiles?|catalog(?:ue)?s?|brochures?)\b/gi)].filter(match=>!action.conditions.some(condition=>condition.start<=(match.index||0)&&condition.end>=(match.index||0)+match[0].length));
 return preceding.length===1?documentKindsForState(preceding[0][0]):[];
}
/** The buyer can accept the immediately preceding actual offer, not a
 * historical example or a proposal separated by substantive conversation. */
export function acceptedDocumentOfferAt(turns:DocumentTurn[],index:number):{turn:DocumentTurn;index:number;objects:DocumentActionSyntax['object'][]}|undefined{
 const current=turns[index];if(!current||!['buyer','customer'].includes(current.role)||current.transcriptionUncertainty||materialRefusal(normalize(current.text).toLowerCase()))return;
 const accepts=/^(?:(?:okay|ok)[, ]*)?(?:yes|yeah|yep|sure|please do|go ahead|that (?:works|would be (?:useful|helpful|good|great)))(?:[, ]*(?:please|thanks|thank you|go ahead|send it(?: over)?|do that))?[.!\s]*$/i.test(current.text.trim());
 const suppliedAddress=!!fieldEvidence('Email',[current]);if(!accepts&&!suppliedAddress)return;
 const previous=turns.findLastIndex((turn,position)=>position<index&&turn.role==='you');if(previous<0)return;
 const offer=turns[previous];if(offer.transcriptionUncertainty||!turns.slice(previous+1,index).every(turn=>turn.role==='buyer'&&/^(?:uh+|um+|hmm+|one moment|one second|hold on)[.!\s]*$/i.test(turn.text.trim())))return;
 const questionOffer=ownSendQuestion.exec(normalize(offer.text));
 const own=analyzeDocumentActionSyntax(offer.text,{speaker:'salesperson'}).filter(action=>action.actor==='salesperson'&&action.documentDelivery&&(['offer','commitment'].includes(action.speechAct)||questionOffer&&action.speechAct==='permission_question'));
 const objects=own.map(action=>action.object);
 if(questionOffer&&!objects.length)objects.push(directDocumentActionObject(offer.text,questionOffer[0].length,offer.text.length,questionOffer[0].match(/\w+$/)![0]));
 if(!objects.length)return;
 const address=suppliedAddress&&offer.text.includes('?')&&/\b(?:email|address)\b/i.test(offer.text);
 return accepts||address?{turn:offer,index:previous,objects}:undefined;
}
/** Actual attributed actions only. Promises never become sending or receipt;
 * a buyer reference/condition never becomes original company coverage evidence. */
export function deriveDocumentState(input:{turns?:DocumentTurn[];seed?:DocumentState;sources?:DocumentProductSource[]}):DocumentState{
 const turns=(input.turns||[]).filter(t=>!t.transcriptionUncertainty&&['buyer','customer','you'].includes(t.role));
 const ids=new Set(turns.flatMap(t=>t.id?[t.id]:[]));
 const rebuild=!!input.seed?.processedTurnIds.length&&input.seed.processedTurnIds.every(id=>ids.has(id));
 const result:DocumentState=rebuild||!input.seed?{version:1,transfers:[],processedTurnIds:[]}:structuredClone(input.seed);
 const position=new Map(turns.map((turn,index)=>[turn.id||`document-turn-${index}`,index]));
 const actionEvent=(event:DocumentEvent)=>['requested','offered','promised','sent','received','cancelled'].includes(event.kind);
 const laterAction=(record:DocumentTransfer,turnId:string)=>record.events.some(event=>actionEvent(event)&&(position.get(event.turnId)??-1)>(position.get(turnId)??-1));
 const get=(document:DocumentKind,sender:DocumentActor,label?:string)=>{let record=result.transfers.find(t=>t.document===document&&t.sender===sender&&(!label||!t.label||t.label===label));if(!record){record={id:`${sender}:${label||document}`,document,...label?{label}:{},sender,recipient:other(sender),phase:'inquiry',sendStatus:'unconfirmed',receiptStatus:'unconfirmed',coverage:'unknown',coverageEvidence:[],events:[]};result.transfers.push(record);}if(label&&!record.label)record.label=label;return record;};
 for(const [index,turn] of turns.entries()){
  if(!rebuild&&turn.id&&result.processedTurnIds.includes(turn.id))continue;
  const actor:DocumentActor=turn.role==='you'?'you':'buyer',text=normalize(turn.text),turnId=turn.id||`document-turn-${index}`;
  const condition=actor==='buyer'?reportDeliveryCondition(text):undefined;
  const event=(record:DocumentTransfer,kind:DocumentEvent['kind'],quote:string)=>{record.events.push({kind,actor,turnId,quote,source:turn.source||'transcript'});record.events=record.events.slice(-64);};
  const accepted=acceptedDocumentOfferAt(turns,index);
  if(accepted)for(const record of result.transfers.filter(row=>row.sender==='you'&&row.phase==='offered'&&row.events.some(prior=>prior.kind==='offered'&&prior.turnId===(accepted.turn.id||`document-turn-${accepted.index}`)))){
   record.phase='requested';record.sendStatus='pending';event(record,'requested',text);
  }
  let parts=documentActionClauses(text);
  if(!parts.length)parts=[text];
  for(const part of parts){
   const labelFor=(kind:DocumentKind)=>kind==='test reports'?part.match(/\b((?:material test|inspection|quality|test) report)\b/i)?.[1].toLowerCase():undefined;
   let kinds=documentKindsForState(part);
   if(!kinds.length&&/\b(?:it|them|both|those|that)\b/i.test(part)&&/\b(?:send|email|reply|receive|received|got|sent|emailed|shared|forwarded)\b/i.test(part)){
    const relevant=result.transfers.filter(t=>t.sender===(receipt.test(part)?other(actor):actor==='buyer'&&request.test(part)?'you':actor));
    // An actual plural completion can complete its explicit prior bundle;
    // one ambiguous singular pronoun must not complete several documents.
    if(relevant.length===1)kinds=[relevant[0].document];
    else if((pastSend.test(part)||receipt.test(part))&&/\b(?:them|both|those|these)\b/i.test(part))kinds=[...new Set(relevant.filter(row=>row.phase!=='cancelled').map(row=>row.document))];
   }
   const ownOffer=ownSendQuestion.exec(part);
   const plain=part.trim().replace(/^(?:(?:please|sorry|actually|instead)[,:]?\s+)*/i,'');
   const refusedSend=/^(?:(?:do not|don't|never|no need to)\s+(?:send|email|forward|share|attach|include)|stop\s+(?:sending|emailing|forwarding|sharing|attaching|including)|you\s+(?:(?:don't|do not)\s+(?:need|have) to|should not|shouldn't|must not|mustn't)\s+(?:send|email|forward|share|attach|include)|(?:I|we)\s+(?:do not|don't|no longer)\s+(?:want|need)\s+(?:you\s+)?to\s+(?:send|email|forward|share|attach|include)|(?:I am|I'm|we are|we're)\s+not asking you to\s+(?:send|email|forward|share|attach|include))\b/i.test(plain);
   const ownWithdrawal=/^(?:I|we)\s+(?:won't|will not|can't|cannot)\s+(?:send|email|forward|share|attach|include)\b/i.test(plain);
   if(refusedSend||ownWithdrawal){
    const sender=ownWithdrawal?actor:other(actor),held=/\b(?:unless|until|if|when|after|once|yet)\b/i.test(plain)||part.includes('?');
    const named=kinds.length?kinds:result.transfers.filter(row=>row.sender===sender&&/\b(?:it|that|them|those|the documents)\b/i.test(part)).map(row=>row.document);
    for(const kind of named){const record=get(kind,sender,labelFor(kind));
     if(held){record.condition={kind:'unresolved',text:part,turnId};event(record,'restricted',part);}
     else{record.phase='cancelled';record.sendStatus='unconfirmed';record.condition=undefined;event(record,'cancelled',part);}
    }
    continue;
   }
   // A speaker asking permission to send their document is an offer by that
   // speaker, not a request for the other side to send it. Limit the object to
   // this action rather than borrowing documents from a following purpose.
   if(ownOffer){
    const object=part.slice(ownOffer[0].length).split(/\s+(?:so(?: that)?|because|if|when|once|provided|and (?:(?:can|could|would|will|may|should) you|you (?:can|will|could|should)|please))\b|,\s*(?:which|so|and\b)/i,1)[0];
    for(const kind of documentKindsForState(object)){const record=get(kind,actor,labelFor(kind));record.phase='offered';record.sendStatus='pending';event(record,'offered',part);}
    continue;
   }
   const question=part.includes('?')&&/^\s*(?:have|has|did|do|does|is|are|when|where|what|which|how|whether|can|could|would|will)\b/i.test(part)&&!/^\s*(?:can|could|would|will) you\b/i.test(part);
   if(negated.test(part)||question){
    if(actor==='buyer'&&/\b(?:reports?|coverage)\b/i.test(part)&&/\b(?:cover|match|scope|apply|applies)\b/i.test(part)){const r=get('test reports','you',labelFor('test reports'));event(r,'coverage_question',part);}
    // An explicit denial of receipt corrects earlier receipt, but not sending.
    if(/\b(?:I|we)\s+(?:haven't|have not|didn't|did not)\s+(?:received?|got)\b/i.test(part)&&!part.includes('?'))for(const kind of kinds){const r=get(kind,other(actor),labelFor(kind));r.receiptStatus='unconfirmed';r.phase=r.sendStatus==='reported_sent'?'sent':r.events.some(e=>e.kind==='promised')?'promised':'inquiry';event(r,'restricted',part);}
    continue;
   }
   const ownSend=isBuyerOwnedDocumentSend(part),meaning=analyzeDocumentActionMeaning(part,{turns:turns.slice(0,index+1),sources:input.sources}),completion=completedDocumentAction(part,actor),sent=completion?.kind==='sent',received=completion?.kind==='received';
   const completedObject=completion?.object;
   const completedKinds=new Set(completedObject?.kind==='document'?documentKindsForState(completedObject.text):[]);
   if(completedObject?.kind==='pronoun')for(const kind of kinds)completedKinds.add(kind);
   // Bind each outgoing predicate to its object, not every document mentioned
   // in a review/check prerequisite in the same sentence.
   const speaker=actor==='you'?'salesperson':'buyer';
   const ownActions=analyzeDocumentActionSyntax(part,{speaker}).filter(action=>action.actor===speaker&&action.documentDelivery&&['commitment','offer'].includes(action.speechAct));
   const outgoingActions=new Map<DocumentKind,DocumentActionSyntax>();
   for(const action of ownActions){
    let targets:DocumentKind[];
    if(action.object.kind==='pronoun'){
     const relevant=result.transfers.filter(row=>row.sender===actor&&row.phase!=='cancelled'&&row.events.some(event=>['requested','offered','promised','sent','received'].includes(event.kind)));
     if(relevant.length===1)targets=[relevant[0].document];
     else if(/^(?:them|both|those|these)$/i.test(action.object.text))targets=[...new Set(relevant.map(row=>row.document))];
     else targets=relevant.length?[]:ownActionDocuments(action,part);
    }else targets=ownActionDocuments(action,part);
    for(const target of targets)outgoingActions.set(target,action);
   }
   const outgoingKinds=new Set(outgoingActions.keys());
   const requestedMain=actor==='buyer'?affirmativeMaterialAction(part,isBuyerOwnedDocumentSend,value=>documentKindsForState(value).length>0):undefined;
   const requestedKinds=new Set<DocumentKind>();
   if(requestedMain){
    const verbs=[...requestedMain.matchAll(/\b(?:send|email|share|forward|attach|include)\b/gi)];
    for(const [verbIndex,verb] of verbs.entries()){
     const before=requestedMain.slice(0,verb.index);
     if(verbIndex&&!/\b(?:and|then|please)\s+(?:(?:can|could|would|will|may|should)\s+you\s+|you\s+(?:(?:can|could|should|may|will)\s+)?)?$/i.test(before))continue;
     const object=directDocumentActionObject(requestedMain,(verb.index||0)+verb[0].length,requestedMain.length,verb[0]);
     if(object.kind==='document')for(const kind of documentKindsForState(object.text))requestedKinds.add(kind);
    }
   }
   kinds=[...new Set([...kinds,...outgoingKinds])];
   for(const kind of kinds){
    if(received&&completedKinds.has(kind)){const r=get(kind,other(actor),labelFor(kind));r.receiptStatus='confirmed';r.sendStatus='reported_sent';r.phase='received';event(r,'received',part);continue;}
    if(sent&&completedKinds.has(kind)){const r=get(kind,actor,labelFor(kind));r.sendStatus='reported_sent';r.phase='sent';event(r,'sent',part);continue;}
    const action=outgoingActions.get(kind);
    if(action){
     const r=get(kind,actor,labelFor(kind)),tentative=action.speechAct==='offer';r.phase=tentative?'offered':'promised';r.sendStatus='pending';event(r,tentative?'offered':'promised',part);
     if(actor==='you'){
      if(meaning.delivery?.deliveryCondition==='stated_condition')r.condition={kind:'coverage_positive',text:meaning.delivery.conditionText||part,turnId};
      else if(action.conditions.length){
       // Retain an actual action prerequisite even when the more specific
       // report/reference matcher cannot resolve it. This grants no coverage
       // or permission: unresolved conditions continue to block sending.
       const scoped=kind==='test reports'&&reportDeliveryCondition(part.slice(action.start,action.scope.end))==='scope_required';
       r.condition={kind:scoped?'coverage_positive':'unresolved',text:action.conditions.map(condition=>condition.text).join(' and '),turnId};
      }
     }
     continue;
    }
    if(actor==='buyer'&&!ownSend&&(requestedKinds.has(kind)||condition&&kind==='test reports')){const r=get(kind,'you',labelFor(kind));r.phase=r.phase!=='cancelled'&&r.events.some(e=>e.kind==='promised')?'promised':'requested';r.sendStatus='pending';event(r,'requested',part);}
    if(actor==='you'&&kind==='test reports'&&/\b(?:I|we)(?:'ll| will| can)\s+(?:check|verify|confirm)\s+(?:whether|if)\b/i.test(part)){const r=get(kind,'you',labelFor(kind));if(!r.events.some(event=>['requested','promised','offered','sent','received'].includes(event.kind)))r.phase='checking';event(r,'check_promised',part);}
   }
  }
  if(condition){const reports=result.transfers.filter(t=>t.sender==='you'&&t.document==='test reports');if(!reports.length&&/\breport\b/i.test(text))reports.push(get('test reports','you'));for(const r of reports){r.condition={kind:condition==='scope_required'?'coverage_positive':'unresolved',text,turnId};event(r,'restricted',text);}}
  result.processedTurnIds.push(turnId);
 }
 // Reuse the existing spoken bundle resolver for contextual "both/that"
 // agreements and explicit cancellations rather than reinterpreting them.
 const spoken=deriveSpokenDocumentEvidence(turns.map((turn,index)=>({id:turn.id||`document-turn-${index}`,role:turn.role==='customer'?'buyer':turn.role as 'you'|'buyer',text:turn.text,at:index})));
 for(const agreement of spoken.agreements)for(const kind of agreement.documents){const document=kind as DocumentKind;if(!documentKindsForState(document).includes(document))continue;const record=get(document,'you');if(laterAction(record,agreement.turnId)||record.events.some(event=>event.turnId===agreement.turnId&&actionEvent(event)))continue;if(record.sendStatus!=='reported_sent')record.phase='promised';record.sendStatus=record.sendStatus==='reported_sent'?'reported_sent':'pending';record.events.push({kind:'promised',actor:'you',turnId:agreement.turnId,quote:agreement.quote,source:turns.find(turn=>turn.id===agreement.turnId)?.source||'transcript'});}
 for(const cancelled of spoken.cancellations)for(const record of result.transfers.filter(row=>row.sender==='you'&&cancelled.documents.includes(row.document))){if(laterAction(record,cancelled.turnId)||record.events.some(event=>event.turnId===cancelled.turnId&&event.kind==='cancelled'))continue;record.phase='cancelled';record.sendStatus='unconfirmed';record.condition=undefined;record.events.push({kind:'cancelled',actor:'buyer',turnId:cancelled.turnId,quote:cancelled.quote,source:turns.find(turn=>turn.id===cancelled.turnId)?.source||'transcript'});}
 // Original approved evidence can prove scope; requests and assurances cannot.
 for(const r of result.transfers.filter(r=>r.document==='test reports')){
  r.coverage='unknown';r.coverageEvidence=[];
  const affirmativeSources=(input.sources||[]).flatMap(source=>source.text.split(/\n+|(?<=[.!?;])\s+/).filter(sentence=>!analyzeDocumentActionMeaning(sentence,{turns}).locallyNonAssertive&&!/\b(?:unknown|unconfirmed|unverified|whether|may|might|could)\b|^\s*(?:if|once|when|unless)\b/i.test(sentence)).map(text=>({...source,text})));
  const context={turns,sources:affirmativeSources};
  const references=[...new Set(r.events.flatMap(e=>analyzeDocumentActionMeaning(e.quote,context).references.filter(ref=>ref.basis!=='unknown').map(ref=>ref.text)))];
  if(references.length){const proofs=references.map(ref=>literalDocumentScopeEvidence(`The ${r.label||'test report'} covers ${ref}.`,context,affirmativeSources));if(proofs.every(Boolean)){r.coverage='verified';r.coverageEvidence=proofs.map(p=>({sourceId:p!.sourceId,quote:p!.quote}));}}
 }
 result.processedTurnIds=[...new Set(result.processedTurnIds)].slice(-600);return result;
}
/** Reviewed recap markers remain editable source text. They do not re-import
 * omitted raw speech or override a salesperson's correction. */
export function documentStateReviewLines(state:DocumentState):string[]{return state.transfers.filter(r=>r.events.length).map(r=>{
 const label=r.label||r.document;
 const conditionEvent=r.condition?([...r.events].reverse().find(event=>event.kind==='restricted'&&event.actor==='buyer')||[...r.events].reverse().find(event=>event.turnId===r.condition!.turnId)):undefined;
 const conditionMarker=conditionEvent?`\nThe ${conditionEvent.actor==='buyer'?'buyer':'salesperson'} stated next step: “${conditionEvent.quote.replace(/\s*\n\s*/g,' ')}”`:'';
 if(r.phase==='cancelled')return `${r.events.findLast(event=>event.kind==='cancelled')?.actor==='you'?'The salesperson withdrew the proposed handoff of':'The buyer cancelled the request for'} the ${label}; no sending obligation remains.`;
 if(r.sender==='buyer')return r.receiptStatus==='confirmed'?`The salesperson confirmed receipt of the buyer’s ${label}.`:r.sendStatus==='reported_sent'?`The buyer reported sending the ${label}; the salesperson has not confirmed receipt.`:`The buyer ${r.phase==='offered'?'offered':'promised'} to send the ${label}; sending and salesperson receipt remain unconfirmed.`;
 const check=r.events.some(e=>e.kind==='check_promised')?'The salesperson will check the report coverage. ':'';
 const hasSend=r.events.some(event=>event.kind==='requested'||event.kind==='promised'||event.kind==='offered');
 if(!hasSend)return check||`The buyer asked about the ${label} coverage; it remains unknown until supported by approved evidence.`;
 const action=r.events.some(e=>e.kind==='promised')?'The salesperson promised to send':r.events.some(e=>e.kind==='requested')?'The buyer requested':'The salesperson offered to send';
 const send=r.sendStatus==='reported_sent'?`The salesperson reported sending the ${label}; buyer receipt remains ${r.receiptStatus}.`:`${action} the ${label}${r.condition?`; ${r.condition.kind==='coverage_positive'?'sending is conditional on confirmed positive report coverage':'the buyer’s stated release condition must be satisfied'}`:''}. Sending remains pending.`;
 return check+send+(r.document==='test reports'?' Report coverage remains unknown until supported by approved evidence.':'')+conditionMarker;
});}
/** Reviewed edits are authoritative. Do not re-import raw speech omitted or
 * corrected by the salesperson. Attribute only explicit reviewed statements;
 * ambiguous prose stays in the recap rather than becoming a completed event. */
export function documentStateFromReviewedRecap(recap:string,options:{buyerNames?:string[]}={}):DocumentState{
 const turns:DocumentTurn[]=[];
 const attributedQuote=(raw:string)=>{
  const line=normalize(raw).trim(),at=line.search(/[“"]/);if(at<0)return;
  const attributed=/^(?:The )?(?:buyer|customer|contact|salesperson|representative|rep)\b/i.test(line)||(options.buyerNames||[]).some(name=>new RegExp('^'+name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\b','i').test(line));
  if(!attributed)return;
  const opening=line[at],closing=opening==='“'?'”':'"';let depth=1;
  for(let index=at+1;index<line.length;index++){
   if(opening==='“'&&line[index]===opening)depth++;
   else if(line[index]===closing&&line[index-1]!=='\\'&&!--depth)return {text:line.slice(at+1,index),end:index};
  }
 };
 const reviewedLines=recap.replace(/\\n/g,'\n').split(/\n+/).flatMap(raw=>{
  const line=raw.trim(),quote=attributedQuote(line);
  return quote?[line.slice(0,quote.end+1),...line.slice(quote.end+1).trim().split(/(?<=[.!?])\s+/).filter(Boolean)]:line.split(/(?<=[.!?])\s+/);
 });
 for(const [index,raw] of reviewedLines.entries()){
  const line=normalize(raw).trim();
  const quote=attributedQuote(line)?.text??line.match(/[“"]([^”"]+)[”"]/u)?.[1];
  const named=(options.buyerNames||[]).filter(Boolean).find(name=>new RegExp('^'+name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\b','i').test(line));
  const buyer=!!named||/^(?:The )?(?:buyer|customer|contact)\b/i.test(line),rep=/^(?:The )?(?:salesperson|representative|rep)\b/i.test(line);
  if(!buyer&&!rep)continue;
  let text=quote||(named?line.slice(named.length).trim():line).replace(/^(?:The )?(?:buyer|customer|contact|salesperson|representative|rep)(?:'s)?(?: document follow-up| stated next step)?[: ]*/i,'');
  text=text.replace(/^(?:will|can|could)\s+/i,match=>'I '+match).replace(/^(?:has |have |already )?(?:sent|emailed)\s+/i,'I sent ');
  text=text.replace(/^(?:promised|agreed|offered|plans?) to /i,match=>/offered/i.test(match)?'I can ':'I will ').replace(/^reported sending /i,'I sent ').replace(/^reported (?:sent|emailed) /i,'I sent ');
  if(/requested\b/i.test(text))text=text.replace(/^requested(?: the)? /i,'Please send the ');
  if(/sending is conditional on confirmed positive report coverage/i.test(text))text=text.replace(/; sending is conditional on confirmed positive report coverage/i,' only if the report covers the buyer reference');
  if(/confirmed receipt of the buyer's/i.test(text))text=text.replace(/^confirmed receipt of the buyer's /i,'I received your ');
  turns.push({id:`reviewed-document-${index}`,role:buyer?'buyer':'you',text,source:'reviewed_recap'});
 }
 return deriveDocumentState({turns});
}
