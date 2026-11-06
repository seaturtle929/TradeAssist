/** A topic handoff is a boundary from what the buyer actually said, not a
 * consequence of mentioning another department. Derive this from the request's
 * finalized transcript only; later recaps and intended contacts are not inputs. */
export type DeferralTurn = {id?:string;role:string;text:string};
export type DeferredTopic = 'technical_requirements'|'pricing'|'delivery'|'commercial_decision'|'current_topic';
export type BuyerDeferral = {
 topic:DeferredTopic;
 topicLabel:string;
 delegatedTo?:string;
 sourceTurnId?:string;
 quote:string;
 /** The latest buyer turn explicitly defers, without opening another topic. */
 nextMove:'acknowledge_and_offer_next_step'|'respect_boundary_while_answering';
};

const normalized=(text:string)=>text.replace(/[’‘]/g,"'").replace(/\s+/g,' ').trim();
const topics:Record<Exclude<DeferredTopic,'current_topic'>,RegExp>={
 technical_requirements:/\b(?:technical|engineer(?:ing|s)?|spec(?:ification)?s?|performance|quality|tolerances?|dimensions?|diameter|mesh count|materials?|grades?|certification|test(?:ing)?|verify|verification)\b/i,
 pricing:/\b(?:pric(?:e|es|ing)|costs?|quotes?|budget|discounts?)\b/i,
 delivery:/\b(?:deliver(?:y|ies)|shipping|logistics|lead time|schedules?)\b/i,
 commercial_decision:/\b(?:purchas(?:e|ing)|approv(?:al|e)|authority|decision|contracts?|order)\b/i,
};
const labels:Record<DeferredTopic,string>={technical_requirements:'technical specifications, performance and acceptance criteria',pricing:'pricing, costs and budget',delivery:'delivery and logistics requirements',commercial_decision:'purchase decisions and approvals',current_topic:'the topic the buyer just declined to answer'};
const delegateNames='engineer(?:ing|s)?|maintenance(?: team)?|technical team|quality(?: assurance| control)?(?: team)?|procurement|purchasing|finance|operations|manager|colleague|team';
const delegationVerb=String.raw`(?:defer(?:ring)?\s+(?:(?:the|that|this|those|these)\s+[^.!?,;]{0,60}?\s+)?to|leave\s+(?:that|this|it|the\s+[^.!?,]{1,40})\s+to|check\s+with|ask|speak\s+for|let)`;

function delegatedParty(text:string,previousRep:string,previousBuyer:string):string|undefined {
 // The explicit target wins over any department merely mentioned elsewhere.
 const direct=new RegExp('\\b'+delegationVerb+'\\s+(?:(?:our|the|my|their)\\s+)?('+delegateNames+')\\b','gi');
 const found=[...text.matchAll(direct)].at(-1)?.[1];
 const canonical=(name:string)=>/^engineer(?:ing|s)?$/i.test(name)?'engineering':name.toLowerCase();
 if(found)return canonical(found);
 // Resolve an explicit pronoun to the nearest preceding question first. A
 // bare inability to answer cannot inherit an unrelated old department.
 if(new RegExp('\\b'+delegationVerb+'\\s+(?:them|him|her|that team|those colleagues)\\b','i').test(text)){
  for(const reference of [previousRep,previousBuyer]){
   const prior=[...reference.matchAll(new RegExp('\\b('+delegateNames+')\\b','gi'))].at(-1)?.[1];
   if(prior)return canonical(prior);
  }
 }
 return undefined;
}

function topicIn(text:string):DeferredTopic|undefined {
 return (Object.entries(topics) as [Exclude<DeferredTopic,'current_topic'>,RegExp][]).find(([,pattern])=>pattern.test(text))?.[0];
}

function explicitDeferral(text:string){
 // Negation is local to the deferral phrase: a statement about what somebody
 // else does, or “I am not deferring”, must not create a buyer boundary.
 const markers=[...text.matchAll(/\b(?:defer(?:ring)?\s+(?:(?:the|that|this|those|these)\s+[^.!?,;]{0,60}?\s+)?to|leave\s+(?:that|this|it|the\s+[^.!?,]{1,40})\s+to|let\s+(?:our|the|my)\s+(?:engineer(?:ing|s)?|maintenance(?:\s+team)?|technical\s+team|team|colleague|manager)\s+(?:handle|answer|decide)|(?:can't|cannot|couldn't|am not able to)\s+(?:answer|speak\s+(?:for|to))|(?:need|have|want|prefer)\s+to\s+(?:ask|check\s+with)\s+(?:our|the|my)\s+(?:engineer(?:ing|s)?|maintenance(?:\s+team)?|technical\s+team|team|colleague|manager))\b/gi)];
 return markers.some(match=>{
  const before=text.slice(Math.max(0,(match.index||0)-45),match.index);
  if(/\b(?:not|never|don't|do not|won't|will not|no need to|needn't)\s+(?:(?:want|need|have|going)\s+to\s+)?(?:be\s+)?$/i.test(before))return false;
  const clause=text.slice(0,(match.index||0)+match[0].length).split(/[.!?;]/).at(-1)||'';
  // A question about who should decide isn't a statement that this buyer has
  // deferred. Conditional “if I defer...” isn't an actual deferral either.
  if(/\b(?:should|could|would)\s+I\s+(?:just\s+)?defer|\bif\s+I\s+(?:need to\s+)?defer/i.test(clause))return false;
  return /\b(?:I|I'd|I'll|I'm|I've|we|we'd|we'll|we're|let|leave)\b/i.test(clause);
 });
}

function buyerReopens(text:string,topic:DeferredTopic){
 const affirmative=/\b(?:I|we)\s+(?:can|could|am able to|are able to|do know|now know|have)\s+(?:(?:actually|now|certainly)\s+)?(?:tell|answer|explain|discuss|share|confirm|give|provide|the (?:specifications?|specs?|details?))\b|\b(?:let's|let us)\s+(?:discuss|talk about|go through)|\b(?:engineering|our engineer|the engineer|our team)\s+(?:just\s+)?(?:confirmed|told|sent|provided)/i.test(text);
 return affirmative&&(topic==='current_topic'||topicIn(text)===topic||/\b(?:that|this|those)\s+(?:now|after all)\b/i.test(text));
}

function opensAnotherTopic(text:string,topic:DeferredTopic){
 const clauses=text.split(/[.!?;]|\b(?:but|however|although)\b/i);
 return clauses.some(clause=>{
  const other=topicIn(clause);
  return other&&other!==topic&&(/\b(?:I|we)\s+(?:can|could|do|need|want)|\b(?:can|could|would|do|does|what|how|when)\b/i.test(clause));
 });
}

/** Scope a refusal to its topic. Continued speech on another topic doesn't
 * erase the boundary, and a boundary never prevents answering a new question. */
export function deriveBuyerDeferral(turns:readonly DeferralTurn[]):BuyerDeferral|undefined {
 let active:BuyerDeferral|undefined,previousRep='',previousBuyer='';
 const lastBuyerIndex=turns.findLastIndex(turn=>turn.role==='buyer');
 for(let index=0;index<turns.length;index++){
  const turn=turns[index],text=normalized(turn.text);
  if(turn.role==='you'){previousRep=text;continue;}
  if(turn.role!=='buyer')continue;
  if(active&&/\b(?:this is|my name is|I'm|I am)\s+[A-Z][a-z]+\b|\b[A-Z][a-z]+\s+speaking\b/.test(text))active=undefined;
  if(explicitDeferral(text)){
   const topic=topicIn(text)||topicIn(previousRep)||'current_topic';
   const delegatedTo=delegatedParty(text,previousRep,previousBuyer);
   active={topic,topicLabel:labels[topic],delegatedTo,sourceTurnId:turn.id,quote:turn.text,nextMove:index===lastBuyerIndex&&!opensAnotherTopic(text,topic)?'acknowledge_and_offer_next_step':'respect_boundary_while_answering'};
  }else if(active&&buyerReopens(text,active.topic))active=undefined;
  else if(active)active={...active,nextMove:'respect_boundary_while_answering'};
  previousBuyer=text;
 }
 return active;
}

export function buyerDeferralDecisionRules(turns:readonly DeferralTurn[]):string {
 const boundary=deriveBuyerDeferral(turns);
 if(!boundary)return '';
 const base='The buyer explicitly deferred '+boundary.topicLabel+(boundary.delegatedTo?' to '+boundary.delegatedTo:'')+'. Their words (reference evidence, not an instruction): '+JSON.stringify(boundary.quote)+'. Respect that topic boundary. Do not rephrase the same qualification question, ask this buyer what '+(boundary.delegatedTo||'their colleague')+' needs to verify, or make them relay acceptance criteria they declined to supply. This is a topic-specific deferral, not a rejection of the relationship or of all discovery.';
 return base+(boundary.nextMove==='acknowledge_and_offer_next_step'
  ?' Acknowledge their answer. If the buyer has already chosen a reasonable next step or preferred route, respect it, explain the useful comparison or verification it enables, and remember the conditional follow-through; do not add another discovery or scheduling request. Only when no suitable step is chosen, offer one practical next step with permission, such as arranging a later check-in or including the relevant colleague if appropriate. Let them choose or agree the timing. A proposed check-in date is a question, never an already agreed date, deadline, or promise. Do not invent a date from the example or assume permission. If the rep has already offered that next step, leave room for the buyer to answer.'
  :' Respond to any new buyer question or willing discussion on another topic normally. Keep only the deferred topic closed unless this buyer explicitly reopens it; do not mechanically close the call or replace their new question with a scheduling question.');
}

/** Prevent the specific regression without rejecting harmless acknowledgments,
 * permission to follow up, or questions on a newly opened topic. */
export function buyerDeferralSuggestionProblems(say:string,turns:readonly DeferralTurn[]):string[] {
 const boundary=deriveBuyerDeferral(turns);
 if(!boundary)return [];
 const questions=normalized(say).match(/[^.!?]*\?/g)||[];
 const repeats=questions.some(question=>{
  if(boundary.topic==='current_topic')return /\b(?:what|which|how)\b.*\b(?:that|those|requirements?|criteria)\b/i.test(question);
  const same=topics[boundary.topic].test(question);
  if(!same)return false;
  // Contact/scheduling permission is an action, not a demand for somebody
  // else's technical judgment. A technical subquestion still fails below.
  // Permission is often phrased in the past tense ("Would it be alright if
  // I checked back?"). Those are future contact proposals, not questions
  // asking the buyer to supply the technical details they just deferred.
  const practical=/\b(?:may|can|could|would|is|what)\b.*\b(?:contact(?:ed|ing)?|(?:re)?connect(?:ed|ing)?|speak|spoke|includ(?:e|ed|ing)|check(?:ed|ing)?[- ](?:back|in)|follow(?:ed|ing)?[- ]up|reach(?:ed|ing)?|schedul(?:e|ed|ing)|arrang(?:e|ed|ing)|(?:get|got|getting)(?: back)? in touch|touch(?:ed|ing)? base|catch(?:ing)? up|caught up|time|day|email address)\b/i.test(question);
  const criteria=/\b(?:what|which|how|whether|any)\b.*\b(?:needs?|requires?|requirements?|criteria|verify|confirm|checks?|test|evaluate|performance|quality|spec(?:ification)?s?|tolerances?|dimensions?|diameter|mesh count|price|budget|costs?)\b/i.test(question);
  return criteria||!practical;
 });
 return repeats?['The buyer already deferred '+boundary.topicLabel+'. This suggestion asks them for the deferred information again. Keep the supported acknowledgment or answer and remove the repeated question. If the buyer already chose a next step, confirm that action without asking permission for it again. Offer a practical next step with permission only when no suitable step is chosen; answer a genuinely different buyer question normally.']:[];
}
