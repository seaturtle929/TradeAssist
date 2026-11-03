import {useState} from 'react';
import type {LearningAudit,LearningAuditEntry} from '../lib/learning-loop';
import './learning-audit.css';

type Props={audit:LearningAudit;disabled?:boolean;onSaveWhy:(entry:LearningAuditEntry,why:string)=>Promise<void>|void;approvedMoves?:{id:string;name:string}[];onAssignMove?:(entry:LearningAuditEntry,id:string)=>Promise<void>|void};
export function LearningAuditPanel({audit,disabled=false,onSaveWhy,approvedMoves=[],onAssignMove}:Props){
 const [assignments,setAssignments]=useState<Record<string,string>>({});
 const [onlyPending,setOnlyPending]=useState(false),[drafts,setDrafts]=useState<Record<string,string>>({}),[busy,setBusy]=useState(''),[error,setError]=useState('');
 const entries=audit.entries.filter(entry=>!onlyPending||entry.missingWhy||entry.structuredLesson.reviewStatus!=='active');
 async function save(entry:LearningAuditEntry){const why=drafts[entry.id]??entry.learningExplanation;if(!why.trim())return;setBusy(entry.id);setError('');try{await onSaveWhy(entry,why);}catch(cause){setError(cause instanceof Error?cause.message:'The explanation could not be saved.');}finally{setBusy('');}}
 return <section className="learning-audit" aria-label="All Edited moments learning audit">
  <h2>Learning from your edits</h2><p><strong>{audit.total} moments</strong> across all company Brains and saved Coaching history · {audit.missingWhyCount} need your Why · {audit.entries.filter(entry=>entry.structuredLesson.reviewStatus==='active').length} active lessons.</p>
  <p>Your handwritten Why stays part of learning. Imported moments without Why stay here for review. Company examples stay isolated; the shared foundation receives only general moves and placeholders.</p>
  <table><thead><tr><th>Moment type</th><th>Edits</th><th>Needs Why</th></tr></thead><tbody>{audit.byMomentType.map(row=><tr key={row.momentType}><td>{row.momentType.replaceAll('_',' ')}</td><td>{row.count}</td><td>{row.needsWhy}</td></tr>)}</tbody></table>
  <label className="learning-pending-filter"><input type="checkbox" checked={onlyPending} onChange={event=>setOnlyPending(event.target.checked)}/> Show moments needing review</label>
  {error&&<p role="alert">{error}</p>}
  {entries.map(entry=><details key={entry.id} className="learning-audit-entry"><summary>{entry.companyName} · {entry.momentType.replaceAll('_',' ')} · {entry.missingWhy?'Needs your Why':entry.structuredLesson.reviewStatus==='active'?'Active lesson':'Needs review'}</summary>
   <small>{entry.callId} · {entry.suggestionId} · {new Date(entry.timestamp).toLocaleString()}</small>
   <p><strong>Buyer:</strong> {entry.buyerLine||'Original buyer context is unavailable; this edit has been kept for review.'}</p><p><strong>Rejected suggestion:</strong> {entry.suggested||'Original suggestion unavailable'}</p><p><strong>Your line:</strong> {entry.actual||'Edited line unavailable'}</p>
   <label>Why should the copilot learn from this moment?<textarea rows={4} maxLength={2000} value={drafts[entry.id]??entry.learningExplanation} placeholder="Explain the move you want and what the copilot should avoid…" onChange={event=>setDrafts(previous=>({...previous,[entry.id]:event.target.value}))} disabled={disabled||busy===entry.id}/></label>
   <button type="button" className="button primary small" onClick={()=>void save(entry)} disabled={disabled||!!busy||!(drafts[entry.id]??entry.learningExplanation).trim()}>{busy===entry.id?'Saving…':'Save Why + learn'}</button>
   <p><strong>Structured move:</strong> {entry.structuredLesson.tags.join(' · ')||'Waiting for your explanation'}</p><p><strong>Pattern:</strong> {entry.structuredLesson.pattern}</p>
   <ul>{entry.structuredLesson.requiredMoves.map(move=><li key={move}>{move}</li>)}</ul>
   {!!entry.structuredLesson.forbiddenMoves.length&&<p><strong>Avoid:</strong> {entry.structuredLesson.forbiddenMoves.join(' ')}</p>}
   {entry.structuredLesson.reviewStatus==='needs_move_approval'&&<div><p>This situation needs a new approved move. <a href="#general-foundation">Propose a move in the General Playbook</a>, then assign the approved move here.</p><label>Approved new move<select value={assignments[entry.id]||''} onChange={event=>setAssignments(previous=>({...previous,[entry.id]:event.target.value}))}><option value="">Choose an approved move</option>{approvedMoves.map(move=><option key={move.id} value={move.id}>{move.name}</option>)}</select></label><button type="button" className="button secondary small" disabled={disabled||!assignments[entry.id]||!onAssignMove} onClick={()=>{void Promise.resolve(onAssignMove?.(entry,assignments[entry.id])).catch(cause=>setError(cause instanceof Error?cause.message:'The move could not be assigned.'));}}>Use this approved move for this lesson</button></div>}
   {!!entry.previousContext.length&&entry.previousContext.every(turn=>turn.role!=='you')&&<p>This saved window contains only buyer lines. Role confirmation and representative commitments need actual transcript evidence or explicit Call Context; edited suggestions are not treated as spoken.</p>}
   {entry.missingContext&&<p>Missing original transcript links are recorded; this edit was retained.</p>}
  </details>)}
 </section>;
}
