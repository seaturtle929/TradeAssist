import assert from 'node:assert/strict';
import test from 'node:test';
import {onDemandDecisionRules,onDemandSuggestionProblems} from '../lib/on-demand-coaching.ts';
import {callRouteSuggestionProblems} from '../lib/call-route.ts';
import {representativeIdentityFor,representativeIdentityProblems} from '../lib/representative-identity.ts';
import {checkSuggestion} from '../lib/call-purpose.ts';

// Authored fictional recognition conditions; no service calls or app storage.
function context(kind='pending'){
 const context={callId:'fictional-call',manufacturer:{id:'cedar',name:'Cedar Instruments',products:'inspection instruments'},sources:[],currentStage:'discovery',callType:'discovery',callContext:{stageId:'discovery',background:'',knownFacts:'',goal:'Understand requirements.'},
  turns:[{id:'old-rep',role:'you',text:"Hi, I'm Lin with Cedar Instruments. Could you connect me with Priya in purchasing?",at:1}],
  clientContext:{version:1,companyId:'cedar',clientId:'fictional-client',clientName:'Fictional Client',contactId:'priya',contact:{id:'priya',companyId:'cedar',clientId:'fictional-client',kind:'person',name:'Priya Shah',role:'Purchasing'},reachViaContact:{id:'main',kind:'main_line',name:'Main line'},callId:'fictional-call',stageId:'discovery',configurationVersionId:'v1',configurationVersion:1,reviewedAt:1,clientUpdatedAt:1,preparationFingerprint:'synthetic',background:'',outsideUpdate:'',entries:[],history:[],isReturning:false},
  coachingRequest:{id:'synthetic-request',requestedAt:2,listeningSession:{startedAt:2,currentTurnIds:['current']},partials:[],pendingSpeech:[]}};
 if(kind==='pending')context.coachingRequest.pendingSpeech=[{id:'current',role:'buyer',at:2}];
 if(kind==='partial'||kind==='uncertain')context.coachingRequest.partials=[{id:'current',role:'buyer',text:kind==='uncertain'?'One moment, hi, Preeya speaking.':'Our engineer',at:2,...kind==='uncertain'?{transcriptionUncertainty:{reason:'low_confidence',message:'Several words were unclear.'}}:{}}];
 if(kind==='complete')context.turns.push({id:'current',role:'buyer',text:'Reception, how can I help?',at:2});
 return context;
}

test('Pending recognition accepts a literal listening cue without redoing an empty-call transfer opener',()=>{
 const c=context();
 for(const say of ["Sure, I'm here and ready whenever you're set to continue.","Sure, go ahead. I'm listening."]){
  assert.deepEqual(onDemandSuggestionProblems(say,c),[],say);assert.equal(checkSuggestion({say},c).ok,true,say);
 }
 assert.match(onDemandDecisionRules(c),/not an empty-call opener/i);
 assert.ok(onDemandSuggestionProblems('What are your requirements?',c).length,'Pending speech still cannot restart discovery');
 assert.ok(onDemandSuggestionProblems('Could you repeat that?',c).length,'Only actual uncertainty permits a repeat question');
});

test('Recognized uncertainty permits a short repeat or identity clarification, while identity stays unconfirmed',()=>{
 const c=context('uncertain');
 for(const say of ['Sorry, could you repeat that?',"Thanks for holding. I'd appreciate if you could repeat that—was it Priya Shah on the line?",'Thanks for that. Could you please confirm—are we connected with Priya Shah now?']){
  assert.deepEqual(onDemandSuggestionProblems(say,c),[],say);assert.equal(checkSuggestion({say},c).ok,true,say);
 }
 assert.match(onDemandDecisionRules(c),/AUDIO RECOGNITION UNCERTAIN/);
 assert.ok(onDemandSuggestionProblems('Hi Priya, what are your needs?',c).length,'An uncertain name cannot be greeted as confirmed');
 assert.ok(onDemandSuggestionProblems('Could you repeat your product requirements?',c).length,'Uncertainty cannot license a discovery prompt');
 assert.ok(onDemandSuggestionProblems('Could you confirm your order volume?',c).length);
 assert.ok(callRouteSuggestionProblems('Did you review the documents you requested?',c).length,'Uncertain identity cannot inherit the absent target’s previous requests');
});

test('Unfinished fragments, empty calls and actual reception greetings retain their existing guards',()=>{
 assert.ok(onDemandSuggestionProblems('Who am I speaking with?',context('partial')).length);
 assert.ok(callRouteSuggestionProblems("Sure, I'm listening.",context('empty')).length,'No captured speech: empty-call routing opener still required');
 assert.ok(callRouteSuggestionProblems('Hi Priya, how are you?',context('complete')).length,'Generic reception greeting does not confirm the target');
 const c=context('complete');assert.deepEqual(callRouteSuggestionProblems("Hi, I'm Lin from Cedar Instruments. Could you connect me with Priya in purchasing?",c),[]);
});

test('Contractions are not personal names; real invented names remain rejected',()=>{
 const c=context();assert.equal(representativeIdentityFor(c).name,'Lin');
 for(const say of ["I'm here.","Sure, I'm here and ready.","I'm listening.","I am here."]){assert.deepEqual(representativeIdentityProblems(say,c),[],say);}
 for(const say of ["Sam here.","Hi, I'm Sam.","This is Sam from Cedar Instruments."]){assert.ok(representativeIdentityProblems(say,c).length,say);}
 assert.deepEqual(representativeIdentityProblems('Lin here.',c),[]);
});

test('A repeat request does not bypass unsupported factual claims or commercial promises',()=>{
 const c=context('uncertain');
 for(const say of ['Our instruments are certified for your application. Could you repeat that?',"We'll ship tomorrow. Could you repeat that?"]){assert.equal(checkSuggestion({say},c).ok,false,say);}
});
