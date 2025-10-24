// app.js (module)
import { 
  parseHHhMM, 
  excelSerialToYMD, 
  prettyToDateint, 
  dateintToPretty, 
  ymdToDateint, 
  safeDateint, 
  toDateint,
  dateintToInput,
  minutesToPretty,
  prettyToMinutes,
} from './utils-date.js';

import { creerActivitesAPI, sortDf } from './activites.js'; 
import { sortCarnet } from './carnet.js'; 
import { AppContext } from './AppContext.js';
import { ActiviteRenderer } from './ActiviteRenderer.js';
import { LieuRenderer } from './LieuRenderer.js';
import { TelRenderer } from './TelRenderer.js';
import { WebRenderer } from './WebRenderer.js';

const DEBUG = false;

let activitesAPI = null;
// let appJustLaunched = true;

// ===== Multi-grilles =====
const grids = new Map();           // id -> { api, el, loader }
window.grids = grids;
let activeGridId = null;

// Mémorise le créneau sélectionné (grille C)
let selectedSlot = null;

// Etat local pour le double-tap
let lastTapKey = null;
let lastTapTime = 0;
const TAP_DELAY_MS = 350; // fenêtre de double-tap
const isTouchDevice = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);

const TODAY = new Date();
const CUR_Y = TODAY.getFullYear();
const CUR_M = TODAY.getMonth() + 1;

const PHANTOM_WITH_OFFSET = false;      // effet fantôme avec ou sans offset 
const PHANTOM_DEFAULT_OFFSET = 0;   // décalage horizontal par default de la trajectoire de l'effet fantôme
const PHANTOM_DEFAULT_DURATION = 680;  // durée par default de la trajectoire de l'effet fantôme

// ------- Misc Helpers -------

const ROW_H=32, HEADER_H=32, PAD=4;
const hFor = n => HEADER_H + ROW_H * Math.max(0,n) + PAD;

const $ = id => document.getElementById(id);
const waitAF = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

const dateintStrToPretty = (d) => dateintToPretty(Number(d)); 

const estNumerique = (val) => {
  return typeof val === 'number'
    ? Number.isFinite(val)
    : !isNaN(val) && isFinite(Number(val));
}

const capitalizeFirst = (str) => {
  const s = String(str ?? '').trim();
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Renvoie la ligne voisine (suivante ou précédente) d'une row donnée par son uuid.
 * d'une ligne repérée par son __uuid de référence.
 * - Si rows est vide ou l'uuid introuvable → null
 * - Si possible → retourne le __uuid de la ligne suivante
 *   sinon celui de la ligne précédente
 * @param {Array<Object>} rows - tableau "df_display" (ordre d'affichage)
 * @param {string|null|undefined} uuid - identifiant __uuid de la ligne de référence
 * @returns {string|null} __uuid du voisin ou null
 */
function getLigneVoisine(rows, uuid) {
  if (!rows || rows.length === 0) return null;
  if (uuid == null) return null;

  const selectedIdx = rows.findIndex(r => r && r.__uuid === uuid);
  if (selectedIdx < 0) return null;

  const len = rows.length;
  const neighborIdx = (selectedIdx + 1 <= len - 1)
    ? selectedIdx + 1
    : Math.max(selectedIdx - 1, 0);

  return rows[neighborIdx];
}

/**
 * Renvoie le __uuid de la ligne voisine (suivante ou précédente) d'une row donnée par son uuid.
 * d'une ligne repérée par son __uuid de référence.
 * - Si rows est vide ou l'uuid introuvable → null
 * - Si possible → retourne le __uuid de la ligne suivante
 *   sinon celui de la ligne précédente
 * @param {Array<Object>} rows - tableau "df_display" (ordre d'affichage)
 * @param {string|null|undefined} uuid - identifiant __uuid de la ligne de référence
 * @returns {string|null} __uuid du voisin ou null
 */
function getLigneVoisineUuid(rows, uuid) {
  if (!rows || rows.length === 0) return null;
  if (uuid == null) return null;

  const selectedIdx = rows.findIndex(r => r && r.__uuid === uuid);
  if (selectedIdx < 0) return null;

  const len = rows.length;
  const neighborIdx = (selectedIdx + 1 <= len - 1)
    ? selectedIdx + 1
    : Math.max(selectedIdx - 1, 0);

  return rows[neighborIdx]?.__uuid ?? null;
}

function safeSizeToFitFor(id){
  const g = grids.get(id);
  if (!g?.api) return;
  setTimeout(()=>{ try{ g.api.sizeColumnsToFit(); }catch{} },0);
}

function normalizeImportedRows(rows) {
  return (rows || []).map((r, i) => {
    const o = { ...r };
    let id = o.__uuid;
    const bad = id == null || id === '' || (typeof id === 'number' && Number.isNaN(id));
    if (bad) {
      id = (crypto?.randomUUID?.()) || `${Date.now()}-${i}-${Math.random().toString(16).slice(2)}`;
    }
    o.__uuid = String(id);
    return o;
  });
}

// ===== Normalisation des clés de colonnes Excel -> JS ASCII =====

// Désaccentue + nettoie (lowercase)
function normalizeHeaderRaw(s) {
  return String(s ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // enlève accents
    .trim()
    .toLowerCase();
}

// "mot mot" -> "MotMot" (PascalCase)
function toPascal(s) {
  return s
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .map(word => word ? word[0].toUpperCase() + word.slice(1) : '')
    .join('');
}

// Dictionnaire de canons (sur base normalisée lower/ASCII)
const CANON = {
  // colonnes usuelles
  'date': 'Date',
  'debut': 'Debut',
  'duree': 'Duree',
  'activite': 'Activite',
  'lieu': 'Lieu',
  'hyperlien': 'Hyperlien',
  'relache': 'Relache',
  'relache(s)': 'Relache',
  'reserve': 'Reserve',
  'priorite': 'Priorite',
  // tolérances diverses
  'debut (hh:mm)': 'Debut',
  'duree (hh:mm)': 'Duree',
};

// Normalise un nom de colonne en canon JS (ASCII, sans espace)
function normalizeHeaderToCanon(header) {
  if (!header) return '';
  const raw = normalizeHeaderRaw(header);        // "début" -> "debut"
  if (raw in CANON) return CANON[raw];           // mapping connu -> "Debut"
  return toPascal(raw);                          // sinon "ma colonne" -> "MaColonne"
}

// Transforme toutes les lignes d'un tableau d'activités en renommant les propriétés (enlève accents, espaces, garde canons connus + PascalCase)
function normalizeRowsKeys(rows = [], { keepOriginal = false } = {}) {
  if (!Array.isArray(rows)) return [];
  return rows.map(src => {
    const out = {};
    for (const [key, val] of Object.entries(src || {})) {
      // on laisse tranquilles les clés techniques "__uuid" etc.
      if (key && key.startsWith?.('__')) { out[key] = val; continue; }

      const canon = normalizeHeaderToCanon(key);
      if (!canon) continue; // ignore colonnes vides

      // si keepOriginal, on garde aussi l'ancienne clé
      if (keepOriginal) out[key] = val;

      // pose/écrase la version canonique
      out[canon] = val;
    }
    return out;
  });
}

// ===== Grid Helpers =====
// Palette de couleurs de jours pour colorisation des activités programmées
const DAY_COLORS = [
  '#fff2b3',  // jaune sable doux mais lumineux
  '#cde9ff',  // bleu clair franc
  '#d9ebff',  // bleu-gris un peu plus saturé
  '#e6f5b0',  // vert anis doux
  '#f6d8ff',  // mauve clair éclatant
  '#c8f3e0',  // vert d’eau plus vivant
  '#ffe3c1',  // orange très clair et chaud
  '#e0d8ff',  // lavande pastel un peu plus soutenu
];

const COULEUR_ACTIVITE_PROGRAMMABLE = "#d9fcd9"  // ("#ccffcc" autre vert clair  "#cfe2f3" bleu clair)

function colorDate(dateInt) {
  if (dateInt == null || Number.isNaN(dateInt)) return null;
  const i = Math.abs(Number(dateInt)) % DAY_COLORS.length;
  return DAY_COLORS[i];
}

function colorActiviteProgrammable(row) {
  return activitesAPI.estActiviteProgrammable(row) ? COULEUR_ACTIVITE_PROGRAMMABLE : null;
}

function findGridHandleInPane(pane) {
  if (!window.grids) return null;
  const gridDiv = pane?.querySelector?.('div[id^="grid"]');
  if (!gridDiv) return null;
  for (const g of grids.values()) if (g.el === gridDiv) return g;
  return null;
}

function measureGridMetrics(pane) {
  const gridRoot = pane.querySelector('.ag-root') || pane.querySelector('.ag-theme-quartz') || pane.querySelector('div[id^="grid"]');
  const header = gridRoot?.querySelector('.ag-header, .ag-header-viewport');
  const anyRow = gridRoot?.querySelector('.ag-center-cols-container .ag-row, .ag-center-cols-viewport .ag-row');

  const headerH = header ? Math.round(header.getBoundingClientRect().height) : 32;
  const cssRowH = parseInt(getComputedStyle(gridRoot).getPropertyValue('--ag-row-height')) || 32;
  const rowH = anyRow ? Math.round(anyRow.getBoundingClientRect().height) : cssRowH;

  let rowCount = 0;
  try { rowCount = findGridHandleInPane(pane)?.api?.getDisplayedRowCount?.() ?? 0; } catch {}
  return { headerH, rowH, rowCount };
}

function paneOf(exp){ return exp.querySelector('.st-expander-body'); }

function enableTransition(pane){
  pane.classList.remove('no-anim');
  if (pane.style.transition === 'none') pane.style.transition = '';
}

function disableTransition(pane){ pane.classList.add('no-anim'); }

function setH(pane, px){ pane.style.setProperty('height', `${Math.round(px)}px`, 'important'); }

function displayedRows(pane){
  try {
    const gridDiv = pane.querySelector('div[id^="grid"]');
    for (const g of grids.values()) if (g.el === gridDiv) return g.api.getDisplayedRowCount() || 0;
  } catch {}
  return 0;
}

function savePaneHeight(exp){
  const h = Math.round(paneOf(exp).getBoundingClientRect().height);
  if (h>0) localStorage.setItem(`paneHeight:${exp.id}`, String(h));
}

function restoreTargetHeight(exp){
  const pane = paneOf(exp);
  const saved = Number(localStorage.getItem(`paneHeight:${exp.id}`));
  const cnt   = displayedRows(pane);
  const auto  = hFor(Math.min(cnt,5));
  const maxH  = Math.max(Number(pane.dataset.maxContentHeight)||0, hFor(cnt));
  const target = Math.min(Number.isFinite(saved)&&saved>1 ? saved : auto, maxH);
  return Math.max(0, Math.round(target));
}

function enableTouchEdit(api, gridEl, opts = {}) {
  if (!api || !gridEl) return;

  const DEBUG = !!opts.debug;
  const FORCE = !!opts.forceTouch; // 👈
  const log = (...a) => { if (DEBUG) console.debug('[TouchEdit]', ...a); };

  const DOUBLE_TAP_MS = opts.doubleTapMs ?? 450;
  const DOUBLE_TAP_PX = opts.doubleTapPx ?? 14;
  const LONG_PRESS_MS = opts.longPressMs ?? 500;

  // détection tactile : autorise mode forcé pour tests desktop
  const isTouchCapable = ('PointerEvent' in window) && (((navigator.maxTouchPoints || 0) > 0) || FORCE);
  if (!isTouchCapable) { log('skip (no touch capability)'); return; }

  const isTouchPtr = (e) => FORCE || e.pointerType === 'touch'; // 👈

  let last = { key: null, t: 0, x: 0, y: 0 };
  let pressTimer = null;
  let downMeta = null;
  let moved = false;

  const clearPressTimer = () => { if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; } };

  const cellFromEvent = (evt) => {
    const el = evt.target?.closest?.('.ag-cell');
    if (!el) return null;
    const colKey = el.getAttribute('col-id');
    const rowEl = el.closest('.ag-row');
    let rowIndex = rowEl?.getAttribute?.('row-index');
    rowIndex = rowIndex != null ? parseInt(rowIndex, 10) : null;
    if (rowIndex == null) {
      const fc = api.getFocusedCell?.();
      if (fc && fc.column?.getColId?.() === colKey) rowIndex = fc.rowIndex;
    }
    if (rowIndex == null || !colKey) return null;
    return { rowIndex, colKey, key: `${rowIndex}|${colKey}` };
  };

  const startEdit = ({ rowIndex, colKey }) => {
    log('→ startEditingCell', rowIndex, colKey);
    api.startEditingCell({ rowIndex, colKey });
  };

  const onPointerDown = (e) => {
    log('enter pointerdown', e.pointerType, e.isPrimary);
    if (!e.isPrimary || !isTouchPtr(e)) return;
    const cell = cellFromEvent(e);
    if (!cell) return;

    moved = false;
    downMeta = { cell, x: e.clientX, y: e.clientY, t: performance.now() };
    clearPressTimer();
    pressTimer = setTimeout(() => { if (!moved) startEdit(cell); }, LONG_PRESS_MS);

    log('pointerdown', downMeta);
  };

  const onPointerMove = (e) => {
    if (!downMeta) return;
    if (!e.isPrimary || !isTouchPtr(e)) return;
    const dx = Math.abs(e.clientX - downMeta.x);
    const dy = Math.abs(e.clientY - downMeta.y);
    if (dx > DOUBLE_TAP_PX || dy > DOUBLE_TAP_PX) {
      moved = true;
      clearPressTimer();
      log('move cancel (dx,dy)=', dx, dy);
    }
  };

  const onPointerUp = (e) => {
    log('enter pointerup', e.pointerType, e.isPrimary); // 👈 voir si on rentre
    if (!downMeta) return;
    if (!e.isPrimary || !isTouchPtr(e)) { downMeta = null; clearPressTimer(); return; }

    const cell = cellFromEvent(e);
    clearPressTimer();

    if (moved || !cell) { downMeta = null; log('pointerup ignored (moved or no cell)'); return; }

    const now = performance.now();
    const dt = now - (last.t || 0);
    const dx = Math.abs(e.clientX - (last.x || 0));
    const dy = Math.abs(e.clientY - (last.y || 0));
    const sameCell = last.key === cell.key;

    log('pointerup', { dt, dx, dy, sameCell });

    if (sameCell && dt <= DOUBLE_TAP_MS && dx <= DOUBLE_TAP_PX && dy <= DOUBLE_TAP_PX) {
      startEdit(cell);
      last = { key: null, t: 0, x: 0, y: 0 };
    } else {
      last = { key: cell.key, t: now, x: e.clientX, y: e.clientY };
      log('single tap memorized', last);
    }

    downMeta = null;
  };

  // écoute locale + fin de geste globale
  gridEl.addEventListener('pointerdown', onPointerDown, { passive: true });
  gridEl.addEventListener('pointermove', onPointerMove, { passive: true });
  window.addEventListener('pointerup', onPointerUp, { passive: true });
  window.addEventListener('pointercancel', () => { clearPressTimer(); downMeta = null; }, { passive: true });

  log('listeners attached on', gridEl);
}

// function enableTouchEdit(api, gridEl, { debug=false } = {}) {
//   if (!('PointerEvent' in window)) return;
//   if (!gridEl) return;

//   const log = (...a)=>{ if(debug) console.log('[TouchEdit]', ...a); };

//   let downMeta = null;     // { x, y, t, cellEl, rowIndex, colId }
//   let lastUp   = null;     // { t, cellKey }

//   const DOUBLE_MS = 380;   // un poil plus large
//   const SLOP_PX   = 14;    // tolérance de déplacement
//   const TAP_MS    = 260;

//   const getCellMeta = (target) => {
//     const cell = target?.closest?.('.ag-cell');
//     if (!cell) return null;
//     const row   = cell.parentElement?.closest?.('.ag-row');
//     const idx1  = row ? Number(row.getAttribute('aria-rowindex')||'1') : 1;
//     const rowIndex = Math.max(0, idx1 - 1);
//     const colId = cell.getAttribute('col-id') || cell.dataset.colId || null;
//     return { cellEl: cell, rowIndex, colId, key: `${rowIndex}::${colId}` };
//   };

//   const onPointerDown = (e) => {
//     if (e.pointerType !== 'touch') return;  // ne s’intéresse qu’au tactile
//     const meta = getCellMeta(e.target);
//     if (!meta) return;
//     downMeta = {
//       x: e.clientX, y: e.clientY, t: Date.now(),
//       cellEl: meta.cellEl, rowIndex: meta.rowIndex, colId: meta.colId, key: meta.key
//     };
//     log('down', downMeta);
//   };

//   const startEdit = (rowIndex, colId) => {
//     try {
//       api.ensureIndexVisible?.(rowIndex, 'middle');
//       api.startEditingCell?.({ rowIndex, colKey: colId });
//       log('→ startEditingCell', rowIndex, colId);
//     } catch (err) {
//       console.warn('startEditingCell error', err);
//     }
//   };

//   const onPointerUp = (e) => {
//     if (e.pointerType && e.pointerType !== 'touch') return;
//     const now = Date.now();

//     // rien de préparé (up hors grille par ex.)
//     if (!downMeta) return;

//     const dx = Math.abs(e.clientX - downMeta.x);
//     const dy = Math.abs(e.clientY - downMeta.y);
//     const dt = now - downMeta.t;

//     // tap simple reconnu ?
//     const isTap = (dt <= TAP_MS && dx < SLOP_PX && dy < SLOP_PX);
//     if (!isTap) { downMeta = null; return; }

//     // “double up” sur la même cellule dans la fenêtre DOUBLE_MS
//     if (lastUp && (now - lastUp.t) <= DOUBLE_MS && lastUp.cellKey === downMeta.key) {
//       startEdit(downMeta.rowIndex, downMeta.colId);
//       lastUp = null;
//       downMeta = null;
//       e.preventDefault?.();  // évite un scroll fantôme
//       return;
//     }

//     // sinon, mémoriser comme 1er tap
//     lastUp = { t: now, cellKey: downMeta.key };
//     downMeta = null;
//   };

//   // Attachements
//   gridEl.addEventListener('pointerdown', onPointerDown, { passive: true });

//   // Recevoir TOUJOURS le pointerup, même si on a quitté la cellule
//   window.addEventListener('pointerup', onPointerUp, { passive: true, capture: true });

//   log('listeners attached on', gridEl);
// }

// Drop-in : double-tap (≈<280ms, même cellule) → startEditingCell
//           long-press (≥550ms, sans bouger)   → startEditingCell
// function enableTouchEditV2(api, root, { debug=false, doubleTapMs=280, longPressMs=550 } = {}) {
//   if (!api || !root) return;
//   const hasTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
//   if (!hasTouch) { debug && console.log('[TouchEdit] skip (no touch)'); return; }

//   // petit confort pour iOS (réduit la latence du tap)
//   try { root.style.touchAction = 'manipulation'; } catch {}

//   let lastTapT = 0, lastKey = '', lastPos = null;
//   let pressTimer = null, pressed = false, startPos = null;

//   const cellFromEvent = (ev) => {
//     const el = ev.target?.closest?.('.ag-cell');
//     if (!el) return null;
//     const rowEl = el.closest('.ag-row');
//     if (!rowEl) return null;
//     const colId = el.getAttribute('col-id');
//     const rowIndex = (parseInt(rowEl.getAttribute('aria-rowindex'), 10) || 1) - 1; // 0-based
//     if (rowIndex < 0 || !colId) return null;
//     return { rowIndex, colId, cellEl: el, rowEl };
//   };

//   const startEditing = ({ rowIndex, colId }) => {
//     // focus puis édition
//     api.setFocusedCell?.(rowIndex, colId);
//     api.startEditingCell?.({ rowIndex, colKey: colId });
//     debug && console.log('[TouchEdit] → startEditingCell', rowIndex, colId);
//   };

//   const clearPress = () => { if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; } pressed = false; };

//   // on écoute *pointerdown* pour capter iOS / PWA proprement
//   root.addEventListener('pointerdown', (e) => {
//     if (e.pointerType !== 'touch') return;
//     const hit = cellFromEvent(e);
//     if (!hit) return;

//     const now = Date.now();
//     const key = `${hit.rowIndex}|${hit.colId}`;
//     const pos = { x: e.clientX, y: e.clientY };

//     // Long-press
//     pressed = true;
//     startPos = pos;
//     clearPress();
//     pressTimer = setTimeout(() => {
//       if (!pressed) return;
//       // seuil de mouvement : ~8px
//       const moved = startPos && Math.hypot(pos.x - startPos.x, pos.y - startPos.y) > 8;
//       if (!moved) startEditing(hit);
//       clearPress();
//     }, longPressMs);

//     // Double-tap
//     const dt = now - lastTapT;
//     const moved = lastPos && Math.hypot(pos.x - lastPos.x, pos.y - lastPos.y) > 12;
//     if (dt < doubleTapMs && key === lastKey && !moved) {
//       e.preventDefault?.(); // évite le zoom double-tap iOS
//       clearPress();
//       requestAnimationFrame(() => startEditing(hit));
//       lastTapT = 0; lastKey = ''; lastPos = null;
//       return;
//     }
//     lastTapT = now; lastKey = key; lastPos = pos;
//   }, { passive: true });

//   root.addEventListener('pointerup',   () => clearPress(), { passive: true });
//   root.addEventListener('pointercancel', () => clearPress(), { passive: true });

//   debug && console.log('[TouchEdit] listeners attached on', root);
// }

function computeMinPaneHeight(pane) {
  // header
  const headerEl = pane.querySelector('.ag-header');
  const headerH = headerEl ? Math.ceil(headerEl.getBoundingClientRect().height) : 0;

  // hauteur d’une ligne (via CSS var AG Grid, fallback 28px)
  const root = pane.querySelector('.ag-root') || pane;
  const cs = getComputedStyle(root);
  const rowH = parseInt(cs.getPropertyValue('--ag-row-height'), 10) || 28;

  // petit padding de respiration (optionnel)
  const pad = 4;

  // mini = header + 1 ligne (même si vide, on réserve la place)
  return headerH + rowH + pad;
}

function computeContentHeight(pane) {
  // racine AG Grid
  const root = pane.querySelector('.ag-root') || pane;
  const cs = getComputedStyle(root);

  // hauteur ligne & header (avec fallback)
  const rowH = parseInt(cs.getPropertyValue('--ag-row-height'), 10) || 28;
  const headerEl = pane.querySelector('.ag-header');
  const headerH = headerEl
    ? Math.ceil(headerEl.getBoundingClientRect().height)
    : (parseInt(cs.getPropertyValue('--ag-header-height'), 10) || 28);

  // nb de lignes affichées via l'API de la grille
  let displayedRows = 0;
  try {
    const gridDiv = pane.querySelector('div[id^="grid"]');
    for (const g of (window.grids?.values?.() || [])) {
      if (g.el === gridDiv) { displayedRows = g.api.getDisplayedRowCount?.() || 0; break; }
    }
  } catch {}

  const rowsWanted = (displayedRows > 0) ? displayedRows : 2; // ✅ 2 lignes si vide (overlay visible)
  const pad = 0; // ajuste si tu as un padding interne sur le pane

  return headerH + rowsWanted * rowH + pad;
}

function calcMaxHForPane(pane) {
  const root = pane.querySelector('.ag-root') || pane;
  const cs   = getComputedStyle(root);

  const rowH    = parseInt(cs.getPropertyValue('--ag-row-height'), 10) || 28;
  const headerH = (() => {
    const hEl = pane.querySelector('.ag-header');
    if (hEl) return Math.ceil(hEl.getBoundingClientRect().height);
    const varH = parseInt(cs.getPropertyValue('--ag-header-height'), 10);
    return Number.isFinite(varH) ? varH : 28;
  })();

  // nb rows via l’API de la grille hébergée dans ce pane
  const host = pane.querySelector('[id^="grid"]');
  const api  = host?.__agApi;
  const rc   = api?.getDisplayedRowCount?.() ?? 0;

  // ✅ règle : si >0 → nbRows ; si 0 → 1.5 rows (pour l’overlay)
  const rowsWanted = rc > 0 ? rc : 0;

  return headerH + rowsWanted * rowH;
}

function autosizeFromGridSafe(handle, pane) {
  if (!handle?.api || !pane) return;
  const cnt = handle.api.getDisplayedRowCount?.();
  // ⚠️ Ignore les états transitoires
  if (cnt == null || cnt <= 0) return;

  const rowH = handle.api.getSizesForCurrentTheme?.().rowHeight || 32;
  const headerH = handle.api.getHeaderHeight?.() || 32;
  const chrome = 4;

  const targetRows = Math.min(cnt, 5);
  const hTarget = headerH + rowH * targetRows + chrome;
  const hMax    = headerH + rowH * cnt      + chrome;

  // 👉 Ne JAMAIS réduire automatiquement : on n’augmente que si nécessaire
  const cur = parseFloat(getComputedStyle(pane).height) || 0;
  if (hTarget > cur) pane.style.setProperty('height', `${hTarget}px`, 'important');
  // if (hTarget > cur) setPaneHeightSmooth(pane, hTarget, false);

  pane.dataset.maxContentHeight = String(hMax);
  try { handle.api.onGridSizeChanged(); handle.api.sizeColumnsToFit(); } catch {}
}

function measureRowAndHeader(gridEl){
  // valeurs par défaut / variables CSS
  const cs = getComputedStyle(gridEl);
  let rowH    = parseFloat(cs.getPropertyValue('--ag-row-height'))    || 30;
  let headerH = parseFloat(cs.getPropertyValue('--ag-header-height')) || 32;

  // affiner par le DOM si dispo
  const anyRow = gridEl.querySelector('.ag-center-cols-container .ag-row');
  if (anyRow)   rowH    = Math.max(18, Math.round(anyRow.getBoundingClientRect().height));
  const hdr = gridEl.querySelector('.ag-header');
  if (hdr)      headerH = Math.max(22, Math.round(hdr.getBoundingClientRect().height));

  return { rowH, headerH };
}

function visibleRowsInPane(pane, gridEl){
  if (!pane || !gridEl) return 0;
  const paneH = Math.max(0, Math.round(pane.getBoundingClientRect().height));
  const { rowH, headerH } = measureRowAndHeader(gridEl);
  const bodyH = Math.max(0, paneH - headerH);
  return Math.max(0, Math.floor(bodyH / rowH));
}

// Calcul de la hauteur idéale : on ne dépasse pas rowCount et on autosize si rowCount < 5
function desiredPaneHeightForRows(pane, gridEl, api,  { nbRows=null, maxRows = 5 } = {}) {
  if (!gridEl) return null;

  // header
  const headerEl = gridEl.querySelector('.ag-header');
  const hHeader =
    headerEl?.getBoundingClientRect()?.height ||
    api?.getHeaderHeight?.() ||
    36;

  // hauteur d’une ligne (via CSS var si dispo)
  let rowH = 28;
  try {
    const css = getComputedStyle(gridEl);
    const v = css.getPropertyValue('--ag-row-height');
    if (v) rowH = parseFloat(v) || rowH;
  } catch {}

  // nombre de lignes affichées
  // const displayed = api?.getDisplayedRowCount?.() ?? 0;
  const displayed = visibleRowsInPane(pane, gridEl);   

  // nb à prendre en compte : min(displayed, 5) ; si vide et tu veux ~1,5 ligne visible, mets 1.5
  // const n = Math.min(displayed, maxRows);
  let n = 0;
  if (nbRows > maxRows) { // dans ce cas on interdit seulement de dépasser le nombre de lignes du tableau à afficher
    if (displayed >= nbRows) { 
      n = nbRows;         // interdiction de dépasser le nombre de lignes du tableau à afficher
    } else {
      if (DEBUG) console.log(`nb calculé: no autoresize`);
      return null;   // pas de resize auto
    }
  } else n = Math.min(maxRows, nbRows);
  if (DEBUG) console.log(`nb calculé: ${n}`);

  // padding interne du pane si il y en a (à ajuster si nécessaire)
  const paddingPane = (nbRows > n) ? 8: 0;

  const desired = Math.round(hHeader + (rowH * n) + paddingPane);
  return Math.max(desired, hHeader + 8);
}

// Retaille en fonction du row count
function autoSizePanelFromRowCount(pane, gridEl, api, { nbRows=null, maxRows = 5 } = {}) {
  if (!pane || !gridEl) return;

  const exp = pane.closest('.st-expander');
  const isOpen = exp?.classList?.contains?.('open');
  const isClosing = exp?.classList?.contains?.('is-closing');
  const userSized = pane.dataset.userSized === '1';

  // Hauteur calculée : on ne dépasse pas rowCount et on autosize si rowCount < 5
  const h = desiredPaneHeightForRows(pane, gridEl, api, { nbRows,  maxRows });
  if (h == null) return;

  pane.dataset.maxContentHeight = String(h);
  pane.dataset.autoOpenHeight   = String(h);  // utilisé par expander-open policy


  // Fermé ou en train de se fermer: on mémorise seulement la hauteur calculée on ne la change pas
  if (!isOpen || isClosing) {
    if (!userSized) pane.dataset.pendingAutoHeight = String(h);
    return;
  }

  // ouvert: on applique la hauteur calculée seulement si pas userSized
  if (!userSized) {
    pane.style.height = `${h}px`;
    delete pane.dataset.pendingAutoHeight;
  }
}

// function measureRowMetrics(gridEl){
//   const cs = getComputedStyle(gridEl);
//   let rowH    = parseFloat(cs.getPropertyValue('--ag-row-height'))  || 30;
//   let headerH = parseFloat(cs.getPropertyValue('--ag-header-height')) || 32;

//   // affiner via DOM si possible
//   const anyRow = gridEl.querySelector('.ag-center-cols-container .ag-row');
//   if (anyRow)   rowH    = Math.max(18, Math.round(anyRow.getBoundingClientRect().height));
//   const hdr = gridEl.querySelector('.ag-header');
//   if (hdr)      headerH = Math.max(22, Math.round(hdr.getBoundingClientRect().height));

//   return { rowH, headerH };
// }

// // retourne { desiredH, capH } ; desiredH peut être null si nbRows > maxRows
// function desiredPaneHeights(pane, gridEl, { maxRows = 5, nbRows }) {
//   const { rowH, headerH } = measureRowMetrics(gridEl);
//   const capRows = Math.max(0, Number(nbRows) || 0);
//   const capH = headerH + capRows * rowH;

//   if (nbRows > maxRows) {
//     // on ne fait PAS d’auto-taille (mais on borne le splitter via capH)
//     return { desiredH: null, capH };
//   }
//   // sinon : viser min(nbRows, maxRows)
//   const targetRows = Math.min(nbRows, maxRows);
//   const desiredH = headerH + targetRows * rowH;
//   return { desiredH, capH };
// }

// applique l’auto-taille ; NB: si nbRows ≤ maxRows, on ignore userSized pour SHRINKER
// function autoSizePanelFromRowCount2(pane, gridEl, api, { maxRows = 5, nbRows } = {}) {
//   if (!pane || !gridEl) return;
//   const exp = pane.closest('.st-expander');
//   const isOpen = exp?.classList?.contains?.('open');

//   const { desiredH, capH } = desiredPaneHeights(pane, gridEl, { maxRows, nbRows });

//   // borne pour le splitter, toujours à jour
//   if (capH != null) pane.dataset.maxContentHeight = String(capH);

//   // si fermé → ne pas toucher, mais mémoriser la taille voulue si applicable
//   if (!isOpen) {
//     if (desiredH != null) pane.dataset.pendingAutoHeight = String(desiredH);
//     return;
//   }

//   // si nbRows > maxRows → pas d’auto-taille
//   if (desiredH == null) return;

//   // tolérance 1 px : ne resize que si besoin réel
//   const EPS = 1;
//   const currentH = Math.round(pane.getBoundingClientRect().height);

//   // ⚠️ IMPORTANT : quand nbRows ≤ maxRows, on FORCERA la hauteur souhaitée
//   // (même si l’utilisateur a déjà “userSized”) pour garantir le shrink.
//   if (Math.abs(currentH - desiredH) > EPS) {
//     pane.style.height = `${desiredH}px`;
//     delete pane.dataset.pendingAutoHeight;
//   }
// }



// récupère la row sélectionnée (ou la focussée) dans une ag-Grid
function getSelectedRowSafe(api) {
  if (!api) return null;
  const sel = api.getSelectedRows?.() || [];
  if (sel.length) return sel[0];
  const fc = api.getFocusedCell?.();
  const r = fc ? api.getDisplayedRowAtIndex?.(fc.rowIndex) : null;
  return r?.data || null;
}

// Renvoie la row de la ligne séléectionnée dans une grille donnée par son gridId
function getSelectedRow(gridId) {
  const h = grids.get(gridId);
  if (!h) return null;
  const sel = h.api.getSelectedRows?.() || [];
  return sel?.[0];
}

// Renvoie les rows d'une grille à partir de son gridId
function getRowsFromGridId(gridId) {
  const h = grids.get(gridId);             // handle de la grille
  if (!h || !h.api) return [];         // sécurité si non initialisée
  const rows = [];
  h.api.forEachNode(node => {
    if (node?.data) rows.push(node.data);
  });
  return rows;
}

// ---------------------------------------
// Ouverture/Fermeture Expander (version d'origine à reprendre si celle du dessous bugue)
// ---------------------------------------

// // Helper: measure content height with temporary “auto” (restores inline styles)
// function measureContentHeight(pane) {
//   const prev = {
//     height: pane.style.height,
//     maxH:   pane.style.maxHeight,
//     ovf:    pane.style.overflow,
//     vis:    pane.style.visibility
//   };
//   try {
//     pane.style.height    = 'auto';
//     pane.style.maxHeight = 'none';
//     pane.style.overflow  = 'hidden';
//     pane.style.visibility = 'hidden'; // avoid flicker
//     // Use both scrollHeight and DOM box; take the max
//     const h = Math.max(pane.scrollHeight || 0, Math.round(pane.getBoundingClientRect().height) || 0);
//     return Math.max(0, h);
//   } finally {
//     pane.style.height     = prev.height;
//     pane.style.maxHeight  = prev.maxH;
//     pane.style.overflow   = prev.ovf;
//     pane.style.visibility = prev.vis;
//   }
// }

// function openExp(exp) {
//   if (!exp) return;
//   const pane = exp.querySelector('.st-expander-body');
//   if (!pane) { exp.classList.add('open'); return; }

//   // si déjà open et pas en fermeture, ne rien faire
//   if (exp.classList.contains('open') && !exp.classList.contains('is-closing')) return;

//   exp.classList.remove('is-closing');
//   exp.classList.add('open');

//   const saved   = localStorage.getItem(`paneHeight:${exp.id}`);
//   const pending = pane.dataset.pendingAutoHeight;
//   const target  = parseInt(pending || saved || '', 10);

//   // point de départ = 0
//   pane.style.height = '0px';

//   // applique la cible au frame suivant pour déclencher la transition
//   requestAnimationFrame(() => {
//     const h = Number.isFinite(target) && target > 0 ? target : pane.scrollHeight;
//     pane.style.height = `${h}px`;

//     // nettoyage en fin de transition : enlève la height inline pour laisser l'auto-size reprendre la main
//     const onEnd = (ev) => {
//       if (ev.propertyName !== 'height') return;
//       pane.removeEventListener('transitionend', onEnd);
//       delete pane.dataset.pendingAutoHeight;
//       // si tu veux laisser le pane “fixe”, garde la height ; sinon, enlève-la :
//       // pane.style.removeProperty('height');
//     };
//     pane.addEventListener('transitionend', onEnd, { once: true });
//   });
// }

// function closeExp(exp) {
//   if (!exp) return;
//   const pane = exp.querySelector('.st-expander-body');
//   if (!pane) { exp.classList.remove('open'); return; }

//   // si déjà en fermeture, ignore
//   if (exp.classList.contains('is-closing')) return;

//   // mémorise la hauteur actuelle pour réouverture / autosize ultérieure
//   const curH = Math.max(0, Math.round(pane.getBoundingClientRect().height));
//   if (curH > 0) {
//     localStorage.setItem(`paneHeight:${exp.id}`, String(curH));
//     pane.dataset.pendingAutoHeight = String(curH);
//   }

//   // prépare la fermeture animée : set la height actuelle -> force reflow -> 0
//   pane.style.height = `${curH}px`;
//   // force reflow pour que la transition reparte de curH
//   // eslint-disable-next-line no-unused-expressions
//   pane.offsetHeight;

//   exp.classList.add('is-closing');
//   pane.style.height = '0px';

//   const onEnd = (ev) => {
//     if (ev.propertyName !== 'height') return;
//     pane.removeEventListener('transitionend', onEnd);

//     // état final fermé
//     exp.classList.remove('open');
//     exp.classList.remove('is-closing');

//     // IMPORTANT : aucune height inline qui pourrait re-gonfler en fermé
//     pane.style.removeProperty('height');
//   };
//   pane.addEventListener('transitionend', onEnd, { once: true });
// }


// ---------------------------------------
// Ouverture/Fermeture Expander (version d'origine à reprendre si celle du dessous bugue)
// ---------------------------------------


// ---------------------------------------
// Ouverture/Fermeture Expander (version censée corriger les pb aléatoires de blocage en position fermée)
// ---------------------------------------
const MIN_OPEN_PX = 16;          // jamais ouvrir en dessous de ça
const ANIM_TIMEOUT_OPEN  = 900;  // fallback Safari si pas de transitionend
const ANIM_TIMEOUT_CLOSE = 700;

function pickTargetHeight(pane, exp) {
  const parse = s => {
    const n = parseInt(s ?? '', 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  const candidates = [
    parse(pane.dataset.pendingAutoHeight),
    parse(localStorage.getItem(`paneHeight:${exp.id}`)),
    parse(pane.dataset.maxContentHeight),
  ];

  // dernier recours: mesurer le contenu
  const measure = () => {
    const prev = {
      h: pane.style.height, maxH: pane.style.maxHeight,
      ovf: pane.style.overflow, vis: pane.style.visibility
    };
    try {
      pane.style.height = 'auto';
      pane.style.maxHeight = 'none';
      pane.style.overflow = 'hidden';
      pane.style.visibility = 'hidden';
      const a = pane.scrollHeight|0;
      const b = Math.round(pane.getBoundingClientRect().height)|0;
      return Math.max(a, b);
    } finally {
      pane.style.height = prev.h;
      pane.style.maxHeight = prev.maxH;
      pane.style.overflow = prev.ovf;
      pane.style.visibility = prev.vis;
    }
  };

  let target = candidates.find(v => v && v >= MIN_OPEN_PX) ?? measure();
  if (!Number.isFinite(target) || target < MIN_OPEN_PX) target = MIN_OPEN_PX;
  return target;
}

export function openExp(exp) {
  if (!exp) return;
  const pane = exp.querySelector('.st-expander-body');
  if (!pane) { exp.classList.add('open'); return; }

  // si anim en cours, on ignore ce clic
  if (exp.dataset.animating === '1') return;

  // déjà ouvert et pas en fermeture → rien à faire
  if (exp.classList.contains('open') && !exp.classList.contains('is-closing')) return;

  exp.classList.remove('is-closing');
  exp.classList.add('open');
  exp.dataset.animating = '1';
  pane.classList.remove('no-anim');

  // point de départ = hauteur actuelle (nudgé à 1px si 0 pour forcer transition)
  const cur = Math.round(pane.getBoundingClientRect().height) || 0;
  const start = cur > 0 ? cur : 1;
  pane.style.height = `${start}px`;

  // force reflow
  // eslint-disable-next-line no-unused-expressions
  pane.offsetHeight;

  // cible “safe”
  let target = pickTargetHeight(pane, exp);

  // si start == target → nudger de 1px pour garantir transitionend
  if (target === start) target += 1;

  let ended = false;
  const cleanup = () => {
    if (ended) return;
    ended = true;
    pane.removeEventListener('transitionend', onEnd);
    delete pane.dataset.pendingAutoHeight;
    delete exp.dataset.animating;
    // mémorise une bonne hauteur pour la prochaine ouverture
    const hNow = Math.round(pane.getBoundingClientRect().height);
    if (hNow >= MIN_OPEN_PX) {
      localStorage.setItem(`paneHeight:${exp.id}`, String(hNow));
    }
  };
  const onEnd = (ev) => { if (ev.propertyName === 'height') cleanup(); };
  pane.addEventListener('transitionend', onEnd);
  setTimeout(cleanup, ANIM_TIMEOUT_OPEN); // fallback Safari/iOS

  // lance l’anim
  requestAnimationFrame(() => { pane.style.height = `${target}px`; });

  // 2 frames plus tard, on re-mesure (AG Grid a pu peindre) et on corrige si besoin
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (exp.dataset.animating !== '1') return;           // déjà fini
    if (pane.dataset.userSized === '1') return;          // l’utilisateur contrôle
    const contentH = pane.scrollHeight|0;
    if (contentH >= MIN_OPEN_PX && Math.abs(contentH - target) > 2) {
      pane.style.height = `${contentH}px`;
      localStorage.setItem(`paneHeight:${exp.id}`, String(contentH));
    }
  }));
}

export function closeExp(exp) {
  if (!exp) return;
  const pane = exp.querySelector('.st-expander-body');
  if (!pane) { exp.classList.remove('open'); return; }

  if (exp.dataset.animating === '1') return;

  exp.classList.add('is-closing');
  exp.dataset.animating = '1';
  pane.classList.remove('no-anim');

  const cur = Math.round(pane.getBoundingClientRect().height) || 0;
  if (cur <= 1) {
    // déjà “à plat” → ferme sans anim
    exp.classList.remove('open', 'is-closing');
    delete exp.dataset.animating;
    pane.style.height = '0px';
    return;
  }

  pane.style.height = `${cur}px`;
  // force reflow
  // eslint-disable-next-line no-unused-expressions
  pane.offsetHeight;

  let ended = false;
  const cleanup = () => {
    if (ended) return;
    ended = true;
    pane.removeEventListener('transitionend', onEnd);
    exp.classList.remove('open', 'is-closing');
    delete exp.dataset.animating;
    pane.style.height = '0px';
  };
  const onEnd = (ev) => { if (ev.propertyName === 'height') cleanup(); };
  pane.addEventListener('transitionend', onEnd);
  setTimeout(cleanup, ANIM_TIMEOUT_CLOSE); // fallback

  requestAnimationFrame(() => { pane.style.height = '0px'; });
}
// ---------------------------------------
// Ouverture/Fermeture Expander (version censée corriger les pb aléatoires de blocage en position fermée)
// ---------------------------------------

// Sélectionne par __uuid et rend visible
function selectRowByUuid(gridId, uuid, { align='middle', flash=true } = {}) {
  const h = grids.get(gridId);
  if (!h || !uuid) return false;
  const api = h.api;
  let node = null;

  api.forEachNode?.(n => { if (!node && n.data?.__uuid === uuid) node = n; });
  if (!node) return false;

  node.setSelected?.(true, true);
  api.ensureNodeVisible?.(node, align);

  if (flash) {
    const rowEl = h.el.querySelector(`.ag-row[aria-rowindex="${node.rowIndex+1}"]`);
    rowEl?.animate(
      [{ background: 'rgba(255,230,0,.5)' }, { background: 'transparent' }],
      { duration: 450, easing: 'ease-out' }
    );
  }
  return true;
}

// Renvoie Row Node et Element en fonction de l'uuid de ligne
async function getRowNodeAndElByUuid(gridId, uuid, { ensureVisible = true, paints = 2, debug = false } = {}) {
  
  // CSS.escape polyfill safe
  const cssEscape = (window.CSS && CSS.escape) ? CSS.escape : (s) => String(s).replace(/["\\#:.%]/g, '\\$&');

  const h = grids.get(gridId);
  if (!h || !uuid) return { api: null, node: null, rowEl: null, el: h?.el || null };

  const api = h.api;
  let node = null;
  api.forEachNode?.(n => { if (!node && n.data?.__uuid === uuid) node = n; });
  if (!node) {
    if (debug) console.warn('[rowByUuid] node introuvable pour', uuid);
    return { api, node: null, rowEl: null, el: h.el };
  }

  // si demandé, assure la visibilité avant de chercher le DOM
  if (ensureVisible) {
    api.ensureNodeVisible?.(node, 'middle');
    // laisse AG Grid peindre (1-2 frames suffisent)
    await new Promise(r => {
      const step = () => (paints-- > 0) ? requestAnimationFrame(step) : r();
      requestAnimationFrame(step);
    });
  }

  // Recherche robustes dans les 3 containers
  const root = h.el;
  const containers = [
    root.querySelector('.ag-center-cols-container'),
    root.querySelector('.ag-pinned-left-cols-container'),
    root.querySelector('.ag-pinned-right-cols-container'),
    root // fallback global
  ].filter(Boolean);

  // 1) par row-id (id du RowNode = ton __uuid si getRowId est en place)
  const id = node.id ?? node.data?.__uuid;
  let rowEl = null;
  if (id) {
    const selId = `.ag-row[row-id="${cssEscape(id)}"]`;
    for (const c of containers) {
      rowEl = c.querySelector(selId);
      if (rowEl) break;
    }
  }

  // 2) fallback par row-index (0-based)
  if (!rowEl && Number.isFinite(node.rowIndex)) {
    const selIdx = `.ag-row[row-index="${node.rowIndex}"]`;
    for (const c of containers) {
      rowEl = c.querySelector(selIdx);
      if (rowEl) break;
    }
  }

  // 3) fallback par aria-rowindex (1-based)
  if (!rowEl && Number.isFinite(node.rowIndex)) {
    const selAria = `.ag-row[aria-rowindex="${node.rowIndex + 1}"]`;
    for (const c of containers) {
      rowEl = c.querySelector(selAria);
      if (rowEl) break;
    }
  }

  if (!rowEl && debug) {
    const all = root.querySelectorAll('.ag-row');
    console.warn('[rowByUuid] rowEl introuvable — rows visibles=', all.length, {
      tried: { id, rowIndex: node.rowIndex },
      containers: containers.map(c => c.className || c.id || c.tagName),
      sample: all[0]?.outerHTML?.slice(0, 160) + '...',
    });
  }

  return { api, node, rowEl, el: root };
}

// Fait exécuter un vol de ligne fantome de la ligne sélectionnée d'une grille à la ligne sélectionnée d'une autre
// Si gridOrigine = gridCible, utilisez le paramètre srcRow pour spécifier la row de départ du vol
async function doPhantomFlight (gridOrigine, gridCible, expCible) { 

  // 0) récupération du rectangle et du label de l'origine
  const srcRow = getSelectedRow(gridOrigine);
  if (!srcRow) return;
  const { node, rowEl } = await getRowNodeAndElByUuid(gridOrigine, srcRow.__uuid);
  const fromRect = rowEl?.getBoundingClientRect() || null;
  const ghostLabel = (srcRow.Activité || srcRow.Activite || '').trim();

  // 1) ouvrir l’expander cible et rendre la row visible
  openExpander(expCible);
  await nextPaint(2);

  // 2) animer vers la VRAIE ligne si possible, sinon flash-only
  const dstRow = getSelectedRow(gridCible);
  if (!dstRow) return;
  const dst = await ensureRowVisibleAndGetEl(gridCible, dstRow.__uuid);

  if (fromRect && dst.rowEl) {
    const toRect = dst.rowEl.getBoundingClientRect();
    if (PHANTOM_WITH_OFFSET) {
      const ghost  = makeRowGhostFromRect(fromRect, ghostLabel);
      await animateGhostArc(ghost, fromRect, toRect, { duration: 700, lift: -180 });
    } else {
      const ghost  = makeRowGhostExact(fromRect);
      await animateGhostToTopLeft(ghost, fromRect, toRect, { duration: 700});
    }
  }
  // 3) quoi qu’il arrive : sélection & flash final (perceptible)
  if (dst.node) {
    dst.node.setSelected?.(true, true);
    dst.api.ensureNodeVisible?.(dst.node, 'middle');
    flashArrival(gridCible, dst.node);
  }
}

// attendre qu'AG Grid ait peint
function nextPaint(times=2) {
  return new Promise(r => {
    const step = () => (times-- > 0) ? requestAnimationFrame(step) : r();
    requestAnimationFrame(step);
  });
}

// trouve le vrai conteneur qui scrolle
function getScrollContainer(el) {
  let cur = el;
  while (cur && cur !== document.body) {
    const cs = getComputedStyle(cur);
    if (/(auto|scroll)/.test(cs.overflowY) && cur.scrollHeight > cur.clientHeight) {
      return cur;
    }
    cur = cur.parentElement;
  }
  return document.scrollingElement || document.documentElement;
}

// scrolle l'expander en tenant compte du header
// function scrollExpanderIntoView(exp) {
//   if (!exp) return;
//   const scroller = getScrollContainer(exp);

//   // lis ar CSS --header-h (fallback 48px) + petit coussin
//   const headerH = parseFloat(
//     getComputedStyle(document.documentElement).getPropertyValue('--header-h')
//   ) || 48;
//   const cushion = 8;

//   const expRect = exp.getBoundingClientRect();
//   const scRect  = scroller.getBoundingClientRect();

//   // position cible = position actuelle du scroll + delta - header - coussin
//   const targetTop = scroller.scrollTop + (expRect.top - scRect.top) - headerH - cushion;

//   console.log(`scrollTop ${scroller.scrollTop}`);
//   console.log(`expRect.top ${expRect.top}`);
//   console.log(`scRect.top ${scRect.top}`);
//   console.log(`targetTop ${targetTop}`);

//   const maxTop = scroller.scrollHeight - scroller.clientHeight;
//   console.log({scrollTop: scroller.scrollTop, maxTop, targetTop});
//   console.log(scroller.scrollHeight, scroller.clientHeight);

//   scroller.scrollTo({ top: Math.max(0, targetTop), behavior: 'smooth' });
// }

// function offsetTopWithin(el, ancestor){
//   let top = 0, n = el;
//   while (n && n !== ancestor){
//     top += n.offsetTop;
//     n = n.offsetParent;
//   }
//   return top;
// }

// const raf = () => new Promise(r => requestAnimationFrame(r));

// async function scrollExpanderIntoView(exp){
//   if (!exp) return;

//   const scroller = getScrollContainer(exp);
//   const cs = getComputedStyle(document.documentElement);
//   const headerH = parseFloat(cs.getPropertyValue('--header-h')) || 48;
//   const cushion = 8;

//   // position basée sur la hiérarchie réelle (plus fiable que getBoundingClientRect)
//   const targetRaw = offsetTopWithin(exp, scroller) - headerH - cushion;

//   const maxTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
//   const targetTop = Math.max(0, Math.min(maxTop, targetRaw));

//   if (Math.abs(scroller.scrollTop - targetTop) < 1) return;

//   // 🔧 On désactive temporairement scroll-snap et overflow-anchor
//   const prevSnap   = scroller.style.scrollSnapType;
//   const prevAnchor = scroller.style.overflowAnchor;
//   scroller.style.scrollSnapType = 'none';
//   scroller.style.overflowAnchor = 'none';

//   // Double scroll : saut instantané puis lissé (le lissé seul peut être ignoré)
//   scroller.scrollTo({ top: targetTop, behavior: 'auto' });
//   await raf();
//   scroller.scrollTo({ top: targetTop, behavior: 'smooth' });

//   // Rétablir les propriétés
//   await raf();
//   scroller.style.scrollSnapType = prevSnap || '';
//   scroller.style.overflowAnchor = prevAnchor || '';
// }


function offsetTopWithin(el, ancestor){
  let top = 0, n = el;
  while (n && n !== ancestor){
    top += n.offsetTop;
    n = n.offsetParent;
  }
  return top;
}

function smoothScrollTo(el, target, duration = 400){
  const start = el.scrollTop;
  const change = target - start;
  const startTime = performance.now();

  function easeOutCubic(t){ return 1 - Math.pow(1 - t, 3); }

  function animate(now){
    const elapsed = now - startTime;
    const t = Math.min(1, elapsed / duration);
    el.scrollTop = start + change * easeOutCubic(t);
    if (t < 1) requestAnimationFrame(animate);
  }
  requestAnimationFrame(animate);
}

async function scrollExpanderIntoView(exp){
  if (!exp) return;
  const scroller = getScrollContainer(exp);
  const cs = getComputedStyle(document.documentElement);
  const headerH = parseFloat(cs.getPropertyValue('--header-h')) || 48;
  const cushion = 8;

  const targetRaw = offsetTopWithin(exp, scroller) - headerH - cushion;
  const maxTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
  const targetTop = Math.max(0, Math.min(maxTop, targetRaw));

  // désactivation temporaire du scroll-snap et de l'ancrage
  const prevSnap = scroller.style.scrollSnapType;
  const prevAnchor = scroller.style.overflowAnchor;
  scroller.style.scrollSnapType = 'none';
  scroller.style.overflowAnchor = 'none';

  smoothScrollTo(scroller, targetTop, 500); // 🔹 durée 500 ms, easing custom

  // réactivation
  setTimeout(() => {
    scroller.style.scrollSnapType = prevSnap || '';
    scroller.style.overflowAnchor = prevAnchor || '';
  }, 600);
}

// centre l'expander dans le viewport (en tenant compte du header),
// sauf si l'expander est plus grand que le viewport -> aligne sous le header.
async function scrollExpanderIntoViewCentered(exp, {
  headerVar = '--header-h',   // CSS var du header (px)
  cushion   = 8,              // petit coussin
  duration  = 500             // durée de l’anim
} = {}){
  if (!exp) return;

  const scroller = getScrollContainer(exp);
  const cs = getComputedStyle(document.documentElement);
  const headerH = parseFloat(cs.getPropertyValue(headerVar)) || 48;

  const expTop   = offsetTopWithin(exp, scroller);
  const expH     = exp.offsetHeight || exp.getBoundingClientRect().height || 0;
  const vpH      = scroller.clientHeight;

  // cas “expander > viewport” → aligne sous le header (comme avant)
  let targetRaw;
  if (expH >= vpH - headerH - cushion*2){
    targetRaw = expTop - headerH - cushion;
  } else {
    // centre : place le milieu de l’expander au milieu de la zone visible sous le header
    const visibleH = vpH - headerH;                 // zone utile sous le header
    const centerOffset = (visibleH - expH) / 2;     // marge pour centrer
    targetRaw = expTop - headerH - Math.max(cushion, centerOffset);
  }

  const maxTop   = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
  const targetTop = Math.max(0, Math.min(maxTop, Math.round(targetRaw)));

  // désactive temporairement scroll-snap/ancrage pour éviter les “retours”
  const prevSnap   = scroller.style.scrollSnapType;
  const prevAnchor = scroller.style.overflowAnchor;
  scroller.style.scrollSnapType = 'none';
  scroller.style.overflowAnchor = 'none';

  smoothScrollTo(scroller, targetTop, duration);

  setTimeout(() => {
    scroller.style.scrollSnapType = prevSnap || '';
    scroller.style.overflowAnchor = prevAnchor || '';
  }, duration + 120);
}

async function scrollExpanderIntoViewCenteredAsync(exp, opts){
  await scrollExpanderIntoViewCentered(exp, opts); // si elle ne renvoie pas de promesse, ajoute `await waitAF()`
  await waitAF();
}

// Rend visible un expander
function scrollToExpander(expId) {
  const exp = document.getElementById(expId);
  if (!exp) return;
  // exp.scrollIntoView({ behavior: 'smooth', block: 'center' });
  // exp.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
  scrollExpanderIntoViewCentered(exp);
}

// Rend visible un expander
function scrollToExpanderAsync(expId) {
  const exp = document.getElementById(expId);
  if (!exp) return;
  // exp.scrollIntoView({ behavior: 'smooth', block: 'center' });
  // exp.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
  scrollExpanderIntoViewCenteredAsync(exp);
}

// Ouvre un expander
function openExpander(expId){
  const exp = document.getElementById(expId);
  if (!exp) return;
  if (!exp.classList.contains('open')) {
    if (typeof openExp === 'function') openExp(exp);
    else exp.classList.add('open');
  }
}

function openExpanderAsync(id){
  const exp  = document.getElementById(id);
  if (!exp) return Promise.resolve();
  if (exp.classList.contains('open')) return Promise.resolve();

  return new Promise(resolve => {
    const pane = exp.querySelector('.st-expander-body');
    const onEnd = (ev) => {
      if (ev.propertyName !== 'height') return;
      pane.removeEventListener('transitionend', onEnd);
      resolve();
    };
    pane.addEventListener('transitionend', onEnd);
    openExp(exp); // ← ta fonction existante
  });
}

// Sélectionne + rend visible + retourne DOM de la ligne si possible
async function ensureRowVisibleAndGetEl(gridId, uuid) {
  const h = grids.get(gridId);
  if (!h) return { api:null, node:null, rowEl:null };

  const api = h.api;
  let node = null;
  api.forEachNode?.(n => { if (!node && n.data?.__uuid === uuid) node = n; });
  if (!node) return { api, node:null, rowEl:null };

  // sélection d’abord (feedback immédiat)
  node.setSelected?.(true, true);
  await nextPaint(1);
  api.ensureNodeVisible?.(node, 'middle');
  await nextPaint(1);

  // essaye de récupérer l’élément DOM
  const rowEl =
    h.el.querySelector(`.ag-row[row-id="${node.id}"]`) ||
    h.el.querySelector(`.ag-row[row-index="${node.rowIndex}"]`) ||
    h.el.querySelector(`.ag-row[aria-rowindex="${node.rowIndex+1}"]`) ||
    null;

  // si pas encore dans le DOM, re-ensure & repaint
  if (!rowEl) {
    api.ensureNodeVisible?.(node, 'middle');
    await nextPaint(2);
  }

  const rowEl2 =
    h.el.querySelector(`.ag-row[row-id="${node.id}"]`) ||
    h.el.querySelector(`.ag-row[row-index="${node.rowIndex}"]`) ||
    h.el.querySelector(`.ag-row[aria-rowindex="${node.rowIndex+1}"]`) ||
    null;

  return { api, node, rowEl: rowEl2 };
}

// Mini flash propre
function flashArrival(gridId, node) {
  const h = grids.get(gridId);
  if (!h || !node) return;
  const rowEl = h.el.querySelector(`.ag-row[aria-rowindex="${node.rowIndex+1}"]`)
             || h.el.querySelector(`.ag-row[row-index="${node.rowIndex}"]`);
  if (!rowEl) return;
  rowEl.classList.add('flash-arrival');
  setTimeout(()=> rowEl.classList.remove('flash-arrival'), 480);
}

// Ghost simple
function makeRowGhostFromRect(rect, label='') {
  if (!rect) return null;

  // const ghost = document.createElement('div');
  // ghost.className = 'row-flight';
  // ghost.style.left   = rect.left+'px';
  // ghost.style.top    = rect.top+'px';
  // ghost.style.width  = Math.max(rect.width, 260)+'px';
  // ghost.style.height = rect.height+'px';
  const w = Math.max(rect.width, 260);        // on élargit pour la lisibilité
  const h = rect.height;
  const cx = rect.left + rect.width / 2;      // centre X de la source
  const cy = rect.top  + rect.height / 2;     // centre Y de la source

  const ghost = document.createElement('div');
  ghost.className = 'row-flight';
  ghost.style.left   = (cx - w/2) + 'px';     // ← CENTRE !
  ghost.style.top    = (cy - h/2) + 'px';     // ← CENTRE !
  ghost.style.width  = w + 'px';
  ghost.style.height = h + 'px';

  const inner = document.createElement('div');
  inner.style.display='flex';
  inner.style.alignItems='center';
  inner.style.height='100%';
  inner.style.padding='4px 10px';
  inner.style.font='14px/1.2 system-ui,-apple-system,"Segoe UI",Roboto';
  inner.textContent = label;
  ghost.appendChild(inner);

  document.body.appendChild(ghost);
  return ghost;
}

// Ghost strictement identique à la source (pas d’élargissement, pas de padding)
function makeRowGhostExact(rect) {
  if (!rect) return null;
  const ghost = document.createElement('div');
  ghost.className = 'row-flight';
  ghost.style.left   = rect.left + 'px';
  ghost.style.top    = rect.top  + 'px';
  ghost.style.width  = rect.width + 'px';
  ghost.style.height = rect.height + 'px';

  // pas de padding ni texte (éviter biais visuel)
  document.body.appendChild(ghost);
  return ghost;
}

// Translation du fantome selon un arc
function animateGhostArc(ghost, fromRect, toRect, { duration=PHANTOM_DEFAULT_DURATION, lift=PHANTOM_DEFAULT_OFFSET }={}) {
  if (!ghost || !fromRect || !toRect) return Promise.resolve();
  const dx = (toRect.left+toRect.width/2)  - (fromRect.left+fromRect.width/2);
  const dy = (toRect.top +toRect.height/2) - (fromRect.top +fromRect.height/2);
  const short = Math.hypot(dx,dy) < 40;
  const L = short ? -200 : lift;
  return new Promise(res=>{
    ghost.animate(
      [
        { transform:'translate3d(0,0,0) scale(1)',          opacity:.96 },
        { transform:`translate3d(${dx*0.75}px,${dy*0.5+L}px,0) scale(1.02)`, opacity:.9 },
        { transform:`translate3d(${dx}px,${dy}px,0) scale(.9)`,             opacity:.15 },
      ],
      { duration, easing:'cubic-bezier(.22,.8,.2,1)', fill:'forwards' }
    ).onfinish = ()=>{ ghost.remove(); res(); };
  });
}

// Translation simple du phantome vers le coin haut-gauche de la destination
function animateGhostToTopLeft(ghost, fromRect, toRect, { duration=500 } = {}) {
  if (!ghost || !fromRect || !toRect) return Promise.resolve();
  const dx = toRect.left - fromRect.left;
  const dy = toRect.top  - fromRect.top;

  return new Promise(res => {
    const anim = ghost.animate(
      [
        { transform: 'translate3d(0,0,0)', opacity: .98 },
        { transform: `translate3d(${dx}px, ${dy}px, 0)`, opacity: .12 },
      ],
      { duration, easing: 'cubic-bezier(.25,.8,.25,1)', fill: 'forwards' }
    );
    anim.onfinish = () => { ghost.remove(); res(); };
    anim.oncancel = ()  => { ghost.remove(); res(); };
  });
}

// ===== Boutons d'expanders =====
function addExpanderButton({expanderId, id, title, innerHTML, onClick}) {
  const exp = document.getElementById(expanderId);
  if (!exp) return;
  const header = exp.querySelector('.st-expander-header');
  if (!header) return;

  // évite les doublons
  let actions = header.querySelector('.exp-header-actions');
  if (!actions) {
    actions = document.createElement('div');
    actions.className = 'exp-header-actions';
    header.appendChild(actions);
  }
  if (actions.querySelector('.' + id)) return;

  const btn = document.createElement('button');
  btn.id = id;
  btn.className = 'exp-header-btn ';// + id;
  btn.title = title;
  btn.innerHTML = innerHTML;

  btn.addEventListener('click', async (e) => {
    // stopPropagation : ne pas toggler l’expander
    e.stopPropagation();
    // flash visuel court
    btn.classList.add('clicked');
    setTimeout(() => btn.classList.remove('clicked'), 180);

    // callback métier (si fourni)
    try {
      await onClick?.();
    } catch (err) {
      console.error('Programmer action error:', err);
    }
  });

  // stopPropagation : ne pas toggler l’expander
  btn.addEventListener('mousedown', e => e.stopPropagation());
  btn.addEventListener('touchstart', e => e.stopPropagation(), { passive: true });

  actions.appendChild(btn);
}

function addExpanderButtons() {

  // Bouton Programmer
  addExpanderButton({
    expanderId: 'exp-programmables',
    id: 'btn-programmer',
    title: 'Programmer l’activité sélectionnée', 
    innerHTML: `
      <span class="exp-icon" aria-hidden="true">
        <!-- Icône calendrier fin, noir -->
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <rect x="3" y="4.5" width="18" height="16" rx="2" ry="2"></rect>
          <line x1="16" y1="3.5" x2="16" y2="7"></line>
          <line x1="8"  y1="3.5" x2="8"  y2="7"></line>
          <line x1="3"  y1="9"   x2="21" y2="9"></line>
          <!-- petit carré de date pour le look -->
          <rect x="7.5" y="12" width="4" height="3.8" rx="0.6" ry="0.6"></rect>
        </svg>
      </span>
      <span class="exp-label">Programmer</span>
    `,
    onClick: async () => {await doProgrammerActivite();}
  });

  // Bouton Déprogrammer
  addExpanderButton({
    expanderId: 'exp-programmees',
    id: 'btn-deprogrammer',
    title: 'Déprogrammer l’activité sélectionnée', 
    innerHTML: `
      <span class="exp-icon" aria-hidden="true">
        <!-- Icône poubelle stylisée, cohérente avec l'épaisseur et le style du calendrier -->
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none"
            stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
          <!-- couvercle -->
          <path d="M3 6h18" />
          <path d="M8 6l1-2h6l1 2" />
          <!-- corps -->
          <rect x="5" y="6" width="14" height="15" rx="2" ry="2" />
          <!-- poignées intérieures -->
          <line x1="10" y1="10" x2="10" y2="17" />
          <line x1="14" y1="10" x2="14" y2="17" />
        </svg>
      </span>
      <span class="exp-label">Déprogrammer</span>
    `,
    onClick: async () => {await doDeprogrammerActivite();}
  });
  
  // Bouton Coller
  // addExpanderButton({
  //   expanderId: 'exp-non-programmees',
  //   id: 'btn-coller',
  //   title: 'Ajouter une activité avec collage', 
  //   innerHTML: `
  //     <span class="exp-icon" aria-hidden="true">
  //       <!-- Icône poubelle stylisée, cohérente avec l'épaisseur et le style du calendrier -->
  //       <svg viewBox="0 0 24 24" width="18" height="18" fill="none"
  //           stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
  //         <path d="M4 4h7l3 3h6v13H4z"/>
  //         <path d="M9 14h6"/>
  //         <path d="M9 18h6"/>
  //       </svg>
  //     </span>
  //     <span class="exp-label">Coller</span>
  //   `,
  //   onClick: async () => {await doAjoutActiviteAvecCollage();}
  // });

  // Bouton Ajouter
  // addExpanderButton({
  //   expanderId: 'exp-non-programmees',
  //   id: 'btn-ajouter',
  //   title: 'Ajouter une activité', 
  //   innerHTML: `
  //     <span class="exp-icon" aria-hidden="true">
  //       <!-- Icône poubelle stylisée, cohérente avec l'épaisseur et le style du calendrier -->
  //       <svg viewBox="0 0 24 24" width="18" height="18" fill="none"
  //           stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
  //         <rect x="9" y="2" width="6" height="4" rx="1"/>
  //         <path d="M4 5h16v16H4z"/>
  //       </svg>
  //     </span>
  //     <span class="exp-label">Ajouter</span>
  //   `,
  //   onClick: async () => {await doAjoutActivite();}
  // });

  // Bouton Supprimer
  addExpanderButton({
    expanderId: 'exp-non-programmees',
    id: 'btn-supprimer',
    title: 'Supprimer l’activité sélectionnée', 
    innerHTML: `
      <span class="exp-icon" aria-hidden="true">
        <!-- Icône poubelle stylisée, cohérente avec l'épaisseur et le style du calendrier -->
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none"
            stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
          <!-- couvercle -->
          <path d="M3 6h18" />
          <path d="M8 6l1-2h6l1 2" />
          <!-- corps -->
          <rect x="5" y="6" width="14" height="15" rx="2" ry="2" />
          <!-- poignées intérieures -->
          <line x1="10" y1="10" x2="10" y2="17" />
          <line x1="14" y1="10" x2="14" y2="17" />
        </svg>
      </span>
      <span class="exp-label">Supprimer</span>
    `,
    onClick: async () => {await doSupprimerActivite();}
  });
  
}

// ===== Builders de colonnes de grilles =====
// Colonnes des grilles d'activités programmées et non programmées
function buildColumnsActivitesCommon(){
  let width = window.matchMedia("(max-width: 750px)").matches ? 60 : 90;
  return [
    { field:'Date', headerName:'Date', width, suppressSizeToFit:true,
      valueFormatter:p=>dateintToPretty(p.value),
      valueParser:p=>prettyToDateint(p.newValue) ?? p.oldValue ?? null,
      comparator:(a,b)=>(safeDateint(a)||0)-(safeDateint(b)||0)
    },
    { field:'Debut', headerName: 'Début', width, suppressSizeToFit:true, valueParser: valueParserHeure,
      comparator:(a,b)=>{
        const ma=parseHHhMM(a)??Infinity, mb=parseHHhMM(b)??Infinity;
        return ma-mb;
      }
    },
    { field:'Activite', headerName: 'Activité', minWidth:200, flex:1, cellRenderer: ActiviteRenderer },
    { field:'Duree', headerName: 'Durée', width, suppressSizeToFit:true, valueParser: valueParserDuree },
    { field:'Fin',   width, suppressSizeToFit:true, editable: false, valueParser: valueParserHeure },
    { field:'Lieu',  minWidth:160, flex:1, cellRenderer: LieuRenderer },
    { field:'Relache', headerName: 'Relâche', minWidth:60, flex:.5, valueParser: valueParserRelache },
    { field:'Reserve', headerName: 'Réservé', minWidth:60, flex:.5, valueParser: valueParserReserve },
    { field:'Priorite', headerName: 'Priorité',minWidth:60, flex:.5, valueParser: valueParserNumerique },
    { field:'Hyperlien', minWidth:120, flex:2 }
  ];
}

function buildColumnsActivitesProgrammees() {
  const cols = buildColumnsActivitesCommon();
  let iDate = cols.findIndex(c => c.field === 'Date');
  let iDebut = cols.findIndex(c => c.field === 'Debut');
  let iDuree = cols.findIndex(c => c.field === 'Duree');
  let iReserve = cols.findIndex(c => c.field === 'Reserve');

  cols[iDate] = {
    ...cols[iDate],
    editable: true,
    valueFormatter: p => dateintToPretty(p.value),
    valueParser: p => prettyToDateint(p.newValue) ?? p.oldValue ?? null,
    cellEditor: 'agSelectCellEditor',
    cellEditorPopup: true,
    popupParent: document.body,
    cellEditorParams: (p) => {
      const values = activitesAPI.getOptionsDateForActiviteProgrammee(p.data) || [];
      return { values: values.map(String), valueListMaxHeight: 300 };   // 👈 must be an array
    },
    onCellValueChanged: onProgGridDateCommitted,
  };

  cols[iDebut] = {
    ...cols[iDebut] ,
    editable: (p) => !activitesAPI.estActiviteReservee(p.data),
  };

  cols[iDuree] = {
    ...cols[iDuree] ,
    editable: (p) => !activitesAPI.estActiviteReservee(p.data),
  };

  cols[iReserve] = {
    ...cols[iReserve] ,
    onCellValueChanged: (p) => {
      onCellValueChangedCommon(p);
      const btn = document.getElementById('btn-deprogrammer');
      btn.disabled = activitesAPI.estActiviteReservee(p.data);
    },
  };

  return cols
}

function buildColumnsActivitesNonProgrammees() {
  const cols = buildColumnsActivitesCommon();
  let iDate = cols.findIndex(c => c.field === 'Date');

  cols[iDate] = {
    ...cols[0],
    editable: true,
    valueFormatter: p => dateintToPretty(p.value),
    valueParser: p => prettyToDateint(p.newValue) ?? p.oldValue ?? null,
    cellEditor: 'agSelectCellEditor',
    cellEditorParams: (p) => {
      const values = activitesAPI.getOptionsDateForActiviteNonProgrammee(p.data) || [];
      return { values: values.map(String) };   // 👈 must be an array
    },
    onCellValueChanged: onNonProgGridDateCommitted,
  };

  return cols
}

function buildColumnsCreneaux(){
  let width = window.matchMedia("(max-width: 750px)").matches ? 60 : 90;
  return [
    { field:'Date', headerName:'Date', width, suppressSizeToFit:true, editable:false,
      valueFormatter:p=>dateintStrToPretty(p.value), // Dans ActivitesProgrammables Date est en string et non en dateint
      comparator:(a,b)=>(safeDateint(a)||0)-(safeDateint(b)||0)
    },
    { field:'Début', width, suppressSizeToFit:true, editable:false,
      comparator:(a,b)=>{
        const ma=parseHHhMM(a)??Infinity, mb=parseHHhMM(b)??Infinity;
        return ma-mb;
      }
    },
    { field:'Fin', width, suppressSizeToFit:true, editable:false,
      comparator:(a,b)=>{
        const ma=parseHHhMM(a)??Infinity, mb=parseHHhMM(b)??Infinity;
        return ma-mb;
      }
    },
    { field:'Activité avant', headerName:'Activité avant', minWidth:160, flex:1, editable:false,},
    { field:'Activité après', headerName:'Activité après', minWidth:160, flex:1, editable:false,},
  ];
}

function buildColumnsActivitesProgrammables() {
  // récupère la définition standard
  const cols = buildColumnsActivitesCommon();
  let iDate = cols.findIndex(c => c.field === 'Date');
  
  // Dans ActivitesProgrammables Date est en string et non en dateint
  cols[iDate].valueFormatter = p=>dateintStrToPretty(p.value);  
  cols[iDate].cellStyle = {
    fontStyle: 'italic',
    color: '#777'       // gris moyen
  }
  
  // force toutes les colonnes non éditables
  return cols.map(col => ({
    ...col,
    editable: false
  }));
}

// function buildColumnsCarnet(){
//   return [
//     { field:'Nom', headerName:'Nom', minWidth:180, flex:1, editable:true },
//     { field:'Adresse', minWidth:160, flex:1, editable:true },
//     { field:'Tel', minWidth:200, flex:1, editable:true },
//     { field:'Web', minWidth:140, editable:true },
//   ];
// }

// ===== Parsers de grilles =====
function valueParserHeure(params) {
  if (!activitesAPI.estHeureValide(params.newValue)) {
    alert("⛔ Format attendu : HHhMM (ex : 10h00)");
    return params.oldValue;
  }
  else return params.newValue;
}
function valueParserDuree (params) {
  if (!activitesAPI.estDureeValide(params.newValue)) {
    alert("⛔ Format attendu : HhMM (ex : 1h00 ou 0h30)");
    return params.oldValue;
  }
  else return params.newValue;
}
function valueParserRelache (params) {
  if (!activitesAPI.estRelacheValide(params.newValue)) {
    alert("⛔ Format attendu : voir Aide / Format des données");
    return params.oldValue;
  }
  else return params.newValue;
}
function valueParserReserve (params) {
  if (!activitesAPI.estReserveValide(params.newValue)) {
    alert("⛔ Format attendu : Oui, Non");
    return params.oldValue;
  }
  else return capitalizeFirst(params.newValue);
}
function valueParserNumerique (params) {
  if (!estNumerique(params.newValue)) {
    alert("⛔ Format numérique attendu");
    return params.oldValue;
  }
  else return params.newValue;
}

// ===== Options de grilles =====
function onCellValueChangedCommon(p) {
  if (p.colDef.field == "Date") return;
  const uuid = p.node.id;
  let df = ctx.getDf().slice(); 
  const idx = df.findIndex(r => r.__uuid === uuid);
  if (idx < 0) return;
  df[idx] = { ...df[idx], ...p.data }; 
  df = sortDf(df);
  ctx.setDf(df);        
}

function gridOptionsCommon(gridId, el) {
  return {
    context: { gridId },                 
    defaultColDef: { editable: true, resizable: true, sortable: true, filter: true },
    rowData: [],
    getRowId: p => p.data?.__uuid,
    onGridReady: async (p) => {
      await refreshGrid(gridId);
      safeSizeToFitFor(gridId);
      const root = el.querySelector('.ag-root') || el;
      enableTouchEdit(p.api, root, {debug: false /*, forceTouch: true*/});
    },
    onModelUpdated: (ev) => {
      const g = grids.get(gridId);
      const pane = g?.el?.closest('.st-expander-body');
      if (pane && g) autosizeFromGridSafe(g, pane); // ne fait rien si cnt <= 0
    },
    onFirstDataRendered: (ev) => {
      const g = grids.get(gridId);
      const pane = g?.el?.closest('.st-expander-body');
      if (pane && g) autosizeFromGridSafe(g, pane);
    },
    onCellFocused: () => setActiveGrid(gridId),
    onGridSizeChanged: () => safeSizeToFitFor(gridId),
    getRowStyle: p => {
      const bg = colorDate(p.data?.Date);
      const c = activitesAPI.estActiviteReservee(p.data) ? 'red' : 'black';
      return { '--day-bg': bg, 'color': c };
    },
    onCellValueChanged: (p) => onCellValueChangedCommon(p),
    rowSelection: 'single',
    suppressDragLeaveHidesColumns: true,
    suppressMovableColumns: false,
    singleClickEdit: false,
    suppressClickEdit: false,
    stopEditingWhenCellsLoseFocus: true,
    onCellKeyDown: (p) => {
      // bonus: Enter déclenche l’édition (utile sur desktop)
      if (p.event?.key === 'Enter' && p.colDef?.editable) {
        p.api.startEditingCell({ rowIndex: p.rowIndex, colKey: p.colDef.field });
        p.event.preventDefault?.();
      }
    },
    suppressNoRowsOverlay: true,
    suppressRowClickSelection: false,
  }
};

const gridOptionsActivitesProgrammees = {
  rowSelection: 'single',
  onSelectionChanged(params) {
    const sel = params.api.getSelectedRows();
    const btn = document.getElementById('btn-deprogrammer');
    btn.disabled = (sel.length > 0) ? activitesAPI.estActiviteReservee(sel[0]) : true;
  },
}

const gridOptionsActivitesNonProgrammees = {
  getRowStyle: p => {
    const bg = colorActiviteProgrammable(p.data);
    return bg ? { '--day-bg': bg } : {};
  },
  onSelectionChanged: (p) => {
    const hasSel = !!p.api.getSelectedRows()?.length;
    document.getElementById('btn-supprimer')?.toggleAttribute('disabled', !hasSel);
  },
}

const gridOptionsCreneaux = {
  onSelectionChanged: () => onCreneauxSelectionChanged(),
}

const gridOptionsActivitesProgrammables = {
  onSelectionChanged: (p) => {
    const hasSel = !!p.api.getSelectedRows()?.length;
    document.getElementById('btn-programmer')?.toggleAttribute('disabled', !hasSel);
  },
}

// ===== Loaders de grilles =====

// Activités Programmées : Date non nulle
async function loadGridActivitesProgrammees(){
  const activites = ctx.df;                      
  // Two-level shallow copy OBLIGATOIRE sinon AgGrid écrit directement dans les tableaux de ctx => catastrophe !!
  return activitesAPI.getActivitesProgrammees(activites).map(r => ({...r}));
}

async function loadGridAtivitesNonProgrammees(){
  const activites = ctx.df;                      
  // Two-level shallow copy OBLIGATOIRE sinon AgGrid écrit directement dans les tableaux de ctx => catastrophe !!
  return activitesAPI.getActivitesNonProgrammees(activites).map(r => ({...r}));
}

async function loadGridCreneaux() {
  const activites = ctx.df;                      
  const activitesProgrammees = activitesAPI.getActivitesProgrammees(activites);
  const periodeProgrammation = activitesAPI.getPeriodeProgrammation(activites)
  // Two-level shallow copy OBLIGATOIRE sinon AgGrid écrit directement dans les tableaux de ctx => catastrophe !!
  return activitesAPI.getCreneaux(activites, activitesProgrammees, false, periodeProgrammation).map(r => ({...r}));
}

async function loadGridActivitesProgrammables(){
  if (!selectedSlot) return [];
  const activites = ctx.df;                      
  // Two-level shallow copy OBLIGATOIRE sinon AgGrid écrit directement dans les tableaux de ctx => catastrophe !!
  return activitesAPI.getActivitesProgrammables(activites, selectedSlot).map(r => ({...r}));
}

// async function loadGridCarnet() {
//   const carnet = ctx.carnet;
//   // Two-level shallow copy OBLIGATOIRE sinon AgGrid écrit directement dans les tableaux de ctx => catastrophe !!
//   return carnet.map(r => ({...r}));
// }


// ===== Handlers de grilles =====

async function dropRowFromSrcGridToDstGrid(srcGrid, dstExp, dstGrid, srcUuid, dstUuid) {

  // 1) sélectionne le voisin dans la source (pas besoin de center ici)
  selectRowByUuid(srcGrid, srcUuid, { ensure: null, flash: null });

  // 2) ouvre l’expander cible et scrolle jusqu’à lui
  await openExpanderAsync(dstExp);
  await scrollExpanderIntoViewCenteredAsync(document.getElementById(dstExp), { duration: 400 });

  // 3) sélectionne la ligne cible dans la grille destination
  selectRowByUuid(dstGrid, dstUuid, { ensure: null, flash: false });

  // 4) centre VRAIMENT la ligne dans la grille et récupère son élément DOM
  const { rowEl } = await ensureRowVisibleAndGetEl(dstGrid, dstUuid, { ensure: 'center' });
  await waitAF(); // laisse le layout se stabiliser

  // 5) lance le phantom flight vers l’élément centré
  doPhantomFlight(srcGrid, dstGrid, rowEl); // adapte si ta signature prend (fromId, toId, targetEl)
}


// Quand on édite la date d'une activité programmée
async function onProgGridDateCommitted(params) {
  if (params.colDef.field !== 'Date') return;
  if (prettyToDateint(params.newValue) === params.oldValue) return;

  const uuid = params.node.id;
  if (!uuid) return;

  // Si params.newValue == "" il faudra écrire null dans le champ Date pour déclencher une déprogrammation
  // sinon prettyToDateint(params.newValue) pour reprogrammer ou oldValue ou null
  let di = null;
  if (params.newValue != "") di = prettyToDateint(params.newValue) ?? params.oldValue ?? null; // ← écriture

  // Récupération de l'uuid de la ligne voisine
  const gridRows = []; params.api.forEachNode(node => gridRows.push(node.data));
  const uuidVoisin = getLigneVoisineUuid(gridRows, uuid);

  // Commit dans contexte ctx
  let df = ctx.getDf().slice(); 
  const idx = df.findIndex(r => r.__uuid === uuid);
  if (idx < 0) return rows;
  df[idx] = { ...df[idx], ...params.data }; df[idx].Date = di; 
  df = sortDf(df);
  ctx.setDf(df);        

  // Si drop dans une autre grille: 
  // - sélectionne la ligne voisine dans la grille de départ
  // - ouvre l’expander de la grille de destination et sélectionne la ligne
  if (params.newValue == "") {
    // setTimeout(() => {
    //   selectRowByUuid('grid-programmees', uuidVoisin, { ensure: 'center', flash: null });
    //   scrollToExpander?.('exp-non-programmees');
    //   openExpander?.('exp-non-programmees');
    //   selectRowByUuid('grid-non-programmees', uuid, { ensure: 'center', flash: true });
    //   doPhantomFlight("grid-programmees", "grid-non-programmees", "exp-non-programmees");
    // }, 50);
    dropRowFromSrcGridToDstGrid('grid-programmees', 'exp-non-programmees', 'grid-non-programmees', uuidVoisin, uuid);
  }
  else {
    await ensureRowVisibleAndGetEl("grid-programmees", uuid);
  }
}

async function onNonProgGridDateCommitted(params) {
  if (params.colDef.field !== 'Date') return;
  if (prettyToDateint(params.newValue) === params.oldValue) return;

  const uuid = params.node.id;
  if (!uuid) return;

  // Il faudra écrire dans le champ Date prettyToDateint(params.newValue) pour programmer ou oldValue ou null
  const di = prettyToDateint(params.newValue) ?? params.oldValue ?? null; // ← écriture
  
  // Récupération de l'uuid de la ligne voisine
  const gridRows = []; params.api.forEachNode(node => gridRows.push(node.data));
  const uuidVoisin = getLigneVoisineUuid(gridRows, uuid);

  // Commit dans contexte ctx
  let df = ctx.getDf().slice(); 
  const idx = df.findIndex(r => r.__uuid === uuid);
  if (idx < 0) return rows;
  df[idx] = { ...df[idx], ...params.data }; df[idx].Date = di; 
  df = sortDf(df);
  ctx.setDf(df);        

  // Si drop dans une autre grille: 
  // - sélectionne la ligne voisine dans la grille de départ
  // - ouvre l’expander de la grille de destination et sélectionne la 
  
  // if (params.newValue != "" && params.newValue) {
  //   setTimeout(() => {
  //     selectRowByUuid('grid-non-programmees', uuidVoisin, { ensure: 'center', flash: null });
  //     scrollToExpander?.('exp-programmees');
  //     openExpander?.('exp-programmees');
  //     selectRowByUuid('grid-programmees', uuid, { ensure: 'center', flash: true });
  //     doPhantomFlight("grid-non-programmees", "grid-programmees", "exp-programmees");
  //   }, 50);
  // }

  // (async () => {
  //   const srcGrid = 'grid-non-programmees';
  //   const dstExp  = 'exp-programmees';
  //   const dstGrid = 'grid-programmees';

  //   // 1) sélectionne le voisin dans la source (pas besoin de center ici)
  //   selectRowByUuid(srcGrid, uuidVoisin, { ensure: null, flash: null });

  //   // 2) ouvre l’expander cible et scrolle jusqu’à lui
  //   await openExpanderAsync(dstExp);
  //   await scrollExpanderIntoViewCenteredAsync(document.getElementById(dstExp), { duration: 400 });

  //   // 3) sélectionne la ligne cible dans la grille destination
  //   selectRowByUuid(dstGrid, uuid, { ensure: null, flash: false });

  //   // 4) centre VRAIMENT la ligne dans la grille et récupère son élément DOM
  //   const { rowEl } = await ensureRowVisibleAndGetEl(dstGrid, uuid, { ensure: 'center' });
  //   await waitAF(); // laisse le layout se stabiliser

  //   // 5) lance le phantom flight vers l’élément centré
  //   doPhantomFlight(srcGrid, dstGrid, rowEl); // adapte si ta signature prend (fromId, toId, targetEl)
  // })();
  dropRowFromSrcGridToDstGrid('grid-non-programmees', 'exp-programmees', 'grid-programmees', uuidVoisin, uuid);
}

function onCreneauxSelectionChanged(){
  const g = grids.get('grid-creneaux');
  if (!g?.api) return;
  const sel = g.api.getSelectedRows?.() || [];
  selectedSlot = sel[0] || null;

  // rafraîchir la grille 4 (programmables)
  refreshGrid('grid-programmables');
}

// function autoOpenSelectOnEdit(api) {
//   api.addEventListener('cellEditingStarted', (e) => {
//     const isRich = e.colDef.cellEditor === 'agRichSelectCellEditor';
//     const isSel  = e.colDef.cellEditor === 'agSelectCellEditor';
//     if (!isRich && !isSel) return;

//     // Laisse AG Grid instancier l’éditeur, puis ouvre la liste
//     setTimeout(() => {
//       const [ed] = e.api.getCellEditorInstances({
//         rowIndex: e.rowIndex,
//         column: e.column
//       }) || [];
//       if (!ed) return;

//       const el = ed.getGui?.() || null;

//       // 1) Tenter une touche ↓ (ouvre la liste dans AG Grid)
//       if (el) {
//         const ev = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true });
//         el.dispatchEvent(ev);
//       }

//       // 2) Fallback : “cliquer” sur l’icône du picker (rich/select)
//       const btn = el?.querySelector?.('.ag-picker-field-icon, .ag-rich-select .ag-picker-field-icon');
//       if (btn) {
//         // petit délai utile sur iOS
//         setTimeout(() => btn.dispatchEvent(new MouseEvent('click', { bubbles: true })), 20);
//       }
//     }, 30);
//   });
// }
function autoOpenSelectOnEdit(api){
  api.addEventListener('cellEditingStarted', (e) => {
    const isRich = e.colDef.cellEditor === 'agRichSelectCellEditor';
    if (!isRich) return;

    setTimeout(() => {
      const [ed] = e.api.getCellEditorInstances({ rowIndex:e.rowIndex, column:e.column }) || [];
      const el = ed?.getGui?.();
      if (!el) return;

      // Tenter “↓” (AG Grid ouvre la liste)
      el.dispatchEvent(new KeyboardEvent('keydown', { key:'ArrowDown', bubbles:true }));

      // Fallback : cliquer sur l’icône du picker
      const btn = el.querySelector?.('.ag-picker-field-icon');
      if (btn) setTimeout(() => btn.dispatchEvent(new MouseEvent('click', { bubbles:true })), 16);
    }, 30);
  });
}

// ===== Contrôleur de grille =====
function createGridController({ gridId, elementId, loader, columnsBuilder, optionsPatch = {}}) {
  if (grids.has(gridId)) return grids.get(gridId);
  const el = $(elementId);
  if (!el) return null;

 // colonnes propres à la grille
  const columnDefs = columnsBuilder?.() || [];

  //merge superficiel : base + overrides + champs calculés
  const common = gridOptionsCommon(gridId, el);
  const gridOptions = {
    ...common,
    ...optionsPatch,
    columnDefs,
    // on garde le context pour identifier la grille dans les callbacks
    context: { ...(common.context || {}), ...(optionsPatch.context || {}), gridId },
  };

  const api = window.agGrid.createGrid(el, gridOptions);
  autoOpenSelectOnEdit(api);
  el.__agApi = api; // ⟵ pour retrouver l’API depuis le pane
  const handle = { id: gridId, el, api, loader, columnsBuilder };
  grids.set(gridId, handle);
  if (!activeGridId) setActiveGrid(gridId);
  return handle;
}

// Rend active une grille donnée
function setActiveGrid(gridId){
  activeGridId = gridId;
  grids.forEach(g => g?.el?.classList.toggle('is-active-grid', g.id === gridId));
}

// Rafraichit une grille
async function refreshGrid(gridId) {
  const h = grids.get(gridId);
  if (!h) return;

  if (DEBUG) console.log(`RefreshGrid ${gridId}`);

  const api = h.api;

  // 0) mémorise la sélection actuelle (par __uuid)
  let prevUuid = null;
  try {
    const prevSel = api.getSelectedRows?.() || [];
    prevUuid = prevSel[0]?.__uuid ?? null;
  } catch {}

  // 1) recharge les données
  const rows = await h.loader?.();
  api.setGridOption?.('rowData', rows || []);

  // 2) après peinture → reselect ou fallback 1ère ligne, puis resize + autosize pane
  const finish = () => {
    // repaint + grid size (AG Grid v29+)
    api.refreshCells?.({ force: true });

    //--------------- DEBUG ---------------
    if (gridId == 'grid-non-programmees') {
      api.redrawRows();  // ré-évalue getRowStyle
      // api.forEachNode(n => {
      //   const bg = colorActiviteProgrammable(n.data);
      //   n.setRowStyle(bg ? { '--day-bg': bg } : null);      
      // })
      // api.forEachNode(node => {
      //   const bg = colorActiviteProgrammable(node.data);
      //   const rowEl = node?.rowIndex != null
      //     ? document.querySelector(`.ag-row[aria-rowindex="${node.rowIndex + 1}"]`)
      //     : null;
      //   if (rowEl) {
      //     if (bg) rowEl.style.setProperty('--day-bg', bg);
      //     else rowEl.style.removeProperty('--day-bg');
      //   }
      // });
    }
    //--------------- DEBUG ---------------

    api.dispatchEvent?.({ type: 'gridSizeChanged' });

    // auto-taille pane (uniquement si ouvert ou mémorisation si fermé)
    const pane = h.el.closest('.st-expander-body');
    autoSizePanelFromRowCount(pane, h.el, api, { nbRows:rows.length});
  };

  const selectAfterPaint = () => {
    // si déjà sélectionné (préservé via getRowId) -> ne rien faire
    const already = api.getSelectedNodes?.();
    if (already && already.length > 0) return finish();

    let node = null;

    // essaie de reselectionner l'ancienne ligne par __uuid
    if (prevUuid) {
      api.forEachNode?.(n => { if (!node && n.data?.__uuid === prevUuid) node = n; });
    }

    // fallback : sélectionner la 1ʳᵉ ligne si aucune
    if (!node) {
      const count = api.getDisplayedRowCount?.() ?? 0;
      if (count > 0) node = api.getDisplayedRowAtIndex?.(0) || null;
    }

    node?.setSelected?.(true, true); // (select, clearOther)
    finish();
  };

  // laisse AG Grid peindre les nouvelles rows
  requestAnimationFrame(() => requestAnimationFrame(selectAfterPaint));
}

// Rafraichit toutes les grilles
async function refreshAllGrids() {
  const ids = Array.from(grids.keys());
  await Promise.all(ids.map(id => refreshGrid(id)));
}

// Rafraichit toutes les grilles d'activités (utilisé par la callback de modification de contexte ctx.onChange sur df)
async function refreshActivitesGrids() {
  refreshGrid('grid-programmees');
  refreshGrid('grid-creneaux');
  refreshGrid('grid-non-programmees');
  // refreshGrid('grid-programmables'); => Pas celle-là car elle se redessine automatiquement du fait de la callback onSelectionChanged sur la grille des créneaux disponibles
}

// Rafraichit la grille du carnet d'adresses (utilisé par la callback de modification de contexte ctx.onChange sur carnet)
// async function refreshCarnetGrid() {
//   refreshGrid('grid-carnet');
// }

// Coalessance évitant les rafraîchissements multiples dans la même frame dus à des mutations multiples de contexte dans une fonction 
// (à utiliser éventuellement dans les onChange de AppContext à la place de refreshAllGrids)
let refreshPending = false;
async function scheduleGlobalRefresh() {
  if (refreshPending) return;
  refreshPending = true;
  requestAnimationFrame(async () => {
    refreshPending = false;
    await refreshAllGrids();
  });
}

// ===== Wiring des grilles =====
let isSplitterDragging = false; // pour geler les recalculs ailleurs
function isFromGrid(e){ return !!e.target?.closest('.ag-root'); }

function wireExpanderSplitters() {
  document.querySelectorAll('.v-splitter').forEach(sp => {
    const handle = sp.querySelector('.v-splitter__handle') || sp;

    const topId = sp.getAttribute('data-top');
    const bottomId = sp.getAttribute('data-bottom');
    const paneTop = document.querySelector(`#${topId} .st-expander-body`);
    const paneBot = document.querySelector(`#${bottomId} .st-expander-body`);
    if (!paneTop || !paneBot) return;

    let dragging = false, startY = 0, hTop = 0, dyMin = 0, dyMax = 0;
    let prevTransition = '', prevAnimation = '';

    const setH = (pane, px) => pane.style.setProperty('height', `${Math.max(0, Math.round(px))}px`, 'important');

    function begin(clientY, e) {
      const expTop = paneTop.closest('.st-expander');
      if (!expTop || !expTop.classList.contains('open')) return;  // 🔒

      dragging = true;
      startY = clientY;

      // hauteur actuelle du pane du haut
      hTop = Math.round(paneTop.getBoundingClientRect().height);

      // limite haute : on peut tout cacher (header compris)
      dyMin = -hTop;

      // limite basse : contenu (nb rows) ou 1.5 si vide
      const maxH = calcMaxHForPane(paneTop);
      // const maxH = Number(paneTop.dataset.maxContentHeight) || hTop; // ← toutes lignes
      dyMax = Math.max(0, Math.round(maxH - hTop));

      // couper toute animation pendant le drag (inline + important)
      prevTransition = paneTop.style.transition || '';
      prevAnimation  = paneTop.style.animation  || '';
      paneTop.style.setProperty('transition', 'none', 'important');
      paneTop.style.setProperty('animation',  'none', 'important');
      paneTop.style.willChange = 'height';

      // verrou visuel
      setH(paneTop, hTop);
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'row-resize';

      // ⚠️ surtout PAS de preventDefault ici (laisser naître le tap→click iOS)
      // e?.preventDefault?.();
    }

    function update(clientY, e) {
      if (!dragging) return;

      const dyRaw = clientY - startY;
      const dy = Math.max(dyMin, Math.min(dyMax, dyRaw)); // clamp
      setH(paneTop, hTop + dy);

      // notifier la grille du haut pour recalcul
      try {
        const gridDiv = paneTop.querySelector('div[id^="grid"]');
        for (const g of (window.grids?.values?.() || [])) {
          if (g.el === gridDiv) { g.api.onGridSizeChanged(); break; }
        }
      } catch {}

      // ❌ ne pas faire preventDefault ici non plus
      // e?.preventDefault?.();
    }

    let minH = 0, maxH = 0;

    function finish() {
      if (!dragging) return;
      dragging = false;

      // restaurer animations
      paneTop.style.removeProperty('transition');
      paneTop.style.removeProperty('animation');
      if (prevTransition) paneTop.style.transition = prevTransition;
      if (prevAnimation)  paneTop.style.animation  = prevAnimation;
      paneTop.style.willChange = '';

      // mémoriser la hauteur
      const expTop = paneTop.closest('.st-expander');
      if (expTop) {
        const h = Math.round(paneTop.getBoundingClientRect().height);
        if (h > 0) localStorage.setItem(`paneHeight:${expTop.id}`, String(h));
      }

      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    }

    handle.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      // if (isFromGrid(e)) return; // pas nécessaire ici, la cible = poignée
      begin(e.clientY, e);
    });

    window.addEventListener('mousemove', e => {
      if (!dragging) return;                 // 👈 clé: rien si pas en drag
      update(e.clientY, e);
      // pas de preventDefault ici (souris)
    });

    window.addEventListener('mouseup', finish);

    // Tactile (splitter)
    handle.addEventListener('touchstart', (e) => {
      // pas de preventDefault ici
      begin(e.touches[0].clientY, e);     // doit mettre dragging=true
    }, { passive: true });

    window.addEventListener('touchmove', (e) => {
      if (!dragging) return;              // rien si pas en drag
      e.preventDefault();                 // ✅ seulement pendant le drag → bloque le scroll
      update(e.touches[0].clientY, e);
    }, { passive: false });

    window.addEventListener('touchend', () => {
      finish();                           // doit mettre dragging=false
    }, { passive: true });
  });
}

function wireGrids() {
  // 1) Activités Programmées
  createGridController({
    gridId: 'grid-programmees',
    elementId: 'gridA',
    loader: loadGridActivitesProgrammees,
    columnsBuilder: buildColumnsActivitesProgrammees,
    optionsPatch: gridOptionsActivitesProgrammees,
  });

  // 3) Créneaux disponibles
  createGridController({
    gridId: 'grid-creneaux',
    elementId: 'gridC',
    loader: loadGridCreneaux,
    columnsBuilder: buildColumnsCreneaux,
    optionsPatch: gridOptionsCreneaux,
  });

  // 4) Activités programmables 
  createGridController({
    gridId: 'grid-programmables',
    elementId: 'gridD',
    loader: loadGridActivitesProgrammables,
    columnsBuilder: buildColumnsActivitesProgrammables,
    optionsPatch: gridOptionsActivitesProgrammables,
  });

  // 2) Activités non programmées
  createGridController({
    gridId: 'grid-non-programmees',
    elementId: 'gridB',
    loader: loadGridAtivitesNonProgrammees,
    columnsBuilder: buildColumnsActivitesNonProgrammees,
    optionsPatch: gridOptionsActivitesNonProgrammees,
  });

  // 5) Carnet d’adresses
  // createGridController({
  //   gridId: 'grid-carnet',
  //   elementId: 'gridE',
  //   loader: loadGridCarnet,
  //   columnsBuilder: buildColumnsCarnet,
  // });

}

function wireExpanders(){
  document.querySelectorAll('.st-expander').forEach((exp) => {
    const header = exp.querySelector('.st-expander-header');
    const body   = exp.querySelector('.st-expander-body');
    if (!header || !body) return;

    // accessibilité : le header devient un bouton
    header.setAttribute('role', 'button');
    header.tabIndex = 0;

    const isAction = (e) => !!e.target.closest('.exp-actions, .exp-btn');

    const toggle = () => {
      const open = !exp.classList.contains('open');
      if (open) openExp(exp);
      else closeExp(exp);
      header.setAttribute('aria-expanded', String(open));
    };

    // clic : ne toggle pas quand on clique dans la zone d’icônes
    header.addEventListener('click', (e) => {
      // ⛔️ ne pas toggler si clic dans la zone actions ou éléments marqués
      if (e.target.closest('.header-actions,[data-no-toggle]')) return;

      if (isAction(e)) return;
      toggle();
    });

    // clavier : Enter / Espace
    header.addEventListener('keydown', (e) => {
      if (isAction(e)) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggle();
      }
    });

    // tactile : pas de preventDefault -> laisse iOS générer le "click"
    header.addEventListener('touchstart', (e) => {
      if (isAction(e)) return;
      // rien ici (pas de preventDefault)
    }, { passive: true });

    // démarrage ouvert (avec ton easing existant)
    openExp(exp);
    header.setAttribute('aria-expanded', 'true');
  });
}

// ------- Actions -------

// Reset du contexte
async function doNouveauContexte() {
  ctx.beginAction('Nouveau contexte');
  try {
  ctx.setDf([]);
  ctx.setCarnet([]);
  } finally {
    ctx.endAction();
  }
  activitesAPI.initPeriodeProgrammation(ctx.getDf());
}

// Import Excel
async function doImportExcel() {
  // déclenche l’input caché
  const fi = $('fileInput');
  if (fi) fi.click();
}

// Export Excel
async function doExportExcel() {
  try {
    const rows = ctx.df;
    // copie “pretty” pour Excel
    const pretty = (rows || []).map(r => ({
      ...r,
      Date: dateintToPretty(r.Date),
    }));
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(pretty);

    // repérer la colonne "Activité" (ligne d'entête)
    const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
    let colActivite = null;
    for (let c = range.s.c; c <= range.e.c; c++) {
      const addr = XLSX.utils.encode_cell({ r: range.s.r, c });
      const v = ws[addr]?.v;
      if (String(v).trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'') === 'activite') {
        colActivite = c;
        break;
      }
    }

    if (colActivite != null) {
      // pour chaque data row, si Hyperlien présent -> pose un lien sur la cellule Activité
      for (let i = 0; i < (rows?.length || 0); i++) {
        const r = range.s.r + 1 + i; // 1-based après entête
        const addr = XLSX.utils.encode_cell({ r, c: colActivite });
        const cell = ws[addr] || (ws[addr] = { t: 's', v: rows[i]?.Activité || '' });
        const url  = rows[i]?.Hyperlien;
        if (url) {
          cell.l = { Target: String(url) };
        }
      }
    }

    XLSX.utils.book_append_sheet(wb, ws, 'data');
    XLSX.writeFile(wb, 'planning.xlsx');
  } catch (e) {
    console.error(e);
    alert('❌ Export KO');
  }
}

// Undo
async function doUndo() {
  try { await ctx.undo('df'); } catch {};
}

// Redo
async function doRedo() {
  try { await ctx.redo(); } catch {};
}

// Ajout activité
async function doAjoutActivite() {
  const nouvelleActivite = await activitesAPI.creerActivite(ctx.df);
  ctx.mutateDf(rows => sortDf([nouvelleActivite, ...rows]));

  // Maj des sélections
  setTimeout(() => {
    scrollToExpander?.('exp-non-programmees');
    openExpander?.('exp-non-programmees');
    selectRowByUuid('grid-non-programmees', nouvelleActivite.__uuid, { ensure: 'center', flash: null });
  }, 50);
}

// Ajout activité avec collage
async function doAjoutActiviteAvecCollage() {
  const nouvelleActivite = await activitesAPI.creerActiviteAvecCollage(ctx.df);
  ctx.mutateDf(rows => sortDf([nouvelleActivite, ...rows]));

  // Maj des sélections
  setTimeout(() => {
    scrollToExpander?.('exp-non-programmees');
    openExpander?.('exp-non-programmees');
    selectRowByUuid('grid-non-programmees', nouvelleActivite.__uuid, { ensure: 'center', flash: null });
  }, 50);
}

// Suppression d'une activité
async function doSupprimerActivite() {
  const row = getSelectedRow('grid-non-programmees');
  if (!row) return;
  const uuid = row.__uuid;
  const uuidVoisin = getLigneVoisineUuid(getRowsFromGridId('grid-non-programmees'), uuid);

  ctx.dfRemove(row.__uuid);
  
  // Maj des sélections
  setTimeout(() => {
    selectRowByUuid('grid-non-programmees', uuidVoisin, { ensure: 'center', flash: null });
  }, 50);
}

// Déprogrammation d'une activité programmée
async function doDeprogrammerActivite() {
  const row = getSelectedRow('grid-programmees');
  if (!row) return;  
  if (activitesAPI.estActiviteReservee(row)) return;
  const uuid = row.__uuid;
  const uuidVoisin = getLigneVoisineUuid(getRowsFromGridId('grid-programmees'), uuid);

  // Mutation immuable
  ctx.mutateDf(rows => {
    let next = rows.slice();
    const i = next.findIndex(r => r.__uuid === uuid);
    if (i >= 0) next[i] = { ...next[i], Date: null };
    next = sortDf(next);
    return next;
  });

  // Maj des sélections
  setTimeout(() => {
    selectRowByUuid('grid-programmees', uuidVoisin, { ensure: 'center', flash: null });
    openExpander?.('exp-non-programmees');
    selectRowByUuid('grid-non-programmees', uuid, { ensure: 'center', flash: true });
    doPhantomFlight("grid-programmees", "grid-non-programmees", "exp-non-programmees");
  }, 50);
}

// Programmation de l'activité sélectionnée dans la grille des activités programmables
async function doProgrammerActivite() {
  // 1) sélection dans la grille des programmables
  const gProg = grids.get('grid-programmables');
  if (!gProg) { alert('Grille “programmables” introuvable.'); return; }

  const sel = getSelectedRowSafe(gProg.api);
  if (!sel) return; 

  const uuid = sel.__uuid;
  const dateInt = toDateint(sel.Date);
  if (!uuid || !dateInt) { alert('Donnée sélectionnée invalide.'); return; }

  // 1) pré-check (lecture instantanée en RAM)
  const exists = (ctx.df || []).some(r => r.__uuid === uuid);
  if (!exists) { 
    alert('Activité introuvable dans les données.');
    return;                      // ⟵ on sort comme avant
  }

  // 2) mutation immuable
  ctx.mutateDf(rows => {
    let next = rows.slice();
    const i = next.findIndex(r => r.__uuid === uuid);
    if (i >= 0) next[i] = { ...next[i], Date: dateInt };
    next = sortDf(next);
    return next;
  });
  
  // 3) ouvrir l’expander “programmées” puis sélectionner & scroller la ligne
  openExpander('exp-programmees');

  // 4) attendre la peinture avant de sélectionner (double rAF)
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const ok = selectRowByUuid('grid-programmees', uuid, { align: 'middle', flash: true });
    if (!ok) {
      // fallback : sélection de la 1ère ligne si l’UUID n’est pas (encore) visible
      const h = grids.get('grid-programmees');
      const count = h?.api?.getDisplayedRowCount?.() ?? 0;
      if (count > 0) {
        const node = h.api.getDisplayedRowAtIndex(0);
        node?.setSelected?.(true, true);
        h.api.ensureIndexVisible?.(0, 'top');
      }
    }
  }));

  doPhantomFlight('grid-programmables', 'grid-programmees', 'exp-programmees');
}

// Rechargement des grilles depuis contexte
async function doRechargerGrilles() {
  if (activeGridId) await refreshGrid(activeGridId);
  else await refreshAllGrids();
}

// ------- Bottom Bar -------
function wireBottomBar() {
  
  const bar = document.getElementById('bottomBar');
  const scroller = document.getElementById('bottomBarScroller');
  if (!bar || !scroller) return;

  // petit flash visuel
  const pulse = (btn) => {
    if (!btn) return;
    btn.classList.add('bb-clicked');
    setTimeout(() => btn.classList.remove('bb-clicked'), 140);
  };

  // --- Fichier (menu) ---
  $('btn-file')?.addEventListener('click', (e) => {
    pulse(e.currentTarget);
    openFileMenuOrSheet(e.currentTarget);
  });

  // --- Undo / Redo ---
  $('btn-undo')?.addEventListener('click', async (e) => {
    pulse(e.currentTarget);
    doUndo();
  });
  $('btn-redo')?.addEventListener('click', async (e) => {
    pulse(e.currentTarget);
    doRedo();
  });

  // --- Ajouter avec collage ---
  $('btn-paste')?.addEventListener('click', (e) => {
    pulse(e.currentTarget);
    doAjoutActiviteAvecCollage();
  });

  // --- Ajouter ---
  $('btn-add')?.addEventListener('click', (e) => {
    pulse(e.currentTarget);
    doAjoutActivite();
  });

// Drag-to-scroll with mouse (desktop)
  let isDown = false, startX = 0, startScroll = 0;
  scroller.addEventListener('mousedown', (e) => {
    isDown = true;
    startX = e.clientX;
    startScroll = scroller.scrollLeft;
    scroller.style.cursor = 'grabbing';
  });
  window.addEventListener('mousemove', (e) => {
    if (!isDown) return;
    const dx = e.clientX - startX;
    scroller.scrollLeft = startScroll - dx;
  });
  window.addEventListener('mouseup', () => {
    isDown = false;
    scroller.style.cursor = '';
  });

  // Optional: hide bar when an input focuses (to avoid overlap with mobile keyboard)
  // window.addEventListener('focusin', (e) => {
  //   if (e.target.closest('input, textarea, [contenteditable="true"]')) {
  //     bar.style.transform = 'translateY(120%)';
  //   }
  // });
  // window.addEventListener('focusout', () => {
  //   bar.style.transform = '';
  // });

  wireHiddenFileInput();
  lockHorizontalScroll();
  initSafeAreaWatch();
  setTimeout(wireBottomBarToggle, 300);
  // wireFileMenu();
}

// Appelle le menu contextuel ou la bottom sheet selon la taille d’écran
function openFileMenuOrSheet(anchorBtn) {
  if (window.matchMedia('(max-width: 768px)').matches) {
    openFileSheet(); // version mobile
  } else {
    openFileMenuDesktop(anchorBtn);  // version desktop
  }
}

// Menu contextuel au-dessus du bouton "Fichier"
// function openFileMenu(anchorBtn, opts = {}) {
//   const btn = anchorBtn;
//   if (!btn || !(btn instanceof HTMLElement)) {
//     console.warn('[FileMenu] anchor invalide');
//     return;
//   }

//   // Si un menu est déjà ouvert → fermer si clic sur le même bouton
//   const existing = document.querySelector('.file-menu');
//   if (existing) {
//     const wasForSameBtn = existing.dataset.anchorId === btn.id;
//     existing.remove();
//     if (wasForSameBtn) return; // toggle: referme seulement
//   }

//   let openMenu = null;

//   const closeMenu = () => {
//     if (!openMenu) return;
//     openMenu.remove();
//     openMenu = null;
//     document.removeEventListener('keydown', onKeyDown);
//   };
//   const onKeyDown = (e) => { if (e.key === 'Escape') closeMenu(); };

//   // 1) créer le menu (invisible le temps de le positionner)
//   const menu = document.createElement('div');
//   menu.className = 'file-menu';
//   menu.dataset.anchorId = btn.id || ''; // pour savoir qui l’a ouvert
//   menu.innerHTML = `
//     <button data-action="new">Nouveau planning</button>
//     <button data-action="open">Importer planning depuis Excel</button>
//     <button data-action="save">Exporter planning vers Excel</button>
//   `;
//   Object.assign(menu.style, {
//     position: 'fixed',
//     zIndex: 2000,
//     background: '#fff',
//     border: '1px solid #ccc',
//     borderRadius: '8px',
//     boxShadow: '0 8px 24px rgba(0,0,0,.12)',
//     padding: '4px',
//     visibility: 'hidden',
//     opacity: '0',
//   });
//   document.body.appendChild(menu);

//   // style des items
//   menu.querySelectorAll('button').forEach(b => {
//     Object.assign(b.style, {
//       display: 'block',
//       width: '100%',
//       padding: '8px 10px',
//       textAlign: 'left',
//       background: 'transparent',
//       border: 'none',
//       borderRadius: '6px',
//       cursor: 'pointer'
//     });
//     b.addEventListener('mouseenter', () => b.style.background = '#f3f4f6');
//     b.addEventListener('mouseleave', () => b.style.background = 'transparent');
//     b.addEventListener('click', async (ev) => {
//       const act = ev.currentTarget.dataset.action;
//       closeMenu();
//       if (act === 'new')  {
//         if (typeof opts.onNew === 'function') return opts.onNew();
//         if (typeof doNouveauContexte === 'function') doNouveauContexte();
//       }
//       if (act === 'open') {
//         if (typeof opts.onOpen === 'function') return opts.onOpen();
//         if (typeof doImportExcel === 'function') doImportExcel();
//       }
//       if (act === 'save') {
//         if (typeof opts.onSave === 'function') return opts.onSave();
//         if (typeof doExportExcel === 'function') doExportExcel();
//       }
//     });
//   });

//   // 2) positionner AU-DESSUS du bouton (ou en dessous si pas de place)
//   try {
//     positionMenuOverBtn(btn, menu);
//   } catch {
//     const r = btn.getBoundingClientRect();
//     Object.assign(menu.style, {
//       left: `${Math.round(r.left)}px`,
//       top: `${Math.round(r.top - 120)}px`,
//     });
//   }

//   // 3) montrer avec une petite anim
//   menu.style.visibility = 'visible';
//   menu.animate(
//     [
//       { opacity: 0, transform: 'translateY(6px)' },
//       { opacity: 1, transform: 'translateY(0)' }
//     ],
//     { duration: 140, easing: 'ease-out', fill: 'forwards' }
//   );

//   openMenu = menu;

//   // fermer si clic ailleurs (différé pour ne pas capter ce même clic)
//   setTimeout(() => {
//     const onDocClick = (ev) => {
//       if (menu.contains(ev.target)) return;
//       // ⇩ ferme aussi si on reclique sur le bouton ancre ⇩
//       if (ev.target === btn) { closeMenu(); return; }
//       document.removeEventListener('click', onDocClick);
//       closeMenu();
//     };
//     document.addEventListener('click', onDocClick);
//   }, 0);

//   document.addEventListener('keydown', onKeyDown);
// }

// Construit le menu fichier (desktop)
function openFileMenuDesktop(anchorBtn) {
  // évite doublons
  document.querySelectorAll('.kebab-menu.file-menu').forEach(m => m.remove());

  const menu = document.createElement('div');
  menu.className = 'kebab-menu';

  // items
  const items = [
    { id:'new',  label:'Nouveau programme'     },
    { id:'open', label:'Importer programme depuis Excel'      },
    { id:'save', label:'Exporter programme depuis Excel' },
  ];
  for (const it of items) {
    const b = document.createElement('button');
    b.className = 'kebab-menu__item';
    b.textContent = it.label;
    b.dataset.action = it.id;
    menu.appendChild(b);
  }

  document.body.appendChild(menu);

  // première mesure invisible → position → afficher
  menu.getBoundingClientRect(); // force layout
  positionMenuOverBtn(anchorBtn, menu, { gap: 10 });
  // petite anim (via .show)
  requestAnimationFrame(() => menu.classList.add('show'));

  // actions
  const close = () => { menu.classList.remove('show'); setTimeout(()=>menu.remove(), 120); };
  menu.addEventListener('click', (e) => {
    const btn = e.target.closest('.kebab-menu__item');
    if (!btn) return;
    const act = btn.dataset.action;
    close();
    if (act === 'new')  doNouveauContexte?.();
    if (act === 'open') doImportExcel?.();
    if (act === 'save') doExportExcel?.();
  });

  // fermeture externe / ESC
  const onDocClick = (e) => { if (!menu.contains(e.target) && e.target !== anchorBtn) { cleanup(); } };
  const onKey = (e) => { if (e.key === 'Escape') cleanup(); };
  function cleanup() {
    document.removeEventListener('click', onDocClick, true);
    document.removeEventListener('keydown', onKey, true);
    close();
  }
  setTimeout(() => { // évite de capter le même clic
    document.addEventListener('click', onDocClick, true);
    document.addEventListener('keydown', onKey, true);
  }, 0);
}

// File sheet appelée par le bouton "Fichier" sur mobile
function openFileSheet() {
  const existing = document.querySelector('.file-sheet');
  if (existing) { existing.remove(); return; }

  const sheet = document.createElement('div');
  sheet.className = 'file-sheet';
  sheet.innerHTML = `
    <div class="file-sheet__backdrop"></div>
    <div class="file-sheet__panel" role="dialog" aria-modal="true">
      <span class="file-sheet__handle" aria-hidden="true"></span>
      <div class="file-sheet__content">
        <ul class="file-sheet__list">
          <li class="file-sheet__item" data-action="new">
            <svg class="file-sheet__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
            <div class="file-sheet__text">
              <span class="file-sheet__titleText">Nouveau planning</span>
              <span class="file-sheet__subtitle">Réinitialise le planning</span>
            </div>
          </li>
          <li class="file-sheet__item" data-action="open">
            <svg class="file-sheet__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h7l3 3h6v13H4z"/></svg>
            <div class="file-sheet__text">
              <span class="file-sheet__titleText">Importer planning depuis Excel</span>
              <span class="file-sheet__subtitle">Choisissez un fichier Excel contenant une liste d'activités</span>
            </div>
          </li>
          <li class="file-sheet__item" data-action="save">
            <svg class="file-sheet__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5h11l5 5v9a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8M7 5v4h8"/></svg>
            <div class="file-sheet__text">
              <span class="file-sheet__titleText">Exporter planning vers Excel</span>
              <span class="file-sheet__subtitle">Sauvegarde le planning courant dans un fichier Excel</span>
            </div>
          </li>
        </ul>
        <div class="file-sheet__footer">
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(sheet);

  const panel    = sheet.querySelector('.file-sheet__panel');
  const backdrop = sheet.querySelector('.file-sheet__backdrop');
  const content  = sheet.querySelector('.file-sheet__content');

  // Apparition
  requestAnimationFrame(() => {
    sheet.classList.add('visible');
    panel.style.transform = 'translateY(0)';
  });

  // Fermer
  const close = () => {
    sheet.classList.remove('visible');
    panel.style.transform = 'translateY(100%)';
    setTimeout(() => sheet.remove(), 250);
  };

  // Boutons
  backdrop.addEventListener('click', close);
  sheet.querySelector('.file-sheet__close')?.addEventListener('click', close);
  sheet.querySelectorAll('.file-sheet__item').forEach(li => {
    li.addEventListener('click', () => {
      const act = li.dataset.action;
      close();
      if (act === 'new')  doNouveauContexte?.();
      if (act === 'open') doImportExcel?.();
      if (act === 'save') doExportExcel?.();
    });
  });

  // ====== GESTURE: swipe down partout (prioritaire) ======
  let dragging = false;
  let startY = 0;
  let lastY = 0;
  let startedInScrollable = false;
  let suppressClick = false;        // évite click fantôme après drag
  const THRESHOLD_PX = 10;          // distance pour considérer un vrai drag
  const CLOSE_PX     = 90;          // distance pour fermer

  // Helper: trouve si la cible est dans un scrollable (content)
  const isInScrollable = (el) => el && (el === content || content.contains(el));

  // Start drag si:
  //  - poignée/titre (toujours)
  //  - OU dans le contenu ET content.scrollTop === 0 ET mouvement vers le bas
  const onPointerDown = (e) => {
    const y = e.touches ? e.touches[0].clientY : e.clientY;
    startY = lastY = y;
    startedInScrollable = isInScrollable(e.target);
    dragging = true;
    sheet.classList.add('dragging');
    suppressClick = false;

    // Pour iOS: on captera touchmove
    // (pas de preventDefault ici, on attend de savoir si ça devient un drag)
  };

  const onPointerMove = (e) => {
    if (!dragging) return;
    const y = e.touches ? e.touches[0].clientY : e.clientY;
    const dy = y - startY;
    lastY = y;

    // Cas contenu scrollable : si on n’est pas tout en haut → laisser scroller, pas drag
    if (startedInScrollable) {
      const atTop = (content.scrollTop <= 0);
      if (!atTop && dy > 0) {
        // on laisse scroller, on annule le drag
        dragging = false;
        sheet.classList.remove('dragging');
        return;
      }
    }

    // Devient un drag dès qu’on dépasse le seuil vers le bas
    if (dy > THRESHOLD_PX) {
      e.preventDefault?.(); // bloque le scroll de page iOS
      panel.style.transform = `translateY(${dy}px)`;
      suppressClick = true; // on a réellement draggué → on ne veut pas déclencher de clic
    }
  };

  const onPointerUp = () => {
    if (!dragging) return;
    dragging = false;
    sheet.classList.remove('dragging');

    const dy = lastY - startY;
    if (dy > CLOSE_PX) {
      close();
      return;
    }
    // sinon, revenir en place
    panel.style.transition = 'transform .22s cubic-bezier(.22,.8,.24,1)';
    panel.style.transform = 'translateY(0)';
    setTimeout(() => panel.style.transition = '', 240);
  };

  // Écouteurs (panel capte tout; move/up sur window)
  // NB: pas de touch-action:none sur panel pour laisser le scroll à l’intérieur
  panel.addEventListener('touchstart', onPointerDown, { passive: true });
  panel.addEventListener('mousedown',  onPointerDown);
  window.addEventListener('touchmove', onPointerMove, { passive: false }); // iOS: on veut pouvoir preventDefault
  window.addEventListener('mousemove', onPointerMove);
  window.addEventListener('touchend',  onPointerUp);
  window.addEventListener('mouseup',   onPointerUp);

  // Évite le "tap" après un drag (click fantôme) dans le panel
  panel.addEventListener('click', (e) => {
    if (suppressClick) {
      e.stopPropagation();
      e.preventDefault();
      suppressClick = false;
    }
  }, true);
}

// Centre horizontalement au-dessus du bouton (fallback en dessous si pas la place)
function positionMenuOverBtn(btn, menu) {
  const GAP = 8;
  const rBtn = btn.getBoundingClientRect();
  const vw = (window.visualViewport?.width)  || window.innerWidth;
  const vh = (window.visualViewport?.height) || window.innerHeight;

  // mesurer le menu (maintenant qu'il est dans le DOM)
  const rMenu = menu.getBoundingClientRect();
  let left = Math.round(rBtn.left + rBtn.width/2 - rMenu.width/2);
  left = Math.max(8, Math.min(left, vw - rMenu.width - 8)); // clamp horizontale

  // préférence : au-dessus
  let top = Math.round(rBtn.top - GAP - rMenu.height);
  if (top < 8) {
    // pas la place au-dessus → en dessous
    top = Math.round(rBtn.bottom + GAP);
    // clamp en bas si nécessaire
    if (top + rMenu.height > vh - 8) {
      top = Math.max(8, vh - 8 - rMenu.height);
    }
  }

  menu.style.left = left + 'px';
  menu.style.top  = top  + 'px';
}

// Handler du file input caché (import Excel effectif) 
function wireHiddenFileInput(){
  const fi = $('fileInput');
  if (!fi) return;

  fi.addEventListener('change', async (ev)=>{
    const f = ev.target.files?.[0];
    if (!f) return;
    try {
      const buf = await f.arrayBuffer();
      const wb  = XLSX.read(buf, { type: 'array' });
      const ws  = wb.Sheets[wb.SheetNames[0]];

      // 1) JSON “classique” (valeurs) — garde toutes les colonnes
      let dfRows = XLSX.utils.sheet_to_json(ws, { defval: null, raw: true });
      dfRows = normalizeRowsKeys(dfRows);

      // 2) range de la feuille
      const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');

      // 3) Récupère la ligne d'entêtes brute (array)
      const headerRow = (XLSX.utils.sheet_to_json(ws, { header: 1, range: range.s.r })[0] || []);

      // 4) Trouve l'index de la colonne "Activite" en normalisant l'entête
      const colActivite = headerRow.findIndex(h => normalizeHeaderToCanon(h) === 'Activite');

      // 5) Si on a une colonne Activité, on va lire les hyperliens des cellules (A2..An selon la colonne)
      if (typeof colActivite === 'number') {
        for (let i = 0; i < dfRows.length; i++) {
          const r = i + 1; // +1 car row 0 = ligne 2 en Excel (entête sur r0)
          const addr = XLSX.utils.encode_cell({ r: range.s.r + 1 + i, c: colActivite });
          const cell = ws[addr];
          const link = cell?.l?.Target || cell?.l?.target || null;

          // S’il y a déjà une colonne "Hyperlien" dans Excel, on la garde prioritaire,
          // sinon on remplit depuis le lien de la cellule Activité.
          if (!dfRows[i].Hyperlien && link) {
            dfRows[i].Hyperlien = link;
          }
        }
      }

      // 6) normalisation colonnes + __uuid + Date->dateint 
      dfRows = dfRows.map((r, i) => {
        const o = { ...r };

        // --- Date -> dateint ---
        // Accepte Excel serial ou "dd/mm[/yy]"
        let di = null;
        if (o.Date != null && String(o.Date).trim() !== '') {
          // d'abord tentative pretty
          di = prettyToDateint(String(o.Date).trim());
          // sinon Excel serial
          if (!di && typeof o.Date === 'number') {
            const ymd = excelSerialToYMD(o.Date);
            if (ymd) di = ymdToDateint(ymd);
          }
        }
        o.Date = di || null; // stock interne = dateint ou null

        // 7) __uuid garanti
        if (!o.__uuid) {
          o.__uuid = (crypto.randomUUID?.()) || `${Date.now()}_${i}`;
        }
        return o;
      });
      
      // 8) Tri des données
      dfRows = sortDf(dfRows);

      console.log('✅ Import df OK', dfRows.length, 'lignes');
    
      // 9) Carnet d’adresses (optionnel, 2e onglet)
      let caRows = [];
      const ca  = wb.Sheets[wb.SheetNames[1]]; // 2e onglet = Carnet
      if (ca) {
        caRows = XLSX.utils.sheet_to_json(ca, { defval: null, raw: true });
        caRows = normalizeImportedRows(caRows);

        caRows = caRows.map((r, i) => {
          const o = { ...r };
          // __uuid garanti
          if (!o.__uuid) {
            o.__uuid = (crypto.randomUUID?.()) || `${Date.now()}_${i}`;
          }
          return o;
        });

        caRows = (caRows||[]).filter(r => r.Nom != null && r.Nom !== '');
        caRows = sortCarnet(caRows);

        console.log('✅ Import ca OK', caRows.length, 'lignes');
      }

      // 10) Initialisation de la période programmation
      activitesAPI.initPeriodeProgrammation(dfRows);      

      // 11) Enregistrement des données dans le contexte
      ctx.beginAction('import');
      try {
        ctx.setDf(dfRows);     
        ctx.setCarnet(caRows);      
      } finally {
        ctx.endAction();                   
      }
    }
    catch (e) {
      console.error('❌ Import Excel KO', e);
      alert('Import échoué : ' + e.message);
    } finally {
      ev.target.value = '';
    }
  });
}

function wireBottomBarToggle() {
  const bar = document.getElementById('bottomBar');
  const toggle = document.getElementById('toggleBar');
  if (!bar || !toggle) return;

  // Injecte le span rotatif si pas déjà là
  if (!toggle.querySelector('span')) {
    toggle.innerHTML = '<span>⌃</span>';
  }
  const icon = toggle.querySelector('span');

  const updateTogglePos = () => {
    const barHeight = bar.offsetHeight || 0;
    const barBottom = parseFloat(getComputedStyle(bar).bottom) || 0;

    // Place la languette juste au-dessus de la barre, en tenant compte du safe-area   
    toggle.style.bottom = bar.classList.contains('hidden')
      ? `${barBottom}px`
      : `${barBottom + barHeight}px`;
  };

  toggle.addEventListener('click', () => {
    const hidden = bar.classList.toggle('hidden');
    toggle.classList.toggle('rotated', hidden);
    updateTogglePos();
    setTimeout(syncBottomBarTogglePosition, 180);
    // syncBottomBarTogglePosition();
  });

  // // --- 2️⃣ Fonction de sync (toujours locale à cette wire) ---
  // function syncBottomBarTogglePosition() {
  //   const rect = bar.getBoundingClientRect();
  //   toggle.style.bottom = `calc(env(safe-area-inset-bottom) + ${rect.height}px)`;
  // }

  // // --- 3️⃣ Wiring des événements liés au viewport ---
  // window.addEventListener('resize', syncBottomBarTogglePosition);
  // window.addEventListener('orientationchange', () =>
  //   setTimeout(syncBottomBarTogglePosition, 200)
  // );
  // bar.addEventListener('transitionend', (e) => {
  //   if (e.propertyName === 'transform') syncBottomBarTogglePosition();
  // });

  // // --- 4️⃣ Lancer une première sync après layout ---
  // requestAnimationFrame(syncBottomBarTogglePosition);

  updateTogglePos();
  window.addEventListener('resize', updateTogglePos);
}

function syncBottomBarTogglePosition() {
  if (isSplitterDragging) return;
  const bar = document.querySelector('.bottom-bar');
  const toggle = document.querySelector('.bottom-toggle');
  if (!bar || !toggle) return;

  // Mesurer la hauteur réellement rendue
  const h = Math.max(0, Math.round(bar.getBoundingClientRect().height));

  // Place la languette juste au-dessus de la barre, en tenant compte du safe-area
  toggle.style.bottom = `calc(${getSafeBottom()} + ${h}px)`;
}

function lockHorizontalScroll() {
  const scroller = document.querySelector('.bottom-bar__scroller');
  if (!scroller) return;

  let startX = 0, startY = 0, startLeft = 0, lock = null;

  scroller.addEventListener('touchstart', (e) => {
    const t = e.touches[0];
    startX = t.clientX;
    startY = t.clientY;
    startLeft = scroller.scrollLeft;
    lock = null;
  }, { passive: true });

  scroller.addEventListener('touchmove', (e) => {
    const t = e.touches[0];
    const dx = t.clientX - startX;
    const dy = t.clientY - startY;

    if (lock === null) lock = (Math.abs(dx) > Math.abs(dy)) ? 'x' : 'y';

    if (lock === 'x') {
      scroller.scrollLeft = startLeft - dx;
      // ✅ NE PAS bloquer si le geste n’est pas dans la bottom bar
      // (ici on est bien dans scroller -> OK)
      e.preventDefault();
    }
  }, { passive: false }); // on a besoin du preventDefault uniquement ici, pas ailleurs
}

function getSafeBottom() {
  // iOS notch etc.
  return 'env(safe-area-inset-bottom, 0px)';
}

function setSafeGap(px){
  // document.documentElement.style.setProperty('--safe-gap', `${px}px`);
}

function computeSafeGap() {
  if (isSplitterDragging) return;

  const vv = window.visualViewport;
  let gap = 0;

  if (vv) {
    // Espace masqué en bas du viewport
    const raw = Math.round(window.innerHeight - (vv.height + vv.offsetTop));

    const KEYBOARD_THRESHOLD = 140;                 // ↓↓↓ si > 140 → clavier
    const keyboardLikely = (window.innerHeight - vv.height) > KEYBOARD_THRESHOLD;
    const pullDown = vv.offsetTop < 0;              // “stretch” iOS en tirant vers le bas

    if (!keyboardLikely && !pullDown) {
      // ✅ Cas "barre Safari" : applique un gap modéré (0..120px)
      const CHROME_MAX = 120;
      gap = Math.max(0, Math.min(CHROME_MAX, raw));
    } else {
      // ❌ On ignore clavier et pull-down pour ton besoin
      gap = 0;
    }
  }

  // (optionnel) garder une petite hystérésis en haut de page pour éviter des micro-sauts
  const atTop = (window.scrollY || document.documentElement.scrollTop || 0) <= 0;
  const prev = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--safe-gap'), 10) || 0;
  if (atTop && gap > prev) {
    gap = prev; // ne pas augmenter en “tirant” tout en haut
  }

  setSafeGap(gap);
}

function hardPinBottom(){
  if (isSplitterDragging) return;
  computeSafeGap();
}

function initSafeAreaWatch(){
  // 1) premier calage dès que possible
  hardPinBottom();

  // 2) raf-loop pour laisser iOS stabiliser le viewport
  let frames = 0, lastGap = -1;
  const rafStabilize = () => {
    const vv = window.visualViewport;
    let gap = 0;
    if (vv) gap = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
    if (gap !== lastGap) {
      setSafeGap(gap);
      lastGap = gap;
    }
    if (++frames < 8) requestAnimationFrame(rafStabilize);
  };
  requestAnimationFrame(rafStabilize);

  // 3) petit recalage différé (iOS met parfois 300–450ms)
  setTimeout(hardPinBottom, 450);

  // 4) écoute les variations de viewport (clavier, slide bar, zoom)
  const vv = window.visualViewport;
  if (vv) {
    vv.addEventListener('resize', hardPinBottom);
    vv.addEventListener('scroll', hardPinBottom);
  }

  // 5) rotation = recalage après animation
  window.addEventListener('orientationchange', () => setTimeout(hardPinBottom, 350));

  // 6) retour PWA (ou onglet) = recalcule
  window.addEventListener('pageshow', () => setTimeout(hardPinBottom, 200));
}

// ------- Menu kebab -------
function positionMenuOverAnchor(anchor, menu) {
  const r = anchor.getBoundingClientRect();
  const vv = window.visualViewport || { width: window.innerWidth, height: window.innerHeight, offsetTop: 0, offsetLeft: 0 };
  // Tentative : au-dessus du bouton
  const menuRect = menu.getBoundingClientRect();
  let left = r.right - menuRect.width;  // aligné à droite
  let top  = r.top - 8 - menuRect.height;
  // Fallback si pas de place au-dessus → dessous
  if (top < (vv.offsetTop || 0) + 8) top = r.bottom + 8;

  // garde dans l’écran
  left = Math.max(8, Math.min(left, (vv.width + (vv.offsetLeft||0)) - menuRect.width - 8));

  menu.style.left = `${Math.round(left)}px`;
  menu.style.top  = `${Math.round(top)}px`;
}

function createKebabItem(label, key) {
  const b = document.createElement('button');
  b.className = 'kebab-menu__item';
  b.type = 'button';
  b.dataset.action = key;
  b.textContent = label;
  return b;
}
function createKebabSep() {
  const d = document.createElement('div');
  d.className = 'kebab-sep';
  return d;
}

function openKebabMenu(anchorBtn, { items = [] } = {}) {
  if (!anchorBtn) return;

  // prevent double-open on the same button
  if (anchorBtn.__menuOpen) {
    try { anchorBtn.__menuOpen.remove(); } catch {}
    anchorBtn.__menuOpen = null;
  }

  // 1) Build the menu (initially invisible so we can measure/position)
  const menu = document.createElement('div');
  menu.className = 'kebab-menu';

  // Stop the click bubbling so outside-closer doesn’t fire
  menu.addEventListener('click', (e)=> e.stopPropagation());

  // Items
  for (const it of items) {
    // const sep = createKebabSep();
    const btn = createKebabItem(it.label, it.id);
    btn.addEventListener('mouseenter', ()=> btn.style.background = '#f3f4f6');
    btn.addEventListener('mouseleave', ()=> btn.style.background = 'transparent');
    btn.addEventListener('click', (e)=> {
      e.stopPropagation();
      try { it.onClick?.(); } finally { closeMenu(); }
    });
    // menu.append(sep, btn);
    menu.appendChild(btn);
  }

  document.body.appendChild(menu);

  // 2) Position it relative to the anchor (above if not enough space below)
  const pos = () => {
    const r = anchorBtn.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    const m = menu.getBoundingClientRect();

    // Prefer under the button, align right edge to button’s right
    let top = r.bottom + 8;
    let left = r.right - m.width;

    // Keep within viewport
    if (left < 8) left = 8;
    if (left + m.width > vw - 8) left = vw - 8 - m.width;

    // If not enough room below, open above
    if (top + m.height > vh - 8) {
      top = r.top - 8 - m.height;
      if (top < 8) top = 8;
    }

    menu.style.left = `${Math.round(left)}px`;
    menu.style.top  = `${Math.round(top)}px`;
    menu.style.visibility = 'visible';

    // animate in
    requestAnimationFrame(()=> {
      menu.style.opacity = '1';
      menu.style.transform = 'translateY(0)';
    });
  };

  // 3) Close handlers (escape / outside click / resize)
  const closeMenu = () => {
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('click', onDocClick, true);
    window.removeEventListener('resize', onResize);
    try {
      menu.style.opacity = '0';
      menu.style.transform = 'translateY(6px)';
      setTimeout(()=> menu.remove(), 120);
    } catch { menu.remove(); }
    anchorBtn.__menuOpen = null;
  };

  const onKey = (e) => { if (e.key === 'Escape') closeMenu(); };
  const onResize = () => { closeMenu(); };

  // Important: defer outside-click to avoid closing immediately
  const onDocClick = (e) => {
    if (menu.contains(e.target) || e.target === anchorBtn) return;
    closeMenu();
  };

  // Prevent the very click that opened the button from closing the menu
  anchorBtn.addEventListener('click', (e)=> e.stopPropagation(), { once: true });

  // Arm listeners
  setTimeout(() => {
    document.addEventListener('click', onDocClick, true);
  }, 0);
  document.addEventListener('keydown', onKey);
  window.addEventListener('resize', onResize);

  // Position now (after in-DOM to get proper size)
  pos();
  anchorBtn.__menuOpen = menu;
}

function wireAppKebab() {
  const btn = document.getElementById('btn-app-kebab');
  if (!btn) return;

  // Évite que le clic se propage à un parent cliquable
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    openKebabMenu(btn, {
      items: [
        { id:'carnet', label:"Carnet d'adresses",          onClick: ()=>openSheetCarnet() },
        { id:'settings', label:'Paramètres',               onClick: ()=>openSheetParams() },
        { id:'help',     label:'Aide',                     onClick: ()=>openSheetAide() },
      ]
    });
  }, { passive: true });
}

// function openSheet({ title = '', maxHeight = '70vh', mount }) {
//   // backdrop + panel
//   const wrap = document.createElement('div');
//   wrap.className = 'sheet-wrap';
//   wrap.innerHTML = `
//     <div class="sheet-backdrop"></div>
//     <div class="sheet-panel" role="dialog" aria-modal="true" style="max-height:${maxHeight}">
//       <header class="sheet-header">
//         <div class="sheet-title">${title}</div>
//         <button class="sheet-close" aria-label="Fermer">✕</button>
//       </header>
//       <div class="sheet-body"></div>
//     </div>
//   `;
//   document.body.appendChild(wrap);

//   const panel = wrap.querySelector('.sheet-panel');
//   const body  = wrap.querySelector('.sheet-body');

//   // monter le contenu (peut renvoyer un cleanup)
//   let cleanup = null;
//   if (typeof mount === 'function') cleanup = mount(body);

//   // anim d’entrée
//   requestAnimationFrame(() => wrap.classList.add('is-open'));

//   const close = () => {
//     wrap.classList.remove('is-open');
//     setTimeout(() => {
//       try { if (typeof cleanup === 'function') cleanup(); } catch {}
//       wrap.remove();
//     }, 180);
//   };

//   wrap.querySelector('.sheet-backdrop').addEventListener('click', close);
//   wrap.querySelector('.sheet-close').addEventListener('click', close);
//   document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); }, { once: true });

//   return { close };
// }

// openSheet({ title, mount, onClose, classes: 'file-skin' })

//=============================
// Version de base qui marche 
//=============================
// function openSheet({ title = '', mount, onClose, classes = '' } = {}) {
//   // wrap
//   const wrap = document.createElement('div');
//   wrap.className = `sheet-wrap ${classes}`.trim();

//   const backdrop = document.createElement('div');
//   backdrop.className = 'sheet-backdrop';

//   const panel = document.createElement('div');
//   panel.className = 'sheet-panel';

//   const header = document.createElement('div');
//   header.className = 'sheet-header';

//   const h = document.createElement('div');
//   h.className = 'sheet-title';
//   h.textContent = title;

//   const close = document.createElement('button');
//   close.className = 'sheet-close';
//   close.innerHTML = '✕';
//   close.addEventListener('click', () => destroy());

//   header.append(h, close);

//   const body = document.createElement('div');
//   body.className = 'sheet-body';

//   panel.append(header, body);
//   wrap.append(backdrop, panel);
//   document.body.appendChild(wrap);

//   const destroy = () => {
//     wrap.classList.remove('is-open');
//     setTimeout(() => {
//       wrap.remove();
//       onClose?.();
//     }, 180);
//   };
//   backdrop.addEventListener('click', destroy);

//   // monter le contenu
//   mount?.(body, { close: destroy });

//   // animation d’entrée
//   requestAnimationFrame(() => wrap.classList.add('is-open'));

//   return { close: destroy, el: wrap, body, panel };
// }

// function openSheet({ title = '', mount, onClose, onOpen, classes = '', maxHeight } = {}) {
//   // --- structure DOM identique à ta version ---
//   const wrap = document.createElement('div');
//   wrap.className = `sheet-wrap ${classes}`.trim();

//   const backdrop = document.createElement('div');
//   backdrop.className = 'sheet-backdrop';

//   const panel = document.createElement('div');
//   panel.className = 'sheet-panel';
//   if (typeof maxHeight === 'number') {
//     panel.style.maxHeight = `${maxHeight}px`;
//   }

//   const header = document.createElement('div');
//   header.className = 'sheet-header';

//   const h = document.createElement('div');
//   h.className = 'sheet-title';
//   h.textContent = title;

//   const btnClose = document.createElement('button');
//   btnClose.className = 'sheet-close';
//   btnClose.innerHTML = '✕';
//   btnClose.addEventListener('click', () => destroy());

//   header.append(h, btnClose);

//   const body = document.createElement('div');
//   body.className = 'sheet-body';

//   panel.append(header, body);
//   wrap.append(backdrop, panel);
//   document.body.appendChild(wrap);

//   // --- verrouille le scroll de la page pendant la sheet ---
//   const html = document.documentElement;
//   const prevOverflow = html.style.overflow;
//   const prevPaddingR = html.style.paddingRight;
//   const scrollbarW = window.innerWidth - html.clientWidth;
//   html.style.overflow = 'hidden';
//   if (scrollbarW > 0) html.style.paddingRight = `${scrollbarW}px`;

//   // --- safe area iOS (padding bas) sans changer ta CSS ---
//   try {
//     const cs = getComputedStyle(document.documentElement);
//     const inset = parseFloat((cs.getPropertyValue('env(safe-area-inset-bottom)') || '0').replace('px','')) || 0;
//     if (inset > 0) {
//       panel.style.paddingBottom = `calc(${getComputedStyle(panel).paddingBottom} + env(safe-area-inset-bottom))`;
//     }
//   } catch {}

//   // --- fermeture (anim identique à ta CSS) ---
//   let closed = false;
//   function destroy() {
//     if (closed) return;
//     closed = true;
//     wrap.classList.remove('is-open');
//     // durée alignée à .22s (CSS transform) / .18s (backdrop)
//     setTimeout(() => {
//       wrap.remove();
//       // restore scroll
//       html.style.overflow = prevOverflow;
//       html.style.paddingRight = prevPaddingR;
//       onClose?.();
//       document.removeEventListener('keydown', onKey, true);
//       window.removeEventListener('mousemove', onMove, { passive: false });
//       window.removeEventListener('mouseup', onEnd, { passive: true });
//     }, 220);
//   }

//   backdrop.addEventListener('click', destroy);

//   // --- contenu (support async) ---
//   (async () => {
//     const ret = mount?.(body, { close: destroy, panel, wrap }) ?? null;
//     if (ret && typeof ret.then === 'function') {
//       await ret; // si mount est async
//     }
//     onOpen?.({ body, panel, wrap });
//   })().catch(console.error);

//   // --- ouverture (anime via .is-open comme ta version) ---
//   requestAnimationFrame(() => wrap.classList.add('is-open'));

//   // --- Esc pour fermer ---
//   const onKey = (e) => { if (e.key === 'Escape') destroy(); };
//   document.addEventListener('keydown', onKey, true);

//   // --- drag-to-close : on glisse le HEADER vers le bas ---
//   let dragging = false, startY = 0, curY = 0;
//   const startTransform = () => {
//     panel.style.transition = 'none'; // pas de snap pendant drag
//   };
//   const endTransform = () => {
//     panel.style.transition = ''; // rétablit la transition CSS
//   };
//   const onStart = (ev) => {
//     const t = ev.touches ? ev.touches[0] : ev;
//     dragging = true;
//     startY = t.clientY;
//     curY = startY;
//     startTransform();
//     ev.preventDefault?.();
//   };
//   const onMove = (ev) => {
//     if (!dragging) return;
//     const t = ev.touches ? ev.touches[0] : ev;
//     curY = t.clientY;
//     const dy = Math.max(0, curY - startY);
//     panel.style.transform = `translateY(${dy}px)`;
//     ev.preventDefault?.();
//   };
//   const onEnd = () => {
//     if (!dragging) return;
//     dragging = false;
//     const dy = Math.max(0, curY - startY);
//     const threshold = Math.min(200, panel.clientHeight * 0.28);
//     endTransform();
//     if (dy > threshold) destroy();
//     else panel.style.transform = ''; // revient à la position initiale (CSS)
//   };

//   // pointer + touch
//   header.addEventListener('touchstart', onStart, { passive: false });
//   header.addEventListener('touchmove', onMove, { passive: false });
//   header.addEventListener('touchend', onEnd, { passive: true });
//   header.addEventListener('mousedown', onStart, { passive: false });
//   window.addEventListener('mousemove', onMove, { passive: false });
//   window.addEventListener('mouseup', onEnd, { passive: true });

//   return { close: destroy, el: wrap, body, panel };
// }

// function openSheet({ title = '', mount, onClose, classes = '', panelMaxHeight = '60vh', panelHeight = null, replaceExisting = false } = {}) {
//   // 0) empêcher l’empilement
//   const existing = document.querySelector('.sheet-wrap.is-open');
//   if (existing && !replaceExisting) {
//     // petit bounce visuel pour indiquer "déjà ouvert"
//     const panel = existing.querySelector('.sheet-panel');
//     if (panel) {
//       panel.animate(
//         [{ transform: 'translateY(0)' }, { transform: 'translateY(-8px)' }, { transform: 'translateY(0)' }],
//         { duration: 180, easing: 'ease-out' }
//       );
//     }
//     return { close: () => existing.remove(), el: existing, body: existing.querySelector('.sheet-body'), panel };
//   }
//   // si on veut vraiment remplacer : on supprime l’ancienne
//   if (existing && replaceExisting) existing.remove();

//   // 1) structure
//   const wrap = document.createElement('div');
//   wrap.className = `sheet-wrap ${classes}`.trim();

//   const backdrop = document.createElement('div');
//   backdrop.className = 'sheet-backdrop';

//   const panel = document.createElement('div');
//   panel.className = 'sheet-panel';
//   // ← pilotage de la hauteur en inline
//   if (panelMaxHeight) panel.style.maxHeight = panelMaxHeight;
//   if (panelHeight)    panel.style.height    = panelHeight;


//   // poignée + header + body
//   const handle = document.createElement('span');
//   handle.className = 'sheet-handle';
//   panel.prepend(handle);

//   const header = document.createElement('div');
//   header.className = 'sheet-header';

//   const h = document.createElement('div');
//   h.className = 'sheet-title';
//   h.textContent = title;

//   const closeBtn = document.createElement('button');
//   closeBtn.className = 'sheet-close';
//   closeBtn.innerHTML = '✕';

//   header.append(h, closeBtn);

//   const body = document.createElement('div');
//   body.className = 'sheet-body';

//   panel.append(handle, header, body);
//   wrap.append(backdrop, panel);
//   document.body.appendChild(wrap);

//   // 2) fermeture
//   const destroy = () => {
//     wrap.classList.remove('is-open');
//     setTimeout(() => {
//       wrap.remove();
//       onClose?.();
//     }, 220);
//   };
//   backdrop.addEventListener('click', destroy);
//   closeBtn.addEventListener('click', destroy);

//   // -- Swipe-to-close (drag vers le bas) --
//   (function attachSwipeToClose(wrap, panel, backdrop, onClose){
//     let startY = 0, curY = 0, dragging = false;

//     const onPointerDown = (e) => {
//       // Ne déclenche que si on part du haut du panel (poignée, header),
//       // ça évite de gêner le scroll du contenu.
//       const y = (e.touches ? e.touches[0] : e).clientY;
//       const target = e.target;
//       const isHandleOrHeader =
//         target.closest('.sheet-handle') || target.closest('.sheet-header');
//       if (!isHandleOrHeader) return;

//       dragging = true;
//       startY = y;
//       curY = y;
//       wrap.classList.add('dragging');
//     };

//     const onPointerMove = (e) => {
//       if (!dragging) return;
//       const y = (e.touches ? e.touches[0] : e).clientY;
//       curY = y;
//       const dy = Math.max(0, curY - startY); // seulement vers le bas
//       panel.style.transform = `translateY(${dy}px)`;
//       // atténue le backdrop proportionnellement
//       const k = Math.max(0, Math.min(1, dy / 180));
//       backdrop.style.opacity = String(1 - 0.7 * k);

//       // évite le scroll de page pendant le drag
//       e.preventDefault?.();
//     };

//     const onPointerUp = () => {
//       if (!dragging) return;
//       dragging = false;
//       wrap.classList.remove('dragging');

//       const dy = Math.max(0, curY - startY);
//       const THRESH = 120; // seuil de fermeture
//       if (dy > THRESH) {
//         // ferme pour de bon
//         onClose();
//       } else {
//         // revient gentiment en place
//         panel.style.transition = 'transform .22s ease';
//         backdrop.style.transition = 'opacity .18s ease';
//         panel.style.transform = 'translateY(0)';
//         backdrop.style.opacity = '';
//         setTimeout(() => {
//           panel.style.transition = '';
//           backdrop.style.transition = '';
//         }, 220);
//       }
//     };

//     // Écouteurs (pointer OU touch + mouse fallback)
//     if (window.PointerEvent) {
//       panel.addEventListener('pointerdown', onPointerDown, { passive: true });
//       window.addEventListener('pointermove', onPointerMove, { passive: false });
//       window.addEventListener('pointerup',   onPointerUp,   { passive: true });
//       window.addEventListener('pointercancel', onPointerUp, { passive: true });
//     } else {
//       panel.addEventListener('touchstart', onPointerDown, { passive: true });
//       window.addEventListener('touchmove',  onPointerMove, { passive: false });
//       window.addEventListener('touchend',   onPointerUp,   { passive: true });
//       panel.addEventListener('mousedown',   onPointerDown, true);
//       window.addEventListener('mousemove',  onPointerMove, true);
//       window.addEventListener('mouseup',    onPointerUp,   true);
//     }
//   })(wrap, panel, backdrop, destroy);

//   // 3) contenu
//   mount?.(body, { close: destroy });

//   // 4) open anim
//   requestAnimationFrame(() => wrap.classList.add('is-open'));

//   return { close: destroy, el: wrap, body, panel };
// }


// helpers: lock/unlock scroll (iOS-safe)
function lockScroll() {
  const y = window.scrollY || document.documentElement.scrollTop || 0;
  document.body.dataset.lockY = String(y);
  Object.assign(document.body.style, {
    position: 'fixed',
    top: `-${y}px`,
    left: '0', right: '0',
    width: '100%',
    overflow: 'hidden',
  });
}
function unlockScroll() {
  const y = parseInt(document.body.dataset.lockY || '0', 10) || 0;
  Object.assign(document.body.style, {
    position: '', top: '', left: '', right: '', width: '', overflow: '',
  });
  window.scrollTo(0, y);
}

function openSheet({
  title = '',
  mount,
  onClose,
  classes = '',
  panelMaxHeight = '60vh',
  panelHeight = null,
  replaceExisting = false
} = {}) {

  // 0) empêcher l’empilement
  // const existing = document.querySelector('.sheet-wrap.is-open');
  // if (existing && !replaceExisting) {
  //   const existingPanel = existing.querySelector('.sheet-panel');
  //   if (existingPanel) {
  //     existingPanel.animate(
  //       [{ transform: 'translateY(0)' }, { transform: 'translateY(-8px)' }, { transform: 'translateY(0)' }],
  //       { duration: 180, easing: 'ease-out' }
  //     );
  //   }
  //   return {
  //     close: () => existing.remove(),
  //     el: existing,
  //     body: existing.querySelector('.sheet-body'),
  //     panel: existingPanel
  //   };
  // }
  // if (existing && replaceExisting) existing.remove();
  // (plus de rebond ici : on suppose que l'appelant passe par openSheetExclusive)

  // 1) structure
  const wrap = document.createElement('div');
  wrap.className = `sheet-wrap ${classes}`.trim();

  const backdrop = document.createElement('div');
  backdrop.className = 'sheet-backdrop';

  const panel = document.createElement('div');
  panel.className = 'sheet-panel';
  if (panelMaxHeight) panel.style.maxHeight = panelMaxHeight;
  if (panelHeight)    panel.style.height    = panelHeight;

  // poignée + header + body
  const handle = document.createElement('span');
  handle.className = 'sheet-handle';

  const header = document.createElement('div');
  header.className = 'sheet-header';

  const h = document.createElement('div');
  h.className = 'sheet-title';
  h.textContent = title || '';

  const closeBtn = document.createElement('button');
  closeBtn.className = 'sheet-close';
  closeBtn.innerHTML = '✕';

  header.append(h, closeBtn);

  const body = document.createElement('div');
  body.className = 'sheet-body';

  panel.append(handle, header, body);
  wrap.append(backdrop, panel);
  document.body.appendChild(wrap);

  // 2) fermeture
  // const destroy = () => {
  //   wrap.classList.remove('is-open');
  //   // petite anim de sortie assurée par le CSS (transform)
  //   setTimeout(() => {
  //     wrap.remove();
  //     unlockScroll();          // ✅ rétablit le scroll page
  //     onClose?.();
  //   }, 220);
  // };
  const destroy = () => {
    // évite double-close
    if (wrap.classList.contains('is-closing')) return;

    // passe en état "closing" → déclenche les transitions CSS
    wrap.classList.add('is-closing');
    wrap.classList.remove('is-open');

    // quand la transition du panel se termine, on retire du DOM
    const onEnd = (ev) => {
      if (ev.target !== panel || ev.propertyName !== 'transform') return;
      panel.removeEventListener('transitionend', onEnd);
      wrap.remove();
      unlockScroll?.();
      onClose?.();
    };
    panel.addEventListener('transitionend', onEnd);

    // filet de sécurité si pas d'event (navigateurs capricieux)
    setTimeout(() => {
      if (wrap.isConnected) {
        panel.removeEventListener('transitionend', onEnd);
        wrap.remove();
        unlockScroll?.();
        onClose?.();
      }
    }, 400);
  };

  // function closeSmoothFrom(dy){
  //   // 1) réactiver transitions si elles ont été coupées
  //   wrap.classList.remove('dragging');
  //   panel.style.willChange   = '';
  //   backdrop.style.willChange= '';
  //   panel.style.transition   = '';  // respecte les transitions CSS
  //   backdrop.style.transition= '';

  //   // 2) position de départ = position atteinte par le drag
  //   panel.style.transform = `translateY(${dy}px)`;
  //   const k = Math.max(0, Math.min(1, dy / 180));
  //   backdrop.style.opacity = String(1 - 0.7 * k);

  //   // 3) IMPORTANT : forcer un reflow pour "sceller" le point de départ
  //   // avant de basculer en is-closing
  //   void panel.offsetHeight;

  //   // 4) bascule en .is-closing -> le CSS anime vers translateY(100%) / opacity:0
  //   wrap.classList.add('is-closing');
  //   wrap.classList.remove('is-open');

  //   // 5) cleanup quand l’anim est finie
  //   const onEnd = (ev) => {
  //     if (ev.target !== panel || ev.propertyName !== 'transform') return;
  //     panel.removeEventListener('transitionend', onEnd);
  //     try { wrap.remove(); } catch {}
  //     unlockScroll?.();
  //     onClose?.();
  //   };
  //   panel.addEventListener('transitionend', onEnd);

  //   // filet de sécu si pas d’event
  //   setTimeout(() => {
  //     if (!wrap.isConnected) return;
  //     panel.removeEventListener('transitionend', onEnd);
  //     try { wrap.remove(); } catch {}
  //     unlockScroll?.();
  //     onClose?.();
  //   }, 500);
  // }

  // ✅ ici, on attache le swipe avant de monter le contenu
  // attachSwipeToClose(wrap, panel, handle, header, backdrop, destroy);

  function closeSmoothFrom(dy){
    // 0) On est sûr de ne plus être en mode "drag sans transition"
    wrap.classList.remove('dragging');
    panel.style.willChange = '';
    backdrop.style.willChange = '';

    // 1) Réactiver les transitions CSS (si tu les avais coupées inline)
    panel.style.transition = '';
    backdrop.style.transition = '';

    // 2) Fixer le point de départ de l'anim (position atteinte par le drag)
    const k = Math.max(0, Math.min(1, dy / 180));
    panel.style.transform = `translateY(${dy}px)`;
    backdrop.style.opacity = String(1 - 0.7 * k);

    // 3) Laisser le style se "poser" (double rAF = ultra-fiable)
    requestAnimationFrame(() => {
      // forcer un reflow si tu préfères : void panel.offsetHeight;
      requestAnimationFrame(() => {
        // 4) Bascule en fermeture via les classes (CSS fera le job)
        wrap.classList.add('is-closing');
        wrap.classList.remove('is-open');

        // 5) Fallback Web Animations (au cas où la transition CSS ne déclenche pas)
        try {
          const pAnim = panel.animate(
            [
              { transform: `translateY(${dy}px)` },
              { transform: 'translateY(100%)' }
            ],
            { duration: 250, easing: 'cubic-bezier(.22,.8,.24,1)', fill: 'forwards' }
          );
          const bAnim = backdrop.animate(
            [
              { opacity: parseFloat(backdrop.style.opacity) || 1 },
              { opacity: 0 }
            ],
            { duration: 200, easing: 'ease', fill: 'forwards' }
          );

          let done = false;
          const cleanup = () => {
            if (done) return; done = true;
            try { wrap.remove(); } catch{}
            unlockScroll?.();
            onClose?.();
          };
          pAnim.addEventListener?.('finish', cleanup);
          bAnim.addEventListener?.('finish', cleanup);
          // filet de sécu
          setTimeout(cleanup, 400);
        } catch {
          // Si Web Animations indisponible, on retombe sur l'event CSS
          const onEnd = (ev) => {
            if (ev.target !== panel || ev.propertyName !== 'transform') return;
            panel.removeEventListener('transitionend', onEnd);
            try { wrap.remove(); } catch{};
            unlockScroll?.();
            onClose?.();
          };
          panel.addEventListener('transitionend', onEnd);
          setTimeout(() => {
            panel.removeEventListener('transitionend', onEnd);
            if (wrap.isConnected) {
              try { wrap.remove(); } catch{};
              unlockScroll?.();
              onClose?.();
            }
          }, 500);
        }
      });
    });
  }


  attachSwipeToClose(wrap, panel, handle, header, backdrop, closeSmoothFrom);

  backdrop.addEventListener('click', destroy);
  closeBtn.addEventListener('click', destroy);

  // =======================
  // Swipe handler (patched)
  // =======================
  function attachSwipeToClose(wrap, panel, headerEl, handleEl, backdrop, onClose){
    let startY = 0, curY = 0, dragging = false;

    const canStartFrom = (tgt) =>
      !!(tgt.closest('.sheet-handle') || tgt.closest('.sheet-header'));

    const onStart = (e) => {
      // block if editing just ended
      if (wrap.dataset.swipeDisabled === '1') return;
      const last = Number(wrap.dataset.lastEditEndedAt || 0);
      if (last && (Date.now() - last) < 180) return;

      const target = e.target;
      if (!canStartFrom(target)) return;

      // blur editor to let keyboard go down
      const ae = document.activeElement;
      if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) {
        ae.blur?.();
      }

      // Synchronously arm the drag so we own the gesture right away
      const t = e.touches ? e.touches[0] : e;
      startY = curY = t.clientY;
      dragging = true;

      wrap.classList.add('dragging');
      panel.style.transition = 'none';
      backdrop.style.transition = 'none';
      panel.style.willChange = 'transform';
      backdrop.style.willChange = 'opacity';

      // IMPORTANT: stop page scroll immediately
      e.preventDefault?.();

      // We still wait for viewport to settle, but we already own the gesture
      waitViewportSettle(300).then(() => {
        /* nothing extra here; we already started */
      });
    };

    const onMove = (e) => {
      if (!dragging) return;
      const t = e.touches ? e.touches[0] : e;
      curY = t.clientY;
      const dy = Math.max(0, curY - startY);

      // keep blocking scroll while dragging
      e.preventDefault?.();

      panel.style.transform = `translateY(${dy}px)`;
      const k = Math.max(0, Math.min(1, dy / 180));
      backdrop.style.opacity = String(1 - 0.7 * k);
    };

    const onEnd = () => {
      if (!dragging) return;
      dragging = false;

      wrap.classList.remove('dragging');
      panel.style.willChange = '';
      backdrop.style.willChange = '';
      panel.style.transition = '';
      backdrop.style.transition = '';

      const dy = Math.max(0, curY - startY);
      // if (dy > 120) onClose();
      // else {
      //   panel.style.transform = 'translateY(0)';
      //   backdrop.style.opacity = '';
      if (dy > 120) {
        onClose(dy);
      } else {
        // retour en place
        panel.style.transition = '';
        backdrop.style.transition = '';
        panel.style.transform = 'translateY(0)';
        backdrop.style.opacity = '';
      }
    };

    // register start listeners as NON-passive so we can preventDefault on start
    const addStart = (el) => {
      if (!el) return;
      if (window.PointerEvent) {
        el.addEventListener('pointerdown', onStart, { passive: false });
      } else {
        el.addEventListener('touchstart', onStart, { passive: false });
        el.addEventListener('mousedown',  onStart, false);
      }
    };

    addStart(headerEl);
    addStart(handleEl);

    // move/end listeners (move must be non-passive to allow preventDefault)
    if (window.PointerEvent) {
      window.addEventListener('pointermove', onMove, { passive: false });
      window.addEventListener('pointerup',   onEnd,  { passive: true });
      window.addEventListener('pointercancel', onEnd, { passive: true });
    } else {
      window.addEventListener('touchmove', onMove, { passive: false });
      window.addEventListener('touchend',  onEnd,  { passive: true });
      window.addEventListener('mousemove', onMove, false);
      window.addEventListener('mouseup',   onEnd,  false);
    }
  }

  // 3) contenu
  mount?.(body, { close: destroy });

  // 4) ouverture (anim) + lock scroll
  lockScroll();                        // ✅ gèle la page en arrière-plan
  requestAnimationFrame(() => wrap.classList.add('is-open'));

  return { close: destroy, el: wrap, body, panel };
}

function waitTransitionEnd(el, prop = 'transform', timeout = 280) {
  return new Promise(resolve => {
    let done = false;
    const t = setTimeout(() => { if (!done) { done = true; resolve(); } }, timeout);

    const onEnd = (ev) => {
      if (done) return;
      if (!prop || ev.propertyName === prop) {
        done = true;
        clearTimeout(t);
        el.removeEventListener('transitionend', onEnd);
        resolve();
      }
    };
    el.addEventListener('transitionend', onEnd);
  });
}

async function closeAnySheet({ immediate = false } = {}) {
  const wrap = document.querySelector('.sheet-wrap.is-open');
  if (!wrap) return;

  // Empêche ré-entrance
  if (wrap.dataset.state === 'closing') return;
  wrap.dataset.state = 'closing';

  const panel = wrap.querySelector('.sheet-panel');

  if (immediate) {
    wrap.remove();
    document.body.style.removeProperty('overflow'); // si tu “lock scroll” pendant la sheet
    return;
  }

  wrap.classList.remove('is-open');      // déclenche l’anim de sortie
  await waitTransitionEnd(panel, 'transform', 260).catch(()=>{});
  wrap.remove();
  document.body.style.removeProperty('overflow');
}

let __sheetBusy = false;

async function openSheetExclusive(opts = {}) {
  // supprime/ferme toute sheet actuelle avant d’ouvrir
  if (__sheetBusy) return;         // anti re-entrance
  __sheetBusy = true;
  try {
    await closeAnySheet({ immediate: false }); // attend la fermeture
    const inst = openSheet({ ...opts, replaceExisting: false }); // ta fonction existante
    return inst;
  } finally {
    // petite garde pour laisser le DOM se poser
    setTimeout(() => { __sheetBusy = false; }, 50);
  }
}

// --- keep this helper outside openSheet ---
function waitViewportSettle(timeout = 350) {
  return new Promise(resolve => {
    const vv = window.visualViewport;
    if (!vv) return resolve();
    const start = Date.now();
    let lastH = vv.height;
    const tick = () => {
      const h = vv.height;
      const stable = Math.abs(h - lastH) < 1;
      lastH = h;
      if (stable || (Date.now() - start) > timeout) resolve();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

// Mark/unmark editing on the current sheet
function markSheetEditing(wrap, on) {
  if (!wrap) return;
  if (on) {
    wrap.dataset.swipeDisabled = '1';
  } else {
    (async () => {
      await waitViewportSettle(350);
      delete wrap.dataset.swipeDisabled;
      wrap.dataset.lastEditEndedAt = String(Date.now());
      // failsafe: auto re-enable if something got stuck
      setTimeout(() => { delete wrap.dataset.swipeDisabled; }, 800);
    })();
  }
}

// function openSheet({
//   title = '',
//   mount,
//   onClose,
//   classes = '',
//   panelMaxHeight = '60vh',
//   panelHeight = null,
//   replaceExisting = false
// } = {}) {

//   const existing = document.querySelector('.sheet-wrap.is-open');
//   if (existing && !replaceExisting) {
//     const existingPanel = existing.querySelector('.sheet-panel');
//     if (existingPanel) {
//       existingPanel.animate(
//         [{ transform: 'translateY(0)' }, { transform: 'translateY(-8px)' }, { transform: 'translateY(0)' }],
//         { duration: 180, easing: 'ease-out' }
//       );
//     }
//     return {
//       close: () => existing.remove(),
//       el: existing,
//       body: existing.querySelector('.sheet-body'),
//       panel: existingPanel
//     };
//   }
//   if (existing && replaceExisting) existing.remove();

//   // DOM
//   const wrap = document.createElement('div');
//   wrap.className = `sheet-wrap ${classes}`.trim();

//   const backdrop = document.createElement('div');
//   backdrop.className = 'sheet-backdrop';

//   const panel = document.createElement('div');
//   panel.className = 'sheet-panel';
//   if (panelMaxHeight) panel.style.maxHeight = panelMaxHeight;
//   if (panelHeight)    panel.style.height    = panelHeight;

//   const handle = document.createElement('span');
//   handle.className = 'sheet-handle';

//   const header = document.createElement('div');
//   header.className = 'sheet-header';

//   const h = document.createElement('div');
//   h.className = 'sheet-title';
//   h.textContent = title || '';

//   const closeBtn = document.createElement('button');
//   closeBtn.className = 'sheet-close';
//   closeBtn.innerHTML = '✕';

//   const body = document.createElement('div');
//   body.className = 'sheet-body';

//   header.append(h, closeBtn);
//   panel.append(handle, header, body);
//   wrap.append(backdrop, panel);
//   document.body.appendChild(wrap);

//   // --- fermeture (définie AVANT usage) ---
//   let detachSwipe = null;
//   const destroy = () => {
//     // détacher swipe + listeners
//     try { detachSwipe?.(); } catch {}
//     backdrop.removeEventListener('click', destroy);
//     closeBtn.removeEventListener('click', destroy);

//     wrap.classList.remove('is-open');
//     setTimeout(() => {
//       wrap.remove();
//       unlockScroll();
//       onClose?.();
//     }, 220);
//   };

//   backdrop.addEventListener('click', destroy);
//   closeBtn.addEventListener('click', destroy);

//   // --- swipe-to-close ---
//   detachSwipe = attachSwipeToClose(handle, header, panel, backdrop, destroy);

//   // contenu
//   mount?.(body, { close: destroy });

//   // open + lock scroll
//   lockScroll();
//   requestAnimationFrame(() => wrap.classList.add('is-open'));

//   return { close: destroy, el: wrap, body, panel };
// }

// /** Attache le swipe; retourne une fonction de nettoyage. */
// function attachSwipeToClose(handleEl, headerEl, panel, backdrop, onClose){
//   let startY = 0, curY = 0, dragging = false;

//   const isStartZone = (tgt) =>
//     tgt.closest('.sheet-handle') || tgt.closest('.sheet-header');

//   const onStart = (e) => {
//     const t = e.touches ? e.touches[0] : e;
//     if (!isStartZone(e.target)) return;
//     dragging = true;
//     startY = curY = t.clientY;
//     document.querySelector('.sheet-wrap')?.classList.add('dragging');
//     panel.style.transition = 'none';
//     backdrop.style.transition = 'none';
//   };

//   const onMove = (e) => {
//     if (!dragging) return;
//     const t = e.touches ? e.touches[0] : e;
//     curY = t.clientY;
//     const dy = Math.max(0, curY - startY);
//     e.preventDefault?.(); // bloque le scroll page pendant le drag
//     panel.style.transform = `translateY(${dy}px)`;
//     backdrop.style.opacity = String(1 - 0.7 * Math.min(1, dy/180));
//   };

//   const onEnd = () => {
//     if (!dragging) return;
//     dragging = false;
//     document.querySelector('.sheet-wrap')?.classList.remove('dragging');
//     panel.style.transition = '';
//     backdrop.style.transition = '';

//     const dy = Math.max(0, curY - startY);
//     if (dy > 120) onClose();
//     else {
//       panel.style.transform = 'translateY(0)';
//       backdrop.style.opacity = '';
//     }
//   };

//   if (window.PointerEvent){
//     panel.addEventListener('pointerdown', onStart, { passive: true });
//     window.addEventListener('pointermove', onMove, { passive: false });
//     window.addEventListener('pointerup',   onEnd,  { passive: true });
//     window.addEventListener('pointercancel', onEnd, { passive: true });
//     return () => {
//       panel.removeEventListener('pointerdown', onStart, { passive: true });
//       window.removeEventListener('pointermove', onMove, { passive: false });
//       window.removeEventListener('pointerup',   onEnd,  { passive: true });
//       window.removeEventListener('pointercancel', onEnd, { passive: true });
//     };
//   } else {
//     panel.addEventListener('touchstart', onStart, { passive: true });
//     window.addEventListener('touchmove',  onMove, { passive: false });
//     window.addEventListener('touchend',   onEnd,  { passive: true });
//     panel.addEventListener('mousedown',   onStart, true);
//     window.addEventListener('mousemove',  onMove, true);
//     window.addEventListener('mouseup',    onEnd,   true);
//     return () => {
//       panel.removeEventListener('touchstart', onStart, { passive: true });
//       window.removeEventListener('touchmove',  onMove, { passive: false });
//       window.removeEventListener('touchend',   onEnd,  { passive: true });
//       panel.removeEventListener('mousedown',   onStart, true);
//       window.removeEventListener('mousemove',  onMove, true);
//       window.removeEventListener('mouseup',    onEnd,   true);
//     };
//   }
// }




// function openSheetCarnet(){
//   openSheet({
//     title: 'Carnet d’adresses',
//     classes: '',          
//     maxHeight: '40vh', 
//     mount: async (body) => {
//       // Ici on injecte la grille :
//       const host = document.createElement('div');
//       host.style.height = '56vh'; // ex: h fixe interne pour scroller dans la sheet
//       host.className = 'ag-theme-quartz compact';
//       body.appendChild(host);

//       // colonnes Carnet
//       const columnDefs = buildColumnsCarnet();

//       // données
//       const rowData = (window.ctx?.carnet ?? []).slice();

//       // options grille (adapte si tu as un factory makeGridOptions)
//       const gridOptions = {
//         columnDefs,
//         rowData,
//         getRowId: p => p.data?.__uuid,
//         defaultColDef: { resizable: true, sortable: true, filter: true, editable: true },
//         suppressRowClickSelection: false,
//         rowSelection: 'single',
//       };

//       const api = window.agGrid.createGrid(host, gridOptions);

//       // sizing initial
//       setTimeout(() => api.onGridSizeChanged?.(), 0);

//       // cleanup renvoyé au sheet manager
//       return () => api.destroy?.();
//     }
//   });
// }

// function openSheetCarnet() {
//   openSheet({
//     title: 'Carnet d’adresses',
//     classes: '',          
//     maxHeight: '40vh', 
//     mount: (body /* HTMLElement */, api) => {
//       // 1) conteneur de la grille
//       const host = document.createElement('div');
//       host.className = 'sheet-grid-host';

//       const gridDiv = document.createElement('div');
//       gridDiv.id = 'grid-carnet-sheet';                  // id local pour cette sheet
//       gridDiv.className = 'ag-theme-quartz compact';     // ton thème
//       host.appendChild(gridDiv);

//       // 2) footer d’actions
//       const actions = document.createElement('div');
//       actions.className = 'sheet-actions';
//       actions.innerHTML = `
//         <button class="btn btn-primary" id="btn-carnet-add">Ajouter</button>
//         <button class="btn btn-danger"  id="btn-carnet-del">Supprimer</button>
//       `;

//       // 3) on injecte dans le body de la sheet
//       body.append(host, actions);

//       // 4) créer/brancher la grille (réutilise ton createGridController si possible)
//       //    Exemple minimal (adapte à ta factory et tes colonnes réelles) :
//       const columns = [
//         { field:'Nom', headerName:'Nom', editable:true },
//         { field:'Adresse', headerName:'Adresse', editable:true, flex:1 },
//         { field:'Tel', headerName:'Téléphone', editable:true, width:120 },
//         { field:'Web', headerName:'Web', editable:true, flex:1 },
//       ];
//       const gridOptions = {
//         columnDefs: columns,
//         rowData: (window.ctx?.carnet || []),  // données actuelles
//         getRowId: p => p.data?.__uuid,
//         defaultColDef: { resizable:true, sortable:true, filter:true },
//         rowSelection: 'single',
//         // important pour style mobile
//         suppressDragLeaveHidesColumns: true,
//         suppressColumnMoveAnimation: true,
//       };

//       const apiGrid = window.agGrid.createGrid(gridDiv, gridOptions);

//       // 5) câbler les boutons
//       const btnAdd = actions.querySelector('#btn-carnet-add');
//       const btnDel = actions.querySelector('#btn-carnet-del');

//       btnAdd.addEventListener('click', () => {
//         const row = {
//           __uuid: crypto.randomUUID(),
//           Nom: 'Nouveau lieu',
//           Adresse: '',
//           Tel: '',
//           Web: ''
//         };
//         window.ctx?.mutateCarnet?.(rows => [...(rows||[]), row]);

//         // recharge visuel rapide (si pas d’écouteur ctx → grille locale) :
//         apiGrid.setGridOption?.('rowData', window.ctx?.carnet || []);
//         // sélectionner la ligne ajoutée
//         setTimeout(() => {
//           let node = null;
//           apiGrid.forEachNode?.(n => { if (!node && n.data?.__uuid === row.__uuid) node = n; });
//           node?.setSelected?.(true, true);
//           apiGrid.ensureIndexVisible?.(node?.rowIndex ?? 0, 'middle');
//         }, 0);
//       });

//       btnDel.addEventListener('click', () => {
//         const sel = apiGrid.getSelectedRows?.()?.[0];
//         if (!sel) return;
//         window.ctx?.mutateCarnet?.(rows => (rows||[]).filter(r => r.__uuid !== sel.__uuid));
//         apiGrid.setGridOption?.('rowData', window.ctx?.carnet || []);
//       });

//       // 6) Pour écouter les changements ctx → rafraîchir la grille:
//       const off = window.ctx?.on?.('carnet:changed', () => {
//         apiGrid.setGridOption?.('rowData', window.ctx?.carnet || []);
//       });

//       // 7) démonter proprement si la sheet se ferme
//       api?.close && (api.onClose = () => { off?.(); /* + cleanup si besoin */ });
//     }
//   });
// }

function openSheetCarnet() {
  let offHist = null;     // history:change (domain=carnet)
  let offCarnet = null;   // carnet:changed (données)
  openSheetExclusive({
    title: 'Carnet d’adresses',
    panelMaxHeight: '60vh',
    panelHeight: '40vh',
    mount: (body) => {
      // host grille
      const host = document.createElement('div');
      host.className = 'sheet-grid-host';

      const gridDiv = document.createElement('div');
      gridDiv.id = 'grid-carnet-sheet';
      gridDiv.className = 'ag-theme-quartz compact';
      host.appendChild(gridDiv);

      // footer actions (icônes + labels)
      const actions = document.createElement('div');
      actions.className = 'sheet-actions';
      actions.innerHTML = `
        <button class="icon-btn" id="btn-carnet-add" title="Ajouter">
          <svg class="bb-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="12" y1="5" x2="12" y2="19"/>
            <line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          <span class="label">Ajouter</span>
        </button>
        <button class="icon-btn" id="btn-carnet-del" title="Supprimer">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none"
              stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
            <!-- couvercle -->
            <path d="M3 6h18" />
            <path d="M8 6l1-2h6l1 2" />
            <!-- corps -->
            <rect x="5" y="6" width="14" height="15" rx="2" ry="2" />
            <!-- poignées intérieures -->
            <line x1="10" y1="10" x2="10" y2="17" />
            <line x1="14" y1="10" x2="14" y2="17" />
          </svg>
          <span class="label">Supprimer</span>
        </button>
        <!-- Bouton Défaire -->
        <button class="icon-btn" id="btn-carnet-undo">
          <svg class="bb-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M3 7v6h6M3 13a9 9 0 1 0 9-9"/>
          </svg>
          <span class="bb-label">Défaire</span>
        </button>

        <!-- Bouton Refaire -->
        <button class="icon-btn" id="btn-carnet-redo">
          <svg class="bb-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 7v6h-6M21 13a9 9 0 1 1-9-9"/>
          </svg>
          <span class="bb-label">Refaire</span>
        </button>
      `;

      // injecte dans la sheet
      body.append(host, actions);

      // grille 
      const columns = [
        { field:'Nom', headerName:'Nom', minWidth:100, flex:1, editable:true },
        { field:'Adresse', headerName:'Adresse', minWidth:200, flex:2, editable:true },
        { field:'Tel', headerName:'Téléphone', minWidth:100, flex:1, editable:true, cellRenderer: TelRenderer },
        { field:'Web', headerName:'Web', minWidth:200, flex: 2, editable:true, cellRenderer: WebRenderer },
        // { field:'Web', headerName:'Web', minWidth:200, flex:2, editable:true,
        //   cellRendererSelector: () => ({ component: 'web91Renderer' })
        // },
      ];

      // const gridOptions = {
      //   columnDefs: columns,
      //   rowData: (window.ctx?.carnet || []),
      //   getRowId: p => p.data?.__uuid,
      //   defaultColDef: { editable: true, resizable: true, sortable: true, filter: true },
      //   onGridReady: (params) => {
      //     const root = params.api.getGui();                 // racine de la grille
      //     enableTouchEdit(params.api, root, { debug: false });
      //   },       
      //   rowSelection: 'single',
      //   onCellValueChanged: (p) => {
      //     if (p.colDef.field == "Date") return;
      //     const uuid = p.node.id;
      //     let ca = ctx.getCarnet().slice(); 
      //     const idx = ca.findIndex(a => a.__uuid === uuid);
      //     if (idx < 0) return;
      //     ca[idx] = { ...ca[idx], ...p.data }; 
      //     ca = sortCarnet(ca);
      //     ctx.setCarnet(ca);        
      //   },
      //   singleClickEdit: false,
      //   suppressClickEdit: false, 
      //   stopEditingWhenCellsLoseFocus: true,
      // };
      const gridOptions = {
        columnDefs: columns,
  // components: {                 // <— enregistre les classes ici
  //   telRenderer: TelRenderer,
  //   webRenderer: Web91Renderer,
  // },
        rowData: (window.ctx?.carnet || []),
        getRowId: p => p.data?.__uuid,

        // ✅ une seule fois
        defaultColDef: { editable:true, resizable:true, sortable:true, filter:true },

        onGridReady: (params) => {
          // const root =
          //   params.api?.getGui?.()                              // si dispo
          //   || params.eGridDiv                                  // standard, toujours là
          //   || params.api?.getGridBodyElement?.()               // autre API selon version
          //   || document.querySelector('#grid-carnet-sheet .ag-root'); // dernier recours si tu connais l’id
          // root.style.touchAction = 'manipulation'; // iOS: aide les gestes
        },
        rowSelection: 'single',
        onCellValueChanged: (p) => {
          // Demarre explicitement l’édition sur la cellule double-tapée
          p.api.startEditingCell({
            rowIndex: p.rowIndex,
            colKey: p.column.getColId?.() || p.colDef.field
          });
          if (p.colDef.field === 'Date') return;
          const uuid = p.data?.__uuid;            // ✅ plus fiable que p.node.id
          if (!uuid) return;
          // mets à jour le carnet via le contexte
          const patch = { [p.colDef.field]: p.newValue };
          ctx.mutateCarnet(rows => {
            const i = rows.findIndex(a => a.__uuid === uuid);
            if (i < 0) return rows;
            const next = rows.slice();
            next[i] = { ...next[i], ...patch };
            return sortCarnet(next);
          });
        },
        suppressDragLeaveHidesColumns: true,
        singleClickEdit: false,
        suppressClickEdit: false,
        stopEditingWhenCellsLoseFocus: true,
        onCellEditingStarted: () => {
          const wrap = document.querySelector('.sheet-wrap.is-open');
          markSheetEditing(wrap, true);
        },
        onCellEditingStopped: () => {
          const wrap = document.querySelector('.sheet-wrap.is-open');
          markSheetEditing(wrap, false); // => attend le settle puis réactive le swipe
        },
        rowSelection: 'single',
        onSelectionChanged(params) {
          const hasSel = params.api.getSelectedRows().length > 0;
          const btnDel = document.getElementById('btn-carnet-del');
          btnDel?.toggleAttribute('disabled', !hasSel);
        },
      };

      const apiGrid = window.agGrid.createGrid(gridDiv, gridOptions);
      
      // ➜ enregistre dans le registre des sheets
      window.sheetGrids.set('grid-carnet', { api: apiGrid, el: gridDiv });

      // // désactive le swipe pendant l’édition, réactive après
      // const wrap = gridDiv.closest('.sheet-wrap');
      // if (wrap && apiGrid?.addEventListener) {
      //   apiGrid.addEventListener('cellEditingStarted', () => {
      //     wrap.dataset.swipeDisabled = '1';
      //   });
      //   apiGrid.addEventListener('cellEditingStopped', () => {
      //     delete wrap.dataset.swipeDisabled;
      //     wrap.dataset.lastEditEndedAt = String(Date.now());
      //   });
      // }

      // ⚠️ Très important : cibler la *bonne* racine de CETTE grille
      requestAnimationFrame(() => {
        const root = gridDiv.querySelector('.ag-root') || gridDiv;
        enableTouchEdit(apiGrid, root, { debug:false });
      });

      // const testRoot = gridDiv.querySelector('.ag-root') || gridDiv;
      // ['pointerdown','pointerup','click','dblclick','touchstart','touchend'].forEach(ev=>{
      //   testRoot.addEventListener(ev, e => {
      //     logToPage('EVENT:', ev, e.pointerType || 'touch', Date.now());
      //   }, { passive: true });
      // });

      // actions
      const btnAddC = actions.querySelector('#btn-carnet-add');
      const btnDelC = actions.querySelector('#btn-carnet-del');
      const btnUndoC = actions.querySelector('#btn-carnet-undo');
      const btnRedoC = actions.querySelector('#btn-carnet-redo');

      const getNouveauNom = (df, prefix='Nom') => {
        if (!Array.isArray(df)) return prefix;
        if (!prefix) prefix = 'Nom';

        // 🔹 Extraire les noms existants
        const nomsExistants = df
          .map(r => (r.Nom ?? '').toString().trim())
          .filter(n => n.length > 0);

        // 🔹 Initialiser ou incrémenter un compteur
        let compteurNouveauNom = 0;

        // 🔹 Boucle de recherche d’un nom libre
        while (true) {
          compteurNouveauNom += 1;
          const nomCandidat = (prefix != 'Nom' && compteurNouveauNom == 1) ? `${prefix}` : `${prefix} ${compteurNouveauNom}`;
          if (!nomsExistants.includes(nomCandidat)) {
            return nomCandidat;
          }
        }
      }

      const selectRow = (uuid) => {
        let node = null;
        apiGrid.forEachNode?.(n => { if (!node && n.data?.__uuid === uuid) node = n; });
        node?.setSelected?.(true, true);
        apiGrid.ensureIndexVisible?.(node?.rowIndex ?? 0, 'middle');
      }

      btnAddC.addEventListener('click', () => {
        const row = { __uuid: crypto.randomUUID(), Nom: getNouveauNom(ctx.carnet), Adresse:'', Tel:'', Web:'' };
        ctx?.mutateCarnet?.(rows => [...(rows||[]), row]);
        setTimeout(selectRow(row.__uuid), 0);
      });

      btnDelC.addEventListener('click', () => {
        const sel = apiGrid.getSelectedRows?.()?.[0];
        if (!sel) return;
        const voisin = getLigneVoisineUuid(ctx.carnet, sel.__uuid)
        ctx?.mutateCarnet?.(rows => (rows||[]).filter(r => r.__uuid !== sel.__uuid));
        setTimeout(selectRow(voisin), 0);
      });

      btnUndoC.addEventListener('click', () => { 
        ctx.undo('carnet'); 
      });
      btnRedoC.addEventListener('click', () => { 
        ctx.redo('carnet'); 
      });

      const updateCarnetHistoryButtons = (st) => {
        btnUndoC?.toggleAttribute('disabled', !st.canUndo);
        btnRedoC?.toggleAttribute('disabled', !st.canRedo);
      };

      // init état au mount
      updateCarnetHistoryButtons(ctx.historyState('carnet'));

      // synchro ÉTAT undo/redo (history:change pour domain=carnet)
      offHist = ctx.on('history:change', ({ domain, ...st }) => {
        if (domain === 'carnet') updateCarnetHistoryButtons(st);
      });

      // synchro DONNÉES (carnet:changed → rafraîchit la grille)
      offCarnet = ctx.on('carnet:changed', () => {
        apiGrid.setGridOption?.('rowData', window.ctx?.carnet || []);
      });

      // Selection de la première ligne
      if (ctx.carnet?.length) selectRow(ctx.carnet?.[0].__uuid);
    },
    onClose: () => { 
      offCarnet?.(); 
      offHist?.() 

      // ➜ nettoyage du registre des sheet grids
      window.sheetGrids.delete('grid-carnet');
    },
  });
}

// Feuilles paramètres
function openSheetParams(){
  const meta = (window.ctx?.meta) || {};
  const curDeb = meta.periode_a_programmer_debut?.toISOString().slice(0,10) || ''; 
  const curFin = meta.periode_a_programmer_fin?.toISOString().slice(0,10) || ''; 
  const marge      = Math.max(0, Number(meta.MARGE ?? 10)|0);
  const dureeRepas = Math.max(0, Number(meta.DUREE_REPAS ?? 60)|0);
  const dureeCafe = Math.max(0, Number(meta.DUREE_CAFE ?? 60)|0);
  const itin          = String(meta.itineraire_app || 'Google Maps Web');
  const cityDefault   = String(meta.city_default || 'Avignon');

  openSheetExclusive({
    title: 'Paramètres',
    panelMaxHeight: '42rem',
    panelHeight: '42rem',
    replaceExisting: true,
    mount: (body, { close }) => {
      body.innerHTML = `
        <div class="form">

          <div class="form-row">
            <label for="pp-debut">Début de la période de programmation</label>
            <input id="pp-debut" type="date"  value="${curDeb}">
          </div>

          <div class="form-row">
            <label for="pp-fin">Fin de la période de programmation</label>
            <input id="pp-fin" type="date"  value="${curFin}">
          </div>

          <div class="form-row">
            <label>Marge entre activités (min)</label>
            <input id="p-marge" type="number" min="0" step="5" value="${marge}"/>
          </div>

          <div class="form-row">
            <label>Durée des pauses repas (min)</label>
            <input id="p-repas" type="number" min="0" step="5" value="${dureeRepas}"/>
          </div>

          <div class="form-row">
            <label>Durée des pauses café (min)</label>
            <input id="p-cafe" type="number" min="0" step="5" value="${dureeCafe}"/>
          </div>

          <div class="form-row">
            <label>Application tinéraire</label>
            <select id="p-itin">
              <option ${itin==='Google Maps Web' ? 'selected':''}>Google Maps Web</option>
              <option ${itin==='Google Maps App' ? 'selected':''}>Google Maps App</option>
              <option ${itin==='Apple Maps' ? 'selected':''}>Apple Maps</option>
            </select>
          </div>

          <div class="form-row">
            <label>Ville par défaut</label>
            <input id="p-city" type="string" value="${cityDefault}"/>
          </div>

          <div class="form-actions">

            <!-- Bouton Annuler -->
            <button class="bb-btn is-primary" id="p-cancel">
              Annuler
            </button>

            <!-- Bouton Enregistrer -->
            <button class="bb-btn is-primary" id="p-save">
              Enregistrer
            </button>

          </div>
          
        </div>
      `;

      const $deb = body.querySelector('#pp-debut');
      const $fin = body.querySelector('#pp-fin');
      const $mar = body.querySelector('#p-marge');
      const $rep = body.querySelector('#p-repas');
      const $caf = body.querySelector('#p-cafe');
      const $it  = body.querySelector('#p-itin');
      const $ci  = body.querySelector('#p-city');

      body.querySelector('#p-cancel')?.addEventListener('click', close);

      body.querySelector('#p-save')?.addEventListener('click', () => {
        const d1 = $deb.value;
        const d2 = $fin.value;

        if (!d1 || !d2 || d2 < d1) {
          alert('Dates invalides (fin >= début).');
        }

        const mar = Math.max(0, Number($mar.value||0)|0);
        const rep = Math.max(0, Number($rep.value||0)|0);
        const caf = Math.max(0, Number($caf.value||0)|0);
        const it = $it.value;
        const ci = $ci.value;

        window.ctx?.setMeta({
          periode_a_programmer_debut: d1,
          periode_a_programmer_fin:   d2,
          MARGE:          mar,
          DUREE_REPAS:    rep,
          DUREE_CAFE:     caf,
          itineraire_app: it,
          city_default:   ci,
        });

        // si des calculs/affichages dépendent de ces params :
        refreshAllGrids?.();

        close();
      });
    }
  });
}

function openSheetAide() {
  openSheetExclusive({
    title: 'Aide',
    panelMaxHeight: '70vh',
    panelHeight: '60vh',
    mount: (body) => {
      body.innerHTML = `
        <div class="help-block">
          <h4>Gestes utiles</h4>
          <ul>
            <li><b>Swipe bas</b> sur l’entête de la sheet → fermer</li>
            <li><b>Double-tap</b> sur une cellule → éditer (iOS OK)</li>
            <li><b>Long-press</b> (desktop : clic) sur 🔗/📍 → ouvrir le lien</li>
          </ul>
          <h4>Programmation</h4>
          <p>Choisissez une date dans la colonne <i>Date</i> (grille activités). Les lignes sélectionnées se
             mettent en évidence; la ligne nouvellement programmée est auto-centrée.</p>
          <h4>Contact</h4>
          <ul>
            <li>📧 support@example.com</li>
          </ul>
        </div>
      `;
    }
  });
}

// ------- Boot -------
function wireContext() {

  // Initialisation de la periode de programmation si contexte vide
  if (!ctx.df) activitesAPI.initPeriodeProgrammation();

  ctx.on('df:changed',        () => refreshActivitesGrids()); // scheduleGlobalRefresh());
  // ctx.on('carnet:changed',    () => refreshCarnetGrid()); // scheduleGlobalRefresh());
  ctx.on('history:change', ({ domain, ...st })  => {
    if (domain === 'df') {
      document.getElementById('btn-undo')?.toggleAttribute('disabled', !st.canUndo);
      document.getElementById('btn-redo')?.toggleAttribute('disabled', !st.canRedo);
    }
  });

  // état initial des boutons Undo/Redo
  const st = ctx.historyState ? ctx.historyState() : { canUndo: false, canRedo: false };
  document.getElementById('btn-undo')?.toggleAttribute('disabled', !st.canUndo);
  document.getElementById('btn-redo')?.toggleAttribute('disabled', !st.canRedo);
}

function initSheetGrids() {
  window.sheetGrids = window.sheetGrids || new Map();
}

document.addEventListener('DOMContentLoaded', async () => {
  console.log('⏳ DOM prêt, initialisation du contexte...');

  // 1️⃣ Contexte métier (singleton)
  window.ctx = await AppContext.ready();

  // Creation de l'API pour le module activites.js
  activitesAPI = creerActivitesAPI(ctx);

  // 2️⃣ Branchements UI
  wireContext();
  wireBottomBar();
  wireGrids();
  wireExpanders();
  wireExpanderSplitters();
  addExpanderButtons();
  wireAppKebab();
  initSheetGrids();

  // 3️⃣ Premier rendu
  // await refreshAllGrids();
  // appJustLaunched = false;

  console.log('✅ Application initialisée');
});
