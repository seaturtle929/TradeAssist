import {upsertClientContact,type ClientContact,type ClientRecord} from './client-records.ts';

/** A UI action only. It is resolved to a persisted, client-scoped contact before
 * a draft or preparation snapshot receives the route selection. */
export const UNRECORDED_MAIN_LINE_ROUTE='route:create-company-main-line';
export type ClientPhoneRouteOption={id:string;label:string;disabled?:boolean};
const scoped=(client:ClientRecord)=>client.contacts.filter(contact=>contact.clientId===client.id&&contact.companyId===client.companyId);
const phoneRoute=(contact:ClientContact)=>contact.kind==='main_line'||!!contact.phone?.trim();
const routeLabel=(contact:ClientContact)=>`${contact.kind==='main_line'?'Company main line':contact.name} · ${contact.phone?.trim()||'number not recorded'}${contact.archived?' · archived':contact.review?.required?' · review required':''}`;

/** Coaching needs to know where the conversation starts, even when the rep
 * dials elsewhere and has not recorded the switchboard number in TradeAssist. */
export function clientPhoneRouteOptions(client?:ClientRecord,selectedId?:string):ClientPhoneRouteOption[]{
 if(!client)return [];
 const contacts=scoped(client),options=contacts.filter(contact=>phoneRoute(contact)&&(!contact.archived||contact.id===selectedId)).map(contact=>({id:contact.id,label:routeLabel(contact),...contact.archived||contact.review?.required?{disabled:true}:{}}));
 if(!contacts.some(contact=>contact.kind==='main_line'&&!contact.archived))options.unshift({id:UNRECORDED_MAIN_LINE_ROUTE,label:'Company main line · number not recorded'});
 return options;
}

export function selectClientPhoneRoute(client:ClientRecord,requestedId?:string,now=Date.now()):{client:ClientRecord;contactId?:string}{
 if(!requestedId)return {client};
 if(client.removedAt!==undefined)throw Error('Restore this client before choosing a phone route.');
 const contacts=scoped(client);
 if(requestedId===UNRECORDED_MAIN_LINE_ROUTE){
  const existing=contacts.find(contact=>contact.kind==='main_line'&&!contact.archived);
  if(existing)return selectClientPhoneRoute(client,existing.id,now);
  const id=`contact:${globalThis.crypto.randomUUID()}`;
  return {client:upsertClientContact(client,{id,name:'Company main line',kind:'main_line'},now),contactId:id};
 }
 const contact=contacts.find(row=>row.id===requestedId);
 if(!contact||contact.archived||contact.review?.required||!phoneRoute(contact))throw Error('Choose an available phone route for this client. A company main line does not need a recorded number.');
 return {client,contactId:contact.id};
}
