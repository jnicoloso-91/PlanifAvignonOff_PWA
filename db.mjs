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
  const tx = db.transaction('df', 'readonly');
  const st = tx.store;
  const idx = st.index('by_order');
  return idx.getAll(); // renvoie trié par __order
}

/**
 * Tri par Date (YYYYMMDD) puis Début ("HHhMM").
 * - Les lignes SANS Date vont à la fin, triées entre elles par Début.
 * - Ne modifie PAS le tableau d'origine.
 *
 * @param {Array<Object>} rows
 * @param {Object} [opts]
 * @param {boolean} [opts.desc=false] - sens du tri pour les lignes AVEC date
 * @param {string}  [opts.dateKey='Date']
 * @param {string}  [opts.timeKey='Début']  // <-- accent
 * @returns {Array<Object>}
 */
function sortRows(rows, opts = {}) {
  const {
    desc = false,
    dateKey = 'Date',
    timeKey = 'Début',
  } = opts;

  const dir = desc ? -1 : 1;

  const parseDateInt = (d) => {
    if (d == null || d === '') return null;
    const n = Number(d);
    return Number.isFinite(n) ? n : null; // attend YYYYMMDD
  };

  const parseTimeHhMM = (t) => {
    if (t == null || t === '') return null;
    const m = String(t).trim().match(/^(\d{1,2})h(\d{2})$/i);
    if (!m) return null;
    const hh = Number(m[1]), mm = Number(m[2]);
    if (!Number.isFinite(hh) || !Number.isFinite(mm) || hh >= 24 || mm >= 60) return null;
    return hh * 60 + mm; // minutes depuis 00:00
  };

  const indexed = rows.map((r, i) => ({
    r,
    i,
    d: parseDateInt(r[dateKey]),
    m: parseTimeHhMM(r[timeKey]),
  }));

  indexed.sort((A, B) => {
    const aNoDate = A.d == null;
    const bNoDate = B.d == null;

    // 0) Sans date : toujours APRES ceux avec date
    if (aNoDate && !bNoDate) return 1;
    if (!aNoDate && bNoDate) return -1;

    if (!aNoDate && !bNoDate) {
      // 1) Les deux ont une date -> comparer Date
      if (A.d !== B.d) return (A.d - B.d) * dir;

      // 2) Puis l'heure (nulls après)
      const aNull = A.m == null, bNull = B.m == null;
      if (aNull && bNull) return A.i - B.i;   // stabilité
      if (aNull) return 1;
      if (bNull) return -1;
      return (A.m - B.m) * dir;
    }

    // 3) Les deux sont sans date -> trier par Début (nulls après)
    const aNull = A.m == null, bNull = B.m == null;
    if (aNull && bNull) return A.i - B.i;
    if (aNull) return 1;
    if (bNull) return -1;
    return A.m - B.m;
  });

  return indexed.map(x => x.r);
}

export async function df_putMany(rows) {
  const db = await dbp;
  const tx = db.transaction(STORES.df, 'readwrite');
  const orderedRows = sortRows(rows);

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

  if (Array.isArray(orderedRows)) {
    orderedRows.forEach((r, i) => putOne(r, i));
  } else {
    putOne(orderedRows, 0);
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