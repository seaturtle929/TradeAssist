/** A scoped objection about switching is not a refusal of the conversation.
 * Share clear stop/refusal detection across state and the question agenda so an
 * old unanswered question cannot reactivate sales work after a real boundary. */
export function hasClearConversationRefusal(raw:string):boolean {
  const line=raw.replace(/[’‘]/g,"'").toLowerCase().replace(/\baren't\b/g,'are not').replace(/\bisn't\b/g,'is not');
  return /\b(?:stop (?:calling|contacting)|don't (?:call|contact)|do not (?:call|contact)|take (?:me|us) off|remove (?:me|us) from|leave (?:me|us) alone)\b/.test(line)
    ||/\bnot interested\b(?!\s+(?:in|to)\b)/.test(line)
    ||/\bnot interested in (?:this(?:\s+(?:offer|conversation))?|that|your (?:products?|offer|company)|any (?:offer|discussion)|discussing this|taking (?:this|it) any further|continuing (?:this|the) (?:discussion|conversation))\b/.test(line)
    ||/^\s*(?:(?:okay|ok|well)[, ]+)?(?:no thanks|no thank you|we(?:'ll| will) pass|i'll pass|that's all|that is all|goodbye)[.!\s]*$/.test(line);
}
