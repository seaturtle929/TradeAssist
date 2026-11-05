import assert from 'node:assert/strict';
import test from 'node:test';
import {assessReplyVerification} from '../lib/turn-verification-policy.ts';
import {needsFactCheck} from '../lib/call-coaching.ts';
import {checkSuggestion} from '../lib/call-purpose.ts';

// Deliberately authored fictional variants, not saved transcripts or model output.
const make=(code='QZ62',closing=true)=>({manufacturer:{id:'fictional-cedar',name:'Cedar Instruments',products:'industrial instruments'},sources:[{id:'available',text:'Specification sheets and inspection reports are available for review.'}],coachingRequest:{id:'authored-reference',requestedAt:5,transcriptState:'confirmed',listeningSession:{startedAt:1,currentTurnIds:['buyer']}},turns:[{id:'ask',role:'buyer',text:'Can you check whether the inspection report covers QZ62?'},{id:'clarify',role:'you',text:'Could you confirm the code?'},{id:'spelling',role:'buyer',text:'Yes, Q as in Quebec, Z as in Zulu six two. That is the reference on our drawing.'},{id:'buyer',role:'buyer',text:closing?`I will email the drawing with the ${code} reference. Send the report only if it matches.`:`The part code is ${code}. I can email our drawing.`}]});
function locallySafe(say,input){const result=assessReplyVerification(say,input);assert.deepEqual(result.unsupportedClaims,[],say);assert.deepEqual(result.pendingClaims,[],say);assert.equal(needsFactCheck(say,input),false,say);const verdict=checkSuggestion({say},input);assert.equal(verdict.ok,true,say+' '+JSON.stringify(verdict));}

for(const code of ['QZ62','QZ-62']){
 test(`Buyer reference ${code} stays complete inside a review prerequisite and conditional send`,()=>{
  const input=make(code);
  locallySafe(`Once I review your drawing with that ${code} reference, I'll check if the inspection report covers it. If it does, I'll reply and send that report as you requested.`,input);
 });
 test(`Buyer reference ${code} stays complete in a plain coverage inquiry`,()=>{
  const input=make(code,false);input.turns.at(-1).text=`The part code is ${code}. Could you check whether the inspection report covers it?`;
  locallySafe(`I'll check whether the inspection report covers ${code}.`,input);
 });
 test(`Only if covers ${code} guards one coordinated email reply`,()=>{
  locallySafe(`I'll check whether the inspection report covers ${code}. If it does, I'll reply and send the report.`,make(code));
 });
}

test('A reference clarification can promise to check once the spelling is clear',()=>{
 const input=make();input.turns=input.turns.slice(0,1);input.turns[0].id='buyer';
 locallySafe("Just to confirm, is that Q as in Quebec, Z 6-2? Once we're clear on that, I'll check the coverage.",input);
});
for(const action of ['reply and send','respond and email','reply and forward','reply and attach'])test(`A positive coverage condition governs the coordinated ${action}`,()=>{
 locallySafe(`I'll check whether the inspection report covers QZ62. If it does, I'll ${action} the report.`,make());
});
for(const bad of [
 "The inspection report covers QZ62.",
 "We have an inspection report for QZ62, and I'll check the details.",
 "I'll check whether the inspection report covers QZ62. I'll reply and send it.",
 "I'll check whether the inspection report covers QZ62. If it does, I'll reply and send the report. I'll email it regardless.",
 "I'll check whether the inspection report covers QZ62. If it does, I'll reply and ship the order tomorrow.",
 "Once I review your drawing with that QZ62 reference, I'll check whether our certified QZ62 is covered.",
 "Once I review your drawing with that QZ63 reference, I'll check whether the inspection report covers it.",
 "Once I review your drawing with that QZ62 reference, I'll check whether the inspection report covers it. We can offer a 15% discount.",
 "Once we're clear on that, I'll check the coverage and certify the product.",
])test(`Substantive claim or broken buyer condition still blocks: ${bad}`,()=>{
 const input=make(),result=assessReplyVerification(bad,input);
 assert.ok(result.unsupportedClaims.length||result.pendingClaims.length||needsFactCheck(bad,input),bad);
 assert.equal(checkSuggestion({say:bad},input).ok,false,bad);
});
test('A conditional reply never waives a later explicit approval hold',()=>{
 const input=make();input.turns.at(-1).text+=' Do not send anything before my engineer approves the drawing.';
 const say="I'll check whether the inspection report covers QZ62. If it does, I'll reply and send the report.";
 assert.ok(assessReplyVerification(say,input).unsupportedClaims.some(claim=>/withheld|approver/.test(claim.reason)));
});
test('A repeated subject does not detach a send from the same positive coverage condition',()=>{
 locallySafe("I'll check whether the inspection report covers QZ62, and I'll reply with that report only if it matches.",make());
});
test('A direct positive conditional send need not invent a present coverage claim',()=>{
 locallySafe("I'll send the inspection report only if it covers QZ62.",make());
});
test('A completed same-call reference survives courtesy and equivalent join typography',()=>{
 const input=make();input.turns.push({id:'thanks',role:'buyer',text:'Yes, that is the plan. Thanks, goodbye.'});input.coachingRequest.listeningSession.currentTurnIds.push('thanks');
 locallySafe("I'll check whether the inspection report covers QZ-62 and send it only if it matches. Take care.",input);
 locallySafe("Thanks. I'll check QZ62 and send the report only if it matches. Have a good day.",input);
});
test('A drawing-reference review and coordinated send accept a grounded asked courtesy',()=>{
 locallySafe("Once I review your drawing with that QZ-62 reference, I'll check whether the inspection report covers it. If it does, I'll reply and send that report as you asked.",make());
});
test('A reference label can clarify the full unfamiliar code',()=>{
 const input=make();input.turns=input.turns.slice(0,1);input.turns[0].id='buyer';
 locallySafe('Could you confirm the reference—Q as in Quebec, Z six two?',input);
});
test('Within a report scope does not promise a response deadline',()=>{
 locallySafe("I'll find out whether QZ62 falls within the inspection report's scope.",make('QZ62',false));
 const input=make('QZ62',false);
 assert.ok(assessReplyVerification("I'll find out whether QZ62 falls within the inspection report's scope within two days.",input).unsupportedClaims.some(claim=>claim.kind==='timing'));
});
test('Reference typography never exempts a separate quantity or company ownership claim',()=>{
 for(const say of [
  "I'll check whether the inspection report covers QZ-62. It has a 62 mm opening.",
  "I'll check whether our QZ-62 is covered by the inspection report.",
  "I'll check whether the inspection report covers QZ-62. We can offer a 15% discount.",
 ])assert.equal(checkSuggestion({say},make()).ok,false,say);
});
