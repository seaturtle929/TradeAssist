import {hasWrittenLearningLesson,normalizeGuidance,type CoachingContext} from './call-coaching.ts';
import {buyerQuestionAgendaFor,substantiveBuyerQuestions} from './buyer-turn-intent.ts';
import {checkSuggestion} from './call-purpose.ts';
import {assessReplyVerification,classifyBuyerTurn} from './turn-verification-policy.ts';
import type {Guidance} from './trade';
import {applyCoachingConfiguration} from './coaching-configuration.ts';

export type DocumentedFactReply={guidance:Guidance;source:'company_knowledge';reason:string};
type FactContext=CoachingContext&{manufacturer?:{id?:string;name?:string;products?:string}};
// An explicit chemical name is an identity alias, never a fuzzy product match.
// Normalize only for matching; the spoken line/citation remain the original.
const normalize=(value:string)=>value.replace(/[₀₁₂₃₄₅₆₇₈₉]/g,char=>String('₀₁₂₃₄₅₆₇₈₉'.indexOf(char))).replace(/\balumin(?:um|ium) oxide\b/gi,'Al2O3').replace(/[’‘]/g,"'").replace(/\s+/g,' ').trim();
const metric=/\b(?:purity|content|percentage|percent)\b|%/i;
const commercial=/\b(?:prices?|pricing|cost|quote|MOQ|minimum order|lead[- ]?time|certif\w*|stock|inventory|capacity|available|availability|ship\w*|deliver\w*|payment|guarantee\w*|warranty|free samples?|CIF|FOB)\b/i;
const uncertain=/\b(?:not|no|never|unknown|unconfirmed|unverified|approximately|approx\.?|about|typically|usually|nominal|estimated|estimate|may|might|could|depending|depends|unless|except|subject to|if|draft|outdated|superseded|historical|archived|not approved|for reference only)\b/i;
const staleSource=/\b(?:draft|outdated|superseded|historical|archived|not current|not approved|for reference only|valid until|expired)\b/i;
const stop=new Set('what whats is are the a an your our their its it this that these those of in for on with from to and can you tell me please give have has do does minimum min maximum max at least most not less more than purity content percentage percent product material grade chemical compound level amount value guaranteed specification specifications spec specs'.split(' '));
const words=(value:string)=>normalize(value).toLowerCase().replace(/'s\b/g,'').match(/[a-z0-9]+/g)||[];
const stem=(word:string)=>word.replace(/(?:ies|s)$/i,part=>part.toLowerCase()==='ies'?'y':'');
const escaped=(value:string)=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
function formulas(value:string):string[]{
 return [...new Set((normalize(value).match(/\b(?:[A-Z][a-z]?\d*){2,}\b/g)||[]).filter(token=>/\d/.test(token)||/[a-z]/.test(token)))];
}
function originalSentences(value:string):string[]{
 return value.split(/\n+/).flatMap(line=>[...line.matchAll(/[\s\S]*?[.!?](?=\s|$)/g)].map(match=>match[0].trim())).filter(Boolean);
}
function bounds(text:string):'minimum'|'maximum'|null {
 const minimum=/\b(?:minimum|min\.?|at least|not less than)\b|≥|>=/i.test(text);
 const maximum=/\b(?:maximum|max\.?|at most|not more than)\b|≤|<=/i.test(text);
 return minimum===maximum?null:minimum?'minimum':'maximum';
}
function needsInterpretation(context:FactContext):boolean {
 if(hasWrittenLearningLesson(context))return true;
 const voice=context.voice as {notes?:string;examples?:string[]}|undefined;
 if(voice?.notes?.trim()||voice?.examples?.some(value=>value.trim()))return true;
 return !!context.brain?.learningExamples.some(example=>example.source==='override'||example.source==='golden'&&example.id!=='golden-agreed-profile-review-prices'&&!!example.positive?.trim());
}

/** Extractive only: repeat one complete original scoped chemical-content fact.
 * No generated numbers, inferred table cells, approximate matches, price/stock
 * policies, or historical answer cache can enter this shortcut. Ambiguity keeps
 * the normal model/source-check path. */
export function documentedFactReplyFor(context:FactContext):DocumentedFactReply|null {
 context=applyCoachingConfiguration(context);
 const latest=context.turns?.at(-1);
 if(!context.callId||!context.manufacturer?.name||latest?.role!=='buyer'||!latest.text.trim()||needsInterpretation(context))return null;
 if(context.brain&&(!context.manufacturer.id||context.brain.companyId!==context.manufacturer.id))return null;
 if(classifyBuyerTurn(context).kind!=='fact_request')return null;
 const agenda=buyerQuestionAgendaFor(context,latest);
 if(agenda.questions.length!==1||agenda.requests.length||agenda.questions.some(question=>question.turnId!==latest.id)||substantiveBuyerQuestions(context).length!==1)return null;
 const question=normalize(latest.text);
 if(!metric.test(question)||commercial.test(question)||/\b(?:exact|actual|average|typical|nominal|guaranteed)\b/i.test(question))return null;
 if(/\b(?:which|what)\s+(?:grades?|products?|materials?|types?|range)\b|\b(?:why|when|where|who)\b/i.test(question))return null;
 const chemicals=formulas(question);if(chemicals.length!==1)return null;
 const chemical=chemicals[0],formulaPattern=new RegExp(`\\b${escaped(chemical)}\\b`,'gi');
 const withoutChemical=question.replace(formulaPattern,' ');
 const queryGrades:string[]=withoutChemical.match(/\b[A-Z]\d{2,6}\b/g)||[];
 if(/\d/.test(withoutChemical.replace(/\b[A-Z]\d{2,6}\b/g,'')))return null;
 const scope=[...new Set(words(withoutChemical).filter(word=>!stop.has(word)).map(stem))];
 if(!scope.length||scope.every(word=>/^[a-z]\d+$/.test(word)))return null;
 const requestedBound=bounds(question);
 const matches:{sourceId:string;quote:string;percentage:string;bound:'minimum'|'maximum'}[]=[];
 for(const source of context.sources||[]){
  if(staleSource.test(source.title||'')||staleSource.test(source.text))continue;
  const sourceScope=new Set(words(source.text).map(stem));
  const potentiallyRelevant=formulas(source.text).some(value=>value.toLowerCase()===chemical.toLowerCase())&&scope.every(word=>sourceScope.has(word));
  if(source.complete===false){if(potentiallyRelevant)return null;continue;}
  // A following qualification can narrow an otherwise complete-looking first
  // sentence. Such documents need the model, rather than dropping that context.
  if(/\b(?:except|unless|subject to|depending on|provided that|only when|may vary|varies by)\b/i.test(source.text)){if(potentiallyRelevant)return null;continue;}
  for(const quote of originalSentences(source.text)){
   const line=normalize(quote),lineWords=new Set(words(line).map(stem));
   if(!formulas(line).some(value=>value.toLowerCase()===chemical.toLowerCase())||!metric.test(line)||!scope.every(word=>lineWords.has(word)))continue;
   // Any same-scope competing statement needs interpretation, even if a
   // different line supplies an otherwise usable threshold.
   const percentages=[...line.matchAll(/\b\d+(?:\.\d+)?\s*%/g)];
   const bound=bounds(line);
   const chemicalList=formulas(line);
   const unknownNumbers=line.replace(new RegExp(`\\b${escaped(chemical)}\\b`,'gi'),'').replace(/\b[A-Z]\d{2,6}\b/g,'').replace(/\b\d+(?:\.\d+)?\s*%/g,'');
   const grades:string[]=line.match(/\b[A-Z]\d{2,6}\b/g)||[];
   if(quote.split(/\s+/).length>35||quote.includes('?')||uncertain.test(line.replace(/\bnot (?:less|more) than\b/gi,''))||commercial.test(line)||chemicalList.length!==1||percentages.length!==1||!bound||requestedBound&&requestedBound!==bound||/\d/.test(unknownNumbers)||/[+-]\s*\d+(?:\.\d+)?\s*%/.test(line))return null;
   const value=Number(percentages[0][0].replace(/\s|%/g,''));if(!(value>=0&&value<=100))return null;
   if(grades.length&&!queryGrades.length&&!(grades.length===2&&new RegExp(`${escaped(grades[0])}\\s*(?:to|[-–—])\\s*${escaped(grades[1])}`).test(line)))return null;
   if(queryGrades.some(grade=>!grades.includes(grade)))return null;
   matches.push({sourceId:source.id,quote,percentage:String(value),bound});
  }
 }
 if(!matches.length||new Set(matches.map(match=>match.percentage+':'+match.bound)).size!==1)return null;
 const selected=matches[0];
 const guidance=normalizeGuidance({say:selected.quote,backup:'',caution:'',missing:[],evidence:[{sourceId:selected.sourceId,quote:selected.quote}],stageId:'discovery',moment:context.bilingual?'资料中已有明确答案':'Documented chemical-content answer',move:context.bilingual?'准确引用原始规格':'Answer from the original specification',why:context.bilingual?'保留产品范围和阈值，直接引用公司资料。':'Repeat the exact scoped threshold from current Company Knowledge.',buyerIntent:''},context,{verified:true});
 if(guidance.say!==selected.quote||guidance.evidence.length!==1||guidance.caution||guidance.missing.length)return null;
 const safety=assessReplyVerification(guidance.say,context);
 if(safety.unsupportedClaims.length||!checkSuggestion(guidance,context,{factChecked:true}).ok)return null;
 return {guidance:{...guidance,phase:'answer',questionEcho:latest.text,analysisReady:true},source:'company_knowledge',reason:'Exact original scoped chemical-content threshold with a matching current-company source citation.'};
}
