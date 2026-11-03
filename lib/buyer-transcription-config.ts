import { buyerTurnDetection } from "./turn-detection.ts";
import { englishTranscription, TRANSCRIPTION_CONFIDENCE_FIELDS } from "./english-transcription.ts";

export type BuyerAudioMode = "computer" | "speakerphone" | "headset";

export function buyerAudioMode(value: unknown): BuyerAudioMode {
  return value === "computer" || value === "headset" ? value : "speakerphone";
}

/** The buyer's computer stream is already telephony-compressed. Use the fuller
 * recognizer without adding another noise suppressor or waiting for more audio.
 * Confidence metadata is optional evidence, never a guarantee of completeness.
 * https://developers.openai.com/api/reference/resources/realtime/client-events */
export function buyerTranscriptionConfig(mode: BuyerAudioMode) {
  return {
    include: [...TRANSCRIPTION_CONFIDENCE_FIELDS],
    audio: { input: {
      // Prose prompts have previously appeared as invented speech on quiet input.
      // Company and buyer context belong to coaching, not recognition hints.
      transcription: englishTranscription(mode === "computer" ? "gpt-4o-transcribe" : "gpt-4o-mini-transcribe"),
      noise_reduction: mode === "headset" ? { type: "near_field" } : null,
      turn_detection: buyerTurnDetection(mode),
    } },
  };
}
