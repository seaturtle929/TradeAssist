import {buyerVadSilenceMs} from './turn-detection.ts';
import {CoachingPhaseClock,type CoachingPhaseTiming} from './coaching-timing.ts';
import {snapshotCoachingContext,coachingRequestFocus,type CoachingSpeechSnapshot} from './coaching-context-snapshot.ts';
import {deriveCallParticipant} from './call-participant.ts';
import type {CoachingRequestTrace} from './coaching-request-trace';
import {applyCoachingConfiguration} from './coaching-configuration.ts';
import {configurationReferences} from './company-configuration.ts';
import {attributeGuidance} from './generation-foundation.ts';
import { LiveTurnCoordinator, type AcceptedBuyerTurn, type LiveReplyTicket } from "./live-turn-coordinator.ts";
import { LiveVerification } from "./live-verification.ts";
import { completedLiveReply, parseLiveDraft } from "./live.ts";
import { liveRequestInstructionsFor } from "./live-request.ts";
import { isWrittenQuoteConfirmation, needsFactCheck, limitScript, type CoachingContext } from "./call-coaching.ts";
import { isTranscriptionPromptEcho, unexpectedEnglishScript } from "./transcript-quality.ts";
import { selectKnowledge } from "./knowledge.ts";
import {includeLookupSources,type KnowledgeReference} from './live-knowledge.ts';
import { fastRouteFor, checkSuggestion, safePurposeReply } from "./call-purpose.ts";
import { isUnfinishedBuyerThought } from "./buyer-thought.ts";
import { assessBuyerTranscript, audioIssueFor, type BuyerAudioIssue } from "./buyer-audio-quality.ts";
import {assessReplyVerification,classifyBuyerTurn} from './turn-verification-policy.ts';
import {analyzeBuyerText,spokenReplyBudget} from './buyer-turn-intent.ts';
import {hasClearConversationRefusal} from './conversation-boundary.ts';
import {LiveLatencyClock,type LiveLatencySnapshot,type AcousticEnd} from './live-latency.ts';
import type { Guidance, Turn } from "./trade";

export type LiveContext=Omit<CoachingContext,"turns"|"sources"> & {turns:Pick<Turn,"id"|"text"|"role"|"at">[];sources:KnowledgeReference[];[key:string]:unknown};
export type LiveReplyTelemetry={type:'first_display'|'verification_complete'|'complete';suggestionId:string;turnId:string;callId?:string;at:number;verificationRequired:boolean;status:'checking'|'passed'|'replaced'|'failed'|'not_required';say:string;firstDisplayMs?:number;verificationCompleteMs?:number;totalMs?:number;acousticLatency?:LiveLatencySnapshot;phases?:CoachingPhaseTiming};
export type LiveVerificationReplacement={suggestionId:string;turnId:string;callId?:string;at:number;originalSay:string;replacementSay:string;reason:string;originalWasDisplayed:boolean};
export type PendingBuyerQuestion={turnId:string;text:string;at:number};
export type LiveQuestionQueueEvent={type:'queued'|'carried'|'resolved'|'withdrawn';at:number;turnId:string;questions:PendingBuyerQuestion[];affected?:PendingBuyerQuestion[];reason:string};
export type LiveSuggestionIssue={suggestionId:string;turnId:string;at:number;status:'rejected'|'unavailable'|'correction';originalSay:string;reason:string;correction?:Guidance;context:LiveContext};
export type LiveTranscriptionTiming={id:string;role:'buyer'|'conversation';speechStartedAt?:number;speechStoppedAt?:number;firstPartialAt?:number;finalAt?:number};
export type QueuedCoachingRequest={id:string;requestedAt:number;status:'listening'|'transcribing';message:string};
export type LiveRequestReceipt=LiveReplyTicket|{queued:true;id:string;requestedAt:number};
type QueuedRequest={id:string;requestedAt:number;started:number;queuedAt:number;queueWaitMs:number;preparationMs:number;continuedDrafts:number;context:LiveContext;status?:QueuedCoachingRequest['status'];stoppedAt?:number;timer?:ReturnType<typeof setTimeout>;speechIds:Set<string>;partials:CoachingSpeechSnapshot['partials'];pending:CoachingSpeechSnapshot['pendingSpeech']};
type Work={phaseClock:CoachingPhaseClock;ticket:LiveReplyTicket;context:LiveContext;library:KnowledgeReference[];lookupSources?:KnowledgeReference[];id:string;started:number;timer?:ReturnType<typeof setTimeout>;fallback?:AbortController;rescued:boolean;answered:boolean;ready:boolean;toolRounds:number;verifier:LiveVerification<Guidance>;
  purpose:boolean;route:ReturnType<typeof fastRouteFor>;cached?:Guidance;checking:boolean;archived:boolean;superseded:boolean;published?:Guidance;publishedAt?:number;proposedSay?:string;representativeText?:string;analysis?:Partial<Guidance>;analysisTimer?:ReturnType<typeof setTimeout>;analysisShown:boolean;metadataComplete:boolean;
  awaitingTranscript?:boolean;deferredResponse?:Record<string,unknown>;repairCount:number;repairPending:boolean;repairReason?:string;rejected?:boolean;candidateAttempt?:number;
  firstDisplayAt?:number;verificationAt?:number;verificationCandidate?:string;verificationGuidance?:Guidance;unverifiedDisplayed?:string;lastDisplayedSay?:string;verificationFailure?:string;replacementLogged?:boolean;contextReplacement?:{originalSay:string;reason:string;originalWasDisplayed:boolean}};
type ResponseBuffer={work:Work;text:string;checked:Guidance|null;checkedSay:string;primed:string;firstShown:boolean;previewSay?:string;attempt?:number;formatRecovered?:boolean;providerDoneRecorded?:boolean;rawWordingRecorded?:boolean};
type RealtimeOutputItem={type?:string;name?:string;arguments?:string;call_id?:unknown;content?:{text?:string}[]};
type RealtimeResponse={id?:unknown;metadata?:Record<string,unknown>;usage?:unknown;status?:string;output?:RealtimeOutputItem[]};
const nonlexical=(text:string)=>/^(?:uh+|um+|hmm+|mm[- ]?hmm)[.!?\s]*$/i.test(text.trim());
const representativeAcknowledgment=(text:string)=>/^(?:(?:uh+|um+|hmm+|mm[- ]?hmm|yeah|yes|yep|okay|ok|right|sure|absolutely|thanks|thank you|I see|I understand|understood|got it|that makes sense|that['’]s helpful|sounds good)[,.!\s]*)+$/i.test(text.trim());
function pinTranscript(context:LiveContext,turn:AcceptedBuyerTurn):LiveContext {
  // ASR may revise the words, but it cannot confirm an unknown speaker or undo
  // a person's manual speaker correction.
  const role=context.turns.find(item=>item.id===turn.id)?.role||'buyer';
  return applyCoachingConfiguration({...context,turns:[...context.turns.filter(item=>item.id!==turn.id),{...turn,role}]});
}
export type LiveCoachingSessionOptions={
  snapshot:(turn:AcceptedBuyerTurn)=>LiveContext;
  /** Transcript already present before this listening session. It remains
   * context, but must never masquerade as newly captured buyer speech. */
  initialTranscriptIds?:readonly string[];
  listeningStartedAt?:number;
  /** Read current UI state only until queued speech is ready. Generation and
   * verification then share one immutable snapshot. */
  latestContext?:(turns?:LiveContext['turns'])=>LiveContext;
  onQueuedRequest?:(state:QueuedCoachingRequest|null)=>void;
  knowledgeSources?:(context:LiveContext)=>KnowledgeReference[];
  send:(event:Record<string,unknown>)=>void;
  verify:(context:LiveContext,proposed:Guidance,signal:AbortSignal)=>Promise<Guidance>;
  fallback:(context:LiveContext,signal:AbortSignal)=>Promise<Guidance>;
  onGuidance:(guidance:Guidance,id:string,at:number,complete:boolean,latency:number,trigger:string,context?:LiveContext)=>void;
  onSupersede:()=>void;
  onPendingTurn:(text:string)=>void;
  onThinking:(active:boolean)=>void;
  onChecking:(active:boolean)=>void;
  onBuyerTurn:(turn:AcceptedBuyerTurn)=>void;
  onBuyerPartial:(text:string)=>void;
  onBuyerSpeech:(active:boolean)=>void;
  onBuyerPending:(ids:string[])=>void;
  onUsage:(kind:"live"|"transcription",usage:unknown)=>void;
  onWarning:(message:string)=>void;
  onError:(message:string)=>void;
  onSupersedeCard?:(triggerTurnId:string)=>void;
  onArchiveCard?:(id:string,reason:"used"|"spoken"|"ignored",actualText?:string)=>void;
  onAnalysis?:(triggerTurnId:string,guidance:Guidance)=>void;
  onTelemetry?:(event:LiveReplyTelemetry)=>void;
  onVerificationReplacement?:(event:LiveVerificationReplacement)=>void;
  onQuestionQueue?:(event:LiveQuestionQueueEvent)=>void;
  onSuggestionIssue?:(event:LiveSuggestionIssue)=>void;
  onObservation?:(snapshot:CoachingSpeechSnapshot)=>void;
  onTranscriptionTiming?:(timing:LiveTranscriptionTiming)=>void;
  onRequestTrace?:(event:CoachingRequestTrace)=>void;
  /** Restore only this same call's pending questions; literal buyer speech in
   * the supplied snapshot must validate every item before it is reused. */
  initialQuestions?:PendingBuyerQuestion[];
  /** Enable confidence checks for the isolated computer/buyer channel. */
  onAudioIssue?:(issue:BuyerAudioIssue|null)=>void;
  transcriptionTimeoutMs?:number;
  incompleteAudioGraceMs?:number;
  fallbackAfterMs?:number;
  fallbackTimeoutMs?:number;
  thinkingPauseMs?:number;
  vadSilenceMs?:number;
  /** Additional continuation window after the provider's existing VAD pause. */
  continuationSettleMs?:number;
  /** Maximum wait for a final transcript after the latest speech stop. */
  queuedTranscriptionTimeoutMs?:number;
};

/** Continuously observes conversation, but generates only for an explicit request. */
export class LiveCoachingSession {
  readonly coordinator:LiveTurnCoordinator;
  readonly latencyClock=new LiveLatencyClock();
  private readonly options:LiveCoachingSessionOptions;
  private historicalTranscriptIds?:Set<string>;
  private listeningStartedAt:number;
  private readonly works=new Map<number,Work>();
  private readonly requestSnapshots=new Map<string,{context:LiveContext;started:number;dispatchStarted:number;enqueuedAt:number;preparationMs:number;queueWaitMs:number;continuedDrafts:number}>();
  private readonly requestedIds=new Set<string>();
  private readonly speechObservations=new Map<string,LiveTranscriptionTiming&{order:number;observedAt?:number}>();
  private readonly responses=new Map<string,ResponseBuffer>();
  private readonly requestEvents=new Map<string,{work:Work;attempt:number}>();
  private readonly starts=new Map<string,number>();
  private readonly partials=new Map<string,string>();
  private readonly pending=new Set<string>();
  private readonly finals=new Set<string>();
  private readonly usage=new Set<string>();
  private stopped=false;
  private queued?:QueuedRequest;
  private speculationCandidate?:{requestId:string;itemId:string;text:string;readyAfter:number};
  private speculative?:{requestId:string;itemId:string;text:string;fingerprint:string;startedAt:number};
  private readonly speculationAttempted=new Set<string>();
  private readonly speculationStats=new Map<string,{speculativeGenerations:number;discardedSpeculations:number;speculationEligibleAtMs:number;speculationOverlapMs?:number}>();
  private readonly observedFinals=new Map<string,AcceptedBuyerTurn>();
  private readonly resolvedSpeechIds=new Set<string>();
  private readonly unansweredBuyerQuestions=new Map<string,PendingBuyerQuestion>();
  private restoredQuestions=false;
  private latestBuyerAt=-Infinity;
  private thoughtTimer?:ReturnType<typeof setTimeout>;
  private readonly audioItems=new Map<string,{order:number;at:number;audioStart?:number;speechMs?:number;logprobs:unknown[];timer?:ReturnType<typeof setTimeout>}>();
  private audioOrder=0;
  private acceptedAudioOrder=0;
  private issueAudioOrder=0;
  private audioAttempts=0;
  private readonly reportedAudio=new Set<string>();
  private readonly timedOutAudio=new Set<string>();
  private incomplete?:{turn:AcceptedBuyerTurn;order:number;timer?:ReturnType<typeof setTimeout>};

  constructor(options:LiveCoachingSessionOptions) {
    this.options=options;
    this.historicalTranscriptIds=options.initialTranscriptIds?new Set(options.initialTranscriptIds):undefined;
    this.listeningStartedAt=options.listeningStartedAt??Date.now();
    this.coordinator=new LiveTurnCoordinator({
      onRequest:(ticket,continuation)=>this.request(ticket,!!continuation),
      onSupersede:()=>{
        for(const work of this.works.values()){
          work.verifier.invalidate();work.fallback?.abort();if(work.timer)clearTimeout(work.timer);if(work.analysisTimer)clearTimeout(work.analysisTimer);
          if(!this.stopped&&!work.archived&&!work.superseded&&!work.answered){work.superseded=true;this.trace(work,'superseded',{reason:'A new intentional request owns the next response.'});options.onSupersedeCard?.(work.ticket.turn.id);}
        }
        options.onSupersede();options.onChecking(false);
      },
      onCancel:id=>{if(!this.stopped)options.send({type:"response.cancel",...(id ? {response_id:id} : {})});},
    });
  }

  /** No speech callback is allowed to allocate a coaching request. */
  acceptBuyer(turn:AcceptedBuyerTurn):null {
    if(this.stopped || turn.transcriptionUncertainty || nonlexical(turn.text) || isTranscriptionPromptEcho(turn.text))return null;
    const literal=pinTranscript(this.options.snapshot(turn),turn);
    this.restoreQuestions(literal,turn.id);
    if(this.questionWithdrawn(turn.text))this.removeQuestions(this.pendingQuestions(),turn.id,'withdrawn','The buyer withdrew the earlier question or ended this exchange.');
    this.queueQuestions(turn,literal);
    const carried=this.pendingQuestions().filter(item=>item.turnId!==turn.id);
    if(carried.length)this.questionEvent('carried',turn.id,carried,'The buyer continued; unanswered questions remain available for the next explicit coaching request.');
    this.latestBuyerAt=Math.max(this.latestBuyerAt,turn.at);
    return null;
  }
  acceptRepresentative(turn:AcceptedBuyerTurn):boolean {
    if(this.stopped || turn.transcriptionUncertainty || !turn.text.trim() || !Number.isFinite(turn.at) || isTranscriptionPromptEcho(turn.text))return false;
    const active=[...this.works.values()].find(work=>this.current(work));
    if(this.incomplete&&this.incomplete.turn.at<=turn.at&&(!analyzeBuyerText(this.incomplete.turn.text).hasQuestion||this.resolvesBuyerText(this.incomplete.turn.text,turn.text))){this.clearIncomplete();this.syncBuyerPending();}
    // Actual speech may resolve the pending agenda, but does not rate, cancel,
    // archive, regenerate or mutate an already requested suggestion.
    this.resolveSpokenQuestions(turn,active);
    return true;
  }

  /** One click authorizes one request. If its current buyer turn is unfinished,
   * observe that turn until a natural pause; freeze only when dispatching. */
  requestNextMove(context:LiveContext,preparationMs=context.coachingRequest?.preparationMs??0):LiveRequestReceipt|null {
    if(this.stopped)return null;
    if(this.queued)return {queued:true,id:this.queued.id,requestedAt:this.queued.requestedAt};
    const prepareStarted=performance.now(),started=prepareStarted-Math.max(0,preparationMs);
    const supplied=context.coachingRequest;
    const requestedAt=supplied?.requestedAt??Date.now();
    const id=supplied?.id||`request-${crypto.randomUUID()}`;
    if(this.requestedIds.has(id))return null;
    this.requestedIds.add(id);
    this.latencyClock.recordRequest(id,started);
    const snapshot=applyCoachingConfiguration(snapshotCoachingContext(this.withListeningBoundary({...context,coachingRequest:{...supplied,id,requestedAt}}),this.observedSpeechSnapshot()));
    const speech=snapshot.coachingRequest!,unfinished=speech.partials?.some(part=>part.role!=='you')||speech.pendingSpeech?.some(part=>part.role!=='you');
    if(this.coordinator.state.buyerSpeaking||unfinished){
      // A newer intent cancels only unfinished work; old displayed wording
      // remains in history while this temporary listening status is visible.
      for(const work of this.works.values())if(this.current(work)&&!work.answered){
        work.superseded=true;work.verifier.invalidate();work.fallback?.abort();if(work.timer)clearTimeout(work.timer);if(work.analysisTimer)clearTimeout(work.analysisTimer);
        this.trace(work,'superseded',{reason:'A newer intentional request is waiting for the current buyer turn.'});this.options.onSupersedeCard?.(work.ticket.turn.id);
      }
      this.coordinator.retireCurrent();this.options.onThinking(false);this.options.onChecking(false);
      const relevantIds=[...(speech.partials||[]),...(speech.pendingSpeech||[])].filter(item=>item.role!=='you').flatMap(item=>item.id?[item.id]:[]);
      const stops=relevantIds.flatMap(id=>{const at=this.latencyClock.snapshot(id)?.speechStoppedAtMs;return at===undefined?[]:[at];});
      this.queued={id,requestedAt,started,queuedAt:performance.now(),queueWaitMs:0,preparationMs:performance.now()-started,continuedDrafts:0,context:structuredClone(context),stoppedAt:this.coordinator.state.buyerSpeaking?undefined:stops.length?Math.max(...stops):performance.now(),speechIds:new Set(),partials:[],pending:[]};
      this.captureQueuedSpeech(snapshot);
      this.options.onRequestTrace?.({event:'queued',requestId:id,suggestionId:`coaching-${id}`,at:requestedAt,attempt:0,focus:coachingRequestFocus(snapshot),snapshot:{request:structuredClone(snapshot.coachingRequest!),turns:structuredClone(snapshot.turns),participant:deriveCallParticipant(snapshot.turns)}});
      this.scheduleQueuedRequest();return {queued:true,id,requestedAt};
    }
    return this.dispatchRequest(snapshot,started,prepareStarted,preparationMs);
  }
  private withListeningBoundary(context:LiveContext):LiveContext {
    if(!this.historicalTranscriptIds||!context.coachingRequest)return context;
    const observed=this.observedSpeechSnapshot();
    const ids=[...context.turns,...context.coachingRequest.partials||[],...context.coachingRequest.pendingSpeech||[],...observed.partials,...observed.pendingSpeech].flatMap(turn=>turn.id&&!this.historicalTranscriptIds!.has(turn.id)?[turn.id]:[]);
    const currentTurnIds=[...new Set(ids)];
    return {...context,coachingRequest:{...context.coachingRequest,listeningSession:{startedAt:this.listeningStartedAt,currentTurnIds}}};
  }
  /** An actual capture resume opens a new current-speech window. Historical
   * transcript and already displayed guidance remain untouched. */
  markListeningResumed(initialTranscriptIds:readonly string[]):void {
    if(this.stopped)return;
    this.cancelQueuedRequest();
    this.historicalTranscriptIds=new Set([...this.historicalTranscriptIds||[],...initialTranscriptIds,...this.speechObservations.keys(),...this.pending,...this.incomplete?[this.incomplete.turn.id]:[]]);
    this.clearIncomplete();this.clearThoughtPause();
    this.listeningStartedAt=Date.now();this.coordinator.buyerSpeech(false);this.options.onBuyerSpeech(false);this.syncBuyerPending();
  }
  private dispatchRequest(snapshot:LiveContext,started:number,dispatchStarted=performance.now(),preparationMs=0,queueWaitMs=0,continuedDrafts=0,speculating=false):LiveReplyTicket|null {
    const {id,requestedAt}=snapshot.coachingRequest!;
    if(!speculating)this.restoreQuestions(snapshot,id);
    const focus=coachingRequestFocus(snapshot);
    snapshot.unansweredBuyerQuestions=(speculating&&this.questionWithdrawn(focus.text)?[]:this.questionsFor(snapshot)).slice(0,8);
    if(speculating&&focus.turnId){
      const turn=snapshot.turns.find(item=>item.id===focus.turnId)!;
      snapshot.unansweredBuyerQuestions=[...snapshot.unansweredBuyerQuestions,...analyzeBuyerText(turn.text).questions.map(text=>({turnId:turn.id,text,at:turn.at}))].slice(0,8);
      this.speculative!.fingerprint=this.speculationFingerprint(snapshot);
    }
    this.requestSnapshots.clear();this.requestSnapshots.set(id,{context:snapshot,started,dispatchStarted,enqueuedAt:performance.now(),preparationMs,queueWaitMs,continuedDrafts});
    const text=focus.text;
    if(focus.turnId&&!snapshot.coachingRequest?.speechItemIds?.length)this.latencyClock.linkRequestSpeech(id,focus.turnId);
    this.options.onRequestTrace?.({event:speculating?'speculation_started':'requested',requestId:id,suggestionId:`coaching-${id}`,at:speculating?Date.now():requestedAt,attempt:0,...speculating?{reason:'Hidden generation from complete-looking provisional recognition. This shadow transcript is not confirmed speech; no validation or display is allowed until the final transcript and request meaning match.'}:{},focus,snapshot:{request:structuredClone(snapshot.coachingRequest!),turns:structuredClone(snapshot.turns),participant:deriveCallParticipant(snapshot.turns)}});
    this.options.onPendingTurn(focus.displayText);this.options.onThinking(true);
    const ticket=this.coordinator.requestNextMove({id,text,at:requestedAt});
    // Never retain caller-owned mutable data after the snapshot was pinned.
    if(!ticket)this.requestSnapshots.delete(id);
    return ticket;
  }
  private captureQueuedSpeech(context:LiveContext) {
    const queued=this.queued;if(!queued)return;
    const request=context.coachingRequest;
    for(const partial of request?.partials||[])if(partial.role!=='you'){
      if(partial.id)queued.speechIds.add(partial.id);
      const index=queued.partials.findIndex(item=>partial.id?item.id===partial.id:item.text===partial.text);
      if(index<0)queued.partials.push({...partial});else queued.partials[index]={...partial};
    }
    for(const pending of request?.pendingSpeech||[])if(pending.role!=='you'){
      queued.speechIds.add(pending.id);const index=queued.pending.findIndex(item=>item.id===pending.id);
      if(index<0)queued.pending.push({...pending});else queued.pending[index]={...pending};
    }
  }
  private queuedContext(refreshed?:LiveContext):LiveContext {
    const queued=this.queued!;
    // Readiness observes speech only. Rebuilding retrieval/foundation on every
    // ASR token adds work precisely when the current turn needs low latency.
    const latest=refreshed||queued.context;
    // Keep fresh authority, client updates and stage intent at release. Identity
    // switches are rejected by releaseQueuedRequest; overwriting fresh fields
    // here would hide a changed boundary from the speculative fingerprint.
    const context=structuredClone(latest),known=new Set(context.turns.map(turn=>turn.id));
    // React can publish its next render after an ASR callback. Include observed
    // literal finals without guessing the speaker on a mixed-audio channel.
    for(const turn of this.observedFinals.values())if(queued.speechIds.has(turn.id)&&!known.has(turn.id))context.turns.push({...turn,role:this.options.onAudioIssue?'buyer':'conversation'});
    context.turns.sort((a,b)=>(a.at??0)-(b.at??0));
    const current={...context,coachingRequest:{...context.coachingRequest,id:queued.id,requestedAt:queued.requestedAt,
      partials:context.coachingRequest?.partials?.filter(part=>!part.id||!this.resolvedSpeechIds.has(part.id)),
      pendingSpeech:context.coachingRequest?.pendingSpeech?.filter(part=>!this.resolvedSpeechIds.has(part.id))}};
    return snapshotCoachingContext(this.withListeningBoundary(current),this.observedSpeechSnapshot());
  }
  private scheduleQueuedRequest() {
    const queued=this.queued;if(!queued||this.stopped)return;
    if(queued.timer)clearTimeout(queued.timer);queued.timer=undefined;
    const current=this.queuedContext();this.captureQueuedSpeech(current);
    const provisional=this.speculative&&current.coachingRequest?.partials?.find(part=>part.id===this.speculative!.itemId);
    if(provisional&&this.normalizedSpeech(provisional.text)!==this.speculative!.text)this.discardSpeculation('The provisional words changed before final transcription.');
    const speaking=this.coordinator.state.buyerSpeaking;
    const status=speaking?'listening':'transcribing';
    if(queued.status!==status){queued.status=status;this.options.onQueuedRequest?.({id:queued.id,requestedAt:queued.requestedAt,status,message:'Listening… your suggestion will appear when they finish.'});}
    if(speaking){this.speculationCandidate=undefined;this.discardSpeculation('The buyer resumed before final transcription.');queued.stoppedAt=undefined;return;}
    queued.stoppedAt??=performance.now();
    const elapsed=performance.now()-queued.stoppedAt,settle=this.options.continuationSettleMs??120;
    const finalIds=new Set(current.turns.map(turn=>turn.id));
    const unfinished=current.coachingRequest?.partials?.some(part=>part.role!=='you')||current.coachingRequest?.pendingSpeech?.some(item=>item.role!=='you')||[...queued.speechIds].some(id=>!finalIds.has(id)&&!this.resolvedSpeechIds.has(id));
    const deadline=this.options.queuedTranscriptionTimeoutMs??900;
    if(elapsed>=settle&&!unfinished){this.releaseQueuedRequest('ready');return;}
    if(elapsed>=deadline){this.releaseQueuedRequest('transcription_timeout');return;}
    if(unfinished)this.trySpeculativeGeneration(current);
    const candidateWait=this.speculationCandidate?Math.max(1,this.speculationCandidate.readyAfter-performance.now()):Infinity;
    const wait=unfinished?Math.min(deadline-elapsed,candidateWait):Math.max(0,settle-elapsed);
    queued.timer=setTimeout(()=>this.scheduleQueuedRequest(),Math.max(1,wait));
  }
  private releaseQueuedRequest(reason:'ready'|'suggest_now'|'transcription_timeout'):LiveReplyTicket|null {
    const queued=this.queued;if(!queued||this.stopped)return null;
    this.speculationCandidate=undefined;
    const dispatchStarted=performance.now(),queueWaitMs=queued.queueWaitMs+dispatchStarted-queued.queuedAt;
    if(queued.timer)clearTimeout(queued.timer);
    const latest=this.options.latestContext?.()||this.options.snapshot({id:queued.id,text:'',at:queued.requestedAt});
    const previous=queued.context;
    if(previous.callId&&latest.callId&&previous.callId!==latest.callId||previous.clientId&&latest.clientId&&previous.clientId!==latest.clientId||previous.manufacturer?.name&&latest.manufacturer?.name&&previous.manufacturer.name!==latest.manufacturer.name||previous.manufacturer?.id!==latest.manufacturer?.id){
      this.cancelQueuedRequest();this.options.onWarning('The call or company changed while listening. Request a new suggestion for the current call.');return null;
    }
    let context=this.queuedContext(latest);this.captureQueuedSpeech(context);
    // Audio-error cleanup may have removed its pending text. Retain captured
    // fragments as provisional instead of answering the preceding buyer turn.
    if(reason!=='ready')context=snapshotCoachingContext(context,{partials:queued.partials.filter(part=>!part.id||!this.resolvedSpeechIds.has(part.id)),pendingSpeech:queued.pending.filter(part=>!this.resolvedSpeechIds.has(part.id))});
    const releasedAt=Date.now(),speechIds=[...queued.speechIds].sort((a,b)=>(this.speechObservations.get(a)?.order??0)-(this.speechObservations.get(b)?.order??0));
    context=applyCoachingConfiguration({...context,coachingRequest:{...context.coachingRequest!,releasedAt,queuedForMs:Math.max(0,performance.now()-queued.started),releaseReason:reason,speechItemIds:speechIds}});
    const lastSpeechId=speechIds.at(-1);if(lastSpeechId)this.latencyClock.linkRequestSpeech(queued.id,lastSpeechId,speechIds);
    const speculativeWork=this.speculative?this.acceptSpeculation(context,reason):undefined;
    this.queued=undefined;this.options.onQueuedRequest?.(null);
    this.options.onRequestTrace?.({event:'queue_released',requestId:queued.id,suggestionId:`coaching-${queued.id}`,at:releasedAt,attempt:0,reason,focus:coachingRequestFocus(context),snapshot:{request:structuredClone(context.coachingRequest!),turns:structuredClone(context.turns),participant:deriveCallParticipant(context.turns)}});
    if(reason==='transcription_timeout')this.options.onWarning('The last buyer words did not finish transcribing. The suggestion uses only the words available; check any missing details.');
    if(speculativeWork){
      speculativeWork.phaseClock.phases.queueWaitMs=queueWaitMs;
      const deferred=speculativeWork.deferredResponse;speculativeWork.deferredResponse=undefined;
      if(deferred)this.handle(deferred);else {const buffer=[...this.responses.values()].find(item=>item.work===speculativeWork);if(buffer)this.update(buffer);}
      return speculativeWork.ticket;
    }
    return this.dispatchRequest(context,queued.started,dispatchStarted,queued.preparationMs,queueWaitMs,queued.continuedDrafts);
  }
  private normalizedSpeech(text:string){return text.trim().replace(/\s+/g,' ');}
  private speculationFingerprint(context:LiveContext):string {
    const stable=(value:unknown):unknown=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).filter(([,item])=>item!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,stable(item)])):value;
    const normalized=structuredClone(context);
    const request=normalized.coachingRequest!;
    normalized.coachingRequest={...request,preparationMs:undefined,releasedAt:undefined,queuedForMs:undefined,releaseReason:undefined};
    normalized.turns=normalized.turns.map(turn=>({...turn,text:this.normalizedSpeech(turn.text)}));
    const focus=coachingRequestFocus(normalized),instructions=liveRequestInstructionsFor(normalized,{id:request.id,text:focus.text,at:request.requestedAt});
    // Compare complete model meaning plus all original evidence/authority, not
    // just the last utterance or selected excerpts. Request clocks are not
    // semantic input. The generated buyerMemory clock is already omitted by
    // the normal generation projection; original client history is retained.
    return JSON.stringify(stable({instructions,companyConfiguration:normalized.companyConfiguration,sources:normalized.sources,clientContext:normalized.clientContext,callContext:normalized.callContext,manufacturer:normalized.manufacturer,brain:normalized.brain&&{facts:normalized.brain.facts,rules:normalized.brain.rules,learningExamples:normalized.brain.learningExamples,rejectedSignatures:normalized.brain.rejectedSignatures,decisionLog:normalized.brain.decisionLog}}));
  }
  private trySpeculativeGeneration(current:LiveContext):void {
    const queued=this.queued;if(!queued||this.speculative||this.speculationAttempted.has(queued.id)||!this.options.onAudioIssue||this.coordinator.state.buyerSpeaking||this.coordinator.state.serverBusy){this.speculationCandidate=undefined;return;}
    const partials=current.coachingRequest?.partials||[],pending=current.coachingRequest?.pendingSpeech||[];
    if(partials.length!==1||partials[0].role!=='buyer'||!partials[0].id||pending.some(item=>item.id!==partials[0].id||item.role!=='buyer')){this.speculationCandidate=undefined;return;}
    const part=partials[0],text=this.normalizedSpeech(part.text),item=this.audioItems.get(part.id!);
    if(!/[.!?]["')\]]*$/.test(text)||/(?:\.\.\.|…)["')\]]*$/.test(text)||this.incomplete||this.timedOutAudio.has(part.id!)||this.reportedAudio.has(part.id!)||this.finals.has(part.id!)||assessBuyerTranscript({text,logprobs:item?.logprobs,speechMs:item?.speechMs}).status!=='accept'||unexpectedEnglishScript(text)||isTranscriptionPromptEcho(text)){this.speculationCandidate=undefined;return;}
    // ASR can stream a punctuated greeting then its question a few milliseconds
    // later. Spend the one hidden attempt only after a short token-stability
    // window. Canonical finals bypass this entirely via normal ready release.
    const candidate=this.speculationCandidate;
    if(!candidate||candidate.requestId!==queued.id||candidate.itemId!==part.id||candidate.text!==text){this.speculationCandidate={requestId:queued.id,itemId:part.id!,text,readyAfter:performance.now()+35};return;}
    if(performance.now()<candidate.readyAfter)return;
    this.speculationCandidate=undefined;
    const turn={id:part.id!,text,role:'buyer' as const,at:this.starts.get(part.id!)||part.at||queued.requestedAt};
    const turns=[...current.turns.filter(value=>value.id!==turn.id),turn].sort((a,b)=>a.at-b.at);
    const latest=this.options.latestContext?.(turns)||{...current,turns};
    if(latest.callId!==current.callId||latest.manufacturer?.id!==current.manufacturer?.id||latest.coachingRequest?.partials?.some(part=>part.role==='you')||latest.coachingRequest?.pendingSpeech?.some(part=>part.role==='you'))return;
    // Pure shadow only: never call onBuyerTurn/acceptBuyer or persist provisional
    // words. The full payload is rebuilt for these candidate words so later
    // exact comparison includes the derived foundation and authority.
    const shadow=applyCoachingConfiguration(snapshotCoachingContext(this.withListeningBoundary({...latest,turns,coachingRequest:{...current.coachingRequest!,partials:[],pendingSpeech:[],speechItemIds:[...queued.speechIds],transcriptState:'confirmed'}})));
    const at=performance.now();this.speculationAttempted.add(queued.id);
    this.speculationStats.set(queued.id,{speculativeGenerations:1,discardedSpeculations:0,speculationEligibleAtMs:at});
    this.speculative={requestId:queued.id,itemId:turn.id,text,fingerprint:'',startedAt:at};
    this.dispatchRequest(shadow,queued.started,at,queued.preparationMs,queued.queueWaitMs+at-queued.queuedAt,queued.continuedDrafts,true);
    this.options.onThinking(false);
  }
  private discardSpeculation(reason:string):void {
    const speculation=this.speculative;if(!speculation)return;
    const work=[...this.works.values()].find(item=>this.current(item)&&item.ticket.turn.id===speculation.requestId);
    if(work){
      work.superseded=true;work.awaitingTranscript=false;work.verifier.invalidate();work.fallback?.abort();if(work.timer)clearTimeout(work.timer);if(work.analysisTimer)clearTimeout(work.analysisTimer);
      const raw=[...this.responses.values()].find(item=>item.work===work)?.text;
      this.trace(work,'speculation_discarded',{rawText:raw,status:'hidden_discarded',reason});
    }
    const stats=this.speculationStats.get(speculation.requestId);if(stats)stats.discardedSpeculations++;
    this.requestSnapshots.delete(speculation.requestId);this.speculative=undefined;this.coordinator.retireCurrent();this.options.onThinking(false);this.options.onChecking(false);
  }
  private acceptSpeculation(context:LiveContext,reason:string):Work|undefined {
    const speculation=this.speculative;if(!speculation)return;
    const work=[...this.works.values()].find(item=>this.current(item)&&item.ticket.turn.id===speculation.requestId);
    const final=this.observedFinals.get(speculation.itemId);
    context.unansweredBuyerQuestions=this.questionsFor(context).slice(0,8);
    if(reason!=='ready'||!work||!final||this.normalizedSpeech(final.text)!==speculation.text||context.coachingRequest?.partials?.length||context.coachingRequest?.pendingSpeech?.length||this.speculationFingerprint(context)!==speculation.fingerprint){this.discardSpeculation('Final recognition, current conversation or authority differs from the provisional candidate, or final transcription was unavailable.');return;}
    const stats=this.speculationStats.get(speculation.requestId)!;stats.speculationOverlapMs=performance.now()-speculation.startedAt;
    Object.assign(work.phaseClock.phases,stats);work.awaitingTranscript=false;work.context=context;this.speculative=undefined;
    this.trace(work,'speculation_accepted',{status:'final_confirmed',reason:'Exact normalized final text and complete generation meaning/evidence/authority match. Ordinary factual and conversation checks now run on the real final snapshot.'});
    return work;
  }
  /** A pause can segment one explanation before its final qualification. An
   * existing click follows resumed isolated-buyer speech only while no wording
   * has been published. This is continuation of the same intent, not a repair
   * or another automatic coaching request. Mixed microphone audio cannot prove
   * that the buyer (rather than the rep) resumed, so it cannot cancel wording. */
  private followUnpublishedBuyerContinuation(id:string):void {
    if(this.queued||!this.options.onAudioIssue||!id||this.historicalTranscriptIds?.has(id))return;
    const work=[...this.works.values()].find(item=>this.current(item)&&!item.answered&&!item.published&&!item.lastDisplayedSay);
    // After release, the coordinator can still be awaiting cancellation of an
    // older provider response. Its current ticket then has a pinned snapshot
    // but no Work yet. A third sentence must also follow the original click.
    const pendingId=this.coordinator.state.pendingBuyer;
    const pinned=!work&&pendingId?this.requestSnapshots.get(pendingId):undefined;
    const source=work?.context||pinned?.context;
    if(!source?.coachingRequest)return;
    const request=source.coachingRequest,phase=work?.phaseClock.snapshot()||{queueWaitMs:pinned!.queueWaitMs,dispatchPreparationMs:pinned!.preparationMs+pinned!.enqueuedAt-pinned!.dispatchStarted,continuedDrafts:pinned!.continuedDrafts};
    const previousIds=request.speechItemIds||[],focus=coachingRequestFocus(source);
    if(previousIds.includes(id)||focus.turnId===id)return;
    if(work){
      const drafts=[...this.responses.values()].filter(item=>item.work===work);
      const raw=drafts.at(-1)?.text||'',say=work.proposedSay||(raw?parseLiveDraft(raw,work.context)?.say:undefined);
      work.superseded=true;work.verifier.invalidate();work.fallback?.abort();
      if(work.timer)clearTimeout(work.timer);if(work.analysisTimer)clearTimeout(work.analysisTimer);
      this.trace(work,'turn_continued',{rawText:raw||undefined,say,status:'unpublished_cancelled',reason:'The buyer resumed before any wording was published. Retain the original click and rebuild from the complete continued turn; this cancelled draft is not a verification repair.'});
    }else{
      this.requestSnapshots.delete(request.id);
      this.options.onRequestTrace?.({event:'turn_continued',requestId:request.id,suggestionId:`coaching-${request.id}`,at:Date.now(),attempt:0,status:'pending_dispatch_requeued',focus,reason:'The buyer continued while the provider cancellation acknowledgment was pending. Retire that undispatched snapshot and keep the original click queued for the complete turn; no additional draft was generated.'});
    }
    this.coordinator.retireCurrent();this.options.onThinking(false);this.options.onChecking(false);
    const context=structuredClone(source);
    context.coachingRequest={...request,releasedAt:undefined,releaseReason:undefined,queuedForMs:undefined,speechItemIds:undefined,partials:[],pendingSpeech:[]};
    this.queued={id:request.id,requestedAt:request.requestedAt,started:work?.started??pinned!.started,queuedAt:performance.now(),queueWaitMs:phase.queueWaitMs||0,preparationMs:phase.dispatchPreparationMs||0,continuedDrafts:(phase.continuedDrafts||0)+(work?1:0),context,speechIds:new Set([...previousIds,...(focus.turnId?[focus.turnId]:[]),id]),partials:[],pending:[]};
  }
  suggestNow():LiveReplyTicket|null {return this.releaseQueuedRequest('suggest_now');}
  cancelQueuedRequest():boolean {
    const queued=this.queued;if(!queued)return false;
    this.speculationCandidate=undefined;this.discardSpeculation('The representative cancelled the queued request.');
    if(queued.timer)clearTimeout(queued.timer);this.queued=undefined;this.options.onQueuedRequest?.(null);this.options.onThinking(false);this.options.onChecking(false);
    this.options.onRequestTrace?.({event:'queue_cancelled',requestId:queued.id,suggestionId:`coaching-${queued.id}`,at:Date.now(),attempt:0,reason:'The representative cancelled the queued request.'});
    return true;
  }
  markUsed(id?:string):boolean {
    return this.retireSuggestion(id,"used");
  }
  markIgnored(id?:string):boolean {
    return this.retireSuggestion(id,"ignored");
  }
  private retireSuggestion(id:string|undefined,reason:"used"|"ignored"):boolean {
    const work=[...this.works.values()].find(value=>this.current(value)&&(!id||id===value.id));if(!work)return false;
    if(reason==='used'){
      const say=work.published?.say||work.unverifiedDisplayed||work.proposedSay||'';
      this.removeQuestions(this.questionsFor(work.context).filter(item=>this.questionCovered(item,say,work)),work.ticket.turn.id,'resolved','The representative explicitly marked a reply covering this question as spoken/Used.');
    }
    this.clearThoughtPause();work.archived=true;work.answered=true;work.verifier.invalidate();work.fallback?.abort();if(work.timer)clearTimeout(work.timer);if(work.analysisTimer)clearTimeout(work.analysisTimer);
    this.coordinator.retireCurrent();this.options.onArchiveCard?.(work.id,reason);this.options.onPendingTurn("");this.options.onThinking(false);this.options.onChecking(false);return true;
  }
  /** Compatibility for an explicit refresh action; speech never calls this. */
  refreshLatest():boolean {
    const work=[...this.works.values()].find(value=>this.current(value));if(!work||this.stopped)return false;
    const context=this.options.snapshot(work.ticket.turn);
    return !!this.requestNextMove({...context,coachingRequest:{id:`request-${crypto.randomUUID()}`,requestedAt:Date.now()}});
  }
  stop() {
    if(this.stopped)return;
    this.cancelQueuedRequest();
    for(const work of this.works.values())if(!work.answered&&!work.archived&&!work.superseded){
      const buffer=[...this.responses.values()].findLast(item=>item.work===work&&(item.attempt??0)===work.repairCount);
      const candidate=work.proposedSay||(buffer?parseLiveDraft(buffer.text,work.context)?.say:undefined);
      if(candidate)this.issue(work,'unavailable',candidate,'Listening stopped before validation finished. This candidate is retained for review and was never ready to say.');
      this.trace(work,'cancelled',{status:'cancelled',reason:'Listening stopped before this requested suggestion finished.',focus:coachingRequestFocus(work.context)});
    }
    this.stopped=true;this.clearThoughtPause();this.clearIncomplete();for(const item of this.audioItems.values())if(item.timer)clearTimeout(item.timer);this.audioItems.clear();this.coordinator.reset();this.responses.clear();this.requestEvents.clear();this.works.clear();this.requestSnapshots.clear();this.requestedIds.clear();this.speculationAttempted.clear();this.speculationStats.clear();this.pending.clear();this.partials.clear();this.speechObservations.clear();this.observedFinals.clear();this.resolvedSpeechIds.clear();this.unansweredBuyerQuestions.clear();this.observeSpeech();this.options.onAudioIssue?.(null);
  }

  confirmBuyerAudio():void {
    if(this.stopped)return;
    this.audioAttempts=0;this.options.onAudioIssue?.(null);
  }
  observedSpeechSnapshot():CoachingSpeechSnapshot {
    const role=this.options.onAudioIssue?'buyer' as const:'conversation' as const;
    const current=(id:string)=>!this.historicalTranscriptIds?.has(id);
    const partials=[...this.partials].filter(([id,text])=>current(id)&&text.trim()&&!this.finals.has(id)).map(([id,text])=>{const item=this.speechObservations.get(id);return {id,role,text,at:this.starts.get(id)||item?.speechStartedAt,observedAt:item?.observedAt,order:item?.order};});
    if(this.incomplete&&current(this.incomplete.turn.id)&&!partials.some(item=>item.id===this.incomplete?.turn.id))partials.push({id:this.incomplete.turn.id,role,text:this.incomplete.turn.text,at:this.incomplete.turn.at,observedAt:undefined,order:this.incomplete.order});
    return {partials,pendingSpeech:[...this.pending].filter(id=>current(id)&&!this.finals.has(id)).map(id=>{const item=this.speechObservations.get(id);return {id,role,at:this.starts.get(id)||item?.speechStartedAt,order:item?.order,hasPartial:this.partials.has(id)};})};
  }
  private observeSpeech(){this.options.onObservation?.(this.observedSpeechSnapshot());this.scheduleQueuedRequest();}
  private transcriptTiming(id:string,update:Partial<LiveTranscriptionTiming>) {
    const previous=this.speechObservations.get(id)||{id,role:this.options.onAudioIssue?'buyer' as const:'conversation' as const,order:this.speechObservations.size+1};
    const next={...previous,...update};this.speechObservations.set(id,next);
    this.options.onTranscriptionTiming?.({...next});
  }

  /** Same captured buyer track, measured locally; it never opens an audio gate. */
  noteBuyerSignal(active:boolean,atMs=performance.now(),resolutionMs=50):void {
    if(!this.stopped)this.latencyClock.recordSignalActivity({active,atMs,resolutionMs});
  }
  recordBuyerAcousticEnd(id:string,end:AcousticEnd):void {if(!this.stopped)this.latencyClock.recordAcousticEnd(id,end);}
  recordReplyPaint(id:string,say:string,full:boolean,atMs=performance.now()):LiveLatencySnapshot|undefined {
    if(this.stopped)return;
    this.latencyClock.recordDisplay(id,{say,full,sink:'dom',atMs});
    return this.latencyClock.snapshot(id);
  }

  private audioItem(id:string) {
    let item=this.audioItems.get(id);
    if(!item){item={order:++this.audioOrder,at:this.starts.get(id)||Date.now(),logprobs:[]};this.audioItems.set(id,item);}
    return item;
  }
  private clearIncomplete() {if(this.incomplete?.timer)clearTimeout(this.incomplete.timer);this.incomplete=undefined;}
  private syncBuyerPending() {
    const observed=this.observedSpeechSnapshot(),ids=[...new Set([...observed.pendingSpeech.map(item=>item.id),...observed.partials.flatMap(item=>item.id?[item.id]:[])])];
    this.options.onBuyerPending(ids);
    this.options.onBuyerPartial(observed.partials.at(-1)?.text||"");
    this.coordinator.buyerPending(ids.length>0||!!this.thoughtTimer);
    this.observeSpeech();
  }
  private audioProblem(id:string,order:number,reason:string,message:string) {
    if(this.stopped||this.reportedAudio.has(id)||order<Math.max(this.acceptedAudioOrder,this.issueAudioOrder))return;
    this.reportedAudio.add(id);
    // Audio recovery is independent of a request already pinned by the rep.
    // Keep that suggestion/generation stable while surfacing missing speech.
    this.clearThoughtPause();this.clearIncomplete();
    this.issueAudioOrder=order;this.audioAttempts++;
    this.options.onAudioIssue?.(audioIssueFor(id,reason,message,this.audioAttempts));
    this.options.onWarning("A buyer passage was unclear during this call. A repeat prompt was shown; review any missing details before relying on the call record.");
  }
  private waitForIncomplete(turn:AcceptedBuyerTurn,order:number) {
    this.clearIncomplete();this.incomplete={turn,order};this.coordinator.buyerPending(true);
    const wait=()=>{
      const fragment=this.incomplete;if(!fragment||this.stopped)return;
      const state=this.coordinator.state;
      if(state.paused||state.buyerSpeaking||state.repSpeaking||state.repPending||this.pending.size){fragment.timer=setTimeout(wait,this.options.incompleteAudioGraceMs??3000);return;}
      this.audioProblem(fragment.turn.id,fragment.order,"incomplete","The buyer's last sentence ended mid-thought. Part of the answer may be missing.");
      this.syncBuyerPending();
    };
    this.incomplete.timer=setTimeout(wait,this.options.incompleteAudioGraceMs??3000);
  }

  private completeBuyerAudio(id:string,text:string,event:Record<string,unknown>):void {
    const item=this.audioItem(id);if(item.timer)clearTimeout(item.timer);item.timer=undefined;
    const logprobs=Array.isArray(event.logprobs)&&event.logprobs.length?event.logprobs:item.logprobs;
    const result=assessBuyerTranscript({text,logprobs,speechMs:item.speechMs});
    if(this.historicalTranscriptIds?.has(id)){
      // A delayed final from before pause/resume is still historical evidence.
      // It cannot reopen the new speech window or join a new buyer sentence.
      if(text.trim()&&!String(event.type).endsWith('.failed')&&!isTranscriptionPromptEcho(text)&&result.status!=='ignore'){
        const uncertainty=unexpectedEnglishScript(text)||(result.status==='unfinished'||result.status==='uncertain'?{reason:result.reason||'incomplete',message:result.message||'This earlier passage ended before its meaning was complete.'}:undefined);
        this.options.onBuyerTurn({id,text,at:item.at,...uncertainty?{transcriptionUncertainty:uncertainty}:{}});
      }
      this.pending.delete(id);this.partials.delete(id);this.starts.delete(id);this.audioItems.delete(id);this.syncBuyerPending();return;
    }
    if(String(event.type).endsWith(".failed"))this.audioProblem(id,item.order,"failed","A passage of buyer audio could not be transcribed.");
    else if(isTranscriptionPromptEcho(text)){
      this.options.send({type:"conversation.item.delete",item_id:id});
      this.audioProblem(id,item.order,"unreliable","The transcription looked like an audio artifact and was excluded.");
    } else if(result.status==="uncertain"||unexpectedEnglishScript(text)){
      const uncertainty=unexpectedEnglishScript(text)||{reason:result.reason||"uncertain",message:result.message||"Some buyer words could not be transcribed confidently."};
      // Keep the recognizer's literal words visible for correction. Uncertain
      // details are provisional context, never confirmed buyer facts/questions.
      if(text.trim())this.options.onBuyerTurn({id,text,at:item.at,transcriptionUncertainty:uncertainty});
      this.audioProblem(id,item.order,uncertainty.reason,uncertainty.message);
    }
    else if(result.status!=="ignore") {
      // A continuation after a thinking pause belongs to the same buyer thought.
      const fragment=this.incomplete;
      const fresh=item.order>=Math.max(this.acceptedAudioOrder,this.issueAudioOrder);
      const combined=fragment&&fresh&&item.order>fragment.order&&!text.toLowerCase().startsWith(fragment.turn.text.toLowerCase())
        ? fragment.turn.text+" "+text : text;
      const turn={id,text:combined,at:fragment&&fresh?Math.min(fragment.turn.at,item.at):item.at};
      if(fresh){
        this.clearIncomplete();
        if(result.status==="unfinished"){this.waitForIncomplete(turn,item.order);}
        else if(!(this.audioAttempts&&(representativeAcknowledgment(text)||/^no[.!]*$/i.test(text)))) {
          this.acceptedAudioOrder=item.order;
          // Transcript ingestion never supersedes an explicit coaching request.
          if(fragment&&fresh)this.resolvedSpeechIds.add(fragment.turn.id);
          this.resolvedSpeechIds.add(id);this.observedFinals.set(id,turn);this.options.onBuyerTurn(turn);this.acceptBuyer(turn);
          this.audioAttempts=0;this.options.onAudioIssue?.(null);
        }
      } else if(!fresh) {
        // Keep reliable historical words, but never replay their old question.
        this.resolvedSpeechIds.add(id);this.observedFinals.set(id,{id,text,at:item.at});this.options.onBuyerTurn({id,text,at:item.at});
        const historical={id,text,at:item.at};
        this.queueQuestions(historical,pinTranscript(this.options.snapshot(historical),historical));
      }
    }
    this.pending.delete(id);this.partials.delete(id);this.starts.delete(id);this.audioItems.delete(id);
    if(result.status==="ignore"&&this.incomplete)this.waitForIncomplete(this.incomplete.turn,this.incomplete.order);
    this.syncBuyerPending();
  }

  handle(event:Record<string,unknown>) {
    if(this.stopped)return;
    const id=typeof event.item_id==="string" ? event.item_id : "";
    if(event.type==="input_audio_buffer.speech_started") {
      if(id)this.latencyClock.recordSpeechStarted(id,{audioStartMs:typeof event.audio_start_ms==='number'?event.audio_start_ms:undefined});
      this.clearThoughtPause();
      if(id){this.starts.set(id,Date.now());this.pending.add(id);}
      if(id)this.transcriptTiming(id,{speechStartedAt:Date.now()});
      if(this.options.onAudioIssue&&id){
        const item=this.audioItem(id);if(item.timer)clearTimeout(item.timer);item.timer=undefined;
        if(typeof event.audio_start_ms==="number")item.audioStart=event.audio_start_ms;
        if(this.incomplete?.timer)clearTimeout(this.incomplete.timer);
      }
      this.coordinator.buyerSpeech(true);this.followUnpublishedBuyerContinuation(id);this.coordinator.buyerPending(this.pending.size>0);
      this.options.onBuyerPending([...this.pending]);this.options.onBuyerSpeech(true);this.observeSpeech();return;
    }
    if(event.type==="input_audio_buffer.speech_stopped") {
      if(this.queued)this.queued.stoppedAt=performance.now();
      if(id)this.transcriptTiming(id,{speechStoppedAt:Date.now()});
      if(id)this.latencyClock.recordSpeechStopped(id,{audioEndMs:typeof event.audio_end_ms==='number'?event.audio_end_ms:undefined,vadSilenceMs:this.options.vadSilenceMs??buyerVadSilenceMs(this.options.onAudioIssue?"computer":"headset")});
      if(this.options.onAudioIssue&&id&&!this.finals.has(id)){
        const item=this.audioItem(id);
        item.speechMs=typeof event.audio_end_ms==="number"&&item.audioStart!==undefined?Math.max(0,event.audio_end_ms-item.audioStart):Date.now()-item.at;
        if(item.timer)clearTimeout(item.timer);
        item.timer=setTimeout(()=>{
          item.timer=undefined;if(this.stopped||this.finals.has(id))return;
          this.timedOutAudio.add(id);
          const partial=this.partials.get(id)||"";
          if((item.speechMs??0)>=1200||(partial.trim()&&!nonlexical(partial)))this.audioProblem(id,item.order,"timeout","Buyer speech was detected, but its transcript did not arrive. The last words may be missing.");
          this.pending.delete(id);this.partials.delete(id);this.syncBuyerPending();
          if(this.incomplete)this.waitForIncomplete(this.incomplete.turn,this.incomplete.order);
        },this.options.transcriptionTimeoutMs??5000);
      }
      this.coordinator.buyerSpeech(false);this.options.onBuyerSpeech(false);this.scheduleQueuedRequest();return;
    }
    if(event.type==="conversation.item.input_audio_transcription.delta") {
      if(id&&!this.finals.has(id)){
        if(this.options.onAudioIssue){
          const item=this.audioItem(id);if(Array.isArray(event.logprobs)&&item.logprobs.length<512)item.logprobs.push(...event.logprobs.slice(0,512-item.logprobs.length));
          // The timeout has already released this item. Late partials are not a
          // new speech event and cannot re-lock the channel without a final.
          if(this.reportedAudio.has(id)||this.timedOutAudio.has(id))return;
          this.pending.add(id);this.coordinator.buyerPending(true);
        }
        this.partials.set(id,(this.partials.get(id)||"")+String(event.delta||""));this.options.onBuyerPartial(this.partials.get(id)!);
        const observation=this.speechObservations.get(id);if(this.partials.get(id)?.trim()&&observation?.firstPartialAt===undefined)this.transcriptTiming(id,{firstPartialAt:Date.now()});
        const latest=this.speechObservations.get(id);if(latest)latest.observedAt=Date.now();this.observeSpeech();
      }return;
    }
    if(event.type==="conversation.item.input_audio_transcription.completed" || event.type==="conversation.item.input_audio_transcription.failed") {
      if(!id || this.finals.has(id))return;this.finals.add(id);
      this.transcriptTiming(id,{finalAt:Date.now()});
      this.latencyClock.recordTranscriptFinalized(id);
      if(event.usage)this.options.onUsage("transcription",event.usage);
      const text=typeof event.transcript==="string" ? event.transcript.trim() : "";
      if(this.options.onAudioIssue){this.completeBuyerAudio(id,text,event);return;}
      if(event.type.endsWith(".failed"))this.options.onWarning("A passage of buyer audio could not be transcribed. Check the transcript and add the actual words if needed.");
      else if(text && !nonlexical(text) && !isTranscriptionPromptEcho(text)) {
        const uncertainty=unexpectedEnglishScript(text);
        const turn={id,text,at:this.starts.get(id)||Date.now(),...uncertainty?{transcriptionUncertainty:uncertainty}:{}};
        if(turn.at>=this.latestBuyerAt){
          if(isUnfinishedBuyerThought(text))this.holdThoughtPause();else this.clearThoughtPause();
        }
        if(!uncertainty)this.observedFinals.set(id,turn);
        this.options.onBuyerTurn(turn);this.acceptBuyer(turn);
        if(uncertainty)this.options.onWarning(uncertainty.message);
      } else if(text && isTranscriptionPromptEcho(text)){this.options.send({type:"conversation.item.delete",item_id:id});this.options.onWarning("A transcription prompt was excluded from the call. Check the audio input if it happens again.");}
      else {
        const unfinished=[...this.works.values()].find(work=>this.current(work)&&!work.answered&&isUnfinishedBuyerThought(work.ticket.turn.text));
        if(unfinished)this.holdThoughtPause();
      }
      // Blank/failed audio does not replace the last real buyer question.
      this.pending.delete(id);this.partials.delete(id);this.starts.delete(id);
      this.options.onBuyerPending([...this.pending]);this.options.onBuyerPartial([...this.partials.values()].at(-1)||"");
      this.coordinator.buyerPending(this.pending.size>0||!!this.thoughtTimer);this.observeSpeech();return;
    }
    if(event.type==="response.created") {
      const response=event.response as RealtimeResponse,revision=Number(response?.metadata?.epoch),responseId=String(response?.id||"");
      if(!this.coordinator.responseCreated(responseId,revision))return;
      const work=this.works.get(revision);if(!work)return;
      this.responses.set(responseId,{work,text:"",checked:null,checkedSay:"",primed:"",firstShown:false,attempt:work.repairCount});
      if(!work.awaitingTranscript)this.options.onThinking(true);return;
    }
    if(event.type==="response.output_text.delta" || event.type==="response.text.delta") {
      const buffer=this.responses.get(String(event.response_id));if(!buffer || !this.current(buffer.work)||(buffer.attempt??0)!==buffer.work.repairCount)return;
      buffer.work.phaseClock.firstDelta();buffer.text+=String(event.delta||"");
      if(!buffer.rawWordingRecorded&&/^SAY:[^\n]*\S[^\n]*\n/m.test(buffer.text)){buffer.rawWordingRecorded=true;buffer.work.phaseClock.rawWordingComplete();}
      this.update(buffer);return;
    }
    if(event.type==="response.done") {
      const response=event.response as RealtimeResponse,responseId=String(response?.id||"");
      if(response?.usage && !this.usage.has(responseId)){this.usage.add(responseId);this.options.onUsage("live",response.usage);}
      const buffer=this.responses.get(responseId);
      this.coordinator.responseDone(responseId);
      if(!buffer || !this.current(buffer.work))return;
      const work=buffer.work;if((buffer.attempt??0)===work.repairCount&&!buffer.providerDoneRecorded){buffer.providerDoneRecorded=true;work.phaseClock.providerComplete();}
      if(work.awaitingTranscript){work.deferredResponse=event;return;}
      this.trace(work,'candidate',{rawText:buffer.text||JSON.stringify(response.output||[]),status:response.status,attempt:buffer.attempt??0});
      if((buffer.attempt??0)!==work.repairCount){if(work.repairPending)this.coordinator.continueResponse(work.ticket);return;}
      work.metadataComplete=true;
      if(response.status!=="completed"){if(!work.answered)void this.rescue(work);return;}
      if(!buffer.text)buffer.text=(response.output||[]).flatMap(item=>item.content||[]).map(content=>content.text||"").join("");
      const main=this.completedSay(buffer,true);
      const lookups=(response.output||[]).filter(item=>item.type==="function_call"&&item.name==="lookup_company_knowledge");
      if(lookups.length && work.toolRounds++<2) {
        for(const lookup of lookups) {
          let query="";try{query=String(JSON.parse(lookup.arguments as string).query||"").slice(0,6000);}catch{}
          if(typeof lookup.call_id!=="string")continue;
          const sources=query?selectKnowledge(work.library,query,24000):[];
          work.lookupSources=includeLookupSources(work.lookupSources||[],sources);
          work.context={...work.context,sources:includeLookupSources(work.context.sources,sources)};
          this.options.send({type:"conversation.item.create",item:{type:"function_call_output",call_id:lookup.call_id,output:JSON.stringify({sources,notice:"Original reference excerpts only. Confirm unsupported details with the factory."})}});
        }
        // A tool turn may already contain a finished, no-fact confirmation.
        // Return every lookup result, then retain that original spoken reply;
        // factual answers must still consume the returned source evidence.
        const cifPriceRequest=/\bCIF\b/i.test(work.ticket.turn.text)&&/\b(?:price|pricing|quote|quotation|number)\b/i.test(work.ticket.turn.text);
        const writtenQuoteCheck=!!main&&/\b(?:confirm|check|verify)\b/i.test(main.say)&&/\b(?:writing|written|email)\b/i.test(main.say);
        if(main&&(isWrittenQuoteConfirmation(main.say,work.context)||cifPriceRequest&&writtenQuoteCheck)){
          const candidate=this.quoteMetadata(main,work);
          // A permitted advancing question still uses the ordinary parallel AI
          // check; this only avoids regenerating an already complete tool-turn
          // candidate. Numerical/context guardrails remain mandatory.
          if(checkSuggestion(candidate,work.context,{landing:work.route.verificationRequired,factChecked:true}).ok){this.prime(buffer,candidate);return;}
        }
        if(this.coordinator.continueResponse(work.ticket))return;
      }
      if(main){this.prime(buffer,main);if(work.purpose&&work.ready&&buffer.checked)this.publish(buffer,this.merge(buffer,buffer.checked),true);}
      else if(!work.answered){
        if(work.context.coachingRequest)this.repairDemand(buffer,'Output format failed: return SAY: followed on the same line by literal spoken wording, then MOVE: on its own line. No preamble or coaching narrative.',buffer.text);
        else void this.rescue(work);
      }
      else {work.answered=true;if(work.timer)clearTimeout(work.timer);this.coordinator.markSkipped(work.ticket);this.options.onPendingTurn("");this.options.onThinking(false);}
      return;
    }
    if(event.type==="error") {
      const error=event.error as {code?:unknown;message?:unknown;event_id?:unknown;response_id?:unknown}|undefined;
      const code=String(error?.code||"");
      if(code==="response_cancel_not_active")return;
      const responseId=typeof event.response_id==='string'?event.response_id:typeof error?.response_id==='string'?error.response_id:undefined;
      const eventId=typeof error?.event_id==='string'?error.event_id:undefined;
      const response=responseId?this.responses.get(responseId):undefined;
      const request=eventId?this.requestEvents.get(eventId):undefined;
      // A late error belongs to its original request, just like a late delta or
      // verifier result. Never guess that it concerns whichever card is current.
      if(responseId&&!response||eventId&&!request)return;
      if(response&&request&&(response.work!==request.work||(response.attempt??0)!==request.attempt))return;
      const owner=response?{work:response.work,attempt:response.attempt??0}:request;
      if(owner){if(this.current(owner.work)&&!owner.work.answered&&owner.attempt===owner.work.repairCount)void this.rescue(owner.work);return;}
      this.options.onWarning(String(error?.message||"The live connection reported an unscoped error. The current suggestion was retained."));
    }
  }

  private current(work:Work) {return !this.stopped && !work.archived && !work.superseded && !work.rejected && this.coordinator.isCurrent(work.ticket);}
  private isCheckingSpeech(text:string) {
    return /\b(?:let me|while I|I['’]?m|I am)\b.{0,40}\b(?:check|pull|verify|look up)\b/i.test(text);
  }
  private questionWithdrawn(text:string) {
    return hasClearConversationRefusal(text)||/\b(?:never mind|forget (?:that|my question)|leave it there|goodbye|stop calling|do not call|don't call|(?:don't|do not|no longer) need (?:that|this|an answer|the answer)(?: anymore)?|no need to answer|(?:don't|do not) need to answer)\b/i.test(text.replace(/[’‘]/g,"'"))
      ||/\b(?:I(?:'ll| will| am going to|'m going to)|let me)\s+(?:transfer you(?=\s+(?:to|over to)\b|[.!?,]|\s*$)|put you through\b|connect you (?:with|to)\b)/i.test(text.replace(/[’‘]/g,"'"));
  }
  private questionKey(question:PendingBuyerQuestion) {return JSON.stringify([question.turnId,question.text,question.at]);}
  private pendingQuestions() {return [...this.unansweredBuyerQuestions.values()].sort((a,b)=>a.at-b.at).map(item=>({...item}));}
  private questionsFor(context:LiveContext) {
    return this.pendingQuestions().filter(item=>context.turns.some(turn=>turn.id===item.turnId&&turn.role==='buyer'&&turn.at===item.at&&turn.text.includes(item.text)));
  }
  private questionEvent(type:LiveQuestionQueueEvent['type'],turnId:string,affected:PendingBuyerQuestion[],reason:string) {
    this.options.onQuestionQueue?.({type,at:Date.now(),turnId,questions:this.pendingQuestions(),affected:affected.map(item=>({...item})),reason});
  }
  private restoreQuestions(context:LiveContext,turnId:string) {
    if(this.restoredQuestions)return;this.restoredQuestions=true;
    const restored:PendingBuyerQuestion[]=[];
    for(const item of this.options.initialQuestions||[]){
      if(typeof item?.turnId!=='string'||typeof item.text!=='string'||!item.text.trim()||!Number.isFinite(item.at)||!analyzeBuyerText(item.text).hasQuestion)continue;
      if(!context.turns.some(turn=>turn.id===item.turnId&&turn.role==='buyer'&&turn.at===item.at&&turn.text.includes(item.text)))continue;
      const question={turnId:item.turnId,text:item.text,at:item.at};this.unansweredBuyerQuestions.set(this.questionKey(question),question);restored.push(question);
    }
    if(restored.length)this.questionEvent('queued',turnId,restored,'Restored pending questions from this same call’s confirmed buyer transcript.');
  }
  private queueQuestions(turn:AcceptedBuyerTurn,context:LiveContext) {
    if(context.turns.find(item=>item.id===turn.id)?.role!=='buyer')return;
    const added:PendingBuyerQuestion[]=[];
    for(const text of analyzeBuyerText(turn.text).questions){
      const item={turnId:turn.id,text,at:turn.at},key=this.questionKey(item);
      if(!this.unansweredBuyerQuestions.has(key)){this.unansweredBuyerQuestions.set(key,item);added.push(item);}
    }
    if(added.length)this.questionEvent('queued',turn.id,added,'Literal buyer questions are pending until addressed in actual speech or withdrawn.');
  }
  private removeQuestions(items:PendingBuyerQuestion[],turnId:string,type:'resolved'|'withdrawn',reason:string) {
    const removed=items.filter(item=>this.unansweredBuyerQuestions.delete(this.questionKey(item)));
    if(removed.length)this.questionEvent(type,turnId,removed,reason);
  }
  private resolveSpokenQuestions(turn:AcceptedBuyerTurn,work?:Work) {
    const prior=this.pendingQuestions().filter(item=>item.at<=turn.at);if(!prior.length)return;
    if(this.asksBuyerToRepeat(turn.text)){this.questionEvent('carried',turn.id,prior,'The representative requested a repeat; the original question remains unanswered.');return;}
    if(this.closesQuestion(turn.text)){this.removeQuestions(prior,turn.id,'withdrawn','The representative explicitly ended or moved past this exchange.');return;}
    if(this.isCheckingSpeech(turn.text)||/\b(?:I|we)(?:['’]ll| will| need to)\s+(?:check|confirm|verify)\b/i.test(turn.text))return;
    const resolved=prior.filter(item=>this.questionCovered(item,work?.representativeText||turn.text,work));
    this.removeQuestions(resolved,turn.id,'resolved','Actual representative speech answered the referenced buyer question.');
  }
  private questionCovered(question:PendingBuyerQuestion,spoken:string,work?:Work) {
    if(!spoken.trim()||this.asksBuyerToRepeat(spoken)||this.isCheckingSpeech(spoken)||/\b(?:unknown|unconfirmed|not confirmed|don't know|do not know|not sure|not certain|checking|verifying|look up|need to (?:check|confirm|verify)|(?:I|we)(?:['’]ll| will)\s+(?:check|confirm|verify))\b/i.test(spoken))return false;
    if(this.resolvesBuyerText(question.text,spoken))return true;
    const statements=spoken.split(/(?<=[.!?])\s+/).filter(sentence=>!sentence.includes('?')).join(' ');
    if(!statements||/\.\.\./.test(statements))return false;
    const topics=[{question:/\b(?:MOQ|minimum order(?: quantity)?)\b/i,answer:/\b(?:MOQ|minimum order(?: quantity)?)\b/i,value:/\d|\b(?:no minimum|no minimum order)\b/i},
      {question:/\b(?:purity|content|Al[₂2]?O[₃3]?)\b/i,answer:/\b(?:purity|content|Al[₂2]?O[₃3]?)\b/i,value:/\d/},
      {question:/\b(?:lead time|delivery schedule|shipping time)\b/i,answer:/\b(?:lead time|delivery schedule|shipping time)\b/i,value:/\d/},
      {question:/\b(?:price|quotation|quote|CIF|FOB)\b/i,answer:/\b(?:price|quotation|quote|CIF|FOB)\b/i,value:/\d/},
      {question:/\b(?:stock|inventory)\b/i,answer:/\b(?:stock|inventory)\b/i,value:/\d|\bno (?:stock|inventory)\b/i},
      {question:/\b(?:certif\w*|ISO|FDA|REACH|RoHS)\b/i,answer:/\b(?:certif\w*|ISO|FDA|REACH|RoHS)\b/i,value:/\b(?:certified|not certified|approved|not approved|compliant|not compliant)\b/i}];
    const relevant=topics.filter(topic=>topic.question.test(question.text));
    if(relevant.length){
      const declarative=/\b(?:is|are|has|have|it['’]s|they['’]re|we (?:hold|meet|maintain))\b/i.test(statements);
      if(declarative&&relevant.some(topic=>topic.answer.test(statements)&&topic.value.test(statements)))return true;
      // A shorthand numeric answer may omit its topic only when that exact
      // spoken number is tied to the question by original checked evidence.
      const numbers=statements.match(/\b\d+(?:[.,]\d+)?/g)||[];
      return !!numbers.length&&!!work&&this.matchesScript(work.published?.say||'',spoken)&&work.published?.verified===true&&!!work.published.evidence.some(item=>relevant.some(topic=>topic.answer.test(item.quote))&&numbers.every(number=>item.quote.includes(number))&&work.context.sources.some(source=>source.id===item.sourceId&&source.text.includes(item.quote)));
    }
    // For an open nonnumeric question, require the representative's full known
    // answer, rather than an introduction or a partial topical acknowledgment.
    return !!work&&this.completedRepresentativeAnswer(work,spoken)&&this.questionsFor(work.context).some(item=>this.questionKey(item)===this.questionKey(question));
  }
  private explicitRepresentativeResolution(text:string) {
    if(this.asksBuyerToRepeat(text)||this.closesQuestion(text))return true;
    return !/\b(?:if|unless|maybe|might|could|not|cannot|can't)\b/i.test(text)&&/\b(?:I(?:'ll| will)|we(?:'ll| will))\s+(?:send|email|forward|share)\b/i.test(text);
  }
  private asksBuyerToRepeat(text:string) {
    return /\b(?:(?:could|can|would|will) you\s+(?:please\s+)?repeat\b|please repeat\b|repeat (?:that|it)\s*,?\s*please\b|say (?:that|it) again\b|what did you say\b)/i.test(text);
  }
  private closesQuestion(text:string) {
    // "Thanks for your time" and "let me repeat your question" can introduce an
    // answer. Do not confuse them with an explicit end or change of subject.
    return /\b(?:goodbye|have a (?:good|great) day)[.!?\s]*$/i.test(text)
      ||/^(?:(?:okay|ok|right|well|so)[,.! ]+)*(?:let(?:'s| us) move on|moving on|next question)\b/i.test(text);
  }
  private completedRepresentativeAnswer(work:Work,text:string) {
    if(this.isCheckingSpeech(text))return false;
    if(this.resolvesBuyerText(work.ticket.turn.text,text))return true;
    const expected=(work.proposedSay||"").toLowerCase().match(/[a-z0-9]+(?:\.\d+)?/g)||[];
    const content=expected.filter(word=>word.length>2||/\d/.test(word)),actual=new Set((work.representativeText||text).toLowerCase().match(/[a-z0-9]+(?:\.\d+)?/g)||[]);
    // A fragment that merely shares a topic is not a completed answer. Require
    // almost all content, including every number, from the full proposed line.
    return content.length>=4&&content.filter(word=>actual.has(word)).length>=Math.ceil(content.length*.9)&&content.filter(word=>/\d/.test(word)).every(word=>actual.has(word));
  }
  private resolvesBuyerText(buyer:string,text:string) {
    if(this.asksBuyerToRepeat(text)||this.closesQuestion(text))return true;
    const documentRequest=/\b(?:send|email|share|forward)\b.{0,90}\b(?:profile|specs|specifications|website|documents|materials)\b/i.test(buyer);
    const remaining=buyer.replace(/\b(?:how|what) about\s*(?:(?:this|that)\s*[:,?]?\s*)?(?:you\s+)?(?:please\s+)?(send|email|share|forward|attach)\b/gi,"$1")
      .replace(/\b(?:can|could|would|will) you\s+(?:please\s+)?(send|email|share|forward|attach)\b/gi,"$1");
    const otherQuestion=analyzeBuyerText(remaining).hasQuestion||/\b(?:why|purity|content|MOQ|minimum order|lead time|stock|capacity|payment|certification|delivery time)\b|\b(?:what|how much)\b.{0,50}\b(?:price|cost)\b/i.test(remaining);
    return documentRequest&&!otherQuestion&&this.explicitRepresentativeResolution(text);
  }
  private matchesScript(script:string,text:string) {
    const words=(value:string)=>(value.toLowerCase().match(/[a-z0-9]+(?:\.\d+)?/g)||[]).filter(word=>word.length>2||/\d/.test(word));
    const expected=words(script),actual=new Set(words(text));
    if(!expected.length)return !!script.trim()&&script.trim().toLowerCase()===text.trim().toLowerCase();
    return expected.filter(word=>actual.has(word)).length>=Math.max(Math.min(3,expected.length),Math.ceil(expected.length*.5));
  }
  private clearThoughtPause() {if(this.thoughtTimer)clearTimeout(this.thoughtTimer);this.thoughtTimer=undefined;}
  private trace(work:Work,event:CoachingRequestTrace['event'],detail:Partial<CoachingRequestTrace>={}) {
    this.options.onRequestTrace?.({requestId:work.ticket.turn.id,suggestionId:work.id,at:Date.now(),attempt:work.repairCount,event,...detail});
  }
  private holdThoughtPause() {
    this.clearThoughtPause();
    this.coordinator.buyerPending(true);
    this.thoughtTimer=setTimeout(()=>{this.thoughtTimer=undefined;if(!this.stopped)this.coordinator.buyerPending(this.pending.size>0);},this.options.thinkingPauseMs??650);
  }
  private prepare(ticket:LiveReplyTicket):Work {
    const existing=this.works.get(ticket.revision);if(existing)return existing;
    const pinned=this.requestSnapshots.get(ticket.turn.id);
    if(!pinned)throw new Error('A coaching request requires its explicit context snapshot.');
    const preparationStarted=performance.now(),{context,started}=pinned;this.requestSnapshots.delete(ticket.turn.id);
    const library=(context.companyConfiguration?configurationReferences(context.companyConfiguration.snapshot):this.options.knowledgeSources?.(context)||context.sources).map(source=>({...source}));
    const work:Work={phaseClock:new CoachingPhaseClock(started),ticket,context,library,id:`coaching-${ticket.turn.id}`,started,rescued:false,answered:false,ready:false,toolRounds:0,repairCount:0,repairPending:false,verifier:null as unknown as LiveVerification<Guidance>,purpose:!!context.coachingRequest||!!context.callContext,route:fastRouteFor({...context,sources:library}),checking:false,archived:false,superseded:false,analysisShown:false,metadataComplete:false};
    work.awaitingTranscript=this.speculative?.requestId===ticket.turn.id;
    Object.assign(work.phaseClock.phases,this.speculationStats.get(ticket.turn.id)||{});
    work.phaseClock.prepared(pinned.preparationMs+pinned.enqueuedAt-pinned.dispatchStarted+performance.now()-preparationStarted,pinned.queueWaitMs,pinned.continuedDrafts,preparationStarted-pinned.enqueuedAt);
    work.verifier=new LiveVerification<Guidance>({verify:(say,signal)=>this.options.verify(work.context,this.quoteMetadata({...parseLiveDraft(`SAY: ${say}`,work.context)!,...(work.verificationGuidance?.say===say?work.verificationGuidance:{}),say,backup:"",evidence:[]},work),signal)});
    this.works.set(ticket.revision,work);return work;
  }
  private scheduleAnalysis(work:Work) {
    if(!work.purpose||!work.published||!work.analysis||!work.metadataComplete||work.analysisTimer||work.analysisShown||!this.current(work))return;
    work.analysisTimer=setTimeout(()=>{
      work.analysisTimer=undefined;if(!this.current(work)||!work.published||work.archived)return;
      work.analysisShown=true;
      const original=[JSON.stringify(work.context.callContext),...work.context.turns.map(turn=>turn.text),...work.context.sources.map(source=>source.text)].join(" ");
      const analysis:Partial<Guidance>={};
      for(const key of ["moment","move","why","buyerIntent"] as const){const text=work.analysis?.[key];if(typeof text==="string"&&!(text.match(/\b\d+(?:[.,]\d+)?\b/g)||[]).some(number=>!original.includes(number)))analysis[key]=text.slice(0,500);}
      const value={...work.published,...analysis,say:work.published.say,evidence:work.published.evidence,missing:work.published.missing,phase:work.published.phase,questionEcho:coachingRequestFocus(work.context).displayText,analysisReady:true};
      work.published=value;this.options.onAnalysis?.(work.ticket.turn.id,value);
    },Math.max(24,40-(performance.now()-(work.publishedAt||0))));
  }
  private request(ticket:LiveReplyTicket,continuation:boolean) {
    const work=this.prepare(ticket);
    if(work.repairPending&&work.timer){clearTimeout(work.timer);work.timer=undefined;}
    work.repairPending=false;
    if(!work.timer)work.timer=setTimeout(()=>{if(this.current(work)&&!work.answered&&!work.ready){if(work.repairCount)this.rejectDemand(work,'The source-safe rewrite did not finish.');else void this.rescue(work);}},this.options.fallbackAfterMs??8000);
    this.options.onPendingTurn(coachingRequestFocus(work.context).displayText);this.options.onThinking(true);
    // The complete frozen transcript is in instructions. This message is an
    // explicit request, never a made-up buyer line. Local turn-based templates
    // and speculative/preloaded replies cannot choose the rep's objective.
    const factual=classifyBuyerTurn(work.context).kind==='fact_request'||(work.context.unansweredBuyerQuestions||[]).some(question=>classifyBuyerTurn({...work.context,buyerText:question.text}).kind==='fact_request');
    // Tool continuations also use an explicit input override. Falling back to
    // the mutable Realtime conversation would let speech arriving after the
    // click leak into this request. Retrieved sources live in the pinned rules.
    const requestContext=work.repairReason?{...work.context,selfCheckFailure:work.repairReason,regenerationAttempt:1}:work.context;
    const repairInstruction=work.repairReason?'\nONE SAME-REQUEST REPAIR: The preceding candidate failed the source or conversation checks given in selfCheckFailure. Rewrite the exact spoken wording to serve the original objective using only established information. Preserve the supported substantive action and remove or correct the failing part. Do not repeat an unsupported claim or lose the buyer’s requested action in empty filler. A concise, specific acknowledgment of the requested action is a complete move when no clarification is needed; do not add a new question just to make the response longer. The frozen transcript has not changed. Begin with SAY:.':'';
    const instructions=liveRequestInstructionsFor(requestContext,ticket.turn,continuation?work.lookupSources:[])+repairInstruction;
    work.phaseClock.providerStarted(instructions.length);
    const eventId=`coaching-${ticket.revision}-${work.repairCount}-${crypto.randomUUID()}`;
    this.requestEvents.set(eventId,{work,attempt:work.repairCount});
    this.trace(work,'provider_request',{reason:work.awaitingTranscript?'Hidden speculative generation; final transcript acceptance is required before checks or display.':work.repairReason||'Generate from the intentional request snapshot.'});
    this.options.send({type:"response.create",event_id:eventId,response:{metadata:{epoch:String(ticket.revision),trigger:ticket.turn.id},...continuation||!factual?{tool_choice:"none"}:{},input:[{type:"message",role:"user",content:[{type:"input_text",text:"Write the representative’s next spoken line for this pinned moment. Start with SAY: followed immediately by literal words the rep can say aloud; then newline MOVE: with a concise action. Use the supplied objective and context; no new buyer speech is implied. A supported confirmation or goodbye is complete when that is the useful move."}]}],instructions}});
  }
  private merge(buffer:ResponseBuffer,verified:Guidance):Guidance {
    const parsed=parseLiveDraft(buffer.text,buffer.work.context);
    if(!parsed || parsed.say!==verified.say)return verified;
    return {...parsed,say:verified.say,backup:needsFactCheck(parsed.backup||"",buffer.work.context) ? "" : parsed.backup,evidence:verified.evidence,missing:[...new Set([...parsed.missing,...verified.missing])],caution:verified.caution||parsed.caution,verified:verified.verified===true,verificationStatus:verified.verificationStatus};
  }
  private quoteMetadata(value:Guidance,work:Work):Guidance {
    const buyer=work.ticket.turn.text;
    const quotation=/\b(?:give|quote|what|need|CIF|FOB)\b.{0,60}\b(?:price|quotation|quote)\b|\b(?:price|quote)\b.{0,40}\b(?:CIF|FOB)\b/i.test(buyer);
    const writtenCheck=/\b(?:confirm|check|verify)\b/i.test(value.say)&&/\b(?:writing|written|email)\b/i.test(value.say);
    if(!quotation||!writtenCheck||value.missing.length)return value;
    // MISSING may stream after SAY (or be omitted). A pending quote is a
    // company-knowledge gap, derived from this actual buyer request, not a
    // reason to rewrite an otherwise clean spoken confirmation.
    return {...value,missing:[buyer.slice(0,500)],caution:value.caution||"The requested quotation is not an approved figure."};
  }
  private guardSalesMove(value:Guidance,work:Work):Guidance {
    const assessment=assessReplyVerification(value.say,work.context);
    // Keep the rejected claim intact for the explicit request's bounded repair.
    // Sanitizing this into a generic acknowledgment would hide a failed move.
    if(work.context.coachingRequest&&assessment.unsupportedClaims.length)return value;
    if(assessment.classification.kind==='fact_request')return value;
    const say=assessment.sanitizedReply||'I understand.';
    if(say!==value.say)work.contextReplacement??={originalSay:work.lastDisplayedSay||value.say,reason:'Removed unsupported claim spans while preserving the sales move: '+assessment.unsupportedClaims.map(claim=>claim.reason).join('; '),originalWasDisplayed:!!work.lastDisplayedSay};
    return {...value,say,backup:'',...assessment.pendingClaims.length?{}:{caution:'',missing:[],evidence:assessment.locallyVerifiedWholeReply?assessment.localEvidence.map(({sourceId,quote})=>({sourceId,quote})):[]},verified:value.verified===true,verificationStatus:value.verificationStatus};
  }
  private completedSay(buffer:ResponseBuffer,complete=false):Guidance|null {
    const completed=completedLiveReply(buffer.text,buffer.work.context,complete);
    if(!completed)return null;
    const {guidance:main,rawSay}=completed;
    if(completed.recoveredFormat&&!buffer.formatRecovered){
      buffer.formatRecovered=true;
      this.trace(buffer.work,'format_recovered',{rawText:buffer.text,say:rawSay,attempt:buffer.attempt??0,reason:completed.recoveredFormat==='bare_acknowledgment'?'Recovered only missing field labels after response completion: the entire output is a literal courtesy acknowledgment. Ordinary source and conversation checks still apply.':'Recovered only a missing SAY label: one literal spoken paragraph was closed by a separate MOVE field. Ordinary source and conversation checks still apply.'});
    }
    // Plain speech and labeled SAY use the same unbudgeted safety input. An
    // unsupported opening must not consume a sentence slot and hide the valid
    // final question. Factual paragraph/stream completion remains unchanged.
    if(assessReplyVerification(rawSay,buffer.work.context).classification.kind!=='fact_request'){
      const guarded=this.guardSalesMove({...main,say:rawSay},buffer.work);
      const budget=spokenReplyBudget(buffer.work.context);
      return {...guarded,say:limitScript(guarded.say,budget.words,budget.sentences)};
    }
    return main;
  }
  private telemetry(work:Work,type:LiveReplyTelemetry['type'],say:string,status:LiveReplyTelemetry['status']) {
    if(type==='verification_complete')this.latencyClock.recordVerification(work.ticket.turn.id);
    this.options.onTelemetry?.({type,suggestionId:work.id,turnId:work.ticket.turn.id,callId:work.context.callId,at:Date.now(),verificationRequired:!!work.verificationCandidate,status,say,acousticLatency:this.latencyClock.snapshot(work.ticket.turn.id),phases:work.phaseClock.snapshot(),
      ...(work.firstDisplayAt!==undefined?{firstDisplayMs:work.firstDisplayAt-work.started}:{}),...(work.verificationAt!==undefined?{verificationCompleteMs:work.verificationAt-work.started}:{}),...(type==='complete'?{totalMs:performance.now()-work.started}:{})});
  }
  private publish(buffer:ResponseBuffer,value:Guidance,complete:boolean,unverifiedCandidate=false) {
    const work=buffer.work;
    // A draft/checking row is not ready-to-say wording. Keep it out of the
    // spoken card until the complete candidate has passed its applicable checks.
    if(!complete||unverifiedCandidate||work.awaitingTranscript)return;
    if(value.verified!==true){this.issue(work,'unavailable',value.say,value.caution||'This candidate has not passed its source checks.');return;}
    if(complete){work.ready=true;if(work.timer)clearTimeout(work.timer);work.fallback?.abort();}
    this.coordinator.deferPublish(work.ticket,()=>{
      if(!this.current(work))return;
      if(work.published){
        if(work.published.say!==value.say)this.issue(work,'correction',work.published.say,'A later validation result differs from the ready wording. Review this explicit correction before using it.',value);
        if(/\n(?:MOMENT|MOVE|WHY):/i.test(buffer.text)){work.analysis=value;this.scheduleAnalysis(work);}return;
      }
      const shown=attributeGuidance({...(work.purpose?{...value,phase:value.phase || "answer",questionEcho:coachingRequestFocus(work.context).displayText,analysisReady:work.metadataComplete}:value),scriptComplete:complete||unverifiedCandidate},work.context);
      if(unverifiedCandidate){work.unverifiedDisplayed=shown.say;this.options.onThinking(false);}
      this.options.onGuidance(shown,work.id,work.ticket.turn.at,complete,performance.now()-work.started,work.ticket.turn.id,work.context);
      this.trace(work,'published',{say:shown.say,status:shown.verificationStatus});
      this.latencyClock.recordDisplay(work.ticket.turn.id,{say:shown.say,full:shown.scriptComplete,sink:'controller'});
      work.lastDisplayedSay=shown.say;work.phaseClock.display(shown.say,shown.scriptComplete===true,complete);
      if(work.firstDisplayAt===undefined){work.firstDisplayAt=performance.now();this.telemetry(work,'first_display',shown.say,unverifiedCandidate?'checking':complete?work.contextReplacement?'replaced':work.verificationCandidate?work.verificationCandidate===shown.say?'passed':'replaced':'not_required':'checking');}
      if(work.purpose&&complete){work.analysisShown=shown.analysisReady===true;work.published=shown;work.publishedAt=performance.now();if(/\n(?:MOMENT|MOVE|WHY):/i.test(buffer.text))work.analysis=value;this.scheduleAnalysis(work);}
      if(complete){
        const original=work.verificationCandidate||work.contextReplacement?.originalSay;
        const changed=!!original&&original!==shown.say;
        if(changed&&!work.replacementLogged){work.replacementLogged=true;this.options.onVerificationReplacement?.({suggestionId:work.id,turnId:work.ticket.turn.id,callId:work.context.callId,at:Date.now(),originalSay:original!,replacementSay:shown.say,reason:work.contextReplacement?.reason||work.verificationFailure||'Verification rejected or changed the candidate',originalWasDisplayed:work.verificationCandidate?work.unverifiedDisplayed===work.verificationCandidate:work.contextReplacement!.originalWasDisplayed});}
        this.telemetry(work,'complete',shown.say,shown.verified===false?'failed':changed?'replaced':work.verificationCandidate?'passed':'not_required');
        work.answered=true;if(work.timer)clearTimeout(work.timer);work.fallback?.abort();this.coordinator.markAnswered(work.ticket);this.options.onPendingTurn("");this.options.onThinking(false);this.options.onChecking(false);
      }
    });
  }
  private update(buffer:ResponseBuffer) {
    // The spoken line has already landed. Parse the remaining metadata once in
    // response.done, rather than deriving call state again on every token.
    if(buffer.work.ready||buffer.work.awaitingTranscript)return;
    if(buffer.work.purpose) {
      const main=this.completedSay(buffer);
      if(main){this.prime(buffer,main);return;}
      return;
    }
    const value=parseLiveDraft(buffer.text,buffer.work.context);if(!value)return;
    if(buffer.checked && buffer.checkedSay===value.say){if(buffer.work.purpose)this.finish(buffer,this.merge(buffer,buffer.checked),true);else this.publish(buffer,this.merge(buffer,buffer.checked),true);}
    else if(!buffer.work.purpose&&!needsFactCheck(value.say,buffer.work.context))this.publish(buffer,{...value,backup:"",evidence:[]},false);
    else if(needsFactCheck(value.say,buffer.work.context))this.options.onChecking(true);
    const main=this.completedSay(buffer);if(main)this.prime(buffer,main);
  }
  private prime(buffer:ResponseBuffer,main:Guidance) {
    if(buffer.work.awaitingTranscript)return;
    if(buffer.primed===main.say || !this.current(buffer.work)||buffer.work.ready||buffer.work.candidateAttempt===buffer.work.repairCount)return;
    buffer.work.candidateAttempt=buffer.work.repairCount;
    main=this.guardSalesMove(this.quoteMetadata(main,buffer.work),buffer.work);
    buffer.primed=main.say;buffer.work.proposedSay=main.say;
    buffer.work.phaseClock.wordingComplete();
    const assessment=buffer.work.phaseClock.validate(()=>assessReplyVerification(main.say,buffer.work.context));
    if(buffer.work.context.coachingRequest&&assessment.unsupportedClaims.length){
      this.repairDemand(buffer,assessment.unsupportedClaims.map(claim=>'Unsupported claim '+JSON.stringify(claim.text)+': '+claim.reason).join('; ')+' Rewrite the full useful move with the supported broad company category or applicable original evidence. Do not delete the subject and leave a vague question or repeat the unsupported predicate.',main.say);return;
    }
    if(!assessment.requiresVerification&&!needsFactCheck(main.say,buffer.work.context)) {
      const verified:Guidance={...main,backup:"",evidence:assessment.locallyVerifiedWholeReply?assessment.localEvidence.map(({sourceId,quote})=>({sourceId,quote})):[],verified:true,verificationStatus:assessment.claims.length?'verified':'not_required'};
      buffer.checked=verified;buffer.checkedSay=main.say;this.finish(buffer,this.merge(buffer,verified),assessment.locallyVerifiedWholeReply||assessment.classification.kind!=='fact_request');return;
    }
    this.verifyMain(buffer,main);
  }
  private verifyMain(buffer:ResponseBuffer,main:Guidance) {
    const work=buffer.work;if(!this.current(work)||work.ready)return;
    if(work.checking&&work.verificationCandidate===main.say)return;
    main=this.quoteMetadata(main,work);
    work.checking=true;work.verificationCandidate=main.say;work.verificationGuidance=main;work.verificationFailure=undefined;this.options.onChecking(true);
    // A finished candidate ends the generation timeout. Its fact check has its
    // own request timeout; elapsed checking is not a reason to replace a draft.
    if(work.timer)clearTimeout(work.timer);work.timer=undefined;
    // Complete structural/context checks now, and source checks before the
    // spoken card becomes ready. There is no read-then-silently-repair window.
    const contextCheck=work.purpose?checkSuggestion(main,work.context,{landing:work.route.verificationRequired||work.checking,factChecked:true}):{ok:true,retryReason:''};
    if(work.context.coachingRequest&&!contextCheck.ok){this.repairDemand(buffer,contextCheck.retryReason||'The source or conversation checks rejected this candidate.',main.say);return;}
    if(!this.current(work)||work.ready)return;
    work.phaseClock.verifyStarted();
    this.trace(work,'verification_started',{say:main.say});
    void work.verifier.verify(main.say,work.ticket.revision).then(verified=>{
      if(!this.current(work)||work.ready)return;
      work.phaseClock.verifyComplete();work.verificationAt=performance.now();
      this.trace(work,'verification_complete',{say:verified.say,status:verified.verificationStatus,reason:verified.caution});
      if(verified.verified!==true){
        const status=verified.verificationStatus==='rejected'?'rejected':'unavailable';
        this.telemetry(work,'verification_complete',verified.say,'failed');
        if(status==='rejected'&&work.context.coachingRequest)this.repairDemand(buffer,verified.caution||'The source check did not establish this claim.',main.say);
        else {this.issue(work,status,main.say,verified.caution||'The source check did not establish this claim.');this.rejectDemand(work,verified.caution||'The source check is unavailable.');}return;
      }
      verified={...verified,verificationStatus:verified.verificationStatus==='not_required'?'not_required':'verified'};
      this.telemetry(work,'verification_complete',verified.say,verified.say===main.say?'passed':'replaced');
      buffer.checked=verified;buffer.checkedSay=main.say;this.finish(buffer,this.merge(buffer,verified),true);
    }).catch(error=>{
      if(!this.current(work)||error instanceof DOMException&&error.name==='AbortError')return;
      work.phaseClock.verifyComplete();work.verificationAt=performance.now();work.verificationFailure='Verification failed: '+(error instanceof Error?error.message:'Request error');
      this.trace(work,'verification_complete',{say:main.say,status:'failed',reason:work.verificationFailure});
      this.telemetry(work,'verification_complete',main.say,'failed');
      const rejected=(error as {code?:string})?.code==='suggestion_rejected';
      if(rejected&&work.context.coachingRequest){
        this.repairDemand(buffer,work.verificationFailure,main.say);
      }else {
        // A failed/incomplete checker is not proof the wording is wrong and
        // must not create an extra generation request or a verified badge.
        this.issue(work,rejected?'rejected':'unavailable',main.say,work.verificationFailure);
        this.rejectDemand(work,work.verificationFailure);
      }
    });
  }
  private finish(buffer:ResponseBuffer,value:Guidance,factChecked:boolean) {
    const work=buffer.work;if(!this.current(work)||work.ready)return;
    value=this.guardSalesMove(value,work);
    if(!work.purpose){this.publish(buffer,value,true);return;}
    const immediateMove=assessReplyVerification(value.say,work.context).classification.kind!=='fact_request';
    if(immediateMove&&!assessReplyVerification(value.say,work.context).requiresVerification)factChecked=true;
    const landing=!immediateMove&&(work.route.verificationRequired||work.checking||!!work.cached);
    let next={...this.quoteMetadata(value,work),backup:"",phase:landing?"landing" as const:"answer" as const,questionEcho:coachingRequestFocus(work.context).displayText,analysisReady:false};
    let verdict=work.phaseClock.validate(()=>checkSuggestion(next,work.context,{landing,factChecked}));
    if(!verdict.ok){
      if(work.context.coachingRequest){this.repairDemand(buffer,verdict.retryReason||'The source or conversation checks rejected this candidate.',next.say);return;}
      work.contextReplacement??={originalSay:work.lastDisplayedSay||next.say,reason:'Context check rejected the candidate: '+verdict.retryReason,originalWasDisplayed:!!work.lastDisplayedSay};
      const safe=safePurposeReply(work.context,{landing});
      const candidate={...safe,backup:"",phase:landing?"landing" as const:"answer" as const,questionEcho:work.ticket.turn.text,analysisReady:work.metadataComplete};
      const safeVerdict=checkSuggestion(candidate,work.context,{landing,factChecked:false});
      // A context-specific process line can repair an invalid draft immediately.
      // Never treat a local supplier claim as verified just to save a round trip.
      if(safeVerdict.ok&&!safeVerdict.needsVerification){next=candidate;verdict=safeVerdict;}
      else {
        if(!work.rescued){void this.rescue(work,verdict.retryReason);return;}
        work.ready=true;work.answered=true;if(work.timer)clearTimeout(work.timer);this.coordinator.markSkipped(work.ticket);this.options.onPendingTurn("");this.options.onThinking(false);this.options.onChecking(false);this.options.onError("The next line could not pass its context checks. Use Suggest next move to retry.");return;
      }
    }
    if(verdict.needsVerification&&!factChecked) {
      this.verifyMain(buffer,next);return;
    }
    work.proposedSay=next.say;buffer.checked=next;buffer.checkedSay=next.say;this.publish(buffer,next,true);
  }
  private repairDemand(buffer:ResponseBuffer,reason:string,say:string) {
    const work=buffer.work;if(!this.current(work)||work.ready||(buffer.attempt??0)!==work.repairCount)return;
    if(work.repairCount){this.issue(work,'rejected',say,reason);this.rejectDemand(work,reason);return;}
    this.issue(work,'rejected',say,reason);
    work.contextReplacement??={originalSay:say,reason,originalWasDisplayed:work.lastDisplayedSay===say};
    work.phaseClock.repairStarted();work.repairCount=1;work.repairPending=true;work.repairReason=JSON.stringify({rejectedSay:say,reason});
    this.trace(work,'repair_requested',{say,reason});
    work.verifier.invalidate();work.checking=false;work.verificationCandidate=undefined;work.verificationGuidance=undefined;
    work.metadataComplete=false;work.analysis=undefined;work.analysisShown=false;
    if(work.timer)clearTimeout(work.timer);work.timer=undefined;
    this.options.onChecking(false);this.options.onThinking(true);
    // Reuse this ticket and its frozen context on the same Realtime connection.
    // Cancel optional metadata from the rejected draft rather than waiting for
    // it to finish. The coordinator retains the slot until cancel acknowledgment
    // (or its bounded timeout), then starts exactly one repair of this snapshot.
    work.timer=setTimeout(()=>{if(this.current(work)&&work.repairPending)this.rejectDemand(work,'The rejected response did not release its slot for the source-safe rewrite.');},this.options.fallbackAfterMs??8000);
    if(!this.coordinator.replaceResponse(work.ticket))this.rejectDemand(work,'The source-safe rewrite no longer owns this request.');
  }
  private rejectDemand(work:Work,reason:string) {
    if(!this.current(work)||work.answered)return;
    this.trace(work,'failed',{status:'failed',reason,focus:coachingRequestFocus(work.context)});
    work.ready=true;work.answered=true;work.rejected=true;work.repairPending=false;work.verifier.invalidate();work.fallback?.abort();
    if(work.timer)clearTimeout(work.timer);if(work.analysisTimer)clearTimeout(work.analysisTimer);
    this.coordinator.markSkipped(work.ticket);this.coordinator.abandonResponse(work.ticket);
    this.options.onPendingTurn('');this.options.onThinking(false);this.options.onChecking(false);
    this.options.onError('The suggestion could not pass its company and conversation checks. Review the source gap or request another next move. '+reason);
  }
  private issue(work:Work,status:LiveSuggestionIssue['status'],originalSay:string,reason:string,correction?:Guidance) {
    this.trace(work,'rejected',{say:originalSay,status,reason});
    this.options.onSuggestionIssue?.({suggestionId:work.id,turnId:work.ticket.turn.id,at:Date.now(),status,originalSay,reason,...correction?{correction}:{},context:work.context});
  }
  private async rescue(work:Work,reason?:string) {
    if(work.awaitingTranscript){this.discardSpeculation('The hidden provider generation failed before final transcription.');return;}
    if(!this.current(work)||work.answered||work.ready||work.rescued)return;
    if(work.context.coachingRequest&&work.repairCount){this.rejectDemand(work,reason||'The source-safe rewrite did not finish.');return;}
    work.rescued=true;const attempt=new AbortController();work.fallback=attempt;this.options.onThinking(true);
    if(work.context.coachingRequest){
      if(work.timer)clearTimeout(work.timer);
      work.timer=setTimeout(()=>{if(this.current(work)&&!work.answered&&!work.ready)this.rejectDemand(work,'The recovery request did not finish. No usable suggestion was produced.');},this.options.fallbackTimeoutMs??5000);
    }
    try {
      const context=reason?{...work.context,selfCheckFailure:reason,regenerationAttempt:1}:work.context;
      const value=await this.options.fallback(context,attempt.signal);
      if(attempt.signal.aborted||work.fallback!==attempt||!this.current(work)||work.answered||work.ready)return;
      const buffer={work,text:"",checked:value,checkedSay:value.say,primed:value.say,firstShown:false};
      work.metadataComplete=true;
      if(work.purpose) {
        const landing=(work.route.verificationRequired||work.checking),verdict=checkSuggestion(value,work.context,{landing,factChecked:true});
        if(!verdict.ok){this.finish(buffer,safePurposeReply(work.context,{landing}),true);this.coordinator.abandonResponse(work.ticket);return;}
        this.finish(buffer,value,true);
      } else this.publish(buffer,value,true);
      // A stalled Realtime slot must not block the buyer's next question after
      // the independent checked response has already recovered this turn.
      this.coordinator.abandonResponse(work.ticket);
    } catch(error) {
      if(attempt.signal.aborted||work.fallback!==attempt)return;
      if(work.context.coachingRequest&&this.current(work)&&!work.answered){this.rejectDemand(work,'The requested suggestion and its recovery could not finish. '+(error instanceof Error?error.message:'The AI request failed.'));return;}
      if(work.purpose&&this.current(work)&&!work.answered){work.metadataComplete=true;const safe=safePurposeReply(work.context,{landing:(work.route.verificationRequired||work.checking)});this.finish({work,text:"",checked:safe,checkedSay:safe.say,primed:safe.say,firstShown:false},safe,true);this.coordinator.abandonResponse(work.ticket);return;}
      if(this.current(work)&&!work.answered&&!(error instanceof DOMException&&error.name==="AbortError")){this.options.onThinking(false);this.options.onChecking(false);this.options.onError(work.context.coachingRequest?"The requested next move could not finish. Use Suggest next move to retry.":"The latest buyer reply could not finish. Use Suggest next move to retry.");}
    }
  }
}
