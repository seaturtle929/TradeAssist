import assert from 'node:assert/strict';
import test from 'node:test';
import {canonicalizeKnownProductIdentifiers,productIdentityReferences} from '../lib/product-identity-evidence.ts';
import {literalSpecificationEvidence,specificationNumberEvidence} from '../lib/scoped-specification-evidence.ts';

// Authored fictional company facts; never copied from a customer workspace.
const source={id:'fictional-spec',text:'PX20 is 20 mesh per inch, made from 316 stainless steel. Its published nominal opening is 0.82 mm.'};
for(const dash of ['-','‐','‑','‒','–','—','―','−','﹣','－'])test(`Known complete product ID accepts typographic join ${dash}`,()=>{
 const text=`PX${dash}20 has a nominal opening of 0.82 mm.`,refs=productIdentityReferences(text,[source]);
 assert.equal(refs.length,1);assert.equal(refs[0].text,`PX${dash}20`);assert.equal(refs[0].canonical,'PX20');assert.equal(refs[0].sourceId,source.id);
 assert.equal(canonicalizeKnownProductIdentifiers(text,[source]),'PX20 has a nominal opening of 0.82 mm.');
 assert.equal(literalSpecificationEvidence(text,[source])?.id,source.id);
 assert.equal(specificationNumberEvidence('0.82 mm',text,[source]).source?.id,source.id);
});
test('Source typography normalizes in both directions and across companies',()=>{
 const other={id:'other-company',text:'QV–80 has a nominal opening of 0.29 mm.'};
 assert.equal(literalSpecificationEvidence('QV80 has a nominal opening of 0.29 mm.',[other])?.id,other.id);
 assert.equal(literalSpecificationEvidence('QV-80 has a nominal opening of 0.29 mm.',[other])?.id,other.id);
 assert.equal(productIdentityReferences('PX-20',[other]).length,0);
 assert.equal(productIdentityReferences('QV-80',[source]).length,0);
});
for(const text of ['PX-21','PX-200','PX-20B','PX-20-2026','IR-PX20-2026','40 mm','20 mm','ISO-9001','Al2O3','PX − 20','PX-20.5','PX20_99'])test('No numeric or unknown-identity exemption: '+text,()=>{
 const refs=productIdentityReferences(text,[source]);
 // A decimal suffix must not be treated as an exact model identity either.
 assert.deepEqual(refs,[]);
});
test('Document identifiers and derived summaries cannot create product identities',()=>{
 for(const source of [{id:'doc',text:'Material test report IR-PX20-2026 is available.'},{id:'doc',text:'Inspection report QV-80 is available.'},{id:'derived',text:'PX20 is available.',original:false}])assert.equal(productIdentityReferences('PX–20 and QV–80',[source]).length,0);
});
test('A known product ID never lends proof to a wrong number or unit',()=>{
 for(const say of ['PX–20 has a nominal opening of 0.83 mm.','PX–20 has a nominal opening of 0.82 cm.','PX–20 is 21 mesh per inch.'])assert.equal(literalSpecificationEvidence(say,[source]),undefined);
});
