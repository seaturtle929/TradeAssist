import {deriveConversationState,committedMaterialDescription,immediateBuyerObjectiveFor,type ConversationState} from './conversation-state.ts';
import {classifyBuyerTurn} from './turn-verification-policy.ts';
import {coldCallGateFor,preparedPurchasingParticipant} from './call-participant.ts';
import {coldCallGateLineFor} from './sales-opening.ts';
import {curriculumForStage} from './sales-curriculum.ts';
import type {ConfigurationStage} from './company-configuration';
import type {GeneralPlaybookRecord} from './general-playbook';

/** Company approval is not product-owner approval. Legacy records retain their
 * original approval dates, but require explicit product curation before shared use. */
export type ProductGuidanceApproval={scope:'product_default';role:'product_owner';reviewer:string;decisionId:string;approvedAt:number};
export type SharedGuidanceProvenance={origin:'product_curation'|'company_feedback'|'legacy_ambiguous';companyId?:string;productApproval?:ProductGuidanceApproval};
export function normalizedSharedProvenance(raw:unknown):SharedGuidanceProvenance {
 const value=raw&&typeof raw==='object'?raw as Partial<SharedGuidanceProvenance>:{};
 const approval=value.productApproval;
 const productApproval=approval?.scope==='product_default'&&approval.role==='product_owner'&&typeof approval.reviewer==='string'&&!!approval.reviewer.trim()&&typeof approval.decisionId==='string'&&!!approval.decisionId.trim()&&Number.isFinite(approval.approvedAt)&&approval.approvedAt>0?{scope:'product_default' as const,role:'product_owner' as const,reviewer:approval.reviewer.trim().slice(0,200),decisionId:approval.decisionId.trim().slice(0,200),approvedAt:approval.approvedAt}:undefined;
 return {origin:value.origin==='product_curation'||value.origin==='company_feedback'?value.origin:'legacy_ambiguous',...typeof value.companyId==='string'&&value.companyId?{companyId:value.companyId}:{},...productApproval?{productApproval}:{}};
}
export function isProductApproved(provenance:SharedGuidanceProvenance|undefined):boolean {
 const value=normalizedSharedProvenance(provenance);return value.origin==='product_curation'&&!!value.productApproval;
}

export const FOUNDATION_MOMENT_TYPES=['cold_call_gate','intro','needs_discovery','interest_narrowed','next_step_agreed','pending_research','trust_objection','price_spec_stall','email_close','follow_up','negotiation','refusal'] as const;
export type FoundationMomentType=typeof FOUNDATION_MOMENT_TYPES[number];
export type FoundationMove={id:string;momentType:FoundationMomentType|string;name:string;when:string;do:string[];doNot:string[];template:string;updatedAt:number;origin:'seed'|'approved';exampleCount:number};
export type FoundationExample={id:string;momentType:string;moveId:string;template:string;tags:string[];requiredMoves:string[];forbiddenMoves:string[];negativePatterns:string[];approvedAt:number;updatedAt:number;reviewCount:number;provenance?:SharedGuidanceProvenance;active?:boolean};
export type FoundationProposal={id:string;name:string;momentType:string;when:string;do:string[];doNot:string[];template:string;status:'pending'|'approved';createdAt:number;approvedAt?:number;origin?:'learning_draft';learningSignature?:string;provenance?:SharedGuidanceProvenance;active?:boolean};
export type GeneralFoundation={version:1;updatedAt:number;moves:FoundationMove[];examples:FoundationExample[];proposals:FoundationProposal[];historicalMoves?:FoundationMove[]};
export type FoundationContext={selectedStage?:Pick<ConfigurationStage,'id'|'name'|'objective'>;callId?:string;manufacturer?:{id?:string;name?:string;products?:string};sources?:{id:string;title?:string;text:string}[];turns?:{id?:string;role:string;text:string;at?:number}[];callContext?:{relationship?:string;stageId?:string;knownFacts?:string;background?:string;doNotGuess?:string};callType?:string;conversationState?:ConversationState;generalPlaybook?:{companyId?:string;patternId?:string;selectedItem?:string;template?:string;boundExample?:string;bindings?:Record<string,string>}|null;voice?:{notes?:string;avoid?:string[]};representativeName?:string;foundation?:FoundationRequest|null};
export type FoundationRequest={version:1;momentType:string;moveId:string;moveName:string;situation:string;when:string;do:string[];doNot:string[];template:string;boundExample:string;bindings:Record<string,string>;exampleIds:string[];examples:FoundationExample[];negativeRules:string[];exampleCount:number;updatedAt:number;companyId:string;detectionReason:string;tacticalLabel?:string|null};

const definitions:Omit<FoundationMove,'id'|'updatedAt'|'origin'|'exampleCount'>[]=[
 {momentType:'cold_call_gate',name:'Cold-call right-person gate',when:'A first-contact cold call has not established purchasing responsibility, or the current person is routing the call.',do:['Give brief identity and broad supply intent.','Ask for the purchasing person before a buyer pitch.','If unavailable, collect only the missing name, contact route or callback time.'],doNot:['Do not pitch product codes, grades, specifications or prices unless answering an actual technical question.','Do not ask a gatekeeper about needs or volumes.','Do not demand a transfer without who and why; prefer a courteous connect-me request.', 'Never greet a transfer target before pickup evidence; conditional intent is not completion.'],template:"Hi, I'm from {company_name}; we supply {product_category}. Could you please connect me with the person responsible for purchasing? I'd like to send our company profile for their review."},
 {momentType:'intro',name:'Introduce a confirmed purchasing contact',when:'Purchasing responsibility is confirmed and this contact has not heard the representative introduction.',do:['Introduce the supplied company, present purpose and credible reason to talk; if brief identity was already given, build on it without repeating the introduction.','Give the buyer room to respond. Ask one easy opening question only when its answer is useful now.'],doNot:['Do not re-ask to reach purchasing after responsibility is confirmed.','Do not claim that research proves a need.','Do not jump directly to email capture or stack discovery onto an introduction.'],template:"I'm from {company_name}, calling about {product_category}."},
 {momentType:'needs_discovery',name:'Understand the buyer’s needs',when:'The relevant buyer is speaking and the immediate objective is to understand fit or explain value.',do:['Build on the application, prior answers and supported offering; explain relevant value when it helps the buyer.','Ask one useful question about fit, evaluation or a constraint only when its answer changes the next action.','An incumbent need not be failing; explore a relevant opportunity without assuming dissatisfaction.'],doNot:['Do not assume an incumbent is a problem.','Do not force replacement, backup or quotation choices.','Do not repeat answered questions or ask for contact details prematurely.'],template:'{acknowledgement} {needs_question}'},
 {momentType:'interest_narrowed',name:'Confirm the selected item',when:'The buyer chooses an already offered item or a currently documented product.',do:['Acknowledge the selected item and connect a supported offering to the buyer’s stated interest.','Answer a current question, clarify one relevant requirement, or propose an evaluation step when useful.','Offer documents or request an email only when appropriate; product interest alone is not consent to a send.'],doNot:['Do not restart generic discovery after the item is selected.','Do not omit another product the buyer explicitly selected.','Do not treat an item still under research as selected.'],template:'Okay, {selected_item}—{relevant_value} {useful_next_action}'},
 {momentType:'next_step_agreed',name:'Complete an agreed next step',when:'The buyer has requested or agreed a concrete document/review/quotation process.',do:['Respect the buyer’s reasonable next step and preserve who owns each action, the actual sequence, and any essential missing detail.','Explain how that step will help the buyer decide; a conditional requirements comparison does not promise a match.','Complete a sending gap only when it is the current objective; remember the rep’s follow-through without assuming completion.','Address a new question, concern, correction or refusal first; keep the commitment available to resume when appropriate.'],doNot:['Do not reopen discovery, substitute another route, or demand a date after the buyer chose a workable next step.','Do not turn a buyer-owned send into a rep send or claim a promised action has already happened.','Do not ignore a new question or objection to force the earlier next step.','Do not invent a deadline, quotation or successful fit.'],template:'{acknowledgement} {useful_next_action}'},
 {momentType:'pending_research',name:'Respect an item still under research',when:'The buyer defers an item or says more internal/market research is needed.',do:['Separate a selected item from the item still being researched.','Give room to review and offer relevant information only if useful.','Keep the next step optional.'],doNot:['Do not treat uncertainty as purchase interest.','Do not pressure the buyer to choose immediately.','Do not drop a different item they already selected.'],template:'Of course—you can take time to look into {research_item}. {optional_review_action}'},
 {momentType:'trust_objection',name:'Low-risk evaluation with an incumbent',when:'The buyer questions trust or the risk of trying another supplier while remaining open to discussion.',do:['Understand whether the concern is risk, trust, qualification effort, timing or simply an existing relationship.','Respect the incumbent and explain a relevant supported reason to evaluate an option.','Choose an optional comparison, requirements discussion, or evaluation if useful; do not mechanically offer sample, report and quote together.','Any physical sample, terms or testing capability must be supported; a hypothetical evaluation is not availability or approval.'],doNot:['Do not claim superiority, savings or reliability without evidence.','Do not promise free samples, availability or successful qualification.','Do not promise no engineering work or push a buyer who declines.'],template:"You don't need to switch suppliers. {evaluation_action}"},
 {momentType:'price_spec_stall',name:'Answer supported facts; park only the unknown',when:'The buyer asks about a price, specification, MOQ, lead time, certificate or availability.',do:['Answer exact supported facts with source scope, units and conditions.','If missing, acknowledge the specific unknown and confirm it in writing.','If the buyer demands an unapproved response deadline, explicitly decline that deadline; only the quotation or missing fact needs confirmation.','Ask a missing quotation detail only when it unlocks that quote.'],doNot:['Never invent a price, number, spec, lead time or availability.','Never invent a response deadline, including soon or shortly.','Do not offer to confirm or guarantee an unsupported deadline.','Do not stall unrelated sales moves for verification.'],template:"I'll confirm the exact {requested_fact} against {requirement_scope} and send it in writing. {quotation_question}"},
 {momentType:'email_close',name:'Confirm the address and close',when:'The buyer provides an address for the current agreed materials with no new factual question.',do:['Acknowledge receipt.','Restate the agreed materials and product identities.','Close warmly without another discovery question.'],doNot:['Do not ask for the email again.','Do not say once verified or introduce a fact warning.','Do not claim that material has already been sent.'],template:"Got it—I'll send {agreed_materials} there{review_sequence}. Thanks for your time."},
 {momentType:'negotiation',name:'Understand the commercial constraint',when:'The buyer challenges price or terms, requests a concession, or trades conditions.',do:['Clarify the real constraint and whether the comparison uses the same scope, quantity and delivery basis.','Use supplied authorized commercial policies to explore a relevant tradeoff.','When approval is missing, distinguish an option to investigate from a concession being offered.'],doNot:['Do not invent discounts, price matching, terms, approval or availability.','Do not treat every price objection as a factual quotation request.','Do not promise savings or ask a checklist of commercial inputs.'],template:'{acknowledgement} {negotiation_question}'},
 {momentType:'refusal',name:'Respect a clear refusal',when:'The buyer clearly declines the conversation, further selling, contact or a proposed next step.',do:['Acknowledge the actual boundary and stop the declined action.','Answer an explicit separate question if one remains.','Retain historical agreements as history, without treating them as permission to override the refusal.'],doNot:['Do not counter a clear refusal with another pitch or persuasion question.','Do not request an email or promise follow-up after contact is declined.'],template:'{acknowledgement} Thanks for your time.'},
 {momentType:'follow_up',name:'Follow the agreed review',when:'This is an explicitly identified follow-up call or the current agreed materials have been sent and review is pending.',do:['Refer only to supplied actual history and the present status of each commitment.','Help resolve the remaining decision or offer a supported update; ask about receipt or review only when unknown and useful now.','Respect an incomplete review and the buyer’s chosen route and next step; allow time when nothing useful is needed from them.'],doNot:['Do not invent a previous call, sent email or completed review.','Do not jump to prices before an agreed engineer review.','Do not demand a decision before the buyer is ready or repeat discovery after a workable next step.'],template:'{follow_up_context}'},
];
const templateJudgment='Templates are illustrative, never compulsory scripts, questions or commitments. Choose one useful move for the current speaker, actual conversation, reviewed history and manager objective. Explain what the buyer gains when relevant; respect a reasonable chosen next step and use only supported claims.';
export function coreFoundationMoveFor(type:FoundationMomentType|string):FoundationMove|undefined {const definition=definitions.find(move=>move.momentType===type);return definition?{...structuredClone(definition),do:[templateJudgment,...definition.do],id:'core-'+definition.momentType,updatedAt:0,origin:'seed',exampleCount:0}:undefined;}
export function defaultGeneralFoundation():GeneralFoundation {return {version:1,updatedAt:0,moves:definitions.map(move=>coreFoundationMoveFor(move.momentType)!),examples:[],proposals:[],historicalMoves:[]};}

export const FOUNDATION_TAGS=['warm_acknowledgement','grounded_specificity','preserve_selected_items','explain_relevant_offer','keep_stage','fulfil_open_commitment','use_collected_information','capture_missing_email','preserve_review_sequence','optional_next_step','respect_incumbent','reduce_pressure','concise_reply','answer_actual_question','verify_specific_claims','explain_call_intent','reach_right_person','collect_contact_route','follow_agreed_review'] as const;
export const FOUNDATION_NEGATIVE_PATTERNS=['generic_discovery_after_selection','discovery_with_open_commitment','ask_email_already_given','erase_selected_item','pressure_supplier_switch','unsupported_fact_or_timing','bare_transfer','pitch_to_gatekeeper','repeat_rejected_wording','docs_only_instead_of_relevant_offer'] as const;
const tagDirectives:Record<typeof FOUNDATION_TAGS[number],{do:string;avoid:string}>={
 warm_acknowledgement:{do:'Acknowledge the buyer warmly within the useful reply.',avoid:'Do not sound monotone or add a stock service-desk acknowledgment.'},
 grounded_specificity:{do:'Use relevant current-company and current-call details to make the move concrete.',avoid:'Do not replace a specific buyer statement with a generic sales question.'},
 preserve_selected_items:{do:'Confirm the item or items the buyer actually selected.',avoid:'Do not erase a selected item or treat a deferred item as selected.'},
 explain_relevant_offer:{do:'Briefly explain the relevant current-company supported offer before a document handoff.',avoid:'Do not copy historical product facts or substitute a documents-only response for the reviewed explanation.'},
 keep_stage:{do:'Respect deal progress while addressing the current question or concern.',avoid:'Do not restart answered discovery or force a prior next step over the current objective.'},
 fulfil_open_commitment:{do:'Remember the agreed commitment and complete its gap when it is the current objective.',avoid:'Do not lose a commitment or use it to ignore a new question, concern, correction or refusal.'},
 use_collected_information:{do:'Use the details already given in this call.',avoid:'Do not ask for information that was already supplied.'},
 capture_missing_email:{do:'Ask for the email only when needed for an agreed send and still missing.',avoid:'Do not ask for contact details before a relevant agreed next step.'},
 preserve_review_sequence:{do:'Preserve the actual sending, review and later price-discussion sequence.',avoid:'Do not skip the review or invent a price or timing promise.'},
 optional_next_step:{do:'Keep an unagreed next step optional.',avoid:'Do not present a possibility as the buyer’s commitment.'},
 respect_incumbent:{do:'Explicitly let the buyer keep their current supplier.',avoid:'Do not require a supplier switch or assume dissatisfaction.'},
 reduce_pressure:{do:'Leave the buyer room to think and express their needs.',avoid:'Do not force a replacement, backup or quotation choice.'},
 concise_reply:{do:'Keep the response concise while retaining the useful action.',avoid:'Do not lose the answer or next step to filler.'},
 answer_actual_question:{do:'Address the buyer’s actual current and carried questions.',avoid:'Do not replace an answer with a generic discovery question.'},
 verify_specific_claims:{do:'Support each concrete claim with current-company evidence.',avoid:'Do not invent specifications, prices, availability or deadlines.'},
 explain_call_intent:{do:'Give brief identity and intent relevant to this contact.',avoid:'Do not give a bare transfer demand or detailed product pitch.'},
 reach_right_person:{do:'Reach or verify the purchasing person before buyer discovery.',avoid:'Do not ask a gatekeeper about needs, specifications or volumes.'},
 collect_contact_route:{do:'When the purchasing person is unavailable, ask for their name, best email and callback time.',avoid:'Do not continue the product pitch to the gatekeeper.'},
 follow_agreed_review:{do:'Ask about the actual agreed review and next decision.',avoid:'Do not invent prior delivery or completed review.'},
};
export const FOUNDATION_NEGATIVE_RULES:Record<typeof FOUNDATION_NEGATIVE_PATTERNS[number],string>={
 generic_discovery_after_selection:'After an item is selected, do not ask generic relevance or supply-partner-criteria questions.',
 discovery_with_open_commitment:'Preserve the agreed commitment; do not replace it with unrelated discovery, but address a new question, concern, correction or refusal before resuming it.',
 ask_email_already_given:'Never ask for the email again when the current contact already supplied it for this send.',
 erase_selected_item:'Never omit another item the buyer explicitly selected, or include an item still under research as selected.',
 pressure_supplier_switch:'Never pressure replacement or imply the incumbent must be changed to evaluate an alternative.',
 unsupported_fact_or_timing:'Never invent a company claim, number, quotation, availability or response deadline.',
 bare_transfer:'Never demand a transfer without brief who and intent.',
 pitch_to_gatekeeper:'Never pitch grades, specifications or prices, or ask needs/volumes of a routing contact.',
 repeat_rejected_wording:'Do not repeat a rejected suggestion or its rejected conversational move in the same situation.',
 docs_only_instead_of_relevant_offer:'When a reviewed lesson calls for it, briefly explain the supported relevant offer before the documents handoff; documents alone do not fulfil that lesson.',
};
const genericWords=new Set((JSON.stringify(definitions)+' '+JSON.stringify(tagDirectives)+' '+Object.values(FOUNDATION_NEGATIVE_RULES).join(' ')+' absolutely okay yeah got it sure glad happy great helpful understand appreciate thanks thank the that this those these i im ill id ive we were well weve you your yours they their them it its lets let can could would should may might need want like from for to in on of with about and or but then after before if only which what how when where who why best good useful current selected relevant exact requirements against writing compare comparison quote quotation prices information documents specs profile brochure email address name time reach responsible purchasing procurement person manager team charge send share offer supply supplies supplier company material product products item grade application review talk speak connect normally usually use interested interested help details choice reaction options context subject sequence received there warm response receive remains remain take look keep staying introductory supply main suitable port destination cover needed missing callback are am is are was do does dont didnt wont isnt not no never already still also as a an so anything own many much little normal first next last same else introducing closed captured equipment technical written without have has had us me my myself themselves themselves across common commonest say check confirm confirmed will willing available hours days sample test report risk switch choose chosen option follow following followup forward route routing consider considering buying buyer selling qualification questions question answer answered given retain respect permission please normal support supported wording acknowledgement acknowledges acknowledge specificity momentum discovery pressure preserve open fulfil collected capture pending research trust stall close follow verified unsupported required requirements concrete practical phase within short brief end warmly review next never start stop doing ask asks asking be being been').toLowerCase().match(/[a-z]+/g)||[]);
for(const word of 'budget rapport refusal callback reminder referral reseller distributor distribution order negotiation negotiate competitor competition outreach prospect consent consented schedule scheduling calendar appointment delay delayed busy voicemail unavailable transfer department introduction qualification process contact route documentation procurement followup follow up later question requests asks request objection response decision concern'.split(' '))genericWords.add(word);
const slots=new Set(['company_name','product_category','representative','application_subject','acknowledgement','needs_question','selected_item','item_documents','email_action','agreed_materials','review_sequence','research_item','optional_review_action','requested_fact','requirement_scope','quotation_question','follow_up_context','follow_up_question','evaluation_action','relevant_value','useful_next_action','negotiation_question']);
const unique=<T,>(values:T[]):T[]=>[...new Set(values)];
const fingerprint=(value:string)=>{let hash=2166136261;for(const character of value)hash=Math.imul(hash^character.charCodeAt(0),16777619);return (hash>>>0).toString(16).padStart(8,'0');};
export const foundationExampleId=(sourceId:string)=>'foundation-example-'+fingerprint(sourceId);
export function foundationTemplateIssue(value:unknown):string|null {
 if(typeof value!=='string'||!value.trim())return 'Write a reusable pattern with placeholders.';
 if(value.length>900)return 'Keep the reusable pattern within 900 characters.';
 const placeholders=[...value.matchAll(/\{([a-z_]+)\}/g)].map(match=>match[1]);
 if(placeholders.some(slot=>!slots.has(slot)))return 'Use only the available company/call placeholders.';
 const prose=value.replace(/\{[a-z_]+\}/g,' ');
 if(!/^[a-z\s.,!?;:'"“”‘’()—–-]*$/i.test(prose))return 'Company names, products, numbers, addresses and links belong in placeholders.';
 const words=prose.toLowerCase().replace(/[’‘]/g,"'").replace(/\b(?:i|we|you|they|it|that|there|who|what|let)'(?:m|re|ll|d|ve|s)\b/g,match=>match.replace(/'/g,'')).match(/[a-z]+/g)||[];
 if(words.some(word=>!genericWords.has(word)))return 'Keep shared wording general; put company details and the full explanation in the company lesson.';
 if(/\b(?:free|guaranteed|guarantee|better|superior|highest|lowest|fastest|cheapest|soon|shortly|asap|quickly)\b/i.test(prose))return 'A general pattern cannot authorize product advantages, concessions or timing promises.';
 return null;
}
function sharedTemplateIssue(value:unknown,momentType?:string):string|null {
 const issue=foundationTemplateIssue(value);if(issue)return issue;
 const text=String(value),required=momentType==='interest_narrowed'?['selected_item']:momentType==='email_close'?['agreed_materials']:[];
 if(!/\{[a-z_]+\}/.test(text))return 'Use a placeholder so this wording can be filled from the active company and call.';
 if(required.some(slot=>!text.includes('{'+slot+'}')))return 'Keep the placeholders required for this move.';
 return null;
}
function normalizedExample(raw:unknown):FoundationExample|null {
 if(!raw||typeof raw!=='object')return null;const value=raw as Partial<FoundationExample>;
 if(typeof value.id!=='string'||!/^foundation-example-[a-f0-9]{8}$/.test(value.id)||typeof value.momentType!=='string'||!(coreFoundationMoveFor(value.momentType)||/^custom_[a-z0-9_]{1,60}$/.test(value.momentType))||typeof value.template!=='string'||sharedTemplateIssue(value.template,value.momentType)||!Number.isFinite(value.approvedAt)||!value.approvedAt||value.approvedAt<0)return null;
 const tags=unique((value.tags||[]).filter((tag):tag is typeof FOUNDATION_TAGS[number]=>FOUNDATION_TAGS.includes(tag as typeof FOUNDATION_TAGS[number])));
 const negativePatterns=unique((value.negativePatterns||[]).filter(pattern=>FOUNDATION_NEGATIVE_PATTERNS.includes(pattern as typeof FOUNDATION_NEGATIVE_PATTERNS[number])));
 return {id:value.id,momentType:value.momentType,moveId:'core-'+value.momentType,template:value.template.trim(),tags,requiredMoves:tags.map(tag=>tagDirectives[tag].do),forbiddenMoves:tags.map(tag=>tagDirectives[tag].avoid),negativePatterns,approvedAt:value.approvedAt,updatedAt:typeof value.updatedAt==='number'&&Number.isFinite(value.updatedAt)?value.updatedAt:value.approvedAt,reviewCount:Number.isInteger(value.reviewCount)&&value.reviewCount!>0?value.reviewCount!:1,provenance:normalizedSharedProvenance(value.provenance),active:isProductApproved(value.provenance)};
}
function safeGenericText(value:unknown,max=650):value is string {return typeof value==='string'&&value.trim().length>0&&value.length<=max&&!foundationTemplateIssue(value);}
function normalizedProposal(raw:unknown):FoundationProposal|null {
 if(!raw||typeof raw!=='object')return null;const value=raw as Partial<FoundationProposal>;
 if(typeof value.id!=='string'||!/^foundation-proposal-[a-f0-9]{8}$/.test(value.id)||!safeGenericText(value.name,90)||!safeGenericText(value.when)||!safeGenericText(value.template,900)||sharedTemplateIssue(value.template)||!Array.isArray(value.do)||!value.do.length||value.do.some(item=>!safeGenericText(item))||!Array.isArray(value.doNot)||value.doNot.some(item=>!safeGenericText(item))||typeof value.momentType!=='string'||!/^custom_[a-z0-9_]{1,60}$/.test(value.momentType)||!Number.isFinite(value.createdAt)||!value.createdAt||!['pending','approved'].includes(value.status||''))return null;
 return {id:value.id,name:value.name.trim(),momentType:value.momentType,when:value.when.trim(),do:unique(value.do.map(item=>item.trim())),doNot:unique(value.doNot.map(item=>item.trim())),template:value.template.trim(),status:value.status as FoundationProposal['status'],createdAt:value.createdAt!,...value.status==='approved'&&Number.isFinite(value.approvedAt)&&value.approvedAt!>0?{approvedAt:value.approvedAt}:{},...value.origin==='learning_draft'?{origin:'learning_draft' as const}:{},...typeof value.learningSignature==='string'&&/^[a-f0-9]{8}$/.test(value.learningSignature)?{learningSignature:value.learningSignature}:{},provenance:normalizedSharedProvenance(value.provenance),active:value.status==='approved'&&isProductApproved(value.provenance)};
}
/** Seed content is code-owned; untrusted persisted records cannot rewrite it.
 * Only placeholder examples and explicitly approved generic proposals extend it. */
export function normalizeGeneralFoundation(raw:unknown):GeneralFoundation {
 const value=raw&&typeof raw==='object'?raw as Partial<GeneralFoundation>:{};
 const rawExamples=uniqueById((Array.isArray(value.examples)?value.examples:[]).map(normalizedExample).filter((item):item is FoundationExample=>!!item));
 const proposals=uniqueById((Array.isArray(value.proposals)?value.proposals:[]).map(normalizedProposal).filter((item):item is FoundationProposal=>!!item));
 const examples=rawExamples; // Historical/custom examples survive even when their move is inactive.
 const moves=defaultGeneralFoundation().moves.map(move=>{const matching=examples.filter(example=>example.active&&example.momentType===move.momentType);return {...move,exampleCount:matching.length,updatedAt:Math.max(0,...matching.map(example=>example.updatedAt))};});
 moves.push(...proposals.filter(item=>item.status==='approved'&&item.approvedAt&&item.active).map(item=>({id:item.id,momentType:item.momentType,name:item.name,when:item.when,do:item.do,doNot:item.doNot,template:item.template,updatedAt:item.approvedAt!,origin:'approved' as const,exampleCount:examples.filter(example=>example.active&&example.momentType===item.momentType).length})));
 const historicalMoves=uniqueById([...(Array.isArray(value.historicalMoves)?value.historicalMoves:[]),...(Array.isArray(value.moves)?value.moves:[])].filter(move=>move?.origin==='approved'&&typeof move.id==='string'&&typeof move.name==='string'&&typeof move.template==='string'&&!moves.some(active=>active.id===move.id)).map(move=>structuredClone(move)));
 return {version:1,updatedAt:Math.max(0,...examples.map(item=>item.updatedAt),...proposals.map(item=>item.approvedAt||item.createdAt)),moves,historicalMoves,examples:examples.map(example=>({...example,moveId:moves.find(move=>move.momentType===example.momentType)?.id||example.moveId})),proposals};
}
function uniqueById<T extends{id:string}>(items:T[]):T[]{return items.filter((item,index)=>items.findIndex(other=>other.id===item.id)===index);}
export function foundationStats(playbook:GeneralPlaybookRecord){const foundation=normalizeGeneralFoundation(playbook.foundation);return {moveCount:foundation.moves.length,exampleCount:foundation.examples.filter(item=>item.active).length,archivedExampleCount:foundation.examples.filter(item=>!item.active).length,pendingProductReviewCount:foundation.examples.filter(item=>!item.active).length+foundation.proposals.filter(item=>!item.active).length,pendingMoveCount:foundation.proposals.filter(item=>item.status==='pending').length,updatedAt:foundation.updatedAt,moves:foundation.moves.map(move=>({id:move.id,name:move.name,momentType:move.momentType,exampleCount:move.exampleCount,updatedAt:move.updatedAt}))};}
export type ApprovedFoundationExampleInput={id:string;momentType:string;template?:string;tags?:string[];requiredMoves?:string[];forbiddenMoves?:string[];negativePatterns?:string[];approvedAt:number;provenance?:SharedGuidanceProvenance};
/** The shared half is deliberately compiled from a known move and canonical
 * tags, never the raw explanation/transcript or company-specific good/bad line. */
export function upsertApprovedFoundationExample(playbook:GeneralPlaybookRecord,input:ApprovedFoundationExampleInput):GeneralPlaybookRecord {
 const foundation=normalizeGeneralFoundation(playbook.foundation),core=foundation.moves.find(item=>item.momentType===input.momentType);if(!core)return playbook;
 const id=foundationExampleId(input.id),old=foundation.examples.find(item=>item.id===id);
 const template=input.template&&!sharedTemplateIssue(input.template,input.momentType)?input.template:core.template;
 const raw={id,momentType:core.momentType,template,tags:input.tags||[],negativePatterns:input.negativePatterns||[],approvedAt:input.approvedAt,updatedAt:input.approvedAt,reviewCount:old?.reviewCount||1,provenance:input.provenance||{origin:'company_feedback'}};
 const example=normalizedExample(raw);if(!example)return playbook;
 if(old&&JSON.stringify({...old,updatedAt:0,approvedAt:0,reviewCount:0})===JSON.stringify({...example,updatedAt:0,approvedAt:0,reviewCount:0}))return playbook;
 if(old)example.reviewCount=old.reviewCount+1;
 const next=normalizeGeneralFoundation({...foundation,examples:[...foundation.examples.filter(item=>item.id!==id),example]});
 return {...playbook,updatedAt:Math.max(playbook.updatedAt,input.approvedAt),foundation:next};
}
export function proposeFoundationMove(playbook:GeneralPlaybookRecord,input:Omit<FoundationProposal,'id'|'status'|'createdAt'|'approvedAt'>,now=Date.now()):GeneralPlaybookRecord {
 const proposal=normalizedProposal({...input,id:'foundation-proposal-'+fingerprint(JSON.stringify(input)),status:'pending',createdAt:now,provenance:input.provenance||{origin:'company_feedback'}});
 if(!proposal)throw Error('A new shared move must contain only general wording and placeholders; company details stay in its company lesson.');
 const foundation=normalizeGeneralFoundation(playbook.foundation);
 if(foundation.proposals.some(item=>item.id===proposal.id))return playbook;
 return {...playbook,updatedAt:Math.max(playbook.updatedAt,now),foundation:normalizeGeneralFoundation({...foundation,proposals:[...foundation.proposals,proposal]})};
}
const LEARNING_DRAFT_TRIGGER='The buyer asks a question that the current moves do not cover.';
export const foundationProposalNeedsTriggerReview=(proposal:FoundationProposal)=>proposal.origin==='learning_draft'&&proposal.when===LEARNING_DRAFT_TRIGGER;
/** Unmatched approved feedback creates an editable proposal immediately. Only
 * known strategy codes enter this shared draft; raw Why, lines, names and facts
 * remain private. A person must refine the general trigger before approval. */
export function upsertLearningMoveProposal(playbook:GeneralPlaybookRecord,lesson:{reviewStatus?:string;momentType?:string;tags?:string[];compiledAt?:number},now=Date.now()):GeneralPlaybookRecord {
 if(lesson.reviewStatus!=='needs_move_approval'||coreFoundationMoveFor(lesson.momentType||''))return playbook;
 const tags=unique((lesson.tags||[]).filter((tag):tag is typeof FOUNDATION_TAGS[number]=>FOUNDATION_TAGS.includes(tag as typeof FOUNDATION_TAGS[number]))).sort();
 const signature=fingerprint(JSON.stringify(tags)),foundation=normalizeGeneralFoundation(playbook.foundation);
 if(foundation.proposals.some(proposal=>proposal.learningSignature===signature))return playbook;
 return proposeFoundationMove(playbook,{name:'New buyer response',momentType:'custom_reviewed_'+signature,when:LEARNING_DRAFT_TRIGGER,do:tags.length?tags.map(tag=>tagDirectives[tag].do):['Answer the buyer’s current question and preserve the useful next step.'],doNot:unique(['Do not invent company facts.',...tags.map(tag=>tagDirectives[tag].avoid)]),template:'{acknowledgement} {follow_up_question}',origin:'learning_draft',learningSignature:signature},now);
}
export function approveFoundationMove(playbook:GeneralPlaybookRecord,id:string,now=Date.now(),productApproval?:ProductGuidanceApproval):GeneralPlaybookRecord {
 const foundation=normalizeGeneralFoundation(playbook.foundation),proposal=foundation.proposals.find(item=>item.id===id);
 if(!proposal)throw Error('The proposed move was not found.');
 if(foundationProposalNeedsTriggerReview(proposal))throw Error('Edit this drafted move to define its general trigger before approving it. The full Why stays in its Company Brain.');
 return {...playbook,updatedAt:Math.max(playbook.updatedAt,now),foundation:normalizeGeneralFoundation({...foundation,proposals:foundation.proposals.map(item=>item.id===id?{...item,status:'approved',approvedAt:now,provenance:productApproval?{origin:'product_curation',productApproval}:item.provenance||{origin:'company_feedback'}}:item)})};
}

const norm=(value:string)=>value.replace(/[’‘]/g,"'").toLowerCase();
// Public product abbreviations are identities, not company-specific claims.
// Canonicalizing them keeps the move check from erasing a second chosen item
// merely because the rep/model uses its familiar spoken abbreviation.
const identityKey=(value:string)=>norm(value).replace(/\bgreen silicon carbide\b/g,'green sic').replace(/\bblack silicon carbide\b/g,'black sic').replace(/\bwhite fused alumina\b/g,'wfa').replace(/\bsilicon carbide\b/g,'sic').replace(/[^a-z0-9]+/g,' ').trim();
function containsUnapprovedTimingPromise(line:string):boolean {
 // A refusal is not a promise. Keep it local to its own clause so “I can't
 // guarantee 24 hours, but I'll send it shortly” still fails on “shortly”.
 const clauses=line.split(/(?<=[.!?])\s+|[,;—]|\b(?:but|however|and|yet|although|then)\b|\s+(?=(?:i|we)(?:'ll|\s+will)\b)/i);
 const timing=/\b(?:soon|shortly|asap|quickly|in a bit|right away|promptly|immediately|within twenty[- ]four hours|within 24 hours)\b/gi;
 for(const clause of clauses)for(const match of clause.matchAll(timing)){
  const before=clause.slice(0,match.index);
  if(!/\b(?:cannot|can't|won't|will not|do not|don't)\s+(?:promise|guarantee|commit)\b[^.!?;—]*$/i.test(before))return true;
 }
 return false;
}
const researchClause=/\b(?:research|not sure|haven't decided|have not decided|still considering|think about)\b/i;
const selectionClauses=(value:string)=>value.split(/[,;]|\.(?=\s)|\b(?:but|however)\b/i);
function currentState(context:FoundationContext):ConversationState {
 const provided=context.conversationState;
 const state=provided&&(!context.callId||!provided.callId||provided.callId===context.callId)?provided:deriveConversationState({callId:context.callId,turns:context.turns,callContext:context.callContext});
 return {...state,participant:preparedPurchasingParticipant(state.participant,context.callContext?.knownFacts,context.callContext?.doNotGuess)};
}
function currentContactTurns(context:FoundationContext,state:ConversationState){
 const turns=context.turns||[];if(!state.participant.afterTransfer)return turns;
 const start=turns.findIndex(turn=>turn.id===state.participant.segmentStartTurnId);return start>=0?turns.slice(start):[];
}
function legacyFoundationMoment(context:FoundationContext,playbook?:GeneralPlaybookRecord):{momentType:string;situation:string;reason:string} {
 const state=currentState(context),turns=currentContactTurns(context,state),latest=turns.findLast(turn=>turn.role!=='you'),line=norm(latest?.text||'');
 const objective=immediateBuyerObjectiveFor(turns);
 if(objective?.kind==='respect_refusal')return {momentType:'refusal',situation:'clear_buyer_refusal',reason:objective.purpose};
 const gate=coldCallGateFor({...context,conversationState:state});
 if(gate)return {momentType:'cold_call_gate',situation:gate.kind,reason:'The current cold-call contact has not been verified as purchasing, or is routing the call.'};
 const classification=classifyBuyerTurn(context);
 const sending=state.commitments.find(item=>item.id==='send_materials'&&!['cancelled'].includes(item.status));
 const negotiation=/\b(?:too expensive|too high|overpriced|higher than|costs? too much|price (?:is|seems) (?:high|higher)|discount|price match|match (?:their|that|the) price|reduce (?:the |your )?price|(?:lower|better) (?:your |the )?price|payment terms|net [0-9]+)\b/.test(line);
 if(negotiation&&objective?.kind==='address_objection')return {momentType:'negotiation',situation:'commercial_constraint_or_tradeoff',reason:'Clarify the buyer’s constraint and authorized options; a price challenge is not permission for a concession.'};
 if(classification.kind==='fact_request')return {momentType:'price_spec_stall',situation:'factual_request',reason:'A present factual demand must be answered from this company’s sources or specifically parked.'};
 if(objective?.kind==='address_objection'||/\b(?:trust|risk|reliab\w*|why (?:your company|should (?:i|we))|current supplier|(?:already|currently) have a supplier|existing supplier|incumbent|switch|changing suppliers|happy with.{0,30}supplier)\b/.test(line))return {momentType:negotiation?'negotiation':'trust_objection',situation:'current_buyer_concern',reason:'Address the current concern before logistics; preserve any earlier agreed next step for an appropriate return.'};
 if(objective?.kind==='acknowledge_correction')return {momentType:'needs_discovery',situation:'correct_buyer_context',reason:objective.purpose};
 if(objective?.kind==='respond_to_question')return {momentType:'needs_discovery',situation:'answer_current_question',reason:objective.purpose};
 if(sending&&state.facts.email?.value&&state.nextAction.kind==='confirm_send')return {momentType:'email_close',situation:'address_received_for_agreed_materials',reason:'The current contact supplied the missing destination for the current agreed send.'};
 const research=/\b(?:further (?:market )?research|need (?:to )?(?:research|check|think)|not sure|haven't decided|have not decided|still (?:researching|considering)|think about it)\b/i;
 const selection=/\b(?:interested in|focus on|looking (?:for|at)|we need|i need|we want|i want|prefer|choose|chosen|picked|select|only|just|would like|i'd like|we'd like)\b/i;
 const clauses=(latest?.text||'').split(/[,;]|\.(?=\s)/);
 const selectedClause=clauses.find(clause=>!research.test(clause)&&selection.test(clause)&&/\b[A-Z]+\d{2,6}\b|\b[A-Z][a-z]+\s+(?:[A-Z][A-Za-z]+|[A-Z]{2,5})\b/.test(clause));
 const previousRep=turns.slice(0,Math.max(0,turns.length-1)).findLast(turn=>turn.role==='you')?.text||'';
 const choiceAnswer=!!line&&!line.includes('?')&&/\b[A-Z]+\d{2,6}\b/.test(latest?.text||'')&&/\b(?:which|what)\b.{0,75}\b(?:grade|model|item|product|one|interested)/i.test(previousRep)&&!research.test(clauses[0]||'')&&!/\b(?:use|using|have|current|currently|already|supplier)\b/.test(line);
 const boundSelection=!!context.generalPlaybook&&context.generalPlaybook.companyId===context.manufacturer?.id&&!!context.generalPlaybook.selectedItem;
 const shortSelection=(latest?.text.match(/\S+/g)?.length||0)<=7&&/\b[A-Z]+\d{2,6}\b/.test(latest?.text||'')&&!/\?|\b(?:we use|using|we have|our current|current|currently|already|supplier|not|never|research|if|might|may)\b/.test(line);
 const namedSelection=selection.test(line)&&scopedSelectedItem(context,state)!=='that item'&&!/\b(?:we use|using|we have|our current|current|currently|already|supplier)\b/.test(line);
 if((boundSelection||!!selectedClause||choiceAnswer||shortSelection||namedSelection)&&!state.sequence.some(step=>['engineer_review','buyer_review','prices_after_review'].includes(step.id)))return {momentType:'interest_narrowed',situation:'buyer_selected_offered_item',reason:'The buyer selected an item; confirm it rather than restarting generic discovery.'};
 if(sending&&!['clarify_uncertainty','continue_conversation'].includes(objective?.kind||'')&&['capture_email','confirm_send','confirm_handoff_plan'].includes(state.nextAction.kind))return {momentType:'next_step_agreed',situation:'open_agreed_commitment',reason:'The buyer is currently progressing the agreed materials/review commitment; capture its actual missing detail.'};
 if(research.test(line)||objective?.kind==='clarify_uncertainty')return {momentType:'pending_research',situation:'buyer_needs_research',reason:'The buyer has deferred this item; give room to review without assuming interest.'};
 if(/\b(?:trust|risk|reliab\w*|why (?:your company|should (?:i|we))|current supplier|(?:already|currently) have a supplier|existing supplier|switch|changing suppliers)\b/.test(line))return {momentType:'trust_objection',situation:'incumbent_or_trust_concern',reason:'Respond to the stated incumbent/trust boundary with a low-risk optional evaluation.'};
 if(context.callContext?.relationship&&['dormant','existing_customer'].includes(context.callContext.relationship)||/follow.?up|reactivat/i.test(context.callType||'')||sending?.status==='fulfilled')return {momentType:'follow_up',situation:'explicit_follow_up_or_review',reason:'Follow supplied history or the current agreed review; never invent a previous interaction.'};
 if(state.participant.role==='purchasing'&&(state.participant.introductionNeeded||/\b(?:i (?:handle|manage|oversee) purchasing|(?:i am|i'm) in charge|that(?:'s| is) me|purchasing manager|procurement manager)\b/.test(line)))return {momentType:'intro',situation:'purchasing_contact_confirmed',reason:'The relevant contact is confirmed; introduce the company and call purpose without repeating the role check.'};
 const custom=matchingApprovedCustomMove(context,playbook);
 if(custom)return {momentType:custom.momentType,situation:'approved_custom_move',reason:'An approved shared move matches the current buyer’s specific situation.'};
 return {momentType:'needs_discovery',situation:'understand_current_buyer_needs',reason:'Choose one useful move from the buyer’s actual goal, current speaker, reviewed history and manager objective. Ask only when an unanswered detail would improve the decision; a supported explanation, acknowledgment or respecting a chosen next step may be more useful.'};
}
type MomentInterpretation={momentType:string;situation:string;reason:string};
/** A label is only a useful hint, not an instruction to force a tactic. Consider
 * both speakers and the selected objective before applying legacy signal rules. */
export function detectFoundationMoment(context:FoundationContext,playbook?:GeneralPlaybookRecord):MomentInterpretation {
 const state=currentState(context),turns=currentContactTurns(context,state);
 const last=turns.at(-1),buyer=turns.findLast(turn=>turn.role==='buyer'),line=norm(buyer?.text||'');
 const selected=context.selectedStage||(context.callContext?.stageId?{id:context.callContext.stageId,name:'',objective:''}:undefined);
 const cycle=curriculumForStage(selected)?.id;
 const objective=immediateBuyerObjectiveFor(turns);
 if(objective?.kind==='respect_refusal')return {momentType:'refusal',situation:'clear_buyer_refusal',reason:objective.purpose};
 // A request for coaching is not a buyer answer or evidence of progress.
 if(last?.role==='you'&&/[?？]\s*$/.test(last.text))return {momentType:'waiting_for_buyer',situation:'representative_question_unanswered',reason:'The representative just asked a question and no buyer answer follows. Allow time; do not repeat it or invent progress. Answer any still-open buyer concern only if the full conversation requires it.'};
 if(objective?.kind==='acknowledge_correction'||/\b(?:actually[, ]|i meant|we meant|that is not what|that\x27s not what|correction|to clarify|not .{1,35}but)\b/.test(line))return {momentType:'buyer_correction',situation:'correct_buyer_context',reason:'A correction changes the interpretation. Acknowledge and use the corrected meaning before choosing a next move; do not assume a new discovery stage.'};
 if(/\b(?:if|provided|subject to|as long as)\b/.test(line)&&/\b(?:we|i)\s+(?:can|will|would|could|are ready to|am ready to|intend to)\s+(?:place (?:the |an? )?order|order|proceed|go ahead|accept|sign)\b/.test(line))return {momentType:'conditional_close',situation:'conditional_acceptance',reason:'The buyer may be describing a conditional decision. Clarify the actual remaining condition and authority; a price word does not make this a generic quotation stall, and intent is not a completed order.'};
 if(!turns.length&&selected&&cycle!=='first_contact')return {momentType:'stage_opening',situation:'opening_for_selected_objective',reason:'There is no speech yet. Use the selected manager objective and reviewed client context for an appropriate opening; do not assume this is first contact or invent progress.'};
 const detected=legacyFoundationMoment(context,playbook);
 const explicitRoleConfirmation=/\b(?:i (?:handle|manage|oversee) purchasing|(?:i am|i\x27m) in charge|that(?:\x27s| is) me|purchasing manager|procurement manager)\b/.test(line);
 const greeting=/^(?:hi|hello|hey|good morning|good afternoon)[,.! ]*$|^(?:hi[, ]+|hello[, ]+)?(?:this is|it(?:\x27s| is)) [a-z ]{1,25}[.!]?$/i.test(buyer?.text.trim()||'');
 if(detected.momentType==='intro'&&(cycle&&cycle!=='first_contact'||buyer&&!explicitRoleConfirmation&&!greeting))return {momentType:'conversation_response',situation:'selected_objective_and_current_conversation',reason:'The selected objective or substantive buyer explanation does not justify a new introduction. Use the stage curriculum and full conversation without forcing a tactical label.'};
 if(detected.momentType==='cold_call_gate'&&cycle&&cycle!=='first_contact'&&detected.situation==='right_person_check')return {momentType:'conversation_response',situation:'uncertain_role_in_selected_stage',reason:'Use the selected objective and actual role evidence; no reliable basis for forcing a cold-call gate in this discussion.'};
 if(detected.momentType==='needs_discovery'&&selected&&cycle!=='discovery'&&cycle!=='first_contact')return {momentType:'conversation_response',situation:'selected_objective_and_current_conversation',reason:'No reliable tactical match: use the selected manager objective, relevant curriculum and actual conversation. Ask only a useful unresolved question, if appropriate.'};
 if(detected.momentType==='follow_up'&&cycle&&['technical_evaluation','quotation','negotiation','closing','existing_customer','reactivation'].includes(cycle))return {momentType:'conversation_response',situation:'selected_objective_with_client_history',reason:'Client relationship alone does not establish a follow-up tactic. Address the selected objective and current discussion using actual history.'};
 return detected;
}
function advisoryMove(context:FoundationContext,detected:MomentInterpretation):FoundationMove {
 const selected=context.selectedStage||(context.callContext?.stageId?{id:context.callContext.stageId,name:'',objective:''}:undefined);
 const cycle=curriculumForStage(selected);
 return {id:'advisory-'+detected.momentType,momentType:detected.momentType,name:detected.momentType==='waiting_for_buyer'?'Allow the buyer to answer':detected.momentType==='buyer_correction'?'Use the buyer’s correction':detected.momentType==='conditional_close'?'Clarify the remaining condition':detected.momentType==='stage_opening'?'Open for the selected objective':'Respond to the current conversation',when:detected.reason,do:[detected.reason,...selected?.objective?[`Selected manager objective: ${selected.objective}`]:[],...cycle?.moves||[]],doNot:['Do not infer agreement or progress from a repeated coaching request.','Do not force a tactic from a keyword or override company evidence, permissions, corrections or refusal.'],template:'',updatedAt:0,origin:'seed',exampleCount:0};
}
function matchingApprovedCustomMove(context:FoundationContext,playbook?:GeneralPlaybookRecord):FoundationMove|undefined {
 const line=norm((context.turns||[]).findLast(turn=>turn.role==='buyer')?.text||'');
 const common=new Set('the a an buyer asks ask about requests request when current person says saying with for this that their there wants want needs need'.split(' '));
 const stem=(word:string)=>word.replace(/(?:ing|ed|s)$/,'');
 const present=new Set((line.match(/[a-z]+/g)||[]).map(stem));
 const candidates=normalizeGeneralFoundation(playbook?.foundation).moves.filter(move=>move.origin==='approved').map(move=>{const words=unique((move.when.toLowerCase().match(/[a-z]+/g)||[]).filter(word=>word.length>=4&&!common.has(word)).map(stem));const score=words.filter(word=>present.has(word)).length;return {move,score,count:words.length};}).filter(item=>item.count>0&&item.score>=Math.min(2,item.count)).sort((a,b)=>b.score-a.score||b.move.updatedAt-a.move.updatedAt);
 return candidates[0]?.move;
}
function scopedSelectedItem(context:FoundationContext,state:ConversationState):string {
 const bound=context.generalPlaybook?.companyId===context.manufacturer?.id?context.generalPlaybook?.selectedItem:'';
 const turns=currentContactTurns(context,state),latest=turns.findLast(turn=>turn.role==='buyer')?.text||'';
 const clauses=selectionClauses(latest),line=clauses.filter(clause=>!researchClause.test(clause)).join(' '),deferred=clauses.filter(clause=>researchClause.test(clause)).join(' ');
 const reference=[context.manufacturer?.products||'',...(context.sources||[]).map(source=>source.text),...turns.filter(turn=>turn.role==='you'&&/\b(?:we|i)\s+(?:offer|supply|carry|sell|provide|make|manufacture)\b/i.test(turn.text)).map(turn=>turn.text)].join('\n');
 const identifiers=line.match(/\b[A-Z]+\d{2,6}\b|\b[A-Z][a-z]+\s+(?:[A-Z][A-Za-z]+|[A-Z]{2,5})\b/g)||[];
 const supported=identifiers.filter(item=>reference.toLowerCase().includes(item.toLowerCase()));
 // A legacy bound selection is local to the active company, but must not turn
 // an explicitly deferred product in this utterance into a selected product.
 if(bound)supported.unshift(...bound.split(' and ').filter(item=>!identityKey(deferred).includes(identityKey(item))||identityKey(line).includes(identityKey(item))));
 for(const product of (context.manufacturer?.products||'').split(/[,;]|\s+and\s+|\s*&\s*|\s*\/\s*/i).map(item=>item.trim()).filter(item=>item.split(/\s+/).length>=2)){
  if(identityKey(line).includes(identityKey(product))&&(!/\bwhite fused alumina\b/i.test(product)||!/\bF\d{2,6}\b/i.test(line)))supported.push(product);
 }
 // These are public identity abbreviations, not company claims; both sides
 // must still occur in the active company's reference or its actual rep offer.
 if(!/\bF\d{2,6}\b/i.test(line)&&/\bWFA\b/i.test(line)&&/\bwhite fused alumina\b/i.test(reference))supported.push('WFA');
 if(/\bgreen SiC\b/i.test(line)&&/\bgreen silicon carbide\b/i.test(reference))supported.push('green SiC');
 return supported.filter((item,index)=>supported.findIndex(other=>identityKey(other)===identityKey(item))===index).join(' and ')||'that item';
}
function categoryFor(context:FoundationContext):string {
 const products=(context.manufacturer?.products||'').replace(/\s+/g,' ').trim();
 return products&&products.split(/\s+/).length<=12&&!/\d|[%$€£]|\b(?:grades?|specifications?|purity|prices?|MOQ|lead time|CIF|FOB|certif\w*)\b/i.test(products)?products:'our products';
}
function bindingsFor(context:FoundationContext,state:ConversationState):Record<string,string> {
 const selected=scopedSelectedItem(context,state),sources=context.sources||[];
 const selectedSources=sources.filter(source=>selected!=='that item'&&selected.split(' and ').some(item=>source.text.toLowerCase().includes(item.toLowerCase())));
 const hasProfile=sources.some(source=>/company (?:profile|introduction)|corporate profile/i.test(source.title||''));
 const hasSpecs=selectedSources.some(source=>/spec(?:ification)?s?|technical data|data sheet/i.test((source.title||'')+' '+source.text));
 const hasBrochure=selectedSources.some(source=>/brochure|catalog/i.test((source.title||'')+' '+source.text));
 const doc=(context.generalPlaybook?.companyId===context.manufacturer?.id&&context.generalPlaybook?.bindings?.item_documents)||(hasSpecs?(hasProfile?'company profile and product specs':'product specs'):hasBrochure?'product brochure':hasProfile?'company profile and product information':'product information');
 const sending=state.commitments.find(item=>item.id==='send_materials'&&item.status!=='cancelled');
 let materials=sending?committedMaterialDescription(sending):selected!=='that item'?`${selected} information`:'the requested information';
 if(sending){
  const actual=sending.evidence.map(item=>item.quote).join(' '),catalog=sources.map(source=>source.text).join(' ');
  const named=unique(actual.match(/\b[A-Z]+\d{2,6}\b|\b[A-Z][a-z]+\s+(?:[A-Z][A-Za-z]+|[A-Z]{2,5})\b/g)||[]).filter(item=>catalog.toLowerCase().includes(item.toLowerCase())&&!materials.toLowerCase().includes(item.toLowerCase()));
  if(named.length&&/product specs|product information|product brochure/.test(materials))materials=materials.replace(/product specs|product information|product brochure/,named.join(' and ')+(/product specs/.test(materials)?' specs':' information'));
 }
 const engineer=state.sequence.some(item=>item.id==='engineer_review'),buyerReview=state.sequence.some(item=>item.id==='buyer_review'),prices=state.sequence.some(item=>item.id==='prices_after_review');
 const sequence=(engineer?' for your engineer to review':buyerReview?' for you to review':'')+(prices?' before we discuss prices':'');
 const current=norm(currentContactTurns(context,state).findLast(turn=>turn.role==='buyer')?.text||'');
 const requested=/\b(?:CIF|FOB)\b/i.exec(current)?.[0]?.toUpperCase();
 const requestedFact=/\b(?:price|pricing|quote|quotation|cost)\b/.test(current)?`${requested?requested+' ':''}quotation`:/\b(?:MOQ|minimum order)\b/i.test(current)?'minimum order quantity':/\blead time\b/.test(current)?'lead time':/\bcertif\w*\b/.test(current)?'certification':/\b(?:stock|availability|inventory)\b/.test(current)?'availability':'specification';
 const needs=state.buyerNeeds;
 const sendIsCurrent=!!sending&&!['cancelled','fulfilled'].includes(sending.status)&&['capture_email','confirm_send','confirm_handoff_plan'].includes(state.nextAction.kind);
 const relevantValue=sendIsCurrent?`I can send the ${doc} for review.`:'we can compare the documented information with your requirements without assuming a match.';
 // A bound template must not append a discovery question merely because the
 // model retrieved it. The current conversation supplies any useful next action.
 const usefulNextAction=sendIsCurrent?(state.facts.email?.value?'':"What's a good email for that?"):'';
 const evaluation='If useful, we could first compare the documented requirements before discussing an authorized evaluation.';
 const needsQuestion=needs?.facts.application?needs.facts.difficulty?'What would be most useful to improve about that?':'How is that material working for your application?':'What do you normally use these products for?';
 return {relevant_value:relevantValue,useful_next_action:usefulNextAction,negotiation_question:'Is the concern the unit price, or the total cost on the same delivery basis?',transfer_status:state.participant.transfer?.status||'',transfer_target:state.participant.transfer?.targetName||'',email_known:state.facts.email?.value?'yes':'no',evaluation_action:evaluation,company_name:context.manufacturer?.name||'our company',representative:context.representativeName||'',product_category:categoryFor(context),application_subject:'your application',acknowledgement:immediateBuyerObjectiveFor(currentContactTurns(context,state))?.kind==='respect_refusal'?'Understood.':'That helps.',needs_question:needsQuestion,selected_item:selected,item_documents:String(doc),email_action:state.facts.email?.value||!sendIsCurrent?'':"What's a good email for that?",agreed_materials:materials,review_sequence:sequence,research_item:'that item',optional_review_action:'Would relevant product information help with your review?',requested_fact:requestedFact,requirement_scope:state.facts.specs?.value?'your stated requirements':'your requirements',quotation_question:requestedFact.includes('quotation')&&!state.facts.destination_port?.value?'Which destination should the quote cover?':'',follow_up_context:sending?.status==='fulfilled'?'Following up on the materials we sent.':"I'm checking in about your requirements.",follow_up_question:engineer?'Has your engineer had a chance to review the materials?':'What would be useful for the next step?'};
}
/** Situation → shared move is resolved before request-local factual bindings.
 * No concrete binding is ever persisted in the shared foundation. */
export function resolveFoundationMove(context:FoundationContext,playbook?:GeneralPlaybookRecord):FoundationRequest {
 const detected=detectFoundationMoment(context,playbook),foundation=normalizeGeneralFoundation(playbook?.foundation);
 const move=foundation.moves.find(item=>item.momentType===detected.momentType)||advisoryMove(context,detected);
 const examples=foundation.examples.filter(example=>example.active&&example.momentType===move.momentType).sort((a,b)=>b.reviewCount-a.reviewCount||b.updatedAt-a.updatedAt).slice(0,5);
 const state=currentState(context),bindings=bindingsFor(context,state);
 const reviewedInterest=move.momentType==='interest_narrowed'&&context.generalPlaybook?.companyId===context.manufacturer?.id?context.generalPlaybook?.template:undefined;
 const template=examples[0]?.template||(context.generalPlaybook?.patternId==='interest-narrowed-v1'?reviewedInterest:undefined)||move.template;
 let boundExample=template.replace(/\{([a-z_]+)\}/g,(_whole,key:string)=>bindings[key]||'').replace(/\s+/g,' ').trim();
 if(move.momentType==='cold_call_gate'){
  const gate=coldCallGateFor({...context,conversationState:state});
  if(gate)boundExample=coldCallGateLineFor({manufacturer:context.manufacturer,sources:context.sources,turns:context.turns,voice:context.voice},gate.kind)||boundExample;
 }
 if(move.momentType==='intro'&&!state.participant.introductionNeeded)boundExample=`We supply ${bindings.product_category}.`;
 if(move.momentType==='trust_objection'){
  const latest=norm(currentContactTurns(context,state).findLast(turn=>turn.role==='buyer')?.text||'');
  if(!state.buyerNeeds?.facts.current_supplier&&!/\b(?:current|existing|incumbent|already have|our)\b.{0,35}\bsupplier\b/.test(latest)&&!/\b(?:switch|chang\w*)\b/.test(latest))boundExample='You can assess us against your requirements. I can share the relevant product information for your review.';
  else if(/\b(?:not interested|no thanks|don't want|do not want|don't need|do not need)\b/.test(latest)&&!/\b(?:but|however)\b.{0,70}\b(?:might|could|open to|compare|comparison)\b/.test(latest))boundExample='Understood. Thanks for letting me know.';
  else if(!/\b(?:why|trust|risk|switch|chang\w*)\b/.test(latest))boundExample='That makes sense. Is there anything you would want to compare before considering another option?';
  else if(/\b(?:qualif\w*|engineer\w*|project|effort|workload)\b/.test(latest))boundExample='No need to switch; we could start with a document comparison. What would be useful for that initial review?';
 }
 return {version:1,momentType:move.momentType,moveId:move.id,moveName:move.name,situation:detected.situation,when:move.when,do:unique([...move.do,'Apply learned examples only when their tactic fits the current buyer objective; an earlier email-capture example never makes product interest consent to send.',...examples.flatMap(example=>example.requiredMoves)]),doNot:unique([...move.doNot,...examples.flatMap(example=>example.forbiddenMoves)]),template,boundExample,bindings,exampleIds:examples.map(example=>example.id),examples,negativeRules:unique([...move.doNot,...examples.flatMap(example=>example.negativePatterns.map(pattern=>FOUNDATION_NEGATIVE_RULES[pattern as typeof FOUNDATION_NEGATIVE_PATTERNS[number]]).filter(Boolean))]),exampleCount:move.exampleCount,updatedAt:move.updatedAt,companyId:context.manufacturer?.id||'',detectionReason:detected.reason,tacticalLabel:move.id.startsWith('advisory-')?null:move.momentType};
}

/** Deterministic conversational self-check. Numeric company claims continue
 * through the existing source verifier; this checks the chosen sales move. */
export function foundationSuggestionProblems(say:string,foundation:FoundationRequest|null|undefined,options:{partial?:boolean}={}):string[] {
 if(!foundation)return ['No General Playbook move was selected before generation.'];
 const line=norm(say),problems:string[]=[];
 const codes=new Set(foundation.examples.flatMap(example=>example.negativePatterns));
 const genericDiscovery=/\bwhat\b.{0,45}\blooking for\b.{0,30}\b(?:supply partner|supplier)\b|\bis (?:this|that|it) relevant\b|\b(?:what|which)\b.{0,30}\b(?:supply[- ]partner criteria|supplier criteria|kind of supplier)\b/;
 const selected=foundation.bindings.selected_item;
 if((foundation.momentType==='interest_narrowed'||codes.has('generic_discovery_after_selection'))&&genericDiscovery.test(line))problems.push('Build on the selected interest instead of restarting generic relevance discovery.');
 if((foundation.momentType==='next_step_agreed'||foundation.momentType==='email_close')&&genericDiscovery.test(line))problems.push('Do not replace the current agreed next step with unrelated generic discovery.');
 if((foundation.momentType==='email_close'||codes.has('ask_email_already_given')||foundation.bindings.email_known==='yes')&&/\b(?:what|which|good|best|give|share|confirm|provide)\b.{0,40}\b(?:email|address)\b[^.!]*\?/.test(line))problems.push('The current destination is already known; do not ask for the email again.');
 if(!options.partial&&(foundation.momentType==='interest_narrowed'||codes.has('erase_selected_item'))&&selected&&selected!=='that item'){
  const items=selected.split(' and '),explicitModels=say.match(/\b[A-Z]{1,6}\d{2,6}\b/gi)||[];
  const differentModel=explicitModels.some(model=>!items.some(item=>identityKey(item).includes(identityKey(model))));
  // A single selection is already established by the actual buyer turn. A
  // relevant needs/fit question need not repeat a product name or pronoun.
  // Protect against substituting another model, not against varied wording.
  // Multiple selections still require preserving every item; agreed-material
  // confirmations retain their separate completeness checks below.
  if(items.length===1){
   if(differentModel&&!identityKey(say).includes(identityKey(selected)))problems.push('Do not substitute a different product for the buyer’s selected item: '+selected+'.');
  }else for(const item of items)if(!identityKey(say).includes(identityKey(item)))problems.push('Keep the buyer’s selected item in the reply: '+item+'.');
 }
 if(!options.partial&&foundation.momentType==='email_close'){
  const agreed=foundation.bindings.agreed_materials||'';
  const materialKinds:[RegExp,RegExp,string][]=[
   [/\bprofile\b/i,/\b(?:profile|company introduction)\b/i,'company profile'],
   [/\bspecs?|specifications?|data sheets?\b/i,/\b(?:specs?|specifications?|data sheets?|technical data)\b/i,'product specifications'],
   [/\b(?:catalog|brochure)\b/i,/\b(?:catalog|brochure)\b/i,'catalog or brochure'],
   [/\b(?:website|web site|link)\b/i,/\b(?:website|web site|link)\b/i,'website link'],
   [/\btest report\b/i,/\b(?:test report|test results)\b/i,'test report'],
  ];
  for(const [required,present,label] of materialKinds)if(required.test(agreed)&&!present.test(say))problems.push('Restate the agreed '+label+' in the email confirmation.');
  const identities=unique([...(agreed.match(/\b[A-Z]+\d{2,6}\b/g)||[]),...(agreed.match(/\b(?:white fused alumina|green silicon carbide|black silicon carbide|green SiC|black SiC|WFA|SiC)\b/gi)||[])]);
  for(const item of identities)if(!identityKey(say).includes(identityKey(item)))problems.push('Restate the actual agreed item in the email confirmation: '+item+'.');
 }
 if(foundation.momentType==='cold_call_gate'){
  if(/\b(?:F\d{2,6}|MOQ|purity|CIF|FOB|price is|prices are|per ton|per kilogram|\d+(?:[.]\d+)?\s*%)\b/i.test(say)||/\b(?:what|which|how much|how many)\b.{0,55}\b(?:grades?|specifications?|needs?|volumes?|quantit\w*|tons?|application)\b/.test(line))problems.push('Do not pitch specifications or ask buyer needs/volumes of the unverified or routing contact.');
  const hasIntent=/\b(?:calling about|profile|review|supply|supplies|offer|products?|materials?)\b/.test(line);
  if(foundation.situation!=='transfer_wait'&&!hasIntent&&/\b(?:transfer|connect|speak|put me through)\b/.test(line)&&(!options.partial||/[.!?]\s*$/.test(line)))problems.push('Give a brief reason for the call before requesting a transfer.');
  if(!options.partial&&foundation.situation!=='transfer_wait'&&!hasIntent)problems.push('Give a brief reason for the call before requesting a transfer.');
  if(foundation.situation==='transfer_wait'&&/\b(?:hi|hello|good morning|good afternoon)\b/.test(line)&&foundation.bindings.transfer_target&&line.includes(norm(foundation.bindings.transfer_target)))problems.push('The target has not joined; address the current routing contact until pickup evidence.');
  if(foundation.situation==='transfer_wait'&&foundation.bindings.transfer_status==='pending'&&/\b(?:connect me|transfer me|put me through)\b/.test(line))problems.push('The transfer is actively underway; acknowledge it instead of requesting the same transfer again.');
  // Unavailability needs one useful missing route, not a mandatory three-field checklist.
  if(!options.partial&&foundation.situation==='unavailable_contact'&&!/\b(?:name|email|time|when|reach|call back|callback|thank)\b/.test(line))problems.push('Offer a useful missing contact route or respectful close when the person is unavailable.');
 }
 if(foundation.momentType==='refusal'&&(/\b(?:but|however|before you go|just give|give us a chance)\b/.test(line)||/\b(?:what|which|could|can|may)\b[^.!?]{0,80}\b(?:email|address|send|try|switch|consider)\b[^.!?]*\?/.test(line)))problems.push('Respect the buyer’s refusal without another persuasion or contact request.');
 if(foundation.momentType==='intro'&&/\b(?:who handles|person (?:responsible|in charge)|speak with|connect me|transfer me)\b.{0,45}\b(?:purchasing|procurement)\b/.test(line))problems.push('Purchasing responsibility is confirmed; continue the introduction and needs instead of routing again.');
 if((foundation.momentType==='trust_objection'||codes.has('pressure_supplier_switch'))&&/\b(?:you (?:need|must|have) to (?:switch|change|replace)|(?:switch|replace) your (?:current )?supplier (?:now|first)|we (?:are|offer|provide) (?:better|superior|cheaper))\b/.test(line))problems.push('Keep evaluation optional and preserve the buyer’s current supplier.');
 if(['interest_narrowed','next_step_agreed','email_close'].includes(foundation.momentType)&&/\b(?:once verified|once (?:we|i) verify|after verification|(?:check|confirm|verify)(?: [a-z]+){0,5} with (?:our |the )?(?:team|factory))\b/.test(line))problems.push('Confirm the current selected item or agreed send without unnecessary factory/team verification language.');
 if((foundation.momentType==='price_spec_stall'||codes.has('unsupported_fact_or_timing'))&&containsUnapprovedTimingPromise(line))problems.push('Do not invent a response deadline or vague timing promise.');
 return unique(problems);
}
