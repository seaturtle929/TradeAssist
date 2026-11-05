import assert from 'node:assert/strict';
import test from 'node:test';
import {LiveTurnCoordinator} from '../lib/live-turn-coordinator.ts';

function fixture(){
 const requests=[],cancels=[];
 const coordinator=new LiveTurnCoordinator({onRequest:(ticket,continuation)=>requests.push({ticket,continuation}),onSupersede:()=>{},onCancel:id=>cancels.push(id),cancelAckTimeoutMs:15});
 const ticket=coordinator.requestNextMove({id:'synthetic-buyer',text:'Can you confirm that?',at:1});
 coordinator.responseCreated('original',ticket.revision);
 return {coordinator,ticket,requests,cancels};
}
test('Rejected wording cancels remaining metadata and dispatches one same-snapshot repair on acknowledgment',()=>{
 const t=fixture();try{
  assert.equal(t.coordinator.replaceResponse(t.ticket),true);
  assert.deepEqual(t.cancels,['original']);assert.equal(t.requests.length,1);
  assert.equal(t.coordinator.replaceResponse(t.ticket),false);
  t.coordinator.responseDone('original');assert.equal(t.requests.length,2);
  assert.equal(t.requests[1].ticket,t.ticket);assert.equal(t.requests[1].continuation,true);
  t.coordinator.responseCreated('repair',t.ticket.revision);
  t.coordinator.responseDone('original');assert.equal(t.requests.length,2);assert.equal(t.coordinator.state.serverBusy,true);
 }finally{t.coordinator.reset();}
});
test('A missing cancellation acknowledgment has a bounded wait and a late acknowledgment cannot clear the repair',async()=>{
 const t=fixture();try{
  t.coordinator.replaceResponse(t.ticket);await new Promise(resolve=>setTimeout(resolve,30));
  assert.equal(t.requests.length,2);t.coordinator.responseCreated('repair',t.ticket.revision);
  t.coordinator.responseDone('original');assert.equal(t.coordinator.state.serverBusy,true);
  t.coordinator.markAnswered(t.ticket);assert.equal(t.coordinator.replaceResponse(t.ticket),false);
 }finally{t.coordinator.reset();}
});
test('A new intentional request replaces a queued repair without replaying the rejected snapshot',()=>{
 const t=fixture();try{
  t.coordinator.replaceResponse(t.ticket);
  const next=t.coordinator.requestNextMove({id:'new-buyer',text:'Actually, please wait.',at:2});
  t.coordinator.responseDone('original');assert.equal(t.requests.length,2);
  assert.equal(t.requests[1].ticket,next);assert.equal(t.requests[1].continuation,false);
 }finally{t.coordinator.reset();}
});
