import assert from 'node:assert/strict';
import test from 'node:test';
import {deriveDocumentState,documentStateReviewLines,isBuyerOwnedDocumentSend} from '../lib/document-state.ts';

// Authored action examples, not saved transcripts or customer records.
const turn=(id,role,text,source)=>({id,role,text,...source?{source}:{}});
const find=(state,document,sender)=>state.transfers.find(row=>row.document===document&&row.sender===sender);
for(const text of ["Don't send me the company profile.",'Please do not send the company profile.',"You don't need to send the company profile.","You don’t have to send me your company profile.","I don't want you to send the company profile."])
 test('An explicit declined document is not a positive request: '+text,()=>{
  const state=deriveDocumentState({turns:[turn('decline','buyer',text)]}),profile=find(state,'company profile','you');
  assert.equal(profile.phase,'cancelled');assert.notEqual(profile.sendStatus,'pending');
  assert.equal(profile.events.some(event=>event.kind==='requested'),false);
  assert.match(documentStateReviewLines(state).join(' '),/cancelled/);
 });
test('A later cancellation retains the original request evidence and its reviewed attribution',()=>{
 const state=deriveDocumentState({turns:[turn('request','buyer','Please send the company profile.'),turn('agreement','you','I will send the company profile.'),turn('decline','buyer','Do not send the company profile.','reviewed_recap')]}),profile=find(state,'company profile','you');
 assert.equal(profile.phase,'cancelled');assert.equal(profile.sendStatus,'unconfirmed');
 assert.ok(profile.events.some(event=>event.kind==='requested'&&event.turnId==='request'));
 assert.ok(profile.events.some(event=>event.kind==='cancelled'&&event.turnId==='decline'&&event.source==='reviewed_recap'));
});
test('A fresh affirmative request after cancellation reopens only the requested action',()=>{
 const state=deriveDocumentState({turns:[turn('request','buyer','Please send the company profile.'),turn('agreement','you','I will send the company profile.'),turn('decline','buyer','Do not send the company profile.'),turn('renew','buyer','Actually, please send the company profile.')]}),profile=find(state,'company profile','you');
 assert.equal(profile.phase,'requested','An old rep promise is not a renewed promise.');assert.equal(profile.sendStatus,'pending');
 assert.ok(profile.events.some(event=>event.kind==='cancelled'));assert.ok(profile.events.some(event=>event.kind==='requested'&&event.turnId==='renew'));
});
test('The last independent action in a same-turn correction is not erased by a cancellation postpass',()=>{
 const state=deriveDocumentState({turns:[turn('request','buyer','Please send the company profile.'),turn('change','buyer','Do not send the company profile. Actually, please send the company profile.')]}),profile=find(state,'company profile','you');
 assert.equal(profile.phase,'requested');assert.equal(profile.sendStatus,'pending');
});
test('Cancelling one document does not cancel a different affirmative request',()=>{
 const state=deriveDocumentState({turns:[turn('change','buyer','Do not send the company profile. Please send the specification sheet.')]}),profile=find(state,'company profile','you'),spec=find(state,'spec sheets','you');
 assert.equal(profile.phase,'cancelled');assert.equal(spec.phase,'requested');assert.equal(spec.sendStatus,'pending');
});
test('An approval hold is a restriction, not a new positive send request or permanent cancellation',()=>{
 const fresh=deriveDocumentState({turns:[turn('hold','buyer','Do not send the company profile until I approve.')]}),unrequested=find(fresh,'company profile','you');
 assert.equal(unrequested.phase,'inquiry');assert.equal(unrequested.sendStatus,'unconfirmed');assert.equal(unrequested.condition.kind,'unresolved');assert.equal(unrequested.events.some(event=>event.kind==='requested'),false);
 const prior=deriveDocumentState({turns:[turn('request','buyer','Please send the company profile.'),turn('hold','buyer','Do not send the company profile until I approve.')]}),requested=find(prior,'company profile','you');
 assert.equal(requested.phase,'requested');assert.equal(requested.sendStatus,'pending');assert.equal(requested.condition.kind,'unresolved');
});
test('A buyer withdrawing their own drawing does not become a request for a supplier drawing',()=>{
 const state=deriveDocumentState({turns:[turn('offer','buyer','I will send the drawing.'),turn('withdraw','buyer',"I won't send the drawing.")]}),drawing=find(state,'drawings','buyer');
 assert.equal(drawing.phase,'cancelled');assert.equal(drawing.sendStatus,'unconfirmed');assert.equal(find(state,'drawings','you'),undefined);
});
test('A denial of past sending leaves an actual future promise pending',()=>{
 const state=deriveDocumentState({turns:[turn('offer','buyer','I will send the drawing.'),turn('not-yet','buyer',"I haven't sent the drawing.")]}),drawing=find(state,'drawings','buyer');
 assert.equal(drawing.phase,'promised');assert.equal(drawing.sendStatus,'pending');assert.equal(drawing.receiptStatus,'unconfirmed');
});
test('A dependent timing condition remains in the original promise evidence',()=>{
 const text='I will email the drawing once our engineer finishes.',state=deriveDocumentState({turns:[turn('promise','buyer',text)]}),drawing=find(state,'drawings','buyer');
 assert.equal(drawing.phase,'promised');assert.equal(drawing.events[0].quote,text);assert.equal(drawing.sendStatus,'pending');assert.equal(drawing.receiptStatus,'unconfirmed');
});
for(const text of ['Can I send you our drawing?','Could we email you the drawing?','Would you like me to send our drawing?','Would you prefer us to email the drawing?'])
 test('A first-person permission question is the speaker’s offer: '+text,()=>{
  assert.equal(isBuyerOwnedDocumentSend(text),true);
  const state=deriveDocumentState({turns:[turn('offer','buyer',text)]}),drawing=find(state,'drawings','buyer');
  assert.equal(drawing.phase,'offered');assert.equal(drawing.sendStatus,'pending');assert.equal(drawing.receiptStatus,'unconfirmed');
  assert.equal(find(state,'drawings','you'),undefined);assert.equal(drawing.events[0].kind,'offered');
 });
test('A document in the purpose of an offered send is not another incoming document',()=>{
 const state=deriveDocumentState({turns:[turn('offer','buyer','Can I email you the drawing so you can check the material test report?')]}),drawing=find(state,'drawings','buyer');
 assert.equal(drawing.phase,'offered');assert.equal(find(state,'test reports','buyer'),undefined);
});
test('A coordinated buyer offer and supplier request remain separate directional actions',()=>{
 const state=deriveDocumentState({turns:[turn('offer','buyer','Can I send you our drawing and could you email the inspection report only if it covers our reference?')]}),drawing=find(state,'drawings','buyer'),report=find(state,'test reports','you');
 assert.equal(drawing.phase,'offered');assert.equal(report.phase,'requested');assert.equal(report.sendStatus,'pending');
 assert.equal(find(state,'drawings','you'),undefined);assert.equal(find(state,'test reports','buyer'),undefined);assert.equal(report.coverage,'unknown');
});
test('A rep’s own permission offer keeps the rep as sender',()=>{
 const state=deriveDocumentState({turns:[turn('offer','you','Can I send you our company profile?','rep_update')]}),profile=find(state,'company profile','you');
 assert.equal(profile.phase,'offered');assert.equal(profile.events[0].source,'rep_update');assert.equal(find(state,'company profile','buyer'),undefined);
});
test('A rep withdrawing a handoff is not attributed to the buyer in the recap',()=>{
 const state=deriveDocumentState({turns:[turn('promise','you','I will send the company profile.'),turn('withdraw','you','I will not send the company profile.')]}),profile=find(state,'company profile','you');
 assert.equal(profile.phase,'cancelled');assert.match(documentStateReviewLines(state).join(' '),/salesperson withdrew/i);assert.doesNotMatch(documentStateReviewLines(state).join(' '),/buyer cancelled/i);
});
