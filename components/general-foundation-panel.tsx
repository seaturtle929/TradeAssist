import {useId,useState,type FormEvent} from 'react';
import type {GeneralPlaybookRecord} from '../lib/general-playbook';
import {approveFoundationMove,foundationStats,foundationProposalNeedsTriggerReview,normalizeGeneralFoundation,proposeFoundationMove,type FoundationProposal} from '../lib/general-foundation';
import './general-foundation-panel.css';

type Props={playbook:GeneralPlaybookRecord;disabled?:boolean;onChange:(next:GeneralPlaybookRecord)=>void|Promise<void>};
type Draft={name:string;when:string;do:string;doNot:string;template:string};
const blank=():Draft=>({name:'',when:'',do:'',doNot:'',template:''});
const dateLabel=(at:number)=>at>0?new Date(at).toLocaleString():'Core move · ready from day one';

/** Shared strategy only. Company examples and written Why remain in their Brain. */
export function GeneralFoundationPanel({playbook,disabled=false,onChange}:Props){
 const id=useId(),stats=foundationStats(playbook),foundation=normalizeGeneralFoundation(playbook.foundation);
 const [draft,setDraft]=useState<Draft>(blank),[editingId,setEditingId]=useState(''),[open,setOpen]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[status,setStatus]=useState('');
 const lines=(value:string)=>value.split('\n').map(item=>item.trim()).filter(Boolean);
 function edit(proposal:FoundationProposal){setDraft({name:proposal.name,when:proposal.when,do:proposal.do.join('\n'),doNot:proposal.doNot.join('\n'),template:proposal.template});setEditingId(proposal.id);setOpen(true);setError('');setStatus('');}
 async function submit(event:FormEvent<HTMLFormElement>){
  event.preventDefault();if(busy||disabled)return;setBusy(true);setError('');setStatus('');
  try{
   const momentType='custom_'+draft.name.toLowerCase().replace(/[^a-z]+/g,'_').replace(/^_|_$/g,'').slice(0,55);
   const base=editingId?{...playbook,foundation:{...foundation,proposals:foundation.proposals.filter(item=>item.id!==editingId)}}:playbook;
   const previous=foundation.proposals.find(item=>item.id===editingId);
   const next=proposeFoundationMove(base,{name:draft.name,when:draft.when,momentType,do:lines(draft.do),doNot:lines(draft.doNot),template:draft.template,...previous?.origin?{origin:previous.origin}:{},...previous?.learningSignature?{learningSignature:previous.learningSignature}:{} });
   await onChange(next);setDraft(blank());setEditingId('');setOpen(false);setStatus('Move proposed. Review and approve it before it can guide calls.');
  }catch(cause){setError(cause instanceof Error?cause.message:'Could not save the proposed move.');}finally{setBusy(false);}
 }
 async function approve(proposal:FoundationProposal){if(busy||disabled)return;setBusy(true);setError('');setStatus('');try{await onChange(approveFoundationMove(playbook,proposal.id));setStatus('Approved. This general move is now available across companies.');}catch(cause){setError(cause instanceof Error?cause.message:'Could not approve this move.');}finally{setBusy(false);}}
 return <section className="foundation-panel" aria-label="General Playbook foundation">
  <header><div><span className="eyebrow">GENERAL PLAYBOOK FOUNDATION</span><h2>Sales moves for every company</h2></div><button type="button" className="button secondary small" disabled={disabled||busy} onClick={()=>{setOpen(value=>!value);setError('');}}>Propose a new move</button></header>
  <p>Every suggestion starts with a move for the current situation. The copilot then uses the active company’s facts and this call’s context.</p>
  <dl className="foundation-stats"><div><dt>Moves</dt><dd>{stats.moveCount}</dd></div><div><dt>Approved examples</dt><dd>{stats.exampleCount}</dd></div><div><dt>Awaiting approval</dt><dd>{stats.pendingMoveCount}</dd></div><div><dt>Last updated</dt><dd>{dateLabel(stats.updatedAt)}</dd></div></dl>
  <p>Company names, product facts, buyer details and your full written explanations stay in their Company Brain. Shared examples contain placeholders and general actions.</p>
  {open&&<form className="foundation-proposal-form" onSubmit={event=>void submit(event)} aria-label="Propose General Playbook move">
   <h3>{editingId?'Edit proposed move':'Propose a new move'}</h3>
   <label htmlFor={`${id}-name`}>Move name<input id={`${id}-name`} required maxLength={90} value={draft.name} disabled={busy} onChange={event=>setDraft({...draft,name:event.target.value})}/></label>
   <label htmlFor={`${id}-when`}>When should it apply?<textarea id={`${id}-when`} required rows={2} maxLength={650} value={draft.when} disabled={busy} onChange={event=>setDraft({...draft,when:event.target.value})}/></label>
   <label htmlFor={`${id}-do`}>What should the copilot do? One action per line.<textarea id={`${id}-do`} required rows={3} maxLength={1800} value={draft.do} disabled={busy} onChange={event=>setDraft({...draft,do:event.target.value})}/></label>
   <label htmlFor={`${id}-avoid`}>What should it avoid? One action per line.<textarea id={`${id}-avoid`} rows={3} maxLength={1800} value={draft.doNot} disabled={busy} onChange={event=>setDraft({...draft,doNot:event.target.value})}/></label>
   <label htmlFor={`${id}-template`}>Reusable wording<textarea id={`${id}-template`} required rows={3} maxLength={900} value={draft.template} disabled={busy} onChange={event=>setDraft({...draft,template:event.target.value})}/></label>
   <small>Use placeholders such as {'{company_name}'}, {'{product_category}'}, {'{selected_item}'}, {'{item_documents}'}, {'{email_action}'} and {'{agreed_materials}'}. Keep company facts, names, numbers and promises out of shared wording.</small>
   <div className="foundation-actions"><button type="submit" className="button primary small" disabled={busy||disabled}>{busy?'Saving…':'Save proposal for review'}</button><button type="button" className="text-button" disabled={busy} onClick={()=>{setOpen(false);setEditingId('');setDraft(blank());setError('');}}>Cancel</button></div>
  </form>}
  {foundation.proposals.filter(item=>item.status==='pending').map(proposal=><article className="foundation-proposal" key={proposal.id}><h3>{proposal.name} · awaiting approval</h3>{foundationProposalNeedsTriggerReview(proposal)&&<p>This draft comes from a reviewed moment that does not fit an existing move. Edit the general trigger and wording before approving it. Your original explanation remains in its Company Brain.</p>}<p><strong>When:</strong> {proposal.when}</p><p><strong>Do:</strong> {proposal.do.join(' ')}</p><p><strong>Avoid:</strong> {proposal.doNot.join(' ')||'Company facts and promises always require current-company support.'}</p><pre>{proposal.template}</pre><div className="foundation-actions"><button type="button" className="button secondary small" disabled={disabled||busy} onClick={()=>edit(proposal)}>Edit proposal</button><button type="button" className="button primary small" disabled={disabled||busy||foundationProposalNeedsTriggerReview(proposal)} onClick={()=>void approve(proposal)}>Approve general move</button></div></article>)}
  {error&&<p className="foundation-error" role="alert">{error}</p>}{status&&<p className="foundation-status" role="status">{status}</p>}
  <div className="foundation-moves">{foundation.moves.map(move=><details key={move.id} className="foundation-move"><summary><span>{move.name}</span><small>{move.exampleCount} approved {move.exampleCount===1?'example':'examples'}</small></summary><p><strong>When:</strong> {move.when}</p><div className="foundation-directions"><div><h4>Do</h4><ul>{move.do.map(item=><li key={item}>{item}</li>)}</ul></div><div><h4>Avoid</h4><ul>{move.doNot.map(item=><li key={item}>{item}</li>)}</ul></div></div><pre>{move.template}</pre><small>{dateLabel(move.updatedAt)}</small>{foundation.examples.filter(example=>example.momentType===move.momentType).map(example=><details className="foundation-example" key={example.id}><summary>Approved pattern · {dateLabel(example.updatedAt)}</summary><pre>{example.template}</pre><p>{example.requiredMoves.join(' ')}</p><p>{example.forbiddenMoves.join(' ')}</p></details>)}</details>)}</div>
 </section>;
}
