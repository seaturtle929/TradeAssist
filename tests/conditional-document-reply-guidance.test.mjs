import assert from 'node:assert/strict';
import test from 'node:test';
import {onDemandDecisionRules,onDemandSuggestionProblems} from '../lib/on-demand-coaching.ts';
import {assessReplyVerification,isAwaitingBuyerDocumentReceipt,reportDeliveryCondition} from '../lib/turn-verification-policy.ts';
import {needsFactCheck} from '../lib/call-coaching.ts';
import {LiveCoachingSession} from '../lib/live-coaching-session.ts';

// Authored fictional document workflows; no saved buyer or model transcripts.
const companies=[{name:'Cedar Instruments',report:'inspection report'},{name:'Harbor Components',report:'material test report'}];
const make=({name,report})=>({manufacturer:{id:name,name,products:'industrial components'},sources:[{id:'available',text:`Specification sheets and ${report}s are available for review.`}],turns:[{id:'question',role:'buyer',text:`Does your ${report} cover ZX72?`},{id:'clarifier',role:'you',text:'Could you confirm the model code?'},{id:'spelling',role:'buyer',text:'The part number is ZX72.'},{id:'latest',role:'buyer',text:"I'll email the drawing with ZX72. Once you're sure the report matches, just reply with it, okay?"}],coachingRequest:{id:'authored-conditional-document',requestedAt:2,transcriptState:'confirmed',listeningSession:{startedAt:1,currentTurnIds:['question','clarifier','spelling','latest']}}});
for(const company of companies){
 test(`${company.name}: current instructions preserve the buyer's explicit conditional report reply`,()=>{
  const c=make(company),rules=onDemandDecisionRules(c);
  assert.match(rules,/CURRENT CONDITIONAL REPORT REPLY/);assert.ok(rules.includes(company.report));assert.match(rules,/ONLY IF the report itself covers their reference/);
  const vague="Once we confirm if the report covers ZX72, I'll follow up. We'll wait for your drawing.";
  assert.ok(onDemandSuggestionProblems(vague,c).some(reason=>/conditional document reply/.test(reason)));
  for(const line of ["If you send the drawing, I'll follow up about the report.","We'll watch for your email and check the report."])assert.ok(onDemandSuggestionProblems(line,c).some(reason=>/conditional document reply/.test(reason)),line);
  c.turns.splice(-1,0,{id:'buyer-offer',role:'buyer',text:'If it helps, I can email that drawing so your engineer sees the reference.'});c.coachingRequest.listeningSession.currentTurnIds.push('buyer-offer');
  assert.match(onDemandDecisionRules(c),/CURRENT CONDITIONAL REPORT REPLY/,'A conditional buyer-owned drawing offer is not an unresolved release restriction on the rep.');
 });
 test(`${company.name}: one click can confirm the report condition and await the buyer's email`,()=>{
  const context=make(company),say=`Once we verify the ${company.report} covers your reference, I'll reply with it. We'll look out for your email.`,sent=[],shown=[],traces=[];let verifications=0;
  const checked=assessReplyVerification(say,context);assert.deepEqual(checked.unsupportedClaims,[]);assert.equal(needsFactCheck(say,context),false);assert.deepEqual(onDemandSuggestionProblems(say,context),[]);
  const session=new LiveCoachingSession({snapshot:()=>context,latestContext:()=>context,send:event=>sent.push(event),onGuidance:value=>shown.push(value.say),onRequestTrace:event=>traces.push(event),verify:async()=>{verifications++;assert.fail('A conditional send and awaiting receipt are not factual coverage assertions');},fallback:async()=>assert.fail('No fallback'),onBuyerTurn:()=>{},onBuyerPartial:()=>{},onBuyerSpeech:()=>{},onBuyerPending:()=>{},onSupersede:()=>{},onPendingTurn:()=>{},onThinking:()=>{},onChecking:()=>{},onUsage:()=>{},onWarning:()=>{},onError:message=>assert.fail(message),fallbackAfterMs:10000});
  try{
   session.requestNextMove(context);const create=sent.find(event=>event.type==='response.create');assert.ok(create);
   session.handle({type:'response.created',response:{id:'authored-conditional',metadata:create.response.metadata}});
   session.handle({type:'response.output_text.delta',response_id:'authored-conditional',delta:'SAY: '+say+'\nMOVE: Confirm the conditional document reply\n'});
   session.handle({type:'response.done',response:{id:'authored-conditional',status:'completed'}});
   assert.deepEqual(shown,[say]);assert.equal(verifications,0);assert.equal(sent.filter(event=>event.type==='response.create').length,1);assert.equal(traces.filter(event=>event.event==='repair_requested').length,0);
  }finally{session.stop();}
 });
 test(`${company.name}: a new approval gate or unavailable document never forces a send`,()=>{
  const gated=make(company);gated.turns.at(-1).text+=' Do not send anything until I approve the drawing revision.';
  assert.doesNotMatch(onDemandDecisionRules(gated),/CURRENT CONDITIONAL REPORT REPLY/);
  assert.deepEqual(onDemandSuggestionProblems("We'll check the drawing and wait for your approval before sending anything.",gated),[]);
  const unavailable=make(company);unavailable.sources=[];assert.doesNotMatch(onDemandDecisionRules(unavailable),/CURRENT CONDITIONAL REPORT REPLY/);
 });
 test(`${company.name}: drawing fit is not report coverage, while looking out for incoming mail stays neutral`,()=>{
  const c=make(company),say="Once we've compared the drawing with our specs and confirmed the match, we'll send the report. We'll look out for your email.",checked=assessReplyVerification(say,c);
  assert.ok(checked.unsupportedClaims.some(claim=>/conditional|positive report match/.test(claim.reason)));
  assert.ok(!checked.unsupportedClaims.some(claim=>/look out/.test(claim.text)),'Do not mislabel awaiting incoming mail as outgoing delivery.');
 });
}
test('A closed incoming-mail action cannot exempt an appended coverage or commercial claim',()=>{
 const c=make(companies[0]);assert.equal(isAwaitingBuyerDocumentReceipt("We'll look out for your email."),true);
 for(const say of ["We'll look out for your email and send the report regardless.","We'll look out for your email. Our report covers ZX72.","We'll watch for your drawing. We can offer a 20% discount."]){
  assert.equal(isAwaitingBuyerDocumentReceipt(say),false);
  const checked=assessReplyVerification(say,c);assert.ok(checked.requiresVerification||checked.unsupportedClaims.length,say);
 }
});
test('A buyer-owned conditional drawing offer cannot waive a separate restriction on the rep report send',()=>{
 const c=make(companies[0]);c.turns.at(-1).text='If it helps, I can email the drawing. Only send the inspection report if it covers ZX72.';
 assert.equal(reportDeliveryCondition(c.turns.at(-1).text),'scope_required');
 assert.ok(assessReplyVerification("I'll send the inspection report.",c).unsupportedClaims.some(claim=>/conditional/.test(claim.reason)));
});
