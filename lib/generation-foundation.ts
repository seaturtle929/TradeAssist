import {applyCoachingConfiguration,selectedConfigurationStage,activeConfigurationBoundaries} from './coaching-configuration.ts';
import {resolveFoundationMove,type FoundationRequest,type GeneralFoundation} from './general-foundation.ts';
import {defaultGeneralPlaybook} from './general-playbook.ts';
import type {CoachingContext} from './call-coaching';
import type {Guidance} from './trade';
import {BUILT_IN_SALES_EXPERTISE,SALES_INPUT_LAYERS,salesJudgmentExamples} from './sales-expertise.ts';
import {curriculumLayerFor} from './sales-curriculum.ts';
import {deriveConversationState} from './conversation-state.ts';

export const FOUNDATION_ORDER=['situation_detection','general_playbook_move','company_brain_facts','conversation_state','transcript','last_buyer_utterance'] as const;
export const FOUNDATION_GENERATION_RULES='FOUR INPUTS: built-in sales expertise, current-company knowledge, applicable manager preferences, and actual conversation. Select a useful move for the immediate objective; templates and lessons are guidance, never compulsory tactics. Interest is not consent to send. New questions, concerns, corrections and refusals take priority while earlier commitments remain remembered. Company facts and commercial authorization stay mandatory; neither examples nor preferences create facts or buyer agreement. For first contact, give brief who + intent + right-person check when purchasing is unverified. The supplied curriculum and detected move are advisory: the selected manager objective and both speakers determine relevance. Omit an unreliable tactic; do not force introduction, discovery, price or contact capture. Missing-Why lessons remain pending.';

export type LearningAttribution={moveId:string;moveName:string;momentType:string;patternIds:string[];goldenMomentIds:string[];lessonIds:string[];status:'retrieved'|'none';adherence:'not_assessed';lessons:{id:string;source:string;goodLine:string;why:string}[]};
type FoundationContext=CoachingContext&{foundation?:FoundationRequest;foundationPlaybook?:GeneralFoundation;manufacturer?:{id?:string;name?:string;products?:string}};
function selectedCurriculumStage(context:FoundationContext) {
 const selected=selectedConfigurationStage(context);if(selected)return selected;
 const stageId=context.callContext?.stageId;
 return stageId?{id:stageId,name:stageId,objective:context.callContext?.goal||''}:undefined;
}
export function generationFoundationFor(context:FoundationContext):FoundationRequest {
 context=applyCoachingConfiguration(context);
 const playbook={...defaultGeneralPlaybook(),...(context.foundationPlaybook?{foundation:context.foundationPlaybook}:{})};
 return resolveFoundationMove({...context,selectedStage:selectedCurriculumStage(context),callType:typeof context.callType==='string'?context.callType:undefined},playbook);
}
export function foundationLayerFor(context:FoundationContext,options:{referenceOnly?:boolean}={}){
 context=applyCoachingConfiguration(context);
 const foundation=generationFoundationFor(context);
 const brain=context.brain?.companyId===context.manufacturer?.id?context.brain:undefined;
 const state=context.conversationState&&(!context.callId||context.conversationState.callId===context.callId)?context.conversationState:deriveConversationState(context);
 return {order:FOUNDATION_ORDER,inputLayers:SALES_INPUT_LAYERS,...context.companyConfiguration?{activeConfiguration:{companyId:context.companyConfiguration.companyId,versionId:context.companyConfiguration.versionId,version:context.companyConfiguration.version,stage:selectedConfigurationStage(context),boundaries:activeConfigurationBoundaries(context)}}:{},
  builtInSalesExpertise:{version:BUILT_IN_SALES_EXPERTISE.version,purpose:BUILT_IN_SALES_EXPERTISE.purpose,judgment:BUILT_IN_SALES_EXPERTISE.judgment,boundaries:BUILT_IN_SALES_EXPERTISE.boundaries,exportSalesUnderstanding:BUILT_IN_SALES_EXPERTISE.exportSalesUnderstanding,curriculum:curriculumLayerFor(selectedCurriculumStage(context)),illustrativeResponses:salesJudgmentExamples(foundation.momentType)},
  companyKnowledge:options.referenceOnly?{companyId:context.manufacturer?.id||'',reference:'Current request manufacturer, sources and brain.facts; use exact current-company evidence.'}:{companyId:context.manufacturer?.id||'',identity:context.manufacturer,confirmedFacts:brain?.facts?.filter(fact=>fact.confirmed)||[],sourceIds:(context.sources||[]).map(source=>source.id),sourceLocation:'Use the current request sources for exact supporting excerpts; no historic example establishes a fact.'},
  managerCustomization:options.referenceOnly?{companyId:brain?.companyId||context.manufacturer?.id||'',reference:'Current request brain.rules, brain.moves, brain.learningExamples and voice. Apply only to the present objective, within facts and buyer boundaries.'}:{companyId:brain?.companyId||context.manufacturer?.id||'',rules:brain?.rules||null,moves:brain?.moves||{},speakingStyle:context.voice||null,lessonIds:brain?.learningExamples?.map(example=>example.id)||[],application:'Apply matching preferences and lessons to the current objective; never infer company facts or buyer consent from them.'},
  conversationContext:options.referenceOnly?{dealStage:state.stageId,currentObjective:state.immediateObjective?.kind||state.nextAction.kind,reference:'Current request conversationState/purpose and actual turns: use known facts, deferred commitments and agreed sequence. Suggestions are not speech.'}:{dealStage:state.stageId,currentObjective:state.immediateObjective||state.nextAction,deferredCommitments:state.deferredCommitments||[],knownInformation:state.facts,commitments:state.commitments,agreedSequence:state.sequence,lastAgreedNextStep:state.lastAgreedNextStep,actualTranscriptLocation:'Use this request’s actual turns; suggested replies are not spoken or agreed.'},
  situation:{momentType:foundation.momentType,reason:foundation.detectionReason,role:'advisory',intentCertainty:'interpretation_unless_explicit',tacticalLabel:foundation.tacticalLabel},move:{id:foundation.moveId,name:foundation.moveName,do:foundation.do,doNot:foundation.doNot,templateRole:'Illustrative only; choose the appropriate answer, useful question, optional step or respectful close.',boundExample:foundation.boundExample,negativeRules:foundation.negativeRules.filter(rule=>!foundation.doNot.includes(rule)),examples:foundation.examples.map(example=>({id:example.id,tags:example.tags}))}};
}
export function attributeGuidance<T extends Guidance>(guidance:T,context:FoundationContext):T {
 context=applyCoachingConfiguration(context);
 const foundation=generationFoundationFor(context);
 const examples=context.brain&&context.brain.companyId===context.manufacturer?.id?context.brain.learningExamples||[]:[];
 const lessons=examples.filter(example=>example.structuredLesson?.reviewStatus==='active'||example.learningExplanation?.trim());
 return {...guidance,learningAttribution:{moveId:foundation.moveId,moveName:foundation.moveName,momentType:foundation.momentType,patternIds:foundation.exampleIds,goldenMomentIds:lessons.filter(item=>item.source==='golden'||item.id.startsWith('moment:')).map(item=>item.id),lessonIds:lessons.map(item=>item.id),status:lessons.length||foundation.exampleIds.length?'retrieved':'none',adherence:'not_assessed',lessons:lessons.map(item=>({id:item.id,source:item.source,goodLine:item.positive,why:item.learningExplanation||''}))}};
}
