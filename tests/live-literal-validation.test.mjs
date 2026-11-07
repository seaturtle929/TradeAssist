import {assertLocalPressCompletion} from './helpers/local-press-assertions.mjs';
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
test('Rejected live candidate is traced and the same press visibly completes locally',()=>{
 const input=context(),sent=[],shown=[],traces=[];const session=new LiveCoachingSession({snapshot:()=>input,latestContext:()=>input,send:event=>sent.push(event),onRequestTrace:event=>traces.push(event),onGuidance:value=>shown.push(value),verify:async()=>assert.fail('Known unsupported permission does not need remote verification'),fallback:async()=>assert.fail('No remote fallback'),onBuyerTurn:()=>{},onSupersede:()=>{},onPendingTurn:()=>{},onThinking:()=>{},onChecking:()=>{},onBuyerPartial:()=>{},onBuyerSpeech:()=>{},onBuyerPending:()=>{},onUsage:()=>{},onWarning:()=>{},onError:message=>assert.fail(message),fallbackAfterMs:10000});
 try{session.requestNextMove(input);const request=sent.find(event=>event.type==='response.create');session.handle({type:'response.created',response:{id:'candidate',metadata:request.response.metadata}});session.handle({type:'response.output_text.delta',response_id:'candidate',delta:'SAY: We can offer you a discount.\nMOVE: Respond\n'});assertLocalPressCompletion({shown:shown.map(value=>({value})),traces},sent.filter(event=>event.type==='response.create'),'We can offer you a discount.');assert.match(JSON.stringify(traces.find(event=>event.event==='rejected')),/discount/);assert.ok(sent.some(event=>event.type==='response.cancel'&&event.response_id==='candidate'));session.handle({type:'response.done',response:{id:'candidate',status:'cancelled'}});session.handle({type:'response.output_text.delta',response_id:'candidate',delta:'WHY: old metadata\n'});assert.equal(shown.length,1);assert.equal(sent.filter(event=>event.type==='response.create').length,1);}finally{session.stop();}
});
