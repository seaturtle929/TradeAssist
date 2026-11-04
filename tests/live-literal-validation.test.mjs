import assert from 'node:assert/strict';
import test from 'node:test';
import {completedLiveReply} from '../lib/live.ts';
import {LiveCoachingSession} from '../lib/live-coaching-session.ts';
import {assessReplyVerification} from '../lib/turn-verification-policy.ts';
import {defaultConfigurationStages} from '../lib/sales-curriculum.ts';

// Authored fictional authority/candidate events; no saved conversation fixtures.
function context(){
 const stages=defaultConfigurationStages(),snapshot={id:'synthetic-version',companyId:'cedar',version:1,activatedAt:1,stages,knowledge:[],boundaries:[{id:'discount-approval',text:'Discounts require manager approval.',authority:'approval_required',scope:'company',action:'discount',status:'active',origin:'manager'}],preferences:[],legacyNotes:[]};
 return {callId:'synthetic-literal',manufacturer:{id:'cedar',name:'Cedar Instruments',products:'inspection instruments'},sources:[],turns:[{id:'buyer',role:'buyer',text:'Can you offer us a discount?',at:1}],callType:'discovery',currentStage:'discovery',coachingRequest:{id:'one-click',requestedAt:2},companyConfiguration:{companyId:'cedar',versionId:snapshot.id,version:1,boundAt:1,selectedStageId:stages[0].id,snapshot}};
}
test('Completed intentional factual wording retains the literal claim for authority checks',()=>{
 const input=context(),say='We can offer you a discount.';
 const parsed=completedLiveReply('SAY: '+say+'\nMOVE: Respond to the request',input);
 assert.equal(parsed.rawSay,say);assert.equal(parsed.guidance.say,say);
 assert.ok(assessReplyVerification(parsed.guidance.say,input).unsupportedClaims.length);
});
test('Rejected live candidate is traced and repaired, never silently replaced by a generic safe line',()=>{
 const input=context(),sent=[],shown=[],traces=[];
 const session=new LiveCoachingSession({snapshot:()=>input,latestContext:()=>input,send:event=>sent.push(event),onRequestTrace:event=>traces.push(event),onGuidance:value=>shown.push(value),
  verify:async()=>assert.fail('Known unsupported permission must not go to remote verification'),fallback:async()=>assert.fail('No fallback expected'),
  onBuyerTurn:()=>{},onSupersede:()=>{},onPendingTurn:()=>{},onThinking:()=>{},onChecking:()=>{},onBuyerPartial:()=>{},onBuyerSpeech:()=>{},onBuyerPending:()=>{},onUsage:()=>{},onWarning:()=>{},onError:message=>assert.fail(message),fallbackAfterMs:10000});
 try{
  session.requestNextMove(input);
  const request=sent.find(event=>event.type==='response.create');assert.ok(request);
  session.handle({type:'response.created',response:{id:'candidate',metadata:request.response.metadata}});
  session.handle({type:'response.output_text.delta',response_id:'candidate',delta:'SAY: We can offer you a discount.\nMOVE: Respond\n'});
  assert.equal(shown.length,0);
  const rejected=traces.find(event=>event.event==='repair_requested');assert.ok(rejected);
  assert.match(JSON.stringify(rejected),/discount/);
  assert.equal(traces.filter(event=>event.event==='published').length,0);
 }finally{session.stop();}
});
