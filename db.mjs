// db.mjs
import { openDB } from './lib/idb.mjs';

export const DB_NAME = 'avignon';
export const DB_VERSION = 4;

const STORES = {
  df: 'df',
  meta: 'meta',
  carnet: 'carnet',
  snapshots: 'snapshots',
};

export const dbp = openDB(DB_NAME, DB_VERSION, {
  upgrade(db, oldVersion, newVersion, tx) {
    // df
    let dfStore;
    if (db.objectStoreNames.contains(STORES.df)) {
      dfStore = tx.objectStore(STORES.df);
    } else {
      dfStore = db.createObjectStore(STORES.df, { keyPath: '__uuid' });
    }
    // index sur __order (pour lecture ordonnée)
    if (!Array.from(dfStore.indexNames).includes('by_order')) {
      dfStore.createIndex('by_order', '__order');
    }

    // meta
    if (!db.objectStoreNames.contains(STORES.meta)) {
      db.createObjectStore(STORES.meta); // key = "singleton"
    }

    // carnet
    if (!db.objectStoreNames.contains(STORES.carnet)) {
      db.createObjectStore(STORES.carnet, { keyPath: '__uuid' });
    }

    // snapshots
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

export async function df_getAllOrdered() {
  const db = await dbp;
  const tx = db.transaction(STORES.df, 'readonly');
  const st = tx.store;
  const idx = st.index('by_order');
  return idx.getAll(); // renvoie trié par __order
}

export async function df_putMany(rows) {
  const db = await dbp;
  const tx = db.transaction(STORES.df, 'readwrite');

  let orderBase = Date.now(); // base unique pour cet import

  const putOne = (r, i = 0) => {
    if (!r || typeof r !== 'object' || Array.isArray(r)) return; // ignore non-objets
    const obj = { ...r }; // clone, on ne mutera pas l’original

    // UUID unique
    if (!obj.__uuid) {
      obj.__uuid =
        (crypto.randomUUID && crypto.randomUUID()) ||
        (`${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
    }

    // Ordre (si absent)
    if (obj.__order == null) {
      obj.__order = orderBase + i;
    }

    tx.store.put(obj);
  };

  if (Array.isArray(rows)) {
    rows.forEach((r, i) => putOne(r, i));
  } else {
    putOne(rows, 0);
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

export async function carnet_getAllOrdered() {
  const db = await dbp;
  const tx = db.transaction(STORES.carnet, 'readonly');
  const st = tx.store;
  const idx = st.index('by_order');
  return idx.getAll(); // renvoie trié par __order
}

export async function carnet_putMany(rows) {
  const db = await dbp;
  const tx = db.transaction(STORES.carnet, 'readwrite');

  let orderBase = Date.now(); // base unique pour cet import

  const putOne = (r, i = 0) => {
    if (!r || typeof r !== 'object' || Array.isArray(r)) return; // ignore non-objets
    const obj = { ...r }; // clone, on ne mutera pas l’original

    // UUID unique
    if (!obj.__uuid) {
      obj.__uuid =
        (crypto.randomUUID && crypto.randomUUID()) ||
        (`${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
    }

    // Ordre (si absent)
    if (obj.__order == null) {
      obj.__order = orderBase + i;
    }

    tx.store.put(obj);
  };

  if (Array.isArray(rows)) {
    rows.forEach((r, i) => putOne(r, i));
  } else {
    putOne(rows, 0);
  }

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