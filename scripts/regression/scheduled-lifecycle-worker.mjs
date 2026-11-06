import {pathToFileURL,fileURLToPath} from 'node:url';
import path from 'node:path';
import {writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {scheduledContract,armSourceRelativeRequest,validateScheduledRun} from './scheduled-comparison.mjs';

// Authored transport only. This runner never opens a service, browser or audio.
const reverseKeys=value=>Array.isArray(value)?value.map(reverseKeys):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).reverse().map(([key,item])=>[key,reverseKeys(item)])):value;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const sha=value=>createHash('sha256').update(value).digest('hex');
export async function runScheduledLifecycle({sourceRoot,probe='exact-final'}){
 globalThis.fetch=()=>{throw new Error('Offline scheduled lifecycle forbids network.');};
 globalThis.WebSocket=class{constructor(){throw new Error('Offline scheduled lifecycle forbids WebSocket.');}};
 const {LiveCoachingSession}=await import(pathToFileURL(path.join(sourceRoot,'lib/live-coaching-session.ts')));
 const provisional=probe==='exact-final'?'QZ62 is our drawing reference. I will email the drawing. Send the inspection report only if it matches.':'Please send the inspection report.';
 const final=probe==='exact-final'?provisional:'Please do not send anything until I approve the drawing.';
 const safe=probe==='exact-final'?"I'll check whether the inspection report covers QZ62 and send it only if it matches.":"Understood, I won't send anything until you approve it.";
 const contract=scheduledContract({id:'authored-'+probe,audioSha256:sha('authored synthetic source '+probe),lastWordOffsetMs:100,requestOffsetMs:30,maxDispatchDriftMs:80,maxPairOffsetDeltaMs:80,expectedPhase:'speaking',probe});
 const context={callId:'authored-schedule',manufacturer:{id:'cedar',name:'Cedar Instruments',products:'inspection instruments'},sources:[{id:'available',text:'Inspection reports are available.'}],turns:[],callType:'discovery',currentStage:'discovery'};
 const inputSha256=sha(JSON.stringify({manufacturer:context.manufacturer,sources:context.sources,provisional,final}));
 const events=[],shown=[],timers=new Set(),terminals=new Set(),firstOutputs=new Set(),sayLines=new Set();let rebuilt=false,generation=0,activeGeneration,remote=0,stopped=false;
 const start=performance.now(),now=()=>performance.now()-start,record=(kind,value={})=>events.push({kind,atMs:now(),...value});
 const later=(ms,callback)=>{const timer=setTimeout(()=>{timers.delete(timer);if(!stopped)callback();},ms);timers.add(timer);return timer;};
 const payload=(turns=context.turns)=>{const value={...context,turns,callContext:{stageId:'discovery',relationship:'first_contact',background:'A fictional inspection inquiry.',knownFacts:'',doNotGuess:'',goal:'Respect the buyer-selected next step.'}};return rebuilt?reverseKeys(value):value;};
 let session;
 const receive=event=>{
  if(event.type==='response.output_text.delta'&&!firstOutputs.has(event.response_id)){firstOutputs.add(event.response_id);record('first_output',{generationId:event.response_id});}
  if(event.type==='response.output_text.delta'&&/^SAY:[^\n]+\n/.test(event.delta)&&!sayLines.has(event.response_id)){sayLines.add(event.response_id);record('say_complete',{generationId:event.response_id});}
  if(event.type==='response.done'&&!terminals.has(event.response.id)){terminals.add(event.response.id);record('provider_completed',{generationId:event.response.id,status:event.response.status});}
  session.handle(event);
 };
 session=new LiveCoachingSession({initialTranscriptIds:[],snapshot:()=>payload(),latestContext:turns=>payload(turns),onAudioIssue:()=>{},
  send:event=>{
   if(event.type==='response.cancel'){record('response_cancel',{generationId:event.response_id});later(1,()=>terminals.has(event.response_id)?receive({type:'error',error:{code:'response_cancel_not_active'}}):receive({type:'response.done',response:{id:event.response_id,status:'cancelled'}}));return;}
   if(event.type!=='response.create')return;
   const id='generation-'+(++generation),attempt=generation;activeGeneration=id;record('provider_request',{generationId:id});
   later(2,()=>{record('provider_created',{generationId:id});receive({type:'response.created',response:{id,metadata:event.response.metadata}});});
   later(12,()=>{const say=probe==='meaning-change'&&attempt===1?'I will send the inspection report.':safe;receive({type:'response.output_text.delta',response_id:id,delta:'SAY: '+say+'\nMOVE: Respect the buyer-selected next step\n'});receive({type:'response.done',response:{id,status:'completed'}});});
  },
  onRequestTrace:event=>{if(['speculation_started','speculation_accepted','speculation_discarded','repair_requested','verification_started','verification_passed','failed'].includes(event.event))record(event.event,{reason:event.reason});},
  onGuidance:(guidance,id,_at,complete,_latency,trigger,snapshot)=>{
   if(shown.some(row=>row.id===id&&row.say===guidance.say))return;
   const value={say:guidance.say,id,complete,trigger,usedFinalText:snapshot.turns.at(-1)?.text,generationId:activeGeneration};shown.push(value);record('publication',value);
   later(4,()=>record('visible',{...value,full:true,documentVisible:true,scriptFullyVisible:true,evidence:'scripted-observer'}));
  },
  onBuyerTurn:turn=>context.turns.push({...turn,role:'buyer'}),verify:async(_snapshot,value)=>{remote++;return {...value,verified:true};},fallback:async()=>{throw new Error('Offline scheduled runner never fabricates fallback.');},onError:message=>record('controller_error',{message}),onWarning:message=>record('controller_warning',{message}),onQueuedRequest:()=>{},onSupersede:()=>{},onPendingTurn:()=>{},onThinking:()=>{},onChecking:()=>{},onBuyerPartial:()=>{},onBuyerSpeech:()=>{},onBuyerPending:()=>{},onUsage:()=>{},continuationSettleMs:1,queuedTranscriptionTimeoutMs:800,transcriptionTimeoutMs:2000,fallbackAfterMs:10000});
 const schedule=armSourceRelativeRequest(contract,{sourceStartAtMs:0,now,onObservation:event=>events.push(event),request:()=>session.requestNextMove({...payload(),coachingRequest:{id:'one-click',requestedAt:Date.now()}})});
 try{
  record('audio_started');record('speech_started',{itemId:'buyer'});receive({type:'input_audio_buffer.speech_started',item_id:'buyer',audio_start_ms:0});
  later(100,()=>{record('speech_stopped',{itemId:'buyer'});receive({type:'input_audio_buffer.speech_stopped',item_id:'buyer',audio_end_ms:100});});
  later(110,()=>{record('first_asr_delta',{itemId:'buyer'});record('provisional_transcript',{itemId:'buyer',text:provisional});receive({type:'conversation.item.input_audio_transcription.delta',item_id:'buyer',delta:provisional});});
  later(350,()=>{rebuilt=true;record('transcript_final',{itemId:'buyer',text:final});record('completed_turn',{itemIds:['buyer'],text:final});receive({type:'conversation.item.input_audio_transcription.completed',item_id:'buyer',transcript:final});});
  for(let i=0;i<200&&!events.some(row=>row.kind==='visible');i++)await sleep(5);
  const stableBefore=JSON.stringify(shown);receive({type:'response.output_text.delta',response_id:'generation-1',delta:'SAY: Obsolete wording.\n'});await sleep(5);
  const count=kind=>events.filter(row=>row.kind===kind).length;record('request_settled',{counts:{requests:count('intentional_request'),publications:count('publication'),generations:count('provider_request'),cancellations:count('response_cancel'),verifications:count('verification_started'),repairs:count('repair_requested')}});
  const run={contractId:contract.id,scheduledRequest:contract.request,audioSha256:contract.audioSha256,sourceCue:contract.sourceCue,inputSha256,models:{generation:'scripted',transcription:'scripted',verification:'scripted'},clock:'audio-source-performance',observationKind:'offline-scripted',observationCoverage:{generation:true,cancellation:true,verification:true,repair:true,publication:true,visible:true},events,quality:{verdict:shown.length===1&&shown[0].say===safe&&JSON.stringify(shown)===stableBefore?'pass':'fail',wording:shown.map(row=>row.say),completeTurnUsed:shown[0]?.usedFinalText===final,stable:JSON.stringify(shown)===stableBefore},sourceRoot,scriptedProvider:true,paidCalls:0,remoteVerificationFixtures:remote};
  return {contract,run,validation:validateScheduledRun(contract,run)};
 }finally{schedule.cancel();stopped=true;for(const timer of timers)clearTimeout(timer);session.stop();}
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 globalThis.fetch=()=>{throw new Error('Offline scheduled worker forbids network.');};globalThis.WebSocket=class{constructor(){throw new Error('Offline scheduled worker forbids WebSocket.');}};
 const [sourceRoot,output]=process.argv.slice(2);if(!sourceRoot||!output)throw new Error('Usage: scheduled-lifecycle-worker.mjs SOURCE_ROOT PRIVATE_OUTPUT.json');
 const results=[];for(const probe of ['exact-final','meaning-change'])results.push(await runScheduledLifecycle({sourceRoot,probe}));
 await writeFile(output,JSON.stringify({mode:'offline-scripted-transport',paidCalls:0,userStorageTouched:false,results},null,2));
 if(results.some(row=>!row.validation.eligible))process.exitCode=1;
}
