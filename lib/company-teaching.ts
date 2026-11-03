import type {Turn,Manufacturer} from './trade';
import {applyConfigurationDraft,ensureCompanyConfiguration,type CompanyConfiguration,type ConfigurationScope,type ConfigurationBoundary} from './company-configuration.ts';
import {proposeConfigurationRefinement,saveConfigurationRefinement,type RefinementDestination,type ConfigurationRefinement} from './configuration-refinement.ts';

export type TeachingActor='manager'|'salesperson';
export type TeachingDestination='knowledge'|'selling'|'boundaries'|'client_memory'|'transcript';
export type TeachingMoment={callId?:string;suggestionId?:string;clientId?:string;stageId:string;turns:Turn[];suggestedLine:string;actualLine?:string;at:number};
export type TeachingProposal={id:string;companyId:string;baseVersionId:string;moment:TeachingMoment;explanation:string;replacement:string;destination:TeachingDestination;scope:ConfigurationScope;stageId?:string;targetRecordId?:string;instruction:string;when:string;exceptions:string;authority:ConfigurationBoundary['authority'];status:'draft'|'submitted'|'applied'|'dismissed';submittedBy:TeachingActor;createdAt:number;updatedAt:number;approvedAt?:number;approvedBy?:'manager';appliedVersionId?:string;correctionTurnId?:string;before:string;preview:string;interpretation:string;refinement?:ConfigurationRefinement};
export type TeachingInput={explanation:string;replacement?:string;destination?:TeachingDestination;scope?:ConfigurationScope;stageId?:string;targetRecordId?:string;instruction?:string;when?:string;exceptions?:string;authority?:ConfigurationBoundary['authority'];correctionTurnId?:string};
/** Keep editing state verbatim. Normalized proposals are for previews and saved
 * guidance, never for controlling a textarea while the manager is typing. */
export function teachingEditorText(input:TeachingInput,proposal:TeachingProposal,field:'instruction'|'when'|'exceptions'):string{return input[field]??proposal[field];}
const clone=<T>(value:T):T=>structuredClone(value);
const tidy=(text:string)=>text.trim();
const uid=(companyId:string,moment:TeachingMoment,now:number)=>`${companyId}:teaching:${moment.suggestionId||moment.callId||'moment'}:${now}`;
export function teachingDestination(text:string):TeachingDestination{
 if(/\b(?:transcript|transcription|misheard|mis-transcribed|transcribed incorrectly)\b|转录|听错|识别错|字幕错误/i.test(text))return 'transcript';
 if(/\b(?:this (?:buyer|client|customer)|buyer(?:'s)? email|client memory|buyer memory|contact details)\b|这(?:个|位|家)(?:客户|买家)|客户记忆|客户邮箱|联系人/i.test(text))return 'client_memory';
 if(/\b(?:must never|not allowed|prohibited|requires? approval|approval required|cannot promise|can't promise|authorized|permitted)\b|不得承诺|禁止|需要批准|必须审批|允许/i.test(text))return 'boundaries';
 if(/\b(?:our (?:company|product|factory)|we (?:supply|produce|manufacture)|company fact|product fact)\b|我们(?:供应|生产|制造)|公司事实|产品事实/i.test(text))return 'knowledge';
 return 'selling';
}
const field=(destination:TeachingDestination):RefinementDestination=>destination==='selling'?'preferences':destination as RefinementDestination;
const rowsFor=(configuration:CompanyConfiguration,destination:TeachingDestination)=>{const current=configuration.draft||configuration.active;return destination==='knowledge'?current.knowledge:destination==='boundaries'?current.boundaries:destination==='selling'?current.preferences:[];};
export function teachingTargets(configuration:CompanyConfiguration,destination:TeachingDestination){
 const targets=rowsFor(configuration,destination).map(row=>({id:row.id,text:row.text}));
 if(destination==='selling')for(const stage of (configuration.draft||configuration.active).stages){targets.push({id:`stage-objective:${stage.id}`,text:`${stage.name} · objective: ${stage.objective}`},{id:`stage-playbook:${stage.id}`,text:`${stage.name} · playbook: ${stage.playbook}`});}
 return targets;
}
/** A local, reviewable interpretation, not a model-generated promise of behavior.
 * English/Chinese explanations remain intact and never activate themselves. */
export function proposeCompanyTeaching(configuration:CompanyConfiguration,moment:TeachingMoment,input:TeachingInput,actor:TeachingActor,now=Date.now(),prior?:TeachingProposal):TeachingProposal{
 if(prior&&prior.companyId!==configuration.companyId)throw new Error('Feedback cannot cross companies.');
 const destination=input.destination||teachingDestination(input.explanation);
 const stageTarget=destination==='selling'&&input.targetRecordId?.match(/^stage-(objective|playbook):(.+)$/);
 const scope:ConfigurationScope=destination==='knowledge'?'company':stageTarget?'stage':input.scope||(destination==='selling'?'stage':'company'),stageId=stageTarget?stageTarget[2]:scope==='stage'?(input.stageId||moment.stageId):undefined;
 const instruction=tidy(input.instruction??input.explanation),when=tidy(input.when??(scope==='stage'?'When this stage and the described situation apply.':'When the described situation applies.')),exceptions=tidy(input.exceptions||'');
 const fullInstruction=[instruction,when?`Applies when: ${when}`:'',exceptions?`Exceptions: ${exceptions}`:''].filter(Boolean).join('\n');
 const existing=teachingTargets(configuration,destination).find(row=>row.id===input.targetRecordId);
 const targetStage=stageTarget?(configuration.draft||configuration.active).stages.find(stage=>stage.id===stageTarget[2]):undefined;
 let refinement:ConfigurationRefinement|undefined;
 if(!['client_memory','transcript'].includes(destination)){
  refinement=proposeConfigurationRefinement(configuration,fullInstruction,{section:field(destination),scope,stageId,recordId:input.targetRecordId==='__new__'||stageTarget?undefined:input.targetRecordId},now);
  if(stageTarget&&targetStage){const record={...clone(targetStage),[stageTarget[1]]:fullInstruction};refinement={...refinement,changes:[{id:record.id,destination:'selling',scope:'stage',stageId:record.id,operation:'update',record}],requiresClarification:false,questions:[]};}
  // Boundary authority is an explicit manager-reviewed field, not inferred from
  // a negation/approval keyword alone (especially across languages).
  if(destination==='boundaries'){
   const record:ConfigurationBoundary={id:existing?.id||prior?.refinement?.changes[0]?.record.id||uid(configuration.companyId,moment,now),text:fullInstruction,authority:input.authority||'approval_required',scope,stageId,condition:exceptions||when,status:'active',origin:'manager',action:'other'};
   refinement={...refinement,changes:[{id:record.id,destination:'boundaries',scope,stageId,operation:existing?'update':'add',record}],requiresClarification:scope==='stage'&&!configuration.active.stages.some(stage=>stage.id===stageId),questions:scope==='stage'&&!configuration.active.stages.some(stage=>stage.id===stageId)?['Choose an existing stage.']:[]};
  }
  // Revising a proposed addition must keep its record ID, otherwise repeated
  // edits would create competing instructions instead of updating one record.
  if(!existing&&prior?.refinement?.changes[0]&&prior.destination===destination&&refinement.changes[0])refinement.changes[0].record.id=prior.refinement.changes[0].record.id;
 }
 const before=(targetStage&&stageTarget?targetStage[stageTarget[1] as 'objective'|'playbook']:existing?.text)||(destination==='transcript'?moment.turns.find(turn=>turn.id===input.correctionTurnId)?.text||'Choose the transcript line to correct.':destination==='client_memory'?'No change to company guidance.':moment.suggestedLine||'No prior suggestion selected.');
 const preview=destination==='transcript'?`Correct the selected transcript line to: ${instruction}`:destination==='client_memory'?`Add this information only to the selected client’s memory: ${instruction}`:input.replacement?.trim()?`Optional example for this moment: ${input.replacement.trim()}\nFuture coaching follows the reviewed instruction and company boundaries; this is not a verified generated response.`:`For this moment the copilot would be instructed to: ${instruction}\nThis is an instruction preview, not a generated response.`;
 return {id:prior?.id||uid(configuration.companyId,moment,now),companyId:configuration.companyId,baseVersionId:prior?.baseVersionId||configuration.active.id,moment:clone(moment),explanation:tidy(input.explanation),replacement:tidy(input.replacement||''),destination,scope,stageId,targetRecordId:input.targetRecordId,instruction,when,exceptions,authority:input.authority||'approval_required',status:prior?.status==='submitted'?'submitted':'draft',submittedBy:prior?.submittedBy||actor,createdAt:prior?.createdAt||now,updatedAt:now,correctionTurnId:input.correctionTurnId,before,preview,interpretation:destination==='client_memory'?'This describes a particular client. It stays in client memory.':destination==='transcript'?'This corrects what was heard. It changes the selected transcript, not a company sales rule.':`Proposed ${existing?'replacement of an existing instruction':'new instruction'} in ${destination==='selling'?'How we sell':destination==='knowledge'?'What we know':'Our boundaries'} for this company only.`,refinement};
}
export function saveTeachingProposal(configuration:CompanyConfiguration,proposal:TeachingProposal,actor:TeachingActor,now=Date.now()):CompanyConfiguration{
 if(proposal.companyId!==configuration.companyId)throw new Error('Feedback cannot cross companies.');
 if(configuration.teaching?.some(row=>row.id===proposal.id&&(row.status==='applied'||row.status==='dismissed')))throw new Error('This reviewed feedback is preserved. Start a new teaching moment to propose another change.');
 if(!proposal.explanation.trim()||!proposal.instruction.trim())throw new Error('Explain the change and review its proposed instruction first.');
 const saved={...clone(proposal),status:'submitted' as const,updatedAt:now,submittedBy:proposal.submittedBy||actor};
 return {...clone(configuration),teaching:[...(configuration.teaching||[]).filter(row=>row.id!==saved.id),saved]};
}
export function applyCompanyTeaching(configuration:CompanyConfiguration,proposal:TeachingProposal,actor:TeachingActor,company:Manufacturer,now=Date.now()):CompanyConfiguration{
 if(actor!=='manager')throw new Error('A manager must approve company guidance changes.');
 if(company.id!==configuration.companyId||proposal.companyId!==company.id)throw new Error('Feedback cannot cross companies.');
 if(proposal.baseVersionId!==configuration.active.id)throw new Error('Company guidance changed. Review this proposal against the active version again.');
 if(['client_memory','transcript'].includes(proposal.destination))throw new Error('Apply this correction to its client or transcript, not Company Brain.');
 if(configuration.draft)throw new Error('Review or discard the existing Company Brain draft before applying this teaching proposal.');
 if(!proposal.explanation.trim()||!proposal.instruction.trim()||!proposal.refinement?.changes.length||proposal.refinement.requiresClarification)throw new Error('Complete the proposed change before applying.');
 const expectedTargets=teachingTargets(configuration,proposal.destination);
 if(!proposal.targetRecordId)throw new Error('Choose an existing instruction to update, or explicitly choose Add a new instruction.');
 if(proposal.targetRecordId!=='__new__'&&!expectedTargets.some(row=>row.id===proposal.targetRecordId))throw new Error('The instruction selected for replacement no longer exists.');
 const saved=saveTeachingProposal(configuration,proposal,actor,now),draft=saveConfigurationRefinement(saved,proposal.refinement,now),applied=applyConfigurationDraft(draft,now,company);
 if(!applied.applied)throw new Error(applied.conflicts.map(conflict=>conflict.message).join(' ')||'No applicable change was proposed.');
 return {...applied.configuration,teaching:applied.configuration.teaching?.map(row=>row.id===proposal.id?{...row,status:'applied',approvedAt:now,approvedBy:'manager',appliedVersionId:applied.configuration.active.id}:row)};
}
export function markLocalTeachingApplied(configuration:CompanyConfiguration,proposal:TeachingProposal,actor:TeachingActor,now=Date.now()):CompanyConfiguration{
 if(actor!=='manager')throw new Error('A manager must review this correction.');
 if(!['client_memory','transcript'].includes(proposal.destination))throw new Error('Company changes use versioned manager approval.');
 const saved=saveTeachingProposal(configuration,proposal,actor,now);
 return {...saved,teaching:saved.teaching?.map(row=>row.id===proposal.id?{...row,status:'applied',approvedAt:now,approvedBy:'manager'}:row)};
}
export function companyTeachingConfiguration(company:Manufacturer){return ensureCompanyConfiguration(company);}
