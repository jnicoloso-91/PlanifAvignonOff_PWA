// context.mjs
import { genUUID } from './utils.js';
import { sortDf } from './activites.js';
import { sortCarnet } from './carnet.js';
import { df_getAllOrdered, df_putMany, df_clear, meta_get, meta_put } from './db.mjs';
import { carnet_getAll, carnet_putMany, carnet_clear } from './db.mjs';
import { captureUiStateFromGrids, restoreUiStateToGrids } from './ui_state.mjs';

const MAX_HISTORY = 50;

// --- Historique par domaine ---
const DOMAINS = { DF:'df', CARNET:'carnet', META:'meta' };

// Petit util debounce
function debounce(fn, ms = 400) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

// util : compare superficiellement
const sameArr = (a,b) => JSON.stringify(a) === JSON.stringify(b);
const sameObj = (a,b) => JSON.stringify(a) === JSON.stringify(b);

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
  #df = [];               // activités (table principale)
  #carnet = [];           // carnet d’adresses

  /** @type {AppMeta} */
  #meta;                  // métadonnées “légères”

  #dirty = { df: false, carnet: false, meta: false };

  // autosave (débouncé)
  #autoSave = debounce(() => this.save(), 500);

  // empêche sauvegardes concurrentes
  #saving = false;
  #savePending = false;   

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
    try {
      // --- Hydrate df + carnet depuis IndexedDB
      const [df, carnet] = await Promise.all([
        df_getAllOrdered().catch(() => []),
        carnet_getAll?.().catch?.(() => []) || Promise.resolve([]),
      ]);

      const migratedDf = Array.isArray(df)
      ? migratePrioriteToMarqueur(df)
      : [];

      this.#df = sortDf(migratedDf);
      this.#carnet = Array.isArray(carnet) ? sortCarnet(carnet) : [];

      // --- Meta depuis IndexedDB
      let meta = await meta_get();            // null si absent
      if (!meta) {
        meta = createDefaultMeta();
        await meta_put(meta);
      }
      meta = migrateGridStatePrioriteToMarqueur(meta);
      meta = normalizeMeta(meta);

      this.#meta = meta;
      localStorage.setItem('app.meta', JSON.stringify(meta)); // cache rapide

      // --- Garantis les UUID
      this.#df = normalizeUuid(this.#df);
      this.#carnet = normalizeUuid(this.#carnet);

    } catch (e) {
      console.error('AppContext init error:', e);
      this.#df = [];
      this.#carnet = [];
      this.#meta = createDefaultMeta();
    }
  }

  // ---------- Getters ----------
  get df() { return this.#df; }
  get carnet() { return this.#carnet; }
  get meta() { return this.#meta; }

  getDf() { return this.#df; }
  getCarnet() { return this.#carnet; }
  getMeta() { return this.#meta; }

  // Accesseurs défensifs (clonés) 
  // get df() { return [...this.#df]; }
  // get carnet() { return [...this.#carnet]; }
  // get meta() { return [...this.#meta]; }

  // Setters “property-style” → délèguent aux méthodes pour conserver historique/events/autosave
  // set df(rows)     { this.setDf(rows); }
  // set carnet(rows) { this.setCarnet(rows); }
  // set meta(param)  { this.setMeta(param); }

  // ---------- Setters (marquent dirty + autosave) ----------
  setDf(rows){
    this.#withHistory('df','setDf', ()=>{
      this.#df = normalizeUuid(Array.isArray(rows)? rows: []);
      this.#dirty.df = true;
      this.#em.emit('df:changed', { reason:'set' });
    });
  }
  setCarnet(rows) {
    this.#withHistory('carnet','setCarnet', () => {
      this.#carnet = normalizeUuid(Array.isArray(rows) ? rows : []);
      this.#dirty.carnet = true;
      this.#em.emit('carnet:changed', { reason: 'set' });
    });
  }
  setMeta(patch, { history = false } = {}) {
    if (!patch || typeof patch !== "object") return;

    if (!history) {
      // ✅ default: pas d’historique
      this.#meta = { ...(this.#meta || {}), ...patch };
      this.#dirty.meta = true;
      this.#em.emit("meta:changed", { reason: "patch" });
      this.#autoSave();
      return;
    }

    // ✅ version undoable
    this.#withHistory('meta','setMeta', () => {
      this.#meta = { ...(this.#meta||{}), ...(patch||{}) };
      this.#dirty.meta = true;
      this.#em.emit('meta:changed', { reason: 'patch' });
    });
  }

  // ---------- Mutateurs (marquent dirty + autosave) ----------
  mutateDf(fn, { forceHistory = false } = {}){
    this.#withHistory('df','mutateDf', ()=>{
      const next = fn(this.#df.slice());
      this.#df = normalizeUuid(Array.isArray(next)? next: []);
      this.#dirty.df = true;
      this.#em.emit('df:changed', { reason:'mutate' });
    }, { forceHistory });
  }
  mutateCarnet(fn, { forceHistory = false } = {}) {
    this.#withHistory('carnet','mutateCarnet', () => {
      const next = fn(Array.isArray(this.#carnet) ? this.#carnet.slice() : []);
      this.#carnet = normalizeUuid(Array.isArray(next) ? next : []);
      this.#dirty.carnet = true;
      this.#em.emit('carnet:changed', { reason: 'mutate' });
    }, { forceHistory });
  }
  mutateMeta(fn, { forceHistory = false } = {}) {
    this.#withHistory('meta','mutateMeta', () => {
      const next = fn({ ...(this.#meta||{}) });
      this.#meta = next || {};
      this.#dirty.meta = true;
      this.#em.emit('meta:changed', { reason: 'mutate' });
    }, { forceHistory });
  }
  dfPatch(uuid, patch) {
    if (!uuid || !patch || typeof patch !== "object") return;

    this.#withHistory('df', 'patch', () => {
      const i = this.#df.findIndex(r => r?.__uuid === uuid);
      if (i < 0) return;

      this.#df[i] = { ...this.#df[i], ...patch };
      this.#df = sortDf(this.#df);

      this.#dirty.df = true;
      this.#em.emit('df:changed', { reason: 'patch', id: uuid });
    });
  }

  // ---------- Sauvegarde ----------
  async save() {
    // --- anti-chevauchement : si un save est en cours, on mémorise qu'il faudra relancer
    if (this.#saving) { this.#savePending = true; return; }

    this.#saving = true;
    try {
      const ops = [];

      if (this.#dirty.df) {
        // Remplacement complet pour rester simple et cohérent
        ops.push(df_clear().then(() => df_putMany(this.#df)));
      }

      if (this.#dirty.carnet) {
        ops.push(carnet_clear().then(() => carnet_putMany(this.#carnet)));
      }

      if (this.#dirty.meta) {
        ops.push(meta_put(this.#meta));
      }

      await Promise.all(ops);

      // reset des flags seulement si tout a bien fini
      this.#dirty = { df: false, carnet: false, meta: false };
    } catch (e) {
      console.error('AppContext save error:', e);
      // on NE reset PAS #dirty pour ne pas perdre les changements
    } finally {
      this.#saving = false;

      // Si un save a été redemandé pendant l'exécution, on relance une fois.
      if (this.#savePending) {
        this.#savePending = false;
        // pas de boucle infinie : une seule relance
        // (si tu veux une vraie coalescence, ajoute un debounce côté setters)
        this.save();
      }
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

  // ---------- Helpers Généraux ----------
  // garantit __uuid unique sur df et carnet
  ensureUuid() {
    this.#df = normalizeUuid(this.#df);
    this.#carnet = normalizeUuid(this.#carnet);
  }

  // ---------- Helpers df ----------
  // trouver une activité dans df par uuid
  dfGetByUuid(uuid) {
    return this.#df.find(r => r.__uuid === uuid) || null;
  }

  // remplacer / insérer une activité dans df
  dfUpsert(row) {
    this.#withHistory('df', 'upsert', () => {
      if (!row) return;
      const id = row.__uuid || genUuid();
      let found = false;
      this.#df = this.#df.map(r => {
        if (r.__uuid === id) { found = true; return { ...r, ...row, __uuid: id }; }
        return r;
      });
      if (!found) this.#df.push({ ...row, __uuid: id });
      this.#df = sortDf(this.#df);
      this.#dirty.df = true;
      this.#em.emit('df:changed', { reason: found ? 'update' : 'insert', id });
    });
  }

  // supprimer une activité de df par uuid 
  dfRemove(uuid) {
    this.#withHistory('df', 'remove', () => {
      const len = this.#df.length;
      this.#df = this.#df.filter(r => r.__uuid !== uuid);
      this.#df = sortDf(this.#df);
      if (this.#df.length !== len) {
        this.#dirty.df = true;
        this.#em.emit('df:changed', { reason: 'remove', id: uuid });
      }
    });
  }

  // ---------- Helpers carnet ----------
  // trouver une adresse dans le carnet d'adresses par uuid
  carnetGetByUuid(uuid) {
    return this.#carnet.find(r => r.__uuid === uuid) || null;
  }

  // remplacer / insérer une adresse dans le carnet d'adresses
  carnetUpsert(row) {
    this.#withHistory('carnet', 'upsert', () => {
      if (!row) return;
      const id = row.__uuid || genUuid();
      let found = false;
      this.#carnet = this.#carnet.map(r => {
        if (r.__uuid === id) { found = true; return { ...r, ...row, __uuid: id }; }
        return r;
      });
      if (!found) this.#carnet.push({ ...row, __uuid: id });
      sortCarnet(this.#carnet);
      this.#dirty.carnet = true;
      this.#em.emit('carnet:changed', { reason: found ? 'update' : 'insert', id });
    });
  }

  // supprimer une adresse du carnet d'adresses par uuid
  carnetRemove(uuid) {
    this.#withHistory('carnet', 'remove', () => {
      const len = this.#carnet.length;
      this.#carnet = this.#carnet.filter(r => r.__uuid !== uuid);
      if (this.#carnet.length !== len) {
        this.#dirty.carnet = true;
        this.#em.emit('carnet:changed', { reason: 'remove', id: uuid });
      }
    });
  }

  // ---------- Helpers meta ----------
  getMetaParam(key, defaultValue = null) {
    if (!this.#meta || typeof this.#meta !== 'object') return defaultValue;
    return this.#meta[key] ?? defaultValue;
  }

  setMetaParam(key, value) {
    this.setMeta({ [key]: value });
  }

  updMetaParams(patch = {}) {
    if (!patch || typeof patch !== 'object') return;
    this.setMeta(patch);
  }

  clearMeta() {
    this.#withHistory('meta','clearMeta', () => {
      this.#meta = createDefaultMeta();
      this.#dirty.meta = true;
      this.#em.emit('meta:changed', { reason: 'clear' });
    });
  }

  // ---------- Historique ----------
  #em = new Emitter();
  #undo = {};
  #redo = {};
  #inAction = {}; // domain -> { label, baseSnapshot }
  #lastRestoreTxId = { df: null, meta: null, carnet: null };
  #txCtx = { df: null, meta: null, carnet: null };
  #txCtxTimer = null;

  // --- Events public API ---
  on(evt, fn){ return this.#em.on(evt, fn); }
  off(evt, fn){ return this.#em.off(evt, fn); }

  // --- Snapshot helpers ---
  #markTxId(snap, txId){
    if (!snap || !txId) return;
    try {
      Object.defineProperty(snap, "__txId", { value: String(txId), enumerable: false });
    } catch {}
  }
  #restoreUIStateToGrids(snap) {
    const ui = snap.ui;
    if (ui) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          try { restoreUiStateToGrids(ui); } catch {}
        });
      });
    }
  }
  #makeDomainSnapshot(domain){
    let snap;
    if (domain === 'df') snap = { df: this.#df.slice(), ui: captureUiStateFromGrids(), };
    else if (domain === 'carnet') snap = { carnet: this.#carnet.slice(), ui: captureUiStateFromGrids(), };
    else if (domain === 'meta')   snap = { meta: { ...(this.#meta||{}) } };
    else if (domain === 'ui')   snap = {  };

    // fallback global si besoin :
    else snap = { df:this.#df.slice(), carnet:this.#carnet.slice(), meta:{ ...(this.#meta||{}) } };
  
    const tx = this.#txCtx?.[domain] ?? null;
    if (tx) this.#markTxId(snap, tx);   // helper non-enum

    return snap;
  }
  #restoreDomainSnapshot(domain, snap){
    if (domain === 'df'     && snap.df)     { this.#df = snap.df.slice(); this.#restoreUIStateToGrids(snap); }
    if (domain === 'carnet' && snap.carnet) { this.#carnet = snap.carnet.slice(); this.#restoreUIStateToGrids(snap); }
    if (domain === 'meta'   && snap.meta)   { this.#meta = { ...(snap.meta||{}) }; }

    // mémorise le txId restauré (non-enum, donc safe)
    this.#lastRestoreTxId[domain] = snap?.__txId ?? null;

    // important : la restauration est une modification à persister
    if (domain === "df")     this.#dirty.df = true;
    if (domain === "carnet") this.#dirty.carnet = true;
    if (domain === "meta")   this.#dirty.meta = true;

    // émettre les events
    if (domain === 'df')     this.#em.emit('df:changed',     { reason:'restore' });
    if (domain === 'carnet') this.#em.emit('carnet:changed', { reason:'restore' });
    if (domain === 'meta')   this.#em.emit('meta:changed',   { reason:'restore' });

  }
  #ensureStacks(domain){
    if (!this.#undo[domain]) this.#undo[domain] = [];
    if (!this.#redo[domain]) this.#redo[domain] = [];
  }
  #pushUndo(domain, snap){
    this.#ensureStacks(domain);
    this.#undo[domain].push(snap);
    if (this.#undo[domain].length > MAX_HISTORY) this.#undo[domain].shift();
    this.#em.emit('history:change', { domain, ...this.historyState(domain) });
  }
  #clearRedo(domain){
    this.#ensureStacks(domain);
    if (this.#redo[domain].length){
      this.#redo[domain] = [];
      this.#em.emit('history:change', { domain, ...this.historyState(domain) });
    }
  }
  canUndo(domain){ this.#ensureStacks(domain); return (this.#undo[domain]?.length||0) > 0; }
  canRedo(domain){ this.#ensureStacks(domain); return (this.#redo[domain]?.length||0) > 0; }
  historyState(domain){
    this.#ensureStacks(domain);
    const u = this.#undo[domain], r = this.#redo[domain];
    return { canUndo: u.length>0, canRedo: r.length>0, undoLen: u.length, redoLen: r.length };
  }

  // ---------- Tx helpers ----------

  // Crée un contexte de transaction synchronisé sur plusieurs domaines -> 
  // Tant que le contexte est actif tous les snapshots des domaines concernés sont tagués avec txId
  // Le domaine reste actif jusqu'au clearTxContext ou sinon holdMs ms.
  setTxContext(domains, txId, { holdMs = 600 } = {}) {
    const list = Array.isArray(domains) ? domains : [domains];
    for (const d of list) this.#txCtx[d] = txId ? String(txId) : null;

    // petit hold : attrape les side-effects “juste après”
    clearTimeout(this.#txCtxTimer);
    if (txId) {
      this.#txCtxTimer = setTimeout(() => {
        for (const d of list) this.#txCtx[d] = null;
        this.#txCtxTimer = null;
      }, holdMs);
    }
  }

  // Clear un contexte de transaction synchronisé
  clearTxContext(domains) {
    const list = Array.isArray(domains) ? domains : [domains];
    for (const d of list) this.#txCtx[d] = null;
  }

  // Renvoie le dernier txId restauré lors d'un #restoreDomainSnapshot
  getLastRestoreTxId(domain='df'){
    return this.#lastRestoreTxId?.[domain] ?? null;
  }

  // Recupère le txId du dernier snapshot de la pile undo d'un domaine
  peekUndoTxId(domain='df'){
    this.#ensureStacks(domain);
    const snap = this.#undo[domain]?.[this.#undo[domain].length - 1];
    return snap?.__txId ?? null;
  }

  // Recupère le txId du dernier snapshot de la pile redo d'un domaine
  peekRedoTxId(domain='df'){
    this.#ensureStacks(domain);
    const snap = this.#redo[domain]?.[this.#redo[domain].length - 1];
    return snap?.__txId ?? null;
  }

  // --- Regroupement d’actions (coalescing) ---
  beginAction(domain='df'){
    if (this.#inAction[domain]) return;
    const baseSnapshot = this.#makeDomainSnapshot(domain);
    this.#inAction[domain] = { baseSnapshot };
  }
  endAction(domain='df'){
    const act = this.#inAction[domain];
    if (!act) return;
    delete this.#inAction[domain];
    this.#pushUndo(domain, act.baseSnapshot);
    this.#clearRedo(domain);
  }

  // --- Wrapper de modification avec historique ---
  #withHistory(domain, reason, mutator, { forceHistory=false } = {}){
    const inAct = this.#inAction[domain] || null;
    const base = inAct ? inAct.baseSnapshot : this.#makeDomainSnapshot(domain);
    const before = JSON.stringify(base);

    mutator(); // applique la mutation (setDf, upsert, etc.)

    const afterSnap = this.#makeDomainSnapshot(domain);
    const after = JSON.stringify(afterSnap);
    if (!forceHistory && before === after) return; // rien n’a changé

    if (inAct) {
      // coalescing : on n’empile pas maintenant ; endAction() le fera
    } else {
      this.#pushUndo(domain, base);
      this.#clearRedo(domain);
    }

    this.#autoSave();
    this.#em.emit('history:change', { domain, ...this.historyState(domain) });
  }

  // ---------- Undo / Redo ----------
  _pushHistory(domain) {
    const snap = this.#makeDomainSnapshot(domain);
    if (snap == null) return;
    (this.#undo[domain] ||= []).push(snap);
    this.#redo[domain] = []; // clear redo
    this.#em.emit('history:change', {
      domain,
      canUndo: this.#undo[domain].length > 0,
      canRedo: this.#redo[domain].length > 0,
    });
  }

  async undo(domain='df'){
    this.#ensureStacks(domain);
    const u = this.#undo[domain], r = this.#redo[domain];
    if (!u.length) return;
    const snap = u.pop();
    const cur  = this.#makeDomainSnapshot(domain);

    // ✅ Propagation du txId
    const txId = snap?.__txId;
    if (txId) this.#markTxId(cur, txId);

    r.push(cur);
    this.#restoreDomainSnapshot(domain, snap);
    this.#em.emit('history:change', { domain, ...this.historyState(domain) });
    this.#autoSave();
  }
  async redo(domain='df'){
    this.#ensureStacks(domain);
    const u = this.#undo[domain], r = this.#redo[domain];
    if (!r.length) return;
    const snap = r.pop();
    const cur  = this.#makeDomainSnapshot(domain);

    // ✅ Propagation du txId
    const txId = snap?.__txId;
    if (txId) this.#markTxId(cur, txId);

    u.push(cur);
    this.#restoreDomainSnapshot(domain, snap);
    this.#em.emit('history:change', { domain, ...this.historyState(domain) });
    this.#autoSave();
  }

}  

// ---------- Helpers internes ----------
function genUuid() {
  return genUUID();
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

/**
 * @typedef {{
 *   id: number,
 *   fn: string,
 *   fp: string,
 *   MARGE: number,
 *   DUREE_REPAS: number,
 *   itineraire_app: string,
 *   city_default: string,
 *   traiter_pauses: string,
 *   periode_a_programmer_debut: any,
 *   periode_a_programmer_fin: any
 * }} AppMeta
 */

function createDefaultMeta() {
  return {
    id: 1,
    fn: '',
    fp: '',
    MARGE: 30,
    DUREE_REPAS: 60,
    DUREE_CAFE: 15,
    itineraire_app: '',
    city_default: '',
    traiter_pauses: 'non',
    periode_a_programmer_debut: null,
    periode_a_programmer_fin: null
  };
}

function normalizeMeta(m = {}) {
  return {
    ...createDefaultMeta(),
    ...m,
    MARGE: Number(m?.MARGE ?? 30),
    DUREE_REPAS: Number(m?.DUREE_REPAS ?? 60),
    DUREE_CAFE: Number(m?.DUREE_CAFE ?? 15),
  };
}

function migratePrioriteToMarqueur(rows) {
  return (rows || []).map(r => {
    if (!r || typeof r !== "object") return r;

    const hasPriorite = Object.prototype.hasOwnProperty.call(r, "Priorite");
    const hasMarqueur = Object.prototype.hasOwnProperty.call(r, "Marqueur");

    if (!hasPriorite || hasMarqueur) return r;

    const out = {};

    for (const [key, value] of Object.entries(r)) {
      if (key === "Priorite") {
        out.Marqueur = value;   // même position que Priorite
      } else {
        out[key] = value;
      }
    }

    return out;
  });
}

function migrateGridStatePrioriteToMarqueur(meta) {
  if (!meta?.gridState) return meta;

  for (const gridId of Object.keys(meta.gridState)) {
    const grid = meta.gridState[gridId];
    if (!grid?.columnState) continue;

    grid.columnState = grid.columnState.map(col => {
      if (!col) return col;

      if (col.colId === "Priorite") {
        return { ...col, colId: "Marqueur" };
      }

      return col;
    });
  }

  return meta;
}
