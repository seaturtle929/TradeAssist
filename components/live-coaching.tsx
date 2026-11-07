import {readableCoachingMove} from "../lib/coaching-labels";
import {EDIT_REASONS,type EditReason} from "../lib/company-brain";
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { ArrowDown, Check, Copy, Loader2, ShieldCheck, Sparkles } from "lucide-react";
import type { Guidance } from "../lib/trade";
import type { SuggestionRecord } from "../lib/phase1-types";
import { stageLabel } from "../lib/call-coaching";
import {hasWordingEdit} from "../lib/reply-history";
import "./stage-stream.css";
import type {LiveLatencySnapshot} from '../lib/live-latency';

type Feedback = "used"|"ignored";
type CardGuidance = Guidance & {phase?:"bridge"|"answer"|"landing";questionEcho?:string;analysisReady?:boolean};
type SavedCard = Omit<SuggestionRecord,"status"|"guidance"> & {guidance:CardGuidance;status:"suggested"|"used"|"edited"|"ignored"|"superseded";buyerQuote?:string;actualSpoken?:string;pending?:boolean;superseded?:boolean};
type Props={waitingForBuyer?:boolean;guidance:Guidance|null;guidanceId?:string;guidanceAt?:number;suggestions?:SuggestionRecord[];pendingBuyerText?:string;thinking:boolean;checkingFacts:boolean;liveDraft:boolean;bilingual:boolean;latency:number;liveTiming?:LiveLatencySnapshot;currentStage:string;repSpeaking:boolean;onCopy:(text?:string)=>void;onOpening:()=>void;configured:boolean|null;onFeedback?:(id:string,status:Feedback)=>void;onEdit?:(id:string,text:string,rememberVoice:boolean,reason?:EditReason)=>void;onReplyPaint?:(id:string,say:string,full:boolean,atMs:number)=>void};
const replyTime=(at:number)=>new Date(at).toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit",second:"2-digit"});
const validTime=(at:number)=>Number.isFinite(at)&&Math.abs(at)<=8.64e15;
const requestFailed=(entry:SavedCard)=>!entry.guidance.say.trim()&&entry.coachingTrace?.some(event=>event.event==='failed');

export function ReplyVerificationChanges({entry}: {entry:Pick<SuggestionRecord,"verificationReplacements"|"verificationProposals">}) {
  return <>{[...(entry.verificationReplacements||[]).map(change=>({...change,protectedEdit:false})),...(entry.verificationProposals||[]).map(change=>({...change,protectedEdit:true}))].map((change,index)=><details className="reply-verification-diff" key={`${change.at}-${index}`}>
        <summary>{change.protectedEdit ? "Source check changed the original AI draft. Your edited line is unchanged." : change.originalWasDisplayed ? "Reply updated after checks — view changes" : "Draft revised before display — view changes"}</summary>
        <div><p><strong>Original AI draft</strong><del>{change.originalSay}</del></p><p><strong>{change.protectedEdit ? "Checked AI draft (not applied)" : "Checked reply"}</strong><ins>{change.replacementSay}</ins></p></div>
      </details>)}</>;
}

export function SuggestionLearningAttribution({value}:{value:Guidance}) {
 const learning=value.learningAttribution;
 return <div className="reply-learning-attribution"><p><strong>Guidance retrieved:</strong> {learning?.moveName||'None'} · <strong>Company guidance / product examples:</strong> {learning?.lessonIds.length||learning?.patternIds.length ? `${learning.lessonIds.length} company lessons · ${learning.patternIds.length} product examples` : 'None'}</p>
 <small>Retrieval does not establish that this suggestion followed the guidance.</small>{!!learning?.lessons.length&&<details><summary>See retrieved company guidance</summary>{learning.lessons.map(lesson=><div key={lesson.id}><blockquote>{lesson.goodLine||'Strategy from your explanation'}</blockquote><p>{lesson.why}</p><small>{lesson.id}</small></div>)}</details>}
 {!!learning?.patternIds.length&&<details><summary>Product examples retrieved</summary>{learning.patternIds.map(id=><p key={id}>{id}</p>)}</details>}</div>;
}

export function CoachingDiagnostics({entries}:{entries:SuggestionRecord[]}) {
  const issues=entries.filter(entry=>entry.coachingIssue),requests=entries.filter(entry=>entry.coachingTrace?.length);
  return issues.length+requests.length>0?<details className="reply-feed-details coaching-diagnostics" aria-label="Coaching diagnostics"><summary>Diagnostics · {requests.length} requests · {issues.length} internal drafts</summary><p>Internal drafts and validation results are retained for review. They are not suggested wording and do not establish what was said.</p>{issues.map(entry=><div key={entry.id} data-diagnostic-id={entry.id}><strong>{replyTime(entry.at)} · {entry.coachingIssue?.status}</strong><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{entry.guidance.say}</pre><p>{entry.coachingIssue?.reason}</p>{entry.coachingIssue?.correction&&<p><strong>Proposed correction · not applied:</strong> {entry.coachingIssue.correction}</p>}</div>)}{requests.map(entry=><details key={entry.id}><summary>Request at {replyTime(entry.at)} · {entry.coachingTrace?.length} events</summary><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{JSON.stringify(entry.coachingTrace,null,2)}</pre></details>)}</details>:null;
}

/** One chronological feed keeps every suggested reply available during the call. */
export function LiveCoachingCard({waitingForBuyer=false,guidance,guidanceId="",guidanceAt=0,suggestions=[],pendingBuyerText="",thinking,checkingFacts,liveDraft,bilingual,latency,liveTiming,currentStage,onCopy,onFeedback,onEdit,onReplyPaint}:Props) {
  const g=guidance as CardGuidance|null;
  const records=new Map<string,SavedCard>();
  for(const candidate of (Array.isArray(suggestions) ? suggestions : []) as SavedCard[]) {
    if(!candidate || typeof candidate.id!=="string" || typeof candidate.guidance?.say!=="string" || candidate.guidance.phase==="bridge" || (!candidate.guidance?.say?.trim() && !(candidate.pending&&candidate.buyerQuote?.trim())&&!requestFailed(candidate)) || !validTime(candidate.at))continue;
    records.set(candidate.id,candidate);
  }
  const activeId=guidanceId || "current-reply",saved=records.get(activeId);
  const active=g?.phase!=="bridge" && g?.say.trim() ? (saved&&hasWordingEdit(saved) ? saved.guidance : g) : null;
  if(active)records.set(activeId,{...saved,id:activeId,at:saved?.at || (validTime(guidanceAt) ? guidanceAt : 0),guidance:active,status:saved?.status || "suggested",bilingual:saved?.bilingual ?? bilingual,sourceSnapshot:saved?.sourceSnapshot || [],buyerQuote:saved?.buyerQuote || active.questionEcho || pendingBuyerText.trim(),pending:false});
  const rows=[...records.values()].filter(item=>!item.coachingIssue);
  const newestReplyId=rows.findLast(item=>!item.coachingIssue&&!!item.guidance.say.trim())?.id || "";
  const newestId=rows.at(-1)?.id || "";
  const pending=waitingForBuyer||thinking||checkingFacts;
  const status=waitingForBuyer ? "Listening… your suggestion will appear when they finish." : thinking ? (bilingual ? "正在生成下一步建议…" : "Generating your next move…") : checkingFacts ? (bilingual ? "正在核对建议中的事实…" : "Checking facts in this suggestion…") : rows.length ? (bilingual ? "需要下一步建议时，点击“Suggest next move”。" : "Request another next move whenever you need it.") : (bilingual ? "准备好时，点击“Suggest next move”。" : "Ready when you request a next move.");
  const history=useRef<HTMLDivElement>(null),following=useRef(true),previousLastId=useRef("");
  const anchor=useRef<{id:string;offset:number}|null>(null);
  const [away,setAway]=useState(false),[newReplies,setNewReplies]=useState(0);
  const [editing,setEditing]=useState<{id:string;text:string;rememberVoice:boolean;reason:EditReason|null}|null>(null);
  const painted=useRef(new Set<string>());
  const paintSay=active?.say||'',paintFull=active?.scriptComplete===true;
  useEffect(()=>{
    if(!onReplyPaint||!activeId||!paintSay||saved&&hasWordingEdit(saved)||typeof requestAnimationFrame!=='function')return;
    const key=JSON.stringify([activeId,paintSay,paintFull]);if(painted.current.has(key))return;
    let second=0;
    const first=requestAnimationFrame(()=>{second=requestAnimationFrame(()=>{
      const node=history.current,entry=node&&[...node.querySelectorAll<HTMLElement>('[data-reply-id]')].find(row=>row.dataset.replyId===activeId),script=entry?.querySelector<HTMLElement>('.reply-feed-script');
      if(!node||!script||script.textContent?.trim()!==paintSay.trim())return;
      const rect=script.getBoundingClientRect(),view=node.getBoundingClientRect();
      // A clipped script or a card below the page fold is not a fully visible
      // reply. Reading older cards must not falsely finish the live timer.
      if(document.visibilityState!=='visible'||rect.height<=0||rect.width<=0||rect.top<Math.max(0,view.top)-1||rect.bottom>Math.min(window.innerHeight,view.bottom)+1||rect.left<0||rect.right>window.innerWidth)return;
      painted.current.add(key);onReplyPaint(activeId,paintSay,paintFull,performance.now());
    });});
    return()=>{cancelAnimationFrame(first);if(second)cancelAnimationFrame(second);};
  },[activeId,paintSay,paintFull,onReplyPaint,saved,away]);
  const editor=useRef<HTMLFormElement>(null);
  const rowIds=rows.map(row=>row.id).join("\0");
  useEffect(()=>{if(editing&&!records.has(editing.id))setEditing(null);},[rowIds,editing?.id]);
  useLayoutEffect(()=>{
    if(!editing)return;
    following.current=false;setAway(true);editor.current?.scrollIntoView({block:"nearest"});rememberAnchor();
  },[editing?.id]);

  function rememberAnchor() {
    const node=history.current;if(!node)return;
    const top=node.getBoundingClientRect().top;
    const first=[...node.querySelectorAll<HTMLElement>("[data-reply-id]")].find(item=>item.getBoundingClientRect().bottom>top+1);
    anchor.current=first ? {id:first.dataset.replyId || "",offset:first.getBoundingClientRect().top-top} : null;
  }
  // Keep the visible exchange anchored while the user reads older replies, even
  // when streaming text or the newest-card emphasis changes heights above it.
  useLayoutEffect(()=>{
    const node=history.current;if(!node)return;
    if(!rows.length&&!pending){following.current=true;previousLastId.current="";anchor.current=null;if(away)setAway(false);if(newReplies)setNewReplies(0);return;}
    if(following.current){node.scrollTop=node.scrollHeight;if(away)setAway(false);if(newReplies)setNewReplies(0);}
    else {
      if(anchor.current){const item=[...node.querySelectorAll<HTMLElement>("[data-reply-id]")].find(item=>item.dataset.replyId===anchor.current?.id);if(item)node.scrollTop+=item.getBoundingClientRect().top-node.getBoundingClientRect().top-anchor.current.offset;}
      if(newestId && previousLastId.current && previousLastId.current!==newestId)setNewReplies(count=>count+1);
    }
    previousLastId.current=newestId;
    rememberAnchor();
  });
  function onScroll() {
    const node=history.current;if(!node)return;
    const atBottom=node.scrollHeight-node.scrollTop-node.clientHeight<=40;
    following.current=atBottom&&!editing;setAway(!atBottom||!!editing);if(atBottom&&!editing)setNewReplies(0);
    rememberAnchor();
  }
  function jumpToLatest() {
    const node=history.current;if(!node)return;
    following.current=true;node.scrollTop=node.scrollHeight;setAway(false);setNewReplies(0);rememberAnchor();node.focus({preventScroll:true});
  }
  function onHistoryKeyDown(event:KeyboardEvent<HTMLDivElement>) {
    if(event.target!==event.currentTarget)return;
    const node=history.current;if(!node)return;
    if(event.key==="End"){event.preventDefault();jumpToLatest();return;}
    const target=event.key==="Home" ? 0 : event.key==="PageUp" ? node.scrollTop-node.clientHeight*.85 : event.key==="PageDown" ? node.scrollTop+node.clientHeight*.85 : null;
    if(target===null)return;event.preventDefault();node.scrollTop=target;onScroll();
  }
  function feedback(entry:SavedCard,unfinished=false) {
    return <div className="stage-feedback" role="group" aria-label="Suggestion feedback">{(["used","edited","ignored"] as const).map(value=><button type="button" key={value} aria-pressed={entry.status===value} aria-expanded={value==="edited" ? editing?.id===entry.id : undefined} disabled={(value==="edited" ? !onEdit : !onFeedback) || (unfinished&&value==="used")} title={value==="used" ? "Mark this suggestion as used" : value==="edited" ? "Edit this suggested reply" : "Mark this suggestion as ignored"} onClick={()=>{
      if(value==="edited"){if(editing?.id===entry.id)return;rememberAnchor();following.current=false;setEditing({id:entry.id,text:entry.guidance.say,rememberVoice:false,reason:null});}
      else {if(editing?.id===entry.id)setEditing(null);onFeedback?.(entry.id,value);}
    }}>{entry.status===value&&<Check size={12}/>} {value==="used" ? "Used" : value==="edited" ? "Edited" : "Ignored"}</button>)}</div>;
  }
  function reply(entry:SavedCard) {
    const zh=bilingual,value=entry.guidance,quote=entry.buyerQuote || value.questionEcho || "";
    const preparedOpening=!entry.triggerTurnId&&quote==='Opening';
    const actual=typeof entry.actualSpoken==="string" ? entry.actualSpoken.trim() : "";
    const superseded=entry.status==="superseded" || entry.superseded===true,unfinished=!value.say.trim(),failed=requestFailed(entry);
    const newest=!entry.coachingIssue&&entry.id===newestReplyId,streaming=entry.id===activeId && !!active && liveDraft;
    const actuallyUsed=entry.status==="used" || entry.status==="edited";
    const analysisReady=value.analysisReady!==false && !streaming;
    const editedWording=hasWordingEdit(entry),verificationStatus=editedWording?'edited':!value.verified&&['verified','not_required'].includes(value.verificationStatus||'')?'unknown':value.verificationStatus||'unknown';
    const evidence=Array.isArray(value.evidence) ? value.evidence : [];
    const label=entry.coachingIssue ? (entry.coachingIssue.status==='correction'?'Correction requires review':'Withheld draft · '+entry.coachingIssue.status) : failed ? "Suggestion unavailable" : unfinished ? "Superseded" : entry.status==="used" ? "Used" : entry.status==="edited" ? "Edited" : entry.status==="ignored" ? "Ignored" : superseded ? "Superseded" : newest ? "Latest suggestion" : "Previous suggestion";
    const details=analysisReady && !!(value.stage || value.moment || value.move || value.why || value.buyerIntent || evidence.length);
    return <article className={`reply-feed-entry ${newest ? "reply-feed-latest" : ""} ${unfinished ? "reply-feed-skipped" : ""}`} key={entry.id} data-reply-id={entry.id} data-status={entry.status} data-feedback-at={entry.feedbackAt} data-verification-status={entry.latencyBreakdown?.status} data-phase={value.phase || "answer"} data-superseded={superseded} data-testid={newest ? "latest-suggested-reply" : undefined} aria-label={failed ? "Suggestion unavailable" : newest ? "Latest suggested reply" : unfinished ? "Superseded buyer turn" : "Previous suggested reply"}>
      <div className="reply-feed-meta"><span className={`reply-feed-label ${actuallyUsed ? "reply-feed-used" : ""}`}>{actuallyUsed&&<Check size={12}/>} {label}{streaming&&<Loader2 size={12} className="spin"/>}</span>{entry.at>0&&<time dateTime={new Date(entry.at).toISOString()}>{replyTime(entry.at)}</time>}</div>
      {quote&&<p className="reply-feed-buyer"><span>{preparedOpening?(zh?'预备开场':'PREPARED'):(zh ? "请求时的对话" : "REQUEST CONTEXT")}</span> {preparedOpening?(zh?'通话开始前':'Before the call'):quote}</p>}
      {unfinished ? <p className="reply-feed-unfinished" role={failed?'status':undefined}>{failed ? (zh ? "未能生成可用建议。请再次请求下一步建议；详情保存在诊断中。" : "No usable suggestion was produced. Request another next move; the details are saved in Diagnostics.") : zh ? "这条未完成的建议已被替代。" : "This unfinished suggestion was superseded."}</p> : <>
        <p className="reply-feed-wording-label">{zh ? "建议话术" : "Suggested wording"}</p>
        <blockquote className="reply-feed-script" data-reply-origin={value.replyOrigin||'generated'}>{value.say}</blockquote><small className="reply-origin">{value.replyOrigin==='local'?'Supplied locally':'AI generated'}</small>{entry.coachingIssue&&<p role="status">Not ready to say. {entry.coachingIssue.reason}{entry.coachingIssue.correction&&<><br/><strong>Proposed correction:</strong> {entry.coachingIssue.correction}</>}</p>}
        <small className={`reply-verification-status verification-${verificationStatus}`} role="status">{editedWording?'Edited wording · not source-checked':verificationStatus==='verified'?'Facts checked against sources':verificationStatus==='not_required'?'No factual check needed':verificationStatus==='rejected'?'Source check rejected this claim':verificationStatus==='unavailable'?'Source check unavailable — not verified':verificationStatus==='pending'?'Source check pending':value.verified?'Previously marked verified':'Not verified'}</small>
      </>}
      {actual&&<p className="reply-feed-actual"><strong>{actuallyUsed ? (zh ? "你实际说出" : "YOU SAID") : (zh ? "销售实际说出" : "REPRESENTATIVE SAID")}</strong> {actual}</p>}
      {value.caution&&analysisReady&&<p className="reply-feed-caution">{value.caution}</p>}
      {!unfinished&&!entry.coachingIssue&&<div className="reply-feed-actions">{feedback(entry,streaming)}<button type="button" className="icon-button" aria-label={newest ? "Copy latest suggested reply" : `Copy suggested reply from ${replyTime(entry.at)}`} title={zh ? "复制话术" : "Copy reply"} onClick={()=>onCopy(value.say)}><Copy size={14}/></button></div>}
      {entry.feedbackAt&&validTime(entry.feedbackAt)&&<small className="reply-feed-feedback-time">{label} saved <time dateTime={new Date(entry.feedbackAt).toISOString()}>{replyTime(entry.feedbackAt)}</time></small>}
      <ReplyVerificationChanges entry={entry}/>
      {editing?.id===entry.id&&<form className="reply-feed-editor" ref={editor} aria-label="Edit suggested response" onSubmit={event=>{event.preventDefault();const text=editing.text.trim();if(!text||!onEdit)return;onEdit(entry.id,text,false,editing.reason||undefined);setEditing(null);}}>
        <label htmlFor={`reply-edit-${entry.id}`}>How would you say this?</label>
        <textarea id={`reply-edit-${entry.id}`} aria-label="Edited response" autoFocus maxLength={600} value={editing.text} onChange={event=>setEditing(previous=>previous?{...previous,text:event.target.value}:previous)}/>
        <div className="reply-edit-reasons" role="group" aria-label="Reason for editing (optional)">{EDIT_REASONS.map(reason=><button type="button" key={reason} aria-pressed={editing.reason===reason} onClick={()=>setEditing(previous=>previous?{...previous,reason}:previous)}>{reason}</button>)}</div>
        
        <div><button type="submit" className="button primary small" disabled={!editing.text.trim()}>Save edit</button><button type="button" className="text-button" onClick={()=>setEditing(null)}>Cancel</button></div>
        <small>Your edit is saved for review. To change future guidance, use Teach the copilot in call review; a manager reviews and applies the change.</small>
      </form>}
      {details&&<details className="reply-feed-details" onToggle={event=>{if(event.currentTarget.open){following.current=false;setAway(true);rememberAnchor();}}}><summary>{zh ? "查看思路与依据" : "Details · reasoning, guidance & sources"}{evidence.length>0&&<span><ShieldCheck size={11}/>{evidence.length}</span>}</summary><div className="reply-feed-detail-content"><SuggestionLearningAttribution value={value}/><div className="reply-feed-tags"><span>{value.stage || stageLabel(currentStage,zh)}</span>{value.moment&&<span>{value.moment}</span>}</div>{value.move&&<p>{readableCoachingMove(value.move,zh)}</p>}{zh&&value.buyerIntent&&<p>{value.buyerIntent}</p>}{value.why&&<p>{value.why}</p>}{evidence.map((source,index)=><p className="reply-feed-source" key={`${source.sourceId}-${index}`}><ShieldCheck size={12}/><span>{entry.sourceSnapshot.find(item=>item.id===source.sourceId)?.title || source.sourceId}: “{source.quote}”</span></p>)}</div></details>}
    </article>;
  }

  return <section className="guidance-card phase-guidance stage-stream-card" aria-label="Suggested response">
    <div className="guidance-header"><span><Sparkles size={17}/>{bilingual ? "按需指导" : "COACHING"}</span><span className="guidance-state" title={active&&latency>0?'Time from your request to the suggested wording.':undefined}>{active && latency>0 && !waitingForBuyer && !thinking && !checkingFacts ? `${(latency/1000).toFixed(1)}s ${bilingual?'请求后':'after request'}` : `${rows.filter(item=>!!item.guidance.say.trim()).length} ${bilingual ? "条建议" : "suggestions"}`}</span></div>
    <div className="reply-feed-wrap"><div className="reply-feed-scroll" ref={history} role="log" aria-label="Suggested reply history" aria-live="polite" aria-relevant="additions text" tabIndex={0} onScroll={onScroll} onKeyDown={onHistoryKeyDown}>
      {rows.map(reply)}
      {pending&&<div className="reply-feed-pending" role="status" aria-label={waitingForBuyer ? "Waiting for buyer turn" : thinking ? "Generating next move" : "Checking suggestion facts"}><span><Loader2 size={13} className="spin"/>{status}</span>{rows.length>0&&<p>{bilingual ? "你可以继续查看上面的建议。" : "Your previous suggestions remain above."}</p>}</div>}
      {!rows.length&&!pending&&<div className="reply-feed-empty"><h2>{bilingual ? "需要建议时，随时请求。" : "Guidance when you need it."}</h2><p>{bilingual ? "点击“Suggest next move”获取开场白或下一步建议。无需等待买方说话，也无需先开启收音。" : "Select Suggest next move for an opener or guidance. You can request it before anyone speaks or listening starts."}</p><p>{bilingual ? "每次建议都会保留在这里，最新一条会更醒目。" : "Each suggestion stays here so you can return to it during the call."}</p></div>}
    </div>{away&&!editing&&<button type="button" className="stage-back-latest" onClick={jumpToLatest}><ArrowDown size={14}/>{bilingual ? "回到最新" : "Back to latest"}{newReplies>0&&<span>{newReplies}</span>}</button>}</div>
    <CoachingDiagnostics entries={suggestions}/>
    <small className="reply-display-timing">Target: usable wording within 1.8s after buyer speech ends.</small>{liveTiming?.requestToFullDisplayMs!==undefined&&<small className="reply-display-timing">Request to fully visible wording: {(liveTiming.requestToFullDisplayMs/1000).toFixed(2)}s</small>}<div className="reply-feed-status" role="status">{pending&&<Loader2 size={12} className="spin"/>}{status}</div>
  </section>;
}
