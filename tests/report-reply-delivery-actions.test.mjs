import assert from 'node:assert/strict';
import test from 'node:test';
import {investigationThenDocumentDelivery} from '../lib/document-product-evidence.ts';
import {assessReplyVerification} from '../lib/turn-verification-policy.ts';
import {needsFactCheck} from '../lib/call-coaching.ts';
import {onDemandSuggestionProblems} from '../lib/on-demand-coaching.ts';

// Fictional common action grammar, independent of any saved call or output.
const c={manufacturer:{id:'fictional-cedar',name:'Cedar Instruments',products:'components'},sources:[{id:'available',text:'Inspection reports are available.'}],coachingRequest:{id:'authored-actions',requestedAt:2},turns:[{role:'buyer',text:'Can you check whether the inspection report covers ZX72?'},{role:'buyer',text:"I'll email the drawing. Once you're sure the report matches, reply with it."}]};
for(const action of ['send','email','share','forward','include','attach','reply with','respond with'])test('Positive report-scope conditions bind the common action '+action,()=>{
 for(const say of [`I'll confirm if the inspection report covers ZX72 and ${action} it if it does.`,`Once we confirm the report covers ZX72, we'll ${action} it as you requested.`,`I'll check whether the inspection report covers ZX72 and ${action} the report if it covers ZX72.`,`I'll check whether the inspection report covers ZX72 and ${action} it only if the report matches the reference.`]){
  assert.equal(investigationThenDocumentDelivery(say,c)?.deliveryCondition,'stated_condition',say);
  const result=assessReplyVerification(say,c);assert.deepEqual(result.unsupportedClaims,[],say);assert.equal(needsFactCheck(say,c),false,say);
  const gated={...c,turns:[...c.turns,{role:'buyer',text:'Do not send anything until my engineer approves the drawing.'}]};assert.ok(assessReplyVerification(say,gated).unsupportedClaims.some(claim=>/withheld permission/.test(claim.reason)),say);
 }
});
test('A result condition keeps its antecedent and cannot become a check-completion send or a mixed promise',()=>{
 for(const say of ["I'll confirm whether the report covers ZX72, then reply with it.","I'll check whether the report covers ZX72 and reply with it if it does. We can offer a 20% discount.","I'll check whether the report covers ZX72 and reply with it if it does and certify the product.","I'll check whether the report covers ZX72 and reply with it if it covers our ZX72.","I'll check whether the report covers ZX72 and reply with it if it covers ZX72 which is certified for medical use."]){const result=assessReplyVerification(say,c);assert.ok(result.requiresVerification||result.unsupportedClaims.length,say);}
 assert.equal(investigationThenDocumentDelivery("If it does, I'll reply with it.",c),undefined,'A detached pronoun has no inferred report inquiry.');
 const notRequested={...c,turns:[{role:'buyer',text:'Does the inspection report cover ZX72?'}]};
 assert.equal(investigationThenDocumentDelivery("Once we confirm the report covers ZX72, we'll reply with it as you requested.",notRequested),undefined,'Courtesy cannot invent a document-send request.');
});
test('A conditional report reply itself acknowledges the buyer drawing handoff',()=>{
 const context={...c,coachingRequest:{...c.coachingRequest,transcriptState:'confirmed'},turns:[{role:'buyer',text:'Can you check whether the inspection report covers ZX72?'},{role:'you',text:'Could you confirm the code?'},{role:'buyer',text:"The reference is ZX72. I'll email the drawing. Once you're sure the report matches, reply with it."}]};
 for(const say of ["Thanks. I'll confirm if the inspection report covers ZX72 and reply with it if it does.","Once we confirm the report covers ZX72, we'll reply with it as you requested."]){assert.deepEqual(onDemandSuggestionProblems(say,context),[],say);assert.equal(needsFactCheck(say,context),false,say);}
 assert.ok(onDemandSuggestionProblems("I'll check the report and follow up.",context).length,'A vague follow-up still drops the requested conditional reply.');
});
