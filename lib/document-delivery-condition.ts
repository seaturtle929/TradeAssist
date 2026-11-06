/** Shared interpretation of the buyer’s report-send condition. A positive
 * coverage result is distinct from merely completing a check. */
export function reportDeliveryCondition(buyerText:string):'scope_required'|'unresolved'|undefined {
 const text=buyerText.replace(/[’‘]/g,"'");
 const delivery='(?:send|email|share|forward|include|attach|reply|respond|sending|emailing|sharing|forwarding|including|attaching)';
 const patterns=[
  new RegExp('\\bonly\\s+'+delivery+'\\b[^.!?]*?\\bif\\s+([^.!?]+)','gi'),
  new RegExp('\\b'+delivery+'\\b[^.!?]*?\\b(?:only\\s+)?(?:if|when|provided(?:\\s+that)?|as long as|on condition that)\\s+([^.!?]+)','gi'),
  new RegExp("\\b(?:do not|don't|never)\\s+"+delivery+'\\b[^.!?]*?\\bunless\\s+([^.!?]+)','gi'),
  new RegExp('(?:^|[.!?]\\s*)\\s*(?:if|once|after|when|provided(?:\\s+that)?|as long as|on condition that)\\s+([^,;.!?]+)[,;]\\s*[^.!?]*?\\b'+delivery+'\\b','gi'),
  new RegExp('(?:^|[.!?]\\s*)\\s*unless\\s+([^,;.!?]+)[,;]\\s*[^.!?]*?\\b(?:do not|don\'t)\\s+'+delivery+'\\b','gi'),
  new RegExp('([^.!?]*\\b(?:needs?|must|has to|have to|requires?|required)\\b[^.!?]*?)\\bbefore\\b[^.!?]*?\\b'+delivery+'\\b','gi'),
 ];
 // “If not, explain the gap instead of attaching it” gives a no-send
 // alternative, not a second condition authorizing an attachment. Exclude
 // only matches whose every document action is explicitly an alternative
 // being declined; a real send elsewhere in the match keeps normal checks.
 const matches=patterns.flatMap(pattern=>[...text.matchAll(pattern)]).filter(match=>[...match[0].matchAll(new RegExp('\\b'+delivery+'\\b','gi'))].some(action=>! /\b(?:instead of|rather than)\s*$/i.test(match[0].slice(0,action.index))));
 const buyerOwned=matches.filter(match=>{
  const action=[...match[0].matchAll(new RegExp('\\b'+delivery+'\\b','gi'))].at(-1);if(!action)return false;
  const at=(match.index||0)+(action.index||0),start=Math.max(text.lastIndexOf('.',at),text.lastIndexOf('!',at),text.lastIndexOf('?',at))+1;
  return /\b(?:I|we)(?:'ll|\s+(?:will|can|could))\s*$/i.test(text.slice(start,at));
 });
 // "If it helps, I can email the drawing" offers the buyer's own action.
 // It does not restrict the representative's later report-send permission.
 const conditions=matches.filter(match=>!buyerOwned.includes(match)).map(match=>match[1].trim());
 if(conditions.length){
  // Match the condition itself, not an unrelated coverage question elsewhere
  // in the buyer's turn. Unknown predicates retain semantic checking; neither
  // an available report nor “once confirmed” establishes the required result.
  const referent='(?:it|that|this|(?:(?:the|this|that|our|your)\\s+)?(?:(?:material\\s+test|inspection|test|quality)\\s+)?report)';
  const scoped=new RegExp('^(?:'+referent+'\\s+(?:(?:needs? to|must|has to)\\s+)?(?:covers?|matches?|includes?|appl(?:y|ies)\\s+to)|(?:its|'+referent+'[\x27’]s)\\s+scope\\s+(?:includes?|contains?))\\s+(.+)$','i');
  // Coverage can put the buyer's item first: "that drawing reference is
  // within its scope". This is a positive report result, not a hold/approval
  // instruction. Keep this grammar closed so added terms, negation or a
  // separate engineering approval still require their own release check.
  const item='(?:(?:(?:the|this|that|our|your|my)\\s+)?(?:(?:selected|exact|specific)\\s+)?(?:(?:drawing|product|part|item|model|grade|mesh)(?:\\s+reference)?|reference)|[A-Z]{1,6}[- ]?\\d{1,6})';
  const report='(?:(?:the|this|that|our|your)\\s+)?(?:(?:material\\s+test|inspection|test|quality)\\s+)?report';
  const scope='(?:its\\s+scope|'+report+'[\x27’]s\\s+scope|the\\s+scope\\s+of\\s+'+report+')';
  const inverseScoped=new RegExp('^'+item+'\\s+(?:(?:is|falls?)\\s+within\\s+'+scope+'|is\\s+covered\\s+by\\s+'+report+')[,. ]*(?:please|okay|ok)?$','i');
  const nominal=/^(?:we|I)\s+need\s+coverage\s+(?:of|for)\s+(.+?)\s+confirmed$/i;
  if(conditions.every(condition=>{
   condition=condition.replace(/^(?:you(?:'re| are)\s+sure\s+(?:that\s+)?|(?:I|we|you)(?:'ve| have)?\s+(?:confirmed|verified|checked)\s+that\s+)/i,'');
   if(new RegExp('^'+referent+'\\s+matches$','i').test(condition))return true;
   if(inverseScoped.test(condition))return true;
   const object=scoped.exec(condition)?.[1]||nominal.exec(condition)?.[1];
   return !!object&&!/\b(?:not|never|no|doesn't|don't|isn't|aren't|and|or|unless|if|when|because|since|before|after|once|provided|confirms?|approves?|discount|approval|permission|authorized|certif\w*|guarantee\w*)\b|[;!?]/i.test(object);
  }))return 'scope_required';
  return 'unresolved';
 }
 // Restrictive wording outside the closed forms above cannot silently become
 // an unconditional send. Ordinary timing questions or a request to check
 // before sending contain none of these restriction markers and remain fast.
 let remaining=text;for(const match of [...buyerOwned].sort((one,two)=>(two.index||0)-(one.index||0)))remaining=remaining.slice(0,match.index)+remaining.slice((match.index||0)+match[0].length);
 if(new RegExp('\\b'+delivery+'\\b','i').test(remaining)&&/\b(?:only if|only when|unless|provided that|on condition that|as long as)\b/i.test(remaining))return 'unresolved';
}
