import {assertLocalPressCompletion} from './helpers/local-press-assertions.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import {immediateDocumentDispatchClaims} from '../lib/document-dispatch-timing.ts';
import {unapprovedResponseDeadline} from '../lib/call-coaching.ts';
import {analyzeDocumentActionMeaning} from '../lib/document-product-evidence.ts';
import {assessReplyVerification} from '../lib/turn-verification-policy.ts';
import {onDemandSuggestionProblems} from '../lib/on-demand-coaching.ts';
import {checkSuggestion} from '../lib/call-purpose.ts';
import {LiveCoachingSession} from '../lib/live-coaching-session.ts';

// Authored fictional examples, scripted provider events after dispatch. No
// saved call, API, browser data, expected answer or rubric in generation input.
const companies=[{id:'alder',name:'Alder Gauge Supply',person:'Sienna',report:'inspection report',code:'QH82'},{id:'cobalt',name:'Cobalt Meter Components',person:'Rowan',report:'material test report',code:'CM67'}];
function fixture(company){
 const turns=[{id:'pickup',role:'buyer',text:company.person+' speaking.',at:1},{id:'question',role:'buyer',text:`Does the ${company.report} cover ${company.code}?`,at:2},{id:'clarify',role:'you',text:'Could you confirm the drawing reference?',at:3},{id:'confirm',role:'buyer',text:`Yes, ${company.code} is our drawing reference.`,at:4},{id:'handoff',role:'buyer',text:`I'll email the drawing. Only send the ${company.report} if it covers ${company.code}.`,at:5}];
 return {callId:'authored-dispatch-'+company.id,manufacturer:{id:company.id,name:company.name,products:'industrial measurement components'},sources:[{id:company.id+'-docs',text:`Company profiles, specifications and ${company.report}s are available for review.`,original:true,complete:true}],turns,callType:'solution_discussion',currentStage:'solution_discussion',callContext:{stageId:'solution_discussion',relationship:'first_contact',goal:'Respect the agreed evidence check and document handoff.'},coachingRequest:{id:'authored-dispatch-click',requestedAt:6,transcriptState:'confirmed',listeningSession:{startedAt:1,currentTurnIds:turns.map(turn=>turn.id)}}};
}
const settle=async()=>{for(let i=0;i<6;i++)await new Promise(resolve=>setImmediate(resolve));};
async function replay(context,candidates){
 const sent=[],shown=[],traces=[];let consumed=0;const noop=()=>{};
 const session=new LiveCoachingSession({initialTranscriptIds:[],snapshot:()=>context,latestContext:()=>context,send:event=>sent.push(event),onGuidance:(value,_id,_at,complete,_latency,trigger)=>{if(complete)shown.push({say:value.say,trigger});},onRequestTrace:event=>traces.push(event),onSuggestionIssue:noop,verify:async()=>assert.fail('No remote verification of a local timing violation or neutral document handoff.'),fallback:async()=>assert.fail('No generic filler.'),onBuyerTurn:noop,onAudioIssue:noop,onSupersede:noop,onPendingTurn:noop,onThinking:noop,onChecking:noop,onBuyerPartial:noop,onBuyerSpeech:noop,onBuyerPending:noop,onUsage:noop,onWarning:noop,onError:noop,fallbackAfterMs:10000});
 try{session.requestNextMove(context);for(const [index,say]of candidates.entries()){const create=sent.filter(event=>event.type==='response.create')[consumed++];assert.ok(create);if(index===0)assert.equal(create.response.instructions.includes(say),false);else assert.equal(create.response.instructions.includes(candidates[index-1]),true,'A repair must receive the actual rejected draft.');const id='authored-dispatch-'+index;session.handle({type:'response.created',response:{id,metadata:create.response.metadata}});session.handle({type:'response.output_text.delta',response_id:id,delta:'SAY: '+say+'\nMOVE: Keep the agreed conditional handoff\n'});session.handle({type:'response.done',response:{id,status:'completed'}});await settle();}return {shown,traces,generations:sent.filter(event=>event.type==='response.create').length};}finally{session.stop();}
}
for(const company of companies){
 const context=fixture(company),conditional=`Once we confirm the ${company.report} covers ${company.code}, we'll send it`,safe=`Thanks, ${company.person}. ${conditional} over. Looking forward to your drawing.`,timed=`Thanks, ${company.person}. ${conditional} right over. Looking forward to your drawing.`;
 test(`${company.name}: recognize the coverage condition while rejecting only the attached unagreed speed`,()=>{
  const part=timed.split('. ')[1],meaning=analyzeDocumentActionMeaning(part,context),assessment=assessReplyVerification(timed,context);
  assert.equal(meaning.checksCoverage,true);assert.equal(meaning.delivery?.deliveryCondition,'stated_condition');
  assert.deepEqual(onDemandSuggestionProblems(timed,context),[],'A timing issue must not become a false missing-coverage diagnostic.');
  assert.ok(assessment.unsupportedClaims.some(claim=>claim.kind==='timing'&&/prompt dispatch/.test(claim.reason)));
  assert.equal(assessment.unsupportedClaims.some(claim=>/no matching company fact|positive report match|scope.*absent/i.test(claim.reason)),false);
  assert.equal(unapprovedResponseDeadline(timed,context),true);assert.equal(checkSuggestion({say:timed},context).ok,false);
 });
 test(`${company.name}: neutral direction and courtesy publish unchanged on the first attempt`,async()=>{
  assert.equal(unapprovedResponseDeadline(safe,context),false);assert.deepEqual(assessReplyVerification(safe,context).unsupportedClaims,[]);assert.equal(assessReplyVerification(safe,context).requiresVerification,false);
  const result=await replay(context,[safe]);assert.deepEqual(result.shown,[{say:safe,trigger:context.coachingRequest.id}]);assert.equal(result.generations,1);assert.equal(result.traces.some(event=>event.event==='repair_requested'),false);
 });
 test(`${company.name}: unsupported timing is blocked and the same press completes locally`,async()=>{
 const result=await replay(context,[timed]);assertLocalPressCompletion(result,Array.from({length:result.generations}),timed);
});
 test(`${company.name}: an unsupported timing draft cannot create another remote repair`,async()=>{
 const result=await replay(context,[timed]);assertLocalPressCompletion(result,Array.from({length:result.generations}),timed);
});
 for(const verb of ['send','email','forward','share'])test(`${company.name}: ${verb} speed is attached to its actual object and remains separate from source claims`,()=>{
  const say=`If the ${company.report} covers ${company.code}, I'll ${verb} that ${company.report} right over to you.`;
  assert.equal(immediateDocumentDispatchClaims(say).length,1);assert.ok(assessReplyVerification(say,context).unsupportedClaims.some(claim=>claim.kind==='timing'));
  const assertion=`The ${company.report} covers ${company.code}. I'll ${verb} it right over.`;
  const check=assessReplyVerification(assertion,context);assert.ok(check.unsupportedClaims.some(claim=>claim.kind==='timing'));assert.ok(check.unsupportedClaims.some(claim=>claim.kind!=='timing'));
 });
 test(`${company.name}: buyer's own deadline cannot authorize a rep's speed assurance`,()=>{
  const changed={...context,turns:[...context.turns,{id:'buyer-date',role:'buyer',text:"I'll send the drawing today.",at:7}]};assert.equal(unapprovedResponseDeadline(timed,changed),true);
 });
 for(const prerequisite of ["Once we get the drawing", "After we've got your drawing", 'When we receive your drawing'])test(`${company.name}: ${prerequisite} is a pending-input condition, not an asserted supplier result`,()=>{
  const say=`${prerequisite}, we'll check the coverage.`,assessment=assessReplyVerification(say,context);
  assert.deepEqual(assessment.unsupportedClaims,[]);assert.equal(assessment.requiresVerification,false);
  const mixed=assessReplyVerification(say+' It guarantees suitability for your application.',context);assert.ok(mixed.unsupportedClaims.length);
 });
 test(`${company.name}: permission grammar cannot conceal an asserted document guarantee`,()=>{
  const bad=`Can I forward the ${company.report} that guarantees suitability for your process?`;
  assert.ok(assessReplyVerification(bad,context).unsupportedClaims.length);assert.equal(checkSuggestion({say:bad},context,{factChecked:true}).ok,false);
  const content='Can I email the company profile that proves our products are superior?';assert.ok(assessReplyVerification(content,context).unsupportedClaims.length);
  const question=`Does the ${company.report} guarantee suitability for your process?`;assert.equal(assessReplyVerification(question,context).unsupportedClaims.some(claim=>/supplier assertion|Supplier capability/.test(claim.reason)),false,'Asking whether is different from presupposing the answer.');
 });
}
for(const say of ["The report is right over there.","I'll move forward with the discussion about the report.","Could you forward the report right over?","I'll forward the report to the office right over there.","I'll forward the report over to you.","We won't send the report right over.","Our trainer said, 'I'll send the report right over.'"])
 test(`Only an actual rep dispatch can acquire a speed commitment: ${say}`,()=>assert.deepEqual(immediateDocumentDispatchClaims(say),[]));
