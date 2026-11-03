import type {CoachingContext} from './call-coaching.ts';
import {substantiveBuyerQuestions} from './buyer-turn-intent.ts';

/** A narrow early-call need statement asks for conversation, not an invented
 * supplier capability followed by an unnecessary factory check. Explicit or
 * implied company questions, materials requests and agreed steps stay on the
 * ordinary factual/commitment paths. */
export function isNeedsOnlyTurn(context:CoachingContext):boolean {
 if(substantiveBuyerQuestions(context).length)return false;
 if(!context.callContext||context.callContext.stageId!=='cold_call'||context.conversationState?.movedPastDiscovery)return false;
 if(context.conversationState&&context.conversationState.moment!=='general')return false;
 const latest=[...(context.turns||[])].reverse().find(turn=>turn.role!=='you')?.text.replace(/[’‘]/g,"'")||'';
 if(/[?]|\b(?:you|your|send|email|share|forward|attach|quote|quotation|offer|confirm|tell|explain|interested|don't call|do not call|stop calling)\b/i.test(latest))return false;
 return /\b(?:we (?:use|buy|purchase|need|require)|we(?:'re| are) looking for|our (?:application|production|purchasing|requirements?|priority))\b/i.test(latest);
}

export const NEEDS_ONLY_INSTRUCTIONS='\nCURRENT RESPONSE SCOPE: This buyer turn describes their own needs, not a request for supplier facts. Respond to that context and ask at most one relevant, easy question that advances the current call. Use the immediate conversational objective; an outstanding send must not suppress a new need or concern. Connect only explicitly supported company facts to the stated need. Do not add unsupported capability, quality, delivery, sample or guarantee claims, and do not defer this ordinary conversation to the factory.';
