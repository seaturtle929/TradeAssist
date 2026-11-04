import assert from 'node:assert/strict';
import test from 'node:test';
import {assessReplyVerification} from '../lib/turn-verification-policy.ts';

// Fictional company reference; no customer transcripts, model calls or timing claims.
const reference={id:'fictional-documents',text:'A company profile, specification sheets and a material test report are available for review.'};
const context=(sources=[reference])=>({manufacturer:{id:'fictional-parts',name:'Fictional Parts',products:'industrial parts'},sources,turns:[{role:'buyer',text:'What information can our engineer review?'}],coachingRequest:{id:'fictional-document-request',requestedAt:0}});
for(const say of [
 'They could also look at our material test report to compare specifications.',
 'Your engineer can review our material test report to compare your requirements.',
 'You can read our test report for reference.',
 'They can review our company profile and material test report if they would like more details.',
 'They can review our company profile and spec sheets if they would like more details.',
])test('Review of an available document makes no assertion about its results: '+say,()=>{
 const result=assessReplyVerification(say,context());
 assert.deepEqual(result.unsupportedClaims,[]);
 assert.deepEqual(result.pendingClaims,[]);
 assert.ok(result.supportedClaims.some(claim=>claim.sourceId===reference.id));
});
for(const [name,say,sources]of[
 ['unapproved report','They could also look at our material test report to compare specifications.',[{id:'profile-only',text:'A company profile and specification sheets are available for review.'}]],
 ['wrong report type','They can review our inspection report to compare quality details.',[reference]],
 ['uncertain availability','They can review our material test report for reference.',[{id:'uncertain',text:'A material test report may be available.'}]],
 ['conditional availability','They can review our material test report for reference.',[{id:'conditional',text:'A material test report is available only if approved.'}]],
 ['unavailable report','They can review our material test report for reference.',[{id:'unavailable',text:'A material test report is not available.'}]],
 ['availability belongs to different document','They can review our material test report for reference.',[{id:'unrelated',text:'A company profile is available. We are considering a material test report.'}]],
 ['report mentioned inside available profile','They can review our material test report for reference.',[{id:'mentioned',text:'A company profile describing our material test report is available.'}]],
 ['historical availability','They can review our material test report for reference.',[{id:'historical',text:'A material test report was available for review.'}]],
 ['truncated availability entry','They can review our material test report for reference.',[{...reference,complete:false}]],
 ['same-entry approval condition','They can review our material test report for reference.',[{id:'approval',text:'A material test report is available for review. Sharing requires manager approval.'}]],
 ['next-paragraph approval condition','They can review our material test report for reference.',[{id:'approval',text:'A material test report is available for review.\n\nManager approval is required before it can be sent.'}]],
 ['conflicting negative entry','They can review our material test report for reference.',[reference,{id:'negative',text:'A material test report is not available.'}]],
 ['stale entry title','They can review our material test report for reference.',[{...reference,title:'Superseded document availability'}]],
 ['conflicting stale entry','They can review our material test report for reference.',[reference,{...reference,id:'stale',title:'Superseded document availability'}]],
 ['unsupported numerical result','They can review our material test report showing 99% purity.',[reference]],
 ['unsupported performance','They can review our material test report, which guarantees better performance.',[reference]],
 ['unsupported certification','They can review our material test report to confirm ISO 9001 certification.',[reference]],
 ['unsupported response deadline','They can review our material test report tomorrow.',[reference]],
])test('Keep the ordinary checks for '+name,()=>{
 const result=assessReplyVerification(say,context(sources));
 assert.ok(result.unsupportedClaims.length||result.pendingClaims.length);
});
test('An extracted summary cannot establish report availability absent from the original',()=>{
 const input=context([{id:'original-profile',text:'A company profile is available for review.'}]);
 input.brain={facts:[{text:'A material test report is available for review.',sourceId:'original-profile',quote:'A company profile is available for review.',confirmed:true}]};
 assert.ok(assessReplyVerification('They can review our material test report for reference.',input).unsupportedClaims.length);
});
