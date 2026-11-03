import type { Turn } from "./trade";
import type { TranslatedTurn, TranslationContextTurn, TranslationSourceTurn } from "./translation";
import { isTranscriptionPromptEcho } from "./transcript-quality.ts";

/** Mixed microphone audio is translated without guessing its speaker. */
export const canTranslateTurn=(turn:Pick<Turn,"role"|"text">)=>turn.role!=="you" && !isTranscriptionPromptEcho(turn.text);

/** Capture a bounded, chronological prefix at enqueue time. Saved post-call
 * memory and later transcript turns never enter an earlier row's translation. */
export function buildTranslationTurns(conversation:Turn[],selected:Turn[]=conversation):TranslationSourceTurn[] {
  return selected.filter(canTranslateTurn).map(turn=>{
    const index=conversation.findIndex(item=>item.id===turn.id && item.text===turn.text);
    const context:TranslationContextTurn[]=[];let remaining=4000;
    for(let at=index-1;at>=0 && context.length<6 && remaining>0;at--) {
      const previous=conversation[at];
      if(!previous.text.trim() || isTranscriptionPromptEcho(previous.text))continue;
      // Keep full short segments and the end of a long segment, where speech
      // continuation lives. Targets themselves are never truncated or merged.
      const text=previous.text.slice(-Math.min(1000,remaining));
      context.unshift({role:previous.role,text});remaining-=text.length;
    }
    return {id:turn.id,text:turn.text,context};
  });
}

/** A translation is a display aid for one exact original turn. */
export function applyBuyerTranslations(turns:Turn[],translations:TranslatedTurn[]):Turn[] {
  let changed=false;
  const next=turns.map(turn=>{
    const match=translations.find(item=>item.id===turn.id && item.text===turn.text);
    if(!canTranslateTurn(turn) || !match || turn.translationZh===match.translationZh)return turn;
    changed=true;return {...turn,translationZh:match.translationZh};
  });
  return changed ? next : turns;
}
