// app.js (module)

import { 
  parseHHhMM, 
  excelSerialToYMD, 
  prettyToDateint, 
  dateintToPretty, 
  ymdToDateint, 
  safeDateint, 
  toDateint,
  isoDateToLocalDate,
  localDateToIsoDate,
  recalcFinForAll,
  recalcFin,
  isDateint,
} from './utils-date.js';

import { 
  isIOS,
  logToPage,
  looksLikeUrl, 
  mergeRowsNoDup,
  mergeRowsNoDupMultiKey, 
  overloadRowsOrInsert,
  estNumerique,
  capitalizeFirst,
} from './utils.js';

import { creerActivitesAPI, sortDf } from './activites.js'; 
import { sortCarnet } from './carnet.js'; 
import { AppContext } from './AppContext.js';
import { ActiviteRenderer } from './ActiviteRenderer.js';
import { LieuRenderer } from './LieuRenderer.js';
import { TelRenderer } from './TelRenderer.js';
import { WebRenderer } from './WebRenderer.js';

import {
  PARSED_DEFAULT, 
  parseAvignonInProgPageUrl, 
  parseAvignonInSpecPageUrl, 
  parseAvignonOffProgPageUrl, 
  parseAvignonOffSpecPageUrl, 
  parseBilletReducProgPageUrl,
  parseBilletReducSpecPageUrl,
  parseBilletReducCollecPageUrl,

  parseAvignonInProgPageText,
  parseAvignonInSpecPageText, 
  parseAvignonOffProgPageText,
  parseAvignonOffSpecPageText, 
  
  isAvignonInProgPageText,
  isAvignonInSpecPageText,
  isAvignonOffProgPageText,
  isAvignonOffSpecPageText,
} from './parsers.js';

import {
  rowsToICS,
} from './calendrier.js';

// Colonnes obligatoires d'un tableau d'activités
const MANDATORY_COLS = new Set([
  'Activite',
  'Date',
  'Debut',
  'Duree',
  'Fin',
  'Lieu',
  'Session',
  'Relache',
  'Style',
  'Orga',
  'Reserve',
  'Priorite',
  'Hyperlien',
  '__uuid'
]);

// ------- Interface Activités -------
let activitesAPI = null;

// ------- Multi-grilles -------
const grids = new Map();           // id -> { api, el, loader }
window.grids = grids;
let activeGridId = null;

// ------- Créneau sélectionné -------
let selectedSlot = null;

// ------- Etat local pour le double-tap -------
let lastTapKey = null;
let lastTapTime = 0;
const TAP_DELAY_MS = 350; // fenêtre de double-tap
const isTouchDevice = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);

// ------- Constantes dates -------
const TODAY = new Date();
const CUR_Y = TODAY.getFullYear();
const CUR_M = TODAY.getMonth() + 1;

// ------- Phantom flight -------
const PHANTOM_WITH_OFFSET = false;      // effet fantôme avec ou sans offset 
const PHANTOM_DEFAULT_OFFSET = 0;   // décalage horizontal par default de la trajectoire de l'effet fantôme
const PHANTOM_DEFAULT_DURATION = 680;  // durée par default de la trajectoire de l'effet fantôme

const overlayAttente = document.getElementById('overlay-attente'); // overlay d'attente

// ------- Debug -------
const DEBUG = false;
function getCaller(depth = 2) {
  try {
    throw new Error();
  } catch (e) {
    const stack = e.stack?.split("\n")[depth] || "";
    let match = stack.match(/at\s+(.*?)\s/);
    if (!match) { match = stack.match(/^([^\s@]+)/); }
    return match ? match[1] : "anonymous";
  }
}
const log = (...a) => { if (DEBUG) console.debug(`[${getCaller(2)}]`, ...a); };

// ------- Misc Helpers -------
const ROW_H=32, HEADER_H=32, PAD=4;
const hFor = n => HEADER_H + ROW_H * Math.max(0,n) + PAD;

const $ = id => document.getElementById(id);
const waitAF = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

const dateintStrToPretty = (d) => dateintToPretty(Number(d)); 

// Récupère l'API d'une grille par son id (selon ta structure window.grids)
function getGridApiById(gridId) {
  return window.grids?.get(gridId)?.api || null;
}

// Renvoie la ligne voisine (suivante ou précédente) d'une row donnée par son uuid.
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

// Renvoie le __uuid de la ligne voisine (suivante ou précédente) d'une row donnée par son uuid.
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

// Appel d'une fonction asynchrone avec affichage overlay attente
async function asyncCallAvecOverlayAttente(fnct, param, msg="Echec") {
  const overlayAttente = document.getElementById('overlay-attente'); // overlay d'attente
  let res = null;
  try {
    overlayAttente.hidden = false; // Affiche l'overlay d'attente
    res = await fnct(param);
  }
  catch (e) {
    console.error('❌ ' + msg + ' : ' + e);
    alert('❌ ' + msg + ' : ' + e.message);
  } finally {
    overlayAttente.hidden = true; // Masque l'overlay d'attente
    return res;
  }
}

// Appel d'une fonction synchrone avec affichage overlay attente
function syncCallAvecOverlayAttente(fnct, param, msg="Echec") {
  const overlayAttente = document.getElementById('overlay-attente'); // overlay d'attente
  let res = null;
  try {
    overlayAttente.hidden = false; // Affiche l'overlay d'attente
    res = fnct(param);
  }
  catch (e) {
    console.error('❌ ' + msg + ' : ' + e);
    alert('❌ ' + msg + ' : ' + e.message);
  } finally {
    overlayAttente.hidden = true; // Masque l'overlay d'attente
    return res;
  }
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
  'validite': 'Session',
  'session': 'Session',
  'sessions': 'Session',
  'seance': 'Session',
  'seances': 'Session',
  'relache': 'Relache',
  'relaches': 'Relache',
  'reserve': 'Reserve',
  'priorite': 'Priorite',
  // tolérances diverses
  'debut (HHhMM)': 'Debut',
  'duree (HhMM)': 'Duree',
  'tel': 'Tel',
  'telephone': 'Tel',
  'site web': 'Web',
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

  const rowsWanted = (displayedRows > 0) ? displayedRows : 2; // ✅ 2 lignes si vide 
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
function desiredPaneHeightForRows(pane, gridEl, api, gridId,  { nbRows=null, nbRowsPred=null, maxRows = 5 } = {}) {
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
  let n = Math.min(maxRows, nbRows);
  if (nbRows > maxRows) { // dans ce cas on interdit seulement de dépasser le nombre de lignes du tableau à afficher
    if (displayed >= nbRows) { 
      n = nbRows;         // interdiction de dépasser le nombre de lignes du tableau à afficher
    } else if (nbRows <= nbRowsPred) {

      // if (gridId === 'grid-programmables') {
      //   logToPage(`nb calculé pour grid-programmables: no autoresize nbRows: ${nbRows} nbRowsPred: ${nbRowsPred}`);
      // }

      return null;        // pas de resize auto
    }
  } 

  // padding interne du pane si il y en a (à ajuster si nécessaire)
  const paddingPane = (nbRows > n) ? 8: 0;

  const desired = Math.round(hHeader + (rowH * n) + paddingPane);
  return Math.max(desired, hHeader + 8);
}

// Retaille en fonction du row count
function autoSizePanelFromRowCount(pane, gridEl, api, gridId, { nbRows=null, nbRowsPred=null, maxRows = 5 } = {}) {
  if (!pane || !gridEl) return;

  const exp = pane.closest('.st-expander');
  const isOpen = exp?.classList?.contains?.('open');
  const isClosing = exp?.classList?.contains?.('is-closing');
  const userSized = pane.dataset.userSized === '1';

  // Hauteur calculée : on ne dépasse pas rowCount et on autosize si rowCount < 5
  const h = desiredPaneHeightForRows(pane, gridEl, api, gridId, { nbRows, nbRowsPred,  maxRows });
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

// Ouverture Expander 
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

// Fermeture Expander 
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
  if (!h || !uuid) return { api: null, node: null, rowEl: null, el: h?.el || null }; //, nbRowsPred: null };

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

function findPageScroller(fromEl){
  if (!fromEl) return document.scrollingElement || document.documentElement;

  // Tout ce qui est scroller *interne* à AG Grid (à ignorer)
  const AG_DENY = [
    '.ag-root',
    '.ag-body-viewport',
    '.ag-center-cols-viewport',
    '.ag-theme-quartz',
  ];

  // remonte dans la hiérarchie
  let el = fromEl;
  while (el && el !== document.documentElement){
    // si on tombe sur la page du pager → c'est notre scroller cible
    if (el.classList?.contains('page')) return el;

    // si c'est un scroller "valide" mais pas AG Grid → ok
    const style = el instanceof Element ? getComputedStyle(el) : null;
    if (style && /(auto|scroll)/.test(style.overflowY || '')){
      const isAg = AG_DENY.some(sel => el.matches?.(sel));
      if (!isAg) return el;
    }
    el = el.parentElement || el.parentNode;
  }
  // fallback : document
  return document.scrollingElement || document.documentElement;
}
function scrollBottomIntoView(target, scroller, {
  pad = 8,            // coussin visuel
  extraPad = 0,       // safe-area + bottom-bar, etc.
  behavior = 'smooth',
} = {}){
  if (!target) return;

  // Choisit le bon scroller si non fourni
  const sc = scroller || findPageScroller(target);

  const tRect = target.getBoundingClientRect();
  const sRect = sc.getBoundingClientRect();

  // combien "dépasse" le bas du target par rapport au bas visible du scroller
  const overflow = (tRect.bottom + pad) - (sRect.bottom - extraPad);

  if (overflow <= 0) return; // déjà visible

  const maxTop = Math.max(0, sc.scrollHeight - sc.clientHeight);
  const newTop = Math.min(maxTop, sc.scrollTop + overflow);

  // document vs élément : choisir le bon appel
  if (sc === document.scrollingElement || sc === document.documentElement || sc === document.body) {
    window.scrollTo({ top: newTop, behavior });
  } else {
    sc.scrollTo({ top: newTop, behavior });
  }
}

function getSafeBottomPx(){
  // si tu as déjà getSafeBottom(), réutilise-la
  const s = getComputedStyle(document.documentElement).getPropertyValue('env(safe-area-inset-bottom)');
  const v = parseFloat(s) || 0;
  return v;
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

// Rend visible un expander (async)
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

// Ouvre un expander (async)
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

// Attend qu'un expander soit rendu avant d'appeler cb
function ensureExpanderReady(expanderId, cb, { timeout = 3000 } = {}) {
  const exp = document.getElementById(expanderId);
  const header = exp?.querySelector('.st-expander-header');
  if (header) { cb(); return; }

  const start = performance.now();
  const obs = new MutationObserver(() => {
    const h = document.getElementById(expanderId)?.querySelector('.st-expander-header');
    if (h) { obs.disconnect(); cb(); }
    else if (performance.now() - start > timeout) { obs.disconnect(); }
  });
  obs.observe(document.body, { childList: true, subtree: true });
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
  if (actions.querySelector('#' + id)) return;

  const btn = document.createElement('button');
  btn.id = id;
  btn.className = 'exp-header-btn';
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

function wireExpanderButtons() {

  // Bouton Filtres sur Activités Programmées
  if (agGridHasHeaderFilters('grid-non-programmees')) addExpanderButton({
    expanderId: 'exp-programmees',
    id: 'btn-filtrer-prog',
    title: 'Filtrer', 
    innerHTML: `
      <span class="exp-icon" aria-hidden="true">
        <!-- Icône Filtre en forme d'entonnoir -->
        <svg viewBox="0 0 24 24" width="24" height="24"
            fill="none" stroke="currentColor" stroke-width="1.8"
            stroke-linecap="round" stroke-linejoin="round"
            aria-hidden="true" focusable="false">
          <!-- entonnoir -->
          <path d="M3 4h18l-7 8v5l-4 2v-7L3 4z"/>
        </svg>
      </span>
      <span class="exp-label">Filtrer</span>
    `,
    onClick: () => { openSheetFiltres('grid-programmees'); },
  });

  // Bouton Déprogrammer sur Activités Programmées
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
      <span class="exp-label">Supprimer</span>
    `,
    onClick: async () => {await doDeprogrammerActivite();},
  });
  
  // Bouton Filtres sur Activités Programmables
  if (agGridHasHeaderFilters('grid-programmables')) addExpanderButton({
    expanderId: 'exp-programmables',
    id: 'btn-filtrer-programmables',
    title: 'Filtrer', 
    innerHTML: `
      <span class="exp-icon" aria-hidden="true">
        <!-- Icône Filtre en forme d'entonnoir -->
        <svg viewBox="0 0 24 24" width="24" height="24"
            fill="none" stroke="currentColor" stroke-width="1.8"
            stroke-linecap="round" stroke-linejoin="round"
            aria-hidden="true" focusable="false">
          <!-- entonnoir -->
          <path d="M3 4h18l-7 8v5l-4 2v-7L3 4z"/>
        </svg>
      </span>
      <span class="exp-label">Filtrer</span>
    `,
    onClick: () => { openSheetFiltres('grid-programmables'); },
  });

  // Bouton Programmer sur Activités Programmables
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
    onClick: async () => {await doProgrammerActivite();},
  });

  // Bouton Colonnes sur Activités Non Programmées
  if (agGridHasHeaderFilters('grid-non-programmees')) addExpanderButton({
    expanderId: 'exp-non-programmees',
    id: 'btn-col-non-prog',
    title: 'Colonnes', 
    innerHTML: `
      <span class="exp-icon" aria-hidden="true">
        <!-- Icône Colonnes -->
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
            stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 8a4 4 0 1 1 0 8a4 4 0 0 1 0-8z" />
          <path d="M3 12h2m14 0h2M12 3v2m0 14v2
                  M5.6 5.6l1.4 1.4M17 17l1.4 1.4
                  M17 7l1.4-1.4M5.6 18.4L7 17" />
        </svg>
      </span>
      <span class="exp-label">Colonnes</span>
    `,
    onClick: () => {
      openKebabMenu($('btn-col-non-prog'), {
        items: [
          { id:'add-column',       label:"Ajouter",        onClick: ()=>doAjouterColonne() },
          { id:'suppress-column',  label:'Supprimer',      onClick: ()=>doSupprimerColonne() },
        ]
      });
    },
  });

  // Choix de svg pour le Bouton Colonnes
  // <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"
  //     stroke-linecap="round" stroke-linejoin="round">
  //   <circle cx="12" cy="12" r="3"></circle>
  //   <path d="M19.4 15a1.7 1.7 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.82-.33
  //           1.7 1.7 0 0 0-1 1.54V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1-1.54 1.7 1.7 0 0 0-1.82.33l-.06.06
  //           a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .33-1.82 1.7 1.7 0 0 0-1.54-1H3a2 2 0 1 1 0-4h.09
  //           a1.7 1.7 0 0 0 1.54-1 1.7 1.7 0 0 0-.33-1.82l-.06-.06A2 2 0 0 1 7.07 3.4l.06.06a1.7 1.7 0 0 0 1.82.33
  //           1.7 1.7 0 0 0 1-1.54V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.54 1.7 1.7 0 0 0 1.82-.33l.06-.06
  //           a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.33 1.82 1.7 1.7 0 0 0 1.54 1H21a2 2 0 1 1 0 4h-.09
  //           a1.7 1.7 0 0 0-1.54 1Z"/>
  // </svg>

  // <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" fill="none" stroke-width="2">
  //   <rect x="3"  y="5" width="4" height="14" rx="1"></rect>
  //   <rect x="10" y="5" width="4" height="14" rx="1"></rect>
  //   <rect x="17" y="5" width="4" height="14" rx="1"></rect>
  // </svg>

  // <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" fill="none" stroke-width="2">
  //   <rect x="3" y="5" width="18" height="14" rx="2"></rect>
  //   <line x1="9" y1="5" x2="9" y2="19"></line>
  //   <line x1="15" y1="5" x2="15" y2="19"></line>
  //   <circle cx="12" cy="12" r="2"></circle>
  // </svg>

  // Bouton Filtres sur Activités Non Programmées
  if (agGridHasHeaderFilters('grid-non-programmees')) addExpanderButton({
    expanderId: 'exp-non-programmees',
    id: 'btn-filtrer-non-prog',
    title: 'Filtrer', 
    innerHTML: `
      <span class="exp-icon" aria-hidden="true">
        <!-- Icône Filtre en forme d'entonnoir -->
        <svg viewBox="0 0 24 24" width="24" height="24"
            fill="none" stroke="currentColor" stroke-width="1.8"
            stroke-linecap="round" stroke-linejoin="round"
            aria-hidden="true" focusable="false">
          <!-- entonnoir -->
          <path d="M3 4h18l-7 8v5l-4 2v-7L3 4z"/>
        </svg>
      </span>
      <span class="exp-label">Filtrer</span>
    `,
    onClick: () => { openSheetFiltres('grid-non-programmees'); },
  });

  // Bouton Supprimer sur Activités Non Programmées
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
    onClick: async () => {await doSupprimerActivite();},
  });

  // Bouton Filtres sur Creneaux disponibles
  if (agGridHasHeaderFilters('grid-creneaux')) addExpanderButton({
    expanderId: 'exp-creneaux',
    id: 'btn-filtrer-creneaux',
    title: 'Filtrer', 
    innerHTML: `
      <span class="exp-icon" aria-hidden="true">
        <!-- Icône Filtre en forme d'entonnoir -->
        <svg viewBox="0 0 24 24" width="24" height="24"
            fill="none" stroke="currentColor" stroke-width="1.8"
            stroke-linecap="round" stroke-linejoin="round"
            aria-hidden="true" focusable="false">
          <!-- entonnoir -->
          <path d="M3 4h18l-7 8v5l-4 2v-7L3 4z"/>
        </svg>
      </span>
      <span class="exp-label">Filtrer</span>
    `,
    onClick: () => { openSheetFiltres('grid-creneaux'); },
  });

  // Toggle TraiterPauses sur Creneaux disponibles
  (function addPausesToggleButton() {
    const id = 'btn-avec-pauses';

    const ICON_PAUSE_ON = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
          xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <rect x="3" y="3" width="18" height="18" rx="3" ry="3"/>
        <path d="M8 12l3 3 5-5"/>
      </svg>`;

    const ICON_PAUSE_OFF = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
          xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <rect x="3" y="3" width="18" height="18" rx="3" ry="3"/>
      </svg>`;
    
    const KEY_SHOW_PAUSES = 'exp-creneaux:avec-pauses';

    function getShowPauses() {
      try { return localStorage.getItem(KEY_SHOW_PAUSES) === '1'; } catch { return false; }
    }
    function setShowPauses(v) {
      try { localStorage.setItem(KEY_SHOW_PAUSES, v ? '1' : '0'); } catch {}
    }

    function renderAvecPausesInnerHTML(isOn) {
      const icon = isOn ? ICON_PAUSE_ON : ICON_PAUSE_OFF;
      const label = isOn ? 'Avec pauses' : 'Sans pauses';
      return `
        <span class="exp-icon">${icon}</span>
        <span class="exp-label">${label}</span>
      `;
    }

    // ⇨ applique l’état (classe + aria + contenu) si le bouton existe
    function syncAvecPausesButtonFromStorage(btnId = 'btn-avec-pauses') {
      const btn = document.getElementById(btnId);
      if (!btn) return false;
      const isOn = getShowPauses();
      btn.innerHTML = renderAvecPausesInnerHTML(isOn);
      btn.classList.toggle('is-on', isOn);
      btn.setAttribute('aria-pressed', String(isOn));
      return true;
    }

    const onChange = () => refreshGrid('grid-creneaux');

    // 1) créer (ou réutiliser) le bouton via helper
    addExpanderButton({
      expanderId: 'exp-creneaux',
      id,
      title: 'Avec pauses',
      innerHTML: renderAvecPausesInnerHTML(getShowPauses()),
      onClick: async () => {
        const current = getShowPauses();
        const next = !current;
        setShowPauses(next);
        syncAvecPausesButtonFromStorage(id);
        // callback métier
        try { onChange?.(next); } catch(e) { console.error(e); }
      }
    });

    // 🔁 sync immédiat (au cas où l’innerHTML a bougé après insertion)
    queueMicrotask(() => syncAvecPausesButtonFromStorage(id));
  })();

}

function traiterPauses() {
  return localStorage.getItem('exp-creneaux:avec-pauses') === '1';
}

function updateGridCounters(api, badgeEl) {
  if (!api || !badgeEl) return;

  const displayed = api.getDisplayedRowCount
    ? api.getDisplayedRowCount()
    : api.getModel().getRowCount();

  const total = api.getModel()?.rootNode?.allLeafChildren?.length ?? displayed;
  badgeEl.textContent = `${displayed} / ${total}`;
}

function agGridHasHeaderFilters(gridId) {
  const gridApi = window.grids?.get(gridId).api;
  const defs = gridApi.getColumnDefs?.() || [];
  return defs.some(col => !!col.filter);
}

// ===== Builders de colonnes de grilles =====

// Met à jour la definition des colonnes sur une grille
function rebuildColumnsForGrid(gridId, dfRows = null) {

  // Recâble le wheel scrolling 
  function ensureWheelScrollOnGrid(handle) {
    if (!handle || handle._wheelPatched) return;

    const root = handle.el;
    if (!root) return;

    // Conteneur qui scroll VERTICALEMENT dans AG Grid
    const viewport =
      root.querySelector('.ag-body-viewport') ||
      root.querySelector('.ag-center-cols-viewport');

    if (!viewport) return;

    const onWheel = (e) => {
      // Ctrl+wheel → zoom navigateur, on ne touche pas
      if (e.ctrlKey) return;

      const { scrollTop, scrollHeight, clientHeight } = viewport;
      const atTop    = scrollTop <= 0;
      const atBottom = scrollTop + clientHeight >= scrollHeight - 1;
      const dy       = e.deltaY || 0;
      const goingUp  = dy < 0;
      const goingDown= dy > 0;

      // Si on est déjà en haut/bas et que l'utilisateur continue, on laisse l'événement
      // remonter pour que la PAGE scrolle éventuellement
      if ((goingUp && atTop) || (goingDown && atBottom)) {
        return;
      }

      // Sinon, on fait scroller la grille
      viewport.scrollTop = Math.max(
        0,
        Math.min(scrollTop + dy, scrollHeight - clientHeight)
      );

      // Ici on PREVENT uniquement si on a bien consommé le scroll
      e.preventDefault();
    };

    // Important : passive:false pour pouvoir preventDefault
    viewport.addEventListener('wheel', onWheel, { passive: false });
    handle._wheelPatched = true;
  }

  const handle = window.grids?.get(gridId);
  if (!handle) return;
  const api = handle.api;
  if (!api) return;

  // 1) Colonnes de base (celles que tu définis dans buildColumnsActivitesXXX)
  const baseCols = (handle.columnsBuilder?.() || []).slice(); // copie défensive

  // 2) Ensemble des champs déjà connus
  const knownFields = new Set(
    baseCols
      .map(c => c.field)
      .filter(f => typeof f === 'string' && f.length)
  );

  // 3) Ajouter les champs trouvés dans les données (dfRows)
  if (dfRows && dfRows.length) {
    for (const row of dfRows) {
      if (!row || typeof row !== 'object') continue;
      for (const key of Object.keys(row)) {
        if (!key) continue;
        if (key.startsWith('__')) continue; // on ignore les colonnes techniques
        if (!knownFields.has(key)) {
          knownFields.add(key);
        }
      }
    }
  }

  // 4) Map pour retrouver rapidement un colDef de base
  const baseMap = new Map();
  for (const col of baseCols) {
    if (col.field) baseMap.set(col.field, col);
  }

  // 5) Reconstruire la liste finale des colDefs
  const newColDefs = [];
  let hyperlinkCol = null;

  // a) Construire toutes les colonnes sauf "Hyperlien"
  for (const field of knownFields) {
    if (field === 'Hyperlien') continue;  // on la traitera ensuite

    const base = baseMap.get(field);
    if (base) {
      newColDefs.push(base);
    } else {
      newColDefs.push({
        field,
        headerName: field,
        minWidth: 100,
        flex: 1,
        sortable: true,
        filter: true,
      });
    }
  }

  // b) Ajouter "Hyperlien" en dernier si présente
  if (knownFields.has('Hyperlien')) {
    const base = baseMap.get('Hyperlien');
    hyperlinkCol = base || {
      field: 'Hyperlien',
      headerName: 'Hyperlien',
      minWidth: 100,
      flex: 1,
      sortable: true,
      filter: true,
    };
    newColDefs.push(hyperlinkCol);
  }

  // 6) Appliquer proprement aux options du grid
  // (AG Grid v29+ ; évite setColumnDefs déprécié)
  api.setGridOption('columnDefs', newColDefs);
  api.onColumnEverythingChanged?.();
  ensureWheelScrollOnGrid(handle);
}

// Met à jour la definition des colonnes sur les grilles qui affichent des activités
function rebuildColumnsForActiviteGrids(dfRows) {
  rebuildColumnsForGrid('grid-programmees', dfRows);
  rebuildColumnsForGrid('grid-non-programmees', dfRows);
  rebuildColumnsForGrid('grid-programmables', dfRows);
}

// Colonnes des grilles d'activités programmées et non programmées
function buildColumnsActivitesCommon(){
  let width = window.matchMedia("(max-width: 750px)").matches ? 60 : 80;
  let widthSR = window.matchMedia("(max-width: 750px)").matches ? 70 : 90;
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
    { field:'Activite', headerName: 'Activité', minWidth:200, flex:1.5, cellRenderer: ActiviteRenderer },
    { field:'Duree', headerName: 'Durée', width, suppressSizeToFit:true, valueParser: valueParserDuree },
    { field:'Fin', headerName: 'Fin', width, suppressSizeToFit:true, editable: false, valueParser: valueParserHeure },
    { field:'Lieu', headerName: 'Lieu', minWidth:160, flex:1, cellRenderer: LieuRenderer },
    { field:'Session', headerName: 'Séances', width:widthSR, minWidth:widthSR, valueParser: valueParserSession },
    { field:'Relache', headerName: 'Relâches', width:widthSR, minWidth:widthSR, valueParser: valueParserRelache },
    { field:'Style', headerName: 'Style', minWidth:160, flex:0.6 },
    { field:'Orga', headerName: 'Orga', width, minWidth:width },
    { field:'Reserve', headerName: 'Réservé', width, minWidth:width, valueParser: valueParserReserve },
    { field:'Priorite', headerName: 'Priorité', width, minWidth:width, valueParser: valueParserNumerique },
    { field:'Hyperlien', headerName: 'Hyperlien', minWidth:120, flex:1 }
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
    cellEditorParams: (p) => {
      const values = activitesAPI.getOptionsDateForActiviteProgrammee(p.data) || [];
      return { values: values.map(String), valueListMaxHeight: 300 };   // 👈 must be an array
    },
    onCellValueChanged: onProgGridDateCommitted,
  };

  cols[iDebut] = {
    ...cols[iDebut] ,
    editable: (p) => !activitesAPI.estActiviteReservee(p.data),
    onCellValueChanged: (p) => p.data.Fin = recalcFin(p.data),
  };

  cols[iDuree] = {
    ...cols[iDuree] ,
    editable: (p) => !activitesAPI.estActiviteReservee(p.data),
    onCellValueChanged: (p) => p.data.Fin = recalcFin(p.data),
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
  let iDebut = cols.findIndex(c => c.field === 'Debut');
  let iDuree = cols.findIndex(c => c.field === 'Duree');

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

  cols[iDebut] = {
    ...cols[iDebut] ,
    onCellValueChanged: (p) => p.data.Fin = recalcFin(p.data),
  };

  cols[iDuree] = {
    ...cols[iDuree] ,
    onCellValueChanged: (p) => p.data.Fin = recalcFin(p.data),
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
    { field:'Début', headerName:'Début', width, suppressSizeToFit:true, editable:false,
      comparator:(a,b)=>{
        const ma=parseHHhMM(a)??Infinity, mb=parseHHhMM(b)??Infinity;
        return ma-mb;
      }
    },
    { field:'Fin', headerName:'Fin', width, suppressSizeToFit:true, editable:false,
      comparator:(a,b)=>{
        const ma=parseHHhMM(a)??Infinity, mb=parseHHhMM(b)??Infinity;
        return ma-mb;
      }
    },
    { field:'Activité-avant', headerName:'Activité avant', minWidth:160, flex:1, editable:false,},
    { field:'Activité-après', headerName:'Activité après', minWidth:160, flex:1, editable:false,},
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
function valueParserSession (params) {
  if (!activitesAPI.estSessionValide(params.newValue)) {
    alert(`⛔ Format attendu = suite d'expressions suivantes, séparées par des virgules :
     - "9", "09" (mois courant et année courante implicites), 
     - "9/7", "09/07" (année courante implicite) , 
     - "09/07/25" ou "09/07/2025"
     - "(9, 16, 23)/7" pour énumérer des dates du même mois
     - "[9-12]/07", [30/07-01/08] pour une période
     - "[9-12]/07 lu ma", [30/07-01/08] lu ma pour des jours de la semaine sur une période 
     - "jours pairs" | "jours impairs"
     - chaîne vide => tous les jours de la période de programmation
    `);
    return params.oldValue;
  }
  else return params.newValue;
}
function valueParserRelache (params) {
  if (!activitesAPI.estRelacheValide(params.newValue)) {
    alert(`⛔ Format attendu = suite d'expressions suivantes, séparées par des virgules :
     - "9", "09" (mois courant et année courante implicites), 
     - "9/7", "09/07" (année courante implicite) , 
     - "09/07/25" ou "09/07/2025"
     - "(9, 16, 23)/7" pour énumérer des dates du même mois
     - "[9-12]/07", [30/07-01/08] pour une période
     - "[9-12]/07 lu ma", [30/07-01/08] lu ma pour des jours de la semaine sur une période 
     - "jours pairs" | "jours impairs"
     - chaîne vide => pas de jours de relâche
    `);
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
    popupParent: document.body, // Nécessaire sur IPad pour assurer que les popup menus soient au dessus de la colo
    suppressRowTransform: true, // Nécessaire sur IPad pour assurer que les popup menus soient au dessus de la colo
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
    // onGridSizeChanged: () => safeSizeToFitFor(gridId),
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

    // floatingFilter: true,
    // suppressMenuHide: false,
    // suppressColumnVirtualisation: false,

    // enableBrowserTooltips: true,
    // suppressTouch: false,
  }
};

const gridOptionsActivitesProgrammees = {
  rowSelection: 'single',
  onSelectionChanged(params) {
    const sel = params.api.getSelectedRows();
    const btn = document.getElementById('btn-deprogrammer');
    btn.disabled = (sel.length > 0) ? activitesAPI.estActiviteReservee(sel[0]) : true;
  },
  onFilterChanged: p => updateGridCounters(p.api, document.getElementById('badge-prog')),
}

const gridOptionsActivitesNonProgrammees = {
  getRowStyle: p => {
    const bg = colorActiviteProgrammable(p.data);
    return bg ? { '--day-bg': bg } : {};
  },
  onSelectionChanged: (p) => {
    const hasSel = !!p.api.getSelectedRows()?.length;
    document.getElementById('btn-supprimer')?.toggleAttribute('disabled', !hasSel);
    synchronizeSelection(p, 'grid-programmables'); 
  },
  onFilterChanged: p => updateGridCounters(p.api, document.getElementById('badge-non-prog')),
}

const gridOptionsCreneaux = {
  onSelectionChanged: () => onCreneauxSelectionChanged(),
  onFilterChanged: p => updateGridCounters(p.api, document.getElementById('badge-creneaux')),
}

const gridOptionsActivitesProgrammables = {
  onSelectionChanged: (p) => {
    const sels = p.api.getSelectedRows();
    const hasSel = !!sels?.length;
    document.getElementById('btn-programmer')?.toggleAttribute('disabled', !hasSel);
    synchronizeSelection(p, 'grid-non-programmees'); 
  },
  onFilterChanged: p => updateGridCounters(p.api, document.getElementById('badge-programmables')),
}

// Sélectionne dans une autre grille la ligne correspondant à celle qui vient d'être sélectionnée et la rend visible
function synchronizeSelection(event, dstGridId) {
  // Évite les boucles si la sélection vient d'une action programmatique
  if (event?.source !== 'rowClicked') return;

  const srcApi = event.api;
  const dstApi = getGridApiById(dstGridId);
  if (!srcApi || !dstApi) return;

  const sel = srcApi.getSelectedRows?.()[0];
  // Si plus rien n'est sélectionné côté "programmable" => on nettoie en face
  if (!sel) {
    dstApi.deselectAll?.({ source: 'programmatic' });
    return;
  }

  const uuid = sel.__uuid;
  const activite = (sel.Activite || '').trim().toLowerCase();

  // Cherche le node correspondant dans "programmees"
  let targetNode = null;
  dstApi.forEachNode(node => {
    const d = node.data || {};
    if (uuid && d.__uuid === uuid) targetNode = node;
  });
  // Fallback si pas de __uuid commun : on matche sur Activite
  if (!targetNode && activite) {
    dstApi.forEachNode(node => {
      const d = node.data || {};
      if (!targetNode && String(d.Activite || '').trim().toLowerCase() === activite) {
        targetNode = node;
      }
    });
  }

  if (!targetNode) {
    // Rien trouvé côté programmees : on peut désélectionner ou ignorer
    // dstApi.deselectAll?.({ source: 'programmatic' });
    return;
  }

  // Sélection "silencieuse" (v30+): évite les finishActions et marque la source
  dstApi.setNodesSelected({
    nodes: [targetNode],
    newValue: true,
    clearSelection: true,
    source: 'programmatic'
  });

  // S'assure que la ligne est visible (après paint pour éviter les races)
  queueMicrotask(() => {
    try {
      dstApi.ensureNodeVisible(targetNode, 'middle'); // 'top' | 'middle' | 'bottom'
    } catch {}
  });
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
  return activitesAPI.getCreneaux(activites, activitesProgrammees, traiterPauses(), periodeProgrammation).map(r => ({...r}));
}

async function loadGridActivitesProgrammables(){
  if (!selectedSlot) return [];
  const activites = ctx.df;                      
  // Two-level shallow copy OBLIGATOIRE sinon AgGrid écrit directement dans les tableaux de ctx => catastrophe !!
  return activitesAPI.getActivitesProgrammables(activites, selectedSlot, traiterPauses()).map(r => ({...r}));
}

async function dropRowFromSrcGridToDstGrid(srcGrid, dstGrid, dstExp, srcUuid, dstUuid, scroll=true) {

  // 1) sélectionne le voisin dans la source (pas besoin de centrer ici)
  selectRowByUuid(srcGrid, srcUuid, { ensure: null, flash: null });

  // 2) ouvre l’expander cible et scrolle jusqu’à lui
  await openExpanderAsync(dstExp);
  if (scroll) await scrollExpanderIntoViewCenteredAsync(document.getElementById(dstExp), { duration: 400 });

  // 3) sélectionne la ligne cible dans la grille destination
  selectRowByUuid(dstGrid, dstUuid, { ensure: null, flash: false });

  // 4) centre VRAIMENT la ligne dans la grille et récupère son élément DOM
  const { rowEl } = await ensureRowVisibleAndGetEl(dstGrid, dstUuid, { ensure: 'center' });
  await waitAF(); // laisse le layout se stabiliser

  // 5) lance le phantom flight vers l’élément centré
  doPhantomFlight(srcGrid, dstGrid, dstExp); 
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
    dropRowFromSrcGridToDstGrid('grid-programmees', 'grid-non-programmees', 'exp-non-programmees', uuidVoisin, uuid, scroll=false);
  }
  else {
    await ensureRowVisibleAndGetEl("grid-programmees", uuid);
  }
}

// Quand on édite la date d'une activité non programmée
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
  dropRowFromSrcGridToDstGrid('grid-non-programmees', 'grid-programmees', 'exp-programmees', uuidVoisin, uuid, scroll=true);
}

function onCreneauxSelectionChanged(){
  // if (e.source === 'programmatic') return; // ignorer les sélections internes
  const g = grids.get('grid-creneaux');
  if (!g?.api) return;
  const sel = g.api.getSelectedRows?.() || [];
  selectedSlot = sel[0] || null;

  // rafraîchir la grille 4 (programmables)
  refreshGrid('grid-programmables');
}

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
  const handle = { id: gridId, el, api, loader, columnsBuilder }; //, nbRowsPred: null };
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

  log(`RefreshGrid ${gridId}`);

  const api = h.api;

  // 0) mémorise la sélection actuelle (par __uuid)
  let prevUuid = null;
  try {
    const prevSel = api.getSelectedRows?.() || [];
    prevUuid = prevSel[0]?.__uuid ?? null;
  } catch {}

  // 1) recharge les données
  const nbRowsPred = api.getGridOption('rowData')?.length;
  const rows = await h.loader?.();
  const nbRows = rows.length;

  api.setGridOption?.('rowData', rows || []);

  // 2) après peinture → reselect ou fallback 1ère ligne, puis resize + autosize pane
  const finish = () => {
    // repaint + grid size (AG Grid v29+)
    api.refreshCells?.({ force: true });

    // traitements spécifiques de grille
    if (gridId == 'grid-programmees') {
      updateGridCounters(api, document.getElementById('badge-prog'));
    }
    else if (gridId == 'grid-non-programmees') {
      api.redrawRows();  // ré-évalue getRowStyle, nécessaire sur cette grille pour appliquer correctement la colo (don't know why...)
      updateGridCounters(api, document.getElementById('badge-non-prog'));
    }
    else if (gridId == 'grid-creneaux') {
      updateGridCounters(api, document.getElementById('badge-creneaux'));
    }
    else if (gridId == 'grid-programmables') {
      updateGridCounters(api, document.getElementById('badge-programmables'));
    }

    api.dispatchEvent?.({ type: 'gridSizeChanged' });

    // autosize pane (uniquement si ouvert ou mémorisation si fermé)
    const pane = h.el.closest('.st-expander-body');
    // autoSizePanelFromRowCount(pane, h.el, api, gridId, { nbRows:api.getGridOption('rowData').length, nbRowsPred:nbRowsPred });
    autoSizePanelFromRowCount(pane, h.el, api, gridId, { nbRows:nbRows, nbRowsPred:nbRowsPred });
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

    // (select, clearOther)
    node?.setSelected?.(true, true);
    // selectRowSilently (api, node);

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
    // 🆕 on autorise l’absence de paneBot si c’est le dernier
    const isLast = sp.dataset.last === '1' || bottomId === '__end__';
    if (!paneTop || (!paneBot && !isLast)) return;

    const expTop = paneTop.closest('.st-expander');        // parent expander (top)
    // const scroller = (typeof getScrollContainer === 'function')
    //   ? getScrollContainer(expTop)
    //   : expTop.closest('.page') || document.scrollingElement || document.documentElement;
    const scroller = findPageScroller(paneTop);
    const bottomBarH = document.getElementById('bottomBar')?.getBoundingClientRect?.().height || 0;

    let dragging = false, startY = 0, hTop = 0, dyMin = 0, dyMax = 0;
    let prevTransition = '', prevAnimation = '';
    let lastHFrame = null;  // previous frame paneTop height (px) during drag

    // 🆕 auto-grow state
    let autoGrowRaf = null;
    let autoGrowActive = false;
    let lastClientY = 0;
    let growAccum = 0; // pixels synthétiques ajoutés quand on “coince” en bas

    const setH = (pane, px) => pane.style.setProperty('height', `${Math.max(0, Math.round(px))}px`, 'important');

    function begin(clientY, e) {
      // const expTop = paneTop.closest('.st-expander');
      if (!expTop || !expTop.classList.contains('open')) return;  // 🔒

      dragging = true;
      startY = clientY;
      lastClientY = clientY;           // 🆕
      growAccum = 0;                   // 🆕

      hTop = Math.round(paneTop.getBoundingClientRect().height);
      lastHFrame = hTop;

      // limite haute : on peut tout cacher (header compris)
      dyMin = -hTop;

      // limite basse : borne “contenu max” (nb de lignes)
      const maxH = calcMaxHForPane(paneTop); // ← ta fonction existante
      dyMax = Math.max(0, Math.round(maxH - hTop));

      // couper les anims pendant le drag
      prevTransition = paneTop.style.transition || '';
      prevAnimation  = paneTop.style.animation  || '';
      paneTop.style.setProperty('transition', 'none', 'important');
      paneTop.style.setProperty('animation',  'none', 'important');
      paneTop.style.willChange = 'height';

      setH(paneTop, hTop);
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'row-resize';
    }

    // 🆕 boucle d’auto-grow quand on est “coincé” en bas du viewport
    function tickAutoGrow() {
      if (!dragging || !autoGrowActive) { autoGrowRaf = null; return; }

      // vitesse de croissance (pixels/frame) – ajuste à ton goût
      const SPEED = 6;

      growAccum += SPEED;
      const dyRaw = (lastClientY - startY) + growAccum;
      const dy = Math.max(dyMin, Math.min(dyRaw, dyMax));

      setH(paneTop, hTop + dy);

      // scrollBottomIntoView(expTop, scroller, { pad: 12 });
      scrollBottomIntoView(paneTop.closest('.st-expander'), scroller, {
        pad: 12,
        extraPad: getSafeBottomPx() + bottomBarH,  // évite de passer sous la bottom bar
        behavior: 'auto', // fluide si tu préfères, 'auto' pendant le drag
      });

      // notify AG Grid haut
      try {
        const gridDiv = paneTop.querySelector('div[id^="grid"]');
        for (const g of (window.grids?.values?.() || [])) {
          if (g.el === gridDiv) { g.api.onGridSizeChanged(); break; }
        }
      } catch {}

      // stop si on touche la borne haute
      if (dy >= dyMax) { autoGrowActive = false; autoGrowRaf = null; return; }

      autoGrowRaf = requestAnimationFrame(tickAutoGrow);
    }

    function maybeAutoGrow(clientY){
      lastClientY = clientY;

      if (!isLast || !dragging) return;

      // marge depuis le bas pour déclencher l’auto-grow
      const safeInset =  Math.max(0, parseInt(getComputedStyle(document.documentElement).getPropertyValue('--safe-bottom') || '0', 10)) || 0;
      // const MARGIN = 16 + safeInset; // px au-dessus du bas de l’écran
      const bottomBar = document.getElementById('bottomBar');
      const bottomBarHeight = bottomBar?.offsetHeight || 0;
      const MARGIN = bottomBarHeight + safeInset; // px au-dessus du bas de l’écran
      const nearBottom = clientY >= (window.innerHeight - MARGIN);

      if (nearBottom && !autoGrowActive) {
        autoGrowActive = true;
        if (!autoGrowRaf) autoGrowRaf = requestAnimationFrame(tickAutoGrow);
      } else if (!nearBottom && autoGrowActive) {
        // on est remonté : on arrête l’auto-grow
        autoGrowActive = false;
        if (autoGrowRaf) { cancelAnimationFrame(autoGrowRaf); autoGrowRaf = null; }
        growAccum = 0;
      }
    }

    function update(clientY, e) {
      if (!dragging) return;

      const dyRaw = clientY - startY + (isLast ? growAccum : 0); // 🆕 accumulé si last
      const dy = Math.max(dyMin, Math.min(dyRaw, dyMax));
      setH(paneTop, hTop + dy);
      
      // scrollBottomIntoView(expTop, scroller, { pad: 12 });

      // notifier la grille du haut
      try {
        const gridDiv = paneTop.querySelector('div[id^="grid"]');
        for (const g of (window.grids?.values?.() || [])) {
          if (g.el === gridDiv) { g.api.onGridSizeChanged(); break; }
        }
      } catch {}

      const hNow = Math.round(paneTop.getBoundingClientRect().height);
      const isGrowing = (lastHFrame == null) ? true : (hNow > lastHFrame);
      lastHFrame = hNow;

      // Only auto-scroll when pane grows (dy > 0), and ONLY for the last splitter
      if (isLast && isGrowing) {
        // bottom breathing space = bottom bar height + iOS safe-area if you want
        const extraPad =
          (typeof getSafeBottom === 'function' ? parseFloat(getSafeBottom()) || 0 : 0) +
          (document.getElementById('bottomBar')?.getBoundingClientRect?.().height || 0);

        // scrollBottomIntoView(paneTop.closest('.st-expander'), scroller, {
        //   pad: 12, extraPad, overflowStart: 10
        // });
        scrollBottomIntoView(paneTop.closest('.st-expander'), scroller, {
          pad: 12,
          extraPad: getSafeBottomPx() + bottomBarH,  // évite de passer sous la bottom bar
          behavior: 'auto', // fluide si tu préfères, 'auto' pendant le drag
        });
      }

      // 🆕 déclenche/arrête auto-grow si besoin
      maybeAutoGrow(clientY);
    }

    function finish() {
      if (!dragging) return;
      dragging = false;
      lastHFrame = null;

      // 🆕 coupe l’auto-grow
      autoGrowActive = false;
      if (autoGrowRaf) { cancelAnimationFrame(autoGrowRaf); autoGrowRaf = null; }
      growAccum = 0;

      // restaurer anims
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

    // Souris
    handle.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      begin(e.clientY, e);
    });
    window.addEventListener('mousemove', e => {
      if (!dragging) return;
      update(e.clientY, e);
    });
    window.addEventListener('mouseup', finish);

    // Tactile
    handle.addEventListener('touchstart', (e) => {
      begin(e.touches[0].clientY, e);
    }, { passive: true });

    window.addEventListener('touchmove', (e) => {
      if (!dragging) return;
      e.preventDefault(); // bloque le scroll pendant le drag
      update(e.touches[0].clientY, e);
    }, { passive: false });

    window.addEventListener('touchend', () => { finish(); }, { passive: true });
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

// ===== Actions =====

// Ajout d'une colonne
function doAjouterColonne() {
  const df  = ctx.df || [];

  openSheetExclusive({
    title: 'Ajouter une colonne',
    panelHeight: 'auto',
    panelMaxHeight: '40vh',
    mount: (body, { close }) => {
      body.innerHTML = `
        <div class="form">
          <div class="form-row">
            <label for="new-col-name">Nom de la nouvelle colonne</label>
            <input id="new-col-name"
                   type="text"
                   class="bb-input"
                   placeholder="Ex. Commentaire, Classement…"
                   autocomplete="off" />
          </div>
          <p class="form-error" id="new-col-error" style="display:none;color:#c00;font-size:0.85rem;"></p>
        </div>
        <div class="sheet-footer has-border">
          <div class="form-actions">
            <button type="button" id="btn-cancel-add-col" class="bb-btn">Annuler</button>
            <button type="button" id="btn-apply-add-col" class="bb-btn is-primary">Ajouter</button>
          </div>
        </div>
      `;

      const input = body.querySelector('#new-col-name');
      const errEl = body.querySelector('#new-col-error');
      const btnCancel = body.querySelector('#btn-cancel-add-col');
      const btnApply  = body.querySelector('#btn-apply-add-col');

      const showError = (msg) => {
        if (!errEl) return;
        errEl.textContent = msg || '';
        errEl.style.display = msg ? 'block' : 'none';
      };

      const clearError = () => showError('');

      // Ensemble des colonnes existantes (insensible à la casse)
      const existingFields = (() => {
        const s = new Set();

        // helper normalisation : " Nom " -> "nom"
        const add = (name) => {
          if (!name) return;
          const norm = String(name).trim().toLowerCase();
          if (!norm) return;
          s.add(norm);
        };

        // 1) Noms de champs du DF
        const rows = ctx.df || [];
        for (const r of rows) {
          if (!r || typeof r !== 'object') continue;
          for (const k of Object.keys(r)) {
            if (!k) continue;
            add(k);              // nom de champ (field)
          }
        }

        // 2) Noms de colonnes dans la grille (field + headerName)
        const handle = window.grids?.get('grid-programmees');    // ou une autre grille de référence
        const colDefs = handle?.api?.getColumnDefs?.() || [];
        for (const col of colDefs) {
          if (!col) continue;
          if (col.field)      add(col.field);       // champ interne
          if (col.headerName) add(col.headerName);  // titre visible
        }

        return s;
      })();

      function apply() {
        clearError();
        let name = (input.value || '').trim();

        // validations de base
        if (!name) {
          showError('Veuillez saisir un nom de colonne.');
          input.focus();
          return;
        }

        // on déconseille fortement de commencer par "__"
        if (name.startsWith('__')) {
          showError('Le préfixe "__" est réservé aux colonnes techniques.');
          input.focus();
          return;
        }

        // éviter les doublons (insensible à la casse)
        if (existingFields.has(name.toLowerCase())) {
          showError('Une colonne portant ce nom existe déjà.');
          input.focus();
          input.select();
          return;
        }

        // facultatif : limiter les caractères exotiques
        const sanitized = name.replace(/\s+/g, ' ').trim();
        name = sanitized;

        // On va construire le nouveau df et le garder pour rebuild
        let newDf = null;
        ctx.mutateDf?.(rows => {
          const src = rows || [];

          // on duplique chaque row en ajoutant la nouvelle clé
          const next = src.map(r => ({
            ...r,
            [name]: null,   
          }));

          // si df était vide : on crée une ligne vide pour que la colonne existe
          if (!next.length) {
            next.push({ [name]: null });
          }

          newDf = next;
          return next;
        });

        try {
          if (typeof rebuildColumnsForActiviteGrids === 'function') {
            rebuildColumnsForActiviteGrids(newDf || ctx.df || []);
          }
        } catch (e) {
          console.error('rebuildColumnsForActiviteGrids error:', e);
        }

        close();
      }

      btnCancel?.addEventListener('click', () => close());
      btnApply?.addEventListener('click', apply);

      input?.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') {
          ev.preventDefault();
          apply();
        }
        if (ev.key === 'Escape') {
          ev.preventDefault();
          close();
        }
      });

      // focus initial
      setTimeout(() => input?.focus(), 20);
    }
  });
}

// Suppression d'une colonne
function doSupprimerColonne() {
  const df = window.ctx?.df || [];
  if (!Array.isArray(df) || df.length === 0) {
    alert('Aucune donnée chargée : impossible de supprimer une colonne.');
    return;
  }

  // Récupère la liste des colonnes à partir de la première ligne
  const sample = df[0] || {};
  const allFields = Object.keys(sample);

  // Colonnes candidates à la suppression : non techniques et non obligatoires
  const removable = allFields.filter(f =>
    f &&
    !MANDATORY_COLS.has(f) &&
    !f.startsWith('__')
  );

  if (!removable.length) {
    alert('Aucune colonne facultative à supprimer.');
    return;
  }

  openSheetExclusive({
    title: 'Supprimer une colonne',
    panelHeight: 'auto',
    panelMaxHeight: '40vh',
    mount: (body, { close }) => {
      const optionsHtml = removable
        .map(name => `<option value="${name}">${name}</option>`)
        .join('');

      body.innerHTML = `
        <div class="form">
          <div class="form-row">
            <label for="col-to-remove">Colonne à supprimer</label>
            <select id="col-to-remove" class="bb-input">
              ${optionsHtml}
            </select>
          </div>
        </div>
        <div class="sheet-footer has-border">
          <div class="form-actions">
            <button type="button" id="btn-cancel" class="bb-btn">Annuler</button>
            <button type="button" id="btn-apply" class="bb-btn is-primary">Supprimer</button>
          </div>
        </div>
      `;

      const sel   = body.querySelector('#col-to-remove');
      const btnOk = body.querySelector('#btn-apply');
      const btnKo = body.querySelector('#btn-cancel');

      btnKo.addEventListener('click', () => close());

      btnOk.addEventListener('click', () => {
        const col = sel.value?.trim();
        if (!col) {
          alert('Veuillez choisir une colonne à supprimer.');
          return;
        }
        if (MANDATORY_COLS.has(col)) {
          alert(`La colonne "${col}" est obligatoire et ne peut pas être supprimée.`);
          return;
        }

        // Confirmation de confort
        if (!confirm(`Supprimer la colonne "${col}" ?`)) return;

        if (!window.ctx?.mutateDf) {
          console.error('ctx.mutateDf est introuvable');
          return;
        }

        // Mise à jour du df (immutabilité "façon ctx.mutateDf")
        window.ctx.mutateDf(rows => {
          if (!Array.isArray(rows)) return rows;

          const next = rows.map(r => {
            if (!r || typeof r !== 'object') return r;
            const copy = { ...r };
            delete copy[col];
            return copy;
          });

          // Rebuild des colonnes des grilles d’activités avec le nouveau df
          try {
            rebuildColumnsForActiviteGrids?.(next);
          } catch (e) {
            console.error('rebuildColumnsForActiviteGrids error:', e);
          }

          return next;
        });

        close();
      });
    }
  });
}

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
  rebuildColumnsForActiviteGrids([]);
}

// Import Excel
async function doImportExcel() {
  // déclenche l’input caché
  const fi = $('fileInput');
  if (fi) fi.click();
}

// Import depuis catalogue du In
async function doImportFromCatIn() {
  // importFromUrlOrTxt('https://festival-avignon.com/fr/edition-2025/programmation/par-categorie', 'parseAvignonInProgPage');
  const f = await fetch('https://docs.google.com/spreadsheets/d/1pZvcYOYfhllj95PQlpUunbyklXteMiGs/export?format=xlsx&id=1pZvcYOYfhllj95PQlpUunbyklXteMiGs&gid=1659244658');
  importFromXlsxFile(f, {add:true});
}

// Import depuis catalogue du Off
async function doImportFromCatOff() {
  // importFromUrlOrTxt('https://www.festivaloffavignon.com/programme', 'parseAvignonOffProgPage');
  const f = await fetch('https://docs.google.com/spreadsheets/d/17qBLtxLC4S-e21zk1mPAD214aUilq_e7/export?format=xlsx&id=17qBLtxLC4S-e21zk1mPAD214aUilq_e7&gid=527650237');
  importFromXlsxFile(f, {add:true});
}

// Import depuis billet reduc
async function doImportFromBilletReduc({ rubrique, region, dt }) {
  const url = `https://www.billetreduc.com/search.htm?dt=${encodeURIComponent(dt)}&region=${encodeURIComponent(region)}&idrub=${encodeURIComponent(rubrique)}`;
  importFromUrlOrTxt(url, 'parseBilletReducProgPage');
}


// Export Excel
async function doExportExcel() {

  // Change le nom des colonnes
  // mapping: { ancienNom: nouveauNom }
  function renameColumns(rows, mapping = {}) {
    return (rows || []).map(r => {
      const out = {};
      for (const [k, v] of Object.entries(r)) {
        const newKey = Object.prototype.hasOwnProperty.call(mapping, k) ? mapping[k] : k;
        out[newKey] = v;
      }
      return out;
    });
  }

  // order: tableau des clés selon lequel les colonnes sont réordonnées
  // dropUnknown: si true, on écarte les colonnes non listées
  function reorderColumns(rows, order = [], dropUnknown = false) {
    const has = Object.prototype.hasOwnProperty;
    return (rows || []).map(r => {
      const out = {};
      // d’abord les colonnes demandées
      for (const key of order) if (has.call(r, key)) out[key] = r[key];
      // puis le reste si on ne drop pas
      if (!dropUnknown) {
        for (const k of Object.keys(r)) if (!order.includes(k)) out[k] = r[k];
      }
      return out;
    });
  }

  // Supprime, renomme et réordonne
  function cleanRows(rows, colsToRemove, renameMap, order, dropUnknown = false) {
    let cleaned = rows.map(r => {
      const copy = { ...r };
      colsToRemove.forEach(c => {
        if (Object.prototype.hasOwnProperty.call(copy, c)) {
          delete copy[c];
        }
      });
      return copy;
    })
    return reorderColumns(renameColumns(cleaned, renameMap), order, dropUnknown);
  }

  // Renvoie pour chaque colonne la largeur du contenu le plus long
  function colWidths(rows) {
    const data = [Object.keys(rows[0]), ...rows.map(Object.values)];
    return data[0].map((_, colIndex) => {
      const maxLen = data.reduce((acc, row) => {
        const cell = row[colIndex];
        const cellValue = cell == null ? "" : String(cell);
        return Math.max(acc, cellValue.length);
      }, 0);
      // 1 unité ≈ largeur d’un caractère
      return { wch: Math.min(Math.max(maxLen + 2, 8), 50) }; // borne entre 8 et 50
    });
  }

  try {
    const wb = XLSX.utils.book_new();

    // Data
    const rows = ctx.df || [];

    let cleanData = rows.map(r => {
      const copy = { ...r, Date: dateintToPretty(r.Date) };
      return copy;
    })
    
    cleanData = cleanRows(cleanData, 
      ["__uuid", "Hyperlien", "__order", "__type_activite", "__index"],
      { Debut: "Début", Duree: "Durée", Activite: "Activité", Session: "Séances", Relache: "Relâches", Reserve: "Réservé", Priorite: "Priorité" },
      [ "Date", "Début", "Activité", "Durée", "Fin", "Lieu", "Séances", "Relâches", "Style", "Orga", "Réservé", "Priorité" ],
      false
    );

    const wsData = XLSX.utils.json_to_sheet(cleanData);

    // Calcul automatique des largeurs
    wsData["!cols"] = colWidths(cleanData);

    // repérer la colonne "Activité" dans la ligne d'entête
    const range = XLSX.utils.decode_range(wsData['!ref'] || 'A1');
    let colActivite = null;
    for (let c = range.s.c; c <= range.e.c; c++) {
      const addr = XLSX.utils.encode_cell({ r: range.s.r, c });
      const v = wsData[addr]?.v;
      if (String(v).trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'') === 'activite') {
        colActivite = c;
        break;
      }
    }

    // pour chaque data row, si Hyperlien présent -> pose un lien sur la cellule Activité
    if (colActivite != null) {
      for (let i = 0; i < (rows?.length || 0); i++) {
        const r = range.s.r + 1 + i; // 1-based après entête
        const addr = XLSX.utils.encode_cell({ r, c: colActivite });
        const cell = wsData[addr] || (wsData[addr] = { t: 's', v: rows[i]?.Activité || '' });
        const url  = rows[i]?.Hyperlien;
        if (url) {
          cell.l = { Target: String(url) };
        }
      }
    }

    XLSX.utils.book_append_sheet(wb, wsData, 'data');

    // Carnet d'adresses
    const carnet = ctx.carnet || [];
    if (carnet.length > 0) {
      let cleanCarnet = cleanRows(carnet, 
        ["__uuid", "__order"],
        { Tel: "Téléphone" },
        [ "Nom", "Adresse", "Téléphone", "Web" ],
        false
      );
      const wsCarnet = XLSX.utils.json_to_sheet(cleanCarnet);
      wsCarnet["!cols"] = colWidths(cleanCarnet);
      XLSX.utils.book_append_sheet(wb, wsCarnet, 'Carnet');
    }

    XLSX.writeFile(wb, 'In & Off.xlsx');
  } catch (e) {
    console.error(e);
    alert('❌ Export KO');
  }
}

// Export du programme au format Ics
async function doExportIcs() {
  const filteredRows = [];
  window.grids?.get('grid-programmees').api.forEachNodeAfterFilterAndSort(node => {
    filteredRows.push(node.data);
  });  
  rowsToICS(activitesAPI.getActivitesProgrammees(filteredRows));
}

// Vérification de cohérence du tableau d'activités
async function doVerifierCoherence() {
  openSheetCoherence(ctx.df);
}

// Undo
async function doUndo() {
  try { await ctx.undo('df'); } catch {}; rebuildColumnsForActiviteGrids(ctx.df);
}

// Redo
async function doRedo() {
  try { await ctx.redo(); } catch {}; rebuildColumnsForActiviteGrids(ctx.df);
}

// Ajout activité
async function doAjouterActivite() {
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
async function doAjouterActivitesParCollage() {
  await getClipBoardText();
}

async function getClipBoardText(parser=null) {
  const btn   = document.getElementById('btn-paste');
  const popup = document.getElementById('paste-popup');
  const proxy = document.getElementById('paste-proxy');

  function openPastePopup() {
    popup.setAttribute('aria-hidden', 'false');

    // Positionner juste au-dessus du bouton (mesure réelle)
    requestAnimationFrame(() => {
      const dialog = popup.querySelector('.pp-dialog');
      const rect = btn.getBoundingClientRect();
      const dlgW = dialog.offsetWidth, dlgH = dialog.offsetHeight;

      const top = Math.max(8, rect.top - dlgH - 8);
      const left = Math.min(
        window.innerWidth - dlgW - 8,
        Math.max(8, rect.left + rect.width/2 - dlgW/2)
      );
      dialog.style.top  = `${top + window.scrollY}px`;
      dialog.style.left = `${left + window.scrollX}px`;

      // Prépare la zone et assure un focus "solide"
      proxy.textContent = '';
      proxy.setAttribute('contenteditable', 'true');
      proxy.style.webkitUserSelect = 'text';    // iOS
      proxy.style.userSelect = 'text';

      let done = false;

      // ⚠️ Deux frames pour laisser Safari peindre puis focus
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          proxy.focus();
          // Place un caret explicite dans le contenteditable
          const sel = window.getSelection();
          const range = document.createRange();
          range.selectNodeContents(proxy);
          range.collapse(true);
          sel.removeAllRanges();
          sel.addRange(range);
        });
      });

      // --- LISTENERS ---

      // 1) beforeinput (iOS envoie insertFromPaste) 
      // => ne se déclenche que si le clipboard contient du texte
      const onBeforeInput = (e) => {
        if (e.inputType === 'insertFromPaste' && e.dataTransfer) {
          // 🟢 chemin idéal : on récupère direct
          done = true;
          e.preventDefault(); // évite l'insertion dans le DOM
          const txt = e.dataTransfer.getData('text/plain') || e.dataTransfer.getData('text') || '';
          finalize(txt);
        }
      };

      // 2) paste fallback : laisser coller, puis lire proxy.textContent 
      // => se declenche tout le temps sur paste utilisateur mais ne renvoie aucun texte
      // => sert uniquement à fermer la popup et avertir que la clipboard est vide lorsqu'il est vide
      const onPaste = () => {
        setTimeout(() => {
          const txt = (proxy.textContent || '').trim();
          // si !done le clipboard est effectivement vide => on alerte et on ferme la popup 
          if (!done) {
            cleanup(); 
          }
        }, 100);
      };

      // 3) input fallback ultime : si ni beforeinput ni paste n’ont capté 
      // => fermeture de la popup au premier caractère tapé
      const onInput = () => {
        setTimeout(() => {
          const txt = (proxy.textContent || '').trim();
          cleanup(); 
        }, 0);
      };

      const onBackdrop = (e) => {
        if (e.target.classList.contains('pp-backdrop')) cleanup();
      };

      proxy.addEventListener('beforeinput', onBeforeInput);
      proxy.addEventListener('paste', onPaste);
      proxy.addEventListener('input', onInput);
      popup.addEventListener('click', onBackdrop);

      popup._tmp = { onBeforeInput, onPaste, onInput, onBackdrop };
    });
  }

  function finalize(txt) {
    cleanup();
    importFromUrlOrTxt(txt, parser);
  }

  function cleanup() {
    popup.setAttribute('aria-hidden', 'true');
    if (popup._tmp) {
      proxy.removeEventListener('beforeinput', popup._tmp.onBeforeInput);
      proxy.removeEventListener('paste',        popup._tmp.onPaste);
      proxy.removeEventListener('input',        popup._tmp.onInput);
      popup.removeEventListener('click',        popup._tmp.onBackdrop);
      popup._tmp = null;
    }
    // Réinitialise la zone
    proxy.blur();
    proxy.textContent = '';
    btn.focus();
  }

  // 1️⃣ Tentative immédiate (doit être synchrone)
  try {
    const txt = await navigator.clipboard?.readText();
    if (txt) {
      importFromUrlOrTxt(txt, parser);
      return;
    }
  } catch {}
  // 2️⃣ Fallback : affiche la popup juste au-dessus du bouton
  if (isIOS) openPastePopup();
};

async function importFromUrlOrTxt(raw, parser=null) {

  let parsed = null;
  let mergeMode = 0;

  if (!parser) {
    if (looksLikeUrl(raw)) { 
      if (raw.includes("https://festival-avignon.com/fr/edition-2025/programmation/par-categorie")) {
        parsed = await asyncCallAvecOverlayAttente(parseAvignonInProgPageUrl, raw, 'Echec collage');
      } 
      else if (raw.includes("https://festival-avignon.com/fr/edition-2025/programmation/")) {
        parsed = await asyncCallAvecOverlayAttente(parseAvignonInSpecPageUrl, raw, 'Echec collage');
      } 
      else if (raw.includes("https://www.festivaloffavignon.com/programme")) {
        parsed = await asyncCallAvecOverlayAttente(parseAvignonOffProgPageUrl, raw, 'Echec collage');
      } 
      else if (raw.includes("https:www.festivaloffavignon.com/spectacles")) {
        parsed = await asyncCallAvecOverlayAttente(parseAvignonOffSpecPageUrl, raw, 'Echec collage');
      } 
      else if (raw.includes("https://www.billetreduc.com/search")) {
        parsed = await asyncCallAvecOverlayAttente(parseBilletReducProgPageUrl, raw, 'Echec collage');
      } 
      else if (raw.includes("https://www.billetreduc.com/spectacle")) {
        parsed = await asyncCallAvecOverlayAttente(parseBilletReducSpecPageUrl, raw, 'Echec collage');
        mergeMode = 1;
      } 
      else if (raw.includes("https://www.billetreduc.com/collection")) {
        parsed = await asyncCallAvecOverlayAttente(parseBilletReducCollecPageUrl, raw, 'Echec collage');
      } 
      else {
        alert("Il n'existe pas de lecteur pour cette adresse, essayez de coller après avoir copié le texte de la page.");
      }
    } else {
      switch (true) {
        case isAvignonInProgPageText(raw):
          parsed = syncCallAvecOverlayAttente(parseAvignonInProgPageText, raw, 'Echec collage');
          break;
        case isAvignonInSpecPageText(raw):
          parsed = syncCallAvecOverlayAttente(parseAvignonInSpecPageText, raw, 'Echec collage');
          break;
        case isAvignonOffProgPageText(raw):
          parsed = syncCallAvecOverlayAttente(parseAvignonOffProgPageText, raw, 'Echec collage');
          break;
        case isAvignonOffSpecPageText(raw):
          parsed = syncCallAvecOverlayAttente(parseAvignonOffSpecPageText, raw, 'Echec collage');
          break;
      }
    }
    if (!parsed || parsed.length == 0) {
      alert("Aucune valeur valide à coller. Commencer par aller dans un catalogue, afficher le programme ou la page d'un spectacle et copier l'adresse ou le texte de la page.");
      return null;
    }
  } else {
    if (parser == 'parseAvignonInProgPage') {
      if (looksLikeUrl(raw) && raw.includes("https://festival-avignon.com/fr/edition-2025/programmation/par-categorie")) {
        parsed = await asyncCallAvecOverlayAttente(parseAvignonInProgPageUrl, raw, 'Echec collage');
      }      
      if (!parsed || parsed.length == 0) {
        alert("Aucune activité valide à récupérer à l'adresse choisie.");
        return null;
      }
    } 
    else if (parser == 'parseAvignonOffProgPage') {
      if (looksLikeUrl(raw) && raw.includes("https://www.festivaloffavignon.com/programme")) {
        parsed = await asyncCallAvecOverlayAttente(parseAvignonOffProgPageUrl, raw, 'Echec collage');
      }
      if (!parsed || parsed.length == 0) {
        alert("Aucune activité valide à récupérer à l'adresse choisie.");
        return null;
      }
    } 
    else if (parser == 'parseBilletReducProgPage') {
      if (looksLikeUrl(raw) && raw.includes("https://www.billetreduc.com/search")) {
        parsed = await asyncCallAvecOverlayAttente(parseBilletReducProgPageUrl, raw, 'Echec collage');
      }
      if (!parsed || parsed.length == 0) {
        alert("Aucune activité valide à récupérer à l'adresse choisie.");
        return null;
      }
    } 
    if (!parsed || parsed.length == 0) {
      alert("Aucune valeur valide à coller. Commencer par aller dans un catalogue, afficher le programme ou la page d'un spectacle et copier le texte de la page.");
      return null;
    }
  }

  const nouvellesActivites = [];
  if (!parsed || parsed.length == 0) parsed = [{...PARSED_DEFAULT}];

  for (const row of parsed) {

    const nom = row.Activite || null;

    const hyperlienDefault = (nom) ? 
      (row.Orga.trim().toLowerCase() == 'off') ? 
      `https://www.festivaloffavignon.com/resultats-recherche?recherche=${nom.trim().replace(/\s+/g, '+')}` : 
      (row.Orga.trim().toLowerCase() == 'in') ? 
      `https://festival-avignon.com/fr/edition-2025/programmation/par-categorie`: 
      `https://www.billetreduc.com/search.htm?se=${nom.trim().replace(/\s+/g, '+')}` :
      null;

    const nouvelleActivite = {
        __uuid: crypto.randomUUID?.() || String(Date.now()),
        Date: null, 
        Debut: row.Debut || null, 
        Duree: row.Duree || null,
        Activite: nom, 
        Lieu: row.Lieu || null, 
        Session: row.Session || null,
        Relache: row.Relache || null, 
        Style: row.Style || null,
        Orga: row.Orga || null,
        Reserve: null, 
        Priorite: null, 
        Hyperlien: row.Hyperlien || hyperlienDefault,
      }
      nouvellesActivites.push(nouvelleActivite);
  }

  if (!nouvellesActivites || nouvellesActivites.length == 0) return;
  

  if (mergeMode == 1) {
    ctx.mutateDf(rows => { 
      const next = sortDf(overloadRowsOrInsert(rows, nouvellesActivites[0], ['Activite', 'Lieu'], ['Duree'])); 
      recalcFinForAll(next); 
      return next;
    });
    
  }
  else {
    recalcFinForAll(nouvellesActivites);
    ctx.mutateDf(rows => sortDf(mergeRowsNoDupMultiKey(nouvellesActivites, rows, ['Activite', 'Debut', 'Session'])));
  }

  // Maj des sélections
  setTimeout(() => {
    scrollToExpander?.('exp-non-programmees');
    openExpander?.('exp-non-programmees');
    selectRowByUuid('grid-non-programmees', nouvellesActivites[0].__uuid, { ensure: 'center', flash: null });
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

  if (activitesAPI.estPause(row)) {
    // 🗑️ Supprimer la ligne du DF
    ctx.mutateDf(rows => {
      const next = Array.isArray(rows) ? rows.filter(r => r?.__uuid !== uuid) : [];
      return sortDf(next);
    });

    // sélectionne le voisin dans la source
    selectRowByUuid('grid-programmees', uuidVoisin, { ensure: null, flash: null });

    // Si on a supprimé la ligne définitivement, on NE la déplace PAS vers "non-programmées".
    // On force un léger repaint si besoin :
    try { refreshGrid?.('grid-programmees'); } catch {}
    return;
  }

  // Mutation immuable
  ctx.mutateDf(rows => {
    let next = rows.slice();
    const i = next.findIndex(r => r.__uuid === uuid);
    if (i >= 0) next[i] = { ...next[i], Date: null };
    next = sortDf(next);
    return next;
  });

  dropRowFromSrcGridToDstGrid('grid-programmees', 'grid-non-programmees', 'exp-non-programmees', uuidVoisin, uuid, scroll=false);
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
  const uuidVoisin = getLigneVoisineUuid(getRowsFromGridId('grid-programmables'), uuid);

  ctx.mutateDf(rows => {
    const next = Array.isArray(rows) ? rows.slice() : [];

    const idx = (uuid != null)
      ? next.findIndex(r => r && r.__uuid === uuid)
      : -1;

    // payload normalisé (Date convertie)
    const payload = { ...sel, Date: dateInt };

    if (idx >= 0) {
      // ✅ met à jour la ligne existante
      next[idx] = { ...next[idx], ...payload };
    } else {
      // ✅ ajoute une nouvelle ligne (assure un __uuid)
      if (!payload.__uuid) {
        payload.__uuid = crypto.randomUUID?.()
          || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      }
      next.push(payload);
    }

    // trie final (inchangé par rapport à ton flux)
    return sortDf(next);
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

  // doPhantomFlight('grid-programmables', 'grid-programmees', 'exp-programmees');
  dropRowFromSrcGridToDstGrid('grid-programmables', 'grid-programmees', 'exp-programmees', uuidVoisin, uuid, scroll=true);
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
    doAjouterActivitesParCollage();
  });

  // --- Ajouter ---
  $('btn-add')?.addEventListener('click', (e) => {
    pulse(e.currentTarget);
    doAjouterActivite();
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
  const isSmallScreen = window.matchMedia('(max-width: 768px)').matches;
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.userAgent.includes('Mac') && 'ontouchend' in document); // iPadOS 13+

  if (isSmallScreen || isIOS) {
    openFileSheet(); // version mobile et iPad
  } else {
    openFileMenu(anchorBtn);  // version desktop
  }
}

// File menu/sheet inner HTML
const fileMenuSheetInnerHtml = () => {
  return `
    <ul class="file-sheet__list">
      <li class="file-sheet__item" data-action="new">
        <svg class="file-sheet__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
        <div class="file-sheet__text">
          <span class="file-sheet__titleText">Nouveau programme</span>
          <span class="file-sheet__subtitle">Réinitialise le programme d'activités</span>
        </div>
      </li>
      <li class="file-sheet__item" data-action="open">
        <svg class="file-sheet__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h7l3 3h6v13H4z"/></svg>
        <div class="file-sheet__text">
          <span class="file-sheet__titleText">Importer depuis Excel</span>
          <span class="file-sheet__subtitle">Importe un fichier Excel contenant une liste d'activités</span>
        </div>
      </li>
      <li class="file-sheet__item" data-action="importCatIn">
        <svg class="file-sheet__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h7l3 3h6v13H4z"/></svg>
        <div class="file-sheet__text">
          <span class="file-sheet__titleText">Importer depuis le catalogue du In</span>
          <span class="file-sheet__subtitle">Importe le programme du catalogue du In</span>
        </div>
      </li>
      <li class="file-sheet__item" data-action="importCatOff">
        <svg class="file-sheet__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h7l3 3h6v13H4z"/></svg>
        <div class="file-sheet__text">
          <span class="file-sheet__titleText">Importer depuis le catalogue du Off</span>
          <span class="file-sheet__subtitle">Importe le programme du catalogue du Off</span>
        </div>
      </li>
      <li class="file-sheet__item" data-action="importBilletReduc">
        <svg class="file-sheet__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h7l3 3h6v13H4z"/></svg>
        <div class="file-sheet__text">
          <span class="file-sheet__titleText">Importer depuis Billet réduc</span>
          <span class="file-sheet__subtitle">Importe depuis le site de billet réduc</span>
        </div>
      </li>
      <li class="file-sheet__item" data-action="exportExcel">
        <svg class="file-sheet__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5h11l5 5v9a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8M7 5v4h8"/></svg>
        <div class="file-sheet__text">
          <span class="file-sheet__titleText">Exporter vers Excel</span>
          <span class="file-sheet__subtitle">Sauvegarde la liste d'activités dans un fichier Excel</span>
        </div>
      </li>
      <li class="file-sheet__item" data-action="exportIcs">
        <svg class="file-sheet__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5h11l5 5v9a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8M7 5v4h8"/></svg>
        <div class="file-sheet__text">
          <span class="file-sheet__titleText">Exporter vers calendrier</span>
          <span class="file-sheet__subtitle">Exporte le filtre sur le programme d'activités vers l'application calendrier</span>
        </div>
      </li>
      <li class="file-sheet__item" data-action="rapportCoherence">
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"
            viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"
            aria-hidden="true" focusable="false">
          <!-- Feuille -->
          <path d="M7 3h6l4 4v11a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3z"/>
          <path d="M13 3v4h4"/>
          <!-- Coche -->
          <path d="M8.8 13.2l2 2 4.2-4.2"/>
          <!-- Lignes de texte -->
          <path d="M8 18h8"/>
        </svg>
        <div class="file-sheet__text">
          <span class="file-sheet__titleText">Rapport de vérification de cohérence</span>
          <span class="file-sheet__subtitle">Edite un rapport sur la cohérence de la liste d'activités (chevauchements, formats)</span>
        </div>
      </li>
    </ul>
  `;
}

// Construit le menu fichier (desktop)
function openFileMenu(anchorBtn) {
  // évite doublons
  document.querySelectorAll('.kebab-menu.file-menu').forEach(m => m.remove());

  const menu = document.createElement('div');
  menu.className = 'kebab-menu';

  // items
  const items = [
    { id:'new',  label:'Nouveau programme'     },
    { id:'open', label:'Importer depuis Excel'      },
    { id:'importCatIn', label:'Importer depuis le catalogue du In'      },
    { id:'importCatOff', label:'Importer depuis le catalogue du Off'      },
    { id:'importBilletReduc', label:'Importer depuis Billet réduc'      },
    { id:'exportExcel', label:'Exporter vers Excel' },
    { id:'exportIcs', label:'Exporter vers calendrier' },
    { id:'rapportCoherence', label:'Rapport de vérification de cohérence' },
  ];
  menu.innerHTML = `
    <div class="file-menu__panel" role="dialog" aria-modal="true">` +
      fileMenuSheetInnerHtml() +
    `</div>
  `;

  document.body.appendChild(menu);

  // première mesure invisible → position → afficher
  menu.getBoundingClientRect(); // force layout
  positionMenuOverBtn(anchorBtn, menu, { gap: 10 });
  // petite anim (via .show)
  requestAnimationFrame(() => menu.classList.add('show'));

  // actions
  const close = () => { menu.classList.remove('show'); setTimeout(()=>menu.remove(), 120); };

  menu.querySelectorAll('.file-sheet__item').forEach(li => {
    li.addEventListener('click', () => {
      const act = li.dataset.action;
      close();
      if (act === 'new')  doNouveauContexte?.();
      if (act === 'open') doImportExcel?.();
      if (act === 'importCatIn') doImportFromCatIn?.();
      if (act === 'importCatOff') doImportFromCatOff?.();
      if (act === 'importBilletReduc') openSheetImportBilletReduc?.();
      if (act === 'exportExcel') doExportExcel?.();
      if (act === 'exportIcs') doExportIcs?.();
      if (act === 'rapportCoherence') doVerifierCoherence?.();
    });
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

// Construit le menu fichier (mobile)
function openFileSheet() {
  const existing = document.querySelector('.file-sheet');
  if (existing) { existing.remove(); return; }

  const sheet = document.createElement('div');
  sheet.className = 'file-sheet';
  sheet.innerHTML = fileMenuSheetInnerHtml();

  sheet.innerHTML = `
    <div class="file-sheet__backdrop"></div>
    <div class="file-sheet__panel" role="dialog" aria-modal="true">
      <span class="file-sheet__handle" aria-hidden="true"></span>
      <div class="file-sheet__content">` +
        fileMenuSheetInnerHtml() +
        `<div class="file-sheet__footer">
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
      if (act === 'importCatIn') doImportFromCatIn?.();
      if (act === 'importCatOff') doImportFromCatOff?.();
      if (act === 'importBilletReduc') openSheetImportBilletReduc?.();
      if (act === 'exportExcel') doExportExcel?.();
      if (act === 'exportIcs') doExportIcs?.();
      if (act === 'rapportCoherence') doVerifierCoherence?.();
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
    const f = ev.target.files?.[0] || null;
    importFromXlsxFile(f);
    ev.target.value = '';
  });
}

// Import de fichier Excel
async function importFromXlsxFile(f, {add=false} = {}) {

  if (!f) return;
  try {
    overlayAttente.hidden = false; // Affiche l'overlay d'attente

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
        if (!isDateint(di) && typeof o.Date === 'number') {
          const ymd = excelSerialToYMD(o.Date);
          if (ymd) di = ymdToDateint(ymd);
        }
      }
      o.Date = di || null; // stock interne = dateint ou null

      // Accepte Excel serial sur Session et Relache
      if (typeof o.Session === 'number') {
        if (o.Session < 0 || o.Session > 31) {
          const ymd = excelSerialToYMD(o.Session);
          if (ymd) {
            const di = ymdToDateint(ymd);
            o.Session = (isDateint(di)) ? dateintToPretty(di) : String(o.Session).trim();
          } else String(o.Session).trim();
        } else String(o.Session).trim();
      }
      if (typeof o.Relache === 'number') {
        if (o.Relache < 0 || o.Relache > 31) {
          const ymd = excelSerialToYMD(o.Relache);
          if (ymd) {
            const di = ymdToDateint(ymd);
            o.Relache = (isDateint(di)) ? dateintToPretty(di) : String(o.Relache).trim();
          } else String(o.Relache).trim();
        } else String(o.Relache).trim();
      }

      // 7) __uuid garanti
      if (!o.__uuid) {
        o.__uuid = (crypto.randomUUID?.()) || `${Date.now()}_${i}`;
      }
      return o;
    });
    
    if (!add) {
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

      // 10) Recalcul de la colonne Fin
      recalcFinForAll(dfRows);

      // 11) Initialisation de la période de programmation
      activitesAPI.initPeriodeProgrammation(dfRows);      

      // 12) Enregistrement des données dans le contexte
      ctx.beginAction('import');
      try {
        ctx.setDf(dfRows);     
        ctx.setCarnet(caRows);      
      } finally {
        ctx.endAction();                   
      }

      // 13) Mise à jour des colonnes de grilles
      rebuildColumnsForActiviteGrids(dfRows);
    }
    else {
      recalcFinForAll(dfRows);
      if (!dfRows || dfRows.length == 0) return;
      // ctx.mutateDf(rows => sortDf([...nouvellesActivites, ...rows]));
      ctx.mutateDf(rows => sortDf(mergeRowsNoDupMultiKey(dfRows, rows, ['Activite', 'Debut', 'Session'])));

      // Maj des sélections
      setTimeout(() => {
        scrollToExpander?.('exp-non-programmees');
        openExpander?.('exp-non-programmees');
        selectRowByUuid('grid-non-programmees', dfRows[0].__uuid, { ensure: 'center', flash: null });
      }, 50);  
    }
  }

  catch (e) {
    console.error('❌ Import Excel KO', e);
    alert("Echec de l'import : " + e.message);
  } finally {
    overlayAttente.hidden = true; // Masque l'overlay d'attente
  }
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
  
  btn.addEventListener('click', (e) => {
    e.stopPropagation();  // Évite que le clic se propage à un parent cliquable
    openKebabMenu(btn, {
      items: [
        { id:'carnet', label:"Carnet d'adresses",          onClick: ()=>openSheetCarnet() },
        { id:'settings', label:'Paramètres',               onClick: ()=>openSheetParams() },
        { id:'help',     label:'Aide',                     onClick: ()=>openSheetAide() },
      ]
    });
  }, { passive: true });
}

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

// Obsolete (bug au basculement sur IOS => page grille disparait au retour en mode portrait)
function openSheet({
  title = '',
  mount,
  onClose,
  classes = '',
  panelMaxHeight = '60vh',
  panelHeight = null,
  replaceExisting = false
} = {}) {

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

  // =============
  // Swipe handler 
  // =============
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

function openSheetExclusive({
  title = '',
  mount,            // (bodyEl, helpers) => { bodyEl.innerHTML='...' }
  classes = {       // mapping classes (noms par défaut)
    wrap: 'sheet-wrap',
    backdrop: 'sheet-backdrop',
    panel: 'sheet-panel',
    header: 'sheet-header',
    handle: 'sheet-handle',
    title: 'sheet-title',
    actions: 'sheet-actions',
    closeBtn: 'sheet-close',
    body: 'sheet-body',
    // états
    isOpen: 'is-open',
    isClosing: 'is-closing',
    dragging: 'dragging',
  },
  showClose = true,
  swipeBody = false,          // swipe aussi sur le body (hors ag-grid / inputs)
  panelHeight = '60vh',
  panelMaxHeight = '70vh',
  onOpen, onAfterOpen, onBeforeClose, onClose,
} = {}) {

  // exclusif : enlever toute sheet ouverte
  document.querySelectorAll('.' + classes.wrap).forEach(n => n.remove());

  // markup conforme à ta CSS
  const root = document.createElement('div');
  root.className = classes.wrap;
  root.innerHTML = `
    <div class="${classes.backdrop}" data-backdrop></div>
    <div class="${classes.panel}" role="dialog" aria-modal="true"
         style="max-height:${panelMaxHeight};height:${panelHeight}">
      <span class="${classes.handle}" aria-hidden="true"></span>
      <header class="${classes.header}" data-drag-region>
        <div class="${classes.title}">${title || ''}</div>
        <button class="${classes.closeBtn}" title="Fermer" aria-label="Fermer">×</button>
      </header>
      <div class="${classes.body}" data-body></div>
    </div>
  `;

  document.body.appendChild(root);

  const panel    = root.querySelector('.' + classes.panel);
  const header   = root.querySelector('.' + classes.header);
  const headerRow= root.querySelector('.' + classes.headerRow);
  const bodyEl   = root.querySelector('[data-body]');
  const backdrop = root.querySelector('[data-backdrop]');
  const closeBtn = root.querySelector('.' + classes.closeBtn);

  // contenu
  const helpers = {
    close, root, panel, header, bodyEl,
    qs: (sel) => root.querySelector(sel),
    qsa: (sel) => [...root.querySelectorAll(sel)],
    pingGrids: () => {
      const apis = collectGridApis(window.grids);
      requestAnimationFrame(() => {
        apis.forEach(a => a.onGridSizeChanged?.());
        requestAnimationFrame(() => apis.forEach(a => a.onGridSizeChanged?.()));
      });
    }
  };
  try { mount?.(bodyEl, helpers); } catch (e) { console.error('sheet mount error:', e); }

  // ouverture (ta CSS anime sur .is-open)
  requestAnimationFrame(() => {
    root.classList.add(classes.isOpen);
    onOpen?.(helpers);
    requestAnimationFrame(() => {
      if (bodyEl.getBoundingClientRect().height < 60) bodyEl.style.minHeight = '40vh';
      helpers.pingGrids();
      onAfterOpen?.(helpers);
    });
  });

  // fermeture avec état .is-closing si ta CSS l’utilise
  function close(reason='manual') {
    onBeforeClose?.(helpers, reason);
    root.classList.remove(classes.isOpen);
    if (classes.isClosing) root.classList.add(classes.isClosing);
    panel.style.transform = ''; // rollback si un swipe a posé un translateY
    setTimeout(() => { root.remove(); onClose?.(helpers, reason); }, 260);
  }

  // events
  backdrop?.addEventListener('click', () => close('backdrop'));
  closeBtn?.addEventListener('click', () => close('close'));
  window.addEventListener('keydown', e => { if (e.key === 'Escape') close('esc'); }, { once:true });

  // swipe header (+ optionnel body), en évitant AG Grid et les inputs
  const isInteractive = el => el.closest('input,select,textarea,button,[contenteditable="true"]');
  const isAgGridArea  = el => el.closest('.ag-root, .ag-body-viewport, .ag-center-cols-viewport');

  function attachSwipe(areaEl) {
    if (!areaEl) return;
    let startY=0, moved=0, dragging=false;

    const onStart = (ev) => {
      const t = ev.touches ? ev.touches[0] : ev;
      const target = ev.target;
      if (isInteractive(target) || isAgGridArea(target)) return;
      startY = t.clientY; moved=0; dragging=true;
      root.classList.add(classes.dragging);
      window.addEventListener('touchmove', onMove, { passive:false });
      window.addEventListener('mousemove', onMove, { passive:false });
      window.addEventListener('touchend', onEnd);
      window.addEventListener('mouseup', onEnd);
    };
    const onMove = (ev) => {
      if (!dragging) return;
      const t = ev.touches ? ev.touches[0] : ev;
      const dy = Math.max(0, t.clientY - startY);
      moved = dy;
      panel.style.transform = `translateY(${dy}px)`; // temporaire
      ev.preventDefault();
    };
    const onEnd = () => {
      if (!dragging) return;
      dragging=false;
      root.classList.remove(classes.dragging);
      const ph = panel.getBoundingClientRect().height || 1;
      if (moved > ph * 0.25) close('swipe');
      else panel.style.transform = ''; // rollback → la CSS reprend la main
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('touchend', onEnd);
      window.removeEventListener('mouseup', onEnd);
    };

    areaEl.addEventListener('touchstart', onStart, { passive:true });
    areaEl.addEventListener('mousedown', onStart);
  }

  attachSwipe(header);              // swipe depuis tout le header (inclut handle)
  if (swipeBody) attachSwipe(bodyEl);

  return { close, root, panel, bodyEl, header, headerRow };
}

// util AG Grid (inchangé)
function collectGridApis(gridsLike) {
  if (!gridsLike) return [];
  if (Array.isArray(gridsLike)) return gridsLike.map(h => h?.api).filter(a => a?.onGridSizeChanged);
  if (typeof gridsLike?.forEach === 'function') { const out=[]; gridsLike.forEach(v=>out.push(v?.api||v)); return out.filter(a=>a?.onGridSizeChanged); }
  if (gridsLike?.api?.onGridSizeChanged) return [gridsLike.api];
  if (typeof gridsLike === 'object') return Object.values(gridsLike).map(h=>h?.api).filter(a=>a?.onGridSizeChanged);
  return [];
}

function closeSheet(classes = {}) {
  const rootClass = classes.root || 'sheet-root';
  const visibleRoot = classes.visibleRoot || 'open';
  const root = document.querySelector('.' + rootClass);
  if (!root) return;
  root.classList.remove(visibleRoot);
  const panel = root.querySelector('.' + (classes.panel || 'sheet-panel'));
  if (panel) panel.style.transform = '';
  setTimeout(() => root.remove(), 260);
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

// Feuille Carnet d'adresses
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
      // actions.className = 'sheet-actions';
      // actions.innerHTML = `
      actions.className = 'sheet-footer';
      actions.style.justifyContent = 'flex-start';
      actions.innerHTML = `
        <div class="sheet-actions">
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
        </div>
      `;

      // injecte dans la sheet
      body.append(host, actions);

      // grille 
      const columns = [
        { field:'Nom', headerName:'Nom', minWidth:100, flex:1, editable:true },
        { field:'Adresse', headerName:'Adresse', minWidth:200, flex:2, editable:true },
        { field:'Tel', headerName:'Téléphone', minWidth:100, flex:1, editable:true, cellRenderer: TelRenderer },
        { field:'Web', headerName:'Web', minWidth:200, flex: 2, editable:true, cellRenderer: WebRenderer },
      ];

      const gridOptions = {
        columnDefs: columns,
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

      // ⚠️ Très important : cibler la *bonne* racine de CETTE grille
      requestAnimationFrame(() => {
        const root = gridDiv.querySelector('.ag-root') || gridDiv;
        enableTouchEdit(apiGrid, root, { debug:false });
      });

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

// Feuille paramètres
function openSheetParams() {
  const meta = (window.ctx?.meta) || {};
  const curDeb = localDateToIsoDate(meta.periode_a_programmer_debut) || ''; 
  const curFin = localDateToIsoDate(meta.periode_a_programmer_fin) || ''; 
  const marge      = Math.max(0, Number(meta.MARGE ?? 10)|0);
  const dureeRepas = Math.max(0, Number(meta.DUREE_REPAS ?? 60)|0);
  const dureeCafe = Math.max(0, Number(meta.DUREE_CAFE ?? 60)|0);
  const itin          = String(meta.itineraire_app || 'Google Maps Web');
  const cityDefault   = String(meta.city_default || 'Avignon');

  openSheetExclusive({
    title: 'Paramètres',
    panelHeight: '59vh', 
    panelMaxHeight: '59vh', 
    // swipeBody: true,
    mount: (body, {close}) => {
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
            <label>Application itinéraire</label>
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
        </div>

        <div class="sheet-footer has-border">
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

          // <div class="form-row">
          //   <label>Durée des pauses café (min)</label>
          //   <input id="p-cafe" type="number" min="0" step="5" value="${dureeCafe}"/>
          // </div>

      const $deb = body.querySelector('#pp-debut');
      const $fin = body.querySelector('#pp-fin');
      const $mar = body.querySelector('#p-marge');
      const $rep = body.querySelector('#p-repas');
      // const $caf = body.querySelector('#p-cafe');
      const $it  = body.querySelector('#p-itin');
      const $ci  = body.querySelector('#p-city');

      body.querySelector('#p-cancel')?.addEventListener('click', close);

      body.querySelector('#p-save')?.addEventListener('click', () => {
        const d1 = isoDateToLocalDate($deb.value);
        const d2 = isoDateToLocalDate($fin.value);

        if (!d1 || !d2 || d2 < d1) {
          alert('Dates invalides (fin >= début).');
        }

        const mar = Math.max(0, Number($mar.value||0)|0);
        const rep = Math.max(0, Number($rep.value||0)|0);
        const caf = 30; //Math.max(0, Number($caf.value||0)|0);
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

// Feuille Aide
function openSheetAide() {
  openSheetExclusive({
    title: 'Aide',
    panelMaxHeight: '70vh',
    panelHeight: '60vh',
    // swipeBody: true,
    mount: (body) => {
      body.innerHTML = `
        <!-- Table des matières -->
        <div class="help-toc">
          <a data-target="generalites">Fonctionnalités générales</a>
          <a data-target="regles-programmation">Règles de programmation</a>
          <a data-target="ui">Interface utilisateur</a>
          <a data-target="format-donnees">Format des données</a>
        </div>

        <!-- Chapitres -->
        <div id="help-generalites" class="help-chapter">
          <div class="help-back" data-back>
            <svg viewBox="0 0 24 24" fill="none"><path d="M15 18l-6-6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
            Retour
          </div>
          <div class="help-block">
            <p><u><i>In & Off</u></i> est là pour vous aider à bâtir votre programme de spectacles.</p>
            
            <p>Il est paramétré pour offrir un accès direct aux catalogues du festival d'Avignon, mais peut répondre plus généralement à toute utilisation 
            nécessitant de programmer des activités sur une période donnée. 
            
            <p style="margin-bottom: 0.2em"><u><i>In & Off</u></i> vous permettra notamment :</p>
            <ul style="margin-top: 0em; margin-bottom: 2em">
              <li>de <u><i>charger</u></i> des spectacles et des activités à programmer à partir d'un fichier Excel, ou par collage depuis des catalogues en ligne,</li>
              <li>de <u><i>programmer</u></i> des spectacles et activités, en évitant chevauchements et doublons,</li>
              <li>d'identifier les <u><i>plages libres</u></i> de votre programme de spectacles, ainsi que les <u><i>activités programmables</u></i> sur ces plages,</li>
              <li>de <u><i>naviguer</u></i> vers la description détaillée des spectacles et activités et rechercher l'<u><i>itinéraire</u></i> de vos sites de spectacles,</li>
              <li>de gérer un <u><i>carnet d'adresses</u></i> des sites de spectacles,</li>
              <li>de <u><i>sauvegarder</u></i> votre programme vers Excel ou votre application calendrier,</li>
              <li>de <u><i>vérifier la cohérence</u></i> de vos données (chevauchements d'activités, respect des marges entre activités, format des données).</li>
            </ul>            
          </div>

            <p>Pour démarrer, rien de plus simple : allez dans <u><i>Mon programme</u></i>, importez un catalogue (menu <u><i>Fichier/Importer...</u></i>), 
            définissez une période de programmation (menu <u><i>.../Paramètres</u></i>), chosissez une plage libre et appuyez sur le bouton <u><i>Programmer</u></i> ! 
        </div>
            
        <div id="help-regles-programmation" class="help-chapter">
          <div class="help-back" data-back>
            <svg viewBox="0 0 24 24" fill="none"><path d="M15 18l-6-6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
            Retour
          </div>
          <div class="help-block">
            <p style="margin-bottom: 0.2em">Règles adoptées pour la programmation des activités:</p>
            <ul style="margin-top: 0em; margin-bottom: 0.5em">
              <li>30 minutes de marge entre activités</li>
              <li>1 heure par pause repas</li>
              <li>Respect des périodes pendant lesquelles l'activité est valide et des périodes ou jours de relâche.</li>
            </ul>
            <p>Ces valeurs par défaut sont paramétrables via le menu .../Paramètres.</p>
          </div>
        </div>

        <div id="help-ui" class="help-chapter">
          <div class="help-back" data-back>
            <svg viewBox="0 0 24 24" fill="none"><path d="M15 18l-6-6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
            Retour
          </div>
          <div class="help-block">
            <p>L'application comprend deux pages sélectionnables par balayage gauche / droite ou click sur les icônes gauche et centrale de l'entête.</p>

            <p>La première page <u><i>Catalogue</u></i> propose des liens ves les catalogues du In et du Off du festival d'Avignon et la deuxième <u><i>Mon programme</u></i> permet 
            de construire un programme personnalisé de spectacles ou autres activités.</p>
                         
            <p style="margin-bottom: 0.2em">La page <u><i>Mon programme</u></i>, comprend quatre tableaux:</p>
            <ul style="margin-top: 0em">
                <li><u><i>Programme</u></i>: tableau des activités programmées (i.e. activités avec date de programmation)
                <li><u><i>Plages libres</u></i>: tableau des plages libres entre activités programmées (seules les plages dans lesquelles existent des activités programmables sont listées)
                <li><u><i>Programmer...</u></i>: tableau des activités programmables dans la plage libre sélectionnée
                <li><u><i>Stock</u></i>: tableau des activités non programmées (i.e. activités sans date de programmation).
            </ul>
      
            </p>Dans les tableaux <u><i>Programme</u></i>, <u><i>Plages libres</u></i> et <u><i>Programmer...</u></i> les lignes sont colorisées en fonction de leur Date et dans le tableau
            <u><i>Stock</u></i> les activités programmables (celles pour lesquelles il existe une date de programmation possible) sont colorisées en vert menthe. 
            Dans le tableau <u><i>Programme</u></i> les activités réservées sont libellées en rouge. 

            <p style="margin-bottom: 0.2em">Une activité programmable peut être programmée (i.e. insérée dans le tableau <u><i>Programme</u></i> à une date donnée)
            de deux manières différentes:
            <ul style="margin-top: 0em">
                <li>Soit en sélectionnant une plage libre, puis dans cette plage une activité programmable, puis en appuyant sur le bouton <u><i>Programmer</u></i> 
                (situé en haut à droite du tableau <u><i>Programmer...</u></i>)</i> 
                <li>Soit en sélectionnant une activité programmable (activités colorisées en vert menthe) dans le stock et en dépliant le menu de la 
                colonne <u><i>Date</u></i>, lequel liste les jours de programmation possible.</i> 
            </ul>

            </p>Pour déprogrammer une activité il suffit de la sélectioner dans le tableau <u><i>Programme</u></i> et d'appuyer sur le bouton <u><i>Supprimer</u></i> 
            (situé en haut à droite de ce même tableau). Une fois déprogrammée, l'activité bascule dans le tableau <u><i>Stock</u></i>.</p>
            
            </p>Pour la reprogrammer, déplier le menu de la colonne <u><i>Date</u></i> et sélectionner une autre date possible.</p>

            </p>Le bouton <u><i>Supprimer</u></i> du tableau <u><i>Stock</u></i> permet de supprimer l'activité sélectionnée et le bouton <u><i>Colonnes</u></i> permet 
            d'ajouter ou supprimer des colonnes sur les activités.</p>

            <p>Dans les tableaux <u><i>Programme</u></i> et <u><i>Stock</u></i> toutes les informations sont éditables, sauf les heures de fin (qui sont calculées automatiquement) 
            et les dates de programmation, heures de début et durées des activités réservées (celles dont la colonne <u><i>Réservé</u></i> est à Oui). Elles sont également 
            triables (par clic sur les entêtes de colonnes) et filtrables (par clic sur le bouton <u><i>Filtrer</u></i> des entêtes de grilles ou directement 
            dans les entêtes de colonnes si la dimension de l'écran le permet).</p>

            <p>L'icône de la colonne <u><i>Activité</u></i> permet d'afficher la page Web donnée par la colonne <u><i>Hyperlien</u></i> et 
            l'icône de la colonne <u><i>Lieu</u></i> permet de lancer une recherche d'itinéraire sur le lieu de l'activité, via l'application choisie 
            dans les paramètres et l'adresse du lieu d'activité renseignée dans le carnet d'adresse, ou à défaut le nom du lieu et un nom de ville défini dans les paramètres.</p>
                        
            <p style="margin-bottom: 0.2em">Deux menus permettent d'accéder des fonctionnalités complémentaires:</p>
            <ul style="margin-top: 0em">
              <li>Barre de menu en bas de la page "Mon Programme" comprenant les boutons suivants:
                <ul style="margin-top: 0em">
                    <li><u><i>Fichier</u></i>: permet de créer un nouveau programme d'activités, charger un programme d'activités depuis un fichier 
                    Excel, importer des activités depuis les catalogues en ligne du In et du Off ou le site de billet réduc, exporter le programme d'activités 
                    vers Excel ou vers le calendrier, obtenir un rapport de cohérence des données.</li>
                    <li><u><i>Défaire</u></i> / <u><i>Refaire</u></i>: permettent de défaire, refaire une opération.</li>
                    <li><u><i>Coller</u></i>: collage d'activités depuis le presse-papier. Pour utiliser cette fonctionnalité, copier préalablement 
                    soit l'adresse d'une page du catalogue du In ou du Off (via Partager/Copier ou par copie du champ adresse), soit son contenu. 
                    Il peut s'agir soit d'une page programme listant plusieurs spectacles, soit de la page de détail d'un spectacle.</li>
                    <li><u><i>Ajouter</u></i>: ajout d'une activité.</li>
                </ul>
              </li>
              <li>Menu "..." comprenant les items suivants:
                <ul style="margin-top: 0em">
                    <li><u><i>Carnet d'adresses</u></i>: présente le carnet d'adresses. Les champs <u><i></u>Nom</i> / <u><i></u>Adresse</i> / 
                    <u><i></u>Téléphone</i> / <u><i></u>Web</i> de chaque entrée peuvent être édités et des boutons permettent d'ajouter / supprimer 
                    des entrées, défaire / refaire ces opérations. Dans les colonnes Tel (Numéro de Téléphone) et Web (Adresse Web) des boutons permettent 
                    d'appeler le numéro de téléphone ou aller sur le site Web correspondant.</li>
                    <li><u><i>Paramètres</u></i>: permet d'éditer les paramètres de l'application comprenant:
                      <ul>
                        <li>la <u><i>période de programmation</u></i></li>
                        <li>la <u><i>marge</u></i> entre activités</li>
                        <li>la <u><i>durée</u></i> des pauses repas</li>
                        <li>le nom de <u><i>l'application d'itinéraire</u></i> (Google Maps, Apple, etc.)</li>
                        <li>la <u><i>ville</u></i> de recherche par défaut pour la recherche d'itinéraire.</li>
                      </ul>
                    </li>
                    <li><u><i>Aide</u></i>: la présente aide</li>
                </ul>
              </li>
            </ul>                        
          </div>
        </div>

        <div id="help-format-donnees" class="help-chapter">
          <div class="help-back" data-back>
            <svg viewBox="0 0 24 24" fill="none"><path d="M15 18l-6-6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
            Retour
          </div>
          <div class="help-block">
            <p style="margin-bottom: 0.2em">Le fichier Excel d'entrée doit contenir en feuille 1 au moins les colonnes suivantes:</p>
            <ul style="margin-top: 0em; margin-bottom: 2em">
                <li><u><i>Date</u></i> : Date de l'activité (entier)</li>
                <li><u><i>Début</u></i> : Heure de début de l'activité (format HHhMM)</li>
                <li><u><i>Fin</u></i> : Heure de fin de l'activité (format HHhMM)</li>
                <li><u><i>Durée</u></i> : Durée de l'activité (format HHhMM ou HHh)</li>
                <li><u><i>Activité</u></i> : Nom de l'activité (nom de spectacle, pause, visite, ...)</li>
                <li><u><i>Lieu</u></i> : Lieu de l'activité</li>
                <li><u><i>Séances</u></i> : Jours / périodes de séance de l'activité (voir ci-dessous les formats acceptés)</li>
                <li><u><i>Relâches</u></i> : Jours / périodes de relâche de l'activité (voir ci-dessous les formats acceptés)</li>
                <li><u><i>Réservé</u></i> : Indique si l'activité est réservée (Oui/Non, vide interpété comme Non)</li>
            </ul>

            <p style="margin-bottom: 0.2em">Les jours / périodes de séance ou de relâche sont une suite séparée par des virgules de l'une des formes suivantes:</p>
            <ul style="margin-top: 0em; margin-bottom: 2em">
                <li>Suite de dates de type jour ou jour/mois ou jour/mois/année, séparées par des virgules (mois ou année omis -> mois et année en cours)</li>
                <li>Regroupement de jours : (j1, j2, ...)/mois ou (j1, j2, ...)/mois/année</li>
                <li>Intervalle de dates: [dmin-dmax] ou [jmin-jmax]/mois ou /mois/année</li>
                <li>Jours de la semaine sur un intervalle de dates: [dmin-dmax] j1 j2 ... ou [jmin-jmax]/mois j1 j2 ... ou /mois/année j1 j2 ..., avec ji jour de la semaine sur deux lettres </li>
                <li>Spécification de jours pairs ou impairs: 'pair(s)' / 'impair(s)'</li>
                <li>Exemple: '04/07/25, (8,10)/07, [20-22]/07, jours pairs' -> le 04/07/2025, les 8 et 10 juillet de l'année en cours, 
                entre le 20 et le 22 juillet de l'année en cours et les jours pairs.</li>
            </ul>
                        
            <p style="margin-bottom: 0.2em">En feuille 2 peut figurer un carnet d'adresses des lieux d'activités. Il est utilisé pour la recherche d'itinéraire et
            doit comprendre au moins les colonnes suivantes:</p>
            <ul style="margin-top: 0em; margin-bottom: 2em">
                <li><u><i>Nom</u></i> : nom devant figurer dans la colonne Lieu des tableaux d'activités pour que l'adresse associée soit utilisée dans la recherche d'itinéraire</li>
                <li><u><i>Adresse</u></i> : adresse utilisée pour la recherche d'itinéraire</li>
                <li><u><i>Téléphone</u></i> : numéro de téléphone</li>
                <li><u><i>Web</u></i> : adresse du site Web</li>
            </ul>

            <p>📥Un modèle Excel est disponible <a href="https://github.com/jnicoloso-91/PlanifAvignonOff_PWA/raw/main/Mod%C3%A8le%20Excel.xlsx" download>
            ici
            </a></p>
            <p>ℹ️ Si le téléchargement du modèle ne démarre pas, faites un clic droit → "Enregistrer le lien sous...".</p>
          </div>
        </div>
      `;

      // — Logiciel simple de navigation
      const toc = body.querySelector('.help-toc');
      const chapters = [...body.querySelectorAll('.help-chapter')];

      toc.addEventListener('click', (e) => {
        const link = e.target.closest('a[data-target]');
        if (!link) return;
        const key = link.dataset.target;
        toc.style.display = 'none';
        chapters.forEach(ch => ch.classList.toggle('active', ch.id === 'help-' + key));
      });

      body.addEventListener('click', (e) => {
        if (e.target.closest('[data-back]')) {
          chapters.forEach(ch => ch.classList.remove('active'));
          toc.style.display = 'block';
        }
      });
    }
  });
}

// Feuille Rapport de cohérence 
function openSheetCoherence(rows, {
  title = 'Cohérence des données',
  // tu peux injecter tes validators ; par défaut on prend ceux exposés en global
  estRelacheValideFn = (v) => (typeof estRelacheValide === 'function' ? estRelacheValide(v) : true),
  estSessionValideFn = (v) => (typeof estSessionValide === 'function' ? estSessionValide(v) : true),
  estDateProgrammableFn = (d, s, r) => (typeof _estDateProgrammable === 'function' ? _estDateProgrammable(s, r, d) : true),
} = {}) {
  const html = activitesAPI.getLogVerifierCoherenceJS(rows, { estRelacheValideFn, estSessionValideFn, estDateProgrammableFn });

  openSheetExclusive({
    title,
    panelMaxHeight: '70vh',
    panelHeight: '60vh',
    mount: (body) => {
      body.innerHTML = `
        <div class="coherence-report" style="font-size:14px; line-height:1.4; overflow:auto; height:100%;">
          ${html || "<p>Aucune anomalie détectée.</p>"}
        </div>
      `;
    }
  });
}

function openSheetFiltres(gridId) {
  const gridApi = window.grids?.get?.(gridId)?.api;
  if (!gridApi) return;

  const currentFilters = gridApi.getFilterModel?.() || {};
  const columns = (gridApi.getColumnDefs?.() || []).filter(col => col.filter);
  const fields = columns.map(c => c.field);

  openSheetExclusive({
    title: 'Filtres',
    panelHeight: '50vh',
    panelMaxHeight: '50vh',
    mount: (body, { close }) => {
      // ===== Markup =====
      const rowsHtml = columns.map(col => {
        const colId = col.field;
        const value = currentFilters[colId]?.filter || '';
        const hasVal = value ? ' has-val' : '';
        return `
          <div class="form-row filter-row">
            <label for="filter-${colId}">${col.headerName}</label>
            <div class="input-wrap${hasVal}">
              <button type="button" class="btn-clear" data-field="${colId}" aria-label="Effacer le filtre ${col.headerName}" title="Effacer">×</button>
              <input type="text" id="filter-${colId}" value="${value}" placeholder="Filtrer ${col.headerName}" class="filter-input">
            </div>
          </div>
        `;
      }).join('');

      body.innerHTML = `
        <div class="form">
          ${rowsHtml}
        </div>
        <div id="dl-container" hidden></div>
        <div class="sheet-footer has-border">
          <div class="form-actions">
            <button id="btn-clear" class="bb-btn is-primary">Réinitialiser</button>
            <button id="btn-apply" class="bb-btn is-primary">Appliquer</button>
          </div>
        </div>
      `;

      // ===== CSS inline minimal (une seule fois) =====
      if (!document.getElementById('filters-inline-css')) {
        const style = document.createElement('style');
        style.id = 'filters-inline-css';
        style.textContent = `
          .filter-row .input-wrap { position: relative; display:flex; align-items:center; gap:.5rem; }
          .filter-row .btn-clear {
            width: 1.8rem; height: 1.8rem; line-height: 1.6rem;
            border: 1px solid var(--bb-border,#ccc); border-radius:.4rem;
            background: var(--bb-bg,#f5f5f5); cursor: pointer; flex: 0 0 auto;
            display: none; font-weight: 600; font-size: 1rem;
          }
          .filter-row .input-wrap.has-val .btn-clear { display: inline-block; }
          .filter-row input[type="text"] { flex: 1 1 auto; min-width: 0; }
          @media (hover:hover) {
            .filter-row .btn-clear:hover { background:#eee; }
          }
          /* Hook repaint pour casser les "zones mortes" iOS */
          .sheet-wrap.repaint { transform: translateZ(0); }
        `;
        document.head.appendChild(style);
      }

      // Préremplir inputs avec la valeur SANITIZÉE + stocker la RAW d'origine
      columns.forEach(col => {
        const raw = currentFilters[col.field]?.filter ?? '';
        const san = sanitizeDatalistValue(raw);
        const inp = body.querySelector(`#filter-${col.field}`);
        if (!inp) return;
        inp.value = san;
        inp.dataset.rawDefault = String(raw);
        inp.dataset.modified = 'false';
      });

      // ===== Helpers list/datalist =====
      function scrollPageToRevealFooter(footerEl, { margin = 12, smooth = true } = {}) {
        if (!footerEl) return;
        // viewport visible (en tenant compte d'un éventuel offset top du visualViewport)
        const vpTop = vv ? vv.offsetTop : 0;
        const vpH   = vv ? vv.height   : window.innerHeight;

        const rect  = footerEl.getBoundingClientRect();
        const bottomLimit = vpTop + vpH - margin; // limite basse utile

        if (rect.bottom > bottomLimit) {
          const delta = rect.bottom - bottomLimit;
          window.scrollTo({
            top: window.scrollY + delta,
            behavior: smooth ? 'smooth' : 'auto'
          });
        }
      }

      // scrolle UNIQUEMENT si la row est masquée par clavier+footer
      function scrollRowIfOccluded(input, { smooth = true } = {}) {
        if (!sheetBody) return;
        const row = input.closest('.form-row') || input;
        const r = row.getBoundingClientRect();

        const safeH = vv ? vv.height : window.innerHeight;
        const footerH = footer?.getBoundingClientRect?.().height || 0;
        const margin = 12;

        // lim inf visible au-dessus du clavier et du footer
        const bottomLimit = safeH - footerH - margin;

        // si la row déborde sous la limite, on avance le scroll juste ce qu’il faut
        if (r.bottom > bottomLimit) {
          const delta = r.bottom - bottomLimit;
          sheetBody.scrollBy({ top: delta, behavior: smooth ? 'smooth' : 'auto' });
        }
      }
      // Remplace CR/LF réels ET littéraux (\r\n, \n, \r) par un espace pour l’affichage
      function sanitizeDatalistValue(s) {
        return String(s)
          .replace(/(\r\n|\n|\r|\\r\\n|\\n|\\r)+/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
      }
      // Si l’utilisateur tape "\r\n", on peut (optionnel) le retransformer en vrai saut de ligne
      function unescapeCRLF(s) {
        return String(s).replace(/\\r\\n|\\n|\\r/g, '\n');
      }
      function collectRowsFromGrid(api, mode = 'all') {
        const out = [];
        if (mode === 'afterFilter' && api.forEachNodeAfterFilterAndSort) {
          api.forEachNodeAfterFilterAndSort(n => { if (n?.data) out.push(n.data); });
        } else if (api.forEachLeafNode) {
          api.forEachLeafNode(n => { if (n?.data) out.push(n.data); });
        } else if (api.getDisplayedRowCount) {
          const cnt = api.getDisplayedRowCount();
          for (let i = 0; i < cnt; i++) {
            const rowNode = api.getDisplayedRowAtIndex(i);
            if (rowNode?.data) out.push(rowNode.data);
          }
        }
        return out;
      }
      function uniqueValues(rows, field, { max = 500, includeEmpty = false } = {}) {
        const set = new Set();
        for (const r of rows || []) {
          let v = r?.[field];
          if (v == null || v === '') { if (!includeEmpty) continue; v = '∅'; }
          set.add(String(v));
          if (set.size >= max) break;
        }
        return [...set].sort((a,b)=>a.localeCompare(b,'fr',{numeric:true,sensitivity:'base'}));
      }
      function wireDatalistForField(field, rows) {
        const input = body.querySelector(`#filter-${field}`);
        if (!input) return;
        const listId = `dl-${field}`;
        const dlContainer = body.querySelector('#dl-container');
        let dl = body.querySelector(`#${listId}`);
        if (!dl) {
          dl = document.createElement('datalist');
          dl.id = listId;
          dlContainer.appendChild(dl);
        }
        input.setAttribute('list', listId);
        const values = uniqueValues(rows, field);
        dl.replaceChildren(...values.map(v => {
          const o = document.createElement('option');
          o.value = v;
          return o;
        }));
      }
      
      function wireDatalistForField(field, rows) {
        const input = body.querySelector(`#filter-${field}`);
        if (!input) return;
        const listId = `dl-${field}`;
        const dlContainer = body.querySelector('#dl-container');
        let dl = body.querySelector(`#${listId}`);
        if (!dl) {
          dl = document.createElement('datalist');
          dl.id = listId;
          dlContainer.appendChild(dl);
        }
        input.setAttribute('list', listId);

        const rawValues = uniqueValues(rows, field);
        dl.replaceChildren(); // reset

        // éviter les doublons après sanitization
        const seenSanitized = new Set();
        for (const raw of rawValues) {
          const san = sanitizeDatalistValue(raw);
          if (!san) continue;
          if (seenSanitized.has(san)) continue;
          seenSanitized.add(san);

          const o = document.createElement('option');
          o.value = san;           // ce que voit/saisit l’utilisateur
          o.dataset.raw = String(raw); // la valeur brute (avec éventuels \r\n réels)
          dl.appendChild(o);
        }
      }
      function buildFilterLists(rows, fields) { fields.forEach(f => wireDatalistForField(f, rows)); }
      buildFilterLists(collectRowsFromGrid(gridApi, 'all'), fields);

      const sheet     = body.closest('.sheet-wrap') || document.querySelector('.sheet-wrap.is-open');
      const sheetBody = sheet?.querySelector('.sheet-body') || body;
      const footer    = sheet?.querySelector('.sheet-footer');
      const vv        = window.visualViewport;
      const scrollEl  = sheet?.querySelector('.sheet-body .form') || body;

      // **************************************
      // Section avec menus plutot que datalist
      // Resoud le pb de détachement de la datalist de son champ input sur IPad 
      // mais reste un pb de scroll insuffisant du menu sur IOS lorsque le clavier est affiché
      // et des menus qui parfois ne se ferment pas lorsque l'on ferme la sheet
      // function attachAutocomplete(inp, values, {max=300, minChars=0} = {}) {
      //   let box = null, selIdx = -1, open = false;
      //   const vv = window.visualViewport;

      //   function makeBox() {
      //     if (box) return box;
      //     box = document.createElement('div');
      //     box.className = 'bb-ac';
      //     box.setAttribute('role','listbox');
      //     box.hidden = true;
      //     document.body.appendChild(box);
      //     return box;
      //   }
      //   function posBox() {
      //     if (!box) return;
      //     const r = inp.getBoundingClientRect();
      //     const gap = 4;
      //     const top = r.bottom + gap + (vv ? vv.offsetTop : 0);
      //     const left = r.left + (vv ? vv.offsetLeft : 0);
      //     box.style.top = `${top}px`;
      //     box.style.left = `${left}px`;
      //     box.style.minWidth = `${r.width}px`;
      //   }
      //   function render(list) {
      //     const b = makeBox();
      //     b.innerHTML = '';
      //     selIdx = -1;
      //     const frag = document.createDocumentFragment();
      //     list.slice(0, max).forEach((v, i) => {
      //       const it = document.createElement('div');
      //       it.className = 'bb-ac__item';
      //       it.setAttribute('role','option');
      //       it.textContent = v;
      //       it.addEventListener('mousedown', (e) => {
      //         e.preventDefault();          // empêche blur avant click
      //         commit(v);
      //       });
      //       frag.appendChild(it);
      //     });
      //     b.appendChild(frag);
      //     open = list.length > 0;
      //     b.hidden = !open;
      //     if (open) posBox();
      //   }
      //   function commit(val) {
      //     inp.value = val;
      //     hide();
      //     // ferme le clavier pour libérer le footer, à la manière de ta sheet
      //     inp.blur?.();
      //     setTimeout(() => {
      //       const footer = document.querySelector('.sheet-wrap.is-open .sheet-footer');
      //       if (!footer) return;
      //       const r = footer.getBoundingClientRect();
      //       const vh = window.innerHeight;
      //       if (r.bottom > vh) {
      //         window.scrollTo({ top: window.scrollY + (r.bottom - vh) + 8, behavior: 'smooth' });
      //       }
      //     }, 40);
      //     // propage tes hooks existants
      //     inp.dispatchEvent(new Event('input', { bubbles:true }));
      //     inp.dispatchEvent(new Event('change', { bubbles:true }));
      //   }
      //   function hide() {
      //     open = false;
      //     if (box) box.hidden = true;
      //   }
      //   function items() { return box ? Array.from(box.querySelectorAll('.bb-ac__item')) : []; }
      //   function highlight(idx) {
      //     selIdx = idx;
      //     items().forEach((el,i)=>el.setAttribute('aria-selected', String(i===idx)));
      //   }
      //   function move(delta) {
      //     const it = items();
      //     if (!it.length) return;
      //     let n = selIdx + delta;
      //     if (n < 0) n = it.length - 1;
      //     if (n >= it.length) n = 0;
      //     highlight(n);
      //     it[n].scrollIntoView({ block:'nearest' });
      //   }

      //   // filtres (tu peux remplacer par ta sanitize/normalize)
      //   const normalize = s => String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      //   function filterNow() {
      //     const q = normalize(inp.value);
      //     if (q.length < minChars) { hide(); return; }
      //     const out = [];
      //     for (const v of values) {
      //       if (normalize(v).includes(q)) out.push(v);
      //     }
      //     render(out);
      //   }

      //   // events
      //   inp.addEventListener('focus', () => { filterNow(); posBox(); });
      //   inp.addEventListener('input', filterNow);
      //   inp.addEventListener('keydown', (e) => {
      //     if (!open) return;
      //     if (e.key === 'ArrowDown') { e.preventDefault(); move(+1); }
      //     else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
      //     else if (e.key === 'Enter') { 
      //       if (selIdx >= 0) { e.preventDefault(); commit(items()[selIdx].textContent); }
      //       else hide();
      //     } else if (e.key === 'Escape') { hide(); }
      //   });
      //   inp.addEventListener('blur', () => setTimeout(hide, 100)); // laisse le click se faire

      //   // suivre déplacements/clavier iOS
      //   const rePos = () => { if (open) posBox(); };
      //   window.addEventListener('scroll', rePos, true);
      //   window.addEventListener('resize', rePos);
      //   vv?.addEventListener('resize', rePos);
      //   vv?.addEventListener('scroll', rePos);

      //   return {
      //     destroy() {
      //       window.removeEventListener('scroll', rePos, true);
      //       window.removeEventListener('resize', rePos);
      //       vv?.removeEventListener('resize', rePos);
      //       vv?.removeEventListener('scroll', rePos);
      //       box?.remove();
      //       box = null;
      //     }
      //   };
      // }

      // // 1️⃣ Récupère les valeurs uniques pour chaque champ filtrable
      // const sourceRows = collectRowsFromGrid(gridApi, 'all');
      // const valuesByField = Object.fromEntries(
      //   fields.map(f => [f, uniqueValues(sourceRows, f)])
      // );

      // // 2️⃣ Attache un autocompléteur custom sur chaque input
      // const acHandles = [];
      // body.querySelectorAll('.filter-row .filter-input').forEach(inp => {
      //   const field = inp.id.replace(/^filter-/, '');
      //   const values = valuesByField[field] || [];
      //   const ac = attachAutocomplete(inp, values, { max: 500, minChars: 0 });
      //   acHandles.push(ac);
      // });

      // // 3️⃣ Nettoyage à la fermeture de la sheet (optionnel)
      // const sw = document.querySelector('.sheet-wrap.is-open');
      // if (sw) {
      //   sw.addEventListener('transitionend', (ev) => {
      //     if (!sw.classList.contains('is-open')) {
      //       acHandles.forEach(h => h.destroy());
      //     }
      //   });
      // }
      // **************************************

      // hooks visualViewport (iOS)
      // if (vv) {
      //   const onVV = () => applyInsets();
      //   vv.addEventListener('resize', onVV);
      //   vv.addEventListener('scroll', onVV);
      //   // cleanup quand la sheet est détruite
      //   const mo = new MutationObserver(() => {
      //     if (sheet && !document.body.contains(sheet)) {
      //       vv.removeEventListener('resize', onVV);
      //       vv.removeEventListener('scroll', onVV);
      //       mo.disconnect();
      //     }
      //   });
      //   mo.observe(document.body, { childList: true, subtree: true });
      // }
      // applyInsets();
      
      // ===== RAZ par champ (×) + sync has-val =====
      body.addEventListener('click', (e) => {
        const btn = e.target.closest('.btn-clear');
        if (!btn) return;
        const field = btn.dataset.field;
        const input = body.querySelector(`#filter-${field}`);
        if (!input) return;
        input.value = '';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        btn.parentElement.classList.remove('has-val');
        input.focus();
      });
      // body.querySelectorAll('.filter-row .input-wrap input').forEach(inp => {
      //   const wrap = inp.closest('.input-wrap');
      //   const sync = () => wrap.classList.toggle('has-val', !!inp.value.trim());
      //   inp.addEventListener('input', sync);
      //   inp.addEventListener('change', sync);
      //   inp.addEventListener('keydown', (ev) => {
      //     if (ev.key === 'Escape') { inp.value=''; inp.dispatchEvent(new Event('input',{bubbles:true})); sync(); }
      //   });
      //   sync();
      // });
      // body.querySelectorAll('.filter-row .input-wrap input').forEach(inp => {
      //   const wrap = inp.closest('.input-wrap');
      //   const sync = () => wrap.classList.toggle('has-val', !!inp.value.trim());

      //   const markModified = () => { inp.dataset.modified = 'true'; };

      //   inp.addEventListener('input',  () => { 
      //     sync(); markModified(); 
      //     // if (inp.getAttribute('list')) {
      //     //   requestAnimationFrame(() => ensureFooterVisible({ target: inp, smooth: true }));
      //     // }
      //   });

      //   inp.addEventListener('change', () => { 
      //     sync(); markModified(); 
      //     requestAnimationFrame(() => ensureFooterVisible({ target: inp, smooth: true }));
      //   });

      //   // Esc = RAZ rapide
      //   inp.addEventListener('keydown', (ev) => {
      //     if (ev.key === 'Escape') {
      //       inp.value = '';
      //       inp.dispatchEvent(new Event('input', { bubbles: true }));
      //       markModified();
      //       sync();
      //     }
      //   });

      //   // init
      //   sync();
      // });
      body.querySelectorAll('.filter-row .filter-input').forEach(inp => {
        const wrap = inp.closest('.input-wrap');
        const sync = () => wrap.classList.toggle('has-val', !!inp.value.trim());
        const markModified = () => { inp.dataset.modified = 'true'; };
        const footer = document.querySelector('.sheet-wrap.is-open .sheet-footer');

        // Tape clavier → on ne scrolle PAS (évite les “sauts”)
        inp.addEventListener('input', () => {
          sync();
          markModified();
        });

        // Focus → scroller la ROW si masquée
        inp.addEventListener('focus', () => {
          // applyInsets();
          // petit rafraîchissement visuel avant calcul
          requestAnimationFrame(() => scrollRowIfOccluded(inp, { smooth: false }));
        });

        // Sélection via datalist → scroller la ROW si masquée
        inp.addEventListener('change', () => {
          sync();
          markModified();
          // applyInsets();
          // requestAnimationFrame(() => scrollRowIfOccluded(inp, { smooth: true }));
          inp.blur();
          setTimeout(() => {
            scrollPageToRevealFooter(footer, { smooth: true });
          }, 50);
        });

        // Enter : sécurise aussi
        inp.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter') {
            requestAnimationFrame(() => scrollRowIfOccluded(inp, { smooth: true }));
          }
          if (ev.key === 'Escape') {
            inp.value = '';
            inp.dispatchEvent(new Event('input', { bubbles: true }));
          }
        });

        sync(); // init visuelle
      });


      // ===== Appliquer / Réinitialiser =====
      const applyBtn = body.querySelector('#btn-apply');
      const clearBtn = body.querySelector('#btn-clear');
      // applyBtn.addEventListener('click', () => {
      //   const newModel = {};
      //   columns.forEach(col => {
      //     const val = body.querySelector(`#filter-${col.field}`).value.trim();
      //     if (val) newModel[col.field] = { type: 'contains', filter: val };
      //   });
      //   gridApi.setFilterModel(newModel);
      //   gridApi.onFilterChanged?.();
      //   close();
      // });
      // applyBtn.addEventListener('click', () => {
      //   const newModel = {};
      //   columns.forEach(col => {
      //     const inp = body.querySelector(`#filter-${col.field}`);
      //     let valSan = inp?.value?.trim() || '';
      //     if (!valSan) return;

      //     // retrouver l’option correspondante pour récupérer la valeur brute
      //     const dl = body.querySelector(`#dl-${col.field}`);
      //     let valRaw = null;
      //     if (dl) {
      //       // pas de CSS.escape -> on itère
      //       for (const opt of dl.options) {
      //         if (opt.value === valSan) { valRaw = opt.dataset.raw || null; break; }
      //       }
      //     }
      //     // fallback : si pas d’option trouvée, on tente de “déséchapper” ce que l’utilisateur a tapé
      //     const filterVal = unescapeCRLF(valRaw ?? valSan);

      //     newModel[col.field] = { type: 'contains', filter: filterVal };
      //   });

      //   gridApi.setFilterModel(newModel);
      //   gridApi.onFilterChanged?.();
      //   close();
      // });
      applyBtn.addEventListener('click', () => {
        const newModel = {};
        columns.forEach(col => {
          const inp = body.querySelector(`#filter-${col.field}`);
          if (!inp) return;

          const valSan = (inp.value || '').trim();
          const rawDefault = inp.dataset.rawDefault || '';
          const modified = inp.dataset.modified === 'true';

          if (!valSan && !rawDefault) return;

          let filterVal = null;

          if (!modified && rawDefault) {
            // L’utilisateur n’a rien changé → réappliquer EXACTEMENT la valeur brute précédente
            filterVal = rawDefault;
          } else {
            // L’utilisateur a modifié (ou pas de rawDefault) → tenter de retrouver l’option correspondante
            const dl = body.querySelector(`#dl-${col.field}`);
            if (dl) {
              let matchedRaw = null;
              for (const opt of dl.options) {
                if (opt.value === valSan) { matchedRaw = opt.dataset.raw || null; break; }
              }
              filterVal = matchedRaw ?? unescapeCRLF(valSan);
            } else {
              filterVal = unescapeCRLF(valSan);
            }
          }

          if (filterVal) newModel[col.field] = { type: 'contains', filter: filterVal };
        });

        gridApi.setFilterModel(newModel);
        gridApi.onFilterChanged?.();
        close();
      });

      clearBtn.addEventListener('click', () => {
        gridApi.setFilterModel({});
        gridApi.onFilterChanged?.();
        close();
      });

      // ===== iOS/iPadOS keyboard-safe: gérer la "zone morte" au repli du clavier =====
      // expose hauteur footer pour padding initial
      if (sheet) sheet.style.setProperty('--sheet-footer-h', `${footer?.offsetHeight || 0}px`);
      if (scrollEl && sheet) scrollEl.style.paddingBottom = `var(--sheet-footer-h, 0px)`;

      let kbOpen = false;
      const handlers = [];

      const onVVChange = () => {
        if (!sheet || !scrollEl || !vv) return;
        // heuristique d’ouverture clavier
        const isOpen = (window.innerHeight - vv.height) > 120;

        if (isOpen && !kbOpen) {
          kbOpen = true;
          const kb = Math.max(0, Math.round(window.innerHeight - vv.height));
          sheet.style.setProperty('--kb-inset', kb + 'px');
          scrollEl.style.paddingBottom = `calc(var(--sheet-footer-h, 0px) + var(--kb-inset, 0px))`;
          scrollEl.style.pointerEvents = 'auto';
          
          // 🔹 NOUVEAU : quand le clavier s’ouvre, on s’assure que le footer est visible
          if (footer) {
            setTimeout(() => {
              scrollPageToRevealFooter(footer, { smooth: true });
            }, 30);
          }
        }
        if (!isOpen && kbOpen) {
          kbOpen = false;
          sheet.style.setProperty('--kb-inset', '0px');
          scrollEl.style.paddingBottom = `var(--sheet-footer-h, 0px)`;
          // force un léger repaint pour tuer la zone morte
          // eslint-disable-next-line no-unused-expressions
          sheet.offsetHeight;
          sheet.classList.add('repaint');
          requestAnimationFrame(() => sheet.classList.remove('repaint'));
          scrollEl.style.pointerEvents = 'auto';
          // poke scroll pour réveiller WebKit
          requestAnimationFrame(() => {
            const y = scrollEl.scrollTop;
            scrollEl.scrollTop = Math.max(0, y - 1);
            scrollEl.scrollTop = Math.max(0, y);
          });
        }
      };

      const focusoutHandler = () => setTimeout(onVVChange, 50);

      if (vv) {
        vv.addEventListener('resize', onVVChange);
        vv.addEventListener('scroll', onVVChange);
        handlers.push(() => { vv.removeEventListener('resize', onVVChange); vv.removeEventListener('scroll', onVVChange); });
      }
      document.addEventListener('focusout', focusoutHandler, true);
      handlers.push(() => document.removeEventListener('focusout', focusoutHandler, true));

      // cleanup quand la sheet disparaît (fermeture par swipe incluse)
      const mo = new MutationObserver(() => {
        if (sheet && !document.body.contains(sheet)) {
          handlers.forEach(fn => { try { fn(); } catch {} });
          mo.disconnect();
        }
      });
      mo.observe(document.body, { childList: true, subtree: true });

      // ===== styles visuels quand focus sur input (optionnel)
      document.querySelectorAll('.filter-input').forEach(inp => {
        inp.addEventListener('focus', () => sheet?.classList.add('sheet-filters-open'));
        inp.addEventListener('blur',  () => sheet?.classList.remove('sheet-filters-open'));
      });
    }
  });
}

const BILLETREDUC_RUBRIQUES = [
  { label: 'Théâtre',                value: '68'  },
  { label: 'Spectacles',             value: '37'  },
  { label: 'Concerts',               value: '4'   },
  { label: 'Spectacles Enfants',     value: '187' },
  { label: 'Loisirs',                value: '36'  },
  { label: 'Humour',                 value: '9'   },
  { label: 'Cirque',                 value: '241' },
  { label: 'Expériences',            value: '5'   },
  { label: 'Expos',                  value: '7'   },
  { label: 'Enfants',                value: '8'   },
];

const BILLETREDUC_REGIONS = [
  { label: 'Paris - Île de France',              value: 'J' },
  { label: 'Lyon - Rhône Alpes',                 value: 'V' },
  { label: 'Marseille / Nice / Avignon / Aix',   value: 'U' },
  { label: 'Lille - Nord-Pas de Calais',         value: 'O' },
  { label: 'Nantes / Angers - Pays de Loire',    value: 'R' },
  { label: 'Brest / Rennes - Bretagne',          value: 'E' },
  { label: 'Basse Normandie',                    value: 'P' },
  { label: 'Perpignan / Montpellier',            value: 'K' },
  { label: 'Bordeaux - Aquitaine',               value: 'B' },
  { label: 'Auvergne',                           value: 'C' },
  { label: 'Toulouse - Midi Pyrénées',           value: 'N' },
  { label: 'Rouen - Haute Picardie',             value: 'Q' },
  { label: 'Poitou Charentes',                   value: 'T' },
  { label: 'Centre',                             value: 'F' },
  { label: 'Bourgogne',                          value: 'D' },
  { label: 'Franche Comté',                      value: 'I' },
  { label: 'Lorraine',                           value: 'M' },
  { label: 'Picardie',                           value: 'S' },
  { label: 'Champagne Ardennes',                 value: 'G' },
  { label: 'Limousin',                           value: 'L' },
];

function openSheetImportBilletReduc() {
  // mois courant au format yyyy-mm pour <input type="month">
  const now = new Date();
  const curMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  openSheetExclusive({
    title: 'Import BilletReduc',
    panelHeight: '50vh',
    panelMaxHeight: '60vh',
    mount: (body, { close }) => {
      // Options <option> pour les selects
      const rubOptions = BILLETREDUC_RUBRIQUES.map((r, idx) =>
        `<option value="${r.value}" ${idx === 0 ? 'selected' : ''}>${r.label}</option>`
      ).join('');

      const regOptions = BILLETREDUC_REGIONS.map((r, idx) =>
        `<option value="${r.value}" ${idx === 0 ? 'selected' : ''}>${r.label}</option>`
      ).join('');

      body.innerHTML = `
        <div class="form">
          <div class="form-row">
            <label for="br-rubrique">Rubrique</label>
            <select id="br-rubrique">
              ${rubOptions}
            </select>
          </div>

          <div class="form-row">
            <label for="br-region">Région</label>
            <select id="br-region">
              ${regOptions}
            </select>
          </div>

          <div class="form-row">
            <label for="br-month">Mois</label>
            <input id="br-month" type="month" value="${curMonth}">
          </div>
        </div>

        <div class="sheet-footer has-border">
          <div class="form-actions">
            <button type="button" id="br-cancel" class="bb-btn">
              Annuler
            </button>
            <button type="button" id="br-ok" class="bb-btn is-primary">
              Continuer
            </button>
          </div>
        </div>
      `;

      const selRub = body.querySelector('#br-rubrique');
      const selReg = body.querySelector('#br-region');
      const inpMonth = body.querySelector('#br-month');
      const btnCancel = body.querySelector('#br-cancel');
      const btnOk = body.querySelector('#br-ok');

      btnCancel.addEventListener('click', () => {
        close();
      });

      btnOk.addEventListener('click', async () => {
        const rubrique = selRub.value;
        const region   = selReg.value;
        const ym       = (inpMonth.value || '').trim(); // "yyyy-mm"

        if (!rubrique || !region || !ym) {
          alert('Merci de choisir rubrique, région et mois.');
          return;
        }

        // Normalisation du mois → dt=yyyy-mm
        const dt = ym; // BilletReduc attend déjà ce format

        close();

        try {
          await doImportFromBilletReduc({ rubrique, region, dt });
        } catch (err) {
          console.error('Import BilletReduc failed:', err);
          alert('Erreur pendant l’import BilletReduc.');
        }
      });
    }
  });
}

// ------- Boot -------
function wireContext() {

  // Initialisation de la periode de programmation si contexte vide
  if (!ctx.df || ctx.df?.length == 0) activitesAPI.initPeriodeProgrammation();

  ctx.on('df:changed',        () => {
    refreshActivitesGrids(); // scheduleGlobalRefresh());
  });

  // ctx.on('carnet:changed',    () => {
  //   refreshCarnetGrid(); // scheduleGlobalRefresh());
  // });

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


function enableKeyboardAutoScroll() {
  document.addEventListener('focusin', (e) => {
    const el = e.target;
    if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return;

    // petit délai : attendre que le clavier soit visible
    setTimeout(() => {
      // essaie d'amener l'élément dans la zone visible
      el.scrollIntoView({
        behavior: 'smooth',
        block: 'center'
      });
    }, 300);
  });
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
  wireExpanderButtons();
  wireAppKebab();
  initSheetGrids();
  enableKeyboardAutoScroll();
  rebuildColumnsForActiviteGrids(ctx.df);

  console.log('✅ Application initialisée');

  // Pour DEBUG
  // logToPage('✅ Application initialisée');
});
