import assert from 'node:assert/strict';
import test from 'node:test';
import {assessReplyVerification} from '../lib/turn-verification-policy.ts';
import {needsFactCheck} from '../lib/call-coaching.ts';

// Authored fictional propositions, not customer transcripts or QA recordings.
for(const company of [
 {name:'Example Mesh',product:'PX20',report:'material test report',id:'MTR-PX20-2030',noun:'woven mesh',content:'material chemistry'},
 {name:'Fictional Valve',product:'QV80',report:'inspection report',id:'IR-QV80-2030',noun:'irrigation valves',content:'inspection'},
]){
 const {name,product,report,id,noun,content}=company;
 const scope=`Approved ${report} ${id} explicitly covers ${name} ${product} ${noun}.`;
 const body=`It records the ${content} of the tested sample; it does not certify application suitability, guaranteed service life, or future batches.`;
 const source={id:'scope',text:`${scope} ${body}`};
 const availability={id:'available',text:`Company profiles, specifications and ${report}s are available for review.`};
 const context=(sources=[source,availability])=>({coachingRequest:{id:'synthetic-proof',requestedAt:1},manufacturer:{name,products:product},sources,turns:[{role:'buyer',text:`Does the ${report} cover ${product}?`}]});
 const headline=`Yes, our approved ${report} ${id} explicitly covers ${name} ${product} ${noun}.`;
 for(const verb of ['records','shows','documents'])test(`${name}: whole report predicate ${verb} with exact singular sample and source limitation`,()=>{
  const say=`${headline} It ${verb} the ${content} of the tested sample but doesn't certify application suitability or future batches.`;
  const result=assessReplyVerification(say,context());
  assert.equal(result.locallyVerifiedWholeReply,true);
  assert.equal(needsFactCheck(say,context()),false);
  assert.equal(result.pendingClaims.length,0);
  assert.ok(result.localEvidence.length);
  assert.equal(result.localEvidence.length,1,'One original source appears once even when it proves several adjacent claims.');
  assert.ok(result.localEvidence[0].claim.includes(`It ${verb}`));
  assert.ok(result.localEvidence.every(item=>item.sourceId==='scope'&&item.quote===source.text));
 });
 test(`${name}: em-dash compound retains all predicates and Yes`,()=>{
  const say=`Yes, our ${report} ${id} explicitly covers ${product}—it records the ${content} of the tested sample but doesn't certify future batches.`;
  assert.equal(assessReplyVerification(say,context()).locallyVerifiedWholeReply,true);
  assert.equal(needsFactCheck(say,context()),false);
 });
 for(const joining of [' and records',' and it records','; it records'])test(`${name}: shared subject and singular possessive ${joining}`,()=>{
  const say=`${headline.slice(0,-1)}${joining} the tested sample’s ${content}; it doesn't certify application suitability or future batches.`;
  const result=assessReplyVerification(say,context());
  assert.equal(result.locallyVerifiedWholeReply,true);
  assert.equal(needsFactCheck(say,context()),false);
  assert.equal(result.localEvidence.length,1);
  assert.equal(result.localEvidence[0].quote,source.text);
 });
 test(`${name}: equivalent singular possessive and semicolons in original evidence`,()=>{
  const alternative={...source,text:`${scope.slice(0,-1)}; it records the tested sample's ${content} and does not certify application suitability or future batches.`};
  const say=`${headline} It shows the ${content} of the tested sample and does not certify future batches.`;
  const result=assessReplyVerification(say,context([alternative,availability]));
  assert.equal(result.locallyVerifiedWholeReply,true);
  assert.equal(needsFactCheck(say,context([alternative,availability])),false);
  assert.equal(result.localEvidence[0].quote,alternative.text);
 });
 for(const tail of [
  `and records the tested samples' ${content}`,
  `and records the customer's ${content}`,
  `and records the tested sample's ${content} and certifies suitability`,
  `and records the tested sample's guaranteed ${content}`,
  `and records the tested sample's ${content} only after approval`,
  `and records the tested sample's ${content}; we can ship tomorrow`,
  `and records the tested sample's ${content}; it guarantees suitability`,
 ])test(`${name}: shared-subject tail still needs its full meaning checked: ${tail}`,()=>{
  const say=`${headline.slice(0,-1)} ${tail}.`;
  assert.equal(assessReplyVerification(say,context()).locallyVerifiedWholeReply,false);
  assert.equal(needsFactCheck(say,context()),true);
 });
 test(`${name}: report proof does not weaken source-scoped numeric specifications`,()=>{
  const say=`${headline} It records the ${content} of the tested sample. Its nominal opening is 0.3 mm.`;
  assert.equal(assessReplyVerification(say,context()).locallyVerifiedWholeReply,false);
  assert.equal(needsFactCheck(say,context()),true);
 });
 for(const statement of [
  `It records the ${content} of tested samples.`,
  `It records the ${content} of every tested sample.`,
  `It records the ${content} of the tested sample and proves application suitability.`,
  'It documents the tested sample, though it does not guarantee future batches.',
  'It does not guarantee application suitability.',
  'It does not certify future batches—just the tested sample.',
  'It is approved for the tested sample.',
  'It certifies application suitability.',
  'It does not certify current batches.',
  "It doesn't certify future batches unless the customer approves.",
  'It records the certified quality of the tested sample.',
  'We can ship tomorrow and discount the order.',
 ])test(`${name}: additional/changed report meaning remains checked: ${statement}`,()=>{
  const say=`${headline} ${statement}`;
  assert.equal(assessReplyVerification(say,context()).locallyVerifiedWholeReply,false);
  assert.equal(needsFactCheck(say,context()),true);
 });
 for(const modified of [
  {...source,text:scope},
  {...source,text:`${scope} It records the ${content} of tested samples; it does not certify application suitability or future batches.`},
  {...source,text:`${scope} It may record the ${content} of the tested sample; it does not certify application suitability or future batches.`},
  {...source,text:`${source.text} Customer approval is required before disclosing test results.`},
  {...source,complete:false},
  {...source,title:'Superseded source'},
 ])test(`${name}: incomplete/qualified original is not full content proof: ${modified.text}`,()=>{
  const say=`${headline} It records the ${content} of the tested sample.`;
  assert.equal(assessReplyVerification(say,context([modified,availability])).locallyVerifiedWholeReply,false);
  assert.equal(needsFactCheck(say,context([modified,availability])),true);
 });
 test(`${name}: source for another product cannot supply this report's content`,()=>{
  const disjoint={id:'other',text:source.text.replaceAll(product,'ZZ90')};
  const input=context([{...source,text:scope},disjoint,availability]);
  assert.equal(needsFactCheck(`${headline} It records the ${content} of the tested sample.`,input),true);
 });
 test(`${name}: separate source conditions and conflicting content retain checking`,()=>{
  for(const extra of [
   `The ${report} does not record the ${content} of the tested sample.`,
   `The ${report} records the ${content} only after external approval.`,
   `The ${report} ${id} covers ${product} only for a preliminary sample.`,
   `${availability.text} The ${report} does not record the ${content} of the tested sample.`,
  ]){
   const input=context([source,availability,{id:'condition',text:extra}]);
   const say=`${headline} It records the ${content} of the tested sample.`;
   assert.equal(assessReplyVerification(say,input).locallyVerifiedWholeReply,false);
   assert.equal(needsFactCheck(say,input),true);
  }
 });
 test(`${name}: pronoun must follow a locally proven report, without an intervening subject`,()=>{
  for(const say of [
   `It records the ${content} of the tested sample.`,
   `${headline} The engineer has another document. It records the ${content} of the tested sample.`,
   `Our ${report} concerns ${product}. It records the ${content} of the tested sample.`,
  ])assert.equal(needsFactCheck(say,context()),true,say);
 });
 test(`${name}: source/company names cannot be substituted or made into scope qualifiers`,()=>{
  for(const prefix of ['Other Company','All','Only']){
   const say=headline.replace(`${name} ${product}`,`${prefix} ${product}`);
   assert.equal(assessReplyVerification(say,context()).locallyVerifiedWholeReply,false,say);
   assert.equal(needsFactCheck(say,context()),true,say);
  }
 });
 test(`${name}: paraphrasing an unsupported link with a qualifier never borrows contents`,()=>{
  const unsupported={...source,text:source.text.replaceAll(product,'ZZ90')};
  const input=context([unsupported,availability,{id:'product',text:`${product} specifications are available.`}]);
  for(const link of [`Our ${report} covers ${product} only for the tested sample.`,`Our ${report} applies to ${product}, but not future batches.`]){
   const result=assessReplyVerification(`${link} It records the ${content} of the tested sample.`,input);
   assert.equal(result.locallyVerifiedWholeReply,false);
   assert.ok(result.unsupportedClaims.some(claim=>claim.verificationBoundary==='document_product_scope'));
  }
 });
}
