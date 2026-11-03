import { audioSignal, createMicrophonePipeline, microphoneConstraints } from "./audio.ts";
import { isTranscriptionPromptEcho, unexpectedEnglishScript } from "./transcript-quality.ts";
import type { TranscriptionUncertainty } from "./transcript-quality.ts";
import { assessBuyerTranscript } from "./buyer-audio-quality.ts";
import { createEnglishTranscriptionGuard, representativeTranscriptionConfig } from "./english-transcription.ts";
import type { AcceptedTranscriptionConfig } from "./english-transcription.ts";
import type { CoachingSpeechSnapshot } from "./coaching-context-snapshot";

export type RepTranscriptionTiming={id:string;role:"you";model:string;speechStartedAt?:number;speechStoppedAt?:number;firstPartialAt?:number;finalAt?:number};

export type RepAudioOptions = {
  deviceId?:string;
  signal?:AbortSignal;
  onSpeech:(active:boolean)=>void;
  onPending?:(active:boolean)=>void;
  onPartial:(text:string)=>void;
  onTurn:(turn:{id:string;text:string;at:number;transcriptionUncertainty?:TranscriptionUncertainty})=>void;
  onObservation?:(snapshot:CoachingSpeechSnapshot)=>void;
  onTranscriptionTiming?:(timing:RepTranscriptionTiming)=>void;
  onSessionConfig?:(config:AcceptedTranscriptionConfig)=>void;
  onUsage:(usage:unknown,model:string)=>void;
  onError:(message:string)=>void;
  onLevel?:(level:number)=>void;
  onCaptureWarning?:(message:string)=>void;
};
export type RepAudio = {stop:()=>void;pause:(value:boolean)=>void;observedSpeechSnapshot:()=>CoachingSpeechSnapshot};

/** This function acquires only the headset mic; it never accepts or mixes playback audio. */
export async function startRepAudio(options:RepAudioOptions):Promise<RepAudio> {
  let stopped=false,paused=false,raw:MediaStream|null=null,processed:MediaStream|null=null,ctx:AudioContext|null=null;
  let pc:RTCPeerConnection|null=null,dc:RTCDataChannel|null=null,handle="",frame=0;
  let localSpeaking=false,serverSpeaking=false,reportedSpeaking=false,localStartedAt=0,lastLoudAt=0;
  let model=representativeTranscriptionConfig().audio.input.transcription.model;
  let configGuard:ReturnType<typeof createEnglishTranscriptionGuard>|undefined;
  const pending=new Set<string>(),partials=new Map<string,string>(),starts=new Map<string,number>(),usageIds=new Set<string>(),transcriptIds=new Set<string>(),ignoredIds=new Set<string>();
  const timings=new Map<string,RepTranscriptionTiming>(),observedAt=new Map<string,number>();
  const observedSpeechSnapshot=():CoachingSpeechSnapshot=>({
    partials:[...partials].filter(([,text])=>!!text.trim()).map(([id,text])=>({id:`rep:${id}`,role:"you",text,at:starts.get(id),observedAt:observedAt.get(id)})),
    pendingSpeech:[
      ...[...pending].map(id=>({id:`rep:${id}`,role:"you" as const,at:starts.get(id),hasPartial:!!partials.get(id)?.trim()})),
      ...!paused&&!stopped&&localSpeaking&&!pending.size?[{id:`rep:local:${localStartedAt}`,role:"you" as const,at:localStartedAt,hasPartial:false}]:[],
    ],
  });
  const observation=()=>options.onObservation?.(observedSpeechSnapshot());
  const timing=(id:string,update:Partial<RepTranscriptionTiming>)=>{const next={id:`rep:${id}`,role:"you" as const,model,...timings.get(id),...update};timings.set(id,next);options.onTranscriptionTiming?.({...next});};
  const aborter=new AbortController();
  const stopHandle=(value:string)=>{if(value)void fetch("/api/session/stop",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({handle:value}),keepalive:true}).catch(()=>{});};
  const reportSpeech=()=>{const next=!paused&&!stopped&&(localSpeaking||serverSpeaking);if(next!==reportedSpeaking){reportedSpeaking=next;options.onSpeech(next);observation();}};
  // Pre-pause audio still needs its final transcript before the call can be saved.
  const reportPending=()=>options.onPending?.(!stopped&&pending.size>0);
  const stop=()=>{
    if(stopped)return;stopped=true;aborter.abort();
    configGuard?.stop();
    options.signal?.removeEventListener("abort",stop);
    cancelAnimationFrame(frame);pc?.close();pc=null;dc=null;
    raw?.getTracks().forEach(t=>t.stop());processed?.getTracks().forEach(t=>t.stop());
    raw=null;processed=null;void ctx?.close();ctx=null;
    stopHandle(handle);handle="";localSpeaking=false;serverSpeaking=false;
    pending.clear();partials.clear();starts.clear();observedAt.clear();timings.clear();reportSpeech();reportPending();observation();options.onLevel?.(0);
  };
  const assertActive=()=>{if(stopped||options.signal?.aborted)throw new DOMException("Microphone setup was cancelled.","AbortError");};
  const fail=(message:string)=>{if(stopped)return;try{options.onError(message);}finally{stop();}};
  const pause=(value:boolean)=>{
    if(stopped)return;
    if(value&&!paused&&localSpeaking&&!pending.size)options.onCaptureWarning?.("Microphone capture was paused before the final words were committed. Confirm any promise made just before pausing.");
    paused=value;
    processed?.getAudioTracks().forEach(t=>{t.enabled=!value;});
    if(value){localSpeaking=false;serverSpeaking=false;options.onPartial("");}
    reportSpeech();reportPending();
  };
  options.signal?.addEventListener("abort",stop,{once:true});
  try {
    assertActive();
    if(!navigator.mediaDevices?.getUserMedia)throw new Error("Your microphone is unavailable. Open the local app in Chrome and allow microphone access.");
    const acquired=await navigator.mediaDevices.getUserMedia({audio:microphoneConstraints("headset",options.deviceId || "")});
    if(stopped||options.signal?.aborted){acquired.getTracks().forEach(t=>t.stop());assertActive();}
    raw=acquired;
    const mic=raw.getAudioTracks()[0];
    if(!mic)throw new Error("No microphone audio track was provided.");
    mic.addEventListener("ended",()=>fail("Your headset microphone disconnected. Reconnect both audio channels before continuing."),{once:true});
    ctx=new AudioContext();await ctx.resume();assertActive();
    const pipeline=createMicrophonePipeline(ctx,raw,1);processed=pipeline.stream;
    const samples=new Float32Array(pipeline.analyser.fftSize);
    let lastMeter=0;
    const tick=(at:number)=>{
      if(stopped)return;
      pipeline.analyser.getFloatTimeDomainData(samples);const reading=audioSignal(samples);
      if(!paused){
        // A quick local gate prevents scripts from flashing while the representative speaks.
        // Server VAD still decides transcript boundaries, so no words are created from RMS.
        if(reading.db > -38){lastLoudAt=at;if(!localSpeaking){localSpeaking=true;localStartedAt=Date.now();}}
        else if(localSpeaking&&at-lastLoudAt>220)localSpeaking=false;
        reportSpeech();
      }
      if(at-lastMeter>100){options.onLevel?.(paused?0:reading.level);lastMeter=at;}
      frame=requestAnimationFrame(tick);
    };
    frame=requestAnimationFrame(tick);
    pc=new RTCPeerConnection();const connection=pc;
    processed.getAudioTracks().forEach(track=>connection.addTrack(track,processed!));
    dc=connection.createDataChannel("oai-events");const events=dc;
    configGuard=createEnglishTranscriptionGuard({
      config:representativeTranscriptionConfig(),send:event=>events.send(JSON.stringify(event)),
      onAccepted:config=>{model=config.model;options.onSessionConfig?.(config);},onError:message=>fail(message),
    });
    events.onmessage=(message)=>{
      if(stopped)return;
      let event;try{event=JSON.parse(message.data);}catch{return;}
      configGuard?.handle(event);
      if(stopped)return;
      const id=typeof event.item_id==="string"?event.item_id:"";
      if(event.type==="conversation.item.input_audio_transcription.completed" && event.usage && id && !usageIds.has(id)){
        usageIds.add(id);options.onUsage(event.usage,model);
      }
      if(event.type==="error" || (event.type==="conversation.item.input_audio_transcription.failed" && (!paused || pending.has(id)))){
        if(pending.size)options.onCaptureWarning?.("Some microphone speech could not be transcribed. Confirm any missing words or promises before using the decision packet.");
        fail("Your microphone transcript was interrupted. Reconnect both channels so your promises are captured accurately.");return;
      }
      // Keep finalizing only items whose speech began before pause. New audio
      // seen during pause is rejected permanently, including a completion after resume.
      if(paused&&!pending.has(id)){
        if(id)ignoredIds.add(id);
        return;
      }
      if(id&&ignoredIds.has(id))return;
      if(event.type==="input_audio_buffer.speech_started"){
        serverSpeaking=true;
        if(id){const now=Date.now();pending.add(id);starts.set(id,localStartedAt && now-localStartedAt<1500 ? localStartedAt : now);timing(id,{speechStartedAt:starts.get(id)});reportPending();observation();}
        reportSpeech();
      }
      if(event.type==="input_audio_buffer.speech_stopped"){serverSpeaking=false;if(id)timing(id,{speechStoppedAt:Date.now()});reportSpeech();}
      if(event.type==="conversation.item.input_audio_transcription.delta"&&id){
        const now=Date.now(),text=(partials.get(id)||"")+String(event.delta||"");
        if(!pending.has(id)){pending.add(id);starts.set(id,now);reportPending();}
        if(!timings.get(id)?.firstPartialAt)timing(id,{firstPartialAt:now});
        partials.set(id,text);observedAt.set(id,now);observation();if(!paused)options.onPartial(text);
      }
      if(event.type==="conversation.item.input_audio_transcription.completed"&&id){
        if(transcriptIds.has(id))return;transcriptIds.add(id);
        const at=starts.get(id)||Date.now();timing(id,{finalAt:Date.now()});
        pending.delete(id);partials.delete(id);starts.delete(id);observedAt.delete(id);
        options.onPartial(paused?"":([...partials.values()].at(-1)||""));
        if(typeof event.transcript==="string"&&event.transcript.trim()) {
          if(isTranscriptionPromptEcho(event.transcript))options.onCaptureWarning?.("A transcription prompt was returned instead of speech and was excluded. Check the microphone before continuing.");
          else {
            const text=event.transcript.trim(),assessment=assessBuyerTranscript({text,logprobs:event.logprobs});
            const transcriptionUncertainty=unexpectedEnglishScript(text)||(assessment.status==="uncertain"?{reason:assessment.reason||"low_confidence",message:"Some representative words may have been misheard. The original text is preserved; confirm names, numbers and commitments before using them."}:undefined);
            if(transcriptionUncertainty)options.onCaptureWarning?.(transcriptionUncertainty.message);
            options.onTurn({id:`rep:${id}`,text,at,...transcriptionUncertainty?{transcriptionUncertainty}:{}});
          }
        }
        reportPending();observation();
      }
    };
    events.onclose=()=>fail("Your microphone transcription connection ended. Reconnect both audio channels to continue.");
    connection.onconnectionstatechange=()=>{if(connection.connectionState==="failed")fail("Your microphone transcription connection failed. Reconnect both audio channels.");};
    const offer=await connection.createOffer();assertActive();await connection.setLocalDescription(offer);assertActive();
    const response=await fetch("/api/rep-session",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({sdp:offer.sdp}),signal:AbortSignal.any([aborter.signal,AbortSignal.timeout(40_000)])});
    const returnedHandle=response.headers.get("X-Trade-Call") || "";
    if(stopped||options.signal?.aborted){stopHandle(returnedHandle);assertActive();}
    handle=returnedHandle;
    if(!response.ok){const data=await response.json().catch(()=>({})) as {error?:string};throw new Error(data.error || "The microphone transcription connection could not start.");}
    model=response.headers.get("X-Trade-Transcription-Model")||model;
    const answer=await response.text();assertActive();await connection.setRemoteDescription({type:"answer",sdp:answer});assertActive();
    await new Promise<void>((resolve,reject)=>{
      if(events.readyState==="open"){resolve();return;}
      const complete=(error?:Error)=>{clearTimeout(timeout);events.removeEventListener("open",opened);events.removeEventListener("close",closed);aborter.signal.removeEventListener("abort",aborted);error?reject(error):resolve();};
      const opened=()=>complete(),closed=()=>complete(new Error("Microphone setup ended before it connected.")),aborted=()=>complete(new DOMException("Microphone setup was cancelled.","AbortError"));
      const timeout=setTimeout(()=>complete(new Error("The microphone transcription connection timed out.")),20_000);
      events.addEventListener("open",opened,{once:true});events.addEventListener("close",closed,{once:true});aborter.signal.addEventListener("abort",aborted,{once:true});
    });
    assertActive();configGuard.start();await configGuard.ready;assertActive();
    return {stop,pause,observedSpeechSnapshot};
  }catch(error){stop();throw error;}
}
