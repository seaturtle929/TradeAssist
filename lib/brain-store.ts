import type {CompanyBrainRecord} from './company-brain';

// Workspace and brains share a database so a reviewed call and its client
// updates can be committed together. The legacy database remains untouched.
let connection: Promise<IDBDatabase> | undefined;
let writes: Promise<unknown> = Promise.resolve();
let commitEpoch=0, callCommitActive=false;
export function beginCallCommit(){if(callCommitActive)throw new Error('A call is already being saved.');callCommitActive=true;commitEpoch++;}
export function endCallCommit(){callCommitActive=false;}
function open(): Promise<IDBDatabase> {
 if(!connection) connection = new Promise((resolve,reject)=>{
  const request=indexedDB.open('trade-assist-workspace-v2',1);
  request.onupgradeneeded=()=>{request.result.createObjectStore('brains',{keyPath:'companyId'});request.result.createObjectStore('workspace');};
  request.onsuccess=()=>{const db=request.result;db.onversionchange=()=>{db.close();connection=undefined;};resolve(db);};
  request.onerror=()=>{connection=undefined;reject(request.error || new Error('Workspace storage could not be opened.'));};
  request.onblocked=()=>{connection=undefined;reject(new Error('Workspace storage is blocked by another tab.'));};
 });
 return connection;
}
function ordered<T>(operation:()=>Promise<T>):Promise<T>{const result=writes.then(operation,operation);writes=result.catch(()=>{});return result;}
function completed(tx:IDBTransaction):Promise<void>{return new Promise((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error || new Error('Storage transaction failed.'));tx.onabort=()=>reject(tx.error || new Error('Storage transaction was interrupted.'));});}
function allBrains(db:IDBDatabase):Promise<CompanyBrainRecord[]>{return new Promise((resolve,reject)=>{const request=db.transaction('brains','readonly').objectStore('brains').getAll();request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}
async function legacyBrains():Promise<CompanyBrainRecord[]>{
 return new Promise((resolve,reject)=>{
  const request=indexedDB.open('trade-assist-brains-v1',1);
  request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains('brains'))request.result.createObjectStore('brains',{keyPath:'companyId'});};
  request.onerror=()=>reject(request.error || new Error('Previous Company Brain storage could not be opened.'));
  request.onsuccess=()=>{const db=request.result;void allBrains(db).then(value=>{db.close();resolve(value);},error=>{db.close();reject(error);});};
 });
}
export async function loadWorkspaceSnapshot<T>():Promise<T | undefined>{
 const db=await open();
 return new Promise((resolve,reject)=>{const store=db.transaction('workspace','readonly').objectStore('workspace');const marker=store.get('verified'),request=store.get('current');request.onsuccess=()=>{const verified=marker.result===true,present=request.result!==undefined;if(verified&&!present){reject(new Error('The verified workspace snapshot is missing. Existing local data was kept. Restore the verified backup before continuing; saving is disabled.'));return;}if((present&&!verified)||(marker.result!==undefined&&!verified)){reject(new Error('The workspace verification marker is missing or invalid. Existing local data was kept. Restore the verified backup before continuing; saving is disabled.'));return;}if(verified&&(request.result===null||typeof request.result!=='object'||Array.isArray(request.result))){reject(new Error('The verified workspace snapshot is invalid. Existing local data was kept. Restore the verified backup before continuing; saving is disabled.'));return;}resolve(verified ? request.result as T : undefined);};request.onerror=()=>reject(request.error);marker.onerror=()=>reject(marker.error);});
}
export async function loadCompanyBrains():Promise<CompanyBrainRecord[]>{
 const db=await open();
 // Presence of the committed snapshot establishes the new database as the
 // authority, even when it legitimately contains zero companies.
 if(await loadWorkspaceSnapshot())return allBrains(db);
 return legacyBrains();
}
/** Serialize every write so a queued Brain save cannot interleave with a call. */
export function saveCompanyBrains(brains:CompanyBrainRecord[],isCurrent:()=>boolean=()=>true):Promise<void>{
 const snapshot=structuredClone(brains),epoch=commitEpoch;
 return ordered(async()=>{if(callCommitActive||commitEpoch!==epoch)throw new Error('This client update was superseded by a call save. Please retry it.');if(!isCurrent())return;const db=await open();if(callCommitActive||commitEpoch!==epoch)throw new Error('This client update was superseded by a call save. Please retry it.');if(!isCurrent())return;const tx=db.transaction('brains','readwrite'),done=completed(tx);try{for(const brain of snapshot)tx.objectStore('brains').put(brain);}catch(error){try{tx.abort();}catch{}await done.catch(()=>{});throw error;}await done;});
}
/** Atomically stores call history, active draft, and corresponding client state. */
export function saveWorkspaceSnapshot<T>(snapshot:T,brains:CompanyBrainRecord[],isCurrent:()=>boolean=()=>true,verifyMigration=false):Promise<void>{
 const workspace=structuredClone(snapshot),companyBrains=structuredClone(brains);
 return ordered(async()=>{if(!isCurrent())return;const db=await open();if(!isCurrent())return;const tx=db.transaction(['workspace','brains'],'readwrite'),done=completed(tx),store=tx.objectStore('workspace');
  try{store.put(workspace,'current');for(const brain of companyBrains)tx.objectStore('brains').put(brain);
   if(verifyMigration){let remaining=1+companyBrains.length;const checkValue=(actual:unknown,expected:unknown)=>{try{if(JSON.stringify(actual)!==JSON.stringify(expected)){tx.abort();return;}if(--remaining===0)store.put(true,'verified');}catch{tx.abort();}};const check=store.get('current');check.onsuccess=()=>checkValue(check.result,workspace);for(const brain of companyBrains){const request=tx.objectStore('brains').get(brain.companyId);request.onsuccess=()=>checkValue(request.result,brain);}}
  }catch(error){try{tx.abort();}catch{}await done.catch(()=>{});throw error;}
  await done;
 });
}
