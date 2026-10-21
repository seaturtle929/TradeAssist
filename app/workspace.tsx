"use client";

import { useEffect, useRef, useState } from "react";
import { Activity, ArrowDownToLine, ArrowRight, AudioLines, BookOpen, Check, CheckCircle2, ChevronDown, ChevronRight, CircleHelp, Clipboard, Copy, Download, FileText, Headphones, History, Layers3, Loader2, LockKeyhole, Mic, MicOff, MoreHorizontal, Pause, Phone, Play, Plus, Radio, RefreshCw, Search, Settings2, ShieldCheck, Sparkles, Square, Trash2, Upload, X } from "lucide-react";
import { parseLiveDraft } from "../lib/live";
import { audioSignal, captureComputerAudio, createMicrophonePipeline, microphoneConstraints, type AudioMode } from "../lib/audio";
import { GOALS, knowledgeFor, type Manufacturer, type Source, type Turn, type Guidance, type CallRecord, type BuyerBrief } from "../lib/trade";
import { DEFAULT_VOICE, type VoiceProfile } from "../lib/sales-playbook";
import { DEFAULT_BUDGET, budgetDecision, monthSpend, formatUsd, priceRealtimeUsage, priceTranscriptionUsage, type UsageEntry, type BudgetSettings } from "../lib/costs";
import { selectKnowledge } from "../lib/knowledge";
import { BuyerBriefInput, VoiceProfileInput } from "../lib/coach";
import { BuyerResearchPanel, VoiceSettings, SpendingPanel } from "../components/sales-panels";
import { MacCallSetup } from "../components/mac-call-setup";

type View = "live" | "knowledge" | "history" | "settings";
type Modal = { type: "manufacturer"; manufacturer?: Manufacturer } | { type: "source"; source?: Source } | null;
const STORAGE = "trade-assist-v1";
const AUDIO_STORAGE = "trade-assist-audio-v1";
const FEATURE_STORAGE = "trade-assist-features-v1";
const USAGE_STORAGE = "trade-assist-usage-v1";
const uid = () => crypto.randomUUID();
const durationText = (seconds: number) => `${Math.floor(seconds / 60).toString().padStart(2,"0")}:${Math.floor(seconds % 60).toString().padStart(2,"0")}`;
const nowLabel = (at: number) => new Date(at).toLocaleTimeString("en-US", { hour:"numeric", minute:"2-digit" });
function downloadFile(name: string, contents: string, type = "text/plain") {
  const url = URL.createObjectURL(new Blob([contents], { type })); const anchor = document.createElement("a"); anchor.href = url; anchor.download = name; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function requestJSON<T>(path: string, body?: unknown, signal?: AbortSignal, onCharges?: (charges:UsageEntry[])=>void): Promise<T> {
  const response = await fetch(path, { method: body === undefined ? "GET" : "POST", headers: body === undefined ? {} : { "Content-Type":"application/json" }, ...(body === undefined ? {} : { body:JSON.stringify(body) }), signal });
  const data = await response.json().catch(() => ({ error: "The server returned an unreadable response." })) as T & {error?: string;_charges?:UsageEntry[]};
  if(Array.isArray(data._charges))onCharges?.(data._charges);
  if (!response.ok) throw new Error(data.error || "The request failed."); return data;
}

export default function Workspace() {
  const [view, setView] = useState<View>("live");
  const [manufacturers, setManufacturers] = useState<Manufacturer[]>([]);
  const [activeId, setActiveId] = useState("");
  const [calls, setCalls] = useState<CallRecord[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [modal, setModal] = useState<Modal>(null);
  const [buyer, setBuyer] = useState("");
  const [goal, setGoal] = useState(GOALS[0]);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [notes, setNotes] = useState("");
  const [startedAt, setStartedAt] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [live, setLive] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [paused, setPaused] = useState(false);
  const [partial, setPartial] = useState("");
  const [hearing, setHearing] = useState(false);
  const [guidance, setGuidance] = useState<Guidance | null>(null);
  const [thinking, setThinking] = useState(false);
  const [latency, setLatency] = useState(0);
  const [liveDraft, setLiveDraft] = useState(false);
  const [manualText, setManualText] = useState("");
  const [manualRole, setManualRole] = useState<Turn["role"]>("buyer");
  const [selectedCall, setSelectedCall] = useState<string | null>(null);
  const [summarizing, setSummarizing] = useState(false);
  const [query, setQuery] = useState("");
  const [outcome, setOutcome] = useState("Follow-up needed");
  const [voice, setVoice] = useState<VoiceProfile>(DEFAULT_VOICE);
  const [buyerBrief, setBuyerBrief] = useState<BuyerBrief|null>(null);
  const [budget, setBudget] = useState<BudgetSettings>(DEFAULT_BUDGET);
  const [usageEntries,setUsageEntries] = useState<UsageEntry[]>([]);
  const [callCostUsd,setCallCostUsd] = useState(0);
  const [replyEdit,setReplyEdit] = useState<string|null>(null);
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
  const responsePending = useRef(false);
  const typedReplyPending = useRef(false);
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
  const context = useRef({ current, buyer, goal, turns, voice, buyerBrief });
  context.current = { current, buyer, goal, turns, voice, buyerBrief };
  const draft = useRef({ startedAt, elapsed, notes, outcome, buyer, goal, turns, activeId,callCostUsd,buyerBrief });
  draft.current = { startedAt, elapsed, notes, outcome, buyer, goal, turns, activeId,callCostUsd,buyerBrief };

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE);
      if (raw) {
        const saved = JSON.parse(raw);
        setManufacturers(saved.manufacturers || []); setCalls(saved.calls || []); setActiveId(saved.activeId || "");
        if (saved.draft?.turns?.length) {
          setTurns(saved.draft.turns); setBuyer(saved.draft.buyer || ""); setGoal(saved.draft.goal || GOALS[0]); setNotes(saved.draft.notes || "");
          setStartedAt(saved.draft.startedAt || 0); setElapsed(saved.draft.elapsed || 0); setOutcome(saved.draft.outcome || "Follow-up needed");
          setToast("Your unfinished call was restored. The microphone is off.");
        }
      }
      const audio = JSON.parse(localStorage.getItem(AUDIO_STORAGE) || "null");
      if (audio) { setDeviceId(typeof audio.deviceId === "string" ? audio.deviceId : ""); setAudioMode(audio.mode === "computer" ? "computer" : audio.mode === "headset" ? "headset" : "speakerphone"); setInputGain(Math.min(8,Math.max(1,Number(audio.gain) || (audio.mode === "speakerphone" ? 4 : 1)))); }
      const features=JSON.parse(localStorage.getItem(FEATURE_STORAGE) || "null");
      if(features) { if(features.voice)setVoice({...DEFAULT_VOICE,...features.voice}); if(features.buyerBrief)setBuyerBrief(features.buyerBrief); if(features.buyer)setBuyer(features.buyer); recentReplies.current=Array.isArray(features.recentReplies) ? features.recentReplies.slice(-12) : []; }
      const usage=JSON.parse(localStorage.getItem(USAGE_STORAGE) || "null");
      if(usage) { if(usage.budget)setBudget({...DEFAULT_BUDGET,...usage.budget}); if(Array.isArray(usage.entries))setUsageEntries(usage.entries.filter((e:UsageEntry)=>typeof e.id==="string"&&Number.isFinite(e.usd)&&e.usd>=0)); setCallCostUsd(Math.max(0,Number(usage.callUsd)||0)); }
    } catch { setError("Your saved workspace could not be read. Import a backup or add your materials again."); }
    setHydrated(true);
    requestJSON<{configured:boolean}>("/api/status").then(data => setConfigured(data.configured)).catch(e => { setConfigured(false); setError(e.message); });
    return () => { audioGeneration.current++; captureBusy.current=false; const oldPeer=peer.current;peer.current=null;oldPeer?.close(); if(callHandle.current)void fetch("/api/session/stop",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({handle:callHandle.current}),keepalive:true}).catch(()=>{}); callHandle.current=""; stream.current?.getTracks().forEach(t => t.stop()); rawStream.current?.getTracks().forEach(t => t.stop()); void audioContext.current?.close(); cancelAnimationFrame(frame.current); controller.current?.abort(); if (timer.current) clearTimeout(timer.current); if (testTimer.current) clearTimeout(testTimer.current); if (stopTimer.current) clearTimeout(stopTimer.current); };
  }, []);
  useEffect(()=>{
    if(!hydrated)return;
    try { localStorage.setItem(FEATURE_STORAGE,JSON.stringify({voice,buyerBrief,buyer,recentReplies:recentReplies.current})); localStorage.setItem(USAGE_STORAGE,JSON.stringify({budget,entries:usageEntries,callUsd:callCostUsd})); }
    catch { setError("Your settings or usage could not be saved. Export a backup before closing this page."); }
  },[hydrated,voice,buyerBrief,buyer,budget,usageEntries,callCostUsd]);
  useEffect(()=>{
    if(!hydrated || !live)return;
    const decision=budgetDecision(budget,callCostUsd,usageEntries);
    if(!decision.allowed) {stopAudio();setError(decision.reason+" The AI assistant stopped; your phone call can continue.");}
  },[budget,callCostUsd,usageEntries,hydrated,live]);
  useEffect(() => {
    if (!hydrated) return;
    try { localStorage.setItem(AUDIO_STORAGE,JSON.stringify({deviceId,mode:audioMode,gain:inputGain})); } catch { /* Workspace storage reports errors separately. */ }
    if (gainNode.current && audioContext.current) gainNode.current.gain.setTargetAtTime(inputGain,audioContext.current.currentTime,.03);
  }, [hydrated,deviceId,audioMode,inputGain]);
  useEffect(() => {
    const media = navigator.mediaDevices;
    if (!media?.enumerateDevices) return;
    const refresh = () => { void media.enumerateDevices().then(all => setDevices(all.filter(d => d.kind === "audioinput"))).catch(() => {}); };
    refresh(); media.addEventListener("devicechange",refresh); return () => media.removeEventListener("devicechange",refresh);
  }, []);
  useEffect(() => {
    if (!hydrated) return;
    try { localStorage.setItem(STORAGE, JSON.stringify({ version:1, manufacturers, calls, activeId, draft: draft.current })); }
    catch { setError("Browser storage is full or unavailable. Export a backup before closing this page."); }
  }, [hydrated, manufacturers, calls, activeId, turns, notes, buyer, goal, elapsed, outcome, startedAt,callCostUsd,buyerBrief]);
  useEffect(() => { if (toast) { const t = setTimeout(() => setToast(""), 4000); return () => clearTimeout(t); } }, [toast]);
  useEffect(() => { if (!live || paused) return; const t = setInterval(() => setElapsed(n => n+1), 1000); return () => clearInterval(t); }, [live, paused]);
  useEffect(() => { const container = transcriptEnd.current?.parentElement; if (container && (turns.length || partial)) container.scrollTop = container.scrollHeight; }, [turns, partial]);
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
    const state=spendState.current, document=path==="/api/extract" || path==="/api/drive";
    const decision=budgetDecision(document ? {...state.budget,perCallUsd:Number.MAX_VALUE} : state.budget,document ? 0 : state.callUsd,state.entries,path==="/api/research" ? .08 : document ? .1 : .02);
    if(!decision.allowed)throw new Error(decision.reason+" Adjust limits in Connection & audio to continue.");
    return requestJSON<T>(path,body,signal,charges=>recordCharges(charges,generation===callGeneration.current && (body as {mode?:string}|undefined)?.mode!=="summary"));
  }
  function openModal(value: Modal) {
    setError(""); setModal(value);
    if (value?.type === "manufacturer") { setFormName(value.manufacturer?.name || ""); setFormProducts(value.manufacturer?.products || ""); setFormText(value.manufacturer?.introduction || ""); }
    else { setFormName(value?.source?.title || ""); setFormText(value?.source?.text || ""); }
  }
  async function copy(text: string) { try { await navigator.clipboard.writeText(text); notify("Copied to clipboard"); } catch { setError("Copy was unavailable. Select the text and copy it manually."); } }
  function payload(mode: string, conversation: Turn[], manufacturer = context.current.current, targetBuyer = context.current.buyer, targetGoal = context.current.goal) {
    manufacturer ||= {id:"general",name:"Your company",products:"",introduction:"",sources:[]};
    const query=conversation.slice(-5).map(t=>t.text).join(" ")+" "+manufacturer.products;
    return { mode, manufacturer: { name:manufacturer.name, products:manufacturer.products }, sources:selectKnowledge(knowledgeFor(manufacturer),query), buyer:targetBuyer, goal:targetGoal, voice:context.current.voice,buyerBrief:mode==="summary" ? null : context.current.buyerBrief,recentReplies:recentReplies.current.slice(-12), turns:conversation.slice(-300).map(t => ({ role:t.role, text:t.text.slice(0,6000) })) };
  }
  async function coach(conversation = context.current.turns, mode = "coach") {
    controller.current?.abort(); const aborter = new AbortController(); controller.current = aborter;
    const id = ++seq.current; setThinking(true); setError(""); const began = performance.now();
    try { const result = await billableJSON<Guidance>("/api/coach", payload(mode, conversation), aborter.signal); if (id === seq.current) { setGuidance(result); recentReplies.current=[...recentReplies.current,result.say].slice(-12);setLiveDraft(false); setLatency(performance.now() - began); } }
    catch (e) { if (!(e instanceof DOMException && e.name === "AbortError") && id === seq.current) setError(e instanceof Error ? e.message : "Could not generate guidance."); }
    finally { if (id === seq.current) setThinking(false); }
  }
  function addTurn(text: string, role: Turn["role"], id = uid(), at = Date.now(), generate = true) {
    if (!text.trim()) return;
    const existing = context.current.turns;
    const next = existing.some(t => t.id === id) ? existing.map(t => t.id === id ? { ...t, text } : t) : [...existing, { id, text:text.trim(), role, at }].sort((a,b) => a.at-b.at);
    context.current.turns = next; setTurns(next); if (!draft.current.startedAt) setStartedAt(Date.now());
    if (!generate) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void coach(context.current.turns), 200);
  }
  function submitManual(e: React.FormEvent) {
    e.preventDefault(); const text=manualText.trim(); if (!text) return;
    const dc=channel.current;
    if (live && dc?.readyState === "open") {
      addTurn(text,manualRole,uid(),Date.now(),false);
      const speaker=manualRole === "you" ? "The representative actually said" : manualRole === "buyer" ? "The buyer said" : "Additional call transcript";
      dc.send(JSON.stringify({type:"conversation.item.create",item:{type:"message",role:"user",content:[{type:"input_text",text:`${speaker}: ${text}`}]}}));
      if (manualRole !== "you") {
        if (responsePending.current) typedReplyPending.current=true;
        else { responsePending.current=true; dc.send(JSON.stringify({type:"response.create"})); }
      }
    } else addTurn(text,manualRole);
    setManualText("");
  }
  function stopAudio() {
    audioGeneration.current++; captureBusy.current=false;
    responsePending.current=false; typedReplyPending.current=false;
    const pc = peer.current; peer.current = null; channel.current = null; pc?.close();
    const handle=callHandle.current;callHandle.current="";if(handle)void fetch("/api/session/stop",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({handle}),keepalive:true}).catch(()=>{});
    stream.current?.getTracks().forEach(track => track.stop()); stream.current = null;
    rawStream.current?.getTracks().forEach(track => track.stop()); rawStream.current = null; gainNode.current = null;
    void audioContext.current?.close(); audioContext.current = null; cancelAnimationFrame(frame.current);
    if (testTimer.current) clearTimeout(testTimer.current); if (stopTimer.current) clearTimeout(stopTimer.current);
    setLive(false); setConnecting(false); setPaused(false); setThinking(false); setPartial(""); setHearing(false); setLevel(0); setMicTest(false);
  }
  function ensureAudioCurrent(generation: number) { if (generation !== audioGeneration.current) throw new DOMException("Audio setup was cancelled.","AbortError"); }
  async function captureAudio(generation: number) {
    if (!navigator.mediaDevices) throw new Error("Audio access needs a secure browser window. Open this local app in an up-to-date Google Chrome.");
    let ms: MediaStream;
    try { ms = audioMode === "computer" ? await captureComputerAudio(navigator.mediaDevices) : await navigator.mediaDevices.getUserMedia({audio:microphoneConstraints(audioMode,deviceId)}); }
    catch (e) { if (e instanceof DOMException && e.name === "OverconstrainedError") throw new Error("That microphone is no longer available. Choose another input or System default."); throw e; }
    if (generation !== audioGeneration.current) { ms.getTracks().forEach(t => t.stop()); ensureAudioCurrent(generation); }
    rawStream.current = ms;
    const ctx = new AudioContext(); audioContext.current = ctx; await ctx.resume(); ensureAudioCurrent(generation);
    const pipeline = createMicrophonePipeline(ctx,ms,inputGain); gainNode.current = pipeline.gain; stream.current = pipeline.stream;
    const track = ms.getAudioTracks()[0], settings = track.getSettings();
    for (const inputTrack of ms.getTracks()) inputTrack.addEventListener("ended",() => { if (generation === audioGeneration.current) { stopAudio(); setError(audioMode === "computer" ? "Computer audio sharing ended. Share system audio again to reconnect the assistant. Your phone call can continue." : "The microphone disconnected. Choose an available input, then reconnect the assistant."); } },{once:true});
    setActiveInput(track.label || (audioMode === "computer" ? "Shared computer audio" : "Selected microphone"));
    setInputDetails(audioMode === "computer" ? "Direct playback audio · Your microphone is not captured · No screen frames sent" : `Echo removal ${settings.echoCancellation ? "on" : "off"} · Noise cleanup ${settings.noiseSuppression ? "on" : "off"}`);
    const data = new Float32Array(pipeline.analyser.fftSize); let last = 0;
    const tick = (at: number) => {
      if (at-last > 100) { pipeline.analyser.getFloatTimeDomainData(data); const reading = audioSignal(data); setLevel(reading.level); setSignal(reading.signal); setDecibels(reading.db); last=at; }
      frame.current = requestAnimationFrame(tick);
    }; frame.current = requestAnimationFrame(tick);
    if (audioMode !== "computer") { const inputs = await navigator.mediaDevices.enumerateDevices(); ensureAudioCurrent(generation); setDevices(inputs.filter(d => d.kind === "audioinput")); }
    return pipeline.stream;
  }
  async function startListening() {
    if (captureBusy.current || live || connecting || micTest) return;
    if (!configured) { setError("The AI connection is not ready. Check Connection & audio."); return; }
    const limit=budgetDecision(spendState.current.budget,spendState.current.callUsd,spendState.current.entries,.03);
    if(!limit.allowed) {setError(limit.reason+" Adjust limits in Connection & audio to continue.");return;}
    controller.current?.abort(); seq.current++; if (timer.current) clearTimeout(timer.current);
    const generation = ++audioGeneration.current; captureBusy.current=true;
    setError(""); setThinking(false); setConnecting(true);
    try {
      const ms = await captureAudio(generation); ensureAudioCurrent(generation);
      const pc = new RTCPeerConnection(); peer.current = pc;
      ms.getTracks().forEach(track => pc.addTrack(track, ms));
      const dc = pc.createDataChannel("oai-events"); channel.current = dc;
      const partials = new Map<string,string>();
      const speechTimes = new Map<string,number>();
      let liveText = ""; let activeResponse = ""; let speechStopped = 0; let firstDelta = false;
      const usageIds=new Set<string>();const sessionId=uid();let model="gpt-realtime";
      const sessionTotals=new Map<string,{usd:number;known:boolean}>();
      const meterUsage=(kind:"live"|"transcription",price:{usd:number;known:boolean})=>{
        const now=new Date(),key=`${sessionId}:${kind}:${now.getFullYear()}-${now.getMonth()}`;
        const previous=sessionTotals.get(key),total={usd:(previous?.usd || 0)+price.usd,known:(previous?.known ?? true)&&price.known};sessionTotals.set(key,total);
        recordCharges([{id:key,at:now.getTime(),kind,...total,model:kind==="live" ? model : "gpt-4o-mini-transcribe"}]);
      };
      dc.onmessage = (message) => {
        if (peer.current !== pc) return;
        let event; try { event = JSON.parse(message.data); } catch { return; }
        if (event.type === "input_audio_buffer.speech_started") { setThinking(false); setHearing(true); if (event.item_id) speechTimes.set(event.item_id,Date.now()); }
        if (event.type === "input_audio_buffer.speech_stopped") { setHearing(false); speechStopped=performance.now(); responsePending.current=true; setThinking(true); }
        if (event.type === "response.created") { responsePending.current=true; activeResponse=event.response?.id || ""; liveText=""; firstDelta=false; setThinking(true); }
        if ((event.type === "response.output_text.delta" || event.type === "response.text.delta") && event.response_id === activeResponse) {
          liveText += event.delta || "";
          const result=parseLiveDraft(liveText);
          if (result) { setGuidance(result); setLiveDraft(true); if (!firstDelta) { firstDelta=true; setLatency(speechStopped ? performance.now()-speechStopped : 0); } }
        }
        if (event.type === "response.done") {
          if(event.response?.usage && !usageIds.has(event.response.id)) {usageIds.add(event.response.id);meterUsage("live",priceRealtimeUsage(event.response.usage,model));}
          if(peer.current!==pc)return;
          if (event.response?.id === activeResponse) responsePending.current=false;
          const completed=parseLiveDraft(liveText); if(completed && event.response?.id===activeResponse)recentReplies.current=[...recentReplies.current,completed.say].slice(-12);
          if (event.response?.id === activeResponse) { setThinking(false); if (event.response.status === "failed") setError(event.response.status_details?.error?.message || "The live assistant could not generate a response. Try reconnecting."); }
          const lookups=event.response?.status==="completed" && event.response.id===activeResponse ? (event.response.output || []).filter((item:{type:string;name?:string})=>item.type==="function_call"&&item.name==="lookup_company_knowledge") : [];
          let answeredLookup=false;
          for(const lookup of lookups) {
            let query="";try{query=String(JSON.parse(lookup.arguments).query || "").slice(0,6000);}catch{}
            if(!query.trim() || typeof lookup.call_id!=="string")continue;
            const sources=context.current.current ? selectKnowledge(knowledgeFor(context.current.current),query,24_000) : [];
            dc.send(JSON.stringify({type:"conversation.item.create",item:{type:"function_call_output",call_id:lookup.call_id,output:JSON.stringify({sources,notice:"Original reference excerpts only. If no explicit support, confirm with the factory."})}}));
            answeredLookup=true;
          }
          if (event.response?.id === activeResponse && (answeredLookup || typedReplyPending.current)) {
            typedReplyPending.current=false; responsePending.current=true;
            dc.send(JSON.stringify({type:"response.create",...(answeredLookup ? {response:{tool_choice:"none"}} : {})}));
          }
        }
        if (event.type === "conversation.item.input_audio_transcription.delta") { const text = (partials.get(event.item_id) || "") + event.delta; partials.set(event.item_id,text); setPartial(text); }
        if (event.type === "conversation.item.input_audio_transcription.completed") { partials.delete(event.item_id); setPartial(""); if (event.transcript?.trim()) addTurn(event.transcript,"conversation",event.item_id,speechTimes.get(event.item_id) || Date.now(),false); speechTimes.delete(event.item_id); if(event.usage && !usageIds.has("transcribe:"+event.item_id)) {usageIds.add("transcribe:"+event.item_id);meterUsage("transcription",priceTranscriptionUsage(event.usage));} }
        if (event.type === "conversation.item.input_audio_transcription.failed" || event.type === "error") setError(event.error?.message || "A piece of audio could not be transcribed. Add it using the text box below.");
      };
      dc.onclose = () => { if (peer.current === pc) { stopAudio(); setError("The live transcription connection ended. Your transcript is saved; reconnect to continue."); } };
      pc.onconnectionstatechange = () => {
        if (peer.current === pc && pc.connectionState === "failed") { stopAudio(); setError("The microphone connection failed. Check your network and reconnect."); }
      };
      const offer = await pc.createOffer(); ensureAudioCurrent(generation); await pc.setLocalDescription(offer); ensureAudioCurrent(generation);
      const response = await fetch("/api/session", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({...payload("coach",context.current.turns),audioMode,sdp:offer.sdp}), signal:AbortSignal.timeout(40_000) });
      const returnedHandle=response.headers.get("X-Trade-Call") || "";
      if (generation !== audioGeneration.current && returnedHandle) void fetch("/api/session/stop",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({handle:returnedHandle}),keepalive:true}).catch(()=>{});
      ensureAudioCurrent(generation);
      if (!response.ok) { const data = await response.json() as {error?:string}; throw new Error(data.error || "Live transcription could not connect."); }
      callHandle.current=returnedHandle;model=response.headers.get("X-Trade-Model") || "gpt-realtime";
      const answer = await response.text(); ensureAudioCurrent(generation);
      await pc.setRemoteDescription({ type:"answer", sdp:answer }); ensureAudioCurrent(generation);
      await new Promise<void>((resolve,reject) => { if (dc.readyState === "open") { resolve(); return; } const t = setTimeout(() => reject(new Error("The live connection timed out. Please try again.")), 20_000); dc.addEventListener("open", () => {clearTimeout(t);resolve();}, {once:true}); dc.addEventListener("close", () => {clearTimeout(t);reject(new Error("Audio setup was stopped."));}, {once:true}); });
      ensureAudioCurrent(generation);
      setConnecting(false); setLive(true); if (!startedAt) setStartedAt(Date.now());
      stopTimer.current = setTimeout(() => { stopAudio(); notify("The session reached 55 minutes. Start listening again to continue."); }, 55*60*1000);
      notify(audioMode === "computer" ? "Live assistant connected to computer audio. Your phone call stays on your AT&T line." : "Live assistant connected. Suggestions stream automatically as you talk.");
    } catch (e) { if (generation !== audioGeneration.current) return; stopAudio(); const message = e instanceof Error ? e.message : "Could not start audio capture."; setError(audioMode !== "computer" && (message.includes("Permission") || message.includes("NotAllowed")) ? "Allow microphone access in your browser, then try again." : message); }
  }
  function togglePause() { const value = !paused; stream.current?.getAudioTracks().forEach(t => t.enabled = !value); setPaused(value); if (value) { setPartial(""); setHearing(false); } }
  async function testMic() {
    if (micTest) { stopAudio(); return; } if (captureBusy.current || live || connecting) return; setError("");
    const generation=++audioGeneration.current; captureBusy.current=true; setMicTest(true);
    try { await captureAudio(generation); ensureAudioCurrent(generation); testTimer.current = setTimeout(stopAudio,10_000); }
    catch (e) { if (generation !== audioGeneration.current) return; stopAudio(); setError(e instanceof Error ? e.message : "Microphone access failed."); }
  }
  function saveCall() {
    stopAudio(); if (!turns.length && !notes.trim()) { notify("Add a conversation or notes before saving a call."); return; }
    if (timer.current) clearTimeout(timer.current); controller.current?.abort(); seq.current++; setThinking(false);
    callGeneration.current++;
    const call: CallRecord = { id:uid(), manufacturerId:activeId, manufacturerName:current?.name || "Manufacturer", buyer:buyer || "Unnamed buyer", goal, startedAt:startedAt || Date.now(), duration:elapsed, turns, notes, outcome,estimatedCostUsd:callCostUsd,buyerBrief };
    setCalls(previous => [call,...previous]); setSelectedCall(call.id); setView("history"); setTurns([]); context.current.turns = []; setNotes(""); setStartedAt(0); setElapsed(0); setGuidance(null); setBuyer("");setBuyerBrief(null);setCallCostUsd(0);spendState.current.callUsd=0; setOutcome("Follow-up needed"); notify("Call saved to this browser");
  }
  function newCall() {
    if (turns.length || notes.trim()) { saveCall(); setView("live"); return; }
    callGeneration.current++; controller.current?.abort();seq.current++;if(timer.current)clearTimeout(timer.current);
    stopAudio(); setView("live"); setGuidance(null); setError(""); setStartedAt(0); setElapsed(0); setBuyer("");setBuyerBrief(null);setCallCostUsd(0);spendState.current.callUsd=0; setSelectedCall(null);
  }
  async function summarize(call: CallRecord) {
    const manufacturer = manufacturers.find(m => m.id === call.manufacturerId);
    if (!manufacturer) { setError("This manufacturer's profile is no longer available."); return; }
    setSummarizing(true); setError("");
    try { const summary = await billableJSON<NonNullable<CallRecord["summary"]>>("/api/coach", payload("summary",call.turns,manufacturer,call.buyer,call.goal)); setCalls(previous => previous.map(c => c.id === call.id ? {...c,summary} : c)); }
    catch(e) { setError(e instanceof Error ? e.message : "Could not summarize call."); } finally { setSummarizing(false); }
  }
  function saveForm(e: React.FormEvent) {
    e.preventDefault(); if (!modal || !formName.trim()) return;
    if (modal.type === "manufacturer") {
      const item: Manufacturer = { id:modal.manufacturer?.id || uid(), name:formName.trim(), products:formProducts.trim(), introduction:formText.trim(), sources:modal.manufacturer?.sources || [] };
      setManufacturers(previous => modal.manufacturer ? previous.map(m => m.id === item.id ? item : m) : [...previous,item]); setActiveId(item.id);
    } else if (current) {
      if (!formText.trim()) { setError("Add some source text before saving."); return; }
      const total = knowledgeFor(current).filter(s => s.id !== modal.source?.id).reduce((n,s) => n+s.text.length,0) + formText.length;
      if (total > 500_000) { setError("This manufacturer's library supports 500,000 characters. Split larger libraries across manufacturers."); return; }
      const source: Source = { ...modal.source, id:modal.source?.id || uid(), title:formName.trim(), text:formText.trim(), addedAt:modal.source?.addedAt || new Date().toISOString() };
      setManufacturers(previous => previous.map(m => m.id === current.id ? {...m,sources:modal.source ? m.sources.map(s => s.id === source.id ? source : s) : [...m.sources,source]} : m));
    }
    setModal(null); setGuidance(null); notify("Knowledge saved to this browser");
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
  function backup() { downloadFile(`trade-assist-backup-${new Date().toISOString().slice(0,10)}.json`, JSON.stringify({version:1,manufacturers,calls,activeId,draft:draft.current,features:{voice,buyerBrief},usage:{budget,entries:usageEntries}},null,2),"application/json"); }
  async function restore(file?: File) {
    if (!file) return;
    if(live || connecting) {setError("Stop the live assistant before importing a backup.");return;}
    try {
      if (file.size > 8_000_000) throw new Error("Backup too large.");
      const data = JSON.parse(await file.text());
      if (data.version !== 1 || !Array.isArray(data.manufacturers) || !Array.isArray(data.calls) || !data.manufacturers.every((m: Manufacturer) => typeof m.id === "string" && typeof m.name === "string" && typeof m.products === "string" && typeof m.introduction === "string" && Array.isArray(m.sources) && m.sources.every(s => typeof s.id === "string" && typeof s.title === "string" && typeof s.text === "string")) || !data.calls.every((c: CallRecord) => typeof c.id === "string" && Array.isArray(c.turns) && typeof c.buyer === "string")) throw new Error("Invalid backup.");
      const existing = new Set(manufacturers.map(m => m.id)), callIds = new Set(calls.map(c => c.id));
      setManufacturers(previous => [...previous,...data.manufacturers.filter((m:Manufacturer) => !existing.has(m.id))]); setCalls(previous => [...data.calls.filter((c:CallRecord) => !callIds.has(c.id)),...previous]);
      if (!activeId && data.manufacturers[0]) setActiveId(data.manufacturers[0].id); notify("Backup imported. Existing records were kept.");
      const importedVoice=VoiceProfileInput.safeParse(data.features?.voice);if(importedVoice.success && data.features?.voice)setVoice(importedVoice.data);
      if(Array.isArray(data.usage?.entries))recordCharges(data.usage.entries.filter((entry:UsageEntry)=>entry && typeof entry.id==="string" && typeof entry.model==="string" && ["live","transcription","coach","research","document"].includes(entry.kind) && Number.isFinite(entry.at) && Number.isFinite(entry.usd) && entry.usd>=0),false);
      const limits=data.usage?.budget;
      if(limits && typeof limits.enabled==="boolean" && Number.isFinite(limits.perCallUsd) && limits.perCallUsd>=0 && limits.perCallUsd<=10_000 && Number.isFinite(limits.monthlyUsd) && limits.monthlyUsd>=0 && limits.monthlyUsd<=10_000)setBudget(limits);
      if(!turns.length && !notes.trim()) {
        const restoredDraft=data.draft;
        if(restoredDraft && Array.isArray(restoredDraft.turns) && restoredDraft.turns.every((turn:Turn)=>turn && typeof turn.id==="string" && typeof turn.text==="string" && ["buyer","you","conversation"].includes(turn.role))) {
          callGeneration.current++;const restoredTurns=restoredDraft.turns.slice(-300).map((turn:Turn)=>({...turn,text:turn.text.slice(0,6000)}));setTurns(restoredTurns);context.current.turns=restoredTurns;
          setBuyer(String(restoredDraft.buyer || "").slice(0,500));setGoal(GOALS.includes(restoredDraft.goal) ? restoredDraft.goal : GOALS[0]);setNotes(String(restoredDraft.notes || "").slice(0,20_000));setStartedAt(Number(restoredDraft.startedAt)||0);setElapsed(Math.max(0,Number(restoredDraft.elapsed)||0));setOutcome(String(restoredDraft.outcome || "Follow-up needed").slice(0,100));
          if([...manufacturers,...data.manufacturers].some((m:Manufacturer)=>m.id===restoredDraft.activeId))setActiveId(restoredDraft.activeId);
          const cost=Math.max(0,Number(restoredDraft.callCostUsd)||0);setCallCostUsd(cost);spendState.current.callUsd=cost;
        }
        const importedBrief=BuyerBriefInput.safeParse(data.features?.buyerBrief || restoredDraft?.buyerBrief);
        if(importedBrief.success){setBuyerBrief(importedBrief.data);if(!restoredDraft?.buyer)setBuyer(importedBrief.data.company);}
      }
    } catch { setError("This file is not a valid Trade Assist backup."); }
  }
  function selectManufacturer(id: string) {
    if (live || connecting || turns.length || driveLoading) { setError("Finish the current call or import before switching manufacturers."); return; }
    setActiveId(id); setGuidance(null);setDrivePreview(null); setError("");
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
    setManufacturers(previous=>previous.map(m=>m.id===current.id ? {...m,sources} : m));setDrivePreview(null);setDriveUrl("");setGuidance(null);notify("Drive documents saved in your searchable company memory");
  }
  function driveImportCard() {
    return <section className="card drive-import"><div className="panel-header"><div><BookOpen size={17}/><h2>Import from Google Drive</h2></div><span className="category-label">Anyone-with-link access</span></div><p>Paste a Google Doc, Sheet, Slides, PDF, or folder link. Read the preview once, then save it in this manufacturer’s memory.</p><form onSubmit={e=>{e.preventDefault();void previewDrive();}}><label htmlFor="drive-link">Google Drive file or folder link</label><div className="drive-link-row"><input id="drive-link" type="url" placeholder="https://docs.google.com/document/d/…" value={driveUrl} onChange={e=>setDriveUrl(e.target.value)} required disabled={driveLoading || live || connecting}/><button className="button primary" disabled={driveLoading || live || connecting || !driveUrl.trim()}>{driveLoading ? <Loader2 size={15} className="spin"/> : <ArrowRight size={15}/>} {driveLoading ? "Reading documents…" : "Read link"}</button></div></form><small>Documents stay saved in this browser. Refresh a linked source when the original changes. Private sign-in-only files are not supported by this link importer.</small>{drivePreview && <div className="drive-preview"><strong>{drivePreview.sources.length} document{drivePreview.sources.length===1 ? "" : "s"} ready · {drivePreview.sources.reduce((n,s)=>n+s.text.length,0).toLocaleString()} characters</strong>{drivePreview.warnings.map((warning,i)=><p className="import-warning" key={i}>{warning}</p>)}{drivePreview.sources.map(s=><details key={s.id}><summary>{s.title} <span>{s.text.length.toLocaleString()} characters</span></summary><a href={s.originUrl} target="_blank" rel="noreferrer">Open original document ↗</a><pre>{s.text}</pre></details>)}<div className="button-row"><button className="button primary" onClick={saveDriveMemory} disabled={!drivePreview.sources.length || live || connecting}><Check size={15}/> Save to company memory</button><button className="button secondary" onClick={()=>setDrivePreview(null)}>Discard preview</button></div></div>}</section>;
  }
  const record = calls.find(c => c.id === selectedCall);
  const filteredCalls = calls.filter(c => `${c.buyer} ${c.manufacturerName} ${c.notes}`.toLowerCase().includes(query.toLowerCase()));
  const title = view === "live" ? "Live assistant" : view === "knowledge" ? "Company knowledge" : view === "history" ? "Call history" : "Connection & audio";
  const audioRunning = live || micTest || connecting;
  function audioControls() {
    return <section className="audio-quick-controls card" aria-label="Audio input setup">
      <div className="audio-mode-select"><label htmlFor="audio-mode">CALL AUDIO</label><select id="audio-mode" value={audioMode} disabled={audioRunning} onChange={e => { const mode=e.target.value as AudioMode; setAudioMode(mode); setInputGain(mode === "speakerphone" ? 4 : 1); }}><option value="speakerphone">Phone on speakerphone</option><option value="headset">Speaking into a headset</option><option value="computer">Computer call audio · Mac / browser</option></select></div>
      {audioMode === "computer" ? <div className="computer-source"><span>INPUT SOURCE</span><strong>Shared computer audio</strong><small>Choose it in the browser’s share picker</small></div> : <div className="audio-device-select"><label htmlFor="audio-device">MICROPHONE</label><select id="audio-device" value={deviceId} disabled={audioRunning} onChange={e => setDeviceId(e.target.value)}><option value="">System default microphone</option>{devices.filter(d => d.deviceId && d.deviceId !== "default").map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || "Microphone (test to see name)"}</option>)}</select></div>}
      <div className="audio-gain"><label htmlFor="input-gain">INPUT BOOST <output htmlFor="input-gain">{inputGain}×</output></label><input id="input-gain" type="range" min="1" max="8" step="0.5" value={inputGain} onChange={e => setInputGain(Number(e.target.value))}/></div>
      <button className="button secondary" onClick={testMic} disabled={live || connecting}>{micTest ? <Square size={15}/> : <Mic size={15}/>} {micTest ? "Stop audio test" : audioMode === "computer" ? "Test computer audio" : "Test phone audio"}</button>
      <div className="input-checks"><div className="test-level" role="meter" aria-label="Audio level after input boost" aria-valuemin={0} aria-valuemax={100} aria-valuenow={audioRunning && !paused ? Math.round(level*100) : 0}><div style={{width:`${audioRunning && !paused ? Math.max(2,level*100) : 0}%`}}/></div><span className={`audio-signal ${audioRunning && !paused ? signal : ""}`}>{paused ? "Paused" : !audioRunning ? "Test before calling" : signal === "quiet" ? "Quiet — check while buyer speaks" : signal === "clipping" ? "Too loud — reduce boost" : "Signal detected"}{audioRunning && !paused ? ` · ${Math.round(decibels)} dBFS` : ""}</span></div>
      <p className="audio-detail">{audioRunning && activeInput ? <>Using <strong>{activeInput}</strong> · {inputDetails}. </> : null}{audioMode === "computer" ? "Captures Mac playback directly. Use FaceTime’s cellular calling through your iPhone to keep your number. A headset lets you hear the buyer without playing sound into a room mic." : audioMode === "speakerphone" ? "Use your Mac’s built-in mic or a desk mic beside the phone. Keep the phone on speakerphone; a headset mic may miss the buyer. Adjust boost while the buyer speaks." : "Headset cleanup is on. For a separate phone speaker, switch to Phone on speakerphone."} {micTest ? "This 10-second test stays on your computer." : ""}</p>
      {audioMode === "computer" && <MacCallSetup/>}
    </section>;
  }

  if (configured === false && typeof window !== "undefined" && !["127.0.0.1","localhost"].includes(window.location.hostname)) return <div className="connection-gate"><div className="gate-mark"><AudioLines size={31}/></div><div className="eyebrow">TRADE ASSIST · LIVE CONVERSATION COPILOT</div><h1>Open your connected live assistant.</h1><p>This web copy does not have an AI connection. Your approved API key is on your Mac, where the live assistant runs.</p><a className="button primary" href="http://127.0.0.1:5173/" target="_blank" rel="noreferrer">Open live assistant on this Mac <ArrowRight size={16}/></a><p className="gate-help">If it does not open, double-click <strong>Start Trade Assist.command</strong> in your trade-assist folder. It now runs in the background; Terminal can be closed.</p><button className="text-button" onClick={backup}><Download size={14}/> Export any materials saved in this web copy</button><span className="muted">Import that backup in the connected app under Connection & audio.</span></div>;
  return <div className="app-shell">
    <aside className="sidebar">
      <a className="brand" href="/" aria-label="Trade Assist home"><span className="brand-mark"><AudioLines size={23}/></span><span>trade<span className="brand-light">assist</span><small>YOUR SALES COPILOT</small></span></a>
      <div className="workspace-label">WORKSPACE <LockKeyhole size={11}/></div>
      <nav aria-label="Main navigation">
        {([{id:"live",label:"Live assistant",icon:Headphones},{id:"knowledge",label:"Company knowledge",icon:BookOpen},{id:"history",label:"Call history",icon:History}] as const).map(item => <button key={item.id} aria-label={item.label} className={`nav-item ${view === item.id ? "active" : ""}`} onClick={() => setView(item.id)}><item.icon size={18}/><span>{item.label}</span>{item.id === "live" && live && <span className="live-dot"/>}{item.id === "history" && calls.length > 0 && <span className="nav-count">{calls.length}</span>}</button>)}
      </nav>
      <div className="sidebar-divider"/>
      <div className="workspace-label">REPRESENTING <button className="tiny-button" aria-label="Add manufacturer" onClick={() => openModal({type:"manufacturer"})}><Plus size={15}/></button></div>
      <div className="manufacturer-list">{manufacturers.length ? manufacturers.map(m => <button key={m.id} className={`manufacturer-item ${activeId === m.id ? "selected" : ""}`} onClick={() => selectManufacturer(m.id)}><span className="company-avatar">{m.name.slice(0,1).toUpperCase()}</span><span>{m.name}<small>{m.products || "Manufacturer"}</small></span>{activeId === m.id && <Check size={13}/>}</button>) : <button className="add-company" onClick={() => openModal({type:"manufacturer"})}><Plus size={17}/> Add a manufacturer</button>}</div>
      <div className="sidebar-bottom"><div className="sidebar-note"><ShieldCheck size={18}/><strong>Your information. Your voice.</strong><p>Guidance grounded in the materials you provide.</p></div><button aria-label="Connection & audio" className={`nav-item ${view === "settings" ? "active" : ""}`} onClick={() => setView("settings")}><Settings2 size={17}/><span>Connection & audio</span></button><div className="user-chip"><span>ME</span><div>My private workspace<small>English · US business calls</small></div><LockKeyhole size={13}/></div></div>
    </aside>

    <div className="main-shell">
      <header className="topbar"><div className="breadcrumb">Workspace <ChevronRight size={13}/><span>{title}</span></div><div className="topbar-right"><span className={`connection-pill ${configured ? "ready" : ""}`}><span className="status-dot"/>{configured === null ? "Checking connection" : configured ? "AI ready" : "Open connected app"}</span><button className="icon-button" aria-label="How to use Trade Assist" onClick={() => setShowHelp(true)}><CircleHelp size={18}/></button></div></header>
      <main>
        <div className="page-heading"><div><div className="eyebrow">{view === "live" ? "YOUR LIVE CONVERSATION ASSISTANT" : "YOUR SALES WORKSPACE"}</div><h1>{title}<span className="heading-dot">.</span></h1><p>{view === "live" ? "Listens to your call. Streams what to say next." : view === "knowledge" ? "Give your copilot the facts it needs to help you sell." : view === "history" ? "Keep the conversation moving, even after you hang up." : "Get ready for your next conversation."}</p></div>{view === "live" ? <div className="live-header-actions"><button className={`button ${live ? "stop" : "primary"}`} onClick={live ? stopAudio : startListening} disabled={connecting || micTest || !configured}>{connecting ? <Loader2 size={15} className="spin"/> : live ? <Square size={13}/> : <Mic size={15}/>} {connecting ? "Connecting…" : live ? "Stop assistant" : "Start live assistant"}</button><button className="icon-button bordered" aria-label="New call" onClick={newCall} disabled={live || connecting}><Plus size={16}/></button></div> : view === "knowledge" ? <button className="button primary" onClick={() => openModal({type:current ? "source" : "manufacturer"})}><Plus size={16}/> {current ? "Add source" : "Add manufacturer"}</button> : view === "history" ? <button className="button secondary" onClick={backup}><Download size={16}/> Export backup</button> : null}</div>
        {error && <div className="error-banner" role="alert"><CircleHelp size={17}/><span>{error}</span><button className="icon-button" aria-label="Dismiss error" onClick={() => setError("")}><X size={15}/></button></div>}

        {view === "live" && <>
          {!current && <div className="onboarding-strip"><span className="step-circle">1</span><div><strong>Add your company knowledge.</strong><p>Optional: add product details for specific answers. You can start listening right away.</p></div><button className="text-button" onClick={() => openModal({type:"manufacturer"})}>Add manufacturer <ArrowRight size={16}/></button></div>}
          <section className="call-context card" aria-label="Call details"><label><span>REPRESENTING</span><select aria-label="Manufacturer" value={activeId} onChange={e => selectManufacturer(e.target.value)} disabled={live || connecting || turns.length > 0}><option value="" disabled>Select manufacturer</option>{manufacturers.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label><label><span>WHO ARE YOU CALLING?</span><input placeholder="Buyer name or company" maxLength={500} value={buyer} onChange={e => {setBuyer(e.target.value);setBuyerBrief(null);}} disabled={live || connecting}/></label><label className="goal-field"><span>THIS CALL’S NEXT STEP</span><select value={goal} onChange={e => setGoal(e.target.value)}>{GOALS.map(g => <option key={g}>{g}</option>)}</select></label></section>
          {!live && <BuyerResearchPanel buyer={buyer} brief={buyerBrief} onBrief={setBuyerBrief} products={current?.products || ""} disabled={live || connecting} request={billableJSON}/>} {audioControls()}
          <div className="feature-cost-strip"><span>Estimated AI cost this call <strong>{formatUsd(callCostUsd)}</strong></span><span>This month <strong>{formatUsd(monthSpend(usageEntries))}</strong>{budget.enabled ? ` / ${formatUsd(budget.monthlyUsd)}` : ""}</span><button className="text-button" onClick={()=>setView("settings")}>Spending controls</button></div>
          <div className="call-grid">
            <section className="conversation card"><div className="panel-header"><div><Radio size={17}/><h2>Conversation</h2></div><span className={`micro-status ${live && !paused ? "on" : ""}`}><span className="status-dot"/>{connecting ? "Connecting" : paused ? "Paused" : live ? "Listening" : "Audio off"}</span></div>
              <div className="transcript" aria-live="polite">{turns.length === 0 && !partial ? <div className="transcript-empty"><div className="empty-audio"><AudioLines size={32}/></div><h3>Room for a good conversation.</h3><p>Your live transcript appears here.<br/>You focus on the person on the other end.</p><div className="audio-explainer"><Phone size={16}/><span>{audioMode === "computer" ? <>Call through FaceTime on your Mac.<br/>Share system audio with the assistant.</> : <>Call on your mobile. Use speakerphone<br/>beside your computer’s microphone.</>}</span></div><button className="text-button" onClick={() => setShowHelp(true)}>How it works <ArrowRight size={13}/></button></div> : turns.map(t => <div className={`transcript-turn ${t.role === "you" ? "your-turn" : ""}`} key={t.id}><div className="turn-meta"><select aria-label="Speaker" value={t.role} onChange={e => { const next = turns.map(item => item.id === t.id ? {...item,role:e.target.value as Turn["role"]} : item); setTurns(next); context.current.turns=next; }}><option value="conversation">Call audio</option><option value="buyer">Buyer</option><option value="you">You</option></select><time>{nowLabel(t.at)}</time></div><p>{t.text}</p></div>)}{partial && <div className="transcript-turn partial"><div className="turn-meta">Transcribing…</div><p>{partial}</p></div>}<div ref={transcriptEnd}/></div>
              <form className="manual-entry" onSubmit={submitManual}><div className="manual-heading"><span>Or add what was said</span><select aria-label="Speaker for typed message" value={manualRole} onChange={e => setManualRole(e.target.value as Turn["role"])}><option value="buyer">Buyer</option><option value="you">You</option><option value="conversation">Call audio</option></select></div><div className="manual-input"><input aria-label="What was said" value={manualText} maxLength={6000} onChange={e => setManualText(e.target.value)} placeholder="Type a question or something you heard…"/><button type="submit" aria-label="Add message" disabled={!manualText.trim() || !configured}><ArrowRight size={17}/></button></div></form>
              <div className="call-controls"><div className="audio-meter" aria-label={`Call audio level ${Math.round(level*100)} percent`}>{Array.from({length:13},(_,i) => <i key={i} style={{height:`${Math.round(8+Math.sin(i*1.8)**2*17)}px`,opacity:live && !paused && level > i/15 ? 1 : .2}}/>)}</div><span className="call-clock">{durationText(elapsed)}</span>{live ? <><button className="icon-button bordered" aria-label={paused ? "Resume assistant audio" : "Pause assistant audio"} onClick={togglePause}>{paused ? <Play size={16}/> : <Pause size={16}/>}</button><button className="button stop" onClick={stopAudio}><Square size={13} fill="currentColor"/> Stop listening</button></> : <button className="button primary" onClick={startListening} disabled={connecting || micTest || !configured}>{connecting ? <Loader2 size={16} className="spin"/> : <Mic size={16}/>} {connecting ? "Connecting…" : "Start live assistant"}</button>}</div>
            </section>

            <div className="guidance-column"><section className="guidance-card" aria-label="Suggested response"><div className="guidance-header"><span><Sparkles size={17}/> YOUR EXACT REPLY</span><span className="guidance-state">{thinking ? <><Loader2 size={12} className="spin"/> {live ? "Writing your reply" : "Checking facts"}</> : guidance ? <><Check size={12}/> {liveDraft ? "First words" : "Updated"} {latency ? `${(latency/1000).toFixed(1)}s` : ""}</> : "Ready when you are"}</span></div>
              <div className="say-label">{liveDraft || live || !guidance ? "SAY THIS WORD FOR WORD" : guidance.intent}</div><div className={`suggestion ${thinking ? "updating" : ""}`} aria-live="polite">{guidance ? <p>“{guidance.say}”</p> : <><h2>Your exact reply<br/> appears here.</h2><p className="suggestion-placeholder">Start the live assistant. After the buyer asks a question, read the reply here aloud.</p></>}</div>
              {guidance?.ask && !liveDraft && !live && <div className="ask-next"><span>GOOD QUESTION TO ASK</span><p>{guidance.ask}</p></div>}
              <div className="guidance-footer"><span><ShieldCheck size={13}/>{liveDraft ? "Live draft · uses your supplied context" : guidance?.evidence.length ? "References checked against your sources" : "Company claims use your saved sources"}</span>{guidance ? <button className="icon-button" aria-label="Copy suggested response" onClick={() => void copy(guidance.say)}><Copy size={15}/></button> : <button className="text-button" disabled={!configured || thinking} onClick={() => void coach([],"opening")}>Draft an opening <ArrowRight size={13}/></button>}</div>
            </section>
            <section className="evidence-card card"><div className="panel-header"><div><BookOpen size={16}/><h2>Backed by your knowledge</h2></div><span className="count-badge">{guidance?.evidence.length || 0}</span></div><div className="evidence-body">{guidance?.evidence.length ? guidance.evidence.map((e,i) => <button className="evidence-item" key={i} onClick={() => { if (e.sourceId === "company-profile") openModal({type:"manufacturer",manufacturer:current}); else { const source=current?.sources.find(s => s.id === e.sourceId); if(source) openModal({type:"source",source}); } }}><div><FileText size={14}/><strong>{knowledgeFor(current!).find(s => s.id === e.sourceId)?.title || "Source"}</strong><ChevronRight size={13}/></div><p>“{e.quote}”</p></button>) : <div className="subtle-empty"><Layers3 size={23}/><p>{current ? "Live drafts use your context. Choose Get a verified answer to see supporting source excerpts." : "Add company and product information to ground your suggestions."}</p></div>}{guidance?.caution && <div className="caution"><CircleHelp size={15}/><p>{guidance.caution}</p></div>}{guidance && guidance.missing.length > 0 && <div className="missing-facts"><span>DETAILS TO CONFIRM</span>{guidance.missing.map(m => <p key={m}>· {m}</p>)}</div>}</div></section>
            {!live && !liveDraft && guidance?.nextStep && <section className="next-step-card"><span className="next-step-icon"><ArrowRight size={19}/></span><div><span className="eyebrow">MOVE THE DEAL FORWARD</span><p>{guidance.nextStep}</p></div></section>}
            {guidance && <button className="text-button" onClick={()=>setReplyEdit(guidance.say)}>Edit wording & teach my voice</button>}{replyEdit!==null && <div className="reply-edit card"><label htmlFor="preferred-reply">How would you say this?</label><textarea id="preferred-reply" maxLength={600} value={replyEdit} onChange={e=>setReplyEdit(e.target.value)}/><div className="button-row"><button className="button primary small" disabled={!replyEdit.trim()} onClick={()=>{const text=replyEdit.trim();setVoice(v=>({...v,examples:[...v.examples.filter(e=>e!==text),text].slice(-6)}));setGuidance(g=>g ? {...g,say:text} : g);setReplyEdit(null);notify("Preferred wording saved for future calls");}}>Remember my wording</button><button className="text-button" onClick={()=>setReplyEdit(null)}>Cancel</button></div><small>Saved as a style example. It does not establish product facts. Restart the live assistant to apply new voice settings.</small></div>}{guidance && <button className="text-button refresh-guidance" onClick={() => void coach()} disabled={thinking}><RefreshCw size={13}/> {liveDraft ? "Get a verified answer" : "Refresh guidance"}</button>}</div>
          </div>
          <section className="call-notes card"><div><label htmlFor="call-notes">Your call notes</label><p>Capture a requirement, detail, or promise to follow up.</p></div><textarea id="call-notes" placeholder="What matters for the next conversation?" value={notes} onChange={e => setNotes(e.target.value)} maxLength={20_000}/><div className="save-call"><select aria-label="Call outcome" value={outcome} onChange={e => setOutcome(e.target.value)}>{["Follow-up needed","Interested — next step agreed","Quotation requested","Samples requested","Not interested","No answer","Practice call"].map(o => <option key={o}>{o}</option>)}</select><button className="button secondary" onClick={saveCall} disabled={!turns.length && !notes.trim()}><CheckCircle2 size={15}/> Save call</button></div></section>
          <div className="workspace-footer"><span><LockKeyhole size={12}/> Materials and transcripts saved in this browser</span><span>{audioMode === "computer" ? "Computer audio" : audioMode === "headset" ? "Headset mode" : "Speakerphone mode"} <span>·</span> English <span>·</span> You do the talking</span></div>
        </>}

        {view === "knowledge" && <div className="knowledge-layout"><section className="card company-card"><div className="panel-header"><div><Layers3 size={17}/><h2>{current ? current.name : "Your manufacturer"}</h2></div>{current && <button className="text-button" disabled={live || connecting} onClick={() => openModal({type:"manufacturer",manufacturer:current})}>Edit profile</button>}</div>{current ? <div className="company-profile"><span className="category-label">{current.products || "Product category not added"}</span><p>{current.introduction || "Add a company description, capabilities, and approved selling points in Edit profile."}</p><div className="profile-stats"><div><strong>{current.sources.length}</strong><span>source documents</span></div><div><strong>{knowledgeFor(current).reduce((n,s) => n+s.text.length,0).toLocaleString()}</strong><span>characters of knowledge</span></div></div></div> : <div className="large-empty"><BookOpen size={34}/><h2>Give your copilot something to work with.</h2><p>Add a manufacturer, then paste product details or upload your materials.</p><button className="button primary" onClick={() => openModal({type:"manufacturer"})}><Plus size={16}/> Add your first manufacturer</button></div>}</section>{current && <>{driveImportCard()}<div className="knowledge-search"><Search size={16}/><input aria-label="Search company memory" placeholder="Search your saved company memory…" value={knowledgeQuery} onChange={e=>setKnowledgeQuery(e.target.value)}/></div><div className="section-heading"><div><h2>Source library</h2><p>Review and update these whenever your terms change.</p></div><span>{current.sources.length} sources</span></div><div className="source-grid">{current.sources.filter(s=>!knowledgeQuery || `${s.title} ${s.text}`.toLowerCase().includes(knowledgeQuery.toLowerCase())).map(s => <article className="card source-card" key={s.id}><span className="source-icon"><FileText size={22}/></span><h3>{s.title}</h3>{s.originUrl && <div className="linked-source"><a href={s.originUrl} target="_blank" rel="noreferrer">Google Drive ↗</a><span>Read {new Date(s.syncedAt || s.addedAt).toLocaleDateString()}</span><button className="text-button" disabled={driveLoading || live || connecting} onClick={()=>void previewDrive(s.originUrl)}>Refresh</button></div>}<p>{s.text.slice(0,180)}{s.text.length > 180 ? "…" : ""}</p><div className="source-meta"><span>{s.text.length.toLocaleString()} characters · {new Date(s.addedAt).toLocaleDateString()}</span><button className="text-button" disabled={live || connecting} onClick={() => openModal({type:"source",source:s})}>Review <ArrowRight size={13}/></button></div></article>)}<button className="source-add" disabled={live || connecting} onClick={() => openModal({type:"source"})}><Plus size={24}/><strong>Add a source</strong><span>Paste details or upload a document</span></button></div><div className="info-card"><ShieldCheck size={21}/><div><strong>Useful details make useful suggestions.</strong><p>Include specifications, minimum orders, prices with currencies and units, lead times, certifications, sample policies, and negotiation limits. Keep dates and conditions attached to commercial terms.</p></div></div></>}</div>}

        {view === "history" && <div className="history-layout"><section className="card history-list"><div className="history-search"><Search size={16}/><input aria-label="Search call history" placeholder="Search buyers, companies, notes…" value={query} onChange={e => setQuery(e.target.value)}/></div>{filteredCalls.length ? filteredCalls.map(c => <button className={`history-item ${selectedCall === c.id ? "selected" : ""}`} key={c.id} onClick={() => setSelectedCall(c.id)}><span className="history-avatar"><Phone size={16}/></span><div><strong>{c.buyer}</strong><p>{c.manufacturerName}</p><small>{new Date(c.startedAt).toLocaleDateString()} · {durationText(c.duration)}</small></div><ChevronRight size={15}/></button>) : <div className="subtle-empty"><History size={27}/><h3>{query ? "No matching calls" : "Your conversations, remembered."}</h3><p>{query ? "Try a different search." : "Save your first call to keep notes and prepare a follow-up."}</p></div>}</section><section className="card record-detail">{record ? <><div className="record-heading"><div><span className="eyebrow">{record.manufacturerName}</span><h2>{record.buyer}</h2><p>{new Date(record.startedAt).toLocaleString()} · {durationText(record.duration)}</p></div><button className="icon-button bordered" aria-label="Export call" onClick={() => downloadFile(`call-${record.id.slice(0,8)}.json`,JSON.stringify(record,null,2),"application/json")}><Download size={17}/></button></div><span className="outcome-badge">{record.outcome}</span><p className="record-cost">Estimated AI cost: {formatUsd(record.estimatedCostUsd || 0)}</p><p className="record-goal"><strong>Goal:</strong> {record.goal}</p>{record.buyerBrief && <details className="transcript-details"><summary>Buyer research saved with this call</summary><p>{record.buyerBrief.summary}</p>{record.buyerBrief.facts.map((fact,i)=><p key={i}>{fact.text} <a href={fact.sourceUrl} target="_blank" rel="noreferrer">Source ↗</a></p>)}{record.buyerBrief.hypotheses.map((hypothesis,i)=><p key={i}><strong>Unconfirmed possibility:</strong> {hypothesis.painPoint} · {hypothesis.question}</p>)}</details>}{record.notes && <div className="record-section"><h3>Your notes</h3><p className="preserve">{record.notes}</p></div>}<div className="record-section"><div className="section-heading"><h3>Call recap</h3><button className="button secondary small" disabled={summarizing || !record.turns.length || !configured} onClick={() => void summarize(record)}>{summarizing ? <Loader2 size={14} className="spin"/> : <Sparkles size={14}/>} {record.summary ? "Regenerate" : "Generate recap"}</button></div>{record.summary ? <><p>{record.summary.overview}</p>{([{key:"requirements",name:"Buyer requirements"},{key:"objections",name:"Objections"},{key:"commitments",name:"Explicit commitments"},{key:"nextSteps",name:"Next steps"}] as const).map(s => record.summary![s.key].length > 0 && <div className="recap-group" key={s.key}><h4>{s.name}</h4><ul>{record.summary![s.key].map((t,i) => <li key={i}>{t}</li>)}</ul></div>)}<div className="followup-heading"><h3>Follow-up draft</h3><button className="text-button" onClick={() => void copy(record.summary!.followUp)}><Copy size={13}/> Copy</button></div><textarea className="followup-text" aria-label="Edit follow-up email draft" value={record.summary.followUp} onChange={e => setCalls(previous => previous.map(c => c.id === record.id && c.summary ? {...c,summary:{...c.summary,followUp:e.target.value}} : c))}/><small className="muted">Review before sending. Trade Assist does not send messages.</small></> : <p className="muted">Generate a recap and editable follow-up draft from the actual conversation.</p>}</div><details className="transcript-details"><summary>Full transcript <span>{record.turns.length} turns</span></summary>{record.turns.map(t => <div className="record-turn" key={t.id}><strong>{t.role === "conversation" ? "Call audio" : t.role === "buyer" ? "Buyer" : "You"}</strong><p>{t.text}</p></div>)}</details><button className="text-button danger-text" onClick={() => { if (window.confirm("Delete this saved call from this browser?")) { setCalls(previous => previous.filter(c => c.id !== record.id)); setSelectedCall(null); } }}><Trash2 size={13}/> Delete call</button></> : <div className="large-empty"><FileText size={34}/><h2>A clear next step starts with good notes.</h2><p>Select a call to review the conversation, generate a recap, and draft a follow-up.</p></div>}</section></div>}

        {view === "settings" && <div className="settings-layout"><section className="card settings-card"><div className="panel-header"><div><Activity size={18}/><h2>AI connection</h2></div><span className={`connection-pill ${configured ? "ready" : ""}`}><span className="status-dot"/>{configured ? "Connected" : "Not connected"}</span></div><p>{configured ? "Your API key stays on the server. Company materials and conversation text are sent to OpenAI when you request guidance; live audio is sent only while listening." : "This server does not have the API key configured. Use the local version of Trade Assist where your key was securely saved."}</p><button className="button secondary small" onClick={() => { requestJSON<{configured:boolean}>("/api/status").then(s => {setConfigured(s.configured);notify(s.configured ? "AI connection is configured" : "No AI connection on this server");}).catch(e => setError(e.message)); }}><RefreshCw size={14}/> Check connection</button></section>{audioControls()}<VoiceSettings voice={voice} onChange={setVoice} disabled={live || connecting}/><SpendingPanel settings={budget} onChange={setBudget} callUsd={callCostUsd} entries={usageEntries}/><section className="card settings-card"><div className="panel-header"><div><LockKeyhole size={18}/><h2>Your workspace data</h2></div><span className="category-label">Saved in this browser</span></div><p>Manufacturer profiles, sources, transcripts, and notes stay in this browser. Raw call audio is not saved by this app. Export a backup to move your workspace or protect against browser data being cleared.</p><div className="button-row"><button className="button secondary" onClick={backup}><Download size={15}/> Export backup</button><button className="button secondary" onClick={() => importInput.current?.click()}><Upload size={15}/> Import backup</button></div><input ref={importInput} hidden type="file" accept=".json" onChange={e => {void restore(e.target.files?.[0]);e.target.value="";}}/></section><section className="info-card"><Headphones size={22}/><div><strong>For your first real call</strong><p>Add and review your materials, try a typed question, and test the selected input. Computer audio receives playback without your microphone. Microphone modes mix speakers; you can correct transcript labels. Reconnect if your network interrupts listening.</p></div></section></div>}
      </main>
    </div>

    {modal && <div className="modal-backdrop" onMouseDown={e => {if(e.target === e.currentTarget && !extracting) setModal(null);}}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div className="modal-header"><div><span className="eyebrow">YOUR KNOWLEDGE BASE</span><h2 id="modal-title">{modal.type === "manufacturer" ? modal.manufacturer ? "Edit manufacturer" : "Add a manufacturer" : modal.source ? "Review source" : "Add a source"}</h2></div><button className="icon-button" aria-label="Close dialog" onClick={() => setModal(null)} disabled={extracting}><X size={19}/></button></div><form onSubmit={saveForm}><label>{modal.type === "manufacturer" ? "Manufacturer name" : "Source title"}<input autoFocus required maxLength={200} value={formName} onChange={e => setFormName(e.target.value)} placeholder={modal.type === "manufacturer" ? "e.g. Your manufacturer’s company name" : "e.g. Product specifications — October 2026"}/></label>{modal.type === "manufacturer" && <label>What do they manufacture?<input maxLength={2000} value={formProducts} onChange={e => setFormProducts(e.target.value)} placeholder="Product categories or the range you represent"/></label>}{modal.type === "source" && <><input ref={sourceInput} type="file" hidden accept=".pdf,.txt,.md,.csv,.tsv,.json" onChange={e => {void loadSource(e.target.files?.[0]);e.target.value="";}}/><button type="button" className="upload-area" disabled={extracting} onClick={() => sourceInput.current?.click()} onDragOver={e => e.preventDefault()} onDrop={e => {e.preventDefault();void loadSource(e.dataTransfer.files[0]);}}>{extracting ? <Loader2 size={23} className="spin"/> : <Upload size={23}/>}<strong>{extracting ? "Extracting PDF for your review…" : "Upload a document or drop it here"}</strong><span>PDF, TXT, Markdown, CSV, TSV, JSON · up to 8 MB</span></button></>}<label>{modal.type === "manufacturer" ? "Company facts and approved selling points" : "Source text — review before saving"}<textarea className="source-textarea" required={modal.type === "source"} maxLength={100_000} value={formText} onChange={e => setFormText(e.target.value)} placeholder={modal.type === "manufacturer" ? "Describe the company and what you are authorized to say about it. You can add detailed product documents next." : "Paste specifications, prices with units and currencies, minimum orders, lead times, certifications, and relevant conditions…"}/></label><div className="form-note"><ShieldCheck size={14}/><span>{modal.type === "source" ? "The copilot uses the saved text as reference material. Check extracted numbers and conditions." : "Company claims come from your saved materials. Add facts you can stand behind."}</span></div>{error && <p className="form-error" role="alert">{error}</p>}<div className="modal-footer">{modal.type === "source" && modal.source && <button type="button" className="text-button danger-text" onClick={() => { const sourceId = modal.source!.id; if(window.confirm("Delete this source? It will no longer be available to the copilot.")) {setManufacturers(previous => previous.map(m => m.id === activeId ? {...m,sources:m.sources.filter(s => s.id !== sourceId)} : m));setModal(null);setGuidance(null);} }}><Trash2 size={14}/> Delete</button>}<span/><button type="button" className="button secondary" onClick={() => setModal(null)} disabled={extracting}>Cancel</button><button className="button primary" type="submit" disabled={live || connecting || extracting || !formName.trim() || (modal.type === "source" && !formText.trim())}><Check size={15}/> Save {modal.type === "manufacturer" ? "manufacturer" : "source"}</button></div></form></section></div>}

    {showHelp && <div className="modal-backdrop"><section className="modal help-modal" role="dialog" aria-modal="true" aria-labelledby="help-title"><div className="modal-header"><div><span className="eyebrow">A CALMER WAY TO COLD CALL</span><h2 id="help-title">You talk. Your copilot helps.</h2></div><button className="icon-button" aria-label="Close help" onClick={() => setShowHelp(false)}><X size={19}/></button></div><div className="help-steps">{[{title:"Add your facts",text:"Select a manufacturer. Paste company details or upload product documents. Review extracted text before saving.",icon:BookOpen},{title:"Make your call",text:"Choose Computer call audio to use FaceTime cellular calling through your iPhone on the Mac. Follow the setup under Call audio. Your carrier line keeps your number. Speakerphone mode is also available.",icon:Phone},{title:"Start listening",text:"Share system audio for computer calls, or allow microphone access for speakerphone mode. The large reply is the exact script to read aloud after the buyer speaks. You can pause or stop at any time.",icon:Mic},{title:"Agree a next step",text:"Save the call, review the recap, and edit a follow-up draft. Your workspace is saved in this browser.",icon:ArrowRight}].map((step,i) => <div className="help-step" key={step.title}><span>{i+1}</span><div><h3>{step.title}</h3><p>{step.text}</p></div><step.icon size={20}/></div>)}</div><div className="help-note">Trade Assist assists your existing phone call. Computer audio captures playback; it does not hear your microphone. Microphone modes mix speakers. You dial through FaceTime or your calling app; Trade Assist does not dial or inject audio.</div><button className="button primary" onClick={() => setShowHelp(false)}>Got it <ArrowRight size={15}/></button></section></div>}
    {toast && <div className="toast" role="status"><CheckCircle2 size={17}/>{toast}</div>}
  </div>;
}
