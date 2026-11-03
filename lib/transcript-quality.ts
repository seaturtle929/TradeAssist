/**
 * Old recognition hints have been observed coming back as "speech" in quiet
 * audio. Never send these hints to the recognizer again. This narrowly catches
 * delayed completions from an already-open connection as it is replaced.
 *
 * Do not filter normal introductions, repeated questions, or generic sales
 * wording: their presence alone cannot establish that speech was invented.
 */
const LEGACY_TRANSCRIPTION_HINTS = [
  "An English business-to-business sales call between a manufacturer representative and a potential US buyer. Transcribe actual words, including product names, measurements and quantities.",
  "The microphone contains only the sales representative speaking English on a business call. Transcribe the actual words, including prices, product specifications, promises, units, names and dates. Do not invent words during silence.",
];

const canonical = (text:string) => text.toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
const exactHintEchoes = new Set(LEGACY_TRANSCRIPTION_HINTS.flatMap(hint => [hint,...hint.split(/(?<=[.!?])\s+/)]).map(canonical));

export type TranscriptionUncertainty = {reason:string;message:string};

/** A source diagnostic, never a language filter or corrective translation. Keep
 * every recognized character and let the representative confirm uncertain text.
 * A non-Latin name inside otherwise English speech is not itself an error. */
export function unexpectedEnglishScript(text:string):TranscriptionUncertainty|undefined {
  const letters=[...text].filter(char=>/\p{L}/u.test(char));
  const other=letters.filter(char=>!/[\p{Script=Latin}\p{Script=Common}]/u.test(char)).length;
  if(other>=2&&other/Math.max(1,letters.length)>=.5)return {
    reason:"unexpected_script",
    message:"The English speech recognizer returned a different writing system. The original text is preserved; confirm what was said before using it as a name, fact or commitment.",
  };
}

/** Exact application-hint echoes only; unrelated or partially matching speech survives. */
export function isTranscriptionPromptEcho(text:string):boolean {
  return exactHintEchoes.has(canonical(text));
}
