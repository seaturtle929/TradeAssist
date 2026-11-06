import assert from 'node:assert/strict';
import test from 'node:test';
import {deriveDocumentState,documentStateReviewLines,documentStateFromReviewedRecap} from '../lib/document-state.ts';
import {deriveConversationState} from '../lib/conversation-state.ts';
import {incomingDrawingState} from '../lib/incoming-document-state.ts';
import {buildClientStanding} from '../lib/client-standing.ts';
import {deriveSpokenDocumentEvidence} from '../lib/document-call-evidence.ts';
import {ensureCompanyBrain,buildBrainRequest,rememberBuyer} from '../lib/company-brain.ts';

// Authored fictional language and in-memory records only. No saved calls,
// documents, model output, browser state or paid services are used here.
const companies=['Lark Circuit Works','Vale Filter Components'];
const turn=(id,role,text)=>({id,role,text,at:1});
const transfer=(state,kind,sender)=>state.transfers.find(row=>row.document===kind&&row.sender===sender);
for(const name of companies){
 const company={id:name,name,products:'industrial components',introduction:'',sources:[]};
 const stateFor=turns=>deriveConversationState({callId:'fictional-grounded',manufacturer:company,turns,callContext:{stageId:'solution_discussion'}});
 for(const text of [
  'I can check whether we should send the brochure.',
  'I will ask whether you want me to email the company profile.',
  'I will ask your engineer if we can send the inspection report.',
  'You said I would email the company profile.',
  "Our trainer said, 'I will send the company profile.'",
  "I'll send my notes to our manager about the inspection report.",
 ])test(name+': a non-delivery act cannot become a current document promise: '+text,()=>{
  const state=stateFor([turn('rep','you',text)]),documents=state.documents;
  assert.equal(documents.transfers.some(row=>row.events.some(event=>['offered','promised','sent','received'].includes(event.kind))),false,JSON.stringify(documents));
  const brain=ensureCompanyBrain(company),request=buildBrainRequest({...company,brain},'Authored buyer',state);
  assert.deepEqual(request.buyerMemory.documents,documents);
  assert.deepEqual(rememberBuyer(brain,'Authored buyer',state).buyers[0].documents,documents);
 });
 for(const text of ["If you'd like, I'll email the specification sheet.",'I can send the company profile if you want it.','I can send the brochure.','Would you like me to send the company profile?',"I'll be ready to send the brochure when you ask."])test(name+': an unaccepted offer remains a rep offer through review and memory: '+text,()=>{
  const documents=deriveDocumentState({turns:[turn('offer','you',text)]});assert.equal(documents.transfers.length,1);
  const row=documents.transfers[0];assert.equal(row.sender,'you');assert.equal(row.phase,'offered');assert.equal(row.events.some(event=>event.kind==='promised'),false);
  const lines=documentStateReviewLines(documents);assert.match(lines.join(' '),/salesperson offered to send/i);assert.doesNotMatch(lines.join(' '),/buyer requested|promised/i);
  const reviewed=documentStateFromReviewedRecap(lines.join(' '));assert.equal(reviewed.transfers.length,1);assert.equal(reviewed.transfers[0].sender,'you');assert.equal(reviewed.transfers[0].phase,'offered');assert.equal(reviewed.transfers[0].events.some(event=>event.kind==='requested'),false);
 });
 test(name+': an optional offer is preserved in next-call standing without becoming an owed send',()=>{
  const recap='The salesperson offered to send the company profile. Sending remains pending.',client={id:'fictional-offer-client',companyId:company.id,name:'Fictional Client',contacts:[],context:[],callIds:['fictional-offer-call'],background:'',createdAt:1,updatedAt:2},call={id:'fictional-offer-call',manufacturerId:company.id,clientId:client.id,startedAt:10,turns:[],wrapUp:{recap,outcome:'Optional information offer',reviewedAt:20}};
  const standing=buildClientStanding({client,calls:[call],now:30});
  assert.deepEqual(standing.buyerRequested,[]);assert.deepEqual(standing.repOwes,[]);assert.equal(standing.sendStatus,'unknown');assert.equal(standing.documentState.transfers[0].phase,'offered');assert.ok(standing.unknowns.some(line=>/buyer acceptance.*unconfirmed/i.test(line)));
 });
 test(name+': an embedded buyer inquiry is not a request or information interest',()=>{
  const state=stateFor([turn('inquiry','buyer','I can confirm whether you should send the brochure.')]);
  assert.equal(state.documents.transfers.some(row=>row.events.some(event=>event.kind==='requested')),false);assert.equal(state.buyerNeeds.interest.kind,'unknown');
 });
 test(name+': a comma-separated completed document bundle retains every item',()=>{
  const state=stateFor([turn('request','buyer','Please send the company profile, specification sheets and brochure.'),turn('sent','you','I sent the company profile, specification sheets and brochure.')]);
  assert.equal(state.commitments.find(row=>row.id==='send_materials').status,'fulfilled');for(const kind of ['company profile','spec sheets','brochure'])assert.equal(transfer(state.documents,kind,'you').sendStatus,'reported_sent');
 });
 test(name+': a genuine independent report request survives the shared request grammar',()=>{
  const state=deriveDocumentState({turns:[turn('request','buyer','Could you email the inspection report?')]});assert.equal(transfer(state,'test reports','you').phase,'requested');
 });
 test(name+': a direct request does not borrow a report from its purpose',()=>{
  const state=deriveDocumentState({turns:[turn('request','buyer','Please send your thoughts about the inspection report.')]});assert.equal(state.transfers.some(row=>row.events.some(event=>event.kind==='requested')),false);
 });
 for(const verb of ['email','provide','get'])test(name+': the spoken agreement resolver cannot reintroduce a reported '+verb+' promise',()=>{
  const object=verb==='get'?'both over':'the company profile',turns=[turn('request','buyer','Please send the company profile and specification sheets.'),turn('reported','you','A colleague suggested I will '+verb+' '+object+'.')];
  assert.deepEqual(deriveSpokenDocumentEvidence(turns).agreements,[]);const state=deriveDocumentState({turns});assert.equal(state.transfers.some(row=>row.events.some(event=>event.turnId==='reported'&&event.kind==='promised')),false);
 });
 for(const text of ["Suppose I will send the company profile.","I believe I will provide the company profile.","I think I'll get both over.","Our manager asked whether I will email the company profile."])test(name+': an existing hypothetical or uncertain parent cannot become a definite agreement: '+text,()=>{
  const turns=[turn('request','buyer','Please send the company profile and specification sheets.'),turn('uncertain','you',text)];assert.deepEqual(deriveSpokenDocumentEvidence(turns).agreements,[]);
 });
 test(name+': an independent actual promise after a parent aside remains an agreement',()=>{
  const turns=[turn('request','buyer','Please send the company profile and specification sheets.'),turn('agreement','you',"As you suggested, I'll get both over.")];assert.deepEqual(deriveSpokenDocumentEvidence(turns).agreements[0].documents,['company profile','spec sheets']);
 });
 for(const text of ["I'll be sure to send the company profile and specification sheets.","I'll make sure to email the company profile and specification sheets.","I'll provide the company profile and specification sheets.","I'll get both over."])test(name+': bounded genuine spoken agreements retain the document bundle: '+text,()=>{
  const turns=[turn('request','buyer','Please send the company profile and specification sheets.'),turn('agreement','you',text)],agreement=deriveSpokenDocumentEvidence(turns).agreements[0];assert.ok(agreement);assert.deepEqual(agreement.documents,['company profile','spec sheets']);
 });
 for(const [offer,answer] of [['I can send the brochure.','Yes, please.'],['Would you like me to send the brochure?','Yes, please.'],['I can send the company profile. What email should I use?','sora@fictional-buyer.example']])test(name+': buyer acceptance makes the actual optional offer an outstanding request: '+answer,()=>{
  const turns=[turn('offer','you',offer),turn('accept','buyer',answer)],state=stateFor(turns),row=state.documents.transfers[0];assert.equal(row.phase,'requested');assert.ok(row.events.some(event=>event.kind==='requested'&&event.turnId==='accept'));assert.ok(state.commitments.some(item=>item.id==='send_materials'&&item.status!=='fulfilled'));
  const recap=documentStateReviewLines(state.documents).join(' '),client={id:'fictional-accepted-client',companyId:company.id,name:'Fictional Client',contacts:[],context:[],callIds:[],background:'',createdAt:1,updatedAt:1},call={id:'fictional-accepted-call',manufacturerId:company.id,clientId:client.id,startedAt:10,turns,wrapUp:{recap,documentState:state.documents,documentStateRecap:recap,reviewedAt:20}};
  const standing=buildClientStanding({client,calls:[call],now:30});assert.equal(standing.sendStatus,'pending');assert.ok(standing.repOwes.some(line=>/send/i.test(line)));assert.ok(standing.buyerRequested.length);
 });
 test(name+': accepted offer and definite promise use their own object, not an incoming prerequisite',()=>{
  const offered=stateFor([turn('offer','you','I can send the brochure once we receive your drawing.'),turn('accept','buyer','Yes, please.')]);assert.equal(offered.commitments.find(row=>row.id==='send_materials').action,'Send catalog');assert.equal(offered.documents.transfers.some(row=>row.document==='drawings'),false);
  const promised=stateFor([turn('promise','you','I will send the brochure once we receive your drawing.')]);assert.equal(promised.commitments.find(row=>row.id==='send_materials').action,'Send catalog');assert.equal(promised.documents.transfers.some(row=>row.document==='drawings'),false);
 });
 test(name+': accepting a conditional report offer preserves the actual condition and no generic email gap',()=>{
  const state=stateFor([turn('offer','you','I can email the inspection report only if it covers your reference.'),turn('accept','buyer','Yes, please.')]),report=transfer(state.documents,'test reports','you');
  assert.equal(report.phase,'requested');assert.equal(report.condition.kind,'coverage_positive');assert.equal(report.coverage,'unknown');assert.equal(state.commitments.some(item=>item.id==='send_materials'),false);
 });
 test(name+': a later unrelated yes cannot accept an old offer',()=>{
  const state=stateFor([turn('offer','you','I can email the brochure.'),turn('other','buyer','Engineering is still reviewing the drawing.'),turn('late-yes','buyer','Yes, please.')]);assert.equal(transfer(state.documents,'brochure','you').phase,'offered');assert.equal(state.commitments.some(item=>item.id==='send_materials'),false);
 });
 test(name+': reviewed condition evidence preserves nested reference quotes, approval owner and pending incoming drawing',()=>{
  const release='Only send the inspection report if it covers "QX73". Do not send it until my engineer approves.',turns=[turn('drawing','buyer',"I'll email our drawing when it is ready."),turn('release','buyer',release),turn('check','you',"I'll check whether the inspection report covers QX73.")],before=deriveDocumentState({turns}),recap=documentStateReviewLines(before).join(' '),after=documentStateFromReviewedRecap(recap),report=transfer(after,'test reports','you');
  assert.ok(recap.includes('The buyer stated next step: “'+release+'”'));assert.equal(report.condition.text,release);assert.equal(report.coverage,'unknown');assert.ok(report.events.some(event=>event.actor==='buyer'&&event.quote===release&&event.source==='reviewed_recap'));
  const drawing=transfer(after,'drawings','buyer');assert.equal(drawing.sendStatus,'pending');assert.equal(drawing.receiptStatus,'unconfirmed');assert.equal(drawing.phase,'promised');
 });
 test(name+': deleting or correcting reviewed condition evidence never reimports omitted raw speech',()=>{
  const release='Only send the inspection report if it covers QX73. Do not send it until my engineer approves.',before=deriveDocumentState({turns:[turn('release','buyer',release)]}),recap=documentStateReviewLines(before).join('\n'),without=recap.split('\n').filter(line=>!line.startsWith('The buyer stated next step:')).join('\n'),removed=documentStateFromReviewedRecap(without);
  assert.doesNotMatch(JSON.stringify(removed),/QX73|my engineer approves/);
  const corrected=documentStateFromReviewedRecap(recap.replaceAll('QX73','VR61').replace('my engineer approves','my manager approves')),report=transfer(corrected,'test reports','you');assert.match(report.condition.text,/VR61/);assert.match(report.condition.text,/my manager approves/);assert.doesNotMatch(report.condition.text,/QX73|engineer/);
 });
 test(name+': an optional salesperson condition keeps its actor and force through review',()=>{
  const text="I'll be ready to send the brochure when you ask.",before=deriveDocumentState({turns:[turn('offer','you',text)]}),recap=documentStateReviewLines(before).join('\n'),after=documentStateFromReviewedRecap(recap),brochure=transfer(after,'brochure','you');assert.ok(recap.includes('The salesperson stated next step: “'+text+'”'));assert.equal(brochure.phase,'offered');assert.equal(brochure.condition.text,'when you ask');assert.equal(brochure.events.some(event=>event.kind==='requested'||event.kind==='promised'),false);
 });
 test(name+': a sending pronoun uses its unique owned transfer rather than an approval-prerequisite drawing',()=>{
  const turns=[turn('incoming','buyer',"I'll email our drawing."),turn('request','buyer','Only send the inspection report if it covers QX73. Do not send it until my engineer approves the drawing revision.'),turn('rep','you',"If it covers QX73 and your engineer approves the drawing revision, I'll send it.")],state=deriveDocumentState({turns});assert.equal(transfer(state,'test reports','you').phase,'promised');assert.equal(state.transfers.some(row=>row.document==='drawings'&&row.sender==='you'&&row.events.some(event=>event.kind==='promised')),false);assert.equal(transfer(state,'drawings','buyer').sendStatus,'pending');
 });
 for(const doc of ['inspection report','drawing'])test(name+': an explicit outgoing '+doc+' is not changed by another approval artifact',()=>{
  const state=deriveDocumentState({turns:[turn('rep','you','If your engineer approves the drawing revision, I will send the '+doc+'.')]});assert.equal(transfer(state,doc==='drawing'?'drawings':'test reports','you').phase,'promised');
 });
 test(name+': several owned documents leave an unresolved singular send target unguessed',()=>{
  const turns=[turn('request','buyer','Please send the company profile and inspection report.'),turn('rep','you',"If your engineer approves the drawing revision, I'll send it.")],state=deriveDocumentState({turns});assert.equal(state.transfers.some(row=>row.events.some(event=>event.turnId==='rep'&&event.kind==='promised')),false);
 });
 test(name+': a real conditional send is a pending promise without claiming coverage',()=>{
  const documents=deriveDocumentState({turns:[turn('promise','you',"I'll send the inspection report only if it covers your reference.")]}),report=transfer(documents,'test reports','you');
  assert.equal(report.phase,'promised');assert.equal(report.sendStatus,'pending');assert.equal(report.receiptStatus,'unconfirmed');assert.equal(report.condition.kind,'coverage_positive');assert.equal(report.coverage,'unknown');
 });
 for(const text of ['I will check whether I sent the company profile.',"I don't remember whether I sent the company profile."] )test(name+': an uncertain past send does not fulfill a genuine earlier request: '+text,()=>{
  const state=stateFor([turn('request','buyer','Please send the company profile.'),turn('uncertain','you',text)]);
  assert.notEqual(state.commitments.find(row=>row.id==='send_materials').status,'fulfilled');assert.equal(transfer(state.documents,'company profile','you').sendStatus,'pending');
 });
 test(name+': an uncertain receipt does not fulfill sending',()=>{
  const state=stateFor([turn('request','buyer','Please send the company profile.'),turn('promise','you',"I'll send it."),turn('uncertain','buyer','I will confirm whether I received the company profile.')]);
  assert.notEqual(state.commitments.find(row=>row.id==='send_materials').status,'fulfilled');assert.equal(transfer(state.documents,'company profile','you').receiptStatus,'unconfirmed');
 });
 test(name+': a partial send does not complete the requested bundle; later sending the remainder does',()=>{
  const turns=[turn('request','buyer','Please send the company profile and specification sheets.'),turn('partial','you','I sent the company profile.')],partial=stateFor(turns);
  assert.notEqual(partial.commitments.find(row=>row.id==='send_materials').status,'fulfilled');assert.equal(transfer(partial.documents,'spec sheets','you').sendStatus,'pending');
  const full=stateFor([...turns,turn('remaining','you','I emailed the specification sheets.')]);assert.equal(full.commitments.find(row=>row.id==='send_materials').status,'fulfilled');
  assert.equal(transfer(full.documents,'company profile','you').receiptStatus,'unconfirmed');assert.equal(transfer(full.documents,'spec sheets','you').receiptStatus,'unconfirmed');
 });
 for(const completion of [turn('sent','you','I sent them.'),turn('received','buyer','I received both.')])test(name+': an attributed plural completion preserves the full prior bundle: '+completion.text,()=>{
  const state=stateFor([turn('request','buyer','Please send the company profile and specification sheets.'),completion]);
  assert.equal(state.commitments.find(row=>row.id==='send_materials').status,'fulfilled');
  for(const kind of ['company profile','spec sheets']){const row=transfer(state.documents,kind,'you');assert.equal(row.sendStatus,'reported_sent');assert.equal(row.receiptStatus,completion.role==='buyer'?'confirmed':'unconfirmed');}
 });
 test(name+': a prior completed bundle does not fulfill a renewed pending request in a truncated window',()=>{
  const history=[turn('first-request','buyer','Please send the company profile and specification sheets.'),turn('first-send','you','I sent them.'),turn('renewed','buyer','Please send the company profile and specification sheets again.')],previous=stateFor(history);
  const buyerMemory={...previous,processedTurnIds:history.map(row=>row.id)};
  const state=deriveConversationState({callId:'fictional-grounded',manufacturer:company,buyerMemory,turns:[turn('partial-new','you','I sent the specification sheets.')],callContext:{stageId:'solution_discussion'}});
  assert.notEqual(state.commitments.find(row=>row.id==='send_materials').status,'fulfilled');assert.equal(transfer(state.documents,'company profile','you').sendStatus,'pending');
 });
 for(const [role,text] of [['you','I sent the product information.'],['buyer','I received the product information.']])test(name+': a completed generic material remains completed without a new document schema: '+text,()=>{
  const state=stateFor([turn('request','buyer','Please send the product information.'),turn('completion',role,text)]);assert.equal(state.commitments.find(row=>row.id==='send_materials').status,'fulfilled');assert.equal(state.documents.transfers.length,0);
 });
 for(const text of ['I will check whether I sent the product information.',"I haven't sent the product information."])test(name+': an indirect or negated generic material is not completed: '+text,()=>{
  const state=stateFor([turn('request','buyer','Please send the product information.'),turn('completion','you',text)]);assert.notEqual(state.commitments.find(row=>row.id==='send_materials').status,'fulfilled');
 });
 test(name+': a full material bundle waits for its generic information as well as the profile',()=>{
  const history=[turn('request','buyer','Please send the company profile and product information.'),turn('partial','you','I sent the company profile.')];assert.notEqual(stateFor(history).commitments.find(row=>row.id==='send_materials').status,'fulfilled');assert.equal(stateFor([...history,turn('remainder','you','I sent the product information.')]).commitments.find(row=>row.id==='send_materials').status,'fulfilled');
  assert.equal(stateFor([history[0],turn('together','you','I sent the company profile and product information.')]).commitments.find(row=>row.id==='send_materials').status,'fulfilled');
 });
 test(name+': an ordinary got-it acknowledgment is not confirmed drawing receipt',()=>{
  const context={turns:[turn('buyer','buyer','I will email the drawing.'),turn('ack','you','I got it.')]};assert.equal(incomingDrawingState(context).state,'promised');
 });
 test(name+': a later document in a purpose is not reported sent',()=>{
  const documents=deriveDocumentState({turns:[turn('sent','you','I sent my notes to our manager about the company profile.')]});
  assert.equal(documents.transfers.some(row=>row.sendStatus==='reported_sent'),false);
 });
 test(name+': an actual promise retains a same-action plural document object',()=>{
  const state=deriveDocumentState({turns:[turn('promise','you',"I'll send the company profile and specification sheets.")]});
  assert.equal(transfer(state,'company profile','you').phase,'promised');assert.equal(transfer(state,'spec sheets','you').phase,'promised');
 });
 test(name+': buyer future drawing is pending, not a report request or received drawing',()=>{
  const context={turns:[turn('buyer','buyer',"I'll email our drawing after engineering finishes it."),turn('rep','you',"Once we receive your drawing, we'll compare it with our specifications.")]},documents=deriveDocumentState(context),drawing=transfer(documents,'drawings','buyer');
  assert.equal(drawing.phase,'promised');assert.equal(drawing.sendStatus,'pending');assert.equal(drawing.receiptStatus,'unconfirmed');assert.equal(incomingDrawingState(context).state,'promised');assert.equal(documents.transfers.some(row=>row.sender==='you'),false);
 });
 test(name+': buyer considering whether to send is not an offered or promised drawing',()=>{
  const context={turns:[turn('buyer','buyer',"I'll check whether I should email our drawing.")]};assert.equal(incomingDrawingState(context).state,'unconfirmed');
  assert.equal(deriveDocumentState(context).transfers.some(row=>row.events.some(event=>['promised','offered'].includes(event.kind))),false);
 });
}
