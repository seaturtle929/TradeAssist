export type KnowledgeReference={id:string;title:string;text:string;complete?:boolean};

/** Keep tool results available to the verifier as well as the generating model.
 * Newly retrieved original excerpts take priority over the initial selection.
 * The full library stays local to the live controller, outside request payloads.
 */
export function includeLookupSources(current:KnowledgeReference[],retrieved:KnowledgeReference[],maxCharacters=120_000):KnowledgeReference[] {
  const combined=new Map<string,KnowledgeReference>();
  for(const source of [...retrieved,...current]) {
    const prior=combined.get(source.id);
    if(!prior){combined.set(source.id,{...source});continue;}
    if(!prior.text.includes(source.text)){prior.text+="\n\n[Another original excerpt]\n"+source.text;prior.complete=false;}
  }
  const result:KnowledgeReference[]=[];
  let remaining=Math.min(120_000,maxCharacters);
  for(const source of combined.values()) {
    if(result.length===40||remaining<=0)break;
    const text=source.text.slice(0,Math.min(100_000,remaining));
    result.push({...source,text,complete:source.complete!==false&&text===source.text});remaining-=text.length;
  }
  return result;
}
