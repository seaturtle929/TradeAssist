import assert from 'node:assert/strict';
import test from 'node:test';
import {
 assessDocumentProductCoverage, investigationThenDocumentDelivery,
 isConversationalAcknowledgment, literalDocumentScopeEvidence,
} from '../lib/document-product-evidence.ts';
import {assessReplyVerification} from '../lib/turn-verification-policy.ts';
import {needsFactCheck} from '../lib/call-coaching.ts';

// Authored synthetic fixtures, independent of customer records and audio QA.
const companies=[
 {name:'Example Mesh',product:'PX20',report:'material test report',id:'MTR-PX20-2026',category:'woven stainless-steel mesh'},
 {name:'Fictional Valve',product:'QV80',report:'inspection report',id:'IR-QV80-2026',category:'irrigation valves'},
];
function fixture(company,linked=false){
 const sources=[
  {id:'availability',text:`Company profiles, specification sheets and ${company.report}s are available for review.`},
  {id:'product',text:`${company.product} is one of our ${company.category} products.`},
  ...linked?[{id:'scope',text:`Approved ${company.report} ${company.id} explicitly covers ${company.name} ${company.product} ${company.category}. It records the inspection of the tested sample; it does not certify application suitability, guaranteed service life, or future batches.`}]:[],
 ];
 return {manufacturer:{id:company.name,name:company.name,products:company.product},sources,coachingRequest:{id:'synthetic',requestedAt:1},turns:[{role:'buyer',text:`Does your ${company.report} cover ${company.product}?`}]};
}
for(const company of companies){
 const {product,report}=company;
 for(const topic of ['this','that','it'])for(const punctuation of ['.',', Morgan.','—'])test(`${company.name}: neutral deictic courtesy ${topic}${punctuation}`,()=>{
  const courtesy=`Thanks for asking about ${topic}${punctuation}`;
  assert.equal(isConversationalAcknowledgment(courtesy.replace(/—$/,'')),true);
  const say=`${courtesy} I'll check whether the ${report} covers ${product} and let you know.`;
  assert.equal(needsFactCheck(say,fixture(company)),false);
 });
 for(const suffix of [`that ${report} covering ${product}`,`that, which proves coverage`,`that ${report} that covers ${product}`,`that—our ${report} covers ${product}`])test(`${company.name}: courtesy retains attached premise ${suffix}`,()=>{
  const courtesy=`Thanks for asking about ${suffix}.`;
  assert.equal(isConversationalAcknowledgment(courtesy),false);
  assert.equal(needsFactCheck(courtesy,fixture(company)),true);
 });
 for(const tail of ['and then send it along','and then email it to you',", then I'll send that report over",'and let you know, then we can share the report for review'])test(`${company.name}: after-check delivery preserves sequence ${tail}`,()=>{
  const say=`I'll check whether the ${report} covers ${product} ${tail}.`;
  const parsed=investigationThenDocumentDelivery(say);
  assert.equal(parsed?.document,report);
  assert.equal(parsed?.deliveryCondition,'sequence_only');
  assert.equal(parsed?.conditionText,undefined,'Do not turn ordered sending into a positive result or infer only-if coverage.');
  assert.equal(needsFactCheck(say,fixture(company)),false);
  const missing={...fixture(company),sources:[{id:'specs',text:`${product} specifications are available.`}]};
  assert.equal(needsFactCheck(say,missing),true,'Report delivery needs its own availability evidence.');
 });
 for(const condition of ['if it does','only if the report covers your product'])test(`${company.name}: conditional delivery keeps its stated condition ${condition}`,()=>{
  const say=`I'll check whether the ${report} covers ${product}, and ${condition}, I will send it along.`;
  const parsed=investigationThenDocumentDelivery(say);
  assert.equal(parsed?.document,report);
  assert.equal(parsed?.deliveryCondition,'stated_condition');
  assert.equal(parsed?.conditionText,condition);
  assert.equal(needsFactCheck(say,fixture(company)),false);
 });
 for(const tail of ['and then send it tomorrow','and then send the certified report','and then ship it along','and then send it because it covers your product','and then send it and approve your discount','and then send it regardless of the result','and if it does not, I will send it anyway'])test(`${company.name}: delivery grammar does not swallow added meaning ${tail}`,()=>{
  const say=`I'll check whether the ${report} covers ${product} ${tail}.`;
  assert.equal(investigationThenDocumentDelivery(say),undefined);
  assert.equal(needsFactCheck(say,fixture(company)),true);
 });
 test(`${company.name}: negative suitability limitation does not negate the positive document/product link`,()=>{
  const input=fixture(company,true);
  for(const say of [
   'It documents the inspection of the tested sample, but it does not guarantee suitability for your application.',
   'It documents the inspection of tested samples, but it does not guarantee suitability for your application.',
   `Our ${report} covers ${product}, but it does not certify future batches.`,
  ]){
   const result=assessDocumentProductCoverage(say,input,input.sources);
   assert.equal(result?.pending,true,say);
   assert.deepEqual(result?.candidateSourceIds,['scope'],say);
   assert.equal(result?.verificationBoundary,undefined,say);
   assert.equal(literalDocumentScopeEvidence(say,input,input.sources),undefined,'Content and singular→plural scope are not proven by a document link.');
  }
  assert.equal(assessDocumentProductCoverage(`The ${report} does not cover ${product}.`,input,input.sources)?.pending,undefined);
 });
 test(`${company.name}: literal support requires the entire same-source coverage proposition`,()=>{
  const input=fixture(company,true);
  for(const say of [`The ${report} covers ${product}.`,`Yes, our approved ${report} explicitly covers ${product}.`,`The ${report} ${company.id} covers ${product}.`]){
   const result=literalDocumentScopeEvidence(say,input,input.sources);
   assert.equal(result?.sourceId,'scope',say);
   assert.equal(result?.quote,input.sources.find(source=>source.id==='scope').text,'Cite original wording, not the normalized parser representation.');
  }
  const possession=`We have an approved ${report} that explicitly covers our ${product}.`;
  const proof=literalDocumentScopeEvidence(possession,input,input.sources);
  assert.equal(proof?.sourceId,'scope');
  assert.deepEqual(proof.evidence.map(item=>item.sourceId),['scope','availability']);
  assert.equal(literalDocumentScopeEvidence(possession,input,input.sources.filter(source=>source.id!=='availability')),undefined,'Coverage alone is not an unrestricted availability proof.');
  assert.equal(literalDocumentScopeEvidence(possession,input,[...input.sources,{id:'restriction',text:`The ${report} is available only after written manager approval.`}]),undefined,'An affirmative list does not override another original release restriction.');
  assert.equal(literalDocumentScopeEvidence(possession.replace('that explicitly covers', 'that guarantees the suitability of'),input,input.sources),undefined);
  const headNoun=company.category.endsWith('valves')?'valve':'mesh';
  assert.equal(literalDocumentScopeEvidence(`The ${report} covers ${product} ${headNoun}.`,input,input.sources)?.sourceId,'scope','Omitting sourced noun modifiers does not broaden the identified product.');
  assert.equal(literalDocumentScopeEvidence(`The ${report} covers ${product} certified ${headNoun}.`,input,input.sources),undefined);
  for(const say of [
   `The ${report} covers ${product} and guarantees application suitability.`,
   `The ${report} covers ${product}, so every batch meets your requirements.`,
   `The ${report} covers ${product} for every batch.`,
   `The ${report} covers ${product} based on tested samples.`,
   `The ${report}s cover ${product}.`,
   `The ${report} covers ${product}. We can ship Friday.`,
   `The ${report} covers ${product} at no charge.`,
   `The ${report} does not cover ${product}.`,
   `The ${report} OTHER-2026 covers ${product}.`,
   `The ${report} covers XX99.`,
  ])assert.equal(literalDocumentScopeEvidence(say,input,input.sources),undefined,say);
  for(const sources of [[],[{id:'source',text:`The ${report} covers ${product}.`,original:false}],[{id:'source',text:`The ${report} covers ${product}.`,complete:false}],[{id:'source',text:`Archived ${report} covers ${product}.`}],[{id:'source',text:`The ${report} covers ${product} only if approved.`}],[{id:'source',text:`The ${report} covers ${product}. It does not cover future batches.`}]]){
   assert.equal(literalDocumentScopeEvidence(`The ${report} covers ${product}.`,input,sources),undefined);
  }
 });
 test(`${company.name}: source-known product typography retains source linkage without changing scope`,()=>{
  const input=fixture(company,true),variant=product.replace(/([A-Z])(\d)/,'$1–$2');
  assert.equal(literalDocumentScopeEvidence(`The ${report} covers ${variant}.`,input,input.sources)?.sourceId,'scope');
  assert.equal(assessDocumentProductCoverage(`The ${report} covers ${variant}.`,input,input.sources)?.pending,true);
  assert.equal(literalDocumentScopeEvidence(`The ${report} covers XX–99.`,input,input.sources),undefined);
 });
 test(`${company.name}: local proof considers conflicting originals and ambiguous report identities`,()=>{
  const input=fixture(company,true),say=`The ${report} covers ${product}.`;
  for(const conflict of [
   `The ${report} does not cover ${product}.`,
   `The ${report} covers ${product} only for the tested batch.`,
   `The ${report} covers ${product} for the tested batch.`,
   `The ${report} covers ${product} in the pilot run.`,
   `The ${report} excludes ${product}.`,
   `The ${report} covers ${product} subject to project approval.`,
   `The ${report} covers ${product}. It does not cover future batches.`,
   `The ${report} OTHER-2026 covers ${product}.`,
  ])assert.equal(literalDocumentScopeEvidence(say,input,[...input.sources,{id:'conflict',text:conflict}]),undefined,conflict);
  const other={id:'other-report',text:`The ${report} OTHER-2026 does not cover ${product}.`};
  assert.equal(literalDocumentScopeEvidence(`The ${report} ${company.id} covers ${product}.`,input,[...input.sources,other])?.sourceId,'scope','An explicitly different report does not negate the exact named report.');
  const same={id:'same-report',text:`The ${report} ${company.id} does not cover ${product}.`};
  assert.equal(literalDocumentScopeEvidence(`The ${report} ${company.id} covers ${product}.`,input,[...input.sources,same]),undefined);
 });
 test(`${company.name}: unknown report linkage still fails with an accurate negative limitation`,()=>{
  const input=fixture(company);
  const say=`Our ${report} covers ${product}, but it does not certify suitability.`;
  assert.equal(assessDocumentProductCoverage(say,input,input.sources)?.verificationBoundary,'document_product_scope');
  assert.ok(assessReplyVerification(say,input).unsupportedClaims.length);
 });
}
