import assert from 'node:assert/strict';
import test from 'node:test';
import {conversations} from '../scripts/regression/conversation-fixtures.mjs';
import {clientContextSuggestionProblems,clientContextSafeReply,reviewedClientStateFacts} from '../lib/client-coaching-context.ts';
import {assessReplyVerification} from '../lib/turn-verification-policy.ts';
import {checkSuggestion} from '../lib/call-purpose.ts';
import {buildClientStanding} from '../lib/client-standing.ts';

// Authored fictional contexts only. No customer records or observed call text.
function fixture(update='I emailed Nora the company profile and valve specification sheet yesterday.') {
 const original=conversations.find(row=>row.id==='received-review-deferred');
 const context=structuredClone(original.context);
 context.clientContext.outsideUpdate=update;
 context.turns=original.steps.slice(0,3).map((step,index)=>({id:'synthetic-send-turn-'+index,role:step.role,text:step.text,at:index+1}));
 context.coachingRequest={id:'synthetic-sent-followup',requestedAt:5};
 return context;
}
const opener='Hi Nora, this is Mira from Keystone Valve Export. I sent the company profile and specification sheet you asked for; I’m following up on your evaluation.';

test('A reviewed rep outside update supports the same scoped send without requiring a duplicated memory entry',()=>{
 const input=fixture(),before=JSON.stringify(input);
 assert.deepEqual(input.clientContext.entries,[]);
 assert.deepEqual(clientContextSuggestionProblems(opener,input),[]);
 assert.equal(checkSuggestion({say:opener},input,{factChecked:true}).ok,true);
 assert.deepEqual(assessReplyVerification(opener,input).unsupportedClaims,[]);
 assert.equal(JSON.stringify(input),before,'The reviewed client context must not be mutated or synthesize transcript turns.');
});

test('A send-status answer uses the reviewed rep completion instead of asking the rep to verify it again',()=>{
 const input=fixture();input.turns.push({id:'buyer-status',role:'buyer',text:'Did you email the company profile and specification sheet?',at:4});
 assert.match(clientContextSafeReply(input),/^I sent the information we discussed\./);
});

for(const update of [
 'I will email Nora the company profile and valve specification sheet.',
 'I have not sent Nora the company profile and valve specification sheet.',
 'I am not sure whether I sent Nora the company profile and valve specification sheet.',
 'If I sent Nora the company profile and valve specification sheet, it would be in my outbox.',
])test('An uncompleted or uncertain outside update is not send evidence: '+update,()=>{
 assert.ok(clientContextSuggestionProblems(opener,fixture(update)).some(reason=>/completion/.test(reason)));
});

test('A rep report does not establish completion for a different artifact or product',()=>{
 const input=fixture('I emailed the company profile and QV80 specification sheet yesterday.');
 assert.ok(clientContextSuggestionProblems('I sent the material test report.',input).some(reason=>/completion/.test(reason)));
 assert.ok(clientContextSuggestionProblems('I sent the QV81 specification sheet.',input).some(reason=>/completion/.test(reason)));
 assert.deepEqual(clientContextSuggestionProblems('I sent the QV80 specification sheet.',input),[]);
});

test('The outside update remains representative context and does not become buyer facts',()=>{
 const input=fixture(),facts=reviewedClientStateFacts(input);
 assert.equal(facts.specs,undefined);
 assert.equal(facts.volumes,undefined);
 assert.equal(facts.decision_maker,undefined);
 assert.equal(facts.email,undefined);
});

test('The report of sending leaves receipt and review unconfirmed in the current client account',()=>{
 const companyId='synthetic-juniper',clientId='synthetic-cypress',callId='synthetic-prior-review';
 const recap='Spoke with Noor in purchasing. Noor requested the company profile and specification sheet. The salesperson promised to send them. Receipt and review remain unconfirmed.';
 const client={id:clientId,companyId,name:'Cypress Workshop',contacts:[{id:'noor',companyId,clientId,name:'Noor',role:'Purchasing',kind:'person'}],context:[],callIds:[callId],background:'',createdAt:1,updatedAt:2,currentSummary:{callId,text:recap,reviewedAt:20}};
 const call={id:callId,manufacturerId:companyId,clientId,startedAt:10,turns:[],wrapUp:{recap,outcome:'Information requested',reviewedAt:20}};
 const standing=buildClientStanding({client,calls:[call],outsideUpdate:'I sent the company profile and specification sheet yesterday.',now:30});
 assert.equal(standing.sendStatus,'sent');
 assert.equal(standing.receiptStatus,'unconfirmed');
 assert.equal(standing.reviewStatus,'unconfirmed');
 assert.ok(standing.unknowns.some(value=>/receipt is unconfirmed/i.test(value)));
 assert.ok(standing.unknowns.some(value=>/review is unconfirmed/i.test(value)));
});

test('The reviewed completion cannot be borrowed by another company or call',()=>{
 const otherCompany=fixture();otherCompany.manufacturer.id='synthetic-other-company';
 assert.throws(()=>clientContextSuggestionProblems(opener,otherCompany),/does not belong/);
 const otherCall=fixture();otherCall.callId='synthetic-other-call';
 assert.throws(()=>clientContextSuggestionProblems(opener,otherCall),/does not belong/);
});
