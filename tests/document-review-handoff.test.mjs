import assert from 'node:assert/strict';
import test from 'node:test';
import {createClientRecord,upsertClientContact} from '../lib/client-records.ts';
import {ensureCompanyBrain} from '../lib/company-brain.ts';
import {bindCompanyConfiguration} from '../lib/company-configuration.ts';
import {proposeCallWrapUp,saveClientCallWrapUp} from '../lib/client-workflow.ts';
import {buildClientStanding} from '../lib/client-standing.ts';
import {buildCallPreparation,buildClientCoachingContext,parseCallPreparation} from '../lib/client-coaching-context.ts';
import {groundedPreparationBrief} from '../lib/client-preparation-server.ts';

// Entirely fictional calibration-equipment exchange. No customer data, saved
// speech, company documents, browser storage, API calls or learning is used.
const exchange=[
 ['buyer','Mira speaking.'],
 ['buyer','We are evaluating a torque bench for our calibration workshop.'],
 ['buyer','In your email, please attach the specification sheet and inspection report.'],
 ['you',"Yes, I'll get both over. Which inbox should I use?"],
 ['buyer','Our workshop is still choosing its shared inbox.'],
];
const clone=value=>structuredClone(value);

function fixture(rows=exchange){
 const company={id:'fictional-calibration-supplier',name:'Juniper Instruments',products:'Calibration fixtures',introduction:'',sources:[]};
 let client=createClientRecord(company.id,'Cypress Calibration Workshop',1000,'fictional-calibration-client');
 client=upsertClientContact(client,{id:'fictional-mira',name:'Mira',kind:'person'},1100);
 const brain={...ensureCompanyBrain(company),clients:[client]};
 company.brain=brain;
 const binding=bindCompanyConfiguration(company,'solution_discussion',undefined,9000);
 const call={id:'fictional-document-handoff-call',manufacturerId:company.id,manufacturerName:company.name,clientId:client.id,contactId:'fictional-mira',buyer:client.name,goal:'Explore an appropriate technical evaluation',startedAt:10000,duration:60,turns:rows.map(([role,text],index)=>({id:`fictional-turn-${index}`,role,text,at:10001+index})),notes:'',outcome:'',callType:'discovery',bilingual:false,callContext:{stageId:'solution_discussion'},companyConfiguration:binding,suggestions:[]};
 return {company,brain,client,call};
}

function saveReopenAndPrepare(value,{reviewedRecap}={}){
 const original=JSON.stringify(value),draft=proposeCallWrapUp(value.call,value.client);
 const reviewed={...draft,...reviewedRecap!==undefined?{recap:reviewedRecap}:{}};
 const first=saveClientCallWrapUp(value.brain,[],value.call,reviewed,20000);
 // Exercise the persisted data shape, not a pre-save object reference.
 const reopened=JSON.parse(JSON.stringify({brain:first.brain,calls:first.calls}));
 const client=reopened.brain.clients.find(row=>row.id===value.client.id);
 const standing=buildClientStanding({client,calls:reopened.calls,now:30000});
 const company={...value.company,brain:reopened.brain};
 const binding=bindCompanyConfiguration(company,'solution_discussion',undefined,29000);
 const stage=binding.snapshot.stages.find(row=>row.id==='solution_discussion');
 // Model sections are deliberately empty: this tests the actual offline
 // display-grounding rule that the reviewed current account takes precedence.
 const brief=groundedPreparationBrief({situation:[],potentialFit:[],whatToClarify:['Which destination should receive the documents?']},{companyId:company.id,clientId:client.id,stage,references:[],companyFacts:[],inputFingerprint:'fictional-handoff',standing},30000);
 const snapshot=buildCallPreparation({company,client,contactId:'fictional-mira',callId:'fictional-next-call',stageId:stage.id,configurationBinding:binding,calls:reopened.calls,callBackground:{context:'',websites:[],sources:[],brief},now:30000},{reviewed:true});
 const context=buildClientCoachingContext(snapshot);
 assert.equal(JSON.stringify(value),original,'Shared helpers must not mutate the source call or client.');
 return {draft,reviewed,reopened,client,standing,brief,snapshot,context};
}

test('Spoken two-document request survives review, save, reload and next-call preparation',()=>{
 const value=fixture(),result=saveReopenAndPrepare(value);
 assert.ok(result.draft.recap.includes(exchange[2][1]));
 assert.ok(result.draft.recap.includes(exchange[3][1]));
 assert.ok(result.draft.memory.some(row=>row.sourceTurnId==='fictional-turn-2'&&row.quote===exchange[2][1]));
 assert.ok(result.draft.memory.some(row=>row.sourceTurnId==='fictional-turn-3'&&row.quote===exchange[3][1]&&row.kind==='agreed'));
 assert.deepEqual(result.standing.documents,['spec sheets','test reports']);
 assert.match(result.standing.buyerRequested.join(' '),/spec sheets and test reports/);
 assert.match(result.standing.repOwes.join(' '),/spec sheets and test reports/);
 assert.equal(result.standing.sendStatus,'pending');
 assert.equal(result.standing.receiptStatus,'unconfirmed');
 assert.equal(result.standing.reviewStatus,'unconfirmed');
 assert.equal(result.standing.contact?.email,undefined);
 assert.equal(result.context.contact?.email,undefined);
 assert.match(result.standing.unknowns.join(' '),/destination address is unconfirmed/);
 assert.equal(result.client.currentSummary.text,result.reviewed.recap);
 assert.equal(result.brief.situation,result.standing.summary);
 assert.ok(parseCallPreparation(result.snapshot));
 assert.deepEqual(result.context.standing.documents,['spec sheets','test reports']);
 assert.equal(result.context.standing.sendStatus,'pending');
 assert.equal(result.context.standing.receiptStatus,'unconfirmed');
 assert.equal(result.context.standing.reviewStatus,'unconfirmed');
 assert.equal(result.context.stageId,'solution_discussion');
 assert.deepEqual(result.reopened.calls[0].turns,value.call.turns);
});

test('A retry uses the same call ID and does not duplicate history or client linkage',()=>{
 const value=fixture(),result=saveReopenAndPrepare(value),saved=result.reopened.calls[0];
 const retry=saveClientCallWrapUp(result.reopened.brain,result.reopened.calls,saved,saved.wrapUp,31000);
 assert.equal(retry.calls.length,1);
 assert.equal(retry.calls[0].id,value.call.id);
 assert.deepEqual(retry.calls[0].turns,value.call.turns);
 assert.equal(retry.brain.clients[0].callIds.filter(id=>id===value.call.id).length,1);
 assert.equal(retry.brain.clients[0].currentSummary.text,result.reviewed.recap);
});

test('An explicit reviewed correction outranks the original transcript bundle',()=>{
 const value=fixture(),recap='Spoke with Mira. Mira requested only the spec sheet. The test report is not requested. Sending and the destination address remain unconfirmed.';
 const result=saveReopenAndPrepare(value,{reviewedRecap:recap});
 assert.equal(result.client.currentSummary.text,recap);
 assert.equal(result.standing.summary,recap);
 assert.deepEqual(result.standing.documents,['spec sheets']);
 assert.equal(result.standing.sendStatus,'pending');
 assert.doesNotMatch(result.standing.buyerRequested.join(' '),/test reports/);
 assert.doesNotMatch(result.standing.repOwes.join(' '),/test reports/);
 assert.deepEqual(result.context.standing.documents,['spec sheets']);
 assert.equal(result.brief.situation,recap);
 const existing={...clone(value.call),wrapUp:{...result.reviewed,reviewedAt:20000}};
 assert.equal(proposeCallWrapUp(existing,value.client).recap,recap);
});

test('A later spoken cancellation narrows the generated recap and pending bundle',()=>{
 const value=fixture([...exchange,['buyer',"Please don't send the inspection report."]]);
 const result=saveReopenAndPrepare(value);
 assert.match(result.draft.recap,/Current requested document bundle:\s*spec sheets/);
 assert.ok(result.draft.recap.includes("Please don't send the inspection report."));
 assert.deepEqual(result.standing.documents,['spec sheets']);
 assert.equal(result.standing.sendStatus,'pending');
 assert.match(result.standing.repOwes.join(' '),/spec sheets/);
 assert.doesNotMatch(result.standing.repOwes.join(' '),/test reports/);
 assert.deepEqual(result.context.standing.documents,['spec sheets']);
 assert.equal(result.standing.receiptStatus,'unconfirmed');
 assert.equal(result.standing.reviewStatus,'unconfirmed');
});

test('Cancelling all requested documents leaves no send obligation after reopening',()=>{
 const value=fixture([...exchange,['buyer',"Please don't send any documents."]]);
 const result=saveReopenAndPrepare(value);
 assert.match(result.draft.recap,/No requested documents remain\./);
 assert.deepEqual(result.standing.documents,[]);
 assert.deepEqual(result.standing.buyerRequested,[]);
 assert.equal(result.standing.sendStatus,'unknown');
 assert.match(result.standing.repOwes.join(' '),/cancelled.*no remaining document-send obligation/i);
 assert.deepEqual(result.context.standing.documents,[]);
 assert.equal(result.context.standing.sendStatus,'unknown');
});

test('A proof question mentioning specifications does not create a document-send request',()=>{
 const value=fixture([
  ['buyer','Mira speaking.'],
  ['buyer','Our existing fixture already meets these specifications. What evidence would justify evaluating another instrument?'],
  ['you','We can discuss which comparison would be useful.'],
 ]);
 const result=saveReopenAndPrepare(value);
 assert.deepEqual(result.standing.documents,[]);
 assert.deepEqual(result.standing.buyerRequested,[]);
 assert.deepEqual(result.standing.repOwes,[]);
 assert.equal(result.standing.sendStatus,'unknown');
 assert.deepEqual(result.context.standing.documents,[]);
 assert.doesNotMatch(result.draft.recap,/agreed to send|Buyer requested the/i);
});
