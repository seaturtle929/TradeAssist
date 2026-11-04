"use client";
import {selectClientPhoneRoute} from "../lib/client-phone-routes";
import {callOutcomeLabel} from '../lib/call-outcome-label';
import {createEnglishTranscriptionGuard} from '../lib/english-transcription';
import {buyerTranscriptionConfig} from '../lib/buyer-transcription-config';
import {buyerVadSilenceMs} from '../lib/turn-detection';
import {snapshotCoachingContext,coachingRequestFocus} from '../lib/coaching-context-snapshot';
import type {CoachingRequest} from '../lib/on-demand-coaching';

import {SuggestionLearningAttribution} from "../components/live-coaching";
import {generationFoundationFor} from "../lib/generation-foundation";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Activity, ArrowRight, AudioLines, BookOpen, Check, CheckCircle2, ChevronRight, CircleHelp, Download, FileText, Headphones, History, Layers3, Loader2, LockKeyhole, Mic, Pause, Phone, Play, Plus, Radio, RefreshCw, Search, Settings2, ShieldCheck, Sparkles, Square, Trash2, Upload, X } from "lucide-react";
import {generalStyleExamples} from "../lib/shared-speaking-style";
import {isSuggestNextMoveShortcut} from "../lib/coaching-shortcut";
import {readManualStream} from "../lib/manual-stream-client";
import {isUsableCoachingWording} from "../lib/coaching-timing";
import type {ManualTiming} from "../lib/manual-timing";
import type {LiveLatencySnapshot} from "../lib/live-latency";
import { LiveCoachingSession, type LiveContext, type LiveQuestionQueueEvent, type QueuedCoachingRequest } from "../lib/live-coaching-session";
import { upsertSuggestion, applySuggestionFeedback, recordSuggestionSpeech, recordVerificationReplacement, hasWordingEdit } from "../lib/reply-history";
import { isTranscriptionPromptEcho } from "../lib/transcript-quality";
import { CALL_TYPES, normalizeCallType, stageLabel, isCompanyKnowledgeGap } from "../lib/call-coaching";
import type { CallType, StageEvent, SuggestionRecord, MissingKnowledge, DecisionPacket, DecisionItem } from "../lib/phase1-types";
import { ManagerPacketPanel } from "../components/decision-packet";
import { LiveCoachingCard, ReplyVerificationChanges, CoachingDiagnostics } from "../components/live-coaching";
import { BuyerAudioRecovery } from "../components/buyer-audio-recovery";
import type { BuyerAudioIssue } from "../lib/buyer-audio-quality";
import { startRepAudio } from "../lib/rep-audio";
import { LiveTurnCoordinator } from "../lib/live-turn-coordinator";
import { audioSignal, captureComputerAudio, ComputerAudioCaptureError, createComputerAudioPipeline, createMicrophonePipeline, normalizeComputerAudioGain, microphoneConstraints, type AudioMode } from "../lib/audio";
import { GOALS, knowledgeFor, type Manufacturer, type Source, type Turn, type Guidance, type CallRecord, type BuyerBrief } from "../lib/trade";
import { DEFAULT_VOICE, type VoiceProfile } from "../lib/sales-playbook";
import { DEFAULT_BUDGET, budgetDecision, monthSpend, formatUsd, priceRealtimeUsage, priceTranscriptionUsage, type UsageEntry, type BudgetSettings } from "../lib/costs";
import { selectKnowledge } from "../lib/knowledge";
import { BuyerBriefInput, VoiceProfileInput } from "../lib/coach";
import { VoiceSettings, SpendingPanel } from "../components/sales-panels";
import { CallContextCard, PurposeHUD } from "../components/call-context";
import {CallPreparation} from '../components/call-preparation';
import {openingChoiceFor,chooseOpeningMode,normalizeOpening,type OpeningChoice} from '../lib/opening-preferences';
import {defaultGeneralPlaybook,normalizeGeneralPlaybook,buildGeneralPlaybookRequest,type GeneralPlaybookRecord} from "../lib/general-playbook";
import {loadGeneralPlaybook,saveGeneralPlaybook} from "../lib/general-playbook-store";
import {TeachCopilot} from "../components/teach-copilot";
import {SalesCurriculum} from "../components/sales-curriculum";
import type {TeachingMoment,TeachingActor,TeachingProposal} from "../lib/company-teaching";
import {teachingMomentFor,applyTeachingClientMemory,applyTeachingTranscript,markCorrectedClientEvidence} from "../lib/teaching-workflow";
import {CompanyBrainPanel,CompanyHistoryRecords} from "../components/company-brain-v1";
import {bindCompanyConfiguration,compactCallConfigurationBinding,configurationReferences,configurationStageMap,ensureCompanyConfiguration,startConfigurationDraft,saveConfigurationDraft,syncConfigurationDocuments,type CallConfigurationBinding,type CompanyConfiguration} from "../lib/company-configuration";
import {applyCoachingConfiguration} from "../lib/coaching-configuration";
import {CallConfigurationBindingInput} from "../lib/company-brain-input";
import {clientStandingText,buildClientStanding} from "../lib/client-standing";
import {CallSetup,BackgroundForCall,CallWrapUp,SavedRecapContacts} from "../components/salesperson-workflow";
import {preparationInputFingerprint,parsePastedEmail,parsePreparationUpload,PREPARATION_MAX_BYTES,type ClientCallBackground,type ClientPreparationBrief,type PreparationUpload} from "../lib/client-preparation";
import {proposeCallWrapUp,saveClientCallWrapUp,saveReviewedCallContacts,type WrapUpContact,type ClientCallWrapUp} from "../lib/client-workflow";
import type {ClientCategory} from "../lib/client-records";
import {CallConfigurationReview} from "../components/call-configuration-review";
import {ClientList,ClientPreparation,ClientHistory,CallClientAssociation} from "../components/client-workflow";
import {createClientRecord,updateClientRecord,setClientRemoved,upsertClientContact,addClientContextEntry,supersedeClientEntry,resolveClientEntry,attachCallToClient,reassociateClientCall,upsertClientCallRecord,migrateClientWorkspace,mergeCompanyClientRecords,type ClientRecord,type ClientContextEntry,type CallPreparationSnapshot} from "../lib/client-records";
import {buildCallPreparation,isPreparationCurrent,buildClientCoachingContext,parseCallPreparation,type CallPreparationInput} from "../lib/client-coaching-context";
import {ensureCompanyBrain,buildBrainRequest,captureLearning,rateLearning,promoteLearning,rememberBuyer,recordDecisions,normalizeExtractedFacts,learningRisk,setDefaultOpening,type CompanyBrainRecord,type LearningCapture,type LearningPair,type EditReason} from "../lib/company-brain";
import {loadCompanyBrains,saveCompanyBrains,loadWorkspaceSnapshot,saveWorkspaceSnapshot,beginCallCommit,endCallCommit} from "../lib/brain-store";
import {migrateBrainHistory} from '../lib/brain-migration';
import {deriveConversationState} from "../lib/conversation-state";
import {liveRequestInstructionsFor} from "../lib/live-request";
import { defaultCallContext, normalizeCallContext, normalizeStageMap, getPurposeContext, fastRouteFor, type CallContext } from "../lib/call-purpose";
import "../components/call-context.css";
import { MacCallSetup } from "../components/mac-call-setup";
import { BuyerTranslation } from "../components/buyer-translation";
import {readableCoachingMove} from "../lib/coaching-labels";
import { applyBuyerTranslations, buildTranslationTurns, canTranslateTurn } from "../lib/transcript-translations";
import { BuyerTranslationQueue, type TranslationJob } from "../lib/buyer-translation-queue";
import type { TranslatedTurn } from "../lib/translation";

type View = "live" | "knowledge" | "brain" | "playbook" | "history" | "settings";
type Modal = { type: "manufacturer"; manufacturer?: Manufacturer } | { type: "source"; source?: Source } | null;
const STORAGE = "trade-assist-v1";
const AUDIO_STORAGE = "trade-assist-audio-v1";
const FEATURE_STORAGE = "trade-assist-features-v1";
const USAGE_STORAGE = "trade-assist-usage-v1";
const OUTCOMES = ["Not reached","Blocked by gatekeeper","Wrong person","Talked, no next step","Next step agreed","Sample requested","Quotation requested","Order","Lost"];
const uid = () => crypto.randomUUID();
const durationText = (seconds: number) => `${Math.floor(seconds / 60).toString().padStart(2,"0")}:${Math.floor(seconds % 60).toString().padStart(2,"0")}`;
const nowLabel = (at: number) => new Date(at).toLocaleTimeString("en-US", { hour:"numeric", minute:"2-digit" });
function downloadFile(name: string, contents: string, type = "text/plain") {
  const url = URL.createObjectURL(new Blob([contents], { type })); const anchor = document.createElement("a"); anchor.href = url; anchor.download = name; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function requestJSON<T>(path: string, body?: unknown, signal?: AbortSignal, onCharges?: (charges:UsageEntry[])=>void): Promise<T> {
  const response = await fetch(path, { method: body === undefined ? "GET" : "POST", headers: body === undefined ? {} : { "Content-Type":"application/json" }, ...(body === undefined ? {} : { body:JSON.stringify(body) }), signal });
  const data = await response.json().catch(() => ({ error: "The server returned an unreadable response." })) as T & {error?: string;code?:string;_charges?:UsageEntry[]};
  if(Array.isArray(data._charges))onCharges?.(data._charges);
  if (!response.ok) throw Object.assign(new Error(data.error || "The request failed."),{code:data.code,status:response.status}); return data;
}

function preparationRequestFor(input:CallPreparationInput) {
  const {company,client,configurationBinding:binding}=input;
  const stage=binding.snapshot.stages.find(item=>item.id===binding.selectedStageId)!;
  const background=input.callBackground||client.callBackground||{websites:[],context:client.background,sources:[]};
  const prepared=buildCallPreparation({...input,callBackground:background});
  return {companyId:company.id,clientId:client.id,clientName:client.name,stage:{id:stage.id,name:stage.name,objective:stage.objective},configurationVersionId:binding.versionId,
    salespersonContext:background.context.slice(0,20000),outsideUpdate:input.outsideUpdate||'',standing:prepared.standing,clientMemory:[prepared.standing?clientStandingText(prepared.standing):'',...prepared.entries.map(entry=>`${entry.source} (${new Date(entry.at).toISOString()}): ${entry.text}`)].filter(Boolean).join('\n'),
    companyFacts:selectKnowledge(configurationReferences(binding.snapshot),client.name+' '+background.context+' '+stage.objective,30000).slice(0,60).map(item=>({id:item.id,companyId:company.id,text:item.text.slice(0,6000),sourceId:item.id,sourceTitle:item.title})),websites:background.websites.map(url=>url.trim()).filter(Boolean),sources:background.sources};
}

export default function Workspace() {
  const [view, setView] = useState<View>("live");
  const [workflowRole,setWorkflowRole]=useState<TeachingActor>("manager");
  const [teachingSelection,setTeachingSelection]=useState<{companyId:string;moment:TeachingMoment;proposalId?:string}>();
  const [manufacturers, setManufacturers] = useState<Manufacturer[]>([]);
  const [brainsReady,setBrainsReady]=useState(false);
  const [brainReadyEpoch,setBrainReadyEpoch]=useState(0);
  const brainHydration=useRef({epoch:0,ready:false});
  const workspaceWriteGeneration=useRef(0);
  const [generalPlaybook,setGeneralPlaybook]=useState<GeneralPlaybookRecord>(()=>defaultGeneralPlaybook());
  const [playbookReady,setPlaybookReady]=useState(false);
  const playbookHydration=useRef(0);
  const generalPlaybookRef=useRef(generalPlaybook);generalPlaybookRef.current=generalPlaybook;
  useEffect(()=>{const epoch=++playbookHydration.current;setPlaybookReady(false);void loadGeneralPlaybook().then(value=>{if(epoch===playbookHydration.current){setGeneralPlaybook(value);setPlaybookReady(true);}}).catch(()=>setError("General Playbook could not be opened."));return()=>{playbookHydration.current++;};},[]);
  const [brainBusy,setBrainBusy]=useState(false);
  const manufacturersRef=useRef<Manufacturer[]>([]);manufacturersRef.current=manufacturers;
  const [activeId, setActiveId] = useState("");
  const [calls, setCalls] = useState<CallRecord[]>([]);
  const activeCallId=useRef("");
  const [callSessionId,setCallSessionId]=useState("");
  const [callConfiguration,setCallConfiguration]=useState<CallConfigurationBinding>();
  const callConfigurationRef=useRef<CallConfigurationBinding|undefined>(undefined);
  const [hydrated, setHydrated] = useState(false);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [modal, setModal] = useState<Modal>(null);
  const [buyer, setBuyer] = useState("");
  const [activeClientId,setActiveClientId]=useState("");
  const [activeContactId,setActiveContactId]=useState("");
  const [reachViaContactId,setReachViaContactId]=useState("");
  const routeSelectionSequence=useRef(0);
  const [callPreparation,setCallPreparation]=useState<CallPreparationSnapshot>();
  const [showClientList,setShowClientList]=useState(true);
  const [creatingClient,setCreatingClient]=useState(false);
  const [newClientName,setNewClientName]=useState('');
  const [newClientPhone,setNewClientPhone]=useState('');
  const [outsideUpdate,setOutsideUpdate]=useState('');
  const [preparingBrief,setPreparingBrief]=useState(false);
  const [uploadingBackground,setUploadingBackground]=useState(false);
  const [briefError,setBriefError]=useState('');
  const [wrapUp,setWrapUp]=useState<ClientCallWrapUp>();
  const [wrapUpNextCall,setWrapUpNextCall]=useState(false);
  const [categoryFilter,setCategoryFilter]=useState<'all'|ClientCategory>('all');
  const [savingCall,setSavingCall]=useState(false);
  const backgroundRequest=useRef(0);
  const [historyClientId,setHistoryClientId]=useState<string|null>(null);
  const [historyContactId,setHistoryContactId]=useState('');
  const savedSessionGuard=useRef(false);
  const callSaveInFlight=useRef(false);
  const [savedCallNotice,setSavedCallNotice]=useState<{id:string;at:number}>();
  const clientRemovalOperations=useRef(new Set<string>());
  const [goal, setGoal] = useState(GOALS[0]);
  const [callContext,setCallContext]=useState<CallContext>(()=>defaultCallContext(GOALS[0]));
  const [turns, setTurns] = useState<Turn[]>([]);
  const [restoredTurnCount,setRestoredTurnCount] = useState(0);
  const [draftRestoreRevision,setDraftRestoreRevision] = useState(0);
  const [notes, setNotes] = useState("");
  const [startedAt, setStartedAt] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [live, setLive] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [paused, setPaused] = useState(false);
  const [partial, setPartial] = useState("");
  const [hearing, setHearing] = useState(false);
  const [guidance, setGuidance] = useState<Guidance | null>(null);
  const [guidanceId,setGuidanceId] = useState("");
  const [guidanceAt,setGuidanceAt] = useState(0);
  const activeGuidance=useRef<{id:string;value:Guidance|null}>({id:"",value:null});
  activeGuidance.current={id:guidanceId,value:guidance};
  const [thinking, setThinking] = useState(false);
  const [queuedRequest,setQueuedRequest]=useState<QueuedCoachingRequest|null>(null);
  const [latency, setLatency] = useState(0);
  const [liveTiming,setLiveTiming]=useState<LiveLatencySnapshot>();
  const [liveDraft, setLiveDraft] = useState(false);
  const manualSubmitted=useRef(0);
  const [manualTrace,setManualTrace]=useState<ManualTiming|null>(null);
  useLayoutEffect(()=>{
    if(!manualTrace||manualTrace.replyId!==guidanceId||!guidance?.say)return;
    const now=Date.now(),elapsed=now-manualTrace.submittedAt,usable=isUsableCoachingWording(guidance.say,manualTrace.complete);
    const stable=manualTrace.verified&&manualTrace.stableSay!==guidance.say;
    if(manualTrace.firstChunkMs===undefined||manualTrace.complete&&manualTrace.fullSuggestionMs===undefined||usable&&manualTrace.firstUsableMs===undefined||stable)setManualTrace(value=>value?{...value,
      firstChunkMs:value.firstChunkMs??elapsed,firstUsableMs:usable?(value.firstUsableMs??elapsed):value.firstUsableMs,
      fullSuggestionMs:value.complete?(value.fullSuggestionMs??elapsed):undefined,
      ...stable?{stableSuggestionMs:elapsed,stableSay:guidance.say,displayDelayMs:value.lastDisplayEventAt===undefined?undefined:now-value.lastDisplayEventAt}:{},
    }:value);
  },[manualTrace,guidanceId,guidance]);
  useEffect(()=>{if(manualTrace?.firstChunkMs!==undefined)setSuggestions(previous=>previous.map(item=>item.id===manualTrace.replyId?{...item,manualTiming:manualTrace}:item));},[manualTrace]);

  const [manualText, setManualText] = useState("");
  const [manualRole, setManualRole] = useState<Turn["role"]>("buyer");
  const [selectedCall, setSelectedCall] = useState<string | null>(null);
  const [deleteCallId,setDeleteCallId] = useState<string|null>(null);
  const [summarizing, setSummarizing] = useState(false);
  const [outcome, setOutcome] = useState("");
  const [callType,setCallType] = useState<CallType>("discovery");
  const [bilingual,setBilingual] = useState(false);
  const [translateBuyer,setTranslateBuyer] = useState(true);
  const [translationPending,setTranslationPending] = useState<TranslationJob[]>([]);
  const [translationErrors,setTranslationErrors] = useState<Record<string,{text:string;message:string}>>({});
  const translationQueue=useRef<BuyerTranslationQueue|null>(null);
  const translationState=useRef({enabled:translateBuyer,configured,hydrated,calls});
  translationState.current={enabled:translateBuyer,configured,hydrated,calls};
  const [currentStage,setCurrentStage] = useState("opening");
  const [stageHistory,setStageHistory] = useState<StageEvent[]>([]);
  const [suggestions,setSuggestions] = useState<SuggestionRecord[]>([]);
  const suggestionsRef=useRef<SuggestionRecord[]>([]);
  useEffect(()=>{suggestionsRef.current=suggestions;},[suggestions]);
  const manualReplyEdits=useRef(new Map<string,string>());
  const manualReplyRetired=useRef(new Set<string>());
  const [missingKnowledge,setMissingKnowledge] = useState<MissingKnowledge[]>([]);
  const [nextStepAt,setNextStepAt] = useState("");
  const [captureWarnings,setCaptureWarnings] = useState<string[]>([]);
  const captureWarningsRef = useRef<string[]>([]);
  const [buyerQuestionLog,setBuyerQuestionLog]=useState<LiveQuestionQueueEvent[]>([]);
  const buyerQuestionLogRef=useRef<LiveQuestionQueueEvent[]>([]);
  const [packetLanguage,setPacketLanguage] = useState<"en"|"zh">("en");
  const [repSpeaking,setRepSpeaking] = useState(false);
  const [repPartial,setRepPartial] = useState("");
  const [repLevel,setRepLevel] = useState(0);
  const [checkingFacts,setCheckingFacts] = useState(false);
  const repAudio = useRef<Awaited<ReturnType<typeof startRepAudio>>|null>(null);
  const repAbort = useRef<AbortController|null>(null);
  const turnGate = useRef(new LiveTurnCoordinator({onRequest:()=>{},onSupersede:()=>{},onCancel:()=>{}}));
  const liveSession=useRef<LiveCoachingSession|null>(null);
  const [buyerAudioIssue,setBuyerAudioIssue]=useState<BuyerAudioIssue|null>(null);
  const [pendingBuyerText,setPendingBuyerText]=useState("");
  const pendingBuyerItems = useRef(new Set<string>());
  const englishGuard=useRef<ReturnType<typeof createEnglishTranscriptionGuard>|null>(null);
  const transcriptionDiagnostics=useRef<{sessions:unknown[];turns:Record<string,unknown>[]}>({sessions:[],turns:[]});
  const [voice, setVoice] = useState<VoiceProfile>(DEFAULT_VOICE);
  const [buyerBrief, setBuyerBrief] = useState<BuyerBrief|null>(null);
  const [budget, setBudget] = useState<BudgetSettings>(DEFAULT_BUDGET);
  const [usageEntries,setUsageEntries] = useState<UsageEntry[]>([]);
  const [callCostUsd,setCallCostUsd] = useState(0);
  const [driveUrl,setDriveUrl] = useState("");
  const [driveLoading,setDriveLoading] = useState(false);
  const [drivePreview,setDrivePreview] = useState<{sources:Source[];warnings:string[]}|null>(null);
  const [knowledgeQuery,setKnowledgeQuery] = useState("");
  const recentReplies = useRef<string[]>([]);
  const callGeneration = useRef(0);
  const callHandle = useRef("");
  const spendState = useRef({budget,entries:usageEntries,callUsd:callCostUsd});
  spendState.current={budget,entries:usageEntries,callUsd:callCostUsd};
  const [level, setLevel] = useState(0);
  const [micTest, setMicTest] = useState(false);
  const [deviceId, setDeviceId] = useState("");
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [audioMode, setAudioMode] = useState<AudioMode>("speakerphone");
  const [inputGain, setInputGain] = useState(4);
  const [signal, setSignal] = useState<"quiet" | "good" | "clipping">("quiet");
  const [decibels, setDecibels] = useState(-100);
  const [activeInput, setActiveInput] = useState("");
  const [inputDetails, setInputDetails] = useState("");
  const [openingChoices,setOpeningChoices]=useState<Record<string,OpeningChoice>>({});
  const openingChoicesRef=useRef<Record<string,OpeningChoice>>({});
  const [captureDiagnostic,setCaptureDiagnostic]=useState<ComputerAudioCaptureError|null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const peer = useRef<RTCPeerConnection | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const rawStream = useRef<MediaStream | null>(null);
  const gainNode = useRef<GainNode | null>(null);
  const audioGeneration = useRef(0);
  const captureBusy = useRef(false);
  const audioContext = useRef<AudioContext | null>(null);
  const frame = useRef(0);
  const channel = useRef<RTCDataChannel | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const testTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seq = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const transcriptEnd = useRef<HTMLDivElement>(null);
  const importInput = useRef<HTMLInputElement>(null);
  const sourceInput = useRef<HTMLInputElement>(null);
  const [extracting, setExtracting] = useState(false);
  const [formName, setFormName] = useState("");
  const [formProducts, setFormProducts] = useState("");
  const [formText, setFormText] = useState("");
  const current = manufacturers.find(m => m.id === activeId);
  const uiLocation=useRef({view,selectedCall});uiLocation.current={view,selectedCall};
  const context = useRef({ current, buyer, goal, turns, voice, buyerBrief, callType,bilingual,currentStage,callContext,clientId:activeClientId,contactId:activeContactId,reachViaContactId,preparation:callPreparation,outsideUpdate,wrapUp,transcriptionDiagnostics:transcriptionDiagnostics.current });
  context.current = { current, buyer, goal, turns, voice, buyerBrief,callType,bilingual,currentStage,callContext,clientId:activeClientId,contactId:activeContactId,reachViaContactId,preparation:callPreparation,outsideUpdate,wrapUp,transcriptionDiagnostics:transcriptionDiagnostics.current };
  const draft = useRef({ callId:activeCallId.current,recentReplies:recentReplies.current,startedAt, elapsed, notes, outcome, buyer, goal, turns, activeId,callCostUsd,buyerBrief,callType,bilingual,currentStage,stageHistory,suggestions,missingKnowledge,nextStepAt,captureWarnings,buyerQuestionLog,callContext,companyConfiguration:callConfiguration,clientId:activeClientId,contactId:activeContactId,reachViaContactId,preparation:callPreparation,outsideUpdate,wrapUp,transcriptionDiagnostics:transcriptionDiagnostics.current });
  draft.current = { callId:activeCallId.current,recentReplies:recentReplies.current,startedAt, elapsed, notes, outcome, buyer, goal, turns, activeId,callCostUsd,buyerBrief,callType,bilingual,currentStage,stageHistory,suggestions,missingKnowledge,nextStepAt,captureWarnings,buyerQuestionLog,callContext,companyConfiguration:callConfiguration,clientId:activeClientId,contactId:activeContactId,reachViaContactId,preparation:callPreparation,outsideUpdate,wrapUp,transcriptionDiagnostics:transcriptionDiagnostics.current };
  function markCaptureWarning(message:string) { if(captureWarningsRef.current.includes(message))return;captureWarningsRef.current=[...captureWarningsRef.current,message];setCaptureWarnings(captureWarningsRef.current); }

  useEffect(() => {
    // Fast Refresh retains state. Close writes synchronously before loading
    // records so a retained ready flag cannot overwrite the saved Brain.
    const hydrationEpoch=++brainHydration.current.epoch;
    brainHydration.current.ready=false;setBrainsReady(false);
    void (async()=>{
      const stored=await loadWorkspaceSnapshot<{version:number;manufacturers:Manufacturer[];calls:CallRecord[];activeId:string;draft:typeof draft.current}>();
      const saved=stored || JSON.parse(localStorage.getItem(STORAGE) || 'null');
      if(brainHydration.current.epoch!==hydrationEpoch)return;
      if(saved && (!Array.isArray(saved.manufacturers)||!Array.isArray(saved.calls)))throw new Error('The saved workspace is invalid.');
      if (saved) {
        activeCallId.current=typeof saved.draft?.callId==="string"?saved.draft.callId:uid();setCallSessionId(activeCallId.current);
        const savedBinding=CallConfigurationBindingInput.safeParse(saved.draft?.companyConfiguration);
        if(savedBinding.success&&savedBinding.data.companyId===saved.draft?.activeId){callConfigurationRef.current=savedBinding.data;setCallConfiguration(savedBinding.data);}
        setManufacturers((saved.manufacturers || []).map((item:Manufacturer)=>({...item,brain:ensureCompanyBrain(item)}))); setCalls(saved.calls || []); setActiveId(saved.activeId || "");
        if (saved.draft?.turns?.length || saved.draft?.suggestions?.length || saved.draft?.callContext) {
          transcriptionDiagnostics.current={sessions:Array.isArray(saved.draft.transcriptionDiagnostics?.sessions)?saved.draft.transcriptionDiagnostics.sessions:[],turns:Array.isArray(saved.draft.transcriptionDiagnostics?.turns)?saved.draft.transcriptionDiagnostics.turns:[]};
          setReachViaContactId(saved.draft.reachViaContactId||'');
          setOutsideUpdate(typeof saved.draft.outsideUpdate==='string'?saved.draft.outsideUpdate:'');setWrapUp(saved.draft.wrapUp?.callId===saved.draft.callId?saved.draft.wrapUp:undefined);
          setCallContext(normalizeCallContext(saved.draft.callContext || {background:saved.draft.buyerBrief?.summary || "",knownFacts:(saved.draft.buyerBrief?.facts || []).map((fact:{text:string;sourceUrl:string})=>fact.text+" ("+fact.sourceUrl+")").join("\n")},saved.draft.goal || GOALS[0]));
          setBuyerBrief(saved.draft.buyerBrief||null);recentReplies.current=Array.isArray(saved.draft.recentReplies)?saved.draft.recentReplies.slice(-12):[];
          setTurns(saved.draft.turns || []);setRestoredTurnCount(saved.draft.turns?.length || 0); setBuyer(saved.draft.buyer || ""); setGoal(saved.draft.goal || GOALS[0]); setNotes(saved.draft.notes || "");
          setStartedAt(saved.draft.startedAt || 0); setElapsed(saved.draft.elapsed || 0); setOutcome(OUTCOMES.includes(saved.draft.outcome) ? saved.draft.outcome : "");
          setCallType(normalizeCallType(saved.draft.callType));setCurrentStage(saved.draft.currentStage || "opening");
          setStageHistory(saved.draft.stageHistory || []);setSuggestions(saved.draft.suggestions || []);setMissingKnowledge(saved.draft.missingKnowledge || []);setNextStepAt(saved.draft.nextStepAt || "");
          captureWarningsRef.current=Array.isArray(saved.draft.captureWarnings) ? saved.draft.captureWarnings : [];setCaptureWarnings(captureWarningsRef.current);
          buyerQuestionLogRef.current=Array.isArray(saved.draft.buyerQuestionLog)?saved.draft.buyerQuestionLog:[];setBuyerQuestionLog(buyerQuestionLogRef.current);
          setToast("Your unfinished call was restored. The microphone is off.");
        }
      }
      const audio = JSON.parse(localStorage.getItem(AUDIO_STORAGE) || "null");
      if (audio) { setDeviceId(typeof audio.deviceId === "string" ? audio.deviceId : ""); setAudioMode(audio.mode === "computer" ? "computer" : audio.mode === "headset" ? "headset" : "speakerphone"); setInputGain(audio.mode==="computer" ? 1 : Math.min(8,Math.max(1,Number(audio.gain) || (audio.mode === "speakerphone" ? 4 : 1)))); }
      const features=JSON.parse(localStorage.getItem(FEATURE_STORAGE) || "null");
      if(features) { if(features.workflowRole==='salesperson'||features.workflowRole==='manager')setWorkflowRole(features.workflowRole); setBilingual(Boolean(features.bilingual));setTranslateBuyer(features.translateBuyer!==false); if(!(saved?.draft?.turns?.length || saved?.draft?.suggestions?.length))setCallType(normalizeCallType(features.callType)); if(features.voice)setVoice({...DEFAULT_VOICE,...features.voice});  }
      const usage=JSON.parse(localStorage.getItem(USAGE_STORAGE) || "null");
      if(usage) { if(usage.budget)setBudget({...DEFAULT_BUDGET,...usage.budget}); if(Array.isArray(usage.entries))setUsageEntries(usage.entries.filter((e:UsageEntry)=>typeof e.id==="string"&&Number.isFinite(e.usd)&&e.usd>=0)); setCallCostUsd(Math.max(0,Number(usage.callUsd)||0)); }
      const brains=await loadCompanyBrains();
      if(brainHydration.current.epoch!==hydrationEpoch)return;
      if(stored&&saved.manufacturers.some((company:Manufacturer)=>!brains.some(brain=>brain.companyId===company.id)))throw new Error('The verified company records are incomplete. Existing local data was kept. Restore the verified backup before continuing; saving is disabled.');
      const loaded=(saved?.manufacturers||[]).map((company:Manufacturer)=>{const db=brains.find(brain=>brain.companyId===company.id),local=ensureCompanyBrain(company),base=db&&(!!stored||db.updatedAt>=local.updatedAt)?db:local;const migrated=migrateBrainHistory(company,base,saved?.calls||[],saved?.draft?{...saved.draft,manufacturerId:saved.draft.activeId}:undefined);return {...company,brain:migrated};});
      const clientMigration=migrateClientWorkspace(loaded,saved?.calls||[],saved?.draft);
      // The first durable snapshot is committed before writes are enabled.
      // Keep the old localStorage and Brain database unchanged for recovery.
      const initial={version:1,manufacturers:clientMigration.companies.map(company=>{const item={...company};delete item.brain;return item;}),calls:clientMigration.calls,activeId:saved?.activeId||'',draft:clientMigration.draft || saved?.draft || draft.current};
      const migratedBrains=clientMigration.companies.map(ensureCompanyBrain),visibleIds=new Set(migratedBrains.map(brain=>brain.companyId));
      await saveWorkspaceSnapshot(initial,[...brains.filter(brain=>!visibleIds.has(brain.companyId)),...migratedBrains],()=>brainHydration.current.epoch===hydrationEpoch,true);
      if(brainHydration.current.epoch!==hydrationEpoch)return;
      if(!await loadWorkspaceSnapshot())throw new Error('The migrated workspace could not be verified.');
      manufacturersRef.current=clientMigration.companies;setManufacturers(clientMigration.companies);setCalls(clientMigration.calls);
      if(clientMigration.draft){const restored=clientMigration.draft;setActiveClientId(restored.clientId||'');setActiveContactId(restored.contactId||'');setReachViaContactId(restored.reachViaContactId||'');setCallPreparation(parseCallPreparation(restored.preparation));}
      if(clientMigration.reviewCount)setToast(`${clientMigration.reviewCount} historical associations need client identity review. Original calls were preserved.`);
      setHydrated(true);brainHydration.current.ready=true;setBrainReadyEpoch(hydrationEpoch);setBrainsReady(true);
    })().catch(cause=>{if(brainHydration.current.epoch===hydrationEpoch)setError(cause instanceof Error&&['The verified workspace snapshot is missing.','The verified workspace snapshot is invalid.','The workspace verification marker is missing or invalid.','The verified company records are incomplete.'].some(prefix=>cause.message.startsWith(prefix))?cause.message:"The workspace could not be safely loaded or migrated. Existing local data was kept. Restore the verified backup before continuing; saving is disabled.");});
    requestJSON<{configured:boolean}>("/api/status").then(data => setConfigured(data.configured)).catch(e => { setConfigured(false); setError(e.message); });
    return () => { if(brainHydration.current.epoch===hydrationEpoch){brainHydration.current.ready=false;brainHydration.current.epoch++;}liveSession.current?.stop();audioGeneration.current++;captureBusy.current=false;channel.current=null;turnGate.current.pause(true);repAbort.current?.abort();repAudio.current?.stop(); const oldPeer=peer.current;peer.current=null;oldPeer?.close(); if(callHandle.current)void fetch("/api/session/stop",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({handle:callHandle.current}),keepalive:true}).catch(()=>{}); callHandle.current=""; stream.current?.getTracks().forEach(t => t.stop()); rawStream.current?.getTracks().forEach(t => t.stop()); void audioContext.current?.close(); cancelAnimationFrame(frame.current); controller.current?.abort(); if (timer.current) clearTimeout(timer.current); if (testTimer.current) clearTimeout(testTimer.current); if (stopTimer.current) clearTimeout(stopTimer.current); };
  }, []);
  useEffect(()=>{
    if(!hydrated)return;
    try { localStorage.setItem(FEATURE_STORAGE,JSON.stringify({voice,bilingual,callType,translateBuyer,workflowRole})); localStorage.setItem(USAGE_STORAGE,JSON.stringify({budget,entries:usageEntries,callUsd:callCostUsd})); }
    catch { setError("Your settings or usage could not be saved. Export a backup before closing this page."); }
  },[hydrated,voice,buyerBrief,buyer,budget,usageEntries,callCostUsd,bilingual,callType,translateBuyer,workflowRole]);
  useEffect(()=>{
    if(!hydrated || !live)return;
    const decision=budgetDecision(budget,callCostUsd,usageEntries);
    if(!decision.allowed) {stopAudio();setError(decision.reason+" The AI assistant stopped; your phone call can continue.");}
  },[budget,callCostUsd,usageEntries,hydrated,live]);
  useEffect(() => {
    if (!hydrated) return;
    try { localStorage.setItem(AUDIO_STORAGE,JSON.stringify({deviceId,mode:audioMode,gain:inputGain})); } catch { /* Workspace storage reports errors separately. */ }
    if (gainNode.current && audioContext.current) gainNode.current.gain.setTargetAtTime(audioMode==="computer"?normalizeComputerAudioGain(inputGain):inputGain,audioContext.current.currentTime,.03);
  }, [hydrated,deviceId,audioMode,inputGain]);
  useEffect(() => {
    const media = navigator.mediaDevices;
    if (!media?.enumerateDevices) return;
    const refresh = () => { void media.enumerateDevices().then(all => setDevices(all.filter(d => d.kind === "audioinput"))).catch(() => {}); };
    refresh(); media.addEventListener("devicechange",refresh); return () => media.removeEventListener("devicechange",refresh);
  }, []);
  useEffect(() => {
    if (!hydrated || !brainsReady || !brainHydration.current.ready || brainHydration.current.epoch!==brainReadyEpoch) return;
    const epoch=brainReadyEpoch,generation=workspaceWriteGeneration.current;
    const snapshot={version:1,manufacturers:manufacturers.map(company=>{const stored={...company};delete stored.brain;return stored;}),calls,activeId,draft:draft.current};
    const isCurrent=()=>brainHydration.current.ready&&brainHydration.current.epoch===epoch&&workspaceWriteGeneration.current===generation&&!callSaveInFlight.current;
    void saveWorkspaceSnapshot(snapshot,manufacturers.map(ensureCompanyBrain),isCurrent).catch(()=>{if(isCurrent())setError("Your workspace could not be saved. Export a backup before closing this page.");});
  }, [hydrated, brainsReady,brainReadyEpoch,manufacturers, calls, activeId, turns, notes, buyer, goal, elapsed, outcome, startedAt,callCostUsd,buyerBrief,callType,bilingual,currentStage,stageHistory,suggestions,missingKnowledge,nextStepAt,captureWarnings,buyerQuestionLog,callContext,callConfiguration,activeClientId,activeContactId,reachViaContactId,callPreparation,outsideUpdate,wrapUp]);
  useEffect(()=>{
    if(!hydrated||!brainsReady||!brainHydration.current.ready||brainHydration.current.epoch!==brainReadyEpoch||!current||!buyer.trim()||!turns.length||activeClientId)return;
    const brain=ensureCompanyBrain(current),binding=callConfigurationRef.current,state=deriveConversationState({callId:activeCallId.current,turns,callContext,stageMap:binding?configurationStageMap(binding.snapshot,{includeRetired:true}):brain.playbook.stages,companyConfiguration:binding});
    updateCompanyBrain(current.id,previous=>{const next=rememberBuyer(previous,buyer,state);return {...next,buyers:next.buyers.map(memory=>memory.name===buyer?{...memory,processedTurnIds:[...new Set([...(memory.processedTurnIds||[]),...turns.map(turn=>turn.id)])].slice(-600)}:memory)};});
  },[hydrated,brainsReady,brainReadyEpoch,turns,buyer,callContext,activeId,activeClientId]);
  useEffect(() => { if (toast) { const t = setTimeout(() => setToast(""), 4000); return () => clearTimeout(t); } }, [toast]);
  useEffect(() => { if (!live || paused) return; const t = setInterval(() => setElapsed(n => n+1), 1000); return () => clearInterval(t); }, [live, paused]);
  useEffect(() => { const container = transcriptEnd.current?.parentElement; if (container && (turns.length || partial)) container.scrollTop = container.scrollHeight; }, [turns, partial,translationPending]);
  useEffect(()=>{if(hydrated && configured && translateBuyer){queueBuyerTranslations(context.current.turns,"background");translationQueue.current?.kick();}},[hydrated,configured,translateBuyer,draftRestoreRevision]);
  useEffect(()=>()=>{translationQueue.current?.dispose();translationQueue.current=null;},[]);
  useEffect(()=>{const sync=(event:StorageEvent)=>{if(event.key!==USAGE_STORAGE||!event.newValue)return;try{const entries=JSON.parse(event.newValue).entries;if(Array.isArray(entries))recordCharges(entries,false);}catch{}};window.addEventListener("storage",sync);return()=>window.removeEventListener("storage",sync);},[]);
  useEffect(() => {
    if (!modal && !showHelp) return;
    const previous = document.activeElement as HTMLElement | null;
    const handle = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !extracting) { setModal(null); setShowHelp(false); return; }
      if (event.key !== "Tab") return;
      const nodes = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"] button:not(:disabled),[role="dialog"] input:not(:disabled),[role="dialog"] textarea:not(:disabled),[role="dialog"] select:not(:disabled)'));
      const first = nodes[0], last = nodes[nodes.length-1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    const t = setTimeout(() => { if (!document.activeElement?.closest('[role="dialog"]')) document.querySelector<HTMLElement>('[role="dialog"] button')?.focus(); }, 0);
    document.addEventListener("keydown", handle); return () => { clearTimeout(t); document.removeEventListener("keydown", handle); previous?.focus(); };
  }, [modal, showHelp, extracting]);
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => { if (peer.current) { e.preventDefault(); } };
    window.addEventListener("beforeunload", handler); return () => window.removeEventListener("beforeunload", handler);
  }, []);

  function notify(message: string) { setToast(message); }
  function invalidatePreparation() {
    context.current.preparation=undefined;setCallPreparation(undefined);
  }
  function clientFor(company=context.current.current,clientId=context.current.clientId) {
    return company?ensureCompanyBrain(company).clients?.find(client=>client.id===clientId&&client.companyId===company.id):undefined;
  }
  function hasUnfinishedDraft() {
    return !!(context.current.turns.length||draft.current.notes.trim()||suggestionsRef.current.length||(context.current.outsideUpdate||'').trim()||context.current.wrapUp);
  }
  function preparationInput(company=context.current.current) {
    const client=clientFor(company);if(!company||!client)throw new Error("Choose a client before preparing this call.");
    if(client.removedAt!==undefined)throw new Error("Restore this client before starting another call. Saved conversations remain available in Call History.");
    const binding=previewCallConfiguration(company);if(!binding)throw new Error("Choose an available sales stage.");
    const background=backgroundFor(client),brief=background.brief;
    const stale=!!brief&&brief.inputFingerprint!==preparationInputFingerprint(briefRequestBody(client,background));
    const callBackground=stale?{...background,brief:undefined}:background;
    return {company,client,contactId:context.current.contactId||undefined,reachViaContactId:context.current.reachViaContactId||undefined,callId:activeCallId.current,stageId:context.current.callContext.stageId,configurationBinding:binding,calls,callContext:context.current.callContext,outsideUpdate:context.current.outsideUpdate,callBackground};
  }
  function ensurePreparationReviewed() {
    try {
      const input=preparationInput(),snapshot=context.current.preparation;
      const bound=callConfigurationRef.current;
      // The bound manager stage remains stable, but reviewed background can be refreshed.
      void bound;
      if(!snapshot||!isPreparationCurrent(snapshot,input))throw new Error("Review this client’s preparation and confirm it is current before starting. Your draft is preserved.");
      return snapshot;
    }catch(cause){setError(cause instanceof Error?cause.message:"Review the client preparation before starting.");return undefined;}
  }
  function confirmPreparation(confirmed:boolean) {
    if(callSaveInFlight.current){setError("The call is saving. Update client preparation after it finishes.");return;}
    if(!confirmed){invalidatePreparation();return;}
    try {const snapshot=buildCallPreparation(preparationInput(),{reviewed:true});context.current.preparation=snapshot;setCallPreparation(snapshot);setError("");}
    catch(cause){setError(cause instanceof Error?cause.message:"The preparation could not be confirmed.");}
  }
  function updateClient(clientId:string,change:(client:ClientRecord)=>ClientRecord) {
    if(callSaveInFlight.current){setError("The call is saving. Update client preparation after it finishes.");return;}
    const company=context.current.current;if(!company)throw new Error("Choose the selling company first.");
    updateCompanyBrain(company.id,brain=>({...brain,clients:(brain.clients||[]).map(client=>client.id===clientId&&client.companyId===company.id?change(client):client),updatedAt:Date.now()}));
    if(clientId===context.current.clientId)invalidatePreparation();
  }
  function chooseContact(contactId?:string) {
    if(callSaveInFlight.current){setError("The call is saving. Change clients or contacts after it finishes.");return;}
    if(callConfigurationRef.current)return;
    const client=clientFor();if(contactId&&!client?.contacts.some(contact=>contact.id===contactId&&!contact.archived))return;
    context.current.contactId=contactId||'';setActiveContactId(contactId||'');invalidatePreparation();
  }
  async function chooseReachVia(requestedId?:string) {
    if(callSaveInFlight.current||callConfigurationRef.current||!brainHydration.current.ready||brainHydration.current.epoch!==brainReadyEpoch)return;
    const client=clientFor(),company=context.current.current;if(!client||!company)return;
    const epoch=brainReadyEpoch,selection=++routeSelectionSequence.current;
    try {
      const selected=selectClientPhoneRoute(client,requestedId);
      if(selected.client!==client)updateClient(client.id,()=>selected.client);
      // A repeated selection can see a newly created contact while its first
      // write is pending. Every nonempty selection waits for durable storage.
      // The UI-only main-line action never enters preparation or coaching.
      if(selected.contactId)await saveCompanyBrains(manufacturersRef.current.map(ensureCompanyBrain),()=>brainHydration.current.ready&&brainHydration.current.epoch===epoch);
      if(selection!==routeSelectionSequence.current||context.current.current?.id!==company.id||context.current.clientId!==client.id||callSaveInFlight.current||callConfigurationRef.current||!brainHydration.current.ready||brainHydration.current.epoch!==epoch)return;
      const currentClient=clientFor();if(!currentClient)return;
      const confirmed=selectClientPhoneRoute(currentClient,selected.contactId);
      context.current.reachViaContactId=confirmed.contactId||'';draft.current.reachViaContactId=confirmed.contactId||'';
      setReachViaContactId(confirmed.contactId||'');invalidatePreparation();setError('');
    }catch(cause){if(selection===routeSelectionSequence.current)setError(cause instanceof Error?cause.message:'The phone route could not be saved.');}
  }
  function chooseClient(clientId:string) {
    if(callSaveInFlight.current){setError("The call is saving. Change clients or contacts after it finishes.");return;}
    const company=context.current.current,client=clientFor(company,clientId);if(!company||!client)return;
    if(client.removedAt!==undefined){setError("Restore this client before preparing another call.");return;}
    if(live||connecting){setError("Stop the assistant before changing clients.");return;}
    const same=context.current.clientId===client.id;
    if(!same&&hasUnfinishedDraft()){
      setError("Resume and save the unfinished call before starting with another client.");return;
    }
    if(!same||savedSessionGuard.current){resetActiveCall();savedSessionGuard.current=false;}
    context.current.clientId=client.id;context.current.buyer=client.name;
    setActiveClientId(client.id);setBuyer(client.name);
    if(!same){const mainLine=client.contacts.find(item=>item.kind==='main_line'&&!item.archived);context.current.contactId=mainLine?.id||'';context.current.preparation=undefined;setActiveContactId(mainLine?.id||'');context.current.reachViaContactId=mainLine?.id||'';setReachViaContactId(mainLine?.id||'');setCallPreparation(undefined);}setCreatingClient(false);
    setShowClientList(false);setView('live');setError('');
  }
  function openNewClientWorkspace() {
    if(live||connecting)return;
    if(hasUnfinishedDraft()){setError('Finish and save the current conversation before adding another client.');return;}
    resetActiveCall();setCreatingClient(true);setNewClientName('');setNewClientPhone('');setShowClientList(false);setView('live');setError('');
  }
  async function createWorkspaceClient() {
    if(!newClientName.trim())return;
    try {
      await createClient({name:newClientName,background:'',...(newClientPhone.trim()?{contact:{name:'Company main line',kind:'main_line' as const,phone:newClientPhone.trim()}}:{})});
      const client=clientFor();if(client){const contact=client.contacts.find(item=>item.kind==='main_line');chooseContact(contact?.id);}
      setCreatingClient(false);setNewClientName('');setNewClientPhone('');
    }catch(cause){setError(cause instanceof Error?cause.message:'The client could not be saved.');}
  }
  function changeClientBackground(value:ClientCallBackground) {
    if(callSaveInFlight.current){setBriefError("The call is saving. Update background after it finishes.");return;}
    const client=clientFor();if(!client)return;
    updateClient(client.id,item=>updateClientRecord(item,{callBackground:value}));
    setBriefError('');
  }
  function changeOutsideUpdate(value:string) {
    if(callSaveInFlight.current){setBriefError("The call is saving. Update background after it finishes.");return;}
    context.current.outsideUpdate=value;setOutsideUpdate(value);invalidatePreparation();
  }
  function backgroundFor(client:ClientRecord):ClientCallBackground {
    return client.callBackground||{websites:[],context:client.background,sources:[]};
  }
  function briefRequestBody(client:ClientRecord,background=backgroundFor(client)) {
    const company=context.current.current!,binding=previewCallConfiguration(company),stage=binding?.snapshot.stages.find(item=>item.id===binding.selectedStageId);
    if(!stage)throw Error('Select an available manager stage before preparing.');
    return preparationRequestFor({company,client,contactId:context.current.contactId||undefined,reachViaContactId:context.current.reachViaContactId||undefined,callId:activeCallId.current,stageId:binding!.selectedStageId,configurationBinding:binding!,calls,callContext:context.current.callContext,outsideUpdate:context.current.outsideUpdate,callBackground:background});
  }

  async function prepareClientBrief(uploads:PreparationUpload[]=[]) {
    if(callSaveInFlight.current){setBriefError("The call is saving. Update background after it finishes.");return;}
    const client=clientFor();if(!client)return;
    const requestId=++backgroundRequest.current,sessionId=activeCallId.current,companyId=client.companyId;
    setPreparingBrief(true);setBriefError('');
    try {
      const decision=budgetDecision(spendState.current.budget,spendState.current.callUsd,spendState.current.entries,.02);if(!decision.allowed)throw Error(decision.reason);
      const body={...briefRequestBody(client),uploads};
      const response=await fetch('/api/preparation',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      const result=await response.json() as {brief?:ClientPreparationBrief;sources?:ClientCallBackground['sources'];_charges?:UsageEntry[];error?:string};
      if(result._charges)recordCharges(result._charges,activeCallId.current===sessionId);
      if(requestId!==backgroundRequest.current||activeCallId.current!==sessionId||context.current.clientId!==client.id||context.current.current?.id!==companyId)return;
      if(preparationInputFingerprint(body)!==preparationInputFingerprint(briefRequestBody(clientFor()!))){setBriefError('Background changed while the brief was preparing. Your latest edits are kept; select Update brief again.');return;}
      // Validation/auth failures return no ingested sources. They must not
      // erase the client's existing files; partial successful ingestion can
      // still be retained when the subsequent brief generation fails.
      if(result.sources&&(response.ok||result.sources.length>0))changeClientBackground({...backgroundFor(clientFor()!),sources:result.sources,...result.brief?{brief:result.brief}:{}});
      if(!response.ok||!result.brief)throw Error(result.error||'The brief could not be prepared. Your background is saved; you can review it manually.');
      notify('Brief prepared. Review it before requesting coaching.');
    }catch(cause){if(requestId===backgroundRequest.current)setBriefError(cause instanceof Error?cause.message:'The brief could not be prepared.');}
    finally{if(requestId===backgroundRequest.current)setPreparingBrief(false);}
  }
  async function uploadClientBackground(files:File[],readAt:number) {
    if(callSaveInFlight.current){setBriefError("The call is saving. Update background after it finishes.");return;}
    const client=clientFor();if(!client)return;
    const sessionId=activeCallId.current;setUploadingBackground(true);setBriefError('');
    try {
      const results:ClientCallBackground['sources']=[];
      for(const file of files.slice(0,12)){
        const scope={companyId:client.companyId,clientId:client.id};
        if(file.size>PREPARATION_MAX_BYTES){results.push({id:uid(),...scope,kind:'document',name:file.name,text:'',status:'error',error:'Choose a file under 8 MB.',readAt});continue;}
        const data=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(Error('The file could not be read.'));reader.readAsDataURL(file);});
        results.push(await parsePreparationUpload({name:file.name,data},scope,async(_bytes,name)=>{const extracted=await billableJSON<{text:string}>('/api/extract',{name,data:data.replace(/^data:[^;]*;/,'data:application/pdf;')});return extracted.text;},readAt));
      }
      if(activeCallId.current!==sessionId||context.current.clientId!==client.id||context.current.current?.id!==client.companyId)return;
      const background=backgroundFor(clientFor()!);const sources=new Map(background.sources.map(source=>[source.id,source]));for(const source of results)sources.set(source.id,source);
      changeClientBackground({...background,sources:[...sources.values()]});
      if(results.some(source=>source.status==='error'))setBriefError('Some files could not be read. See their source details; paste missing information manually.');
    }catch(cause){setBriefError(cause instanceof Error?cause.message:'The upload could not be read.');}
    finally{setUploadingBackground(false);}
  }
  function finishCall(recordedAt:number,startAnother=false) {
    if(repSpeaking||hearing||turnGate.current.state.repPending||pendingBuyerItems.current.size){setError('Wait for the current transcript to finish before ending the conversation.');return;}
    stopAudio();controller.current?.abort();seq.current++;setThinking(false);setCheckingFacts(false);
    const client=clientFor();if(!client)return;
    const call=activeCallRecord(outcome,recordedAt);
    setError('');notify('Review opened. The call has not been saved yet.');
    setWrapUp(previous=>previous?.callId===call.id?previous:proposeCallWrapUp(call,client));setWrapUpNextCall(startAnother);
  }
  async function createClient(input:{name:string;background:string;contact?:{name:string;kind?:'person'|'main_line';role?:string;email?:string;phone?:string}}) {
    const company=context.current.current;if(!company)throw new Error("Add the selling company first.");
    let client=createClientRecord(company.id,input.name);
    if(input.background)client=updateClientRecord(client,{background:input.background});
    if(input.contact)client=upsertClientContact(client,input.contact);
    updateCompanyBrain(company.id,brain=>({...brain,clients:[...(brain.clients||[]),client],updatedAt:Date.now()}));
    await saveCompanyBrains(manufacturersRef.current.map(ensureCompanyBrain));
    chooseClient(client.id);
  }
  async function changeClientRemoval(clientId:string,removed:boolean) {
    if(!brainHydration.current.ready||brainHydration.current.epoch!==brainReadyEpoch)throw new Error("Client records are still loading. Try again when loading finishes.");
    if(live||connecting)throw new Error("Stop the assistant before removing or restoring a client.");
    const company=context.current.current,client=clientFor(company,clientId);
    if(!company||!client)throw new Error("This client is not part of the selected selling company.");
    const operationKey=company.id+':'+client.id;
    if(clientRemovalOperations.current.has(operationKey))throw new Error("This client is already being updated.");
    if(removed&&context.current.clientId===client.id&&(hasUnfinishedDraft()||callConfigurationRef.current||draft.current.startedAt))throw new Error("Save this client’s unfinished call before removing the client. Your draft is preserved.");
    if((client.removedAt!==undefined)===removed)return;
    const next=setClientRemoved(client,removed),epoch=brainHydration.current.epoch;
    clientRemovalOperations.current.add(operationKey);
    updateCompanyBrain(company.id,brain=>({...brain,clients:(brain.clients||[]).map(item=>item.id===client.id?next:item),updatedAt:Date.now()}));
    try {
      await saveCompanyBrains(manufacturersRef.current.map(ensureCompanyBrain),()=>brainHydration.current.ready&&brainHydration.current.epoch===epoch);
      if(!brainHydration.current.ready||brainHydration.current.epoch!==epoch)throw new Error("The workspace reloaded during this update. Check Removed clients before trying again.");
      if(removed&&context.current.current?.id===company.id&&context.current.clientId===client.id){
        resetActiveCall();savedSessionGuard.current=false;
        context.current.clientId='';context.current.contactId='';context.current.preparation=undefined;context.current.buyer='';
        draft.current={...draft.current,clientId:'',contactId:'',preparation:undefined,buyer:''};
        setActiveClientId('');setActiveContactId('');setReachViaContactId('');context.current.reachViaContactId='';setCallPreparation(undefined);setBuyer('');setShowClientList(true);
      }
      notify(removed?'Client removed from the main list. Saved calls are kept; restore it from Removed clients.':'Client restored. Its contacts and saved calls are available.');
    } catch(cause) {
      if(brainHydration.current.ready&&brainHydration.current.epoch===epoch)updateCompanyBrain(company.id,brain=>({...brain,clients:(brain.clients||[]).map(item=>item.id===client.id&&item.removalUpdatedAt===next.removalUpdatedAt?{...item,removedAt:client.removedAt,removalUpdatedAt:client.removalUpdatedAt}:item),updatedAt:Date.now()}));
      setError(cause instanceof Error?cause.message:'The client could not be updated.');throw cause;
    } finally {clientRemovalOperations.current.delete(operationKey);}
  }
  function addClientUpdate(clientId:string,input:{text:string;at:number;kind:ClientContextEntry['kind'];status:ClientContextEntry['status'];scope:'client'|'contact';contactId?:string;supersedesId?:string}) {
    const entry={...input,source:'rep_update' as const};
    updateClient(clientId,client=>input.supersedesId?supersedeClientEntry(client,input.supersedesId,entry):addClientContextEntry(client,entry));
  }
  function updateClientEntry(clientId:string,entryId:string,status:ClientContextEntry['status'],explanation:string) {
    if(!['completed','resolved','cancelled','superseded'].includes(status))return;
    updateClient(clientId,client=>resolveClientEntry(client,entryId,status as 'completed'|'resolved'|'cancelled'|'superseded',explanation));
  }
  function associateCall(callId:string,clientId:string,contactId?:string) {
    const call=calls.find(item=>item.id===callId),company=manufacturersRef.current.find(item=>item.id===call?.manufacturerId);if(!call||!company)return;
    const next=reassociateClientCall(ensureCompanyBrain(company),calls,callId,{clientId,contactId});
    updateCompanyBrain(company.id,()=>next.brain);setCalls(next.calls);setHistoryClientId(clientId);setSelectedCall(callId);
  }
  function updateCallContext(value:CallContext) {
    // Keep spaces, line breaks and an empty goal while the user edits.
    const locked=callConfigurationRef.current;
    if(locked&&value.stageId!==locked.selectedStageId){notify("This call keeps its selected stage and setup. Start a new call to choose another stage.");return;}
    const nextContext={...value};
    invalidatePreparation();
    context.current.callContext=nextContext;context.current.goal=nextContext.goal;
    setCallContext(nextContext);setGoal(nextContext.goal);
    if(nextContext.relationship==="dormant"){setCallType("reactivation");context.current.callType="reactivation";}
    if(nextContext.stageId!==callContext.stageId)setStageHistory(previous=>[...previous,{stageId:nextContext.stageId,label:normalizeStageMap(current?ensureCompanyBrain(current).playbook.stages:undefined).find(stage=>stage.id===nextContext.stageId)?.name || nextContext.stageId,at:Date.now(),source:"manual"}]);
  }
  function updateCompanyBrain(companyId:string,change:(brain:CompanyBrainRecord)=>CompanyBrainRecord) {
    if(!brainHydration.current.ready||brainHydration.current.epoch!==brainReadyEpoch)return;
    const next=manufacturersRef.current.map(company=>company.id===companyId?{...company,brain:change(ensureCompanyBrain(company))}:company);
    manufacturersRef.current=next;setManufacturers(next);
    if(context.current.current?.id===companyId)context.current.current=next.find(company=>company.id===companyId);
  }
  function openTeaching(call:CallRecord,suggestion?:SuggestionRecord,turnId?:string) {
    setTeachingSelection({companyId:call.manufacturerId,moment:teachingMomentFor(call,suggestion,turnId)});
  }
  function reviewTeaching(company:Manufacturer,id:string) {
    const proposal=ensureCompanyConfiguration(company).teaching?.find(item=>item.id===id);
    if(proposal)setTeachingSelection({companyId:company.id,moment:proposal.moment,proposalId:id});
  }
  function saveTeachingConfiguration(companyId:string,configuration:CompanyConfiguration) {
    if(configuration.companyId!==companyId)throw Error('This feedback belongs to another company.');
    updateCompanyBrain(companyId,brain=>({...brain,configuration,updatedAt:Date.now()}));
  }
  function applyClientTeaching(proposal:TeachingProposal) {
    const company=manufacturersRef.current.find(item=>item.id===proposal.companyId);if(!company)throw Error('Company not found.');
    const next=applyTeachingClientMemory(ensureCompanyBrain(company),proposal,workflowRole);
    updateCompanyBrain(company.id,()=>next);
  }
  function applyTranscriptTeaching(proposal:TeachingProposal) {
    const call=calls.find(item=>item.id===proposal.moment.callId&&item.manufacturerId===proposal.companyId);if(!call)throw Error('Saved call not found.');
    const next=applyTeachingTranscript(call,proposal,workflowRole);
    setCalls(previous=>previous.map(item=>item.id===next.id?next:item));
    updateCompanyBrain(call.manufacturerId,brain=>markCorrectedClientEvidence(brain,next,proposal.correctionTurnId!));
  }
  function captureFor(id:string,snapshot=payload("coach",context.current.turns)):LearningCapture {
    const state=snapshot.conversationState,latest=[...snapshot.turns].reverse().find(turn=>turn.role!=="you")||{id,text:"Opening",at:Date.now()};
    const safeSnapshot=structuredClone(snapshot);delete (safeSnapshot as Record<string,unknown>).preloadedFacts;
    return {companyId:snapshot.manufacturer.id,callId:snapshot.callId,buyer:snapshot.buyer,buyerWindow:snapshot.turns.slice(-16),stageId:state.stageId,moment:state.moment==='general'?fastRouteFor(snapshot).moment:state.moment,callContext:structuredClone(snapshot.callContext),state,prompt:liveRequestInstructionsFor(snapshot,latest),requestContext:safeSnapshot};
  }
  function learnFeedback(id:string,verdict:LearningPair['verdict'],actual='',reason?:EditReason) {
    const company=context.current.current;if(!company)return;
    const record=suggestionsRef.current.find(item=>item.id===id),brain=ensureCompanyBrain(company);
    const capture=brain.learning.find(pair=>pair.suggestionId===id)||record?.learningCapture||captureFor(id);
    const displayed=record&&hasWordingEdit(record)?undefined:activeGuidance.current.id===id?activeGuidance.current.value?.say:undefined;
    updateCompanyBrain(company.id,current=>rateLearning(captureLearning(current,id,record?.originalSay||displayed||record?.guidance.say||'',capture),id,verdict,actual,reason,verdict==='Used'?'used':'edited'));
  }
  async function draftBrainFacts() {
    const company=context.current.current;if(!company)return;setBrainBusy(true);setError("");
    try{const result=await billableJSON<{facts:import("../lib/company-brain").BrainFact[]}>("/api/brain",{mode:"extract",companyId:company.id,manufacturer:{name:company.name,products:company.products},sources:knowledgeFor(company)});const facts=normalizeExtractedFacts(result.facts,knowledgeFor(company));updateCompanyBrain(company.id,brain=>{
      const configuration=startConfigurationDraft(ensureCompanyConfiguration(company,brain)),draft=configuration.draft!;
      const knowledge=[...draft.knowledge,...facts.filter(fact=>!draft.knowledge.some(item=>item.text===fact.text&&item.sourceId===fact.sourceId)).map(fact=>({id:`extracted:${fact.id}`,kind:fact.kind,text:fact.text,sourceId:fact.sourceId,quote:fact.quote,origin:'document' as const,status:'pending_review' as const,updatedAt:Date.now()}))];
      return {...brain,configuration:saveConfigurationDraft(configuration,{...draft,knowledge}),identityFacts:[...brain.identityFacts.filter(f=>f.confirmed),...facts.filter(f=>!brain.identityFacts.some(old=>old.confirmed&&old.text===f.text))],builder:{...brain.builder,factsDraftedAt:Date.now()},updatedAt:Date.now()};
    });notify(`${facts.length} cited fact drafts added. Confirm or correct them in the Brain.`);}catch(error){setError(error instanceof Error?error.message:"Brain draft failed.");}finally{setBrainBusy(false);}
  }
  async function promoteBrainPair(pair:LearningPair) {
    const company=context.current.current;if(!company||pair.companyId!==company.id)return;
    if(!learningRisk(pair.actual)){updateCompanyBrain(company.id,brain=>promoteLearning(brain,pair.id));return;}
    setBrainBusy(true);setError("");try{const result=await billableJSON<{supported:boolean;evidence:{sourceId:string;quote:string}[];reason:string}>("/api/brain",{mode:"verify_example",companyId:company.id,manufacturer:{name:company.name,products:company.products},sources:knowledgeFor(company),line:pair.actual});if(!result.supported){setError("Example remains in review: "+result.reason);return;}updateCompanyBrain(company.id,brain=>promoteLearning(brain,pair.id,result.evidence));}catch(error){setError(error instanceof Error?error.message:"Example verification failed.");}finally{setBrainBusy(false);}
  }
  function saveManagerDecisions(call:CallRecord,decisions:DecisionItem[]) {
    if(workflowRole!=='manager'){notify('A manager must review these decisions.');return;}
    const updated={...call,decisionsNeeded:decisions};setCalls(previous=>previous.map(item=>item.id===call.id?updated:item));
    updateCompanyBrain(call.manufacturerId,brain=>recordDecisions(updated.clientId?attachCallToClient(brain,updated,{clientId:updated.clientId,contactId:updated.contactId}):brain,updated));
  }
  function clearActiveSuggestion(id:string) {
    if(activeGuidance.current.id!==id || !activeGuidance.current.value)return;
    activeGuidance.current={id:"",value:null};setGuidanceId("");setGuidance(null);setLiveDraft(false);setPendingBuyerText("");
  }
  function feedbackEntries(previous:SuggestionRecord[],id:string,active:typeof activeGuidance.current):SuggestionRecord[] {
    if(active.id!==id || !active.value)return previous;
    const saved=previous.find(item=>item.id===id);
    if(saved)return hasWordingEdit(saved)?previous:upsertSuggestion(previous,{...saved,guidance:active.value});
    return [...previous,{id,at:guidanceAt || Date.now(),guidance:active.value,status:"suggested",bilingual:context.current.bilingual,buyerQuote:active.value.questionEcho,sourceSnapshot:[]}];
  }
  function archiveSuggestion(id:string,reason:"used"|"spoken"|"ignored",actualText?:string) {
    const actualIds=actualText ? context.current.turns.filter(turn=>turn.role==="you"&&turn.text===actualText).map(turn=>turn.id) : [];
    setSuggestions(previous=>recordSuggestionSpeech(previous,id,reason,actualText,actualIds));
    // Audio callbacks outlive the render that connected the call.
    const record=suggestionsRef.current.find(item=>item.id===id);
    if(actualText&&record&&context.current.current){const company=context.current.current;updateCompanyBrain(company.id,brain=>{
      const old=brain.learning.find(pair=>pair.suggestionId===id);return old?.verdict==='unrated'?rateLearning(brain,id,reason==='ignored'?'Ignored':actualText.toLowerCase()===record.guidance.say.toLowerCase()?'Used':'Edited',actualText,undefined,'speech'):brain;
    });}
    clearActiveSuggestion(id);
  }
  function feedbackSuggestion(id:string,status:"used"|"ignored") {
    const active={...activeGuidance.current};
    learnFeedback(id,status==="used"?"Used":"Ignored");
    // Save the user's choice even when a live session has already retired this row.
    setSuggestions(previous=>applySuggestionFeedback(feedbackEntries(previous,id,active),id,status));
    if(active.id!==id || !active.value)return;
    if(liveSession.current){if(status==="ignored")liveSession.current.markIgnored(id);else liveSession.current.markUsed(id);}
    else if(status==="ignored"){controller.current?.abort();seq.current++;setThinking(false);setCheckingFacts(false);}
    else manualReplyRetired.current.add(id);
    clearActiveSuggestion(id);
  }
  function saveReplyEdit(id:string,text:string,rememberVoice:boolean,reason?:EditReason) {
    const edited=text.trim().slice(0,600);if(!edited)return;
    manualReplyEdits.current.set(id,edited);
    learnFeedback(id,"Edited",edited,reason);
    const active={...activeGuidance.current};
    setSuggestions(previous=>applySuggestionFeedback(feedbackEntries(previous,id,active),id,"edited",edited));
    if(active.id===id && active.value){
      const value={...active.value,say:edited,verified:false,verificationStatus:'pending' as const,evidence:[]};
      activeGuidance.current={id,value};setGuidance(value);setLiveDraft(false);
    }
    void rememberVoice;
    notify('Edit saved. Use Teach the copilot in call review to propose a company guidance change.');
  }
  function rememberGuidance(value:Guidance,id=uid(),triggerTurnId?:string,captured?:LearningCapture) {
    const stageId=callConfigurationRef.current?.selectedStageId || value.stageId || context.current.currentStage;
    const label=value.stage || stageLabel(stageId,context.current.bilingual);
    if(value.phase!=="bridge"){setCurrentStage(stageId);setStageHistory(previous=>previous.at(-1)?.stageId===stageId ? previous : [...previous,{stageId,label,at:Date.now(),turnId:triggerTurnId,source:"ai"}]);}
    const library=callConfigurationRef.current?configurationReferences(callConfigurationRef.current.snapshot):context.current.current ? knowledgeFor(context.current.current) : [];
    const capture=captured||captureFor(id);
    const company=context.current.current;if(company)updateCompanyBrain(company.id,brain=>captureLearning(brain,id,value.say,capture));
    const entry:SuggestionRecord={id,triggerTurnId,learningPairId:`${capture.companyId}:${id}`,buyerQuote:value.questionEcho || context.current.turns.find(turn=>turn.id===triggerTurnId)?.text,at:Date.now(),guidance:value,status:"suggested",pending:false,bilingual:context.current.bilingual,sourceSnapshot:value.evidence.map(e=>({id:e.sourceId,title:library.find(s=>s.id===e.sourceId)?.title || "Company knowledge",text:e.quote}))};
    setSuggestions(previous=>upsertSuggestion(previous,entry));
    setMissingKnowledge(previous=>{
      const next=[...previous];for(const fact of value.missing)if(!next.some(m=>m.fact.toLowerCase().trim()===fact.toLowerCase().trim()))next.push({id:uid(),fact,at:Date.now(),turnId:triggerTurnId,status:"open"});return next;
    });
  }
  function changeStage(stageId:string) {
    if(callConfigurationRef.current){notify("This call keeps its selected stage. Start a new call to choose another stage.");return;}
    updateCallContext({...context.current.callContext,stageId});
    setCurrentStage(stageId);setStageHistory(previous=>[...previous,{stageId,label:stageLabel(stageId,bilingual),at:Date.now(),source:"manual"}]);
  }
  function recordCharges(charges:UsageEntry[],countCall=true) {
    const state=spendState.current; let entries=[...state.entries],delta=0;
    for(const charge of charges) {
      if(typeof charge.id!=="string" || !Number.isFinite(charge.usd) || charge.usd<0 || !Number.isFinite(charge.at))continue;
      const previous=entries.find(e=>e.id===charge.id);
      if(previous && previous.usd>=charge.usd)continue;
      if(previous)entries=entries.map(e=>e.id===charge.id ? charge : e); else entries.push(charge);
      if(countCall && charge.kind!=="document")delta+=charge.usd-(previous?.usd || 0);
    }
    spendState.current={...state,entries,callUsd:state.callUsd+delta}; setUsageEntries(entries);setCallCostUsd(state.callUsd+delta);
    const decision=budgetDecision(state.budget,state.callUsd+delta,entries);
    if(!decision.allowed && peer.current) {stopAudio();setError(decision.reason+" The AI assistant stopped; your phone call can continue.");}
  }
  async function billableJSON<T>(path:string,body?:unknown,signal?:AbortSignal):Promise<T> {
    const generation=callGeneration.current;
    const state=spendState.current, document=path==="/api/extract" || path==="/api/drive", afterCall=path==="/api/packet";
    const decision=budgetDecision(document || afterCall ? {...state.budget,perCallUsd:Number.MAX_VALUE} : state.budget,document || afterCall ? 0 : state.callUsd,state.entries,path==="/api/research" ? .08 : document ? .1 : .02);
    if(!decision.allowed)throw new Error(decision.reason+" Adjust limits in Connection & audio to continue.");
    return requestJSON<T>(path,body,signal,charges=>recordCharges(charges,!afterCall && generation===callGeneration.current && (body as {mode?:string}|undefined)?.mode!=="summary"));
  }
  function getTranslationQueue() {
    if(translationQueue.current)return translationQueue.current;
    translationQueue.current=new BuyerTranslationQueue({
      isEnabled:()=>translationState.current.enabled && Boolean(translationState.current.configured) && translationState.current.hydrated,
      isCurrent:job=>[context.current.turns,...translationState.current.calls.map(call=>call.turns)].some(list=>list.some(turn=>turn.id===job.id && turn.text===job.text && canTranslateTurn(turn))),
      onPending:jobs=>setTranslationPending(jobs),
      onError:(jobs,error)=>setTranslationErrors(previous=>{
        const next={...previous};for(const job of jobs)next[job.id]={text:job.text,message:error instanceof Error ? error.message : "Translation is unavailable. Retry this line."};return next;
      }),
      onResult:translations=>{
        const next=applyBuyerTranslations(context.current.turns,translations);
        if(next!==context.current.turns){context.current.turns=next;setTurns(next);}
        setCalls(previous=>previous.map(call=>{const translated=applyBuyerTranslations(call.turns,translations);return translated===call.turns ? call : {...call,turns:translated};}));
      },
      translate:async(jobs,signal)=>{
        const generation=jobs[0].generation,state=spendState.current;
        const saved=translationState.current.calls.find(call=>call.turns.some(turn=>jobs.some(job=>job.id===turn.id)));
        const decision=budgetDecision(state.budget,generation===callGeneration.current ? state.callUsd : saved?.estimatedCostUsd || 0,state.entries,.02);
        if(!decision.allowed)throw new Error(decision.reason+" Adjust spending limits, then retry the translation.");
        const result=await requestJSON<{translations:TranslatedTurn[]}>("/api/translate",{turns:jobs.map(job=>({id:job.id,text:job.text,context:job.context}))},signal,charges=>{
          const currentCall=generation===callGeneration.current;
          recordCharges(charges,currentCall);
          if(!currentCall){const cost=charges.reduce((sum,charge)=>sum+charge.usd,0);setCalls(previous=>previous.map(call=>call.turns.some(turn=>jobs.some(job=>job.id===turn.id)) ? {...call,estimatedCostUsd:(call.estimatedCostUsd || 0)+cost} : call));}
        });
        return result.translations;
      },
    });
    return translationQueue.current;
  }
  function queueBuyerTranslations(conversation:Turn[],priority:"live"|"background"="live") {
    if(!translationState.current.enabled || !translationState.current.configured || !translationState.current.hydrated)return;
    const generation=callGeneration.current;
    getTranslationQueue().enqueue(buildTranslationTurns(context.current.turns,conversation.filter(turn=>canTranslateTurn(turn) && !turn.translationZh)).map(turn=>({...turn,generation,scope:`draft-${generation}`,priority})));
  }
  function retryTranslation(turn:Turn,savedCall?:CallRecord) {
    setTranslationErrors(previous=>{const next={...previous};delete next[turn.id];return next;});
    const generation=savedCall ? -1 : callGeneration.current;
    getTranslationQueue().retry({...buildTranslationTurns(savedCall?.turns||context.current.turns,[turn])[0],generation,scope:savedCall ? `saved-${savedCall.id}` : `draft-${generation}`});
  }
  function translationLine(turn:Turn,savedCall?:CallRecord) {
    if(!translateBuyer)return null;
    const error=translationErrors[turn.id];
    return <BuyerTranslation turn={turn} pending={translationPending.some(job=>job.id===turn.id && job.text===turn.text)} error={error?.text===turn.text ? error.message : undefined} onRetry={()=>retryTranslation(turn,savedCall)}/>;
  }
  function translationToggle() { return <label className="translation-toggle"><input type="checkbox" aria-label="Translate buyer messages into Mandarin" checked={translateBuyer} onChange={event=>setTranslateBuyer(event.target.checked)}/><span>中文翻译</span></label>; }
  // Fresh stage, language, voice and Brain data travel with each response.create.
  // Replacing session instructions on every stage change duplicated the call and slowed setup.
  function openModal(value: Modal) {
    setError(""); setModal(value);
    if (value?.type === "manufacturer") { setFormName(value.manufacturer?.name || ""); setFormProducts(value.manufacturer?.products || ""); setFormText(value.manufacturer?.introduction || ""); }
    else { setFormName(value?.source?.title || ""); setFormText(value?.source?.text || ""); }
  }
  async function copy(text: string) { try { await navigator.clipboard.writeText(text); notify("Copied to clipboard"); } catch { setError("Copy was unavailable. Select the text and copy it manually."); } }
  function pinCallConfiguration() {
    const company=context.current.current;if(!company)return;
    const binding=bindCompanyConfiguration(company,context.current.callContext.stageId,callConfigurationRef.current);
    const stage=binding.snapshot.stages.find(item=>item.id===binding.selectedStageId)!;
    const nextContext={...context.current.callContext,stageId:stage.id,goal:stage.objective};
    context.current.callContext=nextContext;context.current.goal=stage.objective;context.current.currentStage=stage.id;
    setCallContext(nextContext);setGoal(stage.objective);setCurrentStage(stage.id);
    callConfigurationRef.current=binding;setCallConfiguration(binding);return binding;
  }
  function previewCallConfiguration(company:Manufacturer) {
    const prior=callConfigurationRef.current;
    if(prior?.companyId===company.id)return prior;
    const config=ensureCompanyConfiguration(company),selected=config.active.stages.find(stage=>stage.id===context.current.callContext.stageId&&!stage.retired)||config.active.stages.find(stage=>!stage.retired);
    return selected?bindCompanyConfiguration(company,selected.id,undefined,0):undefined;
  }
  // Passive context never retrieves coaching examples or composes candidate wording.
  // Full foundation/learning retrieval belongs to an explicit request in payload().
  function observationPayload(conversation: Turn[]) {
    const manufacturer=context.current.current||{id:"general",name:"Your company",products:"",introduction:"",sources:[]};
    const actual=conversation.filter(turn=>!isTranscriptionPromptEcho(turn.text));
    const companyConfiguration=manufacturer.id==='general'?undefined:previewCallConfiguration(manufacturer);
    const stageMap=companyConfiguration?configurationStageMap(companyConfiguration.snapshot,{includeRetired:true}):ensureCompanyBrain(manufacturer).playbook.stages;
    const callContext={...context.current.callContext,...companyConfiguration?{stageId:companyConfiguration.selectedStageId}:{}};
    const clientContext=context.current.preparation?.reviewedAt?buildClientCoachingContext(context.current.preparation):undefined;
    const observed=applyCoachingConfiguration({callId:activeCallId.current,companyConfiguration,clientContext,callContext,stageMap,manufacturer:{id:manufacturer.id,name:manufacturer.name,products:manufacturer.products},sources:selectKnowledge(knowledgeFor(manufacturer),manufacturer.products),buyer:context.current.buyer,goal:context.current.goal,callType:context.current.callType,bilingual:context.current.bilingual,turns:actual.slice(-300).map(turn=>({id:turn.id,at:turn.at,role:turn.role,text:turn.text.slice(0,6000),...turn.transcriptionUncertainty?{transcriptionUncertainty:turn.transcriptionUncertainty}:{}}))});
    return {...observed,conversationState:deriveConversationState(observed)};
  }
  function payload(mode: string, conversation: Turn[], manufacturer = context.current.current, targetBuyer = context.current.buyer, targetGoal = context.current.goal) {
    manufacturer ||= {id:"general",name:"Your company",products:"",introduction:"",sources:[]};
    const actual=conversation.filter(turn=>!isTranscriptionPromptEcho(turn.text));
    const query=actual.slice(-5).map(t=>t.text).join(" ")+" "+manufacturer.products+" "+context.current.callContext.background+" "+context.current.callContext.knownFacts;
    const companyBrain=ensureCompanyBrain(manufacturer),companyConfiguration=manufacturer.id==='general'?undefined:previewCallConfiguration(manufacturer);
    const stageMap=companyConfiguration?configurationStageMap(companyConfiguration.snapshot,{includeRetired:true}):companyBrain.playbook.stages;
    const selectedContext={...context.current.callContext,...companyConfiguration?{stageId:companyConfiguration.selectedStageId}:{}};
    const callId=activeCallId.current||(activeCallId.current=uid());
    const conversationState=deriveConversationState({callId,turns:actual,callContext:selectedContext,stageMap,companyConfiguration});
    const foundationPlaybook=generalPlaybookRef.current.foundation;
    const foundation=generationFoundationFor({manufacturer,callContext:selectedContext,conversationState,turns:actual,callType:context.current.callType,foundationPlaybook,companyConfiguration});
    const clientContext=context.current.preparation?.reviewedAt?buildClientCoachingContext(context.current.preparation):undefined;
    const brain=buildBrainRequest(manufacturer,targetBuyer,conversationState,actual,foundation.momentType as import("../lib/learning-loop").LearningMomentType,clientContext),choice=openingChoicesRef.current[manufacturer.id];
    if(choice)brain.defaultOpening=choice.mode==='custom'?normalizeOpening(choice.text)||undefined:undefined;
    return applyCoachingConfiguration({mode,callId,companyConfiguration,clientContext,foundation,foundationPlaybook,generalPlaybook:buildGeneralPlaybookRequest(generalPlaybookRef.current,{company:manufacturer,state:conversationState,turns:actual}),brain,conversationState,callContext:selectedContext,stageMap,exampleLines:companyBrain.playbook.examples.slice(-200),manufacturer:{id:manufacturer.id,name:manufacturer.name,products:manufacturer.products},sources:selectKnowledge(knowledgeFor(manufacturer),query),buyer:targetBuyer,goal:targetGoal,voice:{...context.current.voice,examples:generalStyleExamples(context.current.voice.examples),avoid:[...context.current.voice.avoid,...companyBrain.rules.phrasesToAvoid.split("\n").filter(Boolean).map(phrase=>phrase.slice(0,100))].slice(-20)},callType:context.current.callType,bilingual:context.current.bilingual,currentStage:conversationState.stageId,buyerBrief:mode==="summary"?null:context.current.buyerBrief,recentReplies:recentReplies.current.slice(-12),turns:actual.slice(-300).map(t=>({id:t.id,at:t.at,role:t.role,text:t.text.slice(0,6000),...t.transcriptionUncertainty?{transcriptionUncertainty:t.transcriptionUncertainty}:{}}))});
  }
  function requestNextMove() {
    if(queuedRequest)return;
    const buttonStartedAt=performance.now(),requestedAt=Date.now();
    if(!configured){setError("The AI connection is not ready. Check Connection & audio.");return;}
    if(!ensurePreparationReviewed())return;
    try{pinCallConfiguration();}catch(error){setError(error instanceof Error?error.message:"Choose a sales stage before coaching.");return;}
    const id=uid();
    const buyerSpeech=liveSession.current?.observedSpeechSnapshot()||{partials:[],pendingSpeech:[]};
    const repSpeech=repAudio.current?.observedSpeechSnapshot()||{partials:[],pendingSpeech:[]};
    const snapshot=snapshotCoachingContext({...payload("coach",context.current.turns),coachingRequest:{id,requestedAt,preparationMs:0} as CoachingRequest},{partials:[...buyerSpeech.partials,...repSpeech.partials],pendingSpeech:[...buyerSpeech.pendingSpeech,...repSpeech.pendingSpeech]});
    snapshot.coachingRequest.preparationMs=performance.now()-buttonStartedAt;
    const spend=spendState.current,decision=budgetDecision(spend.budget,spend.callUsd,spend.entries,.02);
    if(!decision.allowed){setError(decision.reason);return;}
    // An early live request follows the current buyer turn until it is ready.
    // Once generation starts, one frozen snapshot owns the displayed wording.
    controller.current?.abort();seq.current++;
    const prior={...activeGuidance.current};
    if(prior.id)setSuggestions(previous=>previous.map(item=>item.id===prior.id&&item.status==='suggested'?{...item,guidance:prior.value||item.guidance,status:'superseded',pending:false}:item));
    setError("");setLiveTiming(undefined);setCheckingFacts(false);setLiveDraft(false);setThinking(true);setPendingBuyerText("");
    if(liveSession.current&&channel.current?.readyState==='open'){
      setManualTrace(null);
      liveSession.current.requestNextMove(snapshot as LiveContext);
    } else void coach(snapshot);
  }
  function suggestNow() {
    liveSession.current?.suggestNow();
  }
  function cancelQueuedCoaching() {
    if(liveSession.current?.cancelQueuedRequest()){
      setQueuedRequest(null);setThinking(false);setPendingBuyerText("");
    }
  }
  function retainRequestTrace(event:import('../lib/coaching-request-trace').CoachingRequestTrace) {
    setSuggestions(previous=>{
      const prior=previous.find(item=>item.id===event.suggestionId);
      const row:SuggestionRecord=prior||{id:event.suggestionId,triggerTurnId:event.requestId,at:event.at,guidance:{say:'',ask:'',intent:'',nextStep:'',caution:'',evidence:[],missing:[]},status:'suggested',bilingual:context.current.bilingual,pending:false,sourceSnapshot:[]};
      return upsertSuggestion(previous,{...row,...event.event==='failed'?{pending:false,buyerQuote:event.focus?.displayText||row.buyerQuote}:{},coachingTrace:[...(row.coachingTrace||[]),structuredClone(event)]});
    });
  }
  function retainCoachingIssue(event:{suggestionId:string;at:number;status:'rejected'|'unavailable'|'correction';originalSay:string;reason:string;correction?:string;context?:unknown;turnId?:string}) {
    const issueId=`${event.suggestionId}:validation:${event.at}`;
    const pinned=event.context as ReturnType<typeof payload>|undefined;
    const guidance:Guidance={say:event.originalSay,ask:'',intent:'',nextStep:'',caution:event.reason,evidence:[],missing:[],verified:false,verificationStatus:event.status==='rejected'?'rejected':'unavailable',analysisReady:true,scriptComplete:false};
    setSuggestions(previous=>upsertSuggestion(previous,{id:issueId,at:event.at,triggerTurnId:event.turnId,guidance,status:'ignored',bilingual:false,pending:false,sourceSnapshot:[],coachingIssue:{status:event.status,reason:event.reason,correction:event.correction},...pinned?{learningCapture:captureFor(issueId,pinned)}:{}}));
  }
  async function coach(snapshot:ReturnType<typeof payload> & {coachingRequest:CoachingRequest}) {
    controller.current?.abort();const aborter=new AbortController();controller.current=aborter;
    const id=++seq.current,generation=callGeneration.current,replyId=`request-${snapshot.coachingRequest.id}`;
    const buyerTurn=[...snapshot.turns].reverse().find(turn=>turn.role!=="you"),echo=coachingRequestFocus(snapshot).displayText||buyerTurn?.text||(snapshot.turns.length?"Conversation so far":"Opening");
    const submittedAt=snapshot.coachingRequest.requestedAt;
    setManualTrace({replyId,submittedAt,preparationMs:snapshot.coachingRequest.preparationMs,model:"Connecting…",source:"real_model"});
    setThinking(true);setCheckingFacts(false);setError("");setPendingBuyerText("");
    let candidate:Guidance|null=null,checked=false;
    const present=(value:Guidance,complete:boolean,persist:boolean)=>{
      if(id!==seq.current||generation!==callGeneration.current)return;
      if(manualReplyEdits.current.has(replyId))return;
      if(candidate?.verified&&candidate.say!==value.say){
        retainCoachingIssue({suggestionId:replyId,at:Date.now(),status:'correction',originalSay:candidate.say,correction:value.say,reason:'A later check proposed a correction. The ready wording was not replaced.',context:snapshot});return;
      }
      const firstDisplay=!candidate;
      const next:Guidance={...value,questionEcho:echo,phase:"answer",analysisReady:complete};
      candidate=next;
      // An editable streamed row must outlive active guidance. Keep its original
      // call snapshot before another explicit request can supersede the generation.
      if(firstDisplay){const learningCapture=captureFor(replyId,snapshot);setSuggestions(previous=>upsertSuggestion(previous,{id:replyId,at:submittedAt,triggerTurnId:buyerTurn?.id,guidance:next,status:"suggested",bilingual:snapshot.bilingual,buyerQuote:echo,sourceSnapshot:[],learningCapture}));}
      if(!manualReplyRetired.current.has(replyId)){activeGuidance.current={id:replyId,value:next};setGuidanceId(replyId);setGuidanceAt(submittedAt);setGuidance(next);setThinking(!complete);setLiveDraft(!complete);setPendingBuyerText("");if(firstDisplay)setLatency(Date.now()-submittedAt);}
      if(persist)rememberGuidance(next,replyId,buyerTurn?.id,captureFor(replyId,snapshot));
    };
    try {
      const spend=spendState.current,decision=budgetDecision(spend.budget,spend.callUsd,spend.entries,.02);if(!decision.allowed)throw new Error(decision.reason);
      const response=await fetch("/api/coach/stream",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(snapshot),signal:aborter.signal});
      await readManualStream(response,event=>{
        if(event._charges)recordCharges(event._charges,generation===callGeneration.current);
        if(id!==seq.current||generation!==callGeneration.current)return;
        if(event.timing?.phases)setManualTrace(trace=>trace?{...trace,serverPhases:event.timing!.phases}:trace);
        if(event.guidance)setManualTrace(trace=>trace?{...trace,lastDisplayEventAt:Date.now()}:trace);
        if(event.requestedServiceTier)setManualTrace(trace=>trace?{...trace,requestedServiceTier:event.requestedServiceTier}:trace);
        if(event.serviceTier)setManualTrace(trace=>trace?{...trace,serviceTier:event.serviceTier}:trace);
        if(event.model)setManualTrace(trace=>trace?{...trace,model:event.model!}:trace);
        if(event.type==="start")setManualTrace(trace=>trace?{...trace,model:event.model||"Unknown",source:event.source||"real_model"}:trace);
        // Unchecked provider prefixes are never displayed as ready wording.
        if(event.type==="suggestion_complete"&&event.guidance?.verified){if(!checked)present(event.guidance,true,true);setLiveDraft(false);setCheckingFacts(false);setManualTrace(trace=>trace?{...trace,complete:true}:trace);}
        if(event.type==="verification_complete"&&event.guidance){
          const editProtected=manualReplyEdits.current.has(replyId);checked=true;
          if(event.guidance.verified)present(event.guidance,true,true);
          else retainCoachingIssue({suggestionId:replyId,at:Date.now(),status:event.guidance.verificationStatus==='rejected'?'rejected':'unavailable',originalSay:event.guidance.say,reason:event.guidance.caution||'The source check did not establish this wording.',context:snapshot});
          setCheckingFacts(false);setLiveDraft(false);
          setManualTrace(trace=>trace?{...trace,complete:true,verified:event.guidance?.verified===true,verificationMs:trace.verificationMs??Date.now()-submittedAt,replaced:!!event.replaced&&!editProtected,serverVerificationMs:event.timing?.verificationFinishedMs}:trace);
          if(event.replaced){const replacement={at:Date.now(),originalSay:event.originalSay||candidate?.say||"",replacementSay:event.guidance.say,reason:"Manual draft changed before ready publication",originalWasDisplayed:false};setSuggestions(previous=>recordVerificationReplacement(previous,replyId,replacement));}
        }
        if(event.type==='self_check_rejected')retainCoachingIssue({suggestionId:replyId,at:Date.now(),status:'rejected',originalSay:event.rejectedSay||'',reason:(event.reasons||[]).join(' '),context:snapshot});
        if(event.type==="error")throw new Error(event.error||event.message||"Manual suggestion could not finish.");
      });
      if(!candidate)throw new Error("The AI returned no suggested reply.");
      if(id===seq.current&&generation===callGeneration.current)recentReplies.current=[...recentReplies.current,(candidate as Guidance).say].slice(-12);
    } catch(error){if(!aborter.signal.aborted&&id===seq.current)setError(error instanceof Error?error.message:"Could not generate guidance.");}
    finally{if(id===seq.current){setThinking(false);setLiveDraft(false);setCheckingFacts(false);}}
  }
  function addTurn(text: string, role: Turn["role"], id = uid(), at = Date.now(), transcriptionUncertainty?:Turn["transcriptionUncertainty"]) {
    if (!text.trim()) return;
    const existing = context.current.turns;
    const next = existing.some(t => t.id === id) ? existing.map(t => t.id === id ? { ...t, text:text.trim(),translationZh:t.text===text.trim() ? t.translationZh : undefined } : t) : [...existing, { id, text:text.trim(), role, at,...transcriptionUncertainty?{transcriptionUncertainty}:{} }].sort((a,b) => a.at-b.at);
    context.current.turns = next; setTurns(next); if (!draft.current.startedAt) setStartedAt(Date.now());
    queueBuyerTranslations(next.filter(turn=>turn.id===id));
    // Listening and typed additions only update context, never coaching or feedback.
  }
  function correctTurnSpeaker(id:string,role:Turn['role']) {
    const next=context.current.turns.map(item=>item.id===id?{...item,role}:item);
    context.current.turns=next;setTurns(next);
    queueBuyerTranslations(next.filter(item=>item.id===id));translationQueue.current?.kick();
    // Keep the current request's frozen snapshot; the next request uses the correction.
  }
  function submitManual(e: React.FormEvent) {
    e.preventDefault(); const text=manualText.trim(); if (!text||!ensurePreparationReviewed()) return;
    const dc=channel.current;
    if (live && dc?.readyState === "open") {
      const typedId=uid();addTurn(text,manualRole,typedId,Date.now());
      const speaker=manualRole === "you" ? "The representative actually said" : manualRole === "buyer" ? "The buyer said" : "Additional call transcript";
      dc.send(JSON.stringify({type:"conversation.item.create",item:{type:"message",role:"user",content:[{type:"input_text",text:`${speaker}: ${text}`}]}}));
      const typedTurn={id:typedId,text,at:context.current.turns.find(turn=>turn.id===typedId)?.at || Date.now()};
      if(manualRole==="you")liveSession.current?.acceptRepresentative(typedTurn);
      else {if(manualRole==="buyer")liveSession.current?.confirmBuyerAudio();liveSession.current?.acceptBuyer(typedTurn);}
    } else addTurn(text,manualRole);
    setManualText("");
  }
  function stopAudio() {
    setQueuedRequest(null);
    englishGuard.current?.stop();englishGuard.current=null;
    if(peer.current && (pendingBuyerItems.current.size || turnGate.current.state.buyerSpeaking || turnGate.current.state.repSpeaking || (turnGate.current.state.repPending && repAudio.current)))markCaptureWarning("Audio stopped before all speech was transcribed. Final words may be missing; check and add them manually before relying on the packet.");
    liveSession.current?.stop();liveSession.current=null;setBuyerAudioIssue(null);setPendingBuyerText("");audioGeneration.current++;captureBusy.current=false;turnGate.current.pause(true);channel.current=null;repAbort.current?.abort();repAbort.current=null;repAudio.current?.stop();repAudio.current=null;turnGate.current.reset();setRepSpeaking(false);setRepPartial("");setRepLevel(0);setCheckingFacts(false);pendingBuyerItems.current.clear();
    const pc = peer.current; peer.current = null; channel.current = null; pc?.close();
    const handle=callHandle.current;callHandle.current="";if(handle)void fetch("/api/session/stop",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({handle}),keepalive:true}).catch(()=>{});
    stream.current?.getTracks().forEach(track => track.stop()); stream.current = null;
    rawStream.current?.getTracks().forEach(track => track.stop()); rawStream.current = null; gainNode.current = null;
    void audioContext.current?.close(); audioContext.current = null; cancelAnimationFrame(frame.current);
    if (testTimer.current) clearTimeout(testTimer.current); if (stopTimer.current) clearTimeout(stopTimer.current);
    setLive(false); setConnecting(false); setPaused(false); setThinking(false); setPartial(""); setHearing(false); setLevel(0); setMicTest(false);
  }
  function ensureAudioCurrent(generation: number) { if (generation !== audioGeneration.current) throw new DOMException("Audio setup was cancelled.","AbortError"); }
  function audioFailureMessage(failure:unknown,fallback:string):string {
    setCaptureDiagnostic(failure instanceof ComputerAudioCaptureError?failure:null);
    return failure instanceof Error?failure.message:fallback;
  }
  function recordLiveReplyPaint(id:string,say:string,full:boolean,atMs:number) {
    const session=liveSession.current;if(!session||!id.startsWith('coaching-')&&!id.startsWith('buyer-reply-'))return;
    const entry=suggestionsRef.current.find(item=>item.id===id);
    if(!entry&&activeGuidance.current.id!==id)return;
    if(entry&&hasWordingEdit(entry))return;
    const turnId=id.startsWith('coaching-')?id.slice('coaching-'.length):entry?.triggerTurnId||id.slice('buyer-reply-'.length);
    const timing=session.recordReplyPaint(turnId,say,full,atMs);if(!timing)return;
    if(activeGuidance.current.id===id)setLiveTiming(timing);
    setSuggestions(previous=>previous.map(item=>item.id===id?{...item,latencyBreakdown:{verificationRequired:false,status:'not_required',...item.latencyBreakdown,acousticLatency:timing,...timing.requestedAtMs!==undefined&&isUsableCoachingWording(say,full)&&item.latencyBreakdown?.firstUsableMs===undefined?{firstUsableMs:atMs-timing.requestedAtMs}:{},...full&&item.latencyBreakdown?.phases?.stableSuggestionMs!==undefined&&(item.latencyBreakdown?.stableSuggestionMs===undefined||item.latencyBreakdown?.acousticLatency?.fullSay!==say)?{stableSuggestionMs:atMs-(timing.requestedAtMs??atMs)}:{}}}:item));
  }
  async function captureAudio(generation: number) {
    if (!navigator.mediaDevices) throw new Error("Audio access needs a secure browser window. Open this local app in an up-to-date Google Chrome.");
    let ms: MediaStream;
    try { ms = audioMode === "computer" ? await captureComputerAudio(navigator.mediaDevices) : await navigator.mediaDevices.getUserMedia({audio:microphoneConstraints(audioMode,deviceId)}); }
    catch (e) { if (e instanceof DOMException && e.name === "OverconstrainedError") throw new Error("That microphone is no longer available. Choose another input or System default."); throw e; }
    if (generation !== audioGeneration.current) { ms.getTracks().forEach(t => t.stop()); ensureAudioCurrent(generation); }
    rawStream.current = ms;
    const ctx = new AudioContext(); audioContext.current = ctx; await ctx.resume(); ensureAudioCurrent(generation);
    const pipeline = audioMode==="computer"?createComputerAudioPipeline(ctx,ms,inputGain):createMicrophonePipeline(ctx,ms,inputGain); gainNode.current = pipeline.gain; stream.current = pipeline.stream;
    const track = ms.getAudioTracks()[0], settings = track.getSettings();
    for (const inputTrack of ms.getTracks()) inputTrack.addEventListener("ended",() => { if (generation === audioGeneration.current) { stopAudio(); setError(audioMode === "computer" ? "Computer audio sharing ended. Share system audio again to reconnect the assistant. Your phone call can continue." : "The microphone disconnected. Choose an available input, then reconnect the assistant."); } },{once:true});
    setActiveInput(track.label || (audioMode === "computer" ? "Shared computer audio" : "Selected microphone"));
    setInputDetails(audioMode === "computer" ? "Filtered buyer audio · Separate You microphone · No screen frames sent" : `Echo removal ${settings.echoCancellation ? "on" : "off"} · Noise cleanup ${settings.noiseSuppression ? "on" : "off"}`);
    const data = new Float32Array(pipeline.analyser.fftSize); let last = 0,lastSignal = 0;
    const tick = (at: number) => {
      if(at-lastSignal>30){
        pipeline.analyser.getFloatTimeDomainData(data);const reading=audioSignal(data);lastSignal=at;
        if(audioMode==='computer')liveSession.current?.noteBuyerSignal(reading.db>-48,at,30+data.length/ctx.sampleRate*1000);
        if(at-last>100){setLevel(reading.level);setSignal(reading.signal);setDecibels(reading.db);last=at;}
      }
      frame.current = requestAnimationFrame(tick);
    }; frame.current = requestAnimationFrame(tick);
    if (audioMode !== "computer") { const inputs = await navigator.mediaDevices.enumerateDevices(); ensureAudioCurrent(generation); setDevices(inputs.filter(d => d.kind === "audioinput")); }
    return pipeline.stream;
  }
  async function startListening() {
    if (captureBusy.current || live || connecting || micTest) return;
    if (!configured) { setError("The AI connection is not ready. Check Connection & audio."); return; }
    if(!ensurePreparationReviewed())return;
    const limit=budgetDecision(spendState.current.budget,spendState.current.callUsd,spendState.current.entries,.03);
    if(!limit.allowed) {setError(limit.reason+" Adjust limits in Connection & audio to continue.");return;}
    const generation = ++audioGeneration.current; captureBusy.current=true;
    setError("");setCaptureDiagnostic(null);setBuyerAudioIssue(null);setLiveTiming(undefined); setConnecting(true);turnGate.current.reset();repAbort.current=new AbortController();
    try {
      pinCallConfiguration();
      const ms = await captureAudio(generation); ensureAudioCurrent(generation);
      const pc = new RTCPeerConnection(); peer.current = pc;
      ms.getTracks().forEach(track => pc.addTrack(track, ms));
      const dc = pc.createDataChannel("oai-events"); channel.current = dc;
      let micReady=false,micPending=false,model="gpt-realtime",buyerTranscriptionModel=audioMode==="computer"?"gpt-4o-transcribe":"gpt-4o-mini-transcribe";
      const guard=createEnglishTranscriptionGuard({config:buyerTranscriptionConfig(audioMode),send:event=>{if(dc.readyState==='open')dc.send(JSON.stringify(event));},onAccepted:config=>{transcriptionDiagnostics.current.sessions.push({channel:audioMode==='computer'?'buyer':'conversation',...config});setInputDetails(previous=>previous.includes('English confirmed')?previous:previous+' · English confirmed by speech service');},onError:message=>{if(peer.current===pc){stopAudio();setError(message);}}});
      englishGuard.current=guard;
      dc.addEventListener('open',()=>guard.start(),{once:true});
      const recordTranscription=(timing:Record<string,unknown>)=>{const values=transcriptionDiagnostics.current.turns,index=values.findIndex(item=>item.id===timing.id);if(index<0)values.push(timing);else values[index]={...values[index],...timing};};
      const sessionId=uid(),sessionTotals=new Map<string,{usd:number;known:boolean}>();
      const replyCaptures=new WeakMap<LiveContext,LearningCapture>();
      const liveCapture=(id:string,pinned?:LiveContext)=>{
        if(!pinned)return captureFor(id);
        let captured=replyCaptures.get(pinned);
        if(!captured){captured=captureFor(id,pinned as ReturnType<typeof payload>);replyCaptures.set(pinned,captured);}
        return captured;
      };
      const meterUsage=(kind:"live"|"transcription",price:{usd:number;known:boolean},usageModel=kind==="live"?model:buyerTranscriptionModel)=>{
        const now=new Date(),key=`${sessionId}:${kind}:${usageModel}:${now.getFullYear()}-${now.getMonth()}`;
        const previous=sessionTotals.get(key),total={usd:(previous?.usd || 0)+price.usd,known:(previous?.known ?? true)&&price.known};sessionTotals.set(key,total);
        recordCharges([{id:key,at:now.getTime(),kind,...total,model:usageModel}]);
      };
      const session=new LiveCoachingSession({
        initialTranscriptIds:context.current.turns.map(turn=>turn.id),
        initialQuestions:buyerQuestionLogRef.current.at(-1)?.questions||[],
        vadSilenceMs:buyerVadSilenceMs(audioMode),
        snapshot:()=>observationPayload(context.current.turns) as LiveContext,
        latestContext:(turns)=>{
          const repSpeech=repAudio.current?.observedSpeechSnapshot()||{partials:[],pendingSpeech:[]};
          return {...payload("coach",(turns as Turn[]|undefined)??context.current.turns),coachingRequest:{id:'',requestedAt:0,...repSpeech}} as LiveContext;
        },
        onQueuedRequest:state=>{if(peer.current===pc){setQueuedRequest(state);if(state)setThinking(false);}},
        knowledgeSources:snapshot=>{
          const company=manufacturersRef.current.find(item=>item.id===(snapshot.manufacturer as {id?:string}|undefined)?.id);
          return snapshot.companyConfiguration?configurationReferences(snapshot.companyConfiguration.snapshot):company?knowledgeFor(company):snapshot.sources;
        },
        send:event=>{if(peer.current===pc && dc.readyState==="open")dc.send(JSON.stringify(event));},
        verify:(snapshot,proposed,signal)=>billableJSON<Guidance>("/api/coach",{...snapshot,mode:"verify",proposedGuidance:proposed},signal),
        fallback:(snapshot,signal)=>billableJSON<Guidance>("/api/coach",{...snapshot,mode:"coach"},signal),
        onGuidance:(value,id,at,complete,delay,trigger,pinned)=>{
          if(peer.current!==pc)return;
          const saved=suggestionsRef.current.find(item=>item.id===id),edited=manualReplyEdits.current.get(id)||(saved&&hasWordingEdit(saved)?saved.guidance.say:undefined);
          const displayed=edited?{...value,say:edited,verified:false,evidence:[]}:value;
          activeGuidance.current={id,value:displayed};setGuidanceId(id);setGuidanceAt(at);setGuidance(displayed);setLiveDraft(!complete&&!edited);setLatency(delay);
          if(!complete&&value.say.trim()){
            const first=!pinned||!replyCaptures.has(pinned),captured=liveCapture(id,pinned),company=context.current.current;
            if(first&&company)updateCompanyBrain(company.id,brain=>captureLearning(brain,id,value.say,captured));
            setSuggestions(previous=>upsertSuggestion(previous,{id,triggerTurnId:trigger,learningPairId:`${captured.companyId}:${id}`,buyerQuote:value.questionEcho||context.current.turns.find(turn=>turn.id===trigger)?.text,at,guidance:value,status:'suggested',pending:true,bilingual:context.current.bilingual,sourceSnapshot:[]}));
          }
          if(complete){rememberGuidance(value,id,trigger,liveCapture(id,pinned));if(recentReplies.current.at(-1)!==value.say)recentReplies.current=[...recentReplies.current,value.say].slice(-12);}
        },
        onTelemetry:event=>{
          if(peer.current!==pc)return;
          setSuggestions(previous=>previous.map(item=>item.id===event.suggestionId?{...item,latencyBreakdown:{...item.latencyBreakdown,...event.phases?{phases:event.phases}:{},...event.firstDisplayMs!==undefined?{firstDisplayMs:event.firstDisplayMs}:{},...event.verificationCompleteMs!==undefined?{verificationCompleteMs:event.verificationCompleteMs}:{},...event.totalMs!==undefined?{totalMs:event.totalMs}:{},...event.type==='first_display'?{firstDisplayedAt:event.at}:event.type==='verification_complete'?{verificationCompletedAt:event.at}:{completedAt:event.at},verificationRequired:event.verificationRequired,status:event.status,...event.acousticLatency?{acousticLatency:event.acousticLatency}:{}}}:item));
        },
        onRequestTrace:event=>{if(peer.current===pc)retainRequestTrace(event);},
        onSuggestionIssue:event=>{if(peer.current===pc)retainCoachingIssue({...event,correction:event.correction?.say});},
        onVerificationReplacement:event=>{
          if(peer.current!==pc)return;
          setSuggestions(previous=>recordVerificationReplacement(previous,event.suggestionId,{at:event.at,originalSay:event.originalSay,replacementSay:event.replacementSay,reason:event.reason,originalWasDisplayed:event.originalWasDisplayed}));
        },
        onQuestionQueue:event=>{
          if(peer.current!==pc)return;
          const entry=structuredClone(event);
          buyerQuestionLogRef.current=[...buyerQuestionLogRef.current,entry];setBuyerQuestionLog(buyerQuestionLogRef.current);
        },
        onSupersede:()=>{if(peer.current===pc){setLiveTiming(undefined);setLiveDraft(false);setCheckingFacts(false);}},
        onSupersedeCard:trigger=>setSuggestions(previous=>{const exists=previous.some(item=>item.triggerTurnId===trigger),next=previous.map(item=>item.triggerTurnId===trigger?{...item,superseded:true,status:item.status==="suggested"?"superseded" as const:item.status}:item);const turn=context.current.turns.find(item=>item.id===trigger);return !exists&&turn?[...next,{id:"buyer-unanswered-"+trigger,triggerTurnId:trigger,buyerQuote:turn.text,at:turn.at,guidance:{say:"",ask:"",intent:"",nextStep:"",caution:"",evidence:[],missing:[]},sourceSnapshot:[],status:"superseded",bilingual:context.current.bilingual,pending:true}]:next;}),
        onArchiveCard:(id,reason,actualText)=>archiveSuggestion(id,reason,actualText),
        onAnalysis:(trigger,value)=>{
          if(peer.current!==pc)return;
          // Enrich this existing row without republishing its script or resetting latency.
          setSuggestions(previous=>previous.map(item=>item.triggerTurnId===trigger&&!hasWordingEdit(item)?{...item,guidance:{...item.guidance,moment:value.moment,move:value.move,why:value.why,buyerIntent:value.buyerIntent,analysisReady:true}}:item));
          if(activeGuidance.current.id===`coaching-${trigger}`){
            const previous=activeGuidance.current.value;
            if(previous){const updated={...previous,moment:value.moment,move:value.move,why:value.why,buyerIntent:value.buyerIntent,analysisReady:true};activeGuidance.current={...activeGuidance.current,value:updated};setGuidance(updated);}
          }
        },
        onPendingTurn:text=>{if(peer.current===pc)setPendingBuyerText(text);},
        onThinking:active=>{if(peer.current===pc)setThinking(active);},
        onChecking:active=>{if(peer.current===pc)setCheckingFacts(active);},
        onBuyerTurn:turn=>{if(peer.current===pc)addTurn(turn.text,audioMode==="computer" ? "buyer" : "conversation",turn.id,turn.at,turn.transcriptionUncertainty);},
        onTranscriptionTiming:timing=>{if(peer.current===pc)recordTranscription({...timing,model:buyerTranscriptionModel});},
        onBuyerPartial:text=>{if(peer.current===pc)setPartial(text);},
        onBuyerSpeech:active=>{if(peer.current===pc)setHearing(active);},
        onBuyerPending:ids=>{if(peer.current===pc)pendingBuyerItems.current=new Set(ids);},
        onUsage:(kind,usage)=>meterUsage(kind,kind==="live" ? priceRealtimeUsage(usage,model) : priceTranscriptionUsage(usage,buyerTranscriptionModel)),
        onAudioIssue:audioMode==="computer"?issue=>{if(peer.current===pc)setBuyerAudioIssue(issue);}:undefined,
        onWarning:message=>{if(peer.current===pc)markCaptureWarning(message);},
        onError:message=>{if(peer.current===pc)setError(message);},
      });
      liveSession.current=session;turnGate.current=session.coordinator;
      if(audioMode==="computer")turnGate.current.repPending(true);
      dc.onmessage=message=>{if(peer.current!==pc)return;try{const event=JSON.parse(message.data);guard.handle(event);session.handle(event);}catch{setError("A live update could not be processed. Reconnect the assistant if replies stop updating.");}};
      dc.onclose = () => { if (peer.current === pc) { stopAudio(); setError("The live transcription connection ended. Your transcript is saved; reconnect to continue."); } };
      pc.onconnectionstatechange = () => {
        if (peer.current === pc && pc.connectionState === "failed") { stopAudio(); setError("The microphone connection failed. Check your network and reconnect."); }
      };
      const offer = await pc.createOffer(); ensureAudioCurrent(generation); await pc.setLocalDescription(offer); ensureAudioCurrent(generation);
      const response = await fetch("/api/session", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({...observationPayload(context.current.turns),audioMode,sdp:offer.sdp}), signal:AbortSignal.timeout(40_000) });
      const returnedHandle=response.headers.get("X-Trade-Call") || "";
      if (generation !== audioGeneration.current && returnedHandle) void fetch("/api/session/stop",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({handle:returnedHandle}),keepalive:true}).catch(()=>{});
      ensureAudioCurrent(generation);
      if (!response.ok) { const data = await response.json() as {error?:string}; throw new Error(data.error || "Live transcription could not connect."); }
      callHandle.current=returnedHandle;model=response.headers.get("X-Trade-Model") || "gpt-realtime";buyerTranscriptionModel=response.headers.get("X-Trade-Transcription-Model")||buyerTranscriptionModel;
      const answer = await response.text(); ensureAudioCurrent(generation);
      await pc.setRemoteDescription({ type:"answer", sdp:answer }); ensureAudioCurrent(generation);
      await new Promise<void>((resolve,reject) => { if (dc.readyState === "open") { resolve(); return; } const t = setTimeout(() => reject(new Error("The live connection timed out. Please try again.")), 20_000); dc.addEventListener("open", () => {clearTimeout(t);resolve();}, {once:true}); dc.addEventListener("close", () => {clearTimeout(t);reject(new Error("Audio setup was stopped."));}, {once:true}); });
      ensureAudioCurrent(generation);
      guard.start();await guard.ready;ensureAudioCurrent(generation);
      if(audioMode==="computer"){
        repAudio.current=await startRepAudio({deviceId,signal:repAbort.current?.signal,
          onSpeech:active=>{if(generation!==audioGeneration.current)return;setRepSpeaking(active);turnGate.current.repSpeech(active);},
          onPending:active=>{micPending=active;if(micReady && generation===audioGeneration.current)turnGate.current.repPending(active);},
          onPartial:text=>{if(generation===audioGeneration.current)setRepPartial(text);},
          onSessionConfig:config=>{if(generation===audioGeneration.current)transcriptionDiagnostics.current.sessions.push({channel:'you',...config});},
          onTranscriptionTiming:timing=>{if(generation===audioGeneration.current)recordTranscription({...timing});},
          onTurn:turn=>{if(generation!==audioGeneration.current)return;setRepPartial("");addTurn(turn.text,"you",turn.id,turn.at,turn.transcriptionUncertainty);session.acceptRepresentative(turn);if(dc.readyState==="open")dc.send(JSON.stringify({type:"conversation.item.create",item:{type:"message",role:"user",content:[{type:"input_text",text:`Representative microphone transcript${turn.transcriptionUncertainty?' (UNCERTAIN recognition; do not treat as fact)':' (not buyer)'}: ${turn.text}`}]}}));},
          onUsage:(usage,transcriptionModel)=>{if(generation===audioGeneration.current)meterUsage("transcription",priceTranscriptionUsage(usage,transcriptionModel),transcriptionModel);},
          onLevel:value=>{if(generation===audioGeneration.current)setRepLevel(value);},
          onCaptureWarning:message=>{if(generation===audioGeneration.current)markCaptureWarning(message);},
          onError:message=>{if(generation===audioGeneration.current){stopAudio();setError(message+" Both channels stopped; your phone call can continue.");}}
        });ensureAudioCurrent(generation);micReady=true;turnGate.current.repPending(micPending);
      }
      setConnecting(false); setLive(true); if (!startedAt) setStartedAt(Date.now());
      stopTimer.current = setTimeout(() => { stopAudio(); notify("The session reached 55 minutes. Start listening again to continue."); }, 55*60*1000);
      notify(audioMode === "computer" ? "Live assistant connected to computer audio. Your phone call stays on your AT&T line." : "Listening connected. Click Suggest next move whenever you want coaching.");
    } catch (e) { if (generation !== audioGeneration.current) return; stopAudio(); const message = audioFailureMessage(e,"Could not start audio capture."); setError(audioMode !== "computer" && (message.includes("Permission") || message.includes("NotAllowed")) ? "Allow microphone access in your browser, then try again." : message); }
  }
  function togglePause() {
    const value=!paused;
    if(value)cancelQueuedCoaching();
    else {
      const repSpeech=repAudio.current?.observedSpeechSnapshot();
      liveSession.current?.markListeningResumed([...context.current.turns.map(turn=>turn.id),...(repSpeech?.partials||[]).flatMap(part=>part.id?[part.id]:[]),...(repSpeech?.pendingSpeech||[]).map(part=>part.id)]);
    }
    turnGate.current.pause(value);repAudio.current?.pause(value);stream.current?.getAudioTracks().forEach(track=>track.enabled=!value);setPaused(value);
    if(value){setPartial("");setHearing(false);}
  }

  async function testRepresentativeMic(generation:number) {
    const raw=await navigator.mediaDevices.getUserMedia({audio:microphoneConstraints("headset",deviceId)});
    if(generation!==audioGeneration.current){raw.getTracks().forEach(t=>t.stop());ensureAudioCurrent(generation);}
    const ctx=new AudioContext();let frameId=0;let ended=false;
    const stop=()=>{if(ended)return;ended=true;cancelAnimationFrame(frameId);raw.getTracks().forEach(t=>t.stop());void ctx.close();};
    repAudio.current={stop,pause:value=>raw.getAudioTracks().forEach(t=>t.enabled=!value),observedSpeechSnapshot:()=>({partials:[],pendingSpeech:[]})};
    await ctx.resume();ensureAudioCurrent(generation);
    const source=ctx.createMediaStreamSource(raw),analyser=ctx.createAnalyser();analyser.fftSize=1024;source.connect(analyser);
    const samples=new Float32Array(analyser.fftSize);
    const tick=()=>{if(ended)return;analyser.getFloatTimeDomainData(samples);const reading=audioSignal(samples);setRepLevel(reading.level);setRepSpeaking(reading.db > -40);frameId=requestAnimationFrame(tick);};tick();
  }
  async function testMic() {
    if (micTest) { stopAudio(); return; } if (captureBusy.current || live || connecting) return; setError("");setCaptureDiagnostic(null);
    const generation=++audioGeneration.current; captureBusy.current=true; setMicTest(true);
    try { await captureAudio(generation); ensureAudioCurrent(generation);if(audioMode==="computer")await testRepresentativeMic(generation);ensureAudioCurrent(generation); testTimer.current = setTimeout(stopAudio,10_000); }
    catch (e) { if (generation !== audioGeneration.current) return; stopAudio(); setError(audioFailureMessage(e,"Microphone access failed.")); }
  }
  function resetActiveCall() {
    backgroundRequest.current++;setPreparingBrief(false);setBriefError('');setWrapUp(undefined);setWrapUpNextCall(false);setOutsideUpdate('');
    openingChoicesRef.current={};setOpeningChoices({});
    manualReplyEdits.current.clear();
    // Rotate identity before any asynchronous callback can see the next draft.
    activeCallId.current=uid();setCallSessionId(activeCallId.current);callConfigurationRef.current=undefined;setCallConfiguration(undefined);callGeneration.current++;controller.current?.abort();seq.current++;
    if(timer.current)clearTimeout(timer.current);
    stopAudio();recentReplies.current=[];
    const freshContext={...defaultCallContext(GOALS[0]),stageId:context.current.callContext.stageId};
    const selected=clientFor(),clientName=selected?.name||'';
    context.current={...context.current,outsideUpdate:'',wrapUp:undefined,buyer:clientName,preparation:undefined,goal:GOALS[0],turns:[],buyerBrief:null,callType:'discovery',currentStage:freshContext.stageId,callContext:freshContext};
    draft.current={...draft.current,outsideUpdate:'',wrapUp:undefined,callId:activeCallId.current,recentReplies:[],startedAt:0,elapsed:0,notes:'',outcome:'',buyer:clientName,goal:GOALS[0],turns:[],buyerBrief:null,callType:'discovery',currentStage:freshContext.stageId,callContext:freshContext,stageHistory:[],suggestions:[],missingKnowledge:[],nextStepAt:'',captureWarnings:[],buyerQuestionLog:[],callCostUsd:0,companyConfiguration:undefined,preparation:undefined};
    buyerQuestionLogRef.current=[];setBuyerQuestionLog([]);transcriptionDiagnostics.current={sessions:[],turns:[]};
    activeGuidance.current={id:'',value:null};captureWarningsRef.current=[];
    setTurns([]);setCallPreparation(undefined);setCallContext(freshContext);setGoal(GOALS[0]);setRestoredTurnCount(0);setNotes('');setStartedAt(0);setElapsed(0);setBuyer(clientName);setBuyerBrief(null);setCallType('discovery');setCurrentStage(freshContext.stageId);
    setManualTrace(null);manualSubmitted.current=0;manualReplyRetired.current.clear();setGuidance(null);setGuidanceId('');setGuidanceAt(0);setPendingBuyerText('');setLiveDraft(false);setThinking(false);setCheckingFacts(false);setLatency(0);setManualText('');setManualRole('buyer');
    setCallCostUsd(0);spendState.current.callUsd=0;setOutcome('');setSuggestions([]);setStageHistory([]);setMissingKnowledge([]);setNextStepAt('');setCaptureWarnings([]);setError('');
  }
  function activeCallRecord(actualOutcome:string,recordedAt:number):CallRecord {
    const existingBinding=callConfigurationRef.current,preview=existingBinding||previewCallConfiguration(context.current.current!);
    const binding=existingBinding||(preview?{...preview,boundAt:recordedAt}:undefined),savedContext={...context.current.callContext,...binding?{stageId:binding.selectedStageId,goal:binding.snapshot.stages.find(stage=>stage.id===binding.selectedStageId)!.objective}:{}};
    const call:CallRecord={id:activeCallId.current||uid(),manufacturerId:activeId,manufacturerName:current?.name || "Manufacturer",buyer:buyer || "Unnamed buyer",goal:savedContext.goal,startedAt:startedAt || recordedAt,duration:elapsed,turns,notes,outcome:actualOutcome,estimatedCostUsd:callCostUsd,buyerBrief,callType,bilingual,stageHistory,missingKnowledge:missingKnowledge.filter(item=>isCompanyKnowledgeGap(item.fact)),nextStepAt,captureWarnings:captureWarningsRef.current,buyerQuestionLog:structuredClone(buyerQuestionLogRef.current),decisionsNeeded:[],callContext:savedContext,companyConfiguration:binding?structuredClone(binding):undefined,stageMapSnapshot:binding?configurationStageMap(binding.snapshot,{includeRetired:true}):normalizeStageMap(current?ensureCompanyBrain(current).playbook.stages:undefined),suggestions:suggestions.map(item=>({...item,callOutcome:actualOutcome}))};
    call.transcriptionDiagnostics=structuredClone(transcriptionDiagnostics.current);
    call.clientId=context.current.clientId||undefined;call.contactId=context.current.contactId||undefined;call.reachViaContactId=context.current.reachViaContactId||undefined;call.preparation=context.current.preparation?structuredClone(context.current.preparation):undefined;
    return call;
  }
  async function saveCall(options:{forNewCall?:boolean;wrapUp?:ClientCallWrapUp}={}) {
    if(savedSessionGuard.current||callSaveInFlight.current)return false;
    if(!hydrated||!brainsReady||!brainHydration.current.ready||brainHydration.current.epoch!==brainReadyEpoch){setError('The workspace is still loading or could not be saved. Your review is retained.');return false;}
    if(preparingBrief||uploadingBackground){setError("Wait for preparation or file reading to finish before saving. Your review is retained.");return false;}
    if(options.wrapUp&&options.wrapUp.callId!==activeCallId.current){setError('This review belongs to a different call. Your draft is preserved.');return false;}
    if(repSpeaking||hearing||turnGate.current.state.repPending||pendingBuyerItems.current.size){setError('Wait for captured speech to finish transcribing before saving. Coaching validation does not block saving.');return false;}
    const actualOutcome=options.wrapUp?.outcome?.trim()||outcome.trim()||'Outcome not recorded';
    try { beginCallCommit(); } catch { setError('Another call is being saved. Retry when it finishes.');return false; }
    callSaveInFlight.current=true;workspaceWriteGeneration.current++;setSavingCall(true);setError('');
    try {
      // Capture before resetting. A failed persistence retry keeps this call ID.
      let call=activeCallRecord(actualOutcome,Date.now());
      let brain=ensureCompanyBrain(context.current.current!);
      if(options.wrapUp){const reviewed=saveClientCallWrapUp(brain,calls,call,options.wrapUp);call=reviewed.call;brain=reviewed.brain;}
      const withLearning={...brain,learning:brain.learning.map(pair=>suggestionsRef.current.some(item=>item.id===pair.suggestionId)?{...pair,outcome:call.outcome,callId:call.id}:pair)};
      const remembered=call.clientId?attachCallToClient(withLearning,call,{clientId:call.clientId,contactId:call.contactId}):rememberBuyer(withLearning,call.buyer,deriveConversationState({callId:call.id,turns:call.turns,callContext:call.callContext,stageMap:call.stageMapSnapshot,companyConfiguration:call.companyConfiguration}),call);
      const nextBrain=recordDecisions(remembered,call);
      const nextCompanies=manufacturersRef.current.map(company=>company.id===call.manufacturerId?{...company,brain:nextBrain}:company);
      const nextCalls=upsertClientCallRecord(calls,call);
      const nextDraft={callId:uid(),activeId,clientId:call.clientId,contactId:call.contactId,reachViaContactId:call.reachViaContactId,buyer:call.buyer,goal:GOALS[0],callContext:{...defaultCallContext(GOALS[0]),stageId:call.callContext?.stageId||'cold_call'},startedAt:0,elapsed:0,turns:[],notes:'',outcome:'',suggestions:[],recentReplies:[],buyerBrief:null,callType:'discovery',bilingual,stageHistory:[],missingKnowledge:[],nextStepAt:'',captureWarnings:[],buyerQuestionLog:[],callCostUsd:0,outsideUpdate:''};
      // A single transaction commits the call, its reviewed recap, the client
      // updates and the cleared draft. A retry uses the same call ID.
      await saveWorkspaceSnapshot({version:1,manufacturers:nextCompanies.map(company=>{const stored={...company};delete stored.brain;return stored;}),calls:nextCalls,activeId,draft:nextDraft},nextCompanies.map(ensureCompanyBrain));
      queueBuyerTranslations(call.turns,'background');translationQueue.current?.backgroundScope(`draft-${callGeneration.current}`,callGeneration.current);
      stopAudio();controller.current?.abort();seq.current++;setThinking(false);setCheckingFacts(false);
      savedSessionGuard.current=true;manufacturersRef.current=nextCompanies;setManufacturers(nextCompanies);setCalls(nextCalls);
      context.current.current=nextCompanies.find(company=>company.id===call.manufacturerId);
      setHistoryClientId(call.clientId||null);setSelectedCall(call.id);setView('history');setPacketLanguage(bilingual?'zh':'en');
      resetActiveCall();
      setSavedCallNotice({id:call.id,at:Date.now()});
      notify('Call saved. Transcript, coaching review status and selected client updates are stored.');
      return true;
    }catch(cause){setError('Save did not finish. Your review is retained; retry safely without creating another call. '+(cause instanceof Error?cause.message:''));return false;}
    finally{endCallCommit();callSaveInFlight.current=false;setSavingCall(false);}
  }
  async function saveContactsFromRecap(call:CallRecord,contacts:WrapUpContact[]) {
    if(callSaveInFlight.current)throw Error('Another save is in progress. Retry when it finishes.');
    const company=manufacturersRef.current.find(item=>item.id===call.manufacturerId);
    if(!company)throw Error('The company for this call is unavailable.');
    callSaveInFlight.current=true;setSavingCall(true);
    try {
      const result=saveReviewedCallContacts(ensureCompanyBrain(company),call,contacts);
      const nextCompanies=manufacturersRef.current.map(item=>item.id===company.id?{...item,brain:result.brain}:item);
      await saveCompanyBrains(nextCompanies.map(ensureCompanyBrain));
      manufacturersRef.current=nextCompanies;setManufacturers(nextCompanies);
      if(context.current.current?.id===company.id)context.current.current=nextCompanies.find(item=>item.id===company.id);
      if(context.current.clientId===call.clientId)invalidatePreparation();
      notify('Reviewed contacts saved. The original call record is unchanged.');
    }finally{callSaveInFlight.current=false;setSavingCall(false);}
  }
  function newCall(recordedAt:number) {
    if (hasUnfinishedDraft()) { finishCall(recordedAt,true);return; }
    translationQueue.current?.backgroundScope(`draft-${callGeneration.current}`,callGeneration.current);
    resetActiveCall();savedSessionGuard.current=false;setShowClientList(!context.current.clientId);setView('live');setSelectedCall(null);notify('New call is ready. Review its preparation before starting.');
  }
  async function generatePacket(call:CallRecord,language=packetLanguage) {
    const manufacturer=manufacturers.find(m=>m.id===call.manufacturerId) || {id:"general",name:call.manufacturerName,products:"",introduction:"",sources:[]};
    setSummarizing(true);setError("");
    try {
      const canonical=ensureCompanyBrain(manufacturer),state=deriveConversationState({callId:call.id,turns:call.turns,callContext:call.callContext,stageMap:call.stageMapSnapshot||canonical.playbook.stages,companyConfiguration:call.companyConfiguration});
      const packetCall={...call,...call.companyConfiguration?{companyConfiguration:compactCallConfigurationBinding(call.companyConfiguration)}:{}};
      const packet=await billableJSON<DecisionPacket & {_charges?:UsageEntry[]}>("/api/packet",{call:packetCall,language,brain:buildBrainRequest(manufacturer,call.buyer,state),manufacturer:{id:manufacturer.id,name:manufacturer.name,products:manufacturer.products},sources:selectKnowledge(call.companyConfiguration?configurationReferences(call.companyConfiguration.snapshot):knowledgeFor(manufacturer),call.turns.map(t=>t.text).join(" "))});
      updateCompanyBrain(call.manufacturerId,brain=>{const updated={...call,decisionsNeeded:packet.decisionsNeeded};return recordDecisions(updated.clientId?attachCallToClient(brain,updated,{clientId:updated.clientId,contactId:updated.contactId}):brain,updated);});
      setCalls(previous=>previous.map(c=>{
        if(c.id!==call.id)return c;
        const packets={...c.packets,[language]:packet};
        const decisions=new Map<string,DecisionItem>();
        Object.values(packets).forEach(saved=>saved?.decisionsNeeded.forEach(item=>decisions.set(item.id,{...item,checked:c.decisionsNeeded?.find(existing=>existing.id===item.id)?.checked ?? item.checked})));
        const packetCost=(packet._charges || []).reduce((sum,charge)=>sum+charge.usd,0);
        return {...c,packets,decisionsNeeded:[...decisions.values()],estimatedCostUsd:(c.estimatedCostUsd || 0)+packetCost,packetCostUsd:(c.packetCostUsd || 0)+packetCost};
      }));
    }catch(e){if(uiLocation.current.view==="history"&&uiLocation.current.selectedCall===call.id)setError(e instanceof Error ? e.message : "Could not prepare the decision packet. The call is saved; retry from its record.");}finally{setSummarizing(false);}
  }
  function saveForm(e: React.FormEvent) {
    e.preventDefault(); if (!modal || !formName.trim()) return;
    if (modal.type === "manufacturer") {
      const item: Manufacturer = { id:modal.manufacturer?.id || uid(), name:formName.trim(), products:formProducts.trim(), introduction:formText.trim(), sources:modal.manufacturer?.sources || [],brain:modal.manufacturer?.brain,stageMap:modal.manufacturer?.stageMap,exampleLines:modal.manufacturer?.exampleLines };
      const brain=ensureCompanyBrain(item),saved={...item,brain:{...brain,configuration:syncConfigurationDocuments(ensureCompanyConfiguration(item,brain),item),updatedAt:Date.now()}};
      setManufacturers(previous => modal.manufacturer ? previous.map(m=>m.id===item.id?saved:m) : [...previous,saved]); setActiveId(item.id);
    } else if (current) {
      if (!formText.trim()) { setError("Add some source text before saving."); return; }
      const total = knowledgeFor(current).filter(s => s.id !== modal.source?.id).reduce((n,s) => n+s.text.length,0) + formText.length;
      if (total > 500_000) { setError("This manufacturer's library supports 500,000 characters. Split larger libraries across manufacturers."); return; }
      const source: Source = { ...modal.source, id:modal.source?.id || uid(), title:formName.trim(), text:formText.trim(), addedAt:modal.source?.addedAt || new Date().toISOString() };
      setManufacturers(previous => previous.map(m => {if(m.id!==current.id)return m;const updated={...m,sources:modal.source ? m.sources.map(s=>s.id===source.id?source:s):[...m.sources,source]};const brain=ensureCompanyBrain(updated);return {...updated,brain:{...brain,configuration:syncConfigurationDocuments(ensureCompanyConfiguration(updated,brain),updated),updatedAt:Date.now()}};}));
    }
    setModal(null); setGuidance(null); notify("Source saved. Review and apply its information in Company Brain before use.");
  }
  async function loadSource(file?: File) {
    if (!file) return; setError("");
    if (file.size > 8*1024*1024) { setError("Use a file smaller than 8 MB."); return; }
    setFormName(file.name);
    if (/\.pdf$/i.test(file.name)) {
      setExtracting(true);
      try { const data = await new Promise<string>((resolve,reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(file); }); const result = await billableJSON<{text:string}>("/api/extract", {name:file.name,data}); setFormText(result.text); notify("PDF extracted. Review the text before saving."); }
      catch(e) { setError(e instanceof Error ? e.message : "The PDF could not be read."); } finally { setExtracting(false); }
    } else if (/\.(txt|md|csv|tsv|json)$/i.test(file.name)) { const text = await file.text(); if (text.length > 100_000) { setError("Each source can contain up to 100,000 characters. Split this file into smaller sources."); return; } setFormText(text); }
    else setError("Supported files: PDF, TXT, Markdown, CSV, TSV, and JSON. Paste text from other formats.");
  }
  function backup() { downloadFile(`trade-assist-backup-${new Date().toISOString().slice(0,10)}.json`, JSON.stringify({version:1,manufacturers,calls,generalPlaybook,activeId,draft:draft.current,features:{voice,buyerBrief,bilingual,callType,translateBuyer},usage:{budget,entries:usageEntries}},null,2),"application/json"); }
  async function restore(file?: File) {
    if (!file) return;
    if(live || connecting) {setError("Stop the live assistant before importing a backup.");return;}
    if(callSaveInFlight.current || !brainsReady || !brainHydration.current.ready){setError("Wait for the workspace to finish loading or saving before importing.");return;}
    const importGeneration=callGeneration.current,importAudioGeneration=audioGeneration.current;
    let importCommit=false;
    try {
      if (file.size > 100_000_000) throw new Error("Backup too large (maximum 100 MB).");
      const data = JSON.parse(await file.text());
      if(importGeneration!==callGeneration.current||importAudioGeneration!==audioGeneration.current){setError("The active call changed during import. Try importing again after stopping the assistant.");return;}
      if (data.version !== 1 || !Array.isArray(data.manufacturers) || !Array.isArray(data.calls) || !data.manufacturers.every((m: Manufacturer) => typeof m.id === "string" && typeof m.name === "string" && typeof m.products === "string" && typeof m.introduction === "string" && Array.isArray(m.sources) && m.sources.every(s => typeof s.id === "string" && typeof s.title === "string" && typeof s.text === "string")) || !data.calls.every((c: CallRecord) => typeof c.id === "string" && Array.isArray(c.turns) && typeof c.buyer === "string")) throw new Error("Invalid backup.");
      if(data.generalPlaybook&&playbookReady){const incoming=normalizeGeneralPlaybook(data.generalPlaybook);if(incoming.updatedAt>generalPlaybookRef.current.updatedAt){await saveGeneralPlaybook(incoming);generalPlaybookRef.current=incoming;setGeneralPlaybook(incoming);}}
      const existing = new Set(manufacturers.map(m => m.id)), callIds = new Set(calls.map(c => c.id));
      const mergedCompanies=[...manufacturersRef.current.map(company=>{const imported=data.manufacturers.find((m:Manufacturer)=>m.id===company.id);if(!imported?.brain||imported.brain.companyId!==company.id)return company;const local=ensureCompanyBrain(company),incoming=ensureCompanyBrain(imported),pairs=new Map(local.learning.map(pair=>[pair.id,pair]));for(const pair of incoming.learning)if(pair.companyId===company.id&&!pairs.has(pair.id))pairs.set(pair.id,pair);return {...company,brain:{...(incoming.updatedAt>local.updatedAt?incoming:local),clients:mergeCompanyClientRecords(company.id,local.clients||[],incoming.clients||[]),learning:[...pairs.values()],updatedAt:Date.now()}};}),...data.manufacturers.filter((m:Manufacturer)=>!existing.has(m.id)).map((m:Manufacturer)=>({...m,brain:ensureCompanyBrain(m)}))];
      const hasDraft=hasUnfinishedDraft();
      const matchingDraft=hasDraft && !!data.draft?.callId && data.draft.callId===activeCallId.current;
      // An old backup may contain earlier edits even when the call ID matches.
      // Ask before replacing an active review; never silently discard it.
      const matchingDraftDiffers=matchingDraft && JSON.stringify(data.draft)!==JSON.stringify(draft.current);
      const replaceMatchingDraft=matchingDraft && (!matchingDraftDiffers || window.confirm('This backup contains the same unfinished call. Restore its draft and reviewed recap? This replaces the current draft, which may contain newer edits. Export the current workspace first if you want to keep both.'));
      const importingDraft=(!hasDraft||replaceMatchingDraft)?data.draft:undefined;
      if(importingDraft && (!Array.isArray(importingDraft.turns) || !importingDraft.turns.every((turn:Turn)=>turn && typeof turn.id==='string' && typeof turn.text==='string' && ['buyer','you','conversation'].includes(turn.role)) || (importingDraft.callId!==undefined && typeof importingDraft.callId!=='string') || (importingDraft.suggestions!==undefined && !Array.isArray(importingDraft.suggestions)) || (importingDraft.wrapUp && (importingDraft.wrapUp.callId!==importingDraft.callId || typeof importingDraft.wrapUp.recap!=='string' || typeof importingDraft.wrapUp.outcome!=='string' || !Array.isArray(importingDraft.wrapUp.memory) || !Array.isArray(importingDraft.wrapUp.contacts)))))throw new Error('The backup contains an invalid unfinished call. No draft was replaced.');
      const migration=migrateClientWorkspace(mergedCompanies,[...data.calls.filter((c:CallRecord)=>!callIds.has(c.id)),...calls],importingDraft);
      if(importGeneration!==callGeneration.current||importAudioGeneration!==audioGeneration.current)throw new Error('The active call changed during import. Try again.');
      beginCallCommit();importCommit=true;callSaveInFlight.current=true;workspaceWriteGeneration.current++;
      const importedActiveId=importingDraft?.activeId || activeId || data.manufacturers[0]?.id || '';
      await saveWorkspaceSnapshot({version:1,manufacturers:migration.companies.map(company=>{const stored={...company};delete stored.brain;return stored;}),calls:migration.calls,activeId:importedActiveId,draft:migration.draft || importingDraft || draft.current},migration.companies.map(ensureCompanyBrain));
      manufacturersRef.current=migration.companies;setManufacturers(migration.companies);setCalls(migration.calls);
      if(migration.draft)data.draft=migration.draft;
      if (!activeId && data.manufacturers[0]) setActiveId(data.manufacturers[0].id); notify(hasDraft&&!replaceMatchingDraft?"Backup records imported. Your current unfinished call was kept; the backup draft was not restored.":"Backup imported. Existing call records were kept.");
      if(typeof data.features?.bilingual==="boolean")setBilingual(data.features.bilingual);
      if(typeof data.features?.translateBuyer==="boolean")setTranslateBuyer(data.features.translateBuyer);
      const importedVoice=VoiceProfileInput.safeParse(data.features?.voice);if(importedVoice.success && data.features?.voice)setVoice(importedVoice.data);
      if(Array.isArray(data.usage?.entries))recordCharges(data.usage.entries.filter((entry:UsageEntry)=>entry && typeof entry.id==="string" && typeof entry.model==="string" && ["live","transcription","coach","research","document"].includes(entry.kind) && Number.isFinite(entry.at) && Number.isFinite(entry.usd) && entry.usd>=0),false);
      const limits=data.usage?.budget;
      if(limits && typeof limits.enabled==="boolean" && Number.isFinite(limits.perCallUsd) && limits.perCallUsd>=0 && limits.perCallUsd<=10_000 && Number.isFinite(limits.monthlyUsd) && limits.monthlyUsd>=0 && limits.monthlyUsd<=10_000)setBudget(limits);
      if(!hasDraft||replaceMatchingDraft) {
        const restoredDraft=data.draft;
        if(restoredDraft && Array.isArray(restoredDraft.turns) && restoredDraft.turns.every((turn:Turn)=>turn && typeof turn.id==="string" && typeof turn.text==="string" && ["buyer","you","conversation"].includes(turn.role))) {
          resetActiveCall();activeCallId.current=typeof restoredDraft.callId==="string"&&restoredDraft.callId?restoredDraft.callId:uid();setCallSessionId(activeCallId.current);recentReplies.current=Array.isArray(restoredDraft.recentReplies)?restoredDraft.recentReplies.filter((line:unknown)=>typeof line==="string").slice(-12):[];const restoredTurns=restoredDraft.turns.map((turn:Turn)=>({...turn}));setTurns(restoredTurns);context.current.turns=restoredTurns;setRestoredTurnCount(restoredTurns.length);setDraftRestoreRevision(value=>value+1);
          const restoredBinding=CallConfigurationBindingInput.safeParse(restoredDraft.companyConfiguration);
          const binding=restoredBinding.success&&restoredBinding.data.companyId===restoredDraft.activeId?restoredBinding.data:undefined;
          callConfigurationRef.current=binding;setCallConfiguration(binding);
          transcriptionDiagnostics.current={sessions:Array.isArray(restoredDraft.transcriptionDiagnostics?.sessions)?restoredDraft.transcriptionDiagnostics.sessions:[],turns:Array.isArray(restoredDraft.transcriptionDiagnostics?.turns)?restoredDraft.transcriptionDiagnostics.turns:[]};
          setOutsideUpdate(typeof restoredDraft.outsideUpdate==='string'?restoredDraft.outsideUpdate:'');setWrapUp(restoredDraft.wrapUp?.callId===restoredDraft.callId?restoredDraft.wrapUp:undefined);
          const clientId=restoredDraft.clientId||'',contactId=restoredDraft.contactId||'',routeId=restoredDraft.reachViaContactId||'',preparation=parseCallPreparation(restoredDraft.preparation);
          context.current.clientId=clientId;context.current.contactId=contactId;context.current.reachViaContactId=routeId;setReachViaContactId(routeId);context.current.preparation=preparation;setActiveClientId(clientId);setActiveContactId(contactId);setCallPreparation(preparation);savedSessionGuard.current=false;setShowClientList(true);
          setCallContext(normalizeCallContext(restoredDraft.callContext,restoredDraft.goal || GOALS[0]));setBuyer(String(restoredDraft.buyer || "").slice(0,500));setGoal(String(restoredDraft.goal || GOALS[0]).slice(0,1000));setNotes(String(restoredDraft.notes || "").slice(0,20_000));setStartedAt(Number(restoredDraft.startedAt)||0);setElapsed(Math.max(0,Number(restoredDraft.elapsed)||0));setOutcome(OUTCOMES.includes(restoredDraft.outcome) ? restoredDraft.outcome : "");setCallType(normalizeCallType(restoredDraft.callType));setCurrentStage(String(restoredDraft.currentStage || "opening"));setStageHistory(Array.isArray(restoredDraft.stageHistory) ? restoredDraft.stageHistory : []);setSuggestions(Array.isArray(restoredDraft.suggestions) ? restoredDraft.suggestions : []);setMissingKnowledge(Array.isArray(restoredDraft.missingKnowledge) ? restoredDraft.missingKnowledge : []);setNextStepAt(String(restoredDraft.nextStepAt || ""));captureWarningsRef.current=Array.isArray(restoredDraft.captureWarnings)?restoredDraft.captureWarnings:[];setCaptureWarnings(captureWarningsRef.current);
          if([...manufacturers,...data.manufacturers].some((m:Manufacturer)=>m.id===restoredDraft.activeId))setActiveId(restoredDraft.activeId);
          buyerQuestionLogRef.current=Array.isArray(restoredDraft.buyerQuestionLog)?restoredDraft.buyerQuestionLog:[];setBuyerQuestionLog(buyerQuestionLogRef.current);
          const cost=Math.max(0,Number(restoredDraft.callCostUsd)||0);setCallCostUsd(cost);spendState.current.callUsd=cost;
        }
        const importedBrief=BuyerBriefInput.safeParse(data.features?.buyerBrief || restoredDraft?.buyerBrief);
        if(importedBrief.success){setBuyerBrief(importedBrief.data);if(!restoredDraft?.buyer)setBuyer(importedBrief.data.company);}
      }
    } catch(cause) { setError('Backup import did not finish. Existing records were kept. '+(cause instanceof Error?cause.message:'')); }
    finally {if(importCommit){endCallCommit();callSaveInFlight.current=false;}}
  }
  function selectManufacturer(id: string) {
    if (live || connecting || hasUnfinishedDraft() || driveLoading) { setError("Finish and save the current conversation or import before switching manufacturers."); return; }
    resetActiveCall();context.current.clientId='';context.current.contactId='';context.current.preparation=undefined;context.current.buyer='';setActiveClientId('');setActiveContactId('');setReachViaContactId('');context.current.reachViaContactId='';setCallPreparation(undefined);setBuyer('');setShowClientList(true);setHistoryClientId(null);setSelectedCall(null);context.current.current=manufacturersRef.current.find(company=>company.id===id);setActiveId(id);setDrivePreview(null);
  }
  async function previewDrive(url=driveUrl) {
    if(!current || driveLoading || live || connecting)return;
    const manufacturerId=current.id;setError("");setDriveLoading(true);setDrivePreview(null);setDriveUrl(url);
    try {
      const result=await billableJSON<{sources:Source[];warnings:string[]}>("/api/drive",{url});
      if(context.current.current?.id!==manufacturerId)throw new Error("Select the original manufacturer before importing this document.");
      setDrivePreview(result);
    }catch(e){setError(e instanceof Error ? e.message : "The Drive link could not be read.");}finally{setDriveLoading(false);}
  }
  function saveDriveMemory() {
    if(!current || !drivePreview || live || connecting)return;
    const sources=[...current.sources];
    for(const source of drivePreview.sources) {const index=sources.findIndex(s=>s.id===source.id || (s.originUrl&&s.originUrl===source.originUrl));if(index>=0)sources[index]={...source,addedAt:sources[index].addedAt};else sources.push(source);}
    if(sources.reduce((n,s)=>n+s.text.length,0)+current.introduction.length>500_000){setError("This would exceed the 500,000-character library limit. Import fewer documents or use another manufacturer profile.");return;}
    setManufacturers(previous=>previous.map(m=>{if(m.id!==current.id)return m;const updated={...m,sources},brain=ensureCompanyBrain(updated);return {...updated,brain:{...brain,configuration:syncConfigurationDocuments(ensureCompanyConfiguration(updated,brain),updated),updatedAt:Date.now()}};}));setDrivePreview(null);setDriveUrl("");setGuidance(null);notify("Drive documents saved. Review and apply their information in Company Brain before use.");
  }
  function driveImportCard() {
    return <section className="card drive-import"><div className="panel-header"><div><BookOpen size={17}/><h2>Import from Google Drive</h2></div><span className="category-label">Anyone-with-link access</span></div><p>Paste a Google Doc, Sheet, Slides, PDF, or folder link. Read the preview once, then save it in this manufacturer’s memory.</p><form onSubmit={e=>{e.preventDefault();void previewDrive();}}><label htmlFor="drive-link">Google Drive file or folder link</label><div className="drive-link-row"><input id="drive-link" type="url" placeholder="https://docs.google.com/document/d/…" value={driveUrl} onChange={e=>setDriveUrl(e.target.value)} required disabled={driveLoading || live || connecting}/><button className="button primary" disabled={driveLoading || live || connecting || !driveUrl.trim()}>{driveLoading ? <Loader2 size={15} className="spin"/> : <ArrowRight size={15}/>} {driveLoading ? "Reading documents…" : "Read link"}</button></div></form><small>Documents stay saved in this browser. Refresh a linked source when the original changes. Private sign-in-only files are not supported by this link importer.</small>{drivePreview && <div className="drive-preview"><strong>{drivePreview.sources.length} document{drivePreview.sources.length===1 ? "" : "s"} ready · {drivePreview.sources.reduce((n,s)=>n+s.text.length,0).toLocaleString()} characters</strong>{drivePreview.warnings.map((warning,i)=><p className="import-warning" key={i}>{warning}</p>)}{drivePreview.sources.map(s=><details key={s.id}><summary>{s.title} <span>{s.text.length.toLocaleString()} characters</span></summary><a href={s.originUrl} target="_blank" rel="noreferrer">Open original document ↗</a><pre>{s.text}</pre></details>)}<div className="button-row"><button className="button primary" onClick={saveDriveMemory} disabled={!drivePreview.sources.length || live || connecting}><Check size={15}/> Save to company memory</button><button className="button secondary" onClick={()=>setDrivePreview(null)}>Discard preview</button></div></div>}</section>;
  }
  // Observe semantic context only. No coaching candidates are prepared on render,
  // on transcription, or when audio starts; the explicit action does that work.
  const callSnapshot=useMemo(()=>observationPayload(turns),[current,buyer,goal,turns,callType,bilingual,callContext,callConfiguration,activeClientId,activeContactId,reachViaContactId,callPreparation,outsideUpdate,wrapUp]);
  const callStages=callConfiguration?callSnapshot.stageMap.filter(stage=>stage.id===callConfiguration.selectedStageId):current?configurationStageMap(ensureCompanyConfiguration(current).active):callSnapshot.stageMap;
  const purpose=useMemo(()=>getPurposeContext(callSnapshot,{observationOnly:true}),[callSnapshot]);
  const savedOpening=current?ensureCompanyBrain(current).playbook.defaultOpening||'':'';
  const openingChoice=openingChoiceFor(openingChoices[current?.id||'general'],savedOpening,'');
  function chooseOpening(choice:OpeningChoice) {
    const companyId=context.current.current?.id||'general',next={...openingChoicesRef.current,[companyId]:choice.mode==='custom'?{...choice,customDraft:choice.text}:choice};
    openingChoicesRef.current=next;setOpeningChoices(next);
  }
  function saveOpeningDefault(text:string) {
    const company=context.current.current,line=normalizeOpening(text);if(!company||!line)return;
    updateCompanyBrain(company.id,brain=>setDefaultOpening(brain,line));
    chooseOpening({mode:'custom',text:line});notify('Opening saved as this company’s default.');
  }
  function removeOpeningDefault() {
    const company=context.current.current;if(!company)return;
    updateCompanyBrain(company.id,brain=>setDefaultOpening(brain,''));
    chooseOpening({mode:'suggested',text:''});notify('Company default removed. The suggested opening is selected.');
  }
  function correctUnderstanding() {
    const field=document.querySelector<HTMLTextAreaElement>('[aria-label="Known buyer facts"]');
    const details=field?.closest('details');if(details)details.open=true;
    field?.scrollIntoView({behavior:'smooth',block:'center'});field?.focus({preventScroll:true});
  }
  const record = calls.find(c => c.id === selectedCall);
  const recordCompany=record?manufacturers.find(company=>company.id===record.manufacturerId):undefined;
  const clients=current?ensureCompanyBrain(current).clients||[]:[];
  const selectedClient=clients.find(client=>client.id===activeClientId&&client.companyId===activeId&&client.removedAt===undefined);
  const historyClient=clients.find(client=>client.id===historyClientId&&client.companyId===activeId);
  const selectedStanding=selectedClient?buildClientStanding({client:selectedClient,calls,outsideUpdate,excludeCallId:callSessionId}):undefined;
  const selectedManagerStage=callConfiguration?.snapshot.stages.find(stage=>stage.id===callConfiguration.selectedStageId)||current&&ensureCompanyConfiguration(current).active.stages.find(stage=>stage.id===callContext.stageId);
  let preparationPreview:CallPreparationSnapshot|undefined,preparationConfirmed=false,briefStale=false;
  const clientBackground=selectedClient?backgroundFor(selectedClient):undefined;
  try {
    if(selectedClient&&current&&clientBackground){
      const binding=callConfiguration||bindCompanyConfiguration(current,callContext.stageId,undefined,0);
      const input:CallPreparationInput={company:current,client:selectedClient,contactId:activeContactId||undefined,reachViaContactId:reachViaContactId||undefined,callId:callSessionId,stageId:callContext.stageId,configurationBinding:binding,calls,callContext,outsideUpdate,callBackground:clientBackground};
      briefStale=!!clientBackground.brief&&clientBackground.brief.inputFingerprint!==preparationInputFingerprint(preparationRequestFor(input));
      if(briefStale)input.callBackground={...clientBackground,brief:undefined};
      preparationPreview=buildCallPreparation(input,{reviewed:false});preparationConfirmed=isPreparationCurrent(callPreparation,input);
    }
  }catch{/* Unavailable manager stages remain unselected. */}

  useEffect(()=>{
    if(view!=='live'||showClientList||!selectedClient||!preparationConfirmed||!configured||modal||showHelp)return;
    const handle=(event:KeyboardEvent)=>{if(!isSuggestNextMoveShortcut(event))return;event.preventDefault();requestNextMove();};
    window.addEventListener('keydown',handle);return()=>window.removeEventListener('keydown',handle);
  });
  const reviewEntries=callConfiguration&&callPreparation?callPreparation.entries:preparationPreview?.entries;
  const reviewHistory=callConfiguration&&callPreparation?callPreparation.history:preparationPreview?.history;
  function clientPreparationPanel(client:ClientRecord,history=false) {
    const contactId=history?historyContactId:activeContactId;
    const pinned=!history&&callConfiguration&&callPreparation;
    const displayClient=pinned?{...client,name:pinned.clientName||client.name,background:pinned.background,contacts:pinned.contact?[{...pinned.contact,createdAt:pinned.reviewedAt,updatedAt:pinned.reviewedAt}]:[]}:{...client,background:client.callBackground?.context??client.background};
    return <ClientPreparation key={`${history?'history':'call'}:${client.id}:${history?'current':callSessionId}`} client={displayClient} contactId={contactId||undefined} stage={history?undefined:selectedManagerStage||undefined} entries={history?undefined:reviewEntries} history={history?undefined:reviewHistory} confirmed={history?false:preparationConfirmed} reviewedAt={history?undefined:callPreparation?.reviewedAt} mode={history?'history':'call'} disabled={!brainsReady||live||connecting||client.removedAt!==undefined} locked={!!pinned} onContactChange={id=>history?setHistoryContactId(id||''):chooseContact(id)} onUpdateClient={patch=>updateClient(client.id,item=>updateClientRecord(item,patch))} onSaveContact={contact=>updateClient(client.id,item=>upsertClientContact(item,contact))} onAddUpdate={input=>addClientUpdate(client.id,input)} onUpdateEntry={(entryId,status,explanation)=>updateClientEntry(client.id,entryId,status,explanation)} onConfirm={history?undefined:confirmPreparation}/>;
  }
  function openClientHistory(clientId:string) {setHistoryClientId(clientId);setHistoryContactId('');setSelectedCall(calls.filter(call=>call.manufacturerId===activeId&&call.clientId===clientId).sort((a,b)=>b.startedAt-a.startedAt)[0]?.id||null);setView('history');}
  function callReview() {return <section className="card record-detail">{record ? <><div className="record-heading"><div><span className="eyebrow">{record.manufacturerName}</span><h2>{record.buyer}</h2><p>{new Date(record.startedAt).toLocaleString()} · {durationText(record.duration)}</p></div><button className="icon-button bordered" aria-label="Export call" onClick={() => downloadFile(`call-${record.id.slice(0,8)}.json`,JSON.stringify(record,null,2),"application/json")}><Download size={17}/></button></div><span className="outcome-badge">Call outcome: {callOutcomeLabel(record.outcome)}</span>{savedCallNotice?.id===record.id&&<p role="status" className="client-notice">Call saved successfully at {new Date(savedCallNotice.at).toLocaleTimeString()}. You can reopen it from Call history.</p>}{record.wrapUp&&<section className="record-section"><h3>Reviewed call recap</h3><p className="preserve">{record.wrapUp.recap}</p><details><summary>Agreements, completion and open matters</summary>{record.wrapUp.memory.map(item=><p key={item.id}><strong>{item.kind} · {item.confirmed?'Retained in client memory':'Call record only'}:</strong> {item.text}</p>)}</details></section>}{recordCompany&&record.clientId&&(()=>{const client=ensureCompanyBrain(recordCompany).clients?.find(item=>item.id===record.clientId);return client?<SavedRecapContacts key={record.id} call={record} client={client} disabled={live||connecting||savingCall} onSaveContacts={contacts=>saveContactsFromRecap(record,contacts)}/>:null;})()}<p className="record-cost">Estimated AI cost: {formatUsd(record.estimatedCostUsd || 0)}</p><p className="record-goal"><strong>Goal:</strong> {record.goal}</p><CallConfigurationReview call={record}/>{recordCompany&&<button className="button secondary small" onClick={()=>openTeaching(record)} disabled={!brainsReady}>Teach the copilot</button>}{record.derivedReviewStale&&<p role="status">The transcript was corrected after review. Earlier recap, decisions and derived client facts need review.</p>}{record.preparation&&<details className="transcript-details"><summary>Salesperson-reviewed preparation used</summary><p>Reviewed {new Date(record.preparation.reviewedAt).toLocaleString()} · Client {record.preparation.clientId} · Contact {record.preparation.contact?.name||'Not selected'}</p><p className="preserve">{record.preparation.background}</p>{record.preparation.outsideUpdate&&<p className="preserve"><strong>Developments for this call:</strong> {record.preparation.outsideUpdate}</p>}{record.preparation.callBackground&&<><p className="preserve">{record.preparation.callBackground.context}</p>{record.preparation.callBackground.brief&&<><h4>Preparation brief</h4><p>{record.preparation.callBackground.brief.situation}</p><p>{record.preparation.callBackground.brief.potentialFit}</p><p>{record.preparation.callBackground.brief.whatToClarify}</p></>}{record.preparation.callBackground.sources.map(source=><details key={source.id}><summary>{source.name} · {new Date(source.readAt).toLocaleString()} · {source.status}</summary>{source.email&&<p>{Object.entries(source.email).map(([key,value])=>`${key}: ${value}`).join(' · ')}</p>}<p className="preserve">{source.error||source.text}</p></details>)}</>}{record.preparation.entries.map(entry=><p key={entry.id}><strong>{entry.source} · {new Date(entry.at).toLocaleString()} · {entry.status}:</strong> {entry.text}</p>)}</details>}{recordCompany&&<CallClientAssociation call={record} clients={ensureCompanyBrain(recordCompany).clients||[]} companyId={record.manufacturerId} disabled={live||connecting} onReassociate={associateCall}/>}{recordCompany&&!record.clientId&&<CompanyHistoryRecords company={recordCompany} brain={ensureCompanyBrain(recordCompany)} buyer={record.buyer} availableCallIds={calls.filter(call=>call.manufacturerId===recordCompany.id).map(call=>call.id)} disabled={!brainsReady||live||connecting||workflowRole!=='manager'} onChange={brain=>updateCompanyBrain(recordCompany.id,()=>brain)} onOpenCall={id=>setSelectedCall(id)}/>}{record.buyerBrief && <details className="transcript-details"><summary>Buyer research saved with this call</summary><p>{record.buyerBrief.summary}</p>{record.buyerBrief.facts.map((fact,i)=><p key={i}>{fact.text} <a href={fact.sourceUrl} target="_blank" rel="noreferrer">Source ↗</a></p>)}{record.buyerBrief.hypotheses.map((hypothesis,i)=><p key={i}><strong>Unconfirmed possibility:</strong> {hypothesis.painPoint} · {hypothesis.question}</p>)}</details>}{record.notes && <div className="record-section"><h3>Your notes</h3><p className="preserve">{record.notes}</p></div>}<ManagerPacketPanel call={record} decisionsReadOnly={workflowRole!=='manager'} language={packetLanguage} onLanguageChange={setPacketLanguage} onGenerate={()=>void generatePacket(record)} loading={summarizing} onPacketChange={packet=>setCalls(previous=>previous.map(c=>c.id===record.id ? {...c,packets:{...c.packets,[packet.language]:packet}} : c))} onDecisionsChange={decisions=>saveManagerDecisions(record,decisions)}/>
            {!!record.buyerQuestionLog?.length&&<details className="transcript-details"><summary>Question queue log · {record.buyerQuestionLog.at(-1)?.questions.length || 0} unresolved</summary><p>A superseded suggestion does not mean the buyer’s question was answered.</p>{record.buyerQuestionLog.map((event,index)=><div className="record-turn" key={index}><strong>{nowLabel(event.at)} · {event.type}</strong>{(event.affected||event.questions).map((question,n)=><p key={n}>{question.text}</p>)}<small>{event.reason}</small></div>)}</details>}
            {record.summary && <details className="transcript-details"><summary>Previous recap</summary><p>{record.summary.overview}</p><textarea className="followup-text" aria-label="Edit previous follow-up draft" value={record.summary.followUp} onChange={e=>setCalls(previous=>previous.map(c=>c.id===record.id && c.summary ? {...c,summary:{...c.summary,followUp:e.target.value}} : c))}/></details>}
            <details className="transcript-details"><summary>Coaching history · {record.suggestions?.filter(item=>!item.coachingIssue&&!!item.guidance.say.trim()).length || 0} suggestions</summary><p>Suggested wording is not evidence of what was spoken.</p>{record.stageHistory?.map((event,i)=><p key={i}>{nowLabel(event.at)} · {event.label} · {event.source}</p>)}{record.suggestions?.filter(item=>!item.coachingIssue&&!!item.guidance.say.trim()).map(item=><div className="saved-suggestion" key={item.id}><strong>{nowLabel(item.at)} · {item.guidance.stage} · {item.guidance.moment}</strong><p>{readableCoachingMove(item.guidance.move)}</p><blockquote>{item.guidance.say}</blockquote>{item.coachingIssue&&<p role="status"><strong>Coaching draft {item.coachingIssue.status}:</strong> {item.coachingIssue.reason}{item.coachingIssue.correction&&<> Proposed correction: {item.coachingIssue.correction}</>}</p>}<ReplyVerificationChanges entry={item}/><SuggestionLearningAttribution value={item.guidance}/>{item.manualTiming&&<p className="record-cost">{item.manualTiming.model} · first chunk {item.manualTiming.firstChunkMs??"—"} ms · full reply {item.manualTiming.fullSuggestionMs??"—"} ms · verification {item.manualTiming.verificationMs??"—"} ms</p>}{recordCompany&&!item.coachingIssue&&<button className="button secondary small" disabled={!brainsReady} onClick={()=>openTeaching(record,item)}>Teach the copilot</button>} {item.sourceSnapshot.map((source,i)=><p key={i}>{source.title}: “{source.text}”</p>)}</div>)}<CoachingDiagnostics entries={record.suggestions||[]}/></details>
            <details className="transcript-details" open={Boolean(record.missingKnowledge?.length)}><summary>Missing knowledge · {record.missingKnowledge?.filter(m=>m.status==="open").length || 0} open</summary>{record.missingKnowledge?.length ? record.missingKnowledge.map(m=><label className="missing-knowledge-item" key={m.id}><input type="checkbox" checked={m.status==="confirmed"} onChange={e=>setCalls(previous=>previous.map(c=>c.id===record.id ? {...c,missingKnowledge:c.missingKnowledge?.map(item=>item.id===m.id ? {...item,status:e.target.checked ? "confirmed" : "open"} : item)} : c))}/><span>{m.fact}</span></label>) : <p>No missing company facts were logged.</p>}</details>
            <details className="transcript-details"><summary>Full transcript <span>{record.turns.length} turns</span></summary>{record.turns.map(t => <div className="record-turn" id={`turn-${t.id}`} key={t.id}><strong>{t.role === "conversation" ? "Call audio" : t.role === "buyer" ? "Buyer" : "You"}</strong><p>{t.text}</p>{t.corrections?.map((correction,index)=><details key={index}><summary>Transcript correction · {new Date(correction.at).toLocaleString()}</summary><del>{correction.originalText}</del><p>{correction.reason}</p></details>)}{recordCompany&&<button className="text-button" onClick={()=>openTeaching(record,undefined,t.id)}>Teach the copilot</button>}{translationLine(t,record)}</div>)}</details>{deleteCallId===record.id?<div role="group" aria-label="Confirm call deletion"><p>Delete “{record.buyer}” from this browser’s call history?</p><div className="button-row"><button className="button secondary small" onClick={()=>setDeleteCallId(null)}>Cancel deletion</button><button className="text-button danger-text" onClick={()=>{setCalls(previous=>previous.filter(call=>call.id!==record.id));setSelectedCall(null);setDeleteCallId(null);}}><Trash2 size={13}/> Confirm delete call</button></div></div>:<button className="text-button danger-text" onClick={()=>setDeleteCallId(record.id)}><Trash2 size={13}/> Delete call</button>}</> : <div className="large-empty"><FileText size={34}/><h2>A clear next step starts with good notes.</h2><p>Select a call to review the conversation, generate a recap, and draft a follow-up.</p></div>}</section>;}
  // Feedback remains company-scoped and inactive until explicit manager Apply.
  // Historical learning records are preserved; never auto-promote them globally.
  const teachingCompany=teachingSelection?manufacturers.find(company=>company.id===teachingSelection.companyId):undefined;
  const title = view === "live" ? "Live assistant" : view === "knowledge" ? "Company knowledge" : view === "brain" ? "Company Brain" : view === "playbook" ? "Sales curriculum" : view === "history" ? "Call history" : "Connection & audio";
  const audioRunning = live || micTest || connecting;
  function coachingPreferences(showStage=false) {
    const stages=Array.from(new Map(CALL_TYPES.flatMap(type=>type.stages).map(stage=>[stage.id,stage])).values());
    return <section className="coaching-preferences card" aria-label="Call coaching preferences"><label className="bilingual-toggle"><input aria-label="Bilingual mode" type="checkbox" checked={bilingual} onChange={e=>setBilingual(e.target.checked)}/><span>中文辅助 <small>English scripts · Chinese coaching</small></span></label>{showStage && <><label className="stage-select">{bilingual ? "当前阶段" : "Current stage"}<select aria-label="Current stage" value={currentStage} onChange={e=>changeStage(e.target.value)}>{stages.map(stage=><option key={stage.id} value={stage.id}>{stage[bilingual ? "zh" : "en"]}</option>)}</select></label><p className="call-target"><strong>Target:</strong> {CALL_TYPES.find(type=>type.id===callType)?.successTarget}<small>Choose the actual outcome when you save the call.</small></p></>}</section>;
  }
  function audioControls() {
    return <section className="audio-quick-controls card" aria-label="Audio input setup">
      <div className="audio-mode-select"><label htmlFor="audio-mode">CALL AUDIO</label><select id="audio-mode" value={audioMode} disabled={audioRunning} onChange={e => { const mode=e.target.value as AudioMode; setAudioMode(mode); setInputGain(mode === "speakerphone" ? 4 : 1); }}><option value="speakerphone">Phone on speakerphone</option><option value="headset">Speaking into a headset</option><option value="computer">Computer call audio · Mac / browser</option></select></div>
      {audioMode === "computer" ? <div className="computer-source"><span>INPUT SOURCE</span><strong>Shared computer audio</strong><small>Buyer · choose in the share picker</small><label htmlFor="rep-mic">YOUR MICROPHONE</label><select id="rep-mic" aria-label="Your microphone" value={deviceId} disabled={audioRunning} onChange={e=>setDeviceId(e.target.value)}><option value="">System default microphone</option>{devices.filter(d=>d.deviceId && d.deviceId!=="default").map(d=><option key={d.deviceId} value={d.deviceId}>{d.label || "Microphone"}</option>)}</select></div> : <div className="audio-device-select"><label htmlFor="audio-device">MICROPHONE</label><select id="audio-device" value={deviceId} disabled={audioRunning} onChange={e => setDeviceId(e.target.value)}><option value="">System default microphone</option>{devices.filter(d => d.deviceId && d.deviceId !== "default").map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || "Microphone (test to see name)"}</option>)}</select></div>}
      <div className="audio-gain"><label htmlFor="input-gain">INPUT BOOST <output htmlFor="input-gain">{inputGain}×</output></label><input id="input-gain" type="range" min="1" max={audioMode==="computer"?"2":"8"} step="0.5" value={inputGain} onChange={e => setInputGain(audioMode==="computer"?normalizeComputerAudioGain(Number(e.target.value)):Number(e.target.value))}/></div>
      <button className="button secondary" onClick={testMic} disabled={live || connecting}>{micTest ? <Square size={15}/> : <Mic size={15}/>} {micTest ? "Stop audio test" : audioMode === "computer" ? "Test computer audio" : "Test phone audio"}</button>
      <div className="input-checks"><div className="test-level" role="meter" aria-label="Audio level after input boost" aria-valuemin={0} aria-valuemax={100} aria-valuenow={audioRunning && !paused ? Math.round(level*100) : 0}><div style={{width:`${audioRunning && !paused ? Math.max(2,level*100) : 0}%`}}/></div><span className={`audio-signal ${audioRunning && !paused ? signal : ""}`}>{paused ? "Paused" : !audioRunning ? "Test before calling" : signal === "quiet" ? "Quiet — check while buyer speaks" : signal === "clipping" ? "Too loud — reduce boost" : "Signal detected"}{audioRunning && !paused ? ` · ${Math.round(decibels)} dBFS` : ""}</span></div>
      <p className="audio-detail">{audioRunning && activeInput ? <>Using <strong>{activeInput}</strong> · {inputDetails}. </> : null}{audioMode === "computer" ? "Computer playback is Buyer; your microphone is You. Use headphones to keep the channels separate. Continue calling through your iPhone line on the Mac." : audioMode === "speakerphone" ? "Use your Mac’s built-in mic or a desk mic beside the phone. Keep the phone on speakerphone; a headset mic may miss the buyer. Adjust boost while the buyer speaks." : "Headset cleanup is on. For a separate phone speaker, switch to Phone on speakerphone."} {micTest ? "This 10-second test stays on your computer." : ""}</p>{audioMode === "computer" && <div className="dual-audio-status"><span>Buyer playback <meter min="0" max="1" value={audioRunning && !paused ? level : 0}/></span><span>You · microphone <meter min="0" max="1" value={audioRunning && !paused ? repLevel : 0}/>{repSpeaking ? " Speaking" : ""}</span></div>}
      {audioMode === "computer" && <MacCallSetup/>}
    </section>;
  }

  if (configured === false && typeof window !== "undefined" && !["127.0.0.1","localhost"].includes(window.location.hostname)) return <div className="connection-gate"><div className="gate-mark"><AudioLines size={31}/></div><div className="eyebrow">TRADE ASSIST · LIVE CONVERSATION COPILOT</div><h1>Open your connected live assistant.</h1><p>This web copy does not have an AI connection. Your approved API key is on your Mac, where the live assistant runs.</p><a className="button primary" href="http://127.0.0.1:5173/" target="_blank" rel="noreferrer">Open live assistant on this Mac <ArrowRight size={16}/></a><p className="gate-help">If it does not open, double-click <strong>Start Trade Assist.command</strong> in your trade-assist folder. It now runs in the background; Terminal can be closed.</p><button className="text-button" onClick={backup}><Download size={14}/> Export any materials saved in this web copy</button><span className="muted">Import that backup in the connected app under Connection & audio.</span></div>;
  return <div className="app-shell">
    <aside className="sidebar">
      <Link className="brand" href="/" aria-label="Trade Assist home"><span className="brand-mark"><AudioLines size={23}/></span><span>trade<span className="brand-light">assist</span><small>YOUR SALES COPILOT</small></span></Link>
      <div className="workspace-label">WORKSPACE <LockKeyhole size={11}/></div>
      <nav aria-label="Main navigation">
        {([{id:"live",label:"Live assistant",icon:Headphones},{id:"knowledge",label:"Company knowledge",icon:BookOpen},{id:"history",label:"Call history",icon:History}] as const).map(item => <button key={item.id} aria-label={item.label} className={`nav-item ${view === item.id ? "active" : ""}`} onClick={() => {setView(item.id);if(item.id==='live')setShowClientList(true);if(item.id==='history'){setHistoryClientId(null);setSelectedCall(null);}}}><item.icon size={18}/><span>{item.label}</span>{item.id === "live" && live && <span className="live-dot"/>}{item.id === "history" && calls.length > 0 && <span className="nav-count">{calls.length}</span>}</button>)}
      </nav>
      <div className="sidebar-divider"/>
      <button className={`nav-item ${view === "brain" ? "active" : ""}`} onClick={()=>setView("brain")}><BookOpen size={17}/><span>Company Brain</span></button>
      <button className={`nav-item ${view === "playbook" ? "active" : ""}`} onClick={()=>setView("playbook")}><Layers3 size={17}/><span>Sales curriculum</span></button>
      <a className="nav-item" href="/regression" target="_blank" rel="noreferrer">Regression lab ↗</a><div className="workspace-label">REPRESENTING <button className="tiny-button" aria-label="Add manufacturer" onClick={() => openModal({type:"manufacturer"})}><Plus size={15}/></button></div>
      <div className="manufacturer-list">{manufacturers.length ? manufacturers.map(m => <button key={m.id} className={`manufacturer-item ${activeId === m.id ? "selected" : ""}`} onClick={() => selectManufacturer(m.id)}><span className="company-avatar">{m.name.slice(0,1).toUpperCase()}</span><span>{m.name}<small>{m.products || "Manufacturer"}</small></span>{activeId === m.id && <Check size={13}/>}</button>) : <button className="add-company" onClick={() => openModal({type:"manufacturer"})}><Plus size={17}/> Add a manufacturer</button>}</div>
      <div className="sidebar-bottom"><div className="sidebar-note"><ShieldCheck size={18}/><strong>Your information. Your voice.</strong><p>Guidance grounded in the materials you provide.</p></div><button aria-label="Connection & audio" className={`nav-item ${view === "settings" ? "active" : ""}`} onClick={() => setView("settings")}><Settings2 size={17}/><span>Connection & audio</span></button><div className="user-chip"><span>ME</span><div>My private workspace<small>English · US business calls</small></div><LockKeyhole size={13}/></div></div>
    </aside>

    <div className="main-shell">
      <header className="topbar"><div className="breadcrumb">Workspace <ChevronRight size={13}/><span>{title}</span></div><div className="topbar-right"><label className="workflow-role">Workspace mode <select aria-label="Workspace mode" value={workflowRole} onChange={event=>setWorkflowRole(event.target.value as TeachingActor)}><option value="manager">Manager</option><option value="salesperson">Salesperson</option></select></label><span className={`connection-pill ${configured ? "ready" : ""}`}><span className="status-dot"/>{configured === null ? "Checking connection" : configured ? "AI ready" : "Open connected app"}</span><button className="icon-button" aria-label="How to use Trade Assist" onClick={() => setShowHelp(true)}><CircleHelp size={18}/></button></div></header>
      <main>
        <div className="page-heading"><div><div className="eyebrow">{view === "live" ? "YOUR LIVE CONVERSATION ASSISTANT" : "YOUR SALES WORKSPACE"}</div><h1>{title}<span className="heading-dot">.</span></h1><p>{view === "live" ? "Listens to your call. Coaches when you ask." : view === "knowledge" ? "Give your copilot the facts it needs to help you sell." : view === "history" ? "Keep the conversation moving, even after you hang up." : "Get ready for your next conversation."}</p></div>{view === "live" && !creatingClient && !showClientList && selectedClient ? <div className="live-header-actions">{live?<button className="button stop" onClick={event=>finishCall(event.timeStamp>1e12?event.timeStamp:performance.timeOrigin+event.timeStamp)} disabled={connecting||repSpeaking||hearing||preparingBrief||uploadingBackground}><Square size={13}/> End conversation</button>:<button className="button secondary" aria-label="New call" title="Start a new conversation with this client" onClick={event=>newCall(event.timeStamp>1e12?event.timeStamp:performance.timeOrigin+event.timeStamp)} disabled={connecting||!!wrapUp||preparingBrief||uploadingBackground}><Plus size={16}/> New call</button>}</div> : view === "knowledge" ? <button className="button primary" onClick={() => openModal({type:current ? "source" : "manufacturer"})}><Plus size={16}/> {current ? "Add source" : "Add manufacturer"}</button> : view === "history" ? <button className="button secondary" onClick={backup}><Download size={16}/> Export backup</button> : null}</div>
        {error && <div className="error-banner" role="alert"><CircleHelp size={17}/><span>{error}{captureDiagnostic?.message===error&&(captureDiagnostic.nativeName||captureDiagnostic.nativeMessage)&&<details className="capture-error-details"><summary>Browser error details</summary><p><strong>{captureDiagnostic.nativeName||"Capture error"}</strong>{captureDiagnostic.nativeMessage?" · "+captureDiagnostic.nativeMessage:""}</p></details>}</span><button className="icon-button" aria-label="Dismiss error" onClick={() => {setError("");setCaptureDiagnostic(null);}}><X size={15}/></button></div>}

        {view === "live" && !creatingClient&&(showClientList||!selectedClient)&&current&&<>{selectedClient&&(turns.length>0||notes.trim()||outsideUpdate.trim()||wrapUp||callConfiguration)&&<section className="card"><p>An unfinished call for {selectedClient.name} is saved.</p><button className="button secondary" onClick={()=>chooseClient(selectedClient.id)}>Resume unfinished call</button></section>}<ClientList company={current} clients={clients} calls={calls} disabled={!brainsReady||live||connecting} onSelect={chooseClient} onCreate={createClient} onAddClient={openNewClientWorkspace} categoryFilter={categoryFilter} onCategoryFilterChange={setCategoryFilter} onRemove={id=>changeClientRemoval(id,true)} onRestore={id=>changeClientRemoval(id,false)} onOpenRemovedHistory={openClientHistory}/></>}
        {view==='live'&&creatingClient&&current&&<CallSetup newClient name={newClientName} onNameChange={setNewClientName} stages={ensureCompanyConfiguration(current).active.stages} stageId={callContext.stageId} onStageChange={changeStage} mainLinePhone={newClientPhone} onMainLinePhoneChange={setNewClientPhone} onContactChange={()=>{}} onSaveContact={()=>{}} onCreate={createWorkspaceClient} onCancelCreate={()=>{setCreatingClient(false);setShowClientList(true);}} disabled={!brainsReady}/>}
        {view === "live" && !current&&<section className="card"><h2>Add the company you represent</h2><p>Then add clients and prepare each conversation.</p><button className="button primary" onClick={()=>openModal({type:'manufacturer'})}>Add manufacturer</button></section>}
        {view === "live" && !creatingClient && !showClientList&&selectedClient&&<>
          {!current && <div className="onboarding-strip"><span className="step-circle">1</span><div><strong>Add your company knowledge.</strong><p>Optional: add product details for specific answers. You can start listening right away.</p></div><button className="text-button" onClick={() => openModal({type:"manufacturer"})}>Add manufacturer <ArrowRight size={16}/></button></div>}
          <section className="client-call-identity card" aria-label="Call details"><div><button className="text-button" disabled={live||connecting} onClick={()=>setShowClientList(true)}>← All clients</button><p><strong>{selectedClient?.name}</strong> · {current?.name}</p><small>Client ID: {selectedClient?.id}</small></div>{restoredTurnCount>0&&<span className="context-help">Resuming the same unfinished call</span>}</section>
          <CallSetup name={selectedClient.name} onNameChange={name=>updateClient(selectedClient.id,item=>updateClientRecord(item,{name}))} stages={callConfiguration?.snapshot.stages||ensureCompanyConfiguration(current!).active.stages} stageId={callContext.stageId} onStageChange={changeStage} client={selectedClient} contactId={activeContactId||undefined} onContactChange={chooseContact} reachViaContactId={reachViaContactId||undefined} onReachViaContactChange={chooseReachVia} onSaveContact={contact=>updateClient(selectedClient.id,item=>upsertClientContact(item,contact))} onCategoryChange={patch=>updateClient(selectedClient.id,item=>updateClientRecord(item,patch))} stageLocked={!!callConfiguration} contactLocked={!!callConfiguration} compact={live||connecting||!!wrapUp} disabled={!brainsReady||live||connecting||preparingBrief||savingCall}/>
          {clientBackground&&<BackgroundForCall standing={selectedStanding} onOpenSourceCall={id=>{setSelectedCall(id);setHistoryClientId(selectedClient.id);setView('history');}} value={clientBackground} onChange={changeClientBackground} outsideUpdate={outsideUpdate} onOutsideUpdateChange={changeOutsideUpdate} onPrepare={()=>prepareClientBrief()} onUpload={uploadClientBackground} onPasteEmail={text=>{const client=clientFor();if(!client)return;const source=parsePastedEmail(text,{companyId:client.companyId,clientId:client.id});const background=backgroundFor(client);changeClientBackground({...background,sources:[...background.sources.filter(item=>item.id!==source.id),source]});}} preparing={preparingBrief} uploading={uploadingBackground} error={briefError} stale={briefStale} reviewed={preparationConfirmed} reviewedAt={callPreparation?.reviewedAt} onReview={confirmPreparation} collapsed={live||connecting||!!wrapUp} disabled={!brainsReady||savingCall} history={reviewHistory} entries={reviewEntries}/>}
          {!live&&!connecting&&turns.length===0&&callContext.stageId==='cold_call'&&<details className="sales-supporting-detail"><summary>Opening wording preference · optional</summary><CallPreparation onDemand opening={openingChoice.text} choice={openingChoice} savedOpening={savedOpening} companyName={current?.name} onChoose={mode=>chooseOpening(chooseOpeningMode(mode,openingChoicesRef.current[current?.id||'general'],openingChoice.text))} onDraftChange={text=>chooseOpening({mode:'custom',text})} onCopy={text=>void copy(text)} onSaveDefault={current?saveOpeningDefault:undefined} onResetDefault={removeOpeningDefault}/></details>}
          {wrapUp?<CallWrapUp value={wrapUp} onChange={setWrapUp} client={selectedClient} saving={savingCall} error={error} onCancel={()=>{setWrapUp(undefined);setWrapUpNextCall(false);}} onSave={async()=>{const startNext=wrapUpNextCall;if(await saveCall({wrapUp,forNewCall:startNext})){if(startNext){savedSessionGuard.current=false;setShowClientList(false);setView('live');setSelectedCall(null);}}}}/>:<>
          <details className="live-context-review"><summary>Audio setup and preferences</summary>
            {coachingPreferences()}
            <PurposeHUD observationOnly purpose={purpose.stage.purpose} items={purpose.checklist} move={purpose.nextMove} state={purpose.conversationState} onCorrect={correctUnderstanding}/>
            {audioControls()}
          </details>
          <div className="feature-cost-strip"><span>Estimated AI cost this call <strong>{formatUsd(callCostUsd)}</strong></span><span>This month <strong>{formatUsd(monthSpend(usageEntries))}</strong>{budget.enabled ? ` / ${formatUsd(budget.monthlyUsd)}` : ""}</span><button className="text-button" onClick={()=>setView("settings")}>Spending controls</button></div>
          <div className="call-grid">
            <section className="conversation card"><div className="panel-header"><div><Radio size={17}/><h2>Conversation</h2></div><div className="conversation-options">{translationToggle()}<span className={`micro-status ${live && !paused ? "on" : ""}`}><span className="status-dot"/>{connecting ? "Connecting" : paused ? "Paused" : live ? "Listening" : "Audio off"}</span></div></div>
              {restoredTurnCount>0 && <p className="restored-call-notice"><History size={13}/><span>Restored draft · {restoredTurnCount} previously saved lines. Starting the assistant continues this call.</span></p>}<div className="transcript" aria-live="polite">{turns.length === 0 && !partial ? <div className="transcript-empty"><div className="empty-audio"><AudioLines size={32}/></div><h3>Room for a good conversation.</h3><p>Your live transcript appears here.<br/>You focus on the person on the other end.</p><div className="audio-explainer"><Phone size={16}/><span>{audioMode === "computer" ? <>Call through FaceTime on your Mac.<br/>Share system audio with the assistant.</> : <>Call on your mobile. Use speakerphone<br/>beside your computer’s microphone.</>}</span></div><button className="text-button" onClick={() => setShowHelp(true)}>How it works <ArrowRight size={13}/></button></div> : turns.map(t => <div className={`transcript-turn ${t.role === "you" ? "your-turn" : ""}`} key={t.id}><div className="turn-meta"><select aria-label="Speaker" value={t.role} onChange={e => correctTurnSpeaker(t.id,e.target.value as Turn["role"])}><option value="conversation">Call audio</option><option value="buyer">Buyer</option><option value="you">You</option></select><time>{nowLabel(t.at)}</time></div><p>{t.text}</p>{t.transcriptionUncertainty&&<small role="status" className="transcript-excluded">Recognition uncertain: {t.transcriptionUncertainty.message} Original recognition retained; this is not a confirmed call fact.</small>}{isTranscriptionPromptEcho(t.text) && <small className="transcript-excluded">Transcription prompt echo · excluded from guidance</small>}{translationLine(t)}</div>)}{repPartial && <div className="transcript-turn partial your-turn"><div className="turn-meta">You · transcribing microphone…</div><p>{repPartial}</p></div>}{partial && <div className="transcript-turn partial"><div className="turn-meta">{audioMode === "computer" ? "Buyer · transcribing playback…" : "Transcribing…"}</div><p>{partial}</p></div>}<div ref={transcriptEnd}/></div>
              <form className="manual-entry" onSubmit={submitManual}><div className="manual-heading"><span>Or add what was said</span><select aria-label="Speaker for typed message" value={manualRole} onChange={e => setManualRole(e.target.value as Turn["role"])}><option value="buyer">Buyer</option><option value="you">You</option><option value="conversation">Call audio</option></select></div><div className="manual-input"><input aria-label="What was said" value={manualText} maxLength={6000} onChange={e => setManualText(e.target.value)} placeholder="Add what either person said…"/><button type="submit" aria-label="Add message" disabled={!manualText.trim() || !preparationConfirmed}><ArrowRight size={17}/></button></div></form>
              <div className="call-controls"><div className="audio-meter" aria-label={`Call audio level ${Math.round(level*100)} percent`}>{Array.from({length:13},(_,i) => <i key={i} style={{height:`${Math.round(8+Math.sin(i*1.8)**2*17)}px`,opacity:live && !paused && level > i/15 ? 1 : .2}}/>)}</div><span className="call-clock">{durationText(elapsed)}</span>{live ? <><button className="icon-button bordered" aria-label={paused ? "Resume assistant audio" : "Pause assistant audio"} onClick={togglePause}>{paused ? <Play size={16}/> : <Pause size={16}/>}</button><button className="button stop" onClick={stopAudio}><Square size={13} fill="currentColor"/> Stop listening</button></> : <button className="button primary" onClick={startListening} disabled={connecting || micTest || !configured || !preparationConfirmed}>{connecting ? <Loader2 size={16} className="spin"/> : <Mic size={16}/>} {connecting ? "Connecting…" : "Start listening"}</button>}</div>
            </section>

            <div className="guidance-column"><section className="request-coaching card" aria-label="Coaching on demand"><div className="request-coaching-action"><button type="button" className="button primary suggest-next-move" aria-keyshortcuts="Alt+Enter" onClick={requestNextMove} disabled={!configured||!preparationConfirmed||!brainsReady||!!queuedRequest}>{thinking?<Loader2 size={18} className="spin"/>:<Sparkles size={18}/>} Suggest next move</button><span className="shortcut-hint"><kbd>Alt</kbd> + <kbd>Enter</kbd><small>⌥ Enter on Mac · outside text fields</small></span></div>{queuedRequest?<div className="queued-coaching-request"><p role="status">{queuedRequest.message}</p><div><button type="button" className="button secondary small" onClick={suggestNow}>Suggest now</button><button type="button" className="text-button" onClick={cancelQueuedCoaching}>Cancel</button></div></div>:<p>{thinking?'Generating from your request. Click again to use the latest conversation.':'Request an opening or guidance at any point. Listening continues independently.'}</p>}<details className="current-coaching-objective"><summary>Current objective · {selectedManagerStage?.name||purpose.stage.name}</summary><p>{selectedManagerStage?.objective||purpose.stage.purpose}</p></details></section><BuyerAudioRecovery issue={buyerAudioIssue} onConfirm={()=>liveSession.current?.confirmBuyerAudio()}/><LiveCoachingCard waitingForBuyer={!!queuedRequest} guidance={guidance} guidanceId={guidanceId} guidanceAt={guidanceAt} pendingBuyerText={pendingBuyerText} suggestions={suggestions} thinking={thinking} checkingFacts={checkingFacts} liveDraft={liveDraft} bilingual={bilingual} latency={latency} liveTiming={liveTiming} onReplyPaint={recordLiveReplyPaint} currentStage={currentStage} repSpeaking={repSpeaking} configured={configured} onCopy={text=>{if(text || guidance)void copy(text || guidance!.say);}} onFeedback={feedbackSuggestion} onEdit={saveReplyEdit} onOpening={requestNextMove}/>
            <details className="evidence-card card"><summary>Company sources and facts to confirm · {guidance?.evidence.length || 0}</summary><div className="panel-header"><div><BookOpen size={16}/><h2>Backed by your knowledge</h2></div><span className="count-badge">{guidance?.evidence.length || 0}</span></div><div className="evidence-body">{guidance?.evidence.length ? guidance.evidence.map((e,i) => <button className="evidence-item" key={i} onClick={() => { if (e.sourceId === "company-profile") openModal({type:"manufacturer",manufacturer:current}); else { const source=current?.sources.find(s => s.id === e.sourceId); if(source) openModal({type:"source",source}); } }}><div><FileText size={14}/><strong>{knowledgeFor(current!).find(s => s.id === e.sourceId)?.title || "Source"}</strong><ChevronRight size={13}/></div><p>“{e.quote}”</p></button>) : <div className="subtle-empty"><Layers3 size={23}/><p>{current ? "General sales move only — no product facts claimed." : "Add company and product information to ground your suggestions."}</p></div>}{guidance?.caution && <div className="caution"><CircleHelp size={15}/><p>{guidance.caution}</p></div>}{guidance && guidance.missing.length > 0 && <div className="missing-facts"><span>DETAILS TO CONFIRM</span>{guidance.missing.map(m => <p key={m}>· {m}</p>)}</div>}</div></details>
            </div>
          </div>
          {!!captureWarnings.length&&<div className="error-banner" role="status">{captureWarnings.join(" ")}</div>}
          <section className="sales-session-finish"><details><summary>Notes during this conversation · optional</summary><textarea aria-label="Call notes" value={notes} onChange={event=>setNotes(event.target.value)} maxLength={20000} placeholder="Useful details to keep for wrap-up"/></details><button className="button secondary" onClick={event=>finishCall(event.timeStamp>1e12?event.timeStamp:performance.timeOrigin+event.timeStamp)} disabled={connecting||repSpeaking||hearing||preparingBrief||uploadingBackground}><CheckCircle2 size={15}/> End conversation & review</button></section>
          </>}
          <div className="workspace-footer"><span><LockKeyhole size={12}/> Materials and transcripts saved in this browser</span><span>{audioMode === "computer" ? "Computer audio" : audioMode === "headset" ? "Headset mode" : "Speakerphone mode"} <span>·</span> English <span>·</span> You do the talking</span></div>
        </>}

        {teachingSelection&&teachingCompany&&<TeachCopilot key={teachingSelection.proposalId||[teachingSelection.companyId,teachingSelection.moment.suggestionId,teachingSelection.moment.at].join(':')} company={teachingCompany} moment={teachingSelection.moment} actorRole={workflowRole} initialProposal={ensureCompanyConfiguration(teachingCompany).teaching?.find(item=>item.id===teachingSelection.proposalId)} onSaveConfiguration={configuration=>saveTeachingConfiguration(teachingCompany.id,configuration)} onApplyClientMemory={applyClientTeaching} onApplyTranscriptCorrection={applyTranscriptTeaching} onClose={()=>setTeachingSelection(undefined)}/>}
        {view === "brain" && (current?<CompanyBrainPanel key={current.id} company={current} brain={ensureCompanyBrain(current)} actorRole={workflowRole} onReviewTeaching={id=>reviewTeaching(current,id)} disabled={!brainsReady} busy={brainBusy} onChange={brain=>updateCompanyBrain(current.id,()=>brain)} onDraft={()=>void draftBrainFacts()} onPromote={pair=>void promoteBrainPair(pair)} onHistory={()=>{setHistoryClientId(null);setSelectedCall(null);setView("history");}} onCoaching={()=>setView("playbook")} onKnowledge={()=>setView("knowledge")} onUpload={()=>{setView("knowledge");openModal({type:"source"});}}/>:<section className="card"><div className="panel-header"><h2>Add a company before building its Brain.</h2><button className="button primary" onClick={()=>openModal({type:"manufacturer"})}>Add manufacturer</button></div></section>)}
        {view === "playbook" && <SalesCurriculum/>}
        {view === "knowledge" && <div className="knowledge-layout"><section className="card company-card"><div className="panel-header"><div><Layers3 size={17}/><h2>{current ? current.name : "Your manufacturer"}</h2></div>{current && <button className="text-button" disabled={live || connecting} onClick={() => openModal({type:"manufacturer",manufacturer:current})}>Edit profile</button>}</div>{current ? <div className="company-profile"><span className="category-label">{current.products || "Product category not added"}</span><p>{current.introduction || "Add a company description, capabilities, and approved selling points in Edit profile."}</p><div className="profile-stats"><div><strong>{current.sources.length}</strong><span>source documents</span></div><div><strong>{knowledgeFor(current).reduce((n,s) => n+s.text.length,0).toLocaleString()}</strong><span>characters of knowledge</span></div></div></div> : <div className="large-empty"><BookOpen size={34}/><h2>Give your copilot something to work with.</h2><p>Add a manufacturer, then paste product details or upload your materials.</p><button className="button primary" onClick={() => openModal({type:"manufacturer"})}><Plus size={16}/> Add your first manufacturer</button></div>}</section>{current && <><section className="card"><div className="panel-header"><h2>Company Brain v1</h2><button className="button secondary small" onClick={()=>setView("brain")}>Open Company Brain</button></div></section>{driveImportCard()}<div className="knowledge-search"><Search size={16}/><input aria-label="Search company memory" placeholder="Search your saved company memory…" value={knowledgeQuery} onChange={e=>setKnowledgeQuery(e.target.value)}/></div><div className="section-heading"><div><h2>Source library</h2><p>Review and update these whenever your terms change.</p></div><span>{current.sources.length} sources</span></div><div className="source-grid">{current.sources.filter(s=>!knowledgeQuery || `${s.title} ${s.text}`.toLowerCase().includes(knowledgeQuery.toLowerCase())).map(s => <article className="card source-card" key={s.id}><span className="source-icon"><FileText size={22}/></span><h3>{s.title}</h3>{s.originUrl && <div className="linked-source"><a href={s.originUrl} target="_blank" rel="noreferrer">Google Drive ↗</a><span>Read {new Date(s.syncedAt || s.addedAt).toLocaleDateString()}</span><button className="text-button" disabled={driveLoading || live || connecting} onClick={()=>void previewDrive(s.originUrl)}>Refresh</button></div>}<p>{s.text.slice(0,180)}{s.text.length > 180 ? "…" : ""}</p><div className="source-meta"><span>{s.text.length.toLocaleString()} characters · {new Date(s.addedAt).toLocaleDateString()}</span><button className="text-button" disabled={live || connecting} onClick={() => openModal({type:"source",source:s})}>Review <ArrowRight size={13}/></button></div></article>)}<button className="source-add" disabled={live || connecting} onClick={() => openModal({type:"source"})}><Plus size={24}/><strong>Add a source</strong><span>Paste details or upload a document</span></button></div><div className="info-card"><ShieldCheck size={21}/><div><strong>Useful details make useful suggestions.</strong><p>Include specifications, minimum orders, prices with currencies and units, lead times, certifications, sample policies, and negotiation limits. Keep dates and conditions attached to commercial terms.</p></div></div></>}</div>}

        {view==='history'&&!historyClient&&!record&&calls.some(call=>!manufacturers.some(company=>company.id===call.manufacturerId))&&<section className="card"><h2>Preserved conversations without a selling-company profile</h2><p>The original names, IDs and transcripts remain available for review.</p>{calls.filter(call=>!manufacturers.some(company=>company.id===call.manufacturerId)).map(call=><button className="button secondary" key={call.id} onClick={()=>setSelectedCall(call.id)}>{call.buyer} · {call.manufacturerName} · {new Date(call.startedAt).toLocaleDateString()}</button>)}</section>}
        {view==='history'&&current&&!historyClient&&!record&&<ClientList company={current} clients={clients} calls={calls} mode="history" disabled={!brainsReady||live||connecting} onSelect={openClientHistory} onCreate={createClient} onAddClient={openNewClientWorkspace} categoryFilter={categoryFilter} onCategoryFilterChange={setCategoryFilter} onRemove={id=>changeClientRemoval(id,true)} onRestore={id=>changeClientRemoval(id,false)} onOpenRemovedHistory={openClientHistory} unassociatedCalls={calls.filter(call=>call.manufacturerId===activeId&&(!call.clientId||call.legacyClientAssociation?.status==='needs_review'))} onOpenCall={id=>{setSelectedCall(id);setHistoryClientId(calls.find(call=>call.id===id)?.clientId||null);}} onReassociate={associateCall}/>}
        {view==='history'&&historyClient&&<ClientHistory client={historyClient} calls={calls} selectedCallId={selectedCall} disabled={!brainsReady||live||connecting} onRemove={id=>changeClientRemoval(id,true)} onRestore={id=>changeClientRemoval(id,false)} onSelectCall={id=>{setSelectedCall(id);setHistoryContactId(calls.find(call=>call.id===id)?.contactId||'');}} onStartCall={recordedAt=>{if(context.current.clientId===historyClient.id)newCall(recordedAt);else chooseClient(historyClient.id);}} onBack={()=>{setHistoryClientId(null);setSelectedCall(null);}}><details className="card"><summary>Current client background and open matters</summary>{clientPreparationPanel(historyClient,true)}</details>{callReview()}</ClientHistory>}
        {view==='history'&&!historyClient&&record&&<><button className="text-button" onClick={()=>{setHistoryClientId(null);setSelectedCall(null);}}>← All clients</button>{callReview()}</>}


        {view === "settings" && <div className="settings-layout"><section className="card settings-card"><div className="panel-header"><div><Activity size={18}/><h2>AI connection</h2></div><span className={`connection-pill ${configured ? "ready" : ""}`}><span className="status-dot"/>{configured ? "Connected" : "Not connected"}</span></div><p>{configured ? "Your API key stays on the server. Company materials and conversation text are sent to OpenAI when you request guidance; live audio is sent only while listening." : "This server does not have the API key configured. Use the local version of Trade Assist where your key was securely saved."}</p><button className="button secondary small" onClick={() => { requestJSON<{configured:boolean}>("/api/status").then(s => {setConfigured(s.configured);notify(s.configured ? "AI connection is configured" : "No AI connection on this server");}).catch(e => setError(e.message)); }}><RefreshCw size={14}/> Check connection</button></section><CallContextCard value={callContext} stages={callStages} live={live || connecting} configurationVersion={callConfiguration?.version} managed={!!current} stageLocked={!!callConfiguration} onChange={updateCallContext}/><PurposeHUD observationOnly purpose={purpose.stage.purpose} items={purpose.checklist} move={purpose.nextMove} state={purpose.conversationState} onCorrect={correctUnderstanding}/>{audioControls()}{coachingPreferences()}<section className="card settings-card translation-settings"><div className="panel-header"><h2>Buyer transcript translation</h2>{translationToggle()}</div><p>Show Mandarin underneath completed Buyer lines and mixed Call audio lines. Your separately labeled You lines stay in English. Translations count toward your spending limits.</p></section><VoiceSettings voice={voice} onChange={setVoice} disabled={live || connecting}/><SpendingPanel settings={budget} onChange={setBudget} callUsd={callCostUsd} entries={usageEntries}/><section className="card settings-card"><div className="panel-header"><div><LockKeyhole size={18}/><h2>Your workspace data</h2></div><span className="category-label">Saved in this browser</span></div><p>Manufacturer profiles, sources, transcripts, and notes stay in this browser. Raw call audio is not saved by this app. Export a backup to move your workspace or protect against browser data being cleared.</p><div className="button-row"><button className="button secondary" onClick={backup}><Download size={15}/> Export backup</button><button className="button secondary" onClick={() => importInput.current?.click()}><Upload size={15}/> Import backup</button></div><input ref={importInput} hidden type="file" accept=".json" onChange={e => {void restore(e.target.files?.[0]);e.target.value="";}}/></section><section className="info-card"><Headphones size={22}/><div><strong>For your first real call</strong><p>Add and review your materials, request an opening with Suggest next move, and test the selected input. Computer mode keeps buyer playback and your microphone in separate labeled channels. Other microphone modes mix speakers; you can correct transcript labels. Reconnect if your network interrupts listening.</p></div></section></div>}
        {view==="live"&&manualTrace&&<details className="card manual-timing" data-testid="manual-latency" data-trace={JSON.stringify(manualTrace)}><summary>Manual text timing · {manualTrace.model}</summary><p>Submit → first chunk: {manualTrace.firstChunkMs??"…"} ms · full reply: {manualTrace.fullSuggestionMs??"…"} ms · verification finished: {manualTrace.verificationMs??"…"} ms · {manualTrace.source}</p><small>Measured when reply text reaches the browser DOM. Verification does not count as buyer speech.</small></details>}
      </main>
    </div>

    {modal && <div className="modal-backdrop" onMouseDown={e => {if(e.target === e.currentTarget && !extracting) setModal(null);}}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div className="modal-header"><div><span className="eyebrow">YOUR KNOWLEDGE BASE</span><h2 id="modal-title">{modal.type === "manufacturer" ? modal.manufacturer ? "Edit manufacturer" : "Add a manufacturer" : modal.source ? "Review source" : "Add a source"}</h2></div><button className="icon-button" aria-label="Close dialog" onClick={() => setModal(null)} disabled={extracting}><X size={19}/></button></div><form onSubmit={saveForm}><label>{modal.type === "manufacturer" ? "Manufacturer name" : "Source title"}<input autoFocus required maxLength={200} value={formName} onChange={e => setFormName(e.target.value)} placeholder={modal.type === "manufacturer" ? "e.g. Your manufacturer’s company name" : "e.g. Product specifications — October 2026"}/></label>{modal.type === "manufacturer" && <label>What do they manufacture?<input maxLength={2000} value={formProducts} onChange={e => setFormProducts(e.target.value)} placeholder="Product categories or the range you represent"/></label>}{modal.type === "source" && <><input ref={sourceInput} type="file" hidden accept=".pdf,.txt,.md,.csv,.tsv,.json" onChange={e => {void loadSource(e.target.files?.[0]);e.target.value="";}}/><button type="button" className="upload-area" disabled={extracting} onClick={() => sourceInput.current?.click()} onDragOver={e => e.preventDefault()} onDrop={e => {e.preventDefault();void loadSource(e.dataTransfer.files[0]);}}>{extracting ? <Loader2 size={23} className="spin"/> : <Upload size={23}/>}<strong>{extracting ? "Extracting PDF for your review…" : "Upload a document or drop it here"}</strong><span>PDF, TXT, Markdown, CSV, TSV, JSON · up to 8 MB</span></button></>}<label>{modal.type === "manufacturer" ? "Company facts and approved selling points" : "Source text — review before saving"}<textarea className="source-textarea" required={modal.type === "source"} maxLength={100_000} value={formText} onChange={e => setFormText(e.target.value)} placeholder={modal.type === "manufacturer" ? "Describe the company and what you are authorized to say about it. You can add detailed product documents next." : "Paste specifications, prices with units and currencies, minimum orders, lead times, certifications, and relevant conditions…"}/></label><div className="form-note"><ShieldCheck size={14}/><span>{modal.type === "source" ? "New or changed source text goes to a Brain draft. Review facts and Apply before new calls can use it." : "Company claims come from your saved materials. Add facts you can stand behind."}</span></div>{error && <p className="form-error" role="alert">{error}</p>}<div className="modal-footer">{modal.type === "source" && modal.source && <button type="button" className="text-button danger-text" onClick={() => { const sourceId = modal.source!.id; if(window.confirm("Delete this source? It will no longer be available to the copilot.")) {setManufacturers(previous => previous.map(m => m.id === activeId ? {...m,sources:m.sources.filter(s => s.id !== sourceId)} : m));setModal(null);setGuidance(null);} }}><Trash2 size={14}/> Delete</button>}<span/><button type="button" className="button secondary" onClick={() => setModal(null)} disabled={extracting}>Cancel</button><button className="button primary" type="submit" disabled={live || connecting || extracting || !formName.trim() || (modal.type === "source" && !formText.trim())}><Check size={15}/> Save {modal.type === "manufacturer" ? "manufacturer" : "source"}</button></div></form></section></div>}

    {showHelp && <div className="modal-backdrop"><section className="modal help-modal" role="dialog" aria-modal="true" aria-labelledby="help-title"><div className="modal-header"><div><span className="eyebrow">A CALMER WAY TO COLD CALL</span><h2 id="help-title">You talk. Your copilot helps.</h2></div><button className="icon-button" aria-label="Close help" onClick={() => setShowHelp(false)}><X size={19}/></button></div><div className="help-steps">{[{title:"Prepare your client",text:"Choose a client and manager-configured stage. Add background, websites or emails, prepare a brief if useful, and confirm the current context.",icon:BookOpen},{title:"Make your call",text:"Choose Computer call audio to use FaceTime cellular calling through your iPhone on the Mac. Follow the setup under Call audio. Your carrier line keeps your number. Speakerphone mode is also available.",icon:Phone},{title:"Start listening",text:"Share system audio for computer calls, or allow microphone access for speakerphone mode. Listening updates the conversation only. Click Suggest next move or press Alt+Enter whenever you want guidance, even before anyone speaks. You can pause or stop listening at any time.",icon:Mic},{title:"Review and save",text:"End the conversation, review its recap, and confirm memory or contact updates. Save call keeps this session in the client’s timeline. Your workspace is saved in this browser.",icon:ArrowRight}].map((step,i) => <div className="help-step" key={step.title}><span>{i+1}</span><div><h3>{step.title}</h3><p>{step.text}</p></div><step.icon size={20}/></div>)}</div><div className="help-note">Trade Assist assists your existing phone call. Computer audio captures playback; it does not hear your microphone. Microphone modes mix speakers. You dial through FaceTime or your calling app; Trade Assist does not dial or inject audio.</div><button className="button primary" onClick={() => setShowHelp(false)}>Got it <ArrowRight size={15}/></button></section></div>}
    {toast && <div className="toast" role="status"><CheckCircle2 size={17}/>{toast}</div>}
  </div>;
}
