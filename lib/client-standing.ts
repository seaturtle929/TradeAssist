import {documentStateFromReviewedRecap,deriveDocumentState,type DocumentState} from './document-state.ts';
import type {ClientRecord,ClientContextEntry} from './client-records';
import type {CallRecord} from './trade';
import type {PreparationStage} from './client-preparation';
import {isDocumentRequest} from './document-call-evidence.ts';
import {deriveBuyerNeeds} from './buyer-needs.ts';

export type ClientStanding={documentState?:DocumentState;version:1;companyId:string;clientId:string;source?:{callId:string;at:number;reviewedAt:number};summary:string;reached:string;buyerRequested:string[];repOwes:string[];buyerOwes:string[];unknowns:string[];sendStatus:'pending'|'sent'|'unknown';receiptStatus:'confirmed'|'unconfirmed';reviewStatus:'confirmed'|'unconfirmed';contact?:{name:string;role?:string;email?:string};documents:string[];outsideUpdate?:string;evidence:{callId:string;at:number;text:string;kind:'reviewed_recap'|'quote'|'rep_update'}[]};
const clean=(text:string)=>text.replace(/\\r\\n|\\n/g,'\n').replace(/[‘’]/g,"'").replace(/[\t ]+/g,' ').trim();
const plain=(text:string)=>clean(text).replace(/\s+/g,' ').trim();
const unique=(values:string[])=>[...new Set(values.filter(Boolean))];
const materialKinds=(text:string)=>[
 ['company profile',/\b(?:company\s+)?profiles?\b/i],['spec sheets',/\b(?:spec(?:ification)?\s+sheets?|specifications?|specs?|data sheets?)\b/i],['test reports',/\btest reports?\b/i],['drawings',/\bdrawings?\b/i],['catalog',/\bcatalog(?:ue)?s?\b/i],
].filter(([,pattern])=>(pattern as RegExp).test(text)).map(([label])=>label as string);
const joined=(values:string[])=>values.length>1?values.slice(0,-1).join(', ')+' and '+values.at(-1):values[0]||'the requested documents';
const uncertain=/\b(?:not|never|no longer|no confirmation|no evidence|unconfirmed|unknown|uncertain|not sure|don't know|do not know|haven't|have not|hasn't|has not|didn't|did not|maybe|perhaps|whether|if|once|when|until|before)\b/i;
const sentences=(text:string)=>clean(text).split(/\n+|(?<=[!?;])\s+|(?<=\.)\s+(?=[A-Z“"'])/).map(plain).filter(Boolean);
/** Completion is deliberately narrower than a mention of "sent". A dated rep
 * update can complete a send; it cannot establish receipt, review or approval. */
export function reportedDocumentSend(text:string):boolean {
 return sentences(text).some(part=>{
  const match=/\b(?:I|we)(?:'ve| have| had)?\s+(?:(?:already|just)\s+)*(?:sent|emailed|forwarded|shared)\b/i.exec(part);
  return !!match&&!part.includes('?')&&!uncertain.test(part.slice(0,match.index))&&!/\b(?:sent|emailed|forwarded|shared)\s+(?:no|none|nothing)\b/i.test(part)&&(/\b(?:documents?|materials?|them|those)\b/i.test(part)||materialKinds(part).length>0);
 });
}
/** Only an explicit, attributed completion updates receipt/review. Sending,
 * a future review plan, the rep receiving something, and uncertain wording do
 * not establish buyer completion. A partial document receipt is not the whole
 * requested bundle. All other update wording remains verbatim prompt context. */
export function reportedBuyerDocumentCompletion(text:string,action:'receipt'|'review',contact:ClientStanding['contact'],documents:string[]):'confirmed'|'unconfirmed'|undefined {
 const escaped=(value:string)=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 const names=unique(['buyer','client','customer',contact?.name||'',contact?.name.split(/\s+/)[0]||'']).map(escaped);
 const subject=new RegExp('^(?:the )?(?:'+names.join('|')+')\\b','i');
 const event=action==='receipt'?/\b(?:receiv(?:e|ed)|got|receipt)\b/i:/\b(?:review(?:ed)?|reviewing)\b/i;
 const complete=action==='receipt'?/\b(?:received|got)\b|\bconfirmed (?:the )?receipt\b/i:/\breviewed\b|\b(?:finished|completed) (?:the )?review(?:ing)?\b/i;
 let status:'confirmed'|'unconfirmed'|undefined;
 for(const part of sentences(text).flatMap(part=>part.split(/\s+(?:but|however)\s+/i))){
  if(!subject.test(part)||!event.test(part))continue;
  const kinds=materialKinds(part),wholeBundle=/\b(?:documents?|materials?|them|those)\b/i.test(part)||documents.length>0&&documents.every(kind=>kinds.includes(kind));
  if(!wholeBundle)continue;
  if(part.includes('?')||uncertain.test(part)||/\b(?:none|nothing|zero|some|partial|part of|except)\b|\bno\s+(?:documents?|materials?|specs?|profiles?)\b/i.test(part)||/\b(?:may|might|could|would|should|thinks?|believes?|probably|possibly|appears?|seems?|expect|hope|plans?|planned|will)\b/i.test(part)){status='unconfirmed';continue;}
  if(complete.test(part))status='confirmed';
 }
 return status;
}
function reviewedContact(recap:string,client:ClientRecord):ClientStanding['contact'] {
 const declared=recap.match(/confirmed purchasing responsibility\s*\(([^)]+)\)/i)?.[1]
  ||recap.match(/\b(?:[Rr]eached|[Ss]poke (?:to|with)|[Tt]alked (?:to|with))\s+([A-Z][a-z'-]+(?:\s+[A-Z][a-z'-]+)?)(?=\s+(?:in|from|who|at|about|and)|[,.;]|$)/)?.[1]
  ||recap.match(/\b([A-Z][a-z'-]+(?:\s+[A-Z][a-z'-]+)?)\s+(?:in|from)\s+(?:purchasing|procurement)\b/)?.[1];
 const name=declared?.trim().replace(/^([a-z])/,(letter)=>letter.toUpperCase());
 if(!name)return;
 const invalid=new RegExp('(?:'+name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+').{0,35}\\b(?:not reached|was not reached|unavailable|not available|no longer (?:handles|in))\\b','i');
 if(invalid.test(recap)&&!new RegExp('(?:reached|spoke (?:to|with)) '+name,'i').test(recap))return;
 const known=client.contacts.find(row=>row.kind!=='main_line'&&!row.review?.required&&row.name.toLowerCase()===name.toLowerCase());
 const namePattern=name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 const explicitRole=recap.match(new RegExp('\\b'+namePattern+'\\b\\s+(?:is\\s+)?(?:in|from|handles|works in)\\s+(?:the\\s+)?(purchasing|procurement|engineering|reception|sales|quality|operations|finance|technical)\\b','i'))?.[1];
 const roleWithdrawn=new RegExp('\\b'+namePattern+'\\b.{0,50}\\b(?:no longer|not in|not responsible|role (?:is |remains )?(?:unknown|unconfirmed))\\b','i').test(recap);
 const confirmedRole=new RegExp('confirmed purchasing responsibility\\s*\\('+namePattern+'\\)','i').test(recap);
 const role=roleWithdrawn?undefined:explicitRole?/^(?:purchasing|procurement)$/i.test(explicitRole)?'Purchasing':explicitRole[0].toUpperCase()+explicitRole.slice(1).toLowerCase():confirmedRole?'Purchasing':known?.role;
 const addressParts=sentences(recap).filter(part=>!/\b(?:salesperson|representative|rep)(?:'s)? (?:email|address)|\byour email\b/i.test(part));
 const email=addressParts.flatMap(part=>part.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/ig)||[]).at(-1);
 return {name,...role?{role}:{},...email?{email}:{}};
}
/** The reviewed recap is the current client account, not a collection of
 * unchecked extraction candidates. Older quotes remain evidence, never a
 * competing current summary. No transcript reconstruction overrides an edit. */
export function buildClientStanding(input:{client:ClientRecord;calls:CallRecord[];outsideUpdate?:string;now?:number;excludeCallId?:string;projectId?:string;contactId?:string}):ClientStanding {
 const {client}=input,now=input.now??Date.now();
 const call=input.calls.filter(row=>row.manufacturerId===client.companyId&&row.clientId===client.id&&(!row.projectId||row.projectId===input.projectId)&&(!input.contactId||!row.contactId||row.contactId===input.contactId||client.contacts.find(contact=>contact.id===row.contactId)?.kind==='main_line')&&row.id!==input.excludeCallId&&!row.derivedReviewStale&&row.wrapUp?.reviewedAt&&row.wrapUp.reviewedAt<=now&&row.startedAt<=now).sort((a,b)=>b.startedAt-a.startedAt||(b.wrapUp!.reviewedAt!-a.wrapUp!.reviewedAt!))[0];
 const saved=client.currentSummary;
 const source=call?{callId:call.id,at:call.startedAt,reviewedAt:call.wrapUp!.reviewedAt!}:undefined;
 const rawRecap=call?(saved?.callId===call.id&&saved.reviewedAt>=call.wrapUp!.reviewedAt!?saved.text:call.wrapUp!.recap):'';
 const recap=clean(rawRecap);
 const outsideUpdate=clean(input.outsideUpdate||'');
 const manualUpdates=client.context.filter(entry=>!entry.callId&&!entry.needsReview&&!entry.supersededById&&['rep_update','manager'].includes(entry.source)&&['current','completed'].includes(entry.status)&&(!entry.projectId||entry.projectId===input.projectId)&&(entry.scope==='client'||!!input.contactId&&entry.contactId===input.contactId)&&entry.at<=now&&entry.recordedAt<=now&&entry.recordedAt>=(source?.reviewedAt||0)&&(entry.at>=(source?.at||0)||!!entry.supersedesId)).sort((a,b)=>a.at-b.at||a.recordedAt-b.recordedAt);
 const base:ClientStanding={version:1,companyId:client.companyId,clientId:client.id,...source?{source}:{},summary:'No reviewed call recap yet.',reached:'Not recorded.',buyerRequested:[],repOwes:[],buyerOwes:[],unknowns:[],sendStatus:'unknown',receiptStatus:'unconfirmed',reviewStatus:'unconfirmed',documents:[],evidence:[],...outsideUpdate?{outsideUpdate:(input.outsideUpdate||'').trim()}:{}};
 if(!call||!recap)return base;
 base.evidence=[{callId:call.id,at:source!.at,text:rawRecap,kind:'reviewed_recap'},...call.turns.filter(turn=>!turn.transcriptionUncertainty).map(turn=>({callId:call.id,at:turn.at,text:`${turn.role==='you'?'Salesperson':turn.role==='buyer'?'Buyer':'Unattributed'}: ${turn.text}`,kind:'quote' as const}))];
 const contact=reviewedContact(recap,client),parts=sentences(recap);
 // A substantive product question is not itself a request to send documents.
 // Read the reviewed account, including quoted include/attach requests, without
 // reconstructing facts from transcript omitted by the salesperson's review.
 const requestParts=parts.filter(part=>materialKinds(part).length&&(/\b(?:request(?:ed)?|asked(?: for)?)\b/i.test(part)||isDocumentRequest(part.replace(/^[^“"]*:\s*[“"]?/,'').replace(/[”"]$/,'')))&&!/^Salesperson|^Reason for calling/i.test(part)&&!/\b(?:not requested|not needed|no longer|did not (?:ask|request)|didn't (?:ask|request))\b/i.test(part));
 // A later recap may report receipt/review without repeating the original
 // request. Retain that document bundle without inventing a new request.
 const documentStatusParts=parts.filter(part=>!/^Salesperson|^Reason for calling/i.test(part)&&/\b(?:receiv(?:e|ed)|receipt|review(?:ed|ing)?)\b/i.test(part));
 // The review keeps historical request quotations for evidence. An explicit
 // later cancellation narrows the current bundle rather than re-opening it
 // from those earlier quotes. This marker is itself part of the editable recap.
 const currentBundle=parts.findLast(part=>/^Current requested document bundle:/i.test(part));
 const cancelledAll=parts.some(part=>/^No requested documents remain[.!]?$/i.test(part));
 const documents=cancelledAll?[]:currentBundle?materialKinds(currentBundle):unique([...requestParts,...documentStatusParts].flatMap(materialKinds));
 base.documents=documents;
 base.contact=contact;
 base.reached=contact?`${contact.name}${contact.role?' in '+contact.role.toLowerCase():''} was reached.`:/contact who confirmed purchasing responsibility/i.test(recap)?'A contact confirmed purchasing responsibility.':/routing contact|reception|gatekeeper|purchasing contact not reached|message left with routing/i.test(recap+' '+call.wrapUp?.outcome)?'Reception was reached; no purchasing conversation is confirmed.':'See the reviewed recap for who was reached.';
 if(requestParts.length&&documents.length)base.buyerRequested=[`${contact?.name||'The buyer'} requested the ${joined(currentBundle?documents:unique(requestParts.flatMap(materialKinds)))}${contact?.email?' at '+contact.email:''}.`];
 const promised=parts.some(part=>/\b(?:salesperson|representative|rep|promis(?:ed|e))\b/i.test(part)&&/\b(?:send|email|share)\b/i.test(part)&&materialKinds(part).length)||parts.some(part=>/^Salesperson.*next step:/i.test(part)&&/\b(?:I'll|I will|we'll|we will)\b/i.test(part));
 // Named-rep recaps need no special name list; explicit "promised" is enough.
 const repNames=unique(call.turns.filter(turn=>turn.role==='you'&&!turn.transcriptionUncertainty).flatMap(turn=>[...turn.text.matchAll(/\b(?:this is|I'm|I am|my name is)\s+([A-Z][a-z'-]+)(?=[,.;!]|\s+(?:with|from|at|and)|$)/g)].map(match=>match[1])));
 const namedRepSent=parts.some(part=>{const start=part.match(/^(?:The )?(salesperson|representative|rep|[A-Z][a-z'-]+)\s+(?:has |had |already |just )*(?:sent|emailed|forwarded|shared)\b/i);return !!start&&!uncertain.test(part)&&materialKinds(part).length>0&&(/^(?:salesperson|representative|rep)$/i.test(start[1])||repNames.some(name=>name.toLowerCase()===start[1].toLowerCase()));});
 const sendEvidence=namedRepSent||reportedDocumentSend(outsideUpdate)||parts.some(part=>/^(?:I|We)\b/.test(part)&&reportedDocumentSend(part))||parts.some(part=>/^Salesperson(?:'s)? (?:update|completed|stated next step):/i.test(part)&&reportedDocumentSend(part));
 base.sendStatus=cancelledAll?'unknown':sendEvidence?'sent':requestParts.length||promised?'pending':'unknown';
 if(cancelledAll)base.repOwes=['The document request was cancelled; no remaining document-send obligation is recorded.'];
 if(base.sendStatus==='pending')base.repOwes=[`Send the ${joined(documents)}${contact?.email?' to '+contact.email:''}; sending has not been confirmed.${documents.length&&!contact?.email?' The destination address is unconfirmed.':''}`];
 if(base.sendStatus==='sent')base.repOwes=['No remaining document-send obligation is recorded; follow up without assuming receipt or review.'];
 const buyerCompleted=(verb:string)=>parts.some(part=>!uncertain.test(part)&&!/^Salesperson|^Reason for calling/i.test(part)&&new RegExp('\\b(?:buyer|contact|customer|'+(contact?.name||'UNNAMED')+').{0,35}\\b(?:has |have |had |already )?'+verb+'\\b','i').test(part));
 base.receiptStatus=reportedBuyerDocumentCompletion(recap,'receipt',contact,documents)??(buyerCompleted('received')?'confirmed':'unconfirmed');
 base.reviewStatus=reportedBuyerDocumentCompletion(recap,'review',contact,documents)??(buyerCompleted('reviewed')?'confirmed':'unconfirmed');
 const receiptUpdate=reportedBuyerDocumentCompletion(outsideUpdate,'receipt',contact,documents),reviewUpdate=reportedBuyerDocumentCompletion(outsideUpdate,'review',contact,documents);
 if(receiptUpdate)base.receiptStatus=receiptUpdate;
 if(reviewUpdate)base.reviewStatus=reviewUpdate;
 if(base.receiptStatus==='confirmed'){
  base.sendStatus='sent';
  base.repOwes=['The buyer confirmed document receipt; no remaining document-send obligation is recorded.'];
 }
 const buyerPromise=parts.filter(part=>/^Contact.{0,25}next step:|^Agreed follow-up:|\b(?:buyer|contact|customer) (?:agreed|promised)\b/i.test(part)&&/\b(?:review|reply|respond|follow up|get back)\b/i.test(part));
 const contactName=contact?.name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 const namedReviewPlan=contactName?parts.find(part=>new RegExp('\\b(?:'+contactName+'|she|he|they)\\b.{0,45}\\b(?:will review|planned to review|agreed to review|would review)\\b','i').test(part)):undefined;
 base.buyerOwes=namedReviewPlan?[(/\b(?:if|conditional|relevant|fit)\b/i.test(namedReviewPlan)?'The buyer plans to review; follow-up is conditional, and neither is confirmed complete.':'The buyer plans to review; completion remains unconfirmed.')]:buyerPromise.length?['The buyer agreed to review or respond; completion remains unconfirmed.']:['No firm buyer follow-up commitment is recorded.'];
 if(base.reviewStatus==='confirmed')base.buyerOwes=['Document review is reported complete; any further buyer action or approval remains unconfirmed.'];
 if(base.receiptStatus==='unconfirmed'&&documents.length)base.unknowns.push('Document receipt is unconfirmed.');
 if(base.reviewStatus==='unconfirmed'&&documents.length)base.unknowns.push('Document review is unconfirmed.');
 if(base.sendStatus==='pending'&&documents.length&&!contact?.email)base.unknowns.push('Document destination address is unconfirmed.');
 if(contact?.role==='Purchasing'&&!parts.some(part=>!uncertain.test(part)&&/\b(?:final (?:decision|approval) (?:authority|maker)|sole decision maker)\b/i.test(part)))base.unknowns.push('Final decision authority is unconfirmed; purchasing responsibility alone does not establish it.');
 const clientNames=unique([client.name,client.name.replace(/\s*[—–-]\s*Test\s*$/i,''),client.name.split(/\s+/)[0]]).map(value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'));
 const usePattern=new RegExp('\\b(?:buyer|contact|customer|we|I|'+clientNames.join('|')+')\\b.{0,40}\\b(?:uses?|buy|buys|need|needs|require|requires)\\b.{0,100}\\b(?:for|in)\\b','i');
 const retainedBuyerEntries=client.context.filter(entry=>entry.source==='buyer'&&entry.status==='current'&&['fact','background','update'].includes(entry.kind)&&!entry.needsReview&&!entry.supersededById&&(!entry.projectId||entry.projectId===input.projectId)&&(entry.scope==='client'||!!input.contactId&&entry.contactId===input.contactId)&&entry.at<=now&&entry.recordedAt<=now);
 const reviewedAccounts=input.calls.filter(row=>row.manufacturerId===client.companyId&&row.clientId===client.id&&row.id!==input.excludeCallId&&!row.derivedReviewStale&&row.wrapUp?.reviewedAt&&row.wrapUp.reviewedAt<=now&&row.startedAt<=now&&(!row.projectId||row.projectId===input.projectId)&&(!input.contactId||!row.contactId||row.contactId===input.contactId||client.contacts.find(contact=>contact.id===row.contactId)?.kind==='main_line')).map(row=>({at:row.startedAt,text:row.wrapUp!.recap}));
 const retainedNeeds=deriveBuyerNeeds({callContext:{knownFacts:[...reviewedAccounts,...retainedBuyerEntries.map(entry=>({at:entry.at,text:entry.text}))].sort((a,b)=>a.at-b.at).map(entry=>entry.text).join('\n')}});
 const useKnown=!!retainedNeeds.facts.application||parts.some(part=>!uncertain.test(part)&&!/^Salesperson|^Reason for calling/i.test(part)&&usePattern.test(part));
 if(!useKnown)base.unknowns.push('Product usage and requirements are unconfirmed.');
 // The editable reviewed account is authoritative. Its paired structured
 // handoffs carry the same action states as live coaching, never raw omitted
 // speech or a previous unchecked extraction. Coverage needs source authority,
 // so reviewed speech alone leaves it unknown.
 const documentState=call.wrapUp?.documentState&&call.wrapUp.documentStateRecap===rawRecap?structuredClone(call.wrapUp.documentState):documentStateFromReviewedRecap(recap,{buyerNames:contact?[contact.name]:client.contacts.filter(row=>row.kind!=='main_line'&&!row.review?.required).map(row=>row.name)});
 if(documentState.transfers.length||manualUpdates.length||outsideUpdate){
  const update=deriveDocumentState({seed:documentState,turns:[...manualUpdates.map(entry=>({id:'client-update:'+entry.id,role:'you',text:entry.text,source:'rep_update' as const})),...outsideUpdate?[{id:'reviewed-rep-update',role:'you',text:outsideUpdate,source:'rep_update' as const}]:[]]});
  base.documentState=update;
  const outgoing=update.transfers.filter(row=>row.sender==='you'&&row.phase!=='cancelled'&&row.events.some(event=>['requested','promised','sent','received'].includes(event.kind))),checks=update.transfers.filter(row=>row.sender==='you'&&row.phase==='checking'),incoming=update.transfers.filter(row=>row.sender==='buyer'&&row.phase!=='cancelled');
  const offers=update.transfers.filter(row=>row.sender==='you'&&row.phase==='offered'&&!row.events.some(event=>['requested','promised','sent','received'].includes(event.kind)));
  base.documents=outgoing.map(row=>row.document);
  const requested=outgoing.filter(row=>row.events.some(event=>event.kind==='requested'));
  base.buyerRequested=requested.length?[`${contact?.name||'The buyer'} requested the ${joined(requested.map(row=>row.document))}${requested.some(row=>row.condition)?'; subject to '+requested.filter(row=>row.condition).map(row=>row.condition!.text).join(' and '):''}.`]:[];
  base.repOwes=outgoing.map(row=>row.sendStatus==='reported_sent'?`The salesperson reports sending the ${row.document}; receipt remains ${row.receiptStatus}.`:`${row.events.some(event=>event.kind==='promised')?'Promised to send':'Requested follow-up: send'} the ${row.document}${row.condition?'; only after '+(row.condition.kind==='coverage_positive'?'positive report coverage is confirmed':'the buyer’s stated condition is satisfied'):''}; sending is pending.`);
  if(outgoing.length>1&&outgoing.every(row=>!row.condition&&row.sendStatus!=='reported_sent'))base.repOwes=[`Send the ${joined(outgoing.map(row=>row.document))}; sending remains pending.`];
  if(!outgoing.length&&update.transfers.some(row=>row.phase==='cancelled'))base.repOwes=['The document request was cancelled; no remaining document-send obligation is recorded.'];
  base.repOwes.push(...checks.map(row=>`Check whether the ${row.label||row.document} covers the buyer’s reference; coverage remains unknown.`));
  base.buyerOwes=incoming.map(row=>row.receiptStatus==='confirmed'?`The salesperson confirmed receipt of the buyer’s ${row.document}.`:row.sendStatus==='reported_sent'?`The buyer reports sending the ${row.document}; salesperson receipt remains unconfirmed.`:`The buyer ${row.phase==='offered'?'offered':'promised'} to send the ${row.document}; it remains pending and receipt is unconfirmed.`);
  base.sendStatus=outgoing.length?outgoing.every(row=>row.sendStatus==='reported_sent')?'sent':'pending':'unknown';
  base.receiptStatus=outgoing.length&&outgoing.every(row=>row.receiptStatus==='confirmed')?'confirmed':'unconfirmed';
  for(const row of update.transfers)if(row.document==='test reports'&&row.coverage==='unknown')base.unknowns.push('Report coverage remains unknown; the buyer’s reference and a promise to check are not source evidence.');
  for(const row of incoming)if(row.receiptStatus!=='confirmed')base.unknowns.push(`The buyer’s ${row.document} has not been confirmed received by the salesperson.`);
  for(const row of offers)base.unknowns.push(`The salesperson offered to send the ${row.document}; buyer acceptance and a sending obligation remain unconfirmed.`);
 }
 const semantic=[base.reached,...base.buyerRequested,base.sendStatus==='sent'?`The salesperson reports sending the ${joined(base.documents)}. Receipt is ${base.receiptStatus}; review is ${base.reviewStatus}.`:base.repOwes[0]];
 // A handwritten account is preserved verbatim as the current summary. Only
 // old extractive recaps are presented through their concise structured view.
 const extractive=/^(?:Participants|Reason for calling|Discussed|Salesperson)[^\n]*:/i.test(recap);
 base.summary=extractive?semantic.filter(Boolean).join(' '):rawRecap;
 if(!extractive&&(reportedDocumentSend(outsideUpdate)||receiptUpdate||reviewUpdate)){
  const retained=sentences(recap).filter(part=>!(reportedDocumentSend(outsideUpdate)&&/\b(?:send|sending|email|emailed)\b/i.test(part)&&/\b(?:promis(?:ed|e)|will|pending|not sent|not confirmed|unconfirmed|still owes)\b/i.test(part)))
   .filter(part=>!(receiptUpdate&&/\b(?:receipt|received)\b/i.test(part)&&/\b(?:pending|unconfirmed|not confirmed|not received|unknown)\b/i.test(part)))
   .filter(part=>!(reviewUpdate&&/\breview(?:ed)?\b/i.test(part)&&/\b(?:pending|unconfirmed|not confirmed|not reviewed|unknown|will|plans?|planned)\b/i.test(part)));
  base.summary=[...retained,...reportedDocumentSend(outsideUpdate)?[`The salesperson reports sending the ${joined(documents)}.`]:[],`Latest reported status: receipt is ${base.receiptStatus}; review is ${base.reviewStatus}.`].join(' ');
 }
 if(manualUpdates.length){
  base.summary+='\n'+manualUpdates.map(entry=>`Salesperson update (${new Date(entry.at).toISOString()}): ${entry.text}`).join('\n');
  base.evidence.push(...manualUpdates.map(entry=>({callId:'',at:entry.at,text:entry.text,kind:'rep_update' as const})));
 }
 return base;
}
export function clientStandingText(standing:ClientStanding):string {
 if(!standing.source)return '';
 return [`Latest salesperson-reviewed client account (call ${standing.source.callId}, ${new Date(standing.source.at).toISOString()}):`,standing.summary,`Reached: ${standing.reached}`,...standing.buyerRequested.map(text=>'Buyer request: '+text),...standing.repOwes.map(text=>'Rep owes: '+text),...standing.buyerOwes.map(text=>'Buyer owes: '+text),...standing.unknowns.map(text=>'Still open: '+text),...standing.outsideUpdate?['New salesperson update: '+standing.outsideUpdate]:[]].join('\n');
}
export function currentClientEntries(entries:ClientContextEntry[],standing:ClientStanding):ClientContextEntry[] {
 if(!standing.source)return entries;
 return entries.filter(entry=>!(entry.at<=standing.source!.at&&standing.contact?.role==='Purchasing'&&/\b(?:who (?:handles|is responsible for)|find (?:the |a )?(?:right |purchasing )?person|purchasing (?:contact|responsibility) (?:unknown|unconfirmed))\b/i.test(entry.text)));
}
/** Keep stage-specific model questions, but never reopen an answered routing
 * task or assert delivery from a promise. This is a semantic guard, not a new
 * hardcoded stage sequence. */
export function standingClarifications(questions:string[],standing:ClientStanding|undefined,stage:PreparationStage):string[] {
 if(!standing?.source)return questions;
 const filtered=questions.map(plain).filter(question=>!(standing.contact?.role==='Purchasing'&&!/\b(?:else|final|approval|approv|decision)\w*\b/i.test(question)&&/\bwho\b.{0,40}\b(?:purchas|procurement|buying)|\b(?:right person|purchasing contact)\b/i.test(question))&&!(standing.contact?.email&&/\b(?:what|which|best)\b.{0,20}\bemail(?: address)?\b/i.test(question))&&!(standing.sendStatus!=='sent'&&/\b(?:receipt|received|reviewed|had a chance to (?:review|read))\b/i.test(question)));
 const stageText=stage.name+' '+stage.objective;
 if(/discover|qualif|understand.*(?:need|requirement)/i.test(stageText)){
  if(standing.unknowns.some(text=>/usage and requirements/.test(text))&&!filtered.some(text=>/\b(?:use|usage|application|requirement)\b/i.test(text)))filtered.unshift('What do you use this material for, and which requirements matter most?');
  if(standing.unknowns.some(text=>/Final decision authority/.test(text))&&!filtered.some(text=>/\b(?:approv|decision|evaluat)/i.test(text)))filtered.push('Who else is involved in evaluating or approving a supplier?');
 }
 return unique(filtered).slice(0,3);
}
