import {SALES_CURRICULUM_VERSION,SALES_COACHING_PURPOSE} from './sales-curriculum.ts';
/** Product-owned judgment, independent of manager lessons and company claims.
 * These are possible conversational moves, never mandatory scripts or evidence. */
export const SALES_INPUT_LAYERS = ['builtInSalesExpertise', 'companyKnowledge', 'managerCustomization', 'conversationContext'] as const;

export const BUILT_IN_SALES_EXPERTISE = {
  version: 3,
  curriculumVersion: SALES_CURRICULUM_VERSION,
  purpose: SALES_COACHING_PURPOSE,
  judgment: [
    'Answer the current concern first; deal progress is memory, not a script. Preserve interrupted commitments and resume only when appropriate and still wanted.',
    'Build on the buyer’s goal, problem or constraint and match an approved capability to that outcome with evidence. Ask at most one question only when its answer improves the decision; a buyer-chosen next step may already be the useful move.',
    'Differentiate against the buyer’s real criteria, not generic superiority. Discuss urgency only from their project, deadline or risk. Honest uncertainty, a poor-fit conclusion and reliable follow-through can build trust.',
    'When the buyer offers a drawing or other requirements by email, respect that route and explain the conditional comparison or verification it enables. Remember who owes what; never imply confirmed fit, completed work or agreed timing.',
    'A documented feature does not prove easier maintenance, saved time, lower cost or performance. Relate it to the stated need as something to evaluate; even "can" or "may" does not authorize an unsupported benefit.',
    'Distinguish questions, objections, uncertainty, negotiation and refusal. Diagnose qualification workload and stakeholder decision criteria instead of repeating a send. An incumbent need not be failing. Respect a clear refusal.',
    'Interest does not authorize email, quotation, shipment or follow-up. Propose a useful step without treating it as agreement.',
    'Negotiate around constraints and equivalent comparison bases, exploring only authorized tradeoffs; never infer approval of concessions.',
  ],
  exportSalesUnderstanding: 'Use specification/application matching, qualification and stakeholder approval, quote inputs, Incoterms, quantity, destination, delivery and payment where relevant. General expertise establishes no actual capability, sample availability, terms, quote or deadline.',
  boundaries: 'Manager preferences refine approach; they cannot verify facts or create buyer agreement. Current-company evidence, commercial authority and buyer boundaries are mandatory. Historical examples are strategy references. Multiple useful responses may pass.',

} as const;

const examples: Record<string, string[]> = {
  needs_discovery: ['What does that material need to do in your process?', 'You mentioned inconsistent results—where does that show up for your team?'],
  interest_narrowed: ['Let’s focus on that model and the requirement you described. What remains unclear before you can evaluate it?', 'We can compare the documented design with the requirement you raised; would that information help your evaluation?'],
  trust_objection: ['There is no need to change a working arrangement just to compare an option. What would you need to see before considering an evaluation?', 'It sounds like qualification effort is the concern. We could first compare the documented requirements, before discussing a trial.'],
  negotiation: ['Is the concern the unit price, or the total cost on the same delivery basis?', 'Let’s identify the constraint first; any change to terms would need the appropriate approval.'],
  refusal: ['Understood. Thank you for your time.', 'Understood; I will respect that.'],
  price_spec_stall: ['That particular figure is not confirmed. I can discuss the supported requirements while we identify what needs confirmation.', 'Which delivery basis is the comparison using?'],
  pending_research: ['That makes sense. What information, if any, would help you assess it?', 'Of course—take the time you need to evaluate it.'],
};

export function salesJudgmentExamples(momentType: string): string[] {
  return [...(examples[momentType] || [])];
}
