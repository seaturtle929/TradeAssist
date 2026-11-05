import assert from 'node:assert/strict';
import test from 'node:test';
import {buyerDeferralSuggestionProblems,deriveBuyerDeferral} from '../lib/buyer-deferral.ts';
import {checkSuggestion} from '../lib/call-purpose.ts';
import {unapprovedResponseDeadline} from '../lib/call-coaching.ts';

// Authored fictional dialogue only; no saved calls, company records or AI.
const turns=[
 {id:'rep',role:'you',text:'Are there technical requirements your engineering team needs to assess?'},
 {id:'buyer',role:'buyer',text:'I will leave the specifications to engineering. I do not handle those details.'},
];
const context={manufacturer:{id:'fictional-cedar',name:'Cedar Instruments',products:'inspection equipment'},sources:[],turns,coachingRequest:{id:'permission-after-deferral',requestedAt:5}};

for(const say of [
 'Of course. Would it be alright if I checked back after engineering has had a chance to review?',
 'Understood. Would you mind if I followed up after the engineer has reviewed the documents?',
 'That makes sense. Would a check-in after engineering has reviewed it be useful?',
 'Certainly. Could I contact you again after engineering has reviewed the information?',
 'Understood. Would you be comfortable if I contacted you after engineering has had a look?',
 'No problem. Would it help if we arranged a follow-up after engineering has reviewed the materials?',
 'Certainly. Could we reconnect once the engineer has reviewed the materials?',
 'Understood. Would it be okay if we reconnected after engineering has reviewed the information?',
 'Of course. May I get back in touch after your engineer has had a look?',
 'No problem. Would it be alright if we got back in touch after engineering reviewed the documents?',
 'Understood. Could we touch base after engineering has reviewed the information?',
 'Certainly. Would it be useful if we caught up after your engineer has reviewed it?',
])test('Permission for future contact respects the technical deferral: '+say,()=>{
 assert.deepEqual(buyerDeferralSuggestionProblems(say,turns),[]);
 const verdict=checkSuggestion({say},context,{factChecked:true});
 assert.equal(verdict.ok,true,verdict.retryReason);
 assert.equal(deriveBuyerDeferral(turns).topic,'technical_requirements');
});

for(const say of [
 'What would engineering need to verify before evaluating us?',
 'Which exact specifications does the engineering team need?',
 'Would it be alright if I checked back, and what technical criteria would engineering require?',
 'Could I follow up after engineering reviews it? What tolerances should we meet?',
 'Would you ask engineering which dimensions they need to verify?',
 'Could we reconnect, and what specifications would engineering need to verify?',
 'Would it be alright if we got back in touch, and which tolerances should we use?',
 'May we touch base on what technical criteria engineering requires?',
])test('A contact proposal cannot hide renewed technical discovery: '+say,()=>{
 assert.equal(buyerDeferralSuggestionProblems(say,turns).length,1);
 assert.equal(checkSuggestion({say},context,{factChecked:true}).ok,false);
});

test('Permission to follow up does not establish a date or authorize a response deadline',()=>{
 const say='Of course. Would it be alright if I checked back after engineering has had a chance to review?';
 assert.doesNotMatch(say,/Monday|Tuesday|Wednesday|Thursday|Friday|tomorrow|soon|shortly/);
 assert.equal(unapprovedResponseDeadline("I'll call you on Thursday after engineering reviews it.",context),true);
});

test('A chosen email next step remains respected; the permission exception does not reopen discovery',()=>{
 const chosen=[...turns,{id:'email',role:'buyer',text:'I will email our drawing when it is ready. I prefer to continue by email.'}];
 assert.equal(deriveBuyerDeferral(chosen).topic,'technical_requirements');
 assert.equal(buyerDeferralSuggestionProblems('What would engineering need to verify?',chosen).length,1);
 const extraPermission='Of course. Would it be alright if I checked back after engineering has reviewed the drawing?';
 assert.equal(checkSuggestion({say:extraPermission},{...context,turns:chosen},{factChecked:true}).ok,false,'The chosen email handoff still prevents another question.');
});
