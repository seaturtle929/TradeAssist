import test from 'node:test';
import assert from 'node:assert/strict';
import {assessReplyVerification} from '../lib/turn-verification-policy.ts';
import {checkSuggestion} from '../lib/call-purpose.ts';

// Authored documents and buyer reference, not saved call evidence.
function context(report,source){
 return {manufacturer:{id:'synthetic-fern',name:'Fern Component Supply',products:'components'},sources:[{id:'approved-documents',text:source,original:true,complete:true}],turns:[{role:'buyer',text:`PR86 is our drawing reference. I will email the drawing. Please send the ${report} only if it covers PR86.`}],coachingRequest:{id:'one-request',requestedAt:1}};
}
for(const report of ['quality report','inspection report','material test report']){
 test(`Conditional ${report} send uses its literal availability proof without another artifact vocabulary`,()=>{
  const input=context(report,`${report}s and specification sheets are available for review.`);
  const say=`I'll check whether the ${report} covers PR86 and email it only if it matches.`;
  const result=assessReplyVerification(say,input);
  assert.deepEqual(result.unsupportedClaims,[]);assert.equal(result.requiresVerification,false);
  assert.equal(checkSuggestion({say},input).ok,true);
  assert.ok(result.supportedClaims.some(item=>item.sourceId==='approved-documents'));
  assert.ok(assessReplyVerification(`The ${report} covers PR86, so I'll email it.`,input).unsupportedClaims.length,'Availability alone cannot prove coverage.');
  assert.equal(checkSuggestion({say:`I'll check whether the ${report} covers PR86, then email it.`},input,{factChecked:true}).ok,false,'Completing the check does not satisfy the positive-result condition.');
 });
}
for(const source of [
 'Specification sheets are available for review.',
 'Inspection reports are available for review.',
 'Quality reports are unavailable.',
 'Quality reports are available only after manager approval.',
 'Quality reports are available for review. They are confidential and not authorized for sharing.',
])test(`Conditional sending still needs the requested document's authorized availability: ${source}`,()=>{
 const input=context('quality report',source),say="I'll check whether the quality report covers PR86 and send it only if it matches.";
 assert.ok(assessReplyVerification(say,input).unsupportedClaims.length);
 assert.equal(checkSuggestion({say},input,{factChecked:true}).ok,false);
});
test('A mixed conditional send cannot smuggle an unsupported report-content claim',()=>{
 const input=context('quality report','Quality reports are available for review.');
 for(const say of [
  "The quality report covers PR86. I'll check the details and email it only if it matches.",
  "I'll check whether the quality report covers PR86 and email it only if it matches. It proves our components are certified for medical use.",
 ])assert.equal(checkSuggestion({say},input,{factChecked:true}).ok,false,say);
});
