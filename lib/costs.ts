/** Published standard USD rates, checked against the pages below. Estimates are
 * based on reported usage, not the provider's final invoice or account credits. */
export const PRICE_CHECKED_AT = "2026-10-21";
export const PRICE_SOURCES = [
  { title:"GPT Realtime pricing", url:"https://developers.openai.com/api/docs/models/gpt-realtime" },
  { title:"GPT-4.1 mini pricing", url:"https://developers.openai.com/api/docs/models/gpt-4.1-mini" },
  { title:"GPT-4o mini transcription pricing", url:"https://developers.openai.com/api/docs/models/gpt-4o-mini-transcribe" },
  { title:"API and web search pricing", url:"https://developers.openai.com/api/docs/pricing" },
] as const;

export type UsageEntry = {
  id: string;
  at: number;
  kind: "live" | "transcription" | "coach" | "research" | "document";
  usd: number;
  model: string;
  known?: boolean;
};
export type BudgetSettings = { perCallUsd:number; monthlyUsd:number; enabled:boolean };
export const DEFAULT_BUDGET: BudgetSettings = { perCallUsd:3, monthlyUsd:50, enabled:true };
export type UsagePrice = { usd:number; known:boolean };

type Fields = Record<string, unknown>;
const MILLION = 1_000_000;
const fields = (value: unknown): Fields => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Fields : {};
const validCount = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;
const count = (value: unknown) => validCount(value) ? value : 0;
const owns = (value: Fields, key: string) => Object.prototype.hasOwnProperty.call(value,key);
const amount = (value: unknown) => validCount(value) ? value : 0;
const bounded = (value: unknown, maximum: number) => Math.min(count(value),maximum);
const realtimeModel = (model: string) => model === "gpt-realtime" || model === "gpt-realtime-2025-08-28";
const textModel = (model: string) => model === "gpt-4.1-mini" || model === "gpt-4.1-mini-2025-04-14";

/** Pass event.response.usage from response.done. Cached counts are a subset of
 * input counts; they must be subtracted before charging the uncached rate. */
export function priceRealtimeUsage(value: unknown, model = "gpt-realtime"): UsagePrice {
  const usage = fields(value), input = fields(usage.input_token_details), output = fields(usage.output_token_details);
  const cached = fields(input.cached_tokens_details);
  const inputTotal = count(usage.input_tokens), outputTotal = count(usage.output_tokens);
  let known = realtimeModel(model) && validCount(usage.input_tokens) && validCount(usage.output_tokens);

  let text = count(input.text_tokens), audio = count(input.audio_tokens), image = count(input.image_tokens);
  const described = text+audio+image;
  if (described > inputTotal) {
    // A malformed breakdown cannot earn a discount or a lower-rate guess.
    known=false; text=0; image=0; audio=Math.max(inputTotal,described);
  } else if (described < inputTotal) {
    if (owns(input,"audio_tokens") && !owns(input,"text_tokens") && image === 0) text=inputTotal-audio;
    else { audio+=inputTotal-described; known=false; }
  }
  for (const key of ["text_tokens","audio_tokens","image_tokens"]) {
    if (owns(input,key) && !validCount(input[key])) known=false;
  }

  let cachedText = bounded(cached.text_tokens,text), cachedAudio = bounded(cached.audio_tokens,audio), cachedImage = bounded(cached.image_tokens,image);
  const splitCached = cachedText+cachedAudio+cachedImage;
  const cachedTotal = Math.min(inputTotal,Math.max(count(input.cached_tokens),splitCached));
  if (cachedTotal > splitCached) {
    // Old event versions may omit the cached modality split. Allocate to the
    // cheaper uncached modality first so a mixed input is not underpriced.
    let left=cachedTotal-splitCached;
    const textPart=Math.min(left,text-cachedText); cachedText+=textPart; left-=textPart;
    const imagePart=Math.min(left,image-cachedImage); cachedImage+=imagePart; left-=imagePart;
    cachedAudio+=Math.min(left,audio-cachedAudio);
    if ([text,audio,image].filter(n=>n>0).length > 1) known=false;
  }
  if (count(input.cached_tokens) > inputTotal || count(cached.text_tokens) > text || count(cached.audio_tokens) > audio || count(cached.image_tokens) > image) known=false;

  let outputText=count(output.text_tokens), outputAudio=count(output.audio_tokens);
  if (outputText+outputAudio < outputTotal) { outputAudio+=outputTotal-outputText-outputAudio; known=false; }
  if (outputText+outputAudio > outputTotal) known=false;
  for (const key of ["text_tokens","audio_tokens"]) if (owns(output,key) && !validCount(output[key])) known=false;

  // Unknown model names retain these fallback rates without cache discounts;
  // known=false makes the uncertainty visible to the app and its spend guard.
  if (!realtimeModel(model)) {
    return {usd:(Math.max(inputTotal,text+audio+image)*32+Math.max(outputTotal,outputText+outputAudio)*64)/MILLION,known:false};
  }
  const usd=((text-cachedText)*4+(audio-cachedAudio)*32+(image-cachedImage)*5+
    cachedText*.4+cachedAudio*.4+cachedImage*.5+outputText*16+outputAudio*64)/MILLION;
  return {usd,known};
}

/** Mini-transcribe token usage is reported independently of Realtime usage.
 * Duration-only events use its published approximate $0.003/minute estimate. */
export function priceTranscriptionUsage(value: unknown): UsagePrice {
  const usage=fields(value);
  if (usage.type === "duration" || (!owns(usage,"input_tokens") && validCount(usage.seconds))) {
    return {usd:count(usage.seconds)*.003/60,known:false};
  }
  const known=validCount(usage.input_tokens) && validCount(usage.output_tokens);
  return {usd:(count(usage.input_tokens)*1.25+count(usage.output_tokens)*5)/MILLION,known};
}

/** Responses API standard text usage. searchCalls means completed non-preview
 * web_search calls. For 4.1-mini the published search-content charge is a fixed
 * 8k input token block/call. The docs do not establish whether every usage
 * payload includes this block, so add it as a conservative allowance and mark
 * search estimates known=false rather than claim an exact invoice match. */
export function priceTextUsage(value: unknown, model = "gpt-4.1-mini", searchCalls = 0): UsagePrice {
  const usage=fields(value), input=count(usage.input_tokens), output=count(usage.output_tokens);
  const details=fields(usage.input_tokens_details);
  const cached=bounded(details.cached_tokens,input);
  const searches=count(searchCalls);
  const recognized=textModel(model);
  let known=recognized && validCount(usage.input_tokens) && validCount(usage.output_tokens) && validCount(searchCalls);
  if(searches>0)known=false;
  if (owns(details,"cached_tokens") && (!validCount(details.cached_tokens) || count(details.cached_tokens)>input)) known=false;
  const usd=recognized
    ? ((input-cached)*.4+cached*.1+output*1.6+searches*8000*.4)/MILLION+searches*.01
    : (input*32+output*64)/MILLION+searches*(.01+8000*32/MILLION);
  return {usd,known};
}

export function formatUsd(usd: number): string {
  const safe=amount(usd);
  return safe>0 && safe<.01 ? "<$0.01" : new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(safe);
}

/** Calendar month in the user's local time zone, matching the browser UI. */
export function monthSpend(entries: UsageEntry[], date: Date = new Date()): number {
  if (!Number.isFinite(date.getTime())) return 0;
  const start=new Date(date.getFullYear(),date.getMonth(),1).getTime();
  const end=new Date(date.getFullYear(),date.getMonth()+1,1).getTime();
  return entries.reduce((total,entry)=>entry.at>=start && entry.at<end ? total+amount(entry.usd) : total,0);
}

/** A local estimated-spend guard. Responses in flight may still incur charges;
 * this is not an OpenAI account-wide billing limit. Anticipated cost is an
 * optional reserve for the next operation, not another persisted usage entry. */
export function budgetDecision(settings: BudgetSettings, callUsd: number, entries: UsageEntry[], anticipatedUsd = 0): { allowed:boolean; reason:string; remainingUsd:number } {
  if (!settings.enabled) return {allowed:true,reason:"",remainingUsd:Infinity};
  if (!validCount(settings.perCallUsd) || !validCount(settings.monthlyUsd) || !validCount(callUsd) || !validCount(anticipatedUsd)) {
    return {allowed:false,reason:"Review your spending limits before continuing.",remainingUsd:0};
  }
  const callRemaining=Math.max(0,settings.perCallUsd-callUsd), monthlyRemaining=Math.max(0,settings.monthlyUsd-monthSpend(entries));
  const remainingUsd=Math.min(callRemaining,monthlyRemaining);
  if (monthlyRemaining<=0 || anticipatedUsd>monthlyRemaining) return {allowed:false,reason:"Your monthly estimated spending limit has been reached.",remainingUsd};
  if (callRemaining<=0 || anticipatedUsd>callRemaining) return {allowed:false,reason:"This call's estimated spending limit has been reached.",remainingUsd};
  return {allowed:true,reason:"",remainingUsd};
}
