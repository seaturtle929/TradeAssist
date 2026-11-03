export type BuyerFactTurn={id?:string;role:string;text:string;at?:number};
const slug=(value:string)=>value.toLowerCase().replace(/[^a-z0-9]+/g,"_").replace(/^_|_$/g,"");
const normalized=(value:string)=>value.toLowerCase().replace(/[’‘]/g,"'").replace(/\s+/g," ").trim();
const emailPattern=/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}|\b[a-z0-9._+-]+\s+at\s+[a-z0-9.-]+\s+dot\s+[a-z]{2,}\b/ig;
type EmailEvidence={turnId:string;quote:string;value:string};
const withdrawsEmail=(line:string)=>/\b(?:don't|do not|never|stop) (?:use|using|email|sending|send)\b.{0,45}\b(?:email|address|that|it|me)\b|\b(?:that|this|my|our|the|previous|old) (?:email|address)\b.{0,25}\b(?:wrong|invalid|incorrect|no longer|not (?:valid|current|working|mine))\b/.test(normalized(line));

/** A withdrawal terminates the backward search; an older address is not a fallback. */
export function emailEvidenceFor(turns:BuyerFactTurn[]):{evidence?:EmailEvidence;withdrawn:boolean;withdrawal?:EmailEvidence} {
  for(let index=turns.length-1;index>=0;index--){
    const turn=turns[index];if(turn.role!=='buyer')continue;
    for(const part of turn.text.split(/(?<=[.!?])\s+|[;,]\s*/).reverse()){
      // A buyer reading the salesperson's address back is contact confirmation
      // for the rep, not evidence of an address where this buyer can be reached.
      if(/\byour (?:e-?mail(?: address)?|address)\b/i.test(part))continue;
      if(withdrawsEmail(part))return {withdrawn:true,withdrawal:{value:'withdrawn',turnId:turn.id||`buyer-${index}`,quote:turn.text}};
      const matches=part.match(emailPattern);
      if(matches?.length&&!/\b(?:not|isn't|is not|wrong|old) (?:my|our|the) email\b/i.test(part))return {evidence:{value:matches.at(-1)!,turnId:turn.id||`buyer-${index}`,quote:turn.text},withdrawn:false};
    }
  }
  return {withdrawn:false};
}

/** An earlier person's address is historical until this person supplies or approves it. */
export function currentContactEmailEvidence(turns:BuyerFactTurn[],segmentStartTurnId:string|undefined,prior?:EmailEvidence):{current?:EmailEvidence;earlier?:EmailEvidence;withdrawn?:boolean;withdrawal?:EmailEvidence} {
  const start=segmentStartTurnId?turns.findIndex((turn,index)=>(turn.id||`buyer-${index}`)===segmentStartTurnId):-1;
  const segment=start>=0?turns.slice(start):turns;
  const earlier=start>0?fieldEvidence('Email',turns.slice(0,start))||prior:prior;
  for(let index=segment.length-1;index>=0;index--){
    const turn=segment[index];if(turn.role!=='buyer')continue;
    const direct=emailEvidenceFor([turn]);
    if(direct.withdrawn)return {earlier,withdrawn:true,withdrawal:direct.withdrawal};
    if(direct.evidence)return {current:direct.evidence,earlier};
    if(!earlier)continue;
    const line=normalized(turn.text);
    if(/\b(?:don't|do not|not|wrong|different|another)\b/.test(line))continue;
    const explicit=/\b(?:use|send (?:it|them|that|the (?:profile|specs|materials)) to|email (?:it|them) to) (?:the )?(?:same|that|previous|reception(?:ist)?'?s?|front desk'?s?) (?:email|address)\b|\b(?:the )?(?:same|that|previous|reception(?:ist)?'?s?|front desk'?s?) (?:email|address) (?:is |will be |works |would be )?(?:fine|correct|right|okay|ok|good|works|will work)\b/.test(line);
    const previous=segment.slice(0,index).findLast(item=>item.role==='you')?.text||'';
    const yes=/^(?:yes|yeah|yep|sure|correct|right|that's fine|that works|please do)(?:[, ]+please)?[,.!\s]*$/i.test(line);
    const addressQuestion=/\?/.test(previous)&&(/\b(?:same|previous|reception(?:ist)?'?s?|front desk'?s?) (?:email|address)\b/i.test(previous)||previous.toLowerCase().includes(earlier.value.toLowerCase()))&&/\b(?:use|send|email|okay|ok|correct|right)\b/i.test(previous);
    if(explicit||yes&&addressQuestion)return {current:{value:earlier.value,turnId:turn.id||`buyer-${start+index}`,quote:turn.text},earlier};
  }
  return {earlier};
}
export function fieldEvidence(label:string,turns:BuyerFactTurn[]):{turnId:string;quote:string;value:string}|undefined {
  const key=slug(label);
  if(/email|e_mail/.test(key))return emailEvidenceFor(turns).evidence;
  for(let index=turns.length-1;index>=0;index--) {
    const turn=turns[index];if(turn.role!=="buyer" || !turn.text.trim())continue;
    const line=turn.text,lower=normalized(line),previous=turns.slice(Math.max(0,index-2),index).filter(item=>item.role==="you").map(item=>item.text).join(" ");
    const uncertain=/\b(?:don't know|do not know|not sure|haven't decided|have not decided|cannot share|can't share|won't share|will not share|rather not|prefer not|not willing|not comfortable)\b/.test(lower);
    let found=false;const value=line;
    if(/right_person|purchasing_contact/.test(key))found=!/\b(?:not|don't|do not|no longer)\b.{0,40}\b(?:purchas\w*|procurement|buying|buyer)\b/i.test(line)&&(/\bI (?:handle|manage|am responsible for)\b.{0,40}\b(?:purchas\w*|procurement|buying)\b|\b(?:I'm|I am) (?:the )?(?:buyer|purchasing|procurement)\b/i.test(line) || (/\b(?:that would be me|that's me|that is me|I do)\b/i.test(line)&&/who.{0,50}(?:purchas|buy|procurement)|right person|do you handle.{0,30}purchas/i.test(previous)) || /purchasing_contact/.test(key)&&/\bour (?:buyer|purchasing contact) is\b/i.test(line));
    else if(/decision_maker|decision maker/.test(key))found=/\b(?:I (?:make|approve|decide)|I'm the decision maker|I am the decision maker|final (?:decision|approval) (?:is|comes|rests|sits) with|(?:our|the) decision maker is)\b/i.test(line);
    else if(/current_supplier|supplier/.test(key))found=/\b(?:(?:we|I) (?:already )?(?:have|use|buy from|work with)|our (?:current|existing) supplier|current supplier is|currently (?:have|use))\b.{0,50}\b(?:supplier|supply|source|[A-Z][a-z]+)\b/i.test(line) && /supplier|buy from|source|supply/i.test(line);
    else if(/target_price|target|budget/.test(key))found=/(?:\$\s*\d|\b\d+(?:\.\d+)?\s*(?:USD|dollars?))/.test(line)&&/target|budget|need|pay|work|can you do|looking for|aim/i.test(line);
    else if(/current_price|price_reference/.test(key))found=/(?:\$\s*\d|\b\d+(?:\.\d+)?\s*(?:USD|dollars?))/.test(line)&&/currently pay|current (?:price|supplier)|paying|we pay|buy (?:it|this|that) for/i.test(line);
    else if(/response_to_sample|sample_offer/.test(key))found=/\b(?:send|want|need|accept|decline|don't need|do not need|no need for|interested in)\b.{0,45}\bsamples?\b/i.test(line);
    else if(/test_feedback|feedback|comparison/.test(key))found=/\b(?:we (?:tested|tried|ran|evaluated)|(?:the|your) sample (?:was|is|passed|failed)|test (?:result|feedback)|performed|performance)\b/i.test(line) && !/\?/.test(line);
    else if(/particle|size/.test(key))found=/\b(?:we (?:use|need|buy|require)|our (?:grade|size|spec)|looking for|(?:particle )?size (?:is|of))\b.{0,90}(?:\bF\d{2,4}\b|\b\d+(?:\.\d+)?\s*(?:mesh|microns?|μm|um|mm)|\b(?:coarse|fine) powder\b)/i.test(line);
    else if(/volume|quantity|quantities/.test(key))found=/\b(?:we (?:use|need|buy|require)|(?:our|the) (?:volume|quantity)|looking for|about|around|roughly)\b.{0,90}\b\d+(?:[.,]\d+)?\s*(?:tons?|tonnes?|kg|kilograms?|units?|containers?|MT)\b/i.test(line);
    else if(/spec|grade/.test(key))found=/\b(?:we (?:use|need|buy|require)|our (?:grade|spec)|looking for)\b.{0,100}(?:\bF\d{2,4}\b|\b(?:white|brown) fused alumina\b|\b(?:green|black) silicon carbide\b|\b\d+(?:\.\d+)?\s*%|\b(?:grade|mesh|microns?|μm|um)\b)/i.test(line);
    else if(key==="po" || /purchase_order/.test(key))found=/\b(?:PO|purchase order)\s*(?:is|number|#|:|will be|has been|was|sent|attached|\d)/i.test(line)&&!/\?/.test(line);
    else if(/payment/.test(key))found=/\b(?:we (?:need|require|use|pay)|our (?:payment|terms)|payment (?:terms are|is)|Net\s*\d|letter of credit|LC at sight)\b/i.test(line)&&/payment|Net\s*\d|credit|deposit|balance/i.test(line);
    else if(/delivery|shipping/.test(key))found=/\b(?:we (?:need|require|use)|our (?:delivery|shipping)|deliver to|ship to|destination|CIF|FOB|DDP|EXW)\b/i.test(line)&&/CIF|FOB|DDP|EXW|deliver|ship|port|destination/i.test(line);
    else {const terms=label.toLowerCase().match(/[a-z]{4,}/g)||[];found=!!terms.length&&terms.every(term=>lower.includes(term))&&!line.includes("?");}
    if(found && (!uncertain || /email/.test(key)))return {turnId:turn.id||`buyer-${index}`,quote:line,value};
  }
}
