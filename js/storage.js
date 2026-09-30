/* Saved lifts live in this browser's IndexedDB. Nothing is sent anywhere.
   'lifts' holds one record per lift (analysis, path, findings, body positions).
   'blobs' holds images and optional videos under keys like `${id}:thumb`, `${id}:k:catch`, `${id}:video`. */

const DB_NAME = 'bar-path', DB_VERSION = 1;
export const SCHEMA = 1;
let dbp = null;

function db() {
  if (!dbp) dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, DB_VERSION);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains('lifts')) d.createObjectStore('lifts', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('blobs')) d.createObjectStore('blobs');
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.onblocked = () => rej(new Error('Close other tabs of this app and reload.'));
  });
  return dbp;
}

const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

async function run(stores, mode, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction(stores, mode);
    let out;
    Promise.resolve(fn(t)).then(v => { out = v; }, rej);
    t.oncomplete = () => res(out);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error || new Error('Storage was refused. The device may be out of space.'));
  });
}

const range = id => IDBKeyRange.bound(`${id}:`, `${id}:￿`);

/* blobs: { key: Blob } to write, { key: null } to delete. */
export function saveLift(rec, blobs = {}) {
  return run(['lifts', 'blobs'], 'readwrite', t => {
    t.objectStore('lifts').put(rec);
    const b = t.objectStore('blobs');
    for (const [k, v] of Object.entries(blobs)) v ? b.put(v, `${rec.id}:${k}`) : b.delete(`${rec.id}:${k}`);
  });
}

export function listLifts() {
  return run(['lifts'], 'readonly', t => req(t.objectStore('lifts').getAll()))
    .then(all => all.sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.createdAt.localeCompare(a.createdAt)));
}

export const getLift = id => run(['lifts'], 'readonly', t => req(t.objectStore('lifts').get(id)));
export const getBlob = (id, k) => run(['blobs'], 'readonly', t => req(t.objectStore('blobs').get(`${id}:${k}`)));
export const deleteBlob = (id, k) => run(['blobs'], 'readwrite', t => { t.objectStore('blobs').delete(`${id}:${k}`); });

export function deleteLift(id) {
  return run(['lifts', 'blobs'], 'readwrite', t => {
    t.objectStore('lifts').delete(id);
    t.objectStore('blobs').delete(range(id));
  });
}

export async function usage() {
  const out = { used: null, quota: null, persisted: null };
  try {
    if (navigator.storage && navigator.storage.estimate) { const e = await navigator.storage.estimate(); out.used = e.usage; out.quota = e.quota; }
    if (navigator.storage && navigator.storage.persisted) out.persisted = await navigator.storage.persisted();
  } catch (_) { /* not supported */ }
  return out;
}

/* Asks the browser not to clear saved lifts when space runs low. Browsers may say no. */
export async function askPersist() {
  try { return navigator.storage && navigator.storage.persist ? await navigator.storage.persist() : false; }
  catch (_) { return false; }
}

const toDataURL = blob => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(blob); });

/* Backup file: every record plus its images. Videos are left out; they are too large for a backup file. */
export async function exportAll() {
  const lifts = await listLifts();
  const out = [];
  for (const rec of lifts) {
    const images = {};
    const keys = await run(['blobs'], 'readonly', t => req(t.objectStore('blobs').getAllKeys(range(rec.id))));
    for (const key of keys) {
      const k = key.slice(rec.id.length + 1);
      if (k === 'video') continue;
      images[k] = await toDataURL(await getBlob(rec.id, k));
    }
    out.push({ ...rec, images });
  }
  return new Blob([JSON.stringify({ app: 'bar-path', schema: SCHEMA, exportedAt: new Date().toISOString(), lifts: out })], { type: 'application/json' });
}

export async function importAll(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch (_) { throw new Error('That file is not a Bar Path backup.'); }
  if (!data || data.app !== 'bar-path' || !Array.isArray(data.lifts)) throw new Error('That file is not a Bar Path backup.');
  let added = 0, updated = 0;
  for (const item of data.lifts) {
    const { images = {}, ...rec } = item;
    if (!rec.id || !rec.createdAt) continue;
    const existing = await getLift(rec.id);
    if (existing && (existing.updatedAt || existing.createdAt) >= (rec.updatedAt || rec.createdAt)) continue;
    const blobs = {};
    for (const [k, url] of Object.entries(images)) blobs[k] = await (await fetch(url)).blob();
    if (existing && existing.video && existing.video.saved) rec.video = { ...rec.video, saved: true };
    else if (rec.video) rec.video = { ...rec.video, saved: false };
    await saveLift(rec, blobs);
    existing ? updated++ : added++;
  }
  return { added, updated };
}
