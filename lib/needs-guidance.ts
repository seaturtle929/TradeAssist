import {buyerNeedTopicsForQuestion,deriveBuyerNeeds,hasTentativeComparisonInterest,type BuyerNeeds} from './buyer-needs.ts';
import type {CoachingContext} from './call-coaching.ts';
import type {ConversationState} from './conversation-state.ts';

export const GENTLE_SALES_RULES=`BUYER-LED DISCOVERY: Give the buyer room to think and explain. Ask at most one short question, grounded in their actual words and the whole buyerNeeds record. Understand what matters to them; explore consequences only after they state a difficulty. Explain relevant supported value when useful instead of turning each answer into another checklist question. Do not repeat answered or declined topics. Never force a replacement / backup / quote menu, presume dissatisfaction, or assume they want to switch. Having a satisfactory incumbent is context: acknowledge what works and, if relevant, explore a low-pressure reason to evaluate an additional option. A clear refusal means stop pushing. A boundary about switching alone is not permission to close every possible conversation, nor permission to push a replacement. If they need time, leave room; no forced decision or appointment. A brief acknowledgment can be the entire line. A sourced buyer website observation can establish relevance, not prove pain or buying interest. A yes/go ahead after an actual permission opening means continue the introduction, not agreement to compare or buy. Retain agreed next steps, but answer a new question, objection or correction before returning to their practical details. Product interest alone never means agreement to documents, email or a quote.`;
const norm=(value:string)=>value.replace(/[’‘]/g,"'").toLowerCase().replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim();
const latestBuyer=(context:CoachingContext)=>[...(context.turns||[])].reverse().find(turn=>turn.role!=='you')?.text||'';

export function isGentleBoundary(text:string) {
 if(hasTentativeComparisonInterest(text))return false;
 return /\b(?:don't need (?:a|an|another|any|a new) (?:source|supplier)|do not need (?:a|an|another|any|a new) (?:source|supplier)|not interested\b(?!\s+(?:in|to)\b)|no thanks|no thank you|stop (?:calling|contacting)|don't (?:call|contact)|do not (?:call|contact)|leave (?:me|us) alone)\b/i.test(text.replace(/[’‘]/g,"'"));
}
export function isThinkingAboutIt(text:string) {
 return /\b(?:let me think|need to think|think about (?:it|that)|give (?:me|us) (?:some )?time|not sure yet|haven't decided|have not decided)\b/i.test(text.replace(/[’‘]/g,"'"));
}
export function gentleBoundaryReply(text:string):string|undefined {
 // A boundary about switching is compatible with an explicit, low-pressure
 // comparison. Respect the boundary without closing that still-open door.
 if(hasTentativeComparisonInterest(text))return;
 if(isGentleBoundary(text))return 'Understood. Thanks for taking a moment to speak with me.';
 if(isThinkingAboutIt(text))return "Of course, take your time. There's no need to decide on this call.";
}

/** Local orientation/fallback, never a fixed interview. The model still adapts
 * wording from the actual conversation and company-specific learning examples. */
export function needsQuestionPlan(state:ConversationState,context:CoachingContext) {
 const needs=state.buyerNeeds||deriveBuyerNeeds({turns:context.turns,callContext:context.callContext,participant:state.participant}),latest=latestBuyer(context),facts=needs.facts;
 const boundary=gentleBoundaryReply(latest);
 if(boundary)return {say:boundary,topic:'space',purpose:'Give the buyer room to decide',kind:'acknowledge' as const};
 const priorQuestions=(context.turns||[]).filter(turn=>turn.role==='you'&&turn.text.includes('?')).map(turn=>norm(turn.text));
 const available=(topic:string,say:string)=>!needs.declinedTopics.includes(topic)&&!needs.declinedTopics.includes('discovery')&&!needs.askedTopics.includes(topic)&&!priorQuestions.includes(norm(say));
 const proposals:{topic:string;say:string;purpose:string}[]=[];
 if(needs.interest.kind==='comparison'&&needs.interest.status!=='prepared'&&!state.facts.specs)proposals.push({topic:'specs',say:'Which grade would be useful to compare?',purpose:'Understand the basis for the requested comparison'});
 if(facts.priority&&!facts.evaluation)proposals.push({topic:'evaluation',say:/consisten|variation|uniform/i.test(facts.priority.value)?'How do you evaluate consistency in the material you receive?':'How do you check that the material meets that requirement?',purpose:'Understand how the buyer evaluates their stated priority'});
 if(facts.difficulty&&!facts.impact)proposals.push({topic:'impact',say:/deliver|shipment|late/i.test(facts.difficulty.value)?'What happens on your side when a shipment is late?':/consisten|variation|uniform/i.test(facts.difficulty.value)?'Does that variation affect your process?':'How does that affect your day-to-day work?',purpose:'Understand the effect of the difficulty the buyer actually mentioned'});
 if(facts.impact&&!facts.priority)proposals.push({topic:'priority',say:/extra|additional|safety/i.test(facts.impact.value)&&/stock|inventory/i.test(facts.impact.value)?'Is holding that extra stock working well for you?':"Is that something you'd like to improve, or is the current approach working for you?",purpose:'Find out whether the buyer wants to change the stated effect'});
 if(facts.current_supplier&&!facts.difficulty) {
  if(!facts.priority&&/\b(?:works? (?:really |pretty |very )?well|working (?:really |pretty |very )?well|going (?:really |pretty |very )?well|no complaints|happy with|satisfied with)\b/i.test(facts.current_supplier.quote))proposals.push({topic:'priority',say:'What has worked especially well for you with them?',purpose:'Understand what the buyer values about the arrangement they say works well'});
  else proposals.push({topic:'difficulty',say:'How is that arrangement working for you?',purpose:'Understand the existing arrangement without assuming a problem'});
 }
 if(facts.application&&!facts.difficulty&&!facts.priority){
  const exploringFit=/\b(?:interested|interest|caught my attention|looking for|considering|evaluating)\b/i.test(facts.application.quote)&&!/\b(?:we use|we are using|we're using|currently (?:use|using|buy|buying)|already (?:use|using))\b/i.test(facts.application.quote);
  proposals.push(exploringFit?{topic:'difficulty',say:'What would make it a useful fit for that application?',purpose:'Clarify the intended fit without assuming the buyer already uses the offered item'}:{topic:'difficulty',say:'How is that material working for your application?',purpose:'Learn what works in the buyer’s current use'});
 }
 if(facts.application&&!facts.timing)proposals.push({topic:'timing',say:'How does your purchasing schedule work?',purpose:'Understand the buying rhythm when it is useful to this conversation'});
 if(!facts.application&&state.participant.role==='purchasing')proposals.push({topic:'application',say:'What materials are you currently buying for your team?',purpose:'Learn the buyer’s current use before discussing fit'});
 if(!facts.application&&state.participant.role==='unknown')proposals.push({topic:'application',say:'Is this relevant to what your team buys?',purpose:'Check relevance without presuming purchasing responsibility'});
 const chosen=proposals.find(item=>available(item.topic,item.say));
 return chosen?{...chosen,kind:'question' as const}:{say:'Thanks, that gives me a clearer picture of your requirements.',topic:'space',purpose:'Acknowledge what the buyer has shared and leave room',kind:'acknowledge' as const};
}

export function discoveryQuestionProblems(say:string,needs:BuyerNeeds,context:CoachingContext):string[] {
 if(!say.includes('?'))return [];
 const reasons:string[]=[],topics=buyerNeedTopicsForQuestion(say),latest=latestBuyer(context);
 const questionText=say.split(/(?<=[.!])\s+/).find(part=>part.includes('?'))||say;
 const modes=[/\breplac\w*|\bswitch\w*/i,/\bbackup|\bback-up|\bsecond source/i,/\bcompar\w*|\bquotes?\b/i].filter(pattern=>pattern.test(questionText)).length;
 if(modes>=2&&/\bor\b|\bwhich\b|\bchoose\b|\bpick\b/i.test(questionText))reasons.push('Do not force the buyer to choose a replacement, backup source or quote category');
 if(isGentleBoundary(latest)||isThinkingAboutIt(latest))reasons.push('Give the buyer room after a decline or request for thinking time');
 if(topics.some(topic=>needs.declinedTopics.includes(topic))||needs.declinedTopics.includes('discovery'))reasons.push('This buyer already declined that discovery topic');
 const namedItem=context.foundation?.bindings.selected_item;
 const currentMaterialKnown=needs.facts.application||(namedItem&&namedItem!=='that item'&&/\b(?:supplier|source|use|using|buy|buying|distribut\w*)\b/i.test(latest));
 if(currentMaterialKnown&&/\b(?:what|which)\b.{0,30}\b(?:materials?|products?)\b.{0,30}\b(?:use|using|buy|buying)\b/i.test(say))reasons.push('The buyer already supplied their current material or application; ask only a relevant missing detail');
 if(needs.facts.priority&&/\b(?:what matters most|what is most important|what are you looking for in (?:a |an )?(?:supply partner|supplier))\b/i.test(say))reasons.push('Follow the stated priority instead of asking broad priorities again');
 if(needs.facts.current_supplier&&/\b(?:works? (?:really |pretty |very )?well|working (?:really |pretty |very )?well|going (?:really |pretty |very )?well|no complaints)\b/i.test(needs.facts.current_supplier.quote)&&/\bhow (?:is|has) (?:that|the|your) (?:arrangement|supplier|relationship)\b.{0,30}\b(?:work|working|been)\b/i.test(say))reasons.push('The buyer already said the arrangement works well; follow what they value rather than asking again');
 if(!(latest.match(/\brepeat|say (?:that|it) again\b/i))&&(context.turns||[]).some(turn=>turn.role==='you'&&turn.text.includes('?')&&norm(turn.text)===norm(say)))reasons.push('This exact question was already actually asked');
 return reasons;
}
