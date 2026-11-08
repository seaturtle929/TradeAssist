import {deriveDocumentState,documentStateFromReviewedRecap,type DocumentState} from './document-state.ts';
import type {CallRecord,Turn} from './trade';
import type {CompanyBrainRecord} from './company-brain';
import {deriveCallReview} from './call-review.ts';
import {deriveSpokenDocumentEvidence,isRepContactDetailRequest} from './document-call-evidence.ts';
import {buildClientStanding} from './client-standing.ts';
import {routingHistoryFor} from './call-participant.ts';
import {attachCallToClient,updateClientRecord,upsertClientContact,upsertClientCallRecord,type ClientCategory,type ClientRecord,type ClientContact} from './client-records.ts';

export type WrapUpMemoryKind='discussed'|'agreed'|'completed'|'uncertain'|'decision';
export type WrapUpMemory={owner?:'you'|'buyer';projectId?:string;id:string;text:string;kind:WrapUpMemoryKind;source:'buyer'|'rep_update'|'inference';sourceTurnId?:string;quote?:string;at:number;contactId?:string;confirmed:boolean};
export type WrapUpContact={source?:'speech'|'rep_update'|'reviewed_recap';id:string;name:string;email?:string;emailLabel?:string;phone?:string;role?:string;sourceTurnId:string;quote:string;confirmed:boolean;reviewDecision?:'include'|'exclude'};
export type CallWrapUp={projectId?:string;interactionType?:import('./trade').InteractionType;documentState?:DocumentState;documentStateRecap?:string;version:1;callId:string;companyId:string;clientId:string;recap:string;outcome:string;notes:string;memory:WrapUpMemory[];contacts:WrapUpContact[];categoryUpdate?:{category?:ClientCategory;inactiveReason?:string;reopenOpportunity?:string};reviewedAt?:number};
export type ClientCallWrapUp=CallWrapUp;
const clone=<T>(value:T):T=>structuredClone(value);
// A routing contact repeating/requesting the rep's details is not offering a buyer contact.
const repContactCheck=isRepContactDetailRequest;
const promise=/\b(?:I|we)(?:'ll|’ll| will)\s+(?:send|email|share|provide|check|confirm|review|call|contact|pass|relay|forward)\b/i;
const possibleAction=/\b(?:I|we) (?:can|could|may|might) (?:pass|take|relay|forward|send|email|share|review|call)\b/i;
const uncertainty=/\?|\b(?:not sure|uncertain|don't know|do not know|need to check|needs? approval|not yet|still waiting|pending)\b/i;
const completed=/\b(?:I|we)(?:'ve|’ve| have)?\s+(?:already\s+)?(?:sent|emailed|shared|provided|completed|received)\b/i;
const conditional=/\b(?:if|once|when|unless|might|maybe|perhaps|not|never|haven't|have not|didn't|did not|no confirmation|no record)\b/i;
const relevant=/\b(?:needs?|require\w*|uses?|suppliers?|grades?|spec(?:s|ifications?)?|volumes?|quantit\w*|applications?|tests?|criteria|evaluation|engineer\w*|defer|decision|purchasing|budget|cost|prices?|concern|problem|risk|timeline|schedule|send|email|review|approval|interested|plan|sent|emailed|message|callback|unavailable)\b|@/i;
function kindFor(turn:Turn):WrapUpMemoryKind {
 if(possibleAction.test(turn.text))return 'uncertain';
 if(promise.test(turn.text)&&conditional.test(turn.text))return deriveDocumentState({turns:[turn]}).transfers.some(row=>row.events.some(event=>event.kind==='promised'||event.kind==='check_promised'))?'agreed':'uncertain';
 if(promise.test(turn.text))return 'agreed';
 if(uncertainty.test(turn.text))return 'uncertain';
 if(completed.test(turn.text)&&!conditional.test(turn.text))return 'completed';
 return 'discussed';
}
const contactNameKey=(value:string)=>value.trim().toLocaleLowerCase().replace(/\s+/g,' ');
const inboxLabel=(email:string|undefined,clientName:string)=>email&&/^(?:purchasing|procurement|buying|buyers)(?:[.+_-][^@]*)?@/i.test(email)?`${clientName} purchasing inbox`:undefined;
function buyerContactStatement(text:string):boolean {
 if(repContactCheck(text))return false;
 const own=/\b(?:my|our)\s+(?:email(?: address)?|inbox|phone|number)\b|\b(?:email|send|reach|contact)\s+(?:me|us)\b|\bto (?:me|us) at\b/i.test(text);
 if(/\byour (?:email(?: address)?|inbox|phone|number)\b/i.test(text)&&!own)return false;
 // A buyer can name someone else's destination without supplying their own
 // contact details. Preserve the spoken request, but do not assign that inbox.
 return !/\b(?:to|for|email|reach|contact)\s+(?:(?:my|our|your|his|her|their)\s+)?(?:manager|supervisor|engineer|colleague|assistant|representative)\b|\b(?:manager|supervisor|engineer|colleague|assistant|representative)(?:'s)?\s+(?:email|inbox|address|number)\b/i.test(text);
}
const buyerIntroduction=(text:string)=>{const name=text.match(/\b(?:my name is|this is|I am|I'm)\s+([A-Z][a-z'-]+(?:\s+[A-Z][a-z'-]+)?)(?=[,.!]|\s+(?:from|with|at|and|in|here|speaking)|$)/i)?.[1]||text.match(/(?:^|[,.!]\s+)([A-Z][a-z'-]+)\s+(?:speaking|here)\b/i)?.[1];return name&&!/^(?:not|calling|the|a|an|in|from|just|only|purchasing|reception|receptionist|front desk|unavailable|busy)\b/i.test(name)?name:undefined;};
const buyerRole=(text:string)=>/\b(?:in|from|with)\s+(?:the\s+)?(?:purchasing|procurement)\b|\b(?:I|we)\s+(?:handle|manage|am responsible for)\s+(?:the\s+)?(?:purchasing|procurement)\b/i.test(text)?'Purchasing':undefined;
const matchNamedContact=(client:ClientRecord,contact:Pick<WrapUpContact,'id'|'name'>)=>client.contacts.find(row=>row.id===contact.id&&row.kind!=='main_line')||client.contacts.find(row=>row.kind!=='main_line'&&!row.archived&&contact.name.trim()&&contactNameKey(row.name)===contactNameKey(contact.name));

/** Build an editable proposal from captured speech and, for existing calls, the
 * salesperson-reviewed recap. A shared inbox is a route, never a person ID. */
export function proposeReviewedCallContacts(call:CallRecord,client:ClientRecord):WrapUpContact[]{
 if(call.manufacturerId!==client.companyId||call.clientId!==client.id)throw Error('This call belongs to another client or selling company.');
 const reliable=call.turns.filter(turn=>!turn.transcriptionUncertainty),proposals:WrapUpContact[]=[];
 // The intended contact is not proof of who answered the main line.
 let name='',role:string|undefined;
 const repAddresses=new Set(reliable.filter(turn=>turn.role==='you'&&/\b(?:my|our) (?:email|address)|\b(?:reach|email) me\b/i.test(turn.text)).flatMap(turn=>turn.text.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/ig)||[]).map(value=>value.toLowerCase()));
 for(const turn of reliable.filter(row=>row.role==='buyer')){
  const introduced=buyerIntroduction(turn.text);if(introduced){name=introduced;role=buyerRole(turn.text);}else role=buyerRole(turn.text)||role;
  const statement=turn.text.split(/(?<=[.!?])\s+/).filter(buyerContactStatement).join(' ');
  const email=statement.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i)?.[0],phone=statement.match(/(?:\+\d{1,3}[ .-]?)?(?:\(\d{3}\)|\d{3})[ .-]\d{3}[ .-]\d{4}\b/)?.[0];
  if(!email&&!phone||email&&repAddresses.has(email.toLowerCase())&&!/\bmy (?:email|address)\b/i.test(statement))continue;
  const existing=matchNamedContact(client,{id:'',name}),prior=proposals.find(row=>contactNameKey(row.name)===contactNameKey(name)&&!!name);
  const contact:WrapUpContact={...prior,id:existing?.id||prior?.id||`contact:${client.id}:call:${call.id}:${turn.id}`,name:name||existing?.name||'',email:email||prior?.email,phone:phone||prior?.phone,role:role||prior?.role||existing?.role,emailLabel:inboxLabel(email||prior?.email,client.name)||prior?.emailLabel||existing?.emailLabel,source:'speech',sourceTurnId:turn.id,quote:turn.text,confirmed:!!name};
  if(prior)proposals.splice(proposals.indexOf(prior),1,contact);else proposals.push(contact);
 }
 // A reviewed recap can correct ASR identity and contact details. Apply that
 // account after speech, before legacy proposal fields; old unchecked proposals
 // are evidence only and cannot overwrite the salesperson's reviewed correction.
 const recap=call.wrapUp?.reviewedAt?call.wrapUp.recap.replace(/\\n/g,'\n'):'';
 const reviewed=recap?buildClientStanding({client:{...client,currentSummary:undefined},calls:[call],now:Math.max(Date.now(),call.startedAt,call.wrapUp!.reviewedAt!)}).contact:undefined;
 if(reviewed){
  const named=proposals.filter(row=>row.name.trim()),prior=proposals.find(row=>contactNameKey(row.name)===contactNameKey(reviewed.name))||(named.length===1?named[0]:undefined),existing=matchNamedContact(client,{id:prior?.id||'',name:reviewed.name});
  const email=reviewed.email??prior?.email;
  const corrected:WrapUpContact={...prior,id:prior?.id||existing?.id||`contact:${client.id}:call:${call.id}:recap`,name:reviewed.name,email,emailLabel:reviewed.email?inboxLabel(reviewed.email,client.name):prior?.emailLabel,role:reviewed.role,source:'reviewed_recap',sourceTurnId:'',quote:recap,confirmed:true};
  if(prior)proposals.splice(proposals.indexOf(prior),1,corrected);else proposals.push(corrected);
 }
 // An explicit edited-and-confirmed contact remains the rep's contact decision.
 // Exclusion remains exclusion. Merely opening a legacy unchecked proposal does
 // not promote its obsolete ASR fields above the reviewed recap.
 for(const saved of call.wrapUp?.contacts||[]){
  const prior=proposals.find(row=>row.id===saved.id||!!saved.name&&contactNameKey(row.name)===contactNameKey(saved.name));
  const explicitEdit=saved.source==='rep_update'&&saved.confirmed;
  const merged:WrapUpContact=prior?{...clone(saved),...prior,...explicitEdit?clone(saved):{},confirmed:saved.reviewDecision==='exclude'?false:!!(explicitEdit?saved.name:prior.name),reviewDecision:saved.reviewDecision}:{...clone(saved),confirmed:saved.reviewDecision==='exclude'?false:!!saved.name,reviewDecision:saved.reviewDecision};
  if(prior)proposals.splice(proposals.indexOf(prior),1,merged);else proposals.push(merged);
 }
 return proposals;
}

/** Shared by wrap-up and Add contacts from saved recap. This only updates the
 * client address book; historical calls and stages stay byte-for-byte intact. */
export function saveReviewedCallContacts(brain:CompanyBrainRecord,call:CallRecord,contacts:WrapUpContact[],now=Date.now()):{brain:CompanyBrainRecord;contacts:WrapUpContact[]}{
 if(brain.companyId!==call.manufacturerId)throw Error('The contact review belongs to another selling company.');
 let client=brain.clients?.find(row=>row.id===call.clientId&&row.companyId===brain.companyId);if(!client)throw Error('Choose the client for this call before saving contacts.');
 const saved:WrapUpContact[]=[];
 for(const contact of contacts){
  if(!contact.confirmed){saved.push({...clone(contact),reviewDecision:'exclude'});continue;}
  const turn=call.turns.find(row=>row.id===contact.sourceTurnId&&row.role==='buyer');
  if(contact.source==='reviewed_recap'){
   if(!call.wrapUp?.reviewedAt||contact.quote.trim()!==call.wrapUp.recap.replace(/\\n/g,'\n').trim())throw Error('A recap contact needs the reviewed source call.');
  }else if(contact.source!=='rep_update'&&(!turn||turn.text!==contact.quote||turn.transcriptionUncertainty))throw Error('A captured contact requires its reliable source buyer turn.');
  if(!contact.name.trim())throw Error('Confirm the contact’s name before adding them.');
  if(client.contacts.some(row=>row.id===contact.id&&row.kind==='main_line'))throw Error('Keep the person and the company main line separate.');
  if((brain.clients||[]).some(row=>row.id!==client!.id&&row.contacts.some(item=>item.id===contact.id)))throw Error('A reviewed contact cannot be moved from another client.');
  const known=matchNamedContact(client,contact),id=known?.id||contact.id;
  const values:Partial<ClientContact>={id,kind:'person',name:contact.name.trim(),...contact.email!==undefined?{email:contact.email.trim()}:{},...contact.email!==undefined||contact.emailLabel!==undefined?{emailLabel:(contact.emailLabel||'').trim()}:{},...contact.phone!==undefined?{phone:contact.phone.trim()}:{},...contact.role!==undefined?{role:contact.role.trim()}:{},provenance:{source:contact.source||'speech',callId:call.id,...contact.sourceTurnId?{sourceTurnId:contact.sourceTurnId}:{},...contact.quote?{quote:contact.quote}:{},confirmedAt:now}};
  client=upsertClientContact(client,values,now);saved.push({...clone(contact),id,reviewDecision:'include'});
 }
 return {brain:{...brain,clients:(brain.clients||[]).map(row=>row.id===client!.id?client!:clone(row)),updatedAt:now},contacts:saved};
}
/** A concise editable draft is still a proposal. Its temporary reviewed wrapper
 * is only an adapter for the shared standing projection and is never persisted. */
function conciseWrapUpDraft(call:CallRecord,client:ClientRecord,draft:CallWrapUp):string {
 // A factual accomplishment digest is already concise and includes its open
 // questions. Do not append a second, potentially contradictory status recap.
 if(!/^Participants:/i.test(draft.recap))return draft.recap;
 const now=Math.max(Date.now(),call.startedAt+1),standing=buildClientStanding({client:{...client,currentSummary:undefined},calls:[{...call,wrapUp:{...draft,reviewedAt:now}}],now});
 if(!standing.contact||!standing.documents.length)return draft.recap;
 const buyerReview=call.turns.filter(turn=>turn.role==='buyer'&&!turn.transcriptionUncertainty).findLast(turn=>/\bI(?:'ll|’ll| will)\s+review\b/i.test(turn.text));
 const reviewStep=buyerReview?`${standing.contact.name} planned to review the documents${/\bif\b/i.test(buyerReview.text)?'; any follow-up remained conditional':'; completion and any follow-up remain unconfirmed'}.`:standing.buyerOwes.join(' ');
 return [standing.summary,reviewStep,...standing.unknowns].filter(Boolean).join(' ');
}
/** Proposals only. The rep explicitly confirms which observations become memory;
 * generated recap text never becomes attributed buyer evidence. */
export function proposeCallWrapUp(call:CallRecord,client:ClientRecord):CallWrapUp {
 if(call.manufacturerId!==client.companyId||call.clientId!==client.id)throw Error('This call belongs to a different client or selling company.');
 if(call.wrapUp)return {...clone(call.wrapUp),contacts:proposeReviewedCallContacts(call,client)};
 const review=deriveCallReview(call);
 const reliableTurns=call.turns.filter(turn=>!turn.transcriptionUncertainty);
 const documentEvidence=deriveSpokenDocumentEvidence(call.turns),documentRequests=new Set(documentEvidence.requests.map(item=>item.turnId)),documentAgreements=new Map(documentEvidence.agreements.map(item=>[item.turnId,item]));
 const repAddresses=new Set(reliableTurns.filter(turn=>turn.role==='you').flatMap(turn=>turn.text.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/ig)||[]).map(address=>address.toLowerCase()));
 const echoesRepContact=(turn:Turn)=>turn.role==='buyer'&&!documentRequests.has(turn.id)&&(repContactCheck(turn.text)||(turn.text.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/ig)||[]).some(address=>repAddresses.has(address.toLowerCase()))&&!/\bmy (?:email|address)\b/i.test(turn.text));
 const selected=client.contacts.find(row=>row.id===call.contactId);
 const memory:WrapUpMemory[]=reliableTurns.filter(turn=>turn.role!=='conversation'&&!echoesRepContact(turn)&&(turn.role==='buyer'?documentRequests.has(turn.id)||relevant.test(turn.text)||uncertainty.test(turn.text)||promise.test(turn.text)||possibleAction.test(turn.text):documentAgreements.has(turn.id)||promise.test(turn.text)||completed.test(turn.text))).map(turn=>({id:`turn:${turn.id}`,text:documentAgreements.has(turn.id)?`Salesperson agreed to send the ${documentAgreements.get(turn.id)!.documents.join(' and ')}. Spoken: “${turn.text}”`:turn.text,kind:documentAgreements.has(turn.id)?'agreed':kindFor(turn),source:turn.role==='buyer'?'buyer' as const:'rep_update' as const,owner:turn.role==='buyer'?'buyer' as const:'you' as const,sourceTurnId:turn.id,quote:turn.text,at:turn.at,...call.projectId?{projectId:call.projectId}:{},...call.contactId&&selected?.kind!=='main_line'?{contactId:call.contactId}:{},confirmed:false}));
 const routing=routingHistoryFor(reliableTurns);
 if(!routing&&review.unknowns.length)memory.push({id:'review-unknowns',text:review.unknowns.join(' '),kind:'uncertain',source:'inference',at:call.turns.at(-1)?.at||call.startedAt,confirmed:false});
 if(routing)memory.push({id:'routing-status',text:routing.summary,kind:'uncertain',source:'inference',at:call.turns.at(-1)?.at||call.startedAt,confirmed:false});
 for(const decision of call.decisionsNeeded||[])memory.push({id:`decision:${decision.id}`,text:decision.text,kind:'decision',source:'inference',at:call.startedAt,confirmed:false});
 const contacts=proposeReviewedCallContacts(call,client);
 const draft:CallWrapUp={...call.projectId?{projectId:call.projectId}:{},...call.interactionType?{interactionType:call.interactionType}:{},documentState:review.documentState,documentStateRecap:review.recap,version:1,callId:call.id,companyId:client.companyId,clientId:client.id,recap:review.recap,outcome:review.outcome,notes:call.notes,memory,contacts};
 const recap=conciseWrapUpDraft(call,client,draft);return {...draft,recap,documentStateRecap:recap};
}
/** One idempotent session save, preserving participant IDs and historical turns.
 * A proposed category/contact/memory item never applies without rep confirmation. */
export function saveClientCallWrapUp(brain:CompanyBrainRecord,calls:CallRecord[],call:CallRecord,wrapUp:CallWrapUp,now=Date.now()):{brain:CompanyBrainRecord;calls:CallRecord[];call:CallRecord} {
 if(brain.companyId!==call.manufacturerId||wrapUp.companyId!==brain.companyId||wrapUp.callId!==call.id||wrapUp.clientId!==call.clientId)throw Error('The wrap-up belongs to another call, client or selling company.');
 let client=brain.clients?.find(row=>row.id===call.clientId&&row.companyId===brain.companyId);if(!client)throw Error('Select a client before saving the call.');
 if(call.projectId&&!client.projects?.some(project=>project.id===call.projectId&&project.clientId===client!.id&&project.companyId===brain.companyId))throw Error('The interaction project does not belong to this client.');
 if(wrapUp.projectId!==undefined&&wrapUp.projectId!==call.projectId)throw Error('The reviewed memory belongs to another project.');
 if(call.contactId&&!client.contacts.some(contact=>contact.id===call.contactId))throw Error('The call participant is not a contact of this client.');
 for(const item of wrapUp.memory.filter(row=>row.confirmed)){
  if(!item.text.trim())throw Error('A confirmed memory update needs text.');
  if(item.projectId!==undefined&&item.projectId!==call.projectId)throw Error('A memory update belongs to another project.');
  if(item.contactId&&!client.contacts.some(contact=>contact.id===item.contactId))throw Error('A memory update belongs to another contact.');
  if(item.source==='buyer'){
   const turn=call.turns.find(row=>row.id===item.sourceTurnId&&row.role==='buyer');
   if(!turn||turn.text!==item.quote)throw Error('Buyer memory needs its original captured buyer turn.');
   if(turn.transcriptionUncertainty)throw Error('Correct the uncertain transcript before retaining it as a buyer fact.');
  }
  if(item.kind==='completed'&&(promise.test(item.text)||conditional.test(item.text)||!completed.test(item.text)))throw Error('Completion requires an explicit completed action, not a promise or uncertain event.');
 }
 const reviewedCall={...call,derivedReviewStale:false,wrapUp:{...clone(wrapUp),reviewedAt:now}};
 const contacts=proposeReviewedCallContacts(reviewedCall,client);
 const contactResult=saveReviewedCallContacts({...brain,clients:(brain.clients||[]).map(row=>row.id===client!.id?client!:row)},reviewedCall,contacts,now);
 client=contactResult.brain.clients!.find(row=>row.id===client!.id)!;
 if(wrapUp.categoryUpdate)client=updateClientRecord(client,{...wrapUp.categoryUpdate,category:wrapUp.categoryUpdate.category??null},now);
 const review=deriveCallReview({...call,outcome:wrapUp.outcome});
 const reviewedRecap=wrapUp.recap.trim()?wrapUp.recap:review.recap;
 const savedWrapUp:CallWrapUp={...clone(wrapUp),...call.projectId?{projectId:call.projectId}:{},...call.interactionType?{interactionType:call.interactionType}:{},documentState:wrapUp.documentState&&wrapUp.documentStateRecap===reviewedRecap?clone(wrapUp.documentState):documentStateFromReviewedRecap(reviewedRecap,{buyerNames:client.contacts.filter(row=>row.kind!=='main_line'&&!row.review?.required).map(row=>row.name)}),documentStateRecap:reviewedRecap,contacts:contactResult.contacts,recap:wrapUp.recap.trim()?wrapUp.recap:review.recap,outcome:review.outcome,memory:wrapUp.memory.map(item=>({...clone(item),...call.projectId?{projectId:call.projectId}:{},...item.source==='buyer'&&item.text.trim()!==item.quote?.trim()?{source:'rep_update' as const}:{}})),reviewedAt:now};
 const saved:CallRecord={...clone(call),derivedReviewStale:false,wrapUp:savedWrapUp,notes:wrapUp.notes,outcome:savedWrapUp.outcome};
 // Earlier imports of this same session may already have extracted memory. The
 // reviewed selection replaces only this session's derived entries; no other
 // call or manually authored historical evidence is altered.
 client={...client,...!client.currentSummary||call.startedAt>=client.currentSummary.at?{currentSummary:{callId:call.id,at:call.startedAt,reviewedAt:now,text:savedWrapUp.recap,...call.projectId?{projectId:call.projectId}:{},...call.contactId?{contactId:call.contactId}:{},...call.interactionType?{interactionType:call.interactionType}:{}}}:{},context:client.context.filter(row=>row.callId!==call.id||!row.id.startsWith(`call:${call.id}:`)&&!row.id.startsWith(`wrapup:${call.id}:`))};
 const updated={...brain,clients:(brain.clients||[]).map(row=>row.id===client!.id?client!:clone(row))};
 return {brain:attachCallToClient(updated,saved,{clientId:client.id,contactId:call.contactId},now),calls:upsertClientCallRecord(calls,saved),call:saved};
}
