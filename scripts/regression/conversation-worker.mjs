import {readFile,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {createHash,webcrypto} from 'node:crypto';
import {evaluateReply,scoreIdentityRecovery} from './evaluate-reply.mjs';

// Provider events are deliberately SCRIPTED. All request ownership, prompt
// construction, parsing, local checks, repairs and publication are production.
globalThis.fetch=()=>{throw new Error('Offline suite forbids network access');};
globalThis.WebSocket=class {constructor(){throw new Error('Offline suite forbids WebSocket access');}};
globalThis.localStorage=undefined;
globalThis.crypto||=webcrypto;
const [root,fixturePath,outputPath]=process.argv.slice(2);
const fixtures=JSON.parse(await readFile(fixturePath,'utf8'));
const source=relative=>pathToFileURL(path.join(root,relative)).href;
const {LiveCoachingSession}=await import(source('lib/live-coaching-session.ts'));
const {assessReplyVerification}=await import(source('lib/turn-verification-policy.ts'));
const {checkSuggestion}=await import(source('lib/call-purpose.ts'));
const {defaultConfigurationStages}=await import(source('lib/sales-curriculum.ts'));
const {representativeIdentityProblems}=await import(source('lib/representative-identity.ts'));
// Older comparison builds do not implement local completion. Never manufacture
// it in the runner: recognize only wording produced by that build's own factory.
const localFactory=await import(source('lib/local-press-reply.ts')).catch(error=>{if(error.code==='ERR_MODULE_NOT_FOUND'||error.code==='ENOENT')return null;throw error;});
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const clone=value=>structuredClone(value);
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const results=[];
for(const conversation of fixtures.conversations){
  const context={...clone(conversation.context),turns:[],recentReplies:[]};
  context.callId||='offline-'+conversation.id;
  if(context.companyConfiguration?.snapshot?.stages?.length===0)context.companyConfiguration.snapshot.stages=defaultConfigurationStages();
  const sent=[],traces=[],shown=[],errors=[],issues=[],verifications=[],queued=[],telemetry=[];
  let turnIndex=0,activePress,slot=0;
  const session=new LiveCoachingSession({
    initialTranscriptIds:[],snapshot:()=>context,latestContext:()=>context,
    send:event=>sent.push(clone(event)),onRequestTrace:event=>traces.push(clone(event)),
    onGuidance:(guidance,id,at,complete,_latency,trigger,snapshot)=>shown.push({guidance:clone(guidance),id,at,complete,trigger,snapshot:clone(snapshot)}),
    onBuyerTurn:turn=>{const found=context.turns.findIndex(item=>item.id===turn.id);const next={...turn,role:'buyer'};if(found<0)context.turns.push(next);else context.turns[found]=next;},
    verify:async(snapshot,proposed)=>{
      const assessment=assessReplyVerification(proposed.say,snapshot);
      const verdict=activePress?.verification||'pass';
      verifications.push({say:proposed.say,assessment:clone(assessment),verdict,kind:'scripted-verifier-not-model'});
      if(verdict==='reject'||assessment.unsupportedClaims.length)throw Object.assign(new Error('Scripted verifier rejected unsupported evidence'),{code:'suggestion_rejected'});
      return {...proposed,verified:true};
    },
    fallback:async()=>{throw new Error('Offline suite does not manufacture fallback replies');},
    onError:message=>errors.push(message),onWarning:()=>{},onSuggestionIssue:event=>issues.push(clone(event)),
    onQueuedRequest:event=>queued.push(clone(event)),onTelemetry:event=>telemetry.push(clone(event)),
    onSupersede:()=>{},onPendingTurn:()=>{},onThinking:()=>{},onChecking:()=>{},onBuyerPartial:()=>{},onBuyerSpeech:()=>{},onBuyerPending:()=>{},onUsage:()=>{},
    continuationSettleMs:0,queuedTranscriptionTimeoutMs:10,transcriptionTimeoutMs:2000,fallbackAfterMs:10000,
  });
  const rows=[];
  try{
    for(const step of conversation.steps){
      const id=`${conversation.id}-turn-${++turnIndex}`;
      const before={sent:sent.length,traces:traces.length,shown:shown.length,errors:errors.length,issues:issues.length,verifications:verifications.length,queued:queued.length};
      activePress=step.press;
      const request=()=>session.requestNextMove({...context,coachingRequest:{id:step.press.id,requestedAt:Date.now()}});
      const stopAndFinalize=()=>{
        session.handle({type:'input_audio_buffer.speech_stopped',item_id:id,audio_end_ms:1000+turnIndex*2000});
        session.handle({type:'conversation.item.input_audio_transcription.completed',item_id:id,transcript:step.text});
      };
      if(step.role==='buyer'){
        session.handle({type:'input_audio_buffer.speech_started',item_id:id,audio_start_ms:turnIndex*2000});
        if(step.press?.partial){
          session.handle({type:'conversation.item.input_audio_transcription.delta',item_id:id,delta:step.press.partial});
          request();
          stopAndFinalize();
        }else {stopAndFinalize();if(step.press)request();}
      }else if(step.role==='you'){
        const turn={id,text:step.text,at:Date.now()};context.turns.push({...turn,role:'you'});session.acceptRepresentative(turn);if(step.press)request();
      }else if(step.role==='press')request();
      if(!step.press)continue;
      const started=performance.now();let cursor=before.sent,attempt=0;
      // Includes cancellation acknowledgments: otherwise a rejected draft can
      // leave a provider slot occupied and hide a genuine missing-reply bug.
      for(let idle=0;idle<12;){
        await flush();
        if(cursor>=sent.length){idle++;continue;}idle=0;
        while(cursor<sent.length){
          const event=sent[cursor++];
          if(event.type==='response.cancel'){
            session.handle({type:'response.done',response:{id:event.response_id,status:'cancelled'}});continue;
          }
          if(event.type!=='response.create')continue;
          if(++attempt>6)throw new Error('Unbounded provider retry loop');
          const candidate=step.press.candidates[Math.min(attempt-1,step.press.candidates.length-1)];
          if(typeof candidate!=='string')throw new Error('A scripted candidate is required');
          const responseId='scripted-'+(++slot);
          session.handle({type:'response.created',response:{id:responseId,metadata:event.response.metadata}});
          const raw=candidate.startsWith('SAY:')?candidate:`SAY: ${candidate}\nMOVE: Respond to the current buyer moment\n`;
          session.handle({type:'response.output_text.delta',response_id:responseId,delta:raw});
          session.handle({type:'response.done',response:{id:responseId,status:'completed'}});
          await flush();
        }
      }
      const newShown=shown.slice(before.shown),unique=[...new Map(newShown.map(row=>[row.guidance.say,row])).values()];
      const published=unique.at(-1),assessment=published?assessReplyVerification(published.guidance.say,published.snapshot):null;
      const check=published?checkSuggestion(published.guidance,published.snapshot,{factChecked:true}):null;
      const evaluation=evaluateReply(published?.guidance.say||'',step.press.rubric||{});
      const requestTraces=traces.slice(before.traces),provider=sent.slice(before.sent).filter(event=>event.type==='response.create');
      const publicationCount=requestTraces.filter(event=>event.event==='published').length;
      const publishedCardIds=[...new Set(newShown.map(row=>row.id))];
      const origin=published?.guidance.replyOrigin||'generated';
      const localCompletion=origin==='local'&&!!localFactory&&published.guidance.say===localFactory.makeLocalPressReply(published.snapshot,published.guidance.localReason).say;
      const localSafety=localCompletion&&representativeIdentityProblems(published.guidance.say,published.snapshot).length===0;
      const stableCard=unique.length===1&&publicationCount===1&&publishedCardIds.length===1;
      const generatedMoveCorrect=origin!=='local'&&evaluation.pass&&check?.ok===true&&!(assessment?.unsupportedClaims.length);
      const stableUsable=stableCard&&(generatedMoveCorrect||localSafety);
      const rejectedOriginal=issues.slice(before.issues).some(issue=>issue.status==='rejected')&&step.press.candidates.every(candidate=>!newShown.some(row=>row.guidance.say===candidate.replace(/^SAY:\s*/,'').split(/\nMOVE:/)[0]));
      // Verify pinned input contains only this chronological prefix, and never
      // fixture rubrics, candidates, final recaps or future transcript turns.
      const requested=requestTraces.filter(event=>event.event==='requested');
      const literalTurns=turns=>turns.map(({id,role,text})=>({id,role,text}));
      const strings=value=>typeof value==='string'?[value]:value&&typeof value==='object'?Object.values(value).flatMap(strings):[];
      const inputIntegrity=requested.length>0&&provider.length>0&&requested.every(event=>JSON.stringify(literalTurns(event.snapshot?.turns||[]))===JSON.stringify(literalTurns(context.turns)))&&
        provider.every(event=>strings(event.response).every(value=>!/["']?(?:rubric|candidates|identityProbe|mustAll|mustNot|expectedBehavior)["']?\s*:/.test(value)));
      const identityProbe=step.press.identityProbe;
      const identityOutcomes=identityProbe?scoreIdentityRecovery({candidate:step.press.candidates[identityProbe.candidateIndex||0],identityProblems:representativeIdentityProblems(step.press.candidates[identityProbe.candidateIndex||0],context),issues:issues.slice(before.issues),publishedIdentityProblems:newShown.flatMap(row=>representativeIdentityProblems(row.guidance.say,row.snapshot)),stableUsable,publicationCount,cardCount:publishedCardIds.length,providerRequests:provider.length}):null;
      rows.push({id:step.press.id,buyerWordsAvailable:context.turns.filter(turn=>turn.role==='buyer').map(turn=>turn.text),
        transcriptAtClick:step.press.partial||step.text,completedTranscript:step.text,requestSnapshots:requested.map(event=>event.snapshot),
        spokenPrefix:clone(context.turns),inputIntegrity,scriptedCandidates:clone(step.press.candidates),
        wording:published?.guidance.say||null,uniquePublishedWording:unique.map(row=>row.guidance.say),
        oneIntentionalPress:true,oneStableUsableReply:stableUsable,publicationCount,publishedCardIds,
        blocked:unique.length===0,replyOrigin:origin,generatedMoveCorrect,localCompletionSafe:localSafety,originalDraftBlocked:rejectedOriginal,expect:step.press.expect||'usable',evaluationCategory:step.press.evaluationCategory||'conversation',evaluation,
        correct:(step.press.expect==='blocked'?(unique.length===0&&publicationCount===0||stableCard&&localSafety&&rejectedOriginal):stableUsable)&&inputIntegrity&&(!identityOutcomes||identityOutcomes.identitySafety.pass),
        identityOutcomes,
        policy:assessment,conversationCheck:check,providerRequests:provider.length,
        retries:requestTraces.filter(event=>event.event==='repair_requested').length,verifierCalls:verifications.length-before.verifications,
        verifications:verifications.slice(before.verifications),issues:issues.slice(before.issues),traces:requestTraces,errors:errors.slice(before.errors),queued:queued.slice(before.queued),
        timings:{simulationControllerWallMs:performance.now()-started,lastWordToVisibleMs:null,transcriptToVisibleMs:null,reason:'No recorded audio, speech service, generation service, or browser paint in offline scripted transport'},
        estimatedCostUsd:0,costKind:'offline-no-provider-usage',outputProvenance:'SCRIPTED provider events through production LiveCoachingSession; not observed model generation',fixtureProvenance:conversation.provenance||'authored-synthetic',
      });
    }
    // All earlier cards must remain unchanged through the entire conversation.
    for(const row of rows){const values=new Set(shown.filter(item=>item.trigger===row.id).map(item=>item.guidance.say));row.stableThroughClose=values.size<2;row.correct&&=row.stableThroughClose;if(row.identityOutcomes)row.identityOutcomes.samePressRecovery.pass&&=row.stableThroughClose;}
  }finally{session.stop();}
  results.push({id:conversation.id,name:conversation.name,category:conversation.category||'conversation',provenance:conversation.provenance||'authored-synthetic',rows});
}
const rows=results.flatMap(conversation=>conversation.rows);
await writeFile(outputPath,JSON.stringify({schemaVersion:1,mode:'offline-scripted-transport',fixtureSha256:hash(fixtures),sourceRoot:root,apiCalls:0,userStorageTouched:false,
  conversations:results,groups:results.map(conversation=>({id:conversation.id,name:conversation.name,category:conversation.category,moments:conversation.rows.length,correct:conversation.rows.filter(row=>row.correct).length,unavailable:conversation.rows.filter(row=>row.expect==='usable'&&row.blocked).length})),summary:{moments:rows.length,correct:rows.filter(row=>row.correct).length,unavailable:rows.filter(row=>row.expect==='usable'&&row.blocked).length,
  brokenConditions:rows.filter(row=>row.wording&&row.evaluation.failures.some(value=>/condition|approval/i.test(value.name))),
  generatedUseful:rows.filter(row=>row.generatedMoveCorrect&&row.oneStableUsableReply).length,locallySupplied:rows.filter(row=>row.localCompletionSafe&&row.oneStableUsableReply).length,
  unstable:rows.filter(row=>!row.stableThroughClose).length,retries:rows.reduce((sum,row)=>sum+row.retries,0),verifierCalls:rows.reduce((sum,row)=>sum+row.verifierCalls,0),
  identitySafety:{tested:rows.filter(row=>row.identityOutcomes).length,passed:rows.filter(row=>row.identityOutcomes?.identitySafety.pass).length},samePressRecovery:{tested:rows.filter(row=>row.identityOutcomes).length,passed:rows.filter(row=>row.identityOutcomes?.samePressRecovery.pass).length},
  latencyTargetMs:1800,latencyMeasuredMoments:0,latencyPass:null,estimatedCostUsd:0}},null,2));
