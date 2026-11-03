import assert from 'node:assert/strict';
import test from 'node:test';
import {deriveCallReview} from '../lib/call-review.ts';

// Fictional irrigation-equipment conversation; no customer records are used.
const initial=[
 ['buyer','Priya speaking.'],
 ['buyer','We are evaluating an irrigation valve for a prototype orchard system.'],
 ['buyer','I will email the drawing when it is ready.'],
];
const call=rows=>({id:'fictional-orchard',turns:rows.map(([role,text],index)=>({id:`turn-${index}`,role,text,at:1000+index})),outcome:'',notes:'',startedAt:1000});

test('Later progress and an actual qualified representative commitment are retained',()=>{
 const review=deriveCallReview(call([...initial,
  ['buyer','The drawing is ready.'],
  ['buyer','I will email the drawing tomorrow.'],
  ['you','We will attach the inspection report if it is available.'],
 ]));
 assert.match(review.recap,/drawing was finished/i);
 assert.match(review.recap,/email the drawing tomorrow/i);
 assert.match(review.recap,/attach the inspection report if it is available/i);
 assert.match(review.recap,/Sending and receipt of the drawing remain unconfirmed/i);
 assert.match(review.recap,/No follow-up date was agreed/i);
 for(const id of ['turn-3','turn-4','turn-5'])assert.ok(review.sourceTurnIds.includes(id));
});

test('A later reversal of readiness and an email offer supersedes older information',()=>{
 const review=deriveCallReview(call([...initial,
  ['buyer','The drawing is ready.'],
  ['buyer','The drawing is not yet finished.'],
  ['buyer',"I can't email the drawing until our supervisor approves."],
 ]));
 assert.doesNotMatch(review.recap,/said the drawing was finished|offered to email the drawing/i);
 assert.match(review.recap,/can't email the drawing until our supervisor approves/i);
 assert.ok(review.sourceTurnIds.includes('turn-5'));
});

test('Suggested wording is never reported as a spoken commitment',()=>{
 const value=call(initial);
 value.suggestions=[{guidance:{say:'We will attach the inspection report.'}}];
 assert.doesNotMatch(deriveCallReview(value).recap,/Salesperson's stated next step/i);
});
