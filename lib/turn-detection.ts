/** Short computer-audio chunks; unfinished/resumed buyer speech remains owned by
 * the pending explicit request until a stable reply is published. */
export const buyerVadSilenceMs=(mode:"computer"|"speakerphone"|"headset")=>mode==="computer"?200:400;
export function buyerTurnDetection(mode:"computer"|"speakerphone"|"headset") {
  // Keep the tuned sensitivity needed for quiet speakerphone audio.
  return {type:"server_vad" as const,threshold:mode==="speakerphone"?.25:.4,prefix_padding_ms:350,silence_duration_ms:buyerVadSilenceMs(mode),create_response:false,interrupt_response:false};
}
