import {deriveCallParticipant} from './call-participant.ts';
import type {ClientCoachingContext} from './client-coaching-context';

type RouteContext={interactionType?:import('./trade').InteractionType;clientContext?:ClientCoachingContext;brain?:unknown;coachingRequest?:{listeningSession?:{currentTurnIds:string[]};partials?:unknown[];pendingSpeech?:unknown[];transcriptState?:string};turns?:{id?:string;role:string;text:string;transcriptionUncertainty?:unknown}[]};
const capturedUnfinishedSpeech=(context:RouteContext)=>!!(context.coachingRequest?.partials?.length||context.coachingRequest?.pendingSpeech?.length||['partial','pending'].includes(context.coachingRequest?.transcriptState||''));
const nameKey=(value:string)=>value.toLowerCase().replace(/[^a-z'-]+/g,' ').trim();
const sameName=(a:string,b:string)=>{const x=nameKey(a),y=nameKey(b);return !!x&&!!y&&(x===y||(!x.includes(' ')||!y.includes(' '))&&x.split(' ')[0]===y.split(' ')[0]);};

/** The dialed route describes where the call starts, not who answered it.
 * Current speaker identity comes only from this call's confirmed speech. */
export function callRouteAtRequest(context:RouteContext){
 const nested=context.brain&&typeof context.brain==='object'&&'clientContext' in context.brain?context.brain.clientContext as ClientCoachingContext|undefined:undefined;
 const client=context.clientContext||nested;
 if((context.interactionType||client?.interactionType||'call_meeting')!=='call_meeting')return;
 const route=client?.reachViaContact||(client?.contact?.kind==='main_line'?client.contact:undefined);
 if(route?.kind!=='main_line')return;
 const target=client?.contact?.kind==='person'?client.contact:undefined;
 const currentIds=context.coachingRequest?.listeningSession?.currentTurnIds;
 const turns=(context.turns||[]).filter(turn=>!turn.transcriptionUncertainty&&(!currentIds||!!turn.id&&currentIds.includes(turn.id)));
 const participant=deriveCallParticipant(turns);
 const targetPresent=!!target&&!!participant.speakerName&&sameName(target.name,participant.speakerName)&&!participant.transferPending&&participant.role!=='routing';
 const buyerTurns=turns.filter(turn=>turn.role==='buyer');
 const routingNeeded=target?!targetPresent:participant.role!=='purchasing';
 return {route:'company_main_line' as const,target:target?{name:target.name,role:target.role}:undefined,currentSpeaker:participant.speakerName,targetPresent,routingNeeded,transferStatus:participant.transfer?.status,opening:!buyerTurns.length,participantRole:participant.role};
}

export function callRouteDecisionRules(context:RouteContext):string {
 const route=callRouteAtRequest(context);if(!route?.routingNeeded)return '';
 if(capturedUnfinishedSpeech(context))return 'DIALED ROUTE AND UNFINISHED SPEECH: Current speech is being recognized or clarified; this is not an empty-call opener. Do not force a transfer request over a listening or audio-clarification move. The intended contact remains unconfirmed: do not greet them as present or assert their prior requests. Route state: '+JSON.stringify(route);
 return 'DIALED ROUTE BEFORE SALES STAGE: This call is through the company main line. The intended contact is '+JSON.stringify(route.target||{name:'not known'})+', but that selection is not evidence they answered. Until current speech identifies that person, do not greet them by name or address their prior requests as if they are present. For an empty-call opener or a generic office greeting, briefly identify the rep and represented company using known information, then politely ask to be connected to the intended contact (and known role). This routing step applies in EVERY sales stage; it does not change the selected stage or restart discovery. If a transfer is underway, acknowledge and hold; if unavailable, use an appropriate known alternate route. Respond to an actual question from the current speaker before any useful routing request. Once the intended person identifies themselves, use the reviewed prior relationship and this call\'s selected objective. Route state: '+JSON.stringify(route);
}

export function callRouteSuggestionProblems(say:string,context:RouteContext):string[]{
 const route=callRouteAtRequest(context);if(!route?.routingNeeded)return [];
 const errors:string[]=[],name=route.target?.name.split(/\s+/)[0].replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 if(name&&new RegExp('\\b(?:hi|hello|hey|good morning|good afternoon|thanks|thank you|of course)[, !—-]*'+name+'\\b','i').test(say))errors.push('The intended contact has not identified themselves on the company main line. Address the current answerer and request a transfer; do not greet the intended contact yet.');
 if(route.opening){
  const connection=/\b(?:connect|transfer|put me through|speak (?:to|with)|speaking (?:to|with)|reach|pass me|speaking (?:with|to))\b/i.test(say);
  if(!connection&&!capturedUnfinishedSpeech(context))errors.push('A main-line opener must politely ask to reach the intended contact before using their prior relationship or the sales-stage objective.');
  if(/\b(?:have you|did you|have your|has your|you(?:['’]d| had)? requested|your (?:requirements|needs|team))\b/i.test(say))errors.push('Do not direct the absent contact’s discovery or document follow-up to an unidentified main-line answerer.');
 }
 return errors;
}
