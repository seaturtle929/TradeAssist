/** A narrow extra pause for an obviously unfinished clause, never a delay on every turn. */
export function isUnfinishedBuyerThought(text:string):boolean {
  const line=text.trim().replace(/[’‘]/g,"'");
  if(!line||/\?[\s"')\]]*$/.test(line))return false;
  if(/(?:\.{3}|…|[—–-])\s*$/.test(line))return true;
  const words=line.replace(/[.!,:;"')\]]+$/g,"").trim();
  return /\b(?:and|or|but|because|although|unless|whereas|whether|with|without|about|of|to|for|from|the|an?|um+|uh+)$/i.test(words)
    || /\b(?:let me (?:think|see)|I'm thinking|I am thinking|we (?:need|require|want)|I (?:need|want)|looking for)\s*$/i.test(words);
}
