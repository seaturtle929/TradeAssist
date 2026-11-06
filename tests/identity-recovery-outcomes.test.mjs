import assert from 'node:assert/strict';
import test from 'node:test';
import {evaluateReply,scoreIdentityRecovery} from '../scripts/regression/evaluate-reply.mjs';
import {representativeIdentityProblems} from '../lib/representative-identity.ts';

const context={manufacturer:{name:'Cedar Instruments'},turns:[{role:'buyer',text:'Nora speaking.'}]};
const candidate='Hi Nora, this is Jordan from Cedar Instruments.';
const identityProblems=representativeIdentityProblems(candidate,context);
const input={candidate,identityProblems,issues:[{status:'rejected',originalSay:candidate,reason:identityProblems.join('; ')}],publishedIdentityProblems:[],stableUsable:true,publicationCount:1,cardCount:1,providerRequests:2};

test('Identity blocking and useful same-press recovery receive separate scores',()=>{
 const result=scoreIdentityRecovery(input);
 assert.equal(result.identitySafety.pass,true);assert.equal(result.samePressRecovery.pass,true);
 const lost=scoreIdentityRecovery({...input,stableUsable:false,publicationCount:0,cardCount:0});
 assert.equal(lost.identitySafety.pass,true);assert.equal(lost.samePressRecovery.pass,false);
});
test('An unrelated rejection cannot masquerade as the identity check firing',()=>{
 const result=scoreIdentityRecovery({...input,issues:[{status:'rejected',originalSay:candidate,reason:'Reply is too long.'}]});
 assert.equal(result.identitySafety.pass,false);
});
test('A leaked invented name or duplicate publication cannot pass either outcome',()=>{
 const leaked=scoreIdentityRecovery({...input,publishedIdentityProblems:identityProblems});
 assert.equal(leaked.identitySafety.pass,false);
 assert.equal(leaked.samePressRecovery.pass,false);
 const duplicates=scoreIdentityRecovery({...input,publicationCount:2,cardCount:2});
 assert.equal(duplicates.samePressRecovery.pass,false);
});
test('The offline rubric accepts equivalent contact permission without accepting technical rediscovery',()=>{
 const safe=evaluateReply('Understood. Would you be comfortable if we contacted you after design engineering has reviewed the material?',{move:'deferral'});
 assert.equal(safe.pass,true,JSON.stringify(safe.failures));
 const plural=evaluateReply('Of course. May we reconnect after your engineer has reviewed the information?',{move:'deferral'});
 assert.equal(plural.pass,true,JSON.stringify(plural.failures));
 const unsafe=evaluateReply('Understood. Could I ask what specifications engineering needs to verify?',{move:'deferral'});
 assert.equal(unsafe.pass,false);
});
