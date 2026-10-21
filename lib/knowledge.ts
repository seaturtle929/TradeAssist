type Reference = {id:string;title:string;text:string};
const terms = (text:string) => {
  const normalized=text.toLowerCase().replace(/\bmoq\b/g,"moq minimum order quantity").replace(/\bcertif\w*\b/g,"certification certified certificate").replace(/\bprices?\b/g,"price pricing cost usd");
  return [...new Set(normalized.match(/[a-z0-9]{3,}/g) || [])].filter(t => !["the","and","you","our","your","what","that","with","have","this","for","are","can","does","would"].includes(t));
};

/** Select original excerpts; do not replace commercial facts with generated summaries. */
export function selectKnowledge(sources:Reference[],query:string,maxCharacters=45_000):Reference[] {
  const words=terms(query);
  const chunks=sources.flatMap((source,order) => {
    const parts=[];
    for(let offset=0;offset<source.text.length;offset+=5500) {
      const text=source.text.slice(Math.max(0,offset-350),offset+6000);
      const hay=(source.title+" "+text).toLowerCase();
      const score=words.reduce((n,term) => n+(hay.includes(term) ? (source.title.toLowerCase().includes(term) ? 4 : 1) : 0),0)+(source.id==="company-profile" ? .25 : 0);
      parts.push({source,text,score,order,offset});
    }
    return parts;
  }).sort((a,b)=>b.score-a.score || a.order-b.order || a.offset-b.offset);
  let left=maxCharacters;
  const selected=new Map<string,Reference>();
  for(const chunk of chunks) {
    if(left<300)break;
    const existing=selected.get(chunk.source.id);
    if(!existing && selected.size>=38)continue;
    const separator=existing ? "\n\n[Another original excerpt]\n" : "";
    const text=chunk.text.slice(0,Math.max(0,left-separator.length));left-=text.length+separator.length;
    if(existing)existing.text+=separator+text;
    else selected.set(chunk.source.id,{id:chunk.source.id,title:chunk.source.title,text});
  }
  return [...selected.values()];
}
