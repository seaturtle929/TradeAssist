import assert from 'node:assert/strict';
import test from 'node:test';
import {CoachInput} from '../lib/coach.ts';
import {streamManualCoaching} from '../lib/manual-coaching.ts';
import {readManualStream} from '../lib/manual-stream-client.ts';

// Authored fictional speech/provider envelopes only. No API, recordings,
// private records, application storage or real buyer data are used here.
const context=()=>CoachInput.parse({manufacturer:{id:'cedar',name:'Cedar Instruments',products:'inspection instruments'},sources:[{id:'documents',title:'Documents',text:'Inspection reports and specifications are available.'}],turns:[{id:'buyer',role:'buyer',text:'RX73 is our drawing reference. Could you check whether the report covers RX73?'}],coachingRequest:{id:'one-press',requestedAt:Date.now(),transcriptState:'confirmed'}});
const response=(events)=>new Response(new ReadableStream({start(controller){for(const event of events)controller.enqueue(new TextEncoder().encode('data: '+JSON.stringify(event)+'\n\n'));controller.close();}}));
const completed={type:'response.completed',response:{id:'scripted-response',status:'completed',model:'gpt-6-luna',usage:{input_tokens:100,output_tokens:20}}};
const wording=say=>({type:'response.output_text.delta',delta:'SAY: '+say+'\nMOVE: Respond to the current question\n'});
const harness=overrides=>{
 const events=[],charges=[];let repairs=0,verifications=0;
 const options={input:context(),signal:new AbortController().signal,emit:event=>events.push(structuredClone(event)),charges,charge:value=>({id:value.id,at:Date.now(),kind:'coach',model:value.model,usd:0.00002,known:true}),verify:async guidance=>{verifications++;return {...guidance,verified:true};},repair:async()=>{repairs++;throw new Error('An additional model repair is forbidden');},...overrides};
 return {options,events,charges,run:()=>streamManualCoaching(options),shown:()=>events.filter(event=>event.type==='suggestion_complete'),repairs:()=>repairs,verifications:()=>verifications};
};

test('A useful generated check publishes unchanged without source verification or another generation',async()=>{
 const say="I'll check whether the report covers RX73 and get back to you.";
 const t=harness({response:response([wording(say),completed])});await t.run();
 assert.deepEqual(t.shown().map(event=>event.guidance.say),[say]);
 assert.equal(t.shown()[0].guidance.replyOrigin,'generated');
 assert.equal(t.verifications(),0);assert.equal(t.repairs(),0);
 assert.equal(t.charges.length,1);assert.equal(t.charges[0].known,true);
});

test('A rejected coverage claim completes the same press locally without another model call',async()=>{
 const t=harness({response:response([wording('The report covers RX73.'),completed]),verify:async()=>{throw Object.assign(new Error('No approved coverage evidence'),{code:'suggestion_rejected'});}});await t.run();
 assert.equal(t.shown().length,1);assert.equal(t.shown()[0].guidance.replyOrigin,'local');
 assert.equal(t.shown()[0].guidance.say,"I'll check the details and get back to you.");
 assert.doesNotMatch(t.shown()[0].guidance.say,/covers|send/i);assert.equal(t.repairs(),0);
});

test('Provider failure before a response body still completes the same press locally',async()=>{
 const t=harness({createResponse:async()=>{throw new Error('Scripted provider failure');}});await t.run();
 assert.equal(t.shown().length,1);assert.equal(t.shown()[0].guidance.replyOrigin,'local');
 assert.equal(t.shown()[0].guidance.say,"I'll check the details and get back to you.");
 assert.equal(t.shown()[0].guidance.usageUnconfirmed,true,'Missing provider usage is not reported as a known zero charge');
 assert.deepEqual(t.charges,[]);
});

test('No key produces a local line without claiming unknown inference usage',async()=>{
 const t=harness({createResponse:async()=>{throw Object.assign(new Error('No key configured'),{code:'not_configured'});}});await t.run();
 assert.equal(t.shown()[0].guidance.replyOrigin,'local');assert.equal(t.shown()[0].guidance.usageUnconfirmed,false);assert.deepEqual(t.charges,[]);
});

test('The deadline includes the initial fetch and cannot be extended by a hung response',async()=>{
 let providerSignal;
 const t=harness({startedAt:performance.now()-1490,createResponse:signal=>{providerSignal=signal;return new Promise(()=>{});}});
 const started=performance.now();await t.run();
 assert.ok(performance.now()-started<250);assert.equal(t.shown().length,1);
 assert.equal(t.shown()[0].guidance.localReason,'generation_timeout');assert.equal(providerSignal.aborted,true);
});

test('A hung stream body is cancelled after local completion; its late output cannot replace the line',async()=>{
 let streamController,cancelled=false;
 const streamed=new Response(new ReadableStream({start(controller){streamController=controller;},cancel(){cancelled=true;}}));
 const t=harness({response:streamed,startedAt:performance.now()-1490});await t.run();
 assert.equal(t.shown().length,1);assert.equal(cancelled,true);
 assert.throws(()=>streamController.enqueue(new TextEncoder().encode('data: '+JSON.stringify(wording('A different late line.'))+'\n\n')));
 assert.equal(t.shown()[0].guidance.replyOrigin,'local');
});

test('Explicit cancellation ends silently and never revives a retired intentional press',async()=>{
 const aborter=new AbortController();let resolveResponse;
 const t=harness({signal:aborter.signal,createResponse:()=>new Promise(resolve=>{resolveResponse=resolve;})});
 const running=t.run();aborter.abort();await running;
 resolveResponse(response([wording("I'll check the details and get back to you."),completed]));await new Promise(resolve=>setImmediate(resolve));
 assert.equal(t.shown().length,0);
});

test('A provider failure after a checked generated line cannot replace the stable wording',async()=>{
 const say="I'll check whether the report covers RX73 and get back to you.";
 const t=harness({response:response([wording(say),{type:'response.failed',error:{message:'Scripted late error'}}])});await t.run();
 assert.deepEqual(t.shown().map(event=>event.guidance.say),[say]);assert.equal(t.shown()[0].guidance.replyOrigin,'generated');
});

test('Transport errors retain reported charges and an abort releases a hung NDJSON reader',async()=>{
 const events=[];const charge={id:'reported',at:1,kind:'coach',model:'fictional',usd:0.02,known:true};
 await assert.rejects(readManualStream(Response.json({error:'Failed',_charges:[charge]},{status:502}),event=>events.push(event)),/Failed/);
 assert.deepEqual(events,[{type:'charges',_charges:[charge]}]);
 let cancelled=false;const aborter=new AbortController();
 const reading=readManualStream(new Response(new ReadableStream({cancel(){cancelled=true;}})),()=>assert.fail('No line should be emitted'),aborter.signal);
 aborter.abort();await reading;assert.equal(cancelled,true);
});

test('Ordinary useful generated discovery still passes the normal checks unchanged',async()=>{
 const input=context();input.turns=[{id:'buyer',role:'buyer',text:'We are building a prototype filter.'}];
 const say='Could you tell me what you need it to do?';
 const t=harness({input,response:response([wording(say),completed])});await t.run();
 assert.deepEqual(t.shown().map(event=>event.guidance.say),[say]);
 assert.equal(t.shown()[0].guidance.replyOrigin,'generated');assert.equal(t.repairs(),0);
});

test('Ready wording is not left waiting on a hung optional metadata tail',async()=>{
 let cancelled=false;
 const say="I'll check whether the report covers RX73 and get back to you.";
 const streamed=new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('data: '+JSON.stringify(wording(say))+'\n\n'));},cancel(){cancelled=true;}}));
 const t=harness({response:streamed,startedAt:performance.now()-1490});await t.run();
 assert.deepEqual(t.shown().map(event=>event.guidance.say),[say]);assert.equal(t.shown()[0].guidance.replyOrigin,'generated');
 assert.equal(cancelled,true);assert.ok(t.events.some(event=>event.type==='charges'&&event.timing?.usageUnconfirmed));
 assert.deepEqual(t.charges,[],'Unreported usage remains unknown, not a fabricated charge');
});
