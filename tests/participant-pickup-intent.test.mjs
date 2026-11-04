import assert from 'node:assert/strict';
import test from 'node:test';
import {currentParticipantPickup,deriveCallParticipant} from '../lib/call-participant.ts';
import {deriveConversationState} from '../lib/conversation-state.ts';
import {callRouteAtRequest} from '../lib/call-route.ts';
import {onDemandDecisionRules,onDemandSuggestionProblems,onDemandTaskContext} from '../lib/on-demand-coaching.ts';
import {assessReplyVerification} from '../lib/turn-verification-policy.ts';
import {BrainRequestInput} from '../lib/company-brain-input.ts';

// Deliberately fictional identities, approved knowledge and conversation.
// No saved calls or private company/customer material are used here.
const initial=[
 {id:'reception',role:'buyer',text:'Example Laboratory, how can I help?'},
 {id:'rep-intro',role:'you',text:'Hi, I am Lin from Example Instruments.'},
 {id:'rep-route',role:'you',text:'Could you please connect me with Noor Patel in purchasing?'},
];
const buyer=(text,id='pickup')=>({id,role:'buyer',text});
const context=turns=>({
 manufacturer:{id:'example-instruments',name:'Example Instruments',products:'laboratory instruments PX20'},
 callId:'example-call',turns,callContext:{stageId:'solution_discussion',relationship:'first_contact',background:'Noor Patel agreed to a short call about laboratory instruments.'},
 sources:[{id:'docs',text:'Specification sheets and material test reports are available for review.'},{id:'product',text:'PX20 is a laboratory instrument.'}],
 clientContext:{companyId:'example-instruments',clientId:'example-lab',contactId:'noor',contact:{id:'noor',clientId:'example-lab',companyId:'example-instruments',kind:'person',name:'Noor Patel',role:'Purchasing'},reachViaContact:{id:'main',kind:'main_line',name:'Company main line'},background:'',preparedContext:{context:'Noor Patel agreed to a short call about laboratory instruments.'},entries:[],history:[],reviewedAt:1},
 coachingRequest:{id:'example-request',requestedAt:2},
});

for(const text of ['Noor here.','Noor speaking.','Hi, this is Noor.'])test('A requested person’s explicit identity starts a new segment without a captured hold: '+text,()=>{
 const latest=buyer(text),turns=[...initial,latest],original=JSON.stringify(turns),participant=deriveCallParticipant(turns),request=context(turns);
 assert.equal(participant.speakerName,'noor');
 assert.equal(participant.introductionNeeded,true);
 assert.equal(participant.afterTransfer,true);
 assert.equal(participant.transferPending,false);
 assert.equal(participant.transfer.status,'completed');
 assert.equal(participant.segmentStartTurnId,latest.id);
 assert.equal(participant.role,'unknown','A requested purchasing role is not this person’s role evidence.');
 assert.equal(currentParticipantPickup(latest,participant).kind,'greeting_only');
 assert.equal(deriveConversationState({turns}).nextAction.kind,'introduce_contact');
 assert.equal(callRouteAtRequest(request).targetPresent,true);
 assert.deepEqual(onDemandTaskContext(request).currentPickup,{kind:'greeting_only',turnId:latest.id});
 const rules=onDemandDecisionRules(request);
 assert.match(rules,/ACTUAL PICKUP:/);
 assert.match(rules,/clientPreparation\.preparedContext\.context/);
 assert.deepEqual(onDemandSuggestionProblems("Hi Noor, this is Lin from Example Instruments about the short instruments call you agreed to. Is now still a good time?",request),[]);
 assert.ok(onDemandSuggestionProblems('Hi Noor. What specifications are you currently using?',request).length);
 assert.equal(JSON.stringify(turns),original);
});

test('A routing target alone is not evidence that the person is present',()=>{
 const participant=deriveCallParticipant(initial),request=context(initial);
 assert.equal(participant.requestedConnection.targetName,'Noor Patel');
 assert.equal(participant.speakerName,undefined);
 assert.equal(participant.transferPending,false);
 assert.notEqual(participant.transfer?.status,'completed');
 assert.equal(callRouteAtRequest(request).routingNeeded,true);
 assert.equal(onDemandTaskContext(request).currentPickup,undefined);
 const hold=deriveCallParticipant([...initial,buyer('One moment.')]);
 assert.equal(hold.transferPending,true);
 assert.equal(hold.transfer.status,'pending');
});

for(const text of ['She said, Noor here.','They said, Noor speaking.','You will hear Noor here.','She said, “Noor here.”'])test('Reported identity does not complete the requested connection: '+text,()=>{
 for(const hold of [[],[buyer('One moment.','hold')]]){
  const latest=buyer(text),participant=deriveCallParticipant([...initial,...hold,latest]);
  assert.notEqual(participant.speakerName,'noor');
  assert.notEqual(participant.transfer?.status,'completed');
  assert.equal(currentParticipantPickup(latest,participant),undefined);
  assert.equal(callRouteAtRequest(context([...initial,...hold,latest])).targetPresent,false);
 }
});

test('The requested connection survives a genuinely truncated cache and its request schema',()=>{
 const seed=deriveCallParticipant(initial),before=JSON.stringify(seed);
 const schema=BrainRequestInput.shape.buyerMemory.unwrap().shape.participant.unwrap();
 const parsed=schema.parse(seed);
 assert.deepEqual(parsed.requestedConnection,seed.requestedConnection);
 const latest=buyer('Noor here.'),participant=deriveCallParticipant([latest],parsed);
 assert.equal(participant.introductionNeeded,true);
 assert.equal(participant.transfer.status,'completed');
 assert.equal(participant.segmentStartTurnId,latest.id);
 assert.equal(JSON.stringify(seed),before);
});

test('Re-identification by the same current person does not repeat an introduction',()=>{
 for(const prefix of [[buyer('Noor here.','initial-noor')],[...initial,buyer('Noor here.','initial-noor')]]){
  const turns=[...prefix,{id:'actual-intro',role:'you',text:'Hi Noor, I am Lin from Example Instruments.'},buyer('Noor here.')],participant=deriveCallParticipant(turns);
  assert.equal(participant.introductionNeeded,false);
  assert.equal(currentParticipantPickup(turns.at(-1),participant),undefined);
  assert.doesNotMatch(onDemandDecisionRules(context(turns)),/ACTUAL PICKUP:/);
 }
});

test('A pickup with a real question answers it first and retains report coverage checks',()=>{
 const latest=buyer('Noor here. Can you confirm whether the material test report covers PX20?'),turns=[...initial,latest],request=context(turns),participant=deriveCallParticipant(turns);
 assert.equal(currentParticipantPickup(latest,participant).kind,'substantive');
 assert.equal(deriveConversationState({turns}).nextAction.kind,'respond_to_question');
 const rules=onDemandDecisionRules(request);
 assert.match(rules,/ACTUAL PICKUP WITH CURRENT SUBSTANTIVE TURN/);
 assert.doesNotMatch(rules,/ACTUAL PICKUP:/);
 assert.match(rules,/DOCUMENT COVERAGE QUESTION — EVIDENCE GAP/);
 assert.deepEqual(onDemandSuggestionProblems("I'll check whether the material test report covers PX20 and confirm that before sending it.",request),[]);
 const factRequest={...request,clientContext:undefined};
 assert.ok(assessReplyVerification('The material test report covers PX20.',factRequest).unsupportedClaims.some(claim=>claim.verificationBoundary==='document_product_scope'));
});

test('A returning newly reached contact uses reviewed commitments without skipping identity',()=>{
 const request=context([...initial,buyer('Noor here.')]);
 request.clientContext.standing={version:1,companyId:'example-instruments',clientId:'example-lab',source:{callId:'reviewed-call',at:1,reviewedAt:1},summary:'Noor requested documents; sending remains pending.',reached:'Noor in purchasing',contact:{name:'Noor Patel',role:'Purchasing'},buyerRequested:['Specification sheets and material test report'],repOwes:['Send specification sheets and material test report'],buyerOwes:[],unknowns:['Destination address','Receipt and review'],documents:['Specification sheets','Material test report'],sendStatus:'pending',receiptStatus:'unconfirmed',reviewStatus:'unconfirmed',evidence:[]};
 request.clientContext.history=[{callId:'reviewed-call',at:1,contactName:'Noor Patel',summary:'Noor requested the specification sheets and material test report.',outcome:'Documents requested'}];
 const original=JSON.stringify(request),rules=onDemandDecisionRules(request);
 assert.match(rules,/ACTUAL PICKUP:/);
 assert.match(rules,/reviewedFollowThrough.*clientPreparation\.standing/);
 assert.match(rules,/preserve its send, receipt and review status/i);
 assert.deepEqual(onDemandSuggestionProblems("Hi Noor, this is Lin from Example Instruments, following up on the specification sheets and material test report you requested.",request),[]);
 assert.ok(onDemandSuggestionProblems('Hi Noor, following up on the specification sheets and material test report you requested.',request).some(reason=>/Introduce the supplied company/.test(reason)));
 assert.ok(onDemandSuggestionProblems('Hi Noor, this is Taylor from Example Instruments, following up on the requested documents.',request).some(reason=>/verified representative name Lin/.test(reason)));
 assert.equal(JSON.stringify(request),original);
});

test('Missing reviewed commitments do not manufacture a document follow-up or personal name',()=>{
 const request=context([buyer('Noor here.')]),rules=onDemandDecisionRules(request);
 assert.match(rules,/currentPreparation.*clientPreparation\.preparedContext\.context/);
 assert.doesNotMatch(rules,/reviewedFollowThrough":\{/);
 assert.deepEqual(onDemandSuggestionProblems("Hi Noor, I'm calling from Example Instruments about the laboratory instruments call you agreed to.",request),[]);
 assert.ok(onDemandSuggestionProblems("Hi Noor, this is Lin from Example Instruments.",request).some(reason=>/No verified salesperson name/.test(reason)));
});
