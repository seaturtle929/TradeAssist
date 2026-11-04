import assert from 'node:assert/strict';
import test from 'node:test';
import {deriveSpokenDocumentEvidence,documentKinds,isDocumentRequest,isRepContactDetailRequest} from '../lib/document-call-evidence.ts';
import {deriveCallReview} from '../lib/call-review.ts';
import {proposeCallWrapUp,proposeReviewedCallContacts} from '../lib/client-workflow.ts';

// Deliberately fictional laboratory-equipment exchange. No saved customer
// records, transcripts, company documents or learning examples are fixtures.
const rows=[
 ['buyer','Noor here.'],
 ['buyer','Would you email the specifications and inspection report for our lab?'],
 ['you',"Absolutely. I'll get both over. Which address should I use?"],
 ['buyer','I need to check the address.'],
];
const turns=value=>value.map(([role,text],index)=>({id:`synthetic-${index}`,role,text,at:1000+index}));
const call=value=>({id:'fictional-document-review',manufacturerId:'fictional-lab-supplier',clientId:'fictional-lab-client',buyer:'Fictional Lab',goal:'Understand an evaluation',turns:turns(value),outcome:'',notes:'',startedAt:1000});
const client={id:'fictional-lab-client',companyId:'fictional-lab-supplier',name:'Fictional Lab',contacts:[],context:[],callIds:[],background:'',createdAt:500,updatedAt:500};

test('The observed request and immediate agreement retain the canonical bundle and raw speech',()=>{
 const evidence=deriveSpokenDocumentEvidence(turns(rows));
 assert.equal(evidence.requests.length,1);
 assert.deepEqual(evidence.requests[0].documents,['spec sheets','test reports']);
 assert.equal(evidence.agreements.length,1);
 assert.deepEqual(evidence.agreements[0].documents,['spec sheets','test reports']);
 assert.equal(evidence.agreements[0].requestTurnId,'synthetic-1');
 assert.equal(evidence.agreements[0].quote,rows[2][1]);
});

test('Singular document names and include/attach directives are genuine requests',()=>{
 assert.deepEqual(documentKinds('A spec sheet and a material test report.'),['spec sheets','test reports']);
 for(const text of ['Attach the brochure, please.','Please include the catalog.','Could you attach the test report in your email?'])assert.equal(isDocumentRequest(text),true,text);
});

test('A delivery-channel reference is not a request for the representative’s personal details',()=>{
 for(const text of ['Could you attach a brochure in your email?','Please include the inspection report in your email.'])assert.equal(isRepContactDetailRequest(text),false,text);
 for(const text of ['What is your email address?','May I have your last name?','And a callback number?'])assert.equal(isRepContactDetailRequest(text),true,text);
});

test('Review presents both spoken document events, with no invented destination or completed send',()=>{
 const review=deriveCallReview(call(rows));
 assert.match(review.recap,/Buyer requested the spec sheets and test reports/);
 assert.match(review.recap,/Salesperson’s stated next step: agreed to send the spec sheets and test reports/);
 assert.ok(review.recap.includes(rows[1][1]));
 assert.ok(review.recap.includes(rows[2][1]));
 assert.match(review.recap,/request or send agreement alone does not confirm completed sending or receipt/);
 assert.match(review.recap,/destination email address remains unconfirmed/);
 assert.doesNotMatch(review.recap,/No agreed next step|documents (?:were|have been) sent/i);
 assert.ok(review.sourceTurnIds.includes('synthetic-1'));
 assert.ok(review.sourceTurnIds.includes('synthetic-2'));
});

test('Wrap-up offers the original request and an attributed pending commitment for review',()=>{
 const draft=proposeCallWrapUp(call(rows),client),request=draft.memory.find(item=>item.sourceTurnId==='synthetic-1'),agreement=draft.memory.find(item=>item.sourceTurnId==='synthetic-2');
 assert.equal(request.quote,rows[1][1]);
 assert.equal(request.source,'buyer');
 assert.equal(agreement.quote,rows[2][1]);
 assert.match(agreement.text,/agreed to send the spec sheets and test reports/);
 assert.equal(agreement.source,'rep_update');
 assert.equal(agreement.kind,'agreed');
 assert.equal(agreement.confirmed,false);
});

test('An imperfect repetition does not replace the buyer’s explicit document bundle',()=>{
 const value=call([rows[1],['you',"Sure, we'll get those over. I noted the inspection list."],rows[3]]);
 const evidence=deriveSpokenDocumentEvidence(value.turns);
 assert.deepEqual(evidence.agreements[0].documents,['spec sheets','test reports']);
 assert.equal(evidence.agreements[0].quote,value.turns[1].text);
});

test('A genuine request for the representative’s address is still excluded from buyer memory',()=>{
 const value=call([['buyer','Could I have your email address?']]);
 assert.equal(proposeCallWrapUp(value,client).memory.some(item=>item.sourceTurnId==='synthetic-0'),false);
});

for(const [name,text] of [
 ['conditional',"If the lab approves, I'll get both over."],
 ['negative',"I won't get both over."],
 ['possible',"I could send the specifications and inspection report."],
 ['question',"I'll send the specifications and inspection report?"],
 ['reported',"Our trainer said I'll send the specifications and inspection report."],
])test(`${name} wording is not extracted as a definite document agreement`,()=>{
 assert.equal(deriveSpokenDocumentEvidence(turns([rows[1],['you',text]])).agreements.length,0);
});

test('An unrelated intervening turn prevents pronoun resolution against an old request',()=>{
 const evidence=deriveSpokenDocumentEvidence(turns([rows[1],['buyer','The lab entrance is on the west side.'],['you',"I'll get that over."]]));
 assert.equal(evidence.agreements.length,0);
});

test('Uncertain or unattributed speech cannot supply a request antecedent',()=>{
 const uncertain=turns([rows[1],['you',"I'll get both over."]]);uncertain[0].transcriptionUncertainty={reason:'fixture'};
 assert.equal(deriveSpokenDocumentEvidence(uncertain).agreements.length,0);
 const unattributed=turns([rows[1],['conversation','Another speaker may be joining.'],['you',"I'll get both over."]]);
 assert.equal(deriveSpokenDocumentEvidence(unattributed).agreements.length,0);
});

test('Negated and conditional buyer words do not establish a definite document request',()=>{
 for(const text of ["Please don't send the specifications.",'If we continue, please send the test report.'])assert.equal(isDocumentRequest(text),false,text);
});

test('Unspoken suggestions never supply document request or agreement evidence',()=>{
 const value=call([['buyer','We are still assessing our needs.']]);
 value.suggestions=[{guidance:{say:"I will send a company profile and test report."}}];
 assert.deepEqual(deriveSpokenDocumentEvidence(value.turns),{requests:[],agreements:[],cancellations:[],activeDocuments:[]});
 assert.doesNotMatch(deriveCallReview(value).recap,/agreed to send/i);
});

test('Opening an existing reviewed wrap-up preserves the salesperson’s recap and memory',()=>{
 const value=call(rows),draft=proposeCallWrapUp(value,client);
 value.wrapUp={...draft,recap:'My reviewed account stays as written.',reviewedAt:2000};
 const reopened=proposeCallWrapUp(value,client);
 assert.equal(reopened.recap,value.wrapUp.recap);
 assert.deepEqual(reopened.memory,value.wrapUp.memory);
});

test('Discovery accomplishment summaries retain later actual document requests too',()=>{
 const value=call([['buyer','We are evaluating a dosing pump for a prototype lab.'],...rows.slice(1)]);
 const review=deriveCallReview(value);
 assert.match(review.recap,/evaluating a dosing pump/);
 assert.match(review.recap,/Buyer requested the spec sheets and test reports/);
 assert.match(review.recap,/Salesperson’s stated next step: agreed to send the spec sheets and test reports/);
});

test('An explicit later cancellation narrows the current bundle without rewriting historical quotes',()=>{
 const value=call([...rows.slice(0,3),['buyer','Actually, do not send the report. We only need the spec sheet.']]);
 const evidence=deriveSpokenDocumentEvidence(value.turns);
 assert.deepEqual(evidence.activeDocuments,['spec sheets']);
 assert.deepEqual(evidence.cancellations[0].documents,['test reports']);
 assert.equal(evidence.agreements[0].quote,rows[2][1]);
 const review=deriveCallReview(value);
 assert.match(review.recap,/Buyer cancelled the test reports/);
 assert.match(review.recap,/Current requested document bundle: spec sheets\./);
 assert.ok(review.recap.includes(rows[1][1]));
});

test('A bare No is not inferred to cancel the requested document bundle',()=>{
 const evidence=deriveSpokenDocumentEvidence(turns([...rows.slice(0,3),['buyer','No.']]));
 assert.deepEqual(evidence.activeDocuments,['spec sheets','test reports']);
 assert.equal(evidence.cancellations.length,0);
});

test('All-document cancellation and a later explicit re-request have chronological status',()=>{
 const cancelled=call([...rows.slice(0,3),['buyer',"Don't send both documents."]]);
 assert.deepEqual(deriveSpokenDocumentEvidence(cancelled.turns).activeDocuments,[]);
 assert.match(deriveCallReview(cancelled).recap,/No requested documents remain\./);
 const repeated=call([...rows.slice(0,3),['buyer',"Don't send both documents."],['buyer','Please attach the inspection report after all.']]);
 assert.deepEqual(deriveSpokenDocumentEvidence(repeated.turns).activeDocuments,['test reports']);
});

test('Internal notes and approval attachments do not become promises to send documents to the buyer',()=>{
 for(const text of ["I'll include both in my internal notes.","I'll attach the spec sheet to my internal approval request."]){
  assert.equal(deriveSpokenDocumentEvidence(turns([rows[1],['you',text]])).agreements.length,0,text);
  assert.equal(proposeCallWrapUp(call([rows[1],['you',text]]),client).memory.some(item=>item.sourceTurnId==='synthetic-1'&&item.kind==='agreed'),false,text);
 }
 assert.equal(deriveSpokenDocumentEvidence(turns([['you',"I'll attach a brochure to the approval request."]])).agreements.length,0);
});

test('A standalone include/attach promise requires a buyer delivery channel',()=>{
 assert.equal(deriveSpokenDocumentEvidence(turns([['you',"I'll attach a brochure."]])).agreements.length,0);
 assert.equal(deriveSpokenDocumentEvidence(turns([['you',"I'll attach a brochure in my reply."]])).agreements.length,1);
});

test('Rep and third-party addresses are not saved as the current buyer’s email',()=>{
 for(const text of [
  'Could you include a brochure in your email to your manager, rep@fictional-vendor.example?',
  'I have your email, rep@fictional-vendor.example.',
  'Send the specifications to my engineer, engineer@fictional-lab.example.',
 ]){
  const proposals=proposeReviewedCallContacts(call([['buyer','Noor speaking.'],['buyer',text]]),client);
  assert.equal(proposals.length,0,text);
 }
 const proposals=proposeReviewedCallContacts(call([['buyer','Noor speaking.'],['buyer','Please send the specifications to my email, noor@fictional-lab.example.']]),client);
 assert.equal(proposals.length,1);
 assert.equal(proposals[0].name,'Noor');
 assert.equal(proposals[0].email,'noor@fictional-lab.example');
});
