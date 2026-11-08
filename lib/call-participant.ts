import {isSimpleBuyerGreeting,normalizeGreetingSeparator} from "./opening-greeting.ts";
export type ParticipantTurn={id?:string;role:string;text:string};
export type TransferAction={
  status:"intended"|"pending"|"completed"|"unavailable";
  targetName?:string;
  condition?:string;
  evidence:{turnId:string;quote:string};
};
export type CallParticipant={
  role:"unknown"|"routing"|"purchasing";
  evidence?:{turnId:string;quote:string};
  segmentStartTurnId?:string;
  introductionNeeded:boolean;
  transferPending:boolean;
  /** An offered/conditional transfer is not evidence that its target joined. */
  transfer?:TransferAction;
  afterTransfer:boolean;
  speakerName?:string;
  roleQuestionPending?:boolean;
  /** A request to reach purchasing is not itself a direct role question. */
  roleRequestPending?:boolean;
  /** The rep requested this person; this is a routing target, never evidence
   * that the target has joined or handles purchasing. */
  requestedConnection?:{targetName:string;evidence:{turnId:string;quote:string}};
  /** Actual acceptance of the earlier person's sending plan in this segment. */
  handoffPlanAccepted?:boolean;
};
export type ColdCallGateKind='right_person_check'|'gatekeeper_intent'|'unavailable_contact'|'transfer_wait';
type GateContext={turns?:ParticipantTurn[];callType?:unknown;callContext?:unknown;conversationState?:{participant?:CallParticipant;movedPastDiscovery?:boolean}};
const normalize=(value:string)=>normalizeGreetingSeparator(value).replace(/[’‘]/g,"'").replace(/\s+/g," ").trim();
const purchasing=/\b(?:purchasing|procurement|buying|buyer)\b/i;
const transfer=/\b(?:I(?:'ll| will| can| am going to|'m going to)?|let me|we(?:'ll| will| can)?|one moment[, ]+I(?:'ll| will))\b.{0,35}\b(?:transfer you|put(?:ting)? you (?:straight )?through|connect you|pass you (?:over|through|to)|hand you (?:over|to))\b|\b(?:I'm|I am) (?:transferring|connecting) you\b/i;
// A brief routing hold is not a completed transfer. ASR may nevertheless put
// that hold and the next person's explicit identity in a single audio item.
const transferHold=/^(?:(?:yes|yeah|sure|okay|ok|certainly|of course)[,.! ]+)*(?:(?:just |please )?one (?:moment|second)(?:[, ]+please)?|please hold|(?:please )?hold (?:on|the line))\b/i;
const deniedTransfer=/\b(?:can't|cannot|won't|will not|don't|do not|unable to|not able to)\b.{0,25}\b(?:transfer|connect|put you|pass you)\b/i;
const notPurchasing=/\bI (?:don't|do not|no longer) (?:handle|manage|oversee|do|look after|take care of)\b[^,;.!?]{0,25}\b(?:purchasing|procurement|buying)\b|\b(?:I'm|I am) not (?:the |a |our )?(?:buyer|purchasing manager|procurement manager)\b|\b(?:I'm|I am) not (?:responsible for|in charge of|in|from|with|the right person for)\b[^,;.!?]{0,25}\b(?:purchasing|procurement|buying)\b/i;
const excludingPurchasing=/\bI (?:handle|manage|oversee|do|look after|take care of)\b[^.!?]{0,80}\b(?:not|except|rather than)\s+(?:the )?(?:purchasing|procurement|buying)\b/i;
const negativeRoleAnswer=(line:string)=>/^(?:no[,!. ]*(?:that's not me|that is not me|not me|I don't|I do not|not my (?:area|responsibility|department))?|(?:that's|that is) not (?:me|my (?:area|responsibility|department))|I (?:don't|do not))[.! ]*$/i.test(line);
const genericRouting=/\b(?:I'm|I am) not (?:the )?right person\b|\b(?:you (?:need|should|have|want) to|you'll need to) (?:speak|talk) (?:to|with) (?:somebody|someone) else\b/i;
const wrongNumber=/\bwrong number\b|\b(?:you've|you have) (?:got|called|reached) the wrong\b/i;
const contextualRouting=(line:string)=>negativeRoleAnswer(line)||/\bI (?:don't|do not) (?:handle|manage|oversee|do|look after|take care of) (?:that|this|it)\b|\b(?:you (?:need|should|have|want) to|you'll need to) (?:speak|talk) (?:to|with)\s+\S+|^(?:please )?(?:speak|talk) (?:to|with)\s+\S+/i.test(line);
const positivePurchasing=/\bI (?:handle|manage|oversee|lead|run|do|look after|take care of|am responsible for)\s+(?:(?:all|of|the|our|my|company|company's|materials?|raw|day-to-day|international|domestic|some|part)\s+){0,6}(?:purchasing|procurement|buying)\b|\b(?:I'm|I am) (?:responsible for|in charge of)\s+(?:(?:all|of|the|our|my|company|company's|materials?|raw|day-to-day|international|domestic|some|part)\s+){0,6}(?:purchasing|procurement|buying)\b|\b(?:I'm|I am) (?:the |a |our )?(?:(?:purchasing|procurement)(?: (?:manager|director|lead|officer|agent|head))?|buyer)\b|\b(?:I'm|I am|I work) (?:in|with) (?:the )?(?:purchasing|procurement)(?: department| team)?\b|\b(?:purchasing|procurement)[,. :]+(?:[a-z][a-z'-]*\s+){0,2}(?:speaking|here)\b|\bthis is (?:the )?(?:purchasing|procurement)(?: department| team)?\b|\b(?:this is|I'm|I am|my name is)\s+[a-z][a-z'-]*(?:\s+[a-z][a-z'-]*)?\s+(?:in|from|with|at)\s+(?:the )?(?:purchasing|procurement)(?: department| team)?\b|\bI (?:make|approve|have)\s+(?:(?:the|all|our|final)\s+){0,4}purchasing (?:decisions?|approval)\b/i;
const departmentPurchasing=/^(?:(?:hello|hi|good morning|good afternoon)[,.! ]+)?(?:purchasing|procurement)(?: department)?[.! ]*$/i;
const namedPurchasing=/\b(?:this is|I'm|I am|my name is)\s+[a-z][a-z'-]*(?:\s+[a-z][a-z'-]*){0,2}\s*[,;]\s*(?:the |a |our )?(?:purchasing manager|procurement manager|buyer)\b|^(?:purchasing|procurement)(?: department)?[,.: ]+this is\s+[a-z][a-z'-]*\b/i;
const reception=/\b(?:I'm|I am) (?:only )?(?:the |a |at (?:the )?)?(?:receptionist|reception|front desk|switchboard)\b|\bthis is (?:the )?(?:reception|front desk|switchboard)\b|\b(?:this is|I'm|I am|my name is)\s+[a-z][a-z'-]*(?:\s+[a-z][a-z'-]*)?\s+(?:in|from|with|at)\s+(?:the )?(?:reception|front desk|switchboard)\b|^(?:(?:hello|hi|good morning|good afternoon)[,.! ]+)?(?:reception|front desk|switchboard)[,.! ]*(?:[a-z][a-z'-]*\s+)?(?:speaking)?[.!? ]*$/i;
const otherPurchaser=/\b(?:the|our) (?:purchasing|procurement) (?:manager|director|contact|person|team|department)\b.{0,35}\b(?:is|handles|takes care|can|will)\b|\b(?:the|our) (?:person|one|colleague|contact) (?:in charge of|responsible for|(?:who )?(?:handles?|manages?|oversees?)) (?:the |our )?(?:purchasing|procurement|buying)\b|\bour buyer (?:is|handles|can|will)\b|\b(?:you (?:need|should|have|want) to|you'll (?:need|want) to) (?:speak|talk)\b.{0,50}\b(?:purchasing|procurement|buyer)\b|\b(?:purchasing|procurement) (?:is|are) (?:handled|managed|done) by\b/i;
const unavailableContact=/\b(?:unavailable|not (?:in|here|available|free)|isn't (?:in|here|available|free)|out of (?:the )?office|can't transfer|cannot transfer|not able to transfer|away (?:today|right now))\b/i;
const routingAcknowledgement=(line:string)=>/^(?:(?:yes|yeah|yep|sure|okay|ok|all right|thank you|thanks)[,.! ]*)+$/i.test(line)||/\b(?:I|we)(?:'ll| will| can)? (?:leave|take|pass|give|relay)\b.{0,55}\b(?:note|message)\b/i.test(line);
const greeting=/^(?:hello|hi|hey|good (?:morning|afternoon|evening))\b/i;
const identityPrefix=/^(?:(?:hello|hi|hey|good (?:morning|afternoon|evening))[,!.? ]+)?(?:this is|it's|it is|my name is|I'm|I am)\s+/i;
const excludedNames=new Set(["a","an","the","not","just","calling","sorry","afraid","happy","glad","with","from","at","in","responsible","speaking","purchasing","procurement","reception","receptionist","front","switchboard","buying","buyer","only","putting","transferring","connecting","back","here","still","going","busy","fine","okay","ok","good","well","looking","using","working","handling","asking","curious","unsure","available","unavailable","ready","unable","out","away","interested","satisfied","frustrated"]);
function speakerName(line:string):string|undefined {
  const prefix=identityPrefix.exec(line);
  let tail=prefix?line.slice(prefix[0].length):undefined;
  if(!tail){
    const cleaned=line.replace(greeting,'').replace(/^[,.!\s]+/,'');
    const speaking=cleaned.match(/(?:^|[,;:])\s*([a-z][a-z'-]*(?:\s+[a-z][a-z'-]*)?)\s+(?:speaking|here)\b/i);
    if(speaking&&/["“”]|\b(?:said|says|told|tell|hear|heard|will|would|should|might|may)\b/i.test(cleaned.slice(0,(speaking.index||0)+speaking[0].indexOf(speaking[1]))))return;
    tail=speaking?.[1];
  }
  if(!tail)return;
  // A generic "I'm ready" or "This is urgent" is not a definite new identity.
  // Without a pickup/identity suffix, require the capitalization of an actual name.
  const explicitName=/my name is\s+/i.test(prefix?.[0]||"");
  const identitySuffix=/\b(?:at|from|with|in|speaking|here)\b/i.test(tail);
  if(prefix&&!explicitName&&!identitySuffix&&!/^[A-Z]/.test(tail))return;
  const name=tail.split(/[,;.!?]|\s+(?:at|from|with|in|speaking|here|and|who|how|the)\b/i)[0].trim();
  const parts=name.split(/\s+/);
  if(!name||parts.length>3||parts.some(part=>excludedNames.has(part.toLowerCase()))||!parts.every(part=>/^[a-z][a-z'-]*$/i.test(part)))return;
  return name.toLowerCase();
}

/** An ASR item is an audio chunk, not a person boundary. A fast transfer can
 * contain reception's transfer and the next person's pickup in the same item.
 * Preserve its real ID while applying those explicit events chronologically. */
function participantEvents(turn:ParticipantTurn):ParticipantTurn[]{
  if(turn.role!=='buyer')return [turn];
  const line=normalize(turn.text),action=transfer.exec(line)||transferHold.exec(line);
  if(!action||deniedTransfer.test(action[0]))return [turn];
  const after=action.index+action[0].length;
  const pickup=/(?:^|[.!?;,]\s*|\s+)(?:(?:hello|hi|hey|good morning|good afternoon)[,!. ]+)?(?:(?:this is|it's|it is|my name is|I'm|I am)\s+[A-Z][a-z'-]*(?:\s+[A-Z][a-z'-]*)?|[A-Z][a-z'-]*(?:\s+[A-Z][a-z'-]*)?\s+(?:speaking|here))\b/gi;
  for(const match of line.slice(after).matchAll(pickup)){
    const start=after+(match.index||0),candidate=line.slice(start).replace(/^[.!?;,\s]+/,'');
    // A quoted/reported/anticipated identity is still reception talking.
    // Searching an ASR item for a name must not turn "she said ..." into pickup.
    const intervening=line.slice(after,start);
    if(/["“”]|\b(?:said|says|told|tell|asks?|asked|hear|heard|will|would|should|might|may)\b/i.test(intervening))continue;
    if(!speakerName(candidate))continue;
    const prefix=line.slice(0,start).trim();
    if(!prefix)continue;
    return [{...turn,text:prefix},{...turn,text:candidate}];
  }
  return [turn];
}
const transferTarget=(line:string)=>{
  const name=line.match(/\b(?:connect|transfer|put|pass|hand)(?:ing)? you(?: (?:straight )?through| over)? to\s+([A-Z][a-z'-]*(?:\s+[A-Z][a-z'-]*)?)(?=[,.;!?]|\s+(?:if|when|once|unless|in|from|at|and)|$)/)?.[1];
  return name&&!/^(?:Purchasing|Procurement|Reception|The|Our|Someone|Somebody)$/i.test(name)?name:undefined;
};
const conditionalTransfer=(line:string)=>/\b(?:if|once|when|provided|assuming|unless|can|could|might|may)\b|\blet me (?:see|check|find out)\b/i.test(line);
const definiteUnavailable=(line:string)=>line.split(/(?<=[.!?])\s+|;\s*/).some(clause=>{
  if(/\b(?:if|unless|once|when|whether|may|might|perhaps|maybe|not sure)\b/i.test(clause)||clause.includes('?'))return false;
  return unavailableContact.test(clause)||/\b(?:nobody|no one)\b.{0,30}\b(?:available|around|answering)\b/i.test(clause);
});
const continuingTransfer=/\b(?:I'm|I am) (?:still|back)\b|\b(?:nobody|no one)\b.{0,25}\b(?:available|around|answering)\b|\bstill (?:putting|transferring|connecting|trying|checking)\b/i;
const identityOrPickup=(line:string)=>!continuingTransfer.test(line)&&(greeting.test(line)||!!speakerName(line)||positivePurchasing.test(line)||namedPurchasing.test(line)||departmentPurchasing.test(line)||reception.test(line));

/** A bounded pickup/introduction, excluding substantive requests, needs and refusals. */
export function isParticipantIntroduction(value:string):boolean {
  const line=normalize(value);
  if(!line||(line.match(/\S+/g)?.length||0)>30||continuingTransfer.test(line))return false;
  if(/\b(?:needs?|uses?|using|sends?|sending|email|e-mail|profiles?|brochures?|catalog(?:ue)?s?|specs?|specifications?|purity|prices?|pricing|quotes?|quotations?|MOQ|inventory|stock|certif\w*|quantit(?:y|ies)|volumes?|tons?|tonnes?|kg|busy)\b|\b(?:minimum order|lead time|not interested|call (?:me |us )?back|stop calling|don't call|do not call|cannot share|can't share|not (?:a )?good time|no thanks|no thank you|please hold|one moment|already have|current supplier|have a supplier)\b/i.test(line))return false;
  if(notPurchasing.test(line)||excludingPurchasing.test(line)||genericRouting.test(line)||wrongNumber.test(line))return false;
  if(isSimpleBuyerGreeting(line)||identityPrefix.test(line)&&!!speakerName(line)&&isSimpleBuyerGreeting(line.replace(/\b(?:I'm|I am)\s+/i,'this is ')))return true;
  if(line.includes("?")||/\b(?:what|which|when|where|why|how|can you|could you|would you|will you|do you|tell me|give me|explain|clarify|request)\b|\b(?:can't|cannot|unable to) (?:talk|help|speak)\b/i.test(line))return false;
  return positivePurchasing.test(line)||namedPurchasing.test(line)||departmentPurchasing.test(line)||reception.test(line);
}

/** The completed pickup suffix retains its original ASR item ID. Consumers
 * must inspect that suffix rather than rejecting the item's routing prefix. */
export function isCurrentParticipantIntroduction(latest:Pick<ParticipantTurn,'id'|'text'>,participant:CallParticipant):boolean {
  return isParticipantIntroduction(latest.text)||participant.afterTransfer&&participant.segmentStartTurnId===latest.id&&participant.transfer?.status==='completed'&&isParticipantIntroduction(participant.transfer.evidence.quote);
}

/** A person can introduce themselves and ask a real question in the same
 * item. Recognize the pickup separately from the move that should follow it. */
export function currentParticipantPickup(latest:Pick<ParticipantTurn,'id'|'text'>,participant:CallParticipant):{kind:'greeting_only'|'substantive';quote:string;participant:CallParticipant}|undefined {
  if(participant.transferPending||participant.role==='routing'||!participant.speakerName||!participant.introductionNeeded||participant.segmentStartTurnId!==latest.id)return;
  const quote=participant.afterTransfer&&participant.transfer?.status==='completed'&&participant.transfer.evidence.turnId===latest.id?participant.transfer.evidence.quote:latest.text;
  if(!speakerName(normalize(quote)))return;
  return {kind:isParticipantIntroduction(quote)?'greeting_only':'substantive',quote,participant};
}

const actualIntro=(line:string)=>{
  if(/\b(?:I'm|I am|we're|we are)\s+(?:with|from)\b|\b(?:I'm|I am|we're|we are)\s+calling\s+(?:from|on behalf of)\b|\b(?:I (?:represent|work for)|on behalf of)\b/i.test(line))return true;
  const identity=line.match(/\b(?:I'm|I am|this is|my name is)\s+([a-z][a-z'-]*(?:\s+[a-z][a-z'-]*){0,2})\s+(?:with|from)\b/i)?.[1];
  return !!identity&&identity.split(/\s+/).every(part=>/^[A-Z]/.test(part)&&!excludedNames.has(part.toLowerCase()));
};
const roleQuestion=(line:string)=>purchasing.test(line)&&(/\b(?:who|which person)\b.{0,65}\b(?:purchasing|procurement|buying|buyer|handles?|manages?|responsible|in charge)\b/i.test(line)||/\b(?:are you|is this|am I speaking (?:to|with)|would you be|is [a-z][a-z'-]*)\b.{0,70}\b(?:purchasing|procurement|buyer|responsible|in charge|right person)\b/i.test(line)||/\bdo you\b.{0,40}\b(?:handle|manage|oversee|look after|take care of)\b/i.test(line));
const roleRequest=(line:string)=>purchasing.test(line)&&/\b(?:(?:could|can|may) I (?:please )?(?:speak|talk|reach)|(?:could|can|would) you (?:please )?(?:connect me|put me through))\b.{0,75}\b(?:purchasing|procurement|buyer)\b/i.test(line);
function requestedConnectionName(line:string):string|undefined {
  const request=/\b(?:(?:(?:could|can|would) you\s+(?:please\s+)?|please\s+)(?:(?:connect|transfer) me (?:with|to)|put me through (?:to|with))|(?:could|can|may) I\s+(?:please\s+)?(?:speak|talk) (?:with|to))\s+/i.exec(line);
  if(!request)return;
  const name=line.slice(request.index+request[0].length).split(/[,;.!?]|\s+(?:in|from|at|with|please|who|that|the|responsible|handling)\b/i)[0].trim();
  const words=name.split(/\s+/);
  return name&&words.length<=3&&words.every(word=>/^[a-z][a-z'-]*$/i.test(word)&&!excludedNames.has(word.toLowerCase())&&!/^(?:person|someone|somebody|team|department|office|manager)$/i.test(word))?name:undefined;
}
const samePersonName=(one:string,two:string)=>{
  const a=normalize(one).toLowerCase(),b=normalize(two).toLowerCase();
  return a===b||a.startsWith(b+' ')||b.startsWith(a+' ');
};
const affirmative=(line:string)=>/^(?:(?:yes|yeah|yep|correct|right)[,.! ]*)?(?:that's me|that is me|that would be me|I do|speaking)[.! ]*$|^(?:yes|yeah|yep|correct|right)[.! ]*$/i.test(line);
const explicitRoleSelf=(line:string)=>/^(?:(?:yes|yeah|yep|correct|right)[,.! ]*)?(?:that's me|that is me|that would be me|I do|speaking)[.! ]*$/i.test(line);

/** Current person on the line, derived only from actual speaker-labelled call turns. */
export function deriveCallParticipant(turns:ParticipantTurn[]=[],seed?:CallParticipant):CallParticipant {
  let result:CallParticipant=seed?structuredClone(seed):{role:"unknown",introductionNeeded:true,transferPending:false,afterTransfer:false};
  let knownName=result.speakerName;
  const events=turns.flatMap(participantEvents);
  for(let index=0;index<events.length;index++){
    const turn=events[index],line=normalize(turn.text||"");if(!line)continue;
    if(turn.role==="you"){
      if(actualIntro(line))result.introductionNeeded=false;
      const targetName=requestedConnectionName(line);
      if(targetName)result.requestedConnection={targetName,evidence:{turnId:turn.id||`rep-${index}`,quote:turn.text}};
      result.roleRequestPending=roleRequest(line)&&!roleQuestion(line);result.roleQuestionPending=roleQuestion(line)||result.roleRequestPending;continue;
    }
    if(turn.role!=="buyer")continue;
    const turnId=turn.id||`buyer-${index}`,name=transferHold.test(line)?undefined:speakerName(line);
    const routingHold=transferHold.test(line)&&(result.transferPending||result.role==='routing'||result.roleRequestPending||result.role==='unknown'&&!knownName);
    const hasTransfer=(transfer.test(line)||routingHold)&&!deniedTransfer.test(line);
    const sameName=!!name&&!!knownName&&(name===knownName||name.startsWith(knownName+" ")||knownName.startsWith(name+" "));
    const differentSpeaker=!!name&&!!knownName&&!sameName;
    const definiteIdentity=!!name||positivePurchasing.test(line)||namedPurchasing.test(line)||departmentPurchasing.test(line);
    // A greeting after an active transfer can be a pickup. After a conditional
    // intention it is ambiguous: require an identity/role, not merely "hello".
    const unresolvedTransfer=result.transferPending||result.transfer?.status==='unavailable';
    const pickup=unresolvedTransfer&&!hasTransfer&&!sameName&&!definiteUnavailable(line)&&identityOrPickup(line)&&(result.transfer?.status==='pending'||!result.transfer||definiteIdentity);
    // ASR need not capture a hold. The requested person explicitly identifying
    // themselves is sufficient pickup evidence, but the request alone is not.
    const requestedPickup=!!name&&!!result.requestedConnection&&!sameName&&!hasTransfer&&!definiteUnavailable(line)&&samePersonName(name,result.requestedConnection.targetName);
    if(pickup||differentSpeaker||requestedPickup){
      const completed=unresolvedTransfer&&result.transfer?{...result.transfer,status:'completed' as const,evidence:{turnId,quote:turn.text}}:requestedPickup?{status:'completed' as const,targetName:result.requestedConnection!.targetName,evidence:{turnId,quote:turn.text}}:undefined;
      result={role:"unknown",introductionNeeded:true,transferPending:false,afterTransfer:true,segmentStartTurnId:turnId,...completed?{transfer:completed}:{}};
      knownName=undefined;
    }
    if(!result.segmentStartTurnId)result.segmentStartTurnId=turnId;
    if(name){knownName=name;result.speakerName=name;}
    const evidence={turnId,quote:turn.text};
    if(notPurchasing.test(line)||excludingPurchasing.test(line)||(!wrongNumber.test(line)&&(genericRouting.test(line)||(result.roleQuestionPending&&contextualRouting(line)))))result={...result,role:"routing",evidence};
    else if(positivePurchasing.test(line)||namedPurchasing.test(line)||departmentPurchasing.test(line)||(affirmative(line)&&result.roleQuestionPending&&(!result.roleRequestPending||explicitRoleSelf(line))))result={...result,role:"purchasing",evidence};
    else if(reception.test(line)||otherPurchaser.test(line)||hasTransfer)result={...result,role:"routing",evidence};
    if(hasTransfer){
      const condition=line.match(/\b(?:if|once|when|provided|assuming|unless)\b.*$/i)?.[0];
      result={...result,role:"routing",evidence,transferPending:true,transfer:{status:conditionalTransfer(line)?'intended':'pending',targetName:transferTarget(line)||result.transfer?.targetName,...condition?{condition}:{},evidence}};
    }else if(result.transferPending&&definiteUnavailable(line)){
      result={...result,role:'routing',evidence,transferPending:false,transfer:{...result.transfer,status:'unavailable',evidence}};
    }else if(result.transferPending&&/\b(?:please hold|hold (?:on|the line)|one (?:moment|second)|still (?:connecting|transferring)|putting you through)\b/i.test(line)){
      result={...result,transfer:{...result.transfer,status:'pending',evidence}};
    }
    // An answer may establish a role only against the preceding actual rep question.
    // A later generic yes must not reuse that question across unrelated buyer turns.
    result.roleQuestionPending=false;
    result.roleRequestPending=false;
  }
  return result;
}

/** Human-supplied role verification is usable for this initial contact. It is
 * never inferred from a name, the call objective or an earlier contact. */
export function preparedPurchasingParticipant(participant:CallParticipant,knownFacts='',doNotGuess=''):CallParticipant {
  if(participant.evidence?.turnId==='call-context')participant={...participant,role:'unknown',evidence:undefined};
  if(participant.role!=='unknown'||participant.afterTransfer||/right person|purchas\w*|procurement|buying|buyer/i.test(doNotGuess))return participant;
  const clauses=normalize(knownFacts).split(/[;\n]|(?<=[.!?])\s+/);
  const verified=clauses.find(clause=>!notPurchasing.test(clause)&&!excludingPurchasing.test(clause)&&!/\b(?:unknown|unverified|not confirmed|not verified|unsure|not sure)\b/i.test(clause)&&(positivePurchasing.test(clause)||/\bright person(?: verified)?\s*[:=]\s*(?:yes|verified|confirmed)\b|\b(?:current contact|this person|buyer) (?:is |has been )?(?:confirmed|verified) (?:as )?(?:the )?(?:purchasing contact|right person)\b|\b(?:current contact|this person|the buyer) (?:handles (?:our |the )?purchasing|is (?:the )?(?:purchasing manager|procurement manager))\b/i.test(clause)));
  return verified?{...participant,role:'purchasing',evidence:{turnId:'call-context',quote:verified}}:participant;
}

/** Stage 0 applies before a cold-call purchasing conversation has begun. A
 * legacy call that already contains an actual substantive two-way exchange is
 * not sent backwards to a gatekeeper script; a new contact starts fresh. */
export function coldCallGateFor(context:GateContext):{kind:ColdCallGateKind;participant:CallParticipant}|null {
  // A pasted exchange is already addressed correspondence, not a phone line
  // awaiting a transfer. Keep role/authority unknowns without a call-routing move.
  if('interactionType' in context&&context.interactionType==='text_email')return null;
  const callContext=context.callContext&&typeof context.callContext==='object'?context.callContext as {relationship?:string;stageId?:string;knownFacts?:string;doNotGuess?:string}:{};
  if(callContext.relationship&&callContext.relationship!=='first_contact'||context.callType&&!['discovery','gatekeeper'].includes(String(context.callType))||callContext.stageId&&!['cold_call','opening','gatekeeper'].includes(callContext.stageId))return null;
  const participant=preparedPurchasingParticipant(context.conversationState?.participant||deriveCallParticipant(context.turns||[]),callContext.knownFacts,callContext.doNotGuess);
  if(participant.role==='purchasing')return null;
  const all=context.turns||[],start=participant.afterTransfer?all.findIndex(turn=>turn.id===participant.segmentStartTurnId):0;
  if(start<0)return null;
  const turns=all.slice(start),latest=turns.findLast(turn=>turn.role!=='you');
  if(latest&&latest.role!=='buyer')return null;
  const line=normalize(latest?.text||'');
  if(/\b(?:not interested|no thanks|don't call|do not call|stop calling|wrong number|take (?:me|us) off|goodbye|I'm busy|I am busy)\b/i.test(line))return null;
  if(/\b(?:don't|do not|stop|no need to)\s+(?:send|email|share|forward|attach)\b/i.test(line))return null;
  if(participant.transferPending)return {kind:'transfer_wait',participant};
  if(participant.transfer?.status==='unavailable')return {kind:'unavailable_contact',participant};
  const unavailable=unavailableContact.test(line);
  if(unavailable&&(participant.role==='routing'||/\b(?:purchasing|procurement|buyer|manager)\b/i.test(line)||turns.some(turn=>turn.role==='you'&&roleQuestion(turn.text))))return {kind:'unavailable_contact',participant};
  // Acknowledging a note does not make the absent purchasing contact available.
  // Keep this contact's actual routing evidence through a short follow-on turn;
  // a confirmed role, transfer or new speaker clears it in deriveCallParticipant.
  if(participant.role==='routing'&&unavailableContact.test(participant.evidence?.quote||'')&&routingAcknowledgement(line))return {kind:'unavailable_contact',participant};
  if(context.conversationState?.movedPastDiscovery&&!participant.afterTransfer)return null;
  const identity=/who(?:'s| is) (?:calling|this)|who are you|what(?:'s| is) this(?: call)? (?:about|regarding|in regard to)|how (?:can|may) I help/i;
  if(identity.test(line))return {kind:participant.role==='routing'?'gatekeeper_intent':'right_person_check',participant};
  const presentSubstantive=/\b(?:send|email|specs?|specifications?|purity|content|MOQ|minimum order|prices?|pricing|quotes?|CIF|FOB|lead time|stock|inventory|certif\w*)\b/i.test(line);
  if(participant.role==='routing')return presentSubstantive?null:{kind:'right_person_check',participant};
  const repSpoke=turns.some(turn=>turn.role==='you');
  const substantiveBuyer=turns.some(turn=>turn.role==='buyer'&&!isParticipantIntroduction(turn.text)&&!identity.test(turn.text)&&!/^(?:(?:yes|yeah|yep|sure|okay|ok|go ahead|please go ahead|I'm listening|I am listening|uh+|um+|hmm+)[,.! ]*)+$/i.test(normalize(turn.text)));
  if(repSpoke&&substantiveBuyer)return null;
  return {kind:'right_person_check',participant};
}

/** Attribution-only historical evidence. It cannot make an absent contact a
 * current participant or turn a routing interaction into purchasing interest. */
export function routingHistoryFor(turns:ParticipantTurn[]=[]):{summary:string;transferStatus?:TransferAction['status'];targetName?:string}|undefined {
  const participant=deriveCallParticipant(turns);
  if(participant.role!=='routing'||participant.afterTransfer)return;
  const action=participant.transfer,target=action?.targetName?` to ${action.targetName}`:' to the intended contact';
  const detail=action?.status==='intended'?`A transfer${target} was proposed${action.condition?` conditionally (${action.condition})`:''}; completion was not captured.`
    :action?.status==='pending'?`A transfer${target} was underway; no pickup or completed conversation with that person was captured.`
    :action?.status==='unavailable'?`The attempted transfer${target} did not reach the intended contact; the contact was unavailable.`
    :'The conversation remained with a routing contact; no purchasing participant was confirmed.';
  return {summary:`Prior routing-contact interaction. ${detail} Establish who is on the line in the new call. This routing interaction alone establishes neither purchasing interest nor product requirements.`,...action?{transferStatus:action.status,...action.targetName?{targetName:action.targetName}:{}}:{}};
}
