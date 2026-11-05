import assert from 'node:assert/strict';
import test from 'node:test';
import {buyerSpelledIdentifierClarificationReferences,isBuyerIdentifierClarification,isBuyerIdentifierSpellingClarification,productIdentityReferences} from '../lib/product-identity-evidence.ts';
import {assessReplyVerification} from '../lib/turn-verification-policy.ts';
import {needsFactCheck} from '../lib/call-coaching.ts';
import {checkSuggestion} from '../lib/call-purpose.ts';
import {LiveCoachingSession} from '../lib/live-coaching-session.ts';

// Authored synthetic recognition fixture, not a saved call or model output.
const input={manufacturer:{id:'cedar-fictional',name:'Cedar Instruments',products:'inspection instruments'},sources:[{id:'available',text:'Specification sheets and inspection reports are available.'}],turns:[{id:'buyer',role:'buyer',text:'Our engineer asked whether the inspection report covers ZX72. Can you check?'}],coachingRequest:{id:'authored',requestedAt:2,transcriptState:'confirmed',listeningSession:{startedAt:1,currentTurnIds:['buyer']}}};
for(const spelling of ['Z-X-7-2','Z–X–7–2'])test('An exact spelled buyer-code question does not invent numerical facts: '+spelling,()=>{
 const say=`Thanks for raising that. Just to be sure, could you confirm the exact code your engineer mentioned for the material, was it ${spelling}?`;
 const refs=buyerSpelledIdentifierClarificationReferences(say,input.turns[0].text);assert.equal(refs.length,1);assert.equal(refs[0].text,spelling);assert.equal(refs[0].buyerText,'ZX72');assert.equal(refs[0].sourceId,undefined);
 assert.deepEqual(productIdentityReferences(say,input.sources),[]);
 const assessment=assessReplyVerification(say,input);assert.deepEqual(assessment.unsupportedClaims,[]);assert.equal(assessment.requiresVerification,false);assert.equal(needsFactCheck(say,input),false);
 const verdict=checkSuggestion({say},input);assert.equal(verdict.ok,true,JSON.stringify(verdict));assert.equal(verdict.needsVerification,false);
});
test('A changed digit or prefix cannot borrow the buyer spelling',()=>{
 for(const spelling of ['Z-X-7-3','Z-Y-7-2','Z-X-7-2-0']){
  const say=`Could you confirm the model code, was it ${spelling}?`;
  assert.deepEqual(buyerSpelledIdentifierClarificationReferences(say,input.turns[0].text),[]);
  assert.ok(assessReplyVerification(say,input).unsupportedClaims.some(claim=>claim.kind==='number'));
 }
});
test('Only the identifier digits are exempt; a mixed factual tail remains checked',()=>{
 for(const tail of ['We can offer a 20% discount.','It has a 20 mm opening.','It is certified to ISO 9001.','We guarantee all results.']){
  const say='Could you confirm the code, was it Z-X-7-2? '+tail,result=assessReplyVerification(say,input);
  assert.ok(result.requiresVerification||result.unsupportedClaims.length,tail);assert.equal(checkSuggestion({say},input).ok,false,tail);
 }
 assert.equal(isBuyerIdentifierSpellingClarification('Could you confirm Z-X-7-2 and a 20% discount?',input.turns[0].text),false);
});
test('A spelled assertion, unknown ownership, report identifier or old buyer code gets no exemption',()=>{
 for(const [say,buyer] of [['Our Z-X-7-2 is available.',input.turns[0].text],['Could you confirm our Z-X-7-2?',input.turns[0].text],['Does the report cover Z-X-7-2?','Can you check report ID ZX72?'],['Was it Z-X-7-2?','Please check the report.']])assert.deepEqual(buyerSpelledIdentifierClarificationReferences(say,buyer),[],say);
});

for(const say of [
 'Thanks for letting me know. Could you confirm the exact code or spelling for ZX72, so I can check that accurately for you?',
 'Thanks for letting me know. Could you confirm the exact code or spelling for Z-X-7-2, so I can check that accurately for you?',
 'Thanks for that question. Could you confirm the exact spelling or any other details for ZX72, so I can be sure we’re checking coverage for the right material?',
 'Could you confirm the spelling of ZX72 so we can check the right material?',
])test('One intentional live request publishes a complete reference clarification with a bounded purpose: '+say,()=>{
 const context=structuredClone(input),sent=[],shown=[],traces=[];let verificationCalls=0;
 assert.equal(isBuyerIdentifierClarification(say.split('. ').at(-1),context.turns[0].text),true);
 assert.equal(needsFactCheck(say,context),false);assert.equal(checkSuggestion({say},context).ok,true);
 const session=new LiveCoachingSession({snapshot:()=>context,latestContext:()=>context,send:event=>sent.push(event),onGuidance:(guidance,id,_at,complete)=>shown.push({say:guidance.say,id,complete}),onRequestTrace:event=>traces.push(event),verify:async()=>{verificationCalls++;assert.fail('A pure identifier clarification is not a coverage claim');},fallback:async()=>assert.fail('Unexpected fallback'),onBuyerTurn:()=>{},onSupersede:()=>{},onPendingTurn:()=>{},onThinking:()=>{},onChecking:()=>{},onBuyerPartial:()=>{},onBuyerSpeech:()=>{},onBuyerPending:()=>{},onUsage:()=>{},onWarning:()=>{},onError:message=>assert.fail(message),fallbackAfterMs:10000});
 try{
  session.requestNextMove(context);const create=sent.find(event=>event.type==='response.create');assert.ok(create);
  session.handle({type:'response.created',response:{id:'authored-clarifier',metadata:create.response.metadata}});
  session.handle({type:'response.output_text.delta',response_id:'authored-clarifier',delta:'SAY: '+say+'\nMOVE: Clarify the buyer reference\n'});
  session.handle({type:'response.done',response:{id:'authored-clarifier',status:'completed'}});
  assert.equal(shown.length,1);assert.equal(shown[0].say,say);assert.equal(shown[0].complete,true);assert.equal(verificationCalls,0);
  assert.equal(sent.filter(event=>event.type==='response.create').length,1);assert.equal(traces.filter(event=>event.event==='repair_requested').length,0);
 }finally{session.stop();}
});

test('A bounded identifier-check tail cannot exempt owned, factual, commercial or timing additions',()=>{
 for(const say of ['Could you confirm our ZX72 product, so I can check that accurately for you?','Could you confirm that our report covers ZX72, so I can check that accurately for you?','Could you confirm the code ZX72? We can offer a 20% discount.','Could you confirm the code ZX72? It has a 20 mm opening.','Could you confirm the code ZX72? It is certified to ISO 9001.','Could you confirm the code ZX72, so I can reply soon?']){
  assert.equal(isBuyerIdentifierClarification(say,input.turns[0].text),false,say);
  assert.equal(needsFactCheck(say,input),true,say);assert.equal(checkSuggestion({say},input).ok,false,say);
 }
 assert.equal(isBuyerIdentifierClarification('Could you confirm the code for ZX73, so I can check that accurately for you?',input.turns[0].text),false);
});
