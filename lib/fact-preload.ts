import type { Guidance } from "./trade";
import type { CoachingContext } from "./call-coaching";
import {normalizeGuidance} from "./call-coaching.ts";
import {referenceExcerpts} from "./coach.ts";

/** Cache only whole short original excerpts, never model-authored product claims. */
export function resolvePreloadedFacts(value:unknown,context:CoachingContext) {
  const refs=referenceExcerpts(context.sources || []);
  if(!Array.isArray(value))return [];
  return value.slice(0,3).flatMap(item=>{
    if(!item||typeof item!=="object")return [];
    const candidate=item as {question?:unknown;sourceId?:unknown;excerptId?:unknown};
    if(typeof candidate.question!=="string"||candidate.question.length>250)return [];
    const ref=refs.find(source=>source.sourceId===candidate.sourceId&&source.excerptId===candidate.excerptId);
    if(!ref||ref.text.split(/\s+/).length>28||/[\u3400-\u9fff]/.test(ref.text)||!ref.text.trim()||!/[.!?]$/.test(ref.text.trim()))return [];
    const guidance:Guidance=normalizeGuidance({say:ref.text.trim(),evidence:[{sourceId:ref.sourceId,quote:ref.text}],missing:[],backup:"",caution:""},{...context,turns:[{role:"buyer",text:candidate.question}]},{verified:true});
    if(guidance.say!==ref.text.trim())return [];
    return [{question:candidate.question,guidance}];
  });
}
