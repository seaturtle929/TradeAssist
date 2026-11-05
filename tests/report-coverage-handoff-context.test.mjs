import assert from 'node:assert/strict';
import test from 'node:test';
import {onDemandDecisionRules,onDemandSuggestionProblems,onDemandTaskContext} from '../lib/on-demand-coaching.ts';
import {assessReplyVerification} from '../lib/turn-verification-policy.ts';
import {needsFactCheck} from '../lib/call-coaching.ts';
import {LiveCoachingSession} from '../lib/live-coaching-session.ts';

// Authored fictional current-call exchanges, not saved customer transcripts.
const companies=[{name:'Cedar Instruments',report:'inspection report'},{name:'Harbor Components',report:'material test report'}];
const make=({name,report})=>({manufacturer:{id:name,name,products:'industrial components'},sources:[{id:'documents',text:`Specification sheets and ${report}s are available.`}],turns:[{id:'question',role:'buyer',text:`Can you confirm whether the ${report} covers ZX72?`},{id:'clarify',role:'you',text:'Could you confirm the exact code?'},{id:'drawing',role:'buyer',text:'The part number is ZX72. I can email the drawing so you see the reference.'}],coachingRequest:{id:'authored-report-handoff',requestedAt:2,transcriptState:'confirmed',listeningSession:{startedAt:1,currentTurnIds:['question','clarify','drawing']}}});
for(const company of companies){
 test(`${company.name}: a code clarification plus drawing offer keeps the report question open`,()=>{
  const c=make(company),rules=onDemandDecisionRules(c),state=onDemandTaskContext(c).pendingReportCoverageHandoff;
  assert.equal(state.questionTurnId,'question');assert.match(rules,/UNANSWERED REPORT COVERAGE FIRST/);assert.doesNotMatch(rules,/compare the incoming requirements with those specs/);
  for(const say of ["Once I've reviewed it, I'll check if the specs align with our available components and let you know what we find.","We'll compare the drawing with our specs and tell you if we have a fit."])assert.ok(onDemandSuggestionProblems(say,c).some(reason=>/still-open report-coverage/.test(reason)),say);
 });
 test(`${company.name}: one click accepts the drawing for a bounded report-coverage check`,()=>{
  const c=make(company),say=`Please email the drawing. Once I've reviewed it, I'll check whether the ${company.report} covers your reference.`,sent=[],shown=[];let verifications=0;
  assert.deepEqual(assessReplyVerification(say,c).unsupportedClaims,[]);assert.equal(needsFactCheck(say,c),false);assert.deepEqual(onDemandSuggestionProblems(say,c),[]);
  const session=new LiveCoachingSession({snapshot:()=>c,latestContext:()=>c,send:event=>sent.push(event),onGuidance:value=>shown.push(value.say),verify:async()=>{verifications++;assert.fail('A bounded coverage check is not a positive coverage claim');},fallback:async()=>assert.fail('No fallback'),onBuyerTurn:()=>{},onBuyerPartial:()=>{},onBuyerSpeech:()=>{},onBuyerPending:()=>{},onSupersede:()=>{},onPendingTurn:()=>{},onThinking:()=>{},onChecking:()=>{},onUsage:()=>{},onWarning:()=>{},onError:message=>assert.fail(message),fallbackAfterMs:10000});
  try{session.requestNextMove(c);const event=sent.find(item=>item.type==='response.create');assert.ok(event);session.handle({type:'response.created',response:{id:'authored-report',metadata:event.response.metadata}});session.handle({type:'response.output_text.delta',response_id:'authored-report',delta:'SAY: '+say+'\nMOVE: Check the pending report coverage\n'});session.handle({type:'response.done',response:{id:'authored-report',status:'completed'}});assert.deepEqual(shown,[say]);assert.equal(verifications,0);assert.equal(sent.filter(item=>item.type==='response.create').length,1);}finally{session.stop();}
 });
 test(`${company.name}: an actual answer or withdrawal does not keep forcing the old report question`,()=>{
  for(const resolution of [{role:'you',text:`The ${company.report} covers ZX72.`},{role:'buyer',text:'Never mind the report question.'}]){const c=make(company);c.turns.splice(2,0,{id:'resolved',...resolution});c.coachingRequest.listeningSession.currentTurnIds.push('resolved');assert.equal(onDemandTaskContext(c).pendingReportCoverageHandoff,undefined);}
 });
 test(`${company.name}: a review prerequisite cannot hide positive or mixed substantive claims`,()=>{
  for(const tail of [`I'll confirm that the ${company.report} covers ZX72.`,`I'll check whether the ${company.report} covers ZX72. We can offer a 20% discount.`,`I'll check whether the ${company.report} covers ZX72, and it certifies medical suitability.`,`I'll send the ${company.report} tomorrow.`]){
   const result=assessReplyVerification("Once I've reviewed it, "+tail,make(company));assert.ok(result.requiresVerification||result.unsupportedClaims.length,tail);
  }
 });
}
