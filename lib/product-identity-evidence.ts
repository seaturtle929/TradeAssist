/** Normalize typography in a source-known product identifier, never a free
 * standing number. The complete letters/digits must match a supplied original
 * source: PX–20 may name PX20, but 20 mm, PX21 and report IDs are not aliases. */
export type ProductIdentitySource={id:string;text:string;title?:string;complete?:boolean;original?:boolean};
export type ProductIdentityReference={text:string;start:number;end:number;canonical:string;sourceId:string};
const dash='\\-\\u2010-\\u2015\\u2212\\uFE63\\uFF0D';
const tokenPattern=new RegExp(`(?<![a-z0-9_${dash}])[a-z]{1,6}(?:[${dash}])?\\d{1,6}[a-z]?(?![a-z0-9_${dash}]|[.,]\\d)`,'gi');
const joinPattern=new RegExp(`[${dash}]`,'g');
const excluded=/^(?:ISO|EN|ASTM|DIN|IEC|UL)\d|^(?:Al2O3|SiO2|Fe2O3|TiO2|Na2O|CaO|MgO)$/i;
const key=(text:string)=>text.replace(joinPattern,'').toUpperCase();
function sourceIdentities(sources:ProductIdentitySource[]):Map<string,string>{
 const known=new Map<string,string>();
 for(const source of sources){
  if(source.original===false)continue;
  for(const match of source.text.matchAll(tokenPattern)){
   const canonical=key(match[0]);
   if(excluded.test(canonical))continue;
   // A simple identifier immediately labelled as a report/certificate number
   // is not evidence of a product with the same letters and digits.
   const before=source.text.slice(Math.max(0,(match.index||0)-65),match.index);
   if(/\b(?:report|certificate|certification|document|record)\s+(?:(?:number|no\.?|id)\s*[:#]?\s*)?$/i.test(before))continue;
   if(!known.has(canonical))known.set(canonical,source.id);
  }
 }
 return known;
}
export function productIdentityReferences(text:string,sources:ProductIdentitySource[]):ProductIdentityReference[]{
 const known=sourceIdentities(sources),references:ProductIdentityReference[]=[];
 for(const match of text.matchAll(tokenPattern)){
  const canonical=key(match[0]),sourceId=known.get(canonical);
  if(!sourceId)continue;
  references.push({text:match[0],start:match.index||0,end:(match.index||0)+match[0].length,canonical,sourceId});
 }
 return references;
}
export function canonicalizeKnownProductIdentifiers(text:string,sources:ProductIdentitySource[]):string{
 let normalized=text;
 for(const reference of productIdentityReferences(text,sources).reverse())normalized=normalized.slice(0,reference.start)+reference.canonical+normalized.slice(reference.end);
 return normalized;
}
