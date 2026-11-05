/** Normalize typography in a source-known product identifier, never a free
 * standing number. The complete letters/digits must match a supplied original
 * source: PX–20 may name PX20, but 20 mm, PX21 and report IDs are not aliases. */
export type ProductIdentitySource={id:string;text:string;title?:string;complete?:boolean;original?:boolean};
export type ProductIdentityReference={text:string;start:number;end:number;canonical:string;sourceId:string};
/** A literal buyer reference is not company evidence or a product alias. */
export type BuyerProductIdentifierReference={text:string;start:number;end:number;buyerText:string};
const dash='\\-\\u2010-\\u2015\\u2212\\uFE63\\uFF0D';
const tokenPattern=new RegExp(`(?<![a-z0-9_${dash}])[a-z]{1,6}(?:[${dash}])?\\d{1,6}[a-z]?(?![a-z0-9_${dash}]|[.,]\\d)`,'gi');
const joinPattern=new RegExp(`[${dash}]`,'g');
const excluded=/^(?:ISO|EN|ASTM|DIN|IEC|UL)\d|^(?:Al2O3|SiO2|Fe2O3|TiO2|Na2O|CaO|MgO)$/i;
const key=(text:string)=>text.replace(joinPattern,'').toUpperCase();
const explicitlyDocumentNumber=(text:string,start:number)=>/\b(?:report|certificate|certification|document|record)\s+(?:(?:number|no\.?|id)\s*[:#]?\s*)?$/i.test(text.slice(Math.max(0,start-65),start));
function presupposesCompanyProductOwnership(text:string,start:number):boolean{
 const prefix=text.slice(0,start),owner=[...prefix.matchAll(/\bour\b/gi)].at(-1);
 if(!owner)return false;
 const modifiers=prefix.slice((owner.index||0)+owner[0].length);
 // Keep intervening noun/adjective modifiers in the owned phrase: "our
 // standard model", "our fully certified", "our current, approved". A
 // buyer's spelling cannot prove any of those presuppositions. Only a closed
 // document-scope predicate separates "our report" from the following ID.
 if(/[.!?;:]/.test(modifiers))return false;
 const documentPredicate=/\b(?:report|reports|document|documents|specifications?|specs?|spec(?:ification)?\s+sheets?|data\s*sheets?)\s+(?:(?:does|do|explicitly|directly|currently|actually)\s+)*(?:covers?|appl(?:y|ies)\s+to|pertains?\s+to|relates?\s+to|matches?)\s+(?:(?:the|your|that|this|stated|requested|exact)\s+)*$/i;
 return !documentPredicate.test(modifiers);
}
function sourceIdentities(sources:ProductIdentitySource[]):Map<string,string>{
 const known=new Map<string,string>();
 for(const source of sources){
  if(source.original===false)continue;
  for(const match of source.text.matchAll(tokenPattern)){
   const canonical=key(match[0]);
   if(excluded.test(canonical))continue;
   // A simple identifier immediately labelled as a report/certificate number
   // is not evidence of a product with the same letters and digits.
   if(explicitlyDocumentNumber(source.text,match.index||0))continue;
   if(!known.has(canonical))known.set(canonical,source.id);
  }
 }
 return known;
}
/** Identify only complete identifiers literally repeated from the current
 * buyer's words. Callers may exempt their embedded digits only inside a
 * separately validated, bounded offer to investigate; this helper cannot
 * establish that the company sells the item or that a report covers it.
 * Unknown IDs get no spelling, dash, prefix or numeric correction. */
export function buyerProductIdentifierReferences(text:string,buyerText:string):BuyerProductIdentifierReference[]{
 const requested=new Set([...buyerText.matchAll(tokenPattern)].filter(match=>!excluded.test(key(match[0]))&&!explicitlyDocumentNumber(buyerText,match.index||0)).map(match=>match[0]));
 const references:BuyerProductIdentifierReference[]=[];
 for(const match of text.matchAll(tokenPattern)){
  const start=match.index||0;
  if(!requested.has(match[0])||explicitlyDocumentNumber(text,start))continue;
  if(presupposesCompanyProductOwnership(text,start))continue;
  references.push({text:match[0],start,end:start+match[0].length,buyerText:match[0]});
 }
 return references;
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
