import assert from 'node:assert/strict';
import test from 'node:test';
import {reportDeliveryCondition,buyerReleaseState,assessReplyVerification} from '../lib/turn-verification-policy.ts';
import {checkSuggestion} from '../lib/call-purpose.ts';
import {investigationThenDocumentDelivery,isBoundedEpistemicFactAction} from '../lib/document-product-evidence.ts';

// Deliberately authored fictional language; no customer records or paid AI.
const make=buyer=>({manufacturer:{id:'synthetic-harbor',name:'Harbor Instruments',products:'instrument housings'},sources:[{id:'reports',text:'Material test reports are available for review.'}],coachingRequest:{id:'synthetic-scope-condition',requestedAt:10},turns:[
 {id:'rep-intro',role:'you',text:'Hi, this is Lee from Harbor Instruments. Could you connect me to Jo?'},
 {id:'ask',role:'buyer',text:'Jo speaking. Does the material test report cover DN58?'},
 {id:'clarify',role:'you',text:'Could you confirm the drawing reference?'},
 {id:'reference',role:'buyer',text:'DN58 is the reference on our drawing. I can send the drawing.'},
 {id:'rep-plan',role:'you',text:'I will check whether the material test report covers DN58.'},
 {id:'condition',role:'buyer',text:buyer},
]});
const safe="If the material test report covers DN58, I'll forward it to you. Otherwise, I'll explain what is still unconfirmed.";
for(const buyer of [
 'Please forward the report only if that drawing reference is within its scope.',
 'Only email it if the part is covered by the report.',
 "Send the material test report if DN58 falls within the report's scope.",
 "As long as DN58 falls within that report's scope, please forward it.",
 'Please forward the report provided that our drawing reference is within its scope.',
 'Please send the report only when that reference is within the scope of the report.',
])test('A positive report-scope condition is not a sending hold: '+buyer,()=>{
 assert.equal(reportDeliveryCondition(buyer),'scope_required');
 const context=make(buyer),state=buyerReleaseState(context);
 assert.deepEqual(state,{scope:true,approval:false,approver:'buyer',hold:false,unresolved:false});
 const assessment=assessReplyVerification(safe,context);
 assert.deepEqual(assessment.unsupportedClaims,[]);
 const check=checkSuggestion({say:safe},context,{factChecked:true});
 assert.equal(check.ok,true,check.retryReason);
});

for(const restriction of [
 'Do not send anything until I approve the drawing revision.',
 'Do not send the report before our engineer approves the drawing.',
 'Actually, do not send the report yet.',
 'Cancel the report request.',
])test('A coverage condition never releases an explicit hold: '+restriction,()=>{
 const context=make('Please send the report only if the drawing reference is within its scope. '+restriction);
 const state=buyerReleaseState(context);
 assert.ok(state.approval||state.hold);
 assert.ok(assessReplyVerification(safe,context).unsupportedClaims.length);
 assert.equal(checkSuggestion({say:safe},context,{factChecked:true}).ok,false);
});

for(const buyer of [
 'Only send the report if our drawing matches your specifications.',
 'Only send the report if the price is right.',
 'Send the report only if engineering can guarantee the result.',
 'Please forward the report only if the item is within our scope.',
 'Please forward the report only if the reference is within its scope and my engineer approves it.',
])test('A different or additional condition remains unresolved: '+buyer,()=>{
 assert.equal(reportDeliveryCondition(buyer),'unresolved');
 const context=make(buyer);
 const assessment=assessReplyVerification(safe,context);
 assert.ok(assessment.requiresVerification||assessment.unsupportedClaims.length);
 assert.equal(checkSuggestion({say:safe},context,{factChecked:true}).ok,false);
});

test('Conditional permission does not establish present report coverage',()=>{
 const context=make('Please forward the report only if the drawing reference is within its scope.');
 for(const say of ['The material test report covers DN58.',"We have a report for DN58, and I'll check the details.","I'll check whether the material test report covers DN58, then send it regardless."]){
  assert.ok(assessReplyVerification(say,context).unsupportedClaims.length,say);
  assert.equal(checkSuggestion({say},context,{factChecked:true}).ok,false,say);
 }
});

test('Applies-to coverage can preserve a positive delivery condition without asserting its result',()=>{
 const context=make('Please forward the material test report provided that our part reference is within that report’s scope. Otherwise just explain the gap.');
 const say="If the material test report applies to DN58, I'll forward it to you. Otherwise, I'll explain what remains unconfirmed.";
 assert.equal(reportDeliveryCondition(context.turns.at(-1).text),'scope_required');
 assert.deepEqual(assessReplyVerification(say,context).unsupportedClaims,[]);
 const check=checkSuggestion({say},context,{factChecked:true});
 assert.equal(check.ok,true,check.retryReason);
});

test('Applies-to coverage permission does not establish coverage or release another sending gate',()=>{
 const context=make('Please forward the report only if our drawing reference is within its scope.');
 for(const say of [
  'The material test report applies to DN58.',
  "The material test report applies to DN58, and I'll check the details.",
  "If the material test report applies to DN58, I'll forward it to you. I'll send it either way.",
 ]){
  assert.ok(assessReplyVerification(say,context).unsupportedClaims.length,say);
  assert.equal(checkSuggestion({say},context,{factChecked:true}).ok,false,say);
 }
 const held=make('Please forward the report only if our drawing reference is within its scope. Do not send it until I approve it.');
 const conditional="If the material test report applies to DN58, I'll forward it to you.";
 assert.ok(assessReplyVerification(conditional,held).unsupportedClaims.length);
 assert.equal(checkSuggestion({say:conditional},held,{factChecked:true}).ok,false);
});

test('Semicolon-delimited inquiry and conditional delivery retain their complete meaning',()=>{
 const context=make('Please email the material test report only if DN58 is covered by that report. If not, explain the gap instead of attaching it.');
 assert.equal(reportDeliveryCondition(context.turns.at(-1).text),'scope_required');
 for(const say of [
  "I'll check whether the material test report covers DN58. If the report applies to DN58, I'll email it; otherwise I'll explain the gap.",
  "I'll check whether the material test report covers DN58; if the report applies to DN58, I'll email it. Otherwise I'll explain the gap.",
 ]){
  const assessment=assessReplyVerification(say,context);
  assert.deepEqual(assessment.unsupportedClaims,[],say);
  assert.deepEqual(assessment.pendingClaims,[],say);
  const check=checkSuggestion({say},context,{factChecked:true});
  assert.equal(check.ok,true,check.retryReason);
 }
 assert.equal(isBoundedEpistemicFactAction("I'll check whether the material test report covers DN58;",context),true);
 assert.equal(investigationThenDocumentDelivery("If the report applies to DN58, I'll email it;",context)?.deliveryCondition,'stated_condition');
});

test('A semicolon never lets a conditional delivery license a separate coverage or sending claim',()=>{
 const context=make('Please email the report only if DN58 is covered by that report.');
 const conditional="If the report applies to DN58, I'll email it; ";
 for(const say of [
  conditional+'the material test report covers DN58.',
  conditional+"we have a material test report for DN58.",
  conditional+"I'll send it regardless.",
  "I'll check whether the material test report covers DN58; the material test report covers DN58.",
 ]){
  const assessment=assessReplyVerification(say,context);
  assert.ok(assessment.unsupportedClaims.length,say);
  assert.equal(checkSuggestion({say},context,{factChecked:true}).ok,false,say);
 }
});
