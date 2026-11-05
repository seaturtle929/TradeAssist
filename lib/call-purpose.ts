import {onDemandSuggestionProblems} from './on-demand-coaching.ts';
import {clientContextNeedsInterpretation,clientContextSuggestionProblems,clientContextSafeReply,reviewedClientContext} from './client-coaching-context.ts';
import {applyCoachingConfiguration,configurationNeedsInterpretation,configurationSuggestionProblems,configuredSafeReply} from './coaching-configuration.ts';
import {generationFoundationFor} from './generation-foundation.ts';
import {foundationSuggestionProblems} from './general-foundation.ts';
import {matchesRejected,matchesAcceptedExample} from "./rejected-examples.ts";
import {analyzeBuyerText,isCompanyChoiceQuestion,spokenReplyBudget,substantiveBuyerQuestions} from './buyer-turn-intent.ts';
import {isSimpleMaterialHandoff} from './material-handoff.ts';
import {deriveConversationState,commitmentReply,validateLeadingQuestion,asksForEmailValue,currentCallMemory,hasAffirmativeMaterialsRequest,hasClearConversationRefusal,materialsNamed,affirmativeMaterialsNamed} from "./conversation-state.ts";
import {fieldEvidence} from "./buyer-facts.ts";
import {isSimpleBuyerGreeting} from "./opening-greeting.ts";
import {coldCallGateFor,isParticipantIntroduction,currentParticipantPickup} from "./call-participant.ts";
export {coldCallGateFor} from './call-participant.ts';
import {buildOpeningPlan,coldCallGateLineFor,isPermissionToContinue} from './sales-opening.ts';
import {needsQuestionPlan,discoveryQuestionProblems,gentleBoundaryReply} from './needs-guidance.ts';
export {isSimpleBuyerGreeting} from "./opening-greeting.ts";
import { conversationalReplyFor, containsAvoidedPhrase, needsFactCheck, productCategoryFor, safeContextReply, materialsRefusalReplyFor, unapprovedResponseDeadline, agreedResponseTimeSpans, type CoachingContext } from "./call-coaching.ts";
import type { Guidance } from "./trade";
import {assessReplyVerification,classifyBuyerTurn,declinedNumericCommitmentSpans} from './turn-verification-policy.ts';
import {learnedSuggestionProblems} from './learning-loop.ts';

export const RELATIONSHIPS=["first_contact","dormant","existing_customer","referral","inbound"] as const;
export type Relationship=typeof RELATIONSHIPS[number];
export type CallContext={relationship:Relationship;background:string;knownFacts:string;doNotGuess:string;goal:string;stageId:string};
export type StageDefinition={id:string;name:string;channel:"call"|"email"|"call/email"|"buyer-side";purpose:string;extract:string[];give:string[];hold:string[];exitCriteria:string};
export const EXAMPLE_MOMENTS=["price_test","polite_stall","trust_challenge","gatekeeper","spec_question","agreed_next_step","general","contact_handoff","opening"] as const;
export type ExampleMoment=typeof EXAMPLE_MOMENTS[number];
export type ExampleLine={id:string;moment:ExampleMoment;text:string;approved:boolean;stageId?:string;negative?:string;context?:string;verified?:boolean};
export type BuyerMoment=ExampleMoment|"contact_handoff"|"general";
export type PurposeContext=CoachingContext & {callContext?:unknown;stageMap?:unknown;exampleLines?:unknown;goal?:unknown};
export type PurposeTurn={id?:string;role:string;text:string;at?:number};
export type ChecklistItem={key:string;label:string;complete:boolean;required:boolean;value?:string;evidence?:{turnId:string;quote:string};source?:"transcript"|"context"|"memory"};

/** A worked example of process, never approval of a price, sample policy or term. */
export const DEFAULT_STAGE_MAP:StageDefinition[]=[
  {id:"cold_call",name:"Cold call",channel:"call",purpose:"Stage 0: briefly identify who is calling and why, and verify the purchasing contact before introducing products or exploring needs. Once verified, understand a relevant need, explain supported value and agree a useful next step when appropriate",extract:["Right person"],give:["Relevant supported product overview after the purchasing contact is verified","Useful evaluation or follow-up options when relevant"],hold:["Unapproved pricing or sample terms","Product specifications and needs discovery before the purchasing contact is verified"],exitCriteria:"The buyer's relevant need, interest, boundary or mutually agreed next step is clear"},
  {id:"spec_confirmation",name:"Spec confirmation",channel:"email",purpose:"Confirm the buyer's purchasing specifications",extract:["Grades","Particle sizes","Volumes"],give:["Approved specification sheets","Clarification questions"],hold:["Firm quote before specs are confirmed"],exitCriteria:"The required grades, particle sizes and volumes are captured"},
  {id:"quote_sample",name:"Quote + sample offer",channel:"call/email",purpose:"Deliver the approved quotation and discuss an authorized sample offer",extract:["Response to sample offer"],give:["Approved quotation","Sample offer only when Company Knowledge authorizes it"],hold:["Unapproved discounts","Unapproved sample terms"],exitCriteria:"The buyer responds to the quotation and any authorized sample proposal"},
  {id:"comparison",name:"Comparison",channel:"buyer-side",purpose:"Understand sample test results against the buyer's current material",extract:["Test feedback","Current price reference"],give:["Documented technical clarification"],hold:["Unapproved superiority claims","Unapproved concessions"],exitCriteria:"The buyer's actual test feedback and comparison basis are captured"},
  {id:"price_negotiation",name:"Price negotiation",channel:"call",purpose:"Resolve the buyer's price concern without unapproved concessions",extract:["Target price","Decision maker"],give:["Approved price and commercial conditions","Clarification of comparison basis"],hold:["Unapproved discounts","Unapproved price matching"],exitCriteria:"A decision maker's price target and the next commercial decision are clear"},
  {id:"close",name:"Close",channel:"call/email",purpose:"Confirm the purchase order and approved order terms",extract:["PO","Payment terms","Delivery terms"],give:["Approved order confirmation","Approved payment and delivery terms"],hold:["Unapproved payment or delivery promises"],exitCriteria:"The actual PO and mutually confirmed approved terms are recorded"},
];

export const DEFAULT_EXAMPLE_LINES:ExampleLine[]=[
  ["price_test","Let's compare the same grade and delivery terms. Is price the main thing you need to resolve?"],
  ["price_test","I don't want to guess at a comparison. What target are you working toward?"],
  ["polite_stall","I'll send the requested information. What's the best email address for you?"],
  ["polite_stall","After you've reviewed it, what would be a useful next step?"],
  ["trust_challenge","That's fair. What would you need to verify before considering another supplier?"],
  ["trust_challenge","I don't know that you have that problem. I should have asked rather than assumed."],
  ["gatekeeper","Could you point me to the person responsible for purchasing?"],
  ["gatekeeper","This concerns a possible raw-material supply option. Who is the right purchasing contact?"],
  ["spec_question","Let me check the exact specification rather than give you a rough figure."],
  ["spec_question","I'll use the approved specification for that grade so we keep the units and conditions clear."],
].map(([moment,text],index)=>({id:`draft-example-${index+1}`,moment:moment as ExampleMoment,text,approved:false}));

const record=(value:unknown):Record<string,unknown>=>value && typeof value==="object" && !Array.isArray(value) ? value as Record<string,unknown> : {};
const text=(value:unknown,max=3000)=>typeof value==="string" ? value.trim().slice(0,max) : "";
const list=(value:unknown,max=12)=>Array.isArray(value) ? [...new Set(value.map(item=>text(item,240)).filter(Boolean))].slice(0,max) : [];
const slug=(value:string)=>value.toLowerCase().replace(/[^a-z0-9]+/g,"_").replace(/^_|_$/g,"");
const words=(value:string)=>value.match(/\S+/g)?.length || 0;
const normalized=(value:string)=>value.toLowerCase().replace(/[’‘]/g,"'").replace(/\s+/g," ").trim();
const emailPattern=/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}|\b[a-z0-9._+-]+\s+at\s+[a-z0-9.-]+\s+dot\s+[a-z]{2,}\b/ig;

/** A narrow check for a receipt script that contains no response to a new
 * concern. Unknown substantive wording is left to the contextual checks; this
 * does not require a question or prescribe how an objection must be handled. */
function isOnlyDeliveryAndClosing(say:string):boolean {
  const line=normalized(say).replace(emailPattern,' ').replace(/\b[a-z]{1,5}-?\d{2,5}\b/g,' ');
  if(line.includes('?')||!/\b(?:send|email|share|forward|attach)\b/.test(line))return false;
  const receiptWords=new Set('i ill im we well will can could shall am are the a an our your my you me us it its them their this that these those and or to for from at in on over with there then before after so as of have has be is been send sending sent email emailing share sharing forward forwarding attach attaching include including discuss discussing prices price quote quotes quotation review reviewing engineer engineers engineering team company product products profile profiles docs document documents material materials information info spec specs specification specifications drawing drawings catalog catalogue brochure website link copy requested agreed address received receive got okay ok sure yes yeah great perfect understood thanks thank time today much very again appreciate help goodbye bye'.split(' '));
  return (line.replace(/'/g,'').match(/[a-z]+/g)||[]).every(word=>receiptWords.has(word));
}

export function defaultCallContext(goal="Understand the buyer's needs and agree a useful next step"):CallContext {
  return {relationship:"first_contact",background:"",knownFacts:"",doNotGuess:"",goal:goal.slice(0,1000),stageId:"cold_call"};
}
export function normalizeCallContext(value:unknown,goal?:string):CallContext {
  const raw=record(value),defaults=defaultCallContext(goal);
  return {relationship:RELATIONSHIPS.includes(raw.relationship as Relationship) ? raw.relationship as Relationship : defaults.relationship,background:text(raw.background,4000),knownFacts:text(raw.knownFacts,5000),doNotGuess:text(raw.doNotGuess,3000),goal:text(raw.goal,1000)||defaults.goal,stageId:text(raw.stageId,120)||defaults.stageId};
}
export function normalizeStageMap(value:unknown):StageDefinition[] {
  if(!Array.isArray(value))return structuredClone(DEFAULT_STAGE_MAP);
  const seen=new Set<string>(),stages:StageDefinition[]=[];
  for(const item of value.slice(0,15)) {
    // IDs are persisted call references, not labels. A manager rename or a
    // UUID's hyphens must not create a different stage on request projection.
    const raw=record(item),id=text(raw.id,120)||slug(text(raw.name,120));
    if(!id || seen.has(id) || !text(raw.name,120)||!text(raw.purpose,1000))continue;
    seen.add(id);stages.push({id,name:text(raw.name,120),channel:["call","email","call/email","buyer-side"].includes(String(raw.channel)) ? raw.channel as StageDefinition["channel"] : "call",purpose:text(raw.purpose,1000),extract:list(raw.extract),give:list(raw.give),hold:list(raw.hold),exitCriteria:text(raw.exitCriteria,1000)});
  }
  return stages.length ? stages : structuredClone(DEFAULT_STAGE_MAP);
}
export function normalizeExampleLines(value:unknown):ExampleLine[] {
  if(!Array.isArray(value))return structuredClone(DEFAULT_EXAMPLE_LINES);
  return value.slice(0,200).flatMap((item,index)=>{
    const raw=record(item),moment=raw.moment as ExampleMoment,line=text(raw.text,700),id=text(raw.id,120)||`example-${index+1}`,stageId=text(raw.stageId,120);
    if(id.startsWith('learned-')&&!stageId)return [];
    return EXAMPLE_MOMENTS.includes(moment)&&line ? [{id,moment,text:line,approved:raw.approved===true,...stageId?{stageId}:{},negative:text(raw.negative,700),context:text(raw.context,1500),verified:raw.verified===true}] : [];
  });
}
const latestBuyer=(context:PurposeContext)=>[...(context.turns||[])].reverse().find(turn=>turn.role!=="you")?.text || "";
function selectedStage(context:PurposeContext) {
  context=applyCoachingConfiguration(context);
  const callContext=normalizeCallContext(context.callContext,typeof context.goal==="string" ? context.goal : undefined),map=normalizeStageMap(context.stageMap);
  const state=deriveConversationState({...context,callId:context.callId,turns:context.turns,companyConfiguration:context.companyConfiguration,callContext,stageMap:map,buyerMemory:context.brain?.buyerMemory});
  const configured=map.find(stage=>stage.id===state.stageId)||map[0];
  return {callContext,stage:{...configured,purpose:state.stagePurpose}};
}
export function checklistFor(context:PurposeContext,turns:PurposeTurn[]=context.turns||[]):ChecklistItem[] {
  const {callContext,stage}=selectedStage(context),labels=[...new Set([...stage.extract,"Right person","Email","Specs","Current supplier","Decision maker"])];
  const state=deriveConversationState({...context,turns,callContext,stageMap:normalizeStageMap(context.stageMap),buyerMemory:context.brain?.buyerMemory});
  return labels.map(label=>{
    if(/email|e_mail/.test(slug(label))){
      const evidence=state.facts.email;
      return {key:slug(label),label,required:stage.extract.some(item=>slug(item)===slug(label)),complete:!!evidence,...evidence?{value:evidence.value,evidence:{turnId:evidence.turnId,quote:evidence.quote},source:evidence.source}:{}};
    }
    const key=slug(label),actual=fieldEvidence(label,turns);
    // A human-entered known fact is usable context, never a transcript quotation.
    const unknown=callContext.doNotGuess.toLowerCase().includes(label.toLowerCase());
    const entered=!unknown&&callContext.knownFacts ? fieldEvidence(label,[{id:"call-context",role:"buyer",text:callContext.knownFacts}]) : undefined;
    const memories=currentCallMemory(context.callId,context.brain?.buyerMemory)?.facts;
    const remembered=!unknown?(memories?.[key]||fieldEvidence(label,Object.values(memories||{}).map(fact=>({id:fact.turnId,role:"buyer",text:fact.quote})))):undefined;
    const historical=state.facts[key]?.source==='context'&&state.facts[key]?.turnId.startsWith('client-')?state.facts[key]:undefined;
    const evidence=actual||entered||historical||(remembered?.value?remembered:undefined);
    return {key,label,required:stage.extract.some(item=>slug(item)===key),complete:!!evidence,...evidence ? {value:evidence.value,evidence:{turnId:evidence.turnId,quote:evidence.quote},source:actual ? "transcript" as const : entered||historical?"context" as const:"memory" as const} : {}};
  });
}
function questionFor(label:string):string {
  const key=slug(label);
  if(/email/.test(key))return "What's the best email address for the relevant information?";
  if(/right_person|purchasing_contact/.test(key))return "Are you the right person for purchasing this material?";
  if(/decision/.test(key))return "Who makes the final purchasing decision with you?";
  if(/target|budget/.test(key))return "What target price would make this workable for you?";
  if(/current_price|price_reference/.test(key))return "What current price and delivery terms should we compare against?";
  if(/particle|size/.test(key))return "Which particle sizes do you need?";
  if(/grade|spec/.test(key))return "Which grades are you using?";
  if(/volume|quantity/.test(key))return "What volume do you need for that grade?";
  if(/sample/.test(key))return "Would you like to review the approved sample proposal?";
  if(/feedback|test/.test(key))return "What did your team's testing show?";
  if(key==="po")return "What's the next step for your purchase order?";
  if(/payment/.test(key))return "Which payment terms does your purchasing team require?";
  if(/delivery/.test(key))return "Which delivery terms and destination do you need?";
  return `What should we clarify about ${label.toLowerCase()}?`;
}
/** A stage checklist is a memory aid, not permission to skip the conversation. */
export function conversationFlowFor(context:PurposeContext) {
  context=applyCoachingConfiguration(context);
  const {callContext,stage}=selectedStage(context),latest=latestBuyer(context),turns=context.turns||[];
  const state=deriveConversationState({...context,callContext,stageMap:normalizeStageMap(context.stageMap),buyerMemory:context.brain?.buyerMemory});
  const participant=state.participant,introduced=!participant.introductionNeeded;
  const question=analyzeBuyerText(latest);
  const closing=hasClearConversationRefusal(latest)||!question.hasQuestion&&!question.requests.length&&/\b(?:goodbye|that's all|that is all)\b/i.test(latest);
  const contact=!!conversationalReplyFor(context);
  const confirmedBuyer=turns.findLast(turn=>turn.role!=="you")?.role==='buyer';
  const requestedMaterials=confirmedBuyer&&hasAffirmativeMaterialsRequest(latest);
  const explicitNextStep=confirmedBuyer&&/\b(?:let's (?:schedule|set up|move|proceed)|I'd like (?:a quote|to (?:review|meet|proceed))|can we (?:schedule|set up)|send (?:me|us) (?:a |the )?(?:quote|quotation)|what(?:'s| is) the next step)\b/i.test(latest);
  const greeting=/^\s*(?:(?:well|yes|yeah|okay|ok)[,.]?\s*)?(?:hello|hi|hey|good (?:morning|afternoon|evening)|this is|[a-z][a-z '\-]{0,35} speaking|[a-z][a-z '\-]{0,35} here)\b/i.test(latest) && !/\b(?:purity|MOQ|certif\w*|price|stock|inventory|lead time|send|quote)\b/i.test(latest);
  const identityQuestion=/who(?:'s| is) (?:calling|this)|who are you|what(?:'s| is) this (?:about|regarding)|how can I help/i.test(latest);
  const currentIntroduction=isParticipantIntroduction(latest);
  const latestTurn=turns.at(-1);
  const currentPickup=latestTurn?.role==='buyer'?currentParticipantPickup(latestTurn,participant):undefined;
  const greetingPickup=currentPickup?.kind==='greeting_only';
  const stageAllowsOpening=currentPickup?.kind!=='substantive'&&!reviewedClientContext(context)?.isReturning&&(!context.companyConfiguration||["cold_call","opening","gatekeeper"].includes(stage.id));
  const openingNeeded=greetingPickup||stageAllowsOpening&&!introduced&&(greeting||identityQuestion||currentIntroduction||state.nextAction.kind==="introduce_contact"||!turns.some(turn=>turn.role==="you"));
  const gate=currentPickup?.kind==='substantive'?null:coldCallGateFor({...context,callContext,conversationState:state});
  const gatekeeper=!!gate||participant.role==="routing"||(context.callType==="gatekeeper"&&participant.role==="unknown"&&!participant.afterTransfer);
  const directFact=/\b(?:what|which|how|tell|confirm|give)\b.{0,80}\b(?:purity|spec|certif\w*|MOQ|minimum order|lead time|price|stock|inventory)\b|\b(?:CIF|FOB) price\b/i.test(latest);
  const attendingCurrentConcern=!!state.immediateObjective&&state.immediateObjective.kind!=='complete_commitment'&&state.immediateObjective.kind!=='continue_conversation'||!!state.deferredCommitments?.length;
  const contactAppropriate=!closing&&!attendingCurrentConcern&&state.nextAction.kind!=="confirm_handoff_plan"&&(['capture_email','confirm_send'].includes(state.nextAction.kind)||contact||requestedMaterials||explicitNextStep);
  const phase=closing ? "closing" : greetingPickup ? "opening" : gate ? "routing" : stageAllowsOpening&&state.nextAction.kind==="introduce_contact" ? "opening" : contactAppropriate ? "next_step" : gatekeeper&&!directFact ? "routing" : openingNeeded&&(greeting||identityQuestion||currentIntroduction) ? "opening" : /negotiat/.test(stage.id+" "+stage.name) ? "negotiation" : "discovery";
  return {phase,participant,openingNeeded:phase==="opening",contactAppropriate:phase!=="opening"&&contactAppropriate,reason:phase==="opening" ? "Introduce the representative/company and the reason for calling to this person before asking for buyer details." : phase==="next_step" ? "The buyer requested or accepted a concrete next step; confirm only the practical detail still missing." : phase==="routing" ? "Reach the purchasing contact; acknowledge an offered transfer without asking again." : phase==="closing" ? "Respect the buyer's boundary and end politely." : participant.role==="unknown"?"The person's role is not yet known. Respond first; clarify purchasing responsibility before treating them as a buyer when useful.":"Respond to this turn and learn about the buyer's stated needs; the checklist does not require a contact request."};
}
function introductionFor(context:PurposeContext):string {
  const {callContext}=selectedStage(context),name=text(context.manufacturer?.name,180),category=productCategoryFor(context);
  const identity=name&&words(name)<=12 ? `Hi, I'm with ${name}.` : "Hi, thanks for taking my call.";
  const subject=category||"your purchasing needs";
  const purpose=callContext.relationship==="dormant" ? `I'm calling to reconnect about ${subject} and hear what you're looking for now.`
    : callContext.relationship==="existing_customer" ? `I'm calling to check in on ${subject} and hear what you need next.`
    : `I'm calling about ${subject}—is this a good time for a quick introduction?`;
  return `${identity} ${purpose}`;
}
const ordinaryOpeningGoals=new Set([
  "understand the buyer's needs and agree a useful next step",
  "confirm interest and agree a next step",
  "confirm interest and agree a useful next step",
  "qualify need and agree one next step",
  "agree a useful next step",
]);
function routingReplyFor(context:PurposeContext):string {
  const state=deriveConversationState({...context,stageMap:normalizeStageMap(context.stageMap),buyerMemory:context.brain?.buyerMemory}),latest=latestBuyer(context);
  const gate=coldCallGateFor({...context,conversationState:state});
  if(gate)return coldCallGateLineFor(context,gate.kind);
  if(state.participant.transferPending)return "Thank you, I'll hold while you connect us.";
  const category=productCategoryFor(context)||"this material",name=text(context.manufacturer?.name,180);
  const identityQuestion=/who(?:'s| is) (?:calling|this)|who are you|what(?:'s| is) this (?:about|regarding)/i.test(latest);
  const prefix=(state.participant.introductionNeeded||identityQuestion)&&name&&words(name)<=12?`Hi, I'm with ${name}, calling about ${category}. `:"";
  const unavailable=/\b(?:unavailable|not (?:in|here|available)|out of (?:the )?office|can't transfer|cannot transfer)\b/i.test(latest);
  const question=unavailable?"What's the best way to reach the person who handles purchasing?":/\bour (?:buyer|purchasing manager|procurement manager|purchasing contact) is\b/i.test(latest)?"Could you put me through to them?":"Could you connect me with the person who handles purchasing?";
  return prefix+question;
}
function immediateOpening(context:PurposeContext,callContext:CallContext,stage:StageDefinition):Guidance|undefined {
  const state=deriveConversationState({...context,stageMap:normalizeStageMap(context.stageMap),buyerMemory:context.brain?.buyerMemory});
  if((stage.id!=="cold_call"&&state.nextAction.kind!=="introduce_contact")||callContext.relationship!=="first_contact"||![undefined,"discovery","gatekeeper"].includes(context.callType as undefined|string)||state.participant.role==="routing")return;
  if(callContext.background||callContext.knownFacts||callContext.doNotGuess||!ordinaryOpeningGoals.has(normalized(callContext.goal)))return;
  const allTurns=context.turns||[],start=state.participant.afterTransfer?allTurns.findIndex(turn=>turn.id===state.participant.segmentStartTurnId):0;
  const turns=start>=0?allTurns.slice(start):allTurns,buyerTurns=turns.filter(turn=>turn.role!=="you");
  if(turns.some(turn=>turn.role==="you")||!buyerTurns.length||buyerTurns.some(turn=>turn.role!=="buyer"||!isParticipantIntroduction(turn.text)))return;
  const name=text(context.manufacturer?.name,180),category=productCategoryFor(context);
  if(!name||words(name)>12||!category)return;
  const notes=(context.voice as {notes?:string}|undefined)?.notes||"";
  const knownName=notes.match(/\b(?:[Mm]y name is|[Mm]y name's|[Rr]epresentative(?:'s)? name:|[Ss]alesperson(?:'s)? name:)\s*([A-Z][a-z'-]{1,24}(?: [A-Z][a-z'-]{1,24})?)(?=[,.!;\n]|$)/)?.[1];
  const identity=knownName?`Hi, I'm ${knownName} with ${name}.`:`Hi, I'm with ${name}.`;
  const candidates=[buildOpeningPlan(context).opening,`${identity} I'm calling about ${category}—do you have a moment?`,`${identity} I'm calling about ${category}—is now a good time?`];
  const avoid=[...(context.voice?.avoid||[]),...(context.brain?.rules?.phrasesToAvoid?.split('\n').filter(Boolean)||[])];
  for(const say of candidates){
    if(containsAvoidedPhrase(say,avoid))continue;
    const guidance=guidanceFor(say,context,"Introduce yourself and the reason for calling");
    const checked=checkSuggestion(guidance,context);
    if(checked.ok&&!checked.needsVerification)return {...guidance,moment:context.bilingual?"买方开场问候":"Buyer greeting",move:context.bilingual?"介绍身份与来意":"Introduce yourself and why you’re calling",why:context.bilingual?"先说明身份与来意，再征求交谈许可。":"Start with who you are and why you’re calling."};
  }
}
export function proactiveMoveFor(context:PurposeContext):string {
  context=applyCoachingConfiguration(context);
  const configured=configuredSafeReply(context);if(configured)return configured;
  const {stage}=selectedStage(context),checklist=checklistFor(context),flow=conversationFlowFor(context);
  const state=deriveConversationState({...context,stageMap:normalizeStageMap(context.stageMap),buyerMemory:context.brain?.buyerMemory});
  const gate=coldCallGateFor({...context,conversationState:state});if(gate)return coldCallGateLineFor(context,gate.kind);
  if(state.nextAction.kind==='respect_refusal')return /contact|take (?:me|us) off/i.test(latestBuyer(context))?"Understood. I won't contact you again.":/don't call|do not call|stop calling/i.test(latestBuyer(context))?"Understood. I won't call again.":"Understood. Thanks for your time.";
  if(state.nextAction.kind==='address_objection'||state.nextAction.kind==='respond_to_question')return safeContextReply(context);
  if(state.nextAction.kind==='clarify_uncertainty')return gentleBoundaryReply(latestBuyer(context))||"Of course. There's no need to decide before you have the information you need.";
  if(state.nextAction.kind==='acknowledge_correction')return "Thanks for clarifying that. I'll use the requirement you just gave me as we work through the options.";
  if(state.nextAction.kind==="confirm_handoff_plan")return "Your colleague suggested a profile for review. Would that be useful for you?";
  const agreed=commitmentReply(state);if(agreed&&flow.phase!=="closing")return agreed;
  if(flow.openingNeeded)return introductionFor(context);
  if(flow.phase==="closing")return "Understood. I'll leave it there.";
  if(flow.phase==="routing")return routingReplyFor(context);
  if(flow.contactAppropriate) {
    if(conversationalReplyFor(context))return conversationalReplyFor(context)!.say;
    return checklist.some(item=>item.key==="email"&&item.complete) ? "I'll send the requested information to the address you shared." : "What's the best email address for the information you requested?";
  }
  // Early interest comes from a relevant question, not the contact database fields.
  if(stage.id==="cold_call") {
    if(isPermissionToContinue(context))return buildOpeningPlan(context).followUp;
    return needsQuestionPlan(state,context).say;
  }
  const gap=checklist.find(item=>item.required&&!item.complete&&!/email|right_person|purchasing_contact/.test(item.key));
  if(gap)return questionFor(gap.label);
  return "What would be the most useful next step for you?";
}
function momentFor(line:string):BuyerMoment {
  if(/what(?:'s| is) this (?:about|regarding)|who(?:'s| is) (?:calling|this)|who are you/i.test(line))return "opening";
  if(isCompanyChoiceQuestion(line)||/how do (?:I|we) know|why (?:trust|should (?:I|we) trust)|proof|prove|trust|reliab/i.test(line))return "trust_challenge";
  if(/\b(?:what|which|how|confirm|tell|give)\b.{0,90}\b(?:spec|purity|content|percentage|Al[₂2]?O[₃3]?|certif\w*|MOQ|lead time|stock|inventory|price|CIF|FOB)\b|\b(?:CIF|FOB) price\b/i.test(line))return /price|CIF|FOB/i.test(line) ? "price_test" : "spec_question";
  if(/higher|cheaper|expensive|price|discount|cost too much/i.test(line))return "price_test";
  if(/send (?:me|us)|email (?:me|us)|think about it|review/i.test(line))return "polite_stall";
  if(new RegExp(emailPattern.source,"i").test(line))return "contact_handoff";
  return "general";
}
export function getPurposeContext(context:PurposeContext,options:{observationOnly?:boolean}={}) {
  const {callContext,stage}=selectedStage(context);
  const conversationState=deriveConversationState({...context,callContext,stageMap:normalizeStageMap(context.stageMap),buyerMemory:context.brain?.buyerMemory});
  const conversationFlow=conversationFlowFor(context);
  // Passive UI observation maintains state; literal moves and questions are
  // prepared only inside an explicit generation request.
  return {callContext,stage,conversationState,conversationFlow,checklist:checklistFor(context),nextMove:options.observationOnly?'':proactiveMoveFor(context),questionPlan:options.observationOnly||conversationFlow.openingNeeded?undefined:needsQuestionPlan(conversationState,context),examples:options.observationOnly?[]:normalizeExampleLines(context.exampleLines).filter(example=>example.approved && example.moment===conversationState.moment && (!example.stageId || example.stageId===conversationState.stageId)).slice(0,3)};
}
function guidanceFor(say:string,context:PurposeContext,move:string):Guidance {
  const {stage}=selectedStage(context),zh=!!context.bilingual;
  return {say,ask:"",intent:move,nextStep:"",caution:"",evidence:[],missing:[],stageId:stage.id,stage:stage.name,moment:zh ? "根据通话背景推进" : "Responding to the current buyer",move:zh ? "推进当前阶段目标" : move,backup:"",why:zh ? "先回应，再推进当前目标。" : "Respond and advance the current stage purpose.",buyerIntent:zh ? "买方意图仍需确认。" : "",verified:true};
}
export function coldCallGateGuidance(context:PurposeContext):Guidance|undefined {
  context=applyCoachingConfiguration(context);
  if(context.coachingRequest||configurationNeedsInterpretation(context)||clientContextNeedsInterpretation(context))return;
  const state=deriveConversationState({...context,stageMap:normalizeStageMap(context.stageMap),buyerMemory:context.brain?.buyerMemory});
  const gate=coldCallGateFor({...context,conversationState:state});if(!gate)return;
  const say=coldCallGateLineFor(context,gate.kind);if(!say)return;
  const move=gate.kind==='transfer_wait'?'Wait for the offered transfer':gate.kind==='unavailable_contact'?'Collect the purchasing contact and return time':gate.kind==='gatekeeper_intent'?'Explain the purpose and earn a transfer':'Introduce who and why, then verify the purchasing contact';
  return {...guidanceFor(say,context,move),moment:context.bilingual?'先确认采购联系人':'Cold-call Stage 0',why:context.bilingual?'先说明身份与来意，找到采购负责人后再了解需求。':'Briefly identify who is calling and the purpose before reaching purchasing; no product pitch.'};
}
export function fastRouteFor(context:PurposeContext):{verificationRequired:boolean;moment:BuyerMoment;directGuidance?:Guidance;directFactChecked?:boolean} {
  context=applyCoachingConfiguration(context);
  if(context.coachingRequest||configurationNeedsInterpretation(context)||clientContextNeedsInterpretation(context))return {verificationRequired:classifyBuyerTurn(context).kind==='fact_request',moment:momentFor(latestBuyer(context))};
  const latest=latestBuyer(context),moment=momentFor(latest),{callContext,stage}=selectedStage(context);
  const exactFact=/\b(?:what|which|how|confirm|tell|give|need|demand)\b.{0,90}\b(?:spec|purity|content|percentage|Al[₂2]?O[₃3]?|certif\w*|MOQ|lead time|stock|inventory|CIF|FOB)\b|\b(?:CIF|FOB)\s+price\b|\b(?:stock|inventory)\s*(?:level|available|now|today|\?)\b/i.test(latest);
  const route:ReturnType<typeof fastRouteFor>={verificationRequired:classifyBuyerTurn(context).kind==='fact_request'&&exactFact,moment};
  if(!context.callContext)return route;
  const state=deriveConversationState({...context,stageMap:normalizeStageMap(context.stageMap),buyerMemory:context.brain?.buyerMemory});
  const gateGuidance=coldCallGateGuidance(context);
  if(gateGuidance){const checked=checkSuggestion(gateGuidance,context);if(checked.ok&&!checked.needsVerification){route.verificationRequired=false;route.moment='gatekeeper';route.directGuidance=gateGuidance;return route;}}
  const refusal=materialsRefusalReplyFor(context,state);
  if(refusal){
    const value=guidanceFor(refusal,context,"Respect the buyer's delivery preference");
    const checked=checkSuggestion(value,context);
    if(checked.ok&&!checked.needsVerification){route.verificationRequired=false;route.directGuidance=value;return route;}
  }
  if(isSimpleMaterialHandoff(context,state)){
    const preferred=context.brain?.learningExamples?.some(item=>/100%/.test(item.actual||item.positive||''))?'Okay, yeah, 100%.':'Okay.';
    for(const prefix of [preferred,'Got it.','']){
      const say=commitmentReply(state,prefix)?.trim();if(!say)continue;
      const value=guidanceFor(say,context,'Confirm the requested materials and sending address');
      const checked=checkSuggestion(value,context);
      if(checked.ok&&!checked.needsVerification){route.verificationRequired=false;route.directGuidance=value;return route;}
    }
  }
  if(state.movedPastDiscovery&&state.nextAction.kind!=="introduce_contact")return route;
  const opening=immediateOpening(context,callContext,stage);
  if(opening){route.verificationRequired=false;route.moment="opening";route.directGuidance=opening;return route;}
  if(!exactFact&&isPermissionToContinue(context)&&conversationFlowFor(context).phase!=='routing') {
    const plan=buildOpeningPlan(context),value={...guidanceFor(plan.followUp,context,'Establish relevance and invite the buyer’s perspective'),evidence:plan.companyEvidence};
    const checked=checkSuggestion(value,context,{factChecked:plan.companyEvidence.length>0});
    if(checked.ok){route.moment='opening';route.directGuidance=value;route.directFactChecked=plan.companyEvidence.length>0;return route;}
  }
  const buyerIntent=analyzeBuyerText(latest);
  const boundary=!buyerIntent.hasQuestion&&!buyerIntent.requests.length&&!/\b(?:don't call|do not call|stop calling|take (?:me|us) off)\b/i.test(latest)?gentleBoundaryReply(latest):undefined;
  if(!exactFact&&boundary){
    const value=guidanceFor(boundary,context,'Give the buyer room to think or decline');
    const checked=checkSuggestion(value,context);if(checked.ok&&!checked.needsVerification){route.directGuidance=value;return route;}
  }
  const latestTurn=[...(context.turns||[])].reverse().find(turn=>turn.role!=="you");
  const routingCue=state.participant.evidence?.turnId===latestTurn?.id||state.participant.transferPending||context.callType==="gatekeeper"&&isSimpleBuyerGreeting(latest);
  if(!exactFact&&routingCue&&(!buyerIntent.hasQuestion||isSimpleBuyerGreeting(latest))&&conversationFlowFor(context).phase==="routing"){
    const value=guidanceFor(routingReplyFor(context),context,state.participant.transferPending?"Wait for the transfer":"Reach the purchasing contact");
    const checked=checkSuggestion(value,context);
    if(checked.ok&&!checked.needsVerification){route.moment="gatekeeper";route.directGuidance=value;return route;}
  }
  const holdPrice=stage.hold.some(item=>/pric|quot/i.test(item)&&!/discount|matching|concession/i.test(item));
  if(moment==="price_test" && holdPrice && /CIF|FOB|quot|(?:give|what|need|price).{0,30}price|\bprice[,?]/i.test(latest)) {
    const checklist=checklistFor(context),specKnown=checklist.some(item=>/specs|grades/.test(item.key)&&item.complete);
    const advance=specKnown ? "Which delivery terms and destination should the quote cover?" : "Which grade or specification should the quote cover?";
    route.verificationRequired=false;route.directGuidance=guidanceFor(`I'll confirm a quote against your requirements. ${advance}`,context,"Clarify the basis for the requested quote");return route;
  }
  if(moment==="price_test" && /price_negotiation|negotiation/.test(stage.id+" "+stage.name)) {
    route.verificationRequired=false;route.directGuidance=guidanceFor(`Let's work through the quote on the same order and delivery terms. ${proactiveMoveFor(context)}`,context,"Clarify the price decision");return route;
  }

  return route;
}
export function bridgeFor(context:PurposeContext,options:{question?:boolean}={}):Guidance {
  const latest=latestBuyer(context),gap=checklistFor(context).find(item=>item.required&&!item.complete);
  if(options.question && gap && !/cannot share|can't share|won't share|rather not|not comfortable|not interested|don't call|stop calling/i.test(latest)) {
    const question=questionFor(gap.label);
    return guidanceFor(`While I pull that up — ${question.charAt(0).toLowerCase()+question.slice(1)}`,context,"Check the source and clarify a useful requirement");
  }
  // A pure bridge never guesses a fact or asks a question the buyer declined.
  return guidanceFor("Let me pull the exact figure so I don't give you a guess.",context,"Check the original document");
}

/** Last safe output after one failed regeneration; never invent a missing figure. */
export function safePurposeReply(context:PurposeContext,options:{landing?:boolean}={}):Guidance {
  if(context.coachingRequest){
    const latest=latestBuyer(context);
    const refusal=hasClearConversationRefusal(latest);
    return guidanceFor(refusal ? /stop (?:calling|contacting)|don[’']t (?:call|contact)|do not (?:call|contact)/i.test(latest) ? "Understood. I won't call again." : 'Understood. Thanks for your time.' : 'Let me make sure I have that right before we move on.',context,refusal?'Respect the buyer’s decision':'Clarify before committing');
  }
  context=applyCoachingConfiguration(context);
  const continuity=clientContextSafeReply(context);if(continuity)return guidanceFor(continuity,context,'Use reviewed client continuity');
  const configured=configuredSafeReply(context);if(configured)return guidanceFor(configured,context,'Respond within the active stage and authority');
  const latest=latestBuyer(context);
  const conversationState=deriveConversationState({...context,stageMap:normalizeStageMap(context.stageMap),buyerMemory:context.brain?.buyerMemory});
  const gateGuidance=coldCallGateGuidance(context);if(gateGuidance)return gateGuidance;
  const refusal=materialsRefusalReplyFor(context,conversationState);
  if(refusal)return guidanceFor(refusal,context,"Respect the buyer's delivery preference");
  if(['respect_refusal','address_objection','clarify_uncertainty','acknowledge_correction'].includes(conversationState.nextAction.kind))return guidanceFor(proactiveMoveFor(context),context,conversationState.nextAction.purpose);
  const questions=substantiveBuyerQuestions(context);
  const agreedReply=commitmentReply(conversationState,context.brain?.learningExamples?.some(item=>/100%/.test(item.actual||item.positive||""))?"Okay, yeah, 100%.":"Okay.");
  if(agreedReply&&!questions.length&&!fastRouteFor(context).verificationRequired&&!/not interested|don't call|do not call|stop calling/i.test(latestBuyer(context)))return guidanceFor(agreedReply,context,"Complete the agreed sequence and its missing information");
  if(questions.length&&questions.every(isCompanyChoiceQuestion))return guidanceFor(safeContextReply(context),context,"Explain the basis for judging supplier fit");
  const hasPendingFactualQuestion=questions.some(question=>/\b(?:MOQ|minimum order|minimum quantity|purity|content|Al[₂2]?O[₃3]?|specifications?|certif\w*|lead[- ]?time|stock|inventory|prices?|quot\w*|CIF|FOB|payment|delivery terms)\b/i.test(question));
  if(questions.length&&conversationState.movedPastDiscovery&&(classifyBuyerTurn(context).kind==='fact_request'||hasPendingFactualQuestion)){
    const subject=questions.some(question=>/\b(?:MOQ|minimum order|minimum quantity)\b/i.test(question))?'minimum order quantity':'details you asked about';
    return {...guidanceFor(`I need to verify the ${subject} before giving you an answer. I'll confirm it in writing with the requested information.`,context,"Resolve the buyer's unanswered question and requested follow-up"),missing:questions,caution:context.bilingual?'买方的问题仍待核实，发送资料不代表已回答。':'The buyer’s question is still unresolved; sending documents does not answer it.'};
  }
  if(options.landing) {
    const guidance=guidanceFor("I don't have that exact figure confirmed. I'll confirm it with the factory and send it in writing.",context,"Resolve the check with a written confirmation");
    return {...guidance,missing:[latest || "The requested company fact"],caution:context.bilingual ? "该事实尚未在资料中核实。" : "The requested fact was not verified in the supplied documents."};
  }
  if(conversationFlowFor(context).openingNeeded)return guidanceFor(introductionFor(context),context,"Introduce the company and reason for calling");
  if(momentFor(latest)==='opening')return guidanceFor(safeContextReply(context),context,"Answer who is calling and why");
  const routed=fastRouteFor(context).directGuidance;if(routed)return routed;
  if(/take (?:us|me) off|don't call|do not call|stop calling/i.test(latest))return guidanceFor("Understood. I won't call again.",context,"Respect the buyer's boundary");
  if(/thanks.*(?:all|bye)|goodbye|that's all|that is all/i.test(latest))return guidanceFor("You're welcome. I'll leave it there.",context,"Respect the buyer's close");
  const handoff=conversationalReplyFor(context);if(handoff)return guidanceFor(handoff.say,context,"Confirm the requested materials");
  const {stage}=selectedStage(context),move=proactiveMoveFor(context);
  if(momentFor(latest)==="gatekeeper") {
    const name=context.manufacturer?.name?.trim();
    const introduction=name && words(name)<=12 ? `I'm with ${name}. ` : "";
    const category=/abrasiv|alumina|silicon carbide|corundum/i.test(context.manufacturer?.products||"") ? "abrasive raw-material purchasing" : "purchasing";
    return guidanceFor(`${introduction}Who handles ${category} at your company?`,context,"Identify the relevant purchasing contact");
  }
  if(/not interested/i.test(latest))return guidanceFor("Understood. Thanks for your time.",context,"Respect the buyer's decision");
  if(conversationFlowFor(context).contactAppropriate)return guidanceFor(checklistFor(context).some(item=>item.key==="email"&&item.complete) ? safeContextReply(context) : `I'll send the requested materials for you to review. What's the best email address?`,context,"Follow the buyer's requested next step");
  if(/higher|expensive|cost too much|cheaper/i.test(latest))return guidanceFor("Is price the main concern, or is there something else you need from a supplier?",context,"Understand the buyer's concern");
  if(/supplier/i.test(latest))return guidanceFor(move,context,"Learn what would make an alternative relevant");
  const say=move;
  return guidanceFor(say,context,`Advance ${stage.name.toLowerCase()}`);
}

export function checkSuggestion(guidance:Partial<Guidance>,context:PurposeContext,options:{landing?:boolean;factChecked?:boolean;partial?:boolean}={}) {
  context=applyCoachingConfiguration(context);
  const say=guidance.say?.trim()||"",reasons:string[]=[],{callContext,stage}=selectedStage(context),latest=latestBuyer(context),normal=normalized(say);
  if(!say)reasons.push("No spoken answer was supplied");
  reasons.push(...configurationSuggestionProblems(say,context),...clientContextSuggestionProblems(say,context));
  if((say.match(/\?/g)||[]).length>1)reasons.push('Ask one question at a time and leave room for the buyer to answer');
  if(context.coachingRequest)reasons.push(...onDemandSuggestionProblems(say,context));
  if(!context.coachingRequest)reasons.push(...foundationSuggestionProblems(say,generationFoundationFor(context),{partial:options.partial}));
  const budget=spokenReplyBudget(context);
  if(words(say)>budget.words)reasons.push("Spoken reply exceeds "+budget.words+" words");
  if(/[\u3400-\u9fff]/.test(say))reasons.push("The spoken reply must remain English");
  if(/^(?:you should|tell the buyer|ask them|focus on|discuss with them)\b/i.test(say))reasons.push("The line gives advice instead of literal words to say");
  const thirdPartyContext=[latest,callContext.background,callContext.knownFacts,...(context.turns||[]).filter(turn=>turn.role!=="you").slice(-4).map(turn=>turn.text)].join(" ");
  const knownThirdParty=/\b(?:engineers?|engineering team|colleagues?|coworkers?|managers?|team members?|end users?|board|staff)\b|\b(?:my|our|your|their|its)\s+(?:customers?|clients?|partners?)\b/i.test(thirdPartyContext);
  const thirdPersonCoaching=/\b(?:let's|let us|we (?:should|could|can)|I (?:should|could|can))\b.{0,25}\b(?:explore|understand|learn|discover|assess|identify|clarify|uncover|establish)\b.{0,100}\b(?:them|their|the buyer|the customer|the prospect)\b/i.test(normal);
  if(thirdPersonCoaching&&!knownThirdParty)reasons.push("The line gives third-person coaching advice instead of speaking directly to the buyer");
  const sourceText=(context.sources||[]).map(source=>source.text).join(" "),buyerText=(context.turns||[]).filter(turn=>turn.role!=="you").map(turn=>turn.text).join(" ");
  const authorizedContext=[context.manufacturer?.name,callContext.background,callContext.knownFacts,buyerText].join(" ");
  const numericValues=(value:string)=>new Set((value.match(/\b\d+(?:[.,]\d+)?/g)||[]).map(number=>String(Number(number.replace(/,/g,"")))));
  const timeSpans=[...agreedResponseTimeSpans(say,context),...declinedNumericCommitmentSpans(say)];
  const sourceNumbers=numericValues(sourceText),contextNumbers=numericValues(authorizedContext),numbers:string[]=[...say.matchAll(/\b\d+(?:[.,]\d+)?(?:%|\b)/g)].filter(match=>!timeSpans.some(span=>match.index>=span.start&&match.index+match[0].length<=span.end)).map(match=>match[0]);
  const numericKey=(value:string)=>String(Number(value.replace(/[,%]/g,"")));
  if(/^(?:okay|ok|yeah)[^.!?]{0,25}100%[.!]/i.test(say)){const index=numbers.indexOf("100%");if(index>=0)numbers.splice(index,1);}
  for(const number of numbers)if(!sourceNumbers.has(numericKey(number))&&!contextNumbers.has(numericKey(number)))reasons.push(`Invented numerical fact: ${number}`);
  // Use the same context-aware classification as the live source checker. A
  // buyer-directed quality question or known trial follow-up is not our claim.
  const turnCheck=assessReplyVerification(say,context);
  if(context.coachingRequest)reasons.push(...turnCheck.unsupportedClaims.map(claim=>claim.reason+' Repair the next move using the supported broad category or relevant evidence needed; omit unsupported additions without losing the commercial purpose.'));
  const needsVerification=turnCheck.classification.kind==='fact_request'
    ? needsFactCheck(say,context) || numbers.some(number=>!contextNumbers.has(numericKey(number)))
    : turnCheck.requiresVerification;
  if(needsVerification && !options.factChecked)reasons.push("Supplier claims require the source check before display");
  if(unapprovedResponseDeadline(say,context))reasons.push("An unapproved follow-up deadline was added");
  const lowerLatest=normalized(latest),declined=/cannot share|can't share|won't share|rather not|not comfortable|will not share/.test(lowerLatest);
  if(declined && /\?/.test(say)&&/current price|current supplier|what.*(?:volume|quantity|grade)|share.*(?:volume|price)|pricing range/i.test(say))reasons.push("Repeated a discovery request the buyer declined");
  if(context.callContext) {
    if(stage.hold.some(item=>/pric|quot/i.test(item)&&!/discount|matching|concession/i.test(item)) && /\$\s*\d|\b\d+(?:\.\d+)?\s*(?:USD|dollars?)\b|(?:our|the) (?:CIF |FOB )?price is/i.test(say))reasons.push("Detailed pricing is held for a later stage");
    for(const unknown of callContext.doNotGuess.split(/[\n;]/).map(line=>line.trim()).filter(Boolean)) {
      const keywords=unknown.toLowerCase().match(/[a-z]{4,}/g)?.filter(word=>!["unknown","not","known","current","please","guess"].includes(word))||[];
      if(keywords.length && keywords.some(keyword=>normal.includes(keyword)) && /\b(?:is|are|has|have|currently|pay|use)\b/.test(normal) && !say.includes("?") && !/\b(?:don't know|not confirmed|confirm|check|verify|without|unknown|guess)\b/.test(normal) && !(normalized(buyerText+" "+callContext.knownFacts).includes(normal)))reasons.push(`Do-not-guess fact asserted: ${unknown}`);
    }
  }
  // Explicit requests are judged against authored authority, factual grounding,
  // refusals and human learning, not a mandatory tactic inferred from an older
  // buyer utterance. Rep speech may have already answered that utterance.
  if(context.coachingRequest){
    if(hasClearConversationRefusal(latest)&&(/\?/.test(say)||/\b(?:but|however|before you go|give us a chance)\b/i.test(say)))reasons.push("Respect the buyer's refusal instead of reopening persuasion or discovery");
    if(matchesRejected(say,context.brain?.rejectedSignatures,context.brain?.learningExamples))reasons.push('Candidate repeats an earlier rejected company/stage/moment line');
    reasons.push(...learnedSuggestionProblems(say,context.brain?.learningExamples,context));
    const unique=[...new Set(reasons)];
    return {ok:!unique.length,reasons:unique,retryReason:unique.join('; '),hasAdvance:!!say,needsVerification};
  }
  const checklist=checklistFor(context),flow=conversationFlowFor(context),gaps=checklist.filter(item=>item.required&&!item.complete),gapTokens=gaps.flatMap(item=>item.label.toLowerCase().match(/[a-z]{3,}/g)||[]);
  const contactAppropriate=flow.contactAppropriate;
  const contactQuestion=say.includes("?")&&(asksForEmailValue(say)||/\b(?:phone number|contact details|best number)\b/i.test(say));
  const routingQuestion=say.includes("?")&&/who.{0,50}(?:purchas|procurement)|(?:right|responsible) person.{0,40}(?:purchas|procurement)|(?:speak|reach|connect|through).{0,45}(?:purchasing|procurement)|(?:are you|do you).{0,45}(?:handle|responsible|in charge).{0,25}(?:purchasing|procurement)/i.test(say);
  const gate=coldCallGateFor({...context,callContext,conversationState:deriveConversationState({...context,callContext,stageMap:normalizeStageMap(context.stageMap),buyerMemory:context.brain?.buyerMemory})});
  const routingContact=gate?.kind==='unavailable_contact'&&/\bpurchasing contact\b/i.test(say)&&/\b(?:email|name|time)\b/i.test(say);
  if(gate&&gate.kind!=='transfer_wait'){
    const company=normalized(context.manufacturer?.name||'');
    const companyAt=company?normal.indexOf(company):-1,identityPrefix=companyAt>=0?normal.slice(0,companyAt+company.length):'';
    const briefWho=!!identityPrefix&&!identityPrefix.includes('?')&&/\b(?:I'm|I am|this is|represent|calling from)\b/i.test(identityPrefix);
    const briefIntent=/\b(?:calling about|profile|for review|purchasing)\b/i.test(say);
    if(!briefWho||!briefIntent)reasons.push('Stage 0 needs brief who is calling and why, not a bare transfer request');
    if(gate.kind==='unavailable_contact'){
      if(!routingContact||!/\bname\b/i.test(say)||!/\bemail\b/i.test(say)||!/\btime\b/i.test(say))reasons.push('The unavailable purchasing contact needs a name, best email and best return time');
    }else if(!routingQuestion)reasons.push('Cold-call Stage 0 must reach or verify the purchasing contact before a product pitch');
    const withoutCompany=context.manufacturer?.name?say.replace(context.manufacturer.name,''):say;
    if(/\b(?:FEPA|JIS|F\d{2,}|MOQ|purity|prices?|pricing|CIF|FOB|lead time|certif\w*|specifications?|specs?|volumes?|quantities|quantity)\b|\d+(?:\.\d+)?\s*%|\$\s*\d/i.test(withoutCompany)||/\b(?:what|which|how much|how many)\b.{0,45}\b(?:needs?|requirements?|use|buy|grades?|volumes?|supplier|supply partner)\b/i.test(say))reasons.push('Stage 0 is brief identity and intent, never technical details or buyer-needs discovery with a gatekeeper');
  }
  if(context.callContext&&flow.phase==="routing"&&/\b(?:what|which|how much|how many)\b.{0,65}\b(?:supply partner|supplier|grades?|specifications?|volumes?|quantities|quantity|material do you|material are you)\b/i.test(say)&&!routingQuestion)reasons.push("Reach purchasing before asking the routing contact buyer-discovery questions");
  if(context.callContext&&flow.participant.role==="purchasing"&&routingQuestion)reasons.push("This person already confirmed purchasing responsibility; do not ask to reach someone else for the same role");
  if(context.callContext&&contactQuestion&&!contactAppropriate&&!routingContact)reasons.push("Contact details were requested before the buyer agreed to or requested a useful next step");
  if(context.callContext&&flow.openingNeeded&&(!/\b(?:I'm|I am|this is|calling|with|from|represent)\b/i.test(say)||contactQuestion||routingQuestion))reasons.push("Open with who is calling and why before asking for contact details or routing");
  const companyName=normalized(context.manufacturer?.name||"");
  const introduction=flow.openingNeeded&&/\b(?:calling|reaching out|reconnect|check in|introduction)\b/i.test(say)&&(!companyName||normal.includes(companyName));
  const relevantQuestion=say.includes("?")&&!contactQuestion&&!routingQuestion;
  const plannedQuestion=say.includes("?")&&gapTokens.some(term=>normal.includes(term));
  const deliveryMove=contactAppropriate&&/\b(?:I|we)(?:'ll| will)\s+(?:send|email|share)\b/i.test(say);
  const factualAnswer=!!options.factChecked&&!!guidance.evidence?.length;
  const genericDeferral=/\b(?:confirm|check|verify)\b.{0,55}\b(?:factory|exact (?:figure|details))\b/i.test(say)&&!/\b(?:factory|manufactur\w*|certif\w*|price|quotation|spec\w*|purity|content|stock|inventory|shipping|lead time|MOQ|payment)\b/i.test(latest);
  const directResponse=words(say)>=5&&!/^(?:thanks?(?: for[^.!?]*)?|thank you(?: for[^.!?]*)?|got it|understood|okay|that makes sense)[.!]?$/i.test(say)&&!genericDeferral;
  const respectBoundary=flow.phase==="closing"&&/\b(?:won't (?:call|contact).*again|will not (?:call|contact).*again|leave it|goodbye|thanks?|thank you|you're welcome)\b/i.test(say)&&!say.includes("?");
  const hasAdvance=!!say&&(introduction||relevantQuestion||deliveryMove||factualAnswer||respectBoundary||(contactAppropriate&&contactQuestion)||(flow.phase==="routing"&&(routingQuestion||routingContact))||(!flow.openingNeeded&&!contactQuestion&&!routingQuestion&&(plannedQuestion||directResponse)));
  // Judge responsiveness here; the model chooses a relevant next move from context.
  // Requiring an empty checklist field on every turn caused retries and premature closes.
  if(context.callContext&&!options.landing&&!hasAdvance)reasons.push("The reply does not address the buyer's turn or a useful next conversational step");
  if(/\b(?:what|which|how)\b/i.test(latest) && /purity|Al[₂2]?O[₃3]?|minimum order|MOQ|stock|inventory|certif/i.test(latest) && !options.landing && !/\b(?:check|confirm|verify|spec|figure|number|grade|stock|inventory|certif|content|purity|minimum|MOQ)\b/i.test(say))reasons.push("The reply does not answer or explicitly park the buyer's factual question");
  // A geographic stocking policy does not establish today's total inventory.
  if(/\b(?:current|available|today|now)\b.{0,35}\b(?:stock|inventory)\b|\b(?:stock|inventory)\s+level\b/i.test(latest)) {
    const writtenCheck=/\b(?:confirm|check|verify)\b/i.test(say)&&/\b(?:writing|written|email)\b/i.test(say);
    const quantity=/\b\d+(?:[.,]\d+)?\s*(?:tons?|tonnes?|MT|kg|kilograms?|units?|containers?)\b/i.test(say);
    const explicitZero=/\b(?:current|total|available) (?:stock|inventory) (?:is|stands at) (?:zero|0)|\b(?:we have|there is) no (?:stock|inventory)(?:\s+(?:currently|available))?[.!]?$/i.test(say);
    if(!writtenCheck&&!((quantity||explicitZero)&&options.factChecked&&guidance.evidence?.length))reasons.push("The current stock quantity is unresolved; confirm the exact level in writing rather than substitute a stocking policy");
  }
  if(/\b(?:give|quote|what|need|CIF|FOB)\b.{0,60}\b(?:price|quotation|quote)\b|\b(?:price|quote)\b.{0,40}\b(?:CIF|FOB)\b/i.test(latest) && options.landing && fastRouteFor(context).verificationRequired) {
    const actualQuote=/(?:\$\s*\d|\b\d+(?:[.,]\d+)?\s*(?:USD|dollars?))/.test(say)&&options.factChecked&&!!guidance.evidence?.length;
    const writtenCheck=/\b(?:confirm|check|verify)\b/i.test(say)&&/\b(?:writing|written|email)\b/i.test(say)&&!!guidance.missing?.length;
    if(!actualQuote&&!writtenCheck)reasons.push("The requested quotation is unresolved; confirm it in writing and log the missing quote");
  }
  const state=deriveConversationState({...context,stageMap:normalizeStageMap(context.stageMap),buyerMemory:context.brain?.buyerMemory});
  if(!options.partial&&state.deferredCommitments?.length&&state.immediateObjective?.kind!=='complete_commitment'&&isOnlyDeliveryAndClosing(say))reasons.push("The buyer added a substantive concern or constraint; a delivery acknowledgment alone does not address it");
  const promisedMaterials=/\b(?:I|we)(?:'ll| will)\s+(?:send|email|share|forward|attach)\b/i.test(say)&&hasAffirmativeMaterialsRequest(say);
  if(promisedMaterials&&!state.movedPastDiscovery&&!options.landing)reasons.push("Do not promise material delivery before a current-call request or agreement");
  if(promisedMaterials&&state.movedPastDiscovery){
    const allowed=materialsNamed(state.commitments.find(item=>item.id==='send_materials')?.action||'');
    const extra=affirmativeMaterialsNamed(say).filter(material=>!allowed.includes(material));
    if(allowed.length&&extra.length)reasons.push("Do not reintroduce cancelled or unrequested materials: "+extra.join(', '));
  }
  if(state.buyerNeeds&&!flow.contactAppropriate&&flow.phase!=='opening'&&flow.phase!=='routing'&&!options.landing)reasons.push(...discoveryQuestionProblems(say,state.buyerNeeds,context));
  reasons.push(...validateLeadingQuestion(say,state).reasons);
  if(state.nextAction.kind==="capture_email"&&!substantiveBuyerQuestions(context).length&&!options.partial) {
    const acknowledgesSend=/\b(?:send|email|share|forward)\b/i.test(say)&&/profile|materials|documents|drawings|information|specs|catalog|website|link/i.test(say);
    if(!acknowledgesSend)reasons.push("Address the buyer's actual material request rather than opening unrelated discovery");
    if(acknowledgesSend&&state.sequence.some(step=>step.id==='engineer_review')&&!/engineer|review/i.test(say))reasons.push('Confirm the agreed engineer review');
    if(acknowledgesSend&&state.sequence.some(step=>step.id==='prices_after_review')&&!/pric|quot/i.test(say))reasons.push('Confirm that the agreed prices step follows review');
    // Keep the T9 sequence honest, but leave room for an equally useful practical
    // clarification rather than requiring one sentence template on every turn.
    if(acknowledgesSend&&state.sequence.some(step=>step.id==="prices_after_review")&&/\b(?:first|before|after|then)\b/i.test(say)&&/\b(?:price|quote)\b/i.test(say)&&/\b(?:prices?|quot\w*)\b.{0,30}\b(?:before|first)\b.{0,30}\breview\b/i.test(say))reasons.push("The buyer agreed review before prices; do not reverse that sequence");
  }
  if(matchesRejected(say,context.brain?.rejectedSignatures,context.brain?.learningExamples))reasons.push("Candidate is near-identical to an earlier rejected company/stage/moment line");
  reasons.push(...learnedSuggestionProblems(say,context.brain?.learningExamples,context));
  for(const example of context.brain?.learningExamples||[]) {
    if(!example.negative)continue;
    const clean=(value:string)=>normalized(value).replace(/[^a-z0-9 ]/g,"").split(/\s+/).filter(Boolean);
    const a=clean(say),b=clean(example.negative),pool=new Set(b);
    if(normalized(say)===normalized(example.negative)||(!matchesAcceptedExample(say,[example])&&a.length>=5&&b.length>=5&&a.filter(word=>pool.has(word)).length/Math.max(a.length,b.length)>=.88))reasons.push("Candidate repeats a rejected company/stage/moment example");
  }
  const unique=[...new Set(reasons)];
  return {ok:!unique.length,reasons:unique,retryReason:unique.join("; "),hasAdvance,needsVerification};
}
