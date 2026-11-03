import type {Manufacturer} from './trade';
import type {CompanyBrainRecord} from './company-brain';
import type {StageDefinition} from './call-purpose';
import {defaultConfigurationStages} from './sales-curriculum.ts';

export type ConfigurationScope='company'|'stage';
export type ConfigurationKnowledge={id:string;kind:'identity'|'product'|'specification'|'strength'|'commercial_term'|'other';text:string;origin:'manager'|'document'|'legacy';status:'active'|'archived'|'pending_review';sourceId?:string;quote?:string;conditions?:string;units?:string;effectiveDate?:string;updatedAt:number};
export type ConfigurationStage={id:string;name:string;objective:string;playbook:string;informationToBringBack:string[];retired:boolean;channel?:StageDefinition['channel'];legacy?:StageDefinition};
export type ConfigurationAction='sample'|'discount'|'price_match'|'payment_terms'|'delivery_promise'|'commercial_promise'|'claim'|'other';
export type ConfigurationBoundary={id:string;text:string;authority:'allowed'|'approval_required'|'prohibited';scope:ConfigurationScope;stageId?:string;condition?:string;action?:ConfigurationAction;status:'active'|'archived';origin:'manager'|'legacy'};
export type ConfigurationPreference={id:string;text:string;scope:ConfigurationScope;stageId?:string;origin:'manager'|'legacy'};
export type ConfigurationContent={knowledge:ConfigurationKnowledge[];stages:ConfigurationStage[];boundaries:ConfigurationBoundary[];preferences:ConfigurationPreference[];legacyNotes:string[]};
export type ConfigurationVersion=ConfigurationContent&{id:string;companyId:string;version:number;activatedAt:number};
export type ConfigurationDraft=ConfigurationContent&{id:string;companyId:string;baseVersionId:string;savedAt:number};
export type CompanyConfiguration={schemaVersion:1;companyId:string;active:ConfigurationVersion;draft?:ConfigurationDraft;versions:ConfigurationVersion[];teaching?:import('./company-teaching').TeachingProposal[]};
export type ConfigurationConflict={id:string;severity:'error'|'warning';message:string;recordIds:string[];section:'knowledge'|'selling'|'boundaries'|'configuration'};
export type ConfigurationChange={section:'knowledge'|'selling'|'boundaries'|'preferences';id:string;label:string;before?:string;after?:string};
export type ConfigurationReview={changes:ConfigurationChange[];conflicts:ConfigurationConflict[];canApply:boolean};
export type CallConfigurationBinding={companyId:string;versionId:string;version:number;boundAt:number;selectedStageId:string;snapshot:ConfigurationVersion};

const clone=<T>(value:T):T=>structuredClone(value);
const content=(value:ConfigurationContent):ConfigurationContent=>({knowledge:clone(value.knowledge),stages:clone(value.stages),boundaries:clone(value.boundaries),preferences:clone(value.preferences),legacyNotes:clone(value.legacyNotes)});
const rowId=(companyId:string,id:string)=>`${companyId}:${id}`;
const stableHash=(value:string)=>{let one=2166136261,two=5381;for(const character of value){one=Math.imul(one^character.charCodeAt(0),16777619);two=Math.imul(two,33)^character.charCodeAt(0);}return `${(one>>>0).toString(36)}${(two>>>0).toString(36)}`;};
export const TECHNICAL_EVALUATION_STAGE:ConfigurationStage={id:'technical_evaluation',name:'Technical evaluation',objective:'Understand the buyer’s application and evaluation criteria, resolve technical questions from supported information, and agree an appropriate evaluation step.',playbook:'Use what the buyer has already shared. Clarify the technical decision or failed test before proposing another evaluation. Explain supported fit and limitations; send relevant technical information when useful or requested. Do not repeat cold-call introductions or force an email request. Samples and commercial terms remain subject to company boundaries.',informationToBringBack:['Application and operating conditions','Required specifications and evaluation criteria','Test results or unresolved technical questions','People involved in approval','Agreed next step and decisions needed'],retired:false,channel:'call/email'};


export function stageFromLegacy(stage:StageDefinition):ConfigurationStage{return {id:stage.id,name:stage.name,objective:stage.purpose,playbook:[...stage.give.map(item=>`Useful move: ${item}`),...stage.hold.map(item=>`Limit: ${item}`),stage.exitCriteria?`Stage outcome: ${stage.exitCriteria}`:''].filter(Boolean).join('\n'),informationToBringBack:clone(stage.extract),retired:false,channel:stage.channel,legacy:clone(stage)};}

/** Legacy field names are not authority semantics: “neverPromise” often means
 * “do not promise unapproved terms”, not an absolute ban on approved offers.
 * Preserve the entire condition, and keep explicit unconditional bans strict. */
export function legacyBoundaryAuthority(key:'neverInvent'|'neverPromise'|'promiseThreshold'|'escalateThreshold',text:string):ConfigurationBoundary['authority']{
 if(key==='neverInvent')return 'prohibited';
 const line=text.replace(/[’‘]/g,"'");
 if(/\b(?:even (?:if|when) (?:approved|authorized|authorised)|regardless of (?:approval|authorization)|under (?:any|no) circumstances|absolute(?:ly)? (?:ban|prohibition))\b/i.test(line))return 'prohibited';
 const conditionalApproval=/\b(?:unapproved|unauthorized|unauthorised|requires? (?:prior |manager |written )?approval|approval (?:is )?required|subject to (?:prior |manager |written )?approval)\b|\b(?:without|unless|until|only (?:if|when|after))\b.{0,100}\b(?:approv(?:e|es|ed|al)|authoriz(?:e|es|ed|ation)|authoris(?:e|es|ed|ation))\b/i.test(line);
 return conditionalApproval||key==='promiseThreshold'||key==='escalateThreshold'?'approval_required':'prohibited';
}

/** Migration is lossless for source records and historical Brain records. A raw
 * upload is retained for review, not silently promoted into factual authority. */
export function ensureCompanyConfiguration(company:Manufacturer,brain:CompanyBrainRecord|undefined=company.brain):CompanyConfiguration{
 const existing=brain?.configuration;
 if(existing?.schemaVersion===1&&existing.companyId===company.id&&existing.active?.companyId===company.id)return clone(existing);
 const sources=[...(company.introduction?[{id:'company-profile',text:company.introduction}]:[]),...company.sources];
 const facts=brain?.identityFacts||[];
 const knowledge:ConfigurationKnowledge[]=facts.map(fact=>({id:rowId(company.id,`fact:${fact.id}`),kind:fact.kind,text:fact.text,origin:fact.sourceId?'document':'legacy',status:fact.confirmed&&!!fact.quote&&sources.some(source=>source.id===fact.sourceId&&source.text.includes(fact.quote))?'active':'pending_review',...fact.sourceId?{sourceId:fact.sourceId}:{},...fact.quote?{quote:fact.quote}:{},updatedAt:brain?.updatedAt||0}));
 for(const source of sources)knowledge.push({id:rowId(company.id,`legacy-source:${source.id}`),kind:'other',text:source.text,origin:'legacy',status:'pending_review',sourceId:source.id,updatedAt:brain?.updatedAt||0});
 if(company.products)knowledge.push({id:rowId(company.id,'legacy-products'),kind:'product',text:company.products,origin:'legacy',status:'pending_review',updatedAt:brain?.updatedAt||0});
 const oldStages=brain?.playbook.stages?.length?brain.playbook.stages:company.stageMap;
 const stages=oldStages?.length?oldStages.map(stageFromLegacy):defaultConfigurationStages();
 if(!stages.some(stage=>stage.id===TECHNICAL_EVALUATION_STAGE.id))stages.push(clone(TECHNICAL_EVALUATION_STAGE));
 const rules=brain?.rules;
 const boundaries:ConfigurationBoundary[]=rules?(['neverInvent','neverPromise','promiseThreshold','escalateThreshold'] as const).filter(key=>rules[key]?.trim()).map(key=>{const authority=legacyBoundaryAuthority(key,rules[key]);return {id:rowId(company.id,`legacy-rule:${key}`),text:rules[key],authority,...authority==='approval_required'?{condition:rules[key]}:{},scope:'company',status:'active',origin:'legacy',action:key==='neverInvent'?'claim':'commercial_promise'};}):[];
 const preferences:ConfigurationPreference[]=[];
 if(rules?.tone)preferences.push({id:rowId(company.id,'legacy-tone'),text:rules.tone,scope:'company',origin:'legacy'});
 if(rules?.phrasesToAvoid)preferences.push({id:rowId(company.id,'legacy-phrases'),text:`Phrases to avoid: ${rules.phrasesToAvoid}`,scope:'company',origin:'legacy'});
 for(const [moment,move] of Object.entries(brain?.playbook.moves||{}))if(move.trim())preferences.push({id:rowId(company.id,`legacy-move:${moment}`),text:`Legacy moment ${moment}: ${move}`,scope:'company',origin:'legacy'});
 if(brain?.playbook.defaultOpening)preferences.push({id:rowId(company.id,'legacy-opening'),text:`Opening preference (use only when an opening fits): ${brain.playbook.defaultOpening}`,scope:'company',origin:'legacy'});
 const active:ConfigurationVersion={id:rowId(company.id,'configuration:1'),companyId:company.id,version:1,activatedAt:brain?.updatedAt||0,knowledge,stages,boundaries,preferences,legacyNotes:['Migrated company settings, rules and stage IDs are preserved. Legacy information with uncertain approval is pending review; original documents, corrections, buyer memories and call history remain unchanged.']};
 return {schemaVersion:1,companyId:company.id,active,versions:[clone(active)]};
}

export function startConfigurationDraft(configuration:CompanyConfiguration,now=Date.now()):CompanyConfiguration{
 if(configuration.draft)return clone(configuration);
 return {...clone(configuration),draft:{id:`${configuration.companyId}:draft:${configuration.active.version+1}`,companyId:configuration.companyId,baseVersionId:configuration.active.id,savedAt:now,...content(configuration.active)}};
}
export function saveConfigurationDraft(configuration:CompanyConfiguration,draft:ConfigurationDraft,now=Date.now()):CompanyConfiguration{
 if(draft.companyId!==configuration.companyId)throw new Error('A draft cannot be saved to another company.');
 if(draft.baseVersionId!==configuration.active.id)throw new Error('This draft was based on an older active version. Review it against the current version before saving.');
 return {...clone(configuration),draft:{...clone(draft),savedAt:now}};
}
export function discardConfigurationDraft(configuration:CompanyConfiguration):CompanyConfiguration{const next=clone(configuration);delete next.draft;return next;}

export function configurationActionFor(text:string):ConfigurationAction|undefined{
 const line=text.toLowerCase();
 if(/\b(?:sample|samples|sampling)\b/.test(line))return 'sample';
 if(/\b(?:match|matching)\b.{0,35}\bprice|\bprice.{0,35}\b(?:match|matching)\b/.test(line))return 'price_match';
 if(/\b(?:discount|discounts|concession|concessions)\b/.test(line))return 'discount';
 if(/\b(?:payment|credit terms|net \d+|days? terms)\b/.test(line))return 'payment_terms';
 if(/\b(?:delivery|deliver|ship|shipping|lead time|deadline)\b/.test(line))return 'delivery_promise';
 if(/\b(?:promise|commercial|commitment|approval|approved|authorize|authorised|authorized)\b/.test(line))return 'commercial_promise';
 if(/\b(?:claim|invent|fact|specification|certification)\b/.test(line))return 'claim';
 return undefined;
}
const safetyQualified=(line:string)=>/\b(?:do not|don't|never|must not|not (?:offer|promise|provide))\b/i.test(line)||/\b(?:approved|authorized|authorised) (?:sample|terms|price|offer)|\b(?:requires? (?:prior )?approval|subject to (?:manager |company |prior )?approval)|\b(?:only (?:if|when|after)|if|after|when)\b.{0,60}\b(?:approv(?:e|es|ed|al)|authoriz(?:e|es|ed|ation)|authoris(?:e|es|ed|ation))\b/i.test(line);
const respectsRestriction=(line:string,boundary:ConfigurationBoundary)=>/\b(?:do not|don't|never|must not|not (?:offer|promise|provide))\b/i.test(line)||boundary.authority==='approval_required'&&safetyQualified(line);
const offerIntent=(line:string)=>/\b(?:offer|provide|give|send|promise|guarantee|commit|arrange|include|authorize|allow|approve|match|discount)\b/i.test(line);
const sameAction=(one:ConfigurationAction|undefined,two:ConfigurationAction|undefined)=>!!one&&!!two&&(one===two||one==='commercial_promise'||two==='commercial_promise');

/** Conservative structural conflict review, not a claim to understand arbitrary
 * natural language. Full text is retained and managers review unresolved cases. */
export function configurationConflicts(value:ConfigurationContent,companyId?:string):ConfigurationConflict[]{
 const conflicts:ConfigurationConflict[]=[];
 const add=(section:ConfigurationConflict['section'],message:string,recordIds:string[],severity:ConfigurationConflict['severity']='error')=>conflicts.push({id:`${section}:${recordIds.join(':')}:${conflicts.length}`,severity,message,recordIds,section});
 const ids=new Set<string>();
 for(const [section,rows] of [['knowledge',value.knowledge],['selling',value.stages],['boundaries',value.boundaries],['preferences',value.preferences]] as const)for(const row of rows){if(!row.id?.trim())add('configuration','Every saved record needs a stable ID.',[], 'error');else if(ids.has(row.id))add('configuration','Two records share an ID; keep one stable ID per record.',[row.id]);ids.add(row.id);if(section!=='preferences'&&'text'in row&& !row.text.trim())add(section, 'An instruction or knowledge entry is empty.',[row.id]);}
 if(!value.stages.some(stage=>!stage.retired))add('selling','At least one sales stage must remain available.',[]);
 for(const stage of value.stages){if(!stage.name.trim()||!stage.objective.trim())add('selling','A stage needs a name and objective.',[stage.id]);}
 for(const item of value.knowledge){if(item.status==='active'&&item.origin==='document'&&(!item.sourceId||!item.quote))add('knowledge','A document-derived active fact needs a source and quotation. Use manager-provided origin for a direct manager entry.',[item.id]);if(item.status==='active'&&item.origin==='legacy')add('knowledge','Legacy information needs explicit review. Change its origin to manager-provided after confirming it, or retain a supporting document quotation.',[item.id]);}
 const active=value.boundaries.filter(row=>row.status==='active');
 for(const row of [...active,...value.preferences])if(row.scope==='stage'&&(!row.stageId||!value.stages.some(stage=>stage.id===row.stageId)))add('boundaries','A stage-scoped instruction needs an existing stage.',[row.id]);
 for(const boundary of active){if(!boundary.text.trim())continue;if(boundary.authority==='allowed'&&!boundary.action&&!configurationActionFor(boundary.text))add('boundaries','Clarify what this permission authorizes before applying it.',[boundary.id]);}
 for(const allowed of active.filter(row=>row.authority==='allowed'))for(const limit of active.filter(row=>row.authority!=='allowed')){
  const overlap=limit.scope==='company'||allowed.scope==='company'||allowed.stageId===limit.stageId;
  if(overlap&&sameAction(allowed.action||configurationActionFor(allowed.text),limit.action||configurationActionFor(limit.text))&&!respectsRestriction(allowed.text,limit))add('boundaries',`A permission conflicts with a ${limit.authority==='prohibited'?'prohibition':'required approval'}. Resolve the scope or condition explicitly; an allowance cannot silently override the limit.`,[allowed.id,limit.id]);
 }
 for(const stage of value.stages.filter(row=>!row.retired))for(const limit of active.filter(row=>row.authority!=='allowed'&&(row.scope==='company'||row.stageId===stage.id))){
  const action=limit.action||configurationActionFor(limit.text);
  for(const sentence of stage.playbook.split(/\n|;|(?<=[.!?])\s+/).filter(Boolean))if(offerIntent(sentence)&&sameAction(configurationActionFor(sentence),action)&&!respectsRestriction(sentence,limit))add('selling',`“${stage.name}” proposes an action restricted by a ${limit.scope==='company'?'company-wide':'stage'} boundary. Keep the restriction explicit or change the boundary after authorization.`,[stage.id,limit.id]);
 }
 void companyId;
 return conflicts;
}

export function reviewConfigurationDraft(configuration:CompanyConfiguration):ConfigurationReview{
 const draft=configuration.draft;if(!draft)return {changes:[],conflicts:[],canApply:false};
 const changes:ConfigurationChange[]=[];
 for(const [section,key] of [['knowledge','knowledge'],['selling','stages'],['boundaries','boundaries'],['preferences','preferences']] as const){
  const before=configuration.active[key],after=draft[key];
  for(const row of after){const prior=before.find(item=>item.id===row.id);if(JSON.stringify(prior)!==JSON.stringify(row))changes.push({section,id:row.id,label:'name'in row?row.name:row.text.slice(0,100),...prior?{before:JSON.stringify(prior,null,2)}:{},after:JSON.stringify(row,null,2)});}
  for(const row of before)if(!after.some(item=>item.id===row.id))changes.push({section,id:row.id,label:'name'in row?row.name:row.text.slice(0,100),before:JSON.stringify(row,null,2)});
 }
 const conflicts=configurationConflicts(draft,configuration.companyId);
 if(draft.baseVersionId!==configuration.active.id)conflicts.push({id:'stale-draft',severity:'error',section:'configuration',message:'The active version changed after this draft was started. Review the newer configuration before applying.',recordIds:[]});
 // Deletion would destroy stable stage references. Retire instead.
 for(const stage of configuration.active.stages)if(!draft.stages.some(item=>item.id===stage.id))conflicts.push({id:`stage-delete:${stage.id}`,severity:'error',section:'selling',message:`Retire “${stage.name}” instead of deleting its stable stage ID; historical calls still refer to it.`,recordIds:[stage.id]});
 return {changes,conflicts,canApply:changes.length>0&&!conflicts.some(row=>row.severity==='error')};
}
export function applyConfigurationDraft(configuration:CompanyConfiguration,now=Date.now(),company?:Manufacturer):{configuration:CompanyConfiguration;applied:boolean;conflicts:ConfigurationConflict[]}{
 const review=reviewConfigurationDraft(configuration);
 if(company&&configuration.draft){review.conflicts.push(...configurationDocumentConflicts(configuration.draft,company));if(review.conflicts.some(row=>row.severity==='error'))review.canApply=false;}
 if(!review.canApply||!configuration.draft)return {configuration:clone(configuration),applied:false,conflicts:review.conflicts};
 const active:ConfigurationVersion={...content(configuration.draft),id:`${configuration.companyId}:configuration:${configuration.active.version+1}`,companyId:configuration.companyId,version:configuration.active.version+1,activatedAt:now};
 const next={...clone(configuration),active,versions:[...configuration.versions.filter(row=>row.id!==active.id).map(clone),clone(active)]};delete next.draft;
 return {configuration:next,applied:true,conflicts:review.conflicts};
}
export function resolveConfiguration(company:Manufacturer,versionId?:string):ConfigurationVersion{
 const configuration=ensureCompanyConfiguration(company);
 if(!versionId)return clone(configuration.active);
 const snapshot=configuration.versions.find(row=>row.id===versionId)|| (configuration.active.id===versionId?configuration.active:undefined);
 if(!snapshot)throw new Error('That configuration version does not belong to this company.');
 return clone(snapshot);
}
export function configurationReferences(version:ConfigurationVersion):{id:string;title:string;text:string;origin:ConfigurationKnowledge['origin'];knowledgeId:string;quote?:string}[]{
 return version.knowledge.filter(row=>row.status==='active'&&(row.origin==='manager'||row.origin==='document'&&!!row.sourceId&&!!row.quote)).map(row=>({id:`cfg:${stableHash(version.id+'|'+row.id)}`,title:row.origin==='manager'?'Manager-provided company information':'Approved company information',text:[row.text,row.units?`Units: ${row.units}`:'',row.conditions?`Conditions: ${row.conditions}`:'',row.effectiveDate?`Effective date: ${row.effectiveDate}`:''].filter(Boolean).join('\n'),origin:row.origin,knowledgeId:row.id,...row.quote?{quote:row.quote}:{}}));
}
export function configurationStageMap(version:ConfigurationVersion,options:{includeRetired?:boolean}={}):StageDefinition[]{return version.stages.filter(stage=>options.includeRetired||!stage.retired).map(stage=>({id:stage.id,name:stage.name,channel:stage.channel||'call/email',purpose:stage.objective,extract:clone(stage.informationToBringBack),give:stage.playbook.split('\n').filter(Boolean),hold:version.boundaries.filter(row=>row.status==='active'&&row.authority!=='allowed'&&(row.scope==='company'||row.stageId===stage.id)).map(row=>[row.text,row.condition?`Condition: ${row.condition}`:''].filter(Boolean).join(' ')),exitCriteria:stage.legacy?.exitCriteria||'The manager-defined objective, information learned, unresolved decisions and mutually agreed next action are accurately recorded.'}));}
/** A call retains the approved knowledge it can actually use, not another copy
 * of the entire document-review inbox. Keep full active facts, provenance, units,
 * conditions and dates; the complete manager configuration and version history
 * remain untouched in Company Brain. Existing saved bindings are not rewritten. */
export function compactCallConfigurationSnapshot(version:ConfigurationVersion):ConfigurationVersion{
 const snapshot=clone(version);
 snapshot.knowledge=snapshot.knowledge.filter(row=>row.status==='active'&&(row.origin==='manager'||row.origin==='document'&&!!row.sourceId&&!!row.quote));
 return snapshot;
}

/** Project an existing binding for a request without mutating the historical
 * stored call. Version identity and applicable manager instructions stay exact. */
export function compactCallConfigurationBinding(binding:CallConfigurationBinding):CallConfigurationBinding{
 return {...clone(binding),snapshot:compactCallConfigurationSnapshot(binding.snapshot)};
}

export function bindCompanyConfiguration(company:Manufacturer,selectedStageId:string,existing?:CallConfigurationBinding,now=Date.now()):CallConfigurationBinding{
 if(existing){if(existing.companyId!==company.id||existing.snapshot.companyId!==company.id)throw new Error('A call configuration cannot cross companies.');return clone(existing);}
 const snapshot=resolveConfiguration(company),stage=snapshot.stages.find(row=>row.id===selectedStageId);
 if(!stage||stage.retired)throw new Error('Choose an available sales stage before starting this call.');
 return compactCallConfigurationBinding({companyId:company.id,versionId:snapshot.id,version:snapshot.version,boundAt:now,selectedStageId:stage.id,snapshot});
}

/** Validate newly applied document-derived facts against real uploaded records,
 * while direct manager entries retain honest manager-provided provenance. */
export function configurationDocumentConflicts(value:ConfigurationContent,company:Manufacturer):ConfigurationConflict[]{
 const sources=[...(company.introduction?[{id:'company-profile',text:company.introduction}]:[]),...company.sources];
 return value.knowledge.filter(row=>row.status==='active'&&row.origin==='document'&&(!row.quote||!sources.some(source=>source.id===row.sourceId&&source.text.includes(row.quote!)))).map(row=>({id:`source:${row.id}`,severity:'error',section:'knowledge',message:'This document quotation does not match the referenced company source. Correct its source/quotation, or record a direct manager-provided entry after confirming it.',recordIds:[row.id]}));
}

/** New or edited raw documents become inactive draft review items. Existing
 * approved knowledge and active call snapshots stay intact until Apply. */
export function syncConfigurationDocuments(configuration:CompanyConfiguration,company:Manufacturer,now=Date.now()):CompanyConfiguration{
 if(configuration.companyId!==company.id)throw new Error('Company documents cannot cross configuration boundaries.');
 const sources=[...(company.introduction?[{id:'company-profile',text:company.introduction}]:[]),...company.sources];
 let next=clone(configuration);
 for(const source of sources){
  const rows=next.draft?.knowledge||next.active.knowledge;
  if(rows.some(row=>row.sourceId===source.id&&row.text===source.text))continue;
  next=startConfigurationDraft(next,now);
  const draft=next.draft!;
  const id=rowId(company.id,`document-review:${source.id}:${stableHash(source.text)}`);
  if(!draft.knowledge.some(row=>row.id===id))draft.knowledge.push({id,kind:'other',text:source.text,origin:'legacy',status:'pending_review',sourceId:source.id,updatedAt:now});
  draft.savedAt=now;
 }
 return next;
}
