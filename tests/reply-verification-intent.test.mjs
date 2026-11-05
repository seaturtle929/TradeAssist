import assert from 'node:assert/strict';
import test from 'node:test';
import {assessReplyVerification,isNonAssertiveReply} from '../lib/turn-verification-policy.ts';
import {needsFactCheck} from '../lib/call-coaching.ts';
import {defaultConfigurationStages} from '../lib/sales-curriculum.ts';
import {configurationSuggestionProblems} from '../lib/coaching-configuration.ts';

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
  `I'll check whether we have a ${report} for ${product}.`,
  'I can verify the coverage and let you know.',
  `Could I check whether the ${report} covers ${product}?`,
  `Hi Priya, I'll confirm whether the ${report} covers ${product} before we send it. Let me check that detail and get back to you.`,
  `Hello, Priya, I'll check whether the ${report} covers ${product}, and I will get back to you.`,
  'Let me check that detail and get back to you.',
  "I'll verify the information and report back with the findings.",
  "Hello Priya. I'll check this detail and let you know.",
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
  assert.equal(isNonAssertiveReply(say,assessment.claims,request),true);
  assert.equal(needsFactCheck(say,request),false);
 });
 for(const tail of [
  'and get back to you with that information',
  'and get back to you with that detail',
  'and get back to you on that',
  'and come back to you with the findings',
  'and follow up with you with an update',
  'and report back to you with the outcome',
  'and let you know what I find',
  'and tell you what we learn',
  'and let you know whether it does',
  'and confirm that for you before I email it',
  'and confirm back before sending it',
  'and confirm back before sending',
  'and follow up before sending',
  'and confirm to you before I send',
  'and follow up with you',
  'and get back to you with an answer',
  'and get back to you with a clear answer',
  'and report back with specific findings',
  'and follow up with a written clarification',
  'and let you know, before sending it over',
  'and confirm back with you before sending it',
  'and confirm to you before I email it over',
  'and follow up with you once I have that answer',
  "and get back to you once I've confirmed it",
  'and let you know after we have the results',
  "and report back when we've verified the coverage",
  'and get back to you with that before sending it',
  'and will get back to you',
  "and I'll report back with the findings",
  'and we can let you know the answer',
  'and get back to you with the clarification before sending the documents',
 ])test(`${company.name}: neutral reporting of the eventual result stays unresolved: ${tail}`,()=>{
  const request=context(company),say=`Thanks for your question, Priya. I'll check whether our ${report} covers ${product} ${tail}.`,assessment=assessReplyVerification(say,request);
  assert.deepEqual(assessment.unsupportedClaims,[],say);
  assert.deepEqual(assessment.pendingClaims,[],say);
  assert.equal(isNonAssertiveReply(say,assessment.claims,request),true,say);
  assert.equal(needsFactCheck(say,request),false,say);
 });
 for(const courtesy of ['Thanks for letting me know.','Priya, thanks for your question.','Thanks for confirming, Priya.','Thank you for sharing that.','Thanks for clarifying—','Got it.','Thanks for keeping us informed.','Thanks for that, Priya.','Thank you for this.',...['this','that','the','your'].flatMap(determiner=>['question','update','clarification','information'].map(noun=>`Thanks for ${determiner} ${noun}, Priya.`))])test(`${company.name}: neutral conversational acknowledgment does not reclassify the next investigation: ${courtesy}`,()=>{
  const request=context(company),say=`${courtesy} I'll check whether the ${report} covers ${product} and get back to you before sending it.`,assessment=assessReplyVerification(say,request);
  assert.deepEqual(assessment.unsupportedClaims,[],say);
  assert.equal(isNonAssertiveReply(say,assessment.claims,request),true,say);
  assert.equal(needsFactCheck(say,request),false,say);
 });
 for(const comma of ['',','])for(const auxiliary of ['', 'will ', "I'll ", 'we will '])test(`${company.name}: punctuation and repeated subject preserve the same neutral coordinator: ${comma} and ${auxiliary}`,()=>{
  const request=context(company),say=`Thanks for that, Priya. I'll check whether the ${report} covers ${product}${comma} and ${auxiliary}get back to you before sending it.`;
  const assessment=assessReplyVerification(say,request);
  assert.deepEqual(assessment.unsupportedClaims,[],say);
  assert.equal(needsFactCheck(say,request),false,say);
  for(const suffix of ['confirm that it covers your product','give you an approved discount','get back to you tomorrow']){
   const unsafe=`I'll check whether the ${report} covers ${product}${comma} and ${auxiliary}${suffix}.`;
   assert.equal(needsFactCheck(unsafe,request),true,unsafe);
   assert.equal(isNonAssertiveReply(unsafe,assessReplyVerification(unsafe,request).claims),false,unsafe);
  }
 });
 for(const continuation of [', then we can send it over',' and then I will email it to you',", then I'll share that report"])
 test(`${company.name}: check and follow-through can precede an available document send: ${continuation}`,()=>{
  const request=context(company),say=`I'll check whether our ${report} covers ${product} and let you know${continuation}.`;
  const assessment=assessReplyVerification(say,request);
  assert.deepEqual(assessment.unsupportedClaims,[],say);
  assert.equal(needsFactCheck(say,request),false,say);
  assert.ok(assessment.supportedClaims.some(claim=>claim.sourceId==='availability'));
  for(const unavailable of [[],[{id:'missing',text:`The ${report} is not available.`}],[{id:'specs-only',text:`${product} specifications are available.`}]]){
   const absent={...request,sources:unavailable};
   assert.ok(assessReplyVerification(say,absent).unsupportedClaims.length,'A proposed send still needs the requested document.');
   assert.equal(needsFactCheck(say,absent),true);
  }
 });
 for(const topic of [product,'the report','coverage','your requirements'])test(`${company.name}: naming a question's topic asserts no answer: ${topic}`,()=>{
  const request=context(company),say=`Thank you for asking about ${topic}. I'll check whether the ${report} covers that product and get back to you with a clear answer.`,assessment=assessReplyVerification(say,request);
  assert.deepEqual(assessment.unsupportedClaims,[],say);
  assert.equal(isNonAssertiveReply(say,assessment.claims,request),true,say);
  assert.equal(needsFactCheck(say,request),false,say);
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
  `Thanks for confirming our ${report} covers ${product}. I'll check the details.`,
  `Thanks for asking about our ${product} ${report}. I'll check the details.`,
  `Thanks for that update confirming our ${report} covers ${product}. I'll check the details.`,
  `Thanks for that ${report} covering ${product}. I'll check the details.`,
  `Hi Priya, our ${report} covers ${product}.`,
  `Hello Morgan, I'll check the details and confirm that our ${report} covers ${product}.`,
  `I'll look into what our ${product} ${report} contains.`,
  `I'll check whether the ${report} we have for ${product} includes your test.`,
  `I'll check whether the ${report} that we have for ${product} includes your test.`,
  `I'll check what our ${report} for ${product} contains.`,
  `I'll check whether our ${report} for ${product} contains that result.`,
  `I'll check the coverage. It definitely includes your exact product.`,
  `Thanks for asking. That ${report} includes your exact product.`,
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
  'and get back to you with confirmation that it covers your product',
  'and let you know it is certified',
  'and get back to you with a guaranteed result',
  'and follow up with you with an approved discount',
  'and get back to you with that information tomorrow',
  'and confirm back before sending tomorrow',
  'and follow up before shipping',
  'and get back to you right now',
  'and get back to you on Friday',
  'and report back with confirmation of coverage',
  'and confirm back with you that it covers your product',
  'and let you know, before sending it over tomorrow',
  'and let you know, our report covers your product',
  "and get back to you once I've confirmed it covers your product",
  'and follow up with you once we approve your discount',
  ', then we can send it tomorrow',
  ', then we can ship it over',
  ', then we can send it and approve your discount',
  ', then we can send it because it proves your product is certified',
 ])test(`${company.name}: an attached assertion is not an ordinary offer to check: ${tail}`,()=>{
  const request=context(company),say=`I'll check whether the report covers ${product} ${tail}.`,assessment=assessReplyVerification(say,request);
  assert.equal(isNonAssertiveReply(say,assessment.claims),false,say);
  assert.equal(needsFactCheck(say,request),true,say);
 });
 test(`${company.name}: a complete literal scope claim can be proven from its approved link`,()=>{
  const request=context(company,true),say=`The ${report} covers ${product}.`,assessment=assessReplyVerification(say,request);
  assert.equal(assessment.unsupportedClaims.length,0);
  assert.ok(assessment.localEvidence.some(item=>item.sourceId==='scope'));
  assert.equal(assessment.locallyVerifiedWholeReply,true);
  assert.equal(needsFactCheck(say,request),false);
  assert.equal(isNonAssertiveReply(say,assessment.claims),false);
 });
 test(`${company.name}: a named report identifier and company label preserve the original scope link and limitations`,()=>{
  const request=context(company),say=`The ${report} covers ${product}.`;
  const source={id:'named-report',text:`Approved ${report} IR-${product}-2026 explicitly covers Example ${product} products. It records the inspection of the tested sample; it does not certify application suitability, guaranteed service life, or future batches.`};
  request.sources.push(source);
  const assessment=assessReplyVerification(say,request);
  assert.equal(assessment.unsupportedClaims.length,0);
  assert.ok(assessment.localEvidence.some(item=>item.sourceId===source.id));
  assert.equal(needsFactCheck(say,request),false);
  const namedSay=`Our ${report} IR-${product}-2026 does cover ${product}.`;
  const namedAssessment=assessReplyVerification(namedSay,request);
  assert.deepEqual(namedAssessment.unsupportedClaims,[],namedSay);
  assert.ok(namedAssessment.localEvidence.some(item=>item.sourceId===source.id));
  assert.ok(namedAssessment.supportedClaims.some(claim=>claim.text===`IR-${product}-2026`&&claim.sourceId===source.id));
  assert.equal(needsFactCheck(namedSay,request),false,'The full closed scope assertion is proven; recognizing only the identifier would not suffice.');
  for(const unknown of [namedSay.replace('-2026','-2027'),namedSay.replace(`IR-${product}-2026`,`IR-ZZ99-2026`)])assert.ok(assessReplyVerification(unknown,request).unsupportedClaims.some(claim=>/document identifier/.test(claim.reason)),unknown);
  const promised=`The ${report} covers ${product} and guarantees your product performance.`;
  assert.equal(needsFactCheck(promised,request),true);
  assert.equal(isNonAssertiveReply(promised,assessReplyVerification(promised,request).claims),false);
  for(const replacement of [
   {...source,text:source.text.replace(`covers Example ${product}`, 'covers Example XX90')},
   {...source,text:source.text.replace('explicitly covers','does not cover')},
   {...source,text:source.text.replace('explicitly covers','may cover')},
   {...source,complete:false},
   {...source,text:`Approved ${report} IR-${product}-2026 is available. ${product} product specifications are available.`},
  ]){
   const other={...request,sources:[...request.sources.filter(item=>item.id!==source.id),replacement]};
   assert.ok(assessReplyVerification(say,other).unsupportedClaims.some(claim=>claim.verificationBoundary==='document_product_scope'),replacement.text);
  }
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
 'Delivery is Friday.',
 'The shipment will be Friday.',
 'Certification is guaranteed.',
 'The discount is approved.',
])test('A follow-through sentence cannot exempt a separate restricted promise: '+added,()=>{
 const request=context(companies[0]),say="Thanks for asking, Priya. I'll check whether the report covers PX20. "+added;
 const assessment=assessReplyVerification(say,request);
 assert.ok(assessment.unsupportedClaims.length,added);
 assert.equal(isNonAssertiveReply(say,assessment.claims),false);
 assert.equal(needsFactCheck(say,request),true);
});

test('A declarative commercial subject remains checked after a nonfactual buyer acknowledgment',()=>{
 const request=context(companies[0]);request.turns=[{role:'buyer',text:'Thank you, that helps.'}];
 for(const say of ['Delivery is Friday.','Shipment will be tomorrow.','The discount is approved.','Certification is guaranteed.']){
  assert.ok(assessReplyVerification(say,request).unsupportedClaims.length,say);
  assert.equal(needsFactCheck(say,request),true,say);
 }
});

test('Unknown predicates on a factual turn cannot fall through a keyword-only exemption',()=>{
 const request=context(companies[0]);
 for(const say of ["I'll check the details. The answer is affirmative.","I'll check the scope. That settles the technical question."]){
  const assessment=assessReplyVerification(say,request);
  assert.equal(isNonAssertiveReply(say,assessment.claims),false,say);
  assert.equal(needsFactCheck(say,request),true,say);
 }
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

test('Document approval and a tested sample do not assert commercial sample authority',()=>{
 const request=context(companies[1]),stages=defaultConfigurationStages();
 const snapshot={id:'synthetic-doc-approval',companyId:companies[1].id,version:1,activatedAt:1,stages,knowledge:[],boundaries:[],preferences:[],legacyNotes:[]};
 request.companyConfiguration={companyId:companies[1].id,versionId:snapshot.id,version:1,boundAt:1,selectedStageId:stages[2].id,snapshot};
 const supported='Our approved inspection report explicitly covers QV80 and records the tested sample’s material chemistry.';
 assert.deepEqual(configurationSuggestionProblems(supported,request),[]);
 for(const added of ['An additional sample is approved.','The discount is authorized.','We are permitted to ship a sample.'])assert.ok(configurationSuggestionProblems(supported+' '+added,request).length,added);
 assert.ok(configurationSuggestionProblems(supported+' and a new sample is approved.',request).length);
});
