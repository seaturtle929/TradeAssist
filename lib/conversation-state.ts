import {materialClauses as clauses,materialRefusal,independentMaterialAction,affirmativeMaterialAction} from './material-request-meaning.ts';
import {configurationReferences} from './company-configuration.ts';
import {deriveDocumentState,isBuyerOwnedDocumentSend,acceptedDocumentOfferAt,attributedDocumentCompletions,type DocumentState} from './document-state.ts';
import {reviewedClientStateFacts,reviewedClientNeedSeed} from './client-coaching-context.ts';
import {fieldEvidence,emailEvidenceFor,currentContactEmailEvidence,type BuyerFactTurn} from "./buyer-facts.ts";
import {deriveCallParticipant,isParticipantIntroduction,isCurrentParticipantIntroduction,preparedPurchasingParticipant,type CallParticipant} from "./call-participant.ts";
import {deriveBuyerNeeds,type BuyerNeeds} from './buyer-needs.ts';
import {isCompanyChoiceQuestion,substantiveBuyerQuestions} from './buyer-turn-intent.ts';
import {hasClearConversationRefusal} from './conversation-boundary.ts';
import {analyzeDocumentActionSyntax} from './document-action-syntax.ts';
export {hasClearConversationRefusal} from './conversation-boundary.ts';

export type StateFact={value:string;turnId:string;quote:string;source:"transcript"|"memory"|"context"};
export type CallCommitment={id:string;action:string;owner:"you"|"buyer";status:"needs_email"|"ready"|"blocked"|"fulfilled"|"cancelled";missing:string[];evidence:{turnId:string;quote:string}[]};
export type ImmediateBuyerObjective={kind:'respond_to_question'|'address_objection'|'clarify_uncertainty'|'acknowledge_correction'|'respect_refusal'|'complete_commitment'|'continue_conversation';purpose:string;buyerTurnId?:string;suspendedCommitmentIds:string[]};
export type ConversationState={callId?:string;stageId:string;stageName?:string;stagePurpose:string;moment:string;participant:CallParticipant;buyerNeeds?:BuyerNeeds;documents?:DocumentState;facts:Record<string,StateFact>;missingFacts:string[];commitments:CallCommitment[];sequence:{id:string;label:string;owner:"you"|"buyer";status:string}[];lastAgreedNextStep:string;nextAction:{kind:string;gap:string;purpose:string;easyToAnswer:boolean;unlocks:string;alreadyAnswered:boolean};immediateObjective?:ImmediateBuyerObjective;deferredCommitments?:{id:string;reason:string;resumeWhen:string}[];movedPastDiscovery:boolean;processedTurnIds?:string[]};
export type StateInput={sources?:import('./document-product-evidence').DocumentProductSource[];clientContext?:import('./client-coaching-context').ClientCoachingContext;clientId?:string;contactId?:string;manufacturer?:{id?:string};companyConfiguration?:import("./company-configuration").CallConfigurationBinding;callId?:string;turns?:BuyerFactTurn[];callContext?:{stageId?:string;knownFacts?:string;doNotGuess?:string};stageMap?:{id:string;name:string;purpose:string}[];buyerMemory?:{callId?:string;participant?:CallParticipant;buyerNeeds?:BuyerNeeds;facts?:Record<string,StateFact>;commitments?:CallCommitment[];lastAgreedNextStep?:string;sequence?:ConversationState["sequence"];processedTurnIds?:string[];documents?:DocumentState}};
/** A familiar buyer name never establishes continuity with a previous phone call. */
export function currentCallMemory<T extends {callId?:string}>(callId:string|undefined,memory:T|undefined):T|undefined {return callId&&memory?.callId===callId?memory:undefined;}
const norm=(value:string)=>value.replace(/[’‘]/g,"'").toLowerCase();
const fields={email:"Email",specs:"Specs",volumes:"Volumes",current_supplier:"Current supplier",decision_maker:"Decision maker",right_person:"Right person"};
const materialMatches=(line:string)=>[
  ['company profile',/\bprofile\b|\bcompany introduction\b/],
  ['product specs',/\bspec(?:ification)?s?\b|\btechnical data sheets?\b/],
  ['product drawings',/\b(?:engineering |technical |product )?drawings?\b/],
  ['catalog',/\bcatalog\w*|\bbrochure/],
  ['product information',/\bproduct (?:information|info|details|range|overview)\b|\bcopy of what (?:you|we) (?:produce|make)\b/],
  ['website link',/\b(?:company (?:website|link)|website(?: (?:link|address))?|web site)\b/],
].map(([name,pattern])=>({name:name as string,index:line.search(pattern as RegExp)})).filter(item=>item.index>=0).sort((a,b)=>a.index-b.index);
const materialNames=(line:string)=>materialMatches(line).map(item=>item.name);
const joinMaterials=(items:string[])=>{const unique=[...new Set(items)];return unique.length>1?`${unique.slice(0,-1).join(', ')} and ${unique.at(-1)}`:unique[0]||'requested information';};
function materialGroups(raw:string):string[][] {
  const line=norm(raw),matches=materialMatches(line),groups:string[][]=[];
  for(let index=0;index<matches.length;index++){
    const item=matches[index],between=index?line.slice(matches[index-1].index,item.index):'';
    if(index&&/\bor\b/.test(between)&&!/[.;:]|\b(?:and|plus)\b/.test(between))groups.at(-1)!.push(item.name);
    else groups.push([item.name]);
  }
  return groups;
}
function describeMaterialGroups(groups:string[][]):string {
  const nonempty=groups.filter(group=>group.length),parts=nonempty.map(group=>group.join(' or '));
  return nonempty.some(group=>group.length>1)&&parts.length>1?parts.join(', plus '):joinMaterials(parts);
}
function mergeMaterialGroups(previous:string[][],incoming:string[][]):string[][] {
  const result=previous.map(group=>[...group]);
  for(const group of incoming){
    // A definite request for one option satisfies the earlier either/or request.
    if(group.length===1){
      if(result.some(old=>old.length===1&&old[0]===group[0]))continue;
      const choice=result.findIndex(old=>old.length>1&&old.includes(group[0]));
      if(choice>=0)result.splice(choice,1,[...group]);else result.push([...group]);
    }else if(!result.some(old=>old.length===1&&group.includes(old[0])||old.length===group.length&&old.every(name=>group.includes(name))))result.push([...group]);
  }
  return result;
}
/** Canonical material wording retains an actual either/or choice, not a promise
 * to send every mentioned option. It also renders older stored send actions. */
export const materialDescriptionFor=(raw:string)=>describeMaterialGroups(materialGroups(raw));
const conditionalOffer=(line:string)=>/\b(?:if|unless|maybe|perhaps)\b/.test(line);
const affirmativeMaterialClause=(line:string)=>!!affirmativeMaterialAction(line);
const definiteSendingPromise=(line:string)=>{const main=independentMaterialAction(line);return !!main&&/^(?:i|we)(?:'ll| will) (?:send|email|share|forward)\b/.test(main)&&!conditionalOffer(line)&&!/\b(?:not|never|didn't|did not|don't|do not|won't|will not)\b/.test(main)&&!line.includes('?');};
const incompleteReview=(line:string)=>/\b(?:not|never|hasn't|has not|haven't|have not|isn't|is not|aren't|are not|didn't|did not|don't know|do not know|not sure|still waiting)\b.{0,55}\b(?:review\w*|check\w*|evaluat\w*|finish\w*|approv\w*|complete\w*|done)\b|\b(?:review|evaluation)\b.{0,25}\b(?:not|pending|incomplete|unfinished)\b/.test(line);
const conditionalReview=(line:string)=>/\b(?:if|once|when|after|before|until)\b.{0,70}\b(?:review\w*|check\w*|evaluat\w*|finish\w*|approv\w*|complete\w*|done)\b/.test(line);
const completedReview=(line:string)=>/\b(?:engineer\w*|technical team|engineering team)\b.{0,50}\b(?:reviewed|checked|evaluated|finished|approved)|\b(?:review|evaluation)\b.{0,20}\b(?:complete|finished|done)\b/.test(line)&&!incompleteReview(line)&&!conditionalReview(line);
/** Shared by flow and reply validation so a negated mention cannot become consent. */
export const hasAffirmativeMaterialsRequest=(raw:string)=>clauses(norm(raw)).some(affirmativeMaterialClause);
export const hasMaterialsRefusal=(raw:string)=>clauses(norm(raw)).some(materialRefusal);
export const materialsNamed=(raw:string)=>materialNames(norm(raw));
export const affirmativeMaterialsNamed=(raw:string)=>[...new Set(clauses(norm(raw)).flatMap(line=>materialNames(affirmativeMaterialAction(line)||'')))];

/** Address receipt may share a turn with a new stakeholder/need constraint.
 * Strip only ordinary receipt wording, not the buyer's additional clauses. */
function hasSubstantiveAddressRemainder(line:string):boolean {
  let content=line.replace(/\b[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}\b/gi,' ')
    .replace(/\b[a-z0-9._+-]+\s+at\s+[a-z0-9.-]+\s+dot\s+[a-z]{2,}\b/gi,' ')
    .replace(/\b[a-z]{1,5}-?\d{2,5}\b/gi,' ')
    .replace(/\b(?:let's|let us) (?:go|get) back to\b/gi,' ')
    .replace(/\b(?:i|we) (?:was|were) (?:unsure|uncertain|concerned) before,? but (?:i am|i'm|we are|we're) (?:comfortable|ready|satisfied) with (?:the |that )?(?:evaluation|review|plan) now[.!]?/gi,' ');
  // A buyer may decline to recall an earlier detail and propose a document
  // review instead. Those bounded handoff phrases are not another constraint;
  // additional lab, legal or other substantive clauses still remain below.
  if(hasAffirmativeMaterialsRequest(line))content=content
    .replace(/\bnot (?:on|off) (?:the )?top of my head\b/gi,' ')
    .replace(/\bhow about (?:this|that)\b/gi,' ')
    .replace(/\b(?:take a look|look (?:at|through) (?:it|them|that|those))\b/gi,' ')
    .replace(/\b(?:get|come) back to you\b/gi,' ');
  const receiptWords=new Set('a an the i im my me we our us you your it its them this that those these to at for from there is are be and or yes yeah yep okay ok sure fine great perfect right all alright use send sending email emailing share forward attach include also over please can could would will should may want need best correct corrected new address old work personal business company profile product products spec specs specification specifications drawing drawings information info materials documents copy copies link links website websites engineer engineers engineering review received receive got have has thanks thank much very again help time appreciate'.split(' '));
  const remainder=(content.match(/[a-z]+/g)||[]).filter(word=>!receiptWords.has(word));
  return remainder.length>=2||remainder.length>0&&/\b(?:but|however|unless|until|before|cannot|can't|won't)\b/.test(content);
}

/** Immediate attention is separate from deal progress. An older delivery plan
 * remains in state; it does not decide the answer to a new concern. This reads
 * only actual spoken turns and permits an ordinary acknowledgment to resume it. */
export function immediateBuyerObjectiveFor(turns:BuyerFactTurn[]=[]):ImmediateBuyerObjective|undefined {
  const latest=turns.at(-1);if(!latest||latest.role!=='buyer')return;
  const line=norm(latest.text),base={buyerTurnId:latest.id,suspendedCommitmentIds:[] as string[]};
  const objective=(kind:ImmediateBuyerObjective['kind'],purpose:string)=>({...base,kind,purpose});
  if(hasClearConversationRefusal(line))return objective('respect_refusal',"Respect the buyer's boundary; acknowledge it and stop pursuing the declined conversation.");
  // Identity/routing and delivery bookkeeping keep their dedicated state paths.
  if(isParticipantIntroduction(line)||/^(?:what(?:'s| is) this (?:about|regarding)|who(?:'s| is) (?:calling|this)|who are you)[?!\s]*$/.test(line))return;
  const questions=substantiveBuyerQuestions({turns});
  const evaluationProcess=/\b(?:lab|laboratory|engineers?|engineering|technical team|quality team|qualif\w*|evaluat\w*|sign(?:ed)?[- ]?off|approval)\b/.test(line)
    &&/\b(?:obstacle|bottleneck|headache|burden|workload|a lot of work|extra work|weeks|months|effort|owns? (?:that|the) decision|takes? ownership|needs? sign[- ]?off|need(?:s)? approval|has to|have to)\b/.test(line);
  const evaluationConcern=evaluationProcess||/\b(?:i(?:'m| am)|we(?:'re| are)|our (?:engineers?|team) (?:is|are))\s+(?:really |a little |still )?(?:worried|concerned|nervous|not confident)\b/.test(line)
    ||/\b(?:qualif\w*|evaluat\w*|onboard\w*|switch\w*|chang\w*)\b.{0,85}\b(?:a lot of work|extra work|weeks|months|effort|risk|disruption|cost)\b/.test(line)
    ||/\b(?:not confident|doubt|doubts)\b.{0,65}\b(?:meet|fit|quality|requirements?|work|perform)\b/.test(line);
  const objection=evaluationConcern||isCompanyChoiceQuestion(line)||/\b(?:why (?:should|would) (?:we|I).{0,55}(?:risk|chang\w*|switch\w*)|risk (?:of|in) (?:chang\w*|switch\w*)|(?:worried|concerned|nervous|concern|risk)\b.{0,50}(?:suppliers?|switch\w*|quality|supply|chang\w*)|already (?:have|use|work with).{0,30}suppliers?|(?:happy|satisfied) with.{0,25}suppliers?|too expensive|too high|overpriced|higher than|costs? too much|reduce (?:the |your )?price|(?:lower|better) (?:your |the )?price|discount|not interested in (?:switch\w*|chang\w*|replac\w*)|not looking (?:for|to))\b/.test(line);
  if(objection)return objective('address_objection',evaluationProcess?"Address the engineering or lab approval process and its workload before returning to logistics. Explain only supported evaluation help or ask one relevant question about the actual approval constraint; repeating the earlier document offer or a send-versus-pause menu does not resolve it. Do not imply that another qualification project has been accepted or promise to remove their work.":"Address the buyer's concern or negotiating constraint before proposing logistics; do not assume dissatisfaction or approval of concessions.");
  if(questions.length)return objective('respond_to_question',"Answer the buyer's current question(s), distinguish supported facts from unknowns, and use only a relevant clarification if needed.");
  // Uncertainty about whether an already agreed review happened is review
  // status, not a fresh objection to conducting that evaluation.
  if(/\b(?:engineer|review|evaluation)\b/.test(line)&&/\b(?:reviewed|checked|evaluated|complete|finished|done|pending|not yet|hasn't|haven't)\b/.test(line))return;
  const uncertainDecision=/\b(?:i(?:'m| am)|we(?:'re| are))\s+(?:still )?(?:unsure|uncertain|not sure)\b.{0,80}\b(?:whether|if|worth|evaluat\w*|decid\w*|fit|need|proceed|forward)\b/.test(line)
    ||/\b(?:let me think|need to think|think about (?:it|that)|give (?:me|us) (?:some )?time|not sure|haven't decided|have not decided|need.{0,25}(?:research|discuss internally))\b/.test(line);
  // A real decision uncertainty must not be lost merely because an address is
  // also supplied. Bare "unsure" in a quoted/negated phrase is not enough.
  if(uncertainDecision&&!hasAffirmativeMaterialsRequest(line))return objective('clarify_uncertainty',"Give the buyer room; clarify a genuine uncertainty only if useful, without treating hesitation as consent or demanding a decision.");
  const correction=/\b(?:correction|I meant|I said|that's not|that is not|you misunderstood|actually|rather than|instead)\b/i.test(line)||/\b(?:not|isn't)\s+(?:F\d+|[A-Z]{1,5}\d+)\b/i.test(latest.text);
  const hasAddress=!!fieldEvidence('Email',[latest]);
  const itemCorrection=correction&&/\b(?:I meant|I said|you misunderstood|grade|product|model|material|quantity|volume|requirement|application|[a-z]{1,5}\d{2,})\b/i.test(line);
  if(itemCorrection&&!hasAffirmativeMaterialsRequest(line))return objective('acknowledge_correction',"Acknowledge and use the buyer's corrected information before deciding what to do next.");
  if(hasAddress&&hasSubstantiveAddressRemainder(line))return objective('continue_conversation',"Retain the supplied address and agreed materials, but respond to the additional buyer information or constraint before closing. An email is not evidence that the rest of this turn has been addressed.");
  if(hasAffirmativeMaterialsRequest(line)||hasMaterialsRefusal(line))return;
  // A corrected address or review status already changes the actual commitment;
  // an address alongside a new question/concern is handled above, not closed.
  if(hasAddress||/\b(?:email|address)\b/.test(line)&&/\b(?:wrong|incorrect|not|instead|replace|use|send|shared|gave|fine|correct|works|okay)\b/.test(line))return;
  if(/\b(?:i|we|my engineer|our (?:engineer|technical team))\b.{0,100}\b(?:review|take a look|look through|get back|come back|evaluat)/.test(line)&&!/\b(?:worried|concerned|risk|uncertain)\b/.test(line))return;
  if(/\b(?:then|after|next|later)\b.{0,50}\b(?:i|we)\b.{0,40}\b(?:prices?|pricing|quotes?|quotation)\b/.test(line))return;
  if(correction)return objective('acknowledge_correction',"Acknowledge and use the buyer's corrected information before deciding what to do next.");
  if(/\b(?:different (?:subject|question|topic)|another (?:point|thing)|we (?:use|need|buy|make)|our (?:application|process|priority|requirement)|I'm interested|we're interested)\b/.test(line))return objective('continue_conversation',"Respond to the buyer's new information with relevant supported value or one useful question; keep earlier commitments available for later.");
  // An unfamiliar substantive sentence must reach contextual generation, not
  // silently fall back to an older email request. Only ordinary acknowledgments
  // and the explicit delivery/review continuations above resume bookkeeping.
  const acknowledgment=/^\s*(?:(?:okay|ok|yes|yeah|yep|sure|great|right|fine|alright|all right|thanks|thank you|got it|understood|sounds (?:good|fine|okay)|that (?:works|sounds (?:good|fine|okay)|makes sense)|go ahead|please do)[,.!\s]*)+(?:(?:to|for) me|very much|i (?:agree|understand)|that's (?:fine|good))?[.!\s]*$/.test(line);
  if(!acknowledgment&&(line.split(/\s+/).filter(Boolean).length>=4||/\b[a-z]{1,5}\d{2,5}\b/i.test(line)))return objective('continue_conversation',"Interpret and respond to the buyer's latest substantive information before resuming an older commitment. Choose a useful response from the full conversation; an unfamiliar paraphrase is not consent to move to email logistics.");
}
export function buyerMomentFor(line:string,openingAllowed=true):string {
  if(hasClearConversationRefusal(line))return "refusal";
  if(/\b(?:not (?:the right|my|responsible)|don't handle|do not handle|wrong (?:person|department)|you (?:need|should) (?:to )?(?:speak|talk)|transfer you)\b/i.test(line))return "gatekeeper";
  if(openingAllowed&&isParticipantIntroduction(line))return "opening";
  if(/what(?:'s| is) this (?:about|regarding)|who(?:'s| is) (?:calling|this)|who are you/i.test(line))return "opening";
  if(isCompanyChoiceQuestion(line)||/how do (?:I|we) know|why (?:trust|should (?:I|we) trust)|proof|prove|trust|reliab|risk.{0,35}(?:chang|switch)|(?:happy|satisfied) with.{0,25}supplier|already (?:have|use|work with).{0,30}supplier/i.test(line))return "trust_challenge";
  if(/\b(?:what|which|how|confirm|tell|give)\b.{0,90}\b(?:spec|purity|content|percentage|Al[₂2]?O[₃3]?|certif\w*|MOQ|lead time|stock|inventory|price|CIF|FOB)\b|\b(?:CIF|FOB) price\b/i.test(line))return /price|CIF|FOB/i.test(line)?"price_test":"spec_question";
  if(/higher|cheaper|expensive|price|discount|cost too much/i.test(line))return "price_test";
  if(/send (?:me|us)|email (?:me|us)|think about it|review/i.test(line))return "polite_stall";
  if(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(line))return "contact_handoff";
  return "general";
}

/** Rebuilt from canonical spoken turns, never from the last sentence or AI suggestions. */
export function deriveConversationState(input:StateInput):ConversationState {
  const memory=currentCallMemory(input.callId,input.buyerMemory);
  const turns=(input.turns||[]).filter(turn=>!(turn as {transcriptionUncertainty?:unknown}).transcriptionUncertainty),context=input.callContext||{},map=input.stageMap||[],facts:Record<string,StateFact>={...reviewedClientStateFacts(input),...Object.fromEntries(Object.entries(memory?.facts||{}).filter(([,fact])=>fact.value.trim()).map(([key,fact])=>[key,{...fact,source:"memory" as const}]))};
  // The cached participant is a summary, never stronger evidence than the
  // complete spoken history that produced it. Rebuild when that history is
  // present (including revised ASR items); seed only genuinely truncated windows.
  const turnIds=new Set(turns.flatMap(turn=>turn.id?[turn.id]:[]));
  const hasParticipantHistory=!!memory?.participant&&!!memory.processedTurnIds?.length&&memory.processedTurnIds.every(id=>turnIds.has(id));
  const participantSeed=hasParticipantHistory?undefined:memory?.participant;
  let participant=preparedPurchasingParticipant(deriveCallParticipant(participantSeed?turns.filter(turn=>!turn.id||!memory?.processedTurnIds?.includes(turn.id)):turns,participantSeed),context.knownFacts,context.doNotGuess);
  if(participant.role==='unknown'&&!participant.afterTransfer&&facts.right_person)participant={...participant,role:'purchasing',evidence:{turnId:facts.right_person.turnId,quote:facts.right_person.quote}};
  if(participant.role==='routing'&&facts.right_person?.turnId.startsWith('client-'))delete facts.right_person;
  if(participant.afterTransfer||participant.role==='routing'){const clientFacts=reviewedClientStateFacts({...input,clientContext:input.clientContext?{...input.clientContext,contactId:undefined,contact:undefined,entries:input.clientContext.entries.filter(entry=>entry.scope==='client'),history:input.clientContext.history.filter(call=>!call.contactId)}:undefined,contactId:undefined});for(const [key,fact] of Object.entries(facts))if(fact.turnId.startsWith('client-')&&!clientFacts[key])delete facts[key];}
  const buyerNeeds=deriveBuyerNeeds({turns,callContext:context,participant,seed:memory?.buyerNeeds||(!participant.afterTransfer&&participant.role!=='routing'?reviewedClientNeedSeed(input,participant.segmentStartTurnId):undefined),processedTurnIds:memory?.processedTurnIds});
  for(const [key,label] of Object.entries(fields)) {
    if(key==='email'&&participant.afterTransfer)continue;
    const emailStatus=key==='email'?emailEvidenceFor(turns):undefined;
    if(emailStatus?.withdrawn){delete facts.email;if(emailStatus.withdrawal)facts.email_withdrawn={...emailStatus.withdrawal,source:'transcript'};continue;}
    const actual=fieldEvidence(label,turns),entered=context.knownFacts&&!norm(context.doNotGuess||"").includes(label.toLowerCase())?fieldEvidence(label,[{id:"call-context",role:"buyer",text:context.knownFacts}]):undefined;
    const found=actual||(key==='email'&&facts.email_withdrawn?undefined:entered);if(found){facts[key]={...found,source:actual?"transcript":"context"};if(key==='email')delete facts.email_withdrawn;}
  }
  if(participant.afterTransfer){
    const sameContact=memory?.participant?.segmentStartTurnId===participant.segmentStartTurnId;
    const enteredEmail=context.knownFacts&&!norm(context.doNotGuess||'').includes('email')?fieldEvidence('Email',[{id:'call-context',role:'buyer',text:context.knownFacts}]):undefined;
    const priorEmail=facts.earlier_contact_email||(!sameContact?facts.email:undefined)||enteredEmail;
    const scoped=currentContactEmailEvidence(turns,participant.segmentStartTurnId,priorEmail);
    if(scoped.earlier)facts.earlier_contact_email={...scoped.earlier,source:scoped.earlier.turnId==='call-context'?'context':'transcript'};
    if(scoped.current){facts.email={...scoped.current,source:'transcript'};delete facts.email_withdrawn;}
    else if(scoped.withdrawn||!sameContact||!memory?.facts?.email){delete facts.email;if(scoped.withdrawal)facts.email_withdrawn={...scoped.withdrawal,source:'transcript'};}
  }
  const fullCommitmentHistory=!!memory?.processedTurnIds?.length&&memory.processedTurnIds.every(id=>turnIds.has(id));
  const commitmentSeed=fullCommitmentHistory?undefined:memory;
  const documents=deriveDocumentState({turns,seed:commitmentSeed?.documents||input.clientContext?.standing?.documentState,sources:input.companyConfiguration?configurationReferences(input.companyConfiguration.snapshot):input.sources});
  // Reuse attributed completed document events, rather than interpreting a
  // past-tense word inside “check whether I sent…” as a completed handoff.
  // Index once so every turn uses the same canonical account as generation
  // and saved memory. A partial send completes only its own named materials.
  const completedByTurn=new Map<string,Set<string>>(),completedMaterials=new Set<string>(),completionTurnIds=new Map(turns.map((turn,index)=>[turn.id||`document-turn-${index}`,turn.id||`turn-${index}`]));
  for(const document of documents.transfers.filter(row=>row.sender==='you')){
    const names=materialNames(document.document);
    for(const event of document.events.filter(event=>event.kind==='sent'&&event.actor==='you'||event.kind==='received'&&event.actor==='buyer')){
      const currentId=completionTurnIds.get(event.turnId);
      if(!currentId){if(document.sendStatus==='reported_sent')for(const name of names)completedMaterials.add(name);continue;}
      const completed=completedByTurn.get(currentId)||new Set<string>();for(const name of names)completed.add(name);completedByTurn.set(currentId,completed);
    }
  }
  // Some already-supported generic materials have no stored DocumentKind.
  // Reuse the canonical completed-action interpretation for their direct
  // objects rather than losing a real send or reviving the old word search.
  for(const [index,turn] of turns.entries()){
    const named=attributedDocumentCompletions(turn).filter(action=>(action.kind==='sent'&&action.actor==='you'||action.kind==='received'&&action.actor==='buyer')&&['document','result'].includes(action.object.kind)).flatMap(action=>materialNames(norm(action.object.text)));
    const turnId=turn.id||`turn-${index}`;
    if(named.length){const completed=completedByTurn.get(turnId)||new Set<string>();for(const name of named)completed.add(name);completedByTurn.set(turnId,completed);}
  }
  const commitments=(commitmentSeed?.commitments||[]).map(item=>structuredClone(item));
  let send=commitments.find(item=>item.id==="send_materials"),review=false,prices=false;
  let reviewType:'engineer'|'buyer'|undefined=commitments.some(item=>item.id==='engineer_review')?'engineer':commitments.some(item=>item.id==='buyer_review')?'buyer':undefined;
  let reviewed=commitments.find(item=>['engineer_review','buyer_review'].includes(item.id))?.status==="fulfilled";
  let pricesDiscussed=commitments.find(item=>item.id==="prices_after_review")?.status==="fulfilled";
  let sequence=structuredClone(commitmentSeed?.sequence||[]),lastAgreedNextStep=commitmentSeed?.lastAgreedNextStep||"";
  for(let i=0;i<turns.length;i++) {
    const turn=turns[i];if(turn.id&&commitmentSeed?.processedTurnIds?.includes(turn.id))continue;
    const line=norm(turn.text),evidence={turnId:turn.id||`turn-${i}`,quote:turn.text};
    const buyer=turn.role==="buyer",rep=turn.role==="you";
    const parts=clauses(line),refused=buyer?parts.filter(materialRefusal):[];
    const requestParts=buyer?parts.map(part=>affirmativeMaterialAction(part,isBuyerOwnedDocumentSend)).filter((part):part is string=>!!part):[];
    const globalRefusal=buyer&&hasClearConversationRefusal(line);
    const existingMaterials=send?materialNames(norm(send.action)):[];
    const refusedMaterials=refused.flatMap(materialNames);
    const cancelAll=globalRefusal||refused.some(part=>!materialNames(part).length)||!!refused.length&&(!existingMaterials.length||existingMaterials.every(name=>refusedMaterials.includes(name)));
    if(cancelAll){
      for(const item of commitments)if(item.status!=="fulfilled"){item.status="cancelled";item.missing=[];}
      sequence=sequence.map(step=>({...step,status:step.status==="fulfilled"?step.status:"cancelled"}));lastAgreedNextStep="Respect the buyer's refusal";
      if(globalRefusal||!requestParts.length)continue;
    }else if(refused.length&&send&&send.status!=='fulfilled')send.action=`Send ${describeMaterialGroups(materialGroups(send.action).map(group=>group.filter(name=>!refusedMaterials.includes(name))))}`;
    // A suggestion or conditional offer is not an agreement. A short acceptance
    // can accept the preceding actual offer, including when a request is windowed.
    const acceptedOffer=buyer?acceptedDocumentOfferAt(turns,i):undefined;
    const previousRepIndex=acceptedOffer?.index??-1,previousRep=acceptedOffer?.turn;
    const acceptedObjects=acceptedOffer?.objects.map(object=>object.text).join(' and ')||'';
    const accepted=!!acceptedOffer&&materialNames(norm(acceptedObjects)).length>0;
    const request=!!requestParts.length||!!accepted;
    const promiseParts=rep?parts.filter(definiteSendingPromise).flatMap(part=>analyzeDocumentActionSyntax(part,{speaker:'salesperson'}).filter(action=>action.actor==='salesperson'&&action.documentDelivery&&action.speechAct==='commitment').map(action=>action.object.text)):[];
    const promise=promiseParts.length>0;
    if(request||promise) {
      const requestedLine=accepted?norm(acceptedObjects):promise?promiseParts.join(' '):requestParts.join(' ');
      const requestedGroups=materialGroups(requestedLine),materials=describeMaterialGroups(requestedGroups);
      if(!send||send.status==="cancelled"||send.status==="fulfilled") {
        completedMaterials.clear();
        send={id:"send_materials",action:`Send ${materials}`,owner:"you",status:"needs_email",missing:["email"],evidence:[]};
        const index=commitments.findIndex(item=>item.id===send!.id);if(index<0)commitments.push(send);else commitments[index]=send;
        review=false;reviewType=undefined;prices=false;reviewed=false;pricesDiscussed=false;sequence=[];
        for(let n=commitments.length-1;n>=0;n--)if(["engineer_review","buyer_review","prices_after_review"].includes(commitments[n].id))commitments.splice(n,1);
      }
      if(materials!=='requested information'){
        const replacement=buyer&&/\b(?:instead|rather than|only|just)\b/.test(line)&&!/^\s*(?:can|could) you just\b/.test(line);
        send.action=`Send ${describeMaterialGroups(replacement?requestedGroups:mergeMaterialGroups(materialGroups(send.action),requestedGroups))}`;
      }
      if(accepted&&previousRep&&!send.evidence.some(item=>item.turnId===previousRep.id))send.evidence.push({turnId:previousRep.id||`turn-${previousRepIndex}`,quote:previousRep.text});
      if(!send.evidence.some(item=>item.turnId===evidence.turnId))send.evidence.push(evidence);
    }
    if(send&&send.status!=="cancelled") {
      if(buyer&&/\b(?:engineer\w*|technical team|engineering team)\b.{0,70}\b(?:look|review|check|evaluate|take)|\b(?:look|review|check|evaluate)\b.{0,70}\bengineer\w*\b/.test(line)){review=true;reviewType='engineer';}
      else if(buyer&&/\b(?:i|we)(?:'ll| will| can| could)? (?:take a look|review|check|evaluate)\b|\bfor (?:me|us) to (?:review|check|evaluate)\b/.test(line)){review=true;reviewType||='buyer';}
      if(buyer&&(/\b(?:then|after|next|later|get back|come back)\b.{0,90}\b(?:pric\w*|quot\w*)\b/.test(line)||review&&/\byou can (?:give|send|provide)\b.{0,50}\bquot\w*\b/.test(line)))prices=true;
      const completed=completedByTurn.get(evidence.turnId);
      if(completed?.size){
        for(const material of completed)completedMaterials.add(material);
        const required=materialGroups(send.action);
        if(required.length&&required.every(group=>group.some(material=>completedMaterials.has(material)))){send.status="fulfilled";send.missing=[];}
        if(!send.evidence.some(item=>item.turnId===evidence.turnId))send.evidence.push(evidence);
      }
      if(buyer)for(const part of parts){
        if(incompleteReview(part)&&/\b(?:engineer\w*|technical team|engineering team|review|evaluation)\b/.test(part))reviewed=false;
        else if(completedReview(part)||reviewType==='buyer'&&!incompleteReview(part)&&/\b(?:i|we)(?:'ve| have| already)? (?:reviewed|checked|evaluated)\b/.test(part)&&!conditionalReview(part))reviewed=true;
      }
      if(rep&&/\b(?:our|the) (?:price|quote) is\b|\b(?:i|we) (?:have |already )?(?:sent|emailed)\b.{0,60}\b(?:price|quote|quotation)\b/.test(line))pricesDiscussed=true;
    }
  }
  if(send&&send.status!=="cancelled") {
    if(send.status!=="fulfilled"){send.status=facts.email?"ready":"needs_email";send.missing=facts.email?[]:["email"];}
    // Preserve a previously agreed sequence when the buyer's next audio item is only a continuation.
    review=review||sequence.some(step=>['engineer_review','buyer_review'].includes(step.id));prices=prices||sequence.some(step=>step.id==="prices_after_review");
    reviewType||=sequence.some(step=>step.id==='engineer_review')?'engineer':review?'buyer':undefined;
    const setCommitment=(id:string,action:string,owner:"you"|"buyer",status:CallCommitment["status"],missing:string[])=>{const old=commitments.find(item=>item.id===id);if(old){old.status=status;old.missing=missing;}else commitments.push({id,action,owner,status,missing,evidence:[...send!.evidence]});};
    if(review){
      const reviewId=reviewType==='engineer'?'engineer_review':'buyer_review';
      for(let index=commitments.length-1;index>=0;index--)if(['engineer_review','buyer_review'].includes(commitments[index].id)&&commitments[index].id!==reviewId)commitments.splice(index,1);
      setCommitment(reviewId,reviewType==='engineer'?"Buyer's engineer reviews the profile":"Buyer reviews the requested materials","buyer",reviewed?"fulfilled":send.status==="fulfilled"?"ready":"blocked",reviewed||send.status==="fulfilled"?[]:["profile delivery"]);
    }
    if(prices)setCommitment("prices_after_review","Discuss prices after the review","you",pricesDiscussed?"fulfilled":review&& !reviewed?"blocked":send.status==="fulfilled"?"ready":"blocked",pricesDiscussed?[]:review&&!reviewed?[reviewType==='engineer'?"engineer review":"buyer review"]:send.status==="fulfilled"?[]:["profile delivery"]);
    sequence=[{id:"send_profile",label:send.action,owner:"you",status:send.status},...commitments.filter(item=>["engineer_review","buyer_review","prices_after_review"].includes(item.id)).map(item=>({id:item.id,label:item.action,owner:item.owner,status:item.status}))];
    lastAgreedNextStep=sequence.map(step=>step.label).join(" → ");
  }
  const configured=map.find(stage=>stage.id===context.stageId)||map[0]||{id:context.stageId||"cold_call",name:"Cold call",purpose:"Understand the buyer and agree a next step"};
  // Incoming buyer-owned documents and conditionally released reports have
  // their own owner/status. They must not become the rep’s generic email gap.
  const ledgerCommitments=documents.transfers.filter(item=>item.document==='drawings'&&item.sender==='buyer'&&item.events.some(event=>['offered','promised','sent','received'].includes(event.kind))||item.document==='test reports').map(item=>{
    const delivery=item.events.some(event=>['requested','promised','offered','sent','received'].includes(event.kind));
    const unmetCondition=!!item.condition&&(item.condition.kind!=='coverage_positive'||item.coverage!=='verified');
    return {id:`document:${item.id}`,action:!delivery?`Check ${item.label||item.document} coverage`:`${item.sender==='buyer'?'Buyer sends':'Send'} ${item.label||item.document}${item.condition?` only after ${item.condition.kind==='coverage_positive'?'positive report coverage is confirmed':'the buyer’s stated condition is satisfied'}`:''}`,owner:item.sender,status:(item.phase==='cancelled'?'cancelled':!delivery?item.coverage==='verified'?'fulfilled':'ready':item.sendStatus==='reported_sent'?'fulfilled':item.sender==='buyer'?'blocked':unmetCondition?'blocked':facts.email?'ready':'needs_email') as CallCommitment['status'],missing:!delivery||item.sendStatus==='reported_sent'?[]:item.sender==='buyer'?['buyer document']:unmetCondition?[item.condition!.kind==='coverage_positive'?'verified report coverage':'buyer condition']:facts.email?[]:['email'],evidence:item.events.map(event=>({turnId:event.turnId,quote:event.quote}))};
  });
  for(const item of ledgerCommitments){const index=commitments.findIndex(old=>old.id===item.id);if(index>=0)commitments[index]=item;else commitments.push(item);}
  if(!send&&ledgerCommitments.length){sequence=ledgerCommitments.map(item=>({id:item.id,label:item.action,owner:item.owner,status:item.status}));lastAgreedNextStep=sequence.map(step=>step.label).join(' → ');}
  const canonicalFollowThrough=documents.transfers.some(row=>row.phase!=='cancelled'&&(row.sender==='buyer'&&['offered','promised','sent'].includes(row.phase)||row.sender==='you'&&row.events.some(event=>['requested','promised','check_promised'].includes(event.kind))));
  const advanced=!!(send&&send.status!=="cancelled")||canonicalFollowThrough;
  const reviewStage=map.find(stage=>/spec|review|qualif/i.test(stage.id+" "+stage.name));
  const advanceStage=!input.companyConfiguration&&advanced&&reviewStage&&map.indexOf(configured)<map.indexOf(reviewStage)?reviewStage:configured;
  const latest=[...turns].reverse().find(turn=>turn.role!=="you")?.text||"";
  const currentBuyer=turns.findLast(turn=>turn.role!=='you');
  const introduceContact=participant.afterTransfer&&participant.introductionNeeded&&!participant.transferPending&&!!currentBuyer&&isCurrentParticipantIntroduction(currentBuyer,participant);
  const segmentIndex=turns.findIndex((turn,index)=>(turn.id||`buyer-${index}`)===participant.segmentStartTurnId),segment=segmentIndex>=0?turns.slice(segmentIndex):turns;
  if(participant.afterTransfer&&!participant.handoffPlanAccepted){
    participant.handoffPlanAccepted=segment.some((turn,index)=>{
      if(turn.role!=="buyer")return false;
      if(send?.evidence.some(item=>item.turnId===turn.id))return true;
      const previous=segment.slice(0,index).findLast(item=>item.role==="you")?.text||"";
      return /^(?:yes|yeah|yep|sure|okay|ok|please do|that (?:works|would be (?:useful|helpful|good|great)))[,.!\s]*$/i.test(turn.text.trim())&&/\b(?:send|email|share|review|receive)\b/i.test(previous)&&/\b(?:profile|specs?|information|materials|documents)\b/i.test(previous);
    });
  }
  const confirmHandoffPlan=participant.afterTransfer&&!participant.transferPending&&!!advanced&&!!send&&send.status!=="fulfilled"&&!participant.handoffPlanAccepted;
  const stagePurpose=advanced?`${advanceStage.purpose}. Agreed sequence retained: ${lastAgreedNextStep}. New questions or concerns can be addressed without losing this agreement.`:advanceStage.purpose;
  const routingAction=participant.transferPending?{
    kind:participant.transfer?.status==='intended'?'transfer_intended':'transfer_pending',gap:participant.transfer?.status==='intended'&&!facts.email?'alternative contact route':'',
    purpose:participant.transfer?.status==='intended'?"The routing contact has offered a conditional transfer; the target has not joined. Answer any current question, then choose a brief acknowledgment, an uncollected alternative contact route or a callback when useful. Do not re-ask for known information.":"The transfer is actively underway; acknowledge and give it room. The target has not joined, and a current routing-contact question still deserves an answer.",
    easyToAnswer:true,unlocks:'Reach the intended contact without assuming a completed handoff',alreadyAnswered:!!facts.email,
  }:participant.transfer?.status==='unavailable'?{kind:'contact_unavailable',gap:facts.email?'callback availability':'alternative contact route',purpose:'The intended contact was unavailable; use any known email and ask only for a useful missing contact route or callback opportunity.',easyToAnswer:true,unlocks:'An appropriate way to reach the absent contact',alreadyAnswered:!!facts.email}:undefined;
  const currentObjective=introduceContact||routingAction?undefined:immediateBuyerObjectiveFor(turns);
  const interrupt=canonicalFollowThrough&&currentObjective?.kind==='continue_conversation'?undefined:currentObjective;
  const canonicalAction=canonicalFollowThrough&&!send?{kind:documents.transfers.some(row=>row.sender==='you'&&row.condition)?'confirm_conditional_send':documents.transfers.some(row=>row.sender==='buyer'&&row.receiptStatus!=='confirmed')?'await_buyer_document':'check_report_coverage',gap:'',purpose:'Respect the agreed document handoff: '+lastAgreedNextStep+'. Keep pending sending, receipt and unknown coverage distinct; do not reopen discovery or assume a positive check result.',easyToAnswer:true,unlocks:'The buyer’s chosen document follow-through',alreadyAnswered:true}:undefined;
  const deferredCommitments=interrupt?commitments.filter(item=>!['fulfilled','cancelled'].includes(item.status)).map(item=>({id:item.id,reason:interrupt.purpose,resumeWhen:'After responding to the current buyer concern, when the buyer is ready; do not assume the concern is resolved.'})):[];
  const nextAction=routingAction|| (introduceContact?{kind:"introduce_contact",gap:"introduction",purpose:"Introduce yourself to the newly reached person; an earlier contact's agreement is not theirs.",easyToAnswer:true,unlocks:"A conversation with the newly reached contact",alreadyAnswered:false}:interrupt?{kind:interrupt.kind,gap:interrupt.kind==='respect_refusal'?'':"current buyer concern",purpose:interrupt.purpose,easyToAnswer:true,unlocks:"A useful response to the buyer's immediate concern",alreadyAnswered:false}:confirmHandoffPlan?{kind:"confirm_handoff_plan",gap:"current contact's agreement",purpose:"Check whether this newly reached person wants the earlier contact's suggested review before asking for an email.",easyToAnswer:true,unlocks:"Confirm the review plan with the newly reached person",alreadyAnswered:false}:canonicalAction?canonicalAction:send?.status==="needs_email"?{kind:"capture_email",gap:"email",purpose:"Complete the agreed sending commitment",easyToAnswer:true,unlocks:lastAgreedNextStep||"Send the requested materials",alreadyAnswered:false}
    :send?.status==="ready"?{kind:"confirm_send",gap:"",purpose:"Confirm the agreed sending and review sequence",easyToAnswer:true,unlocks:"Send the requested materials",alreadyAnswered:true}
    :send?.status==="fulfilled"?{kind:reviewed?"discuss_prices":"follow_review",gap:reviewed?"approved_quote":"review_result",purpose:reviewed?"Advance to the agreed price discussion using verified terms":"Follow the agreed review before prices",easyToAnswer:true,unlocks:"Engineering feedback and a relevant quotation",alreadyAnswered:false}
    :{kind:"discovery",gap:/(?:pric|negotiat)/i.test(advanceStage.id)?"target_price":facts.specs?"priority_or_interest":"application",purpose:advanceStage.purpose,easyToAnswer:true,unlocks:"One relevant next action",alreadyAnswered:false});
  const freshGreeting=turns.length>0&&turns.every(turn=>turn.role==="buyer"&&isParticipantIntroduction(turn.text));
  const turnMoment=buyerMomentFor(latest,freshGreeting);
  const moment=routingAction?"gatekeeper":introduceContact||confirmHandoffPlan&&!interrupt?"opening":interrupt?turnMoment:advanced?"agreed_next_step":participant.role==="routing"&&!["price_test","spec_question","polite_stall","contact_handoff"].includes(turnMoment)?"gatekeeper":turnMoment;
  const immediateObjective:ImmediateBuyerObjective=interrupt?{...interrupt,suspendedCommitmentIds:deferredCommitments.map(item=>item.id)}:{kind:['capture_email','confirm_send','follow_review','discuss_prices'].includes(nextAction.kind)?'complete_commitment':'continue_conversation',purpose:nextAction.purpose,buyerTurnId:turns.findLast(turn=>turn.role==='buyer')?.id,suspendedCommitmentIds:[]};
  return {callId:input.callId,stageId:advanceStage.id,stageName:advanceStage.name,stagePurpose,moment,participant,buyerNeeds,documents,facts,missingFacts:Object.keys(fields).filter(key=>!facts[key]),commitments,sequence,lastAgreedNextStep,nextAction,immediateObjective,deferredCommitments,movedPastDiscovery:!!advanced,processedTurnIds:[...new Set([...(memory?.processedTurnIds||[]),...turns.flatMap(turn=>turn.id?[turn.id]:[])])].slice(-600)};
}

/** Retain item names in the actual agreed document offer/request, not just its document category. */
export function committedMaterialDescription(sending:CallCommitment):string {
  let materials=sending.action==='Send company profile'?'profile':sending.action.replace(/^Send /,'');
  if(!/product specs|product information|product drawings/.test(materials))return materials;
  const reference=sending.evidence.map(item=>item.quote).join(' ');
  const grades=[...new Set((reference.match(/\b[A-Z]{1,5}-?\d{2,5}\b/gi)||[]).filter(item=>!/^(?:ISO|ASTM|DIN|EN)\d/i.test(item)))];
  const sic=/\bSiC\b|\b(?:green )?silicon carbide\b/i.test(reference);
  const items=[...grades,...sic?['SiC']:[]];
  if(items.length)materials=materials.replace(/product specs|product information|product drawings/g,kind=>`${joinMaterials(items)} ${kind.replace(/^product /,'')}`);
  return materials;
}
export function commitmentReply(state:ConversationState,prefix="Okay, yeah, 100%."):string|undefined {
  if(!state.movedPastDiscovery)return;
  const engineerReview=state.sequence.some(step=>step.id==="engineer_review"),buyerReview=state.sequence.some(step=>step.id==='buyer_review'),prices=state.sequence.some(step=>step.id==="prices_after_review");
  const sending=state.commitments.find(item=>item.id==='send_materials');
  const materials=sending?committedMaterialDescription(sending):'requested materials';
  const review=engineerReview?" for your engineer to review":buyerReview?" for your review":"";
  const sequence=`I'll send the ${materials}${review}${prices?" before we discuss prices":""}`;
  if(state.nextAction.kind==="capture_email")return `${prefix} ${sequence}—what would be a great email to reach you?`;
  if(state.nextAction.kind==="confirm_send")return `${prefix} I'll send the ${materials} there${review}${prices?" before we discuss prices":""}; thanks for your time.`;
}

/** A change of consent is different from collecting the same address again. */
export function asksForEmailValue(question:string):boolean {
  const line=norm(question);
  // Inspect the actual interrogative. A preceding statement may offer delivery
  // to a known email, followed by a separate consent question about that action.
  const sentences=line.match(/[^!?]+?(?:[!?]+(?=\s|$)|\.(?!\d)(?=\s|$)|$)/g)?.filter(part=>part.trim())||[line];
  const questions=sentences.filter(part=>part.trim().endsWith('?'));
  return (questions.length?questions:[line]).some(part=>{
    if(!/\b(?:email|e-mail|address)\b/.test(part))return false;
    const asksValue=/\b(?:what|which|where)\b[^.!?]{0,55}\b(?:email|e-mail|address)\b|\b(?:confirm|verify|repeat|spell|provide|give|share|tell|get|have)\b[^.!?]{0,35}\b(?:your |the |an? |best )?(?:email|e-mail|address)\b/.test(part);
    const deliveryPermission=/\b(?:can|could|may|should|shall|would) (?:i|we) (?:still )?(?:send|email|forward|attach)\b|\b(?:would|do) you (?:still )?(?:like|want) (?:me|us) to (?:send|email|forward|attach)\b|\b(?:would|do) you (?:still )?(?:like|want)\b.{0,70}\b(?:sent|emailed|forwarded|attached)\b|\b(?:is|would) it (?:be )?(?:okay|ok|all right|useful)\b.{0,35}\b(?:send|email|forward|attach)\b/.test(part);
    return asksValue||!deliveryPermission;
  });
}

export function validateLeadingQuestion(say:string,state:ConversationState) {
  const reasons:string[]=[],checks={advancesStage:true,easyToAnswer:true,unlocksAction:true,notAlreadyAnswered:true};
  if(!say.includes("?"))return {ok:true,reasons,checks};
  // Evaluate the actual question, not explanatory statements before it. Those
  // statements may appropriately mention the incumbent or selected products;
  // they are not a new discovery question or part of its cognitive burden.
  const questionEnd=say.indexOf('?');let questionBegin=0;
  for(let index=0;index<questionEnd;index++)if(/[.!;—]/.test(say[index])&&(say[index]==='—'||say[index]===';'||/\s/.test(say[index+1]||'')))questionBegin=index+1;
  const question=say.slice(questionBegin,questionEnd+1).trim();
  const questionStart=question.search(/\b(?:what(?:['’]s)?|which|who|where|when|why|how|(?:can|could|would|will|may|do|does|are|is|have|has)\s+(?:I|we|you|your|the|this|that|there))\b/i);
  const line=norm(questionStart>=0?question.slice(questionStart):question),email=/\b(?:email|e-mail|address)\b/.test(line),generic=/supply partner|looking for in|what matters most|what.*(?:volume|grade)|which.*(?:grade|size)|current supplier|what.*supplier.*(?:better|consider)/.test(line);
  // A genuinely current send request has a practical gap. An older agreement
  // does not prohibit a useful diagnostic question about a new buyer concern.
  const completingCommitment=['capture_email','confirm_send'].includes(state.nextAction.kind);
  if(completingCommitment&&generic){checks.advancesStage=false;reasons.push("Question ignores the current agreed next step in favor of generic discovery");}
  if(state.nextAction.kind==="capture_email"&&!email&&/supply partner|looking for in|what matters most/.test(line)){checks.unlocksAction=false;reasons.push("Generic discovery does not address the current sending request");}
  const repeated=[['email',asksForEmailValue(line)],['specs',/\b(?:what|which)\b.{0,35}\b(?:grades?|specifications?)\b/.test(line)],['volumes',/\b(?:what|how much|how many)\b.{0,30}\b(?:volume|quantit|tons|amount)/.test(line)],['decision_maker',/who.{0,40}(?:final|decision|approve)/.test(line)],['current_supplier',/(?:do you|are you|have you).{0,30}(?:have|use|already).{0,20}supplier/.test(line)]] as const;
  for(const [field,asked] of repeated)if(asked&&state.facts[field]){checks.notAlreadyAnswered=false;reasons.push(`${field} has already been answered`);}
  if((say.match(/\?/g)||[]).length>1||line.split(/\s+/).filter(Boolean).length>35){checks.easyToAnswer=false;reasons.push("Question must be one short, easy next action");}
  return {ok:Object.values(checks).every(Boolean),reasons,checks};
}
