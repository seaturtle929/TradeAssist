import assert from 'node:assert/strict';
import test from 'node:test';
import {buyerSpelledIdentifierClarificationReferences,isBuyerIdentifierClarification,productIdentityReferences} from '../lib/product-identity-evidence.ts';
import {assessReplyVerification} from '../lib/turn-verification-policy.ts';
import {needsFactCheck} from '../lib/call-coaching.ts';
import {checkSuggestion} from '../lib/call-purpose.ts';
import {LiveCoachingSession} from '../lib/live-coaching-session.ts';

// Fictional code/company fixture, unrelated to saved calls or product facts.
const context={manufacturer:{id:'cedar',name:'Cedar Instruments',products:'inspection instruments'},sources:[{id:'documents',text:'Specification sheets and inspection reports are available.'}],turns:[{id:'current',role:'buyer',text:'Can you check whether the inspection report covers ZX72?'}],coachingRequest:{id:'authored-nato',requestedAt:2,transcriptState:'confirmed',listeningSession:{startedAt:1,currentTurnIds:['current']}}};
for(const phonetic of ['Zulu X-ray 72','Zulu X ray seven two'])test('An exact current-buyer NATO expansion is a code clarification: '+phonetic,()=>{
 const say=`Sure, just to confirm, are you referring to ZX72 as in ${phonetic}?`,refs=buyerSpelledIdentifierClarificationReferences(say,context.turns[0].text);
 assert.equal(refs.length,1);assert.equal(refs[0].text,phonetic);assert.equal(refs[0].buyerText,'ZX72');assert.equal(refs[0].sourceId,undefined);
 assert.deepEqual(productIdentityReferences(say,context.sources),[]);assert.equal(isBuyerIdentifierClarification(say,context.turns[0].text),true);
 assert.deepEqual(assessReplyVerification(say,context).unsupportedClaims,[]);assert.equal(needsFactCheck(say,context),false);assert.equal(checkSuggestion({say},context).ok,true);
});
test('One intentional live request publishes an exact NATO clarification without verification or repair',()=>{
 const say='Sure, just to confirm, are you referring to ZX72 as in Zulu X-ray 72?',sent=[],shown=[],traces=[];let verifies=0;
 const session=new LiveCoachingSession({snapshot:()=>context,latestContext:()=>context,send:event=>sent.push(event),onGuidance:value=>shown.push(value.say),onRequestTrace:event=>traces.push(event),verify:async()=>{verifies++;assert.fail('NATO reference is not a factual coverage claim');},fallback:async()=>assert.fail('Unexpected fallback'),onBuyerTurn:()=>{},onBuyerPartial:()=>{},onBuyerSpeech:()=>{},onBuyerPending:()=>{},onSupersede:()=>{},onPendingTurn:()=>{},onThinking:()=>{},onChecking:()=>{},onUsage:()=>{},onWarning:()=>{},onError:message=>assert.fail(message),fallbackAfterMs:10000});
 try{session.requestNextMove(context);const request=sent.find(event=>event.type==='response.create');assert.ok(request);session.handle({type:'response.created',response:{id:'authored-nato',metadata:request.response.metadata}});session.handle({type:'response.output_text.delta',response_id:'authored-nato',delta:'SAY: '+say+'\nMOVE: Confirm the reference\n'});session.handle({type:'response.done',response:{id:'authored-nato',status:'completed'}});assert.deepEqual(shown,[say]);assert.equal(verifies,0);assert.equal(sent.filter(event=>event.type==='response.create').length,1);assert.equal(traces.filter(event=>event.event==='repair_requested').length,0);}finally{session.stop();}
});
test('Changed NATO letters/digits and company ownership get no phonetic exemption',()=>{
 for(const say of ['Are you referring to ZX72 as in Zulu X-ray 73?','Are you referring to ZX72 as in Sierra X-ray 72?','Are you referring to ZX73 as in Zulu X-ray 73?','Are you referring to our ZX72 as in Zulu X-ray 72?']){
  assert.deepEqual(buyerSpelledIdentifierClarificationReferences(say,context.turns[0].text),[],say);assert.equal(isBuyerIdentifierClarification(say,context.turns[0].text),false,say);
 }
});
test('Repeated mentions of the same buyer reference do not duplicate a phonetic span',()=>{
 const say='Are you referring to ZX72 as in Zulu X-ray 72?';
 assert.equal(buyerSpelledIdentifierClarificationReferences(say,'Does the inspection report cover ZX72? Please confirm ZX72.').length,1);
});
test('A neutral NATO prefix cannot hide mixed substantive claims',()=>{
 for(const tail of ['We can offer a 20% discount.','It has a 20 mm opening.','The report covers ZX72.','It is certified to ISO 9001.','We guarantee every result.',"I'll send it soon."]){
  const say='Sure, just to confirm, are you referring to ZX72 as in Zulu X-ray 72? '+tail;
  assert.equal(isBuyerIdentifierClarification(say,context.turns[0].text),false,say);assert.equal(needsFactCheck(say,context),true,say);assert.equal(checkSuggestion({say},context).ok,false,say);
 }
});
