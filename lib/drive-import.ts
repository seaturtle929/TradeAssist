import type { UsageEntry } from "./costs";

export type DriveRef = { id:string; kind:"document"|"spreadsheet"|"presentation"|"file"|"folder"; url:string; resourceKey?:string };
export type DriveSource = { id:string; title:string; text:string; addedAt:string; originUrl:string; syncedAt:string; originKind:"google-drive" };
export type DriveImportResult = { sources:DriveSource[]; warnings:string[]; _charges:UsageEntry[] };
export class DriveImportError extends Error {
  status:number;code:string;
  constructor(message:string,status=400,code="drive_import_error") {super(message);this.status=status;this.code=code;}
}
const ID=/^[A-Za-z0-9_-]{10,200}$/;
const MAX_BYTES=8*1024*1024, MAX_FILES=20, MAX_FOLDERS=10, MAX_CHARACTERS=400_000;
const PDF_HEADER=[37,80,68,70,45];
const mimeKinds:Record<string,DriveRef["kind"]>={"application/vnd.google-apps.document":"document","application/vnd.google-apps.spreadsheet":"spreadsheet","application/vnd.google-apps.presentation":"presentation","application/vnd.google-apps.folder":"folder"};
const supportedFileMime=(mime:string)=>Boolean(mimeKinds[mime]) || /^(?:application\/pdf|text\/plain|text\/csv|text\/markdown|text\/tab-separated-values|application\/json)$/.test(mime);

function canonical(id:string,kind:DriveRef["kind"],resourceKey?:string):DriveRef {
  const path=kind==="folder" ? `https://drive.google.com/drive/folders/${id}` : kind==="file" ? `https://drive.google.com/file/d/${id}/view` : `https://docs.google.com/${kind==="spreadsheet"?"spreadsheets":kind}/d/${id}/edit`;
  const url=new URL(path); if(resourceKey) url.searchParams.set("resourcekey",resourceKey);
  return {id,kind,url:url.toString(),...(resourceKey?{resourceKey}:{})};
}

/** Only known Google sharing paths are accepted. Query tracking and account
 * selectors never become fetch destinations or credentials. */
export function parseDriveUrl(value:string):DriveRef {
  let url:URL; try { url=new URL(value.trim()); } catch { throw new DriveImportError("Paste a complete Google Drive, Docs, Sheets, or Slides link."); }
  if(value.length>2000 || url.protocol!=="https:" || url.username || url.password || url.port || !["drive.google.com","docs.google.com"].includes(url.hostname)) throw new DriveImportError("Use an HTTPS sharing link from drive.google.com or docs.google.com.");
  const key=url.searchParams.get("resourcekey") || undefined;
  if(key && !/^[A-Za-z0-9_-]{1,200}$/.test(key)) throw new DriveImportError("The Drive resource key in this link is not valid.");
  let kind:DriveRef["kind"]="file",id="";
  if(url.hostname==="docs.google.com") {
    const match=url.pathname.match(/^\/(document|spreadsheets|presentation)(?:\/u\/\d+)?\/d\/([A-Za-z0-9_-]+)(?:\/(?:edit|view|preview|export|mobilebasic|pub))?\/?$/);
    if(match) { kind=match[1]==="spreadsheets"?"spreadsheet":match[1] as DriveRef["kind"]; id=match[2]; }
  } else {
    const folder=url.pathname.match(/^\/drive(?:\/u\/\d+)?\/folders\/([A-Za-z0-9_-]+)\/?$/);
    const file=url.pathname.match(/^\/file(?:\/u\/\d+)?\/d\/([A-Za-z0-9_-]+)(?:\/(?:view|edit|preview))?\/?$/);
    if(folder) {kind="folder";id=folder[1];} else if(file) id=file[1];
    else if(["/open","/uc","/download"].includes(url.pathname)) id=url.searchParams.get("id")||"";
  }
  if(!ID.test(id)) throw new DriveImportError("This link does not contain a supported Google file or folder ID. Copy its Share link.");
  return canonical(id,kind,key);
}

function allowedFetch(url:URL) {
  return url.protocol==="https:" && !url.username && !url.password && !url.port &&
    (["docs.google.com","drive.google.com","drive.usercontent.google.com"].includes(url.hostname) || url.hostname.endsWith(".googleusercontent.com"));
}

async function readBounded(response:Response):Promise<Uint8Array> {
  const length=Number(response.headers.get("content-length")||0);
  if(length>MAX_BYTES) {await response.body?.cancel();throw new DriveImportError("This export is larger than 8 MB. Split the file or import a smaller PDF.",413);}
  const reader=response.body?.getReader(); if(!reader) return new Uint8Array();
  const chunks:Uint8Array[]=[];let total=0;
  try { for(;;) { const part=await reader.read(); if(part.done)break; total+=part.value.byteLength; if(total>MAX_BYTES) {await reader.cancel();throw new DriveImportError("This export is larger than 8 MB. Split the file or import a smaller PDF.",413);} chunks.push(part.value); } }
  finally {reader.releaseLock();}
  const bytes=new Uint8Array(total);let offset=0;for(const chunk of chunks) {bytes.set(chunk,offset);offset+=chunk.byteLength;}return bytes;
}

export async function fetchDriveContent(url:string,fetcher:typeof fetch=fetch):Promise<{bytes:Uint8Array;headers:Headers}> {
  let target=new URL(url);
  for(let redirects=0;redirects<6;redirects++) {
    if(!allowedFetch(target)) throw new DriveImportError("Google requires sign-in or redirected outside its supported export service. Check that anyone with the link can view and download this file.",403,"drive_access_required");
    const response=await fetcher(target.toString(),{redirect:"manual",credentials:"omit",headers:{Accept:"application/pdf, text/plain, text/html;q=0.8, */*;q=0.5"},signal:AbortSignal.timeout(25_000)});
    if([301,302,303,307,308].includes(response.status)) {
      const location=response.headers.get("location");await response.body?.cancel();
      if(!location)throw new DriveImportError("Google returned an incomplete export redirect.",502);
      target=new URL(location,target);continue;
    }
    if(!response.ok) {await response.body?.cancel();throw new DriveImportError(response.status===404?"Google could not find this file, or its public sharing is disabled.":"Google could not export this file. Check anyone-with-link access and permission to download it.",response.status===404?404:403,"drive_access_required");}
    return {bytes:await readBounded(response),headers:response.headers};
  }
  throw new DriveImportError("Google returned too many export redirects. Try the file's original sharing link.",502);
}

function textOf(bytes:Uint8Array) {try {return new TextDecoder("utf-8",{fatal:true}).decode(bytes).replace(/^\uFEFF/,"");} catch {throw new DriveImportError("This file is not readable UTF-8 text or PDF. Export it as Google Docs or PDF first.",415);}}
function isHtml(text:string) {return /<(?:!doctype\s+html|html|head|body)(?:\s|>)/i.test(text.slice(0,8000));}
function cleanTitle(value:string) {return value.replace(/[\u0000-\u001f]/g," ").replace(/\s+/g," ").trim().slice(0,300);}
function filename(headers:Headers) {
  const disposition=headers.get("content-disposition")||"";
  const encoded=disposition.match(/filename\*\s*=\s*(?:UTF-8'')?([^;]+)/i)?.[1];
  let name="";
  try {name=encoded?decodeURIComponent(encoded.trim().replace(/^"|"$/g,"")):disposition.match(/filename\s*=\s*"([^"]+)"/i)?.[1]||disposition.match(/filename\s*=\s*([^;]+)/i)?.[1]||"";}catch { /* A filename is optional metadata. */ }
  return cleanTitle(name.replace(/\.(?:pdf|txt|csv|tsv|md|json)$/i,""));
}
function decodeHtml(value:string) {return value.replace(/&amp;/g,"&").replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Math.min(Number(n),0x10ffff)));}
function decodeScriptString(value:string) {
  // Decode data from a quoted JavaScript string without evaluating script.
  return value.replace(/\\(?:x([\da-f]{2})|u([\da-f]{4})|([\\'"\/bfnrt]))/gi,(_,hex,unicode,char)=>hex?String.fromCharCode(parseInt(hex,16)):unicode?String.fromCharCode(parseInt(unicode,16)):({b:"\b",f:"\f",n:"\n",r:"\r",t:"\t"} as Record<string,string>)[char]??char);
}

export function folderEntries(html:string):{entries:{ref:DriveRef;title:string}[];skipped:number;recognized:boolean} {
  const found=new Map<string,{ref:DriveRef;title:string}>();let skipped=0,recognized=false;
  const blob=html.match(/(?:window\.)?_DRIVE_ivd\s*=\s*'((?:\\[\s\S]|[^'\\])*)'/)?.[1];
  if(blob) {
    try {
      const root=JSON.parse(decodeScriptString(blob));recognized=true;
      const visit=(node:unknown,depth=0)=>{
        if(!Array.isArray(node)||depth>15)return;
        if(typeof node[0]==="string" && ID.test(node[0]) && typeof node[2]==="string" && typeof node[3]==="string" && node[3].includes("/")) {
          if(supportedFileMime(node[3])) found.set(node[0],{ref:canonical(node[0],mimeKinds[node[3]]||"file"),title:cleanTitle(node[2])}); else skipped++;
          return;
        }
        for(const child of node)visit(child,depth+1);
      };visit(root);
    }catch { /* Unknown folder layout is handled explicitly below. */ }
  }
  for(const match of html.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    try {
      const href=decodeHtml(match[1]);if(!/^https:\/\/(?:docs|drive)\.google\.com\//.test(href))continue;
      const ref=parseDriveUrl(href),title=cleanTitle(decodeHtml(match[2].replace(/<[^>]*>/g," ")));
      found.set(ref.id,{ref,title});recognized=true;
    }catch { /* Non-file links are not import instructions. */ }
  }
  return {entries:[...found.values()],skipped,recognized};
}

type ImportDependencies = {fetch?:typeof fetch;extractPdf?:(bytes:Uint8Array,name:string)=>Promise<{text:string;charge?:UsageEntry}>};
export async function importDriveUrl(value:string,deps:ImportDependencies={}):Promise<DriveImportResult> {
  const root=parseDriveUrl(value),fetcher=deps.fetch||fetch,result:DriveImportResult={sources:[],warnings:[],_charges:[]};
  const visited=new Set<string>();let files=0,folders=0,characters=0;
  const warn=(message:string)=>{if(!result.warnings.includes(message))result.warnings.push(message);};
  async function visit(ref:DriveRef,depth:number,title="") {
    if(visited.has(ref.id))return;visited.add(ref.id);
    if(ref.kind==="folder") {
      if(depth>2||folders>=MAX_FOLDERS) {warn("Some nested folders were skipped: imports stop at two folder levels and ten folders. Paste skipped file links directly.");return;}
      folders++;
      const fetched=await fetchDriveContent(ref.url,fetcher),html=textOf(fetched.bytes);
      if(!isHtml(html))throw new DriveImportError("Google did not return a readable public folder listing.",422);
      const listing=folderEntries(html);
      if(!listing.recognized)throw new DriveImportError("Google did not expose this folder's file list. Paste individual file links instead; no folder contents were imported.",422,"folder_listing_unavailable");
      warn("Public folder listings can be partial. Review the imported file list against Drive; this import does not certify that every file was included.");
      if(listing.skipped)warn(`${listing.skipped} unsupported file(s) were skipped. Use Google Docs, Sheets, Slides, PDF, or plain text.`);
      for(const child of listing.entries) {
        if(files>=MAX_FILES||characters>=MAX_CHARACTERS) {warn("Import limit reached: at most 20 files and 400,000 characters per link. Import remaining files separately.");break;}
        try {await visit(child.ref,depth+1,child.title);} catch(error) {warn(`${child.title||"A folder item"}: ${error instanceof Error?error.message:"could not be imported"}`);}
      }
      return;
    }
    if(files>=MAX_FILES) {warn("Only the first 20 supported files were imported. Paste remaining file links separately.");return;}
    files++;
    let url:URL;
    if(ref.kind==="document")url=new URL(`https://docs.google.com/document/d/${ref.id}/export?format=txt`);
    else if(ref.kind==="spreadsheet")url=new URL(`https://docs.google.com/spreadsheets/d/${ref.id}/export?format=pdf&portrait=false&fitw=true&sheetnames=true&gridlines=true`);
    else if(ref.kind==="presentation")url=new URL(`https://docs.google.com/presentation/d/${ref.id}/export/pdf`);
    else url=new URL(`https://drive.google.com/uc?export=download&id=${ref.id}`);
    if(ref.resourceKey)url.searchParams.set("resourcekey",ref.resourceKey);
    const fetched=await fetchDriveContent(url.toString(),fetcher);
    const pdf=PDF_HEADER.every((byte,i)=>fetched.bytes[i]===byte);
    let text="";
    const name=title||filename(fetched.headers)||`Google ${ref.kind} ${ref.id.slice(0,6)}`;
    if(pdf) {
      if(!deps.extractPdf)throw new DriveImportError("PDF extraction is not available on this server.",503);
      const extracted=await deps.extractPdf(fetched.bytes,`${name}.pdf`);text=extracted.text;
      if(extracted.charge)result._charges.push(extracted.charge);
      if(ref.kind==="spreadsheet")warn("Sheets are read from Google's workbook PDF export. Check that all expected tabs, columns, and print areas appear; hidden or omitted content may not be exported.");
    } else {
      text=textOf(fetched.bytes);
      if(isHtml(text))throw new DriveImportError("Google returned a sign-in, download-confirmation, or preview page instead of the file. Check public viewing and download access, or use the original Docs/Sheets/Slides link.",403,"drive_access_required");
      const mime=(fetched.headers.get("content-type")||"").split(";")[0].trim().toLowerCase();
      if(ref.kind==="spreadsheet"||ref.kind==="presentation"||mime==="application/pdf"||(!/^text\//.test(mime)&&!["application/json","application/octet-stream",""].includes(mime))||text.includes("\0"))throw new DriveImportError("This Drive file is not supported text or PDF. Export it as Google Docs or PDF first.",415);
    }
    text=text.trim();if(!text)throw new DriveImportError("This file contained no readable text.",422);
    if(characters+text.length>MAX_CHARACTERS)throw new DriveImportError("This file would exceed the 400,000-character import limit. Split it into smaller documents.",413);
    characters+=text.length;const at=new Date().toISOString();
    result.sources.push({id:`google-drive-${ref.id}`,title:cleanTitle(name),text,addedAt:at,originUrl:ref.url,syncedAt:at,originKind:"google-drive"});
  }
  await visit(root,0);
  if(!result.sources.length)throw new DriveImportError(result.warnings[0]||"No supported readable files were found in this link.",422);
  return result;
}
