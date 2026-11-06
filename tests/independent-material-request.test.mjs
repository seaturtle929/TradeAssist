import test from 'node:test';
import assert from 'node:assert/strict';
import {deriveConversationState,hasAffirmativeMaterialsRequest,affirmativeMaterialsNamed} from '../lib/conversation-state.ts';
import {ensureCompanyBrain,buildBrainRequest,rememberBuyer} from '../lib/company-brain.ts';
import {foundationLayerFor} from '../lib/generation-foundation.ts';
import {BrainRequestInput} from '../lib/company-brain-input.ts';
import {LiveCoachingSession} from '../lib/live-coaching-session.ts';

// Deliberately authored fictional examples. No saved call content, browser
// persistence, network, physical audio or model responses are used here.
const company={id:'synthetic-larch',name:'Larch Instrument Export',products:'inspection instruments',introduction:'',sources:[{id:'larch-documents',text:'Company profiles, specification sheets and inspection reports are available for review.'}]};
const turns=rows=>rows.map(([role,text],index)=>({id:'authored-'+index,role,text,at:index+1}));
const context=rows=>({callId:'authored-independent-material-call',manufacturer:company,sources:company.sources,turns:turns(rows),callContext:{stageId:'solution_discussion',relationship:'first_contact',goal:'Help the buyer evaluate the requested evidence.'},currentStage:'solution_discussion',callType:'solution_discussion'});
const generic=state=>state.commitments.find(item=>item.id==='send_materials');

for(const line of [
 'Before you email those documents,',
 'Before you email the brochure, can you clarify its scope?',
 'Before you email the brochure can you clarify its scope?',
 'While you email the brochure, are the specifications current?',
 'Until you email the company profile, we will keep the question open.',
 'Earlier you said you would email the brochure.',
 'I remember you can email the company profile.',
 'Did you say you would email the brochure?',
 'I will check the report before you email the brochure.',
 'I can confirm whether you should send the brochure.',
])test(`A mentioned or subordinate delivery is not a new sending commitment: ${line}`,()=>{
 assert.equal(hasAffirmativeMaterialsRequest(line),false);
 const state=deriveConversationState(context([['buyer',line]]));
 assert.equal(generic(state),undefined);assert.notEqual(state.nextAction.kind,'capture_email');
});

for(const line of [
 'Before we finish, could you email the brochure?',
 'Before we finish could you email the brochure?',
 'Well, before we finish, could you email the brochure?',
 'Please email the brochure before the engineering review.',
 'Could you also attach a company profile?',
 'How about you send me your company profile?',
 'Please include technical data sheets.',
 'Instead, send only the catalog.',
 "I'd like you to email the company profile.",
 'That sounds useful and could you send me a company profile?',
 'That would help and please send the company profile.',
])test(`An independent main request remains valid: ${line}`,()=>{
 assert.equal(hasAffirmativeMaterialsRequest(line),true);
 assert.ok(generic(deriveConversationState(context([['buyer',line]]))));
});

test('Dependent document nouns do not expand the actual main request',()=>{
 const line='Before you email the company profile, please attach the product specs.';
 const state=deriveConversationState(context([['buyer',line]]));
 assert.deepEqual(affirmativeMaterialsNamed(line),['product specs']);
 assert.equal(generic(state).action,'Send product specs');
 assert.equal(generic(state).evidence[0].quote,line,'Preserve the full actual evidence without treating every noun as requested.');
});

test('A genuine earlier request survives a subordinate follow-up question with its original evidence',()=>{
 const rows=[['buyer','Please email the company profile.'],['buyer','Before you email that profile, can you explain what it includes?']];
 const state=deriveConversationState(context(rows)),send=generic(state);
 assert.equal(send.action,'Send company profile');assert.equal(send.evidence.length,1);
 assert.equal(send.evidence[0].turnId,'authored-0');assert.equal(send.evidence[0].quote,rows[0][1]);
 assert.ok(['respond_to_question','continue_conversation'].includes(state.nextAction.kind),'Address the new question while keeping the real earlier commitment.');
});

test('A conditional or historical offer cannot acquire consent from a later bare Yes',()=>{
 for(const offer of ['I can confirm whether you should send the brochure.','Earlier I said I can email the company profile.']){
  assert.equal(generic(deriveConversationState(context([['you',offer],['buyer','Yes.']]))),undefined);
 }
 const valid=deriveConversationState(context([['you','If useful, I can send our company profile.'],['buyer','Yes, please.']]));
 assert.equal(generic(valid).action,'Send company profile');assert.equal(generic(valid).evidence.length,2);
});

for(const offer of ['Can I send you our drawing?','Would you like me to send our drawing?'])test(`A buyer-owned offer never becomes the rep’s sending/email gap: ${offer}`,()=>{
 const state=deriveConversationState(context([['buyer',offer]]));
 assert.equal(generic(state),undefined);assert.notEqual(state.nextAction.kind,'capture_email');
 const drawing=state.documents.transfers.find(item=>item.document==='drawings');
 assert.equal(drawing.sender,'buyer');assert.equal(drawing.phase,'offered');assert.equal(drawing.receiptStatus,'unconfirmed');
});

test('Coordinated buyer drawing offers and independent rep document requests retain their separate owners',()=>{
 const state=deriveConversationState(context([['buyer','Can I send you our drawing and could you send me the company profile?']]));
 assert.equal(generic(state).action,'Send company profile');
 const drawing=state.documents.transfers.find(item=>item.document==='drawings');
 assert.equal(drawing.sender,'buyer');assert.equal(drawing.phase,'offered');
 assert.equal(drawing.receiptStatus,'unconfirmed');
 assert.ok(!generic(state).action.includes('drawing'));
});

for(const line of ['Please send the company profile and then email the specs.','Could you email the company profile and send the specs?'])test(`All coordinated same-owner requests remain in the generic commitment: ${line}`,()=>{
 const state=deriveConversationState(context([['buyer',line]]));
 assert.equal(generic(state).action,'Send company profile and product specs');
 assert.deepEqual(affirmativeMaterialsNamed(line),['company profile','product specs']);
 assert.equal(generic(state).evidence.length,1);assert.equal(generic(state).evidence[0].quote,line);
});

test('A rep main promise keeps its own documents separate from the dependent context',()=>{
 const state=deriveConversationState(context([['you',"Before you review the product specs, I'll email our company profile."]]));
 assert.equal(generic(state).action,'Send company profile');
 const historical=deriveConversationState(context([['you',"Earlier I said I will email the brochure."]]));
 assert.equal(generic(historical),undefined);
});

const handoffRows=[
 ['buyer','Jordan speaking. I handle purchasing.'],
 ['you',"I'm Robin from Larch Instrument Export."],
 ['buyer','Before you email those documents,'],
 ['buyer','Does the inspection report cover QH62?'],
 ['you','Could you confirm the drawing reference?'],
 ['buyer','QH62 is our drawing reference. I will email the drawing.'],
 ['buyer','Please email the inspection report only if it covers QH62.'],
];
test('Generation and request/persistent memory use the canonical handoff without a phantom email gap',()=>{
 const input=context(handoffRows),state=deriveConversationState(input);
 assert.equal(generic(state),undefined);assert.equal(state.nextAction.kind,'confirm_conditional_send');
 assert.ok(state.sequence.every(item=>item.id!=='send_profile'));
 assert.equal(state.documents.transfers.find(item=>item.sender==='buyer'&&item.document==='drawings').sendStatus,'pending');
 assert.equal(state.documents.transfers.find(item=>item.sender==='you'&&item.document==='test reports').coverage,'unknown');
 const foundation=foundationLayerFor({...input,conversationState:state});
 assert.equal(foundation.conversationContext.commitments.some(item=>item.id==='send_materials'),false);
 const brain=ensureCompanyBrain(company),request=BrainRequestInput.parse(buildBrainRequest({...company,brain},'Authored buyer',state,input.turns));
 assert.equal(request.buyerMemory.commitments.some(item=>item.id==='send_materials'),false);
 const saved=rememberBuyer(brain,'Authored buyer',state);
 assert.equal(saved.buyers[0].commitments.some(item=>item.id==='send_materials'),false);
});

test('A completed transfer without an earlier rep material commitment does not create a phantom handoff plan',()=>{
 const state=deriveConversationState(context([
  ['buyer','Reception, how may I help?'],
  ['you','Could you connect me to Jordan in purchasing?'],
  ['buyer',"One moment, I'll put you through."],
  ...handoffRows,
 ]));
 assert.equal(state.participant.afterTransfer,true);assert.equal(state.participant.introductionNeeded,false);
 assert.equal(generic(state),undefined);assert.equal(state.nextAction.kind,'confirm_conditional_send');
});

test('The original press can publish a report acknowledgment without a fake material-request rejection',async()=>{
 const input=context(handoffRows),sent=[],shown=[],traces=[],errors=[];let checks=0;
 const say="I'll check whether the inspection report covers QH62 and email it only if it matches.";
 const session=new LiveCoachingSession({snapshot:()=>input,latestContext:()=>input,send:event=>sent.push(event),onGuidance:value=>shown.push(value),onRequestTrace:event=>traces.push(event),verify:async()=>{checks++;assert.fail('This safe future check has no factual coverage assertion.');},fallback:async()=>assert.fail('No filler fallback.'),onError:error=>errors.push(error),onSupersede:()=>{},onPendingTurn:()=>{},onThinking:()=>{},onChecking:()=>{},onBuyerTurn:()=>{},onBuyerPartial:()=>{},onBuyerSpeech:()=>{},onBuyerPending:()=>{},onUsage:()=>{},onWarning:()=>{},fallbackAfterMs:10000});
 try{
  session.requestNextMove({...input,coachingRequest:{id:'authored-one-press',requestedAt:Date.now()}});
  const request=sent.find(item=>item.type==='response.create');assert.ok(request);
  session.handle({type:'response.created',response:{id:'authored-provider-output',metadata:request.response.metadata}});
  session.handle({type:'response.output_text.delta',response_id:'authored-provider-output',delta:'SAY: '+say+'\nMOVE: Respect the conditional evidence handoff\n'});
  session.handle({type:'response.done',response:{id:'authored-provider-output',status:'completed'}});
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(errors,[]);assert.equal(checks,0);assert.equal(shown.length,1);assert.equal(shown[0].say,say);
  assert.equal(sent.filter(item=>item.type==='response.create').length,1);assert.equal(traces.filter(item=>item.event==='repair_requested').length,0);
 }finally{session.stop();}
});
