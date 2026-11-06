import assert from 'node:assert/strict';
import test from 'node:test';
import {assessReplyVerification,reportDeliveryCondition} from '../lib/turn-verification-policy.ts';
import {needsFactCheck} from '../lib/call-coaching.ts';
import {checkSuggestion} from '../lib/call-purpose.ts';
import {investigationThenDocumentDelivery,isBoundedEpistemicFactAction} from '../lib/document-product-evidence.ts';

// Authored fictional workflows only. No saved customer transcripts.
const companies=[{name:'Cedar Instruments',report:'inspection report',product:'RX73'},{name:'Harbor Components',report:'material test report',product:'ZK81'}];
const make=({name,report,product},closing=false)=>({manufacturer:{id:name,name,products:'industrial components'},coachingRequest:{id:'authored-workflow',requestedAt:2},sources:[{id:'available',text:`Company profiles, specification sheets and ${report}s are available for review.`}],turns:[{role:'buyer',text:`Can you check whether your ${report} covers ${product}?`},{role:'you',text:'Could you confirm the code?'},{role:'buyer',text:closing?`I'll email the drawing with ${product}. Once you're sure the report matches, reply with it.`:`The part number is ${product}. I can email the drawing so you can check the same reference.`}]});
function fast(say,input){const result=assessReplyVerification(say,input);assert.deepEqual(result.unsupportedClaims,[],say);assert.deepEqual(result.pendingClaims,[],say);assert.equal(result.requiresVerification,false,say);assert.equal(needsFactCheck(say,input),false,say);return result;}

for(const company of companies){
 const {name,report,product}=company;
 for(const say of [
  `Please email the drawing, and I'll confirm if the ${report} covers ${product} once we review it.`,
  `If you send over that drawing, we'll line it up with our specs and confirm if the ${report} covers ${product}.`,
  `If you can send that drawing, we'll check it against our available specs and confirm if the ${report} addresses what your engineer needs.`,
  `If you can email that drawing, we'll compare it with our specs and confirm whether the ${report} covers ${product}.`,
  `If you send that drawing, we'll check it against our available specs and let you know if the ${report} applies to ${product}.`,
  `We'll review your drawing and confirm whether the ${report} covers ${product}.`,
  `We'll check the drawing and let you know whether the ${report} applies to ${product}.`,
 ])test(`${name}: drawing handoff plus uncertainty is an investigation: ${say}`,()=>fast(say,make(company)));
 for(const say of [
  `Once we've checked that the report covers ${product}, we'll reply with the details.`,
  `Once we've reviewed that drawing and confirmed the ${report} coverage for ${product}, we'll send the documents your way.`,
  `We'll review your drawing and check coverage; if the report covers your reference, I'll reply with it.`,
  `Once we've seen that drawing and confirmed if the ${report} includes ${product}, we'll follow up.`,
 ])test(`${name}: future positive scope condition is preserved: ${say}`,()=>fast(say,make(company,true)));
 for(const say of [
  `Once we confirm whether the report covers ${product}, we'll send the documents right back to you.`,
  `Once we've confirmed if the report covers ${product}, we'll reply with the documents.`,
  `We'll confirm if the report covers that category, and once we've got that, we'll reply with the documents.`,
 ])test(`${name}: finishing a check is not a positive coverage result: ${say}`,()=>{
  const result=assessReplyVerification(say,make(company,true));
  assert.ok(result.unsupportedClaims.some(claim=>/conditional|action sequence/i.test(claim.reason)),JSON.stringify(result));
  assert.equal(result.unsupportedClaims.some(claim=>claim.verificationBoundary==='document_product_scope'),false,'Reject the changed send condition, not a nonexistent assertion of current coverage.');
 });
 test(`${name}: a positive condition for one action cannot license a later unconditional send`,()=>{
  const coherent=`I'll check whether the ${report} covers ${product}. If it does, I'll send it along.`;
  fast(coherent,make(company,true));
  for(const say of ["If the report covers your reference, I'll send it. We'll send the report regardless.","If the report covers your reference, I'll send it, but we'll email the report anyway.",coherent+" We'll send the report regardless."]){
   const input=make(company,true),result=assessReplyVerification(say,input);assert.ok(result.unsupportedClaims.some(claim=>claim.kind==='supplier_claim'&&!claim.pending&&claim.verificationBoundary!=='document_product_scope'),say);assert.equal(checkSuggestion({say},input,{factChecked:true}).ok,false,'A source approval cannot waive the buyer’s delivery condition.');
  }
 });
 test(`${name}: final buyer approval clause cannot be dropped`,()=>{
  const input=make(company,true);input.turns.at(-1).text+=' Actually, do not send anything until I approve the drawing revision.';
  const say="We'll check your drawing and, if the report covers your reference, send it.";
  assert.ok(assessReplyVerification(say,input).unsupportedClaims.some(claim=>/withheld permission/.test(claim.reason)));
  fast("We'll check the drawing and report coverage, and wait for your approval before sending anything.",input);
  for(const mixed of ["We'll wait for your approval before sending anything. We'll send the report regardless.","We'll wait for your approval before sending anything, but we'll send the report.","We'll wait for your approval before sending anything, and then send the report regardless."])assert.ok(assessReplyVerification(mixed,input).unsupportedClaims.some(claim=>/withheld permission/.test(claim.reason)),mixed);
 });
 test(`${name}: relative claims and owned unknown identifiers do not inherit uncertainty`,()=>{
  for(const say of [`I will check whether the ${report} covers ${product} which is certified for medical use.`,`Once we confirm the report covers ${product} which meets every safety requirement, we will send it.`,`If the report covers our ${product}, I'll send it.`]){
   const result=assessReplyVerification(say,make(company,true));assert.ok(result.unsupportedClaims.length||result.requiresVerification,say);assert.equal(needsFactCheck(say,make(company,true)),true,say);
  }
 });
 test(`${name}: engineering and sign-off restrictions survive equivalent wording`,()=>{
  for(const restriction of ["Don't send anything until my engineer approves the drawing revision.","Don't send anything before I approve the drawing revision.","Please wait for my engineer's approval before you email anything.","Until our engineer approves the drawing, do not send anything.","Don't send anything until the engineering team approves it.","No documents until I sign off on the drawing."]){
   const input=make(company,true);input.turns.at(-1).text+=' '+restriction;
   const result=assessReplyVerification("If the report covers your reference, I'll send it.",input);assert.ok(result.unsupportedClaims.some(claim=>/withheld permission/.test(claim.reason)),restriction);
  }
 });
 test(`${name}: courtesy cannot erase the buyer's outstanding report condition`,()=>{
  const input=make(company,true);input.turns.push({role:'buyer',text:'Thanks.'});
  assert.ok(assessReplyVerification(`I'll email the ${report}.`,input).unsupportedClaims.some(claim=>/conditional/.test(claim.reason)));
 });
 test(`${name}: actual buyer approval or cancellation updates the release state`,()=>{
  const input=make(company);input.turns.push({role:'buyer',text:"Don't send anything until I approve the drawing revision."},{role:'buyer',text:'I approve the drawing revision. You can send it now.'});
  fast(`I'll email the ${report}.`,input);
  const cancelled=make(company,true);cancelled.turns.push({role:'buyer',text:'Cancel that report request.'},{role:'buyer',text:'Thanks.'});
  assert.ok(assessReplyVerification(`I'll email the ${report}.`,cancelled).unsupportedClaims.some(claim=>/cancelled/.test(claim.reason)));
  cancelled.turns.push({role:'buyer',text:`Please send the ${report} now.`});fast(`I'll email the ${report}.`,cancelled);
 });
 test(`${name}: the buyer cannot substitute for their stated manager approver`,()=>{
  const input=make(company);input.turns.push({role:'buyer',text:'Do not send anything until my manager approves the drawing revision.'});
  assert.ok(assessReplyVerification(`I'll send the ${report} once you approve the drawing revision.`,input).unsupportedClaims.some(claim=>/stated approver/.test(claim.reason)));
  fast(`I'll send the ${report} once your manager approves the drawing revision.`,input);
 });
 test(`${name}: drawing approval does not erase a trailing hold on sending`,()=>{
  const input=make(company);input.turns.push({role:'buyer',text:'Do not send anything until I approve the drawing revision.'},{role:'buyer',text:"I approve the drawing revision, but don't send it yet."});
  assert.ok(assessReplyVerification(`I'll send the ${report}.`,input).unsupportedClaims.some(claim=>/withheld|cancelled/.test(claim.reason)));
  input.turns.push({role:'buyer',text:'Please send it now.'});fast(`I'll send the ${report}.`,input);
 });
 for(const say of [`The ${report} covers ${product}.`,`We have a ${product} report, and I'll check the details.`,`I'll check whether the report covers ${product}. We can offer a 12% discount.`,`If the report covers your reference, we'll ship the order tomorrow.`,`Once we confirm the report covers ${product}, we'll send it soon.`,`If you email the drawing, we'll compare it with our specs and confirm that the ${report} covers ${product}.`,`We'll compare it with our specs and let you know that the ${report} certifies ${product} for medical use.`])test(`${name}: uncertainty never supports another claim: ${say}`,()=>{
  const result=assessReplyVerification(say,make(company,true));assert.ok(result.requiresVerification||result.unsupportedClaims.length,say);
 });
 test(`${name}: approved release restrictions remain binding after a positive coverage check`,()=>{
  const input=make(company,true);input.sources=[{id:'restricted',text:`The ${report} is available only after manager approval.`}];
  const result=assessReplyVerification(`Once we confirm the ${report} covers ${product}, we'll send it.`,input);assert.ok(result.requiresVerification||result.unsupportedClaims.length);
 });
 test(`${name}: no imaginary specifications are offered in the drawing comparison`,()=>{
  const input=make(company);input.sources=[{id:'report-only',text:`${report}s are available for review.`}];
  const result=assessReplyVerification(`If you send that drawing, we'll check it against our specs and confirm if the ${report} covers ${product}.`,input);assert.ok(result.requiresVerification||result.unsupportedClaims.length);
 });
}

test('A report matching requirement is recognized in the buyer chosen reply route',()=>{
 assert.equal(reportDeliveryCondition("Once you're sure the report matches, just reply with it, okay?"),'scope_required');
 assert.equal(investigationThenDocumentDelivery("Once we confirm whether the report covers RX73, we'll send it.")?.deliveryCondition,'check_completion');
 assert.equal(investigationThenDocumentDelivery("Once we confirm that the report covers RX73, we'll send it.")?.deliveryCondition,'stated_condition');
 assert.equal(isBoundedEpistemicFactAction("I'll check whether the report covers RX73, and it covers RX73."),false);
});
