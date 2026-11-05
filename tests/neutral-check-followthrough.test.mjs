import assert from 'node:assert/strict';
import test from 'node:test';
import {isBoundedEpistemicFactAction,isConversationalAcknowledgment} from '../lib/document-product-evidence.ts';
import {assessReplyVerification} from '../lib/turn-verification-policy.ts';
import {needsFactCheck} from '../lib/call-coaching.ts';

// Authored fictional references; no recorded call copied into committed tests.
for(const fixture of [
 {name:'Cedar Instruments',report:'inspection report',product:'QV80'},
 {name:'Fictional Mesh',report:'material test report',product:'PX20'},
]){
 const {name,report,product}=fixture;
 const context={coachingRequest:{id:'neutral-result',requestedAt:1},manufacturer:{name,products:product},sources:[{id:'documents',text:`${product} specifications and ${report}s are available for review.`}],turns:[{role:'buyer',text:'Morgan speaking.'},{role:'buyer',text:`Does your ${report} cover ${product}?`}]};
 for(const courtesy of ['Thanks for checking in.','Thank you for checking in, Morgan.','Morgan, thanks for checking in.'])test(`${name}: checking-in acknowledgment does not assert a report fact ${courtesy}`,()=>{
  assert.equal(isConversationalAcknowledgment(courtesy,context),true);
  const say=`${courtesy} I'll check whether the ${report} covers ${product} and let you know.`;
  assert.equal(needsFactCheck(say,context),false);
  assert.deepEqual(assessReplyVerification(say,context).unsupportedClaims,[]);
 });
 for(const result of ['follow up with the exact details','get back to you with a precise answer','confirm the exact findings with you','report back with specific information','let you know the detailed outcome'])test(`${name}: bounded follow-through reports an unknown result ${result}`,()=>{
  const say=`I'll confirm whether the ${report} covers ${product} and ${result}.`;
  assert.equal(isBoundedEpistemicFactAction(say,context),true);
  assert.equal(needsFactCheck(say,context),false);
  const assessment=assessReplyVerification(say,context);
  assert.deepEqual(assessment.unsupportedClaims,[]);
  assert.deepEqual(assessment.pendingClaims,[]);
  assert.deepEqual(assessment.localEvidence,[],'A future answer is not proven coverage.');
 });
 for(const assent of ['Sure, Morgan.','Sure.','Yes.','Yes, Morgan.'])test(`${name}: assent to explicit investigation keeps coverage unknown ${assent}`,()=>{
  const say=`${assent} I'll confirm whether the ${report} covers ${product} and follow up with you on that.`;
  assert.equal(isBoundedEpistemicFactAction(say,context),true);
  const result=assessReplyVerification(say,context);
  assert.deepEqual(result.unsupportedClaims,[]);
  assert.deepEqual(result.pendingClaims,[]);
  assert.equal(needsFactCheck(say,context),false);
  for(const unsafe of [assent,`${assent} The ${report} covers ${product}.`,`${say} The ${report} covers ${product}.`,`${assent} I'll check whether our certified ${product} is covered.`])assert.equal(needsFactCheck(unsafe,context),true,unsafe);
 });
 for(const label of ['Guaranteed','Certified','Approved','Free Shipping','Unknown Person'])test(`${name}: an assertion cannot masquerade as a vocative ${label}`,()=>{
  for(const preface of [`Yes, ${label}.`,`Sure, ${label}.`,`${label}, thanks.`]){
   const say=`${preface} I'll check whether the ${report} covers ${product}.`;
   assert.equal(isBoundedEpistemicFactAction(say,context),false);
   assert.equal(needsFactCheck(say,context),true);
  }
 });
 test(`${name}: intended or earlier contact is not the current vocative`,()=>{
  const say=`Sure, Morgan. I'll check whether the ${report} covers ${product}.`;
  for(const turns of [
   [{role:'you',text:'Could I speak to Morgan?'},{role:'buyer',text:'One moment.'},context.turns.at(-1)],
   [...context.turns,{role:'buyer',text:'Hi, Taylor here.'},context.turns.at(-1)],
  ]){
   assert.equal(isBoundedEpistemicFactAction(say,{...context,turns}),false);
   assert.equal(needsFactCheck(say,{...context,turns}),true);
  }
 });
 for(const tail of [
  'follow up with the exact details that prove coverage',
  'follow up with the exact details confirming coverage',
  'follow up with the exact price',
  'get back to you with a precise answer tomorrow',
  'follow up with the exact details and ship tomorrow',
  'follow up with the precise certification',
  'follow up with the guaranteed result',
  'get right back to you with exact details',
 ])test(`${name}: neutral modifiers cannot swallow facts/timing ${tail}`,()=>{
  const say=`I'll check whether the ${report} covers ${product} and ${tail}.`;
  assert.equal(isBoundedEpistemicFactAction(say,context),false);
  assert.equal(needsFactCheck(say,context),true);
 });
 test(`${name}: checking-in courtesy does not exempt its factual continuation`,()=>{
  for(const say of [
   `Thanks for checking in—the ${report} covers ${product}.`,
   `Thanks for checking in, our certified ${product} is covered.`,
   `Thanks for checking in. Our ${report} covers ${product}.`,
   'Thanks for checking in. We can offer a 10% discount.',
  ]){
   assert.equal(isConversationalAcknowledgment(say),false);
   assert.equal(needsFactCheck(say,context),true);
  }
 });
}
