import assert from 'node:assert/strict';
import test from 'node:test';
import {buyerProductIdentifierReferences,productIdentityReferences} from '../lib/product-identity-evidence.ts';
import {assessReplyVerification} from '../lib/turn-verification-policy.ts';

// Deliberately fictional identifiers and facts; no customer call fixture.
const buyer='Can you check whether the inspection report covers RX-73?';
const source={id:'cedar-catalog',text:'Cedar Instruments supplies QV80 inspection instruments. Inspection reports are available.'};
const context=(buyerText=buyer)=>({manufacturer:{id:'cedar',name:'Cedar Instruments',products:'QV80 inspection instruments'},sources:[source],turns:[{role:'buyer',text:buyerText}]});

test('A current buyer identifier is only a literal reference, never company evidence',()=>{
 const say="I'll check whether the inspection report covers RX-73 and let you know.";
 const refs=buyerProductIdentifierReferences(say,buyer);
 assert.equal(refs.length,1);assert.equal(say.slice(refs[0].start,refs[0].end),'RX-73');
 assert.equal(refs[0].buyerText,'RX-73');assert.equal(refs[0].sourceId,undefined);assert.equal(refs[0].canonical,undefined);
 assert.deepEqual(productIdentityReferences(say,[source]),[]);
});

for(const literal of ['RX-73','ZK–81','M29B'])test('A bounded check can repeat the exact buyer identifier: '+literal,()=>{
 const input=context(`Does the inspection report cover ${literal}?`);
 const assessment=assessReplyVerification(`I'll check whether the inspection report covers ${literal} and let you know.`,input);
 assert.deepEqual(assessment.unsupportedClaims,[]);assert.equal(assessment.requiresVerification,false);
 assert.equal(assessment.locallyVerifiedWholeReply,false);assert.deepEqual(assessment.localEvidence,[]);
 assert.equal(assessment.claims.some(claim=>claim.kind==='product_identity'),false,'Buyer spelling does not become a verified company product');
});

for(const other of ['RX73','RX–73','RX-74','RV-73','rx-73','RX-730','RX-73A','RX-73-2026','IR-RX73-2026'])test('Unknown buyer references get no inferred alias: '+other,()=>{
 assert.deepEqual(buyerProductIdentifierReferences(`I will check ${other}.`,buyer),[]);
});

test('No standalone quantity, formula, standard or document number is a buyer product reference',()=>{
 for(const literal of ['73','73 mm','ISO-9001','Al2O3','inspection report IR73','certificate ID CR73']){
  assert.deepEqual(buyerProductIdentifierReferences(`I will check ${literal}.`,`Please check ${literal}.`),[]);
 }
});

test('An unknown affirmative or mixed coverage claim retains the evidence check',()=>{
 for(const say of ['The inspection report covers RX-73.',"I'll check whether the inspection report covers RX-73, and it covers RX-73.","We supply RX-73. I'll check the report."]){
  const result=assessReplyVerification(say,context());
  assert.ok(result.requiresVerification||result.unsupportedClaims.length,say);
  assert.ok(result.unsupportedClaims.some(claim=>claim.kind==='number'&&claim.text==='73'),say);
 }
});

test('Buyer identity reference does not authorize ownership, a free number, or a guessed identifier',()=>{
 for(const say of ["I'll check whether the inspection report covers our RX-73.","I'll check whether the inspection report covers 73.","I'll check whether the inspection report covers RX-74."]){
  const result=assessReplyVerification(say,context());assert.ok(result.unsupportedClaims.some(claim=>claim.kind==='number'),say);
 }
});

for(const say of [
 "I'll check whether the inspection report covers our standard RX-73.",
 "I'll check whether our certified RX-73 is covered by the inspection report.",
 "I'll check whether the inspection report covers our current model RX-73.",
 "I'll check whether the inspection report covers our fully certified RX-73.",
 "I'll check whether the inspection report covers our current, approved RX-73.",
 "I'll check whether our inspection report covers our standard RX-73.",
])test('Buyer spelling cannot establish qualified company ownership: '+say,()=>{
 assert.deepEqual(buyerProductIdentifierReferences(say,buyer),[]);
 const result=assessReplyVerification(say,context());
 assert.ok(result.requiresVerification||result.unsupportedClaims.length);
 assert.ok(result.unsupportedClaims.some(claim=>claim.kind==='number'&&claim.text==='73'));
});

for(const say of [
 "I'll check whether our inspection report covers RX-73 and let you know.",
 "I'll check whether our inspection report covers the RX-73 and let you know.",
 "I'll check whether our inspection report covers your requested RX-73 and let you know.",
 "I'll check whether RX-73 is covered by our inspection report and let you know.",
])test('Owning a report does not assert ownership of the item whose coverage is unknown: '+say,()=>{
 assert.equal(buyerProductIdentifierReferences(say,buyer).length,1);
 const result=assessReplyVerification(say,context());
 assert.deepEqual(result.unsupportedClaims,[]);assert.equal(result.requiresVerification,false);
 assert.equal(result.locallyVerifiedWholeReply,false);assert.deepEqual(result.localEvidence,[]);
});

test('The ownership guard never normalizes a previously unknown unhyphenated identifier',()=>{
 const say="I'll check whether our certified RX73 is covered by the inspection report.";
 assert.deepEqual(buyerProductIdentifierReferences(say,'Does the report cover RX73?'),[]);
 assert.deepEqual(buyerProductIdentifierReferences("I'll check whether the report covers RX73.",buyer),[]);
 assert.deepEqual(productIdentityReferences(say,[source]),[]);
});

test('Only the current buyer turn can supply this reference, across companies',()=>{
 const input=context('Please check the report.');
 input.turns.unshift({role:'buyer',text:buyer});
 assert.ok(assessReplyVerification("I'll check whether the inspection report covers RX-73.",input).unsupportedClaims.some(claim=>claim.kind==='number'));
 const other={...context('Could you check if the report covers ZK-81?'),manufacturer:{id:'harbor',name:'Harbor Valve',products:'check valves'}};
 const checked=assessReplyVerification("I'll check whether the inspection report covers ZK-81 and let you know.",other);
 assert.equal(checked.requiresVerification,false);assert.deepEqual(checked.localEvidence,[]);
 assert.ok(assessReplyVerification("I'll check whether the inspection report covers RX-73.",other).unsupportedClaims.some(claim=>claim.kind==='number'));
});

test('Other numeric promises in the same reply retain their checks',()=>{
 for(const tail of ['We can offer a 12% discount.','We can ship in 3 days.','It is certified to ISO 9001.','It guarantees 99% performance.']){
  const result=assessReplyVerification("I'll check whether the inspection report covers RX-73. "+tail,context());
  assert.ok(result.requiresVerification||result.unsupportedClaims.length,tail);
  assert.ok(result.unsupportedClaims.length,tail);
 }
});

for(const [company,literal,determiner] of [['Cedar Instruments','RX 73','the'],['Harbor Valve','ZK 81','your']])test('A literal spaced buyer scope target can be checked without turning it into a company fact: '+company,()=>{
 const input={...context(`Can you confirm whether your inspection report covers ${literal}?`),manufacturer:{id:company,name:company,products:'inspection instruments'}};
 const say=`I'll check whether that inspection report covers ${determiner} ${literal} and let you know.`;
 const refs=buyerProductIdentifierReferences(say,input.turns[0].text);
 assert.equal(refs.length,1);assert.equal(say.slice(refs[0].start,refs[0].end),literal);
 assert.deepEqual(productIdentityReferences(say,[source]),[]);
 const result=assessReplyVerification(say,input);
 assert.equal(result.requiresVerification,false);assert.deepEqual(result.unsupportedClaims,[]);
 assert.equal(result.locallyVerifiedWholeReply,false);assert.deepEqual(result.localEvidence,[]);
 assert.equal(result.claims.some(claim=>claim.kind==='product_identity'),false);
});

test('Spaced buyer references preserve exact spelling and require a scope target in the buyer turn',()=>{
 const ask='Does the inspection report cover RX 73?';
 for(const alias of ['RX73','RX-73','RX–73','RX  73','RX\t73','RX\u00a073','rx 73','RX 74','RV 73','RX 730','RX 73A','RX 73-2026','RX 73.5']){
  assert.deepEqual(buyerProductIdentifierReferences(`I'll check whether the report covers ${alias}.`,ask),[],alias);
 }
 assert.deepEqual(buyerProductIdentifierReferences("I'll check whether the report covers RX 73.",'Please CHECK RX 73.'),[]);
 // The reference extractor does not authorize speech acts. The policy caller
 // separately requires a bounded epistemic action before exempting its digits.
 const reverse="I'll check whether RX 73 is covered by the inspection report.";
 assert.equal(buyerProductIdentifierReferences(reverse,'Is RX 73 covered by your inspection report?').length,1);
});

test('Spaced ordinary words, quantities, units, standards and document numbers are never product references',()=>{
 for(const literal of ['73 mm','73 kg','MM 73','KG 73','PSI 73','USD 73','CHECK 73','SEND 73','WITH 73','MODEL 73','GRADE 73','ISO 9001','ASTM 73','Al 2','IR 73']){
  const document=literal==='IR 73';
  const ask=document?'Please check inspection report IR 73.':`Does the report cover ${literal}?`;
  const say=document?"I'll check inspection report IR 73.":`I'll check whether the report covers ${literal}.`;
  assert.deepEqual(buyerProductIdentifierReferences(say,ask),[],literal);
 }
});

test('Spaced references never authorize ownership, coverage assertions, free numbers or extra promises',()=>{
 const input=context('Does the inspection report cover RX 73?');
 for(const say of [
  'The inspection report covers RX 73.',
  "I'll check whether the report covers RX 73, and it does cover RX 73.",
  "I'll check whether the report covers our RX 73.",
  "I'll check whether our certified RX 73 is covered by the inspection report.",
  "I'll check whether the report covers our standard RX 73.",
  "I'll check whether the report covers 73.",
  "I'll check whether the report covers RX 73. We can offer a 12% discount.",
  "I'll check whether the report covers RX 73. We can ship in 3 days.",
 ]){
  const result=assessReplyVerification(say,input);
  assert.ok(result.requiresVerification||result.unsupportedClaims.length,say);
 }
});

test('Spaced references cannot be borrowed from an earlier buyer turn or another company context',()=>{
 const input=context('Please check the report.');input.turns.unshift({role:'buyer',text:'Does the inspection report cover RX 73?'});
 assert.ok(assessReplyVerification("I'll check whether the report covers RX 73.",input).unsupportedClaims.some(claim=>claim.kind==='number'));
 const other=context('Does the inspection report cover ZK 81?');
 assert.ok(assessReplyVerification("I'll check whether the report covers RX 73.",other).unsupportedClaims.some(claim=>claim.kind==='number'));
});

for(const literal of ['Rx 73','rx 73','Zk 81','zk 81'])test('ASR casing is preserved exactly in a bounded spaced-reference inquiry: '+literal,()=>{
 const input=context(`Does the inspection report cover ${literal}?`),say=`I'll check whether the inspection report covers ${literal} and let you know.`;
 const refs=buyerProductIdentifierReferences(say,input.turns[0].text);
 assert.equal(refs.length,1);assert.equal(refs[0].text,literal);assert.equal(refs[0].buyerText,literal);
 const result=assessReplyVerification(say,input);
 assert.equal(result.requiresVerification,false);assert.deepEqual(result.unsupportedClaims,[]);
 assert.equal(result.locallyVerifiedWholeReply,false);assert.deepEqual(result.localEvidence,[]);
 for(const changed of [literal.toUpperCase(),literal.replace(' ','-'),literal.replace(' ','')]){
  assert.deepEqual(buyerProductIdentifierReferences(`I'll check whether the report covers ${changed}.`,input.turns[0].text),[],changed);
 }
});

test('Ordinary case-insensitive words and unit-bearing quantities do not gain the spaced-ID exemption',()=>{
 for(const literal of ['all 73','Some 73','these 73','Those 73','our 73','your 73','over 73','Under 73','around 73','almost 73','batch 73','lot 73','check 73','Mm 73','kg 73']){
  const ask=`Does the inspection report cover ${literal} items?`,say=`I'll check whether the inspection report covers ${literal} items.`;
  assert.deepEqual(buyerProductIdentifierReferences(say,ask),[],literal);
  assert.ok(assessReplyVerification(say,context(ask)).unsupportedClaims.some(claim=>claim.kind==='number'),literal);
 }
 const input=context('Does the report cover Rx 73?');
 assert.ok(assessReplyVerification("I'll check whether the report covers Rx 73 mm.",input).unsupportedClaims.some(claim=>claim.kind==='number'),'The matched ID span cannot swallow a unit-bearing numeric claim');
});

test('Mixed-case spaced references do not authorize owned/certified items or mixed factual promises',()=>{
 const input=context('Does the inspection report cover Rx 73?');
 for(const say of [
  "I'll check whether the inspection report covers our standard Rx 73.",
  "I'll check whether our certified Rx 73 is covered by the inspection report.",
  'The inspection report covers Rx 73.',
  "I'll check whether the inspection report covers Rx 73, and it covers Rx 73.",
  "I'll check whether the inspection report covers Rx 73. We can offer a 12% discount.",
  "I'll check whether the inspection report covers Rx 73. We can ship in 3 days.",
 ])assert.ok(assessReplyVerification(say,input).unsupportedClaims.length,say);
});
