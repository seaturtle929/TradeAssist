import assert from 'node:assert/strict';
import test from 'node:test';
import {LiveCoachingSession} from '../lib/live-coaching-session.ts';
import {applyCoachingConfiguration} from '../lib/coaching-configuration.ts';
import {configurationStageMap} from '../lib/company-configuration.ts';
import {buildBrainRequest,ensureCompanyBrain} from '../lib/company-brain.ts';
import {deriveConversationState} from '../lib/conversation-state.ts';
import {generationFoundationFor} from '../lib/generation-foundation.ts';
import {defaultGeneralPlaybook,buildGeneralPlaybookRequest} from '../lib/general-playbook.ts';
import {defaultConfigurationStages} from '../lib/sales-curriculum.ts';

// Deliberately fictional in-memory events; never reads app storage or calls AI.
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function fixture(options={}) {
 const context={callId:'synthetic-speculation',manufacturer:{id:'cedar',name:'Cedar Instruments',products:'inspection instruments'},sources:[],turns:[],callType:'discovery',currentStage:'discovery'};
 const log={sent:[],shown:[],traces:[],statuses:[],phases:[],warnings:[],verified:[]};let clock=0;
 const payload=options.payload||((turns=context.turns)=>({...context,turns}));
 const session=new LiveCoachingSession({snapshot:()=>payload(),latestContext:turns=>payload(turns),send:event=>log.sent.push(event),onRequestTrace:event=>log.traces.push(event),onQueuedRequest:event=>log.statuses.push(event),
  onGuidance:(value,id,at,complete,_latency,trigger,snapshot)=>log.shown.push({value,id,complete,trigger,snapshot}),onTelemetry:event=>log.phases.push(event.phases),
  verify:async(context,value)=>{log.verified.push(context);return {...value,verified:true};},fallback:async()=>assert.fail('Unexpected fallback'),
  onBuyerTurn:turn=>context.turns.push({...turn,role:'buyer'}),onAudioIssue:()=>{},onSupersede:()=>{},onPendingTurn:()=>{},onThinking:()=>{},onChecking:()=>{},onBuyerPartial:()=>{},onBuyerSpeech:()=>{},onBuyerPending:()=>{},onUsage:()=>{},onWarning:message=>log.warnings.push(message),onError:message=>assert.fail(message),
  continuationSettleMs:1,queuedTranscriptionTimeoutMs:200,transcriptionTimeoutMs:2000,fallbackAfterMs:10000,...options});
 const creates=()=>log.sent.filter(event=>event.type==='response.create');
 const start=id=>session.handle({type:'input_audio_buffer.speech_started',item_id:id,audio_start_ms:clock++*3000});
 const stop=id=>session.handle({type:'input_audio_buffer.speech_stopped',item_id:id,audio_end_ms:clock*3000-250});
 const partial=(id,text)=>session.handle({type:'conversation.item.input_audio_transcription.delta',item_id:id,delta:text});
 const final=(id,text,extra={})=>session.handle({type:'conversation.item.input_audio_transcription.completed',item_id:id,transcript:text,...extra});
 const request=()=>session.requestNextMove({...payload(),coachingRequest:{id:'one-click',requestedAt:Date.now()}});
 const created=()=>{const event=creates().at(-1),id='response-'+event.response.metadata.epoch;session.handle({type:'response.created',response:{id,metadata:event.response.metadata}});return id;};
 const finish=(id,say)=>{session.handle({type:'response.output_text.delta',response_id:id,delta:'SAY: '+say+'\nMOVE: Respect the chosen next step\n'});session.handle({type:'response.done',response:{id,status:'completed'}});};
 const cancelled=id=>session.handle({type:'response.done',response:{id,status:'cancelled'}});
 const speculate=async text=>{start('buyer');request();stop('buyer');partial('buyer',text);await sleep(45);assert.equal(creates().length,1,'Exactly one hidden generation starts');};
 return {context,session,log,creates,start,stop,partial,final,request,created,finish,cancelled,speculate};
}

test('Exact final recognition reuses one hidden generation; no canonical turn, validation or display before final',async()=>{
 const t=fixture();try{
  await t.speculate('Thank you, goodbye.');const id=t.created();t.finish(id,'Thank you, goodbye.');
  assert.equal(t.context.turns.length,0);assert.equal(t.log.shown.length,0);assert.equal(t.log.verified.length,0);
  const rawTime=t.session.works.values().next().value.phaseClock.snapshot().providerCompleteMs;
  await sleep(10);t.final('buyer','Thank you, goodbye.');await sleep(5);
  assert.equal(t.creates().length,1);assert.equal(t.log.shown.length,1);assert.equal(t.log.shown[0].snapshot.turns[0].text,'Thank you, goodbye.');
  assert.equal(t.log.traces.filter(event=>event.event==='speculation_accepted').length,1);
  assert.equal(t.log.phases.at(-1).providerCompleteMs,rawTime,'Final-transcript hold is not provider generation time');
  assert.equal(t.log.phases.at(-1).speculativeGenerations,1);assert.equal(t.log.phases.at(-1).discardedSpeculations,0);assert.equal(t.log.phases.at(-1).repairCount,0);
 }finally{t.session.stop();}
});

for(const [partial,final] of [
 ['You can send the information.','You cannot send the information.'],
 ['Please send the information.','Please send the information, but not until I approve it.'],
 ['Thank you, goodbye.','Thank you. What is the price?'],
])test(`Changed final meaning discards hidden wording: ${final}`,async()=>{
 const t=fixture();try{
  await t.speculate(partial);const old=t.created();t.finish(old,'Thank you, goodbye.');t.final('buyer',final);await sleep(5);
  assert.equal(t.log.shown.length,0);assert.equal(t.creates().length,2);assert.match(t.creates().at(-1).response.instructions,new RegExp(final.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  assert.equal(t.log.traces.filter(event=>event.event==='speculation_discarded').length,1);assert.equal(t.log.traces.filter(event=>event.event==='repair_requested').length,0);
  assert.ok(t.creates().every(event=>event.response.metadata.trigger==='one-click'));
 }finally{t.session.stop();}
});

test('A resumed sentence cancels speculation and keeps all final qualification under the original click',async()=>{
 const t=fixture();try{
  await t.speculate('Please send the information.');const old=t.created();t.start('qualifier');t.cancelled(old);t.final('buyer','Please send the information.');t.stop('qualifier');t.final('qualifier','Actually, do not send anything until I approve it.');await sleep(5);
  assert.equal(t.creates().length,2);assert.match(t.creates().at(-1).response.instructions,/do not send anything until I approve/);assert.equal(t.log.shown.length,0);
  t.finish(old,'I will send it.');assert.equal(t.log.shown.length,0,'Late obsolete provider events cannot publish');
  t.finish(t.created(),"I won't send anything until you approve it.");assert.equal(t.log.shown.length,1);assert.equal(t.log.phases.at(-1).discardedSpeculations,1);
  t.start('later');t.stop('later');t.final('later','One more thing, what is the price?');assert.equal(t.log.shown.length,1,'Published reply remains stable');
 }finally{t.session.stop();}
});

test('Final arrives before response.created: one retained request still publishes from the canonical final',async()=>{
 const t=fixture();try{
  await t.speculate('Thank you, goodbye.');t.final('buyer','Thank you, goodbye.');await sleep(5);assert.equal(t.creates().length,1);
  t.finish(t.created(),'Thank you, goodbye.');assert.equal(t.log.shown.length,1);assert.equal(t.log.shown[0].snapshot.turns.length,1);
 }finally{t.session.stop();}
});

test('Rep speech changes relevant context and invalidates a hidden candidate',async()=>{
 const t=fixture();try{
  await t.speculate('Thank you, goodbye.');t.finish(t.created(),'Thank you, goodbye.');t.context.turns.push({id:'rep',role:'you',text:'Before you go, I need to correct my last statement.',at:Date.now()+10});t.final('buyer','Thank you, goodbye.');await sleep(5);
  assert.equal(t.creates().length,2);assert.equal(t.log.shown.length,0);assert.match(t.creates().at(-1).response.instructions,/correct my last statement/);
 }finally{t.session.stop();}
});

test('Missing final is bounded and never promotes the provisional complete-looking words',async()=>{
 const t=fixture({queuedTranscriptionTimeoutMs:80,transcriptionTimeoutMs:130});try{
  await t.speculate('Thank you, goodbye.');const old=t.created();t.finish(old,'Thank you, goodbye.');await sleep(110);
  assert.equal(t.log.shown.length,1);assert.equal(t.log.shown[0].value.say,'Sorry, could you repeat that last part?');assert.equal(t.log.shown[0].value.replyOrigin,'local');
  assert.equal(t.creates().length,1,'The failed final does not add another provider request');assert.equal(t.log.traces.filter(event=>event.event==='queue_released').length,1);
  assert.equal(t.log.traces.findLast(event=>event.event==='queue_wait_timeout').status,'local_clarification');
  assert.equal(t.context.turns.length,0);assert.equal(t.log.traces.filter(event=>event.event==='speculation_discarded').length,1);
 }finally{t.session.stop();}
});

test('Incomplete text and mixed microphone audio never start hidden generation',()=>{
 for(const opts of [{},{onAudioIssue:undefined}]){
  const t=fixture(opts);try{t.start('buyer');t.request();t.stop('buyer');t.partial('buyer',opts.onAudioIssue===undefined&&Object.keys(opts).length?'Thank you, goodbye.':'Our engineer');assert.equal(t.creates().length,0);}finally{t.session.stop();}
 }
});

function productionFixture(){
 const company={id:'cedar',name:'Cedar Instruments',products:'inspection instruments',introduction:'',sources:[]};
 const knowledge=[{id:'identity',kind:'identity',text:'Cedar Instruments supplies inspection instruments.',origin:'manager',status:'active',updatedAt:1},{id:'docs',kind:'other',text:'Company profiles and inspection reports are available.',origin:'manager',status:'active',updatedAt:1}];
 const version={id:'cedar-v1',companyId:'cedar',version:1,activatedAt:1,knowledge,stages:defaultConfigurationStages(),boundaries:[],preferences:[],legacyNotes:[]};
 let binding={companyId:'cedar',versionId:version.id,version:1,boundAt:1,selectedStageId:'discovery',snapshot:version};
 const playbook=defaultGeneralPlaybook(1),companyBrain=ensureCompanyBrain(company);let t;const memories=[];
 const payload=(turns=t.context.turns)=>{
  const callContext={stageId:'discovery',relationship:'first_contact',background:'A representative is returning an inquiry.',knownFacts:'',doNotGuess:'',goal:'Understand requirements.'};
  const stageMap=configurationStageMap(binding.snapshot,{includeRetired:true});
  const conversationState=deriveConversationState({callId:t.context.callId,turns,callContext,stageMap,companyConfiguration:binding});
  const foundation=generationFoundationFor({manufacturer:company,callContext,conversationState,turns,callType:'discovery',foundationPlaybook:playbook.foundation,companyConfiguration:binding});
  const brain=buildBrainRequest(company,'Fictional Buyer',conversationState,turns,foundation.momentType);memories.push(brain.buyerMemory.updatedAt);
  return applyCoachingConfiguration({...t.context,mode:'coach',companyConfiguration:binding,foundation,foundationPlaybook:playbook.foundation,generalPlaybook:buildGeneralPlaybookRequest(playbook,{company,state:conversationState,turns}),brain,conversationState,callContext,stageMap,exampleLines:companyBrain.playbook.examples,voice:{tone:'natural',notes:'',examples:[],avoid:[]},buyer:'Fictional Buyer',goal:'Understand requirements.',bilingual:false,buyerBrief:null,recentReplies:[],turns});
 };
 t=fixture({payload});return {...t,memories,changeBoundary(){binding=structuredClone(binding);binding.versionId='cedar-v2';binding.version=2;binding.snapshot.id='cedar-v2';binding.snapshot.version=2;binding.snapshot.boundaries.push({id:'no-report',text:'Do not send reports without manager approval.',authority:'approval_required',scope:'company',status:'active',origin:'manager',action:'other'});}};
}

test('Production-shaped payload rebuild with fresh Brain clocks reuses exact-final candidate',async()=>{
 const t=productionFixture();try{
  await t.speculate('Thank you, goodbye.');t.finish(t.created(),'Thank you, goodbye.');await sleep(10);t.final('buyer','Thank you, goodbye.');await sleep(5);
  assert.ok(new Set(t.memories).size>1,'Rebuild actually changed generated Brain timestamps');
  assert.equal(t.creates().length,1);assert.equal(t.log.traces.filter(event=>event.event==='speculation_accepted').length,1);assert.equal(t.log.shown.length,1);
 }finally{t.session.stop();}
});

test('A fresh authority/version change cannot be overwritten by queued click configuration',async()=>{
 const t=productionFixture();try{
  await t.speculate('Thank you, goodbye.');t.finish(t.created(),'Thank you, goodbye.');t.changeBoundary();t.final('buyer','Thank you, goodbye.');await sleep(5);
  assert.equal(t.log.shown.length,0);assert.equal(t.creates().length,2);assert.match(t.creates().at(-1).response.instructions,/Do not send reports without manager approval/);assert.match(t.creates().at(-1).response.instructions,/cedar-v2/);
  assert.equal(t.log.traces.filter(event=>event.event==='speculation_discarded').length,1);
 }finally{t.session.stop();}
});

test('An uncertain/failed final and explicit cancel never publish the hidden complete candidate',async()=>{
 for(const action of ['failed','uncertain','cancel']){
  const t=fixture({queuedTranscriptionTimeoutMs:80});try{
   await t.speculate('Thank you, goodbye.');const id=t.created();t.finish(id,'Thank you, goodbye.');
   if(action==='cancel')t.session.cancelQueuedRequest();
   else if(action==='failed')t.session.handle({type:'conversation.item.input_audio_transcription.failed',item_id:'buyer'});
   else t.final('buyer','Thank you, goodbye.',{logprobs:[{token:'Thank',logprob:-5},{token:' you,',logprob:-5},{token:' goodbye.',logprob:-5}]});
   await sleep(90);assert.equal(t.log.shown.length,0);assert.equal(t.log.traces.filter(event=>event.event==='speculation_accepted').length,0);assert.equal(t.log.traces.filter(event=>event.event==='speculation_discarded').length,1);
   if(action==='cancel')assert.equal(t.creates().length,1);
  }finally{t.session.stop();}
 }
});

test('A factual candidate cannot start its external verifier until its canonical final is accepted',async()=>{
 const t=fixture();try{
  t.context.sources=[{id:'coverage',title:'Approved inspection report',text:'The inspection report covers PX20. It records inspection of the tested sample.'}];
  await t.speculate('Does the inspection report cover PX20?');t.finish(t.created(),'The inspection report covers PX20. It documents inspection of the tested sample.');assert.equal(t.log.verified.length,0);assert.equal(t.log.shown.length,0);
  t.final('buyer','Does the inspection report cover PX20?');await sleep(20);
  assert.equal(t.creates().length,1);assert.equal(t.log.verified.length,1);assert.equal(t.log.verified[0].turns[0].text,'Does the inspection report cover PX20?');assert.equal(t.log.shown.length,1);
 }finally{t.session.stop();}
});

test('Closed source proof waits for canonical final, then publishes with its original citation and no redundant model verification',async()=>{
 const t=fixture();try{
  const source={id:'coverage',title:'Approved inspection report',text:'The inspection report covers PX20.'};t.context.sources=[source];
  await t.speculate('Does the inspection report cover PX20?');t.finish(t.created(),source.text);
  assert.equal(t.log.verified.length,0);assert.equal(t.log.shown.length,0);
  t.final('buyer','Does the inspection report cover PX20?');await sleep(20);
  assert.equal(t.creates().length,1);assert.equal(t.log.verified.length,0);assert.equal(t.log.shown.length,1);
  assert.equal(t.log.shown[0].value.verificationStatus,'verified');assert.deepEqual(t.log.shown[0].value.evidence,[{sourceId:source.id,quote:source.text}]);
 }finally{t.session.stop();}
});

test('Recognizing a product name inside an offer to check does not label unknown report coverage as fact-checked',async()=>{
 const t=fixture();try{
  t.context.sources=[{id:'product',text:'PX20 is an inspection instrument.'}];
  await t.speculate('Does the inspection report cover PX20?');t.finish(t.created(),"I'll check whether the inspection report covers PX20 and let you know.");
  t.final('buyer','Does the inspection report cover PX20?');await sleep(20);
  assert.equal(t.log.verified.length,0);assert.equal(t.log.shown.length,1);
  assert.equal(t.log.shown[0].value.verificationStatus,'not_required');assert.deepEqual(t.log.shown[0].value.evidence,[]);
 }finally{t.session.stop();}
});

test('A short ASR stability window lets a multi-sentence burst finish before spending the one hidden attempt',async()=>{
 const t=fixture();try{
  t.start('buyer');t.request();t.stop('buyer');t.partial('buyer','Hi, this is Priya.');await sleep(10);
  assert.equal(t.creates().length,0);
  t.partial('buyer',' Does the report cover PX20?');await sleep(20);assert.equal(t.creates().length,0,'Each text change resets hidden-candidate stability');
  await sleep(25);assert.equal(t.creates().length,1);assert.match(t.creates()[0].response.instructions,/Hi, this is Priya\. Does the report cover PX20\?/);
  assert.equal(t.log.traces.filter(event=>event.event==='speculation_started').length,1);assert.equal(t.log.traces.filter(event=>event.event==='speculation_discarded').length,0);
  t.final('buyer','Hi, this is Priya. Does the report cover PX20?');await sleep(5);assert.equal(t.creates().length,1,'Matching final reuses the full-question draft');
 }finally{t.session.stop();}
});

test('A canonical final arriving during hidden-candidate debounce dispatches immediately and leaves no late timer',async()=>{
 const t=fixture();try{
  t.start('buyer');t.request();t.stop('buyer');t.partial('buyer','Thank you, goodbye.');await sleep(5);assert.equal(t.creates().length,0);
  t.final('buyer','Thank you, goodbye.');assert.equal(t.creates().length,1,'The canonical final bypasses the 35 ms hidden-only wait');
  assert.equal(t.log.traces.filter(event=>event.event==='speculation_started').length,0);
  t.finish(t.created(),'Thank you, goodbye.');await sleep(50);assert.equal(t.creates().length,1);assert.equal(t.log.shown.length,1);
 }finally{t.session.stop();}
});

test('Cancellation and renewed speech retire the debounce; changed partials cannot start a second hidden request',async()=>{
 for(const action of ['cancel','resume','already_spent']){
  const t=fixture();try{
   t.start('buyer');t.request();t.stop('buyer');t.partial('buyer','Thank you, goodbye.');
   if(action==='cancel')t.session.cancelQueuedRequest();
   else if(action==='resume')t.start('new-segment');
   else{await sleep(45);assert.equal(t.creates().length,1);t.created();t.partial('buyer',' One more thing, what is the price?');}
   await sleep(50);assert.equal(t.creates().length,action==='already_spent'?1:0);assert.equal(t.log.shown.length,0);
   if(action==='already_spent')assert.equal(t.log.traces.filter(event=>event.event==='speculation_discarded').length,1);
  }finally{t.session.stop();}
 }
});

// Browser state rebuilds can insert the same JSON fields in a different order.
// Preserve array order and every value; only object insertion order changes.
function reverseObjectKeys(value){
 if(Array.isArray(value))return value.map(reverseObjectKeys);
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).reverse().map(([key,item])=>[key,reverseObjectKeys(item)]));
 return value;
}

for(const moment of [
 {buyer:'Thank you, goodbye.',say:'Thank you, goodbye.'},
 {buyer:"QZ71 is our drawing reference. I'll email the drawing. Send the inspection report only if it matches.",say:"Thanks. I'll check whether the inspection report covers QZ71 once we review your drawing, and send it only if it matches."},
])test(`An equivalent JSON rebuild retains the same exact-final generation: ${moment.buyer}`,async()=>{
 let rebuilt=false,t;
 const payload=(turns=t.context.turns)=>{
  const value={...t.context,turns,callContext:{stageId:'solution_discussion',relationship:'first_contact',background:'An inspection inquiry.',knownFacts:'',doNotGuess:'',goal:'Respect the buyer-chosen next step.'}};
  return rebuilt?reverseObjectKeys(value):value;
 };
 t=fixture({payload});t.context.sources=[{id:'available',title:'Approved documents',text:'Inspection reports are available.'}];
 try{
  await t.speculate(moment.buyer);const id=t.created();t.finish(id,moment.say);
  assert.equal(t.log.shown.length,0,'Even completed hidden wording must wait for final recognition');
  rebuilt=true;t.final('buyer',moment.buyer);await sleep(10);
  assert.equal(t.creates().length,1,'Equivalent field ordering must not cancel and regenerate');
  assert.equal(t.log.traces.filter(event=>event.event==='speculation_accepted').length,1);
  assert.equal(t.log.shown.length,1);assert.equal(t.log.shown[0].value.say,moment.say);
  assert.equal(t.log.shown[0].snapshot.turns.at(-1).text,moment.buyer);
  t.session.handle({type:'error',error:{code:'response_cancel_not_active',message:'No active response'}});
  assert.equal(t.log.shown.length,1,'Normal cancellation notifications cannot replace published wording');
 }finally{t.session.stop();}
});

for(const change of ['source','condition','source_order'])test(`Canonical field ordering does not hide a changed ${change}`,async()=>{
 let rebuilt=false,t;
 const payload=(turns=t.context.turns)=>reverseObjectKeys({...t.context,turns,
  ...(rebuilt&&change==='source'?{sources:[{id:'available',text:'Reports require manager approval before sending.'}]}:{}),
  ...(rebuilt&&change==='source_order'?{sources:[...t.context.sources].reverse()}:{}),
 });
 t=fixture({payload});t.context.sources=[{id:'available',text:'Inspection reports are available.'},{id:'identity',text:'Cedar Instruments supplies inspection instruments.'}];
 try{
  await t.speculate('Please send the information.');const old=t.created();t.finish(old,"I'll send the information.");
  rebuilt=true;t.final('buyer',change==='condition'?'Do not send anything until I approve it.':'Please send the information.');await sleep(10);
  assert.equal(t.log.shown.length,0);assert.equal(t.creates().length,2);
  assert.equal(t.log.traces.filter(event=>event.event==='speculation_accepted').length,0);
  assert.equal(t.log.traces.filter(event=>event.event==='speculation_discarded').length,1);
  if(change==='condition')assert.match(t.creates().at(-1).response.instructions,/Do not send anything until I approve it/);
  if(change==='source')assert.match(t.creates().at(-1).response.instructions,/Reports require manager approval/);
 }finally{t.session.stop();}
});
