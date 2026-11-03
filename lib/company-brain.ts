import {ensureCompanyConfiguration,configurationStageMap,type CompanyConfiguration} from './company-configuration.ts';
import {rejectionSignature} from "./rejected-examples.ts";
import {needsFactCheck} from "./call-coaching.ts";
import {normalizeOpening} from "./opening-preferences.ts";
import {DEFAULT_EXAMPLE_LINES,normalizeStageMap,normalizeExampleLines,type StageDefinition,type ExampleLine,type CallContext} from './call-purpose.ts';
import type {ConversationState,StateFact,CallCommitment} from './conversation-state.ts';
import {detectGeneralMoment,isInterestNarrowedPatternId} from './general-playbook.ts';
import {canonicalLearningMoment,compileLearningLesson,learningExampleMatchesSituation,type StructuredLearningLesson,type LearningMomentType} from './learning-loop.ts';
import type {Manufacturer,Turn,CallRecord} from './trade';
import type {ClientCoachingContext} from './client-coaching-context';

export const EDIT_REASONS=['Too generic','Wrong stage','Too long','Wrong tone','Fact wrong'] as const;
export type EditReason=typeof EDIT_REASONS[number];
export type BrainFact={id:string;kind:'identity'|'product';text:string;sourceId:string;quote:string;confirmed:boolean};
export type BuyerMemory={excludedFacts?:{field:'email';reason:'salesperson_email_read_back';callId:string;sourceTurnId:string;original:StateFact;excludedAt:number}[];id:string;name:string;callId?:string;participant?:ConversationState['participant'];buyerNeeds?:ConversationState['buyerNeeds'];history:{callId:string;at:number;outcome:string;notes:string}[];facts:Record<string,StateFact>;commitments:CallCommitment[];sequence:ConversationState['sequence'];lastAgreedNextStep:string;decisionsNeeded:string[];processedTurnIds?:string[];updatedAt:number};
export type LearningCapture={companyId:string;callId:string;buyer:string;buyerWindow:Pick<Turn,'id'|'role'|'text'|'at'>[];stageId:string;moment:string;callContext:CallContext;state:ConversationState;prompt:string;requestContext:Record<string,unknown>};
export type LearningPair=LearningCapture&{reviewStatus?:'pending_manager'|'approved';id:string;suggestionId:string;suggested:string;actual:string;verdict:'unrated'|'Used'|'Edited'|'Ignored';reason?:EditReason;actualSource?:'edited'|'used'|'speech';outcome:string;at:number;feedbackAt?:number;promoted:boolean;verified:boolean;evidence:{sourceId:string;quote:string}[];learningExplanation?:string;structuredLesson?:StructuredLearningLesson;importAuditId?:string;importSourceLocations?:string[];goldenMomentId?:string};
export type BrainRules={neverInvent:string;neverPromise:string;promiseThreshold:string;escalateThreshold:string;phrasesToAvoid:string;tone:string};
export type CompanyBrainRecord={clients?:import('./client-records').ClientRecord[];configuration?:CompanyConfiguration;goldenMoments?:import("./general-playbook").GoldenMoment[];version:1;companyId:string;updatedAt:number;identityFacts:BrainFact[];knowledge:{sourceIds:string[]};playbook:{stages:StageDefinition[];moves:Record<string,string>;examples:ExampleLine[];defaultOpening?:string};rules:BrainRules;buyers:BuyerMemory[];learning:LearningPair[];decisionLog:{id:string;callId:string;text:string;checked:boolean;outcome:string;at:number}[];builder:{factsDraftedAt?:number;interviewComplete:boolean}};
export type RetrievedExample={id:string;stageId:string;moment:string;positive:string;negative:string;context:string;actual?:string;learningExplanation?:string;structuredLesson?:StructuredLearningLesson;verified:boolean;source:'golden'|'override'};
export type BrainRequestContext={clientContext?:ClientCoachingContext;companyId:string;facts:BrainFact[];rules:BrainRules;learningExamples:RetrievedExample[];rejectedSignatures?:string[];buyerMemory?:BuyerMemory;decisionLog:CompanyBrainRecord['decisionLog'];moves:Record<string,string>;defaultOpening?:string};
const stamp=()=>Date.now();
const learningApproved=(pair:LearningPair)=>pair.reviewStatus==='pending_manager'?false:pair.structuredLesson?pair.structuredLesson.reviewStatus==='active':pair.actualSource!=='speech'||!!pair.reason||pair.promoted;
const key=(value:string)=>value.toLowerCase().replace(/[^a-z0-9@.]+/g,' ').trim();
/** Promotions keep the context of their source pair, including old saved
 * examples created before stageId was stored. Hand-authored global examples
 * deliberately have no stage. An orphaned legacy promotion cannot be global. */
function scopedGoldenExamples(brain:CompanyBrainRecord):ExampleLine[] {
 const pairs=new Map(brain.learning.filter(item=>item.companyId===brain.companyId).map(item=>[`learned-${item.id}`,item]));
 return brain.playbook.examples.flatMap(example=>{
  if(!example.id.startsWith('learned-'))return [example];
  const pair=pairs.get(example.id);
  if(pair)return pair.stageId?[{...example,stageId:pair.stageId,moment:pair.moment as ExampleLine['moment']}]:[];
  return example.stageId?[example]:[];
 });
}
export function companyReferences(company:Pick<Manufacturer,'introduction'|'sources'>){return [...(company.introduction?[{id:'company-profile',title:'Company profile',text:company.introduction}]:[]),...company.sources];}
export function ensureCompanyBrain(company:Manufacturer):CompanyBrainRecord {
 const prior=company.brain?.companyId===company.id?company.brain:undefined;
 if(prior){return {...prior,configuration:ensureCompanyConfiguration(company,prior),knowledge:{sourceIds:companyReferences(company).map(source=>source.id)},playbook:{...prior.playbook,defaultOpening:normalizeOpening(prior.playbook.defaultOpening)||undefined,examples:scopedGoldenExamples(prior)}};}
 const examples=normalizeExampleLines(company.exampleLines||DEFAULT_EXAMPLE_LINES);
 const initialConfiguration=ensureCompanyConfiguration(company);
 const created:CompanyBrainRecord={version:1,companyId:company.id,updatedAt:0,identityFacts:[],knowledge:{sourceIds:companyReferences(company).map(source=>source.id)},playbook:{stages:normalizeStageMap(company.stageMap||configurationStageMap(initialConfiguration.active)),examples,moves:{}},rules:{neverInvent:'Never invent product facts, prices, specifications, stock, certifications, delivery times or buyer facts.',neverPromise:'No unapproved price, discount, sample, delivery, quality or response deadline.',promiseThreshold:'Only approved Company Knowledge or a confirmed manager decision can authorize company promises.',escalateThreshold:'Escalate missing or conflicting commercial terms and facts to the factory.',phrasesToAvoid:'',tone:'Brief, grounded and conversational; agree first when the buyer proposes a useful next step.'},buyers:[],learning:[],decisionLog:[],builder:{interviewComplete:false}};
 return {...created,configuration:ensureCompanyConfiguration(company,created)};
}
export function factsHaveSources(facts:BrainFact[],sources:{id:string;text:string}[]){return facts.filter(fact=>fact.text.trim()&&fact.quote.trim()&&sources.some(source=>source.id===fact.sourceId&&source.text.includes(fact.quote)));}
/** Opening wording is a playbook preference, never a confirmed identity fact. */
export function setDefaultOpening(brain:CompanyBrainRecord,text:unknown):CompanyBrainRecord {
 return {...brain,updatedAt:stamp(),playbook:{...brain.playbook,defaultOpening:normalizeOpening(text)||undefined}};
}
export function normalizeExtractedFacts(raw:unknown,sources:{id:string;text:string}[]):BrainFact[]{
 if(!Array.isArray(raw))return [];
 return factsHaveSources(raw.slice(0,50).filter(item=>item&&typeof item.text==='string'&&typeof item.sourceId==='string'&&typeof item.quote==='string').map((item,index)=>({id:typeof item.id==='string'?item.id:`fact-${index}-${stamp()}`,kind:item.kind==='product'?'product':'identity',text:item.text.slice(0,1500),sourceId:item.sourceId.slice(0,100),quote:item.quote.slice(0,2000),confirmed:false})),sources);
}
export function buyerMemoryFor(brain:CompanyBrainRecord,buyer:string){return buyer.trim()?brain.buyers.find(item=>key(item.name)===key(buyer)):undefined;}
export function buildBrainRequest(company:Manufacturer,buyer:string,state:ConversationState,currentTurns?:Pick<Turn,'id'|'role'|'text'|'at'>[],foundationMoment?:LearningMomentType,clientContext?:ClientCoachingContext):BrainRequestContext {
 const brain=ensureCompanyBrain(company);
 const generalMoment=currentTurns?.length?detectGeneralMoment({company,state,turns:currentTurns}):null;
 const buyerLine=[...(currentTurns||[])].reverse().find(turn=>turn.role==='buyer')?.text||'';
 const detectedMoment=foundationMoment||generalMoment?.momentType||canonicalLearningMoment({moment:state.moment,buyerLine,state});
 const acceptsReview=(item:NonNullable<CompanyBrainRecord['goldenMoments']>[number])=>!(isInterestNarrowedPatternId(item.generalPatternId)||item.momentType==='interest_narrowed')||generalMoment?.momentType==='interest_narrowed';
 // Persistent buyer history stays historical. Only a snapshot derived from this call may seed its next request.
 const requestMemory:BuyerMemory|undefined=state.callId?{id:`call:${state.callId}`,name:buyer,callId:state.callId,participant:state.participant,buyerNeeds:state.buyerNeeds,history:[],facts:state.facts,commitments:state.commitments.map(item=>({...item,evidence:item.evidence.slice(-64)})),sequence:state.sequence,lastAgreedNextStep:state.lastAgreedNextStep,decisionsNeeded:[],processedTurnIds:state.processedTurnIds||[],updatedAt:Date.now()}:undefined;
 const learningExamples=retrieveLearning(brain,company.id,state.stageId,state.moment,acceptsReview,detectedMoment);
 return {companyId:company.id,...clientContext&&clientContext.companyId===company.id&&clientContext.callId===state.callId?{clientContext}:{},...(normalizeOpening(brain.playbook.defaultOpening)?{defaultOpening:normalizeOpening(brain.playbook.defaultOpening)}:{}),facts:factsHaveSources(brain.identityFacts.filter(f=>f.confirmed),companyReferences(company)).slice(0,50),rules:brain.rules,moves:brain.playbook.moves,learningExamples,rejectedSignatures:[...new Set([...brain.learning.filter(pair=>learningApproved(pair)&&pair.companyId===company.id&&pair.stageId===state.stageId&&pair.moment===state.moment&&["Edited","Ignored"].includes(pair.verdict)).map(pair=>rejectionSignature(pair.suggested)),...learningExamples.filter(example=>example.negative).map(example=>rejectionSignature(example.negative))])],buyerMemory:requestMemory,decisionLog:brain.decisionLog.filter(item=>item.callId===state.callId&&!item.checked).slice(-8)};
}
export function retrieveLearning(brain:CompanyBrainRecord,companyId:string,stageId:string,moment:string,acceptsReview?:(item:NonNullable<CompanyBrainRecord['goldenMoments']>[number])=>boolean,momentType?:LearningMomentType):RetrievedExample[]{
 if(brain.companyId!==companyId)return [];
 // A reviewed Golden Moment is a scoped lesson, including when the rep explains
 // the desired behavior without supplying a replacement sentence. Its transcript
 // remains historical context, never current-call facts or factual authority.
 const reviewed:RetrievedExample[]=(Array.isArray(brain.goldenMoments)?brain.goldenMoments:[]).filter(item=>item&&item.companyId===companyId).sort((a,b)=>(b.feedbackAt||b.timestamp)-(a.feedbackAt||a.timestamp)).flatMap(item=>{
  const explanation=typeof item.learningExplanation==='string'?item.learningExplanation.trim().slice(0,2000):'';
  const positive=typeof item.repOverride==='string'?item.repOverride.trim().slice(0,700):'';
  if(!explanation&&!positive)return [];
  const original=typeof item.copilotSuggestion==='string'?item.copilotSuggestion.trim().slice(0,700):'';
  const context=[...(Array.isArray(item.previousContext)?item.previousContext:[]).slice(-6).map(turn=>`${turn.role}: ${turn.text.slice(0,350)}`),`buyer: ${String(item.buyerLine||'').slice(0,700)}`,...!positive&&original?[`Historical copilot suggestion (not spoken): ${original}`]:[]].join('\n').slice(-3500);
  const semantic=canonicalLearningMoment({moment:item.momentType,buyerLine:item.buyerLine,actual:positive,explanation});
  // A written Golden strategy can be useful without a replacement sentence.
  // Old Edited rows with neither a good line nor Why remain pending in audit.
  const structuredLesson=compileLearningLesson({momentType:semantic,why:explanation,actual:positive||(explanation?'Approved written strategy':''),suggested:original},item.feedbackAt||item.timestamp);
  const example:RetrievedExample={id:`moment:${item.id}`,stageId:item.learningStageId||item.stageId,moment:item.learningMoment||item.momentType,positive,negative:positive&&positive!==original?original:'',context,...positive?{actual:positive}:{},...explanation?{learningExplanation:explanation}:{},structuredLesson,verified:false,source:'golden'};
  const legacyMatch=!momentType&&example.stageId===stageId&&example.moment===moment&&(!acceptsReview||acceptsReview(item));
  return (legacyMatch||learningExampleMatchesSituation(example,stageId,moment,momentType))?[{...example,stageId,moment}]:[];
 });
 const golden=scopedGoldenExamples(brain).filter(item=>item.approved).map(item=>({id:item.id,stageId:item.stageId||stageId,moment:item.moment,positive:item.text,negative:item.negative||'',context:item.context||'',verified:!!item.verified,source:'golden' as const})).filter(example=>learningExampleMatchesSituation(example,stageId,moment,momentType)).map(example=>({...example,stageId,moment}));
 const groups=new Map<string,{pair:LearningPair;count:number}>();
 for(const pair of brain.learning){if(pair.companyId!==companyId||pair.verdict==='unrated'||!learningApproved(pair))continue;const probe:RetrievedExample={id:pair.id,stageId:pair.stageId,moment:pair.moment,positive:pair.actual,negative:pair.suggested,context:pair.buyerWindow.map(turn=>`${turn.role}: ${turn.text}`).join('\n'),verified:pair.verified,source:'override',structuredLesson:pair.structuredLesson};if(!learningExampleMatchesSituation(probe,stageId,moment,momentType))continue;const id=key(pair.suggested)+'|'+key(pair.actual);const old=groups.get(id);groups.set(id,{pair,count:(old?.count||0)+1});}
 const learned=[...groups.values()].sort((a,b)=>b.count-a.count||b.pair.at-a.pair.at).map(({pair})=>({id:pair.id,stageId,moment,positive:pair.verdict==='Ignored'?'':pair.actual,negative:pair.verdict==='Used'?'':pair.suggested,context:pair.buyerWindow.map(t=>`${t.role}: ${t.text}`).join('\n').slice(-1200),actual:pair.actual,...pair.learningExplanation?{learningExplanation:pair.learningExplanation}:{},...pair.structuredLesson?{structuredLesson:pair.structuredLesson}:{},verified:pair.verified,source:'override' as const}));
 const seen=new Set(reviewed.map(item=>key(item.positive)+'|'+key(item.negative)));
 return [...reviewed,...[...learned,...golden].filter(item=>!seen.has(key(item.positive)+'|'+key(item.negative)))].slice(0,8);
}
export function isNearRejected(candidate:string,examples:RetrievedExample[]=[]){
 const tokens=(s:string)=>key(s).split(' ').filter(Boolean);
 return examples.some(example=>{if(!example.negative)return false;const a=tokens(candidate),b=tokens(example.negative),set=new Set(b);const overlap=a.filter(word=>set.has(word)).length;return key(candidate)===key(example.negative)||(a.length>=5&&b.length>=5&&overlap/Math.max(a.length,b.length)>=.88);});
}
export function learningRisk(line:string){return needsFactCheck(line)||/\b(?:we (?:are|have|can|supply|make|manufacture|offer)|our (?:product|factory|purity|price)|(?:i|we)(?:'ll| will|’ll)|price is|purity|MOQ|manufactur\w*|produc\w*|certif\w*|guarantee|ship|deliver|free sample|(?:i|we) (?:can|could) (?:send|promise|offer|provide)|USD|CIF|FOB|COA|\d+(?:\.\d+)?\s*(?:tons?|units?|kg|%|dollars?))\b|\$/i.test(line.replace(/(?:okay[,\s]+)?(?:yeah[,\s]+)?100%[.!]?/ig,''));}
export function captureLearning(brain:CompanyBrainRecord,suggestionId:string,suggested:string,capture:LearningCapture):CompanyBrainRecord {
 if(capture.companyId!==brain.companyId)return brain;
 const prior=brain.learning.find(pair=>pair.suggestionId===suggestionId);
 if(prior)return prior.verdict==='unrated'&&prior.suggested!==suggested?{...brain,updatedAt:stamp(),learning:brain.learning.map(pair=>pair.id===prior.id?{...pair,suggested}:pair)}:brain;
 const pair:LearningPair={...structuredClone(capture),id:`${brain.companyId}:${suggestionId}`,suggestionId,suggested,actual:'',verdict:'unrated',outcome:'',at:stamp(),promoted:false,verified:false,evidence:[]};
 return {...brain,updatedAt:stamp(),learning:[...brain.learning,pair]};
}
export function rateLearning(brain:CompanyBrainRecord,suggestionId:string,verdict:LearningPair['verdict'],actual='',reason?:EditReason,actualSource:LearningPair['actualSource']='edited'):CompanyBrainRecord {
 const prior=brain.learning.find(pair=>pair.suggestionId===suggestionId);if(!prior)return brain;
 const nextActual=verdict==='Used'?(actual||prior.actual||prior.suggested):actual,changed=nextActual!==prior.actual||verdict!==prior.verdict;
 const feedbackAt=stamp();
 return {...brain,updatedAt:feedbackAt,playbook:changed?{...brain.playbook,examples:brain.playbook.examples.filter(example=>example.id!==`learned-${prior.id}`)}:brain.playbook,learning:brain.learning.map(pair=>pair.suggestionId===suggestionId?{...pair,verdict,actual:nextActual,reason:reason||pair.reason,actualSource,feedbackAt,...changed?{reviewStatus:'pending_manager' as const,promoted:false,verified:false,evidence:[]}:{}}:pair)};
}
export function promoteLearning(brain:CompanyBrainRecord,id:string,evidence:{sourceId:string;quote:string}[]=[]):CompanyBrainRecord {
 const pair=brain.learning.find(item=>item.id===id);if(!pair||!pair.actual||pair.companyId!==brain.companyId)return brain;
 if(learningRisk(pair.actual)&&!evidence.length&&!pair.verified)return brain;
 const example:ExampleLine={id:`learned-${pair.id}`,stageId:pair.stageId,moment:pair.moment as ExampleLine['moment'],text:pair.actual,negative:pair.verdict==='Edited'?pair.suggested:'',context:pair.buyerWindow.map(t=>t.text).join('\n').slice(-1500),approved:true,verified:pair.verified||!!evidence.length};
 return {...brain,updatedAt:stamp(),playbook:{...brain.playbook,examples:[...brain.playbook.examples.filter(item=>item.id!==example.id),example]},learning:brain.learning.map(item=>item.id===id?{...item,promoted:true,verified:example.verified===true,evidence:evidence.length?evidence:item.evidence}:item)};
}
export function rememberBuyer(brain:CompanyBrainRecord,buyer:string,state:ConversationState,call?:CallRecord,identity?:{clientId:string;contactId?:string}):CompanyBrainRecord {
 if(!buyer.trim())return brain;
 const association=identity||call?.clientId&&{clientId:call.clientId,contactId:call.contactId};
 const stableId=association?`client:${association.clientId}:contact:${association.contactId||'client'}`:undefined;
 const old=stableId?brain.buyers.find(item=>item.id===stableId):buyerMemoryFor(brain,buyer),id=stableId||old?.id||`buyer-${key(buyer)}`;
 const memory:BuyerMemory={...old?.excludedFacts?{excludedFacts:old.excludedFacts}:{},id,name:buyer,buyerNeeds:state.buyerNeeds,history:call?[...(old?.history||[]).filter(item=>item.callId!==call.id),{callId:call.id,at:call.startedAt,outcome:call.outcome,notes:call.notes}]:old?.history||[],facts:{...old?.facts,...state.facts},commitments:state.commitments.length?state.commitments:old?.commitments||[],sequence:state.sequence.length?state.sequence:old?.sequence||[],lastAgreedNextStep:state.lastAgreedNextStep||old?.lastAgreedNextStep||"",processedTurnIds:[...new Set([...(old?.processedTurnIds||[]),...(call?.turns||[]).map(t=>t.id)])].slice(-600),decisionsNeeded:call?.decisionsNeeded?.filter(item=>!item.checked).map(item=>item.text)||old?.decisionsNeeded||[],updatedAt:stamp()};
 return {...brain,updatedAt:stamp(),buyers:[...brain.buyers.filter(item=>item.id!==id),memory],learning:call?brain.learning.map(pair=>pair.callId===call.id||pair.buyer===buyer&&pair.callId===`draft-${call.startedAt}`?{...pair,outcome:call.outcome}:pair):brain.learning};
}
export function recordDecisions(brain:CompanyBrainRecord,call:CallRecord){
 const rows=(call.decisionsNeeded||[]).map(item=>({id:`${call.id}:${item.id}`,callId:call.id,text:item.text,checked:item.checked,outcome:call.outcome,at:Date.now()}));
 return {...brain,updatedAt:stamp(),decisionLog:[...brain.decisionLog.filter(item=>!rows.some(row=>row.id===item.id)),...rows]};
}
export function exportRatedDataset(brain:CompanyBrainRecord){return {schema:'trade-assist-rated-dataset-v1',companyId:brain.companyId,exportedAt:new Date().toISOString(),rows:brain.learning.filter(pair=>pair.verdict!=='unrated').map(pair=>({...pair,prompt:pair.prompt,context:{callContext:pair.callContext,state:pair.state,buyerWindow:pair.buyerWindow,request:pair.requestContext}}))};}
