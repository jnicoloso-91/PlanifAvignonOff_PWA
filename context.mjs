// context.mjs
import { df_getAllOrdered, df_putMany, df_clear } from './db.mjs';
import { carnet_getAll, carnet_putMany, carnet_clear } from './db.mjs';

const MAX_HISTORY = 50;

// Petit util debounce
function debounce(fn, ms = 400) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

class Emitter {
  #m = new Map();
  on(evt, fn){ (this.#m.get(evt) || this.#m.set(evt, new Set()).get(evt)).add(fn); return () => this.off(evt, fn); }
  off(evt, fn){ this.#m.get(evt)?.delete(fn); }
  emit(evt, payload){ this.#m.get(evt)?.forEach(fn => { try{ fn(payload); } catch(e){ console.error(e);} }); }
}

// Contrainte : le constructeur ne peut pas être async → on fait une init() interne.
export class AppContext {
  // ---------- Singleton ----------
  static #instance = null;
  static #readyPromise = null;

  static async ready() {
    if (AppContext.#instance) return AppContext.#instance;
    if (!AppContext.#readyPromise) {
      AppContext.#readyPromise = (async () => {
        const ctx = new AppContext();
        await ctx.#init();
        AppContext.#instance = ctx;
        return ctx;
      })();
    }
    return AppContext.#readyPromise;
  }

  // ---------- État interne ----------
  #df = [];        // activités (table principale)
  #carnet = [];    // carnet d’adresses
  #meta = {};      // métadonnées “légères”
  #dirty = { df: false, carnet: false, meta: false };

  // autosave (débouncé)
  #autoSave = debounce(() => this.save(), 500);

  // empêche sauvegardes concurrentes
  #saving = false;

  // ---------- Boot / Shutdown ----------
  constructor() {
    // hooks “auto-save” à la fermeture / masquage onglet
    window.addEventListener('beforeunload', () => {
      // évite promesses : sauvegarde synchrone best-effort
      this.saveSync();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.saveSync();
    });
  }

  async #init() {
    // Hydrate RAM depuis IndexedDB (best-effort)
    try {
      const [df, carnet] = await Promise.all([
        df_getAllOrdered().catch(() => []),
        carnet_getAll?.().catch?.(()=>[]) || Promise.resolve([]),
      ]);
      this.#df = Array.isArray(df) ? df : [];
      this.#carnet = Array.isArray(carnet) ? carnet : [];

      // meta : optionnellement depuis localStorage
      const rawMeta = localStorage.getItem('app.meta');
      this.#meta = rawMeta ? safeParseJson(rawMeta, {}) : {};

      // garantis __uuid
      this.#df = normalizeUuid(this.#df);
      this.#carnet = normalizeUuid(this.#carnet);
    } catch (e) {
      console.error('AppContext init error:', e);
      this.#df = [];
      this.#carnet = [];
      this.#meta = {};
    }
  }

  // ---------- Accès lecture ----------
  get df() { return this.#df; }
  get carnet() { return this.#carnet; }
  get meta() { return this.#meta; }

  // Accesseurs défensifs (clonés) 
  // get df() { return [...this.#df]; }
  // get carnet() { return [...this.#carnet]; }
  // get meta() { return [...this.#meta]; }

  // Setters “property-style” → délèguent aux méthodes pour conserver historique/events/autosave
  set df(rows)     { this.setDf(rows); }
  set carnet(rows) { this.setCarnet(rows); }
  set meta(patch)  { this.setMeta(patch); }

  // ---------- Mutations (marquent dirty + autosave) ----------
  setDf(rows) {
    this.#withHistory('setDf', () => {
      this.#df = normalizeUuid(Array.isArray(rows) ? rows : []);
      this.#dirty.df = true;
      this.#em.emit('df:changed', { reason: 'set' });
    });
  }
  setCarnet(rows) {
    this.#withHistory('setCarnet', () => {
      this.#carnet = normalizeUuid(Array.isArray(rows) ? rows : []);
      this.#dirty.carnet = true;
      this.#em.emit('carnet:changed', { reason: 'set' });
    });
  }
  setMeta(patch) {
    this.#withHistory('setMeta', () => {
      this.#meta = { ...(this.#meta||{}), ...(patch||{}) };
      this.#dirty.meta = true;
      this.#em.emit('meta:changed', { reason: 'patch' });
    });
  }

  // ---------- Mutateurs fonctionnels (marquent dirty + autosave) ----------
  mutateDf(fn) {
    this.#withHistory('mutateDf', () => {
      const next = fn(Array.isArray(this.#df) ? this.#df.slice() : []);
      this.#df = normalizeUuid(Array.isArray(next) ? next : []);
      this.#dirty.df = true;
      this.#em.emit('df:changed', { reason: 'mutate' });
    });
  }
  mutateCarnet(fn) {
    this.#withHistory('mutateCarnet', () => {
      const next = fn(Array.isArray(this.#carnet) ? this.#carnet.slice() : []);
      this.#carnet = normalizeUuid(Array.isArray(next) ? next : []);
      this.#dirty.carnet = true;
      this.#em.emit('carnet:changed', { reason: 'mutate' });
    });
  }
  mutateMeta(fn) {
    this.#withHistory('mutateMeta', () => {
      const next = fn({ ...(this.#meta||{}) });
      this.#meta = next || {};
      this.#dirty.meta = true;
      this.#em.emit('meta:changed', { reason: 'mutate' });
    });
  }

  // ---------- Sauvegarde ----------
  async save() {
    if (this.#saving) return; // throttle
    this.#saving = true;
    try {
      const ops = [];
      if (this.#dirty.df) {
        ops.push(df_clear().then(() => df_putMany(this.#df)));
      }
      if (this.#dirty.carnet && carnet_clear && carnet_putMany) {
        ops.push(carnet_clear().then(() => carnet_putMany(this.#carnet)));
      }
      if (this.#dirty.meta) {
        localStorage.setItem('app.meta', JSON.stringify(this.#meta));
      }
      await Promise.all(ops);
      this.#dirty = { df: false, carnet: false, meta: false };
    } catch (e) {
      console.error('AppContext save error:', e);
    } finally {
      this.#saving = false;
    }
  }

  // Sauvegarde “synchrone” best-effort (pas de promesse) pour beforeunload
  saveSync() {
    try {
      if (this.#dirty.meta) {
        localStorage.setItem('app.meta', JSON.stringify(this.#meta));
        this.#dirty.meta = false;
      }
      // IndexedDB n’a pas de sync API; on peut forcer une save() async sans attendre.
      if (this.#dirty.df || this.#dirty.carnet) {
        // lancer mais ne pas attendre (le navigateur peut l’interrompre)
        this.save();
      }
    } catch {}
  }

  // flush explicite (utile avant opérations sensibles)
  async flush() {
    await this.save();
  }

  // garantit __uuid
  ensureUuid() {
    this.#df = normalizeUuid(this.#df);
    this.#carnet = normalizeUuid(this.#carnet);
  }

  // trouver une activité par uuid
  getByUuid(uuid) {
    return this.#df.find(r => r.__uuid === uuid) || null;
  }

  // remplacer / insérer une activité
  upsert(row) {
    this.#withHistory('upsert', () => {
      if (!row) return;
      const id = row.__uuid || genUuid();
      let found = false;
      this.#df = this.#df.map(r => {
        if (r.__uuid === id) { found = true; return { ...r, ...row, __uuid: id }; }
        return r;
      });
      if (!found) this.#df.push({ ...row, __uuid: id });
      this.#dirty.df = true;
      this.#em.emit('df:changed', { reason: found ? 'update' : 'insert', id });
    });
  }

  // supprimer par uuid
  remove(uuid) {
    this.#withHistory('remove', () => {
      const len = this.#df.length;
      this.#df = this.#df.filter(r => r.__uuid !== uuid);
      if (this.#df.length !== len) {
        this.#dirty.df = true;
        this.#em.emit('df:changed', { reason: 'remove', id: uuid });
      }
    });
  }

  #em = new Emitter();

  // Historique
  #undoStack = [];
  #redoStack = [];
  #inAction = null;     // { label, baseSnapshot } pour coalescing

  // --- Events public API ---
  on(evt, fn){ return this.#em.on(evt, fn); }
  off(evt, fn){ return this.#em.off(evt, fn); }

  // --- Snapshot helpers ---
  #makeSnapshot() {
    // clones superficiels (les rows sont des objets “plats” → OK)
    return {
      df: this.#df.slice(),
      carnet: this.#carnet.slice(),
      meta: { ...(this.#meta || {}) },
    };
  }
  #restoreSnapshot(snap) {
    this.#df = snap.df.slice();
    this.#carnet = snap.carnet.slice();
    this.#meta = { ...(snap.meta || {}) };
    // émettre les events de changement
    this.#em.emit('df:changed', { reason: 'restore' });
    this.#em.emit('carnet:changed', { reason: 'restore' });
    this.#em.emit('meta:changed', { reason: 'restore' });
  }
  #pushUndo(snap) {
    this.#undoStack.push(snap);
    if (this.#undoStack.length > MAX_HISTORY) this.#undoStack.shift();
    this.#em.emit('history:change', this.historyState());
  }
  #clearRedo() {
    if (this.#redoStack.length) {
      this.#redoStack = [];
      this.#em.emit('history:change', this.historyState());
    }
  }
  historyState() { return { canUndo: this.canUndo(), canRedo: this.canRedo(), undoLen: this.#undoStack.length, redoLen: this.#redoStack.length }; }
  canUndo(){ return this.#undoStack.length > 0; }
  canRedo(){ return this.#redoStack.length > 0; }

  // --- Regroupement d’actions (coalescing) ---
  beginAction(label='op'){
    if (this.#inAction) return; // déjà en cours
    this.#inAction = { label, baseSnapshot: this.#makeSnapshot() };
  }
  endAction(){
    // si rien n’a changé → pas d’entrée d’historique
    if (!this.#inAction) return;
    const snap = this.#inAction.baseSnapshot;
    this.#inAction = null;
    this.#pushUndo(snap);
    this.#clearRedo();
  }

  // --- Wrapper de modification avec historique ---
  #withHistory(reason, mutator) {
    // si on coalesce : on n’empile pas à chaque mutation
    const base = this.#inAction ? this.#inAction.baseSnapshot : this.#makeSnapshot();
    const beforeJson = JSON.stringify(base); // garde-fou simple

    mutator(); // applique la mutation (setDf, upsert, etc.)

    const afterSnap = this.#makeSnapshot();
    const afterJson = JSON.stringify(afterSnap);

    // si état inchangé → on ne crée pas d’entrée d’historique
    if (beforeJson === afterJson) return;

    if (this.#inAction) {
      // on ne pushe pas maintenant : endAction() poussera baseSnapshot
      // mais on garde la modif en RAM évidemment
    } else {
      this.#pushUndo(base);
      this.#clearRedo();
    }

    // autosave débouncée
    this.#autoSave();
    this.#em.emit('history:change', this.historyState());
  }

  // ---------- Mutations (ré-écrites pour passer par #withHistory) ----------

  // ---------- Undo / Redo ----------
  async undo() {
    if (!this.canUndo()) return;
    const snap = this.#undoStack.pop();
    const cur  = this.#makeSnapshot();
    this.#redoStack.push(cur);
    this.#restoreSnapshot(snap);
    this.#em.emit('history:change', this.historyState());
    this.#autoSave(); // on sauve l’état restauré
  }

  async redo() {
    if (!this.canRedo()) return;
    const snap = this.#redoStack.pop();
    const cur  = this.#makeSnapshot();
    this.#undoStack.push(cur);
    this.#restoreSnapshot(snap);
    this.#em.emit('history:change', this.historyState());
    this.#autoSave();
  }
}  


// ---------- Helpers internes ----------
function genUuid() {
  return crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
function normalizeUuid(rows) {
  return (rows||[]).map((r, i) => {
    if (r && !r.__uuid) r.__uuid = genUuid();
    return r;
  });
}
function safeParseJson(s, dflt) {
  try { return JSON.parse(s); } catch { return dflt; }
}

