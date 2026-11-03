import {containsAvoidedPhrase,productCategoryFor,type CoachingContext} from './call-coaching.ts';
import {coldCallGateFor,deriveCallParticipant,preparedPurchasingParticipant,type ColdCallGateKind} from './call-participant.ts';
import {normalizeOpening} from './opening-preferences.ts';
import type {Guidance} from './trade';

export type OpeningPlan={opening:string;suggestedOpening:string;openingSource:'suggested'|'company_default';followUp:string;evidence:{label:string;quote:string;url?:string}[];companyEvidence:{sourceId:string;quote:string}[];buyerObservation?:{text:string;sourceUrl:string}};
const words=(value:string)=>value.trim().split(/\s+/).filter(Boolean).length;
const normalized=(value:string)=>value.trim().toLowerCase().replace(/[^a-z0-9]+/g,' ');
const clean=(value:string)=>value.replace(/\s+/g,' ').trim();

export function knownRepresentativeName(context:CoachingContext):string|undefined {
 const notes=(context.voice as {notes?:string}|undefined)?.notes||'';
 const supplied=notes.match(/\b(?:[Mm]y name is|[Mm]y name's|[Rr]epresentative(?:'s)? name:|[Ss]alesperson(?:'s)? name:)\s*([A-Z][a-z'-]{1,24}(?: [A-Z][a-z'-]{1,24})?)(?=[,.!;\n]|$)/)?.[1];
 if(supplied)return supplied;
 const company=clean(context.manufacturer?.name||'');if(!company)return;
 const escaped=company.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 for(const turn of [...(context.turns||[])].reverse())if(turn.role==='you'){
  const actual=turn.text.match(new RegExp(`\\b(?:I'm|I am|this is|my name is)\\s+([A-Z][a-z'-]{1,24}(?: [A-Z][a-z'-]{1,24})?)\\s+(?:with|from)\\s+${escaped}(?=[,.!?;]|$)`));
  if(actual)return actual[1];
 }
}

/** Brief identification + purpose earns a transfer; it is not a product pitch.
 * Detailed grades, numbers and capabilities never enter this local line. */
export function coldCallGateLineFor(context:CoachingContext,kind:ColdCallGateKind):string {
 if(kind==='transfer_wait')return "Thank you, I'll hold while you connect us.";
 const name=clean(context.manufacturer?.name||''),rep=knownRepresentativeName(context);
 if(!name)return '';
 let category=productCategoryFor(context);
 if(!category||/\d|\b(?:grades?|specs?|specifications?|purity|prices?|MOQ|CIF|FOB|certif\w*|lead time)\b/i.test(category))category='our products';
 const identity=name?(rep?`Hi, I'm ${rep} with ${name}`:`Hi, I'm with ${name}`):'Hi';
 const prefix=`${identity}, calling about ${category}.`;
 const line=kind==='unavailable_contact'
  ? `${prefix} Could you share the purchasing contact's name, best email and a good time to reach them?`
  : kind==='gatekeeper_intent'
  ? `${prefix} Could you connect me with purchasing so I can share our company profile for review?`
  : `${prefix} Could I speak with purchasing to share our company profile for review?`;
 if(words(line)<=35&&!containsAvoidedPhrase(line,context.voice?.avoid||[]))return line;
 const compact=kind==='unavailable_contact'
  ? `${identity}. Could you share the purchasing contact's name, email and best time to reach them about ${category}?`
  : `${identity}. May I reach purchasing to share our profile about ${category}?`;
 return words(compact)<=35&&!containsAvoidedPhrase(compact,context.voice?.avoid||[])?compact:'';
}

/** Keep only this buyer's cited public facts in live generation. A hypothesis
 * remains a possible question, never a confirmed need or supplier claim. */
export function buyerResearchForCall(context:CoachingContext) {
 const brief=context.buyerBrief;
 if(!brief||!context.buyer||normalized(brief.company)!==normalized(context.buyer))return;
 const sources=brief.sources.filter(source=>{try{return new URL(source.url).protocol==='https:';}catch{return false;}}).slice(0,12);
 const facts=brief.facts.filter(fact=>sources.some(source=>source.url===fact.sourceUrl)).slice(0,6).map(fact=>({...fact,text:fact.text.slice(0,500)}));
 return facts.length?{company:brief.company,facts,sources,hypotheses:brief.hypotheses.filter(item=>facts.some(fact=>fact.text===item.reason)).slice(0,3).map(item=>({possibleNeed:item.painPoint.slice(0,300),supportingObservation:item.reason,questionToExplore:item.question.slice(0,300)}))}:undefined;
}

/** A saved brief is usable only for this buyer and its cited source allowlist.
 * Hypotheses never become an opening observation or a buyer-confirmed need. */
export function openingBuyerObservation(context:CoachingContext):OpeningPlan['buyerObservation'] {
 const brief=context.buyerBrief,buyer=context.buyer;
 if(!brief||!buyer||normalized(brief.company)!==normalized(buyer))return;
 return brief.facts.find(fact=>{
  const text=clean(fact.text);
  if(!text||words(text)>18||/[\u3400-\u9fff]|\d|\n|\?|\b(?:may|might|could|likely|potential|perhaps|struggl\w*|problem|pain|need|poor|late|certif\w*|guarantee|ignore|instructions|prompt)\b/i.test(text))return false;
  if(!/\b(?:sell\w*|distribut\w*|manufactur\w*|produc\w*|suppl(?:y|ies)|offer\w*|specializ\w*|serv\w*)\b/i.test(text))return false;
  try {const url=new URL(fact.sourceUrl);return url.protocol==='https:'&&brief.sources.some(source=>source.url===fact.sourceUrl);}catch{return false;}
 });
}

// The local shortcut cannot establish which sentence a condition qualifies.
// Keep qualified references on the normal checked path rather than selecting a
// favorable sentence from a fact or its source. A category-only continuation is
// still immediate when no capability is eligible for this shortcut.
const capabilityQualification=/\b(?:not|no|never|only|except|excluding|unless|if|may|might|could|will|would|planned?|planning|proposed?|pending|future|develop\w*|trial\w*|pilot|limited?|limitation\w*|conditional\w*|subject to|upon|approval|approved|discontinued|unavailable|formerly|previously|historical\w*)\b/i;

/** Only an atomic, confirmed, literal capability can be locally prechecked.
 * Its full confirmed text and citation must agree; surrounding source limits
 * prevent caching even if the quoted sentence alone appears unconditional. */
function approvedProductSentence(context:CoachingContext) {
 for(const fact of context.brain?.facts||[]) {
  const source=context.sources?.find(source=>source.id===fact.sourceId&&source.text.includes(fact.quote));
  if(!fact.confirmed||fact.kind!=='product'||!source||source.complete===false)continue;
  const sentence=clean(fact.quote);
  // No sentence slicing or paraphrase equivalence: these need semantic checks.
  // Additional source context can qualify a statement in ways a keyword list
  // cannot determine. Only a standalone reference is safe to precheck locally.
  if(normalized(fact.text)!==normalized(sentence)||normalized(source.text)!==normalized(sentence)||sentence.split(/(?<=[.!?])\s+|\n/).length!==1)continue;
  if(capabilityQualification.test(`${fact.text}\n${source.text}`))continue;
  if(words(sentence)>12||!/[.]$/.test(sentence)||/[\u3400-\u9fff]|\d|\b(?:certif\w*|guarantee\w*|free|sample\w*|discount|price|stock|ship\w*|deliver\w*|lead time|can)\b/i.test(sentence))continue;
  const subject=sentence.match(/^(.{1,100}?) (?:manufactures?|produces?|makes?|supplies|supply)\s+[a-z]/i)?.[1];
  if(!subject||!(normalized(subject)==='we'||normalized(subject)===normalized(context.manufacturer?.name||'')))continue;
  return {sentence,evidence:{sourceId:fact.sourceId,quote:fact.quote}};
 }
}

export function buildOpeningPlan(context:CoachingContext):OpeningPlan {
 const name=clean(context.manufacturer?.name||'your company'),category=productCategoryFor(context)||'your purchasing needs';
 const rep=knownRepresentativeName(context);
 const identity=rep?`Hi, I'm ${rep} with ${name}.`:`Hi, I'm with ${name}.`;
 const avoid=context.voice?.avoid||[];
 const prepared=context.callContext&&typeof context.callContext==='object'?context.callContext as {knownFacts?:string;doNotGuess?:string}:{};
 const participant=preparedPurchasingParticipant(context.conversationState?.participant||deriveCallParticipant(context.turns||[]),prepared.knownFacts,prepared.doNotGuess);
 const gate=coldCallGateFor(context),gateLine=gate?coldCallGateLineFor(context,gate.kind):'';
 const firstQuestion=participant.role==='purchasing'?'What matters most when you choose these materials?':'Is that something your team purchases?';
 const openings=[`${identity.replace(/[.]$/,'')}, calling about ${category}. ${firstQuestion}`,`${identity} I'm calling about ${category}—do you have a moment?`,`${identity} I'm calling about ${category}—is now a good time?`];
 const basicOpening=gateLine||openings.find(line=>words(line)<=35&&!containsAvoidedPhrase(line,avoid))||'';
 const observation=openingBuyerObservation(context),product=approvedProductSentence(context);
 const question=participant.role==='purchasing'?'what would be useful for you to know?':'is that relevant to what your team buys?';
 const observed=observation?`I noticed ${observation.text.replace(/[.!]+$/,'')}. `:'';
 let statement=product?.sentence.replace(/[.]$/,'')||`I'm calling about ${category}`;
 let followUp=`${observed}${statement}—${question}`;
 let companyEvidence=product?[product.evidence]:[];
 if(words(followUp)>35){statement=`I'm calling about ${category}`;companyEvidence=[];followUp=`${observed}${statement}—${question}`;}
 if(words(followUp)>35||containsAvoidedPhrase(followUp,avoid)){companyEvidence=[];followUp=`I'm calling about ${category}. What would be useful for you to know?`;}
 const observedOpening=observation&&basicOpening?identity+' '+observed+"I'm calling about "+category+'—'+firstQuestion.charAt(0).toLowerCase()+firstQuestion.slice(1):basicOpening;
 const suggestedOpening=gateLine|| (words(observedOpening)<=55&&!containsAvoidedPhrase(observedOpening,avoid)?observedOpening:basicOpening);
 const saved=normalizeOpening(context.brain?.defaultOpening),opening=saved||suggestedOpening;
 // Evidence here describes the ONE displayed opening. The continuation keeps
 // its company evidence separately and never turns saved wording into a fact.
 const evidence=!saved&&observation&&opening.includes(observation.text.replace(/[.!]+$/,''))?[{label:'Buyer website observation',quote:observation.text,url:observation.sourceUrl}]:[];
 return {opening,suggestedOpening,openingSource:saved?'company_default':'suggested',followUp:gateLine||followUp,evidence:gateLine&&!saved?[]:evidence,companyEvidence:gateLine?[]:companyEvidence,...observation?{buyerObservation:observation}:{}};
}

/** An explicitly selected script is displayed verbatim, not regenerated or
 * passed through the AI normalizer which can truncate or substitute wording. */
export function preparedOpeningGuidance(text:string,custom=false):Guidance {
 return {say:normalizeOpening(text),ask:'',intent:'Prepared opening',nextStep:'',caution:custom?'Your prepared wording. Check company claims against Company Knowledge before saying them.':'',evidence:[],missing:[],stageId:'opening',stage:'Opening',moment:'Prepared opening',move:'Introduce yourself and leave room for a response',backup:'',why:'This is prepared wording, not a record of anything spoken or agreed.',buyerIntent:'',verified:false,phase:'answer',questionEcho:'Opening',analysisReady:true};
}

/** A short yes is permission only against an ACTUAL representative permission
 * question to this person, never after specs, quote, role or delivery questions. */
export function isPermissionToContinue(context:CoachingContext):boolean {
 const turns=context.turns||[],latest=turns.findLastIndex(turn=>turn.role!=='you');if(latest<0||turns[latest].role!=='buyer')return false;
 const line=clean(turns[latest].text.replace(/[’‘]/g,"'"));
 if(!/^(?:(?:yes|yeah|yep|sure|okay|ok|certainly|of course)[,!. ]*)?(?:go ahead|please go ahead|I'm listening|I am listening|you can continue|tell me more|you have a moment|I have a moment|I have a minute)?[.! ]*$/i.test(line)||!/[a-z]/i.test(line))return false;
 const participant=context.conversationState?.participant||deriveCallParticipant(turns);
 const segment=participant.afterTransfer&&participant.segmentStartTurnId?turns.findIndex(turn=>turn.id===participant.segmentStartTurnId):0;
 const repIndex=turns.findLastIndex((turn,index)=>index<latest&&index>=Math.max(0,segment)&&turn.role==='you');if(repIndex<0)return false;
 const rep=turns[repIndex];
 // A later backchannel cannot reopen an introduction already moved past.
 if(turns.slice(repIndex+1,latest).some(turn=>turn.role!=='buyer'||!/^(?:(?:yes|yeah|yep|sure|okay|ok|go ahead|please go ahead|I'm listening|I am listening|uh+|um+|hmm+)[,.! ]*)+$/i.test(clean(turn.text.replace(/[’‘]/g,"'")))))return false;
 if(/\b(?:email|profile|specs?|quote|quotation|price|purity|MOQ|certif\w*|send|backup|replace|comparison)\b/i.test(rep.text))return false;
 return /\b(?:do you have (?:a |one )?(?:moment|minute)|is (?:now|this) a good time|is this (?:an? )?(?:okay|ok) time|(?:can|may|could) I (?:briefly introduce|introduce (?:myself|our company)|(?:give|make) (?:a )?(?:quick |brief )?(?:introduction|overview)|(?:share|explain) (?:why I'm calling|the reason for (?:my|this) call|what we do|who we are))|good time for (?:a )?(?:quick |brief )?introduction|okay if I (?:introduce myself|explain why I'm calling))\b/i.test(rep.text);
}
