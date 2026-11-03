import type { Manufacturer, CallRecord, Turn } from './trade';
import type { SuggestionRecord } from './phase1-types';
import { deriveConversationState, type ConversationState } from './conversation-state.ts';
import {defaultGeneralFoundation,normalizeGeneralFoundation,normalizedSharedProvenance,isProductApproved,type SharedGuidanceProvenance,type GeneralFoundation} from './general-foundation.ts';

export const GOLDEN_WHY_TAGS = ['stage regression', 'missed commitment', 'ignored info', 'generic question', 'other'] as const;
export type GoldenWhyTag = typeof GOLDEN_WHY_TAGS[number];
export const MAX_GOLDEN_EXPLANATION_LENGTH = 2000;
export const MAX_GENERAL_PATTERN_LENGTH = 600;
export type GoldenMomentFeedback = { learningExplanation: string; why?: GoldenWhyTag };
export type GoldenPatternReview = { template: string };
export type GeneralMomentType = 'interest_narrowed';
export const INTEREST_NARROWED_TEMPLATE = 'Okay, {selected_item}—{relevant_value} {useful_next_action}';
const PREVIOUS_INTEREST_NARROWED_TEMPLATE = 'Okay, {selected_item}—I can send the {item_documents} for you to review. {email_action}';
const LEGACY_INTEREST_NARROWED_TEMPLATE = 'Okay, {selected_item}. I can send the {item_documents} for you to review. {email_action}';
export const GENERAL_PLAYBOOK_RULES = 'Classify the current buyer objective, retrieve a flexible General Playbook move, then ground it in current-company facts and actual conversation. Product interest means confirm the relevant item and continue useful selling: explain a supported fit, answer, clarify one requirement, or propose an optional evaluation. Documents and email are not compulsory and interest alone is not permission to send. A new objection, question, correction or refusal takes conversational priority over a remembered send; preserve the commitment to resume only when appropriate. Diagnose incumbent concerns without assuming dissatisfaction; a comparison or evaluation may help, but sample + report + quote is not a required bundle. Negotiate only within explicit authority and respect clear refusals. On an agreed email close, confirm the actual agreed materials and address without verification language. General expertise and examples establish no company facts, specifications, price, terms, availability, approval or timing. Reusing an already-spoken product identity does not authorize its technical claims. Manager lessons refine the response when relevant, never override buyer boundaries or factual accuracy.';
const INTEREST_STEPS = ['confirm_selected_item', 'explain_relevant_offer', 'choose_useful_next_move'] as const;
const LEGACY_INTEREST_STEPS = ['confirm_selected_item', 'offer_item_documents', 'capture_missing_email'] as const;
const PATTERN_SLOTS = ['selected_item', 'item_documents', 'email_action', 'relevant_value', 'useful_next_action'] as const;
// Shared wording is intentionally limited to conversational language. Concrete
// identities, claims and terms belong in current-company bindings, never here.
const GENERAL_PATTERN_WORDS = new Set(('fit fits requirement requirements application process evaluate evaluation evaluate criteria discuss compare comparison option options consider considering current supplier incumbent concern concerns constraint understand clarify relevant support supported documented useful step question answer interested interest selected choosing assess assessment basis before without if only optional permission helpful priority matters for you a about absolutely after also and appreciate as at be before both can certainly choice choices compare comparison could detail details do does for from glad good got great happy hear help helpful helps here how i if in information interest interested interests into it its let lets like look looks makes me more my need next nice of offer okay ok on options or our over perfect please prefer provide reaction relevant review see selected send share so sounds specs sure take thank thanks that the their them then there these this through to together understand useful us want we well what when which with wonderful work would yeah yes you your').split(' '));

/** Editable wording may change the tone, but may not carry facts across companies. */
export function generalPatternTemplateIssue(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return 'Write a general pattern, or leave sharing off to save only the company moment.';
  const template = value.trim();
  if (template.length > MAX_GENERAL_PATTERN_LENGTH) return `Keep the general pattern within ${MAX_GENERAL_PATTERN_LENGTH} characters.`;
  if (template.split('{selected_item}').length !== 2) return 'Keep {selected_item} exactly once so the copilot can fill it from the current company and call.';
  for (const slot of PATTERN_SLOTS) if (template.split(`{${slot}}`).length > 2) return `Use {${slot}} at most once.`;
  const prose = template.replace(/\{(?:selected_item|item_documents|email_action|relevant_value|useful_next_action)\}/g, ' ');
  if (!/^[a-z\s.,!?;:'"“”‘’()—–-]*$/i.test(prose)) return 'Use placeholders for names, products and facts; remove numbers, addresses, links and extra placeholders.';
  const words = prose.toLowerCase().replace(/[’‘]/g, "'").replace(/\b(?:i|we|you|they|it|that|there)'(?:m|re|ll|d|ve|s)\b/g, match => match.split("'")[0]).match(/[a-z]+/g) || [];
  if (words.some(word => !GENERAL_PATTERN_WORDS.has(word))) return 'Keep shared wording conversational and fact-free. Put company wording in the rep override; use placeholders for the selected item, supported value and appropriate next action.';
  return null;
}

function reviewPatternId(template: string): string {
  let hash = 2166136261;
  for (const character of template) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return `interest-narrowed-review-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}
export const isInterestNarrowedPatternId = (id: string) => id === 'interest-narrowed-v1' || /^interest-narrowed-review-[a-f0-9]{8}$/.test(id);
export type GeneralPattern = {
  id: string; name: string; momentType: GeneralMomentType; template: string;
  steps: (typeof INTEREST_STEPS[number] | typeof LEGACY_INTEREST_STEPS[number])[]; confirmedAt: number; updatedAt: number;
  origin: 'seed' | 'review'; reviewCount: number; provenance?:SharedGuidanceProvenance; active?:boolean;
};
export type GeneralPlaybookRecord = { version: 1; updatedAt: number; patterns: GeneralPattern[]; historicalPatterns?:GeneralPattern[]; foundation?: GeneralFoundation };
export type GoldenMomentSnapshot = {
  id: string; companyId: string; callId: string; suggestionId: string;
  buyerLine: string; previousContext: Pick<Turn, 'id' | 'role' | 'text' | 'at'>[];
  stageId: string; momentType: string; copilotSuggestion: string; repOverride: string;
  timestamp: number; feedbackAt?: number;
  learningStageId?: string; learningMoment?: string;
  provenance?: 'call_review' | 'user_provided_retrospective'; timestampKnown?: boolean; importedAt?: number;
};
export type GoldenMoment = GoldenMomentSnapshot & { why?: GoldenWhyTag; learningExplanation?: string; generalPatternId: string; generalPatternConfirmedAt: number };
export type PatternEvidence = { companyId: string; sourceId: string; quote: string; scope?: 'identity_only' };
export type GeneralMomentDetection = {
  momentType: GeneralMomentType; selectedItem: string; buyerTurnId: string;
  buyerQuote: string; evidence: PatternEvidence[];
};
export type GeneralPlaybookRequest = {
  companyId: string; momentType: GeneralMomentType; patternId: string;
  template: string; steps: GeneralPattern['steps']; selectedItem: string;
  bindings: { selected_item: string; item_documents: string; email_action: string; relevant_value: string; useful_next_action: string };
  boundExample: string; emailKnown: boolean; evidence: PatternEvidence[]; consentToSend?: boolean; exampleRole?: 'illustrative';
};
type PlaybookInput = { company: Manufacturer; state: ConversationState; turns: Pick<Turn, 'id' | 'role' | 'text' | 'at'>[] };

/** Default shared guidance contains abstract patterns and no company records. */
export function defaultGeneralPlaybook(now = Date.now()): GeneralPlaybookRecord {
  return { version: 1, updatedAt: now, foundation: defaultGeneralFoundation(), historicalPatterns:[], patterns: [{
    id: 'interest-narrowed-v1', name: 'Interest-Narrowed',
    momentType: 'interest_narrowed', template: INTEREST_NARROWED_TEMPLATE,
    steps: [...INTEREST_STEPS], confirmedAt: now, updatedAt: now, origin: 'seed', reviewCount: 0,
  }] };
}

/** Revisions retain older patterns; only validated placeholder wording is shared. */
export function isSafeGeneralPattern(value: unknown): value is GeneralPattern {
  if (!value || typeof value !== 'object') return false;
  const pattern = value as GeneralPattern;
  return typeof pattern.template === 'string' && (pattern.id === 'interest-narrowed-v1' ? ['F2000 Interest-Narrowed','Interest-Narrowed'].includes(pattern.name) && [INTEREST_NARROWED_TEMPLATE,PREVIOUS_INTEREST_NARROWED_TEMPLATE,LEGACY_INTEREST_NARROWED_TEMPLATE].includes(pattern.template) : pattern.id === reviewPatternId(pattern.template) && pattern.name === 'Interest-Narrowed') &&
    pattern.momentType === 'interest_narrowed' && generalPatternTemplateIssue(pattern.template) === null &&
    Array.isArray(pattern.steps) && [INTEREST_STEPS, LEGACY_INTEREST_STEPS].some(steps => pattern.steps.length === steps.length && pattern.steps.every((step, index) => step === steps[index])) &&
    Number.isFinite(pattern.confirmedAt) && pattern.confirmedAt > 0 && Number.isFinite(pattern.updatedAt) &&
    ['seed', 'review'].includes(pattern.origin) && Number.isInteger(pattern.reviewCount) && pattern.reviewCount >= 0;
}

/** Explicitly project allowed fields: extra/raw company fields from storage are discarded. */
export function normalizeGeneralPlaybook(value: unknown): GeneralPlaybookRecord {
  if (!value || typeof value !== 'object' || !Array.isArray((value as GeneralPlaybookRecord).patterns)) return defaultGeneralPlaybook();
  const raw = value as GeneralPlaybookRecord;
  const records = [...raw.patterns,...(Array.isArray(raw.historicalPatterns)?raw.historicalPatterns:[])].filter(isSafeGeneralPattern).map(pattern => ({
    id: pattern.id, name: pattern.name, momentType: pattern.momentType, template: pattern.template,
    steps: [...pattern.steps], confirmedAt: pattern.confirmedAt, updatedAt: pattern.updatedAt,
    origin: pattern.origin, reviewCount: pattern.reviewCount,
    ...(pattern.origin==='review'?{provenance:normalizedSharedProvenance(pattern.provenance),active:isProductApproved(pattern.provenance)}:{}),
  })).filter((pattern,index,all)=>all.findIndex(other=>other.id===pattern.id&&other.template===pattern.template&&other.updatedAt===pattern.updatedAt)===index);
  // Product seeds come from code. Store prior seeds and customer-reviewed patterns
  // as history, never silently reinterpret customer consent as product curation.
  const curated=records.filter(pattern=>pattern.origin==='review'&&pattern.active);
  const historicalPatterns=records.filter(pattern=>pattern.origin==='review'&&!pattern.active||pattern.origin==='seed'&&(pattern.template!==INTEREST_NARROWED_TEMPLATE||pattern.reviewCount>0));
  const timestamp=Number.isFinite(raw.updatedAt)&&raw.updatedAt>0?raw.updatedAt:1;
  const sourceSeed=records.find(pattern=>pattern.origin==='seed'&&pattern.template===INTEREST_NARROWED_TEMPLATE&&pattern.reviewCount===0);
  return {version:1,updatedAt:timestamp,foundation:normalizeGeneralFoundation(raw.foundation),patterns:[...defaultGeneralPlaybook(sourceSeed?.confirmedAt||timestamp).patterns,...curated],historicalPatterns};
}

/** Rebuild bindings server-side without discarding an explicitly reviewed template. */
export function generalPlaybookFromReference(reference?: { patternId: string; template?: string } | null): GeneralPlaybookRecord {
  void reference;
  // A customer/browser reference contains no product-owner approval. Historical
  // wording remains in its company example; shared generation uses code defaults.
  return defaultGeneralPlaybook();
}

export function isSafeGeneralPatternReference(reference: {patternId:string;template?:string}): boolean {
  return reference.patternId === 'interest-narrowed-v1'
    ? reference.template === undefined || [INTEREST_NARROWED_TEMPLATE, PREVIOUS_INTEREST_NARROWED_TEMPLATE, LEGACY_INTEREST_NARROWED_TEMPLATE].includes(reference.template)
    : typeof reference.template === 'string' && !generalPatternTemplateIssue(reference.template) && reference.patternId === reviewPatternId(reference.template.trim());
}

export function createGoldenMomentSnapshot(call: CallRecord, suggestion: SuggestionRecord, company?: Manufacturer): GoldenMomentSnapshot {
  if (!call.suggestions?.some(item => item.id === suggestion.id)) throw new Error('Suggestion does not belong to this call.');
  if (company && company.id !== call.manufacturerId) throw new Error('Call belongs to a different company.');
  if (suggestion.learningCapture && suggestion.learningCapture.companyId !== call.manufacturerId) throw new Error('Suggestion belongs to a different company.');
  const pair = company?.brain?.companyId === call.manufacturerId ? company.brain.learning.find(item => item.companyId === call.manufacturerId && item.suggestionId === suggestion.id) : undefined;
  const trigger = call.turns.findIndex(turn => turn.id === suggestion.triggerTurnId && turn.role === 'buyer');
  const window = suggestion.learningCapture?.buyerWindow || [];
  const capturedBuyer = [...window].reverse().find(turn => turn.role === 'buyer');
  const at = trigger >= 0 ? trigger : call.turns.findLastIndex(turn => turn.role === 'buyer' && turn.at <= suggestion.at);
  const buyer = at >= 0 ? call.turns[at] : capturedBuyer;
  const previousContext = at >= 0 ? call.turns.slice(Math.max(0, at - 12), at) : window.slice(0, capturedBuyer ? window.indexOf(capturedBuyer) : 0);
  // Retrieval needs the state at this buyer turn, not a later call stage or a
  // human-readable reply label. Old calls can derive it from their transcript.
  const learningState = pair?.state || suggestion.learningCapture?.state || deriveConversationState({ callId: call.id, turns: at >= 0 ? call.turns.slice(0, at + 1) : window, callContext: call.callContext, stageMap: call.stageMapSnapshot || company?.brain?.playbook?.stages });
  return {
    id: `${call.manufacturerId}:${call.id}:${suggestion.id}`, companyId: call.manufacturerId,
    callId: call.id, suggestionId: suggestion.id, buyerLine: buyer?.text || suggestion.buyerQuote || '',
    previousContext: previousContext.map(({ id, role, text, at }) => ({ id, role, text, at })),
    stageId: suggestion.learningCapture?.stageId || suggestion.guidance.stageId || call.callContext?.stageId || '',
    momentType: suggestion.learningCapture?.moment || suggestion.guidance.moment || 'general',
    learningStageId: learningState.stageId, learningMoment: learningState.moment,
    copilotSuggestion: pair?.suggested || suggestion.originalSay || suggestion.guidance.say,
    repOverride: pair?.verdict === 'Edited' ? pair.actual : suggestion.status === 'edited' ? suggestion.guidance.say : '',
    timestamp: suggestion.at,
    provenance: 'call_review', timestampKnown: true,
    ...(pair?.feedbackAt || suggestion.feedbackAt || suggestion.editedAt ? { feedbackAt: pair?.feedbackAt || suggestion.feedbackAt || suggestion.editedAt } : {}),
  };
}

/** The confirmation authorizes a reusable process, never copies the source transcript. */
export function confirmGoldenMoment(snapshot: GoldenMomentSnapshot, feedback: GoldenMomentFeedback, confirmed: boolean, playbook: GeneralPlaybookRecord, now = Date.now(), company?: Manufacturer, review?: GoldenPatternReview): { goldenMoment: GoldenMoment; playbook: GeneralPlaybookRecord } {
  const learningExplanation = typeof feedback?.learningExplanation === 'string' ? feedback.learningExplanation.trim() : '';
  if (!learningExplanation) throw new Error('Explain what the copilot should learn from this moment.');
  if (learningExplanation.length > MAX_GOLDEN_EXPLANATION_LENGTH) throw new Error(`Keep your explanation within ${MAX_GOLDEN_EXPLANATION_LENGTH} characters.`);
  if (feedback.why !== undefined && !GOLDEN_WHY_TAGS.includes(feedback.why)) throw new Error('Choose a valid optional category.');
  const lesson = { learningExplanation, ...(feedback.why ? { why: feedback.why } : {}) };
  if (company && snapshot.companyId !== company.id) throw new Error('Golden Moment belongs to a different company.');
  const current = normalizeGeneralPlaybook(playbook);
  const draft = company ? draftGeneralPattern(snapshot, company) : snapshot.momentType === 'interest_narrowed' ? defaultGeneralPlaybook(now).patterns[0] : null;
  if (!draft || !confirmed) return { goldenMoment: { ...structuredClone(snapshot), ...lesson, ...(draft ? { momentType: draft.momentType } : {}), generalPatternId: '', generalPatternConfirmedAt: 0 }, playbook: current };
  const template = (review?.template ?? retrieveGeneralPattern(current, draft.momentType)?.template ?? draft.template).trim();
  const issue = generalPatternTemplateIssue(template); if (issue) throw new Error(issue);
  const id = template === INTEREST_NARROWED_TEMPLATE ? draft.id : reviewPatternId(template);
  const previous = current.historicalPatterns?.findLast(item=>item.id===id)||current.patterns.find(item => item.id === id);
  const pattern: GeneralPattern = { ...(previous || draft),provenance:{origin:'company_feedback',companyId:snapshot.companyId},active:false, id, name: id === draft.id ? draft.name : 'Interest-Narrowed', template, origin: 'review', confirmedAt: previous?.confirmedAt || now, updatedAt: now, reviewCount: (previous?.reviewCount || 0) + 1 };
  return {
    goldenMoment: { ...structuredClone(snapshot), ...lesson, momentType: draft.momentType, generalPatternId: pattern.id, generalPatternConfirmedAt: now },
    playbook: normalizeGeneralPlaybook({ ...current, updatedAt: now, historicalPatterns:[...(current.historicalPatterns||[]).filter(item=>item.id!==pattern.id),pattern] }),
  };
}

const norm = (value: string) => value.toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim();
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const stopped = new Set('a an the i we you me us it this that these those our your is are am be was were to of on in for with and or but not no only just please send share email information info product products profile company documents specs specification specifications interested interest need want like would could can will have take look at okay yes yeah one model'.split(' '));
function sourceItemFor(line: string, company: Manufacturer, actualOffers: Pick<Turn, 'id' | 'role' | 'text'>[] = []) {
  const sources: { id: string; text: string; identityOnly?: boolean }[] = [
    ...(company.introduction ? [{ id: 'company-profile', text: company.introduction }] : []),
    ...company.sources.map(source => ({ id: source.id, text: source.text })),
    // A source from actual speech establishes identity only. It is never added
    // to Company Knowledge or reused as support for specifications or terms.
    ...actualOffers.filter(turn => turn.role === 'you').flatMap(turn => turn.text.split(/(?<=[.!?])\s+/).filter(clause =>
      /\b(?:(?:we|I)\s+(?:can\s+)?(?:offer|supply|carry|sell|provide|make|manufacture)|our\s+(?:products?|grades?|models?)\s+(?:include|are))\b/i.test(clause) &&
      !/\?|\b(?:not|never|don't|do not|can't|cannot|no longer|unsure|unconfirmed|need to check|need to confirm)\b/i.test(clause)
    ).map(text => ({ id: `current-call-rep:${turn.id}`, text, identityOnly: true }))),
  ];
  const words = (line.match(/[\p{L}\p{N}][\p{L}\p{N}+._-]*/gu) || []).map(word => word.replace(/[._-]+$/, '')).filter(Boolean);
  const matches: { item: string; sourceId: string; quote: string; score: number; identityOnly?: boolean }[] = [];
  for (let start = 0; start < words.length; start++) {
    for (let length = 1; length <= Math.min(5, words.length - start); length++) {
      const tokens = words.slice(start, start + length), item = tokens.join(' ');
      if (tokens.some(token => stopped.has(norm(token))) || item.length < 2 || item.length > 90) continue;
      const model = /[\p{L}].*\d|\d.*[\p{L}]/u.test(item), named = tokens.some(token => /^[A-Z][a-z]{2,}$/.test(token) || /^[A-Z]{2,}$/.test(token));
      if (!model && !named && length < 2) continue;
      const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${escape(item).replace(/ /g, '\\s+')}(?![\\p{L}\\p{N}])`, 'iu');
      for (const source of sources) {
        const found = source.text.match(pattern); if (!found) continue;
        const index = found.index || 0;
        matches.push({ item: found[0].replace(/\s+/g, ' '), sourceId: source.id, quote: source.identityOnly ? found[0] : source.text.slice(Math.max(0, index - 80), Math.min(source.text.length, index + found[0].length + 100)), score: (model ? 100 : named ? 30 : 0) + length * 5, ...(source.identityOnly ? { identityOnly: true } : {}) });
        break;
      }
    }
  }
  return matches.sort((a, b) => b.score - a.score)[0];
}

/** Selection uses current-contact speech and this company's documents or actual rep offers. */
export function detectGeneralMoment({ company, state, turns }: PlaybookInput): GeneralMomentDetection | null {
  const segment = state.participant?.afterTransfer && state.participant.segmentStartTurnId ? turns.findIndex(turn => turn.id === state.participant.segmentStartTurnId) : -1;
  const current = segment >= 0 ? turns.slice(segment) : turns;
  const last = [...current].reverse().find(turn => turn.role === 'buyer'); if (!last) return null;
  const line = norm(last.text);
  if (/\b(?:not interested|don't need|do not need|don't want|do not want|no thanks|not (?:the |that )?(?:one|model|grade)|if we|if i|hypothetically|suppose)\b/.test(line)) return null;
  const selecting = /\b(?:interested in|focus on|looking (?:for|at)|we need|i need|we want|i want|prefer|choose|chosen|picked|select|only|just|would like|i'd like|we'd like)\b/.test(line);
  const docs = /\b(?:send|share|email|show)\b.{0,90}\b(?:info\w*|spec\w*|docs?|documents?|details|brochure|profile|data|catalog\w*)\b/.test(line);
  const shortSelection = (last.text.match(/\S+/g)?.length || 0) <= 5 && !last.text.includes('?');
  const previousRep = current.slice(0, current.indexOf(last)).findLast(turn => turn.role === 'you');
  const answeringChoice = !!previousRep && /\b(?:which|what)\b.{0,70}\b(?:grades?|models?|items?|products?|one|interested)\b/i.test(previousRep.text) && !last.text.includes('?');
  if (!selecting && !docs && !shortSelection && !answeringChoice) return null;
  // An item mention in a technical/price question is not consent to a documents handoff.
  if (!docs && /\b(?:what|how|why|when|can you confirm|could you confirm)\b/.test(line) && /\?|\b(?:purity|content|price|CIF|FOB|MOQ|lead time|certif\w*)\b/i.test(last.text)) return null;
  const selectionText = last.text.split(/[,;]|\.(?=\s)/).filter(clause => !/\b(?:further (?:market )?research|need (?:to )?(?:research|check|think)|not sure|haven't decided|have not decided|still (?:researching|considering)|maybe|possibly|if we|if i)\b/i.test(clause)).join(', ');
  const actualOffers = current.slice(0, current.indexOf(last));
  let selected = sourceItemFor(selectionText, company, actualOffers);
  if (!selected && docs) {
    const earlier = current.slice(0, current.indexOf(last)).filter(turn => turn.role === 'buyer').slice(-4).reverse();
    for (const prior of earlier) {
      if (/\b(?:not interested|don't need|do not need|don't want|do not want|no thanks|if we|if i)\b/.test(norm(prior.text))) continue;
      if (!/\b(?:interested in|focus on|looking (?:for|at)|we need|i need|we want|i want|prefer|choose|chosen|picked|select|only|just|would like|i'd like|we'd like)\b/.test(norm(prior.text))) continue;
      selected = sourceItemFor(prior.text, company, actualOffers); if (selected) break;
    }
  }
  if (!selected) return null;
  return { momentType: 'interest_narrowed', selectedItem: selected.item, buyerTurnId: last.id, buyerQuote: last.text, evidence: [{ companyId: company.id, sourceId: selected.sourceId, quote: selected.quote, ...(selected.identityOnly ? { scope: 'identity_only' as const } : {}) }] };
}

/** Only this v1 supported moment is generalized; other reviews remain company-only. */
export function draftGeneralPattern(snapshot: GoldenMomentSnapshot, company: Manufacturer): GeneralPattern | null {
  if (company.id !== snapshot.companyId) return null;
  const turns = [...snapshot.previousContext, { id: `golden-buyer:${snapshot.id}`, role: 'buyer' as const, text: snapshot.buyerLine, at: snapshot.timestamp }];
  const state = { facts: {}, participant: {} } as ConversationState;
  return detectGeneralMoment({ company, state, turns }) ? defaultGeneralPlaybook().patterns[0] : null;
}

export function retrieveGeneralPattern(playbook: GeneralPlaybookRecord, momentType: GeneralMomentType): GeneralPattern | undefined {
  return normalizeGeneralPlaybook(playbook).patterns.filter(pattern => pattern.momentType === momentType&&(pattern.origin==='seed'||isProductApproved(pattern.provenance))).reverse().sort((a,b)=>b.updatedAt-a.updatedAt)[0];
}

/** Document labels describe material actually present for this company, not an industry default. */
function documentsFor(company: Manufacturer, selectedItem: string): { label: string; evidence: PatternEvidence[] } {
  const sources = [
    ...(company.introduction ? [{ id: 'company-profile', title: 'Company profile', text: company.introduction }] : []),
    ...company.sources,
  ];
  const mentionsItem = new RegExp(`(?<![\\p{L}\\p{N}])${escape(selectedItem).replace(/ /g, '\\s+')}(?![\\p{L}\\p{N}])`, 'iu');
  const relevant = sources.filter(source => mentionsItem.test(source.text));
  const profile = sources.find(source => /\b(?:company profile|company introduction|corporate profile)\b/i.test(source.title.replace(/[-_]+/g," ")));
  const specs = relevant.find(source => /\b(?:specifications?|specs?|technical (?:data|sheet)|grades?|FEPA|purity|Al[₂2]?O[₃3]?)\b/i.test(`${source.title} ${source.text}`));
  const brochure = relevant.find(source => /\b(?:brochures?|catalog(?:ue)?s?)\b/i.test(`${source.title} ${source.text}`));
  const evidenceFor = (source: typeof sources[number]): PatternEvidence => ({ companyId: company.id, sourceId: source.id, quote: source.text.slice(0, 220) });
  if (specs) return { label: profile ? 'company profile and product specs' : 'product specs', evidence: [...(profile ? [evidenceFor(profile)] : []), evidenceFor(specs)] };
  if (brochure) return { label: /\b(?:vehicle|car|dealership|automotive|model)\b/i.test(`${company.products} ${brochure.title} ${brochure.text}`) ? 'model brochure' : 'product brochure', evidence: [evidenceFor(brochure)] };
  return { label: 'product information', evidence: [] };
}

/** Detect → retrieve → bind. The returned concrete example is request-local, never persisted globally. */
export function buildGeneralPlaybookRequest(playbook: GeneralPlaybookRecord, input: PlaybookInput): GeneralPlaybookRequest | null {
  const detected = detectGeneralMoment(input); if (!detected) return null;
  const pattern = retrieveGeneralPattern(playbook, detected.momentType); if (!pattern) return null;
  const emailKnown = !!input.state.facts.email?.value;
  const documents = documentsFor(input.company, detected.selectedItem);
  const consentToSend = input.state.commitments.some(item => item.id === 'send_materials' && !['cancelled','fulfilled'].includes(item.status));
  const relevantValue = consentToSend ? `I can send the ${documents.label} for review.` : 'we can discuss how it fits your requirements.';
  const applicationKnown = !!input.state.buyerNeeds?.facts.application;
  const usefulNextAction = consentToSend ? (emailKnown ? '' : 'What would be a good email for that?') : applicationKnown ? 'What would you need to see to evaluate its fit?' : 'What application are you considering it for?';
  const bindings = { selected_item: detected.selectedItem, item_documents: documents.label, email_action: consentToSend && !emailKnown ? 'What would be a great email for me to reach you?' : '', relevant_value: relevantValue, useful_next_action: usefulNextAction };
  const evidence = [...detected.evidence, ...documents.evidence].filter((item, index, all) => all.findIndex(other => other.sourceId === item.sourceId && other.quote === item.quote) === index);
  return { companyId: input.company.id, momentType: detected.momentType, patternId: pattern.id, template: pattern.template, steps: [...pattern.steps], selectedItem: detected.selectedItem, bindings, boundExample: pattern.template.replace(/\{(selected_item|item_documents|email_action|relevant_value|useful_next_action)\}/g, (_whole, key: keyof typeof bindings) => bindings[key]).trim(), emailKnown, evidence, consentToSend, exampleRole: 'illustrative' };
}
