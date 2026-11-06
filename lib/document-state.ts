import {deriveSpokenDocumentEvidence} from './document-call-evidence.ts';
import {reportDeliveryCondition} from './document-delivery-condition.ts';
import {analyzeDocumentActionMeaning,literalDocumentScopeEvidence,type DocumentProductSource} from './document-product-evidence.ts';

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
/** A buyer's own first-person send is not a request for the rep to send. */
export function isBuyerOwnedDocumentSend(text:string):boolean {const s=normalize(text);return senderPrefix.test(s)&&!/^\s*(?:once|when|if|after|before|until)\b/i.test(s);}
const request=/\b(?:please\s+(?:send|email|share|forward|attach|include)|(?:can|could|would|will) you\s+(?:please\s+)?(?:send|email|share|forward|attach|include)|(?:send|email|share|forward)\s+(?:me|us)|you\s+(?:can|could|should)\s+(?:send|email|share|forward))\b|^(?:(?:okay|ok|sure|yes)[,. ]+)?(?:send|email|share|forward|attach|include)\b/i;
const negated=/\b(?:I|we)\s+(?:haven't|have not|didn't|did not|won't|will not|cannot|can't)\s+(?:send|sent|email|emailed|receive|received|get|got)\b/i;
const pastSend=/^\s*(?:(?:yes|okay|ok|sure)[,.!]\s*)?(?:I|we)(?:'ve| have)?\s+(?:already\s+)?(?:sent|emailed|forwarded|shared)\b/i;
const receipt=/^\s*(?:(?:yes|okay|ok|great)[,.!]\s*)?(?:I|we)(?:'ve| have)?\s+(?:already\s+)?(?:received|got)\s+(?:your|the|that|this|those|these)\b/i;
const other=(actor:DocumentActor):DocumentActor=>actor==='you'?'buyer':'you';
/** Actual attributed actions only. Promises never become sending or receipt;
 * a buyer reference/condition never becomes original company coverage evidence. */
export function deriveDocumentState(input:{turns?:DocumentTurn[];seed?:DocumentState;sources?:DocumentProductSource[]}):DocumentState{
 const turns=(input.turns||[]).filter(t=>!t.transcriptionUncertainty&&['buyer','customer','you'].includes(t.role));
 const ids=new Set(turns.flatMap(t=>t.id?[t.id]:[]));
 const rebuild=!!input.seed?.processedTurnIds.length&&input.seed.processedTurnIds.every(id=>ids.has(id));
 const result:DocumentState=rebuild||!input.seed?{version:1,transfers:[],processedTurnIds:[]}:structuredClone(input.seed);
 const get=(document:DocumentKind,sender:DocumentActor,label?:string)=>{let record=result.transfers.find(t=>t.document===document&&t.sender===sender&&(!label||!t.label||t.label===label));if(!record){record={id:`${sender}:${label||document}`,document,...label?{label}:{},sender,recipient:other(sender),phase:'inquiry',sendStatus:'unconfirmed',receiptStatus:'unconfirmed',coverage:'unknown',coverageEvidence:[],events:[]};result.transfers.push(record);}if(label&&!record.label)record.label=label;return record;};
 for(const [index,turn] of turns.entries()){
  if(!rebuild&&turn.id&&result.processedTurnIds.includes(turn.id))continue;
  const actor:DocumentActor=turn.role==='you'?'you':'buyer',text=normalize(turn.text),turnId=turn.id||`document-turn-${index}`;
  const condition=actor==='buyer'?reportDeliveryCondition(text):undefined;
  const event=(record:DocumentTransfer,kind:DocumentEvent['kind'],quote:string)=>{record.events.push({kind,actor,turnId,quote,source:turn.source||'transcript'});record.events=record.events.slice(-64);};
  let parts=text.split(/(?<=[.!?;])\s+|\s+(?=(?:Once|When|After|Before)\b)/).filter(Boolean);
  if(!parts.length)parts=[text];
  for(const part of parts){
   const labelFor=(kind:DocumentKind)=>kind==='test reports'?part.match(/\b((?:material test|inspection|quality|test) report)\b/i)?.[1].toLowerCase():undefined;
   let kinds=documentKindsForState(part);
   if(!kinds.length&&/\b(?:it|them|both|those|that)\b/i.test(part)&&/\b(?:send|email|reply|receive|received|got|sent|emailed)\b/i.test(part)){
    const relevant=result.transfers.filter(t=>t.sender===(receipt.test(part)?other(actor):actor==='buyer'&&request.test(part)?'you':actor));
    if(relevant.length===1)kinds=[relevant[0].document];
   }
   const question=part.includes('?')&&/^\s*(?:have|has|did|do|does|is|are|when|where|what|which|how|whether|can|could|would|will)\b/i.test(part)&&!/^\s*(?:can|could|would|will) you\b/i.test(part);
   if(negated.test(part)||question){
    if(actor==='buyer'&&/\b(?:reports?|coverage)\b/i.test(part)&&/\b(?:cover|match|scope|apply|applies)\b/i.test(part)){const r=get('test reports','you',labelFor('test reports'));event(r,'coverage_question',part);}
    // An explicit denial of receipt corrects earlier receipt, but not sending.
    if(/\b(?:I|we)\s+(?:haven't|have not|didn't|did not)\s+(?:received?|got)\b/i.test(part)&&!part.includes('?'))for(const kind of kinds){const r=get(kind,other(actor),labelFor(kind));r.receiptStatus='unconfirmed';r.phase=r.sendStatus==='reported_sent'?'sent':r.events.some(e=>e.kind==='promised')?'promised':'inquiry';event(r,'restricted',part);}
    continue;
   }
   const ownSend=isBuyerOwnedDocumentSend(part),meaning=analyzeDocumentActionMeaning(part,{turns:turns.slice(0,index+1),sources:input.sources}),promise=senderPrefix.exec(part),sent=!part.includes('?')&&pastSend.test(part),received=!part.includes('?')&&receipt.test(part);
   // Bind each outgoing predicate to its object, not every document mentioned
   // in a review/check prerequisite in the same sentence.
   const outgoingKinds=new Set(meaning.outgoing.flatMap((action,actionIndex)=>documentKindsForState(part.slice(action.end,meaning.outgoing[actionIndex+1]?.start).split(/\b(?:if|when|once|provided|before|after|and (?:check|review|verify|confirm))\b/i,1)[0])));
   for(const action of meaning.outgoing){const object=part.slice(action.end).split(/[.!?;]/,1)[0];if(/^\s+(?:with\s+)?(?:it|that|this|them)\b/i.test(object)){const nearest=[...part.slice(0,action.start).matchAll(/\b(?:(?:material test|inspection|quality|test) reports?|drawings?|specification sheets?|spec sheets?|profiles?)\b/gi)].at(-1);if(nearest)for(const kind of documentKindsForState(nearest[0]))outgoingKinds.add(kind);}}
   if(meaning.delivery)for(const kind of documentKindsForState(meaning.delivery.document))outgoingKinds.add(kind);
   if(!kinds.length&&outgoingKinds.size)kinds=[...outgoingKinds];
   for(const kind of kinds){
    if(received){const r=get(kind,other(actor),labelFor(kind));r.receiptStatus='confirmed';r.sendStatus='reported_sent';r.phase='received';event(r,'received',part);continue;}
    if(sent){const r=get(kind,actor,labelFor(kind));r.sendStatus='reported_sent';r.phase='sent';event(r,'sent',part);continue;}
    if((promise||meaning.outgoing.length&&/\b(?:I|we)(?:'ll|\s+(?:will|can|would))\b/i.test(part))&&outgoingKinds.has(kind)){
     const r=get(kind,actor,labelFor(kind)),tentative=/\b(?:can|could|would)\b/i.test(promise?.[0]||part);r.phase=tentative?'offered':'promised';r.sendStatus='pending';event(r,tentative?'offered':'promised',part);
     if(actor==='you'){if(meaning.delivery?.deliveryCondition==='stated_condition')r.condition={kind:'coverage_positive',text:meaning.delivery.conditionText||part,turnId};}
     continue;
    }
    if(actor==='buyer'&&!ownSend&&(request.test(part)||condition&&kind==='test reports')){const r=get(kind,'you',labelFor(kind));r.phase=r.events.some(e=>e.kind==='promised')?'promised':'requested';r.sendStatus='pending';event(r,'requested',part);}
    if(actor==='you'&&kind==='test reports'&&/\b(?:I|we)(?:'ll| will| can)\s+(?:check|verify|confirm)\s+(?:whether|if)\b/i.test(part)){const r=get(kind,'you',labelFor(kind));if(!r.events.some(event=>['requested','promised','offered','sent','received'].includes(event.kind)))r.phase='checking';event(r,'check_promised',part);}
   }
  }
  if(condition){const reports=result.transfers.filter(t=>t.sender==='you'&&t.document==='test reports');if(!reports.length&&/\breport\b/i.test(text))reports.push(get('test reports','you'));for(const r of reports){r.condition={kind:condition==='scope_required'?'coverage_positive':'unresolved',text,turnId};event(r,'restricted',text);}}
  result.processedTurnIds.push(turnId);
 }
 // Reuse the existing spoken bundle resolver for contextual "both/that"
 // agreements and explicit cancellations rather than reinterpreting them.
 const spoken=deriveSpokenDocumentEvidence(turns.map((turn,index)=>({id:turn.id||`document-turn-${index}`,role:turn.role==='customer'?'buyer':turn.role as 'you'|'buyer',text:turn.text,at:index})));
 for(const agreement of spoken.agreements)for(const kind of agreement.documents){const document=kind as DocumentKind;if(!documentKindsForState(document).includes(document))continue;const record=get(document,'you');if(record.sendStatus!=='reported_sent')record.phase='promised';record.sendStatus=record.sendStatus==='reported_sent'?'reported_sent':'pending';if(!record.events.some(event=>event.kind==='promised'&&event.turnId===agreement.turnId))record.events.push({kind:'promised',actor:'you',turnId:agreement.turnId,quote:agreement.quote,source:turns.find(turn=>turn.id===agreement.turnId)?.source||'transcript'});}
 for(const cancelled of spoken.cancellations)for(const record of result.transfers.filter(row=>row.sender==='you'&&cancelled.documents.includes(row.document))){record.phase='cancelled';record.sendStatus='unconfirmed';record.condition=undefined;record.events.push({kind:'cancelled',actor:'buyer',turnId:cancelled.turnId,quote:cancelled.quote,source:turns.find(turn=>turn.id===cancelled.turnId)?.source||'transcript'});}
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
 if(r.phase==='cancelled')return `The buyer cancelled the request for the ${label}; no sending obligation remains.`;
 if(r.sender==='buyer')return r.receiptStatus==='confirmed'?`The salesperson confirmed receipt of the buyer’s ${label}.`:r.sendStatus==='reported_sent'?`The buyer reported sending the ${label}; the salesperson has not confirmed receipt.`:`The buyer ${r.phase==='offered'?'offered':'promised'} to send the ${label}; sending and salesperson receipt remain unconfirmed.`;
 const check=r.events.some(e=>e.kind==='check_promised')?'The salesperson will check the report coverage. ':'';
 const hasSend=r.events.some(event=>event.kind==='requested'||event.kind==='promised'||event.kind==='offered');
 if(!hasSend)return check||`The buyer asked about the ${label} coverage; it remains unknown until supported by approved evidence.`;
 const send=r.sendStatus==='reported_sent'?`The salesperson reported sending the ${label}; buyer receipt remains ${r.receiptStatus}.`:`${r.events.some(e=>e.kind==='promised')?'The salesperson promised to send':'The buyer requested'} the ${label}${r.condition?`; ${r.condition.kind==='coverage_positive'?'sending is conditional on confirmed positive report coverage':'the buyer’s stated release condition must be satisfied'}`:''}. Sending remains pending.`;
 return check+send+(r.document==='test reports'?' Report coverage remains unknown until supported by approved evidence.':'');
});}
/** Reviewed edits are authoritative. Do not re-import raw speech omitted or
 * corrected by the salesperson. Attribute only explicit reviewed statements;
 * ambiguous prose stays in the recap rather than becoming a completed event. */
export function documentStateFromReviewedRecap(recap:string,options:{buyerNames?:string[]}={}):DocumentState{
 const turns:DocumentTurn[]=[];
 for(const [index,raw] of recap.replace(/\\n/g,'\n').split(/\n+|(?<=[.!?])\s+/).entries()){
  const line=normalize(raw).trim();
  const quote=line.match(/[“"]([^”"]+)[”"]/u)?.[1];
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
