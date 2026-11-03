export type AudioMode = "speakerphone" | "headset" | "computer";

export function normalizeAudioMode(value: unknown): AudioMode {
  return value === "computer" || value === "headset" ? value : "speakerphone";
}

export type ComputerAudioCaptureErrorCode =
  | "system_permission" | "permission_denied" | "aborted" | "source_unavailable"
  | "activation" | "policy_blocked" | "unsupported_options" | "unknown"
  | "unsupported" | "no_audio";

function captureErrorDetail(value:unknown):string {
  return typeof value==="string" ? value.replace(/[\u0000-\u001f\u007f]+/g," ").trim().slice(0,300) : "";
}
function nativeCaptureDetails(error:unknown) {
  if(typeof error==="string")return {nativeName:"",nativeMessage:captureErrorDetail(error)};
  if(error&&typeof error==="object"){
    // DOMException properties are not enumerable. Reading them directly also
    // supports browser errors from another frame; instanceof would not.
    try {
      const detail=error as {name?:unknown;message?:unknown};
      return {nativeName:captureErrorDetail(detail.name),nativeMessage:captureErrorDetail(detail.message)};
    } catch { /* A throwing property cannot hide the original capture failure. */ }
  }
  return {nativeName:"",nativeMessage:""};
}

/** A capture failure, with bounded browser diagnostics separate from user help.
 * Keep the original cause: NotAllowedError alone does not distinguish a closed
 * picker, a browser permission, a system permission or a managed-browser policy. */
export class ComputerAudioCaptureError extends Error {
  readonly code:ComputerAudioCaptureErrorCode;
  readonly nativeName:string;
  readonly nativeMessage:string;
  constructor(code:ComputerAudioCaptureErrorCode,message:string,cause?:unknown) {
    super(message,{cause});
    this.name="ComputerAudioCaptureError";
    this.code=code;
    const details=nativeCaptureDetails(cause);
    this.nativeName=details.nativeName;this.nativeMessage=details.nativeMessage;
  }
}

export function computerAudioCaptureError(error:unknown):ComputerAudioCaptureError {
  if(error instanceof ComputerAudioCaptureError)return error;
  const {nativeName,nativeMessage}=nativeCaptureDetails(error);
  // Classify only explicit policy/system evidence. Generic permission errors
  // remain ambiguous rather than asserting that the user disabled a setting.
  if(/permissions?[- ]?policy|feature[- ]?policy|blocked by (?:an? )?(?:administrator|enterprise|organization)|(?:administrator|enterprise|organization).{0,40}(?:blocked|disabled)|(?:blocked|denied|disabled|disallow).{0,40}(?:system|browser|security|enterprise|organization)\s+policy|(?:system|browser|security|enterprise|organization)\s+policy.{0,40}(?:blocked|denied|disabled|disallow)/i.test(nativeMessage)){
    return new ComputerAudioCaptureError("policy_blocked","This page is blocked from requesting screen or audio sharing in its current browser frame or policy. Open Trade Assist directly in a Google Chrome tab.",error);
  }
  if(/(?:denied|blocked|not allowed)\s+by\s+(?:the\s+)?(?:operating\s+system|system|macos)\b|\b(?:operating\s+system|macos)\b.{0,50}\b(?:denied|blocked|not granted|not allowed)\b|\bsystem[- ]level\s+permission\s+(?:denied|blocked)\b/i.test(nativeMessage)){
    return new ComputerAudioCaptureError("system_permission","The operating system reported a capture permission denial. If browser access is already on, fully quit and reopen the browser. Otherwise, review this browser under macOS System Settings → Privacy & Security → Screen & System Audio Recording.",error);
  }
  if(nativeName==="NotAllowedError"){
    return new ComputerAudioCaptureError("permission_denied","The browser did not grant computer audio sharing. Click Test computer audio again, choose Entire Screen, turn on Share system audio, and click Share. If you already did, check this browser’s screen and audio permissions.",error);
  }
  if(nativeName==="AbortError"){
    return new ComputerAudioCaptureError("aborted","Computer audio capture stopped before it could start. Return to this page and click Test computer audio again.",error);
  }
  if(nativeName==="NotReadableError"){
    return new ComputerAudioCaptureError("source_unavailable","The browser could not read the selected screen or audio source. Stop the old share and choose the source again. If it still fails, fully quit and reopen the browser.",error);
  }
  if(nativeName==="InvalidStateError"){
    return new ComputerAudioCaptureError("activation","Click Test computer audio or Start live assistant again while this page is in front. Sharing must start from a fresh click in the active tab.",error);
  }
  if(nativeName==="TypeError"||nativeName==="OverconstrainedError"){
    return new ComputerAudioCaptureError("unsupported_options","The browser rejected the computer-audio capture options. Use an up-to-date Google Chrome window and try again.",error);
  }
  return new ComputerAudioCaptureError("unknown","Computer audio capture could not start. Try a fresh sharing request; the browser error details can help identify the cause.",error);
}

/** Retain all capture tracks for cleanup; send only audio tracks to the assistant. */
export async function captureComputerAudio(mediaDevices?: Pick<MediaDevices,"getDisplayMedia"> | null): Promise<MediaStream> {
  if (typeof mediaDevices?.getDisplayMedia !== "function") {
    throw new ComputerAudioCaptureError("unsupported","This browser cannot share computer audio. Open Trade Assist in a recent version of Google Chrome.");
  }
  let captured: MediaStream;
  try {
    // The picker requires a video surface even though Trade Assist uses audio only.
    // Do not suppress playback: the representative still needs to hear the buyer.
    const options: DisplayMediaStreamOptions & {audio:MediaTrackConstraints & {suppressLocalAudioPlayback:false};systemAudio:"include";windowAudio:"system";selfBrowserSurface:"exclude"} = {
      video:true,
      // Prefer full-band digital playback; these are hints, not capture requirements.
      audio:{sampleRate:{ideal:48000},channelCount:{ideal:2},echoCancellation:false,noiseSuppression:false,autoGainControl:false,suppressLocalAudioPlayback:false},
      systemAudio:"include",
      windowAudio:"system",
      selfBrowserSurface:"exclude",
    };
    captured = await mediaDevices.getDisplayMedia(options);
  } catch (error) {
    throw computerAudioCaptureError(error);
  }
  if (!captured.getAudioTracks().length) {
    captured.getTracks().forEach(track => track.stop());
    throw new ComputerAudioCaptureError("no_audio","No computer audio was shared. In Chrome, choose Entire Screen and turn on Share system audio. If that option is unavailable, this browser or source does not provide computer audio.");
  }
  return captured;
}

export function microphoneConstraints(mode: AudioMode, deviceId: string): MediaTrackConstraints {
  // A phone speaker is the wanted signal, so do not remove it as room playback/noise.
  const cleanup = mode === "headset";
  return { echoCancellation:cleanup, noiseSuppression:cleanup, autoGainControl:cleanup, channelCount:1, ...(deviceId ? {deviceId:{exact:deviceId}} : {}) };
}

export function audioSignal(samples: Float32Array) {
  let squares = 0, peak = 0;
  for (const sample of samples) { squares += sample*sample; peak = Math.max(peak,Math.abs(sample)); }
  const rms = Math.sqrt(squares / Math.max(1,samples.length));
  const db = rms > 0 ? 20*Math.log10(rms) : -100;
  return { db, peak, level:Math.min(1,Math.max(0,(db+65)/55)), signal:peak >= .9 ? "clipping" : db < -45 ? "quiet" : "good" } as const;
}

function softLimiterCurve() {
  const curve = new Float32Array(4097);
  for (let i=0;i<curve.length;i++) {
    const value = i*2/(curve.length-1)-1, magnitude = Math.abs(value);
    curve[i] = magnitude <= .8 ? value : Math.sign(value)*(.8+.2*Math.tanh((magnitude-.8)/.2));
  }
  return curve;
}

export function createMicrophonePipeline(ctx: AudioContext, raw: MediaStream, amplification: number) {
  const source = ctx.createMediaStreamSource(raw);
  const gain = ctx.createGain(); gain.gain.value = amplification;
  const limiter = ctx.createWaveShaper();
  // Identity for ordinary speech levels, soft ceiling for excessive boost.
  // Unlike a compressor, this adds no automatic makeup gain to quiet input.
  limiter.curve = softLimiterCurve();
  const analyser = ctx.createAnalyser(); analyser.fftSize = 2048;
  const output = ctx.createMediaStreamDestination();
  // This processed track is sent to WebRTC, not just drawn on the meter.
  source.connect(gain); gain.connect(limiter); limiter.connect(analyser); analyser.connect(output);
  return { gain, analyser, stream:output.stream };
}

/** Digital playback does not need the high boost used to hear a phone speaker. */
export function normalizeComputerAudioGain(amplification: number) {
  return Number.isFinite(amplification) ? Math.min(2,Math.max(1,amplification)) : 1;
}

/** Clean the captured playback track without applying microphone speech removal. */
export function createComputerAudioPipeline(ctx: AudioContext, raw: MediaStream, amplification = 1) {
  const source = ctx.createMediaStreamSource(raw);
  // Keep a pre-processing meter so source clipping is not hidden by the limiter.
  const inputAnalyser = ctx.createAnalyser(); inputAnalyser.fftSize = 2048;
  const gain = ctx.createGain();
  gain.gain.value = normalizeComputerAudioGain(amplification);
  // Web Audio's speaker down-mix preserves a duplicated mono call at unity level.
  gain.channelCount = 1; gain.channelCountMode = "explicit"; gain.channelInterpretation = "speakers";
  const highpass = ctx.createBiquadFilter();
  highpass.type = "highpass"; highpass.frequency.value = 70;
  const lowpass = ctx.createBiquadFilter();
  lowpass.type = "lowpass"; lowpass.frequency.value = Math.min(10000,ctx.sampleRate * .45);
  // For low/high-pass filters Web Audio expresses Q in dB. A Butterworth response
  // removes rumble/hiss without a resonant boost, preserving consonants up to 8 kHz.
  // https://www.w3.org/TR/webaudio/#filters-characteristics
  highpass.Q.value = lowpass.Q.value = -3.010299956639812;
  const limiter = ctx.createWaveShaper();
  limiter.curve = softLimiterCurve(); limiter.oversample = "none";
  const analyser = ctx.createAnalyser(); analyser.fftSize = 2048;
  const output = ctx.createMediaStreamDestination();
  output.channelCount = 1; output.channelCountMode = "explicit"; output.channelInterpretation = "speakers";
  const nodes = [source,inputAnalyser,gain,highpass,lowpass,limiter,analyser,output];
  for (let i=0;i<nodes.length-1;i++) nodes[i].connect(nodes[i+1]);
  // No connection to ctx.destination: the call app already plays the buyer's audio.
  // Only this processed audio track goes to WebRTC; raw video stays with its owner.
  let disposed = false;
  return { gain, analyser, inputAnalyser, stream:output.stream, dispose() {
    if (disposed) return;
    disposed = true;
    nodes.forEach(node => node.disconnect());
    output.stream.getTracks().forEach(track => track.stop());
  } };
}
