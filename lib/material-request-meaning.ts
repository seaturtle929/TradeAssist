/** Pure interpretation of independent material requests. Mentioned, historical
 * or subordinate delivery is not a new request. Callers supply the shared
 * actor interpretation when they need to exclude a buyer-owned send. */
const normalize=(value:string)=>value.replace(/[’‘]/g,"'").toLowerCase();
const materialTarget=/\b(?:profile|specs?|specifications?|drawings?|information|info|catalog\w*|brochure|documents?|materials|website|link|product (?:details|range)|technical data sheets?|copy of what (?:you|we) (?:produce|make))\b/;
const materialRequest=new RegExp('(?:\\b(?:send|email|share|forward|attach)\\b|(?:^|\\bplease\\s+)(?:also\\s+)?include\\b).{0,100}'+materialTarget.source);
export const materialClauses=(line:string)=>line.split(/(?<=[.!?])\s+|;\s*|\s+(?:but|instead|rather)\s+|,\s*(?=(?:please )?(?:send|email|share|forward|attach)\b)/).filter(Boolean);
export const materialRefusal=(line:string)=>{
  const negativeDelivery=/\b(?:don't|do not|won't|will not|can't|cannot|never|no need to|not to|shouldn't|should not) (?:send|email|share|forward|attach|include)\b|\b(?:don't|do not) (?:have|need) to (?:send|email|share|forward|attach|include)\b|\bnot (?:asking|asking you|asking you to|wanting|wanting you to) (?:send|email|share|forward|attach|include)\b/.test(line);
  // "I cannot share that" may decline the buyer's own commercial details. It
  // does not cancel a supplier-document plan without a materials/send reference.
  return negativeDelivery&&(materialTarget.test(line)||/\b(?:send|email)\b/.test(line))||new RegExp('\\b(?:don\'t|do not) (?:want|need)\\b.{0,50}'+materialTarget.source+'|\\bno need for\\b.{0,40}'+materialTarget.source).test(line);
};
const conditionalMaterialRequest=(line:string)=>/\b(?:i|we)(?:'ll| will| would| might| may) (?:ask|request)\b.{0,70}\b(?:send|email|share|forward|attach)\b/.test(line)||/\b(?:if|unless|once|when|after)\b.{0,100}\b(?:send|email|share|forward|attach)\b/.test(line)&&!/^\s*if (?:possible|you can|it's possible|it is possible)\b/.test(line);
const deliveryVerb='(?:send|email|share|forward|attach|include)';
const independentDeliveryMove=new RegExp('^(?:'+deliveryVerb+'\\b|you\\s+(?:(?:can|could|should|may|will)\\s+)?'+deliveryVerb+'\\b|(?:can|could|would|will|may|should)\\s+(?:you|i|we)\\s+(?:(?:please|also|just)\\s+)*'+deliveryVerb+'\\b|(?:i|we)(?:\\x27ll|\\s+(?:will|can|could|would|may|might))\\s+(?:(?:please|also|just)\\s+)*'+deliveryVerb+'\\b|(?:i|we)(?:\\x27d|\\s+would)?\\s+(?:like|want|need)\\s+(?:you\\s+)?to\\s+'+deliveryVerb+'\\b|would you (?:like|want)\\b)');
/** A mentioned delivery is not an independent request or promise. Keep a
 * dependent lead-in as context, then inspect the actual main move. Returning
 * that main clause also prevents its earlier document nouns from becoming
 * newly requested materials. No word/name/code from a saved call is special. */
export function independentMaterialAction(raw:string,excludeAction?:(value:string)=>boolean,targetMatches?:(value:string)=>boolean):string|undefined {
  const line=normalize(raw);
  const courtesy=(value:string)=>value.trim().replace(/^(?:(?:well|okay|ok|yes|yeah|sure|great|thanks|thank you|actually|instead|also|just|only|please|now)[,:]?\s+(?:and\s+)?)*/,'').replace(/^(?:how about|what about)(?: (?:this|that))?[: ,]*\s*/,'').replace(/^if (?:possible|you can|it's possible|it is possible)[, ]*/,'');
  let main=courtesy(line);
  if(/^(?:before|after|while|when|once|until|unless|if|whenever|as soon as|as long as)\b/.test(main)&&!/^if (?:possible|you can|it's possible|it is possible)\b/.test(main)){
    const comma=main.indexOf(',');
    if(comma>=0)main=main.slice(comma+1).trim();
    else {
      // ASR may omit a comma: a separate modal request is still identifiable.
      const request=new RegExp('\\b(?:can|could|would|will|may|should)\\s+(?:you|i|we)\\s+(?:(?:please|also|just)\\s+)*'+deliveryVerb+'\\b').exec(main);
      if(!request)return;main=main.slice(request.index);
    }
  }
  const coordinatedRequest=new RegExp('\\b(?:and|then)\\s+(?=(?:(?:please|also|just)\\s+)*(?:'+deliveryVerb+'\\b|you\\s+(?:(?:can|could|should|may|will)\\s+)?'+deliveryVerb+'\\b|(?:can|could|would|will|may|should)\\s+you\\s+(?:(?:please|also|just)\\s+)*'+deliveryVerb+'\\b))','g');
  const coordinated=[...main.matchAll(coordinatedRequest)];
  const starts=[0,...[...main.matchAll(/,\s*/g),...coordinated].map(match=>(match.index||0)+match[0].length)];
  const candidates=starts.map(start=>main.slice(start,coordinated.find(match=>(match.index||0)>=start)?.index));
  const actions=[...new Set(candidates.map(courtesy).filter(value=>independentDeliveryMove.test(value)&&(targetMatches?targetMatches(value):materialRequest.test(value))&&(!excludeAction||!excludeAction(value))))];
  return actions.length?actions.join(' '):undefined;
}
export const affirmativeMaterialAction=(raw:string,excludeAction?:(value:string)=>boolean,targetMatches?:(value:string)=>boolean)=>{const line=normalize(raw);return !materialRefusal(line)&&!conditionalMaterialRequest(line)?independentMaterialAction(line,excludeAction,targetMatches):undefined;};
