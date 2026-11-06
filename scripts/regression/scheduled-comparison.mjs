// Pure comparison protocol. No browser, storage, credentials or provider calls.
const normalized=text=>String(text??'').trim().replace(/\s+/g,' ');
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,canonical(item)])):value;
const same=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
const digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/i.test(value);

export function scheduledContract({id,audioSha256,lastWordOffsetMs,wordUncertaintyMs=0,requestOffsetMs,maxDispatchDriftMs=40,maxPairOffsetDeltaMs=40,expectedPhase='speaking',probe='ordinary'}){
 if(!id||!digest(audioSha256)||![lastWordOffsetMs,wordUncertaintyMs,requestOffsetMs,maxDispatchDriftMs,maxPairOffsetDeltaMs].every(value=>finite(value)&&value>=0))throw new Error('A schedule requires identity, audio SHA and nonnegative source-relative milliseconds.');
 if(!['before_speech','speaking','transcribing','transcript_ready'].includes(expectedPhase)||!['ordinary','exact-final','meaning-change'].includes(probe))throw new Error('Unknown scheduled phase or lifecycle probe.');
 return {version:1,id,audioSha256,sourceCue:{lastWordOffsetMs,wordUncertaintyMs},request:{offsetMs:requestOffsetMs,maxDispatchDriftMs,maxPairOffsetDeltaMs,expectedPhase},probe};
}

export function phaseAtRequest(events,atMs){
 const speaking=new Set(),pending=new Set();let anyFinal=false;
 for(const row of events.filter(row=>finite(row.atMs)&&row.atMs<=atMs).sort((a,b)=>a.atMs-b.atMs)){
  const id=row.itemId||'buyer';
  if(row.kind==='speech_started'){speaking.add(id);pending.add(id);}
  if(row.kind==='speech_stopped')speaking.delete(id);
  if(row.kind==='transcript_final'){pending.delete(id);anyFinal=true;}
 }
 return speaking.size?'speaking':pending.size?'transcribing':anyFinal?'transcript_ready':'before_speech';
}

export function validateScheduledRun(contract,run){
 const reasons=[],add=(code,detail)=>reasons.push({code,detail}),events=Array.isArray(run.events)?run.events.slice().sort((a,b)=>a.atMs-b.atMs):[];
 const all=kind=>events.filter(row=>row.kind===kind),one=kind=>all(kind)[0];
 if(run.contractId!==contract.id)add('contract_mismatch','The observed run did not declare this schedule before playback.');
 if(!same(run.scheduledRequest,contract.request))add('schedule_mismatch','The source-relative request schedule or its tolerances changed.');
 if(run.audioSha256!==contract.audioSha256)add('audio_mismatch','The decoded audio SHA differs from the declared recording.');
 if(!same(run.sourceCue,contract.sourceCue))add('source_cue_mismatch','The actual annotated last-word cue differs from the declared audio schedule.');
 if(!digest(run.inputSha256))add('missing_input_fingerprint','Approved evidence and chronological prefix must have a semantic input fingerprint.');
 if(!run.models||!Object.keys(run.models).length)add('missing_models','Actual model configuration was not recorded.');
 if(!['offline-scripted','observed-audio-browser'].includes(run.observationKind))add('unknown_observation_kind','Scripted and observed timing must be distinguished.');
 if(run.clock!=='audio-source-performance')add('clock_mismatch','Audio cue, dispatch and browser observations must use one source-relative performance clock.');
 for(const stream of ['generation','cancellation','verification','repair','publication','visible'])if(run.observationCoverage?.[stream]!==true)add('missing_observation_stream',stream+' is unobserved, not a known zero.');
 const required=['schedule_armed','audio_started','speech_started','speech_stopped','first_asr_delta','transcript_final','completed_turn','intentional_request','provider_request','first_output','say_complete','publication','visible','request_settled'];
 for(const kind of required)if(!one(kind))add('missing_event',kind);
 if(events.some(row=>!finite(row.atMs)))add('invalid_timestamp','Every recorded event requires an actual clock value.');
 const start=one('audio_started'),requests=all('intentional_request'),request=requests[0],lastAsr=all('transcript_final').at(-1),final=one('completed_turn'),publications=all('publication'),publication=publications[0];
 const finalsById=new Map(all('transcript_final').map(row=>[row.itemId,row])),spokenIds=[...new Set(all('speech_started').map(row=>row.itemId).filter(id=>finalsById.has(id)))];
 for(const id of finalsById.keys())if(!spokenIds.includes(id))spokenIds.push(id);
 if(all('completed_turn').length!==1)add('completed_turn_count','One aggregated completed buyer turn is required.');
 if(final){
  if(!same(final.itemIds,spokenIds)||spokenIds.some(id=>typeof id!=='string'||!id))add('completed_turn_items','Completed turn must name every current ASR item in spoken order.');
  const assembled=spokenIds.map(id=>finalsById.get(id)?.text||'').join(' ');
  if(normalized(final.text)!==normalized(assembled))add('completed_turn_assembly','Completed turn dropped or changed source ASR words.');
  if(lastAsr&&final.atMs<lastAsr.atMs)add('premature_turn_completion','The buyer turn was declared complete before its final ASR item.');
 }
 if(requests.length!==1)add('request_count',`Expected one intentional request; observed ${requests.length}.`);
 if(publications.length!==1)add('publication_count',`Expected one published answer; observed ${publications.length}.`);
 const actualOffset=finite(start?.atMs)&&finite(request?.atMs)?request.atMs-start.atMs:null;
 const actualPhase=request?phaseAtRequest(events,request.atMs):null;
 if(actualOffset!==null&&Math.abs(actualOffset-contract.request.offsetMs)>contract.request.maxDispatchDriftMs)add('late_or_early_dispatch',`Scheduled ${contract.request.offsetMs}ms; dispatched ${actualOffset}ms after source start.`);
 if(actualPhase!==contract.request.expectedPhase)add('phase_mismatch',`Expected ${contract.request.expectedPhase}; request actually occurred during ${actualPhase}.`);
 if(publication&&final&&publication.atMs<final.atMs)add('premature_publication','Wording was published before canonical final recognition.');
 if(publication&&final&&typeof publication.usedFinalText!=='string')add('missing_completed_turn_evidence','The published generation’s completed-turn snapshot was not observed.');
 else if(publication&&final&&normalized(publication.usedFinalText)!==normalized(final.text))add('completed_turn_lost','Published request did not use the completed buyer turn.');
 if(publication&&!normalized(publication.say))add('empty_publication','The card contained no usable spoken wording.');
 const visible=all('visible').find(row=>row.full===true&&normalized(row.say)===normalized(publication?.say));
 if(!visible)add('missing_stable_visible','No independently observed full paint of the published wording exists.');
 if(visible&&(!visible.documentVisible||!visible.scriptFullyVisible))add('not_visible','The tab or full spoken line was not visible.');
 if(visible&&publication&&visible.atMs<publication.atMs)add('paint_before_publication','Visible observation precedes publication.');
 if(run.observationKind==='observed-audio-browser'&&visible?.evidence!=='browser-full-paint')add('paint_not_observed','Live visible latency cannot be synthesized from controller publication.');
 if(all('visible').some(row=>row.full===true&&normalized(row.say)!==normalized(publication?.say)))add('unstable_wording','Another full spoken line appeared for this press.');
 if(run.quality?.verdict!=='pass')add('not_correct','Retain this quality result, but exclude it from claims about correct reply speed.');
 const provisional=one('provisional_transcript'),speculation=one('speculation_started');
 if(contract.probe!=='ordinary'){
  if(!provisional||!speculation||!final||speculation.atMs>=final.atMs)add('probe_not_exercised','No hidden generation from provisional speech was observed before final recognition.');
  if(provisional&&final){const equal=normalized(provisional.text)===normalized(final.text);if(contract.probe==='exact-final'&&!equal)add('probe_text_mismatch','An exact-final reuse probe received changed words.');if(contract.probe==='meaning-change'&&equal)add('probe_text_mismatch','A meaning-change probe received identical words.');}
  if(!one('speculation_accepted')&&!one('speculation_discarded'))add('missing_probe_outcome','Whether the provisional draft was retained or discarded was not recorded.');
  if(contract.probe==='meaning-change'&&(!one('speculation_discarded')||!all('provider_request').some(row=>row.atMs>=final?.atMs)))add('changed_meaning_not_revised','Changed meaning did not discard the old draft and generate from the completed turn.');
 }
 const generation=all('provider_request').findLast(row=>!publication?.generationId||row.generationId===publication.generationId);
 const token=all('first_output').find(row=>!publication?.generationId||row.generationId===publication.generationId),say=all('say_complete').find(row=>!publication?.generationId||row.generationId===publication.generationId);
 if(!publication?.generationId||!generation||!token||!say)add('missing_published_generation_evidence','Request, first output and SAY completion must belong to the generation actually published.');
 const ids=all('provider_request').map(row=>row.generationId),settled=one('request_settled');
 if(ids.some(id=>typeof id!=='string'||!id)||new Set(ids).size!==ids.length)add('generation_identity','Every dispatch needs one distinct generation identity.');
 if(all('request_settled').length!==1)add('settlement_count','One explicit settled observation is required.');
 for(const kind of ['provider_created','provider_completed','first_output','say_complete','response_cancel'])for(const row of all(kind))if(!ids.includes(row.generationId))add('orphan_generation_event',kind+' has no matching dispatch: '+String(row.generationId));
 for(const id of new Set(ids)){
  const dispatched=all('provider_request').find(row=>row.generationId===id),created=all('provider_created').find(row=>row.generationId===id),terminal=all('provider_completed').filter(row=>row.generationId===id);
  if(!created||terminal.length!==1||!['completed','cancelled'].includes(terminal[0]?.status))add('missing_generation_terminal',String(id));
  if(created&&dispatched&&created.atMs<dispatched.atMs||terminal[0]&&created&&terminal[0].atMs<created.atMs)add('invalid_generation_order','Creation/completion predates its dispatch: '+String(id));
  if(terminal[0]?.status==='completed'&&(!all('first_output').some(row=>row.generationId===id)||!all('say_complete').some(row=>row.generationId===id)))add('missing_generation_output','Completed generation lacks its own observed output/SAY line: '+String(id));
  if(terminal[0]&&settled&&terminal[0].atMs>settled.atMs)add('premature_settlement','A provider attempt ended after settlement.');
  if(id===publication?.generationId&&terminal[0]?.status!=='completed')add('published_generation_not_completed','The published wording has no completed provider response.');
 }
 for(const check of all('verification_started')){
  const terminal=all('verification_finished').concat(all('verification_cancelled')).filter(row=>row.checkId&&row.checkId===check.checkId);
  if(!check.checkId||terminal.length!==1||terminal[0].atMs<check.atMs||settled&&terminal[0].atMs>settled.atMs)add('missing_verification_terminal','A started check must finish or cancel before settlement: '+String(check.checkId));
 }
 for(const end of all('verification_finished').concat(all('verification_cancelled')))if(!all('verification_started').some(row=>row.checkId&&row.checkId===end.checkId))add('orphan_verification_terminal','Check completion has no matching observed start.');
 const counts={requests:requests.length,publications:publications.length,generations:all('provider_request').length,cancellations:all('response_cancel').length,verifications:all('verification_started').length,repairs:all('repair_requested').length};
 if(settled&&!same(settled.counts,counts))add('settled_count_mismatch','Recorded settled counts differ from the observed lifecycle streams.');
 if(settled&&visible&&settled.atMs<visible.atMs)add('premature_settlement','Settlement precedes the stable visible observation.');
 if(generation&&token&&token.atMs<generation.atMs)add('invalid_generation_order','First output predates its request.');
 if(token&&say&&say.atMs<token.atMs)add('invalid_generation_order','Completed SAY predates first output.');
 const lastWordAt=finite(start?.atMs)?start.atMs+contract.sourceCue.lastWordOffsetMs:null;
 const elapsed=visible&&lastWordAt!==null?visible.atMs-lastWordAt:null;
 if(elapsed!==null&&elapsed<0)add('negative_latency','Stable wording appeared before the annotated end of the buyer turn.');
 const components={lastWordToFinalAsrMs:lastAsr&&lastWordAt!==null?lastAsr.atMs-lastWordAt:null,finalAsrToCompletedTurnMs:lastAsr&&final?final.atMs-lastAsr.atMs:null,finalAsrToGenerationDispatchMs:lastAsr&&generation?generation.atMs-lastAsr.atMs:null,completedTurnToGenerationDispatchMs:final&&generation?generation.atMs-final.atMs:null,generationDispatchToFirstOutputMs:generation&&token?token.atMs-generation.atMs:null,firstOutputToCompleteSayMs:token&&say?say.atMs-token.atMs:null,completeSayToPublicationMs:say&&publication?publication.atMs-say.atMs:null,publicationToVisibleMs:publication&&visible?visible.atMs-publication.atMs:null};
 return {eligible:reasons.length===0,reasons,quality:run.quality||null,actualRequestOffsetMs:actualOffset,actualPhase,probeOutcome:one('speculation_accepted')?'retained':one('speculation_discarded')?'discarded':null,timingKind:run.observationKind==='offline-scripted'?'scripted-clock-not-live':'observed-audio-browser',liveLatencyMs:run.observationKind==='observed-audio-browser'?elapsed:null,scriptedScheduleMs:run.observationKind==='offline-scripted'?elapsed:null,conservativeLiveLatencyMs:run.observationKind==='observed-audio-browser'&&elapsed!==null?elapsed+contract.sourceCue.wordUncertaintyMs:null,components,counts,events};
}

export function compareScheduledRuns(contract,baseline,candidate){
 const before=validateScheduledRun(contract,baseline),after=validateScheduledRun(contract,candidate),reasons=[];
 if(!before.eligible)reasons.push(...before.reasons.map(row=>({...row,run:'baseline'})));
 if(!after.eligible)reasons.push(...after.reasons.map(row=>({...row,run:'candidate'})));
 if(baseline.audioSha256!==candidate.audioSha256)reasons.push({code:'pair_audio_mismatch'});
 if(baseline.inputSha256!==candidate.inputSha256)reasons.push({code:'pair_input_mismatch'});
 if(!same(baseline.models,candidate.models))reasons.push({code:'pair_model_mismatch'});
 if(baseline.observationKind!==candidate.observationKind)reasons.push({code:'pair_observation_mismatch'});
 const speechEvidence=run=>{
  const rows=(run.events||[]).slice().sort((a,b)=>a.atMs-b.atMs),turn=rows.find(row=>row.kind==='completed_turn'),provisional=rows.find(row=>row.kind==='provisional_transcript'),items=new Map(rows.filter(row=>row.kind==='transcript_final').map(row=>[row.itemId,row]));
  // Provider item IDs are run-local. Compare ordered segment contents, not the
  // random identifiers; preserve segmentation/order as well as assembled words.
  return {completed:turn?normalized(turn.text):null,segments:turn?.itemIds?.map(id=>normalized(items.get(id)?.text)),provisional:provisional?normalized(provisional.text):null};
 };
 const beforeSpeech=speechEvidence(baseline),afterSpeech=speechEvidence(candidate);
 if(beforeSpeech.completed!==afterSpeech.completed)reasons.push({code:'pair_completed_transcript_mismatch',detail:'The same recording produced different completed-turn words; approved-prefix equality does not make model inputs identical.'});
 if(!same(beforeSpeech.segments,afterSpeech.segments))reasons.push({code:'pair_asr_item_sequence_mismatch',detail:'The source ASR item sequence or its words changed.'});
 if(beforeSpeech.provisional!==afterSpeech.provisional)reasons.push({code:'pair_provisional_transcript_mismatch',detail:'The provisional generation received different words; no automatic semantic equivalence is assumed.'});
 if(before.actualPhase!==after.actualPhase)reasons.push({code:'pair_phase_mismatch'});
 if(finite(before.actualRequestOffsetMs)&&finite(after.actualRequestOffsetMs)&&Math.abs(before.actualRequestOffsetMs-after.actualRequestOffsetMs)>contract.request.maxPairOffsetDeltaMs)reasons.push({code:'pair_dispatch_mismatch'});
 const eligible=reasons.length===0,canCompareLiveTiming=eligible&&baseline.observationKind==='observed-audio-browser';
 return {eligible,canCompareLiveTiming,reasons,baseline:before,candidate:after,liveDeltaMs:canCompareLiveTiming?after.liveLatencyMs-before.liveLatencyMs:null,qualityPreserved:[baseline.quality,candidate.quality],qualification:eligible?'Protocol matched for this individual pair; this alone is not statistical or causal proof of a speedup. Scripted transport cannot establish live latency.':'Not a matched speed comparison. Keep wording, quality failures and individual timings; do not pool or claim a speed delta.'};
}

// A local timer removes operator/tool round trips. The callback must be the
// ordinary isolated-app request entry point; this module never clicks a UI.
export function armSourceRelativeRequest(contract,{sourceStartAtMs,now,setTimer=setTimeout,clearTimer=clearTimeout,onObservation,request}){
 if(!finite(sourceStartAtMs)||typeof now!=='function'||typeof request!=='function')throw new Error('Source clock and normal request callback are required.');
 const due=sourceStartAtMs+contract.request.offsetMs;let used=false,cancelled=false;
 onObservation?.({kind:'schedule_armed',atMs:now(),dueAtMs:due,contractId:contract.id,audioSha256:contract.audioSha256,scheduledRequest:contract.request});
 const timer=setTimer(()=>{if(used||cancelled)return;used=true;const atMs=now();onObservation?.({kind:'intentional_request',atMs,dueAtMs:due,dispatchDriftMs:atMs-due,contractId:contract.id});request();},Math.max(0,due-now()));
 return {cancel(){if(used||cancelled)return;cancelled=true;clearTimer(timer);onObservation?.({kind:'schedule_cancelled',atMs:now(),contractId:contract.id});}};
}
