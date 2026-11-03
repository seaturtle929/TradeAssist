import type {CallParticipant} from './call-participant.ts';

export const BUYER_NEED_KEYS=['application','difficulty','impact','priority','evaluation','timing','current_supplier'] as const;
export type BuyerNeedKey=typeof BUYER_NEED_KEYS[number];
export const BUYER_NEED_LABELS:Record<BuyerNeedKey,string>={application:'Current use',difficulty:'Stated difficulty',impact:'Practical effect',priority:'Buyer priority',evaluation:'Approval criteria',timing:'Timing',current_supplier:'Current supplier'};
export type BuyerNeedEvidence={value:string;turnId:string;quote:string;source:'transcript'|'context';status:'confirmed'|'prepared';segmentId?:string};
export type BuyerNeedFact=BuyerNeedEvidence&{key:BuyerNeedKey};
export type BuyerInterest={kind:'unknown'|'information'|'comparison'|'backup'|'replacement';status:'unknown'|'confirmed'|'possible'|'prepared';evidence?:BuyerNeedEvidence};
export type BuyerNeeds={facts:Partial<Record<BuyerNeedKey,BuyerNeedFact>>;interest:BuyerInterest;addressedTopics:string[];askedTopics:string[];declinedTopics:string[];earlierContactFacts:BuyerNeedFact[];segmentId?:string};
type NeedTurn={id?:string;role:string;text:string};
type NeedsInput={turns?:NeedTurn[];callContext?:{knownFacts?:string;doNotGuess?:string};participant?:CallParticipant;seed?:BuyerNeeds;processedTurnIds?:string[]};
const normalized=(value:string)=>value.replace(/[’‘]/g,"'").replace(/\s+/g,' ').trim();
const unique=(values:string[])=>[...new Set(values)].slice(-24);
const blank=():BuyerNeeds=>({facts:{},interest:{kind:'unknown',status:'unknown'},addressedTopics:[],askedTopics:[],declinedTopics:[],earlierContactFacts:[]});
const sentences=(text:string)=>text.match(/[^!?]+?(?:[!?]+(?=\s|$)|\.(?!\d)(?=\s|$)|$)/g)?.map(line=>line.trim()).filter(Boolean)||[text.trim()];
const question=(line:string)=>line.includes('?')||/^(?:what|which|when|where|why|how|do you|are you|can you|could you|would you|is there)\b/i.test(line);
const supplier=/\b(?:supplier|vendor|sourcing partner|source)\b/i;
const noDifficulty=/\b(?:no (?:real |major |particular |quality |delivery )?(?:issues?|problems?|trouble|concerns?|difficulties|late deliveries)|(?:not|isn't|aren't|wasn't) (?:an? |the )?(?:issue|problem|concern|late|inconsistent)|never (?:late|had (?:an? )?(?:issue|problem)))\b/i;
const intentTargets={replacement:/\b(?:replace|replacement|changing|switching|new supplier|different supplier)\b/i,backup:/\b(?:backup|back-up|second source|additional source|alternative source|another source|additional supplier|second supplier|another supplier|new supplier|new source)\b/i,comparison:/\b(?:compar\w*|benchmark\w*|second quote|another quote|quote)\b/i,information:/\b(?:profile|specs?|information|info|catalog\w*|brochure|documents?|materials|website|link)\b/i};
/** Declining a switch does not decline a separate, tentative comparison. */
export function hasTentativeComparisonInterest(text:string):boolean {
 const tail=normalized(text).split(/\b(?:but|however|although)\b/i).slice(1).join(' ');
 return !!tail&&!/\b(?:don't|do not|not|never|won't|will not)\b.{0,20}\b(?:compare|review|consider|look)\b/i.test(tail)&&/\b(?:might|could|would|can|may|open to|willing to|interested in)\b.{0,35}\b(?:compare|comparison|quote|review|consider|look at|take a look)\b/i.test(tail);
}
function targetNegation(line:string,target:RegExp) {
 const matches=[...line.matchAll(new RegExp(target.source,'ig'))];
 const negated=matches.map(match=>{
  const at=match.index!,before=line.slice(Math.max(0,at-80),at).split(/\b(?:but|however|although|yet)\b/i).at(-1)||'',after=line.slice(at+match[0].length).split(/\b(?:but|however|although|yet)\b|[.!?;]/i)[0].slice(0,90);
  return /\b(?:not|never|don't|do not|aren't|are not|isn't|is not|no longer|no interest in|no need (?:for|to)|without)\b[^.!?;]{0,65}$/i.test(before)||/^\s*(?:(?:source|supplier|vendor|option|quote|quotation|information|profile)\s+){0,2}(?:(?:is|are|would be)\s+not\b|isn't\b|aren't\b|wouldn't\b|(?:is |are )?not (?:what|something|needed|necessary|useful|helpful)\b)/i.test(after);
 });
 return {found:matches.length>0,positive:negated.some(value=>!value),onlyNegative:negated.length>0&&negated.every(Boolean)};
}

/** Topics are question targets, not a fixed interview or a claim the buyer has a problem. */
export function buyerNeedTopicsForQuestion(text:string):string[] {
 const line=normalized(text),topics:string[]=[];
 if(!/\b(?:how much|how many|how often|volume|quantit\w*|price|cost)\b/i.test(line)&&/\b(?:what|which|how|tell|describe)\b.{0,70}\b(?:use|using|application|products? (?:do|are)|material|make|manufacture|buy|buying)\b|\b(?:what|which)\b.{0,40}\b(?:grades?|particle sizes?|specifications?)\b/i.test(line))topics.push('application');
 if(/\b(?:problem|difficult|challeng|issue|frustrat|trouble)\w*\b/i.test(line))topics.push('difficulty');
 if(/\b(?:affect\w*|impact|happens?|consequence\w*|cost you|costs you|mean for|effect|production (?:stop|delay))\b/i.test(line))topics.push('impact');
 if(/\b(?:matter(?:s)? most|most important|priorit\w*|important (?:to|for) you|looking for in|worth (?:considering|reviewing|exploring)|useful (?:to|for) you|need (?:most|first)|want to (?:change|improve|reduce)|(?:most )?like to (?:change|improve|reduce))\b/i.test(line))topics.push('priority');
 if(/\b(?:approv\w*|evaluat\w*|qualif\w*|demonstrat\w*|prove|requirements? (?:for|from) (?:a |any |another |new )?supplier|quality checks?|test(?:ing)? (?:a |any |another |new )?(?:supplier|material|product)|documentation|certifications?)\b/i.test(line))topics.push('evaluation');
 if(/^(?:(?:and|so)\s+)?when\b|\b(?:how often|schedule|timing|timeframe|time frame|delivery window|next order|next purchase|purchase cycle)\b/i.test(line))topics.push('timing');
 if(/\b(?:current|existing|already)\b.{0,35}\b(?:supplier|vendor|source)\b|\b(?:do you|are you|have you)\b.{0,35}\b(?:have|use|work with)\b.{0,25}\bsupplier\b/i.test(line))topics.push('current_supplier');
 if(/\bhow\b.{0,25}\b(?:arrangement|relationship|supplier|vendor)\b.{0,35}\b(?:working|worked|going|performing)\b|\bhow (?:is|has) (?:that|this) (?:working|worked) (?:out )?for you\b/i.test(line))topics.push('difficulty','current_supplier','supplier_experience');
 if(/\bhow\b.{0,25}\b(?:material|product)\b.{0,35}\b(?:working|worked|performing)\b/i.test(line))topics.push('difficulty','application_experience');
 if(/\b(?:backup|back-up|replace|replacement|another source|additional source|alternative source|second source|another supplier|additional supplier|compare|comparison|second quote)\b/i.test(line))topics.push('interest');
 if(/\b(?:current|target|paid|paying|pay|purchase|buying)\b.{0,30}\b(?:price|cost)\b|\bprice\b/i.test(line))topics.push('price');
 if(/\b(?:volume|quantity|quantities|tons?|tonnes?|how much|how many)\b/i.test(line))topics.push('volume');
 if(/\b(?:grades?|particle sizes?|specifications?|specs?)\b/i.test(line))topics.push('specs');
 if(/\b(?:email|e-mail|phone number|contact details)\b/i.test(line))topics.push('email');
 return unique(topics);
}

function classifications(raw:string):BuyerNeedKey[] {
 const line=normalized(raw),keys:BuyerNeedKey[]=[];
 if(question(line))return keys;
 if(/^(?:(?:well|okay|ok)[,.]?\s*)?(?:I|we)(?:'ll| will| would| still)? (?:need|want|have) to (?:think|consider)(?: about (?:it|that|this))?[.!\s]*$/i.test(line)||/^(?:let me think|I'm not sure|I am not sure|we're not sure|we are not sure|I don't know|we don't know)[.!\s]*$/i.test(line))return keys;
 const hypothetical=/^(?:if|suppose|supposing|hypothetically|imagine)\b/i.test(line);
 if(hypothetical)return keys;
 const currentUse=/\b(?:we (?:use|buy|purchase|source|make|manufacture|sell|distribute)|our (?:application|products?|production (?:process|uses?))|(?:it|this|the material) (?:is used|goes) (?:for|in))\b/i;
 if(currentUse.test(line))keys.push('application');
 if(!hypothetical&&!noDifficulty.test(line)&&/\b(?:we (?:have|face|experience)|our|I'm|I am|we're|we are)\b.{0,65}\b(?:issues?|problems?|trouble|concerns?|difficult\w*|frustrat\w*|struggl\w*)\b|\b(?:deliveries|shipments?|orders?)\b.{0,40}\b(?:late|delayed|unreliable)\b|\b(?:late deliveries|batch.to.batch variation|inconsistent (?:quality|material|batches|results)|quality (?:problems|issues)|reject(?:ed|ion) (?:batches|rates))\b/i.test(line))keys.push('difficulty');
 if(!hypothetical&&/\b(?:we (?:keep|hold|carry|need) (?:extra|additional|more|safety) (?:stock|inventory)|(?:ties|tying|tied) up (?:our |extra )?(?:cash|capital|money)|(?:stop\w*|delay\w*|interrupt\w*|hold\w* up) (?:our |the )?production|production (?:stops?|delays?|downtime)|costs? us|we (?:lose|lost) (?:orders|customers|production|money)|miss(?:ed|ing)? (?:our )?(?:deadlines|orders)|cash (?:is )?tied up)\b/i.test(line))keys.push('impact');
 if(/\b(?:our (?:main|biggest|top|primary) (?:priority|concern|focus)|(?:most important|matters most|comes first)|(?:consistency|quality|price|cost|delivery|reliability|flexibility|documentation|safety) (?:is (?:very |really |especially )?(?:important|critical|essential|the priority)|matters)|we (?:want|need|would like)|we'd like|I'm looking for|I am looking for)\b/i.test(line))keys.push('priority');
 if(/\b(?:our (?:engineers?|quality team|technical team|purchasing team) (?:needs?|must|has to|have to)|we (?:need|require)\b.{0,70}\b(?:approval|documentation|certif\w*|COA|test\w*|validation|specification)|(?:before|to) (?:we )?(?:approve|approving|qualify|qualifying|consider|considering|test|testing) (?:a |any |another |new )?(?:supplier|source|material)|(?:supplier|factory) (?:approval|qualification|evaluation)|(?:our|the) approval process)\b/i.test(line))keys.push('evaluation');
 if(/\b(?:our (?:next )?(?:order|purchase|production|buying|procurement) (?:is|starts?|begins?|schedule|cycle)|we (?:order|buy|purchase|place orders) (?:every|each|weekly|monthly|quarterly)|we (?:need|require|want)\b.{0,70}\b(?:by|before|within|next (?:week|month|quarter|year))|we(?:'re| are) (?:ordering|buying|reviewing)\b.{0,60}\b(?:next|this|in |by ))\b/i.test(line))keys.push('timing');
 if(/\b(?:we (?:already )?(?:have|use|work with|buy from) (?:an? |our |the )?(?:current |existing |regular |local )?(?:supplier|vendor)|our (?:current |existing )?(?:supplier|vendor)|(?:happy|satisfied|fully covered)\b.{0,40}\b(?:supplier|vendor))\b/i.test(line))keys.push('current_supplier');
 return [...new Set(keys)];
}

function interestFor(raw:string,evidence:BuyerNeedEvidence):BuyerInterest|undefined {
 const line=normalized(raw);
 // A negative or merely informational supplier mention is not an invitation to sell a replacement.
 const affirmative=/\b(?:we|I)\b.{0,30}\b(?:want|need|looking|interested|consider|compare|open to|would like)|\b(?:we'd|I'd) (?:like|consider)|\b(?:would be|could be|might be|may be|sounds?) (?:useful|helpful|worthwhile|good)|\b(?:can|could) you (?:be|provide)|\b(?:send|email|share|give) (?:me|us)\b/i.test(line);
 const tentative=/\b(?:maybe|might|may|possibly|potentially|could|if|would consider)\b/i.test(line);
 const status=evidence.source==='context'?'prepared':tentative?'possible':'confirmed';
 if(affirmative&&targetNegation(line,/\b(?:replace|replacing|replacement)\b|\b(?:switch|switching|change|changing)\b.{0,30}\bsuppliers?\b/i).positive)return {kind:'replacement',status,evidence};
 if(affirmative&&targetNegation(line,/\b(?:backup|back-up) (?:source|supplier|vendor)\b|\b(?:source|supplier|vendor) as (?:a )?(?:backup|back-up)\b|\b(?:second source|additional source|alternative source|additional supplier|second supplier)\b/i).positive)return {kind:'backup',status,evidence};
 if(affirmative&&targetNegation(line,/\b(?:compar\w*|benchmark\w*|second quote|another quote)\b/i).positive)return {kind:'comparison',status,evidence};
 if(/\b(?:send|email|share|forward|attach)\b.{0,75}\b(?:profile|specs?|information|info|catalog\w*|brochure|documents?|materials|website|link)\b/i.test(line)&&targetNegation(line,intentTargets.information).positive)return {kind:'information',status,evidence};
 return;
}

function statementEvidence(turn:NeedTurn,key:BuyerNeedKey,snippet:string,source:'transcript'|'context',segmentId?:string):BuyerNeedFact {
 return {key,value:snippet.slice(0,360),turnId:turn.id||'unidentified-buyer-turn',quote:snippet.slice(0,600),source,status:source==='context'?'prepared':'confirmed',...(segmentId?{segmentId}:{})};
}

function applyTurns(result:BuyerNeeds,turns:NeedTurn[],source:'transcript'|'context',unknowns='') {
 let pendingTopics:string[]=[];
 for(const turn of turns){
  const raw=turn.text?.trim();if(!raw)continue;
  if(turn.role==='you'){
   pendingTopics=question(raw)?buyerNeedTopicsForQuestion(raw):[];
   result.askedTopics=unique([...result.askedTopics,...pendingTopics]);continue;
  }
  if(turn.role!=='buyer')continue; // Mixed room audio is not confirmed buyer speech.
  const refusal=/\b(?:cannot|can't|won't|will not|rather not|not comfortable|prefer not|don't want to|do not want to)\b.{0,55}\b(?:share|disclose|provide|give|discuss|answer|say)\b|\b(?:not interested|no thanks|no thank you|don't call|do not call|stop calling|fully covered for now|not looking (?:for|to)|not considering)\b|\b(?:don't|do not|no longer) need\b.{0,50}\b(?:supplier|source|quote|comparison|backup|replacement)\b/i.test(normalized(raw));
  if(refusal){
   const permittedComparison=hasTentativeComparisonInterest(raw)&&!/\b(?:stop calling|do not call|don't call|no thanks|not interested)\b/i.test(raw);
   const negativePart=permittedComparison?raw.split(/\b(?:but|however|although)\b/i)[0]:raw;
   const scopedSwitchBoundary=/\b(?:not interested in|not looking to|not considering|don't want to|do not want to)\b.{0,35}\b(?:switch\w*|chang\w*|replac\w*)\b/i.test(raw);
   const explicit=buyerNeedTopicsForQuestion(negativePart),targets=scopedSwitchBoundary?['replacement']:explicit.length?explicit:permittedComparison?['replacement']:pendingTopics;
   const closesConversation=/\b(?:not interested\b(?!\s+(?:in|to)\b)|no thanks|no thank you|don't call|do not call|stop calling)\b/i.test(raw);
   result.declinedTopics=unique([...result.declinedTopics,...targets,...closesConversation?['interest','discovery']:targets.length?[]:['discovery']]);
  }
  const line=normalized(raw),globalNo=/\b(?:not interested\b(?!\s+(?:in|to)\b)|no thanks|no thank you|don't call|do not call|stop calling|fully covered for now)\b/i.test(line);
  const priorTarget=result.interest.kind==='unknown'?undefined:intentTargets[result.interest.kind];
  if(globalNo||priorTarget&&targetNegation(line,priorTarget).onlyNegative)result.interest={kind:'unknown',status:'unknown'};
  const pieces=source==='context'?raw.split(/\n+/).flatMap(line=>sentences(line)):sentences(raw);
  for(const snippet of pieces){
   const keys=classifications(snippet);
   if(source==='context'){
    const label=snippet.match(/^\s*(current use|application|buyer priority|priority|difficulty|problem|impact|practical effect|evaluation|approval criteria|timing|current supplier)\s*:/i)?.[1]?.toLowerCase();
    const labelled:Record<string,BuyerNeedKey>={'current use':'application',application:'application','buyer priority':'priority',priority:'priority',difficulty:'difficulty',problem:'difficulty',impact:'impact','practical effect':'impact',evaluation:'evaluation','approval criteria':'evaluation',timing:'timing','current supplier':'current_supplier'};
    if(label&&labelled[label]&&!keys.includes(labelled[label]))keys.push(labelled[label]);
   }
   if(source==='transcript'&&noDifficulty.test(snippet)&&result.facts.difficulty){
    const topical=/\b(?:delivery|deliveries|quality|consistency|material|batches|supplier|production)\b/gi;
    const topics=snippet.match(topical)||[],prior=result.facts.difficulty.quote.toLowerCase().replace(/deliver(?:y|ies)/g,'deliver');
    if(!topics.length||topics.some(topic=>prior.includes(topic.toLowerCase().replace(/deliver(?:y|ies)/g,'deliver'))))delete result.facts.difficulty;
   }
   // A direct short answer can fill the immediately preceding actual question.
   // "Yes" alone never supplies a need, supplier intention or purchase interest.
   const short=!question(snippet)&&(snippet.match(/\S+/g)?.length||0)<=28&&!/^(?:yes|yeah|yep|no|nope|okay|ok|sure|right|correct|go ahead|I'm listening|I am listening|please continue)[,.!\s]*$/i.test(normalized(snippet));
   if(source==='transcript'&&short&&!refusal&&!keys.length&&!/\b(?:not sure|don't know|do not know|need to think|let me think|haven't decided)\b/i.test(normalized(snippet))){
    const neutralExperience=pendingTopics.some(topic=>topic==='supplier_experience'||topic==='application_experience');
    const key=neutralExperience?pendingTopics.includes('supplier_experience')?'current_supplier':undefined:(['impact','evaluation','priority','timing','difficulty','current_supplier','application'] as const).find(topic=>pendingTopics.includes(topic));
    if(key&&!(key==='current_supplier'&&!supplier.test(snippet)&&!pendingTopics.includes('supplier_experience'))&&!(key==='difficulty'&&noDifficulty.test(snippet)))keys.push(key);
    if(neutralExperience)result.addressedTopics=unique([...result.addressedTopics,...pendingTopics.filter(topic=>topic.endsWith('_experience'))]);
   }
   for(const key of keys){
    if(source==='context'&&unknowns&&new RegExp(`\\b(?:${key.replace(/_/g,' ')}|${BUYER_NEED_LABELS[key].toLowerCase()})\\b`,'i').test(unknowns))continue;
    const evidence=statementEvidence(turn,key,snippet,source,result.segmentId);
    if(source==='context'&&result.facts[key]?.source==='transcript')continue;
    result.facts[key]=evidence;result.addressedTopics=unique([...result.addressedTopics,key]);
   }
   const {key:_key,...evidence}=statementEvidence(turn,'priority',snippet,source,result.segmentId),interest=interestFor(snippet,evidence);
   const retainGoal=interest?.kind==='information'&&!['unknown','information'].includes(result.interest.kind);
   if(interest&&!retainGoal&&(source==='transcript'||result.interest.status==='unknown'||result.interest.status==='prepared'))result.interest=interest;
  }
  pendingTopics=[];
 }
}

/** Current-call-only, bounded evidence ledger; no generated summaries or model calls. */
export function deriveBuyerNeeds({turns=[],callContext,participant,seed,processedTurnIds=[]}:NeedsInput):BuyerNeeds {
 const segmentId=participant?.segmentStartTurnId;
 const sameSegment=!!seed&&seed.segmentId===segmentId;
 const result=sameSegment?structuredClone(seed):blank();result.segmentId=segmentId;
 if(seed&&!sameSegment)result.earlierContactFacts=[...seed.earlierContactFacts,...Object.values(seed.facts).filter(fact=>fact?.source==='transcript')].slice(-8) as BuyerNeedFact[];
 const segmentIndex=segmentId?turns.findIndex(turn=>turn.id===segmentId):-1;
 const earlier=participant?.afterTransfer&&segmentIndex>=0?turns.slice(0,segmentIndex):[];
 if(earlier.length){const history=blank();applyTurns(history,earlier,'transcript');result.earlierContactFacts=[...result.earlierContactFacts,...Object.values(history.facts)].filter((fact,index,list)=>list.findIndex(item=>item.key===fact.key&&item.turnId===fact.turnId)===index).slice(-8) as BuyerNeedFact[];}
 const current=participant?.afterTransfer&&segmentIndex>=0?turns.slice(segmentIndex):turns;
 if(callContext?.knownFacts?.trim())applyTurns(result,[{id:'call-context',role:'buyer',text:callContext.knownFacts}],'context',callContext.doNotGuess);
 applyTurns(result,sameSegment?current.filter(turn=>!turn.id||!processedTurnIds.includes(turn.id)):current,'transcript');
 result.addressedTopics=unique(result.addressedTopics);result.askedTopics=unique(result.askedTopics);result.declinedTopics=unique(result.declinedTopics);
 return result;
}
