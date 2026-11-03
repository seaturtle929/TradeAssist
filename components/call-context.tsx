import type { CallContext, StageDefinition } from "../lib/call-purpose";
import type { ConversationState } from "../lib/conversation-state";
import {BUYER_NEED_LABELS,type BuyerNeeds,type BuyerNeedEvidence,type BuyerNeedFact,type BuyerNeedKey} from "../lib/buyer-needs";

type Props={value:CallContext;stages:StageDefinition[];live:boolean;stageLocked?:boolean;configurationVersion?:number;managed?:boolean;compact?:boolean;onChange:(value:CallContext)=>void};
export function CallContextCard({value,stages,live,stageLocked,configurationVersion,managed,compact,onChange}:Props) {
  const update=(key:keyof CallContext,text:string)=>onChange({...value,[key]:text});
  const stage=stages.find(item=>item.id===value.stageId);
  return <section className="card purpose-context-card" aria-label="Call Context">
    <div className="panel-header"><div><h2>Call Context</h2><span className="muted">What we know · what this call is for</span></div><label className="purpose-stage-select">Sales stage<select aria-label="Sales stage" disabled={stageLocked} value={value.stageId} onChange={event=>update("stageId",event.target.value)}>{!stage&&<option value={value.stageId}>Choose an available stage</option>}{stages.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div>
    {!compact&&<p className="purpose-context-purpose"><strong>Manager’s stage objective:</strong> {stage?.purpose}</p>}
    <p className="context-help purpose-starting-help">{stageLocked?`This call uses configuration v${configurationVersion} and this selected stage. Applied Brain changes take effect on new calls.`:"Choose the stage for this call. Its manager playbook loads automatically; the copilot adapts to what the buyer says without changing your selection."}</p>
    <details open={!compact&&!live}><summary>{compact?"Additional call context · optional":live ? "View call context" : "Prepare this call · about 60 seconds"}</summary><fieldset disabled={stageLocked||live} className="purpose-context-fields" style={{border:0,padding:0,margin:0,minWidth:0}}>
      <label>Relationship<select aria-label="Buyer relationship" value={value.relationship} onChange={event=>update("relationship",event.target.value)}><option value="first_contact">First contact</option><option value="dormant">Bought from us before (dormant)</option><option value="existing_customer">Existing customer</option><option value="referral">Referral</option><option value="inbound">Inbound inquiry</option></select></label>
      <label>{managed?"Stage objective for this call":"This call’s goal"}<input aria-label="This call's goal" readOnly={managed} value={managed?stage?.purpose||"Choose a sales stage":value.goal} maxLength={1000} onChange={event=>update("goal",event.target.value)} placeholder="One useful next step"/>{managed&&<small className="context-help">Configured by your manager in Company Brain. Add this buyer’s specific context below.</small>}</label>
      <label className="context-wide">Background<textarea aria-label="Call background" value={value.background} maxLength={4000} onChange={event=>update("background",event.target.value)} placeholder={value.relationship==="dormant" ? "What did they buy? When? Why did contact go quiet? Leave unknown details blank." : "Previous orders, when you spoke, why contact was lost, who referred you…"}/></label>
      {value.relationship==="dormant"&&<p className="context-wide context-help">Reactivation: note what they bought, when, and why it went quiet. The copilot will use this history and ask about gaps.</p>}
      <label>Known facts about this buyer<textarea aria-label="Known buyer facts" value={value.knownFacts} maxLength={5000} onChange={event=>update("knownFacts",event.target.value)} placeholder="Role, current supplier, products/volumes, past concerns. Paste upstream research notes here."/></label>
      <label>Do not guess<textarea aria-label="Do-not-guess list" value={value.doNotGuess} maxLength={3000} onChange={event=>update("doNotGuess",event.target.value)} placeholder="Facts still unknown, e.g. current supplier's price or annual volume"/></label>
    </fieldset></details>
  </section>;
}

const stageLabels:Record<string,string>={cold_call:"Introduction",opening:"Introduction",gatekeeper:"Reaching the right person",discovery:"Understanding needs",reactivation:"Reconnecting",followup:"Following up",spec_confirmation:"Reviewing requirements",quote_sample:"Quote and sample discussion",comparison:"Reviewing buyer feedback",price_negotiation:"Price discussion",negotiation:"Price discussion",objection:"Addressing a concern",next_step:"Agreeing next steps",close:"Closing the call",closing:"Closing the call"};
const statusLabels:Record<string,string>={needs_email:"Email needed",ready:"Ready for the next action",blocked:"Waiting for the previous step",fulfilled:"Completed",cancelled:"Cancelled"};
function progressLabel(state?:ConversationState) {
  const stageName=(state as (ConversationState&{stageName?:string})|undefined)?.stageName;
  if(stageName)return stageName;
  if(state?.nextAction.kind==='capture_email'||state?.nextAction.kind==='confirm_send')return 'Confirming next steps';
  if(state?.nextAction.kind==='follow_review')return 'Following the buyer’s review';
  if(state?.nextAction.kind==='discuss_prices')return 'Price discussion';
  const id=state?.stageId||'cold_call';
  return stageLabels[id]||id.replace(/[_-]+/g,' ').replace(/^\w/,letter=>letter.toUpperCase());
}
function progressGoal(purpose:string,state?:ConversationState) {
  if(state?.nextAction.kind==='introduce_contact')return state.participant.role==='unknown'?'Briefly say who you are and why you are calling, then check whether the person who just joined handles purchasing.':'Introduce yourself and why you are calling to the person who just joined.';
  if(state?.nextAction.kind==='confirm_handoff_plan')return 'Check whether this person wants the materials their colleague suggested before asking for an email.';
  if(state?.nextAction.kind==='capture_email')return 'Confirm what the buyer asked you to send and ask for the missing email.';
  if(state?.nextAction.kind==='confirm_send')return 'Acknowledge the address and confirm what you will send.';
  if(state?.nextAction.kind==='follow_review')return 'Follow up on the agreed review before discussing prices.';
  if(state?.nextAction.kind==='discuss_prices')return 'Discuss the buyer’s quote needs using approved terms.';
  if(state?.participant?.role==='routing'){
    if(state.participant.transferPending)return 'Acknowledge the transfer and wait for the next person to answer.';
    if(/\b(?:unavailable|not (?:in|here|available)|out of (?:the )?office|can't transfer|cannot transfer|not able to transfer|away (?:today|right now))\b/i.test(state.participant.evidence?.quote||''))return 'Briefly explain the call, then ask for the purchasing contact’s name, best email and best time to reach them.';
    return 'Briefly explain the call and reach the person who handles purchasing.';
  }
  if(state?.stageId==='cold_call'||state?.stageId==='opening'){
    if(state.participant?.role==='unknown')return 'Briefly say who you are and why you are calling, then ask to speak with purchasing before exploring needs.';
    return state.participant&&!state.participant.introductionNeeded?'Understand how they use the material and what matters to them.':'Introduce yourself and the relevant reason for calling, then invite them to share.';
  }
  return purpose||'Introduce yourself and why you are calling, then explore a relevant need.';
}
type HUDItem={key:string;label:string;complete:boolean;required?:boolean;value?:string;evidence?:{turnId?:string;quote?:string};source?:'transcript'|'context'|'memory'};
const interestLabels:Record<BuyerNeeds['interest']['kind'],string>={unknown:'Not yet stated',information:'Reviewing information',comparison:'Comparing price or specifications',backup:'Considering a backup source',replacement:'Considering a supplier change'};
function understandingGap(needs:BuyerNeeds) {
  if(needs.facts.difficulty&&!needs.facts.impact)return 'The effect of the stated difficulty is still unclear.';
  if(!needs.facts.application)return 'How the material fits their business is still unclear.';
  if(!needs.facts.priority)return 'What matters most to this buyer is still unclear.';
  if(!needs.facts.evaluation)return 'Their requirements for evaluating a new source are not yet stated.';
  return 'Let the buyer guide what is useful to explore next.';
}
function needsEvidence(fact:BuyerNeedEvidence) {
  return <details className="buyer-understanding-evidence"><summary>{fact.source==='context'?'Prepared context':'Buyer said'} · See exact words</summary><blockquote>{fact.quote}</blockquote></details>;
}
function BuyerUnderstanding({needs,onCorrect}:{needs?:BuyerNeeds;onCorrect?:()=>void}) {
  const facts=needs?Object.entries(needs.facts).filter((entry):entry is [BuyerNeedKey,BuyerNeedFact]=>!!entry[1]):[];
  const confirmed=facts.filter(([,fact])=>fact.status==='confirmed').length;
  return <details className="buyer-understanding" aria-label="Buyer understanding">
    <summary><span>Buyer understanding</span><span>{confirmed?`${confirmed} buyer ${confirmed===1?'statement':'statements'}`:facts.length?'Prepared context':'Still getting to know them'}</span></summary>
    <div className="buyer-understanding-body">
      <div className="buyer-understanding-interest"><strong>Interest</strong><span>{needs?interestLabels[needs.interest.kind]:'Not yet stated'}{needs?.interest.status==='prepared'&&<small>Prepared context</small>}{needs?.interest.status==='possible'&&<small>The buyer mentioned this as a possibility.</small>}</span></div>
      {needs?.interest.evidence&&needsEvidence(needs.interest.evidence)}
      {facts.length>0?<dl className="buyer-understanding-facts">{facts.map(([key,fact])=><div key={key}><dt>{BUYER_NEED_LABELS[key]}</dt><dd><p>{fact.value}</p>{needsEvidence(fact)}</dd></div>)}</dl>:<p className="buyer-understanding-empty">The buyer has not shared their needs yet. Give them room to describe what matters to them.</p>}
      {needs&&facts.length>0&&<p className="buyer-understanding-gap"><strong>Still unclear</strong> {understandingGap(needs)}</p>}
      {!!needs?.declinedTopics.length&&<p className="buyer-understanding-boundary">A boundary is noted. Give the buyer room to decide what they want to discuss.</p>}
      {!!needs?.earlierContactFacts.length&&<details className="buyer-understanding-earlier"><summary>Earlier contact’s comments · {needs.earlierContactFacts.length}</summary><p>These comments belong to the person who spoke before the transfer.</p><ul>{needs.earlierContactFacts.map((fact,index)=><li key={`${fact.key}-${index}`}><strong>{BUYER_NEED_LABELS[fact.key]}:</strong> {fact.value}{needsEvidence(fact)}</li>)}</ul></details>}
      {onCorrect&&<button type="button" className="text-button buyer-understanding-correct" onClick={onCorrect}>Add buyer context</button>}
    </div>
  </details>;
}
export function PurposeHUD({purpose,items,state,onCorrect,observationOnly=false}:{purpose:string;items:HUDItem[];move:string;state?:ConversationState;onCorrect?:()=>void;observationOnly?:boolean}) {
  const collected=items.filter(item=>item.complete&&item.source!=='context'&&item.source!=='memory').length;
  const open=state?.commitments.filter(item=>item.status!=='cancelled'&&item.status!=='fulfilled')||[];
  return <section className="card purpose-hud" aria-label="Call progress">
    <div className="call-progress-header"><h2>Call progress</h2><span className="call-progress-stage">{progressLabel(state)}</span></div>
    <p className="call-progress-person" aria-label="Current contact role" title={state?.participant?.evidence?.quote}><strong>Person on the line:</strong> {state?.participant?.role==='purchasing'?'Handles purchasing':state?.participant?.role==='routing'?state.participant.transferPending?'Routing contact · transfer offered':'Front desk / routing contact':'Role not yet known'}</p>
    <div className="call-progress-goal"><strong>{observationOnly?'Manager’s stage objective':'Goal right now'}</strong><p>{observationOnly?purpose:progressGoal(purpose,state)}</p></div>
    <p className="call-progress-note">{observationOnly?'Call understanding updates as you talk. Use Suggest next move when you want guidance.':'This guides the copilot and updates as you talk. A stage label does not mean the buyer has agreed to a deal step.'}</p>
    <BuyerUnderstanding needs={state?.buyerNeeds} onCorrect={onCorrect}/>
    <details className="call-progress-details"><summary>Call details · {collected} captured{open.length?` · ${open.length} open next ${open.length===1?'step':'steps'}`:''}</summary>
      <div className="call-progress-facts"><h3>Collected this call</h3><div className="purpose-checklist" role="list" aria-label="Buyer information checklist">{items.map(item=><div role="listitem" key={item.key} className={item.complete?'complete':''} title={item.evidence?.quote||'Not yet provided by the buyer'}><span aria-hidden="true">{item.complete?'✓':'○'}</span><span>{item.label}{item.complete&&(item.source==='context'||item.source==='memory')&&<small>{item.source==='context'?'Prepared context':'Previous history'}</small>}</span><span className="sr-only">{item.complete?'Captured':'Not captured'}</span></div>)}</div></div>
      {open.length>0&&<div className="call-progress-commitments"><h3>Agreed next steps still open</h3><ol>{open.map(item=><li key={item.id}><span>{item.action}</span><small>{statusLabels[item.status]||'Needs follow-up'}</small></li>)}</ol></div>}
      {!open.length&&state?.lastAgreedNextStep&&<div className="call-progress-commitments"><h3>Last agreed next step</h3><p>{state.lastAgreedNextStep}</p></div>}
    </details>
  </section>;
}
