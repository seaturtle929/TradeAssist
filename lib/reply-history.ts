import type { Guidance } from "./trade";
import type { SuggestionRecord } from "./phase1-types";

export type ReplyHistoryEntry={id:string;at:number;guidance:Guidance;streaming:boolean;status:SuggestionRecord["status"];bilingual:boolean;actualSpoken?:string;buyerQuote?:string};

export function hasWordingEdit(entry:Pick<SuggestionRecord,"status"|"editedAt">) {
  return Number.isFinite(entry.editedAt) || entry.status==="edited";
}

/** Feedback records a choice; only actual transcripts establish spoken words. */
export function applySuggestionFeedback(previous:SuggestionRecord[],id:string,status:"used"|"ignored"|"edited",editedText?:string):SuggestionRecord[] {
  const text=editedText?.trim().slice(0,600);
  if(status==="edited"&&!text)return previous;
  const feedbackAt=Date.now();
  return previous.map(item=>item.id!==id ? item : {
    ...item,status,feedbackAt,feedbackSource:"manual" as const,...(hasWordingEdit(item)?{editedAt:item.editedAt ?? item.at}:{}),
    ...(status==="edited" ? {editedAt:feedbackAt,originalSay:item.originalSay ?? item.guidance.say,guidance:{...item.guidance,say:text!,verified:false,verificationStatus:undefined,evidence:[]}} : {}),
  });
}

export function recordSuggestionSpeech(previous:SuggestionRecord[],id:string,reason:"used"|"spoken"|"ignored",actualText?:string,actualTurnIds:string[]=[]):SuggestionRecord[] {
  return previous.map(item=>item.id!==id ? item : {
    ...item,
    status:item.feedbackSource==="manual" ? item.status : reason==="ignored" ? "ignored" : actualText && actualText.toLowerCase()!==item.guidance.say.toLowerCase() ? "edited" : "used",
    feedbackSource:item.feedbackSource || "speech",
    ...(actualText ? {actualSpoken:actualText,actualTurnIds} : {}),
  });
}

/** Preserve the source-check diff even when a rep edit prevents its application. */
export function recordVerificationReplacement(previous:SuggestionRecord[],id:string,replacement:NonNullable<SuggestionRecord["verificationReplacements"]>[number]):SuggestionRecord[] {
  return previous.map(item=>item.id!==id ? item : hasWordingEdit(item)
    ? {...item,verificationProposals:[...(item.verificationProposals||[]),replacement]}
    : {...item,verificationReplacements:[...(item.verificationReplacements||[]),replacement]});
}

/** Metadata and source checks update a reply in place, keeping its original time. */
export function upsertSuggestion(previous:SuggestionRecord[],entry:SuggestionRecord):SuggestionRecord[] {
  const index=previous.findIndex(item=>item.id===entry.id);
  if(index<0)return [...previous,entry];
  const prior=previous[index];
  const next={...prior,...entry,at:prior.at};
  // A delayed check must not overwrite wording the representative just edited.
  if(hasWordingEdit(prior) && !entry.editedAt) {
    next.guidance={...prior.guidance,say:prior.guidance.say,verified:false,verificationStatus:undefined,evidence:[]};
    next.editedAt=prior.editedAt ?? prior.at;next.originalSay=prior.originalSay;
  }
  if(prior.feedbackSource==="manual"){next.status=prior.status;next.feedbackSource="manual";}
  if(prior.status!=="suggested"&&entry.status==="suggested")next.status=prior.status;
  if(prior.actualSpoken&&!next.actualSpoken)next.actualSpoken=prior.actualSpoken;
  return previous.map((item,i)=>i===index ? next : item);
}

/** A streaming response occupies one row; silence never removes saved replies. */
export function buildReplyHistory(suggestions:SuggestionRecord[],guidance:Guidance|null,guidanceId:string,activeAt:number):ReplyHistoryEntry[] {
  const entries:ReplyHistoryEntry[]=[];
  for(const item of Array.isArray(suggestions) ? suggestions : []) {
    // Older/imported browser backups may predate coaching records entirely.
    if(!item || typeof item.id!=="string" || !item.guidance || typeof item.guidance.say!=="string" || !item.guidance.say.trim() || !Array.isArray(item.guidance.evidence) || !Number.isFinite(item.at) || Math.abs(item.at)>8.64e15)continue;
    const entry={id:item.id,at:item.at,guidance:item.guidance,streaming:false,status:item.status,bilingual:item.bilingual,actualSpoken:item.actualSpoken,buyerQuote:item.buyerQuote};
    const index=entries.findIndex(existing=>existing.id===item.id);
    if(index<0)entries.push(entry);else entries[index]=entry;
  }
  if(!guidance?.say.trim() || !guidanceId)return entries;
  const index=entries.findIndex(item=>item.id===guidanceId);
  if(index>=0) {
    const prior=entries[index];
    const saved=suggestions.find(item=>item?.id===guidanceId);
    if(!saved||!hasWordingEdit(saved))entries[index]={...prior,guidance,streaming:guidance.verified!==true};
  } else entries.push({id:guidanceId,at:activeAt,guidance,streaming:guidance.verified!==true,status:"suggested",bilingual:false});
  return entries;
}
