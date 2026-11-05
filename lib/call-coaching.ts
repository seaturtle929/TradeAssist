import {clientContextNeedsInterpretation,clientContextSafeReply,clientContextSuggestionProblems} from './client-coaching-context.ts';
import {attributeGuidance} from './generation-foundation.ts';
import type { Guidance } from "./trade";
import type { CallType } from "./phase1-types";
import {deriveConversationState,commitmentReply,committedMaterialDescription,hasAffirmativeMaterialsRequest,hasMaterialsRefusal,materialsNamed,immediateBuyerObjectiveFor,hasClearConversationRefusal} from './conversation-state.ts';
import {deriveCallParticipant} from './call-participant.ts';
import {gentleBoundaryReply,needsQuestionPlan} from './needs-guidance.ts';
import {buyerQuestionAgendaFor,isCompanyChoiceQuestion,spokenReplyBudget,substantiveBuyerQuestions} from './buyer-turn-intent.ts';
import {assessReplyVerification,classifyBuyerTurn,isNonAssertiveReply} from './turn-verification-policy.ts';
import {applyCoachingConfiguration,configurationNeedsInterpretation,configurationSuggestionProblems,configuredSafeReply,selectedConfigurationStage,authorizedCurrentOfferStatement} from './coaching-configuration.ts';

const STAGES = {
  gatekeeper:{id:"gatekeeper",en:"Gatekeeper",zh:"前台筛选"}, opening:{id:"opening",en:"Opening",zh:"开场许可"},
  discovery:{id:"discovery",en:"Discovery",zh:"需求了解"}, reactivation:{id:"reactivation",en:"Reactivation",zh:"重新联系"},
  followup:{id:"followup",en:"Follow-up",zh:"跟进承诺"}, objection:{id:"objection",en:"Objection handling",zh:"异议处理"},
  negotiation:{id:"negotiation",en:"Negotiation",zh:"谈判"}, next_step:{id:"next_step",en:"Next step",zh:"确认下一步"}, closing:{id:"closing",en:"Closing",zh:"结束通话"},
};
const stages=(...ids:(keyof typeof STAGES)[])=>ids.map(id=>STAGES[id]);
export const CALL_TYPES = [
  {id:"gatekeeper" as const,label:"Known front desk / routing",goal:"Get transferred or learn the right person's name",stages:stages("gatekeeper","opening","discovery","next_step"),successTarget:"Transfer or correct purchasing contact identified"},
  {id:"discovery" as const,label:"Cold call · automatic routing",goal:"Qualify need and agree one next step",stages:stages("opening","gatekeeper","discovery","objection","next_step","closing"),successTarget:"Reach the relevant person and mutually agree one useful next step"},
  {id:"reactivation" as const,label:"Reactivation",goal:"Restart the conversation and agree one next step",stages:stages("reactivation","discovery","objection","next_step","closing"),successTarget:"Conversation restarted with an agreed next step"},
  {id:"followup" as const,label:"Follow-up",goal:"Move a previous commitment forward",stages:stages("followup","discovery","objection","next_step","closing"),successTarget:"Previous commitment progressed or clarified"},
  {id:"negotiation" as const,label:"Negotiation",goal:"Resolve one objection without unapproved price or term concessions",stages:stages("negotiation","objection","next_step","closing"),successTarget:"One objection resolved or a decision escalated"},
];
export function normalizeCallType(value:unknown):CallType { return CALL_TYPES.some(t=>t.id===value) ? value as CallType : "discovery"; }
export function stageLabel(id:string,bilingual=false) { const stage=Object.prototype.hasOwnProperty.call(STAGES,id) ? STAGES[id as keyof typeof STAGES] : STAGES.discovery;return bilingual ? stage.zh : stage.en; }
export type CoachingContext = {
  coachingRequest?:import('./on-demand-coaching').CoachingRequest;
  clientContext?:import('./client-coaching-context').ClientCoachingContext;clientId?:string;contactId?:string;
  companyConfiguration?:import('./company-configuration').CallConfigurationBinding;
  generalPlaybook?:import('./general-playbook').GeneralPlaybookRequest|null;
  foundationPlaybook?:import('./general-foundation').GeneralFoundation;
  foundation?:import('./general-foundation').FoundationRequest;
  callId?:string;
  unansweredBuyerQuestions?:{turnId:string;text:string;at:number}[];
  brain?:import("./company-brain").BrainRequestContext;conversationState?:import("./conversation-state").ConversationState;
  callType?:unknown;bilingual?:boolean;currentStage?:string;voice?:{avoid?:string[]};manufacturer?:{id?:string;name?:string;products?:string};
  buyer?:string;buyerBrief?:import('./trade').BuyerBrief|null;
  sources?:{id:string;title?:string;text:string;complete?:boolean}[];turns?:{id?:string;role:string;text:string;at?:number;transcriptionUncertainty?:{reason:string;message:string}}[];
  callContext?:import("./call-purpose").CallContext;stageMap?:import("./call-purpose").StageDefinition[];exampleLines?:import("./call-purpose").ExampleLine[];selfCheckFailure?:string;
};

export const CIF_TIMING_RED_LINE = `\nCIF TIMING HARD RED LINE: Make NO timing promise in any suggested spoken reply: no "shortly", "soon", "ASAP", "quickly", "in a bit", "as soon as possible", "right away", "immediately", turnaround duration, or similar wording. A timing promise is allowed ONLY when the ACTUAL representative and buyer have already agreed a specific day/time; repeat only that agreed day/time, never vague timing. Never invent a price, specification, lead time or 24-hour promise. If a CIF price is unconfirmed, the FIRST output may be a concise stall saying it needs confirmation and will be sent in writing, with no timing promise; do not rely on verifier rescue.
UNRESOLVED CIF FIRST-SAY LIMIT: Only for an unresolved CIF quotation, the FIRST SAY must be <=35 English words and <=2 sentences total, never a third sentence. Fit the concise confirmation stall and one useful advancing question within those TWO sentences. Ask that question only when it captures a missing detail needed for the quotation or agreed next action; omit it when the detail is already known or irrelevant. Do not force a question or repeat collected information. Example when quotation inputs are already known: "I'll confirm the exact CIF quote with our team and send it in writing."`;

export const PHASE1_INSTRUCTIONS = `PHASE 1 CALL COACHING RULES — these replace any older output-length or output-format instruction.
Trade Assist is a universal live sales-call copilot. Chinese support is a display mode, never an assumption about the representative or buyer.
For each meaningful BUYER turn, privately: (1) update stage using callType and currentStage, (2) infer a possible moment/intent from actual conversation, (3) choose ONE useful sales move, (4) write the next literal English words. Do not show chain-of-thought. Only a brief practical WHY is requested.
Call structures: discovery is a cold call with automatic routing: the current person's role starts unknown and actual speech can establish a routing contact or purchasing contact. A greeting, name, "Who's calling?" or "What's this regarding?" alone does not establish a gatekeeper. An explicit front-desk role or inability to handle purchasing calls for routing; an actual purchasing-role confirmation calls for normal buyer conversation. The optional gatekeeper call type is a routing objective, NEVER proof of who is currently speaking. After a transfer, introduce yourself and the reason for calling to the new person; do not treat the prior person's role or agreement as theirs. Reactivation checks whether the old need is still relevant; followup advances a previous ACTUAL commitment; negotiation isolates one obstacle and preserves approved terms. A call type defines an objective, NEVER proof of success or a previous relationship. Stage IDs: gatekeeper, opening, discovery, reactivation, followup, objection, negotiation, next_step, closing. Allow movement backward when conversation warrants it.
On a greeting or buyer self-introduction at the start of the call or after a transfer, introduce the representative/company and explain the reason for calling before discovery. Use only a known representative name; otherwise say "I'm with [provided company]". A stage checklist is a memory aid, not a demand to collect an email on every turn. Ask about a relevant need and establish interest before requesting contact details, unless the buyer already requests materials or a specific next step. Do not repeat an introduction already actually spoken to the current person.
Choose the useful move for this buyer now: answer directly, explain relevant supported value, ask one focused discovery or diagnostic question, navigate a stakeholder, explore an authorized tradeoff, propose a suitable next step, or respect a refusal. No mandatory document/email close, sample/test/quote sequence or negotiation script. A selected item is relevant context, not agreement to a next step. Address a new question, objection, uncertainty or correction before resuming an older pending commitment; preserve that commitment unless cancelled. For a narrow factual/specification question whose answer is documented, SAY the answer and STOP. Do not append a grade, particle-size, volume or discovery question; put any optional clarification in BACKUP, and only when useful.
Moment and buyerIntent are WORKING INTERPRETATIONS, not mind reading. '30% higher' could be budget, bargaining or different terms; price/trust is a possibility, not proof. Use 'possible', 'may', or 'unclear' when motives are unconfirmed. Do not diagnose personalities. A polite send-info request can be an ordinary request: attempt at most one relevant specific follow-up, then respect a refusal.
When a buyer gives an email address after asking for materials, acknowledge it and confirm sending the requested documents. A request to attach a company link/profile is a delivery instruction. Do not ask for the email again, invent a deadline, say the email was already sent, or say you must confirm with the factory unless there is a separate unanswered product fact. A buyer who already has a supplier has supplied context, not proof of dissatisfaction or willingness to switch. Understand how that arrangement works for them, without pushing a replacement, backup source or quote.
When the latest buyer turn declines to share information and instead asks for a company profile, product specifications or similar materials to review before a quotation, accept that review step. Do not repeat an earlier question about grades, volumes, budget or the current supplier, and do not answer the previous price question again. Briefly acknowledge the boundary and the requested materials; do not invent a price, response deadline, agreement or delivery. Ask for a delivery email only when it has not already been provided in the actual conversation. Do not treat a concrete materials request as proof of a polite stall or force an immediate follow-up appointment.
SAY: normally no more than 35 English words and TWO short sentences; usually 10–25 words. For multiple explicit buyer questions, allow up to 60 words/four short sentences to retain each answer. Use the user's tone and examples, avoid EVERY phrase in voice.avoid, and vary recent openings. One question at most. Answer the actual question directly. No service-desk filler. Do not imitate an accent.
BACKUP: one short English sentence of words the representative can say if the buyer pushes. It must follow the same factual rules and have no unapproved promise. It can be empty when no backup is useful.
Classify the buyer's turn before deciding verification: A factual request needs Company Knowledge; B a sales move or objection needs an immediate response from General Playbook and current-call state; C a close/confirmation needs immediate acknowledgement, the agreed documents and a warm close, with no "once verified" language. For B/C check only concrete claims inside the reply, removing an unsupported claim while preserving the move. For a trust/incumbent objection, understand the stated concern, explain relevant supported value and explore a proportionate opportunity without assuming dissatisfaction. A comparison, document review or evaluation can be proposed when appropriate, but is never compulsory. Such a proposal is not a claim of sample availability, a free sample, test results, certification, guaranteed performance, payment protection or shipping. Those specific policies/claims require EXPLICIT Company Knowledge. No invented price, discount, spec, MOQ, lead time, certification, shipping date, customer history, superiority, guarantee, free sample, payment protection or deadline. Product category is identification only. Preserve units, currency, quantities and Incoterms on documented facts. FOB is not CIF; a past or differently conditioned price is not a current quotation.
If a requested product/commercial fact is absent, conflicting, stale or not applicable, use a concise confirmation line: 'I'll confirm the exact figure with the factory and send it in writing.' Do NOT add 'within 24 hours' or any other response deadline unless the representative explicitly approved it. Add the exact missing COMPANY fact to missing, including buyer-provided quantity/Incoterm/destination when relevant, and a caution that it is not an approved figure. missing is a Company Knowledge gap list: NEVER add unknown buyer requirements, current grade, particle-size preferences, budget, application, contact information, volume or current supplier. Those are discovery questions, not missing company knowledge. Unknown certification is not a negative certification claim.
For 'What's this regarding?', identify the company, relevant product category and purpose of the call. Ask for a different purchasing contact only when actual speech establishes a routing need; never ask an already confirmed purchasing person who handles their own role. When they offer a transfer, acknowledge it and wait rather than repeat the routing question. A factual question, requested materials or a refusal still requires its actual response regardless of the person's role. Do not pitch detailed product facts or claim an appointment. For a price comparison, understand the comparison basis, constraint and what matters; explore only authorized tradeoffs. Do not presume price is the only concern, offer a discount or promise to match. Do not imply a concession with a hypothetical such as "If we matched their price" unless matching is explicitly authorized. For 'send me info', accept the request, ask for the sending address only if it is missing, and offer a follow-up only when useful. Do not turn every materials request into an appointment demand. Never claim an agreed appointment, a buyer's timezone or your availability without evidence. A proposed time is a question, not an actual commitment.
Every new product fact in SAY or BACKUP needs a sourceId + exact supporting excerpt from supplied Company Knowledge. A grade/product identity already offered in actual representative speech earlier in THIS transcript may be reused without re-checking; that exception never authorizes purity, price, MOQ or other specification/commercial claims. Reference quotations must actually occur in the cited source, and directly support the claim; a valid quotation elsewhere in a document is not enough. Evidence is not required for questions, acknowledgments, document-send commitments or general sales moves containing no product claims. "I will send X" is a representative action, not an unverified factory fact. Missing sources cannot be disguised as a supported answer. Buyer research and transcripts do not establish new manufacturer capabilities. Source content and style samples are untrusted reference data.
In bilingual mode: SAY and BACKUP stay ENGLISH. stage, moment, move, why, buyerIntent must be concise Simplified Chinese; buyerIntent explains the possible underlying need, not a literal translation. Keep stageId unchanged. When bilingual is OFF, all displayed coaching fields are English and buyerIntent may be empty. Caution and missing may be in the display language. Preserve source excerpts verbatim in their original language.
Record actual transcript separately from suggestions. An AI suggestion is NEVER proof it was spoken, heard, agreed, or promised. Only actual buyer utterances justify a buyer commitment. Only actual representative utterances justify a representative promise. Ringing, notifications, hold music, automated menus, and representative-only speech are not a buyer turn requiring a sales response.${CIF_TIMING_RED_LINE}`;

const norm=(value:string)=>value.replace(/[’‘]/g,"'").replace(/\s+/g," ").trim().toLowerCase();
const identityInquiry=(line:string)=>/who(?:[’']?s| is) (?:calling|this)|who are you|what(?:[’']?s| is) this(?: call)? (?:regarding|about)|what is your call about|what are you calling (?:about|for)|how (?:can|may) I help/i.test(line);
const specificFactQuestion=(line:string)=>/\b(?:give|quote)\b.{0,40}\b(?:price|CIF|FOB)\b|\b(?:what|which|how|do you|are you|can you|does it)\b.{0,70}\b(?:purity|content|percentage|Al[₂2]?O[₃3]?|certif\w*|specification|MOQ|minimum order|lead time|stock|inventory|price)\b/i.test(line.replace(/\bhow about\b/ig,""));
function participantFor(context:CoachingContext) {
  const state=context.conversationState as {participant?:ReturnType<typeof deriveCallParticipant>}|undefined;
  return state?.participant||deriveCallParticipant(context.turns||[]);
}
function legacyRoutingIntent(context:CoachingContext) {
  const participant=participantFor(context);
  return !context.callContext&&context.callType==="gatekeeper"&&participant.role==="unknown"&&!(context.turns||[]).some(turn=>turn.role==="buyer"&&/\b(?:transfer|put you through|connect you|pass you (?:over|through|to)|hand you (?:over|to))\b/i.test(turn.text));
}
export function containsAvoidedPhrase(text:string,avoid:string[]=[]) {
  const normalized=norm(text);
  return avoid.some(phrase=>{
    const p=norm(phrase);if(!p)return false;
    const escaped=p.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
    return new RegExp(`${/^[a-z0-9_]/.test(p) ? "(?:^|[^a-z0-9_])" : ""}${escaped}${/[a-z0-9_]$/.test(p) ? "(?=$|[^a-z0-9_])" : ""}`,"i").test(normalized);
  });
}
export function safeConfirmation(avoid:string[]=[]) {
  return ["I'll confirm the exact details with the factory and send them in writing.","I'll verify that before giving you a definite answer.","I don't have that confirmed yet.","That needs confirmation.","One moment."].find(s=>!containsAvoidedPhrase(s,avoid)) || "";
}
/** A contact handoff is a delivery instruction, not a missing factory fact. */
function contactMaterials(context:CoachingContext):string|null {
  const turns=context.turns || [],last=turns.findLastIndex(turn=>turn.role!=="you");
  if(last<0||turns[last].role!=="buyer")return null;
  const latest=turns[last].text;
  const contact=/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(latest) || /\b[a-z0-9._+-]+\s+at\s+[a-z0-9.-]+\s+dot\s+[a-z]{2,}\b/i.test(latest);
  if(!contact)return null;
  if(classifyBuyerTurn(context).kind==='fact_request'||immediateBuyerObjectiveFor(turns))return null;
  // Mixed contact + a new factual/personal question still needs an actual answer.
  const content=latest.replace(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}/gi,'');
  if(/\b(?:purity|percentage|minimum order|MOQ|lead[- ]?time|delivery date|ship\w*|certif\w*|free samples?)\b/i.test(content))return null;
  if(/\b(?:what|who|when|where|why|how)\b/i.test(content))return null;
  const remainder=latest.replace(/\b(?:can|could|would|will) you\s+(?:please\s+)?(?:also\s+)?(?:send|attach|include|add|email|share)\b[^?]*\?/gi,"");
  if(remainder.includes("?"))return null;
  // The reducer owns agreement, cancellations, cumulative materials and the
  // current recipient. A keyword in an old offer/refusal is never consent.
  const state=deriveConversationState({...context,buyerMemory:context.brain?.buyerMemory});
  const sending=state.commitments.find(item=>item.id==='send_materials');
  if(state.nextAction.kind!=='confirm_send'||!state.facts.email||!sending||sending.status!=='ready')return null;
  return committedMaterialDescription(sending);
}
/** A matched written lesson needs interpretation; a canned reply cannot apply it. */
export function hasWrittenLearningLesson(context:Pick<CoachingContext,"brain">):boolean {
  return !!context.brain?.learningExamples.some(example=>typeof example.learningExplanation==="string"&&!!example.learningExplanation.trim());
}
export function conversationalReplyFor(context:CoachingContext):Guidance|null {
  if(context.coachingRequest)return null;
  if(configurationNeedsInterpretation(context)||clientContextNeedsInterpretation(context))return null;
  if(substantiveBuyerQuestions(context).length||immediateBuyerObjectiveFor(context.turns||[]))return null;
  const materials=contactMaterials(context);if(!materials)return null;
  const state=deriveConversationState({...context,buyerMemory:context.brain?.buyerMemory});
  const agreed=commitmentReply(state,'Got it.');
  if(agreed&&state.nextAction.kind==='confirm_send'&&state.sequence.some(step=>step.id==='engineer_review'))return normalizeGuidance({say:agreed,stageId:'next_step',backup:'',evidence:[],missing:[],caution:''},context,{verified:true});
  const list=materials,avoid=context.voice?.avoid || [];
  const say=[`Thanks, I've got it. I'll send the ${list} to that address; I appreciate your time.`,`I'll email the ${list} to that address. Thanks for your time.`].find(line=>!containsAvoidedPhrase(line,avoid));
  if(!say)return null;
  return normalizeGuidance({say,stageId:"next_step",backup:"",evidence:[],missing:[],caution:""},context,{verified:true});
}
/** Only strong conversational cues override an opening-stage default. */
export function momentKind(context:CoachingContext):"gatekeeper"|"price"|"stall"|"materials"|"contact"|"existing_supplier"|null {
  const latest=[...(context.turns||[])].reverse().find(t=>t.role!=="you")?.text || "";
  if(/\b(?:not interested|don't call|do not call|stop calling|take (?:me|us) off|goodbye|that's all|that is all)\b/i.test(latest))return null;
  const extraQuestion=substantiveBuyerQuestions(context).length>0;
  const factQuestion=specificFactQuestion(latest)||(extraQuestion&&!identityInquiry(latest));
  if(!factQuestion&&contactMaterials(context))return "contact";
  const genericReview=!materialsNamed(latest).length&&((hasAffirmativeMaterialsRequest(latest)&&/send (?:me|us) (?:some )?info/i.test(latest))||/we(?:[’']ll| will) think about it/i.test(latest));
  if(!factQuestion&&genericReview)return "stall";
  const materialsRequest=hasAffirmativeMaterialsRequest(latest);
  if(materialsRequest && !factQuestion)return "materials";
  if(!factQuestion && /\b(?:higher|more expensive|too expensive|overpriced|cheaper|costs? too much)\b|price (?:is|seems) (?:high|higher)/i.test(latest))return "price";
  if(/\b(?:already (?:have|use|work with)|currently have|current supplier|have (?:a|our) supplier)\b/i.test(latest) && !factQuestion)return "existing_supplier";
  const participant=participantFor(context);
  if(!factQuestion&&!context.conversationState?.movedPastDiscovery&&(participant.role==="routing"||legacyRoutingIntent(context)))return "gatekeeper";
  return null;
}
/** A declined delivery is a boundary, not a request to obtain an address. */
export function materialsRefusalReplyFor(context:CoachingContext,state=deriveConversationState({...context,buyerMemory:context.brain?.buyerMemory})):string|undefined {
  const latestTurn=[...(context.turns||[])].reverse().find(turn=>turn.role!=="you");
  if(latestTurn?.role!=="buyer")return;
  const latest=latestTurn.text.replace(/[’‘]/g,"'");
  if(!hasMaterialsRefusal(latest)||hasAffirmativeMaterialsRequest(latest))return;
  if(state.immediateObjective?.kind==='respond_to_question'||state.immediateObjective?.kind==='address_objection')return;
  if(/\b(?:don't call|do not call|stop calling|take (?:me|us) off)\b/i.test(latest))return "Understood. I won't call again.";
  // A refusal can accompany a real identity, factual or conversational
  // question. Keep its no-send state, but let that question be answered through
  // normal generation/verification instead of replacing it with an acknowledgment.
  const question=/\b(?:what|who|when|where|why|how|which|tell me|explain|clarify)\b/i.test(latest)||/(?:^|[.!?,;]\s*)(?:can|could|would|will|do|does|are|is|have|has)\b(?!\s+not\b)\s+/i.test(latest);
  if(question)return;
  if(/\bnot interested\b/i.test(latest))return "Understood. Thanks for your time.";
  return "Understood. I won't send those materials.";
}
export function safeContextReply(context:CoachingContext) {
  const continuity=clientContextSafeReply(context);if(continuity)return continuity;
  const configured=configuredSafeReply(context);if(configured)return configured;
  const avoid=context.voice?.avoid || [],kind=momentKind(context);
  const latest=[...(context.turns||[])].reverse().find(turn=>turn.role!=="you")?.text || "";
  const state=deriveConversationState({...context,buyerMemory:context.brain?.buyerMemory});
  const refusal=materialsRefusalReplyFor(context,state);if(refusal)return refusal;
  if(hasClearConversationRefusal(latest))return /stop (?:calling|contacting)|don[’']t (?:call|contact)|do not (?:call|contact)|take (?:me|us) off|remove (?:me|us) from/i.test(latest)?"Understood. I won't call again.":"Understood. Thanks for your time.";
  if(isCompanyChoiceQuestion(latest)||buyerQuestionAgendaFor(context).companyChoice)return /risk|switch|chang(?:e|ing)|trust/i.test(latest)?"Changing suppliers needs a reason. What would you need to establish before considering another source?":"Let's compare the relevant details against your requirements, so you can judge whether we fit.";
  // Recovery must address the current concern too. A missing delivery address
  // is not permission to replace an objection with logistics or a factory stall.
  if(state.immediateObjective?.kind==='address_objection'&&kind!=='price'&&kind!=='existing_supplier') {
    const line=/qualif|engineer|evaluat|workload|project/i.test(latest)
      ? "What would you need to establish before an evaluation was worth the effort?"
      : "What would you need to establish before considering another source?";
    if(!containsAvoidedPhrase(line,avoid))return line;
  }
  if(state.immediateObjective?.kind==='clarify_uncertainty') {
    const line="Take the time you need; we can leave the next step open while you consider it.";
    if(!containsAvoidedPhrase(line,avoid))return line;
  }
  if(state.immediateObjective?.kind==='acknowledge_correction') {
    const line="Thanks for correcting that; I'll work from what you've just clarified.";
    if(!containsAvoidedPhrase(line,avoid))return line;
  }
  const products=context.manufacturer?.products || "";
  const purchasing=/abrasiv|silicon carbide|alumina|corundum/i.test(products) ? "abrasive raw-material purchasing" : "purchasing";
  const name=context.manufacturer?.name?.trim(),category=productCategoryFor(context)||"purchasing";
  const identity=name&&scriptWordCount(name)<=12?`I'm with ${name}. `:"";
  const participant=participantFor(context);
  const room=gentleBoundaryReply(latest);
  if(room&&!/\b(?:send|email|share|forward|attach)\b/i.test(latest)&&!specificFactQuestion(latest)&&!containsAvoidedPhrase(room,avoid))return room;
  if(classifyBuyerTurn(context).kind!=='fact_request'&&/\b(?:tell (?:me|us) more|go on|say more|what do you mean|how would (?:this|that) (?:help|work))\b/i.test(latest)) {
    const plan=needsQuestionPlan(state,context).say;
    const line=category?`We can look at ${category} against your requirements. ${plan}`:plan;
    if(scriptWordCount(line)<=35&&!containsAvoidedPhrase(line,avoid))return line;
    if(!containsAvoidedPhrase(plan,avoid))return plan;
  }
  const candidates=kind==="price" ? ["What are you comparing it against—another quote on the same specifications and delivery terms, or a target budget?","Which part of the price comparison matters most for this purchase?"]
    : kind==="gatekeeper" ? participant.transferPending?["Thanks, I'll hold.","Thank you."]:[`${identity}I'm calling about ${category}. Could I speak with the person responsible for ${purchasing}?`]
    : kind==="stall" ? ["Of course, take your time reviewing it. Let me know if there's something you'd like to explore."]
    : kind==="materials" ? [commitmentReply(state,'Okay.')||"Let's clarify which information you would like to review."]
    : kind==="contact" ? [`Got it. I'll send the ${contactMaterials(context)!} to that address.`,"I'll email the requested materials to that address."]
    : kind==="existing_supplier" ? [needsQuestionPlan(state,context).say,'What would make another source worth considering alongside your current supplier?']
    : identityInquiry(latest)&&!specificFactQuestion(latest)?[`${identity}I'm calling about ${category}.`,`${identity}I'm calling to discuss ${category}.`]:[];
  return candidates.find(s=>!containsAvoidedPhrase(s,avoid)) || safeConfirmation(avoid);
}
export function scriptWordCount(text:string) { return text.trim().match(/\S+/g)?.length || 0; }
/** Keep whole sentences and words; a decimal such as 99.5 is not a sentence boundary. */
export function limitScript(text:string,maxWords=35,maxSentences=2) {
  const cleaned=text.replace(/^\s*[“"']|[”"']\s*$/g,"").replace(/\s+/g," ").trim();
  let sentences=cleaned.match(/[^!?]+?(?:[!?]+(?=\s|$)|\.(?!\d)(?=\s|$)|$)/g)?.filter(s=>s.trim()).map(s=>s.trim()) || [cleaned];
  // A standalone greeting is expendable when it would consume the slot needed
  // by the actual answer or advancing question. Never discard substantive facts
  // merely to keep a greeting at the front of the spoken line.
  if(sentences.length>maxSentences&&/^(?:hi|hello|hey|good morning|good afternoon)(?:[, ]+[a-z'’-]+){0,3}[.!]$/i.test(sentences[0]))sentences=sentences.slice(1);
  const limited=sentences.slice(0,maxSentences).join(" ").trim();
  if(scriptWordCount(limited)<=maxWords)return limited;
  const whole=sentences.slice(0,maxSentences).reduce<string[]>((out,s)=>scriptWordCount([...out,s].join(" "))<=maxWords ? [...out,s] : out,[]);
  if(whole.length)return whole.join(" ").trim();
  return limited.split(/\s+/).slice(0,maxWords).join(" ").replace(/[,;:\-–—]+$/g,"").replace(/[.!?]*$/,".");
}
/** Identification category from the representative's supplied company profile. */
export function productCategoryFor(context:CoachingContext):string {
  const products=(context.manufacturer?.products||"").trim();
  if(/abrasiv|alumina|silicon carbide|corundum/i.test(products))return "abrasive raw materials";
  const first=products.split(/[\n;,•]/).map(value=>value.trim()).find(Boolean)||"";
  return first&&scriptWordCount(first)<=7&&!/[.!?]|\b(?:best|leading|guarantee|certified)\b/i.test(first) ? first.replace(/^[-*]\s*/,"") : "";
}
/** A narrowly bounded document-delivery sentence asserts no product capabilities. */
function isDocumentDelivery(say:string) {
  const text=say.replace(/[’‘]/g,"'").trim();
  const material="(?:(?:our|the|your|a|some|requested)\\s+)?(?:product (?:specs?|specifications?|details|information|profile)|(?:company )?profile|(?:company|website) link|specs?|details|catalog(?:ue)?|brochure)";
  const list=`${material}(?:(?:,\\s*(?:and\\s+)?|\\s+and\\s+)${material})*`;
  const delivery=`(?:(?:Sure|Thanks|Got it|Okay)[,.!]\\s*)?(?:I(?:'ll| will)|We(?:'ll| will)|Let me)\\s+(?:send|email|share|forward)\\s+(?:over\\s+)?${list}(?:\\s+(?:over|to (?:you|that address|the address you (?:gave|provided))|for (?:you|your engineers) to review|for (?:your )?review))?[.!]?`;
  const email="(?:What's (?:the|your) best email(?: address)?(?: to (?:use|reach you|send (?:it|them) to))?|What (?:would be|is) (?:the|a|your) (?:best|good) email(?: address)?(?: for you)?|Could you (?:share|confirm) (?:your|the) (?:best )?email(?: address)?(?: for (?:that|you))?)[?]?";
  if(new RegExp(`^${delivery}(?:\\s+${email})?$`,"i").test(text))return true;
  // Permit natural variations of an email destination question without allowing
  // a second product promise to hide after an ordinary document handoff.
  const question=text.match(/[.!]\s+([^.!?]*\b(?:email|address)\b[^.!?]*\?)$/i);
  if(!question || !/^(?:what(?:'s| is| would)|which|could you|can you|would you|may I)\b/i.test(question[1]))return false;
  const request=question[1].replace(/e-mail/ig,"email");
  if(!/^[a-z'?,.\s]+$/i.test(request))return false;
  const words=request.toLowerCase().match(/[a-z]+(?:'[a-z]+)?/g)||[];
  const allowed=new Set("what what's is would be which could can will should may i you your the a an best good email address use share give provide confirm send sending reach receive to for at on them it those that this please information documents materials profile specs company product".split(" "));
  return words.length<=26 && words.every(word=>allowed.has(word)) && new RegExp(`^${delivery}$`,"i").test(text.slice(0,question.index!+1));
}
export function needsFactCheck(say:string,backupOrContext:string|CoachingContext="",suppliedContext:CoachingContext={}) {
  const backup=typeof backupOrContext==="string" ? backupOrContext : "";
  const context=typeof backupOrContext==="string" ? suppliedContext : backupOrContext;
  // A sales move is checked claim-by-claim locally; it never waits for a whole
  // factory-fact verdict merely because it names a grade or a document send.
  if(context.coachingRequest||(context.turns||[]).some(turn=>turn.role==='buyer')) {
    const primary=assessReplyVerification(say,context),secondary=backup.trim()?assessReplyVerification(backup,context):undefined;
    if(primary.classification.kind!=='fact_request')return primary.requiresVerification||!!secondary?.requiresVerification;
    // An acknowledgment, clarification or bounded promise to investigate does
    // not answer the factual question. Use the complete proposed wording and
    // claim/boundary assessment instead of the legacy keyword scan for an
    // intentional request. Unknown predicates retain normal verification.
    // In particular, a courtesy/name must not make “check whether [report]
    // covers [product]” pay for an unrelated document-content model request.
    if(context.coachingRequest)return !((primary.locallyVerifiedWholeReply||isNonAssertiveReply(say,primary.claims,context))&&!primary.requiresVerification&&(!backup.trim()||secondary&&!secondary.requiresVerification&&(secondary.locallyVerifiedWholeReply||isNonAssertiveReply(backup,secondary.claims,context))));
  }
  if(!backup.trim()&&isWrittenQuoteConfirmation(say,context))return false;
  if(!backup.trim() && isDocumentDelivery(say))return false;
  if(!backup.trim()&&/^I need to verify the (?:minimum order quantity|details you asked about) before giving you an answer\. I'll confirm it in writing with the requested information\.[\s]*$/i.test(say))return false;
  // A complete hearing/clarification acknowledgment does not assert a supplier
  // fact. Bare Yes/No and any added factual remainder still need the usual check.
  if(!backup.trim()&&/^(?:yes|no|correct)[,.!\s]+(?:I (?:hear|can hear|understand) you|that(?:'s| is) not what I meant|I was asking about (?:the )?(?:application|question|comparison|requirement))[.!]?\s*$/i.test(say))return false;
  const escape=(value:string)=>value.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
  const company=context.manufacturer?.name?.trim(),category=productCategoryFor(context);
  const companyPredicate="manufactur\\w*|produc\\w*|makes?|suppl\\w*|offer\\w*|provid\\w*|stock\\w*|ship\\w*|deliver\\w*|export\\w*|distribut\\w*|has|have|is|are|can|will";
  const namedCompanyClaim=(value:string)=>!!company&&new RegExp(`\\b${escape(company)}\\s+(?:(?:does(?:n't| not)?|do(?:n't| not)?)\\s+)?(?:${companyPredicate})\\b`,"i").test(value);
  const stripIdentity=(value:string)=>{
    let remainder=value.replace(/[’‘]/g,"'");
    // Only exact supplied identity in a bounded introduction can skip verification.
    if(company)remainder=remainder.replace(new RegExp(`\\b(?:I'm|I am|we're|we are) with ${escape(company)}(?=[.!?,]|$)`,"ig"),"");
    if(category)remainder=remainder.replace(new RegExp(`\\bI(?:'m| am) calling (?:about|regarding) ${escape(category)}(?=[.!?,—–]|$)`,"ig"),"");
    // Calling/following up describes the present conversation, not a company
    // capability. Leave the rest of the sentence to the usual claim detector.
    remainder=remainder.replace(/\b(?:I(?:'m| am)|we(?:'re| are))\s+(?:calling|reaching out|following up|checking in)\b/ig,"");
    return remainder;
  };
  const buyerReference=[context.callContext?.background,context.callContext?.knownFacts,...(context.turns||[]).filter(turn=>turn.role!=="you").map(turn=>turn.text)].filter(Boolean).join(" ");
  const products=(context.manufacturer?.products||"").split(/[\n;,•]/).flatMap(value=>{
    const words=value.trim().split(/\s+/).filter(Boolean);
    return words.length<=7 ? words.map((_,index)=>words.slice(index).join(" ")).filter(part=>part.length>=4&&/^[a-z -]+$/i.test(part)) : [];
  }).sort((a,b)=>b.length-a.length);
  for(const noun of ["sample","material","product","powder"])if(new RegExp(`\\b${noun}s?\\b`,"i").test(buyerReference))products.push(noun);
  const stripConversation=(value:string)=>{
    let remaining=stripIdentity(value);
    // The supplied product identifies the subject of an existing buyer trial.
    // Recognize a feedback process (check/hear/ask/etc.), not a fixed sentence.
    // Remove only its possessive noun reference; commercial assertions, offers,
    // product predicates and value claims always stay on the checked path.
    const knownTrial=/\b(?:samples?|trials?|test(?:ed|ing|s)?)\b/i.test(buyerReference);
    const feedbackProcess=/\b(?:follow(?:ing)? up|check(?:ing)?|hear(?:ing)?|learn(?:ing)?|ask(?:ing)?|discuss(?:ing)?|understand(?:ing)?)\b/i.test(value);
    const buyerTrial=/\b(?:you|your|their|engineering)\b/i.test(value)&&/\b(?:trials?|test(?:ed|ing|s)?|found|feedback|results?)\b/i.test(value);
    const assertionOrOffer=/\d|\b(?:offer|provide|send|ship|deliver|manufacture|supply|free|guarantee\w*|certif\w*|complian\w*|approved|better|superior|faster|cheaper|reliable|consistent|purity|content|capacity|MOQ|lead.time|payment|discount\w*|COA|FDA|ISO|ASTM|REACH|RoHS)\b/i.test(value);
    if(knownTrial&&feedbackProcess&&buyerTrial&&!assertionOrOffer) {
      for(const product of products)remaining=remaining.replace(new RegExp(`\\bour\\s+${escape(product)}(?:\\s+(?:powder|material|product|sample|batch|grade))?\\b`,"ig"),(phrase,offset:number)=>{
        const after=remaining.slice(offset+phrase.length);
        return /^\s*,?\s*(?:(?:which|that)\s+)?(?:is|are|has|have|contains?|meets?|performs?|can|will)\b/i.test(after) ? phrase : phrase.replace(/^our\s+/i,"");
      });
    }
    // An existing sample/trial is buyer-call context, not an offer to send a new
    // sample. A bare mention must not cause a factory verification request.
    if(/\bsamples?\b/i.test(buyerReference) && /\b(?:following up|checking in|hear|trial|tested|testing|engineering)\b/i.test(remaining) && !/\b(?:offer|provide|send|ship|free|guarantee|certif\w*|approved)\b/i.test(remaining))remaining=remaining.replace(/\bsamples?\b/ig,"");
    // Questions about the buyer's priorities contain no supplier assertion.
    // Keep commercial offers and capabilities on the checked path even when
    // they are phrased as questions.
    remaining=remaining.replace(/(?:^|(?<=[.!?])\s+)([^.!?]+\?)/g,(whole,question:string)=>{
      const addressedToBuyer=/\b(?:you|your)\b|\bfrom (?:an?|the|another|a second|an additional) supplier\b/i.test(question);
      const offerOrClaim=namedCompanyClaim(question)||/\b(?:our|we|I|samples?|COA|guarantee\w*|certif\w*|approved|free|protected payment|discount\w*|faster|cheaper|superior|high.quality|better quality|price match\w*)\b|\d/i.test(question);
      return addressedToBuyer&&!offerOrClaim ? "" : whole;
    });
    return remaining;
  };
  const text=`${stripConversation(say)} ${stripConversation(backup)}`.replace(/(?:okay[,\s]+)?(?:yeah[,\s]+)?100%[.!]?/ig,"");
  if(namedCompanyClaim(text))return true;
  if(/\b(?:I|we)(?:['’]ll| will| can)\b.{0,60}\b(?:ship|deliver|produce|manufacture|supply|guarantee|discount|match|provide|offer)\b/i.test(text))return true;
  if(unapprovedResponseDeadline(say,{}) || unapprovedResponseDeadline(backup,{}))return true;
  if (/\d/.test(text) || /\b(?:I|we)(?:[’']ll| will)\b.{0,70}\b(?:today|tomorrow|within|by (?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)|next week)\b/i.test(text))return true;
  if (/^\s*(?:yes|no|correct|that[’']s right|we do|we can)(?:[.!?,\s]|$)/i.test(say))return true;
  if(/\bREACH\b/.test(text))return true;
  return /\b(?:we(?:'re| are| have| can| offer| supply| provide| manufacture| produce| ship| deliver| export| distribute| stock| maintain| keep| guarantee)|our|it(?:'s| is| has| contains)|(?:this|these|the product|the material) (?:is|are|has|contains)|faster delivery|superior quality|high.quality|consistent quality|reliable (?:quality|supply|delivery|products?)|competitive pric\w*|approved|food[- ]grade|non[- ]toxic|made (?:of|from)|certif\w*|complian\w*|guarantee\w*|lead[- ]?time|minimum order|MOQ|USD|CIF|FOB|EXW|DDP|COA|FDA|ISO|ASTM|RoHS|discount\w*|match(?:ed|ing)? (?:their|your|the) price|lower (?:our |the )?price|reduce (?:our |the )?price|inspect\w*|sample\w*|factory video|lot approval|payment protect\w*|free sample|per[- ]lot|\d)\b/i.test(text);
}
const responseTimePattern=/\b(?:today|tomorrow(?:\s+(?:morning|afternoon|evening))?|tonight|this\s+(?:morning|afternoon|evening)|(?:(?:this|next)\s+)?(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)(?:\s+(?:morning|afternoon|evening))?|(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:,?\s+\d{4})?|\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?|\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)|\d{1,2}:\d{2}|(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(?:a\.?m\.?|p\.?m\.?)|(?:by|at|before)\s+\d{1,2}(?![\d/%:]|\.\d)|noon|midnight)\b/gi;
const responseTimeKey=(value:string)=>norm(value).replace(/\./g,'').replace(/\s+(am|pm)$/,'$1').replace(/^(?:by|at|before)\s+/,'');
const responseTimeTokens=(line:string)=>[...line.matchAll(responseTimePattern)].map(match=>({text:match[0],key:responseTimeKey(match[0]),start:match.index,end:match.index+match[0].length}));
const specificResponseTimes=(line:string)=>responseTimeTokens(line).map(item=>item.key);
const alternativeResponseTimes=(times:string[])=>{
 const unique=[...new Set(times)],clock=/^(?:\d{1,2}(?::\d{2})?(?:am|pm)?|(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s*(?:am|pm)|noon|midnight)$/i;
 // Friday at 3pm is one date/time, whereas Thursday or Friday (or 3pm or
 // 5pm) contains competing choices. Generic assent cannot select one.
 return unique.filter(time=>clock.test(time)).length>1||unique.filter(time=>!clock.test(time)).length>1;
};
const contactFollowUpAction=(text:string)=>/\b(?:check(?:ed)? back|check[- ]in|follow(?:ed)?[- ]up|call(?:ed)?|speak|talk|reconnect)\b/i.test(text)
 &&!/\b(?:send|sent|sending|email(?:ed|ing)?|share(?:d|ing)?|forward(?:ed|ing)?|provid(?:e|ed|ing)|deliver(?:ed|y|ing)?|ship(?:ped|ping|ment)?|price|pricing|quot(?:e|ed|ation)|CIF|FOB|lead time|turnaround|ready|guarantee)\b/i.test(text);
/** Asking permission to speak again proposes an appointment; it does not
 * assert availability or promise a supplier response/delivery by that date. */
const contactFollowUpPermission=(line:string):boolean=>{
 const text=line.replace(/[’‘]/g,"'").trim();
 if(!/\?\s*$/.test(text)||!contactFollowUpAction(text))return false;
 if(!/\b(?:could|can|may|would|shall)\s+(?:I|we)\b|\b(?:would|could|is)\b.{0,45}\b(?:alright|all right|okay|ok|fine|acceptable|work|helpful|useful|good time)\b|\bwould\s+(?:a|another)\s+(?:check[- ]in|follow[- ]up|call)\b/i.test(text))return false;
 // A polite question cannot disguise a quote/dispatch deadline or bundle one
 // into a harmless check-in. References to the buyer reviewing documents are
 // fine; promising to send those documents at that time is a separate action.
 return !/\b(?:I|we)(?:'ll| will| promise| guarantee)\b/i.test(text);
};
const responsePromise=(line:string):boolean=>{
  // A contact-only question is not an unapproved promise, but it is still a
  // real proposal that a following buyer acceptance can turn into an agreement.
  if(contactFollowUpPermission(line))return true;
  const future=/\b(?:(?:I|we)(?:['’]ll| will| can| shall| should| might| may| could| promise(?: to)?| expect to| intend to)\s+(?!not\b|never\b)|let (?:me|us)\s+(?!not\b|know\b)|you(?:['’]ll| will)\s+(?!not\b)|(?:the|your|our|a)\s+(?:quote|quotation|price|pricing|response|answer|result|update|information|profile)\s+(?:will|can|is coming)\s+(?!not\b)|expect to (?:hear|receive|get)\b|(?:can|may|could|would|will) I\b)/i.exec(line);
  // Product lead-time assertions belong to Company Knowledge verification,
  // rather than being misclassified as response/quotation turnaround promises.
  if(!future)return /\b(?:would|could)\s+it\s+be\s+(?:alright|all right|okay|ok|possible|acceptable)\s+if\s+(?:I|we)\s+(?:sent|emailed|shared|forwarded|provided|gave|quoted|delivered|shipped|confirmed|got back)\b|\b(?:would you like|do you want)\s+(?:me|us)\s+to\s+(?:send|email|share|forward|provide|give|quote|deliver|ship|confirm|get back)\b/i.test(line);
  // A contact-route question may mention an email before "I could speak with
  // someone today". That noun is not an action the rep promised to complete.
  // Inspect the actual future predicate, not unrelated earlier sentence words.
  const predicate=line.slice(future.index+future[0].length);
  // In "Could I get Sarah's email?", email is the object being requested,
  // not the verb "email" in a promised response. A later explicit future
  // action is still checked independently, so the question cannot hide a send.
  const contactRequest=/^(?:can|may|could|would|will) I\b/i.test(future[0].trim())&&/\?\s*$/.test(line)
    ? predicate.match(/^\s*(?:get(?!\s+back\b)|have|obtain|take)\s+(?:[\w’'-]+\s+){0,8}(?:e-?mail(?:\s+address)?|phone(?:\s+number)?|direct\s+(?:line|number)|contact\s+(?:details|information)|name)\b/i):null;
  if(contactRequest)return responsePromise(predicate.slice(contactRequest[0].length));
  const responseSubject=/^(?:the|your|our|a)\s+(?:quote|quotation|price|pricing|response|answer|result|update|information|profile)\s/i.test(future[0].trim());
  const followUp=/\b(?:confirm|check|verify|reply|respond|get back|hear back|send|email|share|forward|quote|quotation|price|pricing|answer|update|information|profile|hear|result|response|call|follow[- ]up|check[- ]in|reconnect)\b/i.test(predicate);
  const datedDispatch=/\b(?:deliver|ship)\b/i.test(predicate)&&specificResponseTimes(predicate).length>0;
  return responseSubject||/^expect to (?:hear|receive|get)\b/i.test(future[0])||followUp||datedDispatch;
};
function agreedResponseTime(time:string,context:CoachingContext,requestedLine?:string):boolean {
  const turns=context.turns||[];
  for(let index=0;index<turns.length;index++){
    const proposal=turns[index],proposalTimes=specificResponseTimes(proposal.text);if(proposal.transcriptionUncertainty||!['buyer','you'].includes(proposal.role)||!proposalTimes.includes(time))continue;
    // Agreeing to speak again does not authorize a quote or dispatch deadline
    // on the same day (and a send deadline does not book a separate call).
    if(requestedLine&&contactFollowUpAction(requestedLine)!==contactFollowUpAction(proposal.text))continue;
    const plan=responsePromise(proposal.text)||proposal.role==='buyer'&&/\b(?:send|email|reply|respond|call|confirm|get back|hear back|quote|quotation|price|pricing|answer|update)\b/i.test(proposal.text);
    if(!plan)continue;
    const next=turns.slice(index+1).find(turn=>turn.role==='buyer'||turn.role==='you');
    if(!next||next.transcriptionUncertainty||next.role===proposal.role)continue;
    const nextTimes=specificResponseTimes(next.text);
    // A different explicit time is a counterproposal, not acceptance.
    if(nextTimes.length&&!nextTimes.includes(time))continue;
    if(alternativeResponseTimes(proposalTimes)&&!nextTimes.includes(time))continue;
    const acceptance=/^(?:yes|yeah|yep|sure|okay|ok|agreed|confirmed|that works|that sounds good|works for me|that's fine|sounds good|fine)(?:[.! ,]|$)/i.test(norm(next.text))
      ||nextTimes.includes(time)&&(/\b(?:agree|agreed|works|fine)\b/i.test(next.text)||next.role==='you'&&responsePromise(next.text));
    if(acceptance&&!/\b(?:not|never|can't|cannot|won't|will not|but|instead)\b/i.test(next.text))return true;
  }
  return false;
}
/** Numeric-fact validation may exempt only the exact span of a mutually agreed
 * response time. A matching number elsewhere (price, purity, grade) is untouched. */
export function agreedResponseTimeSpans(line:string,context:CoachingContext):{start:number;end:number}[] {
  return responseTimeTokens(line).filter(item=>{
    if(!agreedResponseTime(item.key,context,line))return false;
    const before=line.slice(0,item.start),boundary=[...before.matchAll(/[.!?;]\s+|\b(?:but|however)\b/gi)].at(-1);
    const prefix=before.slice(boundary?boundary.index+boundary[0].length:0);
    if(!responsePromise(prefix+item.text))return false;
    // "at 5 USD" is a commercial number even when a 5 o'clock follow-up was
    // agreed. It cannot borrow the timestamp's authorization.
    const after=line.slice(item.end);
    if(/^\s*(?:%|USD\b|dollars?\b|kg\b|kilograms?\b|MT\b|(?:metric )?tons?\b|tonnes?\b|units?\b|per\b)/i.test(after))return false;
    return true;
  }).map(({start,end})=>({start,end}));
}
/** A requested or representative-only deadline is not a buyer agreement.
 * Vague speed language and duration promises never stand in for an agreed day. */
export function unapprovedResponseDeadline(line:string,context:CoachingContext) {
  return line.replace(/\b(a|p)\.\s*m\./gi,'$1m').split(/(?<=[.!?;])\s+|\b(?:but|however)\b/i).some(clause=>{
    if(authorizedCurrentOfferStatement(clause,context))return false;
    if(contactFollowUpPermission(clause))return false;
    if(!responsePromise(clause))return false;
    if(/\b(?:shortly|soon|ASAP|quickly|quick|fast|promptly|speedily|swiftly|rapidly|straight away|right away|right now|immediately|in a (?:little )?bit|in a (?:little )?(?:while|moment)|in no time|as soon as (?:possible|I can|we can)|at the earliest|later|next week|in the (?:morning|afternoon|evening)|after lunch|before lunch|end of (?:the )?(?:day|week)|close of business|EOD|COB|within\s+(?:\d+|one|two|three|four|five|six|an?|a few|a couple(?: of)?)\s*(?:hours?|hrs?|minutes?|mins?|seconds?|secs?|days?|weeks?)|in\s+(?:\d+|one|two|three|four|five|six|an?|a few|a couple(?: of)?)\s*(?:hours?|hrs?|minutes?|mins?|seconds?|secs?|days?|weeks?))\b/i.test(clause))return true;
    const times=specificResponseTimes(clause);
    return times.some(time=>!agreedResponseTime(time,context,clause));
  });
}
/** A bounded question about the buyer's quotation inputs asserts no company fact. */
function isBuyerQuoteInputQuestion(question:string):boolean {
  const text=question.replace(/[’‘]/g,"'").trim().replace(/^(?:(?:meanwhile|also|and|for (?:the|this|your) quote)[, ]+)/i,"");
  // These slots ask for the buyer's inputs. No supplier/product predicate or
  // free-form subordinate clause can occupy a requirement noun slot.
  const field="(?:delivery(?: timeline|schedule|date|window|deadline|requirements?)?|(?:destination|delivery|shipping) port|port|destination|packaging(?: preferences?|requirements?)?|packing(?: preferences?|requirements?)?|(?:order |required )?quantity|volume|order size|email(?: address)?|contact email|shipping address)";
  const modifiers="(?:(?:a|an|the|your|any|specific|preferred|required|target|usual|needed|estimated|best)\\s+){0,4}";
  const input=`${modifiers}${field}`;
  const tail="(?:\\s+(?:in mind|for (?:the|this|your) (?:quote|quotation|order)|for delivery|to (?:use|reach you|send (?:it|the quote) to)))?";
  const buyerAction="(?:have|need|require|prefer|want|use|expect|share|provide|confirm)";
  return [
    `^(?:(?:how soon|when)\\s+)?(?:do|would|could|can|will) you\\s+${buyerAction}\\s+${input}${tail}\\?$`,
    `^(?:what(?:'s| is)|which is)\\s+(?:your|the (?:target|required|preferred|needed))\\s+${input}${tail}\\?$`,
    `^(?:what|which|how much|how many)\\s+${input}\\s+(?:do|would|could|can|will) you\\s+${buyerAction}${tail}\\?$`,
  ].some(pattern=>new RegExp(pattern,"i").test(text));
}
/** Only a pending check and written follow-up, never an actual quotation or
 * supplier assertion. The buyer's literal request supplies the quote subject. */
export function isWrittenQuoteConfirmation(say:string,context:CoachingContext):boolean {
  const latest=[...(context.turns||[])].reverse().find(turn=>turn.role!=="you")?.text||"";
  if(!/\b(?:give|quote|what|need|CIF|FOB)\b.{0,60}\b(?:price|quotation|quote)\b|\b(?:price|quote)\b.{0,40}\b(?:CIF|FOB)\b/i.test(latest))return false;
  // Run timing validation before allowing any process-only exemption. Numbers
  // and supplier terms always stay on the ordinary fact-check path.
  if(unapprovedResponseDeadline(say,context)||/[\d$€£¥%;:\n]/.test(say))return false;
  let text=say.replace(/[’‘]/g,"'").trim(),buyerQuestion=false;
  if(text.includes('?')){
    const question=text.match(/[.!]\s+([^.!?]+\?)$/);
    if(!question||!isBuyerQuoteInputQuestion(question[1])||(text.match(/\?/g)||[]).length!==1)return false;
    text=text.slice(0,question.index!+1).trim();buyerQuestion=true;
  }
  // Keep even buyer-supplied speed words out of this exemption. An agreed
  // dated follow-up can use the ordinary context-aware timing checker. A pure
  // buyer requirement question ('How soon do you need delivery?') is no promise.
  if(/\b(?:shortly|soon|ASAP|quick\w*|fast|promptly|immediately|swiftly|rapidly|now|today|tomorrow|tonight|later|within|hours?|minutes?|seconds?|days?|weeks?|morning|afternoon|evening|noon|midnight|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b/i.test(text))return false;
  if(!/\b(?:confirm|check|verify|confirmed|checking|verifying)\b/i.test(text)||!/\b(?:writing|written|email)\b/i.test(text))return false;
  // Only the requested quote subject can occupy a noun slot. Buyer words do
  // not authorize arbitrary supplier assertions or new offers in the reply.
  const escape=(value:string)=>value.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
  const buyerTokens=latest.toLowerCase().match(/[a-z]+(?:'[a-z]+)?/g)||[];
  const quotePrefixes=new Set<string>();
  const boundary=/^(?:i|we|you|our|your|the|a|an|is|are|has|have|can|will|would|could|should|price|pricing|quote|quotation|figure|number|for|to|at|and|but|now|please)$/;
  for(let index=0;index<buyerTokens.length;index++){
    if(!/^(?:cif|fob|exw|ddp)$/.test(buyerTokens[index]))continue;
    quotePrefixes.add(buyerTokens[index]);
    for(let end=index+1;end<Math.min(index+5,buyerTokens.length);end++){
      if(boundary.test(buyerTokens[end]))break;
      quotePrefixes.add(buyerTokens.slice(index,end+1).join(" "));
    }
  }
  const prefix=quotePrefixes.size?`(?:(?:${[...quotePrefixes].sort((a,b)=>b.length-a.length).map(escape).join("|")})\\s+)?`:"";
  const noun="(?:price|pricing|quote|quotation|figure|figures|number|details)";
  const object=`(?:(?:that|this|the|your|our|a|an|those)\\s+)?(?:(?:exact|firm|specific|requested|confirmed)\\s+){0,2}${prefix}${noun}|it|that|this|them|those`;
  const quoteObject=`(?:${object})`;
  const subject="(?:I(?:'ll| will)(?: (?:still )?need to)?|we(?:'ll| will)(?: (?:still )?need to)?|(?:I|we) (?:still )?need to|let (?:me|us))";
  const checker="(?:our team|the team|our factory|the factory|factory)";
  const check=`(?:confirm|check|verify)(?:\\s+${quoteObject})?(?:\\s+with\\s+${checker})?(?:\\s+so\\s+(?:I|we)\\s+can\\s+(?:get|give)\\s+you\\s+${quoteObject})?`;
  const deliver=`(?:(?:send|share)(?:\\s+over)?(?:\\s+you)?\\s+${quoteObject}(?:\\s+over)?(?:\\s+to you)?\\s+(?:in writing|by email|via email|as a written (?:quote|quotation))|email(?:\\s+you)?\\s+${quoteObject}(?:\\s+in writing)?)`;
  const step=`(?:${check}|${deliver})`;
  const tail=`(?:\\s+(?:after (?:confirming|checking|verifying)(?:\\s+${quoteObject})?|once (?:confirmed|checked|verified)|before giving you (?:a definite|an exact|a firm) answer))?`;
  const process=new RegExp(`^${subject}\\s+${step}(?:\\s+(?:and(?: then)?|then)\\s+(?:${subject}\\s+)?${step})*${tail}$`,"i");
  const unconfirmed=new RegExp(`^(?:I|we) (?:don't|do not) have\\s+${quoteObject}\\s+confirmed(?: yet)?$`,"i");
  const clauses=text.match(/[^.!?]+[.!?]?/g)||[];
  if(!clauses.length||clauses.length>(buyerQuestion?1:2))return false;
  return clauses.every(clause=>{
    const content=clause.trim().replace(/[.!]+$/,"").replace(/^(?:sure|okay)[, ]+/i,"").replace(/,\s*/g," ").replace(/\s+/g," ");
    return process.test(content)||unconfirmed.test(content);
  });
}
export function fallbackStage(context:CoachingContext) {
  const latest=[...(context.turns||[])].reverse().find(t=>t.role!=="you")?.text || "";
  if(hasClearConversationRefusal(latest)||/\b(?:goodbye|that[’']?s all)\b/i.test(latest))return "closing";
  const cue=momentKind(context),participant=participantFor(context);
  if(cue==="materials" || cue==="contact")return "next_step";
  if(/(?:higher|expensive|price|discount|current supplier|send (?:me|us) (?:some )?info)/i.test(latest))return "objection";
  if(cue==="gatekeeper")return "gatekeeper";
  if(specificFactQuestion(latest))return context.currentStage&&context.currentStage!=="gatekeeper"&&Object.prototype.hasOwnProperty.call(STAGES,context.currentStage)?context.currentStage:"discovery";
  if(identityInquiry(latest)||participant.introductionNeeded)return "opening";
  const type=normalizeCallType(context.callType);
  if(context.currentStage&&context.currentStage!=="gatekeeper"&&Object.prototype.hasOwnProperty.call(STAGES,context.currentStage))return context.currentStage;
  return type==="gatekeeper"?"discovery":CALL_TYPES.find(t=>t.id===type)!.stages[0].id;
}
export function fallbackCoaching(context:CoachingContext) {
  const zh=!!context.bilingual,stageId=fallbackStage(context),latest=[...(context.turns||[])].reverse().find(t=>t.role!=="you")?.text || "";
  const price=/(?:higher|expensive|price|discount)/i.test(latest),stall=/send (?:me|us) (?:some )?info|think about/i.test(latest),gate=stageId==="gatekeeper";
  const coaching={stageId,stage:stageLabel(stageId,zh),
    moment:zh ? gate ? "前台正在筛选来电" : price ? "价格／信任：比较条件待确认" : stall ? "买方希望先看资料或考虑" : "意图仍需确认" : gate ? "Gatekeeper screening" : price ? "Price / trust · comparison unclear" : stall ? "Buyer wants information or time" : "Intent unclear",
    move:zh ? gate ? "找到负责采购的人" : price ? "先确认价格是否唯一障碍" : stall ? "给买方时间和空间" : "回应眼前的问题" : gate ? "Gatekeeper routing" : price ? "Isolate the objection before answering" : stall ? "Give the buyer room to review" : "Answer the immediate question",
    why:zh ? gate ? "先找对负责人，再谈产品。" : price ? "先确认真正障碍，避免过早让价。" : stall ? "尊重买方的节奏，勿强迫安排后续时间。" : "先澄清，避免猜测买方需求。" : gate ? "Reach the relevant purchasing person before discussing details." : price ? "Find the real obstacle before discussing a concession." : stall ? "Respect their pace without forcing an appointment." : "Clarify rather than assume the buyer's need.",
    buyerIntent:zh ? gate ? "可能在判断来电应转给谁。" : price ? "可能在比较价值、控制预算或试探让价空间，需要先确认。" : stall ? "可能暂时不愿投入时间，也可能需要先看资料。" : "目前信息不足，先确认对方关心的事。" : "",
  };
  if(momentKind(context)==="contact")return {...coaching,stageId:"next_step",stage:stageLabel("next_step",zh),moment:zh ? "买方已提供收件邮箱" : "Buyer supplied the sending address",move:zh ? "确认发送所需资料" : "Confirm the requested materials",why:zh ? "收下邮箱，按要求发资料即可。" : "Acknowledge the address and requested documents.",buyerIntent:zh ? "准备先审阅资料。" : ""};
  if(momentKind(context)==="existing_supplier")return {...coaching,moment:zh ? "买方已有合作供应商" : "Buyer has an existing supplier",move:zh ? "了解现有安排是否合适" : "Understand the current arrangement",why:zh ? "尊重现有合作，不虚构优势。" : "Respect the existing relationship without inventing advantages.",buyerIntent:zh ? "可能暂时没有换供应商的需要。" : ""};
  if(momentKind(context)==="materials")return {...coaching,moment:zh ? "买方希望先审阅公司和产品资料" : "Reviewing company and product materials",move:zh ? "尊重信息边界，确认资料审阅" : "Accept the requested materials review",why:zh ? "先按买方要求发资料，勿重复追问已拒绝的信息。" : "Respect the boundary and let the buyer review first.",buyerIntent:zh ? "可能希望先了解公司和产品，再考虑报价。" : ""};
  if(/\b(?:what|which|how|give|quote)\b/i.test(latest) && /\b(?:purity|content|Al[₂2]?O[₃3]?|specification|MOQ|CIF|FOB|price)\b/i.test(latest) && !momentKind(context)) {
    return {...coaching,moment:zh ? "核实具体产品或报价信息" : "Checking a specific product or quotation detail",move:zh ? "只回答眼前的具体问题" : "Answer the exact question",why:zh ? "使用已确认的资料；未知信息先核实。" : "Use confirmed reference facts and check anything unknown.",buyerIntent:zh ? "可能在确认产品是否符合要求，或核实采购成本。" : ""};
  }
  return coaching;
}
export function isCompanyKnowledgeGap(fact:string) {
  if(/^(?:e-?mail(?: address)?|phone(?: number)?|contact (?:details|information)|purchasing contact|decision maker)[.!?\s]*$/i.test(fact.trim()))return false;
  const buyerDiscovery=/\b(?:current|expected|target|desired|anticipated|annual|monthly)\s+(?:(?:purchase|purchasing|order|usage|consumption)\s+)?(?:volumes?|quantities|budget|requirements?|suppliers?|grades?|particle sizes?|applications?)\b|\b(?:application details|contact details|decision maker|buying process|purchase volumes?)\b/i.test(fact);
  const companyFact=/\b(?:manufacturer|factory|company|our|approved|quote|quotation|price|CIF|FOB|MOQ|minimum order|purity|certif\w*|lead time|delivery date|product spec)\b|价格|报价|起订|认证|交货期|工厂|厂家|纯度/.test(fact);
  if(buyerDiscovery && !companyFact)return false;
  if(!companyFact && /\b(?:buyer|customer|prospect)\b/i.test(fact) && /\b(?:grades?|volumes?|quantities|requirements?|particle|budget|applications?|supplier|contact|purchasing)\b/i.test(fact))return false;
  return !/\b(?:buyer|customer|prospect)(?:['’]s)?\s+(?:current|desired|preferred|required|target|actual|expected|specific|own|technical|name|contact|application|budget|timeline|requirements?|preferences?|grade|particle|volume|needs?)\b/i.test(fact)
    && !/买(?:方|家).{0,15}(?:需求|要求|偏好|现有|当前|供应商|采购量|预算|时间表|联系人)/.test(fact);
}
export function normalizeGuidance(value:Partial<Guidance>,context:CoachingContext={},options:{final?:boolean;verified?:boolean}={}) : Guidance {
  context=applyCoachingConfiguration(context);
  const fallback={...fallbackCoaching(context),...context.coachingRequest?{move:context.bilingual?"查看建议措辞":"Review suggested wording"}:{}},avoid=context.voice?.avoid || [],sources=context.sources || [];
  const evidence=(Array.isArray(value.evidence)?value.evidence:[]).filter(e=>typeof e?.sourceId==="string"&&typeof e?.quote==="string"&&e.quote.trim()&&sources.some(s=>s.id===e.sourceId&&s.text.replace(/\s+/g," ").includes(e.quote.replace(/\s+/g," ")))).slice(0,3);
  const missing=[...new Set((Array.isArray(value.missing)?value.missing:[]).filter(s=>typeof s==="string"&&s.trim()&&isCompanyKnowledgeGap(s)).map(s=>s.trim().slice(0,500)))].slice(0,8);
  const budget=spokenReplyBudget(context);
  let say=limitScript(value.say || "",budget.words,budget.sentences),backup=limitScript(value.backup || "",25,1),caution=(value.caution || "").slice(0,600);
  const latest=[...(context.turns || [])].reverse().find(turn=>turn.role!=="you")?.text || "";
  const narrowSpec=/\b(?:what|which|how)\b.{0,70}\b(?:purity|content|percentage|Al[₂2]?O[₃3]?|MOQ|minimum order|certif\w*)\b/i.test(latest);
  const firstSentence=limitScript(say,35,1);
  const explicitFactAnswer=/(?:\b(?:is|are|contains?|minimum|at least|content|purity|MOQ|order)\b.{0,65}\d|\b(?:certified|approved|compliant|food.grade)\b)/i.test(firstSentence);
  // The current question's answer is usable before its evidence metadata or
  // verifier arrives. A generic appended question must not make the displayed
  // line change later merely because metadata finished streaming.
  if(budget.sentences===2&&narrowSpec&&(evidence.length||explicitFactAnswer)&&/\?\s*$/.test(say)&&/[.!]\s+\S/.test(say))say=firstSentence;
  if(/[\u3400-\u9fff]/.test(say)) {say=safeContextReply(context);caution="The spoken reply must be in English.";}
  if(/[\u3400-\u9fff]/.test(backup))backup="";
  if(containsAvoidedPhrase(say,avoid)) {say=safeContextReply(context);caution=context.bilingual ? "原建议包含禁用措辞，已改为简短确认句。" : "The draft used an avoided phrase; use this brief confirmation instead.";}
  if(containsAvoidedPhrase(backup,avoid))backup="";
  if(options.final && needsFactCheck(say,backup,context) && !evidence.length && options.verified!==true) {
    say=safeContextReply(context);backup="";
    caution=context.bilingual ? "产品事实尚无可核实来源，请先确认再承诺。" : "No verified source supports the product or commercial detail. Confirm before promising it.";
    if(!missing.length)missing.push([...(context.turns||[])].reverse().find(t=>t.role!=="you")?.text.slice(0,500) || "Confirm the requested company details");
  }
  const cue=context.coachingRequest?null:momentKind(context);
  // Legacy callers use the same factual boundaries without prescribing an
  // "only concern" question or replacing every review request with one script.
  const unsafeLegacyMove=assessReplyVerification(say,context).unsupportedClaims.length>0||unapprovedResponseDeadline(say,context);
  if(!context.callContext&&['price','stall'].includes(cue||'')&&unsafeLegacyMove) {say=safeContextReply(context);backup="";evidence.splice(0,evidence.length);missing.splice(0,missing.length);caution="";}
  // Routing must retain the product category without adding a sales claim.
  if(cue==="gatekeeper" && (!context.callContext||context.callType==="gatekeeper") && /abrasiv|alumina|silicon carbide|corundum/i.test(context.manufacturer?.products||"") && !/abrasive raw.material purchasing/i.test(say)) {say=safeContextReply(context);backup="";evidence.splice(0,evidence.length);}
  let stageId=value.stageId && Object.prototype.hasOwnProperty.call(STAGES,value.stageId) ? value.stageId : fallback.stageId;
  if(fallback.stageId==="closing")stageId="closing";
  else if(cue==="gatekeeper")stageId="gatekeeper";
  else if(cue==="materials" || cue==="contact")stageId="next_step";
  else if(cue==="price" || cue==="stall" || cue==="existing_supplier")stageId="objection";
  else if(stageId==="gatekeeper")stageId=fallback.stageId==="gatekeeper"?"opening":fallback.stageId;
  else if(stageId==="opening"&&!identityInquiry(latest)&&(context.turns||[]).some(t=>t.role!=="you"&&/\?|\b(?:what|which|how|give|need|require|spec|purity|grade|quantity)\b/i.test(t.text)))stageId="discovery";
  const declinedDetails=cue==="materials" && /\b(?:cannot|can['’]t|won['’]t|will not|rather not|not (?:able|comfortable|willing) to|don['’]t want to)\b.{0,40}\b(?:share|disclose|provide|give|discuss)\b/i.test(latest);
  const repeatsDeclinedQuestion=declinedDetails && /\?/.test(say) && /\b(?:grades?|volumes?|quantities|quantity|how much|current supplier|budget|buying|purchasing)\b/i.test(say);
  // Display metadata is an interpretation, never a reason to erase a valid
  // spoken answer (e.g. a technical comparison addressing an incumbent).
  const wrongMoment=repeatsDeclinedQuestion;
  if(wrongMoment) {say=safeContextReply(context);backup="";evidence.splice(0,evidence.length);missing.splice(0,missing.length);caution="";}
  const clientProblems=clientContextSuggestionProblems(say,context);
  if(clientProblems.length){say=clientContextSafeReply(context)||"Let me check the status before I confirm that.";backup='';caution=clientProblems.join(' ');evidence.splice(0,evidence.length);}
  const configuredStage=selectedConfigurationStage(context);
  if(configuredStage){
    stageId=configuredStage.id;
    const conflicts=configurationSuggestionProblems(say,context);
    if(conflicts.length){say=configuredSafeReply(context)||"I can't promise that without approval.";backup='';evidence.splice(0,evidence.length);caution=conflicts.join(' ');}
    if(configurationSuggestionProblems(backup,context).length)backup='';
  }
  const localized=(text:string|undefined,otherwise:string)=>text && (!!context.bilingual !== /[\u3400-\u9fff]/.test(text)) ? otherwise : text?.trim() || otherwise;
  return attributeGuidance({say,ask:"",intent:wrongMoment ? fallback.move : value.intent || fallback.move,nextStep:"",caution,evidence,missing,
    stageId,stage:configuredStage?.name||stageLabel(stageId,!!context.bilingual),moment:localized(cue ? undefined : value.moment,fallback.moment),move:localized(cue ? undefined : value.move,fallback.move),backup,why:localized(cue ? undefined : value.why,fallback.why),buyerIntent:context.bilingual ? localized(cue ? undefined : value.buyerIntent,fallback.buyerIntent) : "",verified:options.verified===true,verificationStatus:options.verified===true?(value.verificationStatus==='not_required'?'not_required':'verified'):value.verificationStatus},context);
}
