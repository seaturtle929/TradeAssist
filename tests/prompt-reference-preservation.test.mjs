import test from 'node:test';
import assert from 'node:assert/strict';
import {deduplicateOnDemandReferenceData} from '../lib/on-demand-projection.ts';

test('Repeated current action and authored objective retain one complete value without changing evidence',()=>{
 const action={kind:'introduce_contact',reason:'The intended person has now identified themselves in the current conversation.',move:'Introduce the verified representative and company, explain the agreed reason for the call, and leave room for the newly reached person to respond.'};
 const objective='Understand the buyer’s project and constraints, then determine whether an approved capability would support their intended outcome without assuming suitability.';
 const source={id:'example-source',text:'The Example Instruments PX20 inspection report contains PX20 dimensional measurements.'};
 const transcript=[{id:'current',role:'buyer',text:'Noor speaking. Actually, please hold off sending anything until I confirm the model.'}];
 const foundation={immediateAction:action,conversationContext:{currentObjective:action},activeConfiguration:{stage:{objective,legacy:{purpose:objective}}},builtInSalesExpertise:{curriculum:{relevantCycle:{objective}}}};
 const snapshot={coachingTask:{managerObjective:objective,immediateAction:action,finalizedTranscript:transcript},purpose:{immediateAction:action,conversationState:{nextAction:action,immediateObjective:action,stagePurpose:objective}},callContext:{goal:objective},sources:[source],brain:{learningExamples:[{negative:'The report covers all models.',positive:'I will check whether the report covers the selected model.'}]}};
 const original=structuredClone({foundation,snapshot});
 const projected=deduplicateOnDemandReferenceData(JSON.stringify({configuration:{selectedStage:{objective}}}),foundation,snapshot);
 assert.deepEqual(projected.foundation.immediateAction,action);
 for(const value of [projected.foundation.conversationContext.currentObjective,projected.snapshot.coachingTask.immediateAction,projected.snapshot.purpose.immediateAction,projected.snapshot.purpose.conversationState.nextAction,projected.snapshot.purpose.conversationState.immediateObjective])assert.deepEqual(value,{sameValueAs:'SALES FOUNDATION.immediateAction'});
 assert.deepEqual(projected.snapshot.coachingTask.finalizedTranscript,transcript);
 assert.deepEqual(projected.snapshot.sources,[source]);
 assert.deepEqual(projected.snapshot.brain.learningExamples,original.snapshot.brain.learningExamples);
 assert.deepEqual({foundation,snapshot},original);
 assert.ok(JSON.stringify(projected).length<JSON.stringify(original).length-500);
});

test('A late changed meaning is never replaced with a previous action or stage objective',()=>{
 const action={kind:'send_documents',reason:'The earlier buyer turn requested documents.',move:'Offer the available documents and confirm the delivery route before sending anything.'};
 const changed={kind:'wait',reason:'The buyer corrected the earlier send request.',move:'Acknowledge the buyer’s instruction to hold off and keep the document sending pending.'};
 const foundation={immediateAction:action};
 const snapshot={coachingTask:{managerObjective:'Do not send yet.',immediateAction:changed},purpose:{conversationState:{nextAction:changed,immediateObjective:changed,stagePurpose:'Follow the buyer’s corrected decision.'}}};
 const result=deduplicateOnDemandReferenceData(JSON.stringify({configuration:{selectedStage:{objective:'Proceed with agreed sending.'}}}),foundation,snapshot);
 assert.deepEqual(result.snapshot,snapshot);
});
