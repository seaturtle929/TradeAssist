import {clientContextNeedsInterpretation} from './client-coaching-context.ts';
import {configurationNeedsInterpretation} from './coaching-configuration.ts';
import { type CoachingContext, containsAvoidedPhrase, hasWrittenLearningLesson, unapprovedResponseDeadline } from './call-coaching.ts';
import { checkSuggestion, normalizeStageMap } from './call-purpose.ts';
import { buyerQuestionAgendaFor, substantiveBuyerQuestions } from './buyer-turn-intent.ts';
import { commitmentReply, deriveConversationState } from './conversation-state.ts';
import { assessReplyVerification, classifyBuyerTurn } from './turn-verification-policy.ts';
import type { Guidance } from './trade';

export type ImmediateSalesReply = {
  guidance: Guidance;
  moment: 'document_confirmation';
  source: 'conversation_state';
  reason: string;
};
type ImmediateContext = CoachingContext & { manufacturer?: { id?: string; name?: string; products?: string }; recentReplies?: string[] };

/** A lesson or manager-authored style needs interpretation. A local delivery
 * confirmation must not bypass that guidance or borrow historical agreement. */
function needsLessonInterpretation(context: ImmediateContext) {
  if (configurationNeedsInterpretation(context)||clientContextNeedsInterpretation(context)||hasWrittenLearningLesson(context)) return true;
  const voice = context.voice as { notes?: string; examples?: string[] } | undefined;
  if (voice?.notes?.trim() || voice?.examples?.some(example => example.trim())) return true;
  return context.brain?.learningExamples.some(example =>
    example.source === 'override' ||
    (example.source === 'golden' && example.id !== 'golden-agreed-profile-review-prices' && !!example.positive?.trim())
  ) || false;
}

/** Local replies are for a completed, explicit conversational decision only.
 * Selecting a product is not consent to a document/email close. An incumbent
 * objection is not consent to a sample/test/quote sequence. Those sales choices
 * use the existing model path and the same foundation/guardrails as any reply. */
export function immediateSalesReplyFor(context: ImmediateContext): ImmediateSalesReply | null {
  if (!context.callContext || !context.callId || !context.manufacturer?.name || needsLessonInterpretation(context)) return null;
  const companyId = context.manufacturer.id;
  if (context.brain && (!companyId || context.brain.companyId !== companyId)) return null;
  if (context.generalPlaybook && (!companyId || context.generalPlaybook.companyId !== companyId)) return null;
  const latest = context.turns?.at(-1);
  if (latest?.role !== 'buyer' || !latest.text.trim() || (latest.text.match(/\S+/g)?.length || 0) > 65) return null;
  if (classifyBuyerTurn(context).kind !== 'confirmation' || substantiveBuyerQuestions(context).length) return null;
  const state = deriveConversationState({ ...context, stageMap: normalizeStageMap(context.stageMap), buyerMemory: context.brain?.buyerMemory });
  if (state.participant.introductionNeeded || state.participant.transferPending || state.participant.role === 'routing') return null;
  if (state.nextAction.kind !== 'confirm_send') return null;
  // A received email cannot erase an unanswered question from the same call.
  if (buyerQuestionAgendaFor(context, latest).questions.some(question => question.turnId !== latest.id)) return null;
  const say = commitmentReply(state, 'Got it.') || '';
  if (!say || containsAvoidedPhrase(say, context.voice?.avoid || []) || unapprovedResponseDeadline(say, context)) return null;
  const assessment = assessReplyVerification(say, context);
  if (assessment.requiresVerification || assessment.changed || assessment.unsupportedClaims.length) return null;
  const reason = 'The current buyer supplied the destination for the current-call agreed materials, with no newer question or concern taking priority.';
  const guidance: Guidance = { say, ask: '', intent: context.bilingual ? '确认资料发送安排' : reason, nextStep: '', caution: '', evidence: [], missing: [], stageId: state.stageId, stage: context.bilingual ? '推进当前通话' : state.stageName || state.stageId, moment: context.bilingual ? '确认资料发送安排' : 'document_confirmation', move: context.bilingual ? '确认已约定的下一步' : 'Confirm the agreed next step', backup: '', why: context.bilingual ? '根据本次已约定的资料和地址完成确认。' : reason, buyerIntent: '', verified: true, phase: 'answer', analysisReady: true, questionEcho: latest.text };
  const checked = checkSuggestion(guidance, context);
  return checked.ok && !checked.needsVerification ? { guidance, moment: 'document_confirmation', source: 'conversation_state', reason } : null;
}
