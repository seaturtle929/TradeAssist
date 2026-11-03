/** Browser/client monotonic-clock timings. All `atMs` values must share one
 * performance clock; server audio offsets are never wall-clock timestamps.
 * OpenAI's speech_stopped audio_end_ms includes the configured VAD silence:
 * https://developers.openai.com/api/reference/resources/realtime/server-events
 */
export type SpeechEndBasis='known_audio_cue'|'local_signal_estimate'|'vad_receipt_estimate'|'unavailable';
export type ReplyDisplaySink='controller'|'dom';
export type AcousticEnd={atMs:number;basis:'known_audio_cue'|'local_signal_estimate';resolutionMs:number};
export type SpeechEndOrigin={atMs?:number;basis:SpeechEndBasis;estimated:boolean;resolutionMs?:number};
type Display={atMs:number;say:string;full:boolean;sink:ReplyDisplaySink};
type Item={id:string;requestedAtMs?:number;speechItemId?:string;speechItemIds?:string[];speechStartedAtMs?:number;speechStoppedAtMs?:number;serverAudioStartMs?:number;serverAudioEndMs?:number;vadSilenceMs?:number;acousticEnd?:AcousticEnd;transcriptFinalizedAtMs?:number;verificationFinishedAtMs?:number;displays:Display[]};
export type LiveLatencySnapshot={
 itemId:string;speechItemId?:string;targetMs:number;basis:SpeechEndBasis;estimated:boolean;resolutionMs?:number;signalMayOverlapVad?:boolean;
 speechEndAtMs?:number;speechStartedAtMs?:number;speechStoppedAtMs?:number;transcriptFinalizedAtMs?:number;
 serverAudioStartMs?:number;serverAudioEndMs?:number;vadSilenceMs?:number;
 speechEndToVadReceivedMs?:number;transcriptionMs?:number;postVadTranscriptionMs?:number;
 firstReplyReadyMs?:number;fullReplyReadyMs?:number;firstDisplayMs?:number;firstFullDisplayMs?:number;fullDisplayMs?:number;
 postTranscriptFirstDisplayMs?:number;postTranscriptFullDisplayMs?:number;renderDelayMs?:number;
 verificationMs?:number;fullSay?:string;replacements:number;
 requestedAtMs?:number;requestToFirstDisplayMs?:number;requestToFullDisplayMs?:number;
 /** True/false only for a measured audio origin AND a complete DOM display. */
 withinTarget:boolean|null;estimatedWithinTarget:boolean|null;
};
const finite=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value)&&value>=0;
const elapsed=(end:number|undefined,start:number|undefined)=>end!==undefined&&start!==undefined&&end>=start?end-start:undefined;

/** Separates speech/ASR/model/publication/paint clocks instead of treating ASR
 * completion as the buyer's end of speech. It observes; it never controls VAD,
 * interrupts speech, changes a suggestion or unlocks a pending audio gate. */
export class LiveLatencyClock {
 private readonly items=new Map<string,Item>();
 private readonly now:()=>number;
 private lastSignalActivity?:{atMs:number;resolutionMs:number};
 readonly targetMs:number;
 private readonly maxItems:number;
 constructor(options:{now?:()=>number;targetMs?:number;maxItems?:number}={}) {
  this.now=options.now||(()=>performance.now());
  this.targetMs=finite(options.targetMs)&&options.targetMs>0?options.targetMs:1800;
  this.maxItems=finite(options.maxItems)&&options.maxItems>=1?Math.min(2000,Math.floor(options.maxItems)):128;
 }
 private item(id:string):Item|undefined {
  if(!id.trim())return;
  let item=this.items.get(id);
  if(!item){item={id,displays:[]};this.items.set(id,item);while(this.items.size>this.maxItems)this.items.delete(this.items.keys().next().value!);}
  return item;
 }
 recordSpeechStarted(id:string,options:{atMs?:number;audioStartMs?:number}={}) {
  const at=options.atMs??this.now();if(!finite(at))return;
  const item=this.item(id);if(!item)return;
  item.speechStartedAtMs??=at;
  if(finite(options.audioStartMs))item.serverAudioStartMs=options.audioStartMs;
 }
 recordRequest(id:string,atMs=this.now()) {
  if(!finite(atMs))return;const item=this.item(id);if(item)item.requestedAtMs??=atMs;
 }
 /** A button request has its own ID/clock, while its buyer speech has an audio
  * item ID. Link the final item included at release, retaining both origins. */
 linkRequestSpeech(id:string,speechItemId:string,speechItemIds=[speechItemId]) {
  if(id===speechItemId||!speechItemId.trim())return;
  const item=this.item(id);if(item){item.speechItemId=speechItemId;item.speechItemIds=[...speechItemIds];}
 }
 private withSpeech(item:Item):Item {
  const speech=item.speechItemId?this.items.get(item.speechItemId):undefined;
  const finals=(item.speechItemIds||[]).flatMap(id=>{const at=this.items.get(id)?.transcriptFinalizedAtMs;return at===undefined?[]:[at];});
  return speech?{...speech,...item,speechStartedAtMs:speech.speechStartedAtMs,speechStoppedAtMs:speech.speechStoppedAtMs,serverAudioStartMs:speech.serverAudioStartMs,serverAudioEndMs:speech.serverAudioEndMs,vadSilenceMs:speech.vadSilenceMs,acousticEnd:speech.acousticEnd,transcriptFinalizedAtMs:finals.length?Math.max(...finals):speech.transcriptFinalizedAtMs}:item;
 }
 recordSpeechStopped(id:string,options:{atMs?:number;audioEndMs?:number;vadSilenceMs?:number}={}) {
  const at=options.atMs??this.now();if(!finite(at))return;
  const item=this.item(id);if(!item)return;
  const firstStop=item.speechStoppedAtMs===undefined;
  item.speechStoppedAtMs??=at;
  if(finite(options.audioEndMs))item.serverAudioEndMs=options.audioEndMs;
  if(finite(options.vadSilenceMs))item.vadSilenceMs=options.vadSilenceMs;
  // The meter observes the same captured buyer track. Its threshold and frame
  // window make this an estimate; transport delay/resumed speech may put it
  // near the VAD event. A duplicate stop cannot attach a later utterance's cue.
  const signal=this.lastSignalActivity;
  if(firstStop&&!item.acousticEnd&&signal&&signal.atMs<=at&&(item.speechStartedAtMs===undefined||signal.atMs>=item.speechStartedAtMs-signal.resolutionMs))item.acousticEnd={...signal,basis:'local_signal_estimate'};
 }
 recordSignalActivity(options:{active:boolean;atMs?:number;resolutionMs?:number}) {
  const at=options.atMs??this.now();if(!options.active||!finite(at))return;
  const resolutionMs=finite(options.resolutionMs)?options.resolutionMs:100;
  if(!this.lastSignalActivity||at>=this.lastSignalActivity.atMs)this.lastSignalActivity={atMs:at,resolutionMs};
 }
 recordAcousticEnd(id:string,end:AcousticEnd) {
  if(!finite(end.atMs)||!finite(end.resolutionMs))return;
  const item=this.item(id);if(!item)return;
  // A controlled PCM/capture cue is stronger than a threshold-based estimate.
  if(item.acousticEnd?.basis==='known_audio_cue'&&end.basis!=='known_audio_cue')return;
  item.acousticEnd={...end};
 }
 recordTranscriptFinalized(id:string,atMs=this.now()) {
  if(!finite(atMs))return;const item=this.item(id);if(item)item.transcriptFinalizedAtMs??=atMs;
 }
 recordDisplay(id:string,options:{say:string;full:boolean;sink:ReplyDisplaySink;atMs?:number}) {
  const at=options.atMs??this.now();if(!finite(at)||!options.say.trim())return;
  const item=this.item(id);if(!item)return;
  const same=item.displays.find(display=>display.sink===options.sink&&display.full===options.full&&display.say===options.say);
  // React metadata re-renders and repeated provider events do not reset a time.
  if(same)return;
  item.displays.push({atMs:at,say:options.say,full:options.full,sink:options.sink});
 }
 recordVerification(id:string,atMs=this.now()) {
  if(!finite(atMs))return;const item=this.item(id);if(item)item.verificationFinishedAtMs=atMs;
 }
 getOrigin(id:string):SpeechEndOrigin {
  const stored=this.items.get(id),item=stored?this.withSpeech(stored):undefined,end=item?.acousticEnd;
  if(end)return {...end,estimated:end.basis!=='known_audio_cue'};
  if(item?.speechStoppedAtMs!==undefined&&item.vadSilenceMs!==undefined)return {atMs:Math.max(0,item.speechStoppedAtMs-item.vadSilenceMs),basis:'vad_receipt_estimate',estimated:true};
  return {basis:'unavailable',estimated:false};
 }
 snapshot(id:string):LiveLatencySnapshot|undefined {
  const stored=this.items.get(id);if(!stored)return;const item=this.withSpeech(stored);
  const origin=this.getOrigin(id),basis=origin.basis,speechEndAtMs=origin.atMs;
  const ready=item.displays.filter(display=>display.sink==='controller');
  const painted=item.displays.filter(display=>display.sink==='dom');
  const completeReady=ready.filter(display=>display.full),completePainted=painted.filter(display=>display.full);
  const full=completePainted.at(-1),readyForFull=full?completeReady.find(display=>display.say===full.say):undefined;
  const fullDisplayMs=elapsed(full?.atMs,speechEndAtMs);
  const measured=basis==='known_audio_cue';
  return {
   itemId:id,speechItemId:item.speechItemId,targetMs:this.targetMs,basis,estimated:origin.estimated,...origin.resolutionMs!==undefined?{resolutionMs:origin.resolutionMs}:{},
   requestedAtMs:item.requestedAtMs,requestToFirstDisplayMs:elapsed(painted[0]?.atMs,item.requestedAtMs),requestToFullDisplayMs:elapsed(full?.atMs,item.requestedAtMs),
   ...basis==='local_signal_estimate'&&speechEndAtMs!==undefined&&item.speechStoppedAtMs!==undefined&&item.vadSilenceMs!==undefined?{signalMayOverlapVad:item.speechStoppedAtMs-speechEndAtMs<item.vadSilenceMs/2}:{},
   speechEndAtMs,speechStartedAtMs:item.speechStartedAtMs,speechStoppedAtMs:item.speechStoppedAtMs,transcriptFinalizedAtMs:item.transcriptFinalizedAtMs,
   serverAudioStartMs:item.serverAudioStartMs,serverAudioEndMs:item.serverAudioEndMs,vadSilenceMs:item.vadSilenceMs,
   speechEndToVadReceivedMs:elapsed(item.speechStoppedAtMs,speechEndAtMs),transcriptionMs:elapsed(item.transcriptFinalizedAtMs,speechEndAtMs),
   postVadTranscriptionMs:elapsed(item.transcriptFinalizedAtMs,item.speechStoppedAtMs),
   firstReplyReadyMs:elapsed(ready[0]?.atMs,speechEndAtMs),fullReplyReadyMs:elapsed(completeReady.at(-1)?.atMs,speechEndAtMs),
   firstDisplayMs:elapsed(painted[0]?.atMs,speechEndAtMs),firstFullDisplayMs:elapsed(completePainted[0]?.atMs,speechEndAtMs),fullDisplayMs,
   postTranscriptFirstDisplayMs:elapsed(painted[0]?.atMs,item.transcriptFinalizedAtMs),postTranscriptFullDisplayMs:elapsed(full?.atMs,item.transcriptFinalizedAtMs),
   renderDelayMs:elapsed(full?.atMs,readyForFull?.atMs),verificationMs:elapsed(item.verificationFinishedAtMs,speechEndAtMs),fullSay:full?.say,
   replacements:Math.max(0,completePainted.length-1),
   withinTarget:measured&&fullDisplayMs!==undefined?fullDisplayMs<=this.targetMs:null,
   estimatedWithinTarget:!measured&&basis!=='unavailable'&&fullDisplayMs!==undefined?fullDisplayMs<=this.targetMs:null,
  };
 }
 reset(){this.items.clear();this.lastSignalActivity=undefined;}
}
