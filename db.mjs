// db.mjs
import { openDB } from './lib/idb.mjs';

export const DB_NAME = 'avignon';
export const DB_VERSION = 3;

const STORES = {
  df: 'df',
  meta: 'meta',
  carnet: 'carnet',
  snapshots: 'snapshots',
};

export const dbp = openDB(DB_NAME, DB_VERSION, {
  upgrade(db) {
    if (!db.objectStoreNames.contains(STORES.df)) {
      db.createObjectStore(STORES.df, { keyPath: '__uuid' });
    }
    if (!db.objectStoreNames.contains(STORES.meta)) {
      db.createObjectStore(STORES.meta); // key = "singleton"
    }
    if (!db.objectStoreNames.contains(STORES.carnet)) {
      db.createObjectStore(STORES.carnet, { keyPath: '__uuid' });
    }
    if (!db.objectStoreNames.contains(STORES.snapshots)) {
      db.createObjectStore(STORES.snapshots);
    }
  }
});

const META_KEY = 'singleton';

// ------- df -------
export async function df_getAll() {
  const db = await dbp;
  return db.getAll(STORES.df);
}
// export async function df_putMany(rows) {
//   const db = await dbp;
//   const tx = db.transaction(STORES.df, 'readwrite');
//   for (const r of rows) tx.store.put(r);
//   await tx.done;
// }
// export async function df_putMany(rows) {
//   const db = await dbp;
//   const tx = db.transaction(STORES.df, 'readwrite');
//   for (let r of rows || []) {
//     if (!r) continue;
//     let id = r.__uuid;
//     const bad = id == null || id === '' || (typeof id === 'number' && Number.isNaN(id));
//     if (bad) id = (crypto?.randomUUID?.()) || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
//     r.__uuid = String(id);
//     await tx.store.put(r);
//   }
//   await tx.done;
// }
export async function df_putMany(rows) {
  const db = await dbp;
  const tx = db.transaction(STORES.df, 'readwrite');

  const putOne = (r) => {
    if (!r || typeof r !== 'object' || Array.isArray(r)) return; // ignore non-objets
    const obj = { ...r }; // clone, on ne mutera pas l’original
    if (!obj.__uuid) {
      obj.__uuid =
        (crypto.randomUUID && crypto.randomUUID()) ||
        (`${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
    }
    tx.store.put(obj);
  };

  if (Array.isArray(rows)) {
    for (const r of rows) putOne(r);
  } else {
    putOne(rows);
  }
  await tx.done;
}

export async function df_clear() {
  const db = await dbp;
  return db.clear(STORES.df);
}

// ------- meta -------
export async function meta_get() {
  const db = await dbp;
  return (await db.get(STORES.meta, META_KEY)) ?? {};
}
export async function meta_put(obj) {
  const db = await dbp;
  return db.put(STORES.meta, obj, META_KEY);
}

// ------- carnet -------
export async function carnet_getAll() {
  const db = await dbp;
  return db.getAll(STORES.carnet);
}
export async function carnet_putMany(rows) {
  const db = await dbp;
  const tx = db.transaction(STORES.carnet, 'readwrite');
  for (const r of rows) tx.store.put(r);
  await tx.done;
}
export async function carnet_clear() {
  const db = await dbp;
  return db.clear(STORES.carnet);
}

// ------- snapshots (optionnel) -------
export async function snapshot_save(key, payload) {
  const db = await dbp;
  return db.put(STORES.snapshots, payload, key);
}
export async function snapshot_keys() {
  const db = await dbp;
  return db.getAllKeys(STORES.snapshots);
}