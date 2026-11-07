import test from 'node:test';
import assert from 'node:assert/strict';
import {makeLocalPressReply,readyNonAssertiveInquiry} from '../lib/local-press-reply.ts';
import {coachingRequestFocus} from '../lib/coaching-context-snapshot.ts';
import {onDemandDecisionRules} from '../lib/on-demand-coaching.ts';

// Authored fictional fixtures, not private call transcripts.
const context={manufacturer:{name:'Cedar Instruments'},turns:[{id:'rep',role:'you',text:"Hi, this is Robin from Cedar Instruments."},{id:'ref',role:'buyer',text:'Our reference is QV80.'},{id:'question',role:'buyer',text:'Does the report cover QV80?'}]};
test('pure future investigation is ready without a content-verification call',()=>{
 const say="I'll check whether the report covers QV80 and get back to you.";
 const reply=readyNonAssertiveInquiry(say,context);
 assert.equal(reply?.say,say);assert.equal(reply?.verificationStatus,'not_required');assert.equal(reply?.replyOrigin,'generated');
});
test('uncertain reference is omitted, not guessed',()=>{
 const reply=readyNonAssertiveInquiry("I'll check whether the report covers ZZ91 and get back to you.",context);
 assert.equal(reply?.say,"I'll check whether the report covers your requirements and get back to you.");
});
test('literal reference in completed buyer question can be repeated without asserting company ownership',()=>{
 const say="I'll check whether the report covers RX73 and get back to you.";
 const reply=readyNonAssertiveInquiry(say,{...context,turns:[{id:'q',role:'buyer',text:'RX73 is our drawing reference. Could you check whether the report covers RX73?'}]});
 assert.equal(reply?.say,say);
});
test('a pure check cannot bypass relevance after a refusal or greeting',()=>{
 for(const text of ['Do not call me again.','Hi, Casey speaking.','Thanks, I received the report.'])assert.equal(readyNonAssertiveInquiry("I'll check whether the report covers QV80 and get back to you.",{...context,turns:[{id:'last',role:'buyer',text}]}),undefined);
 assert.equal(makeLocalPressReply({...context,turns:[{id:'last',role:'buyer',text:'Do not call me again.'}]}).say,'Understood. Thank you for your time.');
});
for(const say of [
 'The report covers QV80.',
 "The report covers QV80. I'll check the details.",
 "I'll check whether the report covers QV80 and send it.",
 "I'll check whether the report covers our QV80.",
 "I'll check whether the report covers QV80 and get back to you tomorrow.",
 "I'll check whether the report covers QV80 and ship tomorrow.",
 "I'll check whether the report covers QV80, but it is certified.",
 "I'll check the details and give you a discount.",
])test('substantive or mixed claim still enters normal validation: '+say,()=>assert.equal(readyNonAssertiveInquiry(say,context),undefined));
test('fallback never asserts coverage or promises sending, even when a draft failed',()=>{
 const reply=makeLocalPressReply(context,'validation_rejected');
 assert.equal(reply.say,"I'll check the details and get back to you.");assert.equal(reply.replyOrigin,'local');assert.equal(reply.verified,true);assert.equal(reply.localReason,'validation_rejected');
});
test('missing final transcription asks for repetition instead of answering partial words',()=>{
 const reply=makeLocalPressReply({...context,coachingRequest:{partials:[{id:'p',role:'buyer',text:'But only if'}]}},'transcription_incomplete');
 assert.equal(reply.say,'Sorry, could you repeat that last part?');
 assert.equal(readyNonAssertiveInquiry("I'll check the details.",{...context,coachingRequest:{partials:[{id:'p',role:'buyer',text:'But only if'}]}}),undefined);
});
test('pickup uses verified rep name, not buyer name',()=>{
 const reply=makeLocalPressReply({...context,turns:[...context.turns,{id:'pickup',role:'buyer',text:'Hi, Casey speaking.'}]});
 assert.equal(reply.say,'Hi, this is Robin from Cedar Instruments. Thanks for taking my call.');
});
test('unknown rep identity is omitted',()=>{
 const reply=makeLocalPressReply({manufacturer:{name:'Cedar Instruments'},turns:[{id:'pickup',role:'buyer',text:'Hi, Casey speaking.'}]});
 assert.equal(reply.say,"Hi, I'm with Cedar Instruments. Thanks for taking my call.");
});
test('an identity question gets an introduction, not a fact-check stall',()=>{
 const reply=makeLocalPressReply({manufacturer:{name:'Cedar Instruments'},turns:[{id:'pickup',role:'buyer',text:"Who's calling?"}]});
 assert.equal(reply.say,"Hi, I'm with Cedar Instruments. I'm calling to introduce our company.");
});
test('pending transfer waits for the named person',()=>{
 const reply=makeLocalPressReply({manufacturer:{name:'Cedar Instruments'},turns:[{id:'rep',role:'you',text:'Could you put me through to Casey?'},{id:'hold',role:'buyer',text:"One moment, I'll put you through."}]});
 assert.equal(reply.say,"Thank you, I'll hold.");
});
test('completed mixed audio remains current words without inventing its speaker',()=>{
 const mixed={...context,coachingRequest:{id:'mixed',listeningSession:{currentTurnIds:['mixed-turn']}},turns:[...context.turns,{id:'mixed-turn',role:'conversation',text:'Only if it covers my drawing and engineering approves.'}]};
 const focus=coachingRequestFocus(mixed);
 assert.equal(focus.role,'conversation');assert.match(focus.displayText,/Only if it covers my drawing and engineering approves/);
 assert.equal(makeLocalPressReply(mixed).say,'Could you clarify that last point for me?');
 assert.match(onDemandDecisionRules(mixed),/CURRENT SPEECH, SPEAKER UNASSIGNED/);
 assert.doesNotMatch(onDemandDecisionRules(mixed),/No new buyer words/);
});
