import { isUnfinishedBuyerThought } from "./buyer-thought.ts";

export type BuyerAudioIssue = {
  id: string;
  reason: string;
  message: string;
  repeatLine: string;
  attempt: number;
  at: number;
};

export type BuyerTranscriptAssessment = {
  status: "accept" | "ignore" | "uncertain" | "unfinished";
  reason?: string;
  message?: string;
};

type ConfidenceToken = { token: string; logprob: number; start: number; end: number };
const lexical = /[\p{L}\p{N}]/u;
const marker = /[\[(<]\s*(?:inaudible|unintelligible|unclear(?:\s+(?:audio|speech))?)(?:\s+(?:audio|speech))?\s*[\])>]/i;
const filler = /^(?:(?:u+h+|u+m+|h+m+|m+h+m+|m+m+|a+h+|e+r+m*|h+u+h+)(?:\s+|$))+$/i;
const thinkingPause = /^(?:(?:well|okay|ok)\s+)*(?:well|let me (?:think|see)(?: about (?:that|it))?|i(?: m| am) thinking(?: about (?:that|it))?|give me (?:a (?:moment|second)|some time)|(?:one|just a) (?:moment|second))$/i;
const MAX_CONFIDENCE_TOKENS = 512;

/** Use only bounded, finite lexical logprobs. Punctuation confidence says little
 * about whether the buyer's actual words were heard. Missing metadata is unknown,
 * not evidence of failed audio. This cannot detect every omitted or wrong word. */
function confidenceTokens(value: unknown): { tokens: ConfidenceToken[]; text: string } {
  if (!Array.isArray(value)) return { tokens: [], text: "" };
  const tokens: ConfidenceToken[] = [];
  let text = "";
  for (const item of value.slice(0, MAX_CONFIDENCE_TOKENS)) {
    if (!item || typeof item !== "object" || typeof item.token !== "string" || item.token.length > 256 ||
      typeof item.logprob !== "number" || !Number.isFinite(item.logprob) || item.logprob > 0) continue;
    const start = text.length;
    text += item.token;
    if (lexical.test(item.token)) tokens.push({ token: item.token, logprob: item.logprob, start, end: text.length });
  }
  return { tokens, text };
}

const uncertain = (reason: string, message: string): BuyerTranscriptAssessment => ({ status: "uncertain", reason, message });

export function assessBuyerTranscript({ text, logprobs, speechMs }: {
  text: string;
  logprobs?: unknown;
  speechMs?: number;
}): BuyerTranscriptAssessment {
  const line = text.trim();
  if (marker.test(line) || /^(?:inaudible|unintelligible)[.!?]*$/i.test(line)) {
    return uncertain("inaudible", "Part of the buyer’s audio was unclear. Ask them to repeat, and listen carefully as they do.");
  }
  if (!lexical.test(line)) {
    // A brief click, breath or hesitation must not produce a repeat request.
    return typeof speechMs === "number" && Number.isFinite(speechMs) && speechMs >= 1200
      ? uncertain("empty_transcript", "Buyer speech was detected without a usable transcript. Ask them to repeat, and listen carefully as they do.")
      : { status: "ignore" };
  }
  const words = line.replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
  if (filler.test(words)) return { status: "ignore" };
  // A thinking acknowledgment or an um after a complete sentence must not be
  // treated as a broken capture, even after a long pause.
  const withoutHesitation = line.replace(/(?:[,;:\s]+)?\b(?:u+m+|u+h+|h+m+|m+h+m+)(?:[.!?…\s]*)$/i, "").trim();
  const thinkingWords = withoutHesitation.replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
  if (thinkingPause.test(thinkingWords)) return { status: "ignore" };

  const confidence = confidenceTokens(logprobs), tokens = confidence.tokens;
  if (tokens.length >= 2) {
    // Tokenized email fragments are critical too; do not require @ and the
    // uncertain word to happen to be emitted in the same model token.
    const emails = [...confidence.text.matchAll(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)+/gi)]
      .map(match => ({ start: match.index!, end: match.index! + match[0].length }));
    if (tokens.some(token => token.logprob < Math.log(.25) && (/\p{N}/u.test(token.token) ||
      emails.some(email => token.start < email.end && token.end > email.start)))) {
      return uncertain("uncertain_detail", "A number or email address may have been misheard. Ask the buyer to repeat that detail, and listen carefully.");
    }
    const low = tokens.filter(token => token.logprob < Math.log(.30)).length;
    if (low >= 2 && low / tokens.length >= .30) {
      return uncertain("low_confidence", "Several buyer words were unclear. Ask them to repeat, and listen carefully as they do.");
    }
  }
  // Mean logprob is the geometric mean of token probabilities; an arithmetic
  // probability average can hide a seriously uncertain part of an utterance.
  if (tokens.length >= 3 && tokens.reduce((sum, token) => sum + token.logprob, 0) / tokens.length < Math.log(.55)) {
    return uncertain("low_confidence", "The buyer’s words could not be transcribed confidently. Ask them to repeat, and listen carefully as they do.");
  }
  // A natural thinking pause alone is not evidence of a capture failure.
  return { status: isUnfinishedBuyerThought(withoutHesitation) ? "unfinished" : "accept" };
}

export function audioIssueFor(id: string, reason: string, message: string, attempt: number, at = Date.now()): BuyerAudioIssue {
  const attempts = Number.isFinite(attempt) ? Math.max(1, Math.floor(attempt)) : 1;
  return {
    id, reason, message, attempt: attempts, at,
    repeatLine: attempts > 1
      ? "Sorry, the audio is still breaking up. Could you repeat that a little more slowly?"
      : "Sorry, I didn’t quite catch that. Could you repeat that?",
  };
}
