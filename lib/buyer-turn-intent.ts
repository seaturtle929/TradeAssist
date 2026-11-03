import {classifyBuyerTurn} from './turn-verification-policy.ts';
import {hasClearConversationRefusal} from './conversation-boundary.ts';

type SpokenTurn={id?:string;role:string;text:string;at?:number};
type BudgetLearningExample={stageId?:string;learningExplanation?:string;structuredLesson?:{reviewStatus?:string;momentType?:string;explanation?:string;tags?:string[]}};
type BuyerContext={coachingRequest?:{id:string;requestedAt:number};clientContext?:import('./client-coaching-context').ClientCoachingContext;callId?:string;turns?:SpokenTurn[];unansweredBuyerQuestions?:{turnId:string;text:string;at:number}[];manufacturer?:{id?:string};foundation?:{momentType?:string};conversationState?:{stageId?:string};brain?:{companyId?:string;learningExamples?:BudgetLearningExample[]}};
const clean=(value:string)=>value.replace(/\s+/g," ").trim();
const reportedPrefix=(before:string)=>/\b(?:know|explained|answered|understand|remember|discussed|told|asked)\b(?:\s+(?:me|us|them|exactly|already|earlier|before|previously|that))*$/i.test(before)&&!/\b(?:to know|wondering|want to ask|wanted to ask)$/i.test(before);

/** A choice challenge is not evidence of interest, a price objection or consent. */
export function isCompanyChoiceQuestion(text:string):boolean {
  const line=text.replace(/[’‘]/g,"'");
  const patterns=[/\bwhy (?:you|your (?:company|factory))(?:[?!.]|$|\s+(?:over|rather than|instead of)\b|\s+(?:is|are|would be)\s+(?:different|better|a good fit)\b)/ig,
    /\bwhy (?:should|would|do|might) (?:I|we)\b.{0,55}\b(?:choose|consider|use|trust|buy from|work with|switch to|go with)\s+(?:you|your company|your factory)\b/ig,
    /\bwhat (?:makes|sets) (?:you|your (?:company|factory|products?))\b.{0,35}\b(?:different|apart|better|special)\b/ig,
    /\bhow (?:are you|is your (?:company|factory)) different\b|\bwhat(?:'s| is) your (?:advantage|value proposition)\b/ig];
  return patterns.some(pattern=>[...line.matchAll(pattern)].some(match=>!reportedPrefix(line.slice(0,match.index).trim())));
}

/** Extract literal requests as attention cues, never as confirmed buyer facts.
 * ASR punctuation is imperfect: recognize explicit question forms without '?' too.
 * Do not turn reported history ('you explained why...') into a fresh question. */
export function analyzeBuyerText(text:string) {
  const questions:string[]=[],requests:string[]=[];
  const pieces=text.slice(0,12000).replace(/\r/g,"").split(/(?<=[?!])\s+|\.(?!\d)(?=\s|$)|[;\n]+/).map(clean).filter(Boolean);
  for(const piece of pieces) {
    const request=piece.match(/\b(?:please\s+)?(?:send|email|share|forward|attach|explain|clarify|tell me|walk me through)\b[\s\S]*/i);
    if(request&&!/\b(?:don't|do not|not asking|no need to)\b/i.test(piece.slice(0,request.index!)))requests.push(request[0]);
    const starts=[...piece.matchAll(/\b(?:why|what|which|how|where|when|who|can you|could you|would you|will you|do you|does your|are you|is your|have you|tell me|explain|(?:want|need|like) to know (?:if|whether)|wondering (?:if|whether))\b/ig)];
    const direct:RegExpMatchArray[]=[];
    for(const match of starts){
      const before=piece.slice(0,match.index).trim();
      if(reportedPrefix(before))continue;
      // Nested "can you tell me what..." is one question, not three.
      if(direct.length&&!/(?:[?!:]|\b(?:and|also|but|so|then|plus))\s*$/i.test(before))continue;
      const line=piece.slice(match.index).trim();
      if(/^(?:which|what|who)\s+(?:is|are|was|were)\s+(?:why|what)\b|^(?:which|who)\s+(?:your|our|their|my|his|her)\b/i.test(line))continue;
      if(line.includes("?")||/^(?:why\b|what(?:'s|\s+(?:is|are|would|do|does|makes|sets|can|kind|grade|spec|price|MOQ|about|company|products?|materials?))|which\b|how\b|where\b|when\b|who\b|(?:can|could|would|will|do|are|have) you\b|(?:does|is) your\b|tell me\b|explain\b|(?:want|need|like) to know\b|wondering\b)/i.test(line))direct.push(match);
    }
    for(const [index,match] of direct.entries()) {
      const line=piece.slice(match.index,direct[index+1]?.index).replace(/[,\s]+\b(?:and|also|but|so|then)\s*$/i,"").trim();
      const same=questions.some(old=>old.toLowerCase()===line.toLowerCase());
      if(!same)questions.push(line.slice(0,700));
    }
  }
  const companyChoice=isCompanyChoiceQuestion(text);
  if(companyChoice&&!questions.some(isCompanyChoiceQuestion)) {
    const piece=pieces.find(isCompanyChoiceQuestion);if(piece)questions.push(piece.slice(0,700));
  }
  return {questions:questions.slice(0,8),requests:[...new Set(requests)].slice(0,6),hasQuestion:questions.length>0,companyChoice};
}

/** Consecutive buyer ASR segments may be one paragraph. Keep all their literal
 * questions; an actual representative turn is a boundary, not a previous script. */
export function buyerQuestionAgendaFor(context:BuyerContext,active?:SpokenTurn) {
  const turns=context.turns||[],index=active?turns.findLastIndex(turn=>turn.id===active.id):turns.length-1;
  const latest=active||turns.at(-1);
  if(!latest||latest.role!=="buyer")return {questions:[] as {turnId?:string;text:string}[],requests:[] as string[],companyChoice:false};
  const preceding=index>=0?turns.slice(0,index):turns;
  const window:SpokenTurn[]=[latest];
  const withdrawsQuestions=hasClearConversationRefusal(latest.text)||/\b(?:never mind|forget (?:that|my question)|leave it there|goodbye)\b/i.test(latest.text);
  if(context.unansweredBuyerQuestions===undefined&&!withdrawsQuestions){
    for(let i=preceding.length-1;i>=0&&window.length<5;i--){
      if(preceding[i].role!=="buyer")break;
      window.unshift(preceding[i]);
    }
  }
  const questions:{turnId?:string;text:string}[]=[],requests:string[]=[];
  // Runtime attention can cross a brief representative context turn. Validate
  // it against literal buyer speech; it cannot supply facts or invent a speaker.
  if(!withdrawsQuestions)for(const item of context.unansweredBuyerQuestions?.slice(-8)||[]){
    const original=turns.find(turn=>turn.id===item.turnId&&turn.role==='buyer'&&turn.at===item.at);
    if(original&&original.text.includes(item.text)&&analyzeBuyerText(item.text).hasQuestion&&!questions.some(question=>question.text.toLowerCase()===item.text.toLowerCase()))questions.push({turnId:item.turnId,text:item.text});
  }
  for(const turn of window){
    const parsed=analyzeBuyerText(turn.text);
    for(const text of parsed.questions)if(!questions.some(item=>item.text.toLowerCase()===text.toLowerCase()))questions.push({turnId:turn.id,text});
    requests.push(...parsed.requests);
  }
  return {questions:questions.slice(-8),requests:[...new Set(requests)].slice(-6),companyChoice:questions.some(item=>isCompanyChoiceQuestion(item.text))};
}

/** A document-delivery request cannot hide another unanswered question in the
 * same uninterrupted buyer paragraph. Keep those questions on the model path. */
function withoutLaterReviewPriceStep(line:string):string {
  // "Then I can get back to you for prices" describes what follows review;
  // it is not a request for a price right now. Do not remove literal questions
  // or technical demands elsewhere in the same buyer paragraph.
  for(const marker of line.matchAll(/\b(?:then|afterwards|after that|once|after)\b/gi)){
    const before=line.slice(0,marker.index),later=line.slice(marker.index);
    if(!/\b(?:review\w*|take a look|look through|look (?:it|them|this|that) over|evaluat\w*)\b/i.test(before+later))continue;
    const future=/\b(?:I|we)(?:'ll|\s+(?:can|will|could|would|may))?\s+(?:(?:get|come)\s+back(?:\s+to\s+you)?\s+(?:for|about|on|regarding|to\s+(?:get|discuss))|talk\s+about|discuss|go\s+over|look\s+at|request|ask\s+for|get)\s+(?:(?:the|your|some)\s+)?(?:prices?|pricing|quotes?|quotations?)\b/i.test(later);
    if(!future)continue;
    const currentQuestion=/\b(?:what|which|who|where|when|why|how|explain|clarify|confirm|verify|tell me|purity|content|percentage|certif\w*|MOQ|minimum order|lead[- ]?time|stock|inventory|ship\w*|deliver\w*|payment|discount\w*|guarantee\w*|free|samples?|CIF|FOB|EXW|DDP|ISO|FDA|REACH|RoHS|ASTM|now|today)\b|\$|\d|\b(?:can|could|would|will|do|does|did|are|is|have|has)\s+(?:you|your|we|I|it|there|the)\b/i.test(later);
    if(!currentQuestion)return before;
  }
  return line;
}
/** A current request for quotation is substantive even without a question mark.
 * Keep this separate from question extraction: attention is not a new queue
 * entry, and reported/future price discussion is not a present request. */
export function currentCommercialRequests(context:BuyerContext):string[] {
  const latest=context.turns?.at(-1);
  if(latest?.role!=='buyer')return [];
  const requests:string[]=[];
  const sentences=latest.text.replace(/[’‘]/g,"'").split(/(?<=[?!])\s+|\.(?!\d)(?=\s|$)|[;\n]+/);
  for(const sentence of sentences){
   let requestObjectList=false;
   for(const raw of sentence.split(/\b(?:and|but|then|also|plus|so|after|once)\b/gi)){
    const clause=raw.trim().replace(/^(?:(?:okay|ok|well|actually|first)[, ]+)+/i,"");
    if(!clause)continue;
    const directive=clause.match(/^(?:please\s+)?(?:(?:give|quote|tell|show|send|email|share|provide)(?:\s+(?:me|us))?|(?:(?:I|we)\s+(?:need|want|would like)|(?:I'd|we'd) like)(?:\s+to\s+(?:get|see|know|have))?)\s+([\s\S]*)$/i);
    if(directive){
      requestObjectList=true;
      if(/\b(?:prices?|pricing|quotes?|quotations?)\b/i.test(directive[1]))requests.push(clause.slice(0,700));
      continue;
    }
    // A coordinated noun object can inherit the request verb ('send a profile
    // and a price'). A new speaker/predicate ends that object list.
    const priceObject=/^(?:(?:a|an|the|your|some|firm|exact|current|best)\s+)*(?:prices?|pricing|quotes?|quotations?)\b/i.test(clause);
    if(requestObjectList&&priceObject)requests.push(clause.slice(0,700));
    else requestObjectList=false;
   }
  }
  return [...new Set(requests)].slice(0,8);
}
export function substantiveBuyerQuestions(context:BuyerContext):string[] {
  const questions=buyerQuestionAgendaFor(context).questions.map(item=>item.text).filter(question=>{
    if(/^how about (?:this|that)[?!:,.\s]*$/i.test(question))return false;
    const remainder=question.replace(/[’‘]/g,"'")
      .replace(/\bhow about\s*(?:(?:this|that)\s*[:,?]?\s*)?/gi,"")
      .replace(/\b(?:can|could|would|will) you\s+(?:please\s+)?(?:also\s+)?(?:send|email|share|forward|attach|include)\b/gi,"send")
      .replace(/\b(?:a )?copy of what (?:you|we) (?:produce|make)\b/gi,"product information");
    const delivery=/\b(?:send|email|share|forward|attach|include)\b.{0,100}\b(?:profile|specs?|specifications?|drawings?|information|info|catalog\w*|brochure|documents?|materials|website|link|product (?:details|range)|technical data sheets?)\b/i.test(remainder);
    const current=delivery?withoutLaterReviewPriceStep(remainder):remainder;
    return !delivery||/\b(?:what|which|who|where|when|why|how|explain|clarify|confirm|verify|tell me|purity|content|percentage|certif\w*|MOQ|minimum order|lead[- ]?time|stock|inventory|ship\w*|deliver\w*|payment|discount\w*|guarantee\w*|free|samples?|CIF|FOB|EXW|DDP|ISO|FDA|REACH|RoHS|ASTM|prices?|quotes?|quotation)\b/i.test(current)
      ||/(?:^|[.!?;:]\s*|\b(?:and|but)\s+)(?:can|could|would|will|do|does|did|are|is|have|has)\s+(?:you|your|we|I|it|there)\b/i.test(current);
  });
  return [...new Set([...questions,...currentCommercialRequests(context)])];
}

export function spokenReplyBudget(context:BuyerContext) {
  const turn=[...(context.turns||[])].reverse().find(item=>item.role!=="you");
  const questions=turn?.role==="buyer"?buyerQuestionAgendaFor(context,turn).questions:turn?analyzeBuyerText(turn.text).questions:[];
  if(turn?.role==='buyer'&&/\bCIF\b/i.test(turn.text)&&/\b(?:price|pricing|quote|quotation|cost|number|figure)\b/i.test(turn.text)&&classifyBuyerTurn({turns:context.turns}).kind==='fact_request')return {words:35,sentences:2};
  // A short on-demand opener may contain identity, purpose and an advancing
  // question. Keep the whole useful move rather than silently cutting sentence3.
  if(context.coachingRequest)return {words:60,sentences:4};
  // Multiple explicit questions need room for answers; don't silently truncate
  // their second/third answers under the normal single-question sentence limit.
  if(questions.length>1)return {words:60,sentences:4};
  // A reviewed returning conversation may need recap + actual status + one
  // advancing question. Keep all three instead of silently discarding the move.
  const client=context.clientContext;
  if(client?.isReturning&&client.reviewedAt>0&&!!client.preparationFingerprint&&client.companyId===context.manufacturer?.id&&client.callId===context.callId&&classifyBuyerTurn({turns:context.turns}).kind!=='fact_request')return {words:60,sentences:3};
  // A human-reviewed Why can explicitly require a substantive product reaction
  // AND a complete document/email handoff. Retain that learned move instead of
  // cutting off its email question at the old two-sentence limit. The exact
  // resolved moment and current company are required: stored examples alone
  // never enlarge an unrelated turn or an unresolved factual/CIF response.
  const moment=context.foundation?.momentType;
  const matchedFullerLesson=moment&&moment!=='price_spec_stall'&&classifyBuyerTurn({turns:context.turns}).kind!=='fact_request'
    &&context.manufacturer?.id&&context.brain?.companyId===context.manufacturer.id
    &&context.brain.learningExamples?.some(example=>{
      const lesson=example.structuredLesson;
      return lesson?.reviewStatus==='active'&&lesson.momentType===moment
        &&!!(example.learningExplanation||lesson.explanation||'').trim()
        &&(!context.conversationState?.stageId||!example.stageId||example.stageId===context.conversationState.stageId)
        &&lesson.tags?.some(tag=>['grounded_specificity','preserve_selected_items','explain_relevant_offer'].includes(tag));
    });
  return matchedFullerLesson?{words:60,sentences:4}:{words:35,sentences:2};
}

export const BUYER_QUESTION_RULES="\nBUYER QUESTIONS: Read the whole current paragraph and the literal question agenda before selecting a move. Answer the buyer's explicit question(s), not just the last sentence or a keyword such as supplier/price. Answer a why-us challenge with relevant sourced reasons and their limits; do not substitute generic discovery or an invented advantage. For several questions, briefly cover each supported answer, explicitly park any unresolved company detail, and ask at most one clarification only if needed. Do not silently drop earlier questions when the buyer adds context, and do not answer a withdrawn question. Multiple explicit questions permit up to 60 words/four short sentences; otherwise keep 35 words/two sentences. The agenda is an attention aid, not proof that a request was accepted or answered.";
