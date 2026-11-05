import assert from 'node:assert/strict';
import test from 'node:test';
import {buyerSpelledIdentifierClarificationReferences,isBuyerIdentifierSpellingClarification,productIdentityReferences} from '../lib/product-identity-evidence.ts';
import {assessReplyVerification} from '../lib/turn-verification-policy.ts';
import {needsFactCheck} from '../lib/call-coaching.ts';
import {checkSuggestion} from '../lib/call-purpose.ts';

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
