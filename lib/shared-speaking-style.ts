// Conservative vocabulary for reusable conversational phrasing. Unknown names,
// products and factual scripts stay in their company learning store; they are
// never guessed safe by redacting one known company name.
const neutralWords=new Set(`a an the i i'm i've i'd i'll me my you you're you've you'd your we we're we've we'd us our they them their it its it's that that's this these those and or but so if then than as at by for from in into of on over to with about after before again all also any be been being am is are was were do does did don't doesn't didn't not no yes yeah okay ok sure thanks thank thankyou please sorry understand understood see hear heard got get let let's lets take one step time explaining explained explain sharing share tell told ask asking asked know knowing think thinking thought feel feeling feels sounds sound makes make sense good great helpful useful works work matter matters next more much little bit just really right well would could should can might may what what's which when where how who why want wanted need needs like interested interest prefer best better good email address reach review look looking question questions conversation something anything everything nothing someone anyone today together here there ready happy glad appreciate honest fair enough absolutely agreed agree welcome course go ahead help clarifying clarify confirm checking check consider considering compare comparing discuss discussion talk talking listen listening carefully easy easier important point points way ways fit fits foryou`.split(/\s+/));
/** Shared style travels between companies; factual scripts must stay company-scoped. */
export function generalStyleExamples(examples:string[]) {
 return examples.filter(text=>{
  if(/[0-9@$%]|\b(?:we|our|i)(?:\s+|['’](?:re|ll|m)\s+)(?:are|am|have|own|run|mine|make|manufacture|produce|supply|offer|sell|provide|ship|deliver|can|will|with|from)|\b(?:manufacturer|middleman|factory|plants?|bauxite|alumina|carbide|certif\w*|purity|specifications?|MOQ|CIF|FOB|price|pricing|discount|guarantee|warranty)\b/i.test(text))return false;
  const words=text.toLowerCase().replace(/[’‘]/g,"'").match(/[\p{L}]+(?:'[\p{L}]+)?/gu)||[];
  return words.length>0&&words.every(word=>neutralWords.has(word));
 });
}
