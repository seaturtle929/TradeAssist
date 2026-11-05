import assert from 'node:assert/strict';
import test from 'node:test';
import {onDemandDecisionRules,onDemandSuggestionProblems} from '../lib/on-demand-coaching.ts';
import {liveRequestInstructionsFor} from '../lib/live-request.ts';
import {defaultConfigurationStages} from '../lib/sales-curriculum.ts';
import {assessReplyVerification} from '../lib/turn-verification-policy.ts';

// Shareable fictional company data, unrelated to saved buyer calls.
const company={id:'fictional-orchard-valves',name:'Orchard Valve Works',products:'irrigation valves OV10 and OV20'};
const stages=defaultConfigurationStages(),stage=stages.find(item=>item.id==='solution_discussion');
assert.ok(stage);
const snapshot={id:'fictional-version',companyId:company.id,version:1,activatedAt:1,stages,knowledge:[
 {id:'identity',kind:'identity',origin:'manager',status:'active',text:'Orchard Valve Works supplies irrigation valves.',updatedAt:1},
 {id:'documents',kind:'other',origin:'manager',status:'active',text:'Product specification sheets and inspection reports are available for review.',updatedAt:1},
],boundaries:[],preferences:[],legacyNotes:[]};
const buyer=(text,id='buyer')=>({id,role:'buyer',text,at:1});
const make=turns=>({manufacturer:company,turns,callContext:{stageId:stage.id,goal:stage.objective,relationship:'first_contact',background:'Priya in purchasing agreed to a short call about irrigation valves.',knownFacts:'',doNotGuess:''},companyConfiguration:{companyId:company.id,versionId:snapshot.id,version:1,boundAt:1,selectedStageId:stage.id,snapshot},coachingRequest:{id:'fictional-request',requestedAt:2}});

test('Named pickup generation and its existing validator agree on a broad introduction',()=>{
 const context=make([buyer('Hello, Priya speaking.')]),original=JSON.stringify(context),rules=onDemandDecisionRules(context);
 assert.match(rules,/ACTUAL PICKUP/);
 assert.match(rules,/do not list model codes, grades or numeric specifications in this greeting-only move/i);
 assert.match(rules,/never invent an email inquiry or prior conversation/i);
 assert.match(rules,/one or two short sentences for identity plus the supplied purpose or call agreement, then stop and give this person the turn/i);
 assert.match(rules,/Do not ask about application, specifications, requirements, evaluation criteria, priorities, important factors or current supplier yet/i);
 assert.deepEqual(onDemandSuggestionProblems("Hi Priya, I'm calling from Orchard Valve Works about the valve discussion you agreed to. Is now still a good time?",context),[]);
 assert.ok(onDemandSuggestionProblems("Hi Priya, I'm calling from Orchard Valve Works about OV10 and OV20.",context).some(reason=>/Unnecessary product codes/.test(reason)));
 assert.ok(onDemandSuggestionProblems("Hi Priya, I'm calling from Orchard Valve Works. What's the most important factor you're considering for your valve requirements?",context).some(reason=>/before asking detailed discovery/.test(reason)));
 const instructions=liveRequestInstructionsFor(context,{id:'fictional-request',text:'Hello, Priya speaking.',at:2});
 assert.ok(instructions.includes(rules),'The active realtime generation request receives the aligned constraints.');
 assert.equal(JSON.stringify(context),original,'Prompt constraints do not mutate the approved facts or stage.');
});

test('A request for evaluation evidence prefers criteria and qualified comparison over a catalog',()=>{
 const context=make([buyer('We use irrigation valves and our supplier meets our requirements. What could you show our engineer to help decide whether another supplier is worth evaluating?')]);
 const rules=onDemandDecisionRules(context);
 for(const phrase of ['BUYER-REQUESTED EVIDENCE','stated decision criteria','only directly relevant approved specifications or available evidence','unasked numbers','superior performance, suitability or a guaranteed result','not what it proves or contains','approved product attribute separate from the document-send action','unless those actual contents are supplied','rather than declaring the comparison\'s conclusion','Preserve a relevant supported match and the useful document offer','source checks','without forcing another discovery question'])assert.ok(rules.includes(phrase),phrase);
 const instructions=liveRequestInstructionsFor(context,{id:'fictional-request',text:context.turns[0].text,at:2});
 assert.ok(instructions.includes(rules));
 assert.doesNotMatch(rules,/OV10|OV20/);
 assert.match(onDemandDecisionRules(make([buyer('Do you have evidence of that?')])),/BUYER-REQUESTED EVIDENCE/);
 assert.ok(assessReplyVerification('We can share our inspection report proving superior quality.',context).unsupportedClaims.length,'The guidance does not weaken the ordinary check on unprovided report conclusions.');
});

test('Incomplete speech cannot activate evidence guidance from an older completed question',()=>{
 const context=make([buyer('What proof could you show our engineer?','earlier')]);
 context.coachingRequest.partials=[{id:'current',role:'buyer',text:'Actually, please do not'}];
 assert.doesNotMatch(onDemandDecisionRules(context),/BUYER-REQUESTED EVIDENCE/);
 assert.match(onDemandDecisionRules(context),/Speech has been captured at this request and is unfinished/);
});

test('A routine document addition keeps the concise acknowledgment rule',()=>{
 const context=make([buyer('Please include the inspection report with your reply.')]);
 const rules=onDemandDecisionRules(context);
 assert.match(rules,/REQUESTED DOCUMENT ADDITION/);
 assert.match(rules,/Confirm the action without a speed promise/);
 assert.match(rules,/Only restate a specific deadline when the buyer actually agreed to that day\/time/);
 assert.doesNotMatch(rules,/BUYER-REQUESTED EVIDENCE/);
 assert.deepEqual(onDemandSuggestionProblems("I'll include the inspection report with my reply.",context),[]);
 assert.ok(assessReplyVerification("I'll send the inspection report right away.",context).unsupportedClaims.some(claim=>claim.kind==='timing'),'The existing timing check remains enforced.');
});

test('Declining further evidence does not restart an evaluation offer',()=>{
 for(const line of ['We do not need more proof. Thanks for your time.','There is no need to show our engineer more evidence.','I am not asking for proof; please just send the invoice.'])assert.doesNotMatch(onDemandDecisionRules(make([buyer(line)])),/BUYER-REQUESTED EVIDENCE/);
});
