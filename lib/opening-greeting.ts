/** A bounded greeting/identity exchange, never a routing or substantive request. */
export function isSimpleBuyerGreeting(value:string):boolean {
  let line=value.replace(/[’‘]/g,"'").trim();
  if(!line||(line.match(/\S+/g)?.length||0)>26)return false;
  if(/^(?:who(?:'s| is) (?:this|calling)|who are you|how (?:can|may) I help(?: you)?|what can I do for you|what(?:'s| is) this(?: call)? (?:about|regarding)|what are you calling (?:about|for))[?!.\s]*$/i.test(line))return true;
  line=line.replace(/(?:[,;.!?]\s*|\s+)(?:who(?:'s| is) (?:this|calling)|who are you|how (?:can|may) I help(?: you)?|what can I do for you|what(?:'s| is) this(?: call)? (?:about|regarding)|what are you calling (?:about|for))[?!.\s]*$/i,'').trim();
  const greeting=/^(?:hello|hi|hey|good (?:morning|afternoon|evening))\b[,!.?\s]*/i;
  const hadGreeting=greeting.test(line);line=line.replace(greeting,'').trim();
  if(!line)return hadGreeting;
  // A business name may follow the identity, but cannot conceal a request,
  // purchasing requirement, refusal or transfer to a different person.
  if(/\?|\b(?:send|email|profile|brochure|catalog|specs?|specifications?|purity|MOQ|certif\w*|prices?|quotes?|stock|inventory|lead time|manufactur\w*|need|want|already|busy|not interested|don't|do not|call back|wrong person|wrong department|not responsible|not the right|transfer|you should (?:speak|talk))\b/i.test(line))return false;
  const person="[a-z][a-z'\\-]{0,24}(?:\\s+[a-z][a-z'\\-]{0,24}){0,2}";
  const company="(?:\\s+(?:at|from|with)\\s+[a-z0-9&.'() -]{1,80})?";
  const role="(?:[,;]\\s*(?:the )?(?:buyer|purchasing manager|procurement manager|purchasing|procurement))?";
  return new RegExp(`^(?:(?:this is|it's|it is|my name is)\\s+${person}(?:\\s+(?:speaking|here))?${company}${role}|${person}\\s+(?:speaking|here)${company})[.!\\s]*$`,'i').test(line);
}
