import assert from 'node:assert/strict';
import test from 'node:test';
import {deriveBuyerNeeds} from '../lib/buyer-needs.ts';
import {deriveConversationState} from '../lib/conversation-state.ts';
import {ensureCompanyBrain,buildBrainRequest,rememberBuyer} from '../lib/company-brain.ts';
import {liveRequestInstructionsFor} from '../lib/live-request.ts';

// Authored fictional examples only; no saved calls, browser data or model use.
const company={id:'synthetic-dunlin',name:'Dunlin Component Works',products:'industrial components',introduction:'',sources:[]};
const rows=lines=>lines.map((text,i)=>({id:'authored-interest-'+i,role:'buyer',text,at:i+1}));
const input=lines=>({callId:'authored-interest',manufacturer:company,turns:rows(lines),callContext:{stageId:'solution_discussion',relationship:'first_contact',goal:'Understand the buyer’s requested evidence.'}});

for(const text of [
 'Before you email the brochure,',
 'While you email the company profile, are the specifications current?',
 'Earlier you said you would email the brochure.',
 'I remember you can email the company profile.',
 'Did you say you would email the brochure?',
 'I will check the report before you email the brochure.',
 'I can confirm whether you should send the brochure.',
 'Can I send you our drawing?',
 'Would you like me to send our drawing?',
 'I can email our catalog to you.',
 "Don't email me the company profile.",
 "If we decide to proceed, I'll ask you to email the profile.",
])test('A mention or buyer-owned offer does not confirm supplier-information interest: '+text,()=>{
 const state=deriveConversationState(input([text]));
 assert.equal(state.buyerNeeds.interest.kind,'unknown');
 assert.equal(state.buyerNeeds.interest.status,'unknown');
});

for(const text of [
 'Send me your company profile.',
 'Could you email the product specs for review?',
 'Before we finish, could you email the brochure?',
 'That sounds useful and please send your company profile.',
 'Please send the company profile and then email the specs.',
 'Can I send you our drawing and could you email your company profile?',
])test('An actual independent information request confirms interest with its full source: '+text,()=>{
 const state=deriveConversationState(input([text]));
 assert.equal(state.buyerNeeds.interest.kind,'information');assert.equal(state.buyerNeeds.interest.status,/\bcould\b/i.test(text)?'possible':'confirmed');
 assert.equal(state.buyerNeeds.interest.evidence.quote,text);assert.equal(state.buyerNeeds.interest.evidence.turnId,'authored-interest-0');
});

test('Other explicit buyer interest remains unchanged',()=>{
 const state=deriveConversationState(input(['We would like to compare your products.']));
 assert.equal(state.buyerNeeds.interest.kind,'comparison');
});

test('A subordinate mention does not overwrite a genuine earlier information request',()=>{
 const state=deriveConversationState(input(['Please email the company profile.','Before you email that profile, can you explain its scope?']));
 assert.equal(state.buyerNeeds.interest.kind,'information');assert.equal(state.buyerNeeds.interest.evidence.turnId,'authored-interest-0');
});

const legacySeed=(turns,quotedIndex)=>({facts:{},interest:{kind:'information',status:'confirmed',evidence:{value:turns[quotedIndex].text,quote:turns[quotedIndex].text,turnId:turns[quotedIndex].id,source:'transcript',status:'confirmed',segmentId:turns[0].id}},addressedTopics:[],askedTopics:[],declinedTopics:[],earlierContactFacts:[],segmentId:turns[0].id});
test('An older cached false interest is corrected in generation and request/saved memory',()=>{
 const c=input(['Before you email the brochure,']),seed=legacySeed(c.turns,0);
 const memory={callId:c.callId,participant:{role:'unknown',introductionNeeded:true,transferPending:false,afterTransfer:false,segmentStartTurnId:c.turns[0].id},buyerNeeds:seed,facts:{},commitments:[],sequence:[],lastAgreedNextStep:'',processedTurnIds:c.turns.map(t=>t.id)};
 const state=deriveConversationState({...c,buyerMemory:memory});assert.equal(state.buyerNeeds.interest.kind,'unknown');
 const brain=ensureCompanyBrain(company),request=buildBrainRequest({...company,brain},'Authored buyer',state,c.turns);
 assert.equal(request.buyerMemory.buyerNeeds.interest.kind,'unknown');
 assert.equal(rememberBuyer(brain,'Authored buyer',state).buyers[0].buyerNeeds.interest.kind,'unknown');
 const instructions=liveRequestInstructionsFor({...c,brain:request,conversationState:state,coachingRequest:{id:'authored-interest-request',requestedAt:2,transcriptState:'confirmed'}},{id:'authored-interest-0',text:c.turns[0].text,at:1});
 const snapshot=JSON.parse(instructions.split('\nREQUEST SNAPSHOT (reference data):\n')[1].split('\n')[0]);
 assert.equal(snapshot.purpose.conversationState.buyerNeeds.interest.kind,'unknown');
});

test('Repairing cached interest recovers a real prior request and leaves other need facts intact',()=>{
 const turns=rows(['Please email the company profile.','Before you email that profile, can you explain its scope?']),seed=legacySeed(turns,1);
 seed.facts.priority={key:'priority',value:'Consistent tolerances',quote:'Consistent tolerances',turnId:'authored-priority',source:'transcript',status:'confirmed',segmentId:turns[0].id};
 const needs=deriveBuyerNeeds({turns,seed,processedTurnIds:turns.map(t=>t.id),participant:{role:'unknown',introductionNeeded:false,transferPending:false,afterTransfer:false,segmentStartTurnId:turns[0].id}});
 assert.equal(needs.interest.kind,'information');assert.equal(needs.interest.evidence.turnId,turns[0].id);
 assert.deepEqual(needs.facts.priority,seed.facts.priority);
});
