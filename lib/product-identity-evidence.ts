/** Normalize typography in a source-known product identifier, never a free
 * standing number. The complete letters/digits must match a supplied original
 * source: PX–20 may name PX20, but 20 mm, PX21 and report IDs are not aliases. */
export type ProductIdentitySource={id:string;text:string;title?:string;complete?:boolean;original?:boolean};
export type ProductIdentityReference={text:string;start:number;end:number;canonical:string;sourceId:string};
/** A literal buyer reference is not company evidence or a product alias. */
export type BuyerProductIdentifierReference={text:string;start:number;end:number;buyerText:string};
const dash='\\-\\u2010-\\u2015\\u2212\\uFE63\\uFF0D';
const tokenPattern=new RegExp(`(?<![a-z0-9_${dash}])[a-z]{1,6}(?:[${dash}])?\\d{1,6}[a-z]?(?![a-z0-9_${dash}]|[.,]\\d)`,'gi');
// A literal ASR spelling such as "RX 73" is a buyer reference only. Keep this
// grammar separate from source identities: it must never alias RX73 or RX-73.
const spacedBuyerPattern=new RegExp(`(?<![A-Za-z0-9_${dash}])[A-Z]{2,6} \\d{1,6}(?![A-Za-z0-9_${dash}]|[.,]\\d)`,'gi');
const nonProductCode=/^(?:ISO|EN|ASTM|DIN|IEC|UL|USD|EUR|GBP|RMB|CNY|KG|MG|LB|LBS|MM|CM|UM|PSI|BAR|MPA|KPA|HZ|KHZ|KW|MW|ML|AL|SI|FE|TI|NA|CA|MESH|GRADE|MODEL|CHECK|VERIFY|SEND|GIVE|COVER|COVERS|WITH|FROM|TO|FOR|AT|BY|IN|ON|OF|AND|OR|IF|THEN|ONLY|ABOUT|PLEASE|MOQ|ALL|SOME|ANY|EACH|EVERY|THE|THESE|THOSE|OUR|YOUR|THEIR|ITS|THAT|THIS|OVER|UNDER|AROUND|UPTO|NEAR|ALMOST|EXACT|LOT|BATCH|MORE|LESS|FEWER)$/;
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
function buyerIdentifierMatches(text:string,requireScopeTarget=false):RegExpMatchArray[]{
 const spaced=[...text.matchAll(spacedBuyerPattern)].filter(match=>{
  // Normalize only for this exclusion check. The returned spelling and the
  // buyer/reply Set comparison below remain exactly case/space sensitive.
  if(nonProductCode.test(match[0].split(' ')[0].toUpperCase()))return false;
  if(!requireScopeTarget)return true;
  const start=match.index||0,before=text.slice(0,start),after=text.slice(start+match[0].length);
  // Establish the spaced code as the buyer's report-scope target, not an
  // arbitrary upper-case word next to a quantity. The full reply's epistemic
  // boundary is separately checked before any digit exemption is applied.
  return /\b(?:reports?|documents?|specifications?|specs?|data\s*sheets?)\b[^.!?;:]{0,100}\b(?:covers?|appl(?:y|ies)\s+to|pertains?\s+to|relates?\s+to|matches?)\s+(?:(?:the|your|our|that|this|stated|requested|exact|standard|certified|approved|current)\s+)*$/i.test(before)
   ||/^\s+(?:(?:is|was|would be)\s+)?(?:covered|addressed)\s+by\s+(?:(?:the|your|our|that|this|inspection|material|test|approved)\s+)*\b(?:report|document)\b/i.test(after);
 });
 return [...text.matchAll(tokenPattern),...spaced].sort((a,b)=>(a.index||0)-(b.index||0));
}
/** Identify only complete identifiers literally repeated from the current
 * buyer's words. Callers may exempt their embedded digits only inside a
 * separately validated, bounded offer to investigate; this helper cannot
 * establish that the company sells the item or that a report covers it.
 * Unknown IDs get no spelling, dash, prefix or numeric correction. */
export function buyerProductIdentifierReferences(text:string,buyerText:string):BuyerProductIdentifierReference[]{
 const requested=new Set(buyerIdentifierMatches(buyerText,true).filter(match=>!excluded.test(key(match[0]))&&!explicitlyDocumentNumber(buyerText,match.index||0)).map(match=>match[0]));
 const references:BuyerProductIdentifierReference[]=[];
 for(const match of buyerIdentifierMatches(text)){
  const start=match.index||0;
  if(!requested.has(match[0])||explicitlyDocumentNumber(text,start))continue;
  if(presupposesCompanyProductOwnership(text,start))continue;
  references.push({text:match[0],start,end:start+match[0].length,buyerText:match[0]});
 }
 return references;
}
/** A letter-by-letter echo inside a model-code question names the buyer's
 * reference; its separated digits are not quantities. This never changes the
 * transcript, proves company ownership, or creates a source/product alias. */
export function buyerSpelledIdentifierClarificationReferences(text:string,buyerText:string):BuyerProductIdentifierReference[]{
 const requested=buyerIdentifierMatches(buyerText,true).filter(match=>!excluded.test(key(match[0]))&&!explicitlyDocumentNumber(buyerText,match.index||0));
 const pattern=new RegExp(`(?<![a-z0-9_${dash}])[a-z](?:[${dash}][a-z0-9]){1,15}(?![a-z0-9_${dash}])`,'gi');
 const references:BuyerProductIdentifierReference[]=[];
 for(const match of text.matchAll(pattern)){
  if(!/\d/.test(match[0]))continue;
  const start=match.index||0,end=start+match[0].length;
  const buyer=requested.find(item=>key(item[0]).replace(/\s/g,'')===key(match[0]));
  if(!buyer||presupposesCompanyProductOwnership(text,start))continue;
  const from=Math.max(text.lastIndexOf('.',start),text.lastIndexOf('!',start),text.lastIndexOf('?',start),text.lastIndexOf(';',start))+1,to=text.indexOf('?',end);
  if(to<0||/[.!;]/.test(text.slice(end,to)))continue;
  const question=text.slice(from,to+1);
  if(!/\b(?:confirm|repeat|spell)\b[^?]{0,110}\b(?:code|model|part|reference|number)\b|\b(?:was it|is it|did you say)\b/i.test(question))continue;
  references.push({text:match[0],start,end,buyerText:buyer[0]});
 }
 return references;
}
/** Closed neutral wording for the whole clarification, including an optional
 * “just to be sure”. Extra factual or commercial tails keep normal checks. */
export function isBuyerIdentifierSpellingClarification(text:string,buyerText:string):boolean {
 const references=buyerSpelledIdentifierClarificationReferences(text,buyerText);if(!references.length||!/^\s*(?:just to be sure[, ]+)?(?:can|could|would|was|is|did)\b/i.test(text)||! /\?\s*$/.test(text))return false;
 let remainder=text;for(const reference of [...references].reverse())remainder=remainder.slice(0,reference.start)+' '+remainder.slice(reference.end);
 if(!/^[A-Za-z\s,?—–-]+$/.test(remainder))return false;
 const allowed=new Set('just to be sure can could would was is did you please confirm repeat spell say the exact model product part code reference number your engineer team mentioned for material me it that this again'.split(' '));
 return (remainder.toLowerCase().match(/[a-z]+/g)||[]).every(word=>allowed.has(word));
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
