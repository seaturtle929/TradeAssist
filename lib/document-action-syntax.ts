export type DocumentActionSpan={start:number;end:number;text:string};
export type DocumentActionSyntax=DocumentActionSpan&{
 actor:'salesperson'|'buyer'|'unspecified';
 grammaticalSubject:string;
 voice:'active'|'passive';
 speechAct:'commitment'|'offer'|'permission_question'|'negated'|'incoming'|'readiness'|'non_delivery';
 governingPredicate:string;
 object:DocumentActionSpan&{kind:'document'|'pronoun'|'result'|'non_document'|'unresolved'};
 /** The grammatical action's extent, not a factual proof or release grant. */
 scope:DocumentActionSpan;
 complements:DocumentActionSpan;
 conditions:DocumentActionSpan[];
 documentDelivery:boolean;
};
type Options={speaker?:'salesperson'|'buyer'};
const actionVerb='(?:send(?:ing)?|email(?:ing)?|shar(?:e|ing)|forward(?:ing)?|includ(?:e|ing)|attach(?:ing)?|reply(?:ing)?|respond(?:ing)?)';
const documentHead=/\b(?:reports?|documents?|drawings?|blueprints?|diagrams?|files?|attachments?|specifications?(?:\s+sheets?)?|specs?(?:\s+sheets?)?|sheets?|profiles?|catalog(?:ue)?s?|brochures?|certificates?|certifications?|packets?|quotes?|quotations?|website(?:\s+link)?)\b/i;
const resultNoun='(?:product\\s+(?:information|info|details|range|overview)|results?|answers?|findings?|outcomes?|confirmation|updates?|details|information|info)';
const conditional=/\b(?:(?:only\s+)?(?:if|after|once|when)|until|unless|provided(?:\s+that)?|as long as|before|subject to|upon)\b/gi;
const span=(text:string,start:number,end:number):DocumentActionSpan=>({start,end,text:text.slice(start,end)});
function statementBounds(text:string,index:number){
 let start=0,end=text.length;
 for(let i=0;i<text.length;i++){
  if(!/[.!?;]/.test(text[i])||text[i]==='.'&&!/\s|^$/.test(text[i+1]||''))continue;
  if(i<index)start=i+1;else{end=i+1;break;}
 }
 return {start,end};
}
function conditionSpans(text:string,start:number,end:number){
 const result:DocumentActionSpan[]=[];
 for(const match of text.slice(start,end).matchAll(conditional)){
  const at=start+(match.index||0),tail=text.slice(at,end),boundary=tail.search(/[,;.!?]/);
  const stop=boundary<0?end:at+boundary;
  if(!result.some(item=>item.start<=at&&item.end>=stop))result.push(span(text,at,stop));
 }
 return result;
}
function actorFor(subject:string,options:Options):DocumentActionSyntax['actor']{
 const speaker=options.speaker||'salesperson';
 return /^(?:I|we)$/i.test(subject)?speaker:/^you$/i.test(subject)?speaker==='salesperson'?'buyer':'salesperson':'unspecified';
}
function governingContext(parent:string,passive=false){
 const main=parent.replace(/^\s*(?:as|before|after|once|when|if|unless|provided(?: that)?|as long as)\b[^;.!?]*,\s*/i,''),independent=/\b(?:and|but|however|then|now)\s*$/i.test(main);
 const inquiry=new RegExp('\\b(?:check|find out|ask|decide|learn|see|confirm|verify)\\b[^,;.!?]*\\b(?:whether|if)'+(passive?'\\b[^,;.!?]*$':'\\s*$'),'i').test(main);
 const quoteText=main.replace(/(?<=[a-z])['’](?=[a-z])/gi,''),insideQuote=(quoteText.match(/["“”]/g)||[]).length%2===1||(quoteText.match(/['‘’]/g)||[]).length%2===1;
 const reported=/\b(?:said|says|told|asked|wrote|quoted|reported|mentioned|explained|suggested|recalled|claimed)\b[^;.!?]*$/i.test(main);
 const hypothesis=!independent&&(/^\s*(?:if|whether|when|once|before|after|unless|suppose|imagine)\b[^,;.!?]*$/i.test(main)||/\b(?:think|believe)\s*$/i.test(main));
 return {inquiry:!independent&&inquiry,reported:insideQuote||!independent&&reported,hypothesis};
}
/** Attribution/scope for an explicitly located grammatical subject. Existing
 * narrow action resolvers can share this without inventing another actor or
 * a reported-speech word list. This does not prove the following action. */
export function documentActionIsEmbedded(text:string,subjectStart:number):boolean{
 const line=text.replace(/[’‘]/g,"'"),bounds=statementBounds(line,subjectStart),governor=governingContext(line.slice(bounds.start,subjectStart));
 return governor.reported||governor.inquiry||governor.hypothesis;
}
export function directDocumentActionObject(text:string,start:number,end:number,verb:string):DocumentActionSyntax['object']{
 let at=start;while(at<end&&/\s/.test(text[at]))at++;
 if(/^(?:reply|respond)/i.test(verb)){
  const withObject=/^with\s+/i.exec(text.slice(at,end));
  if(!withObject)return {...span(text,at,at),kind:'result'};
  at+=withObject[0].length;
 }
 const tail=text.slice(at,end),condition=conditional.exec(tail);conditional.lastIndex=0;
 const objectEnd=condition?at+condition.index:end;
 const recipient=/^(?:you|us|me|them)\s+(?=(?:(?:the|that|this|a|an|our|your)\s+)|(?:report|document|drawing|file)\b)/i.exec(text.slice(at,objectEnd));if(recipient)at+=recipient[0].length;
 const rawObject=text.slice(at,objectEnd).replace(/[,.!?;]\s*$/,'').trimEnd(),boundary=/\s+(?:to|for|with|about|in|because|so|and|but|however|then|that|which)\b/i.exec(rawObject),objectText=boundary?rawObject.slice(0,boundary.index):rawObject;
 const pronoun=/^(?:it|them|both|one)\b/i.exec(objectText);
 if(pronoun)return {...span(text,at,at+pronoun[0].length),kind:'pronoun'};
 const result=new RegExp('^(?:(?:the|our|your|that|this)\\s+)?'+resultNoun+'\\b','i').exec(objectText);
 const noun=result?{index:0,0:result[0]}:documentHead.exec(objectText);
 if(noun&&!/[,:;.!?]|\b(?:I|we|you|they|he|she|will|can|have|has|is|are|was|were|said|ask|want|need|check)\b/i.test(objectText.slice(0,noun.index))){
  let stop=noun.index+noun[0].length,hasDocument=!result;
  // A coordinated object list shares this action; a coordinated new predicate
  // does not. Extend only through complete neighboring document noun phrases.
  for(;;){
   const separator=/^(?:\s*,\s*(?:and\s+)?|\s+and\s+)/i.exec(rawObject.slice(stop));if(!separator)break;
   const next=rawObject.slice(stop+separator[0].length),head=new RegExp(documentHead.source+'|\\b'+resultNoun+'\\b','i').exec(next);if(!head)break;
   const prefix=next.slice(0,head.index);
   if(/[,:;.!?]|\b(?:I|we|you|they|he|she|will|can|have|has|is|are|was|were|said|ask|want|need|check|send|email|to|for|with|about|because|so|and|but|then)\b/i.test(prefix))break;
   hasDocument=hasDocument||documentHead.test(head[0]);
   stop+=separator[0].length+head.index+head[0].length;
  }
  return {...span(text,at,at+stop),kind:hasDocument?'document':'result'};
 }
 const demonstrative=/^(?:that|this|these|those)(?=$|\s+(?:(?:right|straight)\s+)?(?:over|back|along)\b)/i.exec(objectText);if(demonstrative)return {...span(text,at,at+demonstrative[0].length),kind:'pronoun'};
 if(!objectText||/^(?:(?:right\s+)?(?:over|along|back)|to\b|with\b)/i.test(objectText))return {...span(text,at,at),kind:'unresolved'};
 const nonDocument=/^(?:(?:my|our|your|the|this|that|a|an)\s+)?(?:thoughts?|concerns?|opinions?|ideas?|interest|appreciation|thanks|regards|feedback|discussion|conversation|meeting|review|engineers?|managers?|buyers?|colleagues?|team|contacts?|persons?|people|suppliers?)$/i.test(objectText);
 return {...span(text,at,at+objectText.length),kind:nonDocument?'non_document':'unresolved'};
}
/** Grammatical evidence for document actions, not permission or factual
 * support. A future subject alone cannot turn every later matching word into
 * its predicate: FORWARD is an action in “forward it”, but an adverb governed
 * by MOVE in “move forward”. Objects, modal force and condition spans remain
 * separate for the callers that check evidence, release rules and memory. */
export function analyzeDocumentActionSyntax(text:string,options:Options={}):DocumentActionSyntax[]{
 const line=text.replace(/[’‘]/g,"'"),found:DocumentActionSyntax[]=[];
 const subjects=[...line.matchAll(/\b(I|we|you)('ll|\s+(?:will(?:\s+not)?|can(?:not)?|could|would|won't|can't|do not|don't))\b/gi)].map(match=>({start:match.index||0,end:(match.index||0)+match[0].length,subject:match[1],modal:match[2].trim(),question:false}));
 for(const match of line.matchAll(/\b(can|could|may|would|will|shall)\s+(I|we|you)\b/gi))subjects.push({start:match.index||0,end:(match.index||0)+match[0].length,subject:match[2],modal:match[1],question:true});
 subjects.sort((a,b)=>a.start-b.start);
 for(let index=0;index<subjects.length;index++){
  const subject=subjects[index],bounds=statementBounds(line,subject.start),next=subjects[index+1];
  const end=next&&next.start<bounds.end?next.start:bounds.end,body=line.slice(subject.end,end);
  for(const verb of body.matchAll(new RegExp('\\b'+actionVerb+'\\b','gi'))){
   const start=subject.end+(verb.index||0),verbEnd=start+verb[0].length,before=body.slice(0,verb.index);
   const coordinators=[...before.matchAll(/\b(?:and|but|then|however)\b/gi)],coordinator=coordinators.at(-1);
   let prefix=(coordinator?before.slice((coordinator.index||0)+coordinator[0].length):before).trim().replace(/^[,\s]+/,'');
   // A fronted prerequisite may govern this coordinated action; retain it
   // separately rather than mistaking its words for the action's predicate.
   prefix=prefix.replace(/^(?:(?:only\s+)?(?:if|after|once|when)|unless|provided(?:\s+that)?|as long as)\s+[^,;.!?]+,\s*/i,'');
   const assurance=/^(?:(?:[a-z]+ly|just|also|always|still)\s+)*(?:be|make)\s+sure\s+to$/i.test(prefix);
   // Same-subject controlled complements still propose the actual delivery.
   // Willingness/readiness is an offer, not a completed send or firm promise;
   // a different embedded actor or an inquiry is excluded separately below.
   const willingness=/^(?:(?:[a-z]+ly|just|also|always|still)\s+)*be\s+(?:happy|willing|ready|prepared|able)\s+to$/i.test(prefix);
   const dispatchControl=/^(?:(?:[a-z]+ly|just|also|always|still)\s+)*(?:proceed|arrange)\s+to$/i.test(prefix);
   const head=assurance||willingness||dispatchControl||/^(?:(?:will|can|could|would|may|might|shall|be|start|begin|continue|just|also|then|still|always|already|only|even|soon|now|[a-z]+ly|not|never)\s+)*$/i.test(prefix?prefix+' ':'');
   const progressive=!/ing$/i.test(verb[0])||/\b(?:be|start|begin|continue)\s+(?:\w+ly\s+)*$/i.test(prefix+' ');
   const parent=line.slice(bounds.start,subject.start),governor=governingContext(parent),embeddedInquiry=governor.inquiry||governor.hypothesis,reported=governor.reported;
   const reset=coordinator&&(/^(?:but|however)$/i.test(coordinator[0])||/^(?:will|can|could|would)\b/i.test(prefix));
   // In the complete NOT ONLY … BUT ALSO construction, the first NOT marks
   // additive focus, not refusal. A separate NOT on either action remains
   // scoped negation; an incomplete/unpaired fragment gets no such proof.
   const focus=/^will not$/i.test(subject.modal)?/^\s*only\b/i.test(body):/^\s*(?:(?:[a-z]+ly|just|also|still|always)\s+)*not\s+only\b/i.test(body);
   const correlative=focus&&/\bbut\s+also\b/i.test(body);
   const negativePrefix=correlative?prefix.replace(/\bnot\s+only\b/i,'only'):prefix;
   const initialNegative=correlative?false:/^(?:won't|cannot|can't|do not|don't|will not)$/i.test(subject.modal)||/^\s*(?:not|never)\b/i.test(body);
   const negated=/\b(?:not|never)\b/i.test(negativePrefix)||!reset&&initialNegative;
   let actionEnd=end;
   const following=line.slice(verbEnd,end),sibling=new RegExp('(?:,?\\s+)(?:and|but|then|however)\\s+(?:(?:will|can|could|would|also|then)\\s+)*(?='+actionVerb+'\\b)','i').exec(following);
   if(sibling)actionEnd=verbEnd+sibling.index;
   const object=directDocumentActionObject(text,verbEnd,actionEnd,verb[0]),actor=reported?'unspecified':actorFor(subject.subject,options);
   const readiness=!head&&/\b(?:ready|prepared|able|willing)\s+to\b/i.test(prefix);
   const scopeStart=bounds.start<subject.start&&/\b(?:if|once|after|when|unless|provided|until)\b/i.test(parent)?bounds.start:subject.start;
   const conditions=conditionSpans(text,scopeStart,actionEnd),optional=conditions.some(condition=>/^if\s+(?:you|your team)(?:['’]d| would)?\s+(?:(?:like|want|prefer)\b|find\s+(?:it|that|this)\s+(?:useful|helpful)\b)/i.test(condition.text));
   const inheritedWillingness=coordinator&&!reset&&/^\s*(?:(?:[a-z]+ly|just|also|always|still)\s+)*be\s+(?:happy|willing|ready|prepared|able)\s+to\b/i.test(body);
   const speechAct:DocumentActionSyntax['speechAct']=reported?'non_delivery':subject.question?'permission_question':negated?'negated':!head||!progressive||embeddedInquiry?readiness?'readiness':'non_delivery':optional||willingness||inheritedWillingness||/^(?:can|could|would)$/i.test(subject.modal)?'offer':'commitment';
   const communicatesResult=/^(?:reply|respond)/i.test(verb[0])&&(object.kind==='result'||object.kind==='non_document');
   const documentDelivery=head&&progressive&&!embeddedInquiry&&!reported&&!communicatesResult&&object.kind!=='non_document';
   const objectEnd=object.end;
   found.push({...span(text,start,verbEnd),actor,grammaticalSubject:subject.subject,voice:'active',speechAct,governingPredicate:assurance||willingness||dispatchControl?prefix+' '+verb[0]:head?verb[0]:prefix,object,scope:span(text,scopeStart,actionEnd),complements:span(text,objectEnd,actionEnd),conditions,documentDelivery});
  }
 }
 const passiveNoun='(?:(?:(?:the|our|your|that|this)\\s+)?(?:[A-Za-z\x27-]+\\s+){0,4}?(?:reports?|documents?|drawings?|files?|attachments?|sheets?|profiles?|certificates?))';
 for(const passive of line.matchAll(new RegExp('\\b('+passiveNoun+')\\s+(will|can|could|would|won\x27t|cannot|can\x27t)\\s+(?:(not|never)\\s+)?be\\s+(sent|emailed|shared|forwarded|included|attached)\\b','gi'))){
  const at=passive.index||0,start=at+passive[0].lastIndexOf(passive[4]),end=start+passive[4].length,bounds=statementBounds(line,at),objectEnd=at+passive[1].length;
  const negated=!!passive[3]||/^(?:won't|cannot|can't)$/i.test(passive[2]);
  const head=documentHead.exec(passive[1]),governor=governingContext(line.slice(bounds.start,at)+passive[1].slice(0,head?.index||0),true),embedded=governor.inquiry||governor.reported||governor.hypothesis;
  found.push({...span(text,start,end),actor:'unspecified',grammaticalSubject:passive[1],voice:'passive',speechAct:embedded?'non_delivery':negated?'negated':/^(?:can|could|would)$/i.test(passive[2])?'offer':'commitment',governingPredicate:passive[4],object:{...span(text,at,objectEnd),kind:'document'},scope:span(text,bounds.start,bounds.end),complements:span(text,end,bounds.end),conditions:conditionSpans(text,bounds.start,bounds.end),documentDelivery:!embedded});
 }
 for(const passive of line.matchAll(new RegExp('\\b(will|can|could|would|may|shall)\\s+('+passiveNoun+')\\s+(?:(not|never)\\s+)?be\\s+(sent|emailed|shared|forwarded|included|attached)\\b','gi'))){
  const at=passive.index||0,start=at+passive[0].lastIndexOf(passive[4]),end=start+passive[4].length,bounds=statementBounds(line,at),objectStart=at+passive[0].indexOf(passive[2]);
  found.push({...span(text,start,end),actor:'unspecified',grammaticalSubject:passive[2],voice:'passive',speechAct:'permission_question',governingPredicate:passive[4],object:{...span(text,objectStart,objectStart+passive[2].length),kind:'document'},scope:span(text,bounds.start,bounds.end),complements:span(text,end,bounds.end),conditions:conditionSpans(text,bounds.start,bounds.end),documentDelivery:true});
 }
 return found.filter((value,index)=>found.findIndex(other=>other.start===value.start&&other.end===value.end)===index).sort((a,b)=>a.start-b.start);
}

/** Compatibility view: actual affirmative outgoing commitments AND offers.
 * An unresolved true send target stays guarded; a question or an incoming
 * buyer action is not a salesperson promise. Nothing here verifies evidence. */
export function affirmativeOutgoingDocumentActions(text:string):DocumentActionSpan[]{
 return analyzeDocumentActionSyntax(text).filter(action=>action.documentDelivery&&action.actor!=='buyer'&&(action.speechAct==='commitment'||action.speechAct==='offer')).map(({start,end,text})=>({start,end,text}));
}
export function hasAffirmativeOutgoingDocumentAction(text:string):boolean {return affirmativeOutgoingDocumentActions(text).length>0;}
