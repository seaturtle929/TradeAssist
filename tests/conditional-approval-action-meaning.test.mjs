import assert from 'node:assert/strict';
import test from 'node:test';
import {analyzeDocumentActionMeaning} from '../lib/document-product-evidence.ts';
import {assessReplyVerification,buyerReleaseState} from '../lib/turn-verification-policy.ts';
import {checkSuggestion} from '../lib/call-purpose.ts';
import {LiveCoachingSession} from '../lib/live-coaching-session.ts';

// Authored fictional cases only. Real parsers/controller, scripted provider
// output after dispatch, no paid requests or measured speech latency.
const companies=[{id:'maple',name:'Maple Precision Export',code:'KD64',report:'material test report'},{id:'silver',name:'Silverline Components',code:'PV927',report:'inspection report'}];
const approvers=[{role:'buyer',buyer:'I approve',reply:'you approve',noun:'your approval'},{role:'engineering',buyer:'my engineer approves',reply:'your engineer approves',noun:"your engineer's approval"},{role:'manager',buyer:'my manager approves',reply:'your manager approves',noun:"your manager's approval"}];
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function settle(){for(let n=0;n<5;n++)await tick();}
function fixture(company=companies[0],approver=approvers[0]){
 const turns=[{id:'scope',role:'buyer',text:`Does the ${company.report} cover ${company.code}?`,at:1},{id:'confirm',role:'you',text:'Could you confirm the drawing reference?',at:2},{id:'spelling',role:'buyer',text:`Yes, ${company.code} is our drawing reference.`,at:3},{id:'drawing',role:'buyer',text:`I will email the drawing. Only send the ${company.report} if it covers ${company.code}.`,at:4},{id:'approval',role:'buyer',text:`Do not send anything until ${approver.buyer} the drawing revision.`,at:5}];
 return {callId:'authored-approval-'+company.id,manufacturer:{id:company.id,name:company.name,products:'precision components'},sources:[{id:company.id+'-documents',text:`Specification sheets and ${company.report}s are available for review.`}],turns,callType:'solution_discussion',currentStage:'solution_discussion',callContext:{stageId:'solution_discussion',relationship:'first_contact',goal:'Respect the buyer’s evidence and release requirements.'},coachingRequest:{id:'authored-approval-press',requestedAt:6,transcriptState:'confirmed',listeningSession:{startedAt:1,currentTurnIds:turns.map(turn=>turn.id)}}};
}
const safe=(company,approver)=>`I'll check whether the ${company.report} covers ${company.code} and send it only if it does and ${approver.reply}. Looking forward to your drawing.`;
function transport(context){
 const log={sent:[],shown:[],traces:[],errors:[],remote:0,fallback:0};let serial=0;
 const noop=()=>{};const session=new LiveCoachingSession({initialTranscriptIds:[],snapshot:()=>context,latestContext:()=>context,send:event=>log.sent.push(event),onGuidance:(value,_id,_at,complete,_latency,trigger)=>{if(complete)log.shown.push({say:value.say,trigger});},onRequestTrace:event=>log.traces.push(event),onSuggestionIssue:noop,verify:async(_context,value)=>{log.remote++;return {...value,verified:false,verificationStatus:'rejected',caution:'The fictional source does not support that claim.'};},fallback:async()=>{log.fallback++;assert.fail('A generic filler is not successful release-condition recovery.');},onBuyerTurn:noop,onAudioIssue:noop,onSupersede:noop,onPendingTurn:noop,onThinking:noop,onChecking:noop,onBuyerPartial:noop,onBuyerSpeech:noop,onBuyerPending:noop,onUsage:noop,onWarning:noop,onError:message=>log.errors.push(message),fallbackAfterMs:10000});
 const creates=()=>log.sent.filter(event=>event.type==='response.create');
 const request=()=>session.requestNextMove(context);
 const respond=say=>{const create=creates().at(-1);assert.ok(create);const id='authored-approval-response-'+(++serial);session.handle({type:'response.created',response:{id,metadata:create.response.metadata}});session.handle({type:'response.output_text.delta',response_id:id,delta:'SAY: '+say+'\nMOVE: Keep coverage and approval requirements\n'});session.handle({type:'response.done',response:{id,status:'completed'}});};
 return {session,log,creates,request,respond};
}

for(const company of companies)for(const approver of approvers){
 const variations=[safe(company,approver),`Once ${approver.reply} the drawing revision, I'll send the ${company.report} only if it covers ${company.code}. I'll check its coverage when your drawing arrives.`,`I'll send the ${company.report} only if it covers ${company.code} and I have ${approver.noun}.`];
 for(const [index,say]of variations.entries())test(`${company.name}/${approver.role}: closed conjunctive release form${index+1} publishes first attempt`,async()=>{
  const context=fixture(company,approver),first=say.split(/(?<=[.!?])\s+/)[0],meaning=analyzeDocumentActionMeaning(first,context),t=transport(context);
  try{
   assert.equal(meaning.delivery?.deliveryCondition,'stated_condition');assert.ok(meaning.outgoing.length);assert.ok(meaning.outgoing.every(action=>action.condition==='coverage_positive'&&action.approvals.includes(approver.role)));
   const assessment=assessReplyVerification(say,context);assert.deepEqual(assessment.unsupportedClaims,[]);assert.equal(assessment.requiresVerification,false);assert.equal(checkSuggestion({say},context).ok,true);
   t.request();assert.equal(t.creates()[0].response.instructions.includes(say),false,'The answer is not supplied as a generation example.');t.respond(say);await settle();assert.deepEqual(t.log.shown,[{say,trigger:context.coachingRequest.id}]);assert.equal(t.creates().length,1);assert.equal(t.log.traces.filter(event=>event.event==='repair_requested').length,0);assert.equal(t.log.remote,0);assert.equal(t.log.fallback,0);
  }finally{t.session.stop();}
 });
 test(`${company.name}/${approver.role}: wrong approver blocked then one bounded same-press repair`,async()=>{
  const context=fixture(company,approver),wrong=approvers.find(value=>value.role!==approver.role),bad=safe(company,wrong),good=safe(company,approver),t=transport(context);
  try{
   assert.equal(checkSuggestion({say:bad},context,{factChecked:true}).ok,false);
   t.request();t.respond(bad);await settle();assert.deepEqual(t.log.shown,[]);assert.equal(t.creates().length,2);
   t.respond(good);await settle();assert.deepEqual(t.log.shown,[{say:good,trigger:context.coachingRequest.id}]);assert.equal(t.creates().length,2);assert.equal(t.log.traces.filter(event=>event.event==='repair_requested').length,1);assert.equal(t.log.remote,0);assert.equal(t.log.fallback,0);
  }finally{t.session.stop();}
 });
}

for(const company of companies){
 const approver=approvers[0],context=fixture(company,approver),base=safe(company,approver);
 const unsafe=[
  `I'll check whether the ${company.report} covers ${company.code} and send it if it does or you approve.`,
  `Once I've checked whether the ${company.report} covers ${company.code}, I'll send it after you approve.`,
  `Once you approve the drawing revision, I'll review it. I'll send the ${company.report} only if it covers ${company.code}.`,
  `I'll check whether the ${company.report} covers ${company.code} and send it only if it does and you approve. I'll email the report regardless.`,
  `The ${company.report} covers ${company.code}. I'll send it after you approve.`,
  `I have your approval. I'll send the ${company.report} only if it covers ${company.code}.`,
  base+' We guarantee suitability for your process.',
  base+' We will ship your order tomorrow.',
  `Once you approve the drawing revision, I'll send the ${company.report} only if it covers ${company.code}, and I'll give you a discount.`,
 ];
 for(const say of unsafe)test(`${company.name}: attached approval cannot hide another failed condition: ${say}`,()=>{
  const result=assessReplyVerification(say,context);assert.ok(result.unsupportedClaims.length||result.requiresVerification,'Ambiguous or unsupported meaning cannot inherit the closed approval proof.');assert.equal(checkSuggestion({say},context,{factChecked:true}).ok,false);
 });
 test(`${company.name}: original company release restriction survives both buyer conditions`,()=>{
  const restricted={...context,sources:[{id:company.id+'-restricted',text:`The ${company.report} requires company release approval.`}]};
  const assessment=assessReplyVerification(base,restricted);assert.ok(assessment.unsupportedClaims.length||assessment.requiresVerification);assert.equal(checkSuggestion({say:base},restricted,{factChecked:true}).ok,false);
 });
 test(`${company.name}: two failed gate corrections end unavailable, not generic filler`,async()=>{
  const t=transport(context);try{t.request();t.respond(unsafe[0]);await settle();assert.equal(t.creates().length,2);t.respond(unsafe[1]);await settle();assert.deepEqual(t.log.shown,[]);assert.equal(t.creates().length,2);assert.equal(t.log.traces.filter(event=>event.event==='failed').length,1);assert.equal(t.log.fallback,0);}finally{t.session.stop();}
 });
}

test('Drawing offers do not invent completed approval or company authority',()=>{
 const context=fixture();context.turns=context.turns.filter(turn=>turn.id!=='approval');
 const release=buyerReleaseState(context);assert.equal(release.approval,false);assert.equal(release.scope,true);
 const asserted="I've got your approval. I'll send the material test report now.";assert.equal(checkSuggestion({say:asserted},context,{factChecked:true}).ok,false,'The buyer’s drawing offer is not a positive coverage result or a release.');
});
