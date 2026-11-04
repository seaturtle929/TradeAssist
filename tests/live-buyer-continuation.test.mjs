import assert from 'node:assert/strict';
import test from 'node:test';
import {LiveCoachingSession} from '../lib/live-coaching-session.ts';
import {buyerTurnDetection,buyerVadSilenceMs} from '../lib/turn-detection.ts';
import {CoachingPhaseClock} from '../lib/coaching-timing.ts';

// Fictional in-memory speech/provider events only. No audio service or storage.
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function fixture(options={}) {
 const context={callId:'synthetic-continuation',manufacturer:{id:'cedar',name:'Cedar Instruments',products:'inspection instruments'},sources:[],turns:[],callType:'discovery',currentStage:'discovery'};
 const log={sent:[],shown:[],traces:[],statuses:[],phases:[],warnings:[]};let order=0;
 const session=new LiveCoachingSession({snapshot:()=>context,latestContext:()=>context,send:event=>log.sent.push(event),onRequestTrace:event=>log.traces.push(event),onQueuedRequest:event=>log.statuses.push(event),
  onGuidance:(value,id,at,complete,_latency,trigger,snapshot)=>log.shown.push({value,id,complete,trigger,snapshot}),onTelemetry:event=>log.phases.push(event.phases),
  verify:async(_context,value)=>({...value,verified:true}),fallback:async()=>assert.fail('Unexpected fallback'),
  onBuyerTurn:turn=>context.turns.push({...turn,role:'buyer'}),onAudioIssue:()=>{},onSupersede:()=>{},onPendingTurn:()=>{},onThinking:()=>{},onChecking:()=>{},onBuyerPartial:()=>{},onBuyerSpeech:()=>{},onBuyerPending:()=>{},onUsage:()=>{},onWarning:message=>log.warnings.push(message),onError:message=>assert.fail(message),
  continuationSettleMs:1,queuedTranscriptionTimeoutMs:35,transcriptionTimeoutMs:1000,fallbackAfterMs:10000,...options});
 const creates=()=>log.sent.filter(event=>event.type==='response.create');
 const start=id=>session.handle({type:'input_audio_buffer.speech_started',item_id:id,audio_start_ms:order++*3000});
 const end=(id,text)=>{session.handle({type:'input_audio_buffer.speech_stopped',item_id:id,audio_end_ms:order*3000-250});session.handle({type:'conversation.item.input_audio_transcription.completed',item_id:id,transcript:text});};
 const partial=(id,text)=>session.handle({type:'conversation.item.input_audio_transcription.delta',item_id:id,delta:text});
 const buyer=(id,text)=>{start(id);end(id,text);};
 const request=()=>session.requestNextMove({...context,coachingRequest:{id:'one-click',requestedAt:Date.now()}});
 const created=()=>{const event=creates().at(-1),id='response-'+event.response.metadata.epoch;session.handle({type:'response.created',response:{id,metadata:event.response.metadata}});return id;};
 const finish=(id,say)=>{session.handle({type:'response.output_text.delta',response_id:id,delta:'SAY: '+say+'\nMOVE: Respect the chosen next step\n'});session.handle({type:'response.done',response:{id,status:'completed'}});};
 const cancelled=id=>session.handle({type:'response.done',response:{id,status:'cancelled'}});
 return {context,session,log,creates,start,end,partial,buyer,request,created,finish,cancelled};
}

test('Computer VAD uses a shared 200 ms pause; microphone modes stay at 400 ms and cannot auto-generate',()=>{
 for(const mode of ['computer','speakerphone','headset']){
  const config=buyerTurnDetection(mode);assert.equal(config.silence_duration_ms,buyerVadSilenceMs(mode));assert.equal(config.silence_duration_ms,mode==='computer'?200:400);assert.equal(config.create_response,false);assert.equal(config.interrupt_response,false);
 }
});

test('A resumed sentence with trailing negation cancels only the unpublished draft and keeps one original click',async()=>{
 const t=fixture();try{
  t.buyer('first','Please send the information.');t.request();const first=t.created();
  t.session.handle({type:'response.output_text.delta',response_id:first,delta:'SAY: I will send'});
  t.start('qualification');t.partial('qualification','Actually, do not');
  assert.equal(t.log.shown.length,0);assert.equal(t.log.traces.filter(event=>event.event==='turn_continued').length,1);assert.equal(t.log.statuses.at(-1)?.status,'listening');
  t.finish(first,'I will send the information.');assert.equal(t.log.shown.length,0,'Cancelled text cannot reach the spoken card');
  t.end('qualification','Actually, do not send anything until I approve it.');await sleep(5);
  assert.equal(t.creates().length,2);assert.ok(t.creates().every(event=>event.response.metadata.trigger==='one-click'));
  assert.match(t.creates().at(-1).response.instructions,/Actually, do not send anything until I approve it/);
  const second=t.created();t.finish(second,"Understood, I won't send anything until you approve it.");
  assert.equal(t.log.shown.length,1);assert.match(t.log.shown[0].value.say,/won't send/);assert.equal(t.log.shown[0].snapshot.turns.length,2);
  assert.equal(t.log.phases.at(-1).repairCount,0);assert.equal(t.log.phases.at(-1).continuedDrafts,1);
  assert.ok(t.log.phases.at(-1).queueWaitMs>=0);assert.ok(t.log.phases.at(-1).dispatchPreparationMs>=0);
 }finally{t.session.stop();}
});

test('Several buyer sentences and a new question stay in the original queued intent',async()=>{
 const t=fixture();try{
  t.start('drawing');t.partial('drawing','Our engineer');assert.equal(t.request().queued,true);
  t.end('drawing','Our engineer is finishing the drawing.');await sleep(5);const first=t.created();
  t.start('route');t.cancelled(first);t.end('route','I prefer email when it is ready. What will you do with the drawing?');await sleep(5);
  assert.equal(t.creates().length,2);const released=t.log.traces.filter(event=>event.event==='queue_released').at(-1);
  assert.deepEqual(released.snapshot.turns.map(turn=>turn.text),['Our engineer is finishing the drawing.','I prefer email when it is ready. What will you do with the drawing?']);
  assert.equal(released.focus.text,'I prefer email when it is ready. What will you do with the drawing?');
  assert.equal(t.log.traces.filter(event=>event.event==='repair_requested').length,0);
  assert.equal(new Set(t.log.traces.map(event=>event.requestId)).size,1);
 }finally{t.session.stop();}
});

test('A final transcript replaces a contrary partial before the only dispatch',async()=>{
 const t=fixture();try{
  t.start('revised');t.partial('revised','You can send it');t.request();t.end('revised','You cannot send it until I approve.');await sleep(5);
  assert.equal(t.creates().length,1);assert.doesNotMatch(t.creates()[0].response.instructions,/You can send it/);assert.match(t.creates()[0].response.instructions,/You cannot send it until I approve/);
 }finally{t.session.stop();}
});

test('Published wording remains unchanged when the buyer resumes or asks another question',()=>{
 const t=fixture();try{
  t.buyer('close','Thank you, goodbye.');t.request();const response=t.created();t.finish(response,'Thank you, goodbye.');assert.equal(t.log.shown.length,1);
  t.buyer('new-question','One more thing: what is the price?');
  assert.equal(t.creates().length,1);assert.equal(t.log.shown.length,1);assert.equal(t.log.traces.filter(event=>event.event==='turn_continued').length,0);
 }finally{t.session.stop();}
});

test('An interrupted request keeps bounded missing-final handling, explicit Suggest now and cancellation',async()=>{
 for(const action of ['timeout','suggest_now','cancel']){
  const t=fixture();try{
   t.buyer('first','Please send the information.');t.request();const first=t.created();t.start('continued');t.cancelled(first);t.partial('continued','Actually, before');
   if(action==='cancel'){assert.equal(t.session.cancelQueuedRequest(),true);t.end('continued','Actually, before you send it, let me approve it.');await sleep(45);assert.equal(t.creates().length,1);}
   else if(action==='suggest_now'){t.session.suggestNow();assert.equal(t.creates().length,2);assert.equal(t.log.traces.filter(event=>event.event==='queue_released').at(-1).reason,'suggest_now');}
   else{t.session.handle({type:'input_audio_buffer.speech_stopped',item_id:'continued'});await sleep(45);assert.equal(t.creates().length,2);assert.equal(t.log.traces.filter(event=>event.event==='queue_released').at(-1).reason,'transcription_timeout');assert.equal(t.log.warnings.length,1);}
  }finally{t.session.stop();}
 }
});

test('Preparation telemetry separates queued listening from synchronous dispatch work',()=>{
 let now=100;const clock=new CoachingPhaseClock(0,()=>now);clock.prepared(7,93,2);now=112;clock.providerStarted(500);const phases=clock.snapshot();
 assert.equal(phases.preparationMs,112);assert.equal(phases.dispatchPreparationMs,19);assert.equal(phases.queueWaitMs,93);assert.equal(phases.continuedDrafts,2);assert.equal(phases.repairCount,0);
});


test('A third sentence during the provider cancellation-ack gap replaces the undispatched snapshot',async()=>{
 const t=fixture();try{
  t.buyer('one','Please send the information.');t.request();const first=t.created();
  t.start('two');t.end('two','Include the drawing.');await sleep(5);
  assert.equal(t.creates().length,1,'The old provider cancellation is still unacknowledged');
  t.start('three');t.end('three','Actually, do not send anything until I approve it.');await sleep(5);
  assert.equal(t.creates().length,1);t.cancelled(first);
  assert.equal(t.creates().length,2,'Only the latest continued snapshot can dispatch after cancellation');
  assert.match(t.creates().at(-1).response.instructions,/Actually, do not send anything until I approve it/);
  const requested=t.log.traces.filter(event=>event.event==='requested').at(-1);
  assert.deepEqual(requested.snapshot.turns.map(turn=>turn.text),['Please send the information.','Include the drawing.','Actually, do not send anything until I approve it.']);
  assert.equal(requested.focus.text,'Actually, do not send anything until I approve it.');
  t.finish(t.created(),"Understood, I won't send anything until you approve it.");
  assert.equal(t.log.shown.length,1);assert.match(t.log.shown[0].value.say,/won't send/);
  assert.equal(t.log.traces.filter(event=>event.status==='pending_dispatch_requeued').length,1);
  assert.equal(t.log.phases.at(-1).continuedDrafts,1,'An undispatched snapshot is not another cancelled model draft');
  assert.equal(t.log.phases.at(-1).repairCount,0);assert.equal(new Set(t.log.traces.map(event=>event.requestId)).size,1);
 }finally{t.session.stop();}
});
