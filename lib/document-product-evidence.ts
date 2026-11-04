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
const parts=(text:string)=>text.split(/\n+|(?<=[.!?;])\s+/).filter(Boolean);

function documents(text:string){return [...text.matchAll(documentPattern)].map(match=>({text:match[0],start:match.index||0,end:(match.index||0)+match[0].length,kind:norm(match[0]).replace(/\breports\b/g,'report').replace(/\bsheets\b/g,'sheet').replace(/\bcertificates\b/g,'certificate').replace(/\bcertifications\b/g,'certification').replace(/\bspec sheet\b/g,'specification sheet')}));}
const relationWords=(text:string)=>relationship.test(text.replace(documentPattern,' '));
function sameDocument(claim:string,source:string){return claim===source||claim==='test report'&&source==='material test report'||claim==='report'&&/report$/.test(source);}
function scopes(text:string):Scope[]{
 const result:Scope[]=[...new Set((text.match(productPattern)||[]).filter(value=>!notProduct.test(value)).map(norm))].map(key=>({key,labels:[key]}));
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
 const match=new RegExp('\\b'+escaped(scope.key)+'\\b','i').exec(text);return match?{start:match.index,end:match.index+match[0].length}:undefined;
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
/** One shared speech-act boundary for local fact classification and document
 * scope checks. Natural first-person investigation wording asserts no answer;
 * positive tails, commercial actions and timing do not inherit that status. */
export function isBoundedEpistemicFactAction(text:string):boolean {
 // A closed courtesy prefix changes neither the action nor its uncertainty.
 // Preserve everything after it so attached factual/timing claims still fail.
 const line=text.trim().replace(/[’‘]/g,"'").replace(/^(?:(?:thanks|thank you)(?: for (?:asking|raising that|checking|clarifying|pointing that out))?|of course|understood|sure|okay|ok)\s*[,;:—–-]\s*/i,'');
 const investigation=/^(?:(?:I|we)(?:'ll|\s+(?:can|will|would|must))\s+|(?:I|we)\s+(?:need|have) to\s+|let (?:me|us)\s+)(?:(?:definitely|certainly|personally)\s+)?(?:(?:need|have) to\s+)?(?:(?:definitely|certainly|personally)\s+)?(?:check|double[- ]?check|verify|confirm|find out)\s+(?:whether|if)\b/i.test(line);
 const reservation=/^(?:I|we)\s+(?:(?:cannot|can't|do not|don't)\s+(?:confirm|verify|know|say)|(?:have not|haven't)\s+(?:confirmed|verified|established))\s+(?:whether|if)\b/i.test(line);
 if(!investigation&&!reservation)return false;
 const attachedAssertion=/\b(?:but|however)\b|\b(?:and|plus|also|yet)\s+(?:we|I|our|it|this|that|the (?:report|product|mesh|material))\b|\b(?:and|plus|also)\s+(?:send|ship|deliver|offer|provide|supply|give|arrange|promise|approve|discount|extend|show|prove|demonstrate)\b|\band\s+(?:confirm|verify)\s+that\s+(?:it|we|our|the)\b|\b(?:let (?:you|them|him|her) know|report back|follow up)\s+(?:that|because)\b|\bguarantee(?:s|d)?\b|:\s*[a-z]|[,;]\s*(?:which|that|we|I|our|it|this|the (?:report|product|mesh|material))\b/i;
 const timing=/\b(?:soon|shortly|ASAP|quickly|in a bit|right away|promptly|immediately|tomorrow|today|within|by (?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|\d)|in \d+ (?:hours?|days?))\b/i;
 return !attachedAssertion.test(line)&&!timing.test(line);
}

/** Return a hard veto for absent linkage. A present relationship remains a
 * candidate for normal semantic checking: scope alone never proves results,
 * suitability, certification, or any other contents of the report. */
export function assessDocumentProductCoverage(clause:string,context:Context,sources:DocumentProductSource[]):{supported:false;pending?:true;candidateSourceIds?:string[];reason:string;verificationBoundary?:'document_product_scope'}|undefined {
 const buyer=latestBuyer(context),asked=requestsDocumentProductCoverage(buyer);
 const line=clause.trim().replace(/[’‘]/g,"'");
 // Explicit uncertainty is a commitment to investigate, never a positive or
 // negative assertion about report scope. Appended assertions are assessed in
 // their own clause by the normal verification policy.
 if(isBoundedEpistemicFactAction(line))return;
 if(/^(?:does|do|is|are|can|could|would|will|which|what|how|whether)\b/i.test(line)&&/\?\s*$/.test(line)&&! /\b(?:our|the)\s+[a-z]+\d+[^?]{0,30}\b(?:reports?|sheets?|certificates?)\b/i.test(line))return;
 const ownDocuments=documents(line),buyerDocuments=documents(buyer);
 const assent=asked&&/^\s*(?:yes|correct|exactly|absolutely|certainly|sure|it does|that does|we do)\b/i.test(line);
 const documentPronoun=asked&&!ownDocuments.length&&/^\s*(?:it|this|that)\b/i.test(line)&&relationWords(line);
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
   if(negative.test(sentence)!==negative.test(line))return false;
   return documents(sentence).some(original=>sameDocument(document.kind,original.kind)&&scopes(sentence).some(product=>equivalent(scope,product,map)&&linked(sentence,original,product)));
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

/** A compact evidence decision next to the live output rules. It carries the
 * current question and source verdict, never a prewritten answer. */
export function documentCoverageQuestionEvidence(context:Context,sources:DocumentProductSource[]){
 const buyer=latestBuyer(context);if(!requestsDocumentProductCoverage(buyer))return;
 const assessment=assessDocumentProductCoverage('Yes, it does.',context,sources);
 return {buyerQuestion:buyer,documentTypes:[...new Set(documents(buyer).map(item=>item.kind))],productScopes:scopes(buyer).map(scope=>scope.key),relationship:assessment?.pending?'original_link_candidate':'unconfirmed',candidateSourceIds:assessment?.candidateSourceIds||[],boundary:'Document availability and separate product facts never establish document-to-product coverage.'};
}
