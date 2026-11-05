import {canonicalizeKnownProductIdentifiers} from './product-identity-evidence.ts';
import {availableDocumentActionEvidence} from './document-availability-evidence.ts';

/** Document availability and product coverage are different propositions.
 * A scope claim must have its own original document→product relationship;
 * co-occurrence in a catalog, buyer request or extracted summary is not one. */
export type DocumentProductSource={id:string;text:string;title?:string;complete?:boolean;original?:boolean};
type Scope={key:string;labels:string[]};
type Context={manufacturer?:{products?:string};turns?:{role:string;text:string}[];buyerText?:string};
const norm=(text:string)=>text.toLowerCase().replace(/[’‘]/g,"'").replace(/\bstainless steel\b/g,'stainless').replace(/\bper inch\b/g,'').replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();
const escaped=(text:string)=>text.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const documentPattern=/\b(?:(?:material|inspection|quality|compliance|certification)\s+)?(?:test\s+reports?|inspection\s+reports?|reports?|certificates?|certifications?|specification\s+sheets?|spec\s+sheets?|data\s+sheets?)\b/gi;
const productPattern=/\b[A-Z]{1,6}\d{1,6}[A-Z0-9-]*\b/gi;
const notProduct=/^(?:Al2O3|SiO2|Fe2O3|TiO2|Na2O|CaO|MgO|ISO\d+|ASTM\d+|DIN\d+|EN\d+)$/i;
const relationship=/\b(?:covers?|covering|appl(?:y|ies|icable)|pertain(?:s|ing)?|relat(?:es|ing|ed)|relevant|specific(?:ally)?|suitable|appropriate|correspond(?:s|ing)?|address(?:es|ing)?)\b/i;
const stale=/\b(?:superseded|archived|obsolete|draft|outdated|historical|expired|not current|unapproved|not approved|for reference only)\b/i;
const uncertainty=/\b(?:unknown|unconfirmed|unverified|may|might|could|unless|except|subject to|only when|only if|requires? approval|approval required)\b/i;
const negative=/\b(?:not|no|never|doesn't|does not|isn't|is not|aren't|are not|excluding|except)\b/i;
const productNounTail=/^(?:products?|models?|grades?|mesh|valves?|irrigation valves?|woven mesh|stainless steel mesh|woven stainless[- ]steel mesh)$/i;
const parts=(text:string)=>text.split(/\n+|(?<=[.!?;])\s+/).filter(Boolean);

function documents(text:string){return [...text.matchAll(documentPattern)].map(match=>({text:match[0],start:match.index||0,end:(match.index||0)+match[0].length,kind:norm(match[0]).replace(/\breports\b/g,'report').replace(/\bsheets\b/g,'sheet').replace(/\bcertificates\b/g,'certificate').replace(/\bcertifications\b/g,'certification').replace(/\bspec sheet\b/g,'specification sheet')}));}
/** Keep numbered document identifiers distinct from the products and measured
 * values they may contain. This only locates a reference; it does not verify it. */
export function documentIdentifierReferences(text:string){return documents(text).flatMap(document=>{
 const match=/^\s+([A-Z][A-Z0-9]*(?:[-/][A-Z0-9]+)+)\b/.exec(text.slice(document.end));if(!match)return [];
 const start=document.end+match[0].indexOf(match[1]);return [{identifier:match[1],kind:document.kind,start,end:start+match[1].length}];
});}
export function documentIdentifierSource(reference:ReturnType<typeof documentIdentifierReferences>[number],sources:DocumentProductSource[]){
 return sources.find(source=>source.original!==false&&source.complete!==false&&!stale.test((source.title||'')+' '+source.text)&&documentIdentifierReferences(source.text).some(candidate=>candidate.identifier===reference.identifier&&sameDocument(reference.kind,candidate.kind)));
}
const inclusionPredicate=/^\s+(?:(?:definitely|certainly|explicitly|specifically|already|also)\s+)*(?:includes?|contains?)\b/i;
const relationWords=(text:string)=>relationship.test(text.replace(documentPattern,' '))
 ||documents(text).some(document=>inclusionPredicate.test(text.slice(document.end)))
 ||/^\s*(?:it|this|that)\b/i.test(text)&&inclusionPredicate.test(text.replace(/^\s*(?:it|this|that)\b/i,''));
function sameDocument(claim:string,source:string){return claim===source||claim==='test report'&&source==='material test report'||claim==='report'&&/report$/.test(source);}
function scopes(text:string):Scope[]{
 const identifiers=documentIdentifierReferences(text);
 const result:Scope[]=[...new Set([...text.matchAll(productPattern)].filter(match=>!notProduct.test(match[0])&&!identifiers.some(id=>id.start<=(match.index||0)&&id.end>=(match.index||0)+match[0].length)).map(match=>norm(match[0])))].map(key=>({key,labels:[key]}));
 // Count/material are a product description, not evidence that a report
 // covers that product. The signature only resolves equivalent descriptions.
 const mesh=text.match(/\b(\d+(?:\.\d+)?)\s*mesh\b/i),steel=text.match(/\b(\d{3})\s*stainless(?:\s+steel)?\b/i);
 if(mesh&&steel)result.push({key:`mesh:${mesh[1]}:stainless:${steel[1]}`,labels:[`${mesh[1]} mesh ${steel[1]} stainless`,`${mesh[1]} mesh ${steel[1]} stainless mesh`]});
 return result;
}
function aliases(sources:DocumentProductSource[]){
 const map=new Map<string,Set<string>>();
 for(const source of sources.filter(item=>item.original!==false&&item.complete!==false&&!stale.test(item.title||'')))for(const sentence of parts(source.text)){
  const found=scopes(sentence),codes=found.filter(item=>!item.key.startsWith('mesh:'));
  // A product's own specification may establish its descriptive identity,
  // but never a document relationship absent from that source sentence.
  if(codes.length!==1||!new RegExp('^\\s*(?:(?:our|the|product)\\s+)?'+escaped(codes[0].key)+'\\b','i').test(sentence)||negative.test(sentence)||uncertainty.test(sentence))continue;
  for(const description of found.filter(item=>item.key.startsWith('mesh:'))){const set=map.get(description.key)||new Set<string>();set.add(codes[0].key);map.set(description.key,set);}
 }
 return map;
}
function equivalent(one:Scope,two:Scope,map:ReturnType<typeof aliases>){
 if(one.key===two.key)return true;
 return map.get(one.key)?.size===1&&map.get(one.key)?.has(two.key)||map.get(two.key)?.size===1&&map.get(two.key)?.has(one.key)||false;
}
function productPosition(text:string,scope:Scope){
 if(scope.key.startsWith('mesh:')){
  const [,,count,,grade]=scope.key.match(/^(mesh):(.*):(stainless):(.*)$/)||[];
  const mesh=new RegExp('\\b'+escaped(count||'')+'\\s*mesh\\b','i').exec(text),steel=new RegExp('\\b'+escaped(grade||'')+'\\s*stainless\\b','i').exec(text);
  return mesh&&steel?{start:Math.min(mesh.index,steel.index),end:Math.max(mesh.index+mesh[0].length,steel.index+steel[0].length)}:undefined;
 }
 // A model substring inside a report identifier (IR-PX20-2026) is not the
 // product occurrence in “report IR-PX20-2026 covers Example PX20”.
 const match=new RegExp('(?<![a-z0-9/-])'+escaped(scope.key)+'(?![a-z0-9/-])','i').exec(text);return match?{start:match.index,end:match.index+match[0].length}:undefined;
}
function linked(text:string,document:ReturnType<typeof documents>[number],scope:Scope){
 const product=productPosition(text,scope);if(!product)return false;
 if(product.end<=document.start){
  const between=text.slice(product.end,document.start);
  // "PX20 specification sheets and material test reports" is a catalog
  // list, not an assertion that the report covers PX20.
  return /^\s*(?:['’]s\s*)?(?:(?:product|material|quality|inspection)\s+)?$/i.test(between)
   ||/^\s+(?:has|comes with|is supported by)\s+(?:a|an|the|our)?\s*$/i.test(between);
 }
 if(document.end<=product.start){
  const between=text.slice(document.end,product.start);
  // An explicitly named report can state its product scope with an identifier,
  // an emphasis adverb and the product's company label. These remain candidate
  // evidence only; semantic verification still checks the actual limitations.
  const namedScope=between.match(/^\s*(?:[A-Z][A-Z0-9]*(?:[-/][A-Z0-9]+)+\s+)?(?:(?:is|are|does|do)\s+)?(?:(?:explicitly|specifically)\s+)?(?:covers?|addresses?|describes?|documents?|records?|details?|tests?|evaluates?|assesses?)\s+((?:[A-Za-z'-]+\s+)*)$/i);
  if(namedScope&&namedScope[1].trim().split(/\s+/).filter(Boolean).every(word=>/^(?:our|the|this|that|exact|product|grade)$/.test(word)||/^[A-Z][A-Za-z'-]*$/.test(word)))return true;
  return !/[;.!?]|\b(?:and|or)\b/i.test(between)&&(
   /^\s*(?:(?:we have|that we have|which we have)\s*)?(?:(?:is|are)\s*)?(?:(?:available|provided|issued|prepared)\s*)?(?:for|on|about|of|specific to|applicable to|related to|pertaining to|covering)\s+(?:(?:our|the|this|that|product|grade|exact)\s+)*$/i.test(between)
   ||/^\s*(?:(?:is|are)\s*)?(?:covers?|addresses?|describes?|documents?|records?|details?|tests?|evaluates?|assesses?)\s+(?:(?:the|our|this|that|exact|product|grade)\s+)*$/i.test(between)
   ||/^\s+(?:includes?|contains?|provides?)\s+(?:test\s+)?(?:data|results|information|details|measurements|evidence)\s+(?:for|on|about|of)\s+(?:(?:our|the|this|that|product|grade|exact)\s+)*$/i.test(between));
 }
 return false;
}
function latestBuyer(context:Context){return context.buyerText??([...(context.turns||[])].reverse().find(turn=>turn.role==='buyer'||turn.role==='customer')?.text||'');}
function bareDocumentAction(line:string){
 if(!/^\s*(?:I|we)(?:['’]ll|\s+(?:will|can|could|would))\s+(?:include|attach|send|email|share|provide)\b/i.test(line))return false;
 const remainder=line.replace(documentPattern,' ').replace(productPattern,' ').replace(/\b\d+(?:\.\d+)?\s*mesh(?:\s+per inch)?\b|\b\d{3}\s*stainless(?:\s+steel)?\b/gi,' ');
 const allowed=new Set("i i'll we we'll will can could would include attach send email share provide the a an our your both and in with to that this it them these those company profile profiles product mesh for review reference engineer engineers team s over".split(' '));
 return (remainder.toLowerCase().replace(/[’‘]/g,"'").match(/[a-z]+(?:'[a-z]+)?/g)||[]).every(word=>allowed.has(word));
}
export function requestsDocumentProductCoverage(text:string):boolean {
 return !!documents(text).length&&/\?|\b(?:confirm|whether|if|need to know|tell me)\b/i.test(text)&&(relationWords(text)||/\b(?:report|sheet|certificate)\b.{0,55}\bfor\b/i.test(text));
}
const courtesyAction='(?:asking|(?:this|that|the|your) (?:question|update|clarification|information)|this|that|your time|your patience|raising that|checking|pointing that out|bringing that up|letting (?:me|us) know|keeping (?:me|us) informed|(?:sharing|explaining|clarifying|confirming|flagging|mentioning)(?: (?:that|this))?)';
const courtesyStart=new RegExp('^(?:(?:thanks|thank you)(?: for '+courtesyAction+')?|of course|understood|sure|okay|ok|got it|that makes sense|that helps|that[\'’]s helpful|I understand)(.*)$','i');
/** Courtesy words describe the interaction, never an answer about the product.
 * Require the complete acknowledgment, including an optional name, so “thanks
 * for confirming the report covers…” cannot hide its factual proposition. */
export function isConversationalAcknowledgment(text:string):boolean {
 const line=text.trim().replace(/[’‘]/g,"'").replace(/^[A-Z][A-Za-z'-]*(?:\s+[A-Z][A-Za-z'-]*){0,2},\s*(?=(?:thanks|thank you|understood|got it)\b)/,'');
 // A closed salutation asserts no product fact. Participant and identity
 // validation still decide whether this is the person the rep may address.
 if(/^(?:[Hh]i|[Hh]ello)(?:(?:,\s*|\s+)[A-Z][A-Za-z'-]*(?:\s+[A-Z][A-Za-z'-]*){0,2})?[.!]?$/.test(line))return true;
 const courtesy=courtesyStart.exec(line);if(!courtesy)return false;
 const tail=courtesy[1].trim();
 // A topic label after “asking about” names the subject of the question, not
 // its answer. Keep complete noun labels only: modifiers, relative clauses and
 // a qualified “[product] report” still go through ordinary claim checks.
 if(/^about\s+/i.test(tail)&&/^(?:thanks|thank you) for asking\b/i.test(line)){
  const topic=tail.replace(/^about\s+/i,'').replace(/,\s*[A-Z][A-Za-z'-]*(?:\s+[A-Z][A-Za-z'-]*){0,2}[.!]?$/,'').replace(/[.!]+$/,'').trim();
  if(/^(?:this|that|it)$/i.test(topic))return true;
  if(/^(?:(?:the|that|this|your)\s+)?(?:[A-Z]{1,6}\d{1,6}[A-Z0-9-]*|product|mesh|grade|requirements?|specifications?|scope|coverage|availability|certification|price|pricing|(?:material test|inspection|test) report|report)$/i.test(topic))return true;
 }
 return /^[,.!]*$/.test(tail)||/^,\s*[A-Z][A-Za-z'-]*(?:\s+[A-Z][A-Za-z'-]*){0,2}[.!]?$/.test(tail);
}
/** Reporting an investigation's eventual result does not supply that result.
 * Keep the communication action, optional neutral object and ordering clause
 * separate so ordinary wording variations cannot become scope assertions. */
function reportsInvestigationResult(tail:string):boolean {
 const action=/^and\s+(?:(?:(?:I|we)(?:'ll|\s+(?:will|can))|will|can)\s+)?(?:(?:get|come) back to (?:you|them)|let (?:you|them|him|her) know|tell (?:you|them|him|her)|report back(?: to (?:you|them))?|follow up(?: with (?:you|them))?|confirm(?: back)?(?: (?:with|to) (?:you|them))?)\b/i.exec(tail);
 if(!action)return false;
 const remainder=tail.slice(action[0].length).trim().replace(/(?:\s*,)?\s*\bbefore\s+(?:(?:sending|emailing)(?:\s+(?:it|them|anything|the documents))?|(?:I|we)\s+(?:send|email)(?:\s+(?:it|them|anything|the documents))?)(?: over)?$/i,'')
  .replace(/(?:\s*,)?\s*\b(?:once|after|when)\s+(?:(?:I|we)\s+have\s+(?:that|the|an?)\s+(?:answer|information|results?|confirmation)|(?:I|we)(?:'ve| have)\s+(?:checked|verified|confirmed)\s+(?:it|that|the (?:scope|coverage)))$/i,'').trim();
 if(!remainder)return true;
 return /^(?:that|it)(?: for you)?$/i.test(remainder)
  ||/^with\s+(?:that|it)$/i.test(remainder)
  ||/^(?:with\s+)?(?:(?:that|this|the|an?)\s+)?(?:(?:clear|specific|detailed|written)\s+)?(?:confirmation|results?|details?|answer|information|update|findings|outcome|clarification)(?: for you)?$/i.test(remainder)
  ||/^on\s+(?:that|this|it|(?:the|its|that)\s+(?:scope|coverage|availability))$/i.test(remainder)
  ||/^what\s+(?:I|we)\s+(?:find(?: out)?|learn|discover)$/i.test(remainder)
  ||/^whether\s+(?:it|that)\s+(?:does|is covered)$/i.test(remainder);
}
/** One shared speech-act boundary for local fact classification and document
 * scope checks. Natural first-person investigation wording asserts no answer;
 * positive tails, commercial actions and timing do not inherit that status. */
export function isBoundedEpistemicFactAction(text:string):boolean {
 // A closed courtesy prefix changes neither the action nor its uncertainty.
 // Preserve everything after it so attached factual/timing claims still fail.
 let line=text.trim().replace(/[’‘]/g,"'");
 // An intra-token letter→digit dash is identifier typography, not a clause
 // boundary. This parses the inquiry only; identity/number evidence checks
 // still decide whether the referenced product is actually known.
 line=line.replace(/([A-Za-z])[\u2010-\u2015\u2212\uFE63\uFF0D](?=\d)/g,'$1-');
 const courtesyEnd=[...line.matchAll(/[,;:—–-]/g)].filter(match=>isConversationalAcknowledgment(line.slice(0,match.index))).at(-1)?.index;
 if(courtesyEnd!==undefined)line=line.slice(courtesyEnd+1).trim();
 const investigation=/^(?:(?:I|we)(?:'ll|\s+(?:can|will|would|must))\s+|(?:I|we)\s+(?:need|have) to\s+|let (?:me|us)\s+|(?:can|could|may|should|would)\s+(?:I|we)\s+)(?:(?:definitely|certainly|personally)\s+)?(?:(?:need|have) to\s+)?(?:(?:definitely|certainly|personally)\s+)?(?:check|double[- ]?check|verify|confirm|find out|look into)\s+/i.exec(line);
 const reservation=/^(?:I|we)\s+(?:(?:cannot|can't|do not|don't)\s+(?:confirm|verify|know|say)|(?:have not|haven't)\s+(?:confirmed|verified|established))\s+/i.exec(line);
 const prefix=investigation||reservation;if(!prefix)return false;
 let subject=line.slice(prefix[0].length).replace(/[.!?]+$/,'').trim();
 if(reservation)subject=subject.replace(/\s+yet$/i,'');
 const timing=/\b(?:soon|shortly|ASAP|quickly|in a bit|right away|promptly|immediately|tomorrow|today|within|by (?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|\d)|in \d+ (?:hours?|days?))\b/i;
 // A scope inquiry can contain arbitrary unknown content, but not an appended
 // claim hidden behind a causal, relative, parenthetical or coordinate clause.
 // Ambiguity stays on the normal verification path rather than being guessed.
 if(timing.test(subject)||/[;:—–()[\]"“”]|[.!?]\s+\S|\b(?:but|however|because|since|although|though|therefore|thus|nevertheless|despite|yet|guarantee(?:s|d)?)\b|\bso\s+(?:you|we|it|this|that|the)\b/i.test(subject))return false;
 const next=subject.search(/\s+\b(?:and|plus|also)\b\s+/i);
 if(next>=0){
  const tail=subject.slice(next).trim();
  // Follow-through may report the result; it cannot predetermine the answer,
  // authorize a concession, promise shipment or attach an unagreed deadline.
  if(!reportsInvestigationResult(tail))return false;
  // The coordinator has passed its own closed communication grammar. An
  // optional comma immediately before it is punctuation, not a new claim;
  // commas anywhere else in the predicate remain subject to the check below.
  subject=subject.slice(0,next).trim().replace(/,$/,'').trim();
 }
 // Only the closed communication/ordering suffix above may consume a comma.
 // Punctuation anywhere in the unresolved predicate remains conservative.
 if(/,/.test(subject))return false;
 if(/^(?:whether|if|which|what)\b\s+\S/i.test(subject)){
  // Uncertainty about a predicate does not erase a qualified noun inside it:
  // “what our PX20 report contains” already says that this report exists for
  // PX20, as does “the report we have for PX20”. Keep that premise checked.
  const presupposedScope=documents(subject).some(document=>scopes(subject).some(scope=>{
   const product=productPosition(subject,scope);if(!product)return false;
   if(product.end<=document.start)return linked(subject,document,scope);
   const before=subject.slice(0,document.start),between=subject.slice(document.end,product.start);
   // “Whether we have a report for PX20” asks about existence. In contrast,
   // “what our report for PX20 contains” takes that scoped report for granted.
   const asksExistence=/^(?:whether|if)\s+(?:(?:we|I)\s+(?:have|hold|possess)|there\s+(?:is|are))\s+(?:(?:an?|the|our)\s+)?$/i.test(before);
   const finitePredicate=/^\s+(?:is|are|covers?|applies?|relates?|pertains?|includes?|contains?)\b/i.test(between);
   return !asksExistence&&!finitePredicate&&/\b(?:for|on|about|of)\s+(?:(?:our|the|this|that|product|grade|exact)\s+)*$/i.test(between);
  }));
  return !presupposedScope&&!/\b(?:which|that)\s+(?:proves?|guarantees?|certifies?|ensures?|demonstrates?)\b/i.test(subject);
 }
 // These nominal objects ask about an unresolved property. A qualified noun
 // such as “the PX20 report” would instead presuppose a product/report link.
 if(investigation&&/^(?:that|the|this)\s+(?:details?|information)$/i.test(subject))return true;
 return !!investigation&&/^(?:(?:the|that|this|its|our|your)\s+)?(?:(?:(?:material test|inspection|test)\s+)?report(?:'s)?\s+)?(?:scope|coverage|availability)(?:\s+before\s+(?:(?:sending|emailing)\s+(?:it|them|anything|the documents)|(?:I|we)\s+(?:send|email)\s+(?:it|them|anything|the documents)))?$/i.test(subject);
}

/** A check, communication of its result, and later document delivery are three
 * different actions. The first two assert no coverage. The last still needs
 * availability and company permission; return its explicit referent so the
 * ordinary document-action checks can enforce those independently. */
export function investigationThenDocumentDelivery(text:string):{investigation:string;document:string;deliveryCondition:'sequence_only'|'stated_condition';conditionText?:string}|undefined {
 const line=text.trim().replace(/[’‘]/g,"'");
 // A repeated subject is optional in a coordinated action (“I'll check ...
 // and then send it”). Sequence does NOT mean “only if it covers the product”.
 const continuation=/\s*,?\s+(?:and\s+)?then\s+(?:(?:I|we)(?:'ll|\s+(?:will|can|could))\s+)?(?:send|email|share|include|attach)\s+(?:it|that report|the report)(?:\s+(?:over|along|to you|for review))?[.!]?$/i.exec(line)
  ||/\s*,?\s+and\s+((?:only\s+)?if\s+(?:it|that report|the report)\s+(?:does|covers?\s+(?:it|that product|your product|your mesh|the requirements)|matches?\s+(?:the|your)\s+requirements))\s*,?\s+(?:I|we)(?:'ll|\s+(?:will|can|could))\s+(?:send|email|share|include|attach)\s+(?:it|that report|the report)(?:\s+(?:over|along|to you|for review))?[.!]?$/i.exec(line);
 if(!continuation)return;
 const investigation=line.slice(0,continuation.index).trim();
 if(!isBoundedEpistemicFactAction(investigation))return;
 const referents=documents(investigation);
 if(referents.length!==1||! /report$/.test(referents[0].kind))return;
 return {investigation,document:referents[0].kind,deliveryCondition:continuation[1]?'stated_condition':'sequence_only',...(continuation[1]?{conditionText:continuation[1]}:{})};
}

/** Negation of report coverage differs from a limitation on what the report
 * proves. “It records the tested sample, but does not certify suitability”
 * does not negate the report→product relationship asserted earlier. */
function coverageNegated(text:string,document?:ReturnType<typeof documents>[number],scope?:Scope):boolean {
 const product=scope&&productPosition(text,scope);
 if(document&&product)return negative.test(text.slice(0,Math.max(document.end,product.end)));
 return /\b(?:does\s+not|doesn't|do\s+not|don't|never|cannot|can't)\s+(?:(?:explicitly|specifically)\s+)?(?:cover|apply|pertain|relate|correspond|include|contain)\b|\b(?:is\s+not|isn't|are\s+not|aren't)\s+(?:for|applicable|specific|relevant|related)\b/i.test(text);
}

/** A single affirmative excerpt is insufficient when another original source
 * limits/denies the same relationship or names a different report. Resolve
 * explicit IDs, but leave generic conflicting or ambiguous references pending. */
function competingScopeEvidence(kind:string,product:string,identifier:string|undefined,sources:DocumentProductSource[]):boolean {
 const reportIds=new Set<string>(),target=norm(product);
 for(const source of sources){
  let priorDocument=false,priorProduct=false,priorOtherIdentifier=false;
  for(const raw of parts(canonicalizeKnownProductIdentifiers(source.text,sources))){
   const found=documents(raw).filter(document=>sameDocument(kind,document.kind));
   const ids=documentIdentifierReferences(raw).filter(document=>sameDocument(kind,document.kind));
   const products=scopes(raw),hasProduct=products.some(scope=>scope.key===target);
   const otherIdentifier=!!identifier&&!!ids.length&&ids.every(reference=>reference.identifier!==identifier);
   const followsDocument=!found.length&&/^\s*(?:it|this|that)\b/i.test(raw)&&priorDocument;
   const applies=(found.length>0||followsDocument)&&!otherIdentifier&&!(followsDocument&&priorOtherIdentifier)
    &&(hasProduct||!products.length&&(priorProduct||found.length>0));
   if(applies){
    if(hasProduct)for(const reference of ids)reportIds.add(reference.identifier);
    const scopePredicate=relationWords(raw)||/\b(?:excludes?|omits?|scope|coverage)\b/i.test(raw);
    if(scopePredicate&&(coverageNegated(raw)||uncertainty.test(raw)||/\b(?:only|limited|excluding|excludes?|omits?|restriction|restricted)\b/i.test(raw)))return true;
    if(scopePredicate&&hasProduct){
     const position=productPosition(raw,{key:target,labels:[target]});
     const remainder=position?raw.slice(position.end).replace(/[.!]$/,'').trim():'';
     // A second scope statement with an unexplained qualifier must not be
     // ignored merely because an unrestricted positive statement also exists.
     if(remainder&&!productNounTail.test(remainder))return true;
    }
   }
   if(found.length){priorDocument=true;priorOtherIdentifier=otherIdentifier;if(products.length)priorProduct=hasProduct;}
  }
 }
 return !identifier&&reportIds.size>1;
}

/** Return a hard veto for absent linkage. A present relationship remains a
 * candidate for normal semantic checking: scope alone never proves results,
 * suitability, certification, or any other contents of the report. */
export function assessDocumentProductCoverage(clause:string,context:Context,sources:DocumentProductSource[]):{supported:false;pending?:true;candidateSourceIds?:string[];reason:string;verificationBoundary?:'document_product_scope'}|undefined {
 sources=sources.map(source=>({...source,text:canonicalizeKnownProductIdentifiers(source.text,sources)}));
 context={...context,buyerText:canonicalizeKnownProductIdentifiers(latestBuyer(context),sources)};
 const buyer=latestBuyer(context),asked=requestsDocumentProductCoverage(buyer);
 const line=canonicalizeKnownProductIdentifiers(clause,sources).trim().replace(/[’‘]/g,"'");
 // Explicit uncertainty is a commitment to investigate, never a positive or
 // negative assertion about report scope. Appended assertions are assessed in
 // their own clause by the normal verification policy.
 if(isBoundedEpistemicFactAction(line)||investigationThenDocumentDelivery(line))return;
 if(/^(?:does|do|is|are|can|could|would|will|which|what|how|whether)\b/i.test(line)&&/\?\s*$/.test(line)&&! /\b(?:our|the)\s+[a-z]+\d+[^?]{0,30}\b(?:reports?|sheets?|certificates?)\b/i.test(line))return;
 const ownDocuments=documents(line),buyerDocuments=documents(buyer);
 const assent=asked&&/^\s*(?:yes|correct|exactly|absolutely|certainly|sure|it does|that does|we do)\b/i.test(line);
 // “I'll confirm it covers ...” asserts a positive answer, unlike the
 // bounded “confirm whether ...” action handled above. The current question
 // supplies its document referent, never the missing coverage relationship.
 const documentPronoun=asked&&!ownDocuments.length&&/^\s*(?:(?:I|we)(?:'ll|\s+(?:will|can|would))\s+(?:confirm|verify)\s+(?:that\s+)?)?(?:it|this|that)\b/i.test(line)&&(relationWords(line)||/^\s*(?:it|this|that)\s+(?:documents?|records?|details?|describes?|reports?)\b/i.test(line));
 const explicitRelation=!!ownDocuments.length&&(relationWords(line)||/\b(?:report|sheet|certificate)\b.{0,65}\b(?:for|of)\s+(?:(?:our|your|that|this|the|exact)\s+)*(?:product|grade|mesh|material)\b/i.test(line));
 const qualified=ownDocuments.some(document=>scopes(line).some(scope=>linked(line,document,scope)));
 // Follow a document subject with a product-specific predicate even when its
 // verb is a new paraphrase ("the report concerns PX20"). This is deliberately
 // structural, not a list of previously rejected sentences. A buyer/engineer
 // comparison action is not itself a document subject or coverage assertion.
 const subjectDocument=ownDocuments.find(document=>/^\s*(?:(?:yes|correct|exactly)[,.!]\s*)?(?:(?:our|the|this|that|a|an|both)\s+)*$/i.test(line.slice(0,document.start)));
 const documentSubject=!!scopes(line).length&&!!subjectDocument;
 const leadingScope=!!ownDocuments.length&&/^\s*for\s+[^,;.!?]+,\s*/i.test(line)&&scopes(line.slice(0,line.indexOf(','))).length>0;
 if(!assent&&!documentPronoun&&!explicitRelation&&!qualified&&!documentSubject&&!leadingScope)return;
 const claimedDocuments=ownDocuments.length?ownDocuments:assent||documentPronoun?buyerDocuments:[];
 const explicitScopes=scopes(line),buyerScopes=scopes(buyer);
 const claimedScopes=explicitScopes.length?explicitScopes:asked||/\b(?:that|this|the exact|your)\s+(?:product|grade|mesh|material)\b/i.test(line)?buyerScopes:[];
 if(!claimedDocuments.length)return;
 // "for your engineer/review" is a recipient/action, not product coverage.
 if(!claimedScopes.length&&!assent&&!relationWords(line))return;
 // Bind a qualifier to its own document. In "the test report and PX20 spec
 // sheet", PX20 qualifies the sheet, never the neighbouring report. Unknown
 // predicates with one document still assert a relationship and need evidence.
 const pairs=claimedDocuments.flatMap(document=>{
  const local=explicitScopes.filter(scope=>linked(line,document,scope));
  const inferred=(assent||documentPronoun)&&!ownDocuments.length||!explicitScopes.length&&(assent||explicitRelation)||document===subjectDocument||ownDocuments.length===1&&explicitRelation||leadingScope;
  const applicable=local.length?local:inferred?claimedScopes:[];
  return applicable.map(scope=>({document,scope}));
 });
 if(!pairs.length)return {supported:false,verificationBoundary:'document_product_scope',reason:'This document-to-product coverage is not established by original Company Knowledge. The specific product scope of this report is unresolved; confirm it without asserting coverage.'};
 const originals=sources.filter(source=>source.original!==false&&source.complete!==false&&!stale.test((source.title||'')+' '+source.text));
 const map=aliases(originals);
 const matching=pairs.map(({scope,document})=>originals.filter(source=>!uncertainty.test(source.text)&&parts(source.text).some(sentence=>{
   const claimNegative=coverageNegated(line,ownDocuments.includes(document)?document:undefined,scope);
   return documents(sentence).some(original=>sameDocument(document.kind,original.kind)&&scopes(sentence).some(product=>equivalent(scope,product,map)&&linked(sentence,original,product)&&coverageNegated(sentence,original,product)===claimNegative));
  })));
 if(matching.every(matches=>matches.length)){
  // The qualified noun is grounded. Let the existing document-availability
  // guard check every unqualified member of the send, without a second model
  // round for an otherwise closed action containing no content assertion.
  if(bareDocumentAction(line))return;
  return {supported:false,pending:true,candidateSourceIds:[...new Set(matching.flatMap(matches=>matches.map(source=>source.id)))],reason:'Original evidence links this specific document type to this product; normal verification must still establish the claimed scope, conditions and contents.'};
 }
 return {supported:false,verificationBoundary:'document_product_scope',reason:'This document-to-product coverage is not established by original Company Knowledge. Document availability and separate product specifications do not link that specific report to that specific product. Confirm the coverage gap without asserting it, including in a paraphrase.'};
}

/** Prove one closed, literal coverage predicate. This deliberately does not
 * prove a report's contents, certification, sample population or suitability.
 * Those remain semantic questions even when the document/product link exists.
 * A complete original source travels with the result through its source ID. */
export function literalDocumentScopeEvidence(clause:string,context:Context,sources:DocumentProductSource[]):{sourceId:string;reason:string;quote:string;evidence?:{sourceId:string;quote:string;reason:string}[]}|undefined {
 const originals=sources.filter(source=>source.original!==false&&source.complete!==false&&!stale.test((source.title||'')+' '+source.text));
 const normalized=canonicalizeKnownProductIdentifiers(clause,originals).trim().replace(/[’‘]/g,"'").replace(/[.!]$/,'');
 const line=normalized.replace(/^(?:yes|correct)[,\s]+/i,'');
 const doc=documents(line);if(doc.length!==1)return;
 const document=doc[0],before=line.slice(0,document.start),after=line.slice(document.end);
 if(/\b(?:reports|sheets|certificates|certifications)\b/i.test(document.text))return;
 const possession=/^\s*(?:we|our company)\s+(?:have|has)\s+(?:(?:an?|the|our|approved)\s+)*$/i.test(before);
 if(!possession&&!/^\s*(?:(?:our|the|this|that|an?|approved)\s+)*$/i.test(before))return;
 const predicate=/^\s*(?:([A-Z][A-Z0-9]*(?:[-/][A-Z0-9]+)+)\s+)?(?:(?:that|which)\s+)?(?:(?:does|do)\s+)?(?:(?:explicitly|specifically)\s+)?covers?\s+(?:(?:our|the|this|that|product|grade|model)\s+)*([A-Z]{1,6}\d{1,6}[A-Z0-9-]*)(?:\s+([a-z][a-z -]*))?$/i.exec(after);
 if(!predicate)return;
 if(possession&&!/\b(?:that|which)\b/i.test(after))return;
 if(!possession&&/\b(?:that|which)\b/i.test(after))return;
 const availability=possession?availableDocumentActionEvidence(document.kind,originals,true):undefined;
 if(possession&&!availability)return;
 const [,identifier,product,description='']=predicate;
 if(competingScopeEvidence(document.kind,product,identifier,originals))return;
 // Only a product noun already stated with the source's scoped product may
 // be elided/repeated. Adjectives, extra predicates and new scope stay pending.
 if(description&&!productNounTail.test(description))return;
 const assessment=assessDocumentProductCoverage(line,context,originals);
 if(!assessment?.pending)return;
 const candidates=new Set(assessment.candidateSourceIds||[]);
 for(const source of originals.filter(item=>candidates.has(item.id))){
  if(uncertainty.test(source.text))continue;
  const sourceText=canonicalizeKnownProductIdentifiers(source.text,originals);
  // A positive headline plus an explicit coverage exclusion is not a closed
  // unrestricted scope proof. Negative certification/performance limitations
  // remain separate predicates and do not create this contradiction.
  if(parts(sourceText).some(sentence=>coverageNegated(sentence)&&(!scopes(sentence).length||scopes(sentence).some(scope=>scope.key===norm(product)))))continue;
  for(const sentence of parts(sourceText))for(const sourceDocument of documents(sentence)){
   if(!sameDocument(document.kind,sourceDocument.kind))continue;
   if(/\bapproved\b/i.test(before)&&!/^\s*(?:(?:the|our|an?)\s+)?approved\s*$/i.test(sentence.slice(0,sourceDocument.start)))continue;
   const scope:Scope={key:norm(product),labels:[norm(product)]};
   const position=productPosition(sentence,scope);if(!position||position.start<=sourceDocument.end)continue;
   const relation=sentence.slice(sourceDocument.end,position.start);
   const link=/^\s*(?:([A-Z][A-Z0-9]*(?:[-/][A-Z0-9]+)+)\s+)?(?:(?:does|do)\s+)?(?:(?:explicitly|specifically)\s+)?covers?\s+((?:[A-Za-z'-]+\s+)*)$/i.exec(relation);
   if(!link||identifier&&link[1]!==identifier||coverageNegated(sentence,sourceDocument,scope))continue;
   if(link[2].trim().split(/\s+/).filter(Boolean).some(word=>! /^(?:our|the|this|that|product|grade|model)$/.test(word)&&! /^[A-Z][A-Za-z'-]*$/.test(word)))continue;
   const suffix=sentence.slice(position.end).replace(/[.!]$/,'').trim();
   // No extrapolation from “covers PX20 only if…”, a sample restriction or
   // an attached claim. A following source sentence remains available to the
   // semantic checker whenever the reply makes any additional content claim.
   if(suffix&&!productNounTail.test(suffix))continue;
   const described=norm(description).replace(/s$/,''),sourced=norm(suffix).replace(/s$/,'');
   if(description&&described!==sourced&&!sourced.endsWith(' '+described)&&!/^(?:product|model|grade)$/i.test(description))continue;
   const proof={sourceId:source.id,quote:source.text,reason:'The clause’s coverage predicate is the original source’s explicit same-document, same-product relation; no contents, result, certification or wider sample scope is asserted.'};
   return {...proof,...availability?{evidence:[proof,{sourceId:availability.id,quote:availability.text,reason:'A complete current original source explicitly establishes availability of this document type, with no applicable release or approval restriction.'}]}:{}};
  }
 }
}

/** A compact evidence decision next to the live output rules. It carries the
 * current question and source verdict, never a prewritten answer. */
export function documentCoverageQuestionEvidence(context:Context,sources:DocumentProductSource[]){
 const buyer=latestBuyer(context);if(!requestsDocumentProductCoverage(buyer))return;
 const assessment=assessDocumentProductCoverage('Yes, it does.',context,sources);
 return {buyerQuestion:buyer,documentTypes:[...new Set(documents(buyer).map(item=>item.kind))],productScopes:scopes(buyer).map(scope=>scope.key),relationship:assessment?.pending?'original_link_candidate':'unconfirmed',candidateSourceIds:assessment?.candidateSourceIds||[],boundary:'Document availability and separate product facts never establish document-to-product coverage.'};
}
