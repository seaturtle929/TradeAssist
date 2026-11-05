import assert from 'node:assert/strict';
import test from 'node:test';
import {assessReplyVerification,hasAffirmativeOutgoingDocumentAction,isAwaitingBuyerDocumentReceipt} from '../lib/turn-verification-policy.ts';
import {checkSuggestion} from '../lib/call-purpose.ts';
import {mainLineCheckInput} from '../lib/claim-check.ts';
import {onDemandDecisionRules,onDemandSuggestionProblems} from '../lib/on-demand-coaching.ts';
import {LiveCoachingSession} from '../lib/live-coaching-session.ts';

// Authored fictional fixtures. The provider and semantic verdict below are
// scripted offline; they are not new model outputs or customer conversations.
const companies=[{name:'Cedar Instruments',report:'inspection report'},{name:'Harbor Components',report:'material test report'}];
function fixture(company){return {manufacturer:{id:company.name,name:company.name,products:'industrial components'},sources:[{id:'availability',text:`Specification sheets and ${company.report}s are available.`},{id:'unrelated',text:'Company profiles are available.'}],turns:[{id:'name',role:'buyer',text:'Morgan speaking.'},{id:'scope',role:'buyer',text:`Does the ${company.report} cover ZX72?`},{id:'clarify',role:'you',text:'Could you confirm the reference?'},{id:'drawing',role:'buyer',text:'The reference is ZX72. I can email the drawing for you to review.'}],coachingRequest:{id:'authored-semantic',requestedAt:2,transcriptState:'confirmed',listeningSession:{startedAt:1,currentTurnIds:['name','scope','clarify','drawing']}}};}
function controller(context,say,verdict){
 const sent=[],shown=[],traces=[];let verificationCalls=0;
 const session=new LiveCoachingSession({snapshot:()=>context,latestContext:()=>context,send:event=>sent.push(event),onGuidance:guidance=>shown.push(guidance.say),onRequestTrace:event=>traces.push(event),verify:async(_context,proposed)=>{verificationCalls++;assert.equal(proposed.say,say,'The entire proposed wording reaches the existing verifier unchanged.');return {...proposed,...verdict};},fallback:async()=>assert.fail('No fallback'),onBuyerTurn:()=>{},onBuyerPartial:()=>{},onBuyerSpeech:()=>{},onBuyerPending:()=>{},onSupersede:()=>{},onPendingTurn:()=>{},onThinking:()=>{},onChecking:()=>{},onUsage:()=>{},onWarning:()=>{},onError:()=>{},fallbackAfterMs:10000});
 session.requestNextMove(context);const create=sent.find(event=>event.type==='response.create');assert.ok(create);session.handle({type:'response.created',response:{id:'authored-semantic',metadata:create.response.metadata}});session.handle({type:'response.output_text.delta',response_id:'authored-semantic',delta:'SAY: '+say+'\nMOVE: Investigate report scope\n'});session.handle({type:'response.done',response:{id:'authored-semantic',status:'completed'}});
 return {session,sent,shown,traces,get verificationCalls(){return verificationCalls;}};
}
for(const company of companies){
 for(const say of [`Thanks, Morgan. Yes, please do email the drawing over, and after we've reviewed it, I'll confirm whether the ${company.report} covers ZX72 for you.`,`If you email the drawing, we'll compare it and get back to you on whether the ${company.report} covers that ZX72 reference.`,`If you email the drawing, we'll compare it with our specs and get back to you on whether the ${company.report} covers ZX72.`])test(`${company.name}: unknown investigation grammar uses one semantic check, not a rewrite: ${say}`,async()=>{
  const context=fixture(company),assessment=assessReplyVerification(say,context);
  assert.deepEqual(assessment.unsupportedClaims,[]);assert.ok(assessment.pendingClaims.length);assert.ok(assessment.pendingClaims.every(claim=>claim.verificationKind==='speech_act'));assert.equal(assessment.requiresVerification,true);assert.equal(assessment.sanitizedReply,say);
  assert.equal(checkSuggestion({say},context,{factChecked:true}).ok,true,'A successful semantic verdict is not rejected again by the same local grammar.');
  assert.equal(mainLineCheckInput(say,context).references.length,2,'Speech-act uncertainty preserves all original references, including any accompanying fact support.');
  assert.ok(mainLineCheckInput(say,context).input.pendingClaims.every(claim=>claim.verificationKind==='speech_act'),'The existing checker receives the reason for semantic review, not a mislabeled positive coverage finding.');
  const run=controller(context,say,{verified:true,verificationStatus:'not_required',evidence:[]});
  try{await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(run.shown,[say]);assert.equal(run.verificationCalls,1);assert.equal(run.sent.filter(event=>event.type==='response.create').length,1);assert.equal(run.traces.filter(event=>event.event==='repair_requested').length,0);}finally{run.session.stop();}
 });
 for(const say of [`I'll confirm if the ${company.report} covers ZX72 once we review your drawing, and if it does, I'll send the report as requested.`,`Once we review your drawing and confirm the ${company.report} covers that ZX72 reference, I'll reply with the report as requested.`,`We'll confirm whether the ${company.report} covers ZX72 once we review your drawing. If it does, we'll reply with the report as requested.`,`Once we review the drawing and confirm that the ${company.report} covers ZX72, we'll reply with it as you requested. We'll be looking out for your email.`])test(`${company.name}: an unparsed positive-result condition uses the existing whole-line check: ${say}`,async()=>{
  const context=fixture(company);context.turns.at(-1).text="I'll email the drawing. Once you're sure the report matches, reply with it.";
  const assessment=assessReplyVerification(say,context);assert.deepEqual(assessment.unsupportedClaims,[]);assert.ok(assessment.pendingClaims.some(claim=>claim.verificationKind==='speech_act'));assert.equal(assessment.sanitizedReply,say);
  const run=controller(context,say,{verified:true,verificationStatus:'verified',evidence:[{sourceId:'availability',quote:context.sources[0].text}]});
  try{await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(run.shown,[say]);assert.equal(run.verificationCalls,1);assert.equal(run.sent.filter(event=>event.type==='response.create').length,1);}finally{run.session.stop();}
  for(const latest of ['Only send the report if it covers my reference. Do not send anything until my engineer approves the drawing.','Only send the report if it covers my reference. Actually, do not send it yet.']){const gated={...context,turns:[...context.turns,{id:'restriction',role:'buyer',text:latest}]};assert.ok(assessReplyVerification(say,gated).unsupportedClaims.length,latest);}
  const restricted={...context,sources:[{id:'restricted',text:`The ${company.report} is available only after manager approval.`}]};assert.ok(assessReplyVerification(say,restricted).unsupportedClaims.length,'Unparsed sending still needs original release authority.');
 });
 test(`${company.name}: an inconclusive or rejected semantic verdict never publishes`,async()=>{
  const say=`Yes, please do email the drawing over, and after we've reviewed it, I'll confirm whether the ${company.report} covers ZX72 for you.`;
  for(const verdict of [{verified:false,verificationStatus:'unavailable',caution:'Check unavailable.'},{verified:false,verificationStatus:'rejected',caution:'A claim is unsupported.'}]){const run=controller(fixture(company),say,verdict);try{await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(run.shown,[]);assert.equal(run.verificationCalls,1);}finally{run.session.stop();}}
 });
 test(`${company.name}: a canonical future check keeps its zero-verification fast path`,()=>{
  const say=`I'll check whether the ${company.report} covers ZX72 and let you know.`,assessment=assessReplyVerification(say,fixture(company));assert.deepEqual(assessment.pendingClaims,[]);assert.deepEqual(assessment.unsupportedClaims,[]);assert.equal(assessment.requiresVerification,false);
 });
 test(`${company.name}: substantive premises and mixed claims remain hard vetoes`,()=>{
  for(const say of [`The ${company.report} covers ZX72.`,`We have a ${company.report} for ZX72, and I'll check whether it covers your drawing.`,`I'll confirm whether the ${company.report} covers our ZX72.`,`I'll confirm whether the ${company.report} covers ZX72 which is certified for medical use.`,`I'll confirm whether the ${company.report} covers ZX72, and the report covers your exact product.`,`I'll confirm that the ${company.report} covers ZX72.`,`Please email the drawing, and I'll confirm whether the ${company.report} covers ZX72. We can offer a 20% discount.`,`I'll confirm whether the ${company.report} covers ZX72 and ship it tomorrow.`,`I'll confirm whether the ${company.report} covers ZX72 and guarantee its results.`]){const assessment=assessReplyVerification(say,fixture(company));assert.ok(assessment.unsupportedClaims.length,say);}
  const context=fixture(company);context.turns.at(-1).text='Only send the report if it covers my reference.';
  for(const say of [`I'll check whether the ${company.report} covers ZX72, then send it.`,`I'll confirm whether the ${company.report} covers ZX72 and send it regardless.`,`I'll confirm whether the ${company.report} covers ZX72. Even if it does not, I'll send it anyway.`])assert.ok(assessReplyVerification(say,context).unsupportedClaims.length,say);
 });
 test(`${company.name}: a newly stated send restriction needs its own acknowledgment`,()=>{
  const context=fixture(company);context.turns.push({id:'hold',role:'buyer',text:'Actually, do not send anything until my engineer approves the drawing revision.'});context.coachingRequest.listeningSession.currentTurnIds.push('hold');
  assert.match(onDemandDecisionRules(context),/CURRENT BUYER RELEASE RESTRICTION/);
  assert.deepEqual(mainLineCheckInput(`We'll check whether the ${company.report} covers your reference.`,context).input.buyerReleaseConstraints,{scope:false,approval:true,approver:'engineering',hold:false,unresolved:false});
  assert.ok(onDemandSuggestionProblems(`We'll check whether the ${company.report} covers your reference.`,context).some(reason=>/current restriction/.test(reason)));
  assert.deepEqual(onDemandSuggestionProblems(`We'll check whether the ${company.report} covers your reference and wait for your engineer's approval before sending anything.`,context),[]);
  context.turns.at(-1).text="I can email the drawing. Actually, don't send anything until my engineer approves the drawing revision.";
  assert.deepEqual(onDemandSuggestionProblems("Of course. We'll wait for your engineer's approval before sending anything.",context),[],'The new hold is the one move; the unresolved report question need not be repeated.');
 });
}
test('An incoming email noun is not an outgoing delivery predicate',()=>{
 for(const text of ["We'll be looking out for your email.","We'll be waiting for your drawing.","We'll watch for your reply.","I'll be awaiting your email."]){assert.equal(isAwaitingBuyerDocumentReceipt(text),true,text);assert.equal(hasAffirmativeOutgoingDocumentAction(text),false,text);}
 for(const text of ["We'll read your email.","We'll review the reply.","I'll not send it.","We will not email the report.","We won't send it.","We will not be sending the report."]){assert.equal(hasAffirmativeOutgoingDocumentAction(text),false,text);}
 for(const text of ["We'll read your email and send the report.","We'll be waiting for your drawing, and then email the report.","We will not send it, but email the report.","We won't send it, but will reply with the report.","The report will be emailed.","We'll be sending the report.","We'll be emailing the report."]){assert.equal(hasAffirmativeOutgoingDocumentAction(text),true,text);}
 const context=fixture(companies[0]);context.turns.at(-1).text='Only send the report if it covers the reference. Do not send anything until my engineer approves the drawing.';
 assert.ok(assessReplyVerification("We'll be sending the report.",context).unsupportedClaims.some(claim=>/withheld permission/.test(claim.reason)));
 assert.deepEqual(assessReplyVerification("We will not send anything until your engineer approves.",context).unsupportedClaims,[]);
});
