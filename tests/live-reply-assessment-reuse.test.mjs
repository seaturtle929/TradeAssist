import {assertLocalPressCompletion} from './helpers/local-press-assertions.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import {LiveCoachingSession} from '../lib/live-coaching-session.ts';

// Authored fictional provider events. No recordings, saved calls or paid AI.
function fixture(){
 const context={callId:'synthetic-assessment-reuse',manufacturer:{id:'cedar',name:'Cedar Instruments',products:'inspection instruments'},sources:[{id:'documents',text:'Inspection reports are available.'}],turns:[{id:'buyer',role:'buyer',text:'KM73 is our drawing reference. I will send the drawing. Send the inspection report only if it matches.',at:1}],callType:'solution_discussion',currentStage:'solution_discussion',coachingRequest:{id:'one-press',requestedAt:2}};
 const log={sent:[],shown:[],traces:[],telemetry:[],remoteChecks:0};
 const session=new LiveCoachingSession({snapshot:()=>context,latestContext:()=>context,send:e=>log.sent.push(e),onGuidance:g=>log.shown.push(g),onRequestTrace:e=>log.traces.push(e),onTelemetry:e=>log.telemetry.push(e),verify:async()=>{log.remoteChecks++;assert.fail('Local safe move must not need a remote check');},fallback:async()=>assert.fail('No fallback expected'),onSupersede:()=>{},onPendingTurn:()=>{},onThinking:()=>{},onChecking:()=>{},onBuyerTurn:()=>{},onBuyerPartial:()=>{},onBuyerSpeech:()=>{},onBuyerPending:()=>{},onUsage:()=>{},onWarning:()=>{},onError:e=>assert.fail(e),fallbackAfterMs:10000});
 const create=()=>{const request=log.sent.filter(e=>e.type==='response.create').at(-1),id='response-'+request.response.metadata.epoch+'-'+log.sent.length;session.handle({type:'response.created',response:{id,metadata:request.response.metadata}});return id;};
 const delta=(id,say)=>session.handle({type:'response.output_text.delta',response_id:id,delta:'SAY: '+say+'\nMOVE: Respect the chosen document handoff\n'});
 return {context,log,session,create,delta};
}
const safe="I'll check whether the inspection report covers KM73 and send it only if it matches.";

test('One stable safe reply reuses exact pinned assessments while all move/source checks still run',()=>{
 const t=fixture();try{
  t.session.requestNextMove(t.context);const id=t.create();t.delta(id,safe);
  assert.equal(t.log.shown.length,1);assert.equal(t.log.shown[0].say,safe);assert.equal(t.log.remoteChecks,0);
  const phases=t.log.telemetry.find(e=>e.type==='complete').phases;
  assert.equal(phases.replyAssessmentRuns,1);assert.ok(phases.replyAssessmentCacheHits>=4);
  t.session.handle({type:'response.output_text.delta',response_id:id,delta:'WHY: This metadata must not rewrite the spoken card\n'});
  t.session.handle({type:'response.done',response:{id,status:'completed'}});
  assert.equal(t.log.shown.length,1);assert.equal(t.log.traces.filter(e=>e.event==='published').length,1);
 }finally{t.session.stop();}
});

test('An unsupported coverage draft is blocked; the same press publishes locally without remote repair',()=>{
 const t=fixture();try{t.session.requestNextMove(t.context);const bad=t.create();t.delta(bad,'The inspection report covers KM73.');assertLocalPressCompletion({shown:t.log.shown.map(value=>({value})),traces:t.log.traces},t.log.sent.filter(event=>event.type==='response.create'),'The inspection report covers KM73.');assert.equal(t.log.remoteChecks,0);const phases=t.log.telemetry.find(e=>e.type==='complete').phases;assert.equal(phases.repairCount,0);t.session.handle({type:'response.done',response:{id:bad,status:'cancelled'}});assert.equal(t.log.shown.length,1);}finally{t.session.stop();}
});

test('Assessment reuse is isolated by work, exact wording and replaced pinned evidence',()=>{
 const t=fixture();try{
  t.session.requestNextMove(t.context);const work=[...t.session.works.values()][0];
  const first=t.session.assessReply(work,safe);assert.strictEqual(t.session.assessReply(work,safe),first);
  const claim='The inspection report covers KM73.';
  assert.ok(t.session.assessReply(work,claim).unsupportedClaims.length,'An offer cannot exempt the asserted variant');
  work.context={...work.context,sources:[...work.context.sources,{id:'scope',text:'The inspection report covers KM73.'}]};
  const supported=t.session.assessReply(work,claim);assert.equal(supported.unsupportedClaims.length,0);assert.equal(supported.requiresVerification,false);
  work.context={...work.context,sources:t.context.sources};assert.ok(t.session.assessReply(work,claim).unsupportedClaims.length,'Removing scope evidence forces a fresh decision');
 }finally{t.session.stop();}
});
