"use client";

import { useEffect, useId, useRef, useState } from "react";
import { BookOpen, Check, CircleHelp, ExternalLink, Loader2, Search, Settings2, ShieldCheck, Sparkles, Wallet, X } from "lucide-react";
import { formatUsd, monthSpend, PRICE_CHECKED_AT, PRICE_SOURCES, type BudgetSettings, type UsageEntry } from "../lib/costs";
import { SALES_PLAYBOOK_SOURCES, VOICE_TONE_GUIDES, type VoiceProfile } from "../lib/sales-playbook";
import type { BuyerBrief } from "../lib/trade";
import "./sales-panels.css";

type VoiceSettingsProps = { voice:VoiceProfile; onChange:(voice:VoiceProfile)=>void; disabled?:boolean };
const lines = (value: string, maximum: number, length: number) => value.split("\n").slice(0,maximum).map(line => line.slice(0,length));

export function VoiceSettings({voice,onChange,disabled=false}: VoiceSettingsProps) {
  const id = useId();
  return <section className="feature-panel card feature-voice" aria-labelledby={`${id}-title`}>
    <div className="feature-heading"><div><Settings2 size={18}/><h2 id={`${id}-title`}>Your speaking style</h2></div><span className="feature-badge"><Check size={12}/> Saved as you edit</span></div>
    <p className="feature-intro">Keep the reply in your voice: direct answers, natural pauses, and questions only when they help.</p>
    <label className="feature-field" htmlFor={`${id}-tone`}><span>Tone</span><select id={`${id}-tone`} value={voice.tone} onChange={e=>onChange({...voice,tone:e.target.value as VoiceProfile["tone"]})} disabled={disabled}><option value="calm">Calm and experienced</option><option value="warm">Warm and relaxed</option><option value="direct">Clear and direct</option></select><small>{VOICE_TONE_GUIDES[voice.tone]}</small></label>
    <label className="feature-field" htmlFor={`${id}-notes`}><span>How you want to sound</span><textarea id={`${id}-notes`} value={voice.notes} maxLength={1200} rows={3} disabled={disabled} onChange={e=>onChange({...voice,notes:e.target.value})} placeholder="For example: short sentences, everyday English, no exaggerated enthusiasm."/><small>Style preferences only. Company claims still need support in your knowledge.</small></label>
    <div className="feature-field-grid">
      <label className="feature-field" htmlFor={`${id}-examples`}><span>Examples that sound like you</span><textarea id={`${id}-examples`} value={voice.examples.join("\n")} maxLength={3605} rows={4} disabled={disabled} onChange={e=>onChange({...voice,examples:lines(e.target.value,6,600)})} placeholder={"What quantity did you have in mind?\nLet me check that with our factory."}/><small>One example per line · up to 6 examples. These teach wording, not product facts.</small></label>
      <label className="feature-field" htmlFor={`${id}-avoid`}><span>Phrases to avoid</span><textarea id={`${id}-avoid`} value={voice.avoid.join("\n")} maxLength={2019} rows={4} disabled={disabled} onChange={e=>onChange({...voice,avoid:lines(e.target.value,20,100)})} placeholder={"Absolutely!\nGreat question\nI completely understand"}/><small>One phrase per line · up to 20 phrases.</small></label>
    </div>
    {disabled && <p className="feature-note"><CircleHelp size={15}/> Stop the live assistant before changing its speaking style.</p>}
    <details className="feature-details"><summary><BookOpen size={15}/> How the sales playbook works</summary><p>Answer the specific question. Follow the buyer’s own words. Ask useful follow-ups without turning every answer into a question. Be accurate about capabilities, give the buyer room to decline, and stop selling once a next step is agreed.</p><p>Communication research informs these habits; it does not guarantee trust or sales.</p><ul>{SALES_PLAYBOOK_SOURCES.map(source=><li key={source.url}><a href={source.url} target="_blank" rel="noreferrer">{source.title} ({source.year}) <ExternalLink size={12}/></a><p>{source.note}</p></li>)}</ul></details>
  </section>;
}

type BuyerResearchPanelProps = {
  buyer:string; brief:BuyerBrief|null; onBrief:(brief:BuyerBrief|null)=>void; products:string; disabled:boolean;
  request:<T>(path:string,body?:unknown)=>Promise<T>;
};
export function BuyerResearchPanel({buyer,brief,onBrief,products,disabled,request}: BuyerResearchPanelProps) {
  const id=useId(), generation=useRef(0), busyRef=useRef(false);
  const [website,setWebsite]=useState(brief?.website || ""), [busy,setBusy]=useState(false), [error,setError]=useState("");
  useEffect(()=>{generation.current++;busyRef.current=false;setBusy(false);setError("");setWebsite(brief?.company.trim().toLowerCase()===buyer.trim().toLowerCase() ? brief.website : "");},[buyer,brief?.website]);
  useEffect(()=>()=>{generation.current++;},[]);
  async function research() {
    if (busyRef.current || disabled || !buyer.trim() || !website.trim()) return;
    const current=++generation.current;busyRef.current=true;setBusy(true);setError("");
    try {
      const result=await request<{brief:BuyerBrief}>("/api/research",{company:buyer.trim(),website:website.trim(),products});
      if (generation.current===current) onBrief(result.brief);
    } catch(e) { if(generation.current===current)setError(e instanceof Error ? e.message : "The buyer research could not be completed."); }
    finally { if(generation.current===current){busyRef.current=false;setBusy(false);} }
  }
  const matches=!!brief && brief.company.trim().toLowerCase()===buyer.trim().toLowerCase();
  return <section className="feature-panel card feature-research" aria-labelledby={`${id}-title`}>
    <div className="feature-heading"><div><Search size={18}/><h2 id={`${id}-title`}>Know your buyer</h2></div>{brief && <button type="button" className="icon-button" aria-label="Clear buyer research" disabled={disabled || busy} onClick={()=>{onBrief(null);setError("");}}><X size={16}/></button>}</div>
    <p className="feature-intro">Research public company information before calling. Possible pain points become questions to explore, never assumptions about this buyer.</p>
    <div className="feature-research-controls"><label className="feature-field" htmlFor={`${id}-website`}><span>Buyer’s company website</span><input id={`${id}-website`} value={website} maxLength={2000} disabled={disabled || busy} onChange={e=>setWebsite(e.target.value)} placeholder="company.com" inputMode="url" autoComplete="url"/></label><button type="button" className="button primary" onClick={()=>void research()} disabled={disabled || busy || !buyer.trim() || !website.trim()}>{busy ? <Loader2 size={15} className="spin"/> : <Search size={15}/>} {busy ? "Researching…" : brief ? "Refresh research" : "Research buyer"}</button></div>
    <p className="feature-note">{buyer.trim() ? <>Researching <strong>{buyer.trim()}</strong>. Use the company name in “Who are you calling?”</> : "Enter the buyer’s company name in “Who are you calling?” first."}</p>
    {busy && <p className="feature-note" role="status"><Loader2 size={14} className="spin"/> Reading public sources and preparing a cited brief. This can take a minute.</p>}
    {error && <div className="feature-error" role="alert"><CircleHelp size={16}/><span>{error}{brief ? " Your previous brief is still shown below; it has not been refreshed." : ""}</span></div>}
    {brief && <div className="feature-brief">
      {!matches && <p className="feature-warning">This saved brief is for {brief.company}. Research the current company before using it on this call.</p>}
      <div className="feature-brief-title"><h3>{brief.company}</h3><a href={brief.website} target="_blank" rel="noreferrer">Company website <ExternalLink size={12}/></a></div>
      <p className="feature-summary">{brief.summary}</p>
      <h4><ShieldCheck size={15}/> Public facts</h4><ul className="feature-facts">{brief.facts.map((fact,index)=><li key={`${fact.sourceUrl}-${index}`}><p>{fact.text}</p><a href={fact.sourceUrl} target="_blank" rel="noreferrer">Source <ExternalLink size={12}/></a></li>)}</ul>
      {brief.hypotheses.length>0 && <><h4><Sparkles size={15}/> Possible pain points</h4><p className="feature-note">Hypotheses to test. The buyer has not confirmed these.</p><div className="feature-hypotheses">{brief.hypotheses.map((hypothesis,index)=><article key={index}><span className="feature-badge feature-hypothesis-badge">Possible need</span><h5>{hypothesis.painPoint}</h5><p>{hypothesis.reason}</p><div className="feature-question"><span>Ask to find out</span><p>“{hypothesis.question}”</p></div></article>)}</div></>}
      <details className="feature-details"><summary>Sources and research date</summary><p>{new Date(brief.researchedAt).toLocaleString()}</p><ul>{brief.sources.map(source=><li key={source.url}><a href={source.url} target="_blank" rel="noreferrer">{source.title} <ExternalLink size={12}/></a></li>)}</ul></details>
    </div>}
  </section>;
}

type SpendingPanelProps = {settings:BudgetSettings;onChange:(settings:BudgetSettings)=>void;callUsd:number;entries:UsageEntry[];disabled?:boolean};
const chargeLabels: Record<UsageEntry["kind"],string>={live:"Live replies",transcription:"Transcription",coach:"Verified guidance",research:"Buyer research",document:"Document reading"};
export function SpendingPanel({settings,onChange,callUsd,entries,disabled=false}: SpendingPanelProps) {
  const id=useId(), month=monthSpend(entries);
  const recent=[...entries].sort((a,b)=>b.at-a.at).slice(0,8);
  const updateLimit=(field:"perCallUsd"|"monthlyUsd",value:string)=>{const amount=Number(value);onChange({...settings,[field]:Number.isFinite(amount) ? Math.min(10000,Math.max(0,amount)) : 0});};
  return <section className="feature-panel card feature-spending" aria-labelledby={`${id}-title`}>
    <div className="feature-heading"><div><Wallet size={18}/><h2 id={`${id}-title`}>Spending & limits</h2></div><span className="feature-badge">USD estimates</span></div>
    <div className="feature-spend-totals"><div><span>This call</span><strong>{formatUsd(callUsd)}</strong><small>Including its AI actions</small></div><div><span>This month</span><strong>{formatUsd(month)}</strong><small>Tracked in this browser</small></div></div>
    <label className="feature-checkbox"><input type="checkbox" checked={settings.enabled} disabled={disabled} onChange={e=>onChange({...settings,enabled:e.target.checked})}/><span>Stop AI requests at my estimated limits</span></label>
    <div className="feature-field-grid"><label className="feature-field" htmlFor={`${id}-call-limit`}><span>Per-call limit (USD)</span><input id={`${id}-call-limit`} type="number" min="0" max="10000" step="0.5" value={settings.perCallUsd} disabled={disabled} onChange={e=>updateLimit("perCallUsd",e.target.value)}/></label><label className="feature-field" htmlFor={`${id}-month-limit`}><span>Monthly limit (USD)</span><input id={`${id}-month-limit`} type="number" min="0" max="10000" step="5" value={settings.monthlyUsd} disabled={disabled} onChange={e=>updateLimit("monthlyUsd",e.target.value)}/></label></div>
    <p className="feature-note"><CircleHelp size={15}/> The guard uses reported usage and published prices. Requests already in progress can finish and add cost. This is a local estimate guard, not a cap on your OpenAI account bill.</p>
    {!settings.enabled && <p className="feature-warning">The spending guard is off. AI requests can continue without these limits.</p>}
    {entries.some(entry=>entry.known===false) && <p className="feature-warning">Some usage used a fallback or incomplete rate estimate. Check OpenAI Platform for the final charge.</p>}
    <details className="feature-details"><summary>Recent AI usage {recent.length ? `(${recent.length})` : ""}</summary>{recent.length ? <ul className="feature-charges">{recent.map(entry=><li key={entry.id}><div><strong>{chargeLabels[entry.kind]}</strong><small>{new Date(entry.at).toLocaleString()} · {entry.model}</small></div><span>{formatUsd(entry.usd)}</span></li>)}</ul> : <p>No usage has been recorded in this browser yet. Activity before tracking was added is not included.</p>}</details>
    <details className="feature-details"><summary>Pricing and estimate details</summary><p>Published prices checked {PRICE_CHECKED_AT}. Rates can change. This view covers usage recorded by this app in this browser; other apps, other browsers, taxes, phone service and unreported usage are not included.</p><ul>{PRICE_SOURCES.map(source=><li key={source.url}><a href={source.url} target="_blank" rel="noreferrer">{source.title} <ExternalLink size={12}/></a></li>)}</ul></details>
  </section>;
}
