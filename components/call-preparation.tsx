import {useId} from 'react';
import {Copy,MessageSquare,ExternalLink,Loader2} from 'lucide-react';
import {MAX_OPENING_LENGTH,normalizeOpening,type OpeningChoice} from '../lib/opening-preferences';
import './call-preparation.css';

export type CallPreparationEvidence={label:string;quote:string;url?:string};
export type CallPreparationProps={
  opening:string;
  choice:OpeningChoice;
  savedOpening?:string;
  companyName?:string;
  evidence?:CallPreparationEvidence[];
  onChoose:(mode:OpeningChoice['mode'])=>void;
  onDraftChange:(text:string)=>void;
  onCopy:(text:string)=>void;
  onUse?:(text:string)=>void;
  onSaveDefault?:(text:string)=>void;
  onResetDefault?:()=>void;
  busy?:boolean;
  onDemand?:boolean;
};

function sourceLink(value:string|undefined) {
  if(!value)return undefined;
  try{const url=new URL(value);return /^https?:$/.test(url.protocol)?url.toString():undefined;}catch{return undefined;}
}

/** One selected opening. Preparing, saving or copying never records speech. */
export function CallPreparation({opening,choice,savedOpening='',companyName,evidence=[],onChoose,onDraftChange,onCopy,onUse,onSaveDefault,onResetDefault,busy=false,onDemand=false}:CallPreparationProps) {
  const custom=choice.mode==='custom',first=normalizeOpening(onDemand?(custom?choice.text:''):opening),id=useId(),saved=normalizeOpening(savedOpening);
  return <details className="card call-preparation" aria-label="Prepared opening">
    <summary><span><MessageSquare size={15}/><strong>{onDemand?'Opening preference':'Opening and first question'}</strong></span><span className="call-preparation-state">{onDemand?(custom?(saved&&first===saved?'Company default':first?'Custom wording':'Optional draft'):'Copilot chooses on request'):busy?<><Loader2 size={12} className="spin"/>Preparing…</>:saved&&first===saved?'Company default':first?'Ready before you dial':'Prepare your approach'}</span></summary>
    <div className="call-preparation-content">
      <p className="call-preparation-help">{onDemand?'Use Suggest next move when you want an opening. You can optionally provide your preferred wording here.':'Choose one opening, then give the person room to answer.'}</p>
      <div className="call-preparation-choices" role="group" aria-label="Choose opening wording">
        <button type="button" aria-pressed={!custom} disabled={busy} onClick={()=>onChoose('suggested')}>{onDemand?'Let copilot choose wording':'Use suggested opening'}</button>
        <button type="button" aria-pressed={custom} disabled={busy} onClick={()=>onChoose('custom')}>Write my own</button>
      </div>
      {custom?<div className="call-preparation-draft"><label htmlFor={id}>{onDemand?'Your preferred opening':'Your opening'}</label><textarea id={id} aria-label="Your opening" rows={4} maxLength={MAX_OPENING_LENGTH} value={choice.text} disabled={busy} onChange={event=>onDraftChange(event.target.value)} placeholder={onDemand?'Optional wording to guide an opening for this call.':'Introduce yourself, explain why you’re calling, and ask one easy question.'}/><small>{choice.text.length} / {MAX_OPENING_LENGTH} characters</small></div>:onDemand?<p className="call-preparation-empty">The copilot will use your selected stage, objective and available context when you request guidance.</p>:first?<div className="call-preparation-line"><div><span>Suggested opening</span></div><blockquote>{first}</blockquote></div>:<p className="call-preparation-empty">Add your company information and buyer context to prepare a relevant opening.</p>}
      <div className="call-preparation-actions">
        {!onDemand&&onUse&&<button type="button" className="button primary" disabled={busy||!first} onClick={()=>onUse(first)}>Show opening in Your Exact Reply</button>}
        {!onDemand&&<button type="button" className="button secondary" aria-label="Copy prepared opening" disabled={busy||!first} onClick={()=>onCopy(first)}><Copy size={13}/>Copy</button>}
        {onSaveDefault&&(!onDemand||custom)&&<button type="button" className="text-button" disabled={busy||!first||first===saved} onClick={()=>onSaveDefault(first)}>Save as company default</button>}
        {saved&&onResetDefault&&<button type="button" className="text-button" disabled={busy} onClick={onResetDefault}>Remove company default</button>}
      </div>
      <p className="call-preparation-help">{companyName?`A saved default belongs to ${companyName} and is reused for its future calls.`:'Select a company to save a default.'} Remove buyer-specific details before saving a reusable default.</p>
      {custom&&<p className="call-preparation-help">Your wording is kept as written. Saving it does not verify company facts or promises.</p>}
      {!onDemand&&!custom&&evidence.length>0&&<details className="call-preparation-sources"><summary>What this opening is based on · {evidence.length} {evidence.length===1?'source':'sources'}</summary><ul>{evidence.map((item,index)=>{const href=sourceLink(item.url);return <li key={index}><strong>{item.label}</strong><q>{item.quote}</q>{href&&<a href={href} target="_blank" rel="noreferrer">View source <ExternalLink size={11}/></a>}</li>;})}</ul></details>}
      <small className="call-preparation-footnote">{onDemand?'Saving a preference does not generate coaching or mark it as spoken.':'Prepared wording is not marked as spoken or agreed.'}</small>
    </div>
  </details>;
}
