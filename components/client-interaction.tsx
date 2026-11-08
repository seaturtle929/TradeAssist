import {useId,useState} from 'react';
import {Mail,Phone,Users} from 'lucide-react';
import './client-interaction.css';

import type {InteractionType} from '../lib/trade';
export type {InteractionType} from '../lib/trade';
export const interactionLabels:Record<InteractionType,string>={in_person:'In person',call_meeting:'Call or meeting',text_email:'Text or email'};
const interactionOptions=[
 {id:'in_person' as const,label:'In person',description:'Listen together and ask for help when you need it.',Icon:Users},
 {id:'call_meeting' as const,label:'Call or meeting',description:'Use microphone or shared computer audio.',Icon:Phone},
 {id:'text_email' as const,label:'Text or email',description:'Paste an exchange and prepare your next reply.',Icon:Mail},
];
type Project={id:string;name:string;status?:'active'|'closed'};
export type InteractionSetupProps={type:InteractionType;onTypeChange:(type:InteractionType)=>void;projectId?:string;onProjectChange:(id:string|undefined)=>void;projects?:Project[];onCreateProject?:(name:string)=>void|Promise<void>;disabled?:boolean;locked?:boolean};

/** The interaction uses the existing client, coaching and reviewed-memory flow. */
export function InteractionSetup({type,onTypeChange,projectId,onProjectChange,projects=[],onCreateProject,disabled=false,locked=false}:InteractionSetupProps){
 const id=useId(),[adding,setAdding]=useState(false),[name,setName]=useState(''),[saving,setSaving]=useState(false),[error,setError]=useState('');
 async function create(){
  if(!name.trim()||!onCreateProject||saving)return;
  setSaving(true);setError('');
  try{await onCreateProject(name.trim());setName('');setAdding(false);}catch(cause){setError(cause instanceof Error?cause.message:'The project could not be saved.');}finally{setSaving(false);}
 }
 const unavailable=disabled||locked||saving;
 return <section className="client-interaction-setup" aria-label="Interaction setup">
  <fieldset disabled={unavailable}><legend>How are you interacting?</legend><div className="interaction-type-options">{interactionOptions.map(({id:choice,label,description,Icon})=><button type="button" key={choice} aria-label={label} aria-pressed={type===choice} onClick={()=>onTypeChange(choice)}><Icon size={18} aria-hidden="true"/><span><strong>{label}</strong><small>{description}</small></span></button>)}</div></fieldset>
  <div className="interaction-project-row"><label htmlFor={`${id}-project`}>Project · optional<select id={`${id}-project`} value={projectId||''} disabled={unavailable||adding} onChange={event=>onProjectChange(event.target.value||undefined)}><option value="">General client relationship</option>{projects.filter(project=>project.status!=='closed'||project.id===projectId).map(project=><option value={project.id} key={project.id}>{project.name}{project.status==='closed'?' · closed':''}</option>)}</select></label>{onCreateProject&&<button type="button" className="text-button" disabled={unavailable} onClick={()=>{setAdding(true);setError('');}}>Add project</button>}</div><p className="interaction-help">Choose a project to include its previous requirements and next steps. General client memory stays available.</p>
  {adding&&<div className="interaction-project-editor"><label htmlFor={`${id}-new-project`}>Project name<input id={`${id}-new-project`} value={name} disabled={disabled||saving} maxLength={200} onChange={event=>setName(event.target.value)} placeholder="For example: New filter evaluation" autoFocus/></label><div className="interaction-actions"><button type="button" className="button secondary small" disabled={disabled||saving||!name.trim()} onClick={()=>void create()}>{saving?'Saving…':'Save project'}</button><button type="button" className="text-button" disabled={saving} onClick={()=>{setAdding(false);setError('');}}>Cancel</button></div></div>}
  {locked&&<p className="interaction-help">This interaction keeps its selected type and project. Save or finish it before starting a different one.</p>}{error&&<p role="alert" className="interaction-error">{error}</p>}
 </section>;
}

export type PastedExchangeProps={value:string;onChange:(value:string)=>void;onCapture:()=>void|Promise<void>;disabled?:boolean;hasCaptured?:boolean;error?:string};
export function PastedExchange({value,onChange,onCapture,disabled=false,hasCaptured=false,error}:PastedExchangeProps){
 const id=useId(),[saving,setSaving]=useState(false),[localError,setLocalError]=useState('');
 async function capture(){if(!value.trim()||saving||disabled)return;setSaving(true);setLocalError('');try{await onCapture();}catch(cause){setLocalError(cause instanceof Error?cause.message:'The exchange could not be added.');}finally{setSaving(false);}}
 return <section className="client-pasted-exchange" aria-label="Text or email exchange"><header><h2>{hasCaptured?'Continue the exchange':'Paste your exchange'}</h2><p>Keep the client’s words and your replies together. Then ask the copilot for a line you can send.</p></header><label htmlFor={`${id}-exchange`}>Text or email exchange<textarea id={`${id}-exchange`} value={value} onChange={event=>onChange(event.target.value)} disabled={disabled||saving} rows={7} maxLength={60000} placeholder={'Client: We are evaluating a replacement filter.\nYou: What do you need it to improve?\nClient: We need easier cleaning.'}/></label><p className="interaction-help">Label each message <strong>Client:</strong> or <strong>You:</strong>. Unlabeled text stays unassigned until you clarify who wrote it. Pasting does not send an email.</p><div className="interaction-actions"><button type="button" className="button secondary" disabled={disabled||saving||!value.trim()} onClick={()=>void capture()}>{saving?'Adding exchange…':'Add exchange to interaction'}</button></div>{(error||localError)&&<p className="interaction-error" role="alert">{error||localError}</p>}</section>;
}

export function InteractionProgress({step,type,clientName}:{step:'prepare'|'interact'|'review'|'saved';type:InteractionType;clientName:string}){
 const index={prepare:0,interact:1,review:2,saved:3}[step];
 return <nav className="interaction-progress" aria-label={`Interaction with ${clientName}`}><ol>{['Open client','Choose interaction','Interact with copilot','Review & save memory'].map((label,i)=><li key={label} aria-current={i===(step==='prepare'?1:step==='interact'?2:3)?'step':undefined} className={i<=(index===0?1:index===1?2:3)?'is-reached':''}><span>{i+1}</span>{label}</li>)}</ol><p>{clientName} · {interactionLabels[type]}{step==='saved'?' · Memory saved':''}</p></nav>;
}
