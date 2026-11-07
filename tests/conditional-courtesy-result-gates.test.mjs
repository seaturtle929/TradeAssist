import {assertLocalPressCompletion} from './helpers/local-press-assertions.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import {analyzeDocumentActionMeaning} from '../lib/document-product-evidence.ts';
import {assessReplyVerification} from '../lib/turn-verification-policy.ts';
import {checkSuggestion} from '../lib/call-purpose.ts';
import {LiveCoachingSession} from '../lib/live-coaching-session.ts';

// Authored fictional conversations; real validation/controller and SCRIPTED
// provider output. No saved customer/model transcripts or paid API calls.
const companies=[{id:'willow',name:'Willow Sensor Supply',person:'Maya',report:'inspection report',code:'VR72'},{id:'coral',name:'Coral Valve Exports',person:'Evan',report:'material test report',code:'CV93'}];
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function settle(){for(let n=0;n<5;n++)await tick();}
function fixture(company=companies[0],approval=false){
 const turns=[{id:'pickup',role:'buyer',text:company.person+' speaking.',at:1},{id:'question',role:'buyer',text:`Does the ${company.report} cover ${company.code}?`,at:2},{id:'clarify',role:'you',text:'Could you confirm the drawing reference?',at:3},{id:'confirm',role:'buyer',text:`Yes, ${company.code} is the reference on our drawing.`,at:4},{id:'handoff',role:'buyer',text:`I will email the drawing. Only send the ${company.report} if it covers ${company.code}.`,at:5}];
 if(approval)turns.push({id:'release',role:'buyer',text:'Do not send anything until I approve the drawing revision.',at:6});
 return {callId:'authored-structural-'+company.id,manufacturer:{id:company.id,name:company.name,products:'industrial components'},sources:[{id:company.id+'-documents',text:`Company profiles, specification sheets and ${company.report}s are available for review.`}],turns,callType:'solution_discussion',currentStage:'solution_discussion',callContext:{stageId:'solution_discussion',relationship:'first_contact',goal:'Respect the chosen evidence review and release conditions.'},coachingRequest:{id:'authored-structural-click',requestedAt:7,transcriptState:'confirmed',listeningSession:{startedAt:1,currentTurnIds:turns.map(turn=>turn.id)}}};
}
function transport(context){
 const log={sent:[],shown:[],traces:[],remote:0,fallback:0,errors:[]};let sequence=0;const noop=()=>{};
 const session=new LiveCoachingSession({initialTranscriptIds:[],snapshot:()=>context,latestContext:()=>context,send:value=>log.sent.push(value),onGuidance:(value,_id,_at,complete,_latency,trigger)=>{if(complete)log.shown.push({say:value.say,trigger});},onRequestTrace:event=>log.traces.push(event),onSuggestionIssue:noop,verify:async(_context,value)=>{log.remote++;return {...value,verified:false,verificationStatus:'rejected',caution:'No evidence for the added claim.'};},fallback:async()=>{log.fallback++;assert.fail('No generic fallback.');},onBuyerTurn:noop,onAudioIssue:noop,onSupersede:noop,onPendingTurn:noop,onThinking:noop,onChecking:noop,onBuyerPartial:noop,onBuyerSpeech:noop,onBuyerPending:noop,onUsage:noop,onWarning:noop,onError:message=>log.errors.push(message),fallbackAfterMs:10000});
 const creates=()=>log.sent.filter(event=>event.type==='response.create');
 const request=()=>session.requestNextMove(context);
 const respond=say=>{const create=creates().at(-1);assert.ok(create);const id='authored-structural-response-'+(++sequence);session.handle({type:'response.created',response:{id,metadata:create.response.metadata}});session.handle({type:'response.output_text.delta',response_id:id,delta:'SAY: '+say+'\nMOVE: Respect the conditional document action\n'});session.handle({type:'response.done',response:{id,status:'completed'}});};
 return {session,log,creates,request,respond};
}
async function firstAttempt(context,say){const t=transport(context);try{const assessment=assessReplyVerification(say,context);assert.deepEqual(assessment.unsupportedClaims,[]);assert.equal(assessment.requiresVerification,false);assert.equal(checkSuggestion({say},context).ok,true);t.request();assert.equal(t.creates()[0].response.instructions.includes(say),false,'The expected reply is not generation input.');t.respond(say);await settle();assert.deepEqual(t.log.shown,[{say,trigger:context.coachingRequest.id}]);assert.equal(t.creates().length,1);assert.equal(t.log.remote,0);assert.equal(t.log.fallback,0);}finally{t.session.stop();}}

for(const company of companies){
 for(const boundary of ['—',':',';'])test(`${company.name}: verified courtesy${boundary} keeps a complete fronted report condition`,async()=>{
  const context=fixture(company),say=`Thanks, ${company.person}${boundary} once we verify the ${company.report} covers ${company.code}, we'll send it along. We'll look out for your drawing.`;
  assert.equal(analyzeDocumentActionMeaning(say.split('. ')[0]+'.',context).delivery?.deliveryCondition,'stated_condition');await firstAttempt(context,say);
 });
 for(const suffix of ['', ' as requested', ' as agreed'])test(`${company.name}: one inquiry binds joint match AND approval before delivery${suffix}`,async()=>{
  const context=fixture(company,true),say=`We'll check whether the ${company.report} covers ${company.code} first, and once we have a match and you approve the drawing revision, we'll send it over${suffix}. Looking forward to your drawing.`;
  const meaning=analyzeDocumentActionMeaning(say.split('. ')[0]+'.',context);assert.equal(meaning.delivery?.deliveryCondition,'stated_condition');assert.ok(meaning.outgoing.every(action=>action.condition==='coverage_positive'&&action.approvals.includes('buyer')));await firstAttempt(context,say);
 });
 test(`${company.name}: unsupported first claim is blocked and the same click completes locally`,async()=>{
 const context=fixture(company,true),t=transport(context),bad=`The ${company.report} covers ${company.code}. We'll send it.`;
 try{t.request();t.respond(bad);await settle();assertLocalPressCompletion(t.log,t.creates(),bad);assert.equal(t.log.remote,0);}finally{t.session.stop();}
});
 const context=fixture(company,true),inquiry=`We'll check whether the ${company.report} covers ${company.code} first`,gate='once we have a match and you approve the drawing revision';
 const unsafe=[
  `Thanks, Avery—once we confirm the ${company.report} covers ${company.code}, we'll send it.`,
  `Thanks for confirming the ${company.report} covers ${company.code}—once we confirm the match, we'll send it.`,
  `The ${company.report} covers ${company.code}; once you approve, we'll send it.`,
  `${inquiry}, and once we have a match or you approve the drawing revision, we'll send it over.`,
  `${inquiry}, and once we have a match and your engineer approves the drawing revision, we'll send it over.`,
  `${inquiry}, and ${gate}, we'll review the drawing. We'll send the report.`,
  `${inquiry}, and ${gate}, we'll send it over and then email the report regardless.`,
  `${inquiry}, and once we've checked whether it matches and you approve, we'll send it over.`,
  `${inquiry}, and ${gate}, we'll send it over. We guarantee suitability for your process.`,
  `${inquiry}, and ${gate}, we'll send it over. Your shipment will leave tomorrow.`,
  `${inquiry}, and ${gate}, we'll send it over. We can give you a discount.`,
 ];
 for(const say of unsafe)test(`${company.name}: courtesy/joint-gate parsing retains every unsupported or broken action: ${say}`,()=>{
  const assessment=assessReplyVerification(say,context);assert.ok(assessment.unsupportedClaims.length||assessment.requiresVerification);assert.equal(checkSuggestion({say},context,{factChecked:true}).ok,false);
 });
 test(`${company.name}: as-agreed cannot manufacture a buyer request from availability and a question`,()=>{
  const noRequest=fixture(company,true);noRequest.turns=noRequest.turns.filter(turn=>turn.id!=='handoff');const say=`${inquiry}, and ${gate}, we'll send it over as agreed.`;
  assert.equal(analyzeDocumentActionMeaning(say,noRequest).delivery,undefined);assert.equal(checkSuggestion({say},noRequest,{factChecked:true}).ok,false);
  const withdrawn=fixture(company,true);withdrawn.turns.push({id:'withdrawn',role:'buyer',text:'Actually, forget the report request.',at:8});assert.equal(checkSuggestion({say},withdrawn,{factChecked:true}).ok,false);
  const declined=fixture(company,true);declined.turns.push({id:'declined',role:'buyer',text:"Could you send the company profile? I don't need the report.",at:8});assert.equal(analyzeDocumentActionMeaning(say,declined).delivery,undefined,'A profile request and separate report refusal cannot become report agreement.');
  const cancelled=fixture(company,true);cancelled.turns.push({id:'cancelled',role:'buyer',text:"Actually, please don't send any report.",at:8});assert.equal(analyzeDocumentActionMeaning(say,cancelled).delivery,undefined);
  const companyOffer=fixture(company,true);companyOffer.turns=companyOffer.turns.filter(turn=>turn.id!=='handoff');companyOffer.turns.push({id:'offer',role:'you',text:`I can send the ${company.report}.`,at:8});assert.equal(analyzeDocumentActionMeaning(say,companyOffer).delivery,undefined,'Our offer is not the buyer’s agreement.');
  const buyerOffer=fixture(company,true);buyerOffer.turns=buyerOffer.turns.filter(turn=>turn.id!=='handoff');buyerOffer.turns.push({id:'offer',role:'buyer',text:'I can email my report to you.',at:8});assert.equal(analyzeDocumentActionMeaning(say,buyerOffer).delivery,undefined,'The buyer’s own artifact is not a request for our report.');
 });
 test(`${company.name}: ambiguous report or reference cannot bind a nominal match`,()=>{
  const ambiguous={...context,sources:[...context.sources,{id:'other-report',text:'Quality test reports are available for review.'}]};
  for(const say of [`We'll check whether the ${company.report} and the quality test report cover ${company.code}, and ${gate}, we'll send it over.`,`We'll check whether the ${company.report} covers ${company.code} or NT84, and ${gate}, we'll send it over.`])assert.equal(analyzeDocumentActionMeaning(say,ambiguous).delivery,undefined);
 });
 test(`${company.name}: right-over wording stays outside the local closed proof`,()=>{
  const say=`I'll check whether the ${company.report} covers ${company.code}. If it does, I'll send it right over.`;
  const assessment=assessReplyVerification(say,fixture(company));assert.ok(assessment.requiresVerification||assessment.unsupportedClaims.length,'Do not broaden a direction parser to waive an unagreed immediacy cue.');
 });
}
