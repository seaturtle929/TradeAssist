import {assertLocalPressCompletion} from './helpers/local-press-assertions.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import {analyzeDocumentActionMeaning,documentActionGroups} from '../lib/document-product-evidence.ts';
import {assessReplyVerification} from '../lib/turn-verification-policy.ts';
import {checkSuggestion} from '../lib/call-purpose.ts';
import {LiveCoachingSession} from '../lib/live-coaching-session.ts';

// Authored fictional cases. Provider events are SCRIPTED after dispatch; the
// expected wording is not request context, and no model/API calls are made.
const companies=[
 {id:'meadow',name:'Meadow Process Components',contact:'Lina',code:'ZK74',other:'ZD29',report:'inspection report',otherReport:'material test report'},
 {id:'harbor',name:'Harbor Instrument Supply',contact:'Owen',code:'HT63',other:'HP28',report:'material test report',otherReport:'inspection report'},
];
const owners={buyer:{predicate:'you approve the drawing revision',request:'I approve the drawing revision'},engineering:{predicate:'your engineer approves the drawing revision',request:'our engineer approves the drawing revision'},manager:{predicate:'your manager approves the drawing revision',request:'our manager approves the drawing revision'}};
function fixture(company=companies[0],owner='buyer'){
 const turns=[{id:'pickup',role:'buyer',text:company.contact+' speaking.',at:1},{id:'inquiry',role:'buyer',text:`Does the ${company.report} cover ${company.code}?`,at:2},{id:'clarification',role:'you',text:'Could you confirm the drawing reference?',at:3},{id:'reference',role:'buyer',text:`Yes, ${company.code} is our drawing reference. I can email the drawing.`,at:4},{id:'other',role:'buyer',text:`I also asked about the ${company.otherReport} and the ${company.other} drawing reference.`,at:5},{id:'request',role:'buyer',text:`Only send the ${company.report} if it covers ${company.code}.`,at:6}];
 if(owner)turns.push({id:'permission',role:'buyer',text:`Do not send anything until ${owners[owner].request}.`,at:7});
 return {callId:'authored-prerequisite-'+company.id,manufacturer:{id:company.id,name:company.name,products:'industrial filter components'},sources:[{id:company.id+'-documents',text:`Inspection reports, material test reports, company profiles and specification sheets are available for review.`,original:true,complete:true}],turns,currentStage:'solution_discussion',callType:'solution_discussion',callContext:{stageId:'solution_discussion',relationship:'first_contact',goal:'Help the buyer evaluate the drawing and preserve their release conditions.'},coachingRequest:{id:'authored-prerequisite-click',requestedAt:10,transcriptState:'confirmed',listeningSession:{startedAt:1,currentTurnIds:turns.map(turn=>turn.id)}}};
}
const settle=async()=>{for(let n=0;n<5;n++)await new Promise(resolve=>setImmediate(resolve));};
function controller(context){
 const log={sent:[],shown:[],traces:[],remote:0,fallback:0,errors:[]};const noop=()=>{};let count=0;
 const session=new LiveCoachingSession({initialTranscriptIds:[],snapshot:()=>context,latestContext:()=>context,send:event=>log.sent.push(event),onGuidance:(value,_id,_at,complete,_latency,trigger)=>{if(complete)log.shown.push({say:value.say,trigger});},onRequestTrace:event=>log.traces.push(event),onSuggestionIssue:noop,verify:async(_context,value)=>{log.remote++;return {...value,verified:false,verificationStatus:'rejected',caution:'The added claim lacks evidence.'};},fallback:async()=>{log.fallback++;assert.fail('No generic filler fallback.');},onBuyerTurn:noop,onAudioIssue:noop,onSupersede:noop,onPendingTurn:noop,onThinking:noop,onChecking:noop,onBuyerPartial:noop,onBuyerSpeech:noop,onBuyerPending:noop,onUsage:noop,onWarning:noop,onError:message=>log.errors.push(message),fallbackAfterMs:10000});
 const creates=()=>log.sent.filter(event=>event.type==='response.create');
 const respond=say=>{const create=creates().at(-1);assert.ok(create);const id='authored-prerequisite-response-'+(++count);session.handle({type:'response.created',response:{id,metadata:create.response.metadata}});session.handle({type:'response.output_text.delta',response_id:id,delta:'SAY: '+say+'\nMOVE: Honor the document review prerequisites\n'});session.handle({type:'response.done',response:{id,status:'completed'}});};
 return {session,log,creates,respond};
}
async function acceptedFirst(context,say){
 const assessment=assessReplyVerification(say,context);assert.deepEqual(assessment.unsupportedClaims,[]);assert.equal(assessment.requiresVerification,false);assert.equal(checkSuggestion({say},context).ok,true);
 const t=controller(context);try{t.session.requestNextMove(context);assert.equal(t.creates()[0].response.instructions.includes(say),false);t.respond(say);await settle();assert.deepEqual(t.log.shown,[{say,trigger:context.coachingRequest.id}]);assert.equal(t.creates().length,1);assert.equal(t.log.remote,0);assert.equal(t.log.fallback,0);}finally{t.session.stop();}
}
for(const company of companies){
 for(const owner of Object.keys(owners)){
  const context=fixture(company,owner),approval=owners[owner].predicate;
  for(const separator of ['. ', '; ', ', and ', ': ', ' — ', ' – '])test(`${company.name}: ${separator.trim()} preserves inquiry, positive match AND ${owner} approval`,async()=>{
   const say=`We'll check whether the ${company.report} covers ${company.code}${separator}Once we have a match and ${approval}, we'll email it.`;
   const meaning=analyzeDocumentActionMeaning(say,context);assert.equal(meaning.delivery?.deliveryCondition,'stated_condition');assert.equal(meaning.delivery.document,company.report);assert.deepEqual(meaning.outgoing.map(action=>[action.condition,action.approvals]),[['coverage_positive',[owner]]]);assert.equal(documentActionGroups(say,context).length,1);await acceptedFirst(context,say);
  });
  for(const prefix of ['',`I'll check whether the ${company.report} covers ${company.code}. `])test(`${company.name}: explicit named predicate binds named send with ${owner} approval despite prior other report${prefix?' and inquiry':''}`,async()=>{
   const say=`${prefix}If the ${company.report} covers ${company.code} and ${approval}, I'll send that ${company.report}.`;
   const meaning=analyzeDocumentActionMeaning(say,context);assert.equal(meaning.delivery?.document,company.report);assert.deepEqual(meaning.delivery?.approvals,[owner]);await acceptedFirst(context,say);
  });
 }
 test(`${company.name}: no approval is invented when only positive coverage is required`,async()=>{
  const context=fixture(company,null),say=`I'll check whether the ${company.report} covers ${company.code}. Once we have a match, I'll email it.`;
  assert.deepEqual(analyzeDocumentActionMeaning(say,context).delivery?.approvals,[]);await acceptedFirst(context,say);
 });
 test(`${company.name}: unknown coverage and pending drawing remain unknown after a safe action`,async()=>{
  const context=fixture(company),before=JSON.stringify(context),say=`I'll check whether the ${company.report} covers ${company.code}. If the ${company.report} covers ${company.code} and you approve, I'll send that ${company.report}. Looking forward to your drawing.`;
  await acceptedFirst(context,say);assert.equal(JSON.stringify(context),before);assert.equal(context.sources.some(source=>source.text.includes(company.code)),false);
 });
 test(`${company.name}: punctuation grouping retains literal offsets and independent assertions`,()=>{
  const context=fixture(company),safe=`I'll check whether the ${company.report} covers ${company.code}. Once we have a match and you approve, I'll email it.`,text=`${safe} The opening is 0.425 mm. Email quality@example.invalid. We'll send the other report.`;
  const groups=documentActionGroups(text,context);assert.equal(groups[0].text,safe);assert.equal(groups.length,4);for(const group of groups)assert.equal(text.slice(group.start,group.end),group.text);assert.ok(groups.some(group=>group.text.includes('0.425')));assert.ok(groups.some(group=>group.text.includes('quality@example.invalid')));assert.equal(analyzeDocumentActionMeaning(groups.at(-1).text,context).outgoing[0].condition,'unparsed');
 });
 const context=fixture(company),inquiry=`I'll check whether the ${company.report} covers ${company.code}. `,gate=`Once we have a match and you approve the drawing revision`,unsafe=[
  `${inquiry}Once we've checked whether it matches and you approve, I'll email it.`,
  `${inquiry}Once we have a match or you approve, I'll email it.`,
  `${inquiry}Once we have a match, I'll email it.`,
  `${inquiry}Once you approve, I'll email it.`,
  `${inquiry}Once we have a match and your engineer approves, I'll email it.`,
  `${inquiry}${gate}, I'll review the drawing. I'll email the report.`,
  `${inquiry}${gate}, I'll email it. I'll send the report regardless.`,
  `${inquiry}If the ${company.report} covers ${company.other} and you approve, I'll send that ${company.report}.`,
  `${inquiry}If the ${company.otherReport} covers ${company.code} and you approve, I'll send that ${company.report}.`,
  `${inquiry}If the ${company.report} covers ${company.code} and you approve, I'll send the ${company.otherReport}.`,
  `${inquiry}${gate}, I'll email it. It guarantees suitability for your process.`,
  `${inquiry}${gate}, I'll email it tomorrow.`,
  `The ${company.report} covers ${company.code}; ${gate}, I'll email it.`,
  `Thanks for confirming the ${company.report} covers ${company.code}—${gate}, I'll email it.`,
  `The ${company.report} covers ${company.code}: ${gate}, I'll email it.`,
  `The ${company.report} covers ${company.code} — ${gate}, I'll email it.`,
  `${inquiry}The other report is certified. ${gate}, I'll email it.`,
  `I'll check whether the ${company.report} and the ${company.otherReport} cover ${company.code}. ${gate}, I'll email it.`,
 ];
 for(const say of unsafe)test(`${company.name}: scope and every required prerequisite survive: ${say}`,()=>{
  const assessment=assessReplyVerification(say,context);assert.ok(assessment.unsupportedClaims.length||assessment.requiresVerification);assert.equal(checkSuggestion({say},context,{factChecked:true}).ok,false);
 });
 test(`${company.name}: a rejected weakened gate gets one local stable answer`,async()=>{
 const t=controller(context),bad=`${inquiry}Once we've checked whether it matches and you approve, I'll email it.`;try{t.session.requestNextMove(context);t.respond(bad);await settle();const spoken=assertLocalPressCompletion(t.log,t.creates(),bad);assert.equal(t.log.remote,0);t.session.handle({type:'response.output_text.delta',response_id:'retired-response',delta:'SAY: Replace this\n'});await settle();assert.equal(t.log.shown[0].say,spoken);}finally{t.session.stop();}
});
 test(`${company.name}: late unsafe text cannot replace the local completion`,async()=>{
 const t=controller(context),bad=`${inquiry}Once we've checked whether it matches and you approve, I'll email it.`;try{t.session.requestNextMove(context);t.respond(bad);await settle();const spoken=assertLocalPressCompletion(t.log,t.creates(),bad);t.respond(bad);await settle();assert.equal(t.log.shown.length,1);assert.equal(t.log.shown[0].say,spoken);assert.equal(t.creates().length,1);}finally{t.session.stop();}
});
}
