import {hasAffirmativeMaterialsRequest,type ConversationState} from './conversation-state.ts';
import type {CoachingContext} from './call-coaching.ts';
import {substantiveBuyerQuestions} from './buyer-turn-intent.ts';

/** Only a current, agreed document/review move can bypass generation. Other
 * questions keep their normal answer and source-check path. */
export function isSimpleMaterialHandoff(context:CoachingContext,state:ConversationState):boolean {
  if(substantiveBuyerQuestions(context).length)return false;
  if(!['capture_email','confirm_send'].includes(state.nextAction.kind))return false;
  const latest=[...(context.turns||[])].reverse().find(turn=>turn.role!=='you');
  if(latest?.role!=='buyer')return false;
  const sending=state.commitments.find(item=>item.id==='send_materials');
  if(!sending||!['needs_email','ready'].includes(sending.status))return false;
  const line=latest.text.replace(/[’‘]/g,"'");
  const questionText=line
    .replace(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}/gi,'EMAIL')
    .replace(/\bhow about\s*(?:(?:this|that)\s*[:,?]?\s*)?/gi,'')
    .replace(/\b(?:can|could|would|will) you\s+(?:please\s+)?(?:also\s+)?(?:send|email|share|forward|attach|include)\b/gi,'send')
    .replace(/\b(?:a )?copy of what (?:you|we) (?:produce|make)\b/gi,'product information');
  if(/\b(?:what|which|who|where|when|why|how|explain|clarify|confirm|verify|tell me)\b/i.test(questionText))return false;
  if(/(?:^|[.!?;:]\s*|\b(?:and|but)\s+)(?:can|could|would|will|do|does|did|are|is|have|has)\s+(?:you|your|we|I|it|there)\b/i.test(questionText))return false;
  if(/\b(?:purity|content|percentage|Al[₂2]?O[₃3]?|certif\w*|MOQ|minimum order|lead[- ]?time|stock|inventory|ship\w*|deliver\w*|payment|discount\w*|guarantee\w*|free|samples?|CIF|FOB|EXW|DDP|ISO|FDA|REACH|RoHS|ASTM)\b/i.test(questionText))return false;
  // Prices may be a later agreed step, not a request for a number right now.
  if(/\b(?:pric\w*|quot\w*)\b/i.test(questionText)&&(!state.sequence.some(step=>step.id==='prices_after_review')||questionText.includes('?')||/\b(?:now|today|how much|give me|tell me)\b/i.test(questionText)))return false;
  const currentRequest=hasAffirmativeMaterialsRequest(line);
  if(!currentRequest&&/\b(?:not|never|won't|will not|can't|cannot|don't|do not|couldn't|wouldn't|might|may|maybe|perhaps|if|unless)\b/i.test(questionText))return false;
  const currentEvidence=!!latest.id&&sending.evidence.some(item=>item.turnId===latest.id);
  const currentAddress=!!latest.id&&state.facts.email?.turnId===latest.id;
  const reviewContinuation=state.sequence.some(step=>['buyer_review','engineer_review','prices_after_review'].includes(step.id))
    &&/\b(?:I|we|my engineer|our (?:engineer|technical team)|the engineer)\b.{0,100}\b(?:review\w*|take a look|look through|get back|come back|evaluat\w*)\b/i.test(line);
  return currentRequest||currentEvidence||currentAddress||reviewContinuation;
}
