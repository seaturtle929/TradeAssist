import assert from 'node:assert/strict';
import test from 'node:test';
import {buyerSpelledIdentifierClarificationReferences,isBuyerIdentifierClarification,productIdentityReferences} from '../lib/product-identity-evidence.ts';
import {assessReplyVerification} from '../lib/turn-verification-policy.ts';
import {checkSuggestion} from '../lib/call-purpose.ts';
import {LiveCoachingSession} from '../lib/live-coaching-session.ts';

// Fictional expected-reference fixtures. Every character must match the
// current buyer, irrespective of the spelling choice at each position.
const cases=[
 {code:'ZX72',company:'Cedar Instruments',spellings:['Z as in Zulu, X-7-2','Zulu, X-seven-two','Z-X as in X-ray-72','Z as in Zulu, X as in X-ray seven two']},
 {code:'QV13',company:'Harbor Components',spellings:['Q as in Quebec, V-1-3','Quebec, V-one-three','Q-V as in Victor-13','Q as in Quebec, V as in Victor one three']},
];
const make=entry=>({manufacturer:{id:entry.company,name:entry.company,products:'industrial instruments'},sources:[{id:'documents',text:'Specification sheets and inspection reports are available.'}],turns:[{id:'buyer',role:'buyer',text:`Does the inspection report cover ${entry.code}?`}],coachingRequest:{id:'authored-composition',requestedAt:2,transcriptState:'confirmed',listeningSession:{startedAt:1,currentTurnIds:['buyer']}}});
for(const entry of cases){
 for(const spelling of entry.spellings)test(`${entry.company}: each exact buyer-code position can mix literal and phonetic spelling: ${spelling}`,()=>{
  const context=make(entry),say=`Could you confirm the exact model code—did you say ${spelling}?`,refs=buyerSpelledIdentifierClarificationReferences(say,context.turns[0].text);
  assert.equal(refs.length,1);assert.equal(refs[0].text,spelling);assert.equal(say.slice(refs[0].start,refs[0].end),spelling);assert.equal(refs[0].buyerText,entry.code);
  assert.equal(isBuyerIdentifierClarification(say,context.turns[0].text),true);assert.deepEqual(productIdentityReferences(say,context.sources),[]);
  assert.deepEqual(assessReplyVerification(say,context).unsupportedClaims,[]);assert.equal(checkSuggestion({say},context).ok,true);
 });
 test(`${entry.company}: an intentional click publishes one exact mixed-spelling question without verification`,()=>{
  const context=make(entry),say=`Thanks for raising that. Could you confirm the exact model code—did you say ${entry.spellings[0]}?`,sent=[],shown=[],traces=[];let verifies=0;
  const session=new LiveCoachingSession({snapshot:()=>context,latestContext:()=>context,send:event=>sent.push(event),onGuidance:value=>shown.push(value.say),onRequestTrace:event=>traces.push(event),verify:async()=>{verifies++;assert.fail('An exact reference echo does not assert product facts');},fallback:async()=>assert.fail('No fallback'),onBuyerTurn:()=>{},onBuyerPartial:()=>{},onBuyerSpeech:()=>{},onBuyerPending:()=>{},onSupersede:()=>{},onPendingTurn:()=>{},onThinking:()=>{},onChecking:()=>{},onUsage:()=>{},onWarning:()=>{},onError:message=>assert.fail(message),fallbackAfterMs:10000});
  try{session.requestNextMove(context);const request=sent.find(event=>event.type==='response.create');assert.ok(request);session.handle({type:'response.created',response:{id:'authored-composition',metadata:request.response.metadata}});session.handle({type:'response.output_text.delta',response_id:'authored-composition',delta:'SAY: '+say+'\nMOVE: Clarify reference spelling\n'});session.handle({type:'response.done',response:{id:'authored-composition',status:'completed'}});assert.deepEqual(shown,[say]);assert.equal(verifies,0);assert.equal(sent.filter(event=>event.type==='response.create').length,1);assert.equal(traces.filter(event=>event.event==='repair_requested').length,0);}finally{session.stop();}
 });
}
test('A compositional echo cannot change a character, quantity, owner or source role',()=>{
 const context=make(cases[0]);
 for(const spelling of ['Z as in Zulu, X-7-3','Z as in Sierra, X-7-2','Z as in Zulu, Y-7-2','Z as in Zulu, X-7-2-0','Z as in Zulu, X-7-2mm']){
  const say=`Could you confirm the model code—did you say ${spelling}?`;assert.deepEqual(buyerSpelledIdentifierClarificationReferences(say,context.turns[0].text),[],spelling);assert.equal(isBuyerIdentifierClarification(say,context.turns[0].text),false,spelling);
 }
 const owned='Could you confirm our model Z as in Zulu, X-7-2?';assert.deepEqual(buyerSpelledIdentifierClarificationReferences(owned,context.turns[0].text),[]);
 assert.deepEqual(buyerSpelledIdentifierClarificationReferences('Could you confirm Z as in Zulu, X-7-2?','Can you check report number ZX72?'),[]);
 for(const tail of ['We can offer a 20% discount.','It has a 20 mm opening.','The inspection report covers ZX72.','It is certified to ISO 9001.',"I'll send it soon."]){
  const say='Could you confirm the code—did you say Z as in Zulu, X-7-2? '+tail;assert.equal(isBuyerIdentifierClarification(say,context.turns[0].text),false);assert.ok(assessReplyVerification(say,context).unsupportedClaims.length,tail);assert.equal(checkSuggestion({say},context).ok,false,tail);
 }
 assert.ok(assessReplyVerification('Could you confirm the code Z as in Zulu, X-7-2 mm?',context).unsupportedClaims.some(claim=>claim.kind==='number'),'A unit outside the reference span is still a measured assertion.');
});
