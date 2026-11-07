import assert from 'node:assert/strict';
import test from 'node:test';
import {LiveCoachingSession} from '../lib/live-coaching-session.ts';

// Authored fictional in-memory controller/button events. No user records, real
// microphone, audio/transcription service or model calls are used in this file.
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function fixture(extra={}) {
 const context={callId:'synthetic-stable-press',manufacturer:{id:'cedar',name:'Cedar Instruments',products:'inspection instruments'},sources:[],turns:[],callType:'discovery',currentStage:'discovery'};
 const log={sent:[],shown:[],traces:[],issues:[],errors:[],queued:[],remote:0,fallback:0,usage:[]};
 const session=new LiveCoachingSession({snapshot:()=>context,latestContext:()=>context,send:event=>log.sent.push(event),
  onGuidance:(value,id,_at,complete,_latency,trigger,snapshot)=>{if(complete)log.shown.push({value,id,trigger,snapshot,at:performance.now()});},
  onRequestTrace:event=>log.traces.push(event),onSuggestionIssue:event=>log.issues.push(event),onQueuedRequest:event=>log.queued.push(event),
  verify:async(_input,value)=>{log.remote++;return {...value,verified:false,verificationStatus:'rejected',caution:'No approved evidence for this claim.'};},
  fallback:async()=>{log.fallback++;assert.fail('Completion must not request a remote fallback.');},
  onBuyerTurn:turn=>context.turns.push({...turn,role:'buyer'}),onAudioIssue:()=>{},onSupersede:()=>{},onPendingTurn:()=>{},onThinking:()=>{},onChecking:()=>{},onBuyerPartial:()=>{},onBuyerSpeech:()=>{},onBuyerPending:()=>{},onUsage:(kind,usage)=>log.usage.push({kind,usage}),onWarning:()=>{},onError:message=>log.errors.push(message),
  continuationSettleMs:1,queuedTranscriptionTimeoutMs:20,pressReplyDeadlineMs:120,...extra});
 const creates=()=>log.sent.filter(event=>event.type==='response.create');
 const request=(id='one-click')=>session.requestNextMove({...context,coachingRequest:{id,requestedAt:Date.now()}});
 const start=(id='buyer')=>session.handle({type:'input_audio_buffer.speech_started',item_id:id,audio_start_ms:0});
 const stop=(id='buyer')=>{const at=performance.now();session.recordBuyerAcousticEnd(id,{atMs:at,basis:'known_audio_cue',resolutionMs:0});session.handle({type:'input_audio_buffer.speech_stopped',item_id:id,audio_end_ms:4000});return at;};
 const partial=(text,id='buyer')=>session.handle({type:'conversation.item.input_audio_transcription.delta',item_id:id,delta:text});
 const final=(text,id='buyer')=>session.handle({type:'conversation.item.input_audio_transcription.completed',item_id:id,transcript:text});
 const buyer=text=>{start();const ended=stop();final(text);return ended;};
 const created=()=>{const event=creates().at(-1),id='response-'+event.response.metadata.epoch;session.handle({type:'response.created',response:{id,metadata:event.response.metadata}});return id;};
 const finish=(say,id=created())=>{session.handle({type:'response.output_text.delta',response_id:id,delta:'SAY: '+say+'\nMOVE: Respect the current request\n'});session.handle({type:'response.done',response:{id,status:'completed'}});return id;};
 return {context,session,log,creates,request,start,stop,partial,final,buyer,created,finish};
}
const check="I'll check whether the report covers XZ51 and get back to you.";
function oneLine(t,origin) {
 assert.equal(t.log.shown.length,1,'One intentional press publishes one complete line');
 assert.equal(t.log.shown[0].value.replyOrigin,origin);
 assert.equal(t.log.shown[0].value.verified,true);
 assert.ok(t.log.shown[0].value.say.trim());
 assert.doesNotMatch(t.log.shown[0].value.say,/Suggestion unavailable|SAY:|MOVE:/i);
 assert.equal(t.log.errors.length,0);assert.equal(t.log.fallback,0);
}

test('A nonassertive coverage check publishes unchanged on the first generated draft',()=>{
 const t=fixture();try{
  t.buyer('My reference is XZ51. Can you check whether your report covers it?');t.request();t.finish(check);
  oneLine(t,'generated');assert.equal(t.log.shown[0].value.say,check);assert.equal(t.log.remote,0);assert.equal(t.creates().length,1);
 }finally{t.session.stop();}
});

test('A rejected unsafe claim completes locally on the same press without another generation',async()=>{
 const t=fixture();try{
  t.buyer('Does the report cover my XZ51 drawing?');t.request();const response=t.finish('The report covers XZ51.');await sleep(5);
  oneLine(t,'local');assert.doesNotMatch(t.log.shown[0].value.say,/report covers XZ51|send/i);assert.equal(t.creates().length,1);
  assert.ok(t.log.issues.some(event=>event.originalSay==='The report covers XZ51.'),'The rejected original remains reviewable');
  t.finish('The report definitely covers XZ51.',response);assert.equal(t.log.shown.length,1,'Late provider output cannot replace the stable local line');
 }finally{t.session.stop();}
});

test('A scoped provider error completes locally instead of calling remote recovery',()=>{
 const t=fixture();try{
  t.buyer('Could you confirm whether the report covers this drawing?');t.request();const create=t.creates()[0];
  t.session.handle({type:'error',error:{event_id:create.event_id,code:'server_error',message:'Authored provider failure'}});
  oneLine(t,'local');assert.equal(t.creates().length,1);
 }finally{t.session.stop();}
});

test('The generation deadline includes observed ASR time and supplies one local line',async()=>{
 const t=fixture({pressReplyDeadlineMs:140});try{
  t.start();t.partial('Could you check');t.request();const ended=t.stop();await sleep(60);
  t.final('Could you check whether the report covers this drawing?');await sleep(110);
  oneLine(t,'local');assert.equal(t.creates().length,1);const elapsed=t.log.shown[0].at-ended;
  assert.ok(elapsed>=120&&elapsed<230,`Speech-end→controller publication ${elapsed.toFixed(1)} ms includes the 60 ms transcription delay`);
  assert.match(t.log.shown[0].value.localReason,/timeout/);
 }finally{t.session.stop();}
});

test('A missing final event finishes as a clarification, never as a guessed final transcript',async()=>{
 const t=fixture({pressReplyDeadlineMs:65});try{
  t.start();t.partial('Send it only if');t.request();t.stop();await sleep(95);
  oneLine(t,'local');assert.equal(t.creates().length,0);
  assert.equal(t.log.shown[0].snapshot.coachingRequest.transcriptState,'partial');assert.equal(t.log.shown[0].snapshot.turns.length,0);
  assert.match(t.log.shown[0].value.localReason,/transcription_incomplete/);
  t.final('Send it only if our engineer approves.');await sleep(5);assert.equal(t.log.shown.length,1);assert.equal(t.creates().length,0);
 }finally{t.session.stop();}
});

test('A press during speech waits for the final changing clause and publishes once',async()=>{
 const t=fixture();try{
  t.start();t.partial('Please send the report');t.request();await sleep(130);
  assert.equal(t.log.shown.length,0,'No deadline may publish while the buyer is speaking');
  t.stop();t.final('Please check whether the report covers XZ51, and send it only if it does and engineering approves.');await sleep(5);
  assert.match(t.creates()[0].response.instructions,/only if it does and engineering approves/);
  t.finish(check);oneLine(t,'generated');assert.match(t.log.shown[0].snapshot.turns.at(-1).text,/engineering approves/);
 }finally{t.session.stop();}
});

for(const phase of ['before_created','during_generation','before_publication'])test(`Late completed speech ${phase} replaces provisional work and keeps the same press`,async()=>{
 const t=fixture({pressReplyDeadlineMs:300});try{
  t.start();t.partial('Please send the report.');t.request();t.stop();await sleep(45);
  assert.equal(t.creates().length,1,'Only speculative hidden generation may use punctuated partial words');
  let first;
  if(phase!=='before_created'){
   first=t.created();
   if(phase==='during_generation')t.session.handle({type:'response.output_text.delta',response_id:first,delta:'SAY: I can'});
   else t.finish('Thanks, I will check that.',first);
  }
  assert.equal(t.log.shown.length,0,'A provisional draft cannot display');
  t.final('Could you check whether the report covers XZ51? Do not send it until it covers XZ51 and engineering approves.');
  const original=t.creates()[0],id=first||'response-'+original.response.metadata.epoch;
  if(!first)t.session.handle({type:'response.created',response:{id,metadata:original.response.metadata}});
  t.session.handle({type:'response.done',response:{id,status:'cancelled'}});await sleep(5);
  assert.equal(t.creates().length,2);assert.match(t.creates().at(-1).response.instructions,/until it covers XZ51 and engineering approves/);
  t.finish(check);oneLine(t,'generated');assert.equal(t.log.traces.filter(event=>event.event==='queued').length,1);
  assert.equal(t.log.traces.filter(event=>event.event==='repair_requested').length,0);
 }finally{t.session.stop();}
});

test('Budget-limited presses queue for completed speech and publish without a provider call',async()=>{
 const t=fixture();try{
  t.start();t.partial('Could you check');t.session.requestLocalNextMove({...t.context,coachingRequest:{id:'budget-click',requestedAt:Date.now()}},'budget_limit');
  assert.equal(t.log.shown.length,0);t.stop();t.final('Could you check whether the report covers this drawing?');await sleep(5);
  oneLine(t,'local');assert.equal(t.creates().length,0);assert.match(t.log.shown[0].value.localReason,/budget_limit/);
 }finally{t.session.stop();}
});

for(const action of ['cancel','stop'])test(`Explicit ${action} prevents late local completion`,async()=>{
 const t=fixture({pressReplyDeadlineMs:40});try{
  t.start();t.partial('Our engineer');t.request();t.stop();
  if(action==='cancel')t.session.cancelQueuedRequest();else t.session.stop();
  await sleep(70);t.final('Our engineer will send it later.');await sleep(5);assert.equal(t.log.shown.length,0);
 }finally{t.session.stop();}
});


test('A queued local-only press cannot speculate a paid response from a complete-looking partial',async()=>{
 const t=fixture({pressReplyDeadlineMs:300});try{
  t.start();t.partial('Please check the report.');t.session.requestLocalNextMove({...t.context,coachingRequest:{id:'offline-complete-looking',requestedAt:Date.now()}},'budget_limit');t.stop();await sleep(65);
  assert.equal(t.creates().length,0,'The local-only decision also applies to hidden speculation');assert.equal(t.log.shown.length,0);
  t.final('Please check whether the report covers our drawing.');await sleep(5);oneLine(t,'local');assert.equal(t.creates().length,0);
 }finally{t.session.stop();}
});

test('Late usage after a local completion is retained exactly once and cannot replace wording',()=>{
 const t=fixture();try{
  t.buyer('Could you check the report?');t.request();const response=t.created();const create=t.creates()[0];
  t.session.handle({type:'error',error:{event_id:create.event_id,code:'server_error',message:'Authored error'}});oneLine(t,'local');const spoken=t.log.shown[0].value.say;
  const done={type:'response.done',response:{id:response,status:'cancelled',usage:{total_tokens:42}}};t.session.handle(done);t.session.handle(done);
  assert.deepEqual(t.log.usage,[{kind:'live',usage:{total_tokens:42}}]);assert.equal(t.log.shown.length,1);assert.equal(t.log.shown[0].value.say,spoken);
 }finally{t.session.stop();}
});

for(const phase of ['during_speech','after_speech_before_final'])test(`An obsolete provider error ${phase} cannot strand a continued original press`,async()=>{
 const t=fixture({pressReplyDeadlineMs:350});try{
  t.buyer('Could you check the report?');t.request();const firstCreate=t.creates()[0],old=t.created();
  t.start('continued');t.partial('And please include','continued');
  if(phase==='after_speech_before_final')t.stop('continued');
  t.session.handle({type:'error',error:{event_id:firstCreate.event_id,response_id:old,code:'server_error',message:'Failure of obsolete generation'}});
  assert.equal(t.log.shown.length,0);
  if(phase==='during_speech')t.stop('continued');
  t.final('And please check whether it matches our drawing, but do not send it until engineering approves.','continued');
  t.session.handle({type:'response.done',response:{id:old,status:'cancelled'}});await sleep(5);
  assert.equal(t.creates().length,2,'Continuation, not another button press or error-repair generation');
  assert.match(t.creates()[1].response.instructions,/do not send it until engineering approves/);
  t.finish("I'll check the details and get back to you.");oneLine(t,'generated');assert.equal(t.log.shown[0].trigger,'one-click');
 }finally{t.session.stop();}
});


test('An error in hidden provisional generation waits for the completed turn and does not open another model call',async()=>{
 const t=fixture({pressReplyDeadlineMs:350});try{
  t.start();t.partial('Could you check the report?');t.request();t.stop();await sleep(50);assert.equal(t.creates().length,1);
  const create=t.creates()[0],response=t.created();t.session.handle({type:'error',error:{event_id:create.event_id,code:'server_error',message:'Authored hidden error'}});
  assert.equal(t.log.shown.length,0);t.final('Could you check the report? Do not send it unless it matches and I approve.');t.session.handle({type:'response.done',response:{id:response,status:'cancelled'}});await sleep(5);
  oneLine(t,'local');assert.equal(t.creates().length,1);assert.match(t.log.shown[0].snapshot.turns.at(-1).text,/unless it matches and I approve/);
 }finally{t.session.stop();}
});

test('Final speech immediately before local publication refreshes context without another model call',async()=>{
 const t=fixture({pressReplyDeadlineMs:350});try{
  t.start();t.partial('Could you check the report');t.request();t.stop();t.session.suggestNow();const create=t.creates()[0],response=t.created();
  const publish=t.session.coordinator.deferPublish.bind(t.session.coordinator);let held;t.session.coordinator.deferPublish=(ticket,callback)=>{held=()=>publish(ticket,callback);return true;};
  t.session.handle({type:'error',error:{event_id:create.event_id,code:'server_error',message:'Authored error before final'}});assert.equal(t.log.shown.length,0);
  t.session.coordinator.deferPublish=publish;
  t.final('Could you check the report? Do not send it unless it matches and engineering approves.');t.session.handle({type:'response.done',response:{id:response,status:'cancelled'}});await sleep(5);held();
  oneLine(t,'local');assert.equal(t.creates().length,1,'The local decision survives transcript refresh');assert.match(t.log.shown[0].snapshot.turns.at(-1).text,/engineering approves/);
 }finally{t.session.stop();}
});

for(const failure of ['rejection','exception','timeout'])test(`A substantive source-check ${failure} still completes the original press locally`,async()=>{
 let checks=0;
 const t=fixture({pressReplyDeadlineMs:100,verify:async(_context,value)=>{checks++;if(failure==='timeout')return new Promise(()=>{});if(failure==='exception')throw new Error('Authored checker unavailable');return {...value,verified:false,verificationStatus:'rejected',caution:'The source does not establish unrestricted access.'};}});
 try{
  t.context.sources=[{id:'technical',original:true,complete:true,text:'PX20 has a removable side cover for maintenance access to the spring.'}];
  t.buyer('Can I get at the spring from the side of PX20?');t.request();t.finish('PX20 supports unrestricted spring access from the side.');
  await sleep(failure==='timeout'?130:5);oneLine(t,'local');assert.equal(checks,1);assert.equal(t.creates().length,1);
  assert.doesNotMatch(t.log.shown[0].value.say,/unrestricted|supports|PX20/);
 }finally{t.session.stop();}
});

test('A synchronous provider-send failure still publishes a local completion',()=>{
 let sends=0;const t=fixture({send:event=>{if(event.type==='response.create'){sends++;throw new Error('Authored closed data channel');}}});try{
  t.buyer('Could you check whether the report covers the drawing?');t.request();oneLine(t,'local');assert.equal(sends,1);
 }finally{t.session.stop();}
});
