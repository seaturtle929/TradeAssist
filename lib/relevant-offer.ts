export type OfferExplanationContext={manufacturer?:{name?:string;products?:string};sources?:{text:string}[];turns?:{role:string;text:string}[]};
const normalized=(value:string)=>value.replace(/[’‘]/g,"'").toLowerCase().replace(/[^a-z0-9]+/g,' ');
const generic=new Set('we our company also supply supplies offer offers offering produce produces manufacture manufactures provide provides make makes specialize specialise in range products product line portfolio includes include covers consists of has have comes come available offered grades grade high quality key flagship main leading various different materials material goods options versions versions both all a an the for from with and or to you your can could will would us is are that this these those them it its at as by on of needs need anything everything requirements specs specifications documents profile report email send sending share review information details compare comparison quote quotation price prices evaluate evaluation assess assessment current volume volumes team'.split(' '));

/** Checks the presence of a substantive offer proposition, not factual truth.
 * Normal claim verification remains responsible for every concrete claim.
 * No historical example text is ever used as evidence for this function. */
export function hasRelevantOfferExplanation(say:string,context?:OfferExplanationContext):boolean {
 const clauses=say.replace(/[’‘]/g,"'").split(/[.!?;]+/);
 const name=normalized(context?.manufacturer?.name||'').trim(),short=name.split(' ').find(word=>word.length>2&&!['the','company','limited','corporation','international','group','inc','ltd','co'].includes(word));
 const ownNames=[name,short||''].filter(Boolean),companyOffer=(clause:string)=>ownNames.some(value=>normalized(clause).includes(value+' ')&&new RegExp('\\b'+value.replace(/\s+/g,'\\s+')+'\\s+(?:also\\s+)?(?:supplies|offers|produces|manufactures|provides|makes|speciali[sz]es in)\\b').test(normalized(clause)));
 const comparison=(clause:string)=>/\b(?:we|i|you|your team)\s+(?:could|can|would|may)\s+(?:also\s+)?look at\b/i.test(clause)&&/\b(?:against|alongside|compare|comparison|current (?:grades|requirements))\b/i.test(clause);
 const offer=clauses.filter(clause=>companyOffer(clause)||comparison(clause)||/\b(?:we|our company)\s+(?:also\s+)?(?:can\s+)?(?:supply|offer|produce|manufacture|provide|make|speciali[sz]e in)\b|\b(?:we|i|you|your team)\s+(?:could|can|would|may)\s+(?:also\s+)?(?:compare|evaluate|assess|quote)\b|\bwe(?:'re| are)\b.{0,60}\b(?:manufacturer|supplier|producer)\b|\bour (?:range|products?|offer|line|portfolio)\s+(?:includes?|covers?|consists of)\b|\b(?:is|are)\s+(?:our|one of our|a key)\b|\bour\b.{1,60}\b(?:has|have|comes? in|is available|is offered|features?)\b/i.test(clause));
 if(!offer.length)return false;
 const evidence=[context?.manufacturer?.products||'',...(context?.sources||[]).map(source=>source.text),...(context?.turns||[]).filter(turn=>turn.role==='you').map(turn=>turn.text)].join(' ');
 const available=new Set(normalized(evidence).split(/\s+/).filter(Boolean));
 if(/\bwhite fused alumina\b/i.test(evidence))available.add('wfa');
 if(/\bsilicon carbide\b/i.test(evidence))available.add('sic');
 const nameWords=new Set(name.split(' '));
 return offer.some(clause=>{const specifics=normalized(clause).split(/\s+/).filter(word=>word.length>=3&&!generic.has(word)&&!nameWords.has(word));return specifics.length>0&&(!context||specifics.some(word=>available.has(word)));});
}
