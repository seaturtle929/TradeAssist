import assert from 'node:assert/strict';
import test from 'node:test';
import {CoachInput} from '../lib/coach.ts';
import {manualRequestFor,MANUAL_TEXT_MODEL,streamManualCoaching} from '../lib/manual-coaching.ts';
import {interactionCoachingRules} from '../lib/interaction-coaching.ts';
import {makeLocalPressReply} from '../lib/local-press-reply.ts';
import {callRouteAtRequest} from '../lib/call-route.ts';
import {coldCallGateFor} from '../lib/call-participant.ts';

// Authored fictional examples. No network, recordings or client records.
const context={manufacturer:{id:'fictional',name:'Cedar Instruments',products:'instruments'},sources:[],turns:[],coachingRequest:{id:'press',requestedAt:1}};
test('written interaction metadata survives parsing and reaches the existing generation call',()=>{
 const input=CoachInput.parse({...context,interactionType:'text_email',projectId:'prototype'}),request=manualRequestFor(input);
 assert.equal(input.projectId,'prototype');assert.equal(request.model,MANUAL_TEXT_MODEL);
 assert.match(request.instructions,/CHANNEL: TEXT OR EMAIL/);assert.match(request.instructions,/not a telephone opener/);
 assert.match(request.input,/text_email/);assert.match(request.input,/prototype/);
});
test('spoken and written channels use one grounded coaching foundation',()=>{
 for(const interactionType of ['in_person','call_meeting','text_email']){
  const rules=interactionCoachingRules({interactionType});assert.match(rules,/reviewed history/);assert.match(rules,/approved company evidence/);assert.match(rules,/Suggestions are drafts/);assert.match(rules,/Preserve conditions/);
 }
});
test('an in-person greeting has no invented caller identity or phone wording',()=>{
 const reply=makeLocalPressReply({...context,interactionType:'in_person'});
 assert.equal(reply.say,"Hi, I'm with Cedar Instruments. Thanks for taking the time.");assert.equal(reply.replyOrigin,'local');
});
test('a written local opener is professional and does not pretend a call connected',()=>{
 const reply=makeLocalPressReply({...context,interactionType:'text_email'});
 assert.equal(reply.say,"Hello, I'm with Cedar Instruments. How can I help with what you’re working on?");
 assert.doesNotMatch(reply.say,/call|phone|transfer|sent/i);
});
test('main-line routing cannot leak into an email or an in-person meeting',()=>{
 const clientContext={contact:{kind:'main_line',name:'Company main line'}};
 for(const interactionType of ['text_email','in_person'])assert.equal(callRouteAtRequest({...context,interactionType,clientContext}),undefined);
 assert.equal(callRouteAtRequest({...context,interactionType:'call_meeting',clientContext})?.routingNeeded,true);
 assert.equal(coldCallGateFor({...context,interactionType:'text_email',callContext:{stageId:'cold_call',relationship:'first_contact'}}),null);
});
test('a written response press still completes locally after one provider failure',async()=>{
 const input=CoachInput.parse({...context,interactionType:'text_email',turns:[{id:'question',role:'buyer',text:'Does that report cover our part?'}]});
 const events=[];let calls=0,verifications=0,repairs=0;
 await streamManualCoaching({input,signal:new AbortController().signal,emit:event=>events.push(event),charges:[],createResponse:async()=>{calls++;throw Error('Authored provider failure');},verify:async()=>{verifications++;throw Error('Unexpected verifier');},repair:async()=>{repairs++;throw Error('Unexpected repair');},charge:()=>assert.fail('No provider usage received')});
 const shown=events.filter(event=>event.type==='suggestion_complete');assert.equal(shown.length,1);assert.equal(shown[0].guidance.say,"I'll check the details and get back to you.");assert.equal(shown[0].guidance.replyOrigin,'local');assert.equal(calls,1);assert.equal(verifications,0);assert.equal(repairs,0);
});
