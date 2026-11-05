import {clientContextSuggestionProblems,clientContextSafeReply,reviewedClientContext,type ClientCoachingContext} from './client-coaching-context.ts';
/** Turn intent and claim-level safety. Deliberately independent of generation/state modules. */
import { hasClearConversationRefusal } from './conversation-boundary.ts';
import {applyCoachingConfiguration,configurationSuggestionProblems,configurationAuthorizesAction,configuredSafeReply} from './coaching-configuration.ts';
import {literalSpecificationEvidence,specificationNumberEvidence} from './scoped-specification-evidence.ts';
import {buyerProductIdentifierReferences,buyerSpelledIdentifierClarificationReferences,isBuyerIdentifierClarification,canonicalizeKnownProductIdentifiers,productIdentityReferences} from './product-identity-evidence.ts';
import {availableDocumentActionEvidence} from './document-availability-evidence.ts';
import {assessDocumentProductCoverage,documentIdentifierReferences,documentIdentifierSource,investigationThenDocumentDelivery,isBoundedEpistemicFactAction,isConversationalAcknowledgment,literalDocumentScopeEvidence,literalDocumentStatementEvidence,requestsDocumentProductCoverage} from './document-product-evidence.ts';
export type BuyerTurnKind = 'fact_request' | 'sales_move' | 'confirmation';
export type VerificationPolicyContext = {
  coachingRequest?:{id:string;requestedAt:number};
  companyConfiguration?:import('./company-configuration').CallConfigurationBinding;clientContext?:ClientCoachingContext;clientId?:string;contactId?:string;callId?:string;
  buyerText?: string;
  turns?: { role: string; text: string }[];
  sources?: { id: string; text: string; title?: string; complete?:boolean }[];
  brain?: { facts?: { text: string; sourceId: string; quote: string; confirmed: boolean }[]; rules?: { neverPromise?: string; neverInvent?: string; promiseThreshold?: string; escalateThreshold?: string } };
  manufacturer?: { id?:string;name?: string; products?: string };
  conversationState?: {
    callId?: string;
    nextAction?: { kind?: string };
    facts?: Record<string, { value?: unknown }>;
  };
};
export type BuyerTurnClassification = {
  kind: BuyerTurnKind;
  buyerText: string;
  reason: string;
  factTopics: string[];
  reusableProductIdentities: string[];
};
export type ReplyFactClaim = {
  text: string;
  start: number;
  end: number;
  kind: 'number' | 'timing' | 'supplier_claim' | 'product_identity';
  supported: boolean;
  /** Lexical mismatch is uncertainty, not evidence of fabrication. */
  pending?: boolean;
  candidateSourceIds?: string[];
  /** An absent required source relationship cannot be overturned by a remote
   * verifier that matches a related product or document instead. */
  verificationBoundary?:'document_product_scope';
  reason: string;
  sourceId?: string;
};
export type ReplyVerificationAssessment = {
  classification: BuyerTurnClassification;
  requiresVerification: boolean;
  claims: ReplyFactClaim[];
  unsupportedClaims: ReplyFactClaim[];
  supportedClaims: ReplyFactClaim[];
  pendingClaims: ReplyFactClaim[];
  /** Closed local entailment of every asserted clause from current original
   * sources. Candidate retrieval or matching a number alone is never enough. */
  locallyVerifiedWholeReply: boolean;
  localEvidence: {sourceId:string;quote:string;claim:string}[];
  sanitizedReply: string;
  changed: boolean;
};

const normalize = (text: string) => text.toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9#.%]+/g, ' ').trim();
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const IDENTITY = /\bF\s?\d{2,6}\b|#\s?\d{2,6}\b|\b(?:WFA|SiC|Al2O3|FEPA|JIS)\b|\b(?:white fused alumina|green silicon carbide|silicon carbide)\b/gi;
const FORMULA = /\b(?:Al2O3|SiC|SiO2|Fe2O3|TiO2|Na2O|CaO|MgO)\b/gi;
const DOCUMENT = /\b(?:profile|website|catalog(?:ue)?|brochure|spec(?:ification)?s?(?:\s+sheet)?|data\s*sheet|drawings?|documents?|test\s+report|COA)\b/i;
const SEND = /\b(?:send|email|share|forward|pass\s+(?:it|them|that)\s+(?:on|over))\b/i;
const DELIVERY = /\b(?:(?:I|we)(?:['’]ll|\s+will|\s+can|\s+would)|let me|happy to)\s+(?:email|send|share|forward)\b/i;
const CONDITIONAL_PROPOSAL = /\b(?:would|could|can|may)\s+(?:(?:you|we|I)\s+)?(?:be\s+open|review|compare|evaluate|test|look|consider|arrange|discuss|start|send|provide)|\b(?:if you(?:['’]d| would)? like|if helpful|one option|we could|would that|would you)\b/i;
const FACT_TOPICS: [string, RegExp][] = [
  ['price', /\b(?:price|prices|pricing|cost|costs|quote|CIF|FOB|USD|discount|payment\s+terms?|(?:sixty|thirty|ninety|\d+)[- ]day\s+payment)\b/i],
  ['specification', /\b(?:spec(?:ification)?s?|purity|Al2O3|percentage|content|composition|particle\s+size|grain\s+size|grade|grades|mesh|tolerance|density|hardness|temperature|pressure|dimensions?|rated?|ratings?|operating\s+limits?|material\s+(?:composition|compatibility)|flow\s+rate)\b/i],
  ['minimum_order', /\b(?:MOQ|minimum\s+(?:order|quantity)|order\s+minimum)\b/i],
  ['lead_time', /\b(?:lead\s*time|turnaround|delivery\s+(?:time|date)|deliver(?:y)?|how\s+(?:soon|long)|when\s+(?:can|could|will|would)|shipping)\b/i],
  ['certification', /\b(?:certif(?:ied|icate|icates|ication|ications)|ISO\s?\d*|compliance|compliant|accreditation)\b/i],
  ['availability', /\b(?:available|availability|in\s+stock|stock|capacity|can\s+you\s+(?:supply|produce|manufacture)|do\s+you\s+(?:supply|produce|manufacture))\b/i],
  ['sample_policy', /\b(?:free\s+samples?|sample\s+(?:cost|policy|availability))\b/i],
  ['supplier_capability', /\b(?:manufacturer|factory|product\s+(?:overview|range|line)|your\s+(?:\w+\s+){0,3}products|what\s+do\s+you\s+(?:make|manufacture|produce)|manufacturing\s+capabilit(?:y|ies))\b/i],
];

/** Declining a requested response deadline makes no supplier timing promise. */
export function declinesResponseDeadline(clause:string):boolean {
  const line=clause.replace(/[’‘]/g,"'");
  const laterPromise=/\b(?:I|we)(?:'ll|\s+(?:will|can|would))\s+(?!not\b).{0,85}\b(?:soon|shortly|ASAP|quickly|within|tomorrow|today|in\s+\d+\s+(?:hours?|days?))\b/i.test(line);
  return !laterPromise&&/\b(?:I|we)\s+(?:cannot|can't|won't|will not|do not|don't)\s+(?:promise|guarantee|commit(?:\s+to)?)\b/i.test(line);
}

/** Only actual rep speech in this request, never Brain examples, buyer memory, or previous calls. */
export function offeredProductIdentities(context: VerificationPolicyContext): string[] {
  if(context.companyConfiguration){context=applyCoachingConfiguration(context);return [...new Set((context.sources||[]).flatMap(source=>[...source.text.matchAll(IDENTITY)].map(match=>match[0].replace(/\s+(?=\d)/g,''))))];}
  const values = (context.turns || []).filter(turn => turn.role === 'you').flatMap(turn => sentences(turn.text).filter(part =>
    /\b(?:offer|supply|provide|produce|manufacture|make|sell|carry|available|send|email|share|our\s+(?:range|grades|products))\b/i.test(part.text)
    && !/\b(?:not|never|don['’]t|doesn['’]t|cannot|can['’]t|unsure|unverified|check|confirm\s+(?:if|whether)|know\s+(?:if|whether))\b/i.test(part.text)
    && !/\?\s*$/.test(part.text)
  ).flatMap(part => [...part.text.matchAll(IDENTITY)].map(match => match[0].replace(/\s+(?=\d)/g, ''))));
  return [...new Set(values)];
}

function latestBuyerText(context: VerificationPolicyContext): string {
  if (context.buyerText !== undefined) return context.buyerText.trim();
  return [...(context.turns || [])].reverse().find(turn => turn.role === 'buyer' || turn.role === 'customer')?.text.trim() || '';
}

function withoutDocumentRequests(text: string): string {
  // Asking to receive a document is a sales step, not a question about its contents.
  return text.replace(/\b(?:(?:can|could|would|will)\s+you\s+|please\s+|how about\s+(?:you\s+)?)?(?:send|email|share|forward)\b[^.!?]*(?:[.!?]|$)/gi, fragment => {
    if (!DOCUMENT.test(fragment)) return fragment;
    // A second question inside the same sentence still requires factual grounding.
    const mixed = fragment.search(/(?:\b(?:and|but|also)\s+|,\s*)(?:(?:what|which|how|when|is|are|do|does|can|could)\b)/i);
    return mixed < 0 ? '' : fragment.slice(mixed);
  });
}

function requestsFact(text: string, topic: RegExp): boolean {
  if (!topic.test(text)) return false;
  // A request to compare suppliers/prices is a sales move; it does not ask for a price.
  const comparison = /\b(?:compare|comparing|comparison|incumbent|current\s+supplier|switch\s+suppliers?|trust)\b/i.test(text);
  const directQuestion = /\b(?:what|which|how\s+(?:much|many|long|soon|about)|when|tell\s+me|confirm|need\s+to\s+know)\b/i.test(text)
    && !/^\s*(?:why|how)\s+(?:should|would|could)\s+(?:I|we)\s+(?:trust|switch|choose)\b/i.test(text);
  const demandCandidates = [...text.matchAll(/\b(?:give|provide|send|quote|need|want|require)\s+([^.!?]{0,110}?)\b(?:price|prices|pricing|quote|cost|MOQ|minimum\s+order|lead\s*time|certification|purity|Al2O3|availability|firm\s+(?:number|figure)|exact\s+(?:number|figure))\b/gi)];
  // Destinations, incoterms and adjectives can separate the request verb from the fact.
  // Conversely, "need to compare prices" asks for a sales comparison, not a quoted amount.
  const directDemand = demandCandidates.some(match => !/\b(?:compare|comparing|comparison|evaluate|evaluating)\b/i.test(match[1]));
  if (directDemand) return true;
  if (directQuestion && (!comparison || /\b(?:what|which|how\s+(?:much|many|long|soon)|when)\b.{0,55}\b(?:price|prices|pricing|cost|MOQ|minimum|lead\s*time|purity|Al2O3|grade|grades|certification|available|availability)\b/i.test(text))) return true;
  if (comparison) return false;
  return /^\s*(?:is|are|do|does|can|could|will|would)\b/i.test(text) || /\b(?:is|are|do|does|can|could|will|would)\s+(?:you|your|it|they|that|the\s+(?:product|grade|material))\b/i.test(text);
}

export function classifyBuyerTurn(context: VerificationPolicyContext): BuyerTurnClassification {
  context=applyCoachingConfiguration(context);
  const buyerText = latestBuyerText(context);
  const reusableProductIdentities = offeredProductIdentities(context);
  const remaining = withoutDocumentRequests(buyerText).replace(EMAIL, '');
  let factTopics = FACT_TOPICS.filter(([, pattern]) => sentences(remaining).some(part => requestsFact(part.text, pattern))).map(([topic]) => topic);
  if(requestsDocumentProductCoverage(buyerText))factTopics.push('document_coverage');
  const laterPrices = /\b(?:then|after|later|get\s+back|come\s+back)\b.{0,80}\b(?:prices?|pricing|quote)\b/i.test(remaining) && !/\?|\b(?:now|today|give\s+me|what\s+(?:is|are))\b/i.test(remaining);
  if (laterPrices) factTopics = factTopics.filter(topic => topic !== 'price');
  if (factTopics.length) return { kind: 'fact_request', buyerText, factTopics, reusableProductIdentities, reason: 'The buyer requests a concrete supplier/product fact; this takes precedence over any acknowledgement or handoff in the same turn.' };
  const emailGiven = EMAIL.test(buyerText) || /\b(?:email|address)\b.{0,50}\b(?:at|dot)\b/i.test(buyerText);
  EMAIL.lastIndex = 0;
  const agreedSend = SEND.test(buyerText) && DOCUMENT.test(buyerText) && /\b(?:yes|yeah|okay|ok|sure|great|sounds\s+good|please|how\s+about|you\s+(?:can|could)|(?:can|could|would|will)\s+you|send\s+me|email\s+me)\b/i.test(buyerText);
  const close = /\b(?:thanks|thank\s+you|sounds\s+good|that\s+works|looking\s+forward|talk\s+(?:to\s+you\s+)?later|goodbye|bye)\b/i.test(buyerText) && /^(?:confirm_send|capture_email)$/.test(context.conversationState?.nextAction?.kind || '');
  if (emailGiven || agreedSend || close) return { kind: 'confirmation', buyerText, factTopics: [], reusableProductIdentities, reason: 'The buyer is completing an agreed handoff or confirming the next step, with no new factual question.' };
  return { kind: 'sales_move', buyerText, factTopics: [], reusableProductIdentities, reason: 'This turn calls for a conversational sales move, such as a greeting, interest acknowledgement, or objection response.' };
}

type Evidence = { id: string; text: string; title?:string; complete?:boolean; original?:boolean };
const AVAILABLE_DOCUMENT_ACTION='Approved Company Knowledge establishes this existing document is available; its contents and performance are not asserted.';
function evidenceFor(context: VerificationPolicyContext): Evidence[] {
  const sources=context.sources||[];
  const confirmed=(context.brain?.facts||[]).filter(fact=>fact.confirmed&&sources.some(source=>source.id===fact.sourceId&&source.text.includes(fact.quote))).map(fact=>({id:fact.sourceId,text:`${fact.text}\n${fact.quote}`,original:false}));
  // Keep the existing non-specification paraphrase behavior, but extracted
  // Brain summaries are never original numeric specification evidence.
  return [...sources.map(source => ({ id: source.id, text: source.text, title:source.title, complete:source.complete,original:true })),...confirmed];
}

function identitySupported(identity: string, context: VerificationPolicyContext, evidence: Evidence[]) {
  const key = normalize(identity).replace(/\s/g, '');
  if (offeredProductIdentities(context).some(value => normalize(value).replace(/\s/g, '') === key)) return { supported: true, reason: 'Product/grade identity was already offered in this same call.' };
  if (normalize(context.manufacturer?.products || '').replace(/\s/g, '').includes(key)) return { supported: true, reason: 'Product identity appears in the supplied company product record; this does not verify its specifications.' };
  const source = evidence.find(item => normalize(item.text).replace(/\s/g, '').includes(key));
  return source ? { supported: true, reason: 'Product/grade identity appears in company knowledge.', sourceId: source.id } : { supported: false, reason: 'A new product/grade identity needs company evidence.' };
}

function sentences(text: string): { text: string; start: number; end: number }[] {
  // Do not split decimals, product numbers, or email addresses at periods.
  const result: { text: string; start: number; end: number }[] = [];
  let start = 0;
  for (let index = 0; index < text.length; index++) {
    if (!/[.!?;]/.test(text[index]) || (text[index] === '.' && !/\s|^$/.test(text[index + 1] || ''))) continue;
    if (text[index] === '.' && /\d/.test(text[index - 1] || '') && /\d/.test(text[index + 1] || '')) continue;
    result.push({ text: text.slice(start, index + 1), start, end: index + 1 });
    start = index + 1;
  }
  if (start < text.length) result.push({ text: text.slice(start), start, end: text.length });
  return result.filter(part => part.text.trim());
}

function replyClauses(text: string,context?:VerificationPolicyContext): { text: string; start: number; end: number }[] {
  return replySentences(text,context).flatMap(sentence => {
    // Preserve a closed check → (possibly result-conditional) document send.
    // Cutting “if it does, I will send it” at the second comma would invent an
    // unfinished coverage assertion; the combined action still gets source
    // availability and company-authority checks below.
    if(investigationThenDocumentDelivery(sentence.text,context)||isBoundedEpistemicFactAction(sentence.text,context)||isBuyerIdentifierClarification(sentence.text,latestBuyerText(context||{})))return [sentence];
    const separator = /,\s*(?=but\b)|,\s*(?=(?:and\s+)?(?:can|could|would|may|what|which|how|I|we|our|it|you)\b)|\s+(?=and\s+(?:can|could|would|what|which|how|I|we|our|it|you)\b)/gi;
    const parts: { text: string; start: number; end: number }[] = [];
    let offset = 0;
    for (const match of sentence.text.matchAll(separator)) {
      const end = match.index || 0;
      parts.push({ text: sentence.text.slice(offset, end), start: sentence.start + offset, end: sentence.start + end });
      offset = end + match[0].length;
    }
    parts.push({ text: sentence.text.slice(offset), start: sentence.start + offset, end: sentence.end });
    return parts.filter(part => part.text.trim());
  });
}

/** A following pronoun may refer to exactly one preceding bounded report
 * check. Keep that closed action pair together; never borrow a referent from
 * earlier calls, unknown intervening sentences or a different company. */
function replySentences(text:string,context?:VerificationPolicyContext):{text:string;start:number;end:number}[]{
 const original=sentences(text),grouped:{text:string;start:number;end:number}[]=[];
 for(const sentence of original){
  const previous=grouped.at(-1),together=previous?text.slice(previous.start,sentence.end):'';
  if(previous&&(investigationThenDocumentDelivery(together,context)||isBoundedEpistemicFactAction(together,context))){
   grouped[grouped.length-1]={text:together,start:previous.start,end:sentence.end};
  }else grouped.push(sentence);
 }
 return grouped;
}

function evidenceForNumber(number: string, clause: string, evidence: Evidence[]): Evidence | undefined {
  const specification=specificationNumberEvidence(number,clause,evidence.filter(item=>item.original!==false));
  if(specification.handled)return specification.source;
  const topics = FACT_TOPICS.filter(([, pattern]) => pattern.test(clause));
  const key = normalize(number).replace(/\s/g, '');
  return evidence.find(item => sentences(item.text).some(part => {
    if (!normalize(part.text).replace(/\s/g, '').includes(key)) return false;
    const grades = [...clause.matchAll(/\bF\s?\d{2,6}\b|#\s?\d{2,6}\b/gi)].map(match => normalize(match[0]).replace(/\s/g, ''));
    if (grades.length && grades.some(grade => !normalize(part.text).replace(/\s/g, '').includes(grade))) return false;
    if (grades.length) {
      const numberIndex = part.text.toLowerCase().indexOf(number.toLowerCase());
      const prefix = part.text.slice(0, numberIndex < 0 ? part.text.length : numberIndex);
      const scope = prefix.slice(Math.max(prefix.lastIndexOf(','), prefix.lastIndexOf(';'), prefix.lastIndexOf('\n')) + 1);
      const scopedGrades = [...scope.matchAll(/\bF\s?\d{2,6}\b|#\s?\d{2,6}\b/gi)].map(match => normalize(match[0]).replace(/\s/g, ''));
      if (!scopedGrades.length || grades.some(grade => !scopedGrades.includes(grade))) return false;
    }
    // A percentage in a purity fact cannot substantiate a price, MOQ, or delivery claim.
    return topics.length ? topics.some(([, pattern]) => pattern.test(part.text)) : normalize(part.text).includes(normalize(clause));
  }));
}

function timingAgreed(clause: string, context: VerificationPolicyContext): boolean {
  // Vague speed promises are never a specific agreement. Product lead-time facts still use docs.
  if (/\b(?:soon|shortly|ASAP|quickly|in\s+a\s+bit|right\s+away|promptly|immediately)\b/i.test(clause)) return false;
  const clock = clause.match(/\b(?:\d{1,2}(?::\d{2})?\s*(?:am|pm)|(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)(?:\s+(?:morning|afternoon|evening))?|tomorrow|today)\b/i)?.[0];
  if (!clock) return false;
  const buyerTurns = (context.turns || []).filter(turn => turn.role === 'buyer' || turn.role === 'customer');
  return buyerTurns.some(turn => turn.text.toLowerCase().includes(clock.toLowerCase()) && /\b(?:yes|okay|ok|works|fine|agreed|please|can\s+you|could\s+you)\b/i.test(turn.text));
}

/** A product-purpose attachment asserts an application, unlike a recipient
 * ("for your team") or a document-review action. Keep the entire predicate
 * for evidence checking; a matching product name alone cannot support it. */
function productPurposeClaim(clause:string):boolean {
  const match=clause.match(/\b(?:we|our company)\s+(?:(?:can|do|will)\s+)?(?:supply|offer|provide|produce|manufacture|make|sell)\b([^.!?;]{1,140}?)\bfor\s+([^.!?;]{2,120})/i);
  if(!match||DOCUMENT.test(match[1]))return false;
  return !/^(?:you|your (?:team|company|business)(?!['’]s)|(?:your |the |a |an )?(?:review|evaluation|comparison|reference|consideration|discussion))\b/i.test(match[2].trim());
}
function supplierApplicationClaim(clause:string):boolean {
  if(productPurposeClaim(clause)||/\b(?:used|applied)\s+(?:in|for|by)\b|\b(?:designed|suited|suitable|ideal|intended)\s+for\b/i.test(clause))return true;
  // "We help companies that need this material for their equipment" still
  // asserts an existing customer/application capability. A prospect's industry
  // or a question about possible relevance cannot establish that predicate.
  return /\bwe\s+(?:(?:can|do)\s+)?(?:help|support|serve)\s+(?:companies|businesses|customers|clients|manufacturers)\b[^.!?;]{0,90}\b(?:need|use|using|work with)\b[^.!?;]{0,70}\b(?:for|in)\s+[^.!?;]+/i.test(clause);
}
/** A promise to find out whether a fact is true does not assert that it is.
 * Keep the uncertainty marker mandatory and reject an attached positive claim. */
function unresolvedFactCheck(clause:string,context?:VerificationPolicyContext):boolean {
 return isBoundedEpistemicFactAction(clause,context);
}
/** Closed conversational acts can accompany a fact question without asserting
 * its answer. Inspect every clause; a polite prefix never exempts its tail. */
function conversationalClause(text:string,context?:VerificationPolicyContext):boolean {
 const line=text.trim().replace(/[’‘]/g,"'");
 if(isConversationalAcknowledgment(line,context))return true;
 if(isBuyerIdentifierClarification(line,latestBuyerText(context||{})))return true;
 if(/^(?:please\s+)?(?:go ahead and\s+)?(?:email|send)\s+(?:over\s+)?(?:the|that|your)\s+drawing(?:\s+over)?[.!]?$/i.test(line))return true;
 if(/^(?:(?:and\s+)?(?:I|we)(?:'ll| will| can)\s+)?wait\s+for\s+your\s+approval\s+before\s+(?:sending|emailing|sharing)\s+(?:anything|it|the report)[.!]?$/i.test(line))return true;
 if(/^(?:(?:once|after|when|if)\s+(?:I|we)\s+(?:(?:verify|confirm) (?:that|its availability|it is available)|know for sure)|(?:I|we)(?:'ll| will)\s+(?:follow up(?: and let you know)?|let you know|report back|confirm(?: that for you)?(?: before (?:sending|emailing) (?:it|them|anything|the documents))?))[,.!]?$/i.test(line))return true;
 // An unqualified investigation promises only the rep's follow-through.
 // Restricted actions, content assertions and time promises cannot fit it.
 if(/^(?:(?:I|we)(?:'ll| will| can)|let (?:me|us))\s+(?:check|double[- ]?check|find out|look into (?:it|that)|check (?:it|that|the details))(?:\s+and\s+(?:let you know|report back|confirm before (?:sending|emailing) (?:it|them|anything)))?[.!]?$/i.test(line))return true;
 // Ask about the buyer's needs/criteria, rather than offering our capability
 // in interrogative form. Numeric and presupposed factual claims still pass
 // through assessReplyVerification before this whole-reply exemption.
 return /^(?:what|which|how|when|where|who|does|do|is|are|would|could|can)\b[^.!?]*\?$/i.test(line)
  &&/\b(?:you|your)\b/i.test(line)
  &&!/\b(?:our|we|I|guarantee\w*|certif\w*|approved|free|discount\w*|ship|deliver|promise|superior|cheaper|faster|better quality)\b/i.test(line);
}
/** Fast factual-turn handling is a whole-meaning decision over the proposed
 * spoken reply, not a keyword decision about the buyer's question. Unknown
 * clauses remain conservative; supported factual claims still get their
 * normal source check, and hard company/context vetoes always win. */
export function isNonAssertiveReply(say:string,claims:ReplyFactClaim[],context?:VerificationPolicyContext):boolean {
 if(claims.some(claim=>!claim.supported||(claim.kind!=='product_identity'&&(claim.kind!=='supplier_claim'||claim.reason!==AVAILABLE_DOCUMENT_ACTION))))return false;
 const parts=replySentences(say,context);
 return !!parts.length&&parts.every(sentence=>unresolvedFactCheck(sentence.text,context)||replyClauses(sentence.text,context).every(local=>{
  const part={...local,start:sentence.start+local.start};
  return unresolvedFactCheck(part.text,context)||conversationalClause(part.text,context)||claims.some(claim=>claim.start===part.start&&claim.text===part.text&&claim.reason===AVAILABLE_DOCUMENT_ACTION);
 }));
}
/** A whole-reply fast path must account for every clause, including a predicate
 * an older lexical detector may not recognize. Unrecognized tails keep the
 * ordinary verification path rather than inheriting the uncertainty exemption. */
export function isBoundedFactCheckReply(say:string,claims:ReplyFactClaim[],context?:VerificationPolicyContext):boolean {
 return replyClauses(say,context).some(part=>unresolvedFactCheck(part.text,context)||!!investigationThenDocumentDelivery(part.text,context))&&isNonAssertiveReply(say,claims,context);
}
function concreteSupplierAssertion(clause: string): boolean {
  // "That makes sense" is acknowledgment, not a claimed maintenance outcome.
  clause=clause.replace(/^\s*(?:that|it) makes sense\s*[-—:,;.]?\s*/i,'');
  if(unresolvedFactCheck(clause))return false;
  // Waiting while another person checks availability asserts no product stock
  // or personnel availability; the condition explicitly remains unresolved.
  if(/^\s*(?:I|we)(?:['’]ll|\s+(?:will|can|would))\s+(?:hold|wait|stay on the line)\b/i.test(clause)&&/\b(?:while|as|to)\b.{0,40}\b(?:check|see|find out)\b.{0,25}\b(?:if|whether)\b/i.test(clause)&&! /\b(?:but|however|guarantee|stock|inventory|products?|materials?|samples?|we (?:have|offer|supply))\b/i.test(clause))return false;
  if(declinesResponseDeadline(clause)&&/\b(?:hours?|days?|deadline|turnaround|quote|response)\b/i.test(clause))return false;
  // A commercial commitment need not use “we will”: “Delivery is Friday”
  // supplies the same supplier schedule. Questions and explicit investigation
  // remain nonassertive; a declarative commercial subject needs evidence.
  if(!/\?\s*$/.test(clause)&&/^\s*(?:(?:and|but|also)\s+)?(?:(?:the|our|your|this|that)\s+)?(?:delivery|shipment|shipping|dispatch|arrival|discount|concession|certification|payment terms)\b.{0,45}\b(?:is|are|will be|has been|have been|takes?|comes?|happens?|starts?|arrives?|leaves?|departs?|includes?)\b/i.test(clause))return true;
  // Restating the buyer's desired outcome is not asserting supplier performance.
  if(/^\s*(?:you(?:['’]re| are)?\s+(?:looking|hoping|aiming)|you\s+(?:want|need)|your\s+(?:goal|priority|requirement|aim)\s+is)\b/i.test(clause)&&!/\b(?:our|we can|we will|guarantee)\b/i.test(clause))return false;
  // Speech and streamed wording may put the predicate in its own sentence:
  // "Mostly used in industrial equipment." It remains an application claim,
  // even without a repeated subject, product code, or numerical specification.
  const applicationClaim=/\b(?:mostly|commonly|typically|widely|generally|mainly|often)\s+(?:used|applied)\s+(?:in|for|by)\b|\b(?:designed|suited|suitable|ideal|intended)\s+for\b|\b(?:used|applied)\s+(?:in|for|by)\b/i.test(clause);
  const applicationQuestion=/\?\s*$|^\s*(?:what|how|which|whether|is|are|would|could|can)\b|\b(?:check|confirm|learn|understand|find out)\s+(?:whether|if)\b/i.test(clause);
  if((applicationClaim||supplierApplicationClaim(clause))&&!applicationQuestion)return true;
  const own = /\b(?:we|our|ours|I|it|which|that|this\s+(?:product|grade|material)|the\s+(?:product|grade|material)|F\s?\d+)\b/i.test(clause);
  // Document availability is still a claim even when its subject has no 'we'.
  // Check it separately from a neighbouring rep-status/uncertainty clause.
  if(!clause.includes('?')&&/\b(?:specs?|specifications?|drawings?|documents?|profiles?|data sheets?|catalog(?:ue)?)\b.{0,100}\b(?:is|are)\s+available\b/i.test(clause))return true;
  // A question can smuggle an assertion through its noun phrase ("email for our free samples").
  if (/\bour\s+(?:(?:ISO\s?\d*|certified|free|guaranteed|superior|consistent|in[-\s]stock)\s+)(?:\w+\s+){0,2}(?:samples?|products?|materials?|grades?|stock|quality|performance|supply)\b/i.test(clause)) return true;
  if (/\b(?:makes?|improves?|reduces?|saves?|simplif(?:y|ies)|speeds? up|helps? (?:reduce|improve|simplify))\b.{0,55}\b(?:maintenance|downtime|costs?|quality|performance|productivity|installation|changeovers?|reliability|service|effort|time|simpler|easier|faster)\b|\b(?:maintenance|installation|changeovers?)\b.{0,25}\b(?:simpler|easier|faster)\b/i.test(clause)&&!/^\s*(?:what|how|would|could)\b/i.test(clause)) return true;
  // A relative tail remains an asserted guarantee after clause splitting;
  // grounded numerical wording before it cannot authorize the new outcome.
  if(/^\s*(?:which|that)\s+(?:guarantees?|ensures?|proves?|certifies?)\b/i.test(clause))return true;
  if (!own || /^\s*(?:and\s+)?(?:is|are|do|does|would|could|can|what|how|when)\b/i.test(clause) || /^\s*which\s+(?!(?:is|are|has|have)\b)/i.test(clause)) return false;
  if (/\b(?:free\s+samples?|guarantee(?:s|d)?|in\s+stock|(?:is|are|have)\s+available|certif(?:y|ies|ying|ied|ication|icates?)|ISO\s?\d+|best\s+(?:quality|performance|products?|materials?|grades?|prices?|supply|service)|superior|more\s+reliable|faster\s+delivery|better\s+(?:quality|performance)|(?:good|high|consistent|stable|premium)[-\s]+(?:quality|performance)|(?:is|are)\s+(?:consistent|reliable)|performs?\s+well|based\s+in|protected\s+payment|quality\s+(?:products|materials)|(?:meet|exceed)\w*\s+(?:\w+\s+){0,3}standards|competitive\s+pric(?:e|es|ing)|lowest\s+pric(?:e|es)|sample\s+policy)\b/i.test(clause)||/\b(?:our|we|it)\b.{0,50}\b(?:is|are|offer|offers)\s+(?:the\s+)?best\b/i.test(clause)) return true;
  if (CONDITIONAL_PROPOSAL.test(clause) && !/\b(?:guarantee|free|in\s+stock|certified)\b/i.test(clause)) return false;
  // Sending existing documents is a rep action, not factory capacity or a sample policy.
  if (DELIVERY.test(clause) && DOCUMENT.test(clause) && !/\b(?:ship|deliver|free|guarantee|stock|certified)\b/i.test(clause)) return false;
  if (/\b(?:we(?:['’]re|\s+are)|our\s+company\s+is)\s+(?:a\s+|the\s+)?(?:manufacturer|factory)\b|\b(?:quality|performance|purity)\s+(?:is|are)\s+(?:good|superior|consistent|reliable|high)\b/i.test(clause)) return true;
  if (/\bwe\s+(?:have|provide|offer|supply)\s+(?:\w+\s+){0,3}(?:samples?|stock)\b|\bwe\s+(?:manufacture|produce|ship|deliver)\b/i.test(clause)) return true;
  // A limitation attached to a proposed review ("though no discount is
  // preapproved") is not an affirmative concession hidden in "we can...".
  const affirmativeClause=clause.replace(/\b(?:no|not any)\s+(?:discounts?|price matching|payment[- ]term changes?)\s+(?:is|are)\s+(?:preapproved|approved|authorized)\b/gi,'');
  return /\b(?:we\s+(?:can|do|will|always)|our\s+\w+(?:\s+\w+){0,4}\s+(?:is|are|has|have)|it\s+(?:is|has))\b.{0,45}\b(?:supply|produce|manufacture|ship|deliver|stock|capacity|purity|hardness|certification|samples?|quality|price|discount|lead\s*time|MOQ)\b/i.test(affirmativeClause);
}

function safeSupplierEvidence(clause: string, evidence: Evidence[],context?:VerificationPolicyContext): Evidence | undefined {
  const specification=literalSpecificationEvidence(clause,evidence.filter(item=>item.original!==false));
  if(specification)return specification;
  const normalized = normalize(clause).replace(/^(?:yes |and |but |we |our |it is |this is )+/, '');
  if (normalized.length < 8) return undefined;
  // Only an actual matching assertion qualifies locally. The model verifier handles paraphrases.
  const articles=(line:string)=>line.replace(/\b(?:a|an|the)\b\s*/g,'').replace(/\s+/g,' ').trim();
  const exact=evidence.find(item => normalize(item.text).includes(normalized)||articles(normalize(item.text)).includes(articles(normalized)));
  if(exact)return exact;
  // A documented "Chinese manufacturer and exporter of X" entails
  // "We're a manufacturer of X". Match the actual company subject, keep the
  // entire product scope, and require every claimed role/modifier in the source.
  // This never supports an added application, benefit, certification or negation.
  const identity=clause.trim().match(/^(?:and\s+)?(?:we(?:['’]re|\s+are)|our company is)\s+(?:a|an|the)\s+([^.!?;:,]{1,90}?)\s+of\s+([^.!?;:,]+)[.!]?$/i);
  if(identity&&/\b(?:manufacturer|exporter|supplier|distributor|factory)\b/i.test(identity[1])&&context?.manufacturer?.name){
    const company=context.manufacturer.name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    const sourcePattern=new RegExp('^(?:'+company+' is|we are|our company is)\\s+(?:a|an|the)\\s+([^.!?;:,]{1,90}?)\\s+of\\s+([^.!?;:,]+)[.!]?$','i');
    const roleWords=normalize(identity[1]).split(' ').filter(word=>word!=='and');
    const source=evidence.find(item=>sentences(item.text).some(part=>{
      const original=part.text.trim().match(sourcePattern);if(!original||/\b(?:not|no|never|or|formerly|previously)\b/i.test(original[1]))return false;
      const documented=new Set(normalize(original[1]).split(' '));
      return roleWords.every(word=>documented.has(word))&&articles(normalize(identity[2]))===articles(normalize(original[2]));
    }));
    if(source)return source;
  }
  // Equivalent document nouns/modifiers can retain a grounded availability
  // sentence. This does not confer sample/product stock, concessions, or any
  // extra availability condition; all other claim words still must match.
  if(/\b(?:specs?|specifications?|drawings?|documents?|profiles?|data sheets?|catalog(?:ue)?)\b.{0,100}\b(?:is|are)\s+available\b/i.test(clause)){
    const documentText=(text:string)=>articles(normalize(text)).replace(/\bspecs?\b/g,'specifications').replace(/\bdocs?\b/g,'documents').replace(/\b(?:technical|dimensional)\s+(?=(?:specifications|drawings)\b)/g,'').replace(/\s+/g,' ').trim();
    const claim=documentText(normalized),direct=evidence.find(item=>documentText(item.text).includes(claim));if(direct)return direct;
    // An available set entails an unmodified member: specs AND dimensional
    // drawings being available supports "drawings are available for review".
    // Extra artifact types, conditions and technical claims must still match.
    const [subject,tail]=claim.split(/\b(?:is|are) available\b/),kinds=['specifications','drawings','documents','profiles','data sheets','catalog'];
    const asked=kinds.filter(kind=>subject?.includes(kind)),identities=subject?.match(/\b[a-z]{1,6}\d{2,6}\b/g)||[];
    let remainder=subject||'';for(const token of [...asked,...identities])remainder=remainder.replaceAll(token,'');
    remainder=remainder.replace(/\b(?:since|and|both|our|your|these|those)\b/g,'').trim();
    const purpose=(tail||'').trim();
    if(asked.length&&!remainder&&/^(?:|for (?:engineering )?(?:review|evaluation))$/.test(purpose))return evidence.find(item=>{
      const source=documentText(item.text);return /\b(?:is|are) available\b/.test(source)&&asked.every(kind=>source.includes(kind))&&identities.every(id=>source.includes(id))&&(!purpose||/\b(?:review|evaluation)\b/.test(source));
    });
  }

}

/** Candidate evidence is a retrieval boundary, never a support verdict. Only
 * excerpts describing a relevant property qualify: a product name or the mere
 * availability of drawings does not support a new mechanism. The existing
 * semantic verifier decides equivalence, negation, scope and conditions. */
function paraphraseCandidates(clause:string,evidence:Evidence[],context:VerificationPolicyContext):Evidence[] {
 clause=canonicalizeKnownProductIdentifiers(clause,evidence);
 const stop=new Set('the a an our your this that these those it they we can could will would has have is are be been allows allow you to of for and or with from design product products'.split(' '));
 const tokens=(text:string)=>new Set((normalize(text).match(/[a-z0-9]+/g)||[]).filter(word=>word.length>2&&!stop.has(word)));
 const identityWords=tokens((context.manufacturer?.products||'')+' '+(context.manufacturer?.name||''));
 const words=tokens(clause),ids=[...clause.matchAll(/\b[a-z]+\d+[a-z0-9]*\b/gi)].map(item=>item[0].toLowerCase());
 return evidence.filter(item=>sentences(item.text).some(part=>{
   const source=normalize(canonicalizeKnownProductIdentifiers(part.text,evidence)),shared=[...tokens(source)].filter(word=>words.has(word)&&!ids.includes(word)&&!identityWords.has(word));
   // A grounded design plus a new outcome is not merely a paraphrase of that
   // design. Require evidence about the asserted outcome before asking the
   // semantic checker to resolve equivalent wording; identity overlap cannot
   // promote a maintenance/cost/performance promise into a pending draft.
   // A customer named "Equipment" in a quotation does not substantiate an
   // application claim about industrial equipment. Retrieve property evidence,
   // not an unrelated shared noun, before asking the semantic verifier.
   const application=supplierApplicationClaim(clause);
   if(application&&!supplierApplicationClaim(source)&&!/\b(?:used|applied|uses?|applications?)\b|\b(?:designed|suited|suitable|ideal|intended)\s+for\b/i.test(source))return false;
   const benefit=clause.match(/\b(?:makes?|improves?|reduces?|saves?|simplif(?:y|ies)|speeds? up|helps? (?:reduce|improve|simplify))\b.{0,55}\b(maintenance|downtime|costs?|quality|performance|productivity|installation|changeovers?|reliability|service|effort|time)\b/i);
   if(benefit&&!new RegExp('\\b'+benefit[1].replace(/s$/i,'')+'s?\\b','i').test(source))return false;

   // Retrieval must not use another model/grade's property as evidence.
   if(ids.length&&ids.some(id=>!new RegExp('\\b'+id+'\\b','i').test(source)))return false;
   if(!shared.length)return false;
   const identityOnly=/\b(?:supplies|supply|manufactures|manufacture|offers|offer|produces|produce|is (?:a|an|the)|are)\b/i.test(source)&&! /\b(?:has|have|uses|use|contains|contain|features|feature|supports|support|allows|allow|enables|enable|removable|removal|designed|operates|operation|resists|resistance|rated)\b/i.test(source);
   const artifactOnly=/\b(?:specifications?|specs?|drawings?|documents?|profiles?|brochures?|manuals?|test reports?|inspection reports?|certificates?)\b.*\b(?:available|review|evaluation)\b/i.test(source)&&! /\b(?:has|have|uses|contains|features|supports|allows|enables|removable|designed|proves|shows|confirms|demonstrates|certifies)\b/i.test(source);
   return !identityOnly&&!artifactOnly;
 }));
}

/** A buyer's delivery condition can survive different word orders. Only a
 * closed report-scope condition can be satisfied by “if it does”; an unknown
 * condition remains pending rather than becoming permission to send. */
export function reportDeliveryCondition(buyerText:string):'scope_required'|'unresolved'|undefined {
 const text=buyerText.replace(/[’‘]/g,"'");
 const delivery='(?:send|email|share|forward|reply|respond|sending|emailing|sharing|forwarding)';
 const patterns=[
  new RegExp('\\bonly\\s+'+delivery+'\\b[^.!?]*?\\bif\\s+([^.!?]+)','gi'),
  new RegExp('\\b'+delivery+'\\b[^.!?]*?\\b(?:only\\s+)?(?:if|when)\\s+([^.!?]+)','gi'),
  new RegExp("\\b(?:do not|don't|never)\\s+"+delivery+'\\b[^.!?]*?\\bunless\\s+([^.!?]+)','gi'),
  new RegExp('(?:^|[.!?]\\s*)\\s*(?:if|once|after|when)\\s+([^,;.!?]+)[,;]\\s*[^.!?]*?\\b'+delivery+'\\b','gi'),
  new RegExp('(?:^|[.!?]\\s*)\\s*unless\\s+([^,;.!?]+)[,;]\\s*[^.!?]*?\\b(?:do not|don\'t)\\s+'+delivery+'\\b','gi'),
  new RegExp('([^.!?]*\\b(?:needs?|must|has to|have to|requires?|required)\\b[^.!?]*?)\\bbefore\\b[^.!?]*?\\b'+delivery+'\\b','gi'),
 ];
 const conditions=patterns.flatMap(pattern=>[...text.matchAll(pattern)].map(match=>match[1].trim()));
 if(conditions.length){
  // Match the condition itself, not an unrelated coverage question elsewhere
  // in the buyer's turn. Unknown predicates retain semantic checking; neither
  // an available report nor “once confirmed” establishes the required result.
  const referent='(?:it|that|this|(?:(?:the|this|that|our|your)\\s+)?(?:(?:material\\s+test|inspection|test|quality)\\s+)?report)';
  const scoped=new RegExp('^'+referent+'\\s+(?:(?:needs? to|must|has to)\\s+)?(?:covers?|matches?|applies?\\s+to)\\s+(.+)$','i');
  const nominal=/^(?:we|I)\s+need\s+coverage\s+(?:of|for)\s+(.+?)\s+confirmed$/i;
  if(conditions.every(condition=>{
   condition=condition.replace(/^(?:you(?:'re| are)\s+sure\s+(?:that\s+)?|(?:I|we|you)(?:'ve| have)?\s+(?:confirmed|verified|checked)\s+that\s+)/i,'');
   if(new RegExp('^'+referent+'\\s+matches$','i').test(condition))return true;
   const object=scoped.exec(condition)?.[1]||nominal.exec(condition)?.[1];
   return !!object&&!/\b(?:not|never|no|doesn't|don't|isn't|aren't|and|or|unless|if|when|because|since|before|after|once|provided|confirms?|approves?|discount|approval|permission|authorized|certif\w*|guarantee\w*)\b|[;!?]/i.test(object);
  }))return 'scope_required';
  return 'unresolved';
 }
 // Restrictive wording outside the closed forms above cannot silently become
 // an unconditional send. Ordinary timing questions or a request to check
 // before sending contain none of these restriction markers and remain fast.
 if(new RegExp('\\b'+delivery+'\\b','i').test(text)&&/\b(?:only if|only when|unless|provided that|on condition that|as long as)\b/i.test(text))return 'unresolved';
}

function buyerApprovalRequired(text:string):boolean {
 const approval=/\bapprov\w*|\bsign(?:s|ed)?\s*[- ]?off\b/i.test(text),delivery=/\b(?:send|email|share|reply|documents?)\b/i.test(text);
 return approval&&delivery&&(/\b(?:until|before)\b/i.test(text)&&/\b(?:do not|don't|never|no documents?|wait|hold)\b/i.test(text)||/\bonly\b[^.!?]{0,80}\b(?:after|once|when)\b/i.test(text));
}
type BuyerReleaseState={scope:boolean;approval:boolean;approver:'buyer'|'engineering';hold:boolean;unresolved:boolean};
/** Release conditions are actual buyer instructions, not the last sentence.
 * Courtesy and rep promises cannot erase them. A later explicit buyer release,
 * approval or cancellation can update this same-call state. */
function buyerReleaseState(context:VerificationPolicyContext):BuyerReleaseState {
 const state:BuyerReleaseState={scope:false,approval:false,approver:'buyer',hold:false,unresolved:false};
 const texts=(context.turns||[]).filter(turn=>turn.role==='buyer'||turn.role==='customer').map(turn=>turn.text);
 if(context.buyerText!==undefined&&texts.at(-1)!==context.buyerText)texts.push(context.buyerText);
 for(const raw of texts){
  const text=raw.replace(/[’‘]/g,"'");
  const currentCondition=reportDeliveryCondition(text);
  const cancellation=/\b(?:cancel|forget|withdraw)\b[^.!?]{0,35}\b(?:send|request|documents?|report)\b|\b(?:do not|don't)\s+(?:send|email|share)\s+(?:anything|it|the report)[.!]?\s*$/i.test(text)&&!currentCondition&&!/\b(?:until|before|unless)\b/i.test(text);
  if(cancellation){state.scope=false;state.approval=false;state.unresolved=false;state.hold=true;continue;}
  const permitted=/\b(?:you\s+(?:can|may)|please|go ahead and)\s+(?:send|email|share)\b/i.test(text)&&! /\b(?:only|until|unless|before|if|when|once|after|not|don't)\b/i.test(text);
  if(permitted)state.hold=false;
  const waivesScope=/\b(?:send|email|share)\b[^.!?]{0,80}\b(?:regardless of|even if|without checking)\b/i.test(text);
  const condition=currentCondition;
  if(waivesScope){state.scope=false;state.unresolved=false;}
  else if(condition==='scope_required')state.scope=true;
  else if(condition==='unresolved')state.unresolved=true;
  if(buyerApprovalRequired(text)){state.approval=true;state.approver=/\b(?:engineer|engineering)\b/i.test(text)?'engineering':'buyer';}
  else{
   const approved=text.split(/(?<=[.!?])\s+/).some(sentence=>/^(?:(?:thanks|okay|ok)[,. ]+)?(?:I|we|(?:my|our|the)\s+(?:engineer|engineering team|team|manager))\s+(?:(?:have|has)\s+)?(?:approved|approve|signed off)\b/i.test(sentence));
   if(approved&&(state.approver!=='engineering'||/\b(?:engineer|engineering)\b/i.test(text)))state.approval=false;
  }
 }
 return state;
}
function preservesBuyerApproval(say:string,approver:BuyerReleaseState['approver']='buyer'):boolean {
 if(/\b(?:regardless|anyway|without (?:your )?approval|even if you (?:do not|don't) approve)\b/i.test(say))return false;
 if(approver==='engineering'&&!/\b(?:engineer|engineering)\b/i.test(say))return false;
 const line=say.replace(/your (?:engineer|engineering team|team|manager)(?:'s)? approval/ig,'your approval').replace(/your (?:engineer|engineering team|team|manager)\s+approv/ig,'you approv');
 return /\b(?:wait|hold)\b[^.!?]{0,35}\byour approval\b[^.!?]{0,25}\bbefore\s+(?:sending|emailing|sharing)/i.test(line)
  ||/\b(?:won't|will not|do not|don't)\s+(?:send|email|share)\b[^.!?]{0,60}\buntil\s+(?:you|your team)\s+(?:approv|sign)/i.test(line)
  ||/\b(?:send|email|share|reply)\b[^.!?]{0,50}\b(?:after|once|when)\s+(?:you|your team)\s+(?:approv|sign)/i.test(line)
  ||/^\s*(?:once|after|when)\s+(?:you|your team)\s+(?:approv|sign)[^,;.!?]*,\s*(?:I|we)(?:['’]ll|\s+(?:will|can))\s+(?:send|email|share|reply)\b/i.test(line);
}

/** Offering a technical method or qualified artifact asserts support exists.
 * Document follow-through separately respects buyer and release conditions. */
function technicalSupportAssertion(clause:string,context:VerificationPolicyContext,evidence:Evidence[]):Pick<ReplyFactClaim,'supported'|'pending'|'candidateSourceIds'|'reason'|'sourceId'|'verificationBoundary'>|undefined {
 if(unresolvedFactCheck(clause,context))return;
 const delivery=investigationThenDocumentDelivery(clause,context);
 if(delivery){
  const buyer=latestBuyerText(context).replace(/[’‘]/g,"'");
  const release=buyerReleaseState(context),buyerCondition=release.scope?'scope_required':release.unresolved?'unresolved':undefined;
  if(buyerCondition==='scope_required'&&delivery.deliveryCondition!=='stated_condition')return {supported:false,reason:'The buyer made document delivery conditional on the report matching their product. Checking and then sending is only an action sequence; preserve the buyer’s explicit condition instead of promising delivery regardless of the result.'};
  if(buyerCondition==='unresolved')return {supported:false,pending:true,reason:'The buyer placed a condition on document delivery that is not established by merely completing the report check. Verify that this proposed send preserves the actual condition; document availability does not satisfy it.'};
  // “That report” can carry the one explicit report type in the current
  // buyer's request. Resolve the referent from their words, never from whichever
  // report happens to be available in the catalog or a previous company.
  const reportRequest=[buyer,...[...(context.turns||[])].reverse().filter(turn=>turn.role==='buyer').map(turn=>turn.text)].find(text=>/\b(?:(?:material\s+)?test|inspection|certification|quality)\s+reports?\b/i.test(text))||buyer;
  const requestedReports=[...new Set((reportRequest.match(/\b(?:(?:material\s+)?test|inspection|certification|quality)\s+reports?\b/gi)||[]).map(value=>value.toLowerCase().replace(/reports$/,'report')))];
  const document=delivery.document==='report'&&requestedReports.length===1?requestedReports[0]:delivery.document;
  const availability=technicalSupportAssertion(`I can send the ${document}.`,context,evidence);
  return availability||{supported:false,reason:'The document proposed after checking coverage is not established as available by Company Knowledge.'};
 }
 const coverage=assessDocumentProductCoverage(clause,context,evidence);
 if(coverage)return coverage;
 if(!context.coachingRequest)return;
 // A person's optional review of an existing document is not a predicate
 // about a product ("They can resist..."). Check document existence only,
 // with a closed grammar so content/performance qualifiers still fall through.
 const review=clause.trim().match(/^(?:they|you|he|she|your (?:team|engineer|colleague))\s+(?:can|could|may)\s+(?:also\s+)?(?:review|read|look at)\s+(.+?)(?:\s+if (?:they|you|he|she)(?:['’]d| would) like(?: more details)?|\s+for (?:more details|review|reference)|\s+to compare (?:quality details|(?:the |your |their )?(?:specifications|specs|requirements)))?[.!]?$/i);
 if(review){
   const nouns=review[1].split(/\s+(?:and|or)\s+|,\s*/i).map(value=>value.trim().replace(/^(?:(?:our|the|company|product)\s+)+/i,''));
   const kinds=nouns.map(value=>/^profiles?$/i.test(value)?'profile':/^(?:specs?|specifications?)(?: sheets?)?$/i.test(value)?'specification':/^(?:material )?test reports?$/i.test(value)?/^material/i.test(value)?'material_test_report':'test_report':undefined);
   if(kinds.length&&kinds.every(Boolean)){
     const reports=kinds.filter(kind=>kind==='test_report'||kind==='material_test_report');
     const availableReport=(part:string)=>{
       const statement=part.trim().match(/^(.+?)\s+(?:is|are)\s+available(?:\s+for review)?[.!]?$/i);
       if(!statement||!reports.every(kind=>kind==='material_test_report'?/\bmaterial test reports?\b/i.test(statement[1]):/\btest reports?\b/i.test(statement[1])))return false;
       // A plain document list is available. Mentioning a report inside another
       // document's description is not proof that the report itself is offered.
       return !statement[1].replace(/\b(?:company\s+)?profiles?\b|\b(?:material\s+)?test reports?\b|\b(?:product\s+)?(?:specs?|specifications?)(?:\s+sheets?)?\b/gi,'').replace(/\b[A-Z]{1,6}\d{1,6}\b/gi,'').replace(/\b(?:a|an|the|our|and|both)\b/gi,'').replace(/[\s,]/g,'');
     };
     const reportEntries=evidence.filter(item=>item.original!==false&&/\btest reports?\b/i.test((item.title||'')+' '+item.text));
     // The whole original availability entry must be a plain present-tense
     // document list. Do not ignore a later approval condition, a conflicting
     // entry or stale status just because one sentence says "available".
     const reportEntriesSafe=!!reportEntries.length&&reportEntries.every(item=>item.complete!==false&&!/\b(?:superseded|archived|obsolete|draft|outdated|historical|expired|not current|unapproved|not approved|for reference only)\b/i.test((item.title||'')+' '+item.text)&&availableReport(item.text));
     const source=evidence.find(item=>/\bavailable(?: for review)?\b/i.test(item.text)&&! /\b(?:not available|unavailable|no profile|no specification)\b/i.test(item.text)&&kinds.every(kind=>kind==='profile'?/\bprofiles?\b/i.test(item.text):kind==='specification'?/\b(?:specs?|specifications?)(?: sheets?)?\b/i.test(item.text):true)&&(!reports.length||reportEntriesSafe&&reportEntries.includes(item)));
     return source?{supported:true,sourceId:source.id,reason:'Approved knowledge establishes these documents are available; the line offers review without asserting their contents.'}:{supported:false,reason:'The offered documents are not established as available in approved Company Knowledge.'};
   }
 }
 if(/^\s*(?:I|we)(?:\s+(?:can|will|could)|['’]ll)\s+(?:check|confirm|find out|verify|ask (?:our|the) (?:team|engineer))\b/i.test(clause)&&!/\b(?:but|however|we have|we can (?:provide|offer|explain|show))\b/i.test(clause))return;
 const method=/\b(?:I|we)\s+(?:can|could|will|would)\s+(?:outline|explain|describe|demonstrate|show|walk (?:[\w’'-]+\s+){0,4}through)\b/i.test(clause)&&/\b(?:exact|method|procedure|process|how (?:the |our |it |this )?(?:[\w-]+\s+){0,4}(?:opens?|works?|operates?|assembles?|access|clean|install)|access|maintenance|installation|assembly)\b/i.test(clause);
 const artifact=clause.match(/\b(?:exploded[- ]view|cross[- ]section(?:al)?|assembly|installation|maintenance|service|repair|inspection|certification|test|CAD)\s+(?:drawings?|diagrams?|manuals?|procedures?|reports?|certificates?|models?|instructions|videos?)\b/i)?.[0];
 const offered=!!artifact&&/\b(?:provide|send|share|offer|attach|include|add|available|have|show)\b/i.test(clause);
 // An available report supports attaching it, never a newly invented claim
 // about what it proves. Check the asserted contents/outcome, not just its noun.
 const afterArtifact=artifact?clause.slice(clause.toLowerCase().indexOf(artifact.toLowerCase())+artifact.length):'';
 const artifactContent=offered&&/\b(?:prov(?:es|ing)|show(?:s|ing)|confirm(?:s|ing)|demonstrat(?:es|ing)|certif(?:ies|ying)|establish(?:es|ing)|validat(?:es|ing)|guarantee(?:s|d)?|meets?|complies|passes|ensures|certified)\b/i.test(afterArtifact);
 const productAssertion=affirmativeProductAssertion(clause,context);
 if(!method&&!offered&&!productAssertion)return;
 const subjects=[...clause.matchAll(IDENTITY)].map(item=>normalize(item[0]));
 // Existing-document follow-through is fast only while release is actually
 // permitted. A source saying “available only after manager approval” does
 // not authorize an unconditional send, even if another list says available.
 const available=artifact?availableDocumentActionEvidence(artifact,evidence):undefined;
 const source=method||productAssertion||artifactContent?safeSupplierEvidence(clause,evidence,context):available&&subjects.every(subject=>normalize(available.text).includes(subject))?available:undefined;
 if(source)return {supported:true,reason:offered&&!method&&!productAssertion&&!artifactContent?AVAILABLE_DOCUMENT_ACTION:'This specific technical support or product predicate is documented in Company Knowledge.',sourceId:source.id};
 const candidates=(artifactContent||productAssertion&&!offered)&&!method?paraphraseCandidates(clause,evidence,context):[];
 if(candidates.length)return {supported:false,pending:true,candidateSourceIds:[...new Set(candidates.map(item=>item.id))],reason:'A relevant company source may support this technical paraphrase; semantic support, conditions and scope are not yet verified.'};
 return {supported:false,reason:'This technical method, product feature or specific support artifact is not established by Company Knowledge. A product name or available document is not evidence of its construction, operation or contents; choose a requirement/evidence move or check the actual gap.'};
}

/** Claim detection follows the subject and predicate, not a catalog of invented
 * features. Citing the right product's document cannot establish a new verb or
 * property. Neutral questions, buyer requirements and conversational plans are
 * deliberately outside this guard. */
function affirmativeProductAssertion(clause:string,context:VerificationPolicyContext):boolean {
 const text=clause.trim().replace(/^(?:and|but|since|because)\s+/i,'');
 // "This is Morgan with [supplied company]" identifies the caller, not a
 // technical property of a product named "This". The separate rep-identity
 // guard still requires the actual name; an appended predicate cannot fit
 // this closed introduction form and retains the normal factual checks.
 const introduction=text.match(/^[Tt]his is\s+([A-Z][a-zA-Z'-]*(?:\s+[A-Z][a-zA-Z'-]*){0,2})\s+(?:with|from)\s+(.+?)[.!]?$/);
 if(introduction&&context.manufacturer?.name&&!/\b(?:a|an|the)\b/i.test(introduction[1])&&introduction[2].replace(/[.!]$/,'').trim().toLowerCase()===context.manufacturer.name.replace(/[.!]$/,'').trim().toLowerCase())return false;
 if(!/\b(?:our|we)\b/i.test(text)&&(context.turns||[]).some(turn=>turn.role==='buyer'&&normalize(turn.text).includes(normalize(text))))return false;
 if(/^(?:what|which|how|whether|do|does|is|are|can|could|would|will|have|has)\b/i.test(text))return false;
 if(/^\b(?:you|your (?:engineer|team))\s+can\b/i.test(text)&&/\b(?:open|operate|clean|install|assemble|remove|replace|access|connect)\b/i.test(text))return true;
 const match=text.match(/^((?:(?:our|this|that|these|those|the|its)\s+[^.!?;:,]{1,90}?|it|they|[A-Z][\w’'-]*(?:\s+[\w’'-]+){0,4}))\s+(is|are|has|have|uses?|features?|contains?|supports?|allows?|enables?|offers?|provides?|opens?|handles?|fits?|resists?|can|will)\b\s*([\s\S]*)/i);
 if(!match)return false;
 const subject=match[1],predicate=match[3];
 // Commercial approval has its own current-authority checks; it is not a
 // physical product predicate and must retain the approved/seek-approval move.
 if(/\b(?:discount|approval|offer|quotation|quote|payment|terms|price|pricing|concession)\b/i.test(subject))return false;
 if(/\b(?:buyer|customer|engineer|team|priority|focus|goal|objective|question|next step|concern|requirement|criterion|criteria|issue|point|decision|evaluation|review|need)\b/i.test(subject))return false;
 if(/^(?:important|key|useful|helpful|worth\b|something to\b|what\b|why\b|how\b|a (?:priority|concern|question)|not yet (?:known|confirmed))\b/i.test(predicate))return false;
 const productTerms=(context.manufacturer?.products||'').toLowerCase().match(/[a-z]{4,}/g)||[];
 const identity=/\b[a-z]+\d+[a-z0-9]*\b/i.test(subject);
 return identity||/^(?:our|this|that|these|those|the|its|it\b|they\b)/i.test(subject)||productTerms.some(term=>new RegExp('\\b'+term+'\\b','i').test(subject));
}

/** Repeating a requested number while explicitly withholding commitment is
 * not a supplier figure. The exception is local to this clause; an affirmative
 * clause later in the reply still needs ordinary evidence and authority. */
function declinesNumericCommitment(clause:string):boolean {
 const line=clause.replace(/[’‘]/g,"'");
 return /\b(?:I|we)\s+(?:cannot|can't|won't|will not|do not|don't)\s+(?:commit(?:\s+to)?|promise|guarantee|approve)\b/i.test(line)&&!/\b(?:but|however|yet|and)\b.{0,30}\b(?:I|we)(?:'ll| will| can| could| would)\b/i.test(line);
}
export function declinedNumericCommitmentSpans(say:string):{start:number;end:number}[]{
 return replyClauses(say).filter(part=>declinesNumericCommitment(part.text)).map(part=>({start:part.start,end:part.end}));
}
function buyerNumberInClarifyingQuestion(number:string,clause:string,context:VerificationPolicyContext):boolean {
 const clarification=/\?\s*$/.test(clause)&&/^\s*(?:and\s+)?(?:is|are|did|does|have|would|could|can|what|which|how)\b/i.test(clause),attributedRequirement=/\b(?:you (?:previously |earlier )?(?:mentioned|said|reported)|your (?:stated|reported|annual|current) (?:volume|requirement|usage|use))\b/i.test(clause);
 if((!clarification&&!attributedRequirement)||!/\b(?:you|your|team|requirement|decision|target|budget|constraint|comparison)\b/i.test(clause)||/\b(?:our|we|offer|provide|promise|guarantee|deliver|ship|certified)\b/i.test(clause))return false;
 const numbers:Record<string,number>={zero:0,one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,eleven:11,twelve:12,thirteen:13,fourteen:14,fifteen:15,sixteen:16,seventeen:17,eighteen:18,nineteen:19,twenty:20,thirty:30,forty:40,fifty:50,sixty:60,seventy:70,eighty:80,ninety:90};
 const numeric=(value:string)=>normalize(value).replace(/\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)\b/g,word=>String(numbers[word])).replace(/\s*\bpercent\b/g,'%').replace(/\s+%/g,'%');
 const prepared=reviewedClientContext(context)?.entries.filter(entry=>!entry.needsReview&&['buyer','rep_update'].includes(entry.source)&&['fact','background','update'].includes(entry.kind)&&entry.status==='current').map(entry=>entry.text)||[];
 const key=numeric(number),buyer=numeric([...(context.turns||[]).filter(turn=>turn.role==='buyer'||turn.role==='customer').map(turn=>turn.text),...prepared].join(' '));
 return new RegExp('(?:^|[^0-9.])'+key.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(?=$|[^0-9.])').test(buyer);
}

/** Inside a bounded promise to investigate report coverage, repeating the
 * buyer's value + property names the requirement to check, not a supplier
 * specification. A new value, changed unit/property or affirmative tail keeps
 * all normal factual checks. */
function buyerNumberInDocumentScopeCheck(number:string,clause:string,context:VerificationPolicyContext):boolean {
 if(!unresolvedFactCheck(clause)||!requestsDocumentProductCoverage(latestBuyerText(context))||! /\b(?:covers?|match(?:es)?|appl(?:y|ies)|pertain(?:s)?|relat(?:es)?)\b/i.test(clause))return false;
 // Do not let this local exemption hide a second commercial action attached
 // to the investigation. It only removes reference numbers from the check.
 if(/\b(?:and|plus|also)\s+(?:send|ship|deliver|offer|provide|supply|give|arrange|promise|approve|discount|extend)\b/i.test(clause))return false;
 const value=number.match(/^\s*(\d+(?:[.,]\d+)*)/)?.[1];if(!value)return false;
 const property=(text:string)=>[...text.matchAll(new RegExp('(?:^|[^a-z0-9.])('+value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+')(?![0-9.])','gi'))].flatMap(match=>{
  const tail=text.slice((match.index||0)+match[0].length),unit=tail.match(/^\s*(%|mesh\b|stainless\b|mm\b|millimet(?:er|re)s?\b|microns?\b|μm\b|um\b|inches?\b|kg\b|kilograms?\b|psi\b|bar\b)/i)?.[1];
  return unit?[normalize(value)+' '+normalize(unit)]:[];
 });
 const requested=new Set(property(latestBuyerText(context)));
 return property(clause).some(key=>requested.has(key));
}

/** A conditional concession is still an offered company action. General sales
 * knowledge and a buyer's request cannot authorize it. Neutral constraint
 * questions and an explicit promise to seek approval remain possible. */
function commercialActionSupport(clause:string,context:VerificationPolicyContext):{supported:boolean;reason:string;sourceId?:string}|undefined {
  const line=clause.replace(/[’‘]/g,"'");
  const topics:[string,RegExp][]=[
    ['discount',/\b(?:discount|concession|reduce (?:the |our |your )?price|(?:lower|cut) (?:the |our |your )?price|knock .{0,25}off)\b/i],
    ['price matching',/\b(?:match(?:ing)? (?:their|that|the|your|a competitor'?s?|competitors'?) price|price match(?:ing)?)\b/i],
    ['payment terms',/\b(?:extend(?:ed)? (?:payment |credit )?terms|payment[- ]term changes?|(?:offer|accept|give|provide).{0,35}(?:credit|payment|net[- ]?\d+))\b/i],
    ['samples',/\bsamples?\b/i],
  ];
  const topic=topics.find(([,pattern])=>pattern.test(line));if(!topic)return;
  // Asking about the buyer's previous test is not a new sample offer. In
  // particular, "Could you tell me why the first sample failed?" must survive
  // the very boundary that asks the rep to diagnose that failure first.
  if(topic[0]==='samples'&&/\?\s*$/.test(line)&&/\b(?:what|why|how|which|could you|can you|would you)\b/i.test(line)&&!/\b(?:free|offer|provide|send|arrange|ship|available|availability)\b|\bour samples?\b|\b(?:we|I)(?:'ll| will| can| could| would)\b/i.test(line))return;
  // Declining or explicitly reserving approval is not a concession. Do not let
  // an earlier refusal conceal a later affirmative clause in the same span.
  const affirmative=/\b(?:but|however|and)\s+(?:we|I)\s+(?:can|will|could|would|offer|give|match)\b/i.test(line);
  if(!affirmative&&(/\b(?:can(?:not|'t)|will not|won't|do not|don't|no|not)\b.{0,35}\b(?:promise|guarantee|offer|give|approved|preapproved|available|discount|match|sample)\b/i.test(line)||/\b(?:need(?:s)?|require(?:s)?)\b.{0,30}\b(?:approval|confirmation)\b/i.test(line)||/\b(?:check|confirm|ask|seek|request)\b.{0,35}\b(?:whether|if|approval|authorized|available)\b/i.test(line)))return;
  const action=/\b(?:we|I)\s+(?:could|can|will|would|offer|provide|match|give|accept)|\b(?:would|could|can)\s+(?:a |an |our |you |we |I )/i.test(line);
  if(!action)return;
  if(context.companyConfiguration){
    const conflicts=configurationSuggestionProblems(clause,context);
    if(conflicts.length)return {supported:false,reason:conflicts.join(' ')};
    // Knowledge can prove availability or terms, but cannot independently
    // authorize a concession in a versioned manager configuration.
    const actions:Record<string,string>={discount:'discount','price matching':'price_match','payment terms':'payment_terms',samples:'sample'};
    const permission=configurationAuthorizesAction(context,actions[topic[0]]);
    const buyerEvaluation=topic[0]==='samples'&&CONDITIONAL_PROPOSAL.test(line)&&!(/\b(?:our samples?|free samples?|we\s+(?:can|will|offer|provide|have)|ship|send|arrange)\b/i.test(line));
    if(!permission&&!buyerEvaluation)return {supported:false,reason:'This commercial offer has no applicable explicit authority in the call configuration.'};
  }
  const relevant=(context.sources||[]).flatMap(source=>sentences(source.text).filter(part=>topic[1].test(part.text)).map(part=>({id:source.id,text:part.text})));
  const managerLimits=Object.values(context.brain?.rules||{}).join(' ');
  const restriction=/\b(?:no|not|never|unavailable|unapproved|not preapproved|prohibited|cannot|can't)\b|\b(?:require|requires|need|needs|subject to|without)\b.{0,35}\bapproval\b/i;
  // A versioned configuration has already enforced its scoped structured
  // boundaries above. Do not concatenate unrelated "never invent" text with
  // an approved discount permission and misread that as a discount ban.
  const blocked=relevant.some(item=>restriction.test(item.text))||(!context.companyConfiguration&&topic[1].test(managerLimits)&&restriction.test(managerLimits));
  const supported=relevant.find(item=>!restriction.test(item.text)&&(/\b(?:approved|authorized|may offer|can offer|offer|offers|available|permitted)\b/i.test(item.text)||normalize(item.text).includes(normalize(line))));
  // Discussing sample evaluation as a possible buyer process isn't a sample
  // availability claim. Explicit company restrictions still govern it.
  const evaluationOnly=topic[0]==='samples'&&CONDITIONAL_PROPOSAL.test(line)&&!(/\b(?:our samples?|free samples?|we\s+(?:can|will|offer|provide|have)|ship|send|arrange)\b/i.test(line));
  if(!blocked&&(supported||evaluationOnly))return supported?{supported:true,sourceId:supported.id,reason:'The current company reference authorizes this commercial action.'}:undefined;
  return {supported:false,reason:`The proposed ${topic[0]} action is not authorized by current company policy; diagnose the constraint or seek approval instead.`};
}

function safeMove(classification: BuyerTurnClassification): string {
  if (hasClearConversationRefusal(classification.buyerText)) return 'Understood. Thank you for your time.';
  if (/\b(?:price|expensive|budget|cost|discount|payment|terms)\b/i.test(classification.buyerText)) return 'Any change to price or terms needs approval. Which part of the comparison is the main concern?';
  if (/\b(?:supplier|trust|switch|risk|why\s+(?:you|your))\b/i.test(classification.buyerText)) return 'There is no need to change a working arrangement just to consider an option. What would matter most before evaluating another supplier?';
  if (classification.kind === 'confirmation') return /@|\b(?:email|address)\b.{0,50}\b(?:at|dot)\b/i.test(classification.buyerText) ? 'Thank you. I’ll send the agreed information to that address, and you can take a look when it suits you.' : 'I can send you the agreed information. What would be a good email address?';
  return 'Understood. What would be most useful for you to look at next?';
}

/**
 * Removes unsupported *clauses*, not the conversational turn. All changes are returned explicitly
 * so rep-authored Edited wording can be shown as a diff rather than silently overwritten.
 */
function removeUnsupportedClauses(say: string, claims: ReplyFactClaim[], classification: BuyerTurnClassification): string {
  const unsupported = claims.filter(claim => !claim.supported && !claim.pending);
  if (!unsupported.length) return say;
  const clauses = replyClauses(say);
  let kept = clauses.map((part,index)=>({...part,index})).filter(part => !unsupported.some(claim => claim.start < part.end && claim.end > part.start));
  // If a whole subject assertion vanished, a follow-up about comparing "that"
  // can no longer stand alone. Preserve independent questions/claims instead.
  const sentenceParts=sentences(say);
  const orphaned=sentenceParts.filter((part,index)=>{
    const previous=sentenceParts[index-1];
    return previous&&!kept.some(clause=>clause.start<previous.end&&clause.end>previous.start)
      &&/\b(?:how|whether)\s+(?:that|this|it)\b.{0,30}\bcompare|\bcompare\s+(?:that|this|it)\b/i.test(part.text);
  });
  kept=kept.filter(part=>!orphaned.some(sentence=>part.start<sentence.end&&part.end>sentence.start));
  // Preserve the original join between adjacent surviving clauses. Turning
  // every comma into a period corrupts phrases such as "If helpful, we could".
  // Only close a sentence when a removed clause left a gap between survivors.
  let result='';
  kept.forEach((part,index)=>{
    const previous=kept[index-1],adjacent=previous&&previous.index+1===part.index;
    let text=part.text.trim().replace(/^[,;.]\s*/, '');
    if(!adjacent)text=text.replace(/^and\s+/i,'');
    if(!text)return;
    if(previous&&adjacent)result+=(say.slice(previous.end,part.start)||' ')+text;
    else {
      if(result)result=(/[.!?]$/.test(result)?result:result.replace(/[,;]$/, '')+'.')+' ';
      result+=text.charAt(0).toUpperCase()+text.slice(1);
    }
  });
  result=result.replace(/\s+([,.!?])/g, '$1').trim();
  return result || safeMove(classification);
}

export function assessReplyVerification(say: string, context: VerificationPolicyContext): ReplyVerificationAssessment {
  context=applyCoachingConfiguration(context);
  const classification = classifyBuyerTurn(context);
  const evidence = evidenceFor(context);
  const claims: ReplyFactClaim[] = [];
  const add = (text: string, start: number, kind: ReplyFactClaim['kind'], support: Pick<ReplyFactClaim,'supported'|'pending'|'candidateSourceIds'|'reason'|'sourceId'|'verificationBoundary'>) => {
    const existing=claims.findIndex(claim=>claim.start===start&&claim.kind===kind);
    if(existing<0)claims.push({ text, start, end: start + text.length, kind, ...support });
    // An authorization/context conflict must override a lexical match or a
    // pending paraphrase sharing the same clause. Never let dedup hide a veto.
    else if(!support.supported&&!support.pending&&(claims[existing].supported||claims[existing].pending))claims[existing]={text,start,end:start+text.length,kind,...support};
  };
  const identities = [...say.matchAll(IDENTITY)];
  const companySpans: { start: number; end: number }[] = [];
  const companyName = context.manufacturer?.name?.trim();
  const release=buyerReleaseState(context),buyerApproval=release.approval,buyerScope=release.scope;
  if(buyerApproval||buyerScope||release.hold)for(const sentence of replySentences(say,context)){
   // A permission clause cannot license a second subject's contradictory
   // action. Keep fronted conditions with their action, while examining each
   // coordinated new rep promise separately (not a whole-reply checkbox).
   // The existing bounded sentence grouper preserves only an adjacent
   // explicit inquiry + "if it does" referent, never a later unrelated send.
   for(const action of sentence.text.split(/\b(?:and|but|however)\s+(?=(?:I|we)(?:['’]ll|\s+(?:will|can|would))\b)/i))if(/\b(?:I|we)(?:['’]ll|\s+(?:will|can|would))\b[^.!?]{0,180}\b(?:send|email|share|reply|respond)\b|\b(?:report|documents?)\s+will\s+be\s+(?:sent|emailed|shared)\b/i.test(action)){
    const start=sentence.start+sentence.text.indexOf(action);
    if(release.hold)add(action,start,'supplier_claim',{supported:false,reason:'The buyer cancelled or withheld this send and has not released it again. A company document being available does not override that instruction.'});
    if(buyerApproval&&!preservesBuyerApproval(action,release.approver))add(action,start,'supplier_claim',{supported:false,reason:'The buyer withheld permission to send until they approve. Preserve the buyer’s stated approver before every promised document send; confirming report coverage or mentioning approval for a different action does not release the documents.'});
    if(buyerScope&&investigationThenDocumentDelivery(action.trim(),context)?.deliveryCondition!=='stated_condition')add(action,start,'supplier_claim',{supported:false,reason:'The buyer made delivery conditional on a positive report match. Preserve that condition for every promised send; completing a check or conditioning a different action does not authorize this delivery.'});
   }
  }
  if (companyName) {
    let from = 0;
    for (;;) {
      const index = say.toLowerCase().indexOf(companyName.toLowerCase(), from);
      if (index < 0) break;
      companySpans.push({ start: index, end: index + companyName.length });
      from = index + companyName.length;
    }
  }
  for (const match of identities) {
    // Formulas are names, not numerical claims. Mentioning a chemical does not assert its content.
    if (/^(?:Al2O3|SiC)$/i.test(match[0])) continue;
    add(match[0], match.index || 0, 'product_identity', identitySupported(match[0], context, evidence));
  }
  const productIds=productIdentityReferences(say,evidence).filter(reference=>!companySpans.some(span=>span.start<=reference.start&&span.end>=reference.end));
  for(const reference of productIds)add(reference.text,reference.start,'product_identity',{supported:true,sourceId:reference.sourceId,reason:'This complete product identifier, including equivalent join typography, appears in original company knowledge; this does not verify any quantity, specification or document coverage.'});
  const documentIds=documentIdentifierReferences(say).map(reference=>({...reference,source:documentIdentifierSource(reference,evidence)}));
  for(const reference of documentIds)add(reference.identifier,reference.start,'supplier_claim',reference.source?{supported:true,sourceId:reference.source.id,reason:'This exact identifier names the same document type in original Company Knowledge; its scope and contents still need their own checks.'}:{supported:false,reason:'This document identifier is not established for the same document type in current original Company Knowledge.'});
  // Clause splitting must not let “check whether …, which proves …” hide its
  // appended positive predicate. Assess that original sentence as a claim as
  // well; an uncertainty prefix does not support what follows the boundary.
  for(const sentence of sentences(say))if(replyClauses(sentence.text,context).some(part=>unresolvedFactCheck(part.text,context))&&!unresolvedFactCheck(sentence.text,context)&&/[:,]\s*(?:which|that|we|I|our|it|the (?:product|mesh))\b|:\s*[a-z]|\b(?:and|but|however|plus|also)\s+(?:we|I|our|it)\b/i.test(sentence.text)){
    const source=safeSupplierEvidence(sentence.text,evidence,context);
    add(sentence.text,sentence.start,'supplier_claim',source?{supported:true,sourceId:source.id,reason:'The complete appended supplier predicate is supported by Company Knowledge.'}:{supported:false,reason:'An appended positive supplier claim is not established by an earlier promise to check a different fact. Keep the uncertainty action and remove or independently support the added claim.'});
  }
  // Preserve a fronted qualifier ("For PX20, we have a test report") before
  // splitting its comma into separate clauses and losing the product scope.
  for(const sentence of replySentences(say,context)){
    const coverage=assessDocumentProductCoverage(sentence.text,context,evidence);
    if(coverage?.verificationBoundary)add(sentence.text,sentence.start,'supplier_claim',coverage);
  }
  for (const part of replyClauses(say,context)) {
    const text = part.text;
    const technicalSupport=technicalSupportAssertion(text,context,evidence);
    if(technicalSupport)add(text,part.start,'supplier_claim',technicalSupport);
    const conflicts=[...configurationSuggestionProblems(text,context),...clientContextSuggestionProblems(text,context)];
    if(conflicts.length)add(text,part.start,'supplier_claim',{supported:false,reason:conflicts.join(' ')});
    const commercial=commercialActionSupport(text,context);
    if(commercial)add(text,part.start,'supplier_claim',commercial);
    const responseTiming = /\b(?:I|we)(?:['’]ll|\s+(?:will|can|would))\b.{0,85}\b(?:soon|shortly|ASAP|quickly|in\s+a\s+bit|right\s+away|promptly|immediately|within|by\s+(?:\d|tomorrow|today|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)|in\s+\d+\s+(?:hours?|days?)|tomorrow|today)\b/i.exec(text);
    if (responseTiming&&!declinesResponseDeadline(text)) add(text, part.start, 'timing', { supported: timingAgreed(text, context), reason: 'A rep response deadline requires an explicitly agreed specific day/time; document facts do not authorize it.' });
    const buyerInquiryIds=[...(unresolvedFactCheck(text,context)?buyerProductIdentifierReferences(text,latestBuyerText(context)):[]),...buyerSpelledIdentifierClarificationReferences(text,latestBuyerText(context))];
    for (const number of text.matchAll(/(?:\$\s*)?\b\d+(?:[.,]\d+)*(?:\s*(?:%|USD|dollars?|tons?|tonnes?|kg|kilograms?|days?|hours?|weeks?|months?|microns?|μm|um|mm))?/gi)) {
      const start = part.start + (number.index || 0), end = start + number[0].length;
      if (companySpans.some(span => span.start <= start && span.end >= end)) continue;
      if(documentIds.some(reference=>reference.source&&reference.start<=start&&reference.end>=end))continue;
      if(productIds.some(reference=>reference.start<=start&&reference.end>=end))continue;
      // An unresolved inquiry may repeat the buyer's exact unknown identifier.
      // Its digit is not a measured claim, and this does not establish a
      // company product, an alias, ownership, or any affirmative fact about it.
      if(buyerInquiryIds.some(reference=>reference.start<=(number.index||0)&&reference.end>=(number.index||0)+number[0].length))continue;
      if (identities.some(identity => (identity.index || 0) <= start && (identity.index || 0) + identity[0].length >= end)) continue;
      if ([...say.matchAll(FORMULA), ...say.matchAll(EMAIL)].some(identity => (identity.index || 0) <= start && (identity.index || 0) + identity[0].length >= end)) continue;
      if (number[0].trim() === '100%' && /\b(?:yeah|yes|okay|ok|absolutely)[,.\s]+100%/i.test(text)) continue;
      if(declinesNumericCommitment(text))continue;
      if(buyerNumberInClarifyingQuestion(number[0],text,context))continue;
      if(buyerNumberInDocumentScopeCheck(number[0],text,context))continue;
      // In “check whether we have the ISO 9001 certificate”, 9001 names the
      // buyer's requested standard; it is not a claimed certification/quantity.
      // Only that literal identifier is exempt, never another number in the line.
      const standardPattern=/\b(?:ISO|EN|ASTM|DIN|IEC|UL)\s*[- ]?\d+(?::\d+)?(?:\.\d+)?\b/gi;
      const buyerStandards=[...latestBuyerText(context).matchAll(standardPattern)].map(standard=>normalize(standard[0]));
      const requestedStandard=[...text.matchAll(standardPattern)].find(standard=>(standard.index||0)<=(number.index||0)&&(standard.index||0)+standard[0].length>=(number.index||0)+number[0].length&&buyerStandards.includes(normalize(standard[0])));
      if(requestedStandard&&unresolvedFactCheck(text))continue;
      const declinedTimeUnit=/\b(?:hours?|days?|weeks?)\b/i.test(number[0])||/^[-\s]*(?:hours?|days?|weeks?)\b/i.test(text.slice((number.index||0)+number[0].length));
      if(declinesResponseDeadline(text)&&declinedTimeUnit&&normalize(classification.buyerText).includes(normalize(number[0])))continue;
      const source = evidenceForNumber(number[0], text, evidence);
      add(number[0], start, 'number', source ? { supported: true, reason: 'The number is present in a company source for the same fact topic.', sourceId: source.id } : { supported: false, reason: 'This concrete number has no matching company fact. Keep the sales move without it.' });
    }
    for (const number of text.matchAll(/\b(?:(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand)(?:[-\s]+|$))+(?:percent|dollars?|tons?|tonnes?|kilograms?|days?|hours?|weeks?|months?|microns?|millimeters?)\b/gi)) {
      if(declinesNumericCommitment(text))continue;
      if(buyerNumberInClarifyingQuestion(number[0],text,context))continue;
      const source = evidenceForNumber(number[0], text, evidence);
      add(number[0], part.start + (number.index || 0), 'number', source ? { supported: true, reason: 'The written quantity appears in a company source for the same fact topic.', sourceId: source.id } : { supported: false, reason: 'A quantity written in words is still a concrete fact and needs company evidence.' });
    }
    if (concreteSupplierAssertion(text) && !technicalSupport && !commercial) {
      const source = safeSupplierEvidence(text, evidence,context);
      const candidates=source||!context.coachingRequest?[]:paraphraseCandidates(text,evidence,context);
      add(text, part.start, 'supplier_claim', source ? { supported: true, reason: 'The supplier assertion appears in company knowledge.', sourceId: source.id } : candidates.length ? {supported:false,pending:true,candidateSourceIds:[...new Set(candidates.map(item=>item.id))],reason:'A relevant company source may support this supplier paraphrase; semantic support, conditions and scope are not yet verified.'} : { supported: false, reason: supplierApplicationClaim(text)?'This product application or customer-use capability is absent from original company evidence. Buyer industry, a possible-fit hypothesis, and an earlier rep claim cannot establish it.':'Supplier capability, policy, certification, stock, or superiority needs explicit company evidence.' });
    }
  }
  // A retrieved source relationship is ordinarily pending semantic checking.
  // Promote it only when a closed grammar proves this entire clause from an
  // original source. Never override a hard conflict or infer an extra predicate
  // from a correct number/product name elsewhere in the reply.
  const localEvidence:{sourceId:string;quote:string;claim:string}[]=[];
  const addLocalEvidence=(item:typeof localEvidence[number])=>{
    const key=(quote:string)=>quote.trim().replace(/\s+/g,' ');
    const existing=localEvidence.find(entry=>entry.sourceId===item.sourceId&&key(entry.quote)===key(item.quote));
    if(!existing)localEvidence.push(item);
    else if(!existing.claim.includes(item.claim))existing.claim+='\n'+item.claim;
  };
  const parts=replyClauses(say,context);
  const provenParts=new Set<number>();
  let previousDocument:ReturnType<typeof literalDocumentStatementEvidence>;
  for(const sentence of sentences(say)){
    const proof=literalDocumentStatementEvidence(sentence.text,context,evidence.filter(item=>item.original!==false),previousDocument);
    previousDocument=proof;
    if(!proof)continue;
    for(const part of parts.filter(part=>part.start>=sentence.start&&part.end<=sentence.end))provenParts.add(part.start);
    for(const entry of proof.evidence||[proof])addLocalEvidence({sourceId:entry.sourceId,quote:entry.quote,claim:sentence.text.trim()});
    // A discourse “Yes,” belongs to its actual report sentence. Do not leave
    // it pending separately after proving every predicate in that sentence.
    // Hard conflicts, authorization failures and unknown adjoining sentences
    // remain untouched and prevent whole-reply proof below.
    for(const claim of claims)if(claim.pending&&claim.start>=sentence.start&&claim.end<=sentence.end){
      claim.supported=true;claim.pending=false;claim.sourceId=proof.sourceId;delete claim.candidateSourceIds;claim.reason=proof.reason;
    }
  }
  for(const part of parts){
    const specification=literalSpecificationEvidence(part.text,evidence.filter(item=>item.original!==false));
    const document=literalDocumentScopeEvidence(part.text,context,evidence.filter(item=>item.original!==false));
    const sourceId=specification?.id||document?.sourceId;
    if(!sourceId)continue;
    provenParts.add(part.start);
    const proofSources=document?.evidence||[{sourceId,quote:evidence.find(item=>item.original!==false&&item.id===sourceId)!.text}];
    for(const proof of proofSources)addLocalEvidence({sourceId:proof.sourceId,quote:proof.quote,claim:part.text.trim()});
    for(const claim of claims)if(claim.pending&&claim.start===part.start&&claim.end===part.end){
      claim.supported=true;claim.pending=false;claim.sourceId=sourceId;delete claim.candidateSourceIds;
      claim.reason=specification?'The entire literal specification assertion is entailed by this current original source.':document!.reason;
    }
  }
  const unsupportedClaims = claims.filter(claim => !claim.supported && !claim.pending);
  const pendingClaims = claims.filter(claim => claim.pending);
  const supportedClaims = claims.filter(claim => claim.supported);
  const locallyVerifiedWholeReply=localEvidence.length>0&&!unsupportedClaims.length&&!pendingClaims.length&&parts.every(part=>provenParts.has(part.start)||isNonAssertiveReply(part.text,claims.filter(claim=>claim.start>=part.start&&claim.end<=part.end).map(claim=>({...claim,start:claim.start-part.start,end:claim.end-part.start})),context));
  const fabricatedCompletion=unsupportedClaims.some(claim=>/prior promise to send does not establish completion|No reply is not approval/i.test(claim.reason));
  const fabricatedApproval=unsupportedClaims.some(claim=>/approval cannot be asserted from company knowledge/i.test(claim.reason));
  // A closing question premised on an unauthorized approval cannot survive as
  // if that approval happened. Keep the required approval message in the final
  // guidance instead of merely cutting the false first sentence.
  let sanitizedReply = fabricatedCompletion ? clientContextSafeReply(context)||"Let me check the send status before I tell you it's gone out." : fabricatedApproval ? configuredSafeReply(context)||safeMove(classification) : classification.kind === 'fact_request' ? say : removeUnsupportedClauses(say, claims, classification);
  if(context.coachingRequest&&unsupportedClaims.some(claim=>claim.reason.startsWith('This technical method'))&&sanitizedReply===safeMove(classification))sanitizedReply="I'll check the technical information before I confirm that detail.";
  if (classification.kind === 'confirmation') {
    // Closing a delivery commitment does not depend on re-verifying documents already offered.
    sanitizedReply = sanitizedReply
      .replace(/\b(?:once|after|when)\s+(?:(?:it|they|that|those|the\s+(?:details|information|specs))\s+(?:is|are|has\s+been|have\s+been)\s+)?(?:verified|checked|confirmed)(?:\s+(?:with|by)\s+(?:our\s+)?(?:team|factory))?\s*,?\s*/gi, '')
      .replace(/\b(?:once|after)\s+(?:I|we)\s+(?:verify|check|confirm)\s+(?:it|them|that|those|the\s+(?:details|information|specs))(?:\s+with\s+(?:our\s+)?(?:team|factory))?\s*,?\s*/gi, '')
      .replace(/\s+([,.!?])/g, '$1').trim();
    if (sanitizedReply) sanitizedReply = sanitizedReply[0].toUpperCase() + sanitizedReply.slice(1);
  }
  const assertedRemainder=replyClauses(say,context).filter(part=>!unresolvedFactCheck(part.text,context)&&!conversationalClause(part.text,context)).map(part=>part.text).join(' ');
  const checkAndExistingDocuments=isBoundedFactCheckReply(say,claims,context)&&claims.every(claim=>claim.supported&&(claim.kind==='product_identity'||claim.kind==='supplier_claim'&&claim.reason===AVAILABLE_DOCUMENT_ACTION));
  return { classification, claims, unsupportedClaims, supportedClaims, pendingClaims, locallyVerifiedWholeReply, localEvidence, requiresVerification: !locallyVerifiedWholeReply&&(pendingClaims.length>0 || (classification.kind === 'fact_request' ? !checkAndExistingDocuments&&(claims.length > 0 || /\b(?:yes|correct|we\s+do|we\s+can|it\s+is|we\s+offer|we\s+supply)\b/i.test(assertedRemainder)) : unsupportedClaims.length > 0)), sanitizedReply, changed: sanitizedReply !== say };
}

export function sanitizeSalesReply(say: string, context: VerificationPolicyContext): ReplyVerificationAssessment {
  return assessReplyVerification(say, context);
}
