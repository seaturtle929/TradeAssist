import assert from 'node:assert/strict';
import test from 'node:test';
import {assessReplyVerification} from '../lib/turn-verification-policy.ts';
import {needsFactCheck} from '../lib/call-coaching.ts';
import {onDemandSuggestionProblems} from '../lib/on-demand-coaching.ts';

// Synthetic identity only; no saved company/customer material.
const context={manufacturer:{id:'synthetic-exporter',name:'Synthetic Mesh Export',products:'industrial mesh'},sources:[],turns:[
 {id:'rep',role:'you',text:"Hi, I'm Morgan with Synthetic Mesh Export."},
 {id:'pickup',role:'buyer',text:'One moment, hi Noor speaking.'},
],coachingRequest:{id:'synthetic-pickup',requestedAt:1}};

test('A personal introduction ending in the supplied company is not a product feature',()=>{
 const say='This is Morgan with Synthetic Mesh Export.';
 const result=assessReplyVerification(say,context);
 assert.deepEqual(result.claims,[]);
 assert.equal(result.requiresVerification,false);
 assert.equal(needsFactCheck(say,context),false);
 assert.ok(!onDemandSuggestionProblems(say,context).some(reason=>/representative name|personal name/i.test(reason)));
});

test('The narrow fact exemption does not authorize an invented rep name',()=>{
 assert.ok(onDemandSuggestionProblems('This is Taylor with Synthetic Mesh Export.',context).some(reason=>/not the verified representative name Morgan/.test(reason)));
 const unknown={...context,turns:context.turns.filter(turn=>turn.role!=='you')};
 assert.ok(onDemandSuggestionProblems('This is Morgan with Synthetic Mesh Export.',unknown).some(reason=>/No verified salesperson name/.test(reason)));
});

test('An appended supplier assertion remains subject to factual evidence',()=>{
 for(const say of [
  'This is Morgan with Synthetic Mesh Export, which guarantees superior quality.',
  'This is Morgan with Synthetic Mesh Export. Our products guarantee superior quality.',
  'This is a manufacturer with Synthetic Mesh Export.',
 ])assert.ok(assessReplyVerification(say,context).unsupportedClaims.length,say);
});
