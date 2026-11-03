import {configurationActionFor,configurationConflicts,startConfigurationDraft,saveConfigurationDraft,type CompanyConfiguration,type ConfigurationScope,type ConfigurationKnowledge,type ConfigurationStage,type ConfigurationBoundary,type ConfigurationPreference,type ConfigurationConflict} from './company-configuration.ts';

export type RefinementDestination='knowledge'|'selling'|'boundaries'|'preferences';
export type RefinementChange={id:string;destination:RefinementDestination;scope:ConfigurationScope;stageId?:string;operation:'add'|'update';record:ConfigurationKnowledge|ConfigurationStage|ConfigurationBoundary|ConfigurationPreference};
export type ConfigurationRefinement={id:string;originalText:string;interpretation:string;changes:RefinementChange[];conflicts:ConfigurationConflict[];requiresClarification:boolean;questions:string[]};
export type RefinementTarget={section?:RefinementDestination;stageId?:string;scope?:ConfigurationScope;recordId?:string};
const fieldFor={knowledge:'knowledge',selling:'stages',boundaries:'boundaries',preferences:'preferences'} as const;
const clone=<T>(value:T):T=>structuredClone(value);
const replaceInPlace=<T extends {id:string}>(rows:T[],record:T):T[]=>rows.some(row=>row.id===record.id)?rows.map(row=>row.id===record.id?clone(record):row):[...rows,clone(record)];
const idFor=(companyId:string,text:string,now:number)=>{let hash=0;for(const char of text)hash=(Math.imul(hash,31)+char.charCodeAt(0))|0;return `${companyId}:refinement:${now}:${(hash>>>0).toString(36)}`;};
const boundaryLanguage=(text:string)=>/\b(?:do not|don't|must not|never|not allowed|may not|cannot promise|can't promise|requires? approval|approval required|approval (?:before|first)|only (?:if|when|after) approved|permitted|authorized to|allowed to)\b|不得|禁止|不能承诺|不可承诺|需要批准|必须批准|允许/i.test(text);
const stageLanguage=(text:string)=>/\b(?:during|in|at|for) (?:the )?(?:technical (?:evaluation|review)|negotiation|cold[ -]call|follow[ -]up|closing) (?:stage|call|meeting)\b/i.test(text);

/** A transparent draft assistant: it proposes a destination and preserves the
 * manager's whole instruction. Routing labels never replace negation,
 * exceptions or conditions, and uncertainty is returned for human correction. */
export function proposeConfigurationRefinement(configuration:CompanyConfiguration,text:string,target:RefinementTarget={},now=Date.now()):ConfigurationRefinement{
 const originalText=text.trim(),id=idFor(configuration.companyId,originalText,now),questions:string[]=[];
 let destination=target.section;
 if(!destination){
  if(boundaryLanguage(originalText))destination='boundaries';
  else if(target.stageId)destination='selling';
  else if(/\b(?:tone|prefer|wording|concise|conversational|friendly|phrase)\b|语气|措辞|简洁|自然|先理解|应该先/i.test(originalText))destination='preferences';
  else if(/\b(?:we (?:supply|manufacture|produce|offer|are)|our (?:product|company|factory)|specification|composition|certification)\b|我们(?:供应|生产|提供)|我们公司|我们的产品|规格|认证/i.test(originalText))destination='knowledge';
  else questions.push('Should this change company knowledge, a stage playbook, a mandatory boundary, or a selling preference?');
 }
 const current=configuration.draft||configuration.active;
 const existing=destination&&target.recordId?(current[fieldFor[destination]] as RefinementChange['record'][]).find(row=>row.id===target.recordId):undefined;
 if(target.recordId&&!existing)questions.push('The instruction selected for replacement is unavailable in this destination. Choose it again.');
 const stage=target.stageId?current.stages.find(row=>row.id===target.stageId):undefined;
 if(target.stageId&&!stage)questions.push('Choose an existing sales stage for this instruction.');
 if(destination==='selling'&&!stage)questions.push('Which sales stage should receive this objective or playbook change?');
 if(!target.scope&&!target.stageId&&stageLanguage(originalText))questions.push('This instruction appears stage-specific. Choose its stage and scope before saving.');
 if(!originalText)questions.push('Describe the change in your own words first.');
 const scope:ConfigurationScope=target.scope||(target.stageId?'stage':'company');
 if(scope==='stage'&&!stage)questions.push('A stage-scoped instruction needs a selected stage.');
 const changes:RefinementChange[]=[];
 if(destination&&originalText&&!questions.length){
  let record:RefinementChange['record'];
  if(destination==='knowledge')record={...existing,id:existing?.id||id,kind:'other',text:originalText,origin:'manager',status:'active',sourceId:undefined,quote:undefined,updatedAt:now};
  else if(destination==='selling'&&stage)record={...clone(stage),playbook:target.recordId?originalText:[...new Set([stage.playbook,originalText].filter(Boolean))].join('\n')};
  else if(destination==='boundaries'){
   const approval=/\b(?:approval|approv(?:e|es|ed|al)|authoriz(?:e|es|ed|ation)|authoris(?:e|es|ed|ation))\b|批准|审批|授权/i.test(originalText);
   const negative=/\b(?:do not|don't|must not|never|not allowed|may not|cannot|can't|prohibited)\b|不得|禁止|不能|不可|不允许/i.test(originalText);
   const allowed=/\b(?:allowed|permitted|authorized|authorised|can offer|may offer|may provide|can provide)\b|允许|可以提供|可以发送/i.test(originalText);
   if(!negative&&!approval&&!allowed)questions.push('Is this action permitted, subject to approval, or prohibited?');
   const conditional=/\b(?:until|unless|except|provided that|only if|only when|after|before|if)\b/i.test(originalText);
   const action=configurationActionFor(originalText);
   record={...existing,id:existing?.id||id,text:originalText,authority:approval?'approval_required':negative?'prohibited':'allowed',scope,stageId:scope==='stage'?stage?.id:undefined,...conditional?{condition:originalText}:{},...action?{action}:{},status:'active',origin:'manager'};
  }else record={...existing,id:existing?.id||id,text:originalText,scope,stageId:scope==='stage'?stage?.id:undefined,origin:'manager'};
  if(!questions.length)changes.push({id,destination,scope,...scope==='stage'&&stage?{stageId:stage.id}:{},operation:destination==='selling'||existing?'update':'add',record});
 }
 const draft=clone(current);
 for(const change of changes){const field=fieldFor[change.destination];(draft[field] as RefinementChange['record'][]) = replaceInPlace(draft[field] as RefinementChange['record'][],change.record);}
 const conflicts=changes.length?configurationConflicts(draft,configuration.companyId):[];
 return {id,originalText,interpretation:changes.length?`Add the complete instruction to ${destination==='selling'?`the “${stage?.name}” stage playbook`:destination==='knowledge'?'manager-provided company knowledge':destination==='boundaries'?`${scope==='company'?'company-wide':'stage-specific'} mandatory boundaries`:'selling preferences'}. Review the text, authority, conditions and scope before adding it to the draft.`:'Choose the destination or scope so TradeAssist does not guess at a material instruction.',changes,conflicts,requiresClarification:questions.length>0,questions:[...new Set(questions)]};
}

/** A reviewed proposal saves to the draft only. The normal review-and-Apply gate
 * independently recomputes conflicts, including edits made in the proposal UI. */
export function saveConfigurationRefinement(configuration:CompanyConfiguration,proposal:ConfigurationRefinement,now=Date.now()):CompanyConfiguration{
 if(!proposal.changes.length)throw new Error('Resolve the proposal’s destination and scope before saving it to the draft.');
 const next=startConfigurationDraft(configuration,now),draft=clone(next.draft!);
 for(const change of proposal.changes){
  const field=fieldFor[change.destination];
  if(!field||!change.record.id)throw new Error('Each proposed change needs a valid destination and stable record ID.');
  if(change.scope==='stage'&&(!change.stageId||!draft.stages.some(stage=>stage.id===change.stageId)))throw new Error('Choose a valid stage before saving a stage-scoped proposal.');
  const rows=draft[field] as RefinementChange['record'][];
  (draft[field] as RefinementChange['record'][]) = replaceInPlace(rows,change.record);
 }
 return saveConfigurationDraft(next,draft,now);
}
