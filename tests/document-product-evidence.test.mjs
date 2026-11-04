import assert from 'node:assert/strict';
import test from 'node:test';
import {assessDocumentProductCoverage,isBoundedEpistemicFactAction,requestsDocumentProductCoverage} from '../lib/document-product-evidence.ts';
import {assessReplyVerification,classifyBuyerTurn} from '../lib/turn-verification-policy.ts';
import {needsFactCheck} from '../lib/call-coaching.ts';
import {MAIN_LINE_CHECK} from '../lib/claim-check.ts';
import {ON_DEMAND_COACHING_RULES,onDemandDecisionRules} from '../lib/on-demand-coaching.ts';

// Deliberately fictional product and source fixtures. No saved call data.
const catalog={id:'catalog',text:'Company profiles, PX10 and PX20 specification sheets, and material test reports are available for review.'};
const product={id:'product',text:'PX20 is 70 mesh per inch, made from 316 stainless steel.'};
const question='Can you confirm whether the material test report covers our exact 70 mesh 316 stainless mesh?';
const context=(sources=[catalog,product],buyer=question)=>({manufacturer:{id:'fictional-parts',name:'Fictional Parts',products:'PX10 and PX20 industrial mesh'},sources,turns:[{role:'buyer',text:buyer}],coachingRequest:{id:'fictional-scope',requestedAt:1}});
const rejected=[
 'The material test report we have is for our PX20 mesh.',
 'We do have a material test report available for our 70 mesh 316 stainless steel.',
 'Our material test report covers PX20.',
 'The material test report applies to PX20.',
 'Our material test report concerns PX20.',
 'We can send our PX20 material test report.',
 'Your engineer can review our material test report for PX20.',
 "I'll include a material test report suitable for PX20.",
 'For our PX20 mesh, we have a material test report.',
 'The material test report contains test data for PX20.',
 'The material test report covers that exact mesh.',
 'Yes, it does.',
];
for(const say of rejected)test('Generic availability plus a separate product fact does not support scope: '+say,()=>{
 const input=context(),result=assessReplyVerification(say,input);
 assert.ok(result.unsupportedClaims.some(claim=>/document-to-product coverage/.test(claim.reason)));
 assert.ok(result.unsupportedClaims.some(claim=>claim.verificationBoundary==='document_product_scope'));
 assert.equal(result.pendingClaims.length,0,'Absent linkage is rejected locally, not offered to a semantic checker with unrelated evidence.');
 assert.equal(result.requiresVerification,true);
});

test('Scope questions are factual requests even without a specification keyword',()=>{
 const input=context(undefined,'Does the test report cover PX20?');
 assert.equal(requestsDocumentProductCoverage(input.turns[0].text),true);
 assert.equal(classifyBuyerTurn(input).kind,'fact_request');
 assert.ok(classifyBuyerTurn(input).factTopics.includes('document_coverage'));
 assert.equal(requestsDocumentProductCoverage('Please include the test report with your reply.'),false);
});

for(const say of [
 "I'll confirm whether the material test report covers PX20.",
 "I'll check if the report applies to that exact mesh.",
 "We need to verify whether the material test report covers PX20.",
 "I can’t confirm whether the report covers PX20 yet.",
 "I don’t know whether that report covers PX20.",
 "I'll include the material test report with the specifications.",
 'They can review our material test report for reference.',
])test('Verification actions and unqualified document review do not assert coverage: '+say,()=>{
 const result=assessReplyVerification(say,context());
 assert.equal(result.unsupportedClaims.length,0);
 assert.equal(result.pendingClaims.length,0);
 if(/whether|if the report applies/.test(say))assert.equal(needsFactCheck(say,context()),false,'An explicit unresolved scope must not trigger a second remote verdict.');
});

test('A promise to check cannot hide an appended coverage assertion',()=>{
 const result=assessReplyVerification("I'll confirm whether the report covers PX20, but our material test report is for PX20.",context());
 assert.ok(result.unsupportedClaims.length);
 assert.ok(assessReplyVerification("I can’t confirm whether the report covers PX20 yet, but our material test report is for PX20.",context()).unsupportedClaims.length);
 for(const say of ["I'll confirm whether the report covers your mesh; it covers PX20.","I'll check whether the report covers your mesh. It applies to PX20."])assert.ok(assessReplyVerification(say,context()).unsupportedClaims.some(claim=>claim.verificationBoundary==='document_product_scope'),say);
});

test('An epistemic report-scope check may repeat the buyer’s value/property without a semantic round',()=>{
 const input=context([]);
 const say="Thanks for raising that. I'll confirm whether the material test report covers your exact 70 mesh 316 stainless and follow up with the result.";
 const assessment=assessReplyVerification(say,input);
 assert.deepEqual(assessment.unsupportedClaims,[]);
 assert.deepEqual(assessment.pendingClaims,[]);
 assert.equal(assessment.requiresVerification,false);
 assert.equal(needsFactCheck(say,input),false);
 for(const verb of ['double-check','double check']){
  const careful=`I’ll ${verb} whether the material test report covers your exact 70 mesh 316 stainless and confirm that for you before sending the documents.`;
  const checked=assessReplyVerification(careful,input);
  assert.deepEqual(checked.unsupportedClaims,[]);
  assert.equal(checked.requiresVerification,false);
  assert.equal(needsFactCheck(careful,input),false);
  assert.ok(assessReplyVerification(`I’ll ${verb} whether the material test report covers your mesh; it covers PX20.`,input).unsupportedClaims.some(claim=>claim.verificationBoundary==='document_product_scope'));
 }
 for(const prefix of ["I'll definitely check if",'Let me check whether','Let us personally verify whether',"I'll certainly double-check whether",'We can personally confirm if']){
  const natural=`${prefix} the material test report covers your exact 70 mesh 316 stainless mesh and let you know.`;
  assert.equal(isBoundedEpistemicFactAction(natural),true,natural);
  const checked=assessReplyVerification(natural,input);
  assert.deepEqual(checked.unsupportedClaims,[],natural);
  assert.equal(checked.requiresVerification,false,natural);
  assert.equal(needsFactCheck(natural,input),false,natural);
  for(const tail of ['; it covers PX20.',' and we have the PX20 material test report.',' and let you know shortly.']){
   const appended=natural.replace(/\.$/,'')+tail;
   assert.equal(isBoundedEpistemicFactAction(appended),false,appended);
   assert.ok(assessReplyVerification(appended,input).unsupportedClaims.length,appended);
  }
 }
 for(const changed of [
  "I'll confirm whether the material test report covers 71 mesh 316 stainless.",
  "I'll confirm whether the material test report covers 70 mm 316 stainless.",
  "I'll confirm whether the material test report covers 70 mesh 316 stainless. We can offer it at $9.",
  "I'll confirm whether the material test report covers 70 mesh 316 stainless and send you a free sample.",
  "I'll confirm whether the report covers 70 mesh 316 stainless tomorrow.",
  'Our product is 70 mesh 316 stainless.',
 ])assert.ok(assessReplyVerification(changed,input).unsupportedClaims.length,changed);
});

test('Current coverage evidence produces a targeted first-attempt move without a scripted answer',()=>{
 const rules=onDemandDecisionRules(context());
 assert.match(rules,/DOCUMENT COVERAGE QUESTION — EVIDENCE GAP/);
 assert.match(rules,/first spoken output one concise acknowledgment and an explicit commitment to check whether/);
 assert.match(rules,/not an approved “\[product\] report”/);
 assert.match(rules,/No permission question or new discovery is needed/);
 const linked=context([{id:'linked',text:'The material test report covers PX20.'}],'Does the material test report cover PX20?');
 assert.match(onDemandDecisionRules(linked),/DOCUMENT COVERAGE QUESTION — ORIGINAL LINK CANDIDATE/);
 assert.doesNotMatch(onDemandDecisionRules(context(undefined,'Please include the test report.')),/DOCUMENT COVERAGE QUESTION/);
});

for(const source of [
 {id:'linked',text:'The material test report covers PX20.'},
 {id:'linked',text:'A PX20 material test report is available for review.'},
 {id:'linked',text:'The material test report is available for PX20.'},
 {id:'linked',text:'PX20 has a material test report.'},
])test('An explicit same-document/same-product link is eligible for the ordinary source check: '+source.text,()=>{
 const result=assessDocumentProductCoverage('Our material test report covers PX20.',context([source,product]),[source,product]);
 assert.equal(result?.pending,true);
 assert.deepEqual(result?.candidateSourceIds,['linked']);
});

for(const [name,source]of[
 ['other product',{id:'other',text:'A material test report covers PX10.'}],
 ['other document type',{id:'other',text:'An inspection report covers PX20.'}],
 ['only a spec-sheet link',{id:'other',text:'PX20 specification sheets and material test reports are available for review.'}],
 ['source mentions separate facts',{id:'other',text:'PX20 has a published specification. A material test report is available for review.'}],
 ['unconfirmed',{id:'other',text:'A material test report may cover PX20.'}],
 ['negated',{id:'other',text:'The material test report does not cover PX20.'}],
 ['truncated',{id:'other',text:'The material test report covers PX20.',complete:false}],
 ['stale',{id:'other',title:'Archived material report',text:'The material test report covers PX20.'}],
 ['extracted summary',{id:'other',text:'The material test report covers PX20.',original:false}],
])test('Scope is not established by '+name,()=>{
 const result=assessDocumentProductCoverage('The material test report covers PX20.',context([source]),[source]);
 assert.equal(result?.supported,false);
 assert.equal(result?.pending,undefined);
});

test('A product description resolves identity but cannot supply the missing report relationship',()=>{
 const linked={id:'linked',text:'The material test report covers PX20.'};
 const result=assessDocumentProductCoverage('The material test report is for our 70 mesh 316 stainless steel.',context([linked,product]),[linked,product]);
 assert.equal(result?.pending,true);
 assert.deepEqual(result?.candidateSourceIds,['linked']);
 assert.equal(assessDocumentProductCoverage('The material test report is for our 70 mesh 316 stainless steel.',context(),[catalog,product])?.pending,undefined);
});

test('A qualified sheet in a combined send does not qualify the neighbouring unqualified report',()=>{
 const result=assessReplyVerification("I'll include the material test report and PX20 spec sheet in the email.",context());
 assert.equal(result.unsupportedClaims.length,0);
 assert.ok(!result.claims.some(claim=>claim.verificationBoundary==='document_product_scope'));
 assert.equal(result.pendingClaims.length,0,'A grounded qualified sheet and a bare available report need no semantic round.');
 assert.ok(assessReplyVerification("I'll include the PX20 material test report and spec sheet in the email.",context()).unsupportedClaims.some(claim=>claim.verificationBoundary==='document_product_scope'));
});

test('Buyer assertions and extracted Brain facts do not establish company report scope',()=>{
 const input=context();
 input.turns=[{role:'buyer',text:'Your material test report covers PX20, correct?'}];
 input.brain={facts:[{text:'The material test report covers PX20.',sourceId:catalog.id,quote:catalog.text,confirmed:true}]};
 const result=assessReplyVerification('Yes, the material test report covers PX20.',input);
 assert.ok(result.unsupportedClaims.some(claim=>/document-to-product coverage/.test(claim.reason)));
});

test('Generation and semantic checking share the relationship requirement',()=>{
 for(const rules of [ON_DEMAND_COACHING_RULES,MAIN_LINE_CHECK]){
  assert.match(rules,/Document availability (?:and product coverage are separate|does not establish product coverage)/);
  assert.match(rules,/generic (?:list of available reports|document list) plus (?:a )?separate product/i);
  assert.match(rules,/paraphrase/i);
 }
});

test('A courtesy joined by punctuation preserves the bounded scope-check action',()=>{
 for(const prefix of ['Thanks for asking—','Thanks for raising that, ','Of course: ','Of course, ']){
  const say=prefix+"I'll double-check if the material test report covers your exact 70 mesh 316 stainless mesh and confirm that for you.";
  const result=assessReplyVerification(say,context());
  assert.equal(result.unsupportedClaims.length,0,say);
  assert.equal(result.pendingClaims.length,0,say);
  assert.equal(needsFactCheck(say,context()),false,say);
 }
 assert.ok(assessReplyVerification("Thanks for asking—our material test report covers PX20.",context()).unsupportedClaims.length);
 assert.ok(assessReplyVerification("Thanks for asking—I'll check if the report covers PX20, but our report covers PX20.",context()).unsupportedClaims.length);
});
