import type {ClientStanding} from './client-standing';
/** Preparation material is client reference evidence, never company authority.
 * This module has no network or model side effects; ingestion is explicit. */
export type PreparationEmail = {from?:string;to?:string;cc?:string;date?:string;subject?:string;messageId?:string;inReplyTo?:string;references?:string};
export type ClientBackgroundSource = {id:string;companyId:string;clientId:string;kind:'website'|'email'|'document';name:string;url?:string;text:string;status:'ready'|'error';error?:string;readAt:number;email?:PreparationEmail;truncated?:boolean;warnings?:string[]};
export type PreparationEvidence = {section:'situation'|'potentialFit'|'whatToClarify';kind:'established'|'inference'|'uncertain';text:string;sourceIds:string[]};
export type ClientPreparationBrief = {id:string;companyId:string;clientId:string;stageId:string;situation:string;potentialFit:string;whatToClarify:string;generatedAt:number;inputFingerprint:string;sources:{id:string;name:string;url?:string;readAt:number}[];evidence:PreparationEvidence[];model?:string;editedAt?:number};
export type ClientCallBackground = {websites:string[];context:string;sources:ClientBackgroundSource[];brief?:ClientPreparationBrief};
export type ClientPreparedContext = {websites:string[];context:string;sources:(Pick<ClientBackgroundSource,'id'|'name'|'kind'|'url'|'readAt'|'status'|'error'|'email'>&{excerpt?:string;excerptTruncated?:boolean})[];brief?:ClientPreparationBrief};
export type PreparationCompanyFact = {id:string;companyId:string;text:string;sourceId?:string;sourceTitle?:string};
export type PreparationStage = {id:string;name:string;objective:string};
export type PreparationUpload = {name:string;data:string};
export const PREPARATION_UPLOAD_FORMATS = '.eml, .txt, .md, .html, .pdf';
export const PREPARATION_MAX_BYTES = 8 * 1024 * 1024;
const MAX_SOURCE_CHARS = 30_000;

const hash=(value:string)=>{let result=2166136261;for(const character of value)result=Math.imul(result^character.charCodeAt(0),16777619);return (result>>>0).toString(36);};
const clean=(text:string)=>text.replace(/\u0000/g,'').replace(/\r\n?/g,'\n').trim();
export const preparationSourceId=(kind:string,name:string,text='')=>`prep:${kind}:${hash(name+'\n'+text)}`;
export function preparationFingerprint(value:unknown):string {
 const canonical=(input:unknown):unknown=>Array.isArray(input)?input.map(canonical):input&&typeof input==='object'?Object.fromEntries(Object.entries(input).filter(([key,item])=>item!==undefined&&!['brief','readAt','generatedAt','editedAt'].includes(key)).sort(([one],[two])=>one.localeCompare(two)).map(([key,item])=>[key,canonical(item)])):input;
 return 'brief:'+hash(JSON.stringify(canonical(value)));
}
export type PreparationFingerprintInput={companyId:string;clientId:string;clientName:string;stage:PreparationStage;configurationVersionId?:string;salespersonContext?:string;outsideUpdate?:string;clientMemory?:string;standing?:ClientStanding;companyFacts?:PreparationCompanyFact[];websites?:string[];sources?:ClientBackgroundSource[]};
/** Use the same canonical fields before/after requests. Uploads become sources
 * after ingestion; browser-local files never become part of a saved digest. */
export function preparationInputFingerprint(input:PreparationFingerprintInput):string {
 return preparationFingerprint({companyId:input.companyId,clientId:input.clientId,clientName:input.clientName,stage:input.stage,configurationVersionId:input.configurationVersionId||'',salespersonContext:input.salespersonContext||'',outsideUpdate:input.outsideUpdate||'',clientMemory:input.clientMemory||'',standing:input.standing,companyFacts:input.companyFacts||[],websites:input.websites||[],sources:input.sources||[]});
}
export function preparedClientContext(background:ClientCallBackground,companyId:string,clientId:string):ClientPreparedContext {
 // The reviewed source is still useful when an optional generated brief is
 // absent. Keep bounded, attributed excerpts outside Company Knowledge. The
 // newest developments get the context budget first.
 let remaining=16000;
 const sources=background.sources.filter(source=>source.companyId===companyId&&source.clientId===clientId).slice().sort((one,two)=>two.readAt-one.readAt).map(({id,name,kind,url,readAt,status,error,email,text})=>{
  const excerpt=status==='ready'?text.slice(0,Math.min(6000,remaining)):'';remaining-=excerpt.length;
  return {id,name,kind,url,readAt,status,error,email,...excerpt?{excerpt}:{},...status==='ready'&&excerpt.length<text.length?{excerptTruncated:true}:{}};
 });
 const brief=background.brief?.companyId===companyId&&background.brief.clientId===clientId?structuredClone(background.brief):undefined;
 return {websites:[...background.websites],context:background.context,sources,...brief?{brief}:{}};
}
export function decodeHtmlEntities(value:string):string {
 const named:Record<string,string>={amp:'&',quot:'"',apos:"'",lt:'<',gt:'>',nbsp:' ',ndash:'–',mdash:'—',hellip:'…',rsquo:'’',lsquo:'‘',ldquo:'“',rdquo:'”',copy:'©',reg:'®'};
 return value.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi,(whole,entity:string)=>{if(entity[0]!=='#')return named[entity.toLowerCase()]??whole;const n=entity[1].toLowerCase()==='x'?parseInt(entity.slice(2),16):Number(entity.slice(1));return n>0&&n<=0x10ffff?String.fromCodePoint(n):'';});
}
/** Do not execute or retain scripts, styles, forms, hidden blocks or remote assets. */
export function htmlSourceText(html:string):{title:string;text:string} {
 const title=decodeHtmlEntities(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]||'').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim().slice(0,300);
 const text=decodeHtmlEntities(html.replace(/<!--[\s\S]*?-->/g,' ').replace(/<(script|style|noscript|template|svg|form)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,' ').replace(/<(?:br|hr)\b[^>]*>|<\/(?:p|div|section|article|h[1-6]|li|tr|header|footer|main)>/gi,'\n').replace(/<[^>]*>/g,' ')).replace(/[\t ]+/g,' ').replace(/ *\n */g,'\n').replace(/\n{3,}/g,'\n\n').trim();
 return {title,text};
}
function decodeBytes(bytes:Uint8Array,charset='utf-8'):string {
 try{return new TextDecoder(charset,{fatal:true}).decode(bytes);}catch{throw Error(`This source is not readable ${charset} text. Export as UTF-8 text or PDF, or paste the conversation.`);}
}
function base64Bytes(value:string):Uint8Array {
 const compact=value.replace(/\s+/g,'');if(!/^[A-Za-z0-9+/]*={0,2}$/.test(compact)||compact.length%4===1)throw Error('The source contains invalid base64 data.');
 try{return Uint8Array.from(atob(compact),char=>char.charCodeAt(0));}catch{throw Error('The source contains invalid base64 data.');}
}
function qpBytes(value:string,header=false):Uint8Array {
 const text=(header?value.replace(/_/g,' '):value).replace(/=\r?\n/g,'');const bytes:number[]=[];
 for(let index=0;index<text.length;index++){if(text[index]==='='&&/^[\da-f]{2}$/i.test(text.slice(index+1,index+3))){bytes.push(parseInt(text.slice(index+1,index+3),16));index+=2;}else{const code=text.charCodeAt(index);if(code>255)bytes.push(...new TextEncoder().encode(text[index]));else bytes.push(code);}}
 return new Uint8Array(bytes);
}
function decodedHeader(value:string):string {
 return value.replace(/\?=\s+=\?/g,'?==?').replace(/=\?([^?]+)\?([bq])\?([^?]*)\?=/gi,(whole,charset:string,encoding:string,data:string)=>{try{return decodeBytes(encoding.toLowerCase()==='b'?base64Bytes(data):qpBytes(data,true),charset);}catch{return whole;}}).trim();
}
function splitMail(raw:string):{headers:Map<string,string>;body:string} {
 const split=raw.search(/\r?\n\r?\n/);if(split<0)throw Error('This .eml has no readable header/body separator. Paste the email text instead.');
 const headerText=raw.slice(0,split).replace(/\r?\n[\t ]+/g,' '),body=raw.slice(split).replace(/^\r?\n\r?\n/,'');const headers=new Map<string,string>();
 for(const line of headerText.split(/\r?\n/)){const match=line.match(/^([\w-]+):\s*(.*)$/);if(match)headers.set(match[1].toLowerCase(),headers.has(match[1].toLowerCase())?headers.get(match[1].toLowerCase())+', '+match[2]:match[2]);}
 return {headers,body};
}
function mailBody(raw:string,depth=0):{text:string;warnings:string[]} {
 if(depth>8)throw Error('This email has too many nested parts. Paste the relevant thread instead.');
 const {headers,body}=splitMail(raw),type=headers.get('content-type')||'text/plain; charset=utf-8';
 const boundary=type.match(/boundary\s*=\s*(?:"([^"]+)"|([^;\s]+))/i),encoding=(headers.get('content-transfer-encoding')||'').toLowerCase();
 if(/^multipart\//i.test(type)){
  if(!boundary)throw Error('This multipart email is missing its boundary.');
  const marker=boundary[1]||boundary[2],parts=body.split(new RegExp('(?:^|\\r?\\n)--'+marker.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(?:--)?(?:\\r?\\n|$)')).slice(1);const results:{text:string;warnings:string[];plain:boolean}[]=[];let skipped=0;
  for(const part of parts){if(!part.trim()||!/^\w[\w-]*:/m.test(part))continue;const content=splitMail(part);if(/^attachment\b/i.test(content.headers.get('content-disposition')||'')){skipped++;continue;}if(!/^(?:text\/(?:plain|html)|multipart\/|message\/rfc822)/i.test(content.headers.get('content-type')||'text/plain')){skipped++;continue;}const result=mailBody(part,depth+1);results.push({...result,plain:/^text\/plain/i.test(content.headers.get('content-type')||'text/plain')});}
  const selected=/^multipart\/alternative/i.test(type)&&results.some(part=>part.plain)?results.filter(part=>part.plain):results;
  return {text:selected.map(part=>part.text).filter(Boolean).join('\n\n'),warnings:[...new Set(selected.flatMap(part=>part.warnings)),...skipped?[`${skipped} email attachment(s) were not imported. Upload relevant supported documents separately.`]:[]]};
 }
 if(/^message\/rfc822/i.test(type)){const inner=encoding==='base64'?decodeBytes(base64Bytes(body)):encoding==='quoted-printable'?decodeBytes(qpBytes(body)):body;const parsed=parseEmailSource(inner);return {text:emailMetadataText(parsed.email)+'\n'+parsed.text,warnings:parsed.warnings};}
 if(!/^text\/(?:plain|html)(?:;|$)/i.test(type))return {text:'',warnings:['An unsupported email part was skipped.']};
 const charset=type.match(/charset\s*=\s*"?([^;"\s]+)/i)?.[1]||'utf-8';
 const decoded=encoding==='base64'?decodeBytes(base64Bytes(body),charset):encoding==='quoted-printable'?decodeBytes(qpBytes(body),charset):body;
 return {text:/^text\/html/i.test(type)?htmlSourceText(decoded).text:clean(decoded),warnings:[]};
}
export function emailMetadataText(email:PreparationEmail):string {
 return Object.entries(email).filter(([,value])=>value).map(([key,value])=>`${({messageId:'Message-ID',inReplyTo:'In-Reply-To',references:'References'} as Record<string,string>)[key]||key[0].toUpperCase()+key.slice(1)}: ${value}`).join('\n');
}
/** Parses MIME alternatives/encoding and preserves quoted replies, RFC headers
 * and nested forwarded messages. Attachments are never silently called read. */
export function parseEmailSource(raw:string):{text:string;email:PreparationEmail;warnings:string[]} {
 const {headers}=splitMail(raw);if(!['from','to','subject','date','message-id','mime-version'].some(key=>headers.has(key)))throw Error('This file does not contain recognizable email headers. Paste the email text instead.');
 const email:PreparationEmail={};for(const [key,header] of Object.entries({from:'from',to:'to',cc:'cc',date:'date',subject:'subject',messageId:'message-id',inReplyTo:'in-reply-to',references:'references'}))if(headers.get(header))email[key as keyof PreparationEmail]=decodedHeader(headers.get(header)!).slice(0,1500);
 const result=mailBody(raw);if(!result.text.trim())throw Error('No readable email body was found. Upload attachments separately or paste the conversation.');
 return {email,...result};
}
export function parsePastedEmail(text:string,scope:{companyId:string;clientId:string},at=Date.now()):ClientBackgroundSource {
 let parsed:{text:string;email?:PreparationEmail;warnings?:string[]};
 try{parsed=parseEmailSource(text);}catch{const email:PreparationEmail={};for(const [key,label] of Object.entries({from:'From',to:'To',cc:'Cc',date:'Date|Sent',subject:'Subject'})){const value=text.match(new RegExp('^\\s*(?:'+label+'):\\s*(.+)$','im'))?.[1];if(value)email[key as keyof PreparationEmail]=value.trim();}parsed={text:clean(text),...Object.keys(email).length?{email}:{}};}
 if(!parsed.text)throw Error('Paste the email conversation before preparing.');
 return {id:preparationSourceId('email',parsed.email?.subject||'Pasted email',text),...scope,kind:'email',name:parsed.email?.subject||'Pasted email',...boundedSource(parsed.text),status:'ready',readAt:at,...parsed.email?{email:parsed.email}:{},...parsed.warnings?.length?{warnings:parsed.warnings}:{}};
}
export function boundedSource(text:string):{text:string;truncated?:boolean;warnings?:string[]} {
 const normalized=clean(text);return {text:normalized.slice(0,MAX_SOURCE_CHARS),...normalized.length>MAX_SOURCE_CHARS?{truncated:true,warnings:[`Only the first ${MAX_SOURCE_CHARS.toLocaleString()} characters were read; supply any missing relevant section separately.`]}:{}};
}
export function decodePreparationUpload(upload:PreparationUpload):{bytes:Uint8Array;extension:string} {
 const extension=upload.name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1]||'';
 if(!['eml','txt','md','html','htm','pdf'].includes(extension))throw Error(`Unsupported file. Supported formats: ${PREPARATION_UPLOAD_FORMATS}.`);
 const encoded=upload.data.match(/^data:[^,]*;base64,([A-Za-z0-9+/=\r\n]+)$/)?.[1];if(!encoded)throw Error('This upload could not be read. Select the file again.');
 const bytes=base64Bytes(encoded);if(bytes.length>PREPARATION_MAX_BYTES)throw Error('Choose a file under 8 MB.');if(!bytes.length)throw Error('This file is empty.');return {bytes,extension};
}
export async function parsePreparationUpload(upload:PreparationUpload,scope:{companyId:string;clientId:string},extractPdf?:(bytes:Uint8Array,name:string)=>Promise<string>,at=Date.now()):Promise<ClientBackgroundSource> {
 const base={id:preparationSourceId('document',upload.name,upload.data),...scope,name:upload.name.slice(0,300),readAt:at};
 try{
  const {bytes,extension}=decodePreparationUpload(upload);
  if(extension==='pdf'){if(![37,80,68,70,45].every((byte,index)=>bytes[index]===byte))throw Error('The uploaded file is not a readable PDF.');if(!extractPdf)throw Error('PDF extraction is unavailable. Paste the relevant text instead.');const text=await extractPdf(bytes,upload.name);if(!text.trim()||/^\s*\[unreadable\]\s*$/i.test(text))throw Error('No readable PDF text was found.');return {...base,kind:'document',status:'ready',...boundedSource(text)};}
  const raw=decodeBytes(bytes);if(extension==='eml'){const parsed=parseEmailSource(raw),bounded=boundedSource(parsed.text);return {...base,kind:'email',status:'ready',...bounded,email:parsed.email,warnings:[...(bounded.warnings||[]),...parsed.warnings]};}
  const text=['html','htm'].includes(extension)?htmlSourceText(raw).text:clean(raw);if(!text.trim()||text.includes('\u0000')||/[\u0001-\u0008\u000b\u000c\u000e-\u001f]/.test(text))throw Error('This file does not contain readable text.');return {...base,kind:'document',status:'ready',...boundedSource(text)};
 }catch(error){return {...base,kind:/\.eml$/i.test(upload.name)?'email':'document',status:'error',text:'',error:error instanceof Error?error.message:'The file could not be read.'};}
}
