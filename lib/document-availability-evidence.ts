/** Shared release boundary for an existing document. Knowing a report's
 * product scope does not override a condition on sending it to a customer. */
import {productIdentityReferences} from './product-identity-evidence.ts';
export type DocumentAvailabilitySource={id:string;text:string;title?:string;complete?:boolean;original?:boolean};
const norm=(text:string)=>text.toLowerCase().replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();
const stale=/\b(?:draft|outdated|superseded|historical|archived|expired|not current|for reference only)\b/i;
const restricted=/\b(?:unavailable|NDA|non[- ]disclosure|confidential|internal|permission|authorization|authorisation|not authorized|not authorised|not permitted|requires?[^.!?]{0,35}approval|approval (?:is )?required|subject to[^.!?]{0,35}approval|legal[^.!?]{0,35}signs? off|only[^.!?]{0,35}customers)\b/i;
const releaseLanguage=/\b(?:available|availability|send|sending|sent|share|sharing|shared|release|releasing|released|distribute|distribution|distributed|provide|provided|circulate|circulated)\b/i;
function plainAvailability(sentence:string,requestedKind?:string):boolean{
 const match=sentence.trim().match(/^(.+?)\s+(?:is|are)\s+available(?:\s+for review)?[.!]?$/i);
 if(!match)return false;
 // Prove availability from the requested artifact's actual list member.
 // Sibling documents may have ordinary product/type modifiers; those words
 // neither erase the report nor prove anything about its contents. Planning,
 // negation and release conditions still invalidate the whole source claim.
 let subject=match[1];
 for(const reference of productIdentityReferences(subject,[{id:'availability-list',text:sentence}]).reverse())subject=subject.slice(0,reference.start)+' '+subject.slice(reference.end);
 if(/\b(?:plans?|planning|intend\w*|consider\w*|hope\w*|promise\w*|requests?|requesting|want\w*|future|will|would|could|may|might|send\w*|email\w*|shar(?:e|ing)|provid\w*|releas\w*|distribut\w*|not|no|never|only|unless|if|until|after|before|once|when|to|of|for|we|I|you|they|he|she|is|are|has|have)\b/i.test(subject))return false;
 const noun=/(?:(?:material|inspection|quality)\s+)?test reports?|inspection reports?|reports?|(?:(?:product|technical)\s+)?(?:specs?|specifications?)(?:\s+sheets?)?|data sheets?|drawings?|profiles?|catalog(?:ue)?s?|brochures?/i.source;
 const member=new RegExp('^(?:[A-Za-z][A-Za-z0-9\x27’–-]*\\s+){0,6}?('+noun+')$','i');
 const entries=subject.trim().split(/\s*,\s*|\s+and\s+/i).filter(Boolean).map(part=>member.exec(part.trim().replace(/^(?:and|both)\s+/i,'')));
 if(!entries.length||entries.some(entry=>!entry))return false;
 const requested=requestedKind&&member.exec(requestedKind);
 // Keep the requested member's qualifiers (“company profile”, “valve spec
 // sheet”) while also matching its document noun. A report-summary spec
 // sheet cannot establish availability of the report mentioned in its name.
 return !requestedKind||!!requested&&entries.some(entry=>norm(entry![0]).includes(requestedKind)&&norm(entry![1]).includes(norm(requested[1])));
}
export function availableDocumentActionEvidence(document:string,sources:DocumentAvailabilitySource[],requireAvailability=true):DocumentAvailabilitySource|undefined{
 const kind=norm(document),entries=sources.filter(source=>source.original!==false&&norm(source.text).includes(kind));
 if(!kind||entries.some(source=>restricted.test(source.text)||source.text.split(/\n+|(?<=[.!?;])\s+/).some(sentence=>releaseLanguage.test(sentence)&&!plainAvailability(sentence))))return;
 return entries.find(source=>source.complete!==false&&!stale.test((source.title||'')+' '+source.text)&&source.text.split(/\n+|(?<=[.!?;])\s+/).some(sentence=>{
  const text=norm(sentence),position=text.indexOf(kind);if(position<0)return false;
  return plainAvailability(sentence,kind)||!requireAvailability&&/^\s*(?:we|our company) (?:have|has)\b/.test(text)&&! /\b(?:not|no|never|unless|if|may|might|could|only)\b/.test(text);
 }));
}
