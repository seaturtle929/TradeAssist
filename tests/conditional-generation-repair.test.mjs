import {assertLocalPressCompletion} from './helpers/local-press-assertions.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import {LiveCoachingSession} from '../lib/live-coaching-session.ts';
import {documentFollowThroughAtRequest,onDemandRepairRules} from '../lib/on-demand-coaching.ts';
import {checkSuggestion} from '../lib/call-purpose.ts';

// Entirely authored fictional fixtures. The real controller builds requests,
// validates candidates and publishes; provider/ASR output is SCRIPTED. Expected
// replies enter only as provider events after dispatch, never in model input.
// These are offline lifecycle checks, not model-quality or audio-latency proof.
const companies=[
 {id:'juniper-precision',name:'Juniper Precision',report:'inspection report',reference:'QJ58'},
 {id:'lumen-alloy',name:'Lumen Alloy Export',report:'material test report',reference:'RN731'},
];
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function settle(){for(let n=0;n<5;n++)await tick();}
function fixture(company=companies[0]){
 const turns=[
  {id:'question',role:'buyer',text:`Does your ${company.report} cover ${company.reference}?`,at:1},
  {id:'clarify',role:'you',text:'Could you spell the reference so I check the right document?',at:2},
  {id:'reference',role:'buyer',text:`Yes, ${company.reference} is the reference on our drawing, not your catalog product.`,at:3},
  {id:'handoff',role:'buyer',text:`I will email the drawing with ${company.reference}. Only send the ${company.report} if it covers that reference.`,at:4},
 ];
 return {callId:'authored-release-'+company.id,manufacturer:{id:company.id,name:company.name,products:'precision components'},sources:[{id:company.id+'-documents',original:true,complete:true,text:`Specification sheets and ${company.report}s are available for review.`}],turns,callType:'solution_discussion',currentStage:'solution_discussion',callContext:{stageId:'solution_discussion',relationship:'first_contact',goal:'Help evaluate whether the available evidence addresses the buyer’s reference.'},coachingRequest:{id:'authored-single-press',requestedAt:5,transcriptState:'confirmed',listeningSession:{startedAt:1,currentTurnIds:turns.map(turn=>turn.id)}}};
}
const safe=company=>`I'll check whether the ${company.report} covers ${company.reference} and send it only if it does. Looking forward to your drawing.`;
const bad=company=>`Once we've checked whether the ${company.report} covers ${company.reference}, I'll reply with it.`;
const snapshot=event=>{
 const marker='\nREQUEST SNAPSHOT (reference data):\n';
 assert.ok(event.response.instructions.includes(marker));
 return JSON.parse(event.response.instructions.split(marker)[1].split('\n')[0]);
};
function transport(context){
 const log={sent:[],shown:[],traces:[],errors:[],remote:0,fallback:0};let serial=0;
 const session=new LiveCoachingSession({initialTranscriptIds:[],snapshot:()=>context,latestContext:(turns=context.turns)=>({...context,turns}),send:event=>log.sent.push(event),onGuidance:(guidance,id,_at,complete,_latency,trigger)=>{if(complete)log.shown.push({say:guidance.say,id,trigger});},onRequestTrace:event=>log.traces.push(event),onSuggestionIssue:()=>{},verify:async(_input,value)=>{log.remote++;return {...value,verified:false,verificationStatus:'rejected',caution:'The authored source does not support this claim.'};},fallback:async()=>{log.fallback++;assert.fail('A generic fallback is not recovery for this intentional request.');},onBuyerTurn:turn=>{context.turns.push({...turn,role:'buyer'});if(context.coachingRequest.listeningSession&&!context.coachingRequest.listeningSession.currentTurnIds.includes(turn.id))context.coachingRequest.listeningSession.currentTurnIds.push(turn.id);},onAudioIssue:()=>{},onSupersede:()=>{},onPendingTurn:()=>{},onThinking:()=>{},onChecking:()=>{},onBuyerPartial:()=>{},onBuyerSpeech:()=>{},onBuyerPending:()=>{},onUsage:()=>{},onWarning:()=>{},onError:message=>log.errors.push(message),continuationSettleMs:1,queuedTranscriptionTimeoutMs:200,transcriptionTimeoutMs:2000,fallbackAfterMs:10000});
 const creates=()=>log.sent.filter(event=>event.type==='response.create');
 const request=()=>session.requestNextMove({...context,coachingRequest:{...context.coachingRequest,requestedAt:Date.now()}});
 const respond=(say,event=creates().at(-1))=>{
  assert.ok(event,'The controller must dispatch before scripted output is supplied.');
  const id='authored-release-response-'+(++serial);
  session.handle({type:'response.created',response:{id,metadata:event.response.metadata}});
  session.handle({type:'response.output_text.delta',response_id:id,delta:'SAY: '+say+'\nMOVE: Respect the document release condition\n'});
  session.handle({type:'response.done',response:{id,status:'completed'}});
  return id;
 };
 const assertPublished=say=>{
  assert.deepEqual(log.shown.map(value=>value.say),[say]);
  assert.equal(log.shown[0].trigger,context.coachingRequest.id,'Recovery belongs to the original intentional press.');
  assert.equal(log.traces.filter(event=>event.event==='published').length,1);
  assert.equal(log.traces.filter(event=>event.event==='failed').length,0);
  assert.equal(log.remote,0);assert.equal(log.fallback,0);
 };
 return {session,log,creates,request,respond,assertPublished};
}

for(const company of companies){
 test(`${company.name}: an unfamiliar unconfirmed reference still gets the initial clarification`,async()=>{
  const context=fixture(company);context.turns=context.turns.slice(0,1);context.coachingRequest.listeningSession.currentTurnIds=['question'];
  const t=transport(context),clarify='Could you confirm the drawing reference for me?';
  try{
   t.request();assert.match(t.creates()[0].response.instructions,/SPOKEN PRODUCT IDENTIFIER NEEDS CONFIRMATION/);
   assert.equal(snapshot(t.creates()[0]).coachingTask.documentFollowThrough,undefined,'No release permission may be invented from an unfamiliar-code question.');
   t.respond(clarify);await settle();t.assertPublished(clarify);assert.equal(t.creates().length,1);
  }finally{t.session.stop();}
 });
 test(`${company.name}: first generation receives actual reference, pending drawing and positive report release`,()=>{
  const context=fixture(company),contract=documentFollowThroughAtRequest(context),t=transport(context);
  try{
   assert.ok(contract);assert.equal(contract.report.coverage,'unknown');assert.ok(contract.report.buyerReferences.includes(company.reference));
   assert.deepEqual(contract.drawing,{sender:'buyer',phase:'promised',sending:'pending',receipt:'unconfirmed'});
   assert.equal(contract.sending.positiveMatchRequired,true);assert.equal(contract.sending.additionalApproval,null);
   assert.equal(contract.report.availability.sourceId,company.id+'-documents');
   t.request();assert.equal(t.creates().length,1);assert.deepEqual(snapshot(t.creates()[0]).coachingTask.documentFollowThrough,contract);
   assert.equal(t.creates()[0].response.instructions.includes(safe(company)),false,'The expected answer is outside generation input.');
   const other=companies.find(value=>value.id!==company.id);assert.equal(t.creates()[0].response.instructions.includes(other.name),false);assert.equal(t.creates()[0].response.instructions.includes(other.reference),false);
  }finally{t.session.stop();}
 });
 for(const say of [safe(company),`Once we confirm that the ${company.report} covers ${company.reference}, we'll send it over to you. Looking forward to your drawing.`]){
  test(`${company.name}: safe authored paraphrase publishes unchanged, one generation and no repair`,async()=>{
   const t=transport(fixture(company));try{t.request();t.respond(say);await settle();t.assertPublished(say);assert.equal(t.creates().length,1);assert.equal(t.log.traces.filter(event=>event.event==='repair_requested').length,0);}finally{t.session.stop();}
  });
 }
 test(`${company.name}: local completion preserves the authoritative contract and actual rejection reason`,async()=>{
 const context=fixture(company),t=transport(context),rejected=bad(company);
 try{assert.equal(checkSuggestion({say:rejected},context,{factChecked:true}).ok,false);t.request();const before=snapshot(t.creates()[0]);t.respond(rejected);await settle();assertLocalPressCompletion(t.log,t.creates(),rejected);
 assert.deepEqual(snapshot(t.creates()[0]).coachingTask.documentFollowThrough,before.coachingTask.documentFollowThrough,'Rejected text cannot change the authoritative contract');const trace=t.log.traces.find(event=>event.event==='rejected');assert.match(trace.reason,/positive report match/);assert.doesNotMatch(trace.reason,/broad company category/);}finally{t.session.stop();}
});
 test(`${company.name}: a rejected scripted draft completes locally without another generation`,async()=>{
 const context=fixture(company),t=transport(context);try{t.request();t.respond(bad(company));await settle();const spoken=assertLocalPressCompletion(t.log,t.creates(),bad(company));t.respond(bad(company).replace("I'll","we'll"));await settle();assert.equal(t.log.shown.length,1);assert.equal(t.log.shown[0].say,spoken);assert.equal(t.creates().length,1);}finally{t.session.stop();}
});
}

for(const unsupported of [
 company=>`The ${company.report} covers ${company.reference}.`,
 company=>`We have the ${company.report} for ${company.reference}, and I'll check the details.`,
 company=>`I'll check whether the ${company.report} covers our ${company.reference}.`,
 company=>`Once we've checked whether the ${company.report} covers ${company.reference}, we'll send it over to you.`,
])test('Factual and buyer-condition checks survive local completion: '+unsupported(companies[0]),async()=>{
 const company=companies[0],context=fixture(company),t=transport(context),say=unsupported(company);try{assert.equal(checkSuggestion({say},context,{factChecked:true}).ok,false,'Factual approval cannot waive buyer conditions or establish ownership.');t.request();t.respond(say);await settle();assertLocalPressCompletion(t.log,t.creates(),say);}finally{t.session.stop();}
});

test('A separate engineering approval remains required while the press completes with a check only',async()=>{
 const company=companies[1],context=fixture(company);context.turns.push({id:'engineer-gate',role:'buyer',text:'Do not send anything until my engineer approves.',at:5});context.coachingRequest.listeningSession.currentTurnIds.push('engineer-gate');const contract=documentFollowThroughAtRequest(context),t=transport(context);
 try{assert.equal(contract.sending.positiveMatchRequired,true);assert.deepEqual(contract.sending.additionalApproval,{required:true,approver:'engineering'});t.request();assert.deepEqual(snapshot(t.creates()[0]).coachingTask.documentFollowThrough,contract);t.respond(safe(company));await settle();assertLocalPressCompletion(t.log,t.creates(),safe(company));}finally{t.session.stop();}
});

test('Explicit hold and unresolved release review remain visible instead of document availability granting release',()=>{
 const context=fixture(),hold={...context,turns:[...context.turns,{id:'hold',role:'buyer',text:"Don't send anything yet.",at:5}]};
 assert.equal(documentFollowThroughAtRequest(hold).sending.hold,true);
 const unresolved={...context,turns:[...context.turns,{id:'review',role:'buyer',text:'Only send the report if our compliance review is complete.',at:5}]};
 const contract=documentFollowThroughAtRequest(unresolved);assert.equal(contract.sending.unresolvedCondition,true);assert.ok(contract.report.availability);
 const rules=onDemandRepairRules({...unresolved,selfCheckFailure:JSON.stringify({rejectedSay:'I will send it.',reason:'The release review is unresolved.'})});assert.match(rules,/withheld|unresolved/i);assert.match(rules,/acknowledging the hold without promising a send/);
});

test('Late completed speech adds engineer approval to the original click, discards old work and leaves the published line stable',async()=>{
 const company=companies[0],context=fixture(company),provisional=context.turns.pop().text,t=transport(context),complete=provisional+' Actually, do not send anything until my engineer approves.';
 try{
  t.session.handle({type:'input_audio_buffer.speech_started',item_id:'authored-current-speech',audio_start_ms:100});
  t.session.handle({type:'conversation.item.input_audio_transcription.delta',item_id:'authored-current-speech',delta:provisional});
  t.request();t.session.handle({type:'input_audio_buffer.speech_stopped',item_id:'authored-current-speech',audio_end_ms:5000});
  await new Promise(resolve=>setTimeout(resolve,50));assert.equal(t.creates().length,1);
  const old=t.creates()[0],oldId=t.respond(safe(company),old);assert.deepEqual(t.log.shown,[],'Provisional speech cannot authorize publication.');
  t.session.handle({type:'conversation.item.input_audio_transcription.completed',item_id:'authored-current-speech',transcript:complete});t.session.handle({type:'response.done',response:{id:oldId,status:'cancelled'}});await settle();
  assert.equal(t.creates().length,2);const latest=snapshot(t.creates()[1]);assert.equal(latest.coachingTask.documentFollowThrough.sending.positiveMatchRequired,true);assert.deepEqual(latest.coachingTask.documentFollowThrough.sending.additionalApproval,{required:true,approver:'engineering'});assert.ok(latest.coachingTask.finalizedTranscript.some(turn=>turn.text===complete));assert.equal(t.log.traces.filter(event=>event.event==='repair_requested').length,0,'Meaning-changing speech restarts the same click, not a repair.');
  t.session.handle({type:'response.output_text.delta',response_id:oldId,delta:'SAY: '+safe(company)+'\n'});assert.deepEqual(t.log.shown,[]);
  const held=`I'll check whether the ${company.report} covers ${company.reference}; I won't send it unless it matches and your engineer approves.`;
  t.respond(held);await settle();t.assertPublished(held);
  t.session.handle({type:'input_audio_buffer.speech_started',item_id:'authored-later-speech',audio_start_ms:5100});t.session.handle({type:'input_audio_buffer.speech_stopped',item_id:'authored-later-speech',audio_end_ms:5200});t.session.handle({type:'conversation.item.input_audio_transcription.completed',item_id:'authored-later-speech',transcript:'Thank you, goodbye.'});await settle();
  assert.deepEqual(t.log.shown.map(value=>value.say),[held]);assert.equal(t.creates().length,2,'Later speech cannot replace displayed wording without a new intentional click.');
 }finally{t.session.stop();}
});
