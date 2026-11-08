import type {InteractionType,Turn} from './trade';
export type {InteractionType} from './trade';

export const INTERACTION_TYPES:readonly {id:InteractionType;label:string;description:string}[]=[
 {id:'in_person',label:'In person',description:'Capture a conversation with your microphone or add notes.'},
 {id:'call_meeting',label:'Call or meeting',description:'Use your existing microphone and shared computer audio.'},
 {id:'text_email',label:'Text or email',description:'Paste an exchange, get help replying, then review the memory update.'},
];
export function interactionTypeFor(value:unknown):InteractionType {
 const candidate=value&&typeof value==='object'&&'interactionType' in value?value.interactionType:value;
 return candidate==='in_person'||candidate==='text_email'?candidate:'call_meeting';
}
export const interactionTypeLabel=(value:unknown)=>INTERACTION_TYPES.find(row=>row.id===interactionTypeFor(value))!.label;

const labeled=/^\s*(buyer|customer|client|them|you|me|rep|salesperson)\s*:\s*(.*)$/i;
/** Pasting is capture, not inference. Names, From headers and quotation depth
 * cannot prove who wrote a message. Unknown attribution remains unassigned,
 * unless the salesperson explicitly selects an author for unlabelled text. */
export function parseInteractionExchange(text:string,options:{at?:number;idPrefix?:string;defaultRole?:Turn['role']}={}):{turns:Turn[];warnings:string[]} {
 const at=options.at??Date.now(),prefix=options.idPrefix||`exchange:${globalThis.crypto.randomUUID()}`;
 const turns:Turn[]=[];let role:Turn['role']=options.defaultRole||'conversation',lines:string[]=[];
 const flush=()=>{const body=lines.join('\n').trim();if(body)turns.push({id:`${prefix}:${turns.length}`,role,text:body,at:at+turns.length});lines=[];};
 for(const line of text.replace(/\r\n?/g,'\n').split('\n')){
  const match=labeled.exec(line);
  if(match){flush();role=/^(?:buyer|customer|client|them)$/i.test(match[1])?'buyer':'you';lines.push(match[2]);}
  else lines.push(line);
 }
 flush();
 return {turns,warnings:turns.some(turn=>turn.role==='conversation')?['Some text has no confirmed author. Label messages Buyer: or You:, or select who wrote the pasted text before capturing it.']:[]};
}
