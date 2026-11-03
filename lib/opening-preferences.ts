export const MAX_OPENING_LENGTH=1200;
export type OpeningChoice={mode:"suggested"|"custom";text:string;customDraft?:string};

/** Trim only at use/save time. Spaces and line breaks stay intact while editing. */
export function normalizeOpening(value:unknown):string {
  return typeof value==="string"?value.slice(0,MAX_OPENING_LENGTH).trim():"";
}

export function openingChoiceFor(choice:OpeningChoice|undefined,companyDefault:unknown,suggestion:string):OpeningChoice {
  if(choice)return {...choice,text:choice.mode==="suggested"?suggestion:choice.text};
  const saved=normalizeOpening(companyDefault);
  return saved?{mode:"custom",text:saved}:{mode:"suggested",text:suggestion};
}

/** Trying the suggestion must not erase an unfinished authored opening. */
export function chooseOpeningMode(mode:OpeningChoice["mode"],previous:OpeningChoice|undefined,fallback:string):OpeningChoice {
  const draft=previous?.mode==="custom"?previous.text:previous?.customDraft;
  return {mode,text:mode==="custom"?draft??fallback:"",...(draft!==undefined?{customDraft:draft}:{})};
}
