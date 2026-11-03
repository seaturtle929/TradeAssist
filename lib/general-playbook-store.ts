import { defaultGeneralPlaybook, normalizeGeneralPlaybook, type GeneralPlaybookRecord } from './general-playbook.ts';

let connection: Promise<IDBDatabase> | undefined;
function open(): Promise<IDBDatabase> {
  if (connection) return connection;
  connection = new Promise((resolve, reject) => {
    const request = indexedDB.open('trade-assist-general-playbook-v1', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('playbook');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { connection = undefined; reject(request.error || new Error('Could not open General Playbook.')); };
  });
  return connection;
}

export async function loadGeneralPlaybook(): Promise<GeneralPlaybookRecord> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const request = db.transaction('playbook', 'readonly').objectStore('playbook').get('shared');
    request.onsuccess = () => resolve(request.result ? normalizeGeneralPlaybook(request.result) : defaultGeneralPlaybook());
    request.onerror = () => reject(request.error || new Error('Could not load General Playbook.'));
  });
}

/** Recheck after IndexedDB opens: stale hydration/HMR writes must not overwrite current edits. */
export async function saveGeneralPlaybook(playbook: GeneralPlaybookRecord, isCurrent: () => boolean = () => true): Promise<void> {
  if (!isCurrent()) return;
  const db = await open(); if (!isCurrent()) return;
  const transaction = db.transaction('playbook', 'readwrite');
  transaction.objectStore('playbook').put(normalizeGeneralPlaybook(playbook), 'shared');
  await new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('Could not save General Playbook.'));
    transaction.onabort = () => reject(transaction.error || new Error('General Playbook save was interrupted.'));
  });
}
