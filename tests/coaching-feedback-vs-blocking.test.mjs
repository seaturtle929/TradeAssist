import assert from 'node:assert/strict';
import test from 'node:test';
import {checkSuggestion} from '../lib/call-purpose.ts';

const context={manufacturer:{id:'synthetic-cedar',name:'Cedar Instruments',products:'inspection instruments'},sources:[{id:'identity',text:'Cedar Instruments supplies inspection instruments.'}],turns:[{id:'buyer',role:'buyer',text:'Quinn speaking. I handle purchasing.',at:1}],coachingRequest:{id:'synthetic-long-greeting',requestedAt:2}};
const long="Hi Quinn, I'm with Cedar Instruments. I'm calling about inspection instruments. Thank you for taking the call and for letting me introduce the company. I appreciate the chance to speak with you and understand what would make this conversation useful. I am happy to listen to what you have in mind, and there is no need to make any decision while we are talking. Thank you again for your time.";
test('A grounded wordy introduction is usable with delivery feedback, not an automatic rewrite',()=>{
 const result=checkSuggestion({say:long,evidence:[]},context,{factChecked:true});
 assert.equal(result.ok,true,result.retryReason);
 assert.ok(result.qualityFeedback.some(note=>/shorten/i.test(note)));
});
test('Delivery feedback does not excuse an unsupported report coverage assertion',()=>{
 const result=checkSuggestion({say:long+' Our inspection report covers RX73.',evidence:[]},context,{factChecked:true});
 assert.equal(result.ok,false);
 assert.match(result.retryReason,/claim|coverage|evidence|source|report|fact/i);
});
