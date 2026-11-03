import type {CoachingContext} from './call-coaching';
import {onDemandTaskContext} from './on-demand-coaching.ts';
import {callRouteAtRequest} from './call-route.ts';
import {coachingTranscriptState} from './coaching-context-snapshot.ts';
import {BUYER_DECISION_QUESTIONS,SALES_COACHING_PURPOSE,SALES_MOVE_JUDGMENT,SALES_MOVE_REVIEW_STANDARD} from './sales-curriculum.ts';

/** Generation-only removal of exact duplicates. The entire labeled transcript
 * remains in coachingTask; checks still receive the original frozen input.
 * Full manager configuration and reviewed preparation occur in instructions. */
export function projectedOnDemandTask(context:CoachingContext&{goal?:unknown}) {
 const task=onDemandTaskContext(context);
 return projectOnDemandImmediateAction(context,{...task,
  ...(context.companyConfiguration?{selectedStage:{id:context.companyConfiguration.selectedStageId,reference:'Full objective, playbook and information-to-bring-back are in ACTIVE MANAGER CONFIGURATION above.'}}:{}),
  ...(task.clientContext?{clientContext:{reference:'Full reviewed, attributed clientPreparation is in SALESPERSON-REVIEWED CLIENT PREPARATION above.'}}:{}),
 });
}
export function referencedCompanyFacts<T extends {sourceId:string;quote:string;text:string}>(facts:T[],sources:{id:string;text:string}[]) {
 return facts.map(fact=>sources.some(source=>source.id===fact.sourceId&&source.text.includes(fact.quote))
  ? {...fact,quote:undefined,sourceReference:'Exact original quote is in sources for this sourceId.'}
  : fact);
}

type PromptReferenceUse={location:string;target:string;value:unknown};
/** Remove repeated reference data, never instructions or unique information.
 * Targets are exact original values already present in the instruction prefix
 * or the request's complete source excerpts. No semantic summarization occurs.
 * Transcript, learned examples and source excerpts deliberately remain literal.
 */
export function deduplicateOnDemandReferenceData<F extends object,S extends object>(prefix:string,foundation:F,snapshot:S,onReference?:(use:PromptReferenceUse)=>void):{foundation:F;snapshot:S} {
 const projected=structuredClone({foundation,snapshot}),root=projected.foundation as Record<string,unknown>,request=projected.snapshot as Record<string,unknown>;
 const object=(value:unknown):Record<string,unknown>|undefined=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:undefined;
 const equal=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
 const replace=(owner:Record<string,unknown>|undefined,field:string,expected:unknown,target:string,location:string)=>{
  if(!owner||expected===undefined||!equal(owner[field],expected))return;
  const reference={sameValueAs:target};if(JSON.stringify(reference).length+16>=JSON.stringify(expected).length)return;
  onReference?.({location:location+'.'+field,target,value:owner[field]});owner[field]=reference;
 };
 // Only named duplicate fields are eligible. Preserve custom fields, unique
 // wording and every boundary exception; never perform general interning.
 let configuration:Record<string,unknown>|undefined;
 for(const line of prefix.split('\n'))if(line.startsWith('{')){
  let data:unknown;try{data=JSON.parse(line);}catch{continue;}
  const parsed=object(data);if(parsed?.configuration)configuration=object(parsed.configuration);
 }
 const active=object(root.activeConfiguration),stage=object(active?.stage),selected=object(configuration?.selectedStage),expertise=object(root.builtInSalesExpertise),curriculum=object(expertise?.curriculum);
 for(const field of ['playbook','informationToBringBack','objective'])replace(stage,field,selected?.[field],`ACTIVE MANAGER CONFIGURATION.configuration.selectedStage.${field}`,'SALES FOUNDATION.activeConfiguration.stage');
 replace(active,'boundaries',configuration?.boundaries,'ACTIVE MANAGER CONFIGURATION.configuration.boundaries','SALES FOUNDATION.activeConfiguration');
 if(prefix.includes(SALES_COACHING_PURPOSE))for(const [owner,path]of [[expertise,'SALES FOUNDATION.builtInSalesExpertise'],[curriculum,'SALES FOUNDATION.builtInSalesExpertise.curriculum']] as const)replace(owner,'purpose',SALES_COACHING_PURPOSE,'SHARED SALES JUDGMENT opening purpose',path);
 if(BUYER_DECISION_QUESTIONS.every(item=>prefix.includes(item.question+' '+item.guidance)))replace(curriculum,'buyerDecisionQuestions',BUYER_DECISION_QUESTIONS,'PRIVATE BUYER DECISION LENSES: all six questions and their full guidance','SALES FOUNDATION.builtInSalesExpertise.curriculum');
 if(prefix.includes(SALES_MOVE_REVIEW_STANDARD))replace(curriculum,'moveReviewStandard',SALES_MOVE_REVIEW_STANDARD,'SHARED SALES JUDGMENT final private review standard','SALES FOUNDATION.builtInSalesExpertise.curriculum');
 const shared=[SALES_COACHING_PURPOSE,...SALES_MOVE_JUDGMENT],principles=curriculum?.sharedPrinciples;
 if(Array.isArray(principles)&&equal(principles.slice(0,shared.length),shared)&&shared.every(text=>prefix.includes(text))){
  const target='SHARED SALES JUDGMENT: opening purpose followed by its six move rules';
  onReference?.({location:'SALES FOUNDATION.builtInSalesExpertise.curriculum.sharedPrinciples[0:'+shared.length+']',target,value:shared});
  curriculum!.sharedPrinciples=[{sameValuesAs:target},...principles.slice(shared.length)];
 }
 replace(object(curriculum?.relevantCycle),'information',selected?.informationToBringBack,'ACTIVE MANAGER CONFIGURATION.configuration.selectedStage.informationToBringBack','SALES FOUNDATION.builtInSalesExpertise.curriculum.relevantCycle');
 const facts=object(request.brain)?.facts,sources=request.sources;
 if(Array.isArray(facts)&&Array.isArray(sources))facts.forEach((value,index)=>{
  const fact=object(value),sourceIndex=sources.findIndex(item=>object(item)?.id===fact?.sourceId&&object(item)?.text===fact?.text);
  if(sourceIndex>=0)replace(fact,'text',object(sources[sourceIndex])?.text,`REQUEST SNAPSHOT.sources[${sourceIndex}].text`,`REQUEST SNAPSHOT.brain.facts[${index}]`);
 });
 return projected;
}

/** Empty-main-line routing is the immediate prerequisite, even when a returning
 * client's deal stage is Discovery/Quotation. Replace only derived action hints
 * in generation projections; never rewrite the canonical state, selected stage,
 * factual memory, authored objective or reviewed history used by checks/storage.
 * Captured partial/pending speech is not an empty call. */
export function projectOnDemandImmediateAction<T extends object>(context:CoachingContext,projection:T):T {
 if(!context.coachingRequest||['partial','pending'].includes(coachingTranscriptState(context))||['partial','pending'].includes(context.coachingRequest.transcriptState||''))return projection;
 const session=context.coachingRequest.listeningSession,currentIds=session?new Set(session.currentTurnIds):undefined;
 const resumedWithoutBuyer=!!currentIds&&(context.turns||[]).some(turn=>!currentIds.has(turn.id||''))&&!(context.turns||[]).some(turn=>turn.role==='buyer'&&currentIds.has(turn.id||''));
 if(!resumedWithoutBuyer&&(context.turns||[]).length)return projection;
 const route=callRouteAtRequest(context);
 if((!route?.routingNeeded||!route.target)&&!resumedWithoutBuyer)return projection;
 const action=route?.routingNeeded&&route.target?{kind:'route_to_contact',target:route.target,reason:'The number dialed is the company main line; the intended contact has not identified themselves in this listening session.',move:'Briefly identify the known representative and company, then politely request connection to the intended contact and known role. Resume the selected objective after pickup.'}:{kind:'listen_for_current_person',reason:'Listening resumed with historical transcript, but no new buyer words or current speaker identification are available.',move:'Give a brief neutral invitation to speak or listen for the current person. Do not greet a historical contact or answer an earlier-session topic as a newly heard request.'};
 const object=(value:unknown):Record<string,unknown>|undefined=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:undefined;
 const value=projection as Record<string,unknown>;
 const state=object(value.state),conversationState=object(value.conversationState),flow=object(value.conversationFlow),foundationConversation=object(value.conversationContext),expertise=object(value.builtInSalesExpertise);
 const stateAction=(original:Record<string,unknown>)=>({...original,nextAction:action,immediateObjective:action});
 return {...projection,immediateAction:action,
  ...(state?{state:stateAction(state)}:{}),
  ...(conversationState?{conversationState:stateAction(conversationState)}:{}),
  ...('questionPlan' in value?{questionPlan:undefined}:{}),
  ...('situation' in value?{situation:{momentType:action.kind,reason:action.reason,role:'current_action'}}:{}),
  ...('move' in value?{move:{id:action.kind,name:action.kind==='route_to_contact'?'Reach the intended contact':'Listen for the current person',do:[action.move],doNot:['Do not answer historical buyer speech as a current request.'],templateRole:'One immediate action; historical examples do not establish current speaker presence.'}}:{}),
  ...(flow?{conversationFlow:{...flow,phase:action.kind==='route_to_contact'?'routing':'listening',openingNeeded:false,contactAppropriate:false}}:{}),
  ...(foundationConversation?{conversationContext:{...foundationConversation,currentObjective:action}}:{}),
  ...(resumedWithoutBuyer&&expertise?{builtInSalesExpertise:{...expertise,illustrativeResponses:[],exampleScope:'Historical-turn examples are omitted until current buyer speech identifies this moment.'}}:{}),
  ...(resumedWithoutBuyer&&'buyerDeferral' in value?{historicalBuyerDeferral:value.buyerDeferral,buyerDeferral:undefined}:{}),
 };
}
