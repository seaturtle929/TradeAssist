import assert from 'node:assert/strict';
import test from 'node:test';
import {assessReplyVerification} from '../lib/turn-verification-policy.ts';
import {needsFactCheck} from '../lib/call-coaching.ts';

// Entirely authored, fictional references. No live calls or external services.
const companies=[{id:'mesh',name:'Synthetic Mesh Supply',product:'PX20',category:'mesh',report:'material test report',opening:'0.82'},{id:'valve',name:'Imaginary Valve Works',product:'QV80',category:'valve',report:'inspection report',opening:'0.29'}];
const request=company=>({coachingRequest:{id:'authored-request',requestedAt:1},manufacturer:{id:company.id,name:company.name,products:`${company.product} ${company.category}`},turns:[{role:'buyer',text:`Does your ${company.report} cover ${company.product}, and what is its nominal opening?`}],sources:[{id:'scope',text:`The ${company.report} covers ${company.product}.`},{id:'spec',text:`${company.product} has a nominal opening of ${company.opening} mm.`},{id:'available',text:`Company profiles, specification sheets and ${company.report}s are available for review.`}]});
for(const company of companies){
 const context=request(company),{product,report,opening}=company;
 for(const id of [product,product.replace(/(\D+)(\d+)/,'$1-$2'),product.replace(/(\D+)(\d+)/,'$1–$2')]){
  for(const say of [`The ${report} covers ${id}.`,`${id} has a nominal opening of ${opening} mm.`,`The ${report} covers ${id}. ${id} has a nominal opening of ${opening} mm.`])test(`${company.name}: closed original proof skips a redundant verifier: ${say}`,()=>{
   const result=assessReplyVerification(say,context);
   assert.deepEqual(result.unsupportedClaims,[]);assert.deepEqual(result.pendingClaims,[]);
   assert.equal(result.locallyVerifiedWholeReply,true);assert.equal(result.requiresVerification,false);assert.equal(needsFactCheck(say,context),false);
   assert.ok(result.localEvidence.length);for(const item of result.localEvidence)assert.ok(context.sources.find(source=>source.id===item.sourceId)?.text.includes(item.quote));
   assert.equal(result.sanitizedReply,say);
  });
  test(`${company.name}: source-known joined ID is not a quantity in an offer to check: ${id}`,()=>{
   const say=`I'll check whether the ${report} covers ${id} and let you know.`,result=assessReplyVerification(say,context);
   assert.deepEqual(result.unsupportedClaims,[]);assert.equal(needsFactCheck(say,context),false);
   assert.ok(!result.claims.some(claim=>claim.kind==='number'));
  });
 }
 for(const tail of ['We can offer a 10% discount.','We will ship it tomorrow.','It is certified to ISO 9001.','We guarantee your results.','It filters every particle.','The report records inspection of multiple samples.'])test(`${company.name}: proven scope never exempts an extra assertion: ${tail}`,()=>{
  const say=`The ${report} covers ${product}. ${tail}`,result=assessReplyVerification(say,context);
  assert.equal(result.locallyVerifiedWholeReply,false);assert.equal(needsFactCheck(say,context),true);
 });
 test(`${company.name}: scope-matched paraphrase stays pending`,()=>{
  const say=`The ${report} covers ${product} and records the inspection of multiple samples.`,input={...context,sources:[...context.sources,{id:'content',text:`The ${report} records inspection of the tested sample.`}]},result=assessReplyVerification(say,input);
  assert.equal(result.locallyVerifiedWholeReply,false);assert.ok(result.pendingClaims.length||result.unsupportedClaims.length);assert.equal(needsFactCheck(say,input),true);
 });
 test(`${company.name}: a correct model identifier cannot exempt an unsupported standalone number`,()=>{
  const say=`${product.replace(/(\D+)(\d+)/,'$1–$2')} has a nominal opening of 40 mm.`,result=assessReplyVerification(say,context);
  assert.ok(result.unsupportedClaims.some(claim=>claim.kind==='number'&&claim.text==='40 mm'));assert.equal(needsFactCheck(say,context),true);
 });
 for(const condition of ['only after manager approval','subject to export approval','with prior approval'])test(`${company.name}: an unconditional check then send cannot override ${condition}`,()=>{
  const input={...context,sources:[{id:'restricted',text:`The ${report} is available ${condition}.`}]},say=`I'll check whether the ${report} covers ${product}, then I can send it for your review.`,result=assessReplyVerification(say,input);
  assert.ok(result.unsupportedClaims.length);assert.equal(needsFactCheck(say,input),true);
 });
 for(const text of [
  `The ${report} is available under NDA.`,
  `The ${report} is available only to existing customers.`,
  `The ${report} is available if legal signs off.`,
  `The ${report} must not be sent to prospects.`,
  `We are not authorized to share the ${report}.`,
  `The ${report} has been requested.`,
  `The ${report} will be available next month.`,
  `The ${report} is available for internal review.`,
 ])test(`${company.name}: unfamiliar or restricted availability is not an unconditional send: ${text}`,()=>{
  for(const sources of [[{id:'restriction',text}],[{id:'plain',text:`The ${report} is available.`},{id:'restriction',text}]].slice(0,/has been requested/.test(text)?1:2)){
   const input={...context,sources},say=`I'll check whether the ${report} covers ${product}, then send it.`,result=assessReplyVerification(say,input);
   assert.ok(result.unsupportedClaims.length||result.pendingClaims.length);assert.equal(needsFactCheck(say,input),true);
  }
 });
 test(`${company.name}: buyer's delivery condition is not replaced by mere sequence`,()=>{
  const input={...context,turns:[{role:'buyer',text:`Only send it if the ${report} covers my exact product.`}]};
  const sequence=`I'll check whether the ${report} covers ${product}, then send it.`,conditional=`I'll check whether the ${report} covers ${product}, and if it does, I will send it along.`;
  assert.ok(assessReplyVerification(sequence,input).unsupportedClaims.some(claim=>/buyer.*conditional/i.test(claim.reason)));
  assert.equal(needsFactCheck(sequence,input),true);
  assert.deepEqual(assessReplyVerification(conditional,input).unsupportedClaims,[]);
  assert.equal(needsFactCheck(conditional,input),false);
  assert.equal(needsFactCheck(sequence,context),false,'Without the buyer condition, reasonable check then available-document send stays literal sequence.');
 });
 test(`${company.name}: generic report in check then send resolves the buyer's unambiguous type`,()=>{
  const input={...context,turns:[{role:'buyer',text:`Please email me the ${report}, but first check whether it covers ${product}.`}]},say=`Thanks. I'll confirm if that report covers ${product} and then send it along.`;
  assert.deepEqual(assessReplyVerification(say,input).unsupportedClaims,[]);
  assert.equal(needsFactCheck(say,input),false);
  const other=companies.find(item=>item.id!==company.id),unavailable={...input,sources:request(other).sources};
  assert.ok(assessReplyVerification(say,unavailable).unsupportedClaims.length);
  const ambiguous={...input,turns:[{role:'buyer',text:`I need the ${report} and the ${other.report}. Can you check that report's scope first?`}]};
  assert.equal(needsFactCheck(say,ambiguous),true,'Multiple report referents are not guessed.');
 });
 test(`${company.name}: complete fact evidence cannot be borrowed from another company`,()=>{
  const other=companies.find(item=>item.id!==company.id),say=`The ${report} covers ${product}.`,result=assessReplyVerification(say,request(other));
  assert.equal(result.locallyVerifiedWholeReply,false);assert.equal(needsFactCheck(say,request(other)),true);
 });
}
