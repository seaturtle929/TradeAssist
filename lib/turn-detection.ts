/** Fast audio chunks; LiveCoachingSession separately protects unfinished thoughts and resumed speech. */
export function buyerTurnDetection(mode:"computer"|"speakerphone"|"headset") {
  // Keep the tuned sensitivity needed for quiet speakerphone audio.
  return {type:"server_vad" as const,threshold:mode==="speakerphone"?.25:.4,prefix_padding_ms:350,silence_duration_ms:mode==="computer"?300:400,create_response:false,interrupt_response:false};
}
