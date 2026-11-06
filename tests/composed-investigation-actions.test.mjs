import assert from 'node:assert/strict';
import test from 'node:test';
import {assessReplyVerification} from '../lib/turn-verification-policy.ts';
import {checkSuggestion} from '../lib/call-purpose.ts';
import {LiveCoachingSession} from '../lib/live-coaching-session.ts';

// Authored fictional conversation fixtures. Provider output is scripted;
// these tests measure publication correctness, not live-model speed.
const companies=[{name:'Juniper Controls',report:'inspection report',reference:'QZ73'},{name:'Willow Fabrication',report:'material test report',reference:'NT62'}];
function fixture({name,report,reference},conditional=false){
 const turns=[{id:'pickup',role:'buyer',text:'Jordan speaking.'},{id:'scope',role:'buyer',text:`Does the ${report} cover ${reference}?`},{id:'rep',role:'you',text:'Could you spell that reference?'},{id:'drawing',role:'buyer',text:`It is ${reference}, my drawing reference. I can email the drawing.${conditional?' Please reply with the report only if it covers that reference.':''}`}];
 return {manufacturer:{id:name,name,products:'industrial parts'},sources:[{id:'available',original:true,complete:true,text:`Company profiles, specification sheets and ${report}s are available.`}],turns,coachingRequest:{id:'authored-composition',requestedAt:2,transcriptState:'confirmed',listeningSession:{startedAt:1,currentTurnIds:turns.map(turn=>turn.id)}}};
}
function safeLines({report,reference}){return [
 `Thanks, Jordan. Please go ahead and email your drawing, and then I'll check the ${report} to confirm whether it covers ${reference}.`,
 `Thank you for your offer, Jordan. If you email the drawing, I'll review it and confirm whether the ${report} covers ${reference}.`,
 `Once we've reviewed your drawing against the ${report}, we'll confirm whether the report covers ${reference} and reply with it if it does.`,
 `I'll confirm whether the ${report} actually covers ${reference} once I review your drawing. Then if it does, I'll reply with the report.`,
 `Once we've checked that the ${report} covers ${reference}, we'll reply with it. We'll look out for your drawing.`,
 `I'll review that ${report} to find out whether it includes ${reference}, and I'll reply with it only if it does.`,
 ];}
for(const company of companies){
 for(const [index,say] of safeLines(company).entries())test(`${company.name}: composed inquiry ${index+1} is locally safe without losing its wording`,async()=>{
  const context=fixture(company,index>=2),assessment=assessReplyVerification(say,context);
  assert.deepEqual(assessment.unsupportedClaims,[]);assert.deepEqual(assessment.pendingClaims,[]);assert.equal(assessment.requiresVerification,false);assert.equal(assessment.sanitizedReply,say);
  assert.equal(checkSuggestion({say},context).ok,true);
  const sent=[],shown=[],traces=[];
  const session=new LiveCoachingSession({snapshot:()=>context,latestContext:()=>context,send:event=>sent.push(event),onGuidance:guidance=>shown.push(guidance.say),onRequestTrace:event=>traces.push(event),verify:async()=>assert.fail('A closed ordinary investigation needs no remote check.'),fallback:async()=>assert.fail('No fallback'),onBuyerTurn:()=>{},onBuyerPartial:()=>{},onBuyerSpeech:()=>{},onBuyerPending:()=>{},onSupersede:()=>{},onPendingTurn:()=>{},onThinking:()=>{},onChecking:()=>{},onUsage:()=>{},onWarning:()=>{},onError:()=>{},fallbackAfterMs:10000});
  try{session.requestNextMove(context);const create=sent.find(event=>event.type==='response.create');assert.ok(create);session.handle({type:'response.created',response:{id:'composition',metadata:create.response.metadata}});session.handle({type:'response.output_text.delta',response_id:'composition',delta:'SAY: '+say+'\nMOVE: Honor the drawing handoff\n'});session.handle({type:'response.done',response:{id:'composition',status:'completed'}});await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(shown,[say]);assert.equal(sent.filter(event=>event.type==='response.create').length,1);assert.equal(traces.filter(event=>event.event==='repair_requested').length,0);}finally{session.stop();}
 });
 test(`${company.name}: an inquiry cannot hide a coverage claim, unauthorized promise or lost condition`,()=>{
  const {report,reference}=company,context=fixture(company,true);
  for(const say of [
   `The ${report} covers ${reference}.`,
   `Thanks for confirming the ${report} covers ${reference}.`,
   `Thank you for your certified ${report} offer. I'll check whether it covers ${reference}.`,
   `We have a ${report} for ${reference}, and I'll check the details.`,
   `If you email the drawing, I'll review it and confirm whether the ${report} covers our ${reference}.`,
   `I'll check the ${report} to confirm whether it covers ${reference}, which is certified for medical use.`,
   `Once we've reviewed your drawing against the ${report}, we'll confirm whether the report covers ${reference} and ship tomorrow.`,
   `I'll check the ${report} to confirm whether it covers ${reference} and offer a 15% discount.`,
   `I'll confirm whether the ${report} actually covers ${reference} once I review your drawing. Then I'll send the report regardless.`,
   `I'll confirm whether the ${report} covers ${reference}. Once we've checked it, we'll send it.`,
   `If you email the drawing, I'll review it and confirm that the ${report} covers ${reference}.`,
  ])assert.ok(assessReplyVerification(say,context).unsupportedClaims.length,say);
  const safe=safeLines(company)[2];
  for(const restricted of [
   {...context,sources:[{id:'restricted',text:`The ${report} is available only after manager approval.`}]},
   {...context,turns:[...context.turns,{id:'hold',role:'buyer',text:'Actually, do not send anything until my engineer approves.'}]},
   {...context,turns:[...context.turns,{id:'hold',role:'buyer',text:'Actually, do not send the report yet.'}]},
  ])assert.ok(assessReplyVerification(safe,restricted).unsupportedClaims.length,'Document availability and current buyer release authority remain independent checks.');
 });
 test(`${company.name}: local inquiry proof cannot substitute a similar drawing reference`,()=>{
  const context=fixture(company,true),good=safeLines(company)[2],wrong=good.replace(company.reference,company.reference.slice(0,-1)+'9');
  const rejected=checkSuggestion({say:wrong},context,{factChecked:true});
  assert.equal(rejected.ok,false,'Even an approving remote verdict cannot authorize a changed buyer reference.');assert.match(rejected.reasons.join(' '),/complete confirmed drawing\/product reference/);
  const wrongKnown={...context,sources:[...context.sources,{id:'other-item',text:`${company.reference.slice(0,-1)+'9'} is a company catalogue item.`}]};assert.equal(checkSuggestion({say:wrong},wrongKnown,{factChecked:true}).ok,false,'A catalogue item is not the buyer’s confirmed reference.');
  assert.equal(checkSuggestion({say:good},context).ok,true);
  const dash=good.replace(company.reference,company.reference.replace(/(\D)(\d)/,'$1-$2'));assert.equal(checkSuggestion({say:dash},context).ok,true,'Only typography of the confirmed complete identifier changes.');
  const next=company.reference.slice(0,-1)+'8',corrected={...context,turns:[...context.turns,{id:'correction',role:'buyer',text:`Actually, that was the old drawing code. The correct reference is ${next}, not ${company.reference}. Use ${next} for the report check.`}]};
  assert.equal(checkSuggestion({say:good},corrected,{factChecked:true}).ok,false,'A prior literal mention is not current permission after an explicit correction.');
  assert.equal(checkSuggestion({say:good.replace(company.reference,next)},corrected).ok,true);
  const doNotUse={...context,turns:[...context.turns,{id:'negative-use',role:'buyer',text:`Don't use ${company.reference} anymore; use ${next} for the drawing check.`}]};assert.equal(checkSuggestion({say:good},doNotUse,{factChecked:true}).ok,false,'A negated use instruction withdraws the old code.');assert.equal(checkSuggestion({say:good.replace(company.reference,next)},doNotUse).ok,true);
  const both={...context,turns:[...context.turns,{id:'additional',role:'buyer',text:`Please check both ${company.reference} and ${next}, not just one reference.`}]};assert.equal(checkSuggestion({say:good},both).ok,true,'Asking about two references does not withdraw either one.');
  const negativeCoverage={...context,turns:[...context.turns,{id:'coverage',role:'buyer',text:`The report might not cover ${company.reference}. Please check that reference.`}]};assert.equal(checkSuggestion({say:good},negativeCoverage).ok,true,'Negated coverage is not a correction to the reference itself.');
 });
}
