import {assertLocalPressCompletion} from './helpers/local-press-assertions.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import {analyzeDocumentActionMeaning} from '../lib/document-product-evidence.ts';
import {assessReplyVerification} from '../lib/turn-verification-policy.ts';
import {checkSuggestion} from '../lib/call-purpose.ts';
import {LiveCoachingSession} from '../lib/live-coaching-session.ts';
import {incomingDrawingState,incomingDocumentWordingEffects} from '../lib/incoming-document-state.ts';
import {onDemandDecisionRules} from '../lib/on-demand-coaching.ts';

// Authored fictional transport fixtures. The actual request controller,
// parsers, checks and publication lifecycle run; provider/ASR events are
// scripted. No customer transcripts, API, browser state or latency claim.
const companies=[{id:'alder',name:'Alder Gauge Works',report:'inspection report',reference:'LT47'},{id:'birch',name:'Birch Component Export',report:'material test report',reference:'NW63'}];
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function fixture(company=companies[0]){
 const {id,name,report,reference}=company;
 const turns=[{id:'pickup',role:'buyer',text:'Jordan speaking.',at:1},{id:'scope',role:'buyer',text:`Does the ${report} cover ${reference}?`,at:2},{id:'clarify',role:'you',text:'Could you confirm the drawing reference?',at:3},{id:'drawing',role:'buyer',text:`${reference} is the reference on our drawing. I will email the drawing. Please reply with the ${report} only if it covers that reference.`,at:4}];
 return {callId:'authored-shared-'+id,manufacturer:{id,name,products:'industrial components'},sources:[{id:id+'-documents',original:true,complete:true,text:`Specification sheets and ${report}s are available for review.`}],turns,callType:'solution_discussion',currentStage:'solution_discussion',callContext:{stageId:'solution_discussion',relationship:'first_contact',goal:'Help the buyer evaluate the requested evidence.'},coachingRequest:{id:'shared-one-press',requestedAt:5,transcriptState:'confirmed',listeningSession:{startedAt:1,currentTurnIds:turns.map(turn=>turn.id)}}};
}
const reply=company=>`I'll check whether the ${company.report} covers ${company.reference} and send it only if it matches.`;
function controller(context){
 const log={sent:[],shown:[],traces:[],errors:[],issues:[],verifications:0};
 const session=new LiveCoachingSession({initialTranscriptIds:[],snapshot:()=>context,latestContext:(turns=context.turns)=>({...context,turns}),send:event=>log.sent.push(event),onGuidance:(value,id,_at,complete,_delay,trigger,pinned)=>log.shown.push({say:value.say,id,complete,trigger,pinned}),onRequestTrace:event=>log.traces.push(event),onSuggestionIssue:event=>log.issues.push(event),verify:async(_snapshot,value)=>{log.verifications++;return {...value,verified:false,verificationStatus:'rejected',caution:'The authored evidence does not establish this added claim.'};},fallback:async()=>assert.fail('This authored flow must not replace the requested move with a fallback.'),onBuyerTurn:turn=>context.turns.push({...turn,role:'buyer'}),onAudioIssue:()=>{},onSupersede:()=>{},onPendingTurn:()=>{},onThinking:()=>{},onChecking:()=>{},onBuyerPartial:()=>{},onBuyerSpeech:()=>{},onBuyerPending:()=>{},onUsage:()=>{},onWarning:()=>{},onError:message=>log.errors.push(message),continuationSettleMs:1,queuedTranscriptionTimeoutMs:200,transcriptionTimeoutMs:2000,fallbackAfterMs:10000});
 const creates=()=>log.sent.filter(event=>event.type==='response.create');
 const respond=(say,event=creates().at(-1),suffix='')=>{assert.ok(event,'A generation must exist for this candidate.');const id='authored-'+event.response.metadata.epoch+suffix;session.handle({type:'response.created',response:{id,metadata:event.response.metadata}});session.handle({type:'response.output_text.delta',response_id:id,delta:'SAY: '+say+'\nMOVE: Respect the drawing and evidence handoff\n'});session.handle({type:'response.done',response:{id,status:'completed'}});return id;};
 const request=()=>session.requestNextMove({...context,coachingRequest:{...context.coachingRequest,id:'shared-one-press',requestedAt:Date.now()}});
 const assertOneReply=say=>{const rejection=log.traces.filter(event=>['rejected','repair_requested','failed'].includes(event.event)).map(event=>({event:event.event,reason:event.reason}));assert.equal(log.shown.length,1,'Safety alone is not useful recovery; the original press must produce one usable card. '+JSON.stringify(rejection));assert.equal(log.shown[0].say,say);assert.equal(log.shown[0].trigger,'shared-one-press');assert.equal(log.traces.filter(event=>event.event==='failed').length,0);};
 return {context,session,log,creates,respond,request,assertOneReply};
}

for(const company of companies){
 test(`${company.name}: one shared record keeps an inquiry unknown and a buyer reference distinct from our products`,()=>{
  const context=fixture(company),text=`I'll check whether the ${company.report} covers ${company.reference}.`,meaning=analyzeDocumentActionMeaning(text,context);
  assert.equal(meaning.coverage,'future_inquiry');assert.equal(meaning.locallyNonAssertive,true);assert.equal(meaning.checksCoverage,true);assert.equal(meaning.outgoing.length,0);
  assert.deepEqual(meaning.references.map(item=>({text:item.text,basis:item.basis})),[{text:company.reference,basis:'confirmed_buyer'}]);
  const claim=analyzeDocumentActionMeaning(`The ${company.report} covers ${company.reference}.`,context);assert.equal(claim.locallyNonAssertive,false);assert.equal(claim.coverage,'assertion_or_unparsed');
 });
 test(`${company.name}: completing a check differs from a positive result governing every send`,()=>{
  const context=fixture(company),sequence=`Once I've checked whether the ${company.report} covers ${company.reference}, I'll send the report.`,condition=`Once I confirm that the ${company.report} covers ${company.reference}, I'll reply with it.`;
  const checked=analyzeDocumentActionMeaning(sequence,context),positive=analyzeDocumentActionMeaning(condition,context);
  assert.equal(checked.delivery?.deliveryCondition,'check_completion');assert.ok(checked.outgoing.length);assert.ok(checked.outgoing.every(action=>action.condition==='check_complete'));
  assert.equal(positive.coverage,'positive_result_condition');assert.ok(positive.outgoing.length);assert.ok(positive.outgoing.every(action=>action.condition==='coverage_positive'));
  assert.equal(checkSuggestion({say:sequence},context,{factChecked:true}).ok,false,'Knowing the answer is not the buyer’s positive-match condition.');assert.equal(checkSuggestion({say:condition},context).ok,true);
 });
 for(const say of [
  `Once we've checked that the ${company.report} covers ${company.reference}, I'll send it over to you. Looking forward to your drawing.`,
  `Once we confirm the ${company.report} covers ${company.reference}, we'll forward it along to you for review.`,
  `Once we confirm whether the ${company.report} covers ${company.reference}, we'll send it only if it matches.`,
  `Once I have reviewed your drawing, I'll confirm whether the ${company.report} covers ${company.reference}. If it does, I'll reply with it.`,
  `I'll review your drawing when it arrives and check whether the ${company.report} covers ${company.reference}; I'll send it only if it does.`,
  `After we receive your drawing, I'll find out whether the ${company.report} covers ${company.reference}. If it does, I'll send the report.`,
 ])test(`${company.name}: a safe composed action publishes unchanged on its first attempt: ${say}`,async()=>{
  const t=controller(fixture(company));try{t.request();t.respond(say);await sleep(5);t.assertOneReply(say);assert.equal(t.creates().length,1);assert.equal(t.log.verifications,0,'No remote check solely for an ordinary future investigation.');assert.equal(t.log.traces.filter(event=>event.event==='repair_requested').length,0);}finally{t.session.stop();}
 });
 const unsafe=[
  {kind:'unsupported present coverage',say:`The ${company.report} covers ${company.reference}.`},
  {kind:'mixed scoped-existence claim',say:`We have a ${company.report} for ${company.reference}, and I'll check its details.`},
  {kind:'buyer reference turned into company product',say:`I'll check whether the ${company.report} covers our ${company.reference}.`},
  {kind:'check completion rather than a positive match',say:`Once I've checked whether the ${company.report} covers ${company.reference}, I'll send it.`},
  {kind:'check completion with a composed delivery complement',say:`Once we've checked whether the ${company.report} covers ${company.reference}, we'll send it over to you.`},
  {kind:'delivery complement cannot hide an unsupported benefit',say:`Once we confirm the ${company.report} covers ${company.reference}, we'll send it over to you and guarantee suitability.`},
  {kind:'second unconditional send',say:`I'll check whether the ${company.report} covers ${company.reference} and send it only if it matches. I'll email the report regardless.`},
  {kind:'positive-match gate weakened by alternative approval',say:`I'll send the ${company.report} if it covers ${company.reference} or your engineer approves.`},
  {kind:'positive-match gate weakened by alternative request',say:`I'll check whether the ${company.report} covers ${company.reference}, and I'll send it if it matches or you ask for it.`},
  {kind:'unsupported shipment',say:reply(company)+' We will ship your order tomorrow.'},
  {kind:'unapproved certification',say:reply(company)+' Our products are certified for medical use.'},
  {kind:'drawing receipt invented from a promise',say:`I've received your drawing. ${reply(company)}`},
  {kind:'anticipation cannot hide claimed report coverage',say:`Looking forward to your drawing, which the ${company.report} already covers. ${reply(company)}`},
 ];
 for(const probe of unsafe)test(`${company.name}: block ${probe.kind}, then complete locally on the SAME press`,async()=>{
 const input=fixture(company);assert.equal(checkSuggestion({say:probe.say},input,{factChecked:true}).ok,false,'Source approval cannot waive a condition, ownership or receipt violation.');const t=controller(input);try{t.request();t.respond(probe.say);await sleep(5);assertLocalPressCompletion(t.log,t.creates(),probe.say);}finally{t.session.stop();}
});
}

test('A pure future inquiry may consider alternatives without weakening any delivery gate',()=>{
 const context=fixture(),text="I'll check whether the inspection report covers LT47 or whether we need a different report.",meaning=analyzeDocumentActionMeaning(text,context);
 assert.equal(meaning.locallyNonAssertive,true);assert.equal(meaning.weakensPositiveMatch,false);assert.equal(meaning.outgoing.length,0,'An inquiry about alternatives does not promise an alternative route for sending.');
});
test('One rejected candidate completes locally; late filler cannot replace it or start a repair loop',async()=>{
 const company=companies[0],t=controller(fixture(company)),bad=`The ${company.report} covers ${company.reference}.`;try{t.request();t.respond(bad);await sleep(5);const spoken=assertLocalPressCompletion(t.log,t.creates(),bad);t.respond('Thanks.');await sleep(5);assert.equal(t.log.shown.length,1);assert.equal(t.log.shown[0].say,spoken);assert.equal(t.creates().length,1);}finally{t.session.stop();}
});
test('Company document availability never transfers to another company',async()=>{
 const a=companies[0],b=companies[1],context=fixture(b);context.sources=[{id:'birch-profiles',text:'Company profiles and specification sheets are available.'}];const bad=`I'll send the ${a.report} only if it covers ${b.reference}.`;assert.ok(assessReplyVerification(bad,context).unsupportedClaims.length);const t=controller(context);try{t.request();t.respond(bad);await sleep(5);const spoken=assertLocalPressCompletion(t.log,t.creates(),bad);assert.equal(spoken.includes(a.name),false);assert.equal(spoken.includes(a.reference),false);}finally{t.session.stop();}
});
test('Identical reply text cannot reuse another company’s source authority',()=>{
 const company=companies[0],text=reply(company),approved=fixture(company),unapproved={...fixture(company),manufacturer:{id:'other-company',name:'Cypress Testing Supply',products:'industrial components'},sources:[{id:'cypress-documents',text:'Company profiles and specification sheets are available.'}]};
 assert.equal(checkSuggestion({say:text},approved).ok,true);assert.equal(checkSuggestion({say:text},unapproved,{factChecked:true}).ok,false);assert.equal(checkSuggestion({say:text},approved).ok,true,'Assessment must not mutate or contaminate the first company either.');
});
test('Incoming drawing promise, buyer-reported send and representative receipt are separate dated evidence',()=>{
 const context={turns:[]};assert.equal(incomingDrawingState(context).state,'unconfirmed');
 context.turns.push({id:'promise',role:'buyer',text:'I will email the drawing once our engineer finishes.'});assert.deepEqual(incomingDrawingState(context),{state:'promised',sourceTurnIds:['promise'],evidence:['I will email the drawing once our engineer finishes.']});
 context.turns.push({id:'sent',role:'buyer',text:"I've emailed the drawing."});assert.equal(incomingDrawingState(context).state,'buyer_reports_sent');assert.deepEqual(incomingDrawingState(context).sourceTurnIds,['sent']);
 context.turns.push({id:'conditional',role:'you',text:"Once we've received the drawing, we will review it."});assert.equal(incomingDrawingState(context).state,'buyer_reports_sent','A prerequisite does not prove receipt.');
 context.turns.push({id:'received',role:'you',text:"I've received your drawing."});assert.equal(incomingDrawingState(context).state,'received');assert.deepEqual(incomingDrawingState(context).sourceTurnIds,['received']);
 context.turns.push({id:'denied',role:'you',text:"I haven't received the drawing."});assert.equal(incomingDrawingState(context).state,'unconfirmed','The latest actual denial withdraws receipt evidence.');
});
test('Conditional, uncertain and suggested receipt never promote an incoming drawing to received',()=>{
 for(const text of ["If I've received your drawing, I will review it.","Once we've received your drawing, we will check the report.","I haven't received your drawing.","We've received your drawing? Let me check."]){const input={turns:[{id:'promise',role:'buyer',text:'I will send the drawing.'},{id:'rep',role:'you',text}]};assert.notEqual(incomingDrawingState(input).state,'received',text);}
 const uncertain={turns:[{id:'uncertain',role:'you',text:"I've received your drawing.",transcriptionUncertainty:{reason:'unclear'}}]};assert.equal(incomingDrawingState(uncertain).state,'unconfirmed');
 const unsaid={turns:[{id:'buyer',role:'buyer',text:'Does your report cover the drawing reference?'}],suggestions:[{guidance:{say:"I've received your drawing."}}]};assert.equal(incomingDrawingState(unsaid).state,'unconfirmed');
});
test('Generation receives the actual future drawing state rather than a completed-send assumption',()=>{
 const context=fixture(),rules=onDemandDecisionRules(context);assert.match(rules,/INCOMING DRAWING STATUS/);assert.match(rules,/"state":"promised"/);assert.match(rules,/once it arrives|future help/);assert.equal(incomingDrawingState(context).state,'promised');
 const sent={...context,turns:[...context.turns,{id:'sent',role:'buyer',text:'I emailed the drawing.'}]};assert.match(onDemandDecisionRules(sent),/"state":"buyer_reports_sent"/);assert.equal(incomingDocumentWordingEffects("I've received your drawing.",sent).problems.length,1,'Reported send still does not establish our receipt.');
});
test('Anticipatory gratitude is style feedback; it must not require verification or rewriting',async()=>{
 const company=companies[0],context=fixture(company),courtesy='Thanks for emailing the drawing.',effects=incomingDocumentWordingEffects(courtesy,context);assert.deepEqual(effects.problems,[]);assert.equal(effects.qualityFeedback.length,1);
 const say=courtesy+' '+reply(company),t=controller(context);try{t.request();t.respond(say);await sleep(5);t.assertOneReply(say);assert.equal(t.log.verifications,0);assert.equal(t.creates().length,1);const verdict=checkSuggestion({say},context);assert.equal(verdict.ok,true);assert.ok(verdict.qualityFeedback.some(message=>/future|offered/i.test(message)));}finally{t.session.stop();}
});
test('Explicit invented receipt remains a hard conversation check even beside a safe future inquiry',()=>{
 const company=companies[0],context=fixture(company),say="I've received your drawing. "+reply(company);assert.equal(incomingDocumentWordingEffects(say,context).problems.length,1);assert.equal(checkSuggestion({say},context,{factChecked:true}).ok,false);
 const sent={...context,turns:[...context.turns,{id:'sent',role:'buyer',text:'I sent the drawing.'}]};assert.equal(checkSuggestion({say},sent,{factChecked:true}).ok,false);
 const received={...sent,turns:[...sent.turns,{id:'received',role:'you',text:"I've received your drawing."}]};assert.equal(incomingDocumentWordingEffects(say,received).problems.length,0);assert.equal(checkSuggestion({say},received,{factChecked:true}).ok,true,'Actual receipt evidence is allowed without pretending coverage is confirmed.');
});
test('A late buyer approval condition revises hidden work while the original press and displayed wording stay stable',async()=>{
 const company=companies[0],context=fixture(company),provisional=context.turns.pop().text,t=controller(context),changed=provisional+' Actually, do not send anything until my engineer approves.';
 try{
  t.session.handle({type:'input_audio_buffer.speech_started',item_id:'current-buyer',audio_start_ms:100});t.session.handle({type:'conversation.item.input_audio_transcription.delta',item_id:'current-buyer',delta:provisional});t.request();t.session.handle({type:'input_audio_buffer.speech_stopped',item_id:'current-buyer',audio_end_ms:5000});await sleep(50);assert.equal(t.creates().length,1);const old=t.creates()[0],oldId=t.respond(reply(company),old);assert.equal(t.log.shown.length,0);
  t.session.handle({type:'conversation.item.input_audio_transcription.completed',item_id:'current-buyer',transcript:changed});t.session.handle({type:'response.done',response:{id:oldId,status:'cancelled'}});await sleep(5);assert.equal(t.creates().length,2);assert.match(t.creates()[1].response.instructions,/until my engineer approves/);
  t.session.handle({type:'response.output_text.delta',response_id:oldId,delta:'SAY: '+reply(company)+'\n'});assert.equal(t.log.shown.length,0,'The stale unapproved send cannot regain ownership.');
  const safe=`I'll check whether the ${company.report} covers ${company.reference}; I won't send it unless it matches and your engineer approves.`;t.respond(safe);await sleep(5);t.assertOneReply(safe);assert.equal(t.log.traces.filter(event=>event.event==='repair_requested').length,0,'Changed speech is not a factual repair.');
  t.session.handle({type:'input_audio_buffer.speech_started',item_id:'later-buyer',audio_start_ms:5100});t.session.handle({type:'input_audio_buffer.speech_stopped',item_id:'later-buyer',audio_end_ms:5200});t.session.handle({type:'conversation.item.input_audio_transcription.completed',item_id:'later-buyer',transcript:'Thank you, goodbye.'});assert.equal(t.log.shown.length,1);assert.equal(t.log.shown[0].say,safe);
 }finally{t.session.stop();}
});
