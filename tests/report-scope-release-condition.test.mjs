import assert from 'node:assert/strict';
import test from 'node:test';
import {reportDeliveryCondition,buyerReleaseState,assessReplyVerification} from '../lib/turn-verification-policy.ts';
import {checkSuggestion} from '../lib/call-purpose.ts';
import {investigationThenDocumentDelivery,isBoundedEpistemicFactAction} from '../lib/document-product-evidence.ts';
import {availableDocumentActionEvidence} from '../lib/document-availability-evidence.ts';

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

const inspectionContext=(source='Company profiles, component drawings and inspection reports are available for review.')=>{
 const context=make('Please forward the inspection report provided that our part reference is within that report’s scope. Otherwise just explain the gap.');
 return {...context,sources:[{id:'synthetic-documents',text:source}],turns:context.turns.map(turn=>({...turn,text:turn.text.replaceAll('material test report','inspection report')}))};
};
const inspectionConditional="If the inspection report applies to DN58, I'll forward it to you. Otherwise I'll explain what remains unconfirmed.";

test('A neutral drawing-type modifier does not erase an explicitly available neighboring report',()=>{
 for(const modifier of ['component','part','engineering','dimensional']){
  const context=inspectionContext(`Company profiles, ${modifier} drawings and inspection reports are available for review.`);
  const assessment=assessReplyVerification(inspectionConditional,context);
  assert.deepEqual(assessment.unsupportedClaims,[],modifier);
  assert.deepEqual(assessment.pendingClaims,[],modifier);
  assert.equal(assessment.requiresVerification,false,modifier);
  const check=checkSuggestion({say:inspectionConditional},context,{factChecked:true});
  assert.equal(check.ok,true,check.retryReason);
 }
});

test('Availability of a neighboring report never establishes its coverage or contents',()=>{
 const context=inspectionContext();
 for(const say of [
  'The inspection report covers DN58.',
  'The inspection report certifies DN58 for medical use.',
  "We have an inspection report for DN58, and I'll check the details.",
  "If the inspection report applies to DN58, I'll forward it to you. It guarantees compliance.",
 ]){
  assert.ok(assessReplyVerification(say,context).unsupportedClaims.length,say);
  assert.equal(checkSuggestion({say},context,{factChecked:true}).ok,false,say);
 }
});

test('A typed availability list retains full release and source-meaning checks',()=>{
 for(const source of [
  'Company profiles, component drawings and inspection reports are available only after manager approval.',
  'Plans to send component drawings and inspection reports are available for review.',
 ]){
  const context=inspectionContext(source),assessment=assessReplyVerification(inspectionConditional,context);
  assert.ok(assessment.unsupportedClaims.length||assessment.pendingClaims.length,source);
  assert.equal(checkSuggestion({say:inspectionConditional},context,{factChecked:true}).ok,false,source);
 }
 const conflict=inspectionContext();conflict.sources.push({id:'synthetic-release',text:'Inspection reports are available only after manager approval.'});
 assert.ok(assessReplyVerification(inspectionConditional,conflict).unsupportedClaims.length);
 assert.equal(checkSuggestion({say:inspectionConditional},conflict,{factChecked:true}).ok,false);
});

test('Explicit report availability is independent of a sibling document’s product type or qualification',()=>{
 for(const source of [
  'Company profiles, gasket specification sheets and inspection reports are available for review.',
  'Company profiles, optical cell specification sheets and inspection reports are available for review.',
  'Company profiles, certified drawings and inspection reports are available for review.',
 ]){
  const context=inspectionContext(source),assessment=assessReplyVerification(inspectionConditional,context);
  assert.deepEqual(assessment.unsupportedClaims,[],source);
  assert.deepEqual(assessment.pendingClaims,[],source);
  assert.equal(assessment.requiresVerification,false,source);
  const check=checkSuggestion({say:inspectionConditional},context,{factChecked:true});
  assert.equal(check.ok,true,check.retryReason);
 }
});

test('Typed sibling documents do not establish report availability, content or certification on their own',()=>{
 for(const source of [
  'Plans to send gasket specification sheets and inspection reports are available for review.',
  'Company profiles and inspection report summary specification sheets are available for review.',
  'Company profiles, gasket specification sheets and inspection reports are available only after manager approval.',
 ]){
  const assessment=assessReplyVerification(inspectionConditional,inspectionContext(source));
  assert.ok(assessment.unsupportedClaims.length||assessment.pendingClaims.length,source);
 }
 const context=inspectionContext('Company profiles, certified drawings and inspection reports are available for review.');
 for(const say of ['The inspection report covers DN58.','Our inspection report is certified for medical use.',"I can send our certified inspection report.","I can send the inspection report certified for medical use."]){
  assert.ok(assessReplyVerification(say,context).unsupportedClaims.length,say);
  assert.equal(checkSuggestion({say},context,{factChecked:true}).ok,false,say);
 }
});

test('Requested artifact matching preserves qualifiers and its terminal document type',()=>{
 const sources=[{id:'synthetic-typed-list',text:'Company profiles, valve specification sheets and inspection reports are available for review.'}];
 for(const kind of ['company profile','valve specification sheet','specification sheet','inspection report']){
  assert.equal(availableDocumentActionEvidence(kind,sources)?.id,'synthetic-typed-list',kind);
 }
 assert.equal(availableDocumentActionEvidence('material test report',sources),undefined);
 assert.equal(availableDocumentActionEvidence('inspection report',[{id:'synthetic-summary-only',text:'Company profiles and inspection report summary specification sheets are available for review.'}]),undefined);
});

for(const connector of ['If','Provided that','As long as','On condition that']){
 test(connector+': an adjacent bounded report inquiry supplies its conditional pronoun',()=>{
  const context=inspectionContext();
  context.turns.at(-1).text='Please email the report to me only if its scope includes DN58. If it does not, just tell me what you could not confirm.';
  assert.equal(reportDeliveryCondition(context.turns.at(-1).text),'scope_required');
  const say=`I'll look into whether the inspection report applies to DN58. ${connector} it covers DN58, I'll email the report to you; otherwise I'll explain what we could not confirm.`;
  const assessment=assessReplyVerification(say,context);
  assert.deepEqual(assessment.unsupportedClaims,[],connector);
  assert.deepEqual(assessment.pendingClaims,[],connector);
  assert.equal(assessment.requiresVerification,false,connector);
  const check=checkSuggestion({say},context,{factChecked:true});
  assert.equal(check.ok,true,check.retryReason);
 });
 test(connector+': conditional pronouns do not license actual claims, negative coverage sends or holds',()=>{
  const context=inspectionContext();
  const inquiry="I'll check whether the inspection report covers DN58. ";
  for(const say of [
   inquiry+`${connector} it covers DN58, I'll email the report. It covers DN58.`,
   inquiry+`${connector} it does not cover DN58, I'll email the report.`,
   inquiry+`${connector} it covers DN58, I'll email the report; we'll send it regardless.`,
  ]){
   const assessment=assessReplyVerification(say,context);
   assert.ok(assessment.unsupportedClaims.length||assessment.pendingClaims.length,say);
   assert.equal(checkSuggestion({say},context,{factChecked:true}).ok,false,say);
  }
  const held={...context,turns:[...context.turns,{role:'buyer',text:'Do not send anything until my engineer approves the drawing.'}]};
  const say=inquiry+`${connector} it covers DN58, I'll email the report.`;
  assert.ok(assessReplyVerification(say,held).unsupportedClaims.length);
  assert.equal(checkSuggestion({say},held,{factChecked:true}).ok,false);
 });
}

test('A conditional pronoun cannot manufacture its report referent',()=>{
 const context={manufacturer:{name:'Harbor Instruments',products:'components'},sources:[{id:'reports',text:'Inspection reports are available for review.'}],coachingRequest:{id:'synthetic-unbound',requestedAt:10},turns:[{role:'buyer',text:'DN58 is the reference on our drawing.'}]};
 const say="Provided that it covers DN58, I'll email it.";
 assert.equal(investigationThenDocumentDelivery(say,context),undefined);
});

test('An affirmative item-within-report-scope paraphrase requires original coverage evidence',()=>{
 const context=inspectionContext();
 for(const say of [
  'DN58 falls within the scope of our inspection report.',
  'DN58 is within the scope of the inspection report.',
  "DN58 falls within our inspection report's scope.",
  'DN58 is covered by the inspection report.',
  'DN-58 falls within the scope of our inspection report.',
  'DN 58 falls within the scope of our inspection report.',
  'DN–58 falls within the scope of our inspection report.',
  'That reference falls within the scope of our inspection report.',
  "Our inspection report's scope includes DN58.",
 ]){
  const assessment=assessReplyVerification(say,context);
  assert.ok(assessment.unsupportedClaims.some(claim=>claim.verificationBoundary==='document_product_scope'),say);
  assert.equal(checkSuggestion({say},context,{factChecked:true}).ok,false,say);
 }
});

test('A positive inverse condition withholds the coverage answer instead of asserting it',()=>{
 const context=inspectionContext();
 for(const connector of ['If','Provided that','As long as','On condition that']){
  const say=`${connector} DN58 falls within the scope of the inspection report, I'll forward it to you. Otherwise I'll explain the gap.`;
  const assessment=assessReplyVerification(say,context);
  assert.deepEqual(assessment.unsupportedClaims,[],say);
  assert.deepEqual(assessment.pendingClaims,[],say);
  assert.equal(assessment.requiresVerification,false,say);
  const check=checkSuggestion({say},context,{factChecked:true});
  assert.equal(check.ok,true,check.retryReason);
 }
});

test('A supported inverse scope paraphrase keeps the original document-product evidence',()=>{
 for(const source of ['The inspection report covers DN58.','DN58 falls within the scope of the inspection report.']){
  const context=inspectionContext();context.sources.push({id:'synthetic-coverage',text:source});
  const say='DN58 falls within the scope of the inspection report.';
  const assessment=assessReplyVerification(say,context);
  assert.deepEqual(assessment.unsupportedClaims,[],source);
  assert.ok(assessment.supportedClaims.some(claim=>claim.kind==='supplier_claim'&&claim.sourceId==='synthetic-coverage')||assessment.pendingClaims.some(claim=>claim.candidateSourceIds?.includes('synthetic-coverage')),source);
  const check=checkSuggestion({say},context,{factChecked:true});
  assert.equal(check.ok,true,check.retryReason);
 }
});

test('A conditional handoff cannot hide a separate affirmative inverse coverage claim',()=>{
 const context=inspectionContext();
 for(const say of [
  "If the inspection report applies to DN58, I'll forward it to you. DN58 falls within the scope of our inspection report.",
  "I'll check whether the inspection report covers DN58; DN58 is within our inspection report's scope.",
  "If DN58 falls within the scope of the inspection report, I'll email it. DN58 is covered by the inspection report.",
 ]){
  assert.ok(assessReplyVerification(say,context).unsupportedClaims.some(claim=>claim.verificationBoundary==='document_product_scope'),say);
  assert.equal(checkSuggestion({say},context,{factChecked:true}).ok,false,say);
 }
});

test('A bounded report comparison can coordinate delivery on a passive scope result',()=>{
 const context=inspectionContext();context.turns.at(-1).text='If the report applies to DN58, email it over. If it does not, just let me know what is still missing.';
 const say="I'll check the inspection report against DN58 and email it to you if that reference is included in its scope. If it isn't, I'll explain what we could not confirm.";
 const assessment=assessReplyVerification(say,context);
 assert.deepEqual(assessment.unsupportedClaims,[]);
 assert.deepEqual(assessment.pendingClaims,[]);
 assert.equal(assessment.requiresVerification,false);
 const check=checkSuggestion({say},context,{factChecked:true});
 assert.equal(check.ok,true,check.retryReason);
});

test('Passive scope wording remains factual when it asserts the result',()=>{
 const context=inspectionContext();
 for(const say of [
  'That reference is included in its scope.',
  'DN58 is included in its scope.',
  'DN58 is included in the scope of the inspection report.',
  "I'll check the inspection report against DN58 and email it if that reference is included in its scope. DN58 is included in the scope of the inspection report.",
 ]){
  assert.ok(assessReplyVerification(say,context).unsupportedClaims.some(claim=>claim.verificationBoundary==='document_product_scope'),say);
  assert.equal(checkSuggestion({say},context,{factChecked:true}).ok,false,say);
 }
});

test('A report comparison does not authorize an unconditional or inverse-result send',()=>{
 const context=inspectionContext();
 for(const say of [
  "I'll check the inspection report against DN58 and then email it to you.",
  "I'll check the inspection report against DN58 and email it to you if that reference is not included in its scope.",
 ]){
  const assessment=assessReplyVerification(say,context);
  assert.ok(assessment.unsupportedClaims.length||assessment.pendingClaims.length,say);
  assert.equal(checkSuggestion({say},context,{factChecked:true}).ok,false,say);
 }
 const held={...context,turns:[...context.turns,{role:'buyer',text:'Do not email anything until my engineer approves the drawing.'}]};
 const say="I'll check the inspection report against DN58 and email it to you if that reference is included in its scope.";
 assert.ok(assessReplyVerification(say,held).unsupportedClaims.length);
 assert.equal(checkSuggestion({say},held,{factChecked:true}).ok,false);
});
