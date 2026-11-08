import assert from 'node:assert/strict';
import test from 'node:test';
import {createClientRecord,upsertClientContact,upsertClientProject,addClientContextEntry,selectClientEntries,mergeClientRecords,reassociateClientCall} from '../lib/client-records.ts';
import {parseInteractionExchange,interactionTypeFor} from '../lib/client-interactions.ts';
import {proposeCallWrapUp,saveClientCallWrapUp} from '../lib/client-workflow.ts';
import {buildCallPreparation,buildClientCoachingContext,parseCallPreparation,clientContextInstructions} from '../lib/client-coaching-context.ts';
import {CallWrapUpInput,ClientCoachingContextInput} from '../lib/company-brain-input.ts';
import {ensureCompanyBrain} from '../lib/company-brain.ts';
import {bindCompanyConfiguration} from '../lib/company-configuration.ts';
import {CoachInput} from '../lib/coach.ts';
import {manualRequestFor} from '../lib/manual-coaching.ts';
import {incomingDrawingState,incomingDocumentWordingEffects} from '../lib/incoming-document-state.ts';
import {assessReplyVerification} from '../lib/turn-verification-policy.ts';
import {checkSuggestion} from '../lib/call-purpose.ts';
import {buildClientStanding} from '../lib/client-standing.ts';

// Entirely authored fictional records; no private calls, documents, browser
// records, model output or API requests are used by these tests.
function fixture(){
 const company={id:'cedar-fictional',name:'Cedar Instruments',products:'industrial instruments',introduction:'',sources:[]};
 let client=createClientRecord(company.id,'Juniper Components',1,'juniper');
 client=upsertClientContact(client,{id:'riley',name:'Riley Stone',role:'Purchasing',email:'riley@example.test'},2);
 client=upsertClientProject(client,{name:'Prototype filter'},3);
 const projectId=client.projects[0].id;
 client=upsertClientProject(client,{name:'Maintenance project'},4);
 const otherProjectId=client.projects[1].id;
 let brain={...ensureCompanyBrain(company),clients:[client]},calls=[];
 const call=(id,type,text,at)=>({id,interactionType:type,projectId,manufacturerId:company.id,manufacturerName:company.name,clientId:client.id,contactId:'riley',buyer:client.name,goal:'Understand the buyer’s requirements',startedAt:at,duration:1,turns:parseInteractionExchange(text,{at,idPrefix:id}).turns,notes:'',outcome:''});
 const save=(record,recap,now,confirmDetails=true)=>{
  const draft=proposeCallWrapUp(record,brain.clients[0]);
  draft.recap=recap;draft.outcome='Next step agreed';draft.memory=draft.memory.map(row=>({...row,confirmed:confirmDetails}));
  const result=saveClientCallWrapUp(brain,calls,record,draft,now);brain=result.brain;calls=result.calls;client=brain.clients[0];return result;
 };
 return {company,projectId,otherProjectId,call,save,get client(){return client;},set client(next){client=next;brain={...brain,clients:[next]};},get brain(){return brain;},get calls(){return calls;}};
}

test('a reviewed call, later email, and manual confirmation reach the next real coaching request together',()=>{
 const t=fixture();
 t.save(t.call('first-call','call_meeting','Buyer: We need instruments for a prototype filter. Ease of cleaning is important.\nYou: I will check which specification sheets apply.',10),'Riley in purchasing is evaluating a prototype filter. Ease of cleaning is important. The salesperson will check the relevant specification sheets.',20);
 const email=t.call('later-email','text_email','Buyer: The prototype requires a removable frame, not the fixed frame we discussed. We prefer email for the drawing.\nYou: Thanks, I will review the drawing when you send it.',30);
 t.save(email,'Riley updated the prototype filter requirements to a removable frame. The earlier fixed-frame assumption is withdrawn. Riley prefers to email the drawing; sending and receipt remain unconfirmed.',40);
 t.client=addClientContextEntry(t.client,{id:'internal-confirmation',kind:'update',source:'rep_update',scope:'contact',contactId:'riley',projectId:t.projectId,status:'current',text:'Internal confirmation from our engineer: the removable-frame requirement can be evaluated against the drawing. No product match has been approved.',at:50},50);
 const binding=bindCompanyConfiguration({...t.company,brain:t.brain},'discovery',undefined,55);
 const prepared=buildCallPreparation({company:t.company,client:t.client,projectId:t.projectId,contactId:'riley',interactionType:'text_email',callId:'next-interaction',stageId:binding.selectedStageId,configurationBinding:binding,calls:t.calls,now:60},{reviewed:true});
 const context=buildClientCoachingContext(prepared);
 assert.equal(parseCallPreparation(prepared)?.projectId,t.projectId);
 assert.equal(ClientCoachingContextInput.parse(context).interactionType,'text_email');
 assert.equal(context.history.length,2);assert.deepEqual(context.history.map(row=>row.interactionType),['text_email','call_meeting']);
 assert.ok(context.entries.some(row=>row.id==='internal-confirmation'&&row.at===50&&row.source==='rep_update'));
 const input=CoachInput.parse({mode:'coach',manufacturer:t.company,companyConfiguration:binding,clientContext:context,clientId:t.client.id,contactId:'riley',projectId:t.projectId,interactionType:'text_email',callId:'next-interaction',sources:[],turns:[{id:'current',role:'buyer',text:'What should we do next?',at:61}],coachingRequest:{id:'press',requestedAt:62}});
 const request=JSON.stringify(manualRequestFor(input));
 for(const text of ['Ease of cleaning','removable frame','prefers to email the drawing','Internal confirmation from our engineer'])assert.ok(request.includes(text),text+' must be in the actual coaching request');
 assert.match(clientContextInstructions(input),/not proof it was sent/);
 assert.match(context.standing.summary,/sending and receipt remain unconfirmed/);
});

test('re-saving the same reviewed interaction updates one memory contribution and preserves the original call',()=>{
 const t=fixture(),first=t.call('first','call_meeting','Buyer: We need a washable filter frame.',10);
 const a=t.save(first,'Riley needs a washable filter frame.',20);
 const email=t.call('email','text_email','Buyer: We prefer the removable frame.',30),once=t.save(email,'Riley prefers the removable frame.',40);
 const twice=saveClientCallWrapUp(once.brain,once.calls,once.call,{...once.call.wrapUp,recap:'Corrected: Riley needs a removable frame, evaluation still open.'},45);
 assert.equal(twice.calls.length,2);assert.equal(twice.calls.filter(row=>row.id==='email').length,1);
 assert.deepEqual(twice.calls.find(row=>row.id==='first'),a.call);
 const ids=twice.brain.clients[0].context.map(row=>row.id);assert.equal(new Set(ids).size,ids.length);
 assert.equal(twice.brain.clients[0].currentSummary.text,'Corrected: Riley needs a removable frame, evaluation still open.');
 assert.equal(CallWrapUpInput.parse(twice.call.wrapUp).projectId,t.projectId);
});

test('contact and project facts cannot cross into another project or client',()=>{
 const t=fixture();
 t.client=addClientContextEntry(t.client,{id:'general',kind:'fact',source:'rep_update',scope:'client',text:'This client prefers email.'},10);
 t.client=addClientContextEntry(t.client,{id:'project-a',kind:'fact',source:'rep_update',scope:'contact',contactId:'riley',projectId:t.projectId,text:'Prototype filter needs a removable frame.'},11);
 t.client=addClientContextEntry(t.client,{id:'project-b',kind:'fact',source:'rep_update',scope:'contact',contactId:'riley',projectId:t.otherProjectId,text:'Maintenance project uses a sealed housing.'},12);
 const selected=selectClientEntries(t.client,{companyId:t.company.id,contactId:'riley',projectId:t.projectId});
 assert.deepEqual(new Set(selected.map(row=>row.id)),new Set(['general','project-a']));
 assert.deepEqual(selectClientEntries(t.client,{companyId:t.company.id,contactId:'riley'}).map(row=>row.id),['general']);
 assert.throws(()=>addClientContextEntry(t.client,{kind:'fact',source:'rep_update',scope:'client',projectId:'foreign-project',text:'Wrong project.'}),/project does not belong/);
 assert.throws(()=>selectClientEntries(t.client,{companyId:'other-company',projectId:t.projectId}),/different selling company/);
});

test('sending completion only satisfies the same project promise and does not prove receipt',()=>{
 const t=fixture();
 for(const projectId of [t.projectId,t.otherProjectId])t.client=addClientContextEntry(t.client,{id:'promise-'+projectId,kind:'commitment',source:'rep_update',scope:'contact',contactId:'riley',projectId,text:'I will send the specification sheets.',status:'promised'},10);
 t.client=addClientContextEntry(t.client,{id:'sent',kind:'update',source:'rep_update',scope:'contact',contactId:'riley',projectId:t.projectId,text:'I sent the specification sheets.',status:'completed'},20);
 assert.equal(t.client.context.find(row=>row.id==='promise-'+t.projectId).status,'completed');assert.equal(t.client.context.find(row=>row.id==='promise-'+t.otherProjectId).status,'promised');
 const selected=selectClientEntries(t.client,{companyId:t.company.id,contactId:'riley',projectId:t.projectId});
 assert.ok(selected.some(row=>row.id==='sent'),'Completed action evidence remains available');
 assert.equal(selected.some(row=>/received/.test(row.text)),false,'Sending is not receipt');
});
test('rep sending cannot complete the buyer’s promise to send the same document',()=>{
 const t=fixture();
 t.client=addClientContextEntry(t.client,{id:'buyer-drawing',kind:'commitment',source:'buyer',scope:'contact',contactId:'riley',projectId:t.projectId,text:'I will send the drawing.',status:'promised',callId:'captured-call',sourceTurnId:'buyer-offer',quote:'I will send the drawing.'},10);
 t.client=addClientContextEntry(t.client,{id:'rep-sent',kind:'update',source:'rep_update',scope:'contact',contactId:'riley',projectId:t.projectId,text:'I sent the drawing.',status:'current'},20);
 assert.equal(t.client.context.find(row=>row.id==='buyer-drawing').status,'promised');
 assert.equal(t.client.context.find(row=>row.id==='buyer-drawing').owner,'buyer');
 assert.equal(t.client.context.find(row=>row.id==='rep-sent').owner,'you');
});
test('an attributed manual note does not establish that the salesperson owns its third-person promise',()=>{
 const t=fixture();
 t.client=addClientContextEntry(t.client,{id:'third-person',kind:'commitment',source:'rep_update',scope:'contact',contactId:'riley',projectId:t.projectId,text:'Riley said the engineer will send the drawing.',status:'promised'},10);
 assert.equal(t.client.context.find(row=>row.id==='third-person').owner,undefined);
 t.client=addClientContextEntry(t.client,{id:'rep-drawing',kind:'update',source:'rep_update',scope:'contact',contactId:'riley',projectId:t.projectId,text:'I sent the drawing.'},20);
 assert.equal(t.client.context.find(row=>row.id==='third-person').status,'promised');
});
test('legacy first-person rep promises still complete while unknown legacy actors remain pending',()=>{
 const t=fixture();
 t.client={...t.client,context:[{id:'old-rep',kind:'commitment',source:'rep_update',scope:'contact',contactId:'riley',projectId:t.projectId,text:'I will send the specification sheets.',status:'promised',at:10,recordedAt:10},{id:'old-inference',kind:'commitment',source:'inference',scope:'contact',contactId:'riley',projectId:t.projectId,text:'I will send the specification sheets.',status:'promised',at:10,recordedAt:10}]};
 t.client=addClientContextEntry(t.client,{id:'reported-send',kind:'update',source:'rep_update',scope:'contact',contactId:'riley',projectId:t.projectId,text:'I sent the specification sheets.'},20);
 assert.equal(t.client.context.find(row=>row.id==='old-rep').status,'completed');
 assert.equal(t.client.context.find(row=>row.id==='old-inference').status,'promised');
});
test('a dated manual receipt reaches the document ledger and the ordinary checker without becoming review or coverage',()=>{
 const t=fixture();
 t.save(t.call('drawing-offer','text_email','Buyer: I will email the drawing for revision B when ready.',10),'Riley Stone promised to send the drawing for revision B. Sending and receipt remain unconfirmed.',20);
 t.client=addClientContextEntry(t.client,{id:'manual-receipt',kind:'update',source:'rep_update',scope:'contact',contactId:'riley',projectId:t.projectId,text:'I received the revision B drawing and sent it to our engineer. Report coverage has not been checked.',at:30},30);
 const binding=bindCompanyConfiguration({...t.company,brain:t.brain},'discovery',undefined,35);
 const prepared=buildCallPreparation({company:t.company,client:t.client,projectId:t.projectId,contactId:'riley',interactionType:'text_email',callId:'receipt-follow-up',stageId:binding.selectedStageId,configurationBinding:binding,calls:t.calls,now:40},{reviewed:true});
 const clientContext=buildClientCoachingContext(prepared);
 const input=CoachInput.parse({manufacturer:t.company,companyConfiguration:binding,clientContext,clientId:t.client.id,contactId:'riley',projectId:t.projectId,callId:'receipt-follow-up',interactionType:'text_email',sources:[],turns:[{id:'current',role:'buyer',text:'Did my drawing reach you? Does the report cover it?',at:41}],coachingRequest:{id:'receipt-click',requestedAt:42}});
 const incoming=incomingDrawingState(input);
 assert.equal(incoming.state,'received');assert.ok(incoming.evidence.some(text=>/I received the revision B drawing/.test(text)));
 assert.deepEqual(incomingDocumentWordingEffects('I received your drawing.',input).problems,[]);
 const ledger=clientContext.standing.documentState.transfers.find(row=>row.document==='drawings'&&row.sender==='buyer');assert.equal(ledger.receiptStatus,'confirmed');assert.equal(ledger.coverage,'unknown');
 assert.match(clientContext.standing.summary,/Salesperson update/);assert.match(JSON.stringify(manualRequestFor(input)),/I received the revision B drawing/);
 const safe="I received your drawing. I'll check whether the report covers it.";
 const verdict=checkSuggestion({say:safe,ask:'',intent:'Respond',nextStep:'Check coverage',caution:'',evidence:[],missing:[],verified:true},input,{factChecked:true});
 assert.equal(verdict.ok,true,verdict.reasons.join(' '));
 assert.ok(assessReplyVerification('The report covers your revision B drawing.',input).unsupportedClaims.length>0,'Manual receipt cannot verify report coverage');
});
test('a backdated historical receipt cannot advance the latest drawing; a later receipt can',()=>{
 const t=fixture();
 t.save(t.call('new-drawing','text_email','Buyer: I will email the drawing for revision B when ready.',100),'Riley Stone promised to send the drawing for revision B. Sending and receipt remain unconfirmed.',110);
 t.client=addClientContextEntry(t.client,{id:'historical-receipt',kind:'update',source:'rep_update',scope:'contact',contactId:'riley',projectId:t.projectId,text:'I received the earlier revision A drawing.',at:50},120);
 const historical=buildClientStanding({client:t.client,calls:t.calls,projectId:t.projectId,contactId:'riley',now:130});
 assert.equal(historical.documentState.transfers.find(row=>row.document==='drawings'&&row.sender==='buyer').receiptStatus,'unconfirmed');
 assert.ok(selectClientEntries(t.client,{companyId:t.company.id,projectId:t.projectId,contactId:'riley'}).some(row=>row.id==='historical-receipt'),'Historical evidence is retained, not deleted');
 t.client=addClientContextEntry(t.client,{id:'latest-receipt',kind:'update',source:'rep_update',scope:'contact',contactId:'riley',projectId:t.projectId,text:'I received the revision B drawing.',at:140},140);
 const latest=buildClientStanding({client:t.client,calls:t.calls,projectId:t.projectId,contactId:'riley',now:150});
 const drawing=latest.documentState.transfers.find(row=>row.document==='drawings'&&row.sender==='buyer');
 assert.equal(drawing.receiptStatus,'confirmed');assert.equal(drawing.coverage,'unknown');
});
test('a later email may omit the application without erasing the earlier reviewed need',()=>{
 const t=fixture();
 t.save(t.call('application-call','call_meeting','Buyer: Hi, Riley speaking. We are exploring a backup instrument supplier for our prototype filter.',10),'Riley Stone is exploring a backup instrument supplier for the prototype filter.',20,false);
 t.save(t.call('drawing-email','text_email','Buyer: I will email the drawing when ready.',30),'Riley Stone will email the drawing. Sending and receipt remain unconfirmed.',40,false);
 const standing=buildClientStanding({client:t.client,calls:t.calls,projectId:t.projectId,contactId:'riley',now:50});
 assert.equal(standing.source.callId,'drawing-email');
 assert.equal(standing.unknowns.some(text=>/Product usage and requirements are unconfirmed/.test(text)),false);
 const other=fixture();
 other.save(other.call('documents-only','text_email','Buyer: I will email the drawing when ready.',30),'Riley Stone will email the drawing. Sending and receipt remain unconfirmed.',40);
 const unknown=buildClientStanding({client:other.client,calls:other.calls,projectId:other.projectId,contactId:'riley',now:50});
 assert.ok(unknown.unknowns.some(text=>/Product usage and requirements are unconfirmed/.test(text)),'A document handoff alone never establishes an application');
 assert.equal(t.client.context.length,0,'The reviewed recap remains authoritative even when optional detail rows are unchecked');
 t.save(t.call('withdrawal','text_email','Buyer: We are no longer exploring an instrument supplier for our prototype filter.',60),'Riley Stone is no longer exploring an instrument supplier for the prototype filter.',70,false);
 const withdrawn=buildClientStanding({client:t.client,calls:t.calls,projectId:t.projectId,contactId:'riley',now:80});
 assert.ok(withdrawn.unknowns.some(text=>/Product usage and requirements are unconfirmed/.test(text)),'A later explicit goal withdrawal clears the prior prepared application');
});
test('a different reviewed evaluation goal is prepared context, while document workflow alone is not an application',()=>{
 const t=fixture();
 t.save(t.call('goal-call','call_meeting','Buyer: We are evaluating instruments for a pilot cooling system.',10),'Riley Stone is evaluating instruments for a pilot cooling system.',20,false);
 t.save(t.call('goal-email','text_email','Buyer: I prefer to email the drawing.',30),'Riley Stone prefers to email the drawing.',40,false);
 const known=buildClientStanding({client:t.client,calls:t.calls,projectId:t.projectId,contactId:'riley',now:50});
 assert.equal(known.unknowns.some(text=>/Product usage and requirements are unconfirmed/.test(text)),false);
 const other=fixture();
 other.save(other.call('report-review','text_email','Buyer: We are evaluating the report for review.',10),'Riley Stone is evaluating the report for review.',20,false);
 const unknown=buildClientStanding({client:other.client,calls:other.calls,projectId:other.projectId,contactId:'riley',now:30});
 assert.ok(unknown.unknowns.some(text=>/Product usage and requirements are unconfirmed/.test(text)));
});
test('reply assistance never turns an offered drawing into a received or approved drawing',()=>{
 const t=fixture(),call=t.call('email-offer','text_email','Buyer: I will email our drawing when it is ready.',10);
 call.suggestions=[{id:'suggested-only',guidance:{say:'We received and approved your drawing.'}}];
 const draft=proposeCallWrapUp(call,t.client);
 assert.equal(draft.memory.some(row=>/received and approved/.test(row.text)),false);
 const saved=t.save(call,'Riley Stone offered to email the drawing when ready. Sending, receipt, review and suitability remain unconfirmed.',20);
 const drawing=saved.call.wrapUp.documentState.transfers.find(row=>row.document==='drawings'&&row.sender==='buyer');
 assert.equal(drawing.receiptStatus,'unconfirmed');
 assert.equal(saved.brain.clients[0].context.some(row=>/received and approved/.test(row.text)),false);
});

test('pasting preserves message authors and dates without treating an email header as proof of the author',()=>{
 const parsed=parseInteractionExchange('Buyer: We prefer email.\nPlease include a drawing.\nYou: I will check.\nBuyer: Thank you.',{at:10,idPrefix:'exchange'});
 assert.deepEqual(parsed.turns.map(row=>row.role),['buyer','you','buyer']);assert.deepEqual(parsed.turns.map(row=>row.at),[10,11,12]);assert.match(parsed.turns[0].text,/\nPlease include a drawing/);assert.deepEqual(parsed.warnings,[]);
 const unknown=parseInteractionExchange('From: riley@example.test\nHere is the drawing.',{at:10,idPrefix:'unknown'});assert.equal(unknown.turns[0].role,'conversation');assert.equal(unknown.warnings.length,1);
 const explicitlySelected=parseInteractionExchange('Here is the drawing.',{at:10,defaultRole:'buyer'});assert.equal(explicitlySelected.turns[0].role,'buyer');
 assert.equal(interactionTypeFor({id:'legacy'}),'call_meeting');
});

test('backup merging preserves distinct projects and their dated memory',()=>{
 const t=fixture(),earlier=structuredClone(t.client);
 let incoming=upsertClientProject(t.client,{name:'Third opportunity'},20);
 incoming=addClientContextEntry(incoming,{id:'third',kind:'update',source:'rep_update',scope:'client',projectId:incoming.projects[2].id,text:'This opportunity is at design review.',at:21},21);
 const merged=mergeClientRecords(earlier,incoming);assert.equal(merged.projects.length,3);assert.equal(merged.context.find(row=>row.id==='third').projectId,incoming.projects[2].id);
});
test('a project interaction cannot silently move its project to another client even with no selected memory items',()=>{
 const t=fixture(),call=t.call('project-call','in_person','Buyer: Hello.',10),draft=proposeCallWrapUp(call,t.client);
 draft.recap='An introductory meeting was captured.';draft.memory=[];
 const saved=saveClientCallWrapUp(t.brain,[],call,draft,20),before=structuredClone(saved.calls);
 const other=createClientRecord(t.company.id,'Other fictional client',1,'other-client');
 const brain={...saved.brain,clients:[...saved.brain.clients,other]};
 assert.throws(()=>reassociateClientCall(brain,saved.calls,call.id,{clientId:other.id},30),/project does not belong/);
 assert.deepEqual(saved.calls,before,'Rejected reassociation must leave original history intact');
});
test('reviewing an older call corrects its dated evidence while retaining the later interaction summary',()=>{
 const t=fixture(),old=t.save(t.call('old','call_meeting','Buyer: We need a fixed frame.',10),'Riley initially discussed a fixed frame.',20);
 const latest=t.save(t.call('latest','text_email','Buyer: Our current requirement is a removable frame.',30),'The current requirement is a removable frame.',40);
 const corrected=saveClientCallWrapUp(latest.brain,latest.calls,old.call,{...old.call.wrapUp,recap:'Correction: a fixed frame was an option, not an agreed requirement.'},50);
 assert.equal(corrected.brain.clients[0].currentSummary.callId,'latest');
 assert.equal(corrected.calls.find(row=>row.id==='old').wrapUp.recap,'Correction: a fixed frame was an option, not an agreed requirement.');
 assert.equal(corrected.calls.find(row=>row.id==='old').wrapUp.reviewedAt,50);
});
test('a salesperson-edited outcome survives the save instead of reverting to a derived stage label',()=>{
 const t=fixture(),call=t.call('outcome-review','text_email','Buyer: Our engineer will email the drawing when ready.',10),draft=proposeCallWrapUp(call,t.client);
 draft.outcome='Drawing requested; engineering review pending, no quotation agreed';
 const saved=saveClientCallWrapUp(t.brain,[],call,draft,20);
 assert.equal(saved.call.outcome,draft.outcome);assert.equal(saved.call.wrapUp.outcome,draft.outcome);
});
