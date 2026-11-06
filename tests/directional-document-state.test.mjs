import test from 'node:test';
import assert from 'node:assert/strict';
import {deriveDocumentState} from '../lib/document-state.ts';
import {deriveConversationState} from '../lib/conversation-state.ts';
import {incomingDrawingState} from '../lib/incoming-document-state.ts';
import {ensureCompanyBrain,buildBrainRequest,rememberBuyer} from '../lib/company-brain.ts';
import {createClientRecord} from '../lib/client-records.ts';
import {proposeCallWrapUp,saveClientCallWrapUp} from '../lib/client-workflow.ts';
import {buildClientStanding} from '../lib/client-standing.ts';
import {CallWrapUpInput,BrainRequestInput,ClientStandingInput} from '../lib/company-brain-input.ts';
// Authored fictional supplier and references, never imported client records.
const company={id:'synthetic-eider',name:'Eider Sensor Export',products:'sensors',introduction:'',sources:[{id:'eider-documents',text:'Material test reports and specification sheets are available.'}]};
const turns=(last="I will review your drawing and send the material test report only if it covers RX73.")=>[
 {id:'ref',role:'buyer',text:'RX73 is our drawing reference.',at:11},
 {id:'draw',role:'buyer',text:'I will email the drawing. Send the material test report only if it covers RX73.',at:12},
 {id:'rep',role:'you',text:last,at:13},
];
const find=(state,kind,actor)=>state.transfers.find(row=>row.document===kind&&row.sender===actor);

test('A conditional delivery request is requested, while a coverage question alone is an inquiry',()=>{
 const requested=deriveDocumentState({turns:[{id:'request',role:'buyer',text:'Please send the material test report only if it covers RX73.'}]});
 assert.equal(find(requested,'test reports','you').phase,'requested');
 assert.equal(find(requested,'test reports','you').sendStatus,'pending');
 const question=deriveDocumentState({turns:[{id:'question',role:'buyer',text:'Does the material test report cover RX73?'}]});
 assert.equal(find(question,'test reports','you').phase,'inquiry');
 assert.equal(find(question,'test reports','you').sendStatus,'unconfirmed');
});

test('Incoming drawing and conditional outgoing report retain actor, promise, receipt and source boundaries',()=>{
 const state=deriveDocumentState({turns:turns(),sources:company.sources}),drawing=find(state,'drawings','buyer'),report=find(state,'test reports','you');
 assert.equal(drawing.phase,'promised');assert.equal(drawing.sendStatus,'pending');assert.equal(drawing.receiptStatus,'unconfirmed');
 assert.equal(find(state,'drawings','you'),undefined,'Reviewing a drawing does not promise to send it.');
 assert.equal(report.phase,'promised');assert.equal(report.condition.kind,'coverage_positive');assert.equal(report.coverage,'unknown');assert.equal(report.sendStatus,'pending');
});
for(const line of ["Once we have checked that the material test report covers RX73, I will reply with it.","I will review your drawing and, if the material test report covers RX73, send it."])
 test('Outgoing report pronoun binds its action rather than the drawing: '+line,()=>{
  const state=deriveDocumentState({turns:turns(line)});
  assert.equal(find(state,'drawings','you'),undefined);
  assert.ok(find(state,'test reports','you').events.some(e=>e.kind==='promised'));
 });

test('A buyer future send is not a rep request or missing-email objective',()=>{
 const state=deriveConversationState({callId:'new-call',turns:turns()});
 assert.equal(state.commitments.some(row=>row.owner==='you'&&/drawings/i.test(row.action)),false);
 assert.notEqual(state.nextAction.kind,'capture_email');assert.notEqual(state.nextAction.kind,'discovery');
 assert.equal(find(state.documents,'test reports','you').coverage,'unknown');
});

test('A full revised transcript rebuilds stale same-call generic commitment cache',()=>{
 const rows=turns(),stale={callId:'new-call',processedTurnIds:rows.map(row=>row.id),facts:{},commitments:[{id:'send_materials',action:'Send product drawings',owner:'you',status:'needs_email',missing:['email'],evidence:[{turnId:'draw',quote:rows[1].text}]}],sequence:[{id:'send_profile',label:'Send product drawings',owner:'you',status:'needs_email'}],lastAgreedNextStep:'Send product drawings'};
 const state=deriveConversationState({callId:'new-call',turns:rows,buyerMemory:stale});
 assert.equal(state.commitments.some(row=>row.id==='send_materials'),false);assert.notEqual(state.nextAction.kind,'capture_email');assert.equal(find(state.documents,'drawings','buyer').phase,'promised');
});

for(const text of ["Have you sent the drawing?","Once we receive the drawing, we will review it.","We have received your drawing? Let me check."])
 test('Receipt question/prerequisite does not fulfill an incoming drawing: '+text,()=>{
  const rows=[...turns(),{id:'question',role:'you',text,at:14}];assert.equal(incomingDrawingState({turns:rows}).state,'promised');
 });

test('Buyer reports sent remains separate from rep receipt and later denial',()=>{
 let rows=[...turns(),{id:'sent',role:'buyer',text:'I emailed the drawing.',at:14}],state=deriveDocumentState({turns:rows});assert.equal(find(state,'drawings','buyer').sendStatus,'reported_sent');assert.equal(find(state,'drawings','buyer').receiptStatus,'unconfirmed');
 rows.push({id:'receipt',role:'you',text:'I received your drawing.',at:15});state=deriveDocumentState({turns:rows});assert.equal(find(state,'drawings','buyer').receiptStatus,'confirmed');
 rows.push({id:'correction',role:'you',text:"I haven't received the drawing.",at:16});state=deriveDocumentState({turns:rows});assert.equal(find(state,'drawings','buyer').receiptStatus,'unconfirmed');
});

for(const source of ['Material test reports are available. RX73 sensors have a steel body.','The inspection report covers RX73.','We will check whether the material test report covers RX73.'])
 test('Availability, other-document scope and future checks cannot verify requested material report: '+source,()=>{
  const state=deriveConversationState({callId:'c',turns:turns(),sources:[{id:'scope',text:source}]});assert.equal(find(state.documents,'test reports','you').coverage,'unknown');
 });

test('An explicit same-report same-reference approved source can verify coverage; removing it reopens the gap',()=>{
 const sources=[{id:'scope',text:'The material test report covers RX73.'}],state=deriveDocumentState({turns:turns(),sources});assert.equal(find(state,'test reports','you').coverage,'verified');
 assert.equal(find(deriveDocumentState({seed:state,turns:[],sources:[]}), 'test reports','you').coverage,'unknown');
});

function saved(){const client=createClientRecord(company.id,'Fictional Aspen Design',1,'aspen');let brain={...ensureCompanyBrain(company),clients:[client]};const call={id:'synthetic-call',manufacturerId:company.id,clientId:client.id,buyer:client.name,startedAt:10,turns:turns(),notes:'',outcome:'',callContext:{stageId:'discovery'},suggestions:[]};const wrap=proposeCallWrapUp(call,client);const result=saveClientCallWrapUp(brain,[],call,wrap,20);return {client,wrap,result};}

test('Reviewed save/reopen retains both directional actions and pending coverage in standing and next-call state',()=>{
 const {wrap,result}=saved();assert.match(wrap.recap,/buyer promised to send the drawings/i);assert.doesNotMatch(wrap.recap,/Document handoff|receiptStatus|coverage_positive/);
 const restored=JSON.parse(JSON.stringify(result)),client=restored.brain.clients[0],standing=buildClientStanding({client,calls:restored.calls,now:30});
 assert.equal(find(standing.documentState,'drawings','buyer').phase,'promised');assert.match(standing.buyerOwes.join(' '),/drawing.*pending/i);assert.match(standing.repOwes.join(' '),/coverage/i);assert.equal(find(standing.documentState,'test reports','you').coverage,'unknown');assert.equal(standing.sendStatus,'pending');
 assert.deepEqual(CallWrapUpInput.parse(restored.call.wrapUp).documentState,restored.call.wrapUp.documentState);assert.deepEqual(ClientStandingInput.parse(standing).documentState,standing.documentState);
 const context={version:1,companyId:company.id,clientId:client.id,callId:'next',clientName:client.name,stageId:'discovery',configurationVersionId:'v1',configurationVersion:1,reviewedAt:30,clientUpdatedAt:30,preparationFingerprint:'reviewed',background:'',outsideUpdate:'',entries:[],history:[],isReturning:true,standing};
 const state=deriveConversationState({manufacturer:company,clientId:client.id,callId:'next',clientContext:context,turns:[]});assert.equal(find(state.documents,'drawings','buyer').phase,'promised');assert.equal(find(state.documents,'test reports','you').coverage,'unknown');
 const request=buildBrainRequest(company,client.name,state,[]);assert.deepEqual(BrainRequestInput.parse(request).buyerMemory.documents,state.documents);
});

test('A reviewed recap edit invalidates old structured extraction instead of resurrecting omitted raw speech',()=>{
 const {result}=saved(),call=result.call,wrap={...call.wrapUp,recap:'The buyer cancelled the drawing and no report was requested.'};
 const next=saveClientCallWrapUp(result.brain,result.calls,call,wrap,25),standing=buildClientStanding({client:next.brain.clients[0],calls:next.calls,now:30});
 assert.equal(standing.documentState?.transfers.some(row=>row.phase==='promised')||false,false);assert.equal(standing.summary,wrap.recap);
});

test('Saving corrected empty current commitments cannot resurrect stale old buyer memory',()=>{
 let brain=ensureCompanyBrain(company),state=deriveConversationState({callId:'c',turns:turns()});brain=rememberBuyer(brain,'Fictional Aspen',state);
 state={...state,documents:{version:1,transfers:[],processedTurnIds:[]},commitments:[],sequence:[],lastAgreedNextStep:''};brain=rememberBuyer(brain,'Fictional Aspen',state);
 assert.deepEqual(brain.buyers[0].commitments,[]);assert.deepEqual(brain.buyers[0].documents.transfers,[]);assert.equal(brain.buyers[0].lastAgreedNextStep,'');
});

test('A coverage inquiry is not a request to send the report or collect an email',()=>{
 const rows=[{id:'question',role:'buyer',text:'Does the inspection report cover KM73?',at:1}],state=deriveConversationState({callId:'inquiry-call',turns:rows});
 const report=find(state.documents,'test reports','you');assert.equal(report.phase,'inquiry');assert.equal(report.sendStatus,'unconfirmed');
 assert.equal(state.commitments.some(row=>/^Send /.test(row.action)),false);assert.equal(state.commitments.some(row=>row.missing.includes('email')),false);assert.notEqual(state.nextAction.kind,'capture_email');
});

test('An offer to check report coverage does not promise a report or an outgoing drawing',()=>{
 const rows=[{id:'buyer',role:'buyer',text:'Does the material test report cover our drawing reference?',at:1},{id:'check',role:'you',text:'I will check whether the material test report covers the drawing.',at:2}],state=deriveConversationState({callId:'check-call',turns:rows});
 assert.equal(find(state.documents,'drawings','you'),undefined);assert.equal(find(state.documents,'test reports','you').phase,'checking');
 assert.equal(state.commitments.some(row=>/^Send /.test(row.action)),false);assert.equal(state.commitments.some(row=>row.missing.includes('email')),false);
});

test('Approved positive coverage satisfies that prerequisite, leaving only an actual missing delivery route',()=>{
 const state=deriveConversationState({callId:'approved-coverage',turns:turns(),sources:[{id:'eider-scope',text:'The material test report covers RX73.'}]});
 const report=find(state.documents,'test reports','you');assert.equal(report.coverage,'verified');
 const commitment=state.commitments.find(row=>row.id===`document:${report.id}`);assert.deepEqual(commitment.missing,['email']);assert.equal(commitment.status,'needs_email');
});


test('Reviewed and rep-update action provenance cannot become an original transcript quotation',()=>{
 const reviewed=deriveDocumentState({turns:[{id:'reviewed',role:'you',text:'I will send the specification sheet.',source:'reviewed_recap'}]});
 assert.ok(reviewed.transfers[0].events.every(event=>event.source==='reviewed_recap'));
 const updated=deriveDocumentState({turns:[{id:'request',role:'buyer',text:'Please send the specification sheet.',source:'reviewed_recap'},{id:'cancel',role:'buyer',text:'Do not send the specification sheet.',source:'rep_update'}]});
 assert.ok(updated.transfers.flatMap(row=>row.events).filter(event=>event.turnId==='cancel').every(event=>event.source==='rep_update'));
});
