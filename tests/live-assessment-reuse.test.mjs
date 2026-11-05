import assert from 'node:assert/strict';
import test from 'node:test';
import {LiveCoachingSession} from '../lib/live-coaching-session.ts';
import {assessReplyVerification} from '../lib/turn-verification-policy.ts';
import {defaultConfigurationStages} from '../lib/sales-curriculum.ts';

// Authored fictional snapshots only. This exercise never reads saved calls.
function context(company='Cedar Instruments',product='PX20'){
 return {callId:'synthetic-assessment',manufacturer:{id:company,name:company,products:product},sources:[{id:'scope',text:`Our inspection report explicitly covers ${product}.`},{id:'availability',text:'Inspection reports are available for review.'}],turns:[{id:'pickup',role:'buyer',text:'Morgan speaking.',at:1},{id:'question',role:'buyer',text:`Does your inspection report cover ${product}?`,at:2}],coachingRequest:{id:'one-click',requestedAt:3},callType:'discovery',currentStage:'discovery'};
}
const assess=(say,work)=>LiveCoachingSession.prototype.assessCandidate(say,work);
test('An exact request-local assessment is reused; changed wording and other requests recompute',()=>{
 const work={context:context()},say='Our inspection report covers PX20.';
 const first=assess(say,work);assert.equal(first.locallyVerifiedWholeReply,true);
 assert.strictEqual(assess(say,work),first);
 const changed=assess('Our inspection report covers PX21.',work);
 assert.notStrictEqual(changed,first);assert.ok(changed.unsupportedClaims.length);
 assert.deepEqual(changed,assessReplyVerification('Our inspection report covers PX21.',work.context));
 const another={context:structuredClone(work.context)};
 assert.notStrictEqual(assess(say,another),assess(say,work),'No shared cache even for byte-identical snapshots.');
 const otherCompany={context:context('Imaginary Valve Works','QV80')};
 assert.ok(assess(say,otherCompany).unsupportedClaims.length,'A different company cannot inherit report coverage.');
});
test('In-place source mutations and source completeness invalidate previously supported coverage',()=>{
 const work={context:context()},say='Our inspection report covers PX20.';
 for(const mutate of [
  input=>{input.sources[0].text='Our inspection report does not cover PX20.';},
  input=>{input.sources[0].complete=false;},
 ]){
  work.context=context();const before=assess(say,work);assert.equal(before.locallyVerifiedWholeReply,true);
  mutate(work.context);const after=assess(say,work);
  assert.notStrictEqual(after,before);assert.equal(after.locallyVerifiedWholeReply,false);
  assert.deepEqual(after,assessReplyVerification(say,work.context));
 }
});
test('Current transcript and delivery conditions invalidate an investigation/send assessment',()=>{
 const work={context:context()},say="I'll check whether the inspection report covers PX20. Once that's confirmed, I'll send it over.";
 const first=assess(say,work);assert.equal(first.requiresVerification,false);
 work.context.turns.push({id:'condition',role:'buyer',text:'Only send the inspection report if my engineer approves its coverage.',at:4});
 const changed=assess(say,work);assert.notStrictEqual(changed,first);
 assert.equal(changed.requiresVerification,true);assert.deepEqual(changed,assessReplyVerification(say,work.context));
});
test('Nested current commercial authority and replacement snapshots always participate in the key',()=>{
 const input=context(),stages=defaultConfigurationStages();
 input.sources.push({id:'terms',text:'An approved 5% discount is documented.'});
 input.companyConfiguration={companyId:input.manufacturer.id,versionId:'synthetic-v1',version:1,boundAt:1,selectedStageId:stages[0].id,snapshot:{id:'synthetic-v1',companyId:input.manufacturer.id,version:1,stages,knowledge:[],boundaries:[{id:'discount',text:'The representative may offer the documented 5% discount.',authority:'allowed',scope:'company',action:'discount',status:'active',origin:'manager'}],preferences:[],legacyNotes:[]}};
 const work={context:input},say='We can offer you a 5% discount.';
 const first=assess(say,work);
 work.context.companyConfiguration.snapshot.boundaries[0].authority='approval_required';
 work.context.companyConfiguration.snapshot.boundaries[0].text='Discounts require manager approval.';
 const changed=assess(say,work);assert.notStrictEqual(changed,first);assert.ok(changed.unsupportedClaims.length);
 assert.deepEqual(changed,assessReplyVerification(say,work.context));
 const previous=changed;work.context={...structuredClone(work.context),coachingRequest:{...work.context.coachingRequest,transcriptState:'partial'}};
 assert.notStrictEqual(assess(say,work),previous,'Final/provisional snapshot state cannot inherit an assessment.');
});
function harness(input,afterFirstAssessment){
 const sent=[],shown=[],traces=[],results=[],calls=[];
 const session=new LiveCoachingSession({snapshot:()=>input,latestContext:()=>input,send:event=>sent.push(event),onRequestTrace:event=>traces.push(event),onGuidance:value=>shown.push(value),
  verify:async()=>assert.fail('These exact locally provable or hard-rejected cases need no remote call'),fallback:async()=>assert.fail('Unexpected fallback'),
  onBuyerTurn:()=>{},onSupersede:()=>{},onPendingTurn:()=>{},onThinking:()=>{},onChecking:()=>{},onBuyerPartial:()=>{},onBuyerSpeech:()=>{},onBuyerPending:()=>{},onUsage:()=>{},onWarning:()=>{},onError:message=>assert.fail(message),fallbackAfterMs:10000});
 const original=session.assessCandidate;
 session.assessCandidate=function(say,work){const result=original.call(this,say,work);results.push(result);calls.push(say);if(calls.length===1)afterFirstAssessment?.(work.context);return result;};
 const feed=say=>{session.requestNextMove(input);const request=sent.find(event=>event.type==='response.create');assert.ok(request);session.handle({type:'response.created',response:{id:'response',metadata:request.response.metadata}});session.handle({type:'response.output_text.delta',response_id:'response',delta:`SAY: ${say}\nMOVE: Answer the report question\n`});};
 return {session,sent,shown,traces,results,calls,feed};
}
test('Live complete-SAY pipeline reuses one result and still publishes once before response completion',()=>{
 const t=harness(context());try{
  t.feed('Our inspection report covers PX20.');
  assert.equal(t.shown.length,1);assert.equal(t.shown[0].say,'Our inspection report covers PX20.');assert.equal(t.shown[0].evidence.length,1);
  assert.ok(t.calls.length>=4,'Parsing, sales guard, priming and finishing inspect the actual line.');
  assert.equal(new Set(t.results).size,1,'Identical checks reuse their request-local result.');
  t.session.handle({type:'response.done',response:{id:'response',status:'completed'}});
  assert.equal(t.shown.length,1,'Metadata cannot replace the stable line.');
 }finally{t.session.stop();}
});
test('A source changed between complete-SAY parsing and validation is rejected, never published from cache',()=>{
 const t=harness(context(),input=>{input.sources[0].text='Our inspection report does not cover PX20.';});try{
  t.feed('Our inspection report covers PX20.');
  assert.equal(t.shown.length,0);assert.ok(new Set(t.results).size>=2);
  assert.ok(t.traces.some(event=>event.event==='repair_requested'));
  assert.ok(t.sent.some(event=>event.type==='response.cancel'));
 }finally{t.session.stop();}
});
