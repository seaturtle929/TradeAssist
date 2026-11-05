import assert from 'node:assert/strict';
import test from 'node:test';
import {buyerIdentifierConfirmation,buyerIdentifierConfirmationProblems} from '../lib/buyer-identifier-confirmation.ts';
import {onDemandDecisionRules,onDemandSuggestionProblems} from '../lib/on-demand-coaching.ts';
import {assessReplyVerification} from '../lib/turn-verification-policy.ts';

// Authored fictional companies/recognition pairs. No saved customer call data.
const make=(known,heard,live=true)=>({manufacturer:{id:'fictional',name:'Synthetic Components'},sources:[{id:'product',text:`${known} is a component.`},{id:'documents',text:'Inspection reports and specifications are available for review.'}],turns:[{id:'buyer',role:'buyer',text:`Can you confirm whether your inspection report covers ${heard}?`}],coachingRequest:{id:'authored',requestedAt:2,transcriptState:'confirmed',...(live?{listeningSession:{startedAt:1,currentTurnIds:['buyer']}}:{})}});

for(const [known,heard] of [['OV20','OB20'],['AM40','AG40']])test(`A spoken unfamiliar ${heard} needs identity clarification, not a commitment about that item`,()=>{
 const context=make(known,heard),before=JSON.stringify(context);
 assert.deepEqual(buyerIdentifierConfirmation(context)?.identifiers,[heard]);
 assert.match(onDemandDecisionRules(context),/SPOKEN PRODUCT IDENTIFIER NEEDS CONFIRMATION/);
 assert.doesNotMatch(onDemandDecisionRules(context),/No permission question or new discovery is needed/);
 for(const say of [`I'll confirm if that inspection report covers ${heard} and get back to you with the exact details.`,`I'll check the report and let you know.`,`Did you mean ${known}?`,`Could you confirm the model code is ${known}?`,`Did you say model ${known}?`,`Could you confirm our model code is ${known}?`])assert.ok(onDemandSuggestionProblems(say,context).some(reason=>/Confirm or ask for the spelling/.test(reason)),say);
 for(const say of ['Could you confirm the model code so I check the right report?','Could you repeat the model number?','Could you repeat that number?',`Could you spell ${heard} so I check the right item?`]){
  assert.deepEqual(onDemandSuggestionProblems(say,context),[]);
  const checked=assessReplyVerification(say,context);assert.deepEqual(checked.unsupportedClaims,[]);assert.equal(checked.requiresVerification,false);
 }
 const literalCheck=assessReplyVerification(`I'll check whether the inspection report covers ${heard}.`,context);
 assert.deepEqual(literalCheck.unsupportedClaims,[],'A buyer reference remains an unknown identity, not an invented numerical fact.');
 assert.equal(JSON.stringify(context),before,'Neither transcript nor original sources are corrected in place.');
});

for(const spelling of ['QV80','QV-80','QV–80'])test(`Known complete code ${spelling} keeps the ordinary fast coverage check`,()=>{
 const context=make('QV80',spelling),say=`I'll check whether the inspection report covers ${spelling} and let you know.`;
 assert.equal(buyerIdentifierConfirmation(context),undefined);
 assert.match(onDemandDecisionRules(context),/DOCUMENT COVERAGE QUESTION — EVIDENCE GAP/);
 assert.deepEqual(onDemandSuggestionProblems(say,context),[]);assert.equal(assessReplyVerification(say,context).requiresVerification,false);
});

test('Manual typed unknown codes and ordinary product questions are outside the recognition guard',()=>{
 assert.equal(buyerIdentifierConfirmation(make('QV80','RX73',false)),undefined);
 const context=make('QV80','RX73');context.turns[0].text='Do you make RX73?';
 assert.equal(buyerIdentifierConfirmation(context),undefined);
 context.turns[0].text='Can you confirm whether your inspection report covers RX73?';context.coachingRequest.listeningSession.currentTurnIds=[];
 assert.equal(buyerIdentifierConfirmation(context),undefined,'Historical speech cannot trigger a new clarification.');
});

for(const line of [
 'Our part number is RX73. Does the inspection report cover RX73?',
 'RX73 is our internal part number. Does your inspection report cover RX73?',
 'RX73, spelled R-X-seven-three. Can you confirm whether the inspection report covers RX73?',
 'RX73 is spelled R-X-73. Does your inspection report cover RX73?',
])test('An explicitly supplied customer code clears recognition only: '+line,()=>{
 const context=make('QV80','RX73');context.turns[0].text=line;
 assert.equal(buyerIdentifierConfirmation(context),undefined);
 assert.deepEqual(onDemandSuggestionProblems("I'll check whether the inspection report covers RX73.",context),[]);
 const affirmative=assessReplyVerification('The inspection report covers RX73.',context);
 assert.ok(affirmative.requiresVerification||affirmative.unsupportedClaims.length,'The buyer cannot establish supplier document coverage.');
});

test('A spoken answer to the rep clarification is remembered when the buyer repeats the report question',()=>{
 const context=make('QV80','RX73');
 context.turns=[{id:'rep',role:'you',text:'Could you confirm the model code so I check the right report?'},{id:'confirmed',role:'buyer',text:'Yes, RX73.'},...context.turns];
 context.coachingRequest.listeningSession.currentTurnIds=['rep','confirmed','buyer'];
 assert.equal(buyerIdentifierConfirmation(context),undefined);
 assert.deepEqual(buyerIdentifierConfirmationProblems("I'll check whether the report covers RX73.",context),[]);
});

test('Restarting listening in the same call retains an actual earlier code confirmation',()=>{
 const context=make('QV80','RX73');
 context.turns=[{id:'old-rep',role:'you',text:'Could you confirm the model code so I check the right report?'},{id:'old-confirmed',role:'buyer',text:'Yes, RX73.'},...context.turns];
 context.coachingRequest.listeningSession={startedAt:3,currentTurnIds:['buyer']};
 assert.equal(buyerIdentifierConfirmation(context),undefined);
 assert.deepEqual(buyerIdentifierConfirmationProblems("I'll check whether the inspection report covers RX73.",context),[]);
});

test('An old unconfirmed request or buyer memory is not a spelling confirmation',()=>{
 const context=make('QV80','RX73');
 context.turns=[{id:'old-request',role:'buyer',text:'Does the inspection report cover RX73?'},...context.turns];
 context.coachingRequest.listeningSession={startedAt:3,currentTurnIds:['buyer']};
 context.brain={buyerMemory:{facts:{product:'RX73, spelled R-X-73'}}};
 assert.deepEqual(buyerIdentifierConfirmation(context)?.identifiers,['RX73']);
});

test('An unrelated or contradictory spelling does not resolve an unfamiliar product code',()=>{
 for(const line of ['Does the inspection report cover RX73? My name is Ray, spelled R-A-Y.','RX73, spelled Q-V-80. Does your inspection report cover RX73?']){
  const context=make('QV80','RX73');context.turns[0].text=line;
  assert.deepEqual(buyerIdentifierConfirmation(context)?.identifiers,['RX73'],line);
 }
});

test('Recognition clarification does not exempt substantive claims or company boundaries',()=>{
 const context=make('QV80','RX73');
 for(const tail of ['Our report covers RX73.','We can ship tomorrow.','We can offer a 12% discount.','It is certified to ISO 9001.']){
  const result=assessReplyVerification('Could you confirm the model code? '+tail,context);
  assert.ok(result.requiresVerification||result.unsupportedClaims.length,tail);
 }
 assert.ok(buyerIdentifierConfirmationProblems('RX73 does not exist.',context).length);
 assert.ok(buyerIdentifierConfirmationProblems('Could you confirm whether you want QV80?',context).length,'No silent fuzzy substitution even in question form.');
 for(const say of ['Could you confirm your phone number?','Could you repeat the account number?','Could you confirm the order code?','Could you confirm the report number?'])assert.ok(buyerIdentifierConfirmationProblems(say,context).length,say);
});
