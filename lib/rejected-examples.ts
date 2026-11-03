const normalized=(line:string)=>line.toLowerCase().replace(/[’‘]/g,"'").replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim();
function hash(value:string){let h=2166136261;for(const char of value){h^=char.charCodeAt(0);h=Math.imul(h,16777619);}return h>>>0;}
export function rejectionSignature(line:string){const text=normalized(line),words=text.split(' ').filter(Boolean),scores=Array(32).fill(0);for(const word of words){const h=hash(word);for(let bit=0;bit<32;bit++)scores[bit]+=(h>>>bit)&1?1:-1;}let sim=0;for(let bit=0;bit<32;bit++)if(scores[bit]>0)sim|=1<<bit;return `${words.length}:${hash(text).toString(16)}:${(sim>>>0).toString(16)}`;}
export type AcceptedWordingExample={positive?:string;negative?:string};

/** The caller supplies only this company/stage/moment's retrieved examples.
 * An exact corrected line can share almost all its words with the rejected
 * draft. Exempt that word sequence from similarity only; near-positive wording
 * and unchanged edits do not qualify, and all fact/state checks still apply. */
export function matchesAcceptedExample(line:string,examples:readonly AcceptedWordingExample[]=[]):boolean {
  const candidate=normalized(line);
  return !!candidate&&examples.some(example=>{
    const positive=typeof example.positive==="string"?normalized(example.positive):"";
    const negative=typeof example.negative==="string"?normalized(example.negative):"";
    return !!positive&&positive!==negative&&candidate===positive;
  });
}

export function matchesRejected(line:string,signatures:string[]=[],examples:readonly AcceptedWordingExample[]=[]){
  const [length,exact,sim]=rejectionSignature(line).split(':'),n=Number(length);
  // Exempt only the similarity comparison against this correction's own old
  // draft. Another example may reject these exact words, including a newer edit.
  const correctedFrom=new Set(examples.filter(example=>matchesAcceptedExample(line,[example])&&typeof example.negative==='string'&&example.negative.trim()).map(example=>rejectionSignature(example.negative!)));
  return signatures.some(signature=>{
    const [size,other,fuzzy]=signature.split(':');
    if(other===exact)return true;
    if(correctedFrom.has(signature))return false;
    if(n<6||Number(size)<6||Math.abs(n-Number(size))/Math.max(n,Number(size))>.2)return false;
    let xor=(parseInt(sim,16)^parseInt(fuzzy,16))>>>0,bits=0;
    while(xor){xor&=xor-1;bits++;}
    return bits<=2;
  });
}
