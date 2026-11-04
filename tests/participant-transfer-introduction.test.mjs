import assert from 'node:assert/strict';
import test from 'node:test';
import {deriveCallParticipant,isParticipantIntroduction,isCurrentParticipantIntroduction} from '../lib/call-participant.ts';
import {deriveConversationState} from '../lib/conversation-state.ts';
import {callRouteAtRequest,callRouteSuggestionProblems} from '../lib/call-route.ts';
import {onDemandDecisionRules,onDemandSuggestionProblems} from '../lib/on-demand-coaching.ts';

// Fictional laboratory supplier, contact and spoken exchange. No saved call
// transcript or private company data is used by these shareable regressions.
const initial=[
 {id:'fictional-reception',role:'buyer',text:'Example Laboratory, how can I help?'},
 {id:'fictional-intro',role:'you',text:'Hi, I am Lin from Example Instruments.'},
 {id:'fictional-route',role:'you',text:'Could you please connect me with Noor Patel in purchasing?'},
];
const latest=text=>({id:'fictional-pickup',role:'buyer',text});
const context=turns=>({
 manufacturer:{id:'fictional-supplier',name:'Example Instruments',products:'laboratory instruments'},
 callId:'fictional-call',turns,callContext:{stageId:'solution_discussion'},
 clientContext:{companyId:'fictional-supplier',clientId:'fictional-lab',contactId:'fictional-noor',contact:{id:'fictional-noor',clientId:'fictional-lab',companyId:'fictional-supplier',kind:'person',name:'Noor Patel',role:'Purchasing'},reachViaContact:{id:'fictional-main',kind:'main_line',name:'Company main line'},background:'',entries:[],history:[],reviewedAt:1},
});

for(const text of ['One moment, hi Noor speaking.','One moment. Noor speaking.','Sure, one moment please. This is Noor in purchasing.','I will put you through. Hi, Noor speaking.',"One moment. Hi, I'm Noor.",'One moment. Hello, I am Noor.'])test('A routing cue and explicit pickup in one item establish the new speaker: '+text,()=>{
 const turn=latest(text),turns=[...initial,turn],before=JSON.stringify(turns),participant=deriveCallParticipant(turns);
 assert.equal(participant.speakerName,'noor');
 assert.equal(participant.afterTransfer,true);
 assert.equal(participant.transferPending,false);
 assert.equal(participant.transfer.status,'completed');
 assert.equal(participant.introductionNeeded,true,'Reception’s rep introduction did not reach the new contact.');
 assert.equal(participant.segmentStartTurnId,turn.id);
 assert.equal(participant.transfer.evidence.turnId,turn.id);
 assert.equal(isCurrentParticipantIntroduction(turn,participant),true);
 assert.equal(deriveConversationState({turns}).nextAction.kind,'introduce_contact');
 assert.equal(JSON.stringify(turns),before,'The original ASR item and ID are preserved.');
 const request=context(turns);
 assert.equal(callRouteAtRequest(request).targetPresent,true);
 assert.equal(callRouteAtRequest(request).routingNeeded,false);
 assert.deepEqual(callRouteSuggestionProblems("Hi Noor, I am Lin from Example Instruments.",request),[]);
 assert.match(onDemandDecisionRules(request),/ACTUAL PICKUP/);
 assert.deepEqual(onDemandSuggestionProblems("Hi Noor, I'm calling from Example Instruments about the instruments discussion. Is now a good time?",request),[]);
});

test('A bare routing hold stays pending and cannot establish the intended contact',()=>{
 for(const text of ['One moment.','Sure, one moment please.','Please hold.']){
  const turn=latest(text),turns=[...initial,turn],participant=deriveCallParticipant(turns),request=context(turns);
  assert.equal(participant.transferPending,true,text);
  assert.equal(participant.transfer.status,'pending');
  assert.equal(participant.afterTransfer,false);
  assert.equal(participant.speakerName,undefined);
  assert.equal(isCurrentParticipantIntroduction(turn,participant),false);
  assert.equal(deriveConversationState({turns}).nextAction.kind,'transfer_pending');
  assert.equal(callRouteAtRequest(request).targetPresent,false);
  assert.doesNotMatch(onDemandDecisionRules(request),/ACTUAL PICKUP/);
 }
});

test('Separate transcript updates complete the same pending transfer',()=>{
 const hold=latest('One moment.'),pickup={id:'fictional-next',role:'buyer',text:'Hi, Noor speaking.'};
 const participant=deriveCallParticipant([...initial,hold,pickup]);
 assert.equal(participant.transfer.status,'completed');
 assert.equal(participant.speakerName,'noor');
 assert.equal(participant.segmentStartTurnId,pickup.id);
 assert.equal(isCurrentParticipantIntroduction(pickup,participant),true);
});

for(const text of ['One moment. She said this is Noor speaking.','One moment. You will hear Noor speaking.','One moment. She said, "Noor speaking."',"One moment. She said I'm Noor.",'I will put you through. They told me Noor speaking.'])test('Reported or anticipated identity is not actual pickup: '+text,()=>{
 const turn=latest(text),participant=deriveCallParticipant([...initial,turn]);
 assert.equal(participant.transferPending,true);
 assert.equal(participant.afterTransfer,false);
 assert.equal(isCurrentParticipantIntroduction(turn,participant),false);
 assert.equal(callRouteAtRequest(context([...initial,turn])).targetPresent,false);
});

test('A known purchaser pausing to check something does not become reception',()=>{
 const turns=[{id:'fictional-known',role:'buyer',text:'Hi, this is Noor in purchasing.'},{id:'fictional-followup',role:'you',text:'Thank you, Noor.'},latest('One moment.')];
 const participant=deriveCallParticipant(turns);
 assert.equal(participant.role,'purchasing');
 assert.equal(participant.transferPending,false);
 assert.equal(participant.speakerName,'noor');
});

test('A greeting prefix is not part of a contact’s name',()=>{
 const participant=deriveCallParticipant([latest('Hi, Noor speaking.')]);
 assert.equal(participant.speakerName,'noor');
 assert.equal(participant.transferPending,false);
});

test('An I-am introduction must still be a bounded identity rather than needs or availability',()=>{
 for(const text of ["I'm ready.","I'm not Noor.","I'm busy.","I'm Noor and we need a quotation."])assert.equal(isParticipantIntroduction(text),false,text);
});

test('Complete canonical speech outranks an already-processed stale participant cache',()=>{
 const turns=[...initial,latest('One moment, hi Noor speaking.')];
 const memory={callId:'fictional-call',participant:{role:'unknown',speakerName:'hi noor',introductionNeeded:false,transferPending:false,afterTransfer:false,segmentStartTurnId:initial[0].id},processedTurnIds:turns.map(turn=>turn.id),facts:{},commitments:[],sequence:[]};
 const before=JSON.stringify(memory),state=deriveConversationState({callId:'fictional-call',turns,buyerMemory:memory});
 assert.equal(state.participant.speakerName,'noor');
 assert.equal(state.participant.transfer.status,'completed');
 assert.equal(state.participant.introductionNeeded,true);
 assert.equal(state.nextAction.kind,'introduce_contact');
 assert.equal(JSON.stringify(memory),before,'The saved memory is reference input, not mutated during a request.');
});

test('A genuinely truncated transcript retains its earlier verified participant segment',()=>{
 const memory={callId:'fictional-call',participant:{role:'purchasing',speakerName:'noor',introductionNeeded:false,transferPending:false,afterTransfer:true,segmentStartTurnId:'fictional-older-pickup'},processedTurnIds:['fictional-older-pickup','fictional-older-intro'],facts:{},commitments:[],sequence:[]};
 const state=deriveConversationState({callId:'fictional-call',turns:[{id:'fictional-current',role:'buyer',text:'Thank you.'}],buyerMemory:memory});
 assert.equal(state.participant.speakerName,'noor');
 assert.equal(state.participant.role,'purchasing');
 assert.equal(state.participant.introductionNeeded,false);
 assert.equal(state.participant.segmentStartTurnId,'fictional-older-pickup');
});
