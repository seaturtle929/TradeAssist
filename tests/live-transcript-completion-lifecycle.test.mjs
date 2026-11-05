import assert from 'node:assert/strict';
import test from 'node:test';
import {LiveCoachingSession} from '../lib/live-coaching-session.ts';

// Invented in-memory speech and provider events. No recordings, app data or AI.
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function fixture(options={}) {
 const context={callId:'synthetic-finalization',manufacturer:{id:'cedar',name:'Cedar Instruments',products:'inspection instruments'},sources:[{id:'product',text:'PX20 is an inspection instrument.'},{id:'documents',text:'Inspection reports are available.'}],turns:[],callType:'discovery',currentStage:'discovery'};
 const log={sent:[],shown:[],traces:[],queued:[],errors:[],warnings:[]};
 const session=new LiveCoachingSession({snapshot:()=>context,latestContext:()=>context,send:event=>log.sent.push(event),onRequestTrace:event=>log.traces.push(event),onQueuedRequest:event=>log.queued.push(event),
  onGuidance:(value,id,_at,_complete,_latency,trigger,snapshot)=>log.shown.push({value,id,trigger,snapshot}),
  verify:async(_context,value)=>({...value,verified:true}),fallback:async()=>assert.fail('No fallback should be necessary'),
  onBuyerTurn:turn=>context.turns.push({...turn,role:'buyer'}),onAudioIssue:()=>{},onSupersede:()=>{},onPendingTurn:()=>{},onThinking:()=>{},onChecking:()=>{},onBuyerPartial:()=>{},onBuyerSpeech:()=>{},onBuyerPending:()=>{},onUsage:()=>{},onWarning:message=>log.warnings.push(message),onError:message=>log.errors.push(message),
  continuationSettleMs:1,queuedTranscriptionTimeoutMs:20,transcriptionTimeoutMs:200,fallbackAfterMs:10000,...options});
 const creates=()=>log.sent.filter(event=>event.type==='response.create');
 const start=(id='buyer')=>session.handle({type:'input_audio_buffer.speech_started',item_id:id,audio_start_ms:0});
 const stop=(id='buyer')=>session.handle({type:'input_audio_buffer.speech_stopped',item_id:id,audio_end_ms:4000});
 const partial=text=>session.handle({type:'conversation.item.input_audio_transcription.delta',item_id:'buyer',delta:text});
 const final=text=>session.handle({type:'conversation.item.input_audio_transcription.completed',item_id:'buyer',transcript:text});
 const request=()=>session.requestNextMove({...context,coachingRequest:{id:'one-click',requestedAt:Date.now()}});
 const created=()=>{const event=creates().at(-1),id='response-'+event.response.metadata.epoch;session.handle({type:'response.created',response:{id,metadata:event.response.metadata}});return id;};
 const delta=(id,text)=>session.handle({type:'response.output_text.delta',response_id:id,delta:text});
 const finish=(id,say)=>{delta(id,'SAY: '+say+'\nMOVE: Respect the buyer’s selected next step\n');session.handle({type:'response.done',response:{id,status:'completed'}});};
 const cancelled=id=>session.handle({type:'response.done',response:{id,status:'cancelled'}});
 const begin=text=>{start();partial(text);request();stop();};
 return {context,session,log,creates,start,stop,partial,final,request,created,delta,finish,cancelled,begin};
}
const fragment='Hi, this is Morgan. Please email me the inspection report, but first check whether it';
const completed=fragment+' covers PX20 before you send it.';
const answer="I'll check whether the inspection report covers PX20 and let you know before sending it.";

for(const phase of ['before_created','during_generation','before_publication'])test(`One early click follows a changed final clause ${phase}, including after the cutoff`,async()=>{
 const t=fixture();try{
  t.begin('Please send the information.');await sleep(50);
  assert.equal(t.creates().length,1,'Only a hidden generation may begin while the canonical final is missing');
  assert.equal(t.log.traces.filter(event=>event.event==='queue_wait_timeout').length,1);
  let first;
  if(phase!=='before_created'){
   first=t.created();
   if(phase==='during_generation')t.delta(first,'SAY: I understand');
   else t.finish(first,'I understand.');
  }
  assert.equal(t.log.shown.length,0);t.final('Please send the information, but do not send it until I approve it.');
  if(first)t.cancelled(first);
  else{
   const original=t.creates()[0],id='response-'+original.response.metadata.epoch;
   t.session.handle({type:'response.created',response:{id,metadata:original.response.metadata}});t.cancelled(id);
  }
  await sleep(5);assert.equal(t.creates().length,2);
  assert.match(t.creates().at(-1).response.instructions,/do not send it until I approve it/);
  if(first)t.finish(first,'I will send it.');assert.equal(t.log.shown.length,0);
  t.finish(t.created(),"Understood, I won't send anything until you approve it.");
  assert.equal(t.log.shown.length,1);assert.equal(t.log.shown[0].snapshot.coachingRequest.transcriptState,'confirmed');
  assert.equal(t.log.traces.filter(event=>event.event==='queued').length,1,'No second click');
  assert.equal(t.log.traces.filter(event=>event.event==='repair_requested').length,0);
 }finally{t.session.stop();}
});

test('A transcription cutoff is a recoverable status, never a dispatch of the incomplete fragment',async()=>{
 const t=fixture();try{
  t.begin(fragment);await sleep(30);
  assert.equal(t.creates().length,0);assert.equal(t.log.shown.length,0);
  assert.equal(t.log.traces.filter(event=>event.event==='queue_wait_timeout').length,1);
  assert.match(t.log.queued.at(-1).message,/Still transcribing/);
  t.partial(' covers PX20 before you send it.');t.final(completed);await sleep(5);
  assert.equal(t.creates().length,1);assert.match(t.creates()[0].response.instructions,/covers PX20 before you send it/);
  t.finish(t.created(),answer);
  assert.equal(t.log.shown.length,1);assert.equal(t.log.shown[0].snapshot.turns.at(-1).text,completed);
  assert.equal(t.log.shown[0].snapshot.coachingRequest.transcriptState,'confirmed');
  assert.equal(t.log.shown[0].trigger,'one-click');assert.equal(t.log.errors.length,0);
 }finally{t.session.stop();}
});

for(const phase of ['before_created','during_generation','before_publication'])test(`A completed same-item turn refreshes Suggest now ${phase} and keeps one click`,async()=>{
 const t=fixture();try{
  t.begin('Please send the information');t.session.suggestNow();assert.equal(t.creates().length,1);
  let first;
  if(phase!=='before_created'){
   first=t.created();
   if(phase==='during_generation')t.delta(first,'SAY: I understand');
   else{
    const publish=t.session.coordinator.deferPublish.bind(t.session.coordinator);let held;
    t.session.coordinator.deferPublish=(ticket,callback)=>{held=()=>publish(ticket,callback);return true;};
    t.finish(first,'I understand.');assert.equal(t.log.shown.length,0);
    t.session.coordinator.deferPublish=publish;
    t.final('Please do not send anything until I approve it.');await sleep(5);held();
   }
  }
  if(phase!=='before_publication')t.final('Please do not send anything until I approve it.');
  await sleep(5);
  if(first)t.cancelled(first);
  else{
   // The original provider slot may acknowledge creation only after final ASR.
   const original=t.creates()[0],id='response-'+original.response.metadata.epoch;
   t.session.handle({type:'response.created',response:{id,metadata:original.response.metadata}});t.cancelled(id);
  }
  await sleep(5);assert.equal(t.creates().length,2);
  assert.match(t.creates().at(-1).response.instructions,/do not send anything until I approve/);
  if(first)t.finish(first,'I will send it.');assert.equal(t.log.shown.length,0,'Obsolete provider output cannot publish');
  t.finish(t.created(),"Understood, I won't send anything until you approve it.");
  assert.equal(t.log.shown.length,1);assert.equal(t.log.shown[0].snapshot.coachingRequest.transcriptState,'confirmed');
  assert.ok(t.creates().every(event=>event.response.metadata.trigger==='one-click'));
  assert.equal(t.log.traces.filter(event=>event.event==='repair_requested').length,0,'A final transcript refresh is not a verifier repair');
  t.start('later');t.session.handle({type:'conversation.item.input_audio_transcription.completed',item_id:'later',transcript:'Actually, what is the price?'});
  assert.equal(t.log.shown.length,1,'Published wording remains stable');
 }finally{t.session.stop();}
});

test('A long missing-final wait reports its state once and can still recover on the original click',async()=>{
 const t=fixture({transcriptionTimeoutMs:45});try{
  t.begin('Our engineer');await sleep(65);
  assert.equal(t.creates().length,0);assert.equal(t.log.shown.length,0);assert.match(t.log.queued.at(-1).message,/could not finish transcribing/);
  const warnings=t.log.warnings.length;await sleep(20);assert.equal(t.log.warnings.length,warnings,'No repeated deadline loop');
  t.final('Our engineer will email the drawing when it is ready.');await sleep(5);assert.equal(t.creates().length,1);
  t.finish(t.created(),"That works. I'll look at the drawing when it arrives.");assert.equal(t.log.shown.length,1);
 }finally{t.session.stop();}
});

test('An earlier finalized segment cannot invalidate Suggest now for a different unfinished segment',async()=>{
 const t=fixture();try{
  t.start();t.stop();t.final('Please send the inspection report.');t.request();const first=t.created();
  t.start('second');t.session.handle({type:'conversation.item.input_audio_transcription.delta',item_id:'second',delta:'But our engineer'});t.cancelled(first);
  t.session.suggestNow();const current=t.created();t.finish(current,"I'm listening.");
  assert.equal(t.log.shown.length,1);assert.equal(t.log.shown[0].value.say,"I'm listening.");
  assert.equal(t.log.traces.filter(event=>event.event==='turn_continued').length,1,'Only the actual resumed sentence supersedes the first draft');
  t.session.handle({type:'conversation.item.input_audio_transcription.completed',item_id:'second',transcript:'But our engineer must approve before you send it.'});
  assert.equal(t.log.shown.length,1,'The forced displayed cue stays stable after final completion');
 }finally{t.session.stop();}
});

for(const action of ['cancel','stop'])test(`Late completion cannot revive a request after ${action}`,async()=>{
 const t=fixture();try{
  t.begin(fragment);await sleep(25);
  if(action==='stop')t.session.stop();else t.session.cancelQueuedRequest();
  t.final(completed);await sleep(5);assert.equal(t.creates().length,0);assert.equal(t.log.shown.length,0);
 }finally{t.session.stop();}
});
