import {buyerConversationIdentifierReferences,buyerProductIdentifierReferences,canonicalizeKnownProductIdentifiers,isBuyerIdentifierClarification,productIdentityReferences} from './product-identity-evidence.ts';
import {availableDocumentActionEvidence} from './document-availability-evidence.ts';
import {deriveCallParticipant} from './call-participant.ts';
import {affirmativeOutgoingDocumentActions} from './document-action-syntax.ts';
import {reportDeliveryCondition} from './document-delivery-condition.ts';
import {materialClauses} from './material-request-meaning.ts';

/** Document availability and product coverage are different propositions.
 * A scope claim must have its own original document→product relationship;
 * co-occurrence in a catalog, buyer request or extracted summary is not one. */
export type DocumentProductSource={id:string;text:string;title?:string;complete?:boolean;original?:boolean};
type Scope={key:string;labels:string[]};
type Context={manufacturer?:{products?:string};turns?:{role:string;text:string}[];buyerText?:string;sources?:DocumentProductSource[]};
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
const positiveReportConditionConnector='(?:if|provided(?:\\s+that)?|as long as|on condition that)';

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
 ||/\b(?:(?:its|(?:the|that|this) report['’]s)\s+scope|the scope of (?:the|that|this) report)\s+(?:includes?|contains?)\b/i.test(text)
 ||!!closedReportScopePredicate(text)
 ||/^\s*(?:it|this|that)\b/i.test(text)&&inclusionPredicate.test(text.replace(/^\s*(?:it|this|that)\b/i,''));

/** Reciprocal scope wording asserts the same relationship as “report covers
 * item.” Keep one complete report predicate, not merely co-occurring nouns,
 * so factual detection and conditional-action parsing use the same meaning. */
function closedReportScopePredicate(text:string,implicitDocument?:string):{item:string;document:string}|undefined {
 let line=text.trim().replace(/[’‘]/g,"'").replace(/[.!;]$/,'');
 if(implicitDocument&&!documents(line).length)line=line.replace(/\bits scope\b/i,'the scope of the '+implicitDocument);
 const reports=documents(line);
 if(reports.length!==1||! /report$/.test(reports[0].kind))return;
 const report=reports[0],before=line.slice(0,report.start),after=line.slice(report.end);
 const item='(?:[A-Z]{1,6}[-\\u2010-\\u2015\\u2212\\uFE63\\uFF0D ]?\\d{1,6}[A-Z0-9-]*|(?:(?:the|your|that|this)\\s+)?(?:exact\\s+)?(?:(?:drawing|product|part|item|grade|mesh)(?:\\s+reference)?|reference))';
 const reportScope=new RegExp("^'s\\s+scope\\s+(?:includes?|contains?|covers?)\\s+("+item+')$','i').exec(after);
 if(reportScope&&/^\s*(?:(?:our|the|your|that|this)\s+)?$/i.test(before))return {item:reportScope[1],document:report.kind};
 const scopeOf=new RegExp('^('+item+')\\s+(?:(?:(?:is|falls?)\\s+(?:within|inside)|is\\s+included\\s+in)\\s+(?:the\\s+)?scope\\s+of|is\\s+covered\\s+by)\\s+(?:(?:our|the|your|that|this)\\s+)?$','i').exec(before);
 if(scopeOf&&!after.trim())return {item:scopeOf[1],document:report.kind};
 const possessive=new RegExp('^('+item+')\\s+(?:is|falls?)\\s+(?:within|inside)\\s+(?:(?:our|the|your|that|this)\\s+)?$','i').exec(before);
 if(possessive&&/^'s\s+scope$/i.test(after))return {item:possessive[1],document:report.kind};
}
function sameDocument(claim:string,source:string){return claim===source||claim==='test report'&&source==='material test report'||claim==='report'&&/report$/.test(source);}
function scopes(text:string):Scope[]{
 const identifiers=documentIdentifierReferences(text);
 const result:Scope[]=[...new Set([...text.matchAll(productPattern)].filter(match=>!notProduct.test(match[0])&&!identifiers.some(id=>id.start<=(match.index||0)&&id.end>=(match.index||0)+match[0].length)).map(match=>norm(match[0])))].map(key=>({key,labels:[key]}));
 // The reciprocal grammar also locates a complete separator/spaced buyer
 // reference. Keep literal spaces distinct from compact source identities;
 // only the existing source-known identifier normalizer can establish aliases.
 const scopePredicate=closedReportScopePredicate(text);
 if(scopePredicate&&/^[A-Z]{1,6}[-\u2010-\u2015\u2212\uFE63\uFF0D ]?\d{1,6}[A-Z0-9-]*$/i.test(scopePredicate.item)&&!notProduct.test(scopePredicate.item.replace(/[-\s\u2010-\u2015\u2212\uFE63\uFF0D]/g,''))&&!result.some(scope=>scope.key===norm(scopePredicate.item)))result.push({key:norm(scopePredicate.item),labels:[scopePredicate.item]});
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
 const match=[scope.key,...scope.labels].map(label=>new RegExp('(?<![a-z0-9/-])'+escaped(label)+'(?![a-z0-9/-])','i').exec(text)).find(Boolean);return match?{start:match.index,end:match.index+match[0].length}:undefined;
}
function linked(text:string,document:ReturnType<typeof documents>[number],scope:Scope){
 const product=productPosition(text,scope);if(!product)return false;
 if(product.end<=document.start){
  const between=text.slice(product.end,document.start);
  // "PX20 specification sheets and material test reports" is a catalog
  // list, not an assertion that the report covers PX20.
  return /^\s*(?:['’]s\s*)?(?:(?:product|material|quality|inspection)\s+)?$/i.test(between)
   ||/^\s+(?:(?:(?:is|falls?)\s+(?:within|inside)|is\s+included\s+in)\s+(?:the\s+)?scope\s+of|is\s+covered\s+by)\s+(?:(?:our|the|your|that|this)\s+)?$/i.test(between)
   ||/^\s+(?:is|falls?)\s+(?:within|inside)\s+(?:(?:our|the|your|that|this)\s+)?$/i.test(between)&&/^['’]s\s+scope(?=[.!;,]|$)/i.test(text.slice(document.end))
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
   ||/^['’]s\s+scope\s+(?:includes?|contains?|covers?)\s+$/i.test(between)
   ||/^\s+(?:includes?|contains?|provides?)\s+(?:test\s+)?(?:data|results|information|details|measurements|evidence)\s+(?:for|on|about|of)\s+(?:(?:our|the|this|that|product|grade|exact)\s+)*$/i.test(between));
 }
 return false;
}
function latestBuyer(context:Context){return context.buyerText??([...(context.turns||[])].reverse().find(turn=>turn.role==='buyer'||turn.role==='customer')?.text||'');}
function currentCallReportInquiry(context?:Context):string|undefined {
 return [...(context?.turns||[]).filter(turn=>turn.role==='buyer'||turn.role==='customer').map(turn=>turn.text),...(context?.buyerText?[context.buyerText]:[])].reverse().find(text=>requestsDocumentProductCoverage(text)&&documents(text).filter(document=>/report$/.test(document.kind)).length===1);
}
function bareDocumentAction(line:string){
 if(!/^\s*(?:I|we)(?:['’]ll|\s+(?:will|can|could|would))\s+(?:include|attach|send|email|share|provide)\b/i.test(line))return false;
 const remainder=line.replace(documentPattern,' ').replace(productPattern,' ').replace(/\b\d+(?:\.\d+)?\s*mesh(?:\s+per inch)?\b|\b\d{3}\s*stainless(?:\s+steel)?\b/gi,' ');
 const allowed=new Set("i i'll we we'll will can could would include attach send email share provide the a an our your both and in with to that this it them these those company profile profiles product mesh for review reference engineer engineers team s over".split(' '));
 return (remainder.toLowerCase().replace(/[’‘]/g,"'").match(/[a-z]+(?:'[a-z]+)?/g)||[]).every(word=>allowed.has(word));
}
export function requestsDocumentProductCoverage(text:string):boolean {
 return !!documents(text).length&&/\?|\b(?:confirm|whether|if|need to know|tell me)\b/i.test(text)&&(relationWords(text)||/\b(?:report|sheet|certificate)\b.{0,55}\bfor\b/i.test(text));
}
const courtesyAction='(?:asking|(?:this|that|the|your) (?:question|update|clarification|information|offer)|this|that|your time|your patience|raising that|checking(?: in)?|pointing that out|bringing that up|letting (?:me|us) know|keeping (?:me|us) informed|(?:sending|emailing|forwarding) (?:that|this|it|(?:the|your) drawing)|(?:sharing|explaining|clarifying|confirming|flagging|mentioning)(?: (?:that|this))?)';
const courtesyStart=new RegExp('^(?:(?:thanks|thank you)(?: for '+courtesyAction+')?|of course|understood|sure|okay|ok|got it|that makes sense|that helps|that (?:would|will) help|that[\'’]s helpful|I understand)(.*)$','i');
function acknowledgmentVocativesKnown(text:string,context?:Context):boolean {
 // A salutation is not part of the participant's name. The remaining name
 // still has to match the actual speaker; “Hi Guaranteed” is not an exemption.
 const leading=text.match(/^([A-Z][A-Za-z'-]*(?:\s+[A-Z][A-Za-z'-]*){0,2}),\s*(?=(?:thanks|thank you|understood|got it)\b)/)?.[1].replace(/^(?:Hi|Hello)\s+/,'');
 const trailing=text.match(/,\s*([A-Z][A-Za-z'-]*(?:\s+[A-Z][A-Za-z'-]*){0,2})[.!]?$/)?.[1];
 const names=[leading,trailing].filter((name):name is string=>!!name);
 if(!names.length)return true;
 const participant=deriveCallParticipant(context?.turns||[]),known=participant.transferPending?undefined:participant.speakerName;
 return !!known&&names.every(name=>name.toLowerCase()===known.toLowerCase());
}
/** Courtesy words describe the interaction, never an answer about the product.
 * Require the complete acknowledgment, including an optional name, so “thanks
 * for confirming the report covers…” cannot hide its factual proposition. */
export function isConversationalAcknowledgment(text:string,context?:Context):boolean {
 if(!acknowledgmentVocativesKnown(text.trim(),context))return false;
 const line=text.trim().replace(/[’‘]/g,"'").replace(/^[A-Z][A-Za-z'-]*(?:\s+[A-Z][A-Za-z'-]*){0,2},\s*(?=(?:thanks|thank you|understood|got it)\b)/,'');
 // A bare vocative is neutral only when this person actually identified
 // themselves in the current spoken exchange. An intended transfer target or
 // a capitalized assertion such as “Guaranteed,” cannot supply that evidence.
 const vocative=line.match(/^([A-Z][A-Za-z'-]*(?:\s+[A-Z][A-Za-z'-]*){0,2})[,!.]?$/)?.[1];
 if(vocative&&context?.turns?.length){
  const participant=deriveCallParticipant(context.turns);
  const known=participant.transferPending?undefined:participant.speakerName;
  if(known&&vocative.toLowerCase()===known.toLowerCase())return true;
 }
 // A closed salutation asserts no product fact. Participant and identity
 // validation still decide whether this is the person the rep may address.
 if(/^(?:[Hh]i|[Hh]ello)(?:(?:,\s*|\s+)[A-Z][A-Za-z'-]*(?:\s+[A-Z][A-Za-z'-]*){0,2})?[.!]?$/.test(line))return true;
 const courtesy=courtesyStart.exec(line);if(!courtesy)return false;
 const tail=courtesy[1].trim();
 if(/^(?:thanks|thank you)[, ]+that (?:would|will) help[.!]?$/i.test(line))return true;
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
/** Remove only a complete neutral courtesy, with any vocative checked against
 * the actual speaker. An assertion before the boundary must remain a claim. */
function afterVerifiedCourtesy(text:string,context?:Context):string|undefined {
 for(const boundary of text.matchAll(/[—–:;]/g)){
  const prefix=text.slice(0,boundary.index).trim(),rest=text.slice(boundary.index!+1).trim();
  if(rest&&isConversationalAcknowledgment(prefix,context))return rest;
 }
}
/** Reporting an investigation's eventual result does not supply that result.
 * Keep the communication action, optional neutral object and ordering clause
 * separate so ordinary wording variations cannot become scope assertions. */
function reportsInvestigationResult(tail:string):boolean {
 const action=/^and\s+(?:(?:(?:I|we)(?:'ll|\s+(?:will|can))|will|can)\s+)?(?:(?:get|come) back to (?:you|them)|let (?:you|them|him|her) know|tell (?:you|them|him|her)|report back(?: to (?:you|them))?|follow up(?: with (?:you|them))?|confirm(?: back)?(?: (?:with|to) (?:you|them))?)\b/i.exec(tail);
 if(!action)return false;
 const remainder=tail.slice(action[0].length).trim().replace(/(?:\s*,)?\s*\bbefore\s+(?:(?:sending|emailing)(?:\s+(?:it|them|anything|the documents))?|(?:I|we)\s+(?:send|email)(?:\s+(?:it|them|anything|the documents))?)(?: over)?$/i,'')
  .replace(/(?:\s*,)?\s*\b(?:once|after|when)\s+(?:(?:I|we)\s+have\s+(?:that|the|an?)\s+(?:answer|information|results?|confirmation)|(?:I|we)(?:'ve| have)\s+(?:checked|verified|confirmed)\s+(?:it|that|the (?:scope|coverage)))$/i,'')
  // A recipient can precede or follow the neutral result object: “confirm
  // with you that” / “confirm that with you”. Remove only a terminal recipient;
  // the complete remaining object must still be a closed unresolved result.
  .replace(/\s+(?:for|with|to)\s+(?:you|them|him|her)$/i,'').trim();
 if(!remainder)return true;
 return /^(?:that|it)(?: for you)?$/i.test(remainder)
  ||/^with\s+(?:that|it)$/i.test(remainder)
  ||/^(?:(?:with|on)\s+)?(?:(?:that|this|the|an?)\s+)?(?:(?:clear|specific|detailed|written|exact|precise)\s+)?(?:confirmation|results?|details?|answer|information|update|findings|outcome|clarification)(?: for you)?$/i.test(remainder)
  ||/^on\s+(?:that|this|it|(?:the|its|that)\s+(?:scope|coverage|availability))$/i.test(remainder)
  ||/^what\s+(?:I|we)\s+(?:find(?: out)?|learn|discover)$/i.test(remainder)
  ||/^whether\s+(?:it|that)\s+(?:does|is covered)$/i.test(remainder);
}
/** Uncertainty about coverage does not make “our certified RX73” uncertain.
 * This is a noun-premise guard, independent of the quantity scanner and buyer
 * spelling. “Our report covers RX73” owns the report, not the queried item. */
function presupposesOwnedProduct(subject:string):boolean {
 const compact=/(?<![a-z0-9_-])[a-z]{1,6}-?\d{1,6}[a-z]?(?![a-z0-9_-]|[.,]\d)/gi;
 // A literal spaced buyer code is still not evidence that it is ours.
 // Match literal casing without establishing a product alias or ownership.
 const spaced=/(?<![a-zA-Z0-9_-])[A-Z]{2,6} \d{1,6}(?![a-zA-Z0-9_-]|[.,]\d)/gi;
 for(const identifier of [...subject.matchAll(compact),...subject.matchAll(spaced)]){
  const prefix=subject.slice(0,identifier.index),owner=[...prefix.matchAll(/\bour\b/gi)].at(-1);
  if(!owner)continue;
  const relation=prefix.slice((owner.index||0)+owner[0].length);
  if(/[.!?;:]/.test(relation))continue;
  const referents=documents(relation),document=referents[0];
  const reportPredicate=document&&referents.length===1&&/^\s*$/.test(relation.slice(0,document.start))
   &&/^\s+(?:(?:does|do|explicitly|directly|currently|actually)\s+)*(?:covers?|appl(?:y|ies)\s+to|pertains?\s+to|relates?\s+to|matches?)\s+(?:(?:the|your|that|this|stated|requested|exact)\s+)*$/i.test(relation.slice(document.end));
  if(!reportPredicate)return true;
 }
 return false;
}
/** This is a routing signal for the EXISTING whole-line semantic checker,
 * never local proof or an exemption. A future whether/if investigation may
 * use grammar outside the closed fast path. Keep independent assertions,
 * presupposed ownership and restricted terms on their ordinary hard path. */
export function hasFutureReportInquiry(text:string,context?:Context):boolean {
 const line=text.trim().replace(/[’‘]/g,"'");
 if(isBoundedEpistemicFactAction(line,context)||investigationThenDocumentDelivery(line,context))return false;
 if(!documents(line).some(document=>/report$/.test(document.kind))||!relationWords(line))return false;
 const future=/\b(?:I|we)(?:'ll|\s+(?:will|can|would))\b/i.exec(line);if(!future)return false;
 const action=line.slice(future.index),uncertainty=/\bwhether\b|\b(?:check|verify|confirm|find out|look into)\b[^.!?;]{0,80}\bif\b/i.exec(action);if(!uncertainty)return false;
 const before=line.slice(0,future.index+uncertainty.index),predicate=action.slice(uncertainty.index);
 // A scoped report already claimed before the investigation cannot inherit
 // its uncertainty. Nor can a qualified noun or an appended assertion.
 if(assessDocumentProductCoverage(before,context||{},context?.sources||[])?.verificationBoundary||presupposesOwnedProduct(before)||presupposesOwnedProduct(predicate))return false;
 if(/\b(?:confirm|verify|establish)\s+that\b|\b(?:which|that)\s+(?:is|are|was|were|has|have|can|will|meets?|complies|passes?|guarantees?|certifies?|proves?)\b/i.test(line))return false;
 if(/[;:—–()[\]"“”]|[.!?]\s+\S|\b(?:because|since|therefore|thus|despite)\b|\b(?:and|but|however|plus|also)\s+(?:I|we|our|it|this|that|the)\b/i.test(predicate))return false;
 // These are independent safety/authority domains, not uncertainty grammar.
 // A noncanonical mixed reply keeps the normal hard checks and repair path.
 if(/\b(?:certif\w*|guarantee\w*|discount\w*|price|USD|MOQ|ship\w*|deliver\w*|stock|payment|free|soon|shortly|ASAP|quickly|promptly|immediately|tomorrow|today|within)\b|\bby\s+(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|\d)|\b\d+(?:[.,]\d+)?\s*(?:%|mm|microns?|μm|USD|dollars?|kg|hours?|days?)\b/i.test(line))return false;
 // A proposed outgoing artifact is a separate action with availability and
 // release requirements. It cannot inherit an inquiry's interpretation.
 if(/\b(?:send|email|share|forward|include|attach)\b|\b(?:reply|respond)\s+with\b/i.test(action))return false;
 return true;
}
/** A noncanonical positive-result condition may need semantic attachment
 * checking. This signal authorizes only that check, not the send. Definite
 * sequence/check-completion, absent release authority and contradictory sends
 * never get downgraded to grammar uncertainty. */
export function hasConditionalReportReplyForSemanticReview(text:string,context?:Context):boolean {
 const line=text.trim().replace(/[’‘]/g,"'");if(investigationThenDocumentDelivery(line,context))return false;
 const reports=documents(line).filter(document=>/report$/.test(document.kind));if(!reports.length||!reports.every(report=>availableDocumentActionEvidence(report.kind,context?.sources||[])))return false;
 if(affirmativeOutgoingDocumentActions(line).length!==1)return false;
 if(/\b(?:regardless|anyway|even if|does not|doesn't|not covered|not match|no match|certif\w*|guarantee\w*|discount\w*|price|MOQ|ship\w*|deliver\w*|stock|payment|free|soon|shortly|ASAP|quickly|promptly|immediately|tomorrow|today|within)\b|\bby\s+(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|\d)/i.test(line))return false;
 const postposed=new RegExp('\\b(?:only\\s+)?'+positiveReportConditionConnector+'\\s+(?:it|that report|the report)\\s+(?:does|covers?|matches?)\\b','i').exec(line);
 if(postposed){
  const before=line.slice(0,postposed.index),inquiry=/\b(?:whether|if)\b/i.exec(before);
  if(!inquiry||!requestsDocumentProductCoverage(before))return false;
  if(new Set(documents(before).filter(document=>/report$/.test(document.kind)&&document.kind!=='report').map(document=>document.kind)).size>1)return false;
  if(assessDocumentProductCoverage(before.slice(0,inquiry.index),context||{},context?.sources||[])?.verificationBoundary||presupposesOwnedProduct(before.slice(0,inquiry.index))||presupposesOwnedProduct(before.slice(inquiry.index)))return false;
  return true;
 }
 const fronted=new RegExp('^\\s*(?:once|after|when|'+positiveReportConditionConnector+')\\s+([\\s\\S]+?),\\s*(?:I|we)(?:\x27ll|\\s+(?:will|can|would))\\s+','i').exec(line);
 if(!fronted||/\b(?:whether|if)\b/i.test(fronted[1])||!documents(fronted[1]).length||!relationWords(fronted[1]))return false;
 return !presupposesOwnedProduct(fronted[1])&&!/\b(?:which|that)\s+(?:is|are|has|have|can|will|meets?|guarantees?|proves?)\b/i.test(fronted[1]);
}
function investigationAcknowledgment(text:string,context?:Context):boolean {
 if(!acknowledgmentVocativesKnown(text,context))return false;
 return isConversationalAcknowledgment(text,context)||/^[Yy]es(?:,\s*[A-Z][A-Za-z'-]*(?:\s+[A-Z][A-Za-z'-]*){0,2})?[.!]$/.test(text);
}
/** Receipt or review of an incoming drawing can be a prerequisite, never a
 * completed receipt or a finding about report scope.
 * Consume only this closed action and leave the ENTIRE remaining predicate
 * to the ordinary inquiry/delivery parser. A named comparison artifact still
 * needs availability; a drawing reference must come from this conversation. */
function afterDrawingReview(text:string,context?:Context):string|undefined {
 const review=/^(?:once|after|when)\s+(?:I|we)(?:'ve| have)?\s+(?:review(?:ed)?|check(?:ed)?|seen|receiv(?:e|ed)|get|got)\s+(?:it|(?:the|that|your)\s+drawing)(?:\s+(?:with|against)\s+([^,;.!?]+))?\s*,\s*(.+)$/i.exec(text);
 if(!review)return;
 if(review[1]){
  const target=review[1],reference=target.replace(/^(?:(?:that|the|your)\s+)?/i,'').replace(/\s+reference$/i,'');
  const knownReference=[...buyerProductIdentifierReferences(reference,latestBuyer(context||{})),...buyerConversationIdentifierReferences(reference,context?.turns||[])].some(item=>item.start===0&&item.end===reference.length);
  const report=documents(target);
  const availableReport=report.length===1&&/report$/.test(report[0].kind)&&/^\s*(?:(?:that|the|your)\s+)?$/i.test(target.slice(0,report[0].start))&&!target.slice(report[0].end).trim()&&!!availableDocumentActionEvidence(report[0].kind,context?.sources||[]);
  if(!knownReference&&!availableReport)return;
 }
 return review[2];
}
function purposeReportInquiry(text:string):string|undefined {
 const inquiry=/^((?:I|we)(?:'ll| will| can))\s+(?:check|review)\s+((?:(?:the|that|this)\s+)?(?:(?:material test|inspection|test)\s+)?report)\s+to\s+(?:check|confirm|verify|find out)\s+(whether|if)\s+it\s+(.+)$/i.exec(text);
 return inquiry?inquiry[1]+' check '+inquiry[3]+' '+inquiry[2]+' '+inquiry[4]:undefined;
}
/** One shared speech-act boundary for local fact classification and document
 * scope checks. Natural first-person investigation wording asserts no answer;
 * positive tails, commercial actions and timing do not inherit that status. */
export function isBoundedEpistemicFactAction(text:string,context?:Context):boolean {
 // A closed courtesy prefix changes neither the action nor its uncertainty.
 // Preserve everything after it so attached factual/timing claims still fail.
 // Callers may pass a complete semicolon-delimited clause. Its terminal
 // separator is not part of the predicate; internal separators and every
 // following clause still retain their independent factual checks.
 let line=text.trim().replace(/[’‘]/g,"'").replace(/;$/,'.');
 const courtesy=afterVerifiedCourtesy(line,context);if(courtesy)return isBoundedEpistemicFactAction(courtesy,context);
 // Arrival is a prerequisite for the future investigation, not an invented
 // calendar deadline or evidence that the drawing/report has been received.
 const incomingPrerequisite=/^(.+?)\s+(?:when|once|after)\s+(?:your|the|that)\s+drawing\s+(?:arrives|comes in)[.!]?$/i.exec(line);
 if(incomingPrerequisite)return isBoundedEpistemicFactAction(incomingPrerequisite[1],context);
 // Reviewing the incoming artifact is a prerequisite, not a positive answer
 // about it. Remove only this closed review action and check the ENTIRE
 // following uncertainty action normally, including any attached claims.
 const reviewPrerequisite=afterDrawingReview(line.replace(/^and\s+/i,''),context);
 if(reviewPrerequisite)return isBoundedEpistemicFactAction(reviewPrerequisite,context);
 // An unresolved spelling prerequisite does not claim report coverage.
 // Only strip this closed prerequisite; the complete following action still
 // needs to be a bounded inquiry, and its numbers/claims keep normal checks.
 const clarificationPrerequisite=/^(?:once|after|when)\s+(?:we(?:'re| are)|I(?:'m| am))\s+(?:clear|certain|sure)\s+(?:on|about)\s+(?:that|the (?:code|reference|spelling))\s*,\s*(.+)$/i.exec(line);
 if(clarificationPrerequisite)return isBoundedEpistemicFactAction(clarificationPrerequisite[1],context);
 const followThrough=/^(?:once|after|when)\s+(.+?),\s*(?:I|we)(?:'ll|\s+(?:will|can))\s+(?:follow up|report back|let you know|get back to you)[.!]?$/i.exec(line);
 if(followThrough){
  const condition=followThrough[1].replace(/^(?:I|we)(?:'ve| have)?\s+(?:reviewed|seen|checked)\s+(?:that|the|your)\s+drawing\s+and\s+/i,'');
  const checked=/^(?:(?:I|we)(?:'ve| have)?\s+)?(?:check(?:ed)?|verif(?:y|ied)|confirm(?:ed)?)\s+(?:(?:whether|if|that)\s+)?(.+)$/i.exec(condition);
  if(checked&&documents(checked[1]).length===1&&/\b(?:covers?|matches?|includes?|coverage)\b/i.test(checked[1]))return isBoundedEpistemicFactAction('I will check whether '+checked[1],context);
 }
 // Accepting the buyer's drawing and promising to investigate are actions,
 // not evidence of report coverage. Strip only these closed handoff/review
 // forms, then apply the ordinary whole-predicate uncertainty check below.
 const original=line;
 line=line.replace(/^\s*(?:and\s+)?(?:if you\s+(?:can\s+)?(?:send|email)\s+(?:over\s+)?(?:that|the|your)\s+drawing(?:\s+over)?\s*,\s*|(?:yes,?\s+)?please\s+(?:(?:go ahead and|do)\s+)?(?:send|email)\s+(?:over\s+)?(?:that|the|your)\s+drawing(?:\s+over)?\s*,\s*(?:and\s+)?(?:then\s+)?)/i,'').replace(/^and\s+(?=(?:I|we)\b)/i,'');
 line=line.replace(/\s+once\s+(?:I|we)\s+(?:review|check|see)\s+(?:it|that|the drawing|your drawing)[.!]?$/i,'');
 const comparison=/^((?:I|we)(?:'ll| will| can))\s+(?:line it up with|check it against|compare it with|compare it against)\s+our\s+(?:available\s+)?(?:specs|specifications)\s+and\s+(.+)$/i.exec(line);
 if(comparison){
  if(!availableDocumentActionEvidence('specification',context?.sources||[]))return false;
  line=comparison[1]+' '+comparison[2];
 }
 const prepared=/^((?:I|we)(?:'ll| will| can))\s+(?:review|check|compare)\s+(?:it|(?:your|the|that)\s+drawing)(?:\s+(?:when|once|after)\s+it\s+(?:arrives|comes in))?(?:\s+(?:with|against)\s+our\s+(?:available\s+)?(specs|specifications))?\s+and\s+(.+)$/i.exec(line);
 if(prepared&&(!prepared[2]||availableDocumentActionEvidence('specification',context?.sources||[])))line=prepared[1]+' '+prepared[3];
 line=line.replace(/^((?:I|we)(?:'ll| will| can))\s+(?:get back to you on|let you know)\s+(whether|if)\s+/i,'$1 check $2 ');
 // Checking a report “to confirm whether it covers X” leaves the answer
 // open. Bind “it” to that single report, and parse every remaining word;
 // a qualified report noun, extra claim or outgoing action cannot disappear.
 line=purposeReportInquiry(line)||line;
 // Reporting whether an investigation succeeds leaves its answer open;
 // reporting "that" it succeeds is still an affirmative claim below.
 line=line.replace(/^((?:I|we)(?:'ll| will| can))\s+let you know\s+(if|whether)\s+/i,'$1 check $2 ');
 line=line.replace(/^((?:I|we)(?:'ll| will| can))\s+(?:review|check)\s+(?:your|the|that)\s+drawing\s+and\s+(?:check\s+)?(?:the\s+)?(?:report\s+)?coverage\b/i,'$1 check coverage');
 line=line.replace(/\s*,?\s+and\s+wait\s+for\s+your\s+approval\s+before\s+(?:sending|emailing|sharing)\s+(?:anything|it|the report)[.!]?$/i,'');
 if(line!==original)return isBoundedEpistemicFactAction(line,context);
 // “Sure. I'll check whether…” accepts an investigation, not the unknown
 // coverage. Only a complete following bounded inquiry can supply that sense;
 // standalone assent and any attached factual predicate remain checked.
 const preface=/^([^.!?]+[.!])\s+([\s\S]+)$/.exec(line);
 if(preface&&investigationAcknowledgment(preface[1],context)&&isBoundedEpistemicFactAction(preface[2],context))return true;
 // An intra-token letter→digit dash is identifier typography, not a clause
 // boundary. This parses the inquiry only; identity/number evidence checks
 // still decide whether the referenced product is actually known.
 line=line.replace(/([A-Za-z])[\u2010-\u2015\u2212\uFE63\uFF0D](?=\d)/g,'$1-');
 const courtesyEnd=[...line.matchAll(/[,;:—–-]/g)].filter(match=>isConversationalAcknowledgment(line.slice(0,match.index),context)).at(-1)?.index;
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
 const temporalSubject=subject.replace(/\bwithin(?=\s+(?:(?:the|that|this|our|your)\s+)?(?:(?:material test|inspection|test)\s+)?report(?:'s)?\s+(?:scope|coverage)\b)/gi,'inside')
  .replace(/\bwithin(?=\s+(?:the\s+)?scope\s+of\s+(?:(?:the|that|this|our|your)\s+)?(?:(?:material test|inspection|test)\s+)?report\b)/gi,'inside');
 if(timing.test(temporalSubject)||/[;:—–()[\]"“”]|[.!?]\s+\S|\b(?:but|however|because|since|although|though|therefore|thus|nevertheless|despite|yet|guarantee(?:s|d)?)\b|\bso\s+(?:you|we|it|this|that|the)\b/i.test(subject))return false;
 const next=subject.search(/\s+\b(?:and|plus|also)\b\s+/i);
 if(next>=0){
  const tail=subject.slice(next).trim();
  // Two uncertainty predicates do not assert either answer. Validate each
  // independently so a hidden qualified noun or added claim cannot borrow
  // the first question's uncertainty.
  if(/^and\s+(?:whether|if)\b/i.test(tail))return isBoundedEpistemicFactAction('I will check '+subject.slice(0,next),context)&&isBoundedEpistemicFactAction('I will check '+tail.replace(/^and\s+/i,''),context);
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
 const reportComparison=/^(?:(?:the|that|this|our)\s+)?(?:(?:material test|inspection|test)\s+)?report\s+(?:against|with)\s+(.+)$/i.exec(subject);
 if(investigation&&reportComparison&&buyerConversationIdentifierReferences(reportComparison[1],context?.turns||[]).some(reference=>reference.start===0&&reference.end===reportComparison[1].length))return true;
 if(presupposesOwnedProduct(subject))return false;
 // A relative modifier can assert a certification/result even while the
 // main report-coverage question remains uncertain. It needs its own proof.
 if(/\b(?:which|that)\s+(?:is|are|was|were|has|have|can|will|meets?|complies|passes?|guarantees?|certifies?|proves?)\b/i.test(subject))return false;
 if(/^(?:whether|if|which|what)\b\s+\S/i.test(subject)){
  if(closedReportScopePredicate(subject.replace(/^(?:whether|if|which|what)\s+/i,'')))return true;
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
 if(investigation&&buyerConversationIdentifierReferences(subject,context?.turns||[]).some(reference=>reference.start===0&&reference.end===subject.length)&&currentCallReportInquiry(context))return true;
 return !!investigation&&/^(?:(?:the|that|this|its|our|your)\s+)?(?:(?:(?:material test|inspection|test)\s+)?report(?:'s)?\s+)?(?:scope|coverage|availability)(?:\s+before\s+(?:(?:sending|emailing)\s+(?:it|them|anything|the documents)|(?:I|we)\s+(?:send|email)\s+(?:it|them|anything|the documents)))?$/i.test(subject);
}

/** A check, communication of its result, and later document delivery are three
 * different actions. The first two assert no coverage. The last still needs
 * availability and company permission; return its explicit referent so the
 * ordinary document-action checks can enforce those independently. */
export type DocumentApproval='buyer'|'engineering'|'manager';
type ParsedDocumentDelivery={investigation:string;document:string;deliveryCondition:'sequence_only'|'stated_condition'|'check_completion'|'alternative_condition';conditionText?:string;approvals?:DocumentApproval[]};
const deliveryActor="(?:I|we)(?:'ll|\\s+(?:will|can|could))\\s+";
const deliveryAction='(?:(?:reply|respond)\\s+and\\s+(?:send|email|share|forward|include|attach)\\s+|(?:send|email|share|forward|include|attach)\\s+|(?:reply|respond)\\s+with\\s+)';
const deliveryArtifact='(?:it|(?:that|the)\\s+(?:(?:material test|inspection|test)\\s+)?report|the documents|the details)';
// Interpret the complete dispatch even when its directional complement is
// intensified. A separate shared timing check rejects unagreed speed; losing
// the action here would falsely report a missing coverage prerequisite.
const deliveryTail='(?:\\s+(?:(?:right|straight)\\s+)?(?:over|along))?(?:\\s+(?:to you|your way|back to you|right back to you))?(?:\\s+for review)?';

/** An approval is a release prerequisite only inside a closed conditional
 * predicate. Keep its actual owner; mentioning another person's approval or
 * approving a different action cannot release this document send. */
function approvalPredicate(text:string):DocumentApproval|undefined {
 const line=text.trim().replace(/[’‘]/g,"'");
 const match=/^(you|your team|your engineer|your engineering team|your manager)\s+approves?(?:\s+(?:it|the drawing(?: revision)?|the revision|the report))?$/i.exec(line);
 if(match)return /\b(?:engineer|engineering)\b/i.test(match[1])?'engineering':/\bmanager\b/i.test(match[1])?'manager':'buyer';
 // “Only if X and I have your approval” keeps possession hypothetical.
 // This function is used only inside an attached closed release predicate;
 // a standalone “I have approval” remains an unsupported factual assertion.
 const possession=/^(?:I|we)\s+have\s+(.+)$/i.exec(line);
 return possession?approvalNoun(possession[1]):undefined;
}
function approvalNoun(text:string):DocumentApproval|undefined {
 const match=/^your(?:\s+(engineer|engineering team|manager)['’]s)?\s+(?:approval|sign[- ]?off)$/i.exec(text.trim());
 return match?match[1]?/manager/i.test(match[1])?'manager':'engineering':'buyer':undefined;
}
function closedDelivery(text:string,context?:Context,boundReport?:string):ParsedDocumentDelivery|undefined {
 const action=new RegExp('^'+deliveryActor+deliveryAction,'i').exec(text);if(!action)return;
 const artifact=text.slice(action[0].length),explicit=documents(artifact);
 // Use the canonical document spans for the noun, then validate every word
 // around it. Recognizing a report type neither proves its availability nor
 // establishes its coverage; those retain their independent evidence checks.
 if(explicit.length){
  const report=explicit[0];
  if(explicit.length!==1||! /report$/.test(report.kind)||! /^(?:(?:that|the)\s+)?$/i.test(artifact.slice(0,report.start))||!new RegExp('^'+deliveryTail+'[.!]?$','i').test(artifact.slice(report.end)))return;
 }else if(!new RegExp('^(?:it|the documents|the details)'+deliveryTail+'[.!]?$','i').test(artifact))return;
 const prior=currentCallReportInquiry(context),report=explicit.length===1?explicit[0].kind:explicit.length===0?boundReport||prior&&documents(prior).find(document=>/report$/.test(document.kind))?.kind:undefined;
 return report?{investigation:'',document:report,deliveryCondition:'sequence_only'}:undefined;
}
function actualReportSendRequested(kind:string,context?:Context):boolean {
 const turns=(context?.turns||[]).filter(turn=>turn.role==='buyer'||turn.role==='customer');
 let requested=false,named:string|undefined;
 for(const turn of turns)for(const clause of materialClauses(turn.text)){
  const line=clause.replace(/[’‘]/g,"'").trim(),reports=documents(line).filter(document=>/report$/.test(document.kind));
  const specific=[...new Set(reports.filter(report=>report.kind!=='report').map(report=>report.kind))];if(specific.length)named=specific.length===1?specific[0]:undefined;
  const binds=reports.some(report=>{const target=report.kind==='report'&&named?named:report.kind;return sameDocument(target,kind)||sameDocument(kind,target);});
  const withdraw=/\b(?:cancel|forget|withdraw)\b[^.!?]{0,35}\b(?:report|request)\b|\b(?:don't|do not)\s+(?:want|need)\b[^.!?]{0,35}\breport\b|\bno need for\b[^.!?]{0,35}\breport\b/i.test(line);
  const noSend=/^(?:actually[, ]+)?(?:please\s+)?(?:do not|don't|never)\s+(?:send|email|share)\s+(?:anything|it|(?:(?:the|that|any|a)\s+)?(?:(?:material test|inspection|quality|test)\s+)?reports?)(?:\s+please)?[.!]?\s*$/i.test(line);
  if(withdraw&&binds||noSend){requested=false;continue;}
  if(!binds)continue;
  // Shared report-specific conditional grammar excludes buyer-owned offers.
  // Inspect one complete clause so a profile request cannot grant a report.
  const conditional=reportDeliveryCondition(line);
  const simple=/^(?:(?:can|could|would|will) you\s+)?(?:(?:please|just|also)\s+)*(?:send|email|share|forward|include|attach)\s+(?:(?:me|us)\s+)?(?:(?:the|that|your)\s+)?(?:(?:material test|inspection|quality|test)\s+)?report(?:\s+(?:over|for review|to me|to us))?[.!?]?$/i.test(line);
  if(conditional||simple)requested=true;
 }
 return requested;
}
/** A nominal “match” may bind only to ONE explicit, bounded report inquiry
 * and ONE complete known reference in that same group, never a catalog fit,
 * a second report or an approval/check-completion result. */
function explicitReportInquiry(text:string,context?:Context):{document:string;reference:string}|undefined {
 const inquiry=text.trim().replace(/[.!;]$/,'').replace(/,?\s+first$/i,'');
 if(!isBoundedEpistemicFactAction(inquiry,context))return;
 const predicate=/\b(?:whether|if)\s+/i.exec(inquiry);
 const referents=documents(inquiry);if(!predicate||referents.length!==1||! /report$/.test(referents[0].kind))return;
 const report=referents[0],before=inquiry.slice(predicate.index+predicate[0].length,report.start);
 if(report.start<predicate.index+predicate[0].length||! /^(?:(?:the|that|this|our|your)\s+)?$/i.test(before))return;
 const relation=/^\s+(?:covers?|matches?|includes?|appl(?:y|ies)\s+to)\s+(.+)$/i.exec(inquiry.slice(report.end));if(!relation)return;
 const object=relation[1].trim();
 if(![...buyerConversationIdentifierReferences(object,context?.turns||[]),...productIdentityReferences(object,context?.sources||[])].some(reference=>reference.start===0&&reference.end===object.length))return;
 return {document:referents[0].kind,reference:norm(canonicalizeKnownProductIdentifiers(object,context?.sources||[]))};
}
type ReportInquiry=NonNullable<ReturnType<typeof explicitReportInquiry>>;
/** Keep release prerequisites attached to ONE outgoing artifact, rather than
 * infer them independently from words elsewhere in the reply. A nominal
 * result needs the adjacent explicit inquiry; an explicit repeated report
 * predicate carries its own identity even if other reports were discussed. */
function closedReportRelease(text:string,context?:Context,inquiry?:ReportInquiry):{document:string;approvals:DocumentApproval[]}|undefined {
 const conditions=text.trim().split(/\s+and\s+/i),approvals:DocumentApproval[]=[];
 let coverage:ReportInquiry|undefined;
 for(const condition of conditions){
  const approval=approvalPredicate(condition);if(approval){approvals.push(approval);continue;}
  if(coverage)return;
  if(/^(?:I|we)\s+have\s+(?:(?:a|the|that)\s+)?(?:positive\s+)?(?:report\s+)?match$/i.test(condition)){
   if(!inquiry)return;coverage=inquiry;continue;
  }
  const checked=/^(?:(?:I|we)(?:'ve| have)?\s+)?(?:check(?:ed)?|verif(?:y|ied)|confirm(?:ed)?)\s+(?:(whether|if|that)\s+)?(.+)$/i.exec(condition);
  // Completing an unresolved WHETHER inquiry never supplies a positive match.
  if(checked&&/^(?:whether|if)$/i.test(checked[1]||''))return;
  let predicate=checked?checked[2]:condition;
  if(/^(?:it|(?:the|that) report)\s+(?:does|matches?)$/i.test(predicate)){
   if(!inquiry)return;coverage=inquiry;continue;
  }
  if(/^it\s+/i.test(predicate)&&inquiry)predicate=predicate.replace(/^it\b/i,'the '+inquiry.document);
  const explicit=explicitReportInquiry('I will check whether '+predicate,context);
  if(!explicit||inquiry&&(!sameDocument(explicit.document,inquiry.document)||explicit.reference!==inquiry.reference))return;
  coverage=explicit;
 }
 return coverage?{document:coverage.document,approvals:[...new Set(approvals)]}:undefined;
}
function attachedReportRelease(text:string,context?:Context):ParsedDocumentDelivery|undefined {
 const gate='(?:once|after|when|'+positiveReportConditionConnector+')';
 // The prefix is exactly one bounded inquiry. A sentence boundary, semicolon,
 // or conjunction changes punctuation, not its report/result association.
 const fronted=new RegExp('^(?:(.+?)(?:[.!;:]\\s+|\\s*[—–]\\s+|\\s*,?\\s+and\\s+))?'+gate+'\\s+([^,;.!?]+),\\s*(.+)$','i').exec(text);
 if(fronted){
  const inquiry=fronted[1]?explicitReportInquiry(fronted[1],context):undefined;
  if(fronted[1]&&!inquiry)return;
  const release=closedReportRelease(fronted[2],context,inquiry),delivery=release&&closedDelivery(fronted[3],context,release.document);
  if(delivery&&release&&sameDocument(delivery.document,release.document))return {...delivery,document:release.document,investigation:fronted[1]||'',deliveryCondition:'stated_condition',conditionText:fronted[2],approvals:release.approvals};
 }
 // The same predicate may follow its action. It still constrains only that
 // closed action, never a later send or a factual sentence beside it.
 const postposed=new RegExp('^(.+?)\\s+(?:only\\s+)?'+positiveReportConditionConnector+'\\s+([^.!?;]+)$','i').exec(text);
 if(postposed){
  const release=closedReportRelease(postposed[2],context),delivery=release&&closedDelivery(postposed[1],context,release.document);
  if(delivery&&release&&sameDocument(delivery.document,release.document))return {...delivery,document:release.document,deliveryCondition:'stated_condition',conditionText:postposed[2],approvals:release.approvals};
 }
}
function parseInvestigationThenDocumentDelivery(text:string,context?:Context):ParsedDocumentDelivery|undefined {
 const line=text.trim().replace(/[’‘]/g,"'").replace(/[.!]$/,'');
 const courtesy=afterVerifiedCourtesy(line,context);if(courtesy)return parseInvestigationThenDocumentDelivery(courtesy,context);
 const requestedSuffix=/\s+as(?: you)? (?:requested|asked|agreed)$/i.exec(line);
 if(requestedSuffix){const report=documents(line).find(document=>/report$/.test(document.kind))?.kind||currentCallReportInquiry(context)&&documents(currentCallReportInquiry(context)!).find(document=>/report$/.test(document.kind))?.kind;if(!report||!actualReportSendRequested(report,context))return;return parseInvestigationThenDocumentDelivery(line.slice(0,requestedSuffix.index),context);}
 const attached=attachedReportRelease(line,context);if(attached)return attached;
 const withApproval=(parsed:ParsedDocumentDelivery|undefined,approval:DocumentApproval,condition:string)=>parsed?{...parsed,conditionText:[parsed.conditionText,condition].filter(Boolean).join(' AND '),approvals:[...new Set([...(parsed.approvals||[]),approval])]}:undefined;
 // The conjunction belongs to the SAME release predicate, not a new rep
 // action. Parse the entire remaining delivery normally before adding it.
 const and=[...line.matchAll(/\s+and\s+/gi)].at(-1);
 if(and){const approval=approvalPredicate(line.slice(and.index!+and[0].length));if(approval){const before=line.slice(0,and.index);const parsed=parseInvestigationThenDocumentDelivery(before,context);if(parsed?.deliveryCondition==='stated_condition')return withApproval(parsed,approval,line.slice(and.index!+and[0].length));}}
 const fronted=/^(?:once|after|when|if|provided that|as long as)\s+([^,;.!?]+),\s*(.+)$/i.exec(line);
 if(fronted){const approval=approvalPredicate(fronted[1]);if(approval){const parsed=parseInvestigationThenDocumentDelivery(fronted[2],context)||closedDelivery(fronted[2],context);if(parsed)return withApproval(parsed,approval,fronted[1]);}}
 // Postposed approval-only gates and noun prerequisites still constrain the
 // one closed action; they do not create a positive report-coverage result.
 const postposed=/^(.+?)\s+(?:only\s+)?(?:once|after|when|if|provided that|as long as)\s+([^,;.!?]+)$/i.exec(line);
 if(postposed){const approval=approvalPredicate(postposed[2]);if(approval){const parsed=parseInvestigationThenDocumentDelivery(postposed[1],context)||closedDelivery(postposed[1],context);if(parsed)return withApproval(parsed,approval,postposed[2]);}}
 const withNoun=/^(.+?)\s+(?:and\s+)?with\s+([^,;.!?]+)$/i.exec(line);
 if(withNoun){const approval=approvalNoun(withNoun[2]);if(approval){const parsed=parseInvestigationThenDocumentDelivery(withNoun[1],context)||closedDelivery(withNoun[1],context);if(parsed)return withApproval(parsed,approval,withNoun[2]);}}
 return parseDocumentDeliveryCore(text,context);
}
function parseDocumentDeliveryCore(text:string,context?:Context):ParsedDocumentDelivery|undefined {
 // Preserve a whole fronted condition when the clause extractor ends it at
 // a semicolon. Never strip an internal separator or its adjoining claims.
 let line=text.trim().replace(/[’‘]/g,"'").replace(/;$/,'.');
 const reviewPrerequisite=afterDrawingReview(line,context);
 if(reviewPrerequisite)return parseInvestigationThenDocumentDelivery(reviewPrerequisite,context);
 if(/\s+as(?: you)? (?:requested|asked)[.!]?$/i.test(line)){
  const requested=[context?.buyerText||'',...(context?.turns||[]).filter(turn=>turn.role==='buyer'||turn.role==='customer').map(turn=>turn.text)].some(turn=>/\breport\b/i.test(turn)&&/\b(?:send|email|share|forward|reply|respond|include|attach)\b/i.test(turn));
  if(!requested)return;line=line.replace(/\s+as(?: you)? (?:requested|asked)(?=[.!]?$)/i,'');
 }
 const actor=deliveryActor;
 // A reply coordinated with sending the same artifact is one conditional
 // handoff, not a second unconditioned send. Extra subjects, claims or verbs
 // cannot fit this closed grammar and keep their independent checks.
 const action=deliveryAction;
 const artifact=deliveryArtifact;
 // Direction, recipient and purpose can compose ("send it over to you for
 // review"). Keep each complement closed: added claims or release conditions
 // must still be interpreted independently by the ordinary checks below.
 const tail=deliveryTail;
 const delivery=action+artifact+tail;
 // The object may be the buyer's actual code or a natural reference phrase.
 // Parse its complete predicate below rather than whitelisting object words.
 const positiveConnector=positiveReportConditionConnector;
 const positiveCondition='(?:only\\s+)?'+positiveConnector+'\\s+(?:it|that report|the report)\\s+(?:does|matches?(?:\\s+[^,;.!?]+)?|(?:covers?|includes?|appl(?:y|ies)\\s+to)\\s+[^,;.!?]+)';
 // A coordinated bounded comparison may make its outgoing action conditional
 // on the same item's inclusion. Bind “its scope” only to that one report;
 // the complete closed predicate must remain positive and result-conditional.
 const scopedContinuation=new RegExp('^(.+?)(?:\\s*,?\\s+and\\s+|[.!]\\s+)(?:'+actor+')?'+delivery+'\\s+((?:only\\s+)?'+positiveConnector+'\\s+(.+?))[.!]?$','i').exec(line);
 if(scopedContinuation&&isBoundedEpistemicFactAction(scopedContinuation[1],context)){
  const report=documents(scopedContinuation[1]);
  if(report.length===1&&/report$/.test(report[0].kind)&&closedReportScopePredicate(scopedContinuation[3],report[0].kind))return {investigation:scopedContinuation[1],document:report[0].kind,deliveryCondition:'stated_condition',conditionText:scopedContinuation[2]};
 }
 // A direct conditional send asserts neither present coverage nor a check's
 // result. Resolve "it matches" only against the actual same-call inquiry;
 // never invent a report reference from a company's catalogue or memory.
 const direct=new RegExp('^'+actor+delivery+'\\s+('+positiveCondition+')[.!]?$','i').exec(line);
 if(direct){
  const explicit=documents(line).filter(document=>/report$/.test(document.kind)),prior=currentCallReportInquiry(context),document=explicit[0]||prior&&documents(prior).find(item=>/report$/.test(item.kind));
  if(document&&explicit.length<=1){
   const predicate=direct[1].replace(new RegExp('^(?:only\\s+)?'+positiveConnector+'\\s+','i'),'').replace(/^(?:it|that report|the report)\b/i,'the '+document.kind);
   if(/\b(?:does|matches?)$/i.test(predicate)?!!prior:isBoundedEpistemicFactAction('I will check whether '+predicate,context))return {investigation:'',document:document.kind,deliveryCondition:'stated_condition',conditionText:direct[1]};
  }
 }
 // A fronted check and a result condition on sending are independent
 // prerequisites. Completing a WHETHER check alone is not a positive match;
 // an explicit “send it IF it does” still supplies that positive condition.
 const fronted=new RegExp('^(?:once|after|when|'+positiveConnector+')\\s+(.+?),\\s*'+actor+delivery+'(?:\\s+('+positiveCondition+'))?[.!]?$','i').exec(line);
 if(fronted){
  let condition=fronted[1].trim();
  condition=condition.replace(/^(?:I|we)(?:'ve| have)?\s+(?:review(?:ed)?|seen|check(?:ed)?)\s+(?:that|the|your)\s+drawing\s+and\s+/i,'');
  const inquiry=/^(?:(?:I|we)(?:'ve| have)?\s+)?(?:check(?:ed)?|verif(?:y|ied)|confirm(?:ed)?)\s+(?:(whether|if|that)\s+)?(.+)$/i.exec(condition);
  let predicate=inquiry?inquiry[2]:condition;
  // A singular “it” can carry the one report in this same-call inquiry.
  // Resolve only its complete positive predicate; availability, added factual
  // clauses and the buyer's release restrictions are still checked normally.
  if(/^it\s+/i.test(predicate)&&!documents(predicate).length){
   const prior=currentCallReportInquiry(context),reports=prior&&documents(prior).filter(document=>/report$/.test(document.kind));
   if(reports&&reports.length===1)predicate=predicate.replace(/^it\b/i,'the '+reports[0].kind);
  }
  const referents=documents(predicate);
  const positive=!!closedReportScopePredicate(predicate)||/^(?:(?:the|that|this|our|your)\s+)?(?:(?:material test|inspection|test)\s+)?report\s+(?:covers?|matches?|includes?|appl(?:y|ies)\s+to)\s+[^,;.!?]+$/i.test(predicate)
   ||/^(?:(?:the|that|this)\s+)?(?:(?:material test|inspection|test)\s+)?report\s+coverage\s+(?:for|of)\s+[^,;.!?]+$/i.test(predicate);
  const inquiryPredicate=predicate.replace(/^((?:(?:the|that|this)\s+)?(?:(?:material test|inspection|test)\s+)?report)\s+coverage\s+(?:for|of)\s+/i,'$1 covers ');
  if(positive&&referents.length===1&&!/\b(?:and|but|however|not|never|no|certif\w*|guarantee\w*|discount|approval|price|ship\w*|deliver\w*)\b/i.test(predicate)&&isBoundedEpistemicFactAction('I will check whether '+inquiryPredicate,context)){
   if(fronted[2]){
    const result=fronted[2].replace(new RegExp('^(?:only\\s+)?'+positiveConnector+'\\s+','i'),'').replace(/^(?:it|that report|the report)\b/i,'the '+referents[0].kind);
    if(!/\bdoes$/i.test(result)&&!isBoundedEpistemicFactAction('I will check whether '+result,context))return;
   }
   return {investigation:'I will check whether '+inquiryPredicate,document:referents[0].kind,deliveryCondition:fronted[2]?'stated_condition':inquiry&&/^(?:if|whether)$/i.test(inquiry[1]||'')?'check_completion':'stated_condition',conditionText:fronted[2]||fronted[1]};
  }
 }
 // A repeated subject is optional in a coordinated action (“I'll check ...
 // and then send it”). Sequence does NOT mean “only if it covers the product”.
 const continuation=new RegExp('\\s*,?\\s+(?:and\\s+)?then\\s+(?:'+actor+')?'+delivery+'[.!]?$','i').exec(line)
  ||new RegExp('\\s*,?\\s+and\\s+((?:once|after|when)\\s+(?:I|we)(?:\x27ve| have)\\s+got\\s+(?:that|it))\\s*,\\s*'+actor+delivery+'[.!]?$','i').exec(line)
  ||new RegExp('(?:\\s*,?\\s+and\\s+|[.!;]\\s+)(?:then\\s+)?(?:'+actor+')?'+delivery+'\\s+('+positiveCondition+')[.!]?$','i').exec(line)
  ||new RegExp('(?:\\s*,?\\s+and\\s+|[.!;]\\s+)(?:then\\s+)?('+positiveCondition+')\\s*,?\\s+'+actor+delivery+'[.!]?$','i').exec(line)
  ||new RegExp('[.!]\\s+((?:once|after|when)\\s+(?:that|it|the (?:scope|coverage|answer))(?:(?:\x27s|\\s+is|\\s+has been)\\s+(?:checked|verified|confirmed)))\\s*,\\s*'+actor+delivery+'[.!]?$','i').exec(line);
 if(!continuation)return;
 const investigation=line.slice(0,continuation.index).trim();
 if(!isBoundedEpistemicFactAction(investigation,context))return;
 let referents=documents(investigation),inferredFromConfirmedReference=false;
 if(!referents.length&&buyerConversationIdentifierReferences(investigation,context?.turns||[]).length){const prior=currentCallReportInquiry(context);if(prior){referents=documents(prior);inferredFromConfirmedReference=true;}}
 if(referents.length!==1||! /report$/.test(referents[0].kind))return;
 // Bare “matches” can only refer back to this explicit report-scope inquiry,
 // not an unresolved price/approval/availability predicate or earlier call.
 if(continuation[1]&&new RegExp('^(?:only\\s+)?'+positiveConnector+'\\b','i').test(continuation[1])){
  const predicate=continuation[1].replace(new RegExp('^(?:only\\s+)?'+positiveConnector+'\\s+','i'),'').replace(/^(?:it|that report|the report)\b/i,'the '+referents[0].kind);
  if(/\b(?:does|matches?)$/i.test(predicate)){
   if(!requestsDocumentProductCoverage(purposeReportInquiry(investigation)||investigation)&&!inferredFromConfirmedReference)return;
  }else if(!isBoundedEpistemicFactAction('I will check whether '+predicate,context))return;
 }
 const deliveryCondition=continuation[1]?/^(?:once|after|when)\b/i.test(continuation[1])?'check_completion':'stated_condition':'sequence_only';
 return {investigation,document:referents[0].kind,deliveryCondition,...(continuation[1]?{conditionText:continuation[1]}:{})};
}

type DocumentWithholding={approval?:DocumentApproval;positiveCoverage:boolean};
/** A closed refusal to send is a restriction, never an outgoing promise or a
 * claim that its release conditions already hold. Inspect every conjunct so
 * an attached shipment/coverage assertion cannot inherit that status. */
function documentWithholding(text:string,context?:Context):DocumentWithholding|undefined{
 const line=text.trim().replace(/[’‘]/g,"'").replace(/[.!]$/,'');
 const courtesy=afterVerifiedCourtesy(line,context);if(courtesy)return documentWithholding(courtesy,context);
 const preface=/^([^;:.!?]+?)[,;:.!?]\s+(.+)$/.exec(line);
 if(preface&&investigationAcknowledgment(preface[1]+'.',context))return documentWithholding(preface[2],context);
 const artifact='(?:anything|it|(?:the|that) (?:(?:material test|inspection|test) )?report)';
 const negative=new RegExp('^(?:I|we)(?: won\x27t| will not| do not| don\x27t) (?:send|email|share|forward) '+artifact+' (?:until|unless) (.+)$','i').exec(line);
 const wait=new RegExp('^(?:I|we)(?:\x27ll| will| can) (?:wait|hold) for (.+) before (?:sending|emailing|sharing) '+artifact+'$','i').exec(line);
 const condition=negative?.[1]||wait?.[1];if(!condition)return;
 let approval:DocumentWithholding['approval'],positiveCoverage=false;
 for(const part of condition.split(/\s+and\s+/i)){
  const owner=/^(?:your\s+(engineer|engineering|manager)(?:'s)?\s+(?:approval|sign[- ]?off)|your\s+(engineer|engineering|manager)\s+approves?(?:\s+(?:it|the drawing|the report|the revision))?|you\s+approve(?:\s+(?:it|the drawing|the report))?|your\s+(?:approval|sign[- ]?off))$/i.exec(part);
  if(owner){const role=owner[1]||owner[2];approval=role?/manager/i.test(role)?'manager':'engineering':'buyer';continue;}
  const reports=currentCallReportInquiry(context),document=reports&&documents(reports).find(item=>/report$/.test(item.kind));
  const resolved=part.replace(/^it\b/i,document?'the '+document.kind:'it');
  if(document&&/^(?:it|(?:the|that) (?:(?:material test|inspection|test) )?report)\s+(?:matches?|covers?|does)\b/i.test(part)&&(/\b(?:matches?|does)$/i.test(part)||isBoundedEpistemicFactAction('I will check whether '+resolved,context))){positiveCoverage=true;continue;}
  return;
 }
 return {approval,positiveCoverage};
}
export type DocumentActionMeaning={
 text:string;
 coverage:'none'|'future_inquiry'|'positive_result_condition'|'assertion_or_unparsed';
 /** Closed action proof only. It never proves availability, scope or authority. */
 locallyNonAssertive:boolean;
 checksCoverage:boolean;
 /** An explicit alternative/bypass cannot satisfy a required positive match. */
 weakensPositiveMatch:boolean;
 withholding?:DocumentWithholding;
 delivery?:ParsedDocumentDelivery;
 outgoing:{start:number;end:number;text:string;condition:'coverage_positive'|'check_complete'|'sequence_only'|'alternative'|'unparsed';approvals:DocumentApproval[]}[];
 references:{text:string;start:number;end:number;basis:'confirmed_buyer'|'heard_buyer'|'source_known_identifier'|'unknown'}[];
};
/** One interpretation consumed by factual, condition, relevance and identity
 * checks. No consumer may turn completing a check into a positive result, or
 * reclassify a parsed future result-condition as an already true coverage fact.
 * The proof covers the ENTIRE supplied group. Mixed or unparsed assertions
 * retain all normal factual checks; no keyword grants a whole-reply exemption. */
export function analyzeDocumentActionMeaning(text:string,context?:Context):DocumentActionMeaning{
 const inquiry=isBoundedEpistemicFactAction(text,context),parsed=parseInvestigationThenDocumentDelivery(text,context),withholding=documentWithholding(text,context);
 // Uncertainty may ask about alternatives. A RELEASE condition is different:
 // “if it matches OR you approve” permits sending without a match. Keep that
 // distinction in the shared action record, not separate caller exceptions.
 const delivery:ParsedDocumentDelivery|undefined=parsed?.deliveryCondition==='stated_condition'&&/\bor\b/i.test(parsed.conditionText||'')?{...parsed,deliveryCondition:'alternative_condition'}:parsed;
 const actions=affirmativeOutgoingDocumentActions(text);
 const weakensPositiveMatch=delivery?.deliveryCondition==='alternative_condition'||actions.some(action=>/\b(?:regardless|anyway)\b|\bwhether\b[^.!?;]*\bor not\b|\beven if\b[^.!?;]*\b(?:not|no match)\b/i.test(text.slice(action.end).split(/[.!?;]/,1)[0]));
 const locallyNonAssertive=inquiry||!!delivery||!!withholding;
 const confirmed=buyerConversationIdentifierReferences(text,context?.turns||[]),heard=buyerProductIdentifierReferences(text,latestBuyer(context||{})),known=productIdentityReferences(text,context?.sources||[]);
 const references=[...buyerProductIdentifierReferences(text,text),...known].filter((reference,index,all)=>all.findIndex(other=>other.start===reference.start&&other.end===reference.end)===index).map(reference=>({text:reference.text,start:reference.start,end:reference.end,basis:(confirmed.some(other=>other.start===reference.start&&other.end===reference.end)?'confirmed_buyer':heard.some(other=>other.start===reference.start&&other.end===reference.end)?'heard_buyer':known.some(other=>other.start===reference.start&&other.end===reference.end)?'source_known_identifier':'unknown') as DocumentActionMeaning['references'][number]['basis']}));
 const checksCoverage=!!delivery||inquiry&&(documents(text).some(document=>/report$/.test(document.kind))&&/\b(?:cover\w*|scope|matches?|appl(?:y|ies|icable)|relates?|pertains?)\b/i.test(text)||!!currentCallReportInquiry(context)&&references.some(reference=>reference.basis==='confirmed_buyer'));
 return {text,coverage:delivery?.deliveryCondition==='stated_condition'?'positive_result_condition':inquiry&&checksCoverage?'future_inquiry':documents(text).length&&relationWords(text)?'assertion_or_unparsed':'none',locallyNonAssertive,checksCoverage,weakensPositiveMatch,withholding,delivery,outgoing:actions.map(action=>({...action,condition:delivery?.deliveryCondition==='stated_condition'?'coverage_positive':delivery?.deliveryCondition==='alternative_condition'?'alternative':delivery?.deliveryCondition==='check_completion'?'check_complete':delivery?'sequence_only':'unparsed',approvals:delivery?.approvals||[]})),references};
}
/** Compatibility facade. All consumers get the same parsed action meaning. */
export function investigationThenDocumentDelivery(text:string,context?:Context):ParsedDocumentDelivery|undefined{return analyzeDocumentActionMeaning(text,context).delivery;}

/** Preserve adjacent inquiry→release/action meaning for every consumer. Merge
 * only when the ENTIRE resulting group has a closed nonassertive proof; an
 * unrelated assertion, ambiguous artifact or second send stays independent.
 * Offsets and literal whitespace remain available for claim diagnostics. */
export function documentActionGroups(text:string,context?:Context):{text:string;start:number;end:number}[]{
 const sentences:{text:string;start:number;end:number}[]=[];let start=0;
 for(let index=0;index<text.length;index++){
  if(!/[.!?;]/.test(text[index])||(text[index]==='.'&&!/\s|^$/.test(text[index+1]||'')))continue;
  if(text[index]==='.'&&/\d/.test(text[index-1]||'')&&/\d/.test(text[index+1]||''))continue;
  sentences.push({text:text.slice(start,index+1),start,end:index+1});start=index+1;
 }
 if(start<text.length)sentences.push({text:text.slice(start),start,end:text.length});
 const grouped:{text:string;start:number;end:number}[]=[];
 for(const sentence of sentences.filter(part=>part.text.trim())){
  const previous=grouped.at(-1),together=previous?text.slice(previous.start,sentence.end):'';
  if(previous&&analyzeDocumentActionMeaning(together,context).locallyNonAssertive)grouped[grouped.length-1]={text:together,start:previous.start,end:sentence.end};
  else grouped.push(sentence);
 }
 return grouped;
}

/** Negation of report coverage differs from a limitation on what the report
 * proves. “It records the tested sample, but does not certify suitability”
 * does not negate the report→product relationship asserted earlier. */
function coverageNegated(text:string,document?:ReturnType<typeof documents>[number],scope?:Scope):boolean {
 const product=scope&&productPosition(text,scope);
 if(document&&product){
  if(product.start<document.end)return negative.test(text.slice(0,Math.max(document.end,product.end)));
  // In “does not certify suitability, but it covers PX20”, only the latter
  // predicate establishes scope. Negation in an earlier coordinated predicate
  // remains part of the content claim, never a negation of this relationship.
  const scopePrefix=text.slice(document.end,product.start);
  // A coordinator resets polarity only when it starts a new explicit scope
  // predicate. In “does not cover PX10 and PX20” the negative verb governs
  // both product nouns; a comma/nor/list item cannot erase that negation.
  const newPredicate=/(?:[,;]\s*(?:(?:but|however|and)\s+)?|\b(?:but|however|and)\s+)(?=(?:(?:it|this|that)\s+)?(?:(?:does|do|is|are|doesn't|don't|isn't|aren't)\s+)?(?:(?:not|never)\s+)?(?:(?:explicitly|specifically)\s+)?(?:covers?|appl(?:y|ies|icable)|pertains?|relates?|corresponds?|includes?|contains?|for)\b)/gi;
  const boundary=[...scopePrefix.matchAll(newPredicate)].at(-1);
  const predicate=boundary?scopePrefix.slice((boundary.index||0)+boundary[0].length):scopePrefix;
  return negative.test(predicate)||/\bno\s*$/i.test(text.slice(0,document.start));
 }
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
     const remainder=position?raw.slice(position.end).replace(/[.!;]$/,'').trim():'';
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
export function assessDocumentProductCoverage(clause:string,context:Context,sources:DocumentProductSource[]):{supported:false;pending?:true;candidateSourceIds?:string[];reason:string;verificationBoundary?:'document_product_scope';wholeStatement?:true}|undefined {
 sources=sources.map(source=>({...source,text:canonicalizeKnownProductIdentifiers(source.text,sources)}));
 context={...context,buyerText:canonicalizeKnownProductIdentifiers(latestBuyer(context),sources)};
 const buyer=latestBuyer(context),asked=requestsDocumentProductCoverage(buyer),priorInquiry=currentCallReportInquiry(context);
 let line=canonicalizeKnownProductIdentifiers(clause,sources).trim().replace(/[’‘]/g,"'");
 const priorReport=priorInquiry&&documents(priorInquiry).filter(document=>/report$/.test(document.kind)),implicitScope=!documents(line).length&&closedReportScopePredicate(line,priorReport&&priorReport.length===1?priorReport[0].kind:'report');
 if(implicitScope)line=line.replace(/\bits scope\b/i,'the scope of the '+implicitScope.document);
 // Explicit uncertainty is a commitment to investigate, never a positive or
 // negative assertion about report scope. Appended assertions are assessed in
 // their own clause by the normal verification policy.
 if(analyzeDocumentActionMeaning(line,context).locallyNonAssertive||isBuyerIdentifierClarification(line,buyer))return;
 if(/^(?:does|do|is|are|can|could|would|will|which|what|how|whether)\b/i.test(line)&&/\?\s*$/.test(line)&&! /\b(?:our|the)\s+[a-z]+\d+[^?]{0,30}\b(?:reports?|sheets?|certificates?)\b/i.test(line))return;
 const ownDocuments=documents(line),buyerDocuments=documents(buyer);
 const assent=asked&&/^\s*(?:yes|correct|exactly|absolutely|certainly|sure|it does|that does|we do)\b/i.test(line);
 // “I'll confirm it covers ...” asserts a positive answer, unlike the
 // bounded “confirm whether ...” action handled above. The current question
 // supplies its document referent, never the missing coverage relationship.
 const documentPronoun=(asked||!!priorInquiry)&&!ownDocuments.length&&/^\s*(?:(?:I|we)(?:'ll|\s+(?:will|can|would))\s+(?:confirm|verify)\s+(?:that\s+)?)?(?:it|this|that)\b/i.test(line)&&(relationWords(line)||/^\s*(?:it|this|that)\s+(?:documents?|records?|details?|describes?|reports?)\b/i.test(line));
 const explicitRelation=!!ownDocuments.length&&(relationWords(line)||/\b(?:report|sheet|certificate)\b.{0,65}\b(?:for|of)\s+(?:(?:our|your|that|this|the|exact)\s+)*(?:product|grade|mesh|material)\b/i.test(line));
 const qualified=ownDocuments.some(document=>scopes(line).some(scope=>linked(line,document,scope)));
 // Follow a document subject with a product-specific predicate even when its
 // verb is a new paraphrase ("the report concerns PX20"). This is deliberately
 // structural, not a list of previously rejected sentences. A buyer/engineer
 // comparison action is not itself a document subject or coverage assertion.
 const subjectDocument=ownDocuments.find(document=>/^\s*(?:(?:yes|correct|exactly)[,.!]\s*)?(?:(?:our|the|this|that|a|an|both)\s+)*$/i.test(line.slice(0,document.start)));
 const documentSubject=!!scopes(line).length&&!!subjectDocument;
 // A document remains the subject of its own relative predicate even when
 // offered in a send: “send the report, which discusses [reference]” asserts
 // product-specific contents. Availability alone cannot prove that tail.
 const relativeDocument=!!scopes(line).length&&ownDocuments.some(document=>/^\s*,?\s+(?:which|that)\s+\S/i.test(line.slice(document.end)));
 const leadingScope=!!ownDocuments.length&&/^\s*for\s+[^,;.!?]+,\s*/i.test(line)&&scopes(line.slice(0,line.indexOf(','))).length>0;
 if(!assent&&!documentPronoun&&!explicitRelation&&!qualified&&!documentSubject&&!relativeDocument&&!leadingScope)return;
 const claimedDocuments=ownDocuments.length?ownDocuments:assent||documentPronoun?buyerDocuments.length?buyerDocuments:priorInquiry?documents(priorInquiry):[]:[];
 const explicitScopes=scopes(line),buyerScopes=scopes(buyer);
 const claimedScopes=explicitScopes.length?explicitScopes:implicitScope&&priorInquiry?scopes(priorInquiry):asked||/\b(?:that|this|the exact|your)\s+(?:product|grade|mesh|material)\b/i.test(line)?buyerScopes:[];
 if(!claimedDocuments.length)return;
 // "for your engineer/review" is a recipient/action, not product coverage.
 if(!claimedScopes.length&&!assent&&!relationWords(line))return;
 // Bind a qualifier to its own document. In "the test report and PX20 spec
 // sheet", PX20 qualifies the sheet, never the neighbouring report. Unknown
 // predicates with one document still assert a relationship and need evidence.
 const pairs=claimedDocuments.flatMap(document=>{
  const local=explicitScopes.filter(scope=>linked(line,document,scope));
  const inferred=(assent||documentPronoun)&&!ownDocuments.length||!explicitScopes.length&&(assent||explicitRelation)||document===subjectDocument||ownDocuments.length===1&&(explicitRelation||relativeDocument)||leadingScope;
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
  if(!relativeDocument&&bareDocumentAction(line))return;
  return {supported:false,pending:true,...(relativeDocument?{wholeStatement:true as const}:{}),candidateSourceIds:[...new Set(matching.flatMap(matches=>matches.map(source=>source.id)))],reason:'Original evidence links this specific document type to this product; normal verification must still establish the claimed scope, conditions and contents.'};
 }
 return {supported:false,verificationBoundary:'document_product_scope',reason:'This document-to-product coverage is not established by original Company Knowledge. Document availability and separate product specifications do not link that specific report to that specific product. Confirm the coverage gap without asserting it, including in a paraphrase.'};
}

/** Prove one closed, literal coverage predicate. This deliberately does not
 * prove a report's contents, certification, sample population or suitability.
 * Those remain semantic questions even when the document/product link exists.
 * A complete original source travels with the result through its source ID. */
export function literalDocumentScopeEvidence(clause:string,context:Context,sources:DocumentProductSource[]):{sourceId:string;reason:string;quote:string;evidence?:{sourceId:string;quote:string;reason:string}[]}|undefined {
 const originals=sources.filter(source=>source.original!==false&&source.complete!==false&&!stale.test((source.title||'')+' '+source.text));
 const normalized=canonicalizeKnownProductIdentifiers(clause,originals).trim().replace(/[’‘]/g,"'").replace(/[.!;]$/,'');
 const line=normalized.replace(/^(?:yes|correct)[,\s]+/i,'');
 const inverse=closedReportScopePredicate(line);
 // Canonicalize only this closed equivalent candidate. Original source text
 // remains untouched, and the ordinary exact document/product proof below
 // still supplies the source ID and quote or leaves semantic checking pending.
 if(inverse)return literalDocumentScopeEvidence(`The ${inverse.document} covers ${inverse.item}.`,context,sources);
 const doc=documents(line);if(doc.length!==1)return;
 const document=doc[0],before=line.slice(0,document.start),after=line.slice(document.end);
 if(/\b(?:reports|sheets|certificates|certifications)\b/i.test(document.text))return;
 const possession=/^\s*(?:we|our company)\s+(?:have|has)\s+(?:(?:an?|the|our|approved)\s+)*$/i.test(before);
 if(!possession&&!/^\s*(?:(?:our|the|this|that|an?|approved)\s+)*$/i.test(before))return;
 const predicate=/^\s*(?:([A-Z][A-Z0-9]*(?:[-/][A-Z0-9]+)+)\s+)?(?:(?:that|which)\s+)?(?:(?:does|do)\s+)?(?:(?:explicitly|specifically)\s+)?covers?\s+((?:[A-Za-z'-]+\s+)*)([A-Z]{1,6}\d{1,6}[A-Z0-9-]*)(?:\s+([a-z][a-z -]*))?$/i.exec(after);
 if(!predicate)return;
 if(possession&&!/\b(?:that|which)\b/i.test(after))return;
 if(!possession&&/\b(?:that|which)\b/i.test(after))return;
 const availability=possession?availableDocumentActionEvidence(document.kind,originals,true):undefined;
 if(possession&&!availability)return;
 const [,identifier,productPrefix,product,description='']=predicate;
 const claimPrefix=productPrefix.trim().split(/\s+/).filter(Boolean).filter(word=>!/^(?:our|the|this|that|product|grade|model)$/i.test(word));
 if(claimPrefix.some(word=>! /^[A-Z][A-Za-z'-]*$/.test(word)))return;
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
   const sourcePrefix=link[2].trim().split(/\s+/).filter(Boolean);
   if(sourcePrefix.some(word=>! /^(?:our|the|this|that|product|grade|model)$/.test(word)&&! /^[A-Z][A-Za-z'-]*$/.test(word)))continue;
   const sourceName=sourcePrefix.filter(word=>!/^(?:our|the|this|that|product|grade|model)$/i.test(word));
   if(claimPrefix.length&&norm(claimPrefix.join(' '))!==norm(sourceName.join(' ')))continue;
   const suffix=sentence.slice(position.end).replace(/[.!;]$/,'').trim();
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

type DocumentStatementProof=NonNullable<ReturnType<typeof literalDocumentScopeEvidence>>;
type ReportProposition={kind:'content';object:string}|{kind:'exclusion';objects:string[]};
function reportPropositions(text:string):ReportProposition[]|undefined {
 const line=text.trim().replace(/[’‘]/g,"'").replace(/[.!;]$/,'');
 const clauses=line.split(/\s*(?:;|,?\s+but\s+|,?\s+though\s+|\s+and\s+(?=(?:it\s+)?(?:does not|doesn't)\s+certify\b))\s*/i),result:ReportProposition[]=[];
 for(let index=0;index<clauses.length;index++){
  // Singular genitive and of-phrase identify the same tested sample. Keep
  // plural samples, other possessors and appended predicates out of this rule.
  const clause=clauses[index].trim().replace(/^(it\s+(?:records|shows|documents))\s+the tested sample's\s+([a-z]+(?:[ -][a-z]+){0,4})$/i,'$1 the $2 of the tested sample');
  const content=/^it\s+(?:records|shows|documents)\s+the\s+([a-z]+(?:[ -][a-z]+){0,4}\s+of the tested sample)$/i.exec(clause);
  if(content){
   // The object must be repeated intact, including its singular sample scope.
   // No conjunction/qualifier may smuggle a second proposition into a noun.
   if(/\b(?:and|or|but|only|all|every|not|no|if|unless|guaranteed|certified)\b/i.test(content[1]))return;
   result.push({kind:'content',object:content[1].toLowerCase()});continue;
  }
  const exclusion=new RegExp('^'+(index?'(?:it\\s+)?':'it\\s+')+"(?:does not|doesn't)\\s+certify\\s+(.+)$",'i').exec(clause);
  if(!exclusion)return;
  const objects=exclusion[1].toLowerCase().split(/\s*(?:,\s*(?:or|and)?|\s+(?:or|and)\s+)\s*/).filter(Boolean);
  if(!objects.length||objects.some(object=>! /^[a-z]+(?:[ -][a-z]+){0,3}$/.test(object)||/\b(?:not|no|if|unless|only|all|every|because|but|so|when|which|that)\b/.test(object)))return;
  result.push({kind:'exclusion',objects});
 }
 return result.length?result:undefined;
}

/** The same explicit report remains the referent only across adjacent, proven
 * report sentences. The entire original must have a closed scope headline and
 * directly attached content/limitations; a retrieved fragment is not proof.
 * Unknown wording, approval, broader sample populations and guarantee claims
 * continue to the normal semantic verifier. */
export function literalDocumentStatementEvidence(clause:string,context:Context,sources:DocumentProductSource[],previous?:DocumentStatementProof):DocumentStatementProof|undefined {
 const clean=clause.trim().replace(/[’‘]/g,"'").replace(/;$/,'');
 const direct=literalDocumentScopeEvidence(clean,context,sources);
 if(direct)return direct;
 let binding=previous,body=clean;
 // An em dash joining two complete propositions is not a product-ID dash.
 const divider=clean.indexOf('—');
 if(divider>=0){
  binding=literalDocumentScopeEvidence(clean.slice(0,divider),context,sources);
  if(!binding)return;
  body=clean.slice(divider+1);
 }else{
  const conjunction=/\s+and\s+(?=(?:it\s+)?(?:records|shows|documents)\b)/i.exec(clean);
  if(conjunction){
   binding=literalDocumentScopeEvidence(clean.slice(0,conjunction.index),context,sources);
   if(!binding)return;
   body=clean.slice(conjunction.index+conjunction[0].length);
   if(!/^it\s/i.test(body))body='It '+body;
  }
 }
 if(!binding)return;
 const propositions=reportPropositions(body);if(!propositions)return;
 const source=sources.find(item=>item.id===binding!.sourceId&&item.original!==false&&item.complete!==false&&!stale.test((item.title||'')+' '+item.text));
 if(!source)return;
 const sourceParts=parts(source.text);
 if(sourceParts.length<2||!literalDocumentScopeEvidence(sourceParts[0],context,sources))return;
 const sourceDocument=documents(sourceParts[0]);if(sourceDocument.length!==1)return;
 // A second original about this document may qualify/contradict its contents.
 // A plain availability list is not a second content assertion; everything
 // else remains a semantic question instead of picking a convenient source.
 if(sources.some(item=>item.id!==source.id&&item.original!==false&&documents(item.text).some(doc=>sameDocument(sourceDocument[0].kind,doc.kind)||sameDocument(doc.kind,sourceDocument[0].kind))&&!parts(item.text).every(sentence=>availableDocumentActionEvidence(sourceDocument[0].kind,[{...item,text:sentence}],true))))return;
 const sourcePropositions=reportPropositions(sourceParts.slice(1).join(' '));
 if(!sourcePropositions)return;
 if(!propositions.every(proposition=>sourcePropositions.some(original=>proposition.kind==='content'?original.kind==='content'&&original.object===proposition.object:original.kind==='exclusion'&&proposition.objects.every(object=>original.objects.includes(object)))))return;
 return {...binding,reason:'Every report-content predicate and negative certification limitation repeats a closed proposition from the same complete original report source, preserving singular tested-sample scope.'};
}

/** A compact evidence decision next to the live output rules. It carries the
 * current question and source verdict, never a prewritten answer. */
export function documentCoverageQuestionEvidence(context:Context,sources:DocumentProductSource[]){
 const buyer=latestBuyer(context);if(!requestsDocumentProductCoverage(buyer))return;
 const assessment=assessDocumentProductCoverage('Yes, it does.',context,sources);
 return {buyerQuestion:buyer,documentTypes:[...new Set(documents(buyer).map(item=>item.kind))],productScopes:scopes(buyer).map(scope=>scope.key),relationship:assessment?.pending?'original_link_candidate':'unconfirmed',candidateSourceIds:assessment?.candidateSourceIds||[],boundary:'Document availability and separate product facts never establish document-to-product coverage.'};
}
