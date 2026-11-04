import type {Turn} from './trade';

type SpokenTurn=Pick<Turn,'id'|'role'|'text'|'at'|'transcriptionUncertainty'>;
export type SpokenDocumentRequest={turnId:string;documents:string[];quote:string;at:number};
export type SpokenDocumentAgreement={turnId:string;requestTurnId?:string;documents:string[];quote:string;at:number};
export type SpokenDocumentCancellation={turnId:string;documents:string[];quote:string;at:number};
const clean=(text:string)=>text.replace(/[‘’]/g,"'").replace(/\s+/g,' ').trim();
const clauses=(text:string)=>clean(text).split(/(?<=[.!?;])\s+/);
const uncertain=/\b(?:if|unless|when|once|until|maybe|perhaps|might|may|whether|not sure|need to check|needs? approval)\b/i;
const negative=/\b(?:not|never|no longer|no need|don't|do not|didn't|did not|won't|will not|can't|cannot|unable)\b/i;
const requestMove=/\b(?:please\s+(?:include|attach|send|email|share|forward|provide)|(?:can|could|would|will)\s+you\s+(?:please\s+)?(?:include|attach|send|email|share|forward|provide)|(?:include|attach|send|email|share|forward|provide)\s+(?:me|us)|(?:I'd|I would|we'd|we would)\s+like|(?:I|we)\s+(?:only\s+(?:need|want)|(?:need|want)\s+only))\b|^(?:(?:yes|sure|okay|ok)[,. ]+)?(?:include|attach|send|email|share|forward|provide)\b/i;

/** Document names are a vocabulary for an observed request, never proof that a
 * company offers them or that they have been sent. Keep original speech apart. */
export function documentKinds(text:string):string[] {
 return [
  ['company profile',/\b(?:company\s+)?profiles?\b/i],
  ['spec sheets',/\b(?:spec(?:ification)?\s+sheets?|specifications?|specs?|data sheets?)\b/i],
  ['test reports',/\b(?:(?:material|inspection|quality)\s+)?test reports?\b|\b(?:inspection|quality) reports?\b/i],
  ['drawings',/\bdrawings?\b/i],['catalog',/\bcatalog(?:ue)?s?\b/i],['brochure',/\bbrochures?\b/i],
 ].filter(([,pattern])=>(pattern as RegExp).test(text)).map(([label])=>label as string);
}

export function isDocumentRequest(text:string):boolean {
 return clauses(text).some(part=>documentKinds(part).length>0&&!negative.test(part)&&!uncertain.test(part)&&requestMove.test(part));
}

/** "In your email" names the delivery channel. It does not ask for the rep's
 * personal address, even when the document request itself is a question. */
export function isRepContactDetailRequest(text:string):boolean {
 if(isDocumentRequest(text))return false;
 const line=clean(text);
 return /\b(?:your (?:last name|surname|name|callback(?: number)?|phone(?: number)?|number|email(?: address)?)|a callback number|(?:reach|call) you (?:at|on))\b/i.test(line)
  && (/\?|\b(?:may|can|could|would)\s+(?:I|we)\s+(?:have|get|take|confirm)|\b(?:give|tell|share|provide)\s+(?:me|us)\b/i.test(line)||/^(?:and\s+)?(?:your\s+(?:last name|surname|name|callback|phone|number|email)|a callback number)\b/i.test(line));
}

const internalDestination=/\b(?:internal(?:ly)?|(?:my|our)\s+(?:notes|records|files|manager|supervisor)|(?:internal\s+)?approval request)\b/i;
const buyerDeliveryChannel=/\b(?:to (?:you|your\s+(?:engineer|team|email|inbox))|for you|in (?:my|our|the) (?:reply|email)|with (?:my|our|the) (?:reply|email))\b/i;

/** Resolve only actual, reliable speech. A definite send agreement may resolve
 * "that" against the immediately preceding buyer request; an unrelated turn,
 * conditional offer or generated suggestion cannot supply the missing object. */
export function deriveSpokenDocumentEvidence(turns:SpokenTurn[]):{requests:SpokenDocumentRequest[];agreements:SpokenDocumentAgreement[];cancellations:SpokenDocumentCancellation[];activeDocuments:string[]} {
 const requests:SpokenDocumentRequest[]=[],agreements:SpokenDocumentAgreement[]=[],cancellations:SpokenDocumentCancellation[]=[],active=new Set<string>();
 let previousRequest:SpokenDocumentRequest|undefined;
 for(const turn of turns){
  if(!turn.text.trim())continue;
  if(turn.transcriptionUncertainty||turn.role==='conversation'){previousRequest=undefined;continue;}
  const parts=clauses(turn.text);
  if(turn.role==='buyer'){
   const cancelled=new Set<string>();
   for(const part of parts){
    if(part.includes('?')||uncertain.test(part))continue;
    const cancel=/\b(?:(?:do not|don't|no need to|stop)\s+(?:send|email|include|attach|share|forward|provide)|(?:no longer|don't|do not)\s+(?:need|want)|no need for)\b/i.test(part);
    const only=/\b(?:I|we)\s+(?:only\s+(?:need|want)|(?:need|want)\s+only)\b/i.test(part);
    if(!cancel&&!only)continue;
    const named=documentKinds(part);
    const resolved=named.length?named:/\breports?\b/i.test(part)?[...active].filter(kind=>/reports?/.test(kind)):/\b(?:both|those|them|the documents|these documents|any documents)\b/i.test(part)?[...active]:/\b(?:it|that)\b/i.test(part)&&active.size===1?[...active]:[];
    const removed=only?[...active].filter(kind=>!named.includes(kind)):resolved;
    for(const kind of removed){if(active.has(kind)){cancelled.add(kind);active.delete(kind);}}
   }
   if(cancelled.size)cancellations.push({turnId:turn.id,documents:[...cancelled],quote:turn.text,at:turn.at});
   const documents=[...new Set(parts.filter(isDocumentRequest).flatMap(documentKinds))];
   previousRequest=documents.length?{turnId:turn.id,documents,quote:turn.text,at:turn.at}:undefined;
   if(previousRequest){requests.push(previousRequest);for(const kind of documents)active.add(kind);}
   continue;
  }
  if(turn.role!=='you'){previousRequest=undefined;continue;}
  for(const part of parts){
   if(part.includes('?')||negative.test(part)||uncertain.test(part)||internalDestination.test(part))continue;
   const promise=/\b(?:I|we)(?:'ll| will)\s+(?:(?:be sure to|make sure to)\s+)?(?:send|email|share|forward|provide|include|attach|get)\b/i.exec(part);
   if(!promise||/\b(?:said|says|asked|told|quoted|suppose|imagine|think|believe)\b/i.test(part.slice(0,promise.index)))continue;
   const referential=/\b(?:get\s+(?:that|it|those|them|both)\s+(?:over|sent|emailed)|(?:send|email|share|forward|provide|include|attach)\s+(?:that|it|those|them|both))\b/i.test(part);
   if(/\b(?:include|attach)\b/i.test(promise[0])&&!previousRequest&&!buyerDeliveryChannel.test(part))continue;
   const named=documentKinds(part),documents=referential&&previousRequest?previousRequest.documents:named;
   // "Get" is a send promise only in its explicit contextual sending phrase.
   if(!documents.length||/\bget\b/i.test(promise[0])&&(!referential||!previousRequest))continue;
   agreements.push({turnId:turn.id,...previousRequest?{requestTurnId:previousRequest.turnId}:{},documents:[...documents],quote:turn.text,at:turn.at});
   for(const kind of documents)active.add(kind);
   break;
  }
  previousRequest=undefined;
 }
 return {requests,agreements,cancellations,activeDocuments:[...active]};
}
