"use client";
import {callOutcomeLabel} from '../lib/call-outcome-label';

import { useEffect, useState } from "react";
import { AlertTriangle, CheckSquare, Copy, FileText, Loader2, RefreshCw } from "lucide-react";
import type { CallRecord } from "../lib/trade";
import type { DecisionItem, DecisionPacket } from "../lib/phase1-types";
import { PACKET_CATEGORIES, PACKET_LABELS } from "../lib/decision-packet";
import "./decision-packet.css";

type Props={
  call:CallRecord&{captureWarnings?:string[]}; language:"en"|"zh"; onLanguageChange:(language:"en"|"zh")=>void;
  onGenerate:()=>void; loading:boolean; onPacketChange:(packet:DecisionPacket)=>void;
  onDecisionsChange?:(decisions:DecisionItem[])=>void; disabled?:boolean; decisionsReadOnly?:boolean;
};
function elapsed(at:number,startedAt:number){const seconds=Math.max(0,Math.floor((at-startedAt)/1000));return `${Math.floor(seconds/60).toString().padStart(2,"0")}:${(seconds%60).toString().padStart(2,"0")}`;}

export function ManagerPacketPanel({call,language,onLanguageChange,onGenerate,loading,onPacketChange,onDecisionsChange,disabled=false,decisionsReadOnly=false}:Props){
  const packet=call.packets?.[language],zh=language==="zh";
  const [copyState,setCopyState]=useState("");
  useEffect(()=>setCopyState(""),[call.id,language,packet?.generatedAt]);
  const labels=PACKET_LABELS[language];
  const captureWarnings=call.captureWarnings||[];
  const decisions=packet?.decisionsNeeded.map(decision=>({...decision,checked:call.decisionsNeeded?.find(item=>item.id===decision.id)?.checked??decision.checked}))||[];
  const toggleDecision=(id:string,checked:boolean)=>{
    if(!packet||decisionsReadOnly)return;
    const next=decisions.map(decision=>decision.id===id?{...decision,checked}:decision);
    // Keep check state for decisions which appear only in the other language's packet.
    const canonical=new Map((call.decisionsNeeded||[]).map(item=>[item.id,item]));
    next.forEach(item=>canonical.set(item.id,item));
    onPacketChange({...packet,decisionsNeeded:next});onDecisionsChange?.([...canonical.values()]);
  };
  const revealTurn=(event:React.MouseEvent<HTMLAnchorElement>,turnId:string)=>{
    const target=document.getElementById(`turn-${turnId}`);if(!target)return;
    event.preventDefault();let parent:HTMLElement|null=target.parentElement;
    while(parent){if(parent instanceof HTMLDetailsElement)parent.open=true;parent=parent.parentElement;}
    target.scrollIntoView({block:"center",behavior:"smooth"});
  };
  const copy=async()=>{try{await navigator.clipboard.writeText(packet?.followUp||"");setCopyState(zh?"已复制":"Copied");}catch{setCopyState(zh?"请手动选择并复制草稿。":"Select and copy the draft manually.");}};
  return <section className="manager-packet" aria-label="Manager Decision Packet">
    <div className="manager-packet-heading"><div><FileText size={17}/><h3>{zh?"经理决策包":"Manager Decision Packet"}</h3></div><div className="manager-packet-actions"><div className="packet-language" role="group" aria-label="Packet language"><button type="button" aria-pressed={!zh} onClick={()=>onLanguageChange("en")}>EN</button><button type="button" aria-pressed={zh} onClick={()=>onLanguageChange("zh")}>中文</button></div><button type="button" className="button secondary small" onClick={onGenerate} disabled={loading||disabled}>{loading?<Loader2 size={14} className="spin"/>:<RefreshCw size={14}/>} {loading?(zh?"整理中…":"Preparing…"):packet?(zh?"重新生成":"Regenerate"):(zh?"生成决策包":"Generate packet")}</button></div></div>
    {call.callContext&&<details className="packet-context"><summary>{zh?"通话背景与阶段目的":"Call Context & stage purpose"}</summary><p><strong>{zh?"关系":"Relationship"}:</strong> {call.callContext.relationship.replaceAll("_"," ")}</p><p><strong>{zh?"阶段":"Stage"}:</strong> {call.stageMapSnapshot?.find(stage=>stage.id===call.callContext?.stageId)?.name || call.callContext.stageId}</p><p><strong>{zh?"目的":"Goal"}:</strong> {call.callContext.goal}</p><p className="preserve">{call.callContext.background}</p><p className="preserve"><strong>{zh?"已知买方信息":"Known buyer facts"}:</strong> {call.callContext.knownFacts || "—"}</p><p className="preserve"><strong>{zh?"不得猜测":"Do not guess"}:</strong> {call.callContext.doNotGuess || "—"}</p><small>{zh?"背景由销售代表填写，并非买方原话。":"Background entered by the representative; it is not a buyer quotation."}</small></details>}
    {!!call.suggestions?.length&&<details className="packet-context"><summary>{zh?"建议与实际发言反馈":"Suggestion feedback & actual speech"}</summary>{call.suggestions.map(item=><div key={item.id}><strong>{item.status}</strong><p>{zh?"建议":"Suggested"}: {item.guidance.say}</p>{item.actualSpoken&&<p>{zh?"实际发言":"Actually said"}: {item.actualSpoken}</p>}<small>{zh?"通话结果":"Outcome"}: {callOutcomeLabel(item.callOutcome || call.outcome)}</small></div>)}</details>}
    <p className="packet-review-note">{zh?"供审核的草稿。买方证据和双方承诺仅来自已核对的通话原文，建议话术不代表实际说过。":"Draft for review. Buyer evidence and commitments come from checked transcript quotes; a suggested reply is not proof it was spoken."}</p>
    {!!captureWarnings.length&&<div className="packet-commitment risky" role="alert"><strong className="packet-risk-label"><AlertTriangle size={15}/>{zh?"通话记录不完整":"Incomplete call capture"}</strong><p>{zh?"部分发言可能未被记录。此决策包只能核实已捕获的原文，不能补全缺失的承诺。":"Some speech may not have been captured. This packet can establish only the saved transcript and cannot reconstruct missing commitments."}</p><ul>{captureWarnings.map((warning,index)=><li key={index}>{warning}</li>)}</ul></div>}
    {packet?<>
      <div className="packet-summary"><h4>{zh?"三行摘要":"Three-line summary"}</h4><ol>{packet.summary.map((line,index)=><li key={index}>{line}</li>)}</ol></div>
      <div className="packet-block"><h4>{zh?"买方证据":"Buyer evidence"}</h4><div className="packet-evidence-grid">{PACKET_CATEGORIES.map(category=>{
        const items=packet.evidence.filter(evidence=>evidence.category===category);
        return <div className="packet-evidence-category" key={category}><strong>{labels[category]}</strong>{items.length?items.map((item,index)=><blockquote key={`${item.turnId}-${index}`}><p>“{item.quote}”</p><a href={`#turn-${encodeURIComponent(item.turnId)}`} onClick={event=>revealTurn(event,item.turnId)}>{zh?"买方":"Buyer"} · {elapsed(item.at,call.startedAt)} · {zh?"原文":"Turn"} {item.turnId.slice(0,8)}</a></blockquote>):<p className="packet-not-captured">{zh?"未记录":"Not captured"}</p>}</div>;
      })}</div></div>
      <div className="packet-block"><h4>{zh?"双方实际承诺":"What each side actually committed to"}</h4>{packet.commitments.length?<div className="packet-commitments">{packet.commitments.map((item,index)=><article className={item.risky?"packet-commitment risky":"packet-commitment"} key={`${item.turnId}-${index}`}><div><strong>{item.speaker==="buyer"?(zh?"买方":"Buyer"):(zh?"我方":"You")}</strong><a href={`#turn-${encodeURIComponent(item.turnId)}`} onClick={event=>revealTurn(event,item.turnId)}>{elapsed(item.at,call.startedAt)} · {zh?"原文":"Turn"} {item.turnId.slice(0,8)}</a></div><p>“{item.quote}”</p>{item.risky&&<span className="packet-risk-label"><AlertTriangle size={14}/>{zh?"需审核的承诺":"Promise needs review"}</span>}{item.reason&&<small>{item.reason}</small>}</article>)}</div>:<p className="packet-not-captured">{zh?"未记录可核实的明确承诺。":"No verifiable explicit commitment was captured."}</p>}</div>
      <div className="packet-block"><h4><CheckSquare size={15}/>{zh?"需要经理决定":"Decisions needed from the manager"}</h4>{decisions.length?<div className="packet-decisions">{decisions.map(decision=><label key={decision.id}><input type="checkbox" checked={decision.checked} disabled={decisionsReadOnly} onChange={event=>toggleDecision(decision.id,event.target.checked)}/><span>{decision.text}</span></label>)}</div>:<p className="packet-not-captured">{zh?"没有从通话中确认待决事项。":"No decision request was established from this call."}</p>}<small className="packet-check-note">{zh?"勾选仅表示此事项已处理，不会自动授权报价、样品或商业条款。":"Checking a box marks an item handled; it does not authorize prices, samples or commercial terms."}</small></div>
      {!!packet.notCaptured.length&&<details className="packet-gaps"><summary>{zh?"未记录或无法核实的信息":"Not captured or not established"} ({packet.notCaptured.length})</summary><ul>{packet.notCaptured.map((item,index)=><li key={index}>{item}</li>)}</ul></details>}
      <div className="packet-block"><div className="packet-email-heading"><h4>{zh?"英文跟进邮件草稿":"Follow-up email draft"}</h4><button type="button" className="text-button" disabled={!packet.followUp} onClick={()=>void copy()}><Copy size={13}/>{zh?"复制":"Copy"}</button></div><textarea aria-label="Edit manager packet follow-up email draft" value={packet.followUp} maxLength={12_000} onChange={event=>{setCopyState("");onPacketChange({...packet,followUp:event.target.value});}}/><small className="packet-check-note">{copyState|| (zh?"面向美国买方的可编辑英文草稿。请审核后自行发送，Trade Assist 不会发送邮件。":"Editable English draft for the US buyer. Review before sending; Trade Assist does not send email.")}</small></div>
    </>:<div className="packet-empty"><p>{zh?"根据这次通话整理摘要、原话证据、承诺和待决事项。缺少的信息将明确显示为未记录。":"Prepare the call summary, quoted buyer evidence, actual commitments and decisions needed. Missing details will be marked not captured."}</p><small>{zh?"生成时计入现有 AI 费用与支出限制。":"Generation uses the existing AI spending meter and limits."}</small></div>}
    {!!call.missingKnowledge?.length&&<details className="packet-missing"><summary>{zh?"缺失的公司知识":"Missing company knowledge"} ({call.missingKnowledge.filter(item=>item.status==="open").length} {zh?"项待确认":"open"})</summary><ul>{call.missingKnowledge.map(item=><li key={item.id}><span className={item.status==="confirmed"?"packet-resolved":""}>{item.fact}</span><small>{item.status==="confirmed"?(zh?"已确认":"Confirmed"):(zh?"待工厂或经理确认":"Confirm with factory or manager")}</small></li>)}</ul></details>}
  </section>;
}
