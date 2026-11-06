import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {projectComparisonInput,compareSpeechText} from '../scripts/regression/scheduled-comparison.mjs';

// Authored fictional snapshots. No customer records or real observed lines.
function fixture(clock=100){
 const clientContext={callId:'current-call',clientId:'buyer-record',contactId:'contact-record',reviewedAt:clock,entries:[{id:'preparation-background:current-call',kind:'update',source:'rep_update',text:'A fictional drawing inquiry.',at:clock,recordedAt:clock,status:'current'},{id:'historical-call-fact',kind:'fact',source:'buyer',text:'The buyer received the earlier profile.',at:50,recordedAt:clock,status:'completed',callId:'earlier-call'}],history:[{callId:'earlier-call',at:50,outcome:'Profile requested.'}],standing:{source:{callId:'earlier-call',at:50},sendStatus:'pending',receiptStatus:'unconfirmed'}};
 return {callId:'current-call',clientId:'buyer-record',contactId:'contact-record',manufacturer:{id:'maple',name:'Maple Instruments'},sources:[{id:'available',text:'Inspection reports are available.',updatedAt:40}],companyConfiguration:{boundAt:clock,snapshot:{activatedAt:40,version:1}},clientContext,brain:{createdAt:clock,updatedAt:clock,buyerMemory:{updatedAt:clock,commitments:[{status:'pending',evidence:[{turnId:'buyer-runtime',quote:'Please check the drawing reference QX52, okay?'}]}]},clientContext:structuredClone(clientContext)},conversationState:{commitments:[{status:'pending',deadline:'Thursday'}],immediateObjective:{buyerTurnId:'buyer-runtime'}},turns:[{id:'rep-runtime',at:clock,role:'you',text:'Could you confirm the reference?'},{id:'buyer-runtime',at:clock+1,role:'buyer',text:'Please check the drawing reference QX52, okay?'}],coachingRequest:{id:'request-runtime',requestedAt:clock,releasedAt:clock+2,preparationMs:clock,queuedForMs:clock+3,transcriptState:'confirmed',listeningSession:{startedAt:clock,currentTurnIds:['rep-runtime','buyer-runtime']},speechItemIds:['buyer-runtime']}};
}
const project=value=>projectComparisonInput(value,{currentBuyerItemIds:['buyer-runtime']}),fingerprint=value=>createHash('sha256').update(JSON.stringify(project(value).projection)).digest('hex');

test('Explicit runtime audit clocks alone do not change the semantic fingerprint',()=>{
 const a=fixture(100),b=fixture(200),before=JSON.stringify([a,b]),one=project(a),two=project(b);
 assert.equal(fingerprint(a),fingerprint(b));assert.ok(one.excludedAuditFields.length>10);assert.ok(two.excludedAuditFields.some(row=>row.path==='brain.buyerMemory.updatedAt'));
 assert.ok(two.excludedAuditFields.some(row=>row.path==='clientContext.entries.0.at'));
 assert.equal(JSON.stringify([a,b]),before,'Raw snapshots and their clock evidence remain untouched.');
});
test('Provisional speech clocks are audit-only while partial words and order remain meaningful',()=>{
 const a=fixture(),b=fixture();a.coachingRequest.partials=[{id:'buyer-runtime',role:'buyer',text:'Only if it matches',at:100,observedAt:101,order:1}];b.coachingRequest.partials=[{id:'buyer-runtime',role:'buyer',text:'Only if it matches',at:200,observedAt:201,order:1}];assert.equal(fingerprint(a),fingerprint(b));b.coachingRequest.partials[0].text='Even if it does not match';assert.notEqual(fingerprint(a),fingerprint(b));
});
test('Pending buyer item IDs normalize without pretending that an unfinished turn is confirmed',()=>{
 const a=fixture(),b=fixture();for(const [context,id,at]of [[a,'pending-a',100],[b,'pending-b',200]]){context.coachingRequest.transcriptState='partial';context.coachingRequest.partials=[{id,role:'buyer',text:'Our engineer',at,observedAt:at+1,order:2}];context.coachingRequest.pendingSpeech=[{id,role:'buyer',at,order:2}];context.coachingRequest.speechItemIds=[id];context.coachingRequest.listeningSession.currentTurnIds.push(id);}
 const one=projectComparisonInput(a,{currentBuyerItemIds:['pending-a']}),two=projectComparisonInput(b,{currentBuyerItemIds:['pending-b']});assert.deepEqual(one.projection,two.projection);assert.equal(two.projection.coachingRequest.transcriptState,'partial');b.coachingRequest.transcriptState='confirmed';assert.notDeepEqual(one.projection,projectComparisonInput(b,{currentBuyerItemIds:['pending-b']}).projection);
});
test('Preparation entry at is excluded only when it is the generated review clock',()=>{
 const a=fixture(),b=fixture();b.clientContext.entries[0].at=99;assert.notEqual(fingerprint(a),fingerprint(b),'An independently dated business entry must not inherit the generated-note exception.');
 const c=fixture();c.clientContext.entries[0].source='buyer';assert.ok(project(c).projection.clientContext.entries[0].at!==undefined);
});
test('A historical transcript timestamp outside this listening session remains input',()=>{const a=fixture(),b=fixture();a.turns.unshift({id:'earlier-session',at:20,role:'buyer',text:'I requested the profile.'});b.turns.unshift({id:'earlier-session',at:30,role:'buyer',text:'I requested the profile.'});assert.notEqual(fingerprint(a),fingerprint(b));});
for(const [name,mutate]of [
 ['source content',x=>x.sources[0].text='Inspection reports require manager approval.'],
 ['source update date',x=>x.sources[0].updatedAt=41],
 ['configuration activation date',x=>x.companyConfiguration.snapshot.activatedAt=41],
 ['unreviewed state',x=>x.clientContext.reviewedAt=0],
 ['unbound configuration state',x=>x.companyConfiguration.boundAt=0],
 ['historical call date',x=>x.clientContext.history[0].at=51],
 ['dated client fact',x=>x.clientContext.entries[1].at=51],
 ['standing source call date',x=>x.clientContext.standing.source.at=51],
 ['sending status',x=>x.clientContext.standing.sendStatus='sent'],
 ['receipt status',x=>x.clientContext.standing.receiptStatus='confirmed'],
 ['commitment state',x=>x.conversationState.commitments[0].status='completed'],
 ['agreed deadline',x=>x.conversationState.commitments[0].deadline='Friday'],
 ['contact identity',x=>x.contactId='different-contact'],
 ['company identity',x=>x.manufacturer.id='different-company'],
 ['buyer reference',x=>x.turns[1].text=x.turns[1].text.replace('QX52','QX53')],
 ['buyer turn pointer',x=>x.conversationState.immediateObjective.buyerTurnId='rep-runtime'],
 ['unknown At field',x=>x.businessEvent={at:100}],
 ['audit-named field carrying words instead of a clock',x=>x.clientContext.reviewedAt='Thursday'],
])test('Meaningful input is retained: '+name,()=>{const a=fixture(),b=fixture();mutate(b);assert.notEqual(fingerprint(a),fingerprint(b));});
test('Runtime turn/request identities normalize while client, contact and source identities stay literal',()=>{
 const a=fixture(),b=fixture();b.turns[0].id='other-rep-runtime';b.turns[1].id='other-buyer-runtime';b.coachingRequest.id='other-request-runtime';b.coachingRequest.listeningSession.currentTurnIds=b.turns.map(turn=>turn.id);b.coachingRequest.speechItemIds=['other-buyer-runtime'];b.brain.buyerMemory.commitments[0].evidence[0].turnId='other-buyer-runtime';b.conversationState.immediateObjective.buyerTurnId='other-buyer-runtime';
 const first=project(a),second=projectComparisonInput(b,{currentBuyerItemIds:['other-buyer-runtime']});assert.deepEqual(first.projection,second.projection);assert.equal(second.projection.contactId,'contact-record');assert.equal(second.projection.sources[0].id,'available');
});
test('Only known current speech/evidence receives the declared acknowledgment formatting rule',()=>{
 const a=fixture(),b=fixture();b.turns[1].text='Please check the drawing reference QX52. OK?';b.brain.buyerMemory.commitments[0].evidence[0].quote=b.turns[1].text;
 assert.equal(fingerprint(a),fingerprint(b));assert.ok(project(b).formattedSpeech.length);
 const c=fixture();c.sources[0].text='Please check the drawing reference QX52. OK?';assert.notEqual(fingerprint(a),fingerprint(c),'Company evidence remains exact, not transcript-normalized.');
});
test('Speech formatting is narrow; conditions, references, quantities and interior punctuation do not silently become equivalent',()=>{
 assert.equal(compareSpeechText("I'll check the drawing reference QX52, okay?","I’ll check the drawing reference QX52. OK?").equivalent,true);
 for(const [a,b]of [
  ['Send only if it matches, okay?','Send even if it does not match. OK?'],
  ['Check reference QX52, okay?','Check reference QX53. OK?'],
  ['Use 0.45 mm, okay?','Use 0.54 mm. OK?'],
  ['No, send the drawing, okay?','No send the drawing. OK?'],
  ['Okay.','Okay?'],
  ['Send the report, okay?','Send the report. Actually, do not send it.'],
 ])assert.equal(compareSpeechText(a,b).equivalent,false,a+' / '+b);
});
