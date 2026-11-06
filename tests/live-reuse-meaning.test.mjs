import assert from 'node:assert/strict';
import test from 'node:test';
import {LiveCoachingSession} from '../lib/live-coaching-session.ts';

// Intentionally authored fictional speech/provider events. No saved calls,
// browser storage, network, paid AI, or wall-clock latency claims.
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const buyer="KM73 is the reference on our drawing. I'll email the drawing. Send the inspection report only if it matches.";
const changed=buyer+' Actually, hold sending until our engineer signs off.';
const safe="I'll check whether the inspection report covers KM73 and send it only if it matches.";
const restricted="I'll check whether the inspection report covers KM73; I won't send it unless it matches and your engineer approves.";
const reverse=value=>Array.isArray(value)?value.map(reverse):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).reverse().map(([key,item])=>[key,reverse(item)])):value;

function fixture(){
 const context={callId:'synthetic-reuse-meaning',manufacturer:{id:'sable',name:'Sable Meter Works',products:'industrial meters'},sources:[{id:'documents',title:'Approved document availability',text:'Inspection reports and specification sheets are available.'}],turns:[{id:'question',role:'buyer',text:'Does the inspection report cover KM73?',at:1},{id:'clarify',role:'you',text:'Could you confirm the drawing reference?',at:2}],callType:'solution_discussion',currentStage:'solution_discussion'};
 const log={sent:[],shown:[],traces:[],errors:[],warnings:[],verified:0};let rebuilt=false;
 const payload=(turns=context.turns)=>{const value={...context,turns,callContext:{stageId:'solution_discussion',relationship:'first_contact',goal:'Respect the buyer-chosen document handoff.'}};return rebuilt?reverse(value):value;};
 const session=new LiveCoachingSession({snapshot:()=>payload(),latestContext:turns=>payload(turns),send:event=>log.sent.push(event),onRequestTrace:event=>log.traces.push(event),onGuidance:(value,id,_at,complete,_latency,trigger,snapshot)=>log.shown.push({value,id,complete,trigger,snapshot}),
  verify:async(_context,value)=>{log.verified++;return {...value,verified:true};},fallback:async()=>assert.fail('No fallback expected'),onBuyerTurn:turn=>context.turns.push({...turn,role:'buyer'}),onAudioIssue:()=>{},onSupersede:()=>{},onPendingTurn:()=>{},onThinking:()=>{},onChecking:()=>{},onBuyerPartial:()=>{},onBuyerSpeech:()=>{},onBuyerPending:()=>{},onUsage:()=>{},onWarning:value=>log.warnings.push(value),onError:value=>log.errors.push(value),continuationSettleMs:1,queuedTranscriptionTimeoutMs:200,transcriptionTimeoutMs:2000,fallbackAfterMs:10000});
 const creates=()=>log.sent.filter(event=>event.type==='response.create');
 const start=(id='buyer')=>session.handle({type:'input_audio_buffer.speech_started',item_id:id,audio_start_ms:1000});
 const stop=(id='buyer')=>session.handle({type:'input_audio_buffer.speech_stopped',item_id:id,audio_end_ms:4500});
 const partial=(text,id='buyer')=>session.handle({type:'conversation.item.input_audio_transcription.delta',item_id:id,delta:text});
 const final=(text,id='buyer')=>{rebuilt=true;session.handle({type:'conversation.item.input_audio_transcription.completed',item_id:id,transcript:text});};
 const request=()=>session.requestNextMove({...payload(),coachingRequest:{id:'one-press',requestedAt:Date.now()}});
 const created=(event=creates().at(-1))=>{const id='response-'+event.response.metadata.epoch;session.handle({type:'response.created',response:{id,metadata:event.response.metadata}});return id;};
 const delta=(id,text)=>session.handle({type:'response.output_text.delta',response_id:id,delta:text});
 const finish=(id,say)=>{delta(id,'SAY: '+say+'\nMOVE: Respect the document handoff\n');session.handle({type:'response.done',response:{id,status:'completed'}});};
 const cancel=id=>session.handle({type:'response.done',response:{id,status:'cancelled'}});
 const hidden=async()=>{start();partial(buyer);request();stop();await sleep(50);assert.equal(creates().length,1);assert.equal(log.shown.length,0);};
 const assertStable=say=>{
  assert.equal(log.shown.length,1);assert.equal(log.shown[0].value.say,say);assert.equal(log.shown[0].trigger,'one-press');
  start('later');stop('later');final('Actually, what is your delivery time?','later');
  assert.equal(log.shown.length,1,'Later speech cannot rewrite displayed wording');assert.equal(log.shown[0].value.say,say);
  assert(creates().every(event=>event.response.metadata.trigger==='one-press'));
  assert.equal(log.traces.filter(event=>event.event==='queued').length,1,'One intentional press owns the lifecycle');assert.deepEqual(log.errors,[]);
 };
 return {context,session,log,creates,start,stop,partial,final,request,created,delta,finish,cancel,hidden,assertStable};
}

for(const phase of ['before_response_created','during_generation','before_publication'])test(`Exact completed meaning reuses one hidden draft ${phase}`,async()=>{
 const t=fixture();try{
  await t.hidden();let id;
  if(phase!=='before_response_created'){
   id=t.created();
   if(phase==='during_generation')t.delta(id,'SAY: '+safe.slice(0,30));
   else t.finish(id,safe);
  }
  assert.equal(t.log.shown.length,0);assert.equal(t.log.verified,0);
  t.final(buyer);await sleep(5);assert.equal(t.creates().length,1,'Object field order is not changed meaning');
  if(phase==='before_response_created')t.finish(t.created(),safe);
  else if(phase==='during_generation'){t.delta(id,safe.slice(30)+'\nMOVE: Respect the handoff\n');t.session.handle({type:'response.done',response:{id,status:'completed'}});}
  await sleep(5);assert.equal(t.log.traces.filter(event=>event.event==='speculation_accepted').length,1);assert.equal(t.log.traces.filter(event=>event.event==='repair_requested').length,0);
  assert.equal(t.log.shown[0].snapshot.turns.at(-1).text,buyer);t.assertStable(safe);
 }finally{t.session.stop();}
});

for(const phase of ['before_response_created','during_generation','before_publication'])test(`A changed final approval condition retires the old draft ${phase}`,async()=>{
 const t=fixture();try{
  await t.hidden();const original=t.creates()[0];let id;
  if(phase!=='before_response_created'){
   id=t.created(original);
   if(phase==='during_generation')t.delta(id,'SAY: '+safe.slice(0,30));
   else t.finish(id,safe);
  }
  t.final(changed);
  if(!id)id=t.created(original);
  t.cancel(id);await sleep(5);
  assert.equal(t.creates().length,2);assert.equal(t.log.shown.length,0);assert.match(t.creates().at(-1).response.instructions,/hold sending until our engineer signs off/);
  assert.equal(t.log.traces.filter(event=>event.event==='speculation_accepted').length,0);assert.equal(t.log.traces.filter(event=>event.event==='speculation_discarded').length,1);
  t.finish(id,safe);assert.equal(t.log.shown.length,0,'Obsolete provider events cannot resurrect the old draft');
  t.finish(t.created(),restricted);await sleep(5);assert.equal(t.log.shown[0].snapshot.turns.at(-1).text,changed);
  assert.equal(t.log.traces.filter(event=>event.event==='repair_requested').length,0,'Changed buyer meaning is not a validation repair');t.assertStable(restricted);
 }finally{t.session.stop();}
});

test('Resumed buyer speech retains multiple sentences and full unfamiliar reference on the original press',async()=>{
 const t=fixture();try{
  await t.hidden();const old=t.created();t.delta(old,'SAY: '+safe.slice(0,30));
  t.start('approval');t.cancel(old);t.final(buyer);t.partial('One more thing, do not send anything','approval');t.stop('approval');t.final('One more thing, do not send anything until our engineer approves.','approval');await sleep(5);
  assert.equal(t.creates().length,2);const instructions=t.creates().at(-1).response.instructions;
  assert.match(instructions,/KM73 is the reference on our drawing/);assert.match(instructions,/do not send anything until our engineer approves/);
  t.finish(old,safe);assert.equal(t.log.shown.length,0);t.finish(t.created(),restricted);await sleep(5);assert.equal(t.log.shown.length,1);assert.match(t.log.shown[0].snapshot.turns.map(turn=>turn.text).join(' '),/only if it matches.*engineer approves/);t.assertStable(restricted);
 }finally{t.session.stop();}
});

test('An original-source change prevents exact-text reuse despite equivalent field ordering',async()=>{
 const t=fixture();try{
  await t.hidden();const id=t.created();t.finish(id,safe);
  t.context.sources=[{id:'documents',title:'Approved document availability',text:'Inspection reports require manager approval before sharing.'}];
  t.final(buyer);t.cancel(id);await sleep(5);
  assert.equal(t.log.shown.length,0);assert.equal(t.creates().length,2);assert.equal(t.log.traces.filter(event=>event.event==='speculation_accepted').length,0);
  assert.match(t.creates().at(-1).response.instructions,/require manager approval before sharing/);
  t.finish(id,safe);assert.equal(t.log.shown.length,0,'Old source context cannot regain publication ownership');
 }finally{t.session.stop();}
});

for(const bad of ['The inspection report covers KM73.',"I'll check whether the inspection report covers KM73. We will ship tomorrow."])test(`Reused drafts still block substantive unsupported claims: ${bad}`,async()=>{
 const t=fixture();try{
  await t.hidden();t.finish(t.created(),bad);t.final(buyer);await sleep(5);
  assert.equal(t.log.traces.filter(event=>event.event==='speculation_accepted').length,1,'Candidate reached normal checks after exact final');
  assert.equal(t.log.shown.length,0);assert(t.log.traces.some(event=>event.event==='repair_requested'));
  t.finish(t.created(),safe);await sleep(5);t.assertStable(safe);
 }finally{t.session.stop();}
});
