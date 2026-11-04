/** Small, extractive specification matching. A number is not evidence by
 * itself: product, property, value, unit and qualification must travel together.
 * This does not interpret tables, convert units or establish product fitness. */
export type SpecificationSource={id:string;text:string;title?:string;complete?:boolean};
type Fact={product:string;property:string;value:string;unit:string;start:number;end:number};
const productPattern=/\b[A-Z]{1,6}\d{1,6}[A-Z0-9-]*\b/gi;
const excludedId=/^(?:ISO|EN|ASTM|DIN|IEC|UL)\d|^(?:Al2O3|SiO2|Fe2O3|TiO2|Na2O|CaO|MgO)$/i;
const ids=(text:string)=>[...new Set((text.match(productPattern)||[]).filter(value=>!excludedId.test(value)).map(value=>value.toLowerCase()))];
const ownsScope=(text:string,product:string)=>new RegExp('^\\s*(?:(?:our|the|this)\\s+)?(?:(?:product|grade)\\s+)?'+product.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+"(?:['’]s)?(?=\\s|[,:—–(])",'i').test(text);
const norm=(text:string)=>text.toLowerCase().replace(/[’‘]/g,"'").replace(/\s+/g,' ').trim();
const stale=/\b(?:draft|outdated|superseded|historical|archived|not current|for reference only|expired)\b/i;
const qualified=/\b(?:not|no|never|unknown|unconfirmed|unverified|approximately|approx|about|estimated|may|might|could|depending|unless|except|subject to|only when|only if)\b/i;
function parts(text:string):string[]{return text.split(/\n+|(?<=[.!?;])\s+/).filter(Boolean);}
function rawFacts(text:string,product:string,original=false):Fact[]{
 // This literal grammar covers unsigned specifications only. Never erase a
 // source sign while removing punctuation or reinterpret it as a magnitude.
 if(/(?:^|[\s:(])[-+]\s*\d/.test(text))return [];
 const result:Fact[]=[];
 const add=(property:string,match:RegExpMatchArray,value:string,unit:string)=>result.push({product,property,value:String(Number(value)),unit:norm(unit).replace(/millimet(?:er|re)s?/g,'mm').replace(/micromet(?:er|re)s?|microns?|μm/g,'um'),start:match.index||0,end:(match.index||0)+match[0].length});
 // Nominal is part of the property: deleting it would strengthen the claim.
 for(const match of text.matchAll(/\b((?:published\s+)?nominal\s+)?(opening|aperture|wire\s+diameter)(?:\s+size)?\s*(?:(?:is|of|:|=)\s*)?(\d+(?:\.\d+)?)\s*(mm|millimet(?:er|re)s?|μm|um|micromet(?:er|re)s?|microns?|cm|inches?|inch)\b/gi))add((match[1]?'nominal_':'')+(/wire/i.test(match[2])?'wire_diameter':'opening'),match,match[3],match[4]);
 for(const match of text.matchAll(/\b(\d+(?:\.\d+)?)\s*(mm|millimet(?:er|re)s?|μm|um|micromet(?:er|re)s?|microns?|cm|inches?|inch)\s+((?:published\s+)?nominal\s+)?(opening|aperture|wire\s+diameter)(?:\s+size)?\b/gi))add((match[3]?'nominal_':'')+(/wire/i.test(match[4])?'wire_diameter':'opening'),match,match[1],match[2]);
 // Mesh count and stainless grade have ordinary spoken shorthand. Matching
 // these labels never turns the count into an opening or performance claim.
 const mesh=original?/\b(\d+(?:\.\d+)?)\s+mesh\s+per\s+inch\b/gi:/\b(\d+(?:\.\d+)?)\s+mesh(?:\s+per\s+inch)?\b(?!\s*(?:\/|per\b))/gi;
 const steel=original?/\b(\d{3})\s+stainless\s+steel\b/gi:/\b(\d{3})\s+stainless(?:\s+steel)?\b/gi;
 for(const match of text.matchAll(mesh))add('mesh_count',match,match[1],'mesh per inch');
 for(const match of text.matchAll(steel))add('stainless_grade',match,match[1],'stainless steel');
 return result;
}
function specificationResidue(text:string,facts:Fact[],original=false):string{
 let residue=text;
 for(const fact of [...facts].sort((one,two)=>two.start-one.start))residue=residue.slice(0,fact.start)+' '+residue.slice(fact.end);
 residue=residue.replace(productPattern,'').replace(/['’]s\b/gi,'').replace(/\b(?:our|the|this|product|grade|mesh|is|are|has|have|a|an|of|with|and|made|from|published)\b/gi,'');
 if(original)residue=residue.replace(/\b(?:its|it)\b/gi,'');
 return residue.replace(/[\s.,;:—–-]/g,'');
}
function sourceFacts(source:SpecificationSource):{facts:Fact[];unsafe:Set<string>}{
 const facts:Fact[]=[],unsafe=new Set<string>();let sourceOpaque=false;
 if(source.complete===false)return {facts,unsafe};
 for(const paragraph of source.text.split(/\n\s*\n/)){
  const paragraphFacts:Fact[]=[];let previous:string|undefined,opaque=false;
  for(const part of parts(paragraph)){
   const explicit=ids(part),pronoun=/^\s*(?:its|this product's|this grade's)\b/i.test(part);
   const product=explicit.length===1&&ownsScope(part,explicit[0])?explicit[0]:!explicit.length&&pronoun?previous:undefined;
   if(explicit.length)previous=product;
   else if(!pronoun)previous=undefined;
   if(!product){opaque=true;continue;}
   const parsed=rawFacts(part,product,true);
   // Accept complete original assertions, never a recognized prefix followed
   // by ignored units, limits, tolerance or measurement conditions. An opaque
   // neighboring sentence can qualify the earlier figure, so the paragraph
   // needs ordinary interpretation rather than guessing its scope away.
   if(stale.test(source.title||'')||stale.test(part)||qualified.test(part)||specificationResidue(part,parsed,true)){
    opaque=true;
    for(const property of ['opening','wire_diameter','mesh_count','stainless_grade'])if((property==='opening'?/opening|aperture/:property==='wire_diameter'?/wire\s+diameter/:property==='mesh_count'?/mesh/:/stainless/).test(norm(part)))unsafe.add(product+':'+property);
   }
   paragraphFacts.push(...parsed);
  }
  if(opaque){sourceOpaque=true;for(const fact of paragraphFacts)unsafe.add(fact.product+':'+fact.property.replace(/^nominal_/,''));}
  else facts.push(...paragraphFacts);
 }
 // A separate paragraph may contain a condition on an earlier measurement.
 // This narrow local extractor accepts only a complete closed original source;
 // mixed prose needs the existing semantic check, never prefix-based proof.
 if(sourceOpaque){for(const fact of facts)unsafe.add(fact.product+':'+fact.property.replace(/^nominal_/,''));facts.length=0;}
 return {facts,unsafe};
}
function same(one:Fact,two:Fact){return one.product===two.product&&one.property===two.property&&one.value===two.value&&one.unit===two.unit;}
function supported(claim:Fact,entries:ReturnType<typeof sourceFacts>[]){
 const property=claim.property.replace(/^nominal_/,'');
 if(entries.some(entry=>entry.unsafe.has(claim.product+':'+property)))return false;
 const candidates=entries.flatMap(entry=>entry.facts).filter(fact=>fact.product===claim.product&&fact.property===claim.property);
 return candidates.length>0&&candidates.every(fact=>same(claim,fact));
}
function clauseFacts(clause:string):Fact[]{const product=ids(clause);return product.length===1?rawFacts(clause,product[0]):[];}

/** handled=true prevents a looser whole-document numeric search from borrowing
 * another product's opening or the same value for a different property. */
export function specificationNumberEvidence(number:string,clause:string,sources:SpecificationSource[]):{handled:boolean;source?:SpecificationSource}{
 const claims=clauseFacts(clause),value=number.match(/^\s*(\d+(?:\.\d+)?)/)?.[1];
 const target=claims.find(fact=>value!==undefined&&fact.value===String(Number(value))&&norm(number).replace(/\s/g,'')===norm(clause.slice(fact.start,fact.end).match(/\d+(?:\.\d+)?\s*(?:mm|millimet(?:er|re)s?|μm|um|micromet(?:er|re)s?|microns?|cm|inches?|inch)?/)?.[0]||'').replace(/\s/g,''));
 // Once a product and specification property are present, an unfamiliar word
 // order is uncertainty, never permission for the older topic-only search to
 // borrow the same number from a different product/property.
 if(!target)return {handled:ids(clause).length>0&&/\b(?:opening|aperture|wire\s+diameter|mesh|stainless)\b/i.test(clause)};
 const entries=sources.map(sourceFacts);
 if(!supported(target,entries))return {handled:true};
 const index=entries.findIndex(entry=>entry.facts.some(fact=>same(target,fact)));
 return {handled:true,source:sources[index]};
}

/** Local entailment only for a closed literal specification grammar. Any new
 * benefit, certification, guarantee, condition or extra predicate falls through
 * to the ordinary source checks rather than inheriting the numeric verdict. */
export function literalSpecificationEvidence(clause:string,sources:SpecificationSource[]):SpecificationSource|undefined{
 const claims=clauseFacts(clause);if(!claims.length)return;
 if(specificationResidue(clause,claims))return;
 const entries=sources.map(sourceFacts);
 if(!claims.every(claim=>supported(claim,entries)))return;
 const index=entries.findIndex(entry=>claims.every(claim=>entry.facts.some(fact=>same(claim,fact))));
 return index<0?undefined:sources[index];
}
