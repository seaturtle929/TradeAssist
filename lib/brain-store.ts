import type {CompanyBrainRecord} from './company-brain';
let connection:Promise<IDBDatabase>|undefined;
function open(){if(!connection)connection=new Promise((resolve,reject)=>{const request=indexedDB.open('trade-assist-brains-v1',1);request.onupgradeneeded=()=>request.result.createObjectStore('brains',{keyPath:'companyId'});request.onsuccess=()=>resolve(request.result);request.onerror=()=>{connection=undefined;reject(request.error);};});return connection;}
export async function loadCompanyBrains():Promise<CompanyBrainRecord[]>{const db=await open();return new Promise((resolve,reject)=>{const request=db.transaction('brains','readonly').objectStore('brains').getAll();request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}
/** Hydration can invalidate a queued snapshot while IndexedDB is opening.
 * Recheck immediately before creating the transaction, where writes begin. */
export async function saveCompanyBrains(brains:CompanyBrainRecord[],isCurrent:()=>boolean=()=>true){
 if(!isCurrent())return;
 const db=await open();
 if(!isCurrent())return;
 return new Promise<void>((resolve,reject)=>{const tx=db.transaction('brains','readwrite');for(const brain of brains)tx.objectStore('brains').put(brain);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});
}
