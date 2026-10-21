export type AudioMode = "speakerphone" | "headset";

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
