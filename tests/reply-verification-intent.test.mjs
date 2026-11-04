import assert from 'node:assert/strict';
import test from 'node:test';
import {assessReplyVerification,isNonAssertiveReply} from '../lib/turn-verification-policy.ts';
import {needsFactCheck} from '../lib/call-coaching.ts';
import {defaultConfigurationStages} from '../lib/sales-curriculum.ts';

// Shareable authored fixtures. No production company, call or diagnostic data.
const companies=[
 {id:'fictional-mesh',name:'Synthetic Mesh Supply',product:'PX20',report:'material test report',category:'woven mesh'},
 {id:'fictional-valve',name:'Imaginary Valve Works',product:'QV80',report:'inspection report',category:'irrigation valves'},
];
function context(company,linked=false){
 return {manufacturer:{id:company.id,name:company.name,products:`${company.category} ${company.product}`},coachingRequest:{id:'synthetic-check',requestedAt:1},turns:[{role:'buyer',text:`Hi, this is Priya. Can you confirm whether the ${company.report} covers ${company.product}?`}],sources:[
  {id:'availability',text:`Company profiles, specification sheets and ${company.report}s are available for review.`},
  {id:'product',text:`${company.product} is one of our ${company.category} products.`},
  ...linked?[{id:'scope',text:`The ${company.report} covers ${company.product}.`}]:[],
 ]};
}
for(const company of companies){
 const {product,report}=company;
 const checks=[
  `Thanks for your question, Priya. I'll check whether our ${report} covers ${product} and get back to you with that confirmation.`,
  `Thanks for asking, Priya. I'll need to confirm whether that ${report} covers the ${product} and get back to you.`,
  `Thank you, Priya. I'll find out if the ${report} covers ${product} and let you know.`,
  `Understood. I'll check whether the report covers your exact product and confirm before sending it.`,
  `I'll look into whether the ${report} covers ${product}. I'll report back.`,
  `Let me check the report's scope and confirm before I send it.`,
  `I'll look into which models that ${report} covers.`,
  'I can verify the coverage and let you know.',
  `Could I check whether the ${report} covers ${product}?`,
  `I can't confirm whether the ${report} covers ${product} yet. I'll check and let you know.`,
  'Which requirements would your engineer like to compare?',
  'Could you clarify which product you mean?',
  'Thank you, Priya.',
 ];
 for(const say of checks)test(`${company.name}: a complete non-assertive reply skips the separate verifier: ${say}`,()=>{
  const request=context(company),assessment=assessReplyVerification(say,request);
  assert.deepEqual(assessment.unsupportedClaims,[]);
  assert.deepEqual(assessment.pendingClaims,[]);
  assert.equal(assessment.requiresVerification,false);
  assert.equal(isNonAssertiveReply(say,assessment.claims),true);
  assert.equal(needsFactCheck(say,request),false);
 });
 for(const say of [
  `The ${report} covers ${product}.`,
  `We have a ${report} for ${product}, and I'll check the details.`,
  `I'll check the details. Our ${report} contains ${product}'s test data.`,
  `I'll check whether the report covers your product; it applies to ${product}.`,
  `I'll check whether the report covers your product, but our ${report} is for ${product}.`,
  `I'll check whether the report covers ${product}—it is certified.`,
  `I'll check whether the report covers ${product}, a certified match for your product.`,
  `I'll confirm that it covers ${product}.`,
 ])test(`${company.name}: uncertainty elsewhere cannot hide coverage or contents: ${say}`,()=>{
  const request=context(company),assessment=assessReplyVerification(say,request);
  assert.ok(assessment.unsupportedClaims.length,say);
  assert.equal(isNonAssertiveReply(say,assessment.claims),false);
  assert.equal(needsFactCheck(say,request),true);
 });
 for(const tail of [
  'because it definitely does',
  `(it covers ${product})`,
  `since it already certifies ${product}`,
  'so you can rely on its coverage',
  ', certified to the needed standard',
  'and guarantees your performance',
  'and confirm that it covers your product',
 ])test(`${company.name}: an attached assertion is not an ordinary offer to check: ${tail}`,()=>{
  const request=context(company),say=`I'll check whether the report covers ${product} ${tail}.`,assessment=assessReplyVerification(say,request);
  assert.equal(isNonAssertiveReply(say,assessment.claims),false,say);
  assert.equal(needsFactCheck(say,request),true,say);
 });
 test(`${company.name}: a specific approved link retains the factual verification path`,()=>{
  const request=context(company,true),say=`The ${report} covers ${product}.`,assessment=assessReplyVerification(say,request);
  assert.equal(assessment.unsupportedClaims.length,0);
  assert.ok(assessment.pendingClaims.some(claim=>claim.candidateSourceIds?.includes('scope')));
  assert.equal(needsFactCheck(say,request),true);
  assert.equal(isNonAssertiveReply(say,assessment.claims),false);
 });
}

for(const added of [
 "We can offer you a discount.",
 "I'll ship it tomorrow.",
 'Our product is ISO 9001 certified.',
 'Our product guarantees better performance.',
 'I can certify the product.',
 "I'll confirm before sending it tomorrow.",
 "We'll provide it for $7.",
])test('A follow-through sentence cannot exempt a separate restricted promise: '+added,()=>{
 const request=context(companies[0]),say="Thanks for asking, Priya. I'll check whether the report covers PX20. "+added;
 const assessment=assessReplyVerification(say,request);
 assert.ok(assessment.unsupportedClaims.length,added);
 assert.equal(isNonAssertiveReply(say,assessment.claims),false);
 assert.equal(needsFactCheck(say,request),true);
});

test('Safe primary wording cannot hide a claim in the backup line',()=>{
 const request=context(companies[0]);
 assert.equal(needsFactCheck("I'll check whether the report covers PX20.",'The material test report covers PX20.',request),true);
 assert.equal(needsFactCheck("I'll check whether the report covers PX20.",'Which requirements would your engineer like to compare?',request),false);
});

test('Buyer questions and acknowledgments preserve current company authority boundaries',()=>{
 const request=context(companies[1]),stages=defaultConfigurationStages();
 const snapshot={id:'synthetic-version',companyId:companies[1].id,version:1,activatedAt:1,stages,knowledge:[],boundaries:[{id:'discount-approval',text:'Discounts require manager approval.',authority:'approval_required',scope:'company',action:'discount',status:'active',origin:'manager'}],preferences:[],legacyNotes:[]};
 request.companyConfiguration={companyId:companies[1].id,versionId:snapshot.id,version:1,boundAt:1,selectedStageId:stages[0].id,snapshot};
 for(const say of ["I'll check whether a discount can be approved.","Could I check whether a discount can be approved?"]){
  const assessment=assessReplyVerification(say,request);
  assert.equal(assessment.unsupportedClaims.length,0);
  assert.equal(needsFactCheck(say,request),false);
 }
 const unsafe="I'll check whether the inspection report covers QV80. We can offer you a discount.";
 assert.ok(assessReplyVerification(unsafe,request).unsupportedClaims.some(claim=>/boundary|authoriz|approval/i.test(claim.reason)));
 assert.equal(needsFactCheck(unsafe,request),true);
});
