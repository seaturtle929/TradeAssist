import assert from 'node:assert/strict';
import test from 'node:test';
import {isBoundedEpistemicFactAction} from '../lib/document-product-evidence.ts';
import {needsFactCheck} from '../lib/call-coaching.ts';
import {assessReplyVerification} from '../lib/turn-verification-policy.ts';

// Authored fictional facts. Buyer spelling is not company ownership evidence.
for(const company of [
 {name:'Cedar Instruments',report:'inspection report',known:'QV80',unknown:'RX73'},
 {name:'Fictional Mesh',report:'material test report',known:'PX20',unknown:'ZK81'},
])for(const product of [company.unknown,company.unknown.replace(/(?=\d)/,'-'),company.unknown.replace(/(?=\d)/,'–')]){
 const context={coachingRequest:{id:'synthetic-premise',requestedAt:1},manufacturer:{name:company.name,products:company.known},sources:[{id:'facts',text:`${company.name} supplies ${company.known}. ${company.report}s are available for review.`}],turns:[{role:'buyer',text:`Can you check if your ${company.report} covers ${product}?`}]};
 for(const ownership of ['our','our standard','our certified','our fully certified','our current model','our approved','our guaranteed'])test(`${company.name}: uncertain coverage retains ${ownership} ${product} premise`,()=>{
  for(const say of [
   `I'll check whether ${ownership} ${product} is covered by the ${company.report}.`,
   `I'll check whether the ${company.report} covers ${ownership} ${product} and let you know.`,
  ]){
   assert.equal(isBoundedEpistemicFactAction(say,context),false,say);
   assert.equal(needsFactCheck(say,context),true,say);
   assert.equal(assessReplyVerification(say,context).locallyVerifiedWholeReply,false);
  }
 });
 for(const say of [
  `I'll check whether our ${company.report} covers ${product} and let you know.`,
  `I'll check whether our ${company.report} covers your requested ${product} and let you know.`,
  `I'll check whether ${product} is covered by our ${company.report}.`,
  `I'll check whether ${product} is certified.`,
  `I'll check whether we have a certified ${product}.`,
 ])test(`${company.name}: unresolved predicate remains fast ${say}`,()=>{
  assert.equal(isBoundedEpistemicFactAction(say,context),true);
  assert.equal(needsFactCheck(say,context),false);
  const result=assessReplyVerification(say,context);
  assert.equal(result.locallyVerifiedWholeReply,false);
  assert.deepEqual(result.localEvidence,[]);
  assert.equal(result.claims.some(claim=>claim.kind==='product_identity'),false);
 });
 test(`${company.name}: an owned report cannot hide a certification premise`,()=>{
  const say=`I'll check whether our certified ${company.report} covers ${product}.`;
  assert.equal(isBoundedEpistemicFactAction(say,context),false);
  assert.equal(needsFactCheck(say,context),true);
 });
}
