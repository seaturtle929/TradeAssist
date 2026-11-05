/** Shared release boundary for an existing document. Knowing a report's
 * product scope does not override a condition on sending it to a customer. */
import {productIdentityReferences} from './product-identity-evidence.ts';
export type DocumentAvailabilitySource={id:string;text:string;title?:string;complete?:boolean;original?:boolean};
const norm=(text:string)=>text.toLowerCase().replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();
const stale=/\b(?:draft|outdated|superseded|historical|archived|expired|not current|for reference only)\b/i;
const restricted=/\b(?:unavailable|NDA|non[- ]disclosure|confidential|internal|permission|authorization|authorisation|not authorized|not authorised|not permitted|requires?[^.!?]{0,35}approval|approval (?:is )?required|subject to[^.!?]{0,35}approval|legal[^.!?]{0,35}signs? off|only[^.!?]{0,35}customers)\b/i;
const releaseLanguage=/\b(?:available|availability|send|sending|sent|share|sharing|shared|release|releasing|released|distribute|distribution|distributed|provide|provided|circulate|circulated)\b/i;
function plainAvailability(sentence:string):boolean{
 const match=sentence.trim().match(/^(.+?)\s+(?:is|are)\s+available(?:\s+for review)?[.!]?$/i);
 if(!match)return false;
 // Only a document list can be the subject. A partial phrase buried in a
 // request, future plan, qualification or other predicate proves nothing.
 let subject=match[1];
 for(const reference of productIdentityReferences(subject,[{id:'availability-list',text:sentence}]).reverse())subject=subject.slice(0,reference.start)+' '+subject.slice(reference.end);
 return !subject.replace(/\b(?:(?:company|product)\s+)?profiles?\b|\b(?:(?:material|inspection|quality)\s+)?test reports?\b|\binspection reports?\b|\breports?\b|\b(?:(?:product|technical)\s+)?(?:specs?|specifications?)(?:\s+sheets?)?\b|\bdata sheets?\b|\bdrawings?\b|\bcatalog(?:ue)?s?\b|\bbrochures?\b/gi,'').replace(/\b(?:a|an|the|our|and|both|approved|current)\b/gi,'').replace(/[\s,]/g,'');
}
export function availableDocumentActionEvidence(document:string,sources:DocumentAvailabilitySource[],requireAvailability=true):DocumentAvailabilitySource|undefined{
 const kind=norm(document),entries=sources.filter(source=>source.original!==false&&norm(source.text).includes(kind));
 if(!kind||entries.some(source=>restricted.test(source.text)||source.text.split(/\n+|(?<=[.!?;])\s+/).some(sentence=>releaseLanguage.test(sentence)&&!plainAvailability(sentence))))return;
 return entries.find(source=>source.complete!==false&&!stale.test((source.title||'')+' '+source.text)&&source.text.split(/\n+|(?<=[.!?;])\s+/).some(sentence=>{
  const text=norm(sentence),position=text.indexOf(kind);if(position<0)return false;
  return plainAvailability(sentence)||!requireAvailability&&/^\s*(?:we|our company) (?:have|has)\b/.test(text)&&! /\b(?:not|no|never|unless|if|may|might|could|only)\b/.test(text);
 }));
}
