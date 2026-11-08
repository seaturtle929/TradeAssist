import type {CallRecord,Turn,Manufacturer} from './trade';
import type {CallContext} from './call-purpose';
import type {ClientCallBackground} from './client-preparation';
import {deriveCallParticipant,routingHistoryFor,type TransferAction} from './call-participant.ts';
import {ensureCompanyBrain,type CompanyBrainRecord,type BuyerMemory} from './company-brain.ts';

export type ClientProject={id:string;clientId:string;companyId:string;name:string;status:'active'|'closed';createdAt:number;updatedAt:number};
export type ClientCategory='developing'|'existing'|'inactive';
export const CLIENT_CATEGORIES:readonly {id:ClientCategory;label:string}[]=[{id:'developing',label:'Developing'},{id:'existing',label:'Existing customers'},{id:'inactive',label:'Inactive'}];
export type ClientContactMethod={id:string;label:string;value:string};
export type ContactEvidenceReview={required:boolean;reason:string;callId:string;sourceTurnId:string;markedAt:number;reviewedAt?:number;original:{name:string;role?:string;email?:string;emailLabel?:string;phone?:string;meetingLink?:string;otherMethods?:ClientContactMethod[]}};
export type ClientContact={review?:ContactEvidenceReview;reviewHistory?:ContactEvidenceReview[];provenance?:{source:'speech'|'rep_update'|'reviewed_recap';callId:string;sourceTurnId?:string;quote?:string;confirmedAt:number};kind?:'person'|'main_line';meetingLink?:string;otherMethods?:ClientContactMethod[];id:string;clientId:string;companyId:string;name:string;role?:string;email?:string;emailLabel?:string;phone?:string;notes?:string;archived?:boolean;createdAt:number;updatedAt:number};
export type ClientContextEntry={owner?:'you'|'buyer';projectId?:string;interactionType?:import('./client-interactions').InteractionType;association?:{originalClientId:string;originalContactId?:string;reviewedAt:number};id:string;kind:'fact'|'background'|'objection'|'open_question'|'commitment'|'manager_decision'|'update'|'inference';text:string;source:'buyer'|'rep_update'|'manager'|'inference'|'legacy';at:number;recordedAt:number;updatedAt?:number;status:'current'|'open'|'promised'|'completed'|'resolved'|'superseded'|'cancelled';scope:'client'|'contact';contactId?:string;callId?:string;sourceTurnId?:string;quote?:string;supersedesId?:string;supersededById?:string;needsReview?:boolean};
export type ClientRecord={projects?:ClientProject[];currentSummary?:{callId:string;at:number;reviewedAt:number;text:string;projectId?:string;contactId?:string;interactionType?:import('./client-interactions').InteractionType};category?:ClientCategory;categoryUpdatedAt?:number;inactiveReason?:string;reopenOpportunity?:string;callBackground?:ClientCallBackground;id:string;companyId:string;name:string;contacts:ClientContact[];background:string;context:ClientContextEntry[];callIds:string[];createdAt:number;updatedAt:number;removedAt?:number;removalUpdatedAt?:number;legacy?:{buyerMemoryIds:string[];originalLabels:string[];associationStatus:'confirmed'|'needs_review';reviewReasons:string[]}};
export type ClientHistoryItem={projectId?:string;interactionType?:import('./client-interactions').InteractionType;callId:string;at:number;contactId?:string;contactName?:string;stageId?:string;participantScope?:'selected'|'company'|'other_contact';outcome:string;summary:string;summarySource?:'ai_summary'|'rep_notes'|'manager_packet'|'rep_recap'|'unavailable';routing?:{summary:string;transferStatus?:TransferAction['status'];targetName?:string}};
export type CallPreparationSnapshot={projectId?:string;project?:Pick<ClientProject,'id'|'name'|'status'>;interactionType?:import('./client-interactions').InteractionType;standing?:import('./client-standing').ClientStanding;version:1;companyId:string;clientId:string;contactId?:string;reachViaContactId?:string;reachViaContact?:Pick<ClientContact,'id'|'clientId'|'companyId'|'name'|'role'|'email'|'emailLabel'|'phone'|'kind'|'meetingLink'|'otherMethods'>;clientName?:string;contact?:Pick<ClientContact,'id'|'clientId'|'companyId'|'name'|'role'|'email'|'emailLabel'|'phone'|'kind'|'meetingLink'|'otherMethods'>;callId:string;stageId:string;configurationVersionId:string;configurationVersion:number;reviewedAt:number;clientUpdatedAt:number;category?:ClientCategory;inactiveReason?:string;reopenOpportunity?:string;callBackground?:ClientCallBackground;background:string;outsideUpdate:string;entries:ClientContextEntry[];history:ClientHistoryItem[];stage:{id:string;name:string;objective:string;playbook:string;informationToBringBack:string[]};callContext?:CallContext;fingerprint:string};
export type ClientPreparationSnapshot=CallPreparationSnapshot;
export type LegacyClientAssociation={status:'needs_review'|'confirmed';originalBuyer:string;originalManufacturerId?:string;originalClientId?:string;originalContactId?:string;reviewReasons:string[];candidateClientIds:string[];memoryIds?:string[];reviewedAt?:number};
export type ClientContextEntryInput=Omit<ClientContextEntry,'id'|'recordedAt'|'at'|'status'>&{id?:string;at?:number;status?:ClientContextEntry['status']};
export type ClientAssociationTarget={clientId:string;contactId?:string};

const clone=<T>(value:T):T=>structuredClone(value);
const short=(value:unknown,max=6000)=>typeof value==='string'?value.trim().slice(0,max):'';
const stableHash=(value:string)=>{let hash=2166136261;for(const character of value)hash=Math.imul(hash^character.charCodeAt(0),16777619);return (hash>>>0).toString(36);};
const freshId=(prefix:string)=>`${prefix}:${globalThis.crypto.randomUUID()}`;
const normalized=(value:string)=>value.toLowerCase().replace(/[^a-z0-9@.]+/g,' ').trim();
const assertCompany=(client:ClientRecord,companyId:string)=>{if(client.companyId!==companyId)throw Error('This client belongs to a different selling company.');};
const assertContact=(client:ClientRecord,contactId?:string)=>{if(contactId&&!client.contacts.some(contact=>contact.id===contactId&&contact.clientId===client.id&&contact.companyId===client.companyId))throw Error('This contact does not belong to the selected client and company.');};
const assertProject=(client:ClientRecord,projectId?:string)=>{if(projectId&&!client.projects?.some(project=>project.id===projectId&&project.clientId===client.id&&project.companyId===client.companyId))throw Error('This project does not belong to the selected client and company.');};
const defaultStatus=(kind:ClientContextEntry['kind']):ClientContextEntry['status']=>kind==='commitment'?'promised':['open_question','manager_decision'].includes(kind)?'open':'current';
const completedActionPattern=/\b(?:I|we)(?:'ve|’ve)?\s+(?:(?:have|had|already|just)\s+)*(?:sent|emailed|shared|provided|completed)\b/i;
const completionStatements=(text:string)=>text.split(/(?<=[.!?;])\s+|;\s*|\s+(?:but|however)\s+|,\s*(?=(?:not|never|no)\b)|\s+and\s+(?=(?:I|we)\b)/i).filter(statement=>{
 const match=completedActionPattern.exec(statement);
 if(!match||/\?/.test(statement)||/\b(?:if|whether|once|after|before|when|until|unless|provided)\b/i.test(statement)||/\b(?:sent|emailed|shared|provided|completed)\s+(?:no|none|nothing|zero)\b/i.test(statement))return false;
 const prefix=statement.slice(0,match.index).replace(/[‘’]/g,"'");
 return !/\b(?:if|whether|maybe|perhaps|possibly|suppose|imagine|assuming|thought|think|believe|guess|wish|said|says|asked|told|quoted|no|not|without|lack|cannot|can't|don't|didn't|haven't|hasn't)\b/i.test(prefix);
});
const explicitCompletion=(text:string)=>completionStatements(text).length>0;
const unsupportedCompletion=(text:string)=>!explicitCompletion(text)&&(completedActionPattern.test(text)||/\b(?:I|we)(?:'ll|’ll| will)\b|\b(?:not yet|haven't|have not)\b/i.test(text));

export function createClientRecord(companyId:string,name:string,now=Date.now(),id=freshId('client')):ClientRecord{
 if(!companyId||!short(name,300))throw Error('A client needs a name and selling company.');
 return {id,companyId,name:short(name,300),contacts:[],background:'',context:[],callIds:[],createdAt:now,updatedAt:now};
}
/** Projects are client-owned labels, never inferred from a buyer name or a
 * product mention. Explicit stable IDs keep two opportunities separate. */
export function upsertClientProject(client:ClientRecord,input:{id?:string;name:string;status?:'active'|'closed'},now=Date.now()):ClientRecord {
 const name=short(input.name,300);if(!name)throw Error('A project needs a name.');
 if(input.id)assertProject(client,input.id);
 const id=input.id||freshId('project'),prior=client.projects?.find(project=>project.id===id);
 const project:ClientProject={...prior,id,companyId:client.companyId,clientId:client.id,name,status:input.status||prior?.status||'active',createdAt:prior?.createdAt||now,updatedAt:now};
 return {...clone(client),projects:[...(client.projects||[]).filter(row=>row.id!==id).map(clone),project],updatedAt:now};
}
/** Removal only hides a client from active lists. Keep a separate lifecycle
 * timestamp after restoration so an older backup cannot undo either action. */
export function setClientRemoved(client:ClientRecord,removed:boolean,now=Date.now()):ClientRecord{
 const next=clone(client);
 if((next.removedAt!==undefined)===removed)return next;
 next.updatedAt=now;next.removalUpdatedAt=now;
 if(removed)next.removedAt=now;else delete next.removedAt;
 return next;
}
export function updateClientRecord(client:ClientRecord,patch:{name?:string;background?:string;category?:ClientCategory|null;inactiveReason?:string;reopenOpportunity?:string;callBackground?:ClientCallBackground},now=Date.now()):ClientRecord{
 if(patch.name!==undefined&&!short(patch.name,300))throw Error('The client name cannot be empty.');
 if(patch.callBackground?.sources.some(source=>source.companyId!==client.companyId||source.clientId!==client.id))throw Error('Background sources cannot cross clients or selling companies.');
 if(patch.callBackground?.brief&&(patch.callBackground.brief.companyId!==client.companyId||patch.callBackground.brief.clientId!==client.id))throw Error('The preparation brief belongs to a different client or selling company.');
 const background=patch.background??patch.callBackground?.context;
 const callBackground=patch.callBackground??client.callBackground;
 const next:ClientRecord={...clone(client),...callBackground&&background!==undefined?{callBackground:{...clone(callBackground),context:background.slice(0,20000)}}:{},...Object.hasOwn(patch,'category')?{category:patch.category??undefined,categoryUpdatedAt:now}:{},...patch.inactiveReason!==undefined?{inactiveReason:short(patch.inactiveReason,2000)}:{},...patch.reopenOpportunity!==undefined?{reopenOpportunity:short(patch.reopenOpportunity,2000)}:{},...patch.name!==undefined?{name:short(patch.name,300)}:{},...background!==undefined?{background:background.slice(0,20000)}:{},updatedAt:now};
 if(patch.callBackground&&patch.background===undefined&&next.background.trim()!==(client.callBackground?.context??client.background).trim())next.context=next.context.map(row=>row.kind==='background'&&row.scope==='client'&&row.status==='current'?{...row,status:'superseded',updatedAt:now}:row);
 if(patch.background!==undefined&&next.background.trim()!==(client.callBackground?.context??client.background).trim()){
  const prior=[...next.context].reverse().find(row=>row.kind==='background'&&row.scope==='client'&&row.status==='current');
  const input:ClientContextEntryInput={kind:'background',text:next.background||'Background cleared by the salesperson.',source:'rep_update',scope:'client',at:now,status:'current'};
  return prior?supersedeClientEntry(next,prior.id,input,now):addClientContextEntry(next,input,now);
 }
 return next;
}
export function upsertClientContact(client:ClientRecord,contact:Partial<ClientContact>&{reviewConfirmed?:boolean},now=Date.now()):ClientRecord{
 if(contact.companyId&&contact.companyId!==client.companyId||contact.clientId&&contact.clientId!==client.id)throw Error('A contact cannot be moved between clients or selling companies implicitly.');
 const id=contact.id||freshId('contact'),prior=client.contacts.find(row=>row.id===id),kind=contact.kind||prior?.kind||'person';
 const name=short(contact.name??prior?.name,300)||(kind==='main_line'?'Company main line':'');
 if(!name)throw Error('A named contact needs a name, or choose Company main line.');
 const methods=contact.otherMethods?.filter(method=>short(method.label,100)&&short(method.value,1000)).map(method=>({id:method.id||freshId('contact-method'),label:short(method.label,100),value:short(method.value,1000)}));
 const {reviewConfirmed,...contactFields}=contact;
 const row:ClientContact={...prior,...contactFields,...methods?{otherMethods:methods}:{},kind,id,clientId:client.id,companyId:client.companyId,name,createdAt:prior?.createdAt||now,updatedAt:now};
 if(prior?.review?.required){
  // Only the explicit contact-editor review action can restore factual use.
  // New speech imports and unrelated contact updates retain the warning.
  row.review=reviewConfirmed?{...clone(prior.review),required:false,reviewedAt:now}:clone(prior.review);
  row.reviewHistory=clone(prior.reviewHistory||[]);
 }
 let next:ClientRecord={...clone(client),contacts:[...client.contacts.filter(item=>item.id!==id).map(clone),row],updatedAt:now};
 if(prior&&prior.email!==row.email){
  const updateId=freshId('contact-update');
  next={...next,context:next.context.map(entry=>entry.scope==='contact'&&entry.contactId===id&&entry.status==='current'&&!!prior.email&&entry.text.toLowerCase().includes(prior.email.toLowerCase())?{...entry,status:'superseded',supersededById:updateId,updatedAt:now}:entry)};
  next=addClientContextEntry(next,{id:updateId,kind:'update',text:row.email?`${row.name} contact email updated to ${row.email}.`:`The previously recorded email for ${row.name} was removed; the current address needs confirmation.`,source:'rep_update',scope:'contact',contactId:id,at:now,status:'current'},now);
 }
 return next;
}
export function addClientContextEntry(client:ClientRecord,input:ClientContextEntryInput,now=Date.now()):ClientRecord{
 assertContact(client,input.contactId);assertProject(client,input.projectId);
 if(input.scope==='contact'&&!input.contactId)throw Error('A contact-specific update needs a selected contact.');
 if(input.scope==='client'&&input.contactId)throw Error('Choose client scope or contact scope explicitly.');
 const text=short(input.text);if(!text)throw Error('Write the update before saving it.');
 if(input.status==='completed'&&unsupportedCompletion(text))throw Error('A future, conditional or incomplete action cannot be marked completed. Record what actually happened.');
 if(input.source==='buyer'&&(!input.callId||!input.sourceTurnId||!input.quote))throw Error('A recorded buyer statement needs its call, turn and original quotation. Outside-call developments should be attributed to the salesperson.');
 const id=input.id||freshId('client-entry');
 if(client.context.some(row=>row.id===id))return clone(client);
 const entry:ClientContextEntry={...clone(input),...input.owner?{}:input.source==='buyer'?{owner:'buyer' as const}:['rep_update','manager'].includes(input.source)&&/^\s*(?:I|we)\b/i.test(text)?{owner:'you' as const}:{},id,text,at:input.at??now,recordedAt:now,updatedAt:now,status:input.status||defaultStatus(input.kind)};
 const complete=explicitCompletion(text);
 const materialTerms=(value:string)=>[...new Set((value.toLowerCase().match(/\b(?:spec(?:s|ification(?:s)?)?|profiles?|drawings?|catalog(?:ue)?s?|quot(?:e|es|ation|ations)|test reports?|data sheets?)\b/g)||[]).map(term=>term.replace(/specifications?|specs/g,'spec').replace(/profiles/g,'profile').replace(/drawings/g,'drawing').replace(/quotes|quotations?/g,'quote')))];
 const productIds=(value:string)=>[...new Set([...(value.match(/\b[a-z]{1,6}-?\d{1,6}\b|#\d{2,6}/ig)||[]),...(value.match(/\b[A-Z]{2,8}\b/g)||[])].map(item=>item.toLowerCase()))];
 const completedIds=new Set<string>();
 for(const statement of complete&&['rep_update','manager','buyer'].includes(input.source)?completionStatements(text):[]){
  const sentMaterials=materialTerms(statement);
  const candidates=client.context.filter(row=>row.kind==='commitment'&&row.status==='promised'&&row.scope===entry.scope&&row.contactId===entry.contactId&&row.projectId===entry.projectId&&!!entry.owner&&((row.owner|| (row.source==='buyer'?'buyer':row.source==='rep_update'&&/^\s*(?:I|we)\b/i.test(row.text)?'you':undefined))===entry.owner)&&sentMaterials.length&&materialTerms(row.text).length&&materialTerms(row.text).every(term=>sentMaterials.includes(term)));
  const sentProducts=productIds(statement);
  for(const candidate of candidates){const promisedProducts=productIds(candidate.text);if(sentProducts.length?promisedProducts.length?promisedProducts.every(product=>sentProducts.includes(product)):candidates.length===1:candidates.length===1)completedIds.add(candidate.id);}
 }
 const priorContext=client.context.map(row=>completedIds.has(row.id)?{...clone(row),status:'completed' as const,supersededById:entry.id,updatedAt:now}:clone(row));
 return {...clone(client),context:[...priorContext,entry],updatedAt:now};
}
export function supersedeClientEntry(client:ClientRecord,entryId:string,input:ClientContextEntryInput,now=Date.now()):ClientRecord{
 const prior=client.context.find(row=>row.id===entryId);if(!prior)throw Error('The context item no longer exists.');
 if(prior.status==='superseded')throw Error('That item has already been corrected. Edit its current replacement.');
 if(input.scope!==prior.scope||input.contactId!==prior.contactId||input.projectId!==prior.projectId)throw Error('Corrections must keep the original contact scope; add a separate attributed update for another person.');
 const replacementId=input.id||freshId('client-entry');
 const next=addClientContextEntry(client,{...input,id:replacementId,supersedesId:prior.id},now);
 return {...next,context:next.context.map(row=>row.id===prior.id?{...row,status:'superseded',supersededById:replacementId,updatedAt:now}:row)};
}
export function resolveClientEntry(client:ClientRecord,entryId:string,status:'completed'|'resolved'|'cancelled'|'superseded',updateText:string,now=Date.now(),source:'rep_update'|'manager'='rep_update'):ClientRecord{
 const prior=client.context.find(row=>row.id===entryId);if(!prior)throw Error('The context item no longer exists.');
 if(!short(updateText))throw Error('Record what changed; a promise alone does not prove completion.');
 if(status==='completed'&&unsupportedCompletion(updateText))throw Error('A future, conditional or incomplete action cannot be marked completed. Record what actually happened.');
 const evidenceId=freshId('client-entry');
 const next=addClientContextEntry(client,{id:evidenceId,kind:'update',text:updateText,source,scope:prior.scope,...prior.projectId?{projectId:prior.projectId}:{},...prior.interactionType?{interactionType:prior.interactionType}:{},...prior.contactId?{contactId:prior.contactId}:{},at:now,status:'current',...status==='superseded'?{needsReview:true}:{}},now);
 return {...next,context:next.context.map(row=>row.id===entryId?{...row,status,supersededById:evidenceId,updatedAt:now}:row)};
}

/** Current relationship context remains distinct from active Company Knowledge.
 * Exclude other contacts, resolved/stale records and indiscriminate transcripts. */
export function selectClientEntries(client:ClientRecord,options:{companyId:string;contactId?:string;projectId?:string;query?:string;limit?:number}):ClientContextEntry[]{
 assertCompany(client,options.companyId);assertContact(client,options.contactId);assertProject(client,options.projectId);
 const terms=[...new Set((options.query||'').toLowerCase().match(/[a-z0-9]{3,}/g)||[])];
 const limit=Math.min(40,Math.max(1,options.limit||24));
 const score=(row:ClientContextEntry)=>(['open','promised'].includes(row.status)?20:0)+terms.filter(term=>row.text.toLowerCase().includes(term)).length*3;
 return client.context.filter(row=>(!row.projectId||row.projectId===options.projectId)&&!['superseded','cancelled','resolved'].includes(row.status)&&!(row.status==='completed'&&row.kind==='commitment')&&(row.scope==='client'||!!options.contactId&&row.contactId===options.contactId)).sort((one,two)=>score(two)-score(one)||two.at-one.at||two.recordedAt-one.recordedAt).slice(0,limit).map(clone);
}
export function clientHistoryFor(client:ClientRecord,calls:CallRecord[],options:{companyId:string;contactId?:string;projectId?:string;limit?:number;excludeCallId?:string;includeOtherContacts?:boolean}):ClientHistoryItem[]{
 assertCompany(client,options.companyId);assertContact(client,options.contactId);assertProject(client,options.projectId);
 return calls.filter(call=>call.manufacturerId===client.companyId&&call.clientId===client.id&&(!call.projectId||call.projectId===options.projectId)&&call.id!==options.excludeCallId&&(options.includeOtherContacts||!options.contactId||call.contactId===options.contactId||!call.contactId||client.contacts.find(contact=>contact.id===call.contactId)?.kind==='main_line')).sort((one,two)=>two.startedAt-one.startedAt).slice(0,Math.min(8,Math.max(1,options.limit||4))).map(call=>({callId:call.id,at:call.startedAt,...call.projectId?{projectId:call.projectId}:{},...call.interactionType?{interactionType:call.interactionType}:{},...routingHistoryFor(call.turns)?{routing:routingHistoryFor(call.turns)}:{},...call.contactId?{contactId:call.contactId,contactName:client.contacts.find(contact=>contact.id===call.contactId)?.review?.required?'Contact details awaiting review':client.contacts.find(contact=>contact.id===call.contactId)?.name||call.buyer}:{},participantScope:!call.contactId||client.contacts.find(contact=>contact.id===call.contactId)?.kind==='main_line'?'company':call.contactId===options.contactId?'selected':'other_contact',stageId:call.companyConfiguration?.selectedStageId||call.callContext?.stageId,outcome:call.outcome,summary:short(call.derivedReviewStale?'Transcript corrected after review; earlier recap and conclusions need review. Corrected conversation: '+call.turns.slice(-8).map(turn=>turn.role+': '+turn.text).join(' | '):call.wrapUp?.recap||call.summary?.overview||call.packets?.en?.summary.join(' ')||call.notes||'No reviewed summary recorded.',1000),summarySource:call.derivedReviewStale?'unavailable':call.wrapUp?.recap?'rep_recap':call.summary?.overview?'ai_summary':call.packets?.en?.summary.length?'manager_packet':call.notes?'rep_notes':'unavailable'}));
}
export function upsertClientCallRecord(calls:CallRecord[],call:CallRecord):CallRecord[]{
 const prior=calls.find(row=>row.id===call.id);
 if(prior&&prior.manufacturerId!==call.manufacturerId)throw Error('A saved session cannot move between selling companies.');
 const index=calls.findIndex(row=>row.id===call.id),next=calls.map(clone);
 if(index<0)return [clone(call),...next];
 next[index]={...clone(prior!),...clone(call),...prior?.legacyClientAssociation&&!call.legacyClientAssociation?{legacyClientAssociation:clone(prior.legacyClientAssociation)}:{}};
 return next;
}

/** Attach by stable IDs and record only actual dated statements. AI summaries
 * never become buyer quotations, company facts or completed commitments. */
export function attachCallToClient(brain:CompanyBrainRecord,call:CallRecord,target:ClientAssociationTarget,now=Date.now()):CompanyBrainRecord{
 if(brain.companyId!==call.manufacturerId)throw Error('This call belongs to a different selling company.');
 const client=brain.clients?.find(row=>row.id===target.clientId&&row.companyId===brain.companyId);if(!client)throw Error('Select a client in this selling company.');assertContact(client,target.contactId);assertProject(client,call.projectId);
 let next=clone(client);
 // A reviewed wrap-up is the authority for what this session contributes to
 // current memory. Do not recreate rejected suggestions from its transcript.
 if(call.wrapUp?.reviewedAt){
  const association=call.wrapUpAssociation;
  const corrected=!!association&&association.sourceClientId===call.wrapUp.clientId&&association.targetClientId===client.id&&association.targetContactId===target.contactId&&call.clientId===client.id&&call.contactId===target.contactId&&association.reviewedAt>0;
  if(call.wrapUp.companyId!==brain.companyId||call.wrapUp.callId!==call.id||call.wrapUp.clientId!==client.id&&!corrected||association&&!corrected)throw Error('The reviewed wrap-up does not belong to this call and client.');
  for(const item of call.wrapUp.memory.filter(row=>row.confirmed)){
   const id=`wrapup:${call.id}:${item.id}`;
   if(next.context.some(row=>row.id===id))continue;
   const contactId=corrected&&item.contactId?target.contactId:item.contactId;
   const kind:ClientContextEntry['kind']=item.kind==='agreed'?'commitment':item.kind==='decision'?'manager_decision':item.kind==='uncertain'?'open_question':item.kind==='completed'?'update':'fact';
   const source=item.source==='buyer'&&item.sourceTurnId&&item.quote?'buyer':item.source==='inference'?'inference':'rep_update';
   next=addClientContextEntry(next,{...corrected?{association:{originalClientId:association!.sourceClientId,originalContactId:item.contactId||association!.sourceContactId,reviewedAt:association!.reviewedAt}}:{},id,kind,text:item.text,source,...item.owner?{owner:item.owner}:item.source==='buyer'?{owner:'buyer' as const}:item.source==='rep_update'?{owner:'you' as const}:{},callId:call.id,...call.projectId?{projectId:call.projectId}:{},...call.interactionType?{interactionType:call.interactionType}:{},sourceTurnId:item.sourceTurnId,quote:item.quote,scope:contactId?'contact':'client',...contactId?{contactId}:{},at:item.at,status:item.kind==='agreed'?'promised':item.kind==='completed'?'completed':['uncertain','decision'].includes(item.kind)?'open':'current',...source==='inference'?{needsReview:true}:{}},now);
  }
  next={...next,callIds:[...new Set([...next.callIds,call.id])],updatedAt:now};
  return {...brain,clients:(brain.clients||[]).map(row=>row.id===next.id?next:clone(row)),updatedAt:now};
 }
 const scope:ClientContextEntry['scope']=target.contactId?'contact':'client';
 const participant=deriveCallParticipant(call.turns.filter(turn=>!turn.transcriptionUncertainty)),segmentStart=participant.afterTransfer?call.turns.findIndex(turn=>turn.id===participant.segmentStartTurnId):0,selectedContact=client.contacts.find(row=>row.id===target.contactId);
 const knownSpeakerMismatch=!!(target.contactId&&participant.speakerName&&selectedContact&&selectedContact.kind!=='main_line'&&!normalized(selectedContact.name).startsWith(participant.speakerName)&&!participant.speakerName.startsWith(normalized(selectedContact.name)));
 const finalQuestionState=call.buyerQuestionLog?.at(-1),pendingQuestions=finalQuestionState?.questions||[];
 for(const [turnIndex,turn] of call.turns.entries()){
  if(turn.transcriptionUncertainty||turn.role==='conversation'||participant.afterTransfer&&segmentStart>0&&turnIndex<segmentStart||knownSpeakerMismatch)continue;
  const text=short(turn.text),id=`call:${call.id}:turn:${turn.id}`;
  if(!text||next.context.some(row=>row.id===id))continue;
  const promise=/\b(?:I|we)(?:'ll|’ll| will)\s+(?:send|email|share|provide|check|confirm|review|call|contact)\b/i.test(text);
  const completed=explicitCompletion(text);
  if(turn.role==='you'&&!promise&&!completed)continue;
  const question=/\?/.test(text),pending=turn.role==='buyer'&&question&&pendingQuestions.some(row=>row.turnId===turn.id&&(text.includes(row.text)||row.text.includes(text)));
  const relevant=/\b(?:need|require|use|current|supplier|grade|spec|volume|quantity|application|test|criteria|evaluation|engineer|decision|purchasing|budget|cost|price|concern|worried|failed|problem|risk|timeline|schedule|send|email|review|approval|interested|plan)\b|[a-z0-9._+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(text);
  if(turn.role==='buyer'&&!promise&&!question&&!relevant)continue;
  const kind:ClientContextEntry['kind']=promise?'commitment':turn.role==='you'?'update':pending?'open_question':/\b(?:concern|worried|too (?:high|expensive)|not interested|failed|problem|risk|supplier)\b/i.test(text)?'objection':'fact';
  const rememberedText=question&&!pending?`Historical buyer question: ${text}${finalQuestionState?' (not pending in the final question queue)':' (answer status not recorded; do not assume it remains open)'}`:text;
  next=addClientContextEntry(next,{id,kind,text:rememberedText,source:turn.role==='buyer'?'buyer':'rep_update',owner:turn.role==='buyer'?'buyer':'you',callId:call.id,...call.projectId?{projectId:call.projectId}:{},...call.interactionType?{interactionType:call.interactionType}:{},sourceTurnId:turn.id,quote:text,scope,...target.contactId?{contactId:target.contactId}:{},at:turn.at,status:promise?'promised':pending?'open':'current',...question&&!pending&&!finalQuestionState?{needsReview:true}:{}},now);
 }
 for(const decision of call.decisionsNeeded||[]){
  const id=`call:${call.id}:decision:${decision.id}`,prior=next.context.find(row=>row.id===id),status:ClientContextEntry['status']=decision.checked?'resolved':'open';
  if(prior){next={...next,context:next.context.map(row=>row.id===id?{...row,text:decision.text,status,source:'inference',needsReview:true,updatedAt:now}:row),updatedAt:now};continue;}
  next=addClientContextEntry(next,{id,kind:'manager_decision',text:decision.text,source:'inference',callId:call.id,scope,...target.contactId?{contactId:target.contactId}:{},at:call.startedAt,status,needsReview:true},now);
 }
 if(knownSpeakerMismatch&&!next.context.some(row=>row.id===`call:${call.id}:contact-review`))next=addClientContextEntry(next,{id:`call:${call.id}:contact-review`,kind:'inference',text:`The selected contact was ${selectedContact?.name}, but the captured speaker identity appears as ${participant.speakerName}. Review this call’s contact association before reusing its statements.`,source:'inference',scope:'client',callId:call.id,at:call.startedAt,status:'open',needsReview:true},now);
 next={...next,callIds:[...new Set([...next.callIds,call.id])],updatedAt:now};
 return {...brain,clients:[...(brain.clients||[]).filter(row=>row.id!==next.id).map(clone),next],updatedAt:now};
}
export function reassociateClientCall(brain:CompanyBrainRecord,calls:CallRecord[],callId:string,target:ClientAssociationTarget,now=Date.now()):{brain:CompanyBrainRecord;calls:CallRecord[]}{
 const call=calls.find(row=>row.id===callId);if(!call)throw Error('That saved call no longer exists.');
 if(call.manufacturerId!==brain.companyId)throw Error('Calls cannot be reassociated across selling companies.');
 const client=brain.clients?.find(row=>row.id===target.clientId&&row.companyId===brain.companyId);if(!client)throw Error('Choose a client from this selling company.');assertContact(client,target.contactId);
 const originalBuyer=call.legacyClientAssociation?.originalBuyer||call.buyer;
 const changed:CallRecord={...clone(call),...call.wrapUp?{wrapUpAssociation:{sourceClientId:call.wrapUp.clientId,sourceContactId:call.wrapUpAssociation?.sourceContactId||call.contactId,targetClientId:client.id,targetContactId:target.contactId,reviewedAt:now}}:{},clientId:client.id,...target.contactId?{contactId:target.contactId}:{contactId:undefined},legacyClientAssociation:{status:'confirmed',originalBuyer,originalManufacturerId:call.legacyClientAssociation?.originalManufacturerId||call.manufacturerId,...(call.legacyClientAssociation?.originalClientId||call.clientId)?{originalClientId:call.legacyClientAssociation?.originalClientId||call.clientId}:{},...(call.legacyClientAssociation?.originalContactId||call.contactId)?{originalContactId:call.legacyClientAssociation?.originalContactId||call.contactId}:{},reviewReasons:[],candidateClientIds:[client.id],memoryIds:call.legacyClientAssociation?.memoryIds||[],reviewedAt:now}};
 const cleared={...brain,clients:(brain.clients||[]).map(row=>row.companyId!==brain.companyId?clone(row):({...clone(row),callIds:row.callIds.filter(id=>id!==callId),context:row.context.filter(entry=>entry.callId!==callId),...row.id===client.id&&row.legacy?{legacy:{...clone(row.legacy),associationStatus:'confirmed' as const,reviewReasons:[]}}:{}}))};
 return {brain:attachCallToClient(cleared,changed,target,now),calls:upsertClientCallRecord(calls,changed)};
}

function legacyEntry(memory:BuyerMemory,id:string,text:string,kind:ClientContextEntry['kind'],at:number,status:ClientContextEntry['status']='current',source?:{call:CallRecord;turn:Turn}):ClientContextEntry{
 return {id:`legacy:${memory.id}:${id}`,kind,text:short(text),source:source?'buyer':'legacy',at:source?.turn.at??at,recordedAt:at,status,scope:'client',...source?{callId:source.call.id,sourceTurnId:source.turn.id,quote:source.turn.text}:{},needsReview:true};
}

/** Memory history call IDs are the only automatic legacy linkage. A repeated
 * typed name is merely a review hint; it never permanently merges clients. */
export function migrateLegacyClientRecords(brain:CompanyBrainRecord,calls:CallRecord[],now=Date.now()):{brain:CompanyBrainRecord;calls:CallRecord[];reviewCount:number}{
 const clients=(brain.clients||[]).map(clone),nextCalls=calls.map(clone);
 const ownedCalls=nextCalls.filter(call=>call.manufacturerId===brain.companyId);
 const candidateByCall=new Map<string,string[]>(),memoryByClient=new Map<string,string[]>();
 for(const memory of brain.buyers){
  const linked=memory.history.map(item=>item.callId).filter(id=>ownedCalls.some(call=>call.id===id));
  // Compatibility buyer memories can be recreated from new canonical calls by
  // Brain history migration. The call's explicit stable association wins; a
  // second provisional client must not be invented for the same relationship.
  const stableClients=[...new Set(linked.flatMap(id=>{const call=ownedCalls.find(row=>row.id===id);return call?.clientId&&clients.some(client=>client.id===call.clientId&&client.companyId===brain.companyId)?[call.clientId]:[];}))];
  if(stableClients.length){
   for(const clientId of stableClients){const client=clients.find(row=>row.id===clientId&&row.companyId===brain.companyId)!;client.callIds=[...new Set([...client.callIds,...linked.filter(id=>ownedCalls.some(call=>call.id===id&&call.clientId===clientId))])];memoryByClient.set(clientId,[...new Set([...(memoryByClient.get(clientId)||[]),memory.id])]);}
   for(const callId of linked){const call=ownedCalls.find(row=>row.id===callId)!,candidates=call.clientId&&stableClients.includes(call.clientId)?[call.clientId]:stableClients;candidateByCall.set(callId,[...new Set([...(candidateByCall.get(callId)||[]),...candidates])]);}
   continue;
  }
  const old=clients.find(client=>client.companyId===brain.companyId&&client.legacy?.buyerMemoryIds.includes(memory.id));
  const id=old?.id||`client:${brain.companyId}:memory:${stableHash(memory.id)}`;
  const client=old||createClientRecord(brain.companyId,memory.name||'Legacy buyer',memory.updatedAt||now,id);
  if(!old){
   const historyRows=linked.map(id=>ownedCalls.find(call=>call.id===id)!);
   const findSource=(turnId:string,quote:string)=>{const matches=historyRows.flatMap(call=>call.turns.filter(turn=>turn.role==='buyer'&&turn.id===turnId&&(!quote||turn.text.includes(quote))).map(turn=>({call,turn})));return matches.length===1?matches[0]:undefined;};
   for(const [key,fact] of Object.entries(memory.facts||{}))if(short(fact.value))client.context.push(legacyEntry(memory,`fact:${key}`,`${key.replace(/_/g,' ')}: ${fact.value}`,'fact',memory.updatedAt||now,'current',findSource(fact.turnId,fact.quote)));
   for(const commitment of memory.commitments||[])client.context.push(legacyEntry(memory,`commitment:${commitment.id}`,`${commitment.action} (legacy status: ${commitment.status}; completion not independently confirmed)`,'commitment',memory.updatedAt||now,commitment.status==='cancelled'?'cancelled':'promised'));
   for(const [index,text] of (memory.decisionsNeeded||[]).entries())client.context.push(legacyEntry(memory,`decision:${index}`,text,'manager_decision',memory.updatedAt||now,'open'));
   client.legacy={buyerMemoryIds:[memory.id],originalLabels:[memory.name],associationStatus:'needs_review',reviewReasons:['Imported from buyer memory. Confirm the client/company identity and contacts; original buyer names and memory records remain preserved.']};
   clients.push(client);
  }
  memoryByClient.set(id,[...(memoryByClient.get(id)||[]),memory.id]);
  for(const callId of linked)candidateByCall.set(callId,[...new Set([...(candidateByCall.get(callId)||[]),id])]);
 }
 for(let index=0;index<nextCalls.length;index++){
  const call=nextCalls[index];if(call.manufacturerId!==brain.companyId)continue;
  if(call.clientId&&clients.some(client=>client.id===call.clientId&&client.companyId===brain.companyId)){const linkedClient=clients.find(client=>client.id===call.clientId)!;linkedClient.callIds=[...new Set([...linkedClient.callIds,call.id])];continue;}
  const candidates=candidateByCall.get(call.id)||[];
  if(candidates.length===1){const client=clients.find(row=>row.id===candidates[0])!;client.callIds=[...new Set([...client.callIds,call.id])];nextCalls[index]={...call,clientId:client.id,legacyClientAssociation:{status:'needs_review',originalBuyer:call.legacyClientAssociation?.originalBuyer||call.buyer,originalManufacturerId:call.manufacturerId,...call.clientId?{originalClientId:call.clientId}:{},...call.contactId?{originalContactId:call.contactId}:{},reviewReasons:['Linked through an explicit buyer-memory history call ID. Confirm client identity and contact attribution.'],candidateClientIds:candidates,memoryIds:memoryByClient.get(client.id)||[]}};}
  else if(candidates.length>1)nextCalls[index]={...call,clientId:undefined,contactId:undefined,legacyClientAssociation:{status:'needs_review',originalBuyer:call.legacyClientAssociation?.originalBuyer||call.buyer,originalManufacturerId:call.manufacturerId,...call.clientId?{originalClientId:call.clientId}:{},...call.contactId?{originalContactId:call.contactId}:{},reviewReasons:['More than one buyer-memory record references this call. Choose its client and contact explicitly.'],candidateClientIds:candidates,memoryIds:candidates.flatMap(id=>memoryByClient.get(id)||[])}};
  else{
   const id=`client:${brain.companyId}:call:${stableHash(call.id)}`;
   let client=clients.find(row=>row.id===id);
   if(!client){client=createClientRecord(brain.companyId,call.buyer||'Legacy unassigned buyer',call.startedAt||now,id);client.legacy={buyerMemoryIds:[],originalLabels:[call.buyer],associationStatus:'needs_review',reviewReasons:['No stable legacy relationship link was found. A matching typed buyer name is not enough to merge calls.']};clients.push(client);}
   client.callIds=[...new Set([...client.callIds,call.id])];nextCalls[index]={...call,clientId:id,legacyClientAssociation:{status:'needs_review',originalBuyer:call.legacyClientAssociation?.originalBuyer||call.buyer,originalManufacturerId:call.manufacturerId,...call.clientId?{originalClientId:call.clientId}:{},...call.contactId?{originalContactId:call.contactId}:{},reviewReasons:['This historical call was retained as a separate client for identity review.'],candidateClientIds:[id]}};
  }
 }
 const labels=new Map<string,ClientRecord[]>();for(const client of clients.filter(row=>row.companyId===brain.companyId)){const name=normalized(client.name);if(name)labels.set(name,[...(labels.get(name)||[]),client]);}
 for(const same of labels.values())if(same.length>1)for(const client of same){if(!client.legacy||client.legacy.associationStatus==='confirmed')continue;client.legacy={buyerMemoryIds:client.legacy?.buyerMemoryIds||[],originalLabels:client.legacy?.originalLabels||[client.name],associationStatus:'needs_review',reviewReasons:[...new Set([...(client.legacy?.reviewReasons||[]),'Another client has the same legacy label. Review identity; these records have not been merged.'])]};}
 const result={...brain,clients,updatedAt:brain.updatedAt};
 return {brain:result,calls:nextCalls,reviewCount:nextCalls.filter(call=>call.manufacturerId===brain.companyId&&call.legacyClientAssociation?.status==='needs_review').length};
}

export type ClientDraftLink={callId?:string;activeId?:string;buyer?:string;clientId?:string;contactId?:string;preparation?:CallPreparationSnapshot;turns?:Turn[];notes?:string};
/** Hydration migration is computed once before persistence. Unfinished drafts
 * get a provisional stable client, never a fabricated completed call. */
export function migrateClientWorkspace<TDraft extends ClientDraftLink>(companies:Manufacturer[],calls:CallRecord[],draft?:TDraft,now=Date.now()):{companies:Manufacturer[];calls:CallRecord[];draft:TDraft|undefined;reviewCount:number}{
 let nextCalls=calls.map(clone),reviewCount=0;
 const nextCompanies=companies.map(company=>{const result=migrateLegacyClientRecords(ensureCompanyBrain(company),nextCalls,now);nextCalls=result.calls;reviewCount+=result.reviewCount;return {...clone(company),brain:result.brain};});
 const nextDraft=draft?clone(draft):undefined;
 if(nextDraft?.callId&&nextDraft.activeId&&(short(nextDraft.buyer)||nextDraft.turns?.length||short(nextDraft.notes))){
  const company=nextCompanies.find(row=>row.id===nextDraft.activeId);
  if(company?.brain){
   let client=company.brain.clients?.find(row=>row.id===nextDraft.clientId&&row.companyId===company.id);
   if(!client){
    const id=`legacy-draft:${company.id}:${nextDraft.callId}`;
    client=company.brain.clients?.find(row=>row.id===id);
    if(!client){client=createClientRecord(company.id,nextDraft.buyer||'Unassigned unfinished call',now,id);client.legacy={buyerMemoryIds:[],originalLabels:[nextDraft.buyer||''],associationStatus:'needs_review',reviewReasons:['This unfinished legacy draft has no confirmed client/contact link. Its original session and buyer label are preserved; review the association before continuing.']};company.brain.clients=[...(company.brain.clients||[]),client];reviewCount++;}
    nextDraft.clientId=client.id;nextDraft.contactId=undefined;nextDraft.preparation=undefined;
   }else if(nextDraft.contactId&&!client.contacts.some(contact=>contact.id===nextDraft.contactId&&contact.companyId===company.id&&contact.clientId===nextDraft.clientId)){nextDraft.contactId=undefined;nextDraft.preparation=undefined;}
  }
 }
 return {companies:nextCompanies,calls:nextCalls,draft:nextDraft,reviewCount};
}

/** Merge backup client records by stable IDs only. Names are never identity
 * keys. Union records keep source metadata and unknown forward-compatible fields. */
export function mergeClientRecords(local:ClientRecord,incoming:ClientRecord):ClientRecord{
 if(local.companyId!==incoming.companyId)throw Error('Client records cannot merge across selling companies.');
 if(local.id!==incoming.id)throw Error('Different client IDs cannot be merged implicitly, even when names match.');
 const winner=incoming.updatedAt>local.updatedAt?incoming:local,older=winner===incoming?local:incoming;
 const mergeRows=<T extends {id:string}>(one:T[],two:T[],time:(row:T)=>number):T[]=>{
  const rows=new Map(one.map(row=>[row.id,clone(row)]));
  for(const row of two){const prior=rows.get(row.id);if(!prior)rows.set(row.id,clone(row));else{const newer=time(row)>=time(prior)?row:prior,old=newer===row?prior:row;rows.set(row.id,{...clone(old),...clone(newer)});}}
  return [...rows.values()];
 };
 const contacts=mergeRows(older.contacts,winner.contacts,row=>row.updatedAt||0);
 for(const contact of contacts)if(contact.companyId!==local.companyId||contact.clientId!==local.id)throw Error('A backup contact belongs to another client or company.');
 const projects=mergeRows(older.projects||[],winner.projects||[],row=>row.updatedAt||0);
 for(const project of projects)if(project.companyId!==local.companyId||project.clientId!==local.id)throw Error('A backup project belongs to another client or company.');
 const context=mergeRows(older.context,winner.context,row=>row.updatedAt??row.recordedAt??row.at);
 const entries=new Map(context.map(row=>[row.id,row]));
 for(const replacement of context){
  if(!replacement.supersedesId)continue;
  const prior=entries.get(replacement.supersedesId);
  if(prior&&prior.scope===replacement.scope&&prior.contactId===replacement.contactId&&(!prior.supersededById||prior.supersededById===replacement.id||(replacement.updatedAt??replacement.recordedAt)>=(entries.get(prior.supersededById)?.updatedAt??entries.get(prior.supersededById)?.recordedAt??0))){prior.status='superseded';prior.supersededById=replacement.id;prior.updatedAt=Math.max(prior.updatedAt??0,replacement.updatedAt??replacement.recordedAt);}
 }
 for(const entry of context)if(entry.projectId&&!projects.some(project=>project.id===entry.projectId))throw Error('A backup update references a project outside this client.');
 for(const entry of context)if(entry.scope==='contact'&&(!entry.contactId||!contacts.some(contact=>contact.id===entry.contactId)))throw Error('A backup update references a contact outside this client.');
 const newerLegacy=winner.legacy||older.legacy,olderLegacy=older.legacy;
 const legacy=newerLegacy?{...clone(olderLegacy||newerLegacy),...clone(newerLegacy),buyerMemoryIds:[...new Set([...(olderLegacy?.buyerMemoryIds||[]),...newerLegacy.buyerMemoryIds])],originalLabels:[...new Set([...(olderLegacy?.originalLabels||[]),...newerLegacy.originalLabels])],reviewReasons:newerLegacy.associationStatus==='confirmed'?[]:[...new Set([...(olderLegacy?.reviewReasons||[]),...newerLegacy.reviewReasons])]}:undefined;
 const merged={...clone(older),...clone(winner),id:local.id,companyId:local.companyId,contacts,...projects.length?{projects}:{},context,callIds:[...new Set([...local.callIds,...incoming.callIds])],createdAt:Math.min(local.createdAt,incoming.createdAt),updatedAt:Math.max(local.updatedAt,incoming.updatedAt),...legacy?{legacy}:{}};
 const summaries=[local.currentSummary,incoming.currentSummary].filter((summary):summary is NonNullable<ClientRecord['currentSummary']>=>!!summary).sort((a,b)=>b.at-a.at||b.reviewedAt-a.reviewedAt);
 if(summaries[0])merged.currentSummary=clone(summaries[0]);
 const categoryTime=(client:ClientRecord)=>client.categoryUpdatedAt??0;
 const categoryOwner=categoryTime(incoming)>categoryTime(local)?incoming:categoryTime(local)>categoryTime(incoming)?local:winner;
 if(categoryOwner.category!==undefined)merged.category=categoryOwner.category;else delete merged.category;
 if(categoryOwner.categoryUpdatedAt!==undefined)merged.categoryUpdatedAt=categoryOwner.categoryUpdatedAt;
 const removalTime=(client:ClientRecord)=>client.removalUpdatedAt??client.removedAt??0;
 // Equal-time conflicts keep removal; restoration must be an explicit later
 // action. Unrelated profile edits do not count as restoring a removed client.
 const lifecycle=removalTime(incoming)>removalTime(local)?incoming:removalTime(local)>removalTime(incoming)?local:local.removedAt!==undefined?local:incoming;
 if(lifecycle.removedAt!==undefined)merged.removedAt=lifecycle.removedAt;else delete merged.removedAt;
 if(lifecycle.removalUpdatedAt!==undefined)merged.removalUpdatedAt=lifecycle.removalUpdatedAt;else delete merged.removalUpdatedAt;
 return merged;
}
export function mergeCompanyClientRecords(companyId:string,local:ClientRecord[]=[],incoming:ClientRecord[]=[]):ClientRecord[]{
 const rows=new Map<string,ClientRecord>();
 for(const client of [...local,...incoming]){assertCompany(client,companyId);const prior=rows.get(client.id);rows.set(client.id,prior?mergeClientRecords(prior,client):clone(client));}
 return [...rows.values()];
}
