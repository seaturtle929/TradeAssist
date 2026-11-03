/** One source of truth for English recognition on every new/reconnected stream.
 * Keep coaching facts out of ASR hints: old prose hints hallucinated on silence. */
export const ENGLISH_TRANSCRIPTION_LANGUAGE = "en" as const;
export const TRANSCRIPTION_CONFIDENCE_FIELDS = ["item.input_audio_transcription.logprobs"];
export function englishTranscription(model:string) {
  return {model,language:ENGLISH_TRANSCRIPTION_LANGUAGE};
}

export function representativeTranscriptionConfig() {
  return {
    include:[...TRANSCRIPTION_CONFIDENCE_FIELDS],
    audio:{input:{
      transcription:englishTranscription("gpt-4o-mini-transcribe"),
      noise_reduction:{type:"near_field"},
      turn_detection:{type:"server_vad",threshold:.45,prefix_padding_ms:350,silence_duration_ms:350,create_response:false,interrupt_response:false},
    }},
  };
}

type InputConfig={transcription:{model:string;language:string};noise_reduction:unknown;turn_detection:{type:string;create_response:boolean;interrupt_response:boolean}};
export type EnglishTranscriptionConfig={include:string[];audio:{input:InputConfig}};
export type AcceptedTranscriptionConfig={
  at:number;event:"session.updated";model:string;language:string;noiseReduction:unknown;
  turnDetection:unknown;include:string[];
};
type Event={type?:string;session?:{include?:unknown;audio?:{input?:{
  transcription?:{model?:unknown;language?:unknown};noise_reduction?:unknown;
  turn_detection?:{type?:unknown;create_response?:unknown;interrupt_response?:unknown};
}}}};

/** Requested HTTP headers are not proof of service settings. Reassert once over
 * the open channel and require the service's effective session.updated response.
 * Reconnects construct a fresh guard; no fallback can silently remove English.
 * This never logs secrets, prompts, transcript text or the whole session event. */
export function createEnglishTranscriptionGuard(options:{
  config:EnglishTranscriptionConfig;
  send:(event:unknown)=>void;
  onAccepted?:(config:AcceptedTranscriptionConfig)=>void;
  onError?:(message:string)=>void;
  timeoutMs?:number;
}) {
  let started=false,settled=false,closed=false,failed=false;
  let resolveReady:()=>void=()=>{},rejectReady:(error:Error)=>void=()=>{};
  const ready=new Promise<void>((resolve,reject)=>{resolveReady=resolve;rejectReady=reject;});
  // Callers can await after setting the remote description without an unhandled
  // rejection if an early service event reports a mismatch first.
  void ready.catch(()=>{});
  let timer:ReturnType<typeof setTimeout>|undefined;
  const fail=(message:string)=>{
    if(closed||failed)return;failed=true;clearTimeout(timer);settled=true;
    rejectReady(new Error(message));options.onError?.(message);
  };
  return {
    ready,
    start(){
      if(started||closed)return;started=true;
      timer=setTimeout(()=>fail("English speech recognition settings were not confirmed by the service. Reconnect audio before continuing."),options.timeoutMs??8000);
      options.send({type:"session.update",session:{type:"realtime",...options.config}});
    },
    handle(event:Event){
      if(closed||failed||!started||event.type!=="session.updated")return;
      const input=event.session?.audio?.input,transcription=input?.transcription,turn=input?.turn_detection;
      const expected=options.config.audio.input;
      const include=Array.isArray(event.session?.include)?event.session.include.filter((v):v is string=>typeof v==="string"):[];
      // The provider expands near_field with a default strength. Compare the
      // requested type rather than falsely rejecting the effective extra field.
      const actualNoise=input?.noise_reduction as {type?:unknown}|null|undefined;
      const wantedNoise=expected.noise_reduction as {type?:unknown}|null;
      const noiseMatches=wantedNoise?actualNoise?.type===wantedNoise.type:actualNoise==null;
      const matches=transcription?.language===ENGLISH_TRANSCRIPTION_LANGUAGE&&transcription.model===expected.transcription.model&&
        turn?.type===expected.turn_detection.type&&turn.create_response===false&&turn.interrupt_response===false&&
        noiseMatches&&
        options.config.include.every(value=>include.includes(value));
      if(!matches){fail("The speech service did not accept the required English transcription settings. Reconnect audio before continuing.");return;}
      clearTimeout(timer);if(!settled){settled=true;resolveReady();}
      options.onAccepted?.({at:Date.now(),event:"session.updated",model:transcription!.model as string,language:transcription!.language as string,noiseReduction:input?.noise_reduction??null,turnDetection:turn,include});
    },
    stop(){if(closed)return;closed=true;clearTimeout(timer);if(!settled)rejectReady(new DOMException("Speech recognition setup was cancelled.","AbortError"));},
  };
}
