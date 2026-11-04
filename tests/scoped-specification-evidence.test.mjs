import assert from 'node:assert/strict';
import test from 'node:test';
import {assessReplyVerification} from '../lib/turn-verification-policy.ts';
import {literalSpecificationEvidence,specificationNumberEvidence} from '../lib/scoped-specification-evidence.ts';

// Entirely invented mesh products and dimensions. No customer data or model calls.
const source={id:'fictional-specification',title:'Approved mesh specification',text:'ZX70 is 70 mesh per inch, made from 316 stainless steel. Its published nominal opening is 0.37 mm.'};
const context=(sources=[source])=>({manufacturer:{id:'fictional-mesh',name:'Fictional Mesh',products:'woven mesh'},sources,turns:[{role:'buyer',text:'What is the nominal opening of ZX70?'}],coachingRequest:{id:'fictional-request',requestedAt:0}});
const checks=say=>assessReplyVerification(say,context());

for(const say of [
 'ZX70 has a nominal opening of 0.37 mm.',
 "ZX70's published nominal opening is 0.37 mm.",
 'Our ZX70 mesh has a published nominal opening of 0.37 mm.',
 'ZX70 has a 0.37 mm nominal opening.',
 'ZX70 is 70 mesh 316 stainless, with a 0.37 mm nominal opening.',
 'ZX70 is 70 mesh per inch, made from 316 stainless steel, with a nominal opening of 0.37 mm.',
])test('Literal supported specification: '+say,()=>{
 const result=checks(say);
 assert.deepEqual(result.unsupportedClaims,[]);
 assert.deepEqual(result.pendingClaims,[]);
 assert.ok(result.supportedClaims.length);
 assert.equal(literalSpecificationEvidence(say,[source])?.id,source.id);
});

for(const [name,say] of [
 ['wrong product','ZX71 has a nominal opening of 0.37 mm.'],
 ['wrong value','ZX70 has a nominal opening of 0.38 mm.'],
 ['wrong property','ZX70 has a nominal wire diameter of 0.37 mm.'],
 ['wrong unit','ZX70 has a nominal opening of 0.37 um.'],
 ['different scale','ZX70 has a nominal opening of 0.37 cm.'],
 ['qualification dropped','ZX70 has an opening of 0.37 mm.'],
 ['wrong mesh count','ZX70 is 71 mesh per inch.'],
 ['wrong material grade','ZX70 is made from 304 stainless steel.'],
])test('Reject '+name,()=>{
 const result=checks(say);
 assert.ok(result.unsupportedClaims.some(claim=>claim.kind==='number'));
 assert.equal(literalSpecificationEvidence(say,[source]),undefined);
});

for(const say of [
 'ZX70 has an exact nominal opening of 0.37 mm.',
 'ZX70 has a guaranteed nominal opening of 0.37 mm.',
 'ZX70 has a nominal opening of 0.37 mm and filters every particle.',
 'ZX70 has a nominal opening of 0.37 mm, which guarantees your flow rate.',
])test('Numeric support does not certify an added predicate: '+say,()=>{
 assert.equal(literalSpecificationEvidence(say,[source]),undefined);
 assert.ok(checks(say).unsupportedClaims.length||checks(say).pendingClaims.length);
});

test('A neighboring product cannot lend its value',()=>{
 const sources=[{id:'two-products',text:'ZX70 mesh has a nominal opening of 0.37 mm. ZX71 mesh has a nominal opening of 0.55 mm.'}];
 const result=assessReplyVerification('ZX70 mesh has a nominal opening of 0.55 mm.',context(sources));
 assert.ok(result.unsupportedClaims.some(claim=>claim.kind==='number'));
});
test('Ambiguous pronoun is not assigned to either product',()=>{
 const sources=[{id:'ambiguous',text:'ZX70 and ZX71 are woven mesh products. Its nominal opening is 0.37 mm.'}];
 assert.equal(literalSpecificationEvidence('ZX70 has a nominal opening of 0.37 mm.',sources),undefined);
 assert.ok(assessReplyVerification('ZX70 has a nominal opening of 0.37 mm.',context(sources)).unsupportedClaims.some(claim=>claim.kind==='number'));
});
test('An unrelated intervening sentence breaks pronoun scope',()=>{
 const sources=[{id:'distant',text:'ZX70 is 70 mesh per inch. We also offer other products. Its nominal opening is 0.37 mm.'}];
 assert.equal(literalSpecificationEvidence('ZX70 has a nominal opening of 0.37 mm.',sources),undefined);
});
test('No cross-source borrowing of product identity',()=>{
 const sources=[{id:'identity',text:'ZX70 is 70 mesh per inch.'},{id:'unscoped',text:'Its nominal opening is 0.37 mm.'}];
 assert.equal(literalSpecificationEvidence('ZX70 has a nominal opening of 0.37 mm.',sources),undefined);
});
test('A mentioned product is not the referent of a different subject',()=>{
 const sources=[{id:'mention-only',text:'An alternative to ZX70 is being designed. Its nominal opening is 0.37 mm.'}];
 assert.equal(literalSpecificationEvidence('ZX70 has a nominal opening of 0.37 mm.',sources),undefined);
 assert.ok(assessReplyVerification('ZX70 has a nominal opening of 0.37 mm.',context(sources)).unsupportedClaims.some(claim=>claim.kind==='number'));
});
test('A comparison cannot lend another subject property to the named product',()=>{
 const sources=[{id:'comparison-only',text:'Compared with ZX70, a different design has a nominal opening of 0.37 mm.'}];
 assert.equal(literalSpecificationEvidence('ZX70 has a nominal opening of 0.37 mm.',sources),undefined);
});
for(const [name,text,title]of[
 ['negation','ZX70 has no nominal opening of 0.37 mm.','Approved specification'],
 ['condition','ZX70 has a nominal opening of 0.37 mm only when tensioned.','Approved specification'],
 ['stale entry','ZX70 has a nominal opening of 0.37 mm.','Archived specification'],
 ['uncertain entry','ZX70 has an approximately nominal opening of 0.37 mm.','Approved specification'],
])test('Source requires interpretation: '+name,()=>{
 const sources=[{id:'qualified',text,title}];
 assert.equal(literalSpecificationEvidence('ZX70 has a nominal opening of 0.37 mm.',sources),undefined);
 assert.ok(assessReplyVerification('ZX70 has a nominal opening of 0.37 mm.',context(sources)).unsupportedClaims.some(claim=>claim.kind==='number'));
});
test('Conflicting applicable specification values fail closed',()=>{
 const sources=[source,{id:'conflict',text:'ZX70 has a nominal opening of 0.38 mm.'}];
 assert.equal(literalSpecificationEvidence('ZX70 has a nominal opening of 0.37 mm.',sources),undefined);
 assert.ok(assessReplyVerification('ZX70 has a nominal opening of 0.37 mm.',context(sources)).unsupportedClaims.some(claim=>claim.kind==='number'));
});
test('No numeric-substring match',()=>{
 const sources=[{id:'other-value',text:'ZX70 has a nominal opening of 10.37 mm.'}];
 assert.deepEqual(specificationNumberEvidence('0.37 mm','ZX70 has a nominal opening of 0.37 mm.',sources),{handled:true});
});
test('A source sign cannot be discarded to establish an unsigned magnitude',()=>{
 for(const sign of ['-','+']){
  const sources=[{id:'signed',text:`ZX70 has a ${sign}0.37 mm nominal opening.`}];
  assert.equal(literalSpecificationEvidence('ZX70 has a 0.37 mm nominal opening.',sources),undefined);
  assert.ok(assessReplyVerification('ZX70 has a 0.37 mm nominal opening.',context(sources)).unsupportedClaims.some(claim=>claim.kind==='number'));
 }
});
test('A signed claim is outside the unsigned literal grammar',()=>{
 for(const sign of ['-','+']){
  const say=`ZX70 has a ${sign}0.37 mm nominal opening.`;
  assert.equal(literalSpecificationEvidence(say,[source]),undefined);
  assert.ok(assessReplyVerification(say,context()).unsupportedClaims.some(claim=>claim.kind==='number'));
 }
});
test('Another company with its own supplied facts gets no borrowed evidence',()=>{
 const sources=[{id:'second-company',text:'QP82 has a nominal opening of 0.61 mm.'}];
 assert.equal(literalSpecificationEvidence('ZX70 has a nominal opening of 0.37 mm.',sources),undefined);
 assert.equal(literalSpecificationEvidence('QP82 has a nominal opening of 0.61 mm.',sources)?.id,'second-company');
});
test('A truncated excerpt cannot erase an unseen specification condition',()=>{
 const sources=[{...source,complete:false}];
 assert.equal(literalSpecificationEvidence('ZX70 has a nominal opening of 0.37 mm.',sources),undefined);
 const input=context(sources);
 input.brain={facts:[{confirmed:true,sourceId:source.id,text:'ZX70 has a nominal opening of 0.37 mm.',quote:source.text}]};
 assert.ok(assessReplyVerification('ZX70 has a nominal opening of 0.37 mm.',input).unsupportedClaims.some(claim=>claim.kind==='number'));
});
test('Value-before-property cannot borrow a different product specification',()=>{
 const sources=[{id:'different-product',text:'ZX71 mesh has a nominal opening of 0.37 mm.'}];
 const say='ZX70 has a 0.37 mm nominal opening.';
 assert.deepEqual(specificationNumberEvidence('0.37 mm',say,sources),{handled:true});
 assert.ok(assessReplyVerification(say,context(sources)).unsupportedClaims.some(claim=>claim.kind==='number'));
});
test('Unrecognized specification grammar fails closed instead of using a loose numeric match',()=>{
 const sources=[{id:'different-product',text:'ZX71 mesh has a nominal opening of 0.37 mm.'}];
 const say='ZX70 mesh has an opening measuring a nominal value of 0.37 mm.';
 assert.deepEqual(specificationNumberEvidence('0.37 mm',say,sources),{handled:true});
 assert.ok(assessReplyVerification(say,context(sources)).unsupportedClaims.some(claim=>claim.kind==='number'));
});
for(const summary of [
 'ZX70 has a nominal opening of 0.55 mm.',
 'ZX71 has a nominal opening of 0.37 mm.',
 'ZX70 has an opening of 0.37 mm.',
])test('An extracted Brain summary cannot create an original fact: '+summary,()=>{
 const input=context();
 input.brain={facts:[{confirmed:true,sourceId:source.id,text:summary,quote:source.text}]};
 assert.ok(assessReplyVerification(summary,input).unsupportedClaims.some(claim=>claim.kind==='number'));
 // A bad derived summary cannot contradict the correctly cited original.
 assert.deepEqual(assessReplyVerification('ZX70 has a nominal opening of 0.37 mm.',input).unsupportedClaims,[]);
});
for(const [name,text,say]of[
 ['centimeter mesh unit','ZX70 is 70 mesh per centimeter.','ZX70 is 70 mesh per inch.'],
 ['compact centimeter mesh unit','ZX70 is 70 mesh/cm.','ZX70 is 70 mesh per inch.'],
 ['buyer-claim centimeter mesh unit','ZX70 is 70 mesh per inch.','ZX70 is 70 mesh per centimeter.'],
 ['buyer-claim compact centimeter mesh unit','ZX70 is 70 mesh per inch.','ZX70 is 70 mesh/cm.'],
 ['source omits mesh-count unit','ZX70 is 70 mesh.','ZX70 is 70 mesh per inch.'],
 ['minimum bound','ZX70 opening is minimum 0.37 mm.','ZX70 opening is 0.37 mm.'],
 ['postfixed minimum bound','ZX70 opening is 0.37 mm minimum.','ZX70 opening is 0.37 mm.'],
 ['at-most bound','ZX70 opening is at most 0.37 mm.','ZX70 opening is 0.37 mm.'],
 ['tolerance','ZX70 opening is 0.37 mm ± 0.01 mm.','ZX70 opening is 0.37 mm.'],
 ['range','ZX70 opening is 0.37 mm to 0.50 mm.','ZX70 opening is 0.37 mm.'],
 ['measurement condition','ZX70 opening is 0.37 mm when measured at 100 degrees.','ZX70 opening is 0.37 mm.'],
 ['semicolon condition','ZX70 opening is 0.37 mm; measured under pressure.','ZX70 opening is 0.37 mm.'],
 ['adjacent preliminary qualifier','ZX70 opening is 0.37 mm. This value is preliminary.','ZX70 opening is 0.37 mm.'],
 ['adjacent measurement condition','ZX70 opening is 0.37 mm. This value is only measured at 100 degrees.','ZX70 opening is 0.37 mm.'],
 ['next-paragraph measurement condition','ZX70 opening is 0.37 mm.\n\nThis value is only measured at 100 degrees.','ZX70 opening is 0.37 mm.'],
])test('Original source suffix/qualifier is not discarded: '+name,()=>{
 const sources=[{id:'qualified-source',text}];
 assert.equal(literalSpecificationEvidence(say,sources),undefined);
 assert.ok(assessReplyVerification(say,context(sources)).unsupportedClaims.some(claim=>claim.kind==='number'));
});
test('A differently qualified complete source vetoes a clean matching source',()=>{
 const sources=[{id:'clean',text:'ZX70 opening is 0.37 mm.'},{id:'qualified',text:'ZX70 opening is 0.37 mm. This value is preliminary.'}];
 assert.equal(literalSpecificationEvidence('ZX70 opening is 0.37 mm.',sources),undefined);
 assert.ok(assessReplyVerification('ZX70 opening is 0.37 mm.',context(sources)).unsupportedClaims.some(claim=>claim.kind==='number'));
});
