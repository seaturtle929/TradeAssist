export type AudioMode = "speakerphone" | "headset" | "computer";

export function normalizeAudioMode(value: unknown): AudioMode {
  return value === "computer" || value === "headset" ? value : "speakerphone";
}

const COMPUTER_AUDIO_HELP = "Use a recent version of Chrome, choose Entire Screen, and turn on Share system audio. Allow screen and system audio access in macOS Privacy & Security if asked.";

/** Retain all capture tracks for cleanup; send only audio tracks to the assistant. */
export async function captureComputerAudio(mediaDevices?: Pick<MediaDevices,"getDisplayMedia"> | null): Promise<MediaStream> {
  if (typeof mediaDevices?.getDisplayMedia !== "function") {
    throw new Error("This browser cannot share computer audio. " + COMPUTER_AUDIO_HELP);
  }
  let captured: MediaStream;
  try {
    // The picker requires a video surface even though Trade Assist uses audio only.
    // Do not suppress playback: the representative still needs to hear the buyer.
    const options: DisplayMediaStreamOptions & {audio:MediaTrackConstraints & {suppressLocalAudioPlayback:false};systemAudio:"include";windowAudio:"system";selfBrowserSurface:"exclude"} = {
      video:true,
      audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false,suppressLocalAudioPlayback:false},
      systemAudio:"include",
      windowAudio:"system",
      selfBrowserSurface:"exclude",
    };
    captured = await mediaDevices.getDisplayMedia(options);
  } catch (error) {
    const name = error && typeof error === "object" && "name" in error ? String(error.name) : "";
    if (name === "NotAllowedError" || name === "AbortError") {
      throw new Error("Computer audio sharing was cancelled or blocked. " + COMPUTER_AUDIO_HELP);
    }
    if (name === "InvalidStateError") {
      throw new Error("Click Test computer audio or Start listening to open the sharing picker. " + COMPUTER_AUDIO_HELP);
    }
    throw new Error("Computer audio could not be captured. " + COMPUTER_AUDIO_HELP);
  }
  if (!captured.getAudioTracks().length) {
    captured.getTracks().forEach(track => track.stop());
    throw new Error("No computer audio was shared. " + COMPUTER_AUDIO_HELP);
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

export function createMicrophonePipeline(ctx: AudioContext, raw: MediaStream, amplification: number) {
  const source = ctx.createMediaStreamSource(raw);
  const gain = ctx.createGain(); gain.gain.value = amplification;
  const limiter = ctx.createWaveShaper();
  const curve = new Float32Array(4097);
  for (let i=0;i<curve.length;i++) {
    const value = i*2/(curve.length-1)-1, magnitude = Math.abs(value);
    curve[i] = magnitude <= .8 ? value : Math.sign(value)*(.8+.2*Math.tanh((magnitude-.8)/.2));
  }
  // Identity for ordinary speech levels, soft ceiling for excessive boost.
  // Unlike a compressor, this adds no automatic makeup gain to quiet input.
  limiter.curve = curve;
  const analyser = ctx.createAnalyser(); analyser.fftSize = 2048;
  const output = ctx.createMediaStreamDestination();
  // This processed track is sent to WebRTC, not just drawn on the meter.
  source.connect(gain); gain.connect(limiter); limiter.connect(analyser); analyser.connect(output);
  return { gain, analyser, stream:output.stream };
}
