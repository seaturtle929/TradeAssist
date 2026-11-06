import assert from 'node:assert/strict';
import test from 'node:test';
import {conversations, holdoutConversations, negativeControls, pairedControls} from '../scripts/regression/conversation-fixtures.mjs';
import {evaluateReply} from '../scripts/regression/evaluate-reply.mjs';

test('Authored suite is chronological, has distinct intentional presses and no answer rubric in company context', () => {
  const ids = [];
  for(const conversation of [...conversations, ...holdoutConversations]) {
    assert.equal(conversation.context.turns.length, 0);
    assert.equal(conversation.context.clientContext.callId, conversation.context.callId);
    assert.equal(conversation.context.clientContext.companyId, conversation.context.manufacturer.id);
    assert.equal(conversation.context.clientContext.contact.name.length > 0, true);
    assert.equal(conversation.context.exampleLines.length, 0);
    assert.equal(conversation.context.voice.examples.length, 0);
    assert.doesNotMatch(JSON.stringify(conversation.context), /"rubric"|"candidates"|"mustAll"|"expected"/);
    for(const step of conversation.steps) if(step.press) {
      ids.push(step.press.id);
      assert.equal(step.role, 'buyer');
      assert.ok(step.press.candidates.length > 0);
      assert.ok(step.press.rubric.move);
    }
  }
  assert.equal(new Set(ids).size, ids.length);
});

test('Rubric accepts different natural expressions of a scoped investigation', () => {
  const rubric = {move: 'investigate_coverage', reference: 'UP29', preserveReference: true};
  for(const line of [
    'I will investigate whether the inspection report applies to UP29.',
    'Let me find out whether UP-29 falls within the report’s scope.',
    'Thanks for spelling UP29. I’ll check the coverage using the drawing.',
  ]) assert.equal(evaluateReply(line, rubric).pass, true, line);
  for(const line of [
    'Our inspection report covers UP29.',
    'That report contains the UP29 results.',
    'I will check whether the report covers UP2.',
  ]) assert.equal(evaluateReply(line, rubric).pass, false, line);
});

test('Completing a check is different from a positive result and a new approval hold', () => {
  const conditional = {move: 'conditional_send', reference: 'UP29', preserveReference: true};
  for(const line of [
    'I’ll send the inspection report only if it covers UP29.',
    'If the report applies to UP-29, I will forward it.',
    'I’ll check whether the report covers UP29. If it does, I’ll reply with it.',
    'I’ll check whether the material test report covers UP29. I’ll send it only if that reference is covered.',
    'If UP29 is covered by the report, I’ll reply and send it.',
    'I will check the inspection report against UP29 and email it if that reference is included in its scope.',
  ]) assert.equal(evaluateReply(line, conditional).pass, true, line);
  for(const line of [
    'Once I check whether the report covers UP29, I’ll send it.',
    'I’ll send the report for UP29 regardless of the result.',
    'If it covers UP29, we will dispatch a sample tomorrow.',
    'I’ll send it only if UP29 is not covered.',
    'I will check the inspection report against UP29 and email it if that reference is not included in its scope.',
    'If the report covers UP29, I’ll send it. I’ll send the report anyway.',
    'If the report covers UP29, I’ll send it. I’ll forward it without waiting for the result.',
    'If the report covers UP29, I’ll send it, but I’ll forward it before that check.',
    'If the report covers UP29, I’ll send it. I’ll forward it to your engineer.',
  ]) assert.equal(evaluateReply(line, conditional).pass, false, line);
  assert.equal(evaluateReply('I will hold off sending anything until you approve the revision.', {move: 'approval_hold'}).pass, true);
  assert.equal(evaluateReply('I will send it now before you approve.', {move: 'approval_hold'}).pass, false);
});

test('An investigation or condition cannot conceal a mixed present-coverage assertion', () => {
  const rubric = {move: 'investigate_coverage', reference: 'UP29', preserveReference: true};
  for(const line of [
    'I’ll check whether the report covers UP29, but our report definitely covers it.',
    'I’ll find out if it applies to UP29 and the report already contains the results.',
    'I’ll check whether it covers UP29. It definitely does.',
    'I’ll check the scope for UP29. That reference is covered by our report.',
  ]) assert.equal(evaluateReply(line, rubric).pass, false, line);
});

test('The independent rubric identifies reciprocal report-scope assertions without rejecting their condition', () => {
  const rubric={move:'investigate_coverage',reference:'UP29',preserveReference:true};
  for(const say of [
    'I will check the details. UP29 falls within the scope of our inspection report.',
    'I will check the details. UP29 is within our inspection report’s scope.',
  ]) assert.equal(evaluateReply(say,rubric).checks.find(row=>row.name==='does not assert current coverage').pass,false,say);
  const conditional='If the report covers UP29, I will email it. Otherwise I will explain the gap.';
  assert.equal(evaluateReply(conditional,{move:'conditional_send',reference:'UP29',preserveReference:true}).pass,true);
});

test('Wordiness alone is feedback, not a release-blocking harm', () => {
  const line = 'Hello, this is Mira from Cedar Screening Supply. Thank you for taking a moment to speak with me today; I am calling about your email inquiry on screening materials. What would be most helpful to understand about your evaluation?';
  assert.equal(evaluateReply(line, {move: 'introduction', repName: 'Mira', companyName: 'Cedar Screening Supply', purposeTerms: ['email|inquiry'], naturalOpening: true}).pass, true);
});

test('All isolated known-bad controls fail while paired safe paraphrases pass', () => {
  for(const item of negativeControls) assert.equal(evaluateReply(item.say, item.rubric).pass, false, item.id);
  for(const item of pairedControls) assert.equal(evaluateReply(item.say, item.rubric).pass, true, item.id);
});
