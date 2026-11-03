import type {CoachingContext} from './call-coaching';
import type {CoachingPartialSpeech,CoachingPendingSpeech,CoachingRequest} from './on-demand-coaching';
import {deriveConversationState} from './conversation-state.ts';

export type CoachingSpeechSnapshot={partials:CoachingPartialSpeech[];pendingSpeech:CoachingPendingSpeech[]};
const ordered=<T extends {at?:number;order?:number}>(items:T[])=>items.map((item,index)=>({item,index})).sort((a,b)=>
 a.item.at!==undefined&&b.item.at!==undefined&&a.item.at!==b.item.at?a.item.at-b.item.at:
 a.item.order!==undefined&&b.item.order!==undefined&&a.item.order!==b.item.order?a.item.order-b.item.order:a.index-b.index).map(({item})=>item);

/** Freeze available speech at generation dispatch (click or queued release). Provisional words never enter turns,
 * canonical buyer facts or agreement reducers. IDs prevent a late UI partial
 * from duplicating its already finalized transcript item. */
export function snapshotCoachingContext<T extends CoachingContext>(context:T,observed:Partial<CoachingSpeechSnapshot>={}):T {
 const snapshot=structuredClone(context),request=snapshot.coachingRequest;
 if(!request)return snapshot;
 const uncertain=(snapshot.turns||[]).filter(turn=>!!(turn as {transcriptionUncertainty?:unknown}).transcriptionUncertainty);
 if(uncertain.length){
  snapshot.turns=(snapshot.turns||[]).filter(turn=>!(turn as {transcriptionUncertainty?:unknown}).transcriptionUncertainty);
  snapshot.conversationState=deriveConversationState(snapshot);
 }
 const finalIds=new Set((snapshot.turns||[]).map(turn=>turn.id).filter(Boolean));
 const partials:CoachingPartialSpeech[]=[];
 const currentIds=request.listeningSession?new Set(request.listeningSession.currentTurnIds):undefined;
 const uncertainPartials:CoachingPartialSpeech[]=uncertain.filter(turn=>!currentIds||!!turn.id&&currentIds.has(turn.id)).map(turn=>({id:turn.id,role:turn.role==='you'?'you':turn.role==='buyer'?'buyer':'conversation',text:turn.text,at:turn.at,transcriptionUncertainty:(turn as {transcriptionUncertainty?:{reason:string;message:string}}).transcriptionUncertainty}));
 for(const part of [...request.partials||[],...observed.partials||[],...uncertainPartials]){
  if(!part.text.trim()||part.id&&(finalIds.has(part.id)||currentIds&&!currentIds.has(part.id)))continue;
  const index=partials.findIndex(old=>part.id&&old.id?part.id===old.id:old.role===part.role&&old.text===part.text);
  if(index<0)partials.push({...part,text:part.text.slice(0,6000)});
  else {const old=partials[index];partials[index]={...old,...part,role:old.role,text:part.text.slice(0,6000)};}
 }
 const pending:CoachingPendingSpeech[]=[];
 for(const item of [...request.pendingSpeech||[],...observed.pendingSpeech||[]]){
  if(finalIds.has(item.id)||currentIds&&!currentIds.has(item.id))continue;
  const index=pending.findIndex(old=>old.id===item.id);
  const next={...item,hasPartial:partials.some(part=>part.id===item.id)||item.hasPartial===true};
  if(index<0)pending.push(next);else pending[index]={...pending[index],...next,role:pending[index].role};
 }
 snapshot.coachingRequest={...request,partials:ordered(partials).slice(-6),pendingSpeech:ordered(pending).slice(-12),transcriptState:partials.length?'partial':pending.length?'pending':snapshot.turns?.length?'confirmed':'empty'};
 return snapshot;
}

export function coachingConversationAtRequest(context:CoachingContext) {
 const request=context.coachingRequest;
 return ordered([
  ...(context.turns||[]).map(turn=>({...turn,provisional:false,transcriptionPending:false})),
  ...(request?.partials||[]).map(part=>({...part,provisional:true,transcriptionPending:true})),
  ...(request?.pendingSpeech||[]).filter(item=>!request?.partials?.some(part=>part.id===item.id)).map(item=>({...item,provisional:true,transcriptionPending:true})),
 ]);
}

export function coachingTranscriptState(context:CoachingContext):NonNullable<CoachingRequest['transcriptState']> {
 return context.coachingRequest?.partials?.length?'partial':context.coachingRequest?.pendingSpeech?.length?'pending':context.turns?.length?'confirmed':'empty';
}

export type CoachingRequestFocus={kind:'partial'|'pending'|'confirmed'|'empty';role?:'buyer'|'you'|'conversation';text:string;displayText:string;turnId?:string};

/** The card describes current speech available at dispatch, not an older listening session.
 * Provisional words stay provisional and never become a buyer agreement. */
export function coachingRequestFocus(context:CoachingContext):CoachingRequestFocus {
 const all=coachingConversationAtRequest(context),session=context.coachingRequest?.listeningSession;
 const currentIds=session?new Set(session.currentTurnIds):undefined;
 const conversation=currentIds?all.filter(turn=>turn.transcriptionPending||!!turn.id&&currentIds.has(turn.id)):all,latest=conversation.at(-1);
 if(latest?.transcriptionPending){
  const role=latest.role==='buyer'?'buyer':latest.role==='you'?'you':'conversation';
  const text='text' in latest?latest.text||'':'';
  const speaker=role==='buyer'?'Buyer':role==='you'?'You':'Call audio';
  return {kind:text?'partial':'pending',role,text,displayText:text?`${speaker} — still transcribing: ${text}`:`${speaker} — speech is still being transcribed`,turnId:latest.id};
 }
 const buyer=[...conversation].reverse().find(turn=>turn.role==='buyer'&&!turn.transcriptionPending);
 if(buyer&&'text' in buyer)return {kind:'confirmed',role:'buyer',text:buyer.text||'',displayText:buyer.text||'',turnId:buyer.id};
 if(currentIds&&all.some(turn=>!turn.transcriptionPending&&!!turn.id&&!currentIds.has(turn.id)))return {kind:'confirmed',text:'',displayText:'Listening resumed — no new buyer words captured yet.'};
 return {kind:context.turns?.length?'confirmed':'empty',text:'',displayText:''};
}
