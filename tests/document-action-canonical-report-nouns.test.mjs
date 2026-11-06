import assert from 'node:assert/strict';
import test from 'node:test';
import {analyzeDocumentActionMeaning} from '../lib/document-product-evidence.ts';
import {assessReplyVerification} from '../lib/turn-verification-policy.ts';
import {checkSuggestion} from '../lib/call-purpose.ts';
import {LiveCoachingSession} from '../lib/live-coaching-session.ts';

// Authored fictional cases; canonical document nouns are not facts about
// availability, certification, or coverage. No customer data or API calls.
const companies=[{id:'crest',name:'Crest Field Components',person:'Nora',code:'KF47'},{id:'elm',name:'Elm River Instruments',person:'Theo',code:'ER59'}];
function fixture(company,report='quality report'){
 const turns=[{id:'pickup',role:'buyer',text:company.person+' speaking.',at:1},{id:'clarify',role:'you',text:'Could you confirm the drawing reference?',at:2},{id:'ref',role:'buyer',text:`Yes, ${company.code} is our drawing reference. I can email the drawing.`,at:3},{id:'scope',role:'buyer',text:`Only send the ${report} if it covers ${company.code}.`,at:4},{id:'approval',role:'buyer',text:'Do not send anything until our manager approves the drawing revision.',at:5}];
 return {callId:'authored-canonical-'+company.id,manufacturer:{id:company.id,name:company.name,products:'industrial sensor components'},sources:[{id:company.id+'-original',text:`${report}s are available for review.`,complete:true,original:true}],turns,currentStage:'solution_discussion',callType:'solution_discussion',callContext:{stageId:'solution_discussion',relationship:'first_contact',goal:'Help evaluate the drawing and respect document release conditions.'},coachingRequest:{id:'authored-canonical-click',requestedAt:6,transcriptState:'confirmed',listeningSession:{startedAt:1,currentTurnIds:turns.map(turn=>turn.id)}}};
}
function allowed(say,context){const check=assessReplyVerification(say,context);assert.deepEqual(check.unsupportedClaims,[]);assert.equal(check.requiresVerification,false);assert.equal(checkSuggestion({say},context).ok,true);}
const settle=async()=>{for(let n=0;n<5;n++)await new Promise(resolve=>setImmediate(resolve));};
for(const company of companies){
 for(const report of ['quality report','compliance report','quality test report']){
  const context=fixture(company,report);
  const forms=[
   `I'll check whether the ${report} covers ${company.code}. Once we have a match and your manager approves the drawing revision, I'll email that ${report}.`,
   `I'll check whether the ${report} covers ${company.code}, and once we have a match and your manager approves, I'll send it over.`,
   `If the ${report} covers ${company.code} and your manager approves, I'll send that ${report}.`,
  ];
  for(const say of forms)test(`${company.name}: canonical ${report} has the same closed release interpretation: ${say}`,()=>{
   const meaning=analyzeDocumentActionMeaning(say,context);assert.equal(meaning.delivery?.document,report);assert.deepEqual(meaning.delivery.approvals,['manager']);assert.equal(meaning.delivery.deliveryCondition,'stated_condition');allowed(say,context);
  });
 }
 const context=fixture(company),prefix=`I'll check whether the quality report covers ${company.code}. `,gate='Once we have a match and your manager approves';
 const unsafe=[
  `${prefix}${gate}, I'll email that quality report. The report guarantees suitability for your process.`,
  `The quality report covers ${company.code}. ${gate}, I'll email it.`,
  `${prefix}${gate}, I'll send that certification.`,
  `${prefix}${gate}, I'll send that certificate.`,
  `${prefix}${gate}, I'll send that inspection report.`,
  `${prefix}Once we have a match or your manager approves, I'll send that quality report.`,
  `${prefix}Once we have a match and you approve, I'll send that quality report.`,
  `${prefix}Once we've checked whether it covers ${company.code} and your manager approves, I'll send that quality report.`,
  `${prefix}${gate}, I'll send that quality report tomorrow.`,
  `${prefix}${gate}, I'll send that quality report and a certificate.`,
  `${prefix}${gate}, I'll send that quality report. We are certified for your application.`,
 ];
 for(const say of unsafe)test(`${company.name}: a recognized document noun does not establish an unsupported fact or permission: ${say}`,()=>{
  const assessment=assessReplyVerification(say,context);assert.ok(assessment.unsupportedClaims.length||assessment.requiresVerification);assert.equal(checkSuggestion({say},context,{factChecked:true}).ok,false);
 });
 test(`${company.name}: canonical recognition does not supply missing or unrelated availability`,()=>{
  const say=`${prefix}${gate}, I'll send that quality report.`;
  for(const sources of [[],[{id:'other-artifact',original:true,complete:true,text:'Inspection reports are available for review.'}],[{id:'unapproved',original:false,complete:true,text:'Quality reports are available for review.'}]]){
   const changed={...context,sources},assessment=assessReplyVerification(say,changed);assert.ok(assessment.unsupportedClaims.length||assessment.requiresVerification);assert.equal(checkSuggestion({say},changed,{factChecked:true}).ok,false);
  }
 });
 test(`${company.name}: quality-report first attempt publishes without another model/check and stays stable`,async()=>{
  const say=`${prefix}${gate}, I'll email that quality report. Looking forward to your drawing.`,sent=[],shown=[],traces=[];let remote=0;const noop=()=>{};
  const session=new LiveCoachingSession({initialTranscriptIds:[],snapshot:()=>context,latestContext:()=>context,send:event=>sent.push(event),onGuidance:(value,_id,_at,complete)=>{if(complete)shown.push(value.say);},onRequestTrace:event=>traces.push(event),onSuggestionIssue:noop,verify:async()=>{remote++;assert.fail('No redundant remote verification.');},fallback:async()=>assert.fail('No filler fallback.'),onBuyerTurn:noop,onAudioIssue:noop,onSupersede:noop,onPendingTurn:noop,onThinking:noop,onChecking:noop,onBuyerPartial:noop,onBuyerSpeech:noop,onBuyerPending:noop,onUsage:noop,onWarning:noop,onError:message=>assert.fail(message),fallbackAfterMs:10000});
  try{session.requestNextMove(context);const create=sent.find(event=>event.type==='response.create');assert.ok(create);assert.equal(create.response.instructions.includes(say),false);session.handle({type:'response.created',response:{id:'authored-quality-response',metadata:create.response.metadata}});session.handle({type:'response.output_text.delta',response_id:'authored-quality-response',delta:'SAY: '+say+'\nMOVE: Honor the report release conditions\n'});session.handle({type:'response.done',response:{id:'authored-quality-response',status:'completed'}});await settle();assert.deepEqual(shown,[say]);assert.equal(sent.filter(event=>event.type==='response.create').length,1);assert.equal(traces.filter(event=>event.event==='repair_requested').length,0);assert.equal(remote,0);}finally{session.stop();}
 });
}
