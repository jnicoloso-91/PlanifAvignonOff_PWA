// app.js (module)
import { 
  parseHHhMM, 
  excelSerialToYMD, 
  prettyToDateint, 
  dateintToPretty, 
  ymdToDateint, 
  safeDateint, 
  toDateint } from './utils-date.js';
import { 
  initialiserPeriodeProgrammation, 
  getCreneaux, 
  getActivitesProgrammees, 
  getActivitesNonProgrammees, 
  getActivitesProgrammables, 
  sortDf } from './activites.js'; 
import { sortCarnet } from './carnet.js'; 
import { AppContext } from './context.mjs';

// ===== Multi-grilles =====
const grids = new Map();           // id -> { api, el, loader }
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

const DEBUG = true;
const dlog = (...args)=>DEBUG && console.log('[FLIGHT]', ...args);

// ------- Misc Helpers -------

const ROW_H=32, HEADER_H=32, PAD=4;
const hFor = n => HEADER_H + ROW_H * Math.max(0,n) + PAD;

const $ = id => document.getElementById(id);

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
// Palette pastel (ajuste si tu veux)
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

function colorForDate(dateInt) {
  if (dateInt == null || Number.isNaN(dateInt)) return null;
  const i = Math.abs(Number(dateInt)) % DAY_COLORS.length;
  return DAY_COLORS[i];
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

export function enableTouchEdit(api, gridEl, opts = {}) {
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

// récupère la row sélectionnée (ou la focussée) dans une ag-Grid
function getSelectedRowSafe(api) {
  if (!api) return null;
  const sel = api.getSelectedRows?.() || [];
  if (sel.length) return sel[0];
  const fc = api.getFocusedCell?.();
  const r = fc ? api.getDisplayedRowAtIndex?.(fc.rowIndex) : null;
  return r?.data || null;
}

// --- calcul de la hauteur idéale pour ≤ 5 lignes ---
function desiredPaneHeightForRows(gridEl, api, { maxRows = 5 } = {}) {
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
  const displayed = api?.getDisplayedRowCount?.() ?? 0;

  // nb à prendre en compte : min(displayed, 5) ; si vide et tu veux ~1,5 ligne visible, mets 1.5
  const n = Math.min(displayed, maxRows);

  // padding interne du pane si tu en as (ajuste si nécessaire)
  const paddingPane = 16;

  const desired = Math.round(hHeader + (rowH * n) + paddingPane);
  return Math.max(desired, hHeader + 8);
}

// function autoSizePanelFromRowCount(pane, gridEl, api, { maxRows = 5 } = {}) {
//   if (!pane || !gridEl) return;

//   const exp = pane.closest('.st-expander');
//   const isOpen = exp?.classList?.contains?.('open');

//   // calcule la hauteur souhaitée (≤ 5 rows)
//   const h = desiredPaneHeightForRows(gridEl, api, { maxRows });
//   if (h == null) return;

//   // Toujours tenir à jour la borne max pour le splitter
//   pane.dataset.maxContentHeight = String(h);

//   // Respecte un redimensionnement manuel
//   const userSized = pane.dataset.userSized === '1';

//   if (!isOpen) {
//     // ❗️Expander fermé → ne PAS appliquer la height
//     // si pas userSized, on mémorise pour la prochaine ouverture
//     if (!userSized) pane.dataset.pendingAutoHeight = String(h);
//     return;
//   }

//   // Expander ouvert : appliquer seulement si pas userSized
//   if (!userSized) {
//     pane.style.height = `${h}px`;
//     delete pane.dataset.pendingAutoHeight;
//   }
// }

// function autoSizePanelFromRowCount(pane, gridEl, api, { maxRows = 5 } = {}) {
//   if (!pane || !gridEl) return;

//   const exp = pane.closest('.st-expander');
//   const isOpen = exp?.classList?.contains?.('open');

//   // calcule la hauteur souhaitée (≤ 5 rows)
//   const h = desiredPaneHeightForRows(gridEl, api, { maxRows });
//   if (h == null) return;

//   // toujours tenir à jour la borne max pour le splitter
//   pane.dataset.maxContentHeight = String(h);

//   // respecte un redimensionnement manuel
//   const userSized = pane.dataset.userSized === '1';

//   if (!isOpen) {
//     // expander fermé → ne pas appliquer, juste mémoriser pour la prochaine ouverture
//     if (!userSized) pane.dataset.pendingAutoHeight = String(h);
//     return;
//   }

//   // expander ouvert : appliquer seulement si pas userSized
//   if (!userSized) {
//     pane.style.height = `${h}px`;
//     delete pane.dataset.pendingAutoHeight;
//   }
// }

// function autoSizePanelFromRowCount(pane, gridEl, api, { maxRows = 5 } = {}) {
//   if (!pane || !gridEl) return;

//   const exp = pane.closest('.st-expander');
//   const isOpen = exp?.classList?.contains?.('open');

//   const h = desiredPaneHeightForRows(gridEl, api, { maxRows });
//   if (h == null) return;

//   // borne pour le splitter
//   pane.dataset.maxContentHeight = String(h);

//   const userSized = pane.dataset.userSized === '1';

//   if (!isOpen) {
//     if (!userSized) pane.dataset.pendingAutoHeight = String(h);
//     return; // 🔒 surtout ne pas écrire de height inline en fermé
//   }

//   if (!userSized) {
//     pane.style.height = `${h}px`;
//     delete pane.dataset.pendingAutoHeight;
//   }
// }

function autoSizePanelFromRowCount(pane, gridEl, api, { maxRows = 5 } = {}) {
  if (!pane || !gridEl) return;

  const exp = pane.closest('.st-expander');
  const isOpen = exp?.classList?.contains?.('open');
  const isClosing = exp?.classList?.contains?.('is-closing');

  const h = desiredPaneHeightForRows(gridEl, api, { maxRows });
  if (h == null) return;

  pane.dataset.maxContentHeight = String(h);

  const userSized = pane.dataset.userSized === '1';

  // si fermé ou en train de se fermer → mémorise seulement
  if (!isOpen || isClosing) {
    if (!userSized) pane.dataset.pendingAutoHeight = String(h);
    return;
  }

  // ouvert : applique seulement si pas userSized
  if (!userSized) {
    pane.style.height = `${h}px`;
    delete pane.dataset.pendingAutoHeight;
  }
}

// function openExp(exp){
//   const pane = paneOf(exp);
//   exp.classList.add('open');
//   // anim 0 -> target
//   enableTransition(pane);
//   pane.style.setProperty('max-height','none','important');
//   pane.style.setProperty('min-height','0px','important');

//   setH(pane, 0);           // point de départ
//   pane.offsetHeight;       // reflow
//   const target = restoreTargetHeight(exp);
//   requestAnimationFrame(()=> setH(pane, target));  // déclenche l’easing
// }

// function openExp(exp) {
//   if (!exp) return;
//   exp.classList.add('open');

//   const pane = exp.querySelector('.st-expander-body');
//   if (!pane) return;

//   const userSized = pane.dataset.userSized === '1';
//   const savedKey  = `paneHeight:${exp.id}`;
//   const saved     = localStorage.getItem(savedKey);
//   const pending   = pane.dataset.pendingAutoHeight;

//   let targetH = null;

//   if (userSized && saved) {
//     // l’utilisateur avait dimensionné → on respecte son dernier choix
//     targetH = parseInt(saved, 10);
//   } else if (pending) {
//     // auto-taille calculée pendant que c’était fermé → on l’applique
//     targetH = parseInt(pending, 10);
//   }

//   if (Number.isFinite(targetH) && targetH > 0) {
//     pane.style.height = `${targetH}px`;
//   }
//   // on “consomme” le pending
//   delete pane.dataset.pendingAutoHeight;
// }

// function openExp(exp) {
//   if (!exp) return;
//   exp.classList.add('open');

//   const pane = exp.querySelector('.st-expander-body');
//   if (!pane) return;

//   const saved = localStorage.getItem(`paneHeight:${exp.id}`);
//   const pending = pane.dataset.pendingAutoHeight;
//   const targetH = pending || saved;

//   if (targetH) {
//     pane.style.transition = 'height 0.25s ease';
//     pane.style.height = `${parseInt(targetH, 10)}px`;
//     delete pane.dataset.pendingAutoHeight;
//   }
// }

// function openExp(exp) {
//   if (!exp) return;
//   exp.classList.add('open');

//   const pane = exp.querySelector('.st-expander-body');
//   if (!pane) return;

//   const saved   = localStorage.getItem(`paneHeight:${exp.id}`);
//   const pending = pane.dataset.pendingAutoHeight;
//   const target  = parseInt(pending || saved || '', 10);

//   if (Number.isFinite(target) && target > 0) {
//     // petite transition douce si tu veux
//     pane.style.transition = 'height 0.25s ease';
//     // force un reflow avant d'appliquer (pour que la transition parte bien)
//     requestAnimationFrame(() => { pane.style.height = `${target}px`; });
//   }
//   delete pane.dataset.pendingAutoHeight;
// }

// function closeExp(exp){
//   const pane = paneOf(exp);
//   // mémorise la hauteur actuelle
//   savePaneHeight(exp);
//   enableTransition(pane);
//   const h = Math.round(pane.getBoundingClientRect().height);
//   setH(pane, h);           // point de départ
//   pane.offsetHeight;       // reflow
//   requestAnimationFrame(()=> setH(pane, 0)); // easing vers 0

//   // après l’anim on nettoie, puis retire .open
//   pane.addEventListener('transitionend', function onEnd(e){
//     if (e.propertyName !== 'height') return;
//     pane.removeEventListener('transitionend', onEnd);
//     pane.style.removeProperty('height');
//     exp.classList.remove('open');
//   });
// }

// function closeExp(exp) {
//   if (!exp) return;
//   const pane = exp.querySelector('.st-expander-body');
//   if (pane) {
//     const h = Math.round(pane.getBoundingClientRect().height);
//     if (h > 0) localStorage.setItem(`paneHeight:${exp.id}`, String(h));
//   }
//   exp.classList.remove('open');
// }

// function closeExp(exp) {
//   if (!exp) return;
//   const pane = exp.querySelector('.st-expander-body');
//   if (pane) {
//     // 🔹 mémorise la hauteur courante pour réouverture ultérieure
//     const h = Math.round(pane.getBoundingClientRect().height);
//     if (h > 0) localStorage.setItem(`paneHeight:${exp.id}`, String(h));

//     // 🔹 réinitialise visuellement le body
//     //    -> on passe la height à 0 (ou min), transition douce
//     pane.style.transition = 'height 0.25s ease';
//     pane.style.height = '0px';

//     // 🔹 pour bien forcer la fermeture du layout
//     pane.dataset.pendingAutoHeight = String(h); // garde la valeur pour reopen
//   }
//   exp.classList.remove('open');
// }

function openExp(exp) {
  if (!exp) return;
  const pane = exp.querySelector('.st-expander-body');
  if (!pane) { exp.classList.add('open'); return; }

  // si déjà open et pas en fermeture, ne rien faire
  if (exp.classList.contains('open') && !exp.classList.contains('is-closing')) return;

  exp.classList.remove('is-closing');
  exp.classList.add('open');

  const saved   = localStorage.getItem(`paneHeight:${exp.id}`);
  const pending = pane.dataset.pendingAutoHeight;
  const target  = parseInt(pending || saved || '', 10);

  // point de départ = 0
  pane.style.height = '0px';

  // applique la cible au frame suivant pour déclencher la transition
  requestAnimationFrame(() => {
    const h = Number.isFinite(target) && target > 0 ? target : pane.scrollHeight;
    pane.style.height = `${h}px`;

    // nettoyage en fin de transition : enlève la height inline pour laisser l'auto-size reprendre la main
    const onEnd = (ev) => {
      if (ev.propertyName !== 'height') return;
      pane.removeEventListener('transitionend', onEnd);
      delete pane.dataset.pendingAutoHeight;
      // si tu veux laisser le pane “fixe”, garde la height ; sinon, enlève-la :
      // pane.style.removeProperty('height');
    };
    pane.addEventListener('transitionend', onEnd, { once: true });
  });
}

// function closeExp(exp) {
//   if (!exp) return;
//   const pane = exp.querySelector('.st-expander-body');
//   if (pane) {
//     const h = Math.round(pane.getBoundingClientRect().height);
//     if (h > 0) {
//       localStorage.setItem(`paneHeight:${exp.id}`, String(h));
//       pane.dataset.pendingAutoHeight = String(h); // mémo pour la prochaine ouverture
//     }
//     // IMPORTANT : ne laisse pas une height inline qui pourrait être “réanimée”
//     pane.style.removeProperty('height');
//   }
//   exp.classList.remove('open');
// }

function closeExp(exp) {
  if (!exp) return;
  const pane = exp.querySelector('.st-expander-body');
  if (!pane) { exp.classList.remove('open'); return; }

  // si déjà en fermeture, ignore
  if (exp.classList.contains('is-closing')) return;

  // mémorise la hauteur actuelle pour réouverture / autosize ultérieure
  const curH = Math.max(0, Math.round(pane.getBoundingClientRect().height));
  if (curH > 0) {
    localStorage.setItem(`paneHeight:${exp.id}`, String(curH));
    pane.dataset.pendingAutoHeight = String(curH);
  }

  // prépare la fermeture animée : set la height actuelle -> force reflow -> 0
  pane.style.height = `${curH}px`;
  // force reflow pour que la transition reparte de curH
  // eslint-disable-next-line no-unused-expressions
  pane.offsetHeight;

  exp.classList.add('is-closing');
  pane.style.height = '0px';

  const onEnd = (ev) => {
    if (ev.propertyName !== 'height') return;
    pane.removeEventListener('transitionend', onEnd);

    // état final fermé
    exp.classList.remove('open');
    exp.classList.remove('is-closing');

    // IMPORTANT : aucune height inline qui pourrait re-gonfler en fermé
    pane.style.removeProperty('height');
  };
  pane.addEventListener('transitionend', onEnd, { once: true });
}


// function openExpanderById(expId) {
//   const exp = document.getElementById(expId);
//   if (exp && !exp.classList.contains('open')) openExp(exp); // utilise ta fonction existante
// }

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

// // trouve le node AG Grid + l'élément DOM .ag-row pour un __uuid
// function getRowNodeAndElByUuid(gridId, uuid) {
//   const h = grids.get(gridId);
//   if (!h || !uuid) return { api: null, node: null, rowEl: null };

//   const api = h.api;
//   let node = null;
//   api.forEachNode?.(n => { if (!node && n.data?.__uuid === uuid) node = n; });
//   if (!node) return { api, node: null, rowEl: null };

//   const rowEl = h.el.querySelector(`.ag-row[aria-rowindex="${node.rowIndex+1}"]`);
//   return { api, node, rowEl };
// }

// // crée un clone visuel (canvas DOM) de la ligne source
// function makeRowGhost(fromEl) {
//   if (!fromEl) return null;
//   const rect = fromEl.getBoundingClientRect();
//   const ghost = document.createElement('div');
//   ghost.className = 'row-flight';
//   ghost.style.left = rect.left + 'px';
//   ghost.style.top = rect.top + 'px';
//   ghost.style.width = rect.width + 'px';
//   ghost.style.height = rect.height + 'px';

//   // clone simple : on copie juste le texte des cellules
//   const rowClone = document.createElement('div');
//   rowClone.style.display = 'grid';
//   rowClone.style.gridTemplateColumns = `repeat(${fromEl.querySelectorAll('.ag-cell').length || 1}, 1fr)`;
//   rowClone.style.font = getComputedStyle(fromEl).font;
//   rowClone.style.padding = '2px 6px';

//   fromEl.querySelectorAll('.ag-cell').forEach(cell => {
//     const d = document.createElement('div');
//     d.textContent = cell.textContent || '';
//     d.style.padding = '4px 6px';
//     rowClone.appendChild(d);
//   });

//   ghost.appendChild(rowClone);
//   document.body.appendChild(ghost);
//   return ghost;
// }

// // anime le ghost de A → B (DOMRect)
// function animateGhost(ghost, fromRect, toRect, { duration=550 } = {}) {
//   if (!ghost || !fromRect || !toRect) return Promise.resolve();
//   const dx = (toRect.left + toRect.width/2)  - (fromRect.left + fromRect.width/2);
//   const dy = (toRect.top  + toRect.height/2) - (fromRect.top  + fromRect.height/2);
//   const scale = Math.max(0.85, Math.min(1.05, toRect.height / Math.max(1, fromRect.height)));

//   return new Promise(res => {
//     ghost.animate(
//       [
//         { transform: 'translate(0,0) scale(1)',   opacity: .95 },
//         { transform: `translate(${dx}px, ${dy}px) scale(${scale})`, opacity: 0.15 }
//       ],
//       { duration, easing: 'cubic-bezier(.22,.8,.2,1)', fill: 'forwards' }
//     ).onfinish = () => { ghost.remove(); res(); };
//   });
// }

// // flash visuel de la ligne d'arrivée
// function flashArrival(gridId, node) {
//   const h = grids.get(gridId);
//   if (!h || !node) return;
//   const rowEl = h.el.querySelector(`.ag-row[aria-rowindex="${node.rowIndex+1}"]`);
//   rowEl?.classList.add('flash-arrival');
//   setTimeout(()=> rowEl?.classList.remove('flash-arrival'), 480);
// }

// // Trouve node & .ag-row par __uuid
// function getRowNodeAndElByUuid(gridId, uuid) {
//   const h = grids.get(gridId);
//   if (!h || !uuid) return { api: null, node: null, rowEl: null, el: h?.el || null };
//   const api = h.api;
//   let node = null;
//   api.forEachNode?.(n => { if (!node && n.data?.__uuid === uuid) node = n; });
//   const rowEl = node ? h.el.querySelector(`.ag-row[aria-rowindex="${node.rowIndex+1}"]`) : null;
//   return { api, node, rowEl, el: h.el };
// }

// CSS.escape polyfill safe
const cssEscape = (window.CSS && CSS.escape) ? CSS.escape
  : (s) => String(s).replace(/["\\#:.%]/g, '\\$&');

async function getRowNodeAndElByUuid(gridId, uuid, { ensureVisible = true, paints = 2, debug = false } = {}) {
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

// // crée un “ghost” à partir d’un DOMRect + texte (sans dépendre du DOM source encore présent)
// function makeRowGhostFromRect(rect, sampleText='') {
//   if (!rect) return null;
//   const ghost = document.createElement('div');
//   ghost.className = 'row-flight';
//   ghost.style.left = rect.left + 'px';
//   ghost.style.top = rect.top + 'px';
//   ghost.style.width = rect.width + 'px';
//   ghost.style.height = rect.height + 'px';

//   const inner = document.createElement('div');
//   inner.style.display = 'flex';
//   inner.style.alignItems = 'center';
//   inner.style.gap = '8px';
//   inner.style.height = '100%';
//   inner.style.padding = '4px 10px';
//   inner.style.font = '14px/1.2 system-ui, -apple-system, "Segoe UI", Roboto';
//   inner.textContent = sampleText || '';
//   ghost.appendChild(inner);

//   document.body.appendChild(ghost);
//   return ghost;
// }

// function makeRowGhostFromRect(rect, sampleText='') {
//   if (!rect) return null;
//   const ghost = document.createElement('div');
//   ghost.className = 'row-flight';
//   // élargir légèrement pour visibilité
//   const w = Math.max(rect.width, 260);

//   ghost.style.left = rect.left + 'px';
//   ghost.style.top = rect.top + 'px';
//   ghost.style.width = w + 'px';
//   ghost.style.height = rect.height + 'px';

//   const inner = document.createElement('div');
//   inner.style.display = 'flex';
//   inner.style.alignItems = 'center';
//   inner.style.gap = '8px';
//   inner.style.height = '100%';
//   inner.style.padding = '4px 10px';
//   inner.style.font = '14px/1.2 system-ui, -apple-system, "Segoe UI", Roboto';
//   inner.textContent = sampleText || '';
//   ghost.appendChild(inner);

//   document.body.appendChild(ghost);
//   return ghost;
// }

function animateGhost(ghost, fromRect, toRect, { duration=560 } = {}) {
  if (!ghost || !fromRect || !toRect) return Promise.resolve();
  const dx = (toRect.left + toRect.width/2)  - (fromRect.left + fromRect.width/2);
  const dy = (toRect.top  + toRect.height/2) - (fromRect.top  + fromRect.height/2);
  const scale = Math.max(0.85, Math.min(1.05, toRect.height / Math.max(1, fromRect.height)));
  return new Promise(res => {
    const anim = ghost.animate(
      [
        { transform: 'translate(0,0) scale(1)', opacity: .95 },
        { transform: `translate(${dx}px, ${dy}px) scale(${scale})`, opacity: .1 }
      ],
      { duration, easing: 'cubic-bezier(.22,.8,.2,1)', fill: 'forwards' }
    );
    anim.onfinish = () => { ghost.remove(); res(); };
    anim.oncancel  = () => { ghost.remove(); res(); };
  });
}

// function animateGhostArc(ghost, fromRect, toRect, { duration=700, lift= -180 } = {}) {
//   if (!ghost || !fromRect || !toRect) return Promise.resolve();

//   const dx = (toRect.left + toRect.width/2)  - (fromRect.left + fromRect.width/2);
//   const dy = (toRect.top  + toRect.height/2) - (fromRect.top  + fromRect.height/2);

//   // si delta trop petit → donne un mouvement “lisible”
//   const small = Math.hypot(dx, dy) < 40;
//   const L = small ? -200 : lift;

//   // scale léger pour dynamiser
//   const scaleEnd = 0.9;

//   return new Promise(res => {
//     const anim = ghost.animate(
//       [
//         { transform: 'translate3d(0,0,0) scale(1)',   opacity: .96 },
//         { transform: `translate3d(${dx*0.75}px, ${dy*0.5 + L}px, 0) scale(1.02)`, opacity: .9 },
//         { transform: `translate3d(${dx}px, ${dy}px, 0) scale(${scaleEnd})`,        opacity: .15 }
//       ],
//       { duration, easing: 'cubic-bezier(.22,.8,.2,1)', fill: 'forwards' }
//     );
//     anim.onfinish = () => { ghost.remove(); res(); };
//     anim.oncancel  = ()  => { ghost.remove(); res(); };
//   });
// }

function getHeaderTargetRect(expId) {
  const header = document.querySelector(`#${expId} .st-expander-header`);
  if (!header) return null;
  const r = header.getBoundingClientRect();
  // viser un point un peu au-dessus, centré, pour un mouvement visible
  return {
    left: r.left + r.width/2 - 40,
    top:  r.top  - 24,
    width: 80,
    height: 20
  };
}

// function flashArrival(gridId, node) {
//   const h = grids.get(gridId);
//   if (!h || !node) return;
//   const rowEl = h.el.querySelector(`.ag-row[aria-rowindex="${node.rowIndex+1}"]`);
//   if (!rowEl) return;
//   rowEl.classList.add('flash-arrival');
//   setTimeout(()=> rowEl.classList.remove('flash-arrival'), 480);
// }

// attendre qu'AG Grid ait peint
function nextPaint(times=2) {
  return new Promise(r => {
    const step = () => (times-- > 0) ? requestAnimationFrame(step) : r();
    requestAnimationFrame(step);
  });
}

// Ouvre l’expander par id (utilise ta openExp si dispo)
function openExpanderById(expId){
  const exp = document.getElementById(expId);
  if (!exp) return;
  if (!exp.classList.contains('open')) {
    if (typeof openExp === 'function') openExp(exp);
    else exp.classList.add('open');
  }
}

// sélectionne + rend visible + retourne DOM de la ligne si possible
async function ensureRowVisibleAndGetEl(gridId, uuid) {
  const h = grids.get(gridId);
  if (!h) return { api:null, node:null, rowEl:null };

  const api = h.api;
  let node = null;
  api.forEachNode?.(n => { if (!node && n.data?.__uuid === uuid) node = n; });
  if (!node) return { api, node:null, rowEl:null };

  // sélection d’abord (feedback immédiat)
  node.setSelected?.(true, true);
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

// mini flash propre
function flashArrival(gridId, node) {
  const h = grids.get(gridId);
  if (!h || !node) return;
  const rowEl = h.el.querySelector(`.ag-row[aria-rowindex="${node.rowIndex+1}"]`)
             || h.el.querySelector(`.ag-row[row-index="${node.rowIndex}"]`);
  if (!rowEl) return;
  rowEl.classList.add('flash-arrival');
  setTimeout(()=> rowEl.classList.remove('flash-arrival'), 480);
}

// ghost simple (lisible)
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

// Translation simple vers le coin haut-gauche de la destination
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

// function addHeaderActionsProgrammables() {
//   const exp = document.querySelector('#exp-programmables');
//   if (!exp) return;
//   const header = exp.querySelector('.st-expander-header');
//   if (!header) return;

//   // assure un span titre
//   if (!header.querySelector('.st-expander-title')) {
//     const t = header.querySelector('.title') || header.firstElementChild;
//     if (t) t.classList.add('st-expander-title');
//   }

//   // déjà présent ?
//   if (header.querySelector('.header-actions')) return;

//   const actions = document.createElement('div');
//   actions.className = 'header-actions';
//   actions.setAttribute('data-no-toggle', ''); // pour le guard dans wireExpanders

//   const btn = document.createElement('button');
//   btn.className = 'btn';
//   btn.textContent = 'Programmer';
//   btn.title = 'Programmer l’activité sélectionnée';

//   // 🔒 Empêche de déclencher le toggle de l’expander
//   const swallow = (e) => { e.stopPropagation(); };
//   btn.addEventListener('mousedown', swallow);
//   btn.addEventListener('mouseup', swallow);
//   btn.addEventListener('click', (e) => {
//     e.stopPropagation();
//     doProgrammerActivite();
//   });

//   actions.appendChild(btn);
//   header.appendChild(actions);
// }

function addProgrammerButton(expanderId, onClick) {
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
  if (actions.querySelector('.btn-programmer')) return;

  const btn = document.createElement('button');
  btn.className = 'exp-header-btn btn-programmer';
  btn.title = 'Programmer l’activité sélectionnée';
  btn.innerHTML = `
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
  `;

  // stopPropagation : ne pas toggler l’expander
  btn.addEventListener('click', async (e) => {
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

  actions.appendChild(btn);
}

function addButtons() {
  addProgrammerButton('exp-programmables', async () => {await doProgrammerActivite();});
}

// ===== Colonnes =====
// Colonnes activités (grilles A, B, D) 
function buildColumnsActivites(){
  let width = window.matchMedia("(max-width: 750px)").matches ? 60 : 90;
  return [
    { field:'Date', headerName:'Date', width, suppressSizeToFit:true,
      valueFormatter:p=>dateintToPretty(p.value),
      valueParser:p=>prettyToDateint(p.newValue) ?? p.oldValue ?? null,
      comparator:(a,b)=>(safeDateint(a)||0)-(safeDateint(b)||0)
    },
    { field:'Debut', headerName: 'Début', width, suppressSizeToFit:true,
      comparator:(a,b)=>{
        const ma=parseHHhMM(a)??Infinity, mb=parseHHhMM(b)??Infinity;
        return ma-mb;
      }
    },
    { field:'Activite', headerName: 'Activité', minWidth:200, flex:1, cellRenderer: ActiviteRenderer },
    { field:'Duree', headerName: 'Durée', width, suppressSizeToFit:true },
    { field:'Fin',   width, suppressSizeToFit:true },
    { field:'Lieu',  minWidth:160, flex:1 },
    { field:'Relache', headerName: 'Relâche', minWidth:60, flex:.5 },
    { field:'Reserve', headerName: 'Réservé', minWidth:60, flex:.5 },
    { field:'Priorite', headerName: 'Priorité',minWidth:60, flex:.5 },
    { field:'Hyperlien', minWidth:120, flex:2 }
  ];
}

const dateintStrToPretty = (d) => dateintToPretty(Number(d)); 

// Colonnes créneaux (grille C) 
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
  const cols = buildColumnsActivites();
  
  // Dans ActivitesProgrammables Date est en string et non en dateint
  cols[0].valueFormatter = p=>dateintStrToPretty(p.value);  
  
  // force toutes les colonnes non éditables
  return cols.map(col => ({
    ...col,
    editable: false
  }));
}

// Colonnes carnet d’adresses (grille E)
function buildColumnsCarnet(){
  return [
    { field:'Nom', headerName:'Nom', minWidth:180, flex:1, editable:true },
    { field:'Adresse', minWidth:160, flex:1, editable:true },
    { field:'Tel', minWidth:200, flex:1, editable:true },
    { field:'Web', minWidth:140, editable:true },
  ];
}

// ===== Contrôleur de grille =====
function createGridController({ gridId, elementId, loader, columnsBuilder, onSelectionChanged }) {
  if (grids.has(gridId)) return grids.get(gridId);
  const el = $(elementId);
  if (!el) return null;

  const gridOptions = {
    columnDefs: (columnsBuilder ?? buildColumnsActivites)(),
    defaultColDef: { editable: true, resizable: true, sortable: true, filter: true },
    rowData: [],
    getRowId: p => p.data?.__uuid ?? p.data?.id ?? JSON.stringify(p.data),
    onGridReady: async (p) => {
      await refreshGrid(gridId);
      safeSizeToFitFor(gridId);
      const root = el.querySelector('.ag-root') || el;
      enableTouchEdit(p.api, root, {debug: true /*, forceTouch: true*/});
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
      const c = colorForDate(p.data?.Date);
      return c ? { '--day-bg': c } : null;
    },
    onSelectionChanged: onSelectionChanged
      ? () => onSelectionChanged(gridId)
      : undefined,
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
  };

  const api = window.agGrid.createGrid(el, gridOptions);
  el.__agApi = api; // ⟵ pour retrouver l’API depuis le pane
  const handle = { id: gridId, el, api, loader, columnsBuilder };
  grids.set(gridId, handle);
  if (!activeGridId) setActiveGrid(gridId);
  return handle;
}

function setActiveGrid(gridId){
  activeGridId = gridId;
  grids.forEach(g => g?.el?.classList.toggle('is-active-grid', g.id === gridId));
}

// async function refreshGrid(gridId) {
//   const h = grids.get(gridId);
//   if (!h) return;

//   const api = h.api;

//   // 0) mémorise la sélection actuelle (par __uuid)
//   let prevUuid = null;
//   try {
//     const prevSel = api.getSelectedRows?.() || [];
//     prevUuid = prevSel[0]?.__uuid ?? null;
//   } catch {}

//   // 1) recharge les données
//   const rows = await h.loader?.();
//   api.setGridOption?.('rowData', rows || []);

//   // 2) après peinture → reselect ou fallback 1ère ligne
//   const selectAfterPaint = () => {
//     // si déjà sélectionné (AG Grid peut préserver via getRowId) -> ne rien faire
//     const already = api.getSelectedNodes?.();
//     if (already && already.length > 0) return finish();

//     let node = null;

//     // essaie de reselectionner l'ancienne ligne par __uuid
//     if (prevUuid) {
//       api.forEachNode?.(n => { if (!node && n.data?.__uuid === prevUuid) node = n; });
//     }

//     // fallback : sélectionner la 1ʳᵉ ligne si aucune
//     if (!node) {
//       const count = api.getDisplayedRowCount?.() ?? 0;
//       if (count > 0) node = api.getDisplayedRowAtIndex?.(0) || null;
//     }

//     node?.setSelected?.(true, true); // (select, clearOther)

//     finish();
//   };

//   const finish = () => {
//     // resize / repaint safe (v29+)
//     api.refreshCells?.({ force: true });
//     api.dispatchEvent?.({ type: 'gridSizeChanged' });
//     try { autoSizePanelFromRowCount?.(h.el.closest('.st-expander-body'), api); } catch {}
//   };

//   // laisse AG Grid peindre les nouvelles rows
//   requestAnimationFrame(() => requestAnimationFrame(selectAfterPaint));
// }

async function refreshGrid(gridId) {
  const h = grids.get(gridId);
  if (!h) return;

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
    api.dispatchEvent?.({ type: 'gridSizeChanged' });

    // auto-taille pane (uniquement si ouvert ou mémorisation si fermé)
    const pane = h.el.closest('.st-expander-body');
    autoSizePanelFromRowCount(pane, h.el, api);
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

async function refreshAllGrids() {
  const ids = Array.from(grids.keys());
  await Promise.all(ids.map(id => refreshGrid(id)));
}

let refreshPending = false;

async function scheduleGlobalRefresh() {
  if (refreshPending) return;
  refreshPending = true;
  requestAnimationFrame(async () => {
    refreshPending = false;
    await refreshAllGrids();
  });
}

// ===== Loaders pour chaque grille =====

// 1) Programmées : Date non nulle
async function loadProgrammees(){
  const activites = ctx.df;                      
  return getActivitesProgrammees(activites);
}

// 2) Non programmées : Date vide/null
async function loadNonProgrammees(){
  const activites = ctx.df;                      
  return getActivitesNonProgrammees(activites);
}

async function loadCreneaux() {
  const activites = ctx.df;                      
  const activitesProgrammees = getActivitesProgrammees(activites);
  const periodeProgrammation = initialiserPeriodeProgrammation(activites)
  return getCreneaux(activites, activitesProgrammees, false, periodeProgrammation);
}

// 4) Activités programmables 
async function loadProgrammables(){
  if (!selectedSlot) return [];
  const activites = ctx.df;                      
  return getActivitesProgrammables(activites, selectedSlot);
}

// 5) Carnet d'adresses
async function loadCarnet() {
  const carnet = ctx.carnet;
  return carnet;
}

// ===== Sélection sur la grille des créneaux =====
function onCreneauxSelectionChanged(gridId){
  const g = grids.get(gridId);
  if (!g?.api) return;
  const sel = g.api.getSelectedRows?.() || [];
  selectedSlot = sel[0] || null;

  // rafraîchir la grille 4 (programmables)
  refreshGrid('grid-programmables');
}

// ===== Wiring =====
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
  // 1) Programmées
  createGridController({
    gridId: 'grid-programmees',
    elementId: 'gridA',
    loader: loadProgrammees,
    columnsBuilder: buildColumnsActivites
  });

  // 2) Non programmées
  createGridController({
    gridId: 'grid-non-programmees',
    elementId: 'gridB',
    loader: loadNonProgrammees,
    columnsBuilder: buildColumnsActivites
  });

  // 3) Créneaux
  createGridController({
    gridId: 'grid-creneaux',
    elementId: 'gridC',
    loader: loadCreneaux,
    columnsBuilder: buildColumnsCreneaux,
    onSelectionChanged: onCreneauxSelectionChanged
  });

  // 4) Programmables 
  createGridController({
    gridId: 'grid-programmables',
    elementId: 'gridD',
    loader: loadProgrammables,
    columnsBuilder: buildColumnsActivitesProgrammables
  });

  // 5) Carnet d’adresses
  createGridController({
    gridId: 'grid-carnet',
    elementId: 'gridE',
    loader: loadCarnet,
    columnsBuilder: buildColumnsCarnet
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

// ------- Grid Renderers -------
const ActiviteRenderer = function () {};
ActiviteRenderer.prototype.init = function (params) {
  const e = document.createElement('div');
  e.style.display = 'flex';
  e.style.alignItems = 'center';
  e.style.gap = '.4rem';
  e.style.width = '100%';
  e.style.overflow = 'hidden';

  const label = (params.value != null ? String(params.value) : '').trim();
  const raw   = params.data?.Hyperlien || '';
  const href  = String(raw || ("https://www.festivaloffavignon.com/resultats-recherche?recherche="+encodeURIComponent(label)));

  // lien-icône (ouvre NOUVEL onglet)
  const a = document.createElement('a');
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.title = 'Ouvrir le site';
  a.style.textDecoration = 'none';
  a.style.flex = '0 0 auto';
  a.style.display = 'inline-flex';
  a.style.alignItems = 'center';
  a.style.opacity = '.85';
  a.addEventListener('mouseenter', () => a.style.opacity = '1');
  a.addEventListener('mouseleave', () => a.style.opacity = '.85');
  a.addEventListener('click', (ev) => {
    // important : ne PAS mettre preventDefault ici,
    // on laisse le navigateur ouvrir le nouvel onglet.
    ev.stopPropagation(); // évite de changer la sélection de la ligne
  });

  const icon = document.createElement('span');
  icon.textContent = '🔗';
  icon.style.fontSize = '1rem';
  a.appendChild(icon);

  const txt = document.createElement('span');
  txt.textContent = label;
  txt.style.flex = '1 1 auto';
  txt.style.overflow = 'hidden';
  txt.style.textOverflow = 'ellipsis';

  e.appendChild(a);
  e.appendChild(txt);
  this.eGui = e;
};
ActiviteRenderer.prototype.getGui = function(){ return this.eGui; };
ActiviteRenderer.prototype.refresh = function(){ return false; };

// ------- Actions -------

// Import Excel
async function doImport() {
  // déclenche l’input caché
  const fi = $('fileInput');
  if (fi) fi.click();
}

// Export Excel
async function doExport() {
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

// Recharger
async function doReload(){
  if (activeGridId) await refreshGrid(activeGridId);
  else await refreshAllGrids();
}

// Ajouter 
async function doAdd() {
  const sample = [
    { __uuid: crypto.randomUUID?.() || `${Date.now()}-a`,
      Date: 20250721, Début:'13h20', Durée:'1h20', Activité:"Activité 1", Lieu:"Roi René", Relâche:"", Réservé:"", Priorité:"" },
    { __uuid: crypto.randomUUID?.() || `${Date.now()}-b`,
      Date: 20250722, Début:'15h00', Durée:'1h10', Activité:"Activité 2", Lieu:"La Scala", Relâche:"", Réservé:"", Priorité:""  },
  ];
  ctx.mutateDf(rows => [...rows, ...sample]);
}

// // Init Pyodide (singleton)
// let pyodideReady = null;
// async function getPyodideOnce() {
//   if (!pyodideReady) {
//     pyodideReady = (async () => {
//       const pyodide = await loadPyodide(); // script déjà inclus dans index.html
//       return pyodide;
//     })();
//   }
//   return pyodideReady;
// }

// // Test Python 
// async function doPythonTest() {
//   try {
//     const t0 = performance.now();
//     const pyodide = await getPyodideOnce();
//     const t1 = performance.now();

//     const code = `
//       def pretty_duration(hhmm: str) -> str:
//           try:
//               hh, mm = hhmm.lower().split('h')
//               return f"{int(hh):02d}:{int(mm):02d}"
//           except Exception:
//               return hhmm

//       pretty_duration("1h20")
//       `;
//     const out = await pyodide.runPythonAsync(code);
//     const t2 = performance.now();
//     alert(`Pyodide OK : ${out}\nInit: ${(t1-t0).toFixed(1)} ms, Exec: ${(t2-t1).toFixed(1)} ms`);
//   } catch (e) {
//     console.error(e);
//     alert('Pyodide KO');
//   }
// }

async function doProgrammerActivite() {
  // 1) sélection dans la grille des programmables
  const gProg = grids.get('grid-programmables');
  if (!gProg) { alert('Grille “programmables” introuvable.'); return; }

  const sel = getSelectedRowSafe(gProg.api);
  if (!sel) return; 

  const uuid = sel.__uuid;
  const dateInt = toDateint(sel.Date);
  if (!uuid || !dateInt) { alert('Donnée sélectionnée invalide.'); return; }

  // Capture source AVANT refresh pour préparation animation fantôme
  const srcH = grids.get('grid-programmables');
  let fromRect = null, ghostLabel = '';
  if (srcH) {
    const sel = srcH.api.getSelectedRows?.() || [];
    const s = sel[0];
    if (s) {
      const { node, rowEl } = await ensureRowVisibleAndGetEl('grid-programmables', s.__uuid);
      fromRect = rowEl?.getBoundingClientRect() || null;
      ghostLabel = (s.Activité || s.Activite || '').trim();
    }
  }

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
  openExpanderById('exp-programmees');

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

  // 5) rafraîchir grilles 
  // await refreshAllGrids(); (fait par mutation)

  // 6) ANIMATION fantôme de la ligne (si on a capturé une source)
  const doPhantom = true; // debug Phantom
  if (doPhantom) {

    // 1) ouvrir l’expander cible et rendre la row visible
    openExpanderById('exp-programmees');
    await nextPaint(2);
    const dst = await ensureRowVisibleAndGetEl('grid-programmees', uuid);

    // 2) animer vers la VRAIE ligne si possible, sinon flash-only
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
      flashArrival('grid-programmees', dst.node);
    }
  }
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
    try { await ctx.undo(); } catch {}
  });
  $('btn-redo')?.addEventListener('click', async (e) => {
    pulse(e.currentTarget);
    try { await ctx.redo(); } catch {}
  });

  // --- Ajouter ---
  $('btn-add')?.addEventListener('click', (e) => {
    pulse(e.currentTarget);
    ctx.mutateDf(rows => [
      ...rows,
      {
        __uuid: crypto.randomUUID?.() || String(Date.now()),
        Date: null, Debut: null, Duree: null,
        Activite: 'Nouvelle activité', Lieu: '', Relache: '', Reserve: '', Priorite: ''
      }
    ]);
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
  window.addEventListener('focusin', (e) => {
    if (e.target.closest('input, textarea, [contenteditable="true"]')) {
      bar.style.transform = 'translateY(120%)';
    }
  });
  window.addEventListener('focusout', () => {
    bar.style.transform = '';
  });

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
    openFileMenu(anchorBtn);  // version desktop
  }
}

// Menu contextuel au-dessus du bouton "Fichier"
function openFileMenu(anchorBtn, opts = {}) {
  const btn = anchorBtn;
  if (!btn || !(btn instanceof HTMLElement)) {
    console.warn('[FileMenu] anchor invalide');
    return;
  }

  // Si un menu est déjà ouvert → fermer si clic sur le même bouton
  const existing = document.querySelector('.file-menu');
  if (existing) {
    const wasForSameBtn = existing.dataset.anchorId === btn.id;
    existing.remove();
    if (wasForSameBtn) return; // toggle: referme seulement
  }

  let openMenu = null;

  const closeMenu = () => {
    if (!openMenu) return;
    openMenu.remove();
    openMenu = null;
    document.removeEventListener('keydown', onKeyDown);
  };
  const onKeyDown = (e) => { if (e.key === 'Escape') closeMenu(); };

  // 1) créer le menu (invisible le temps de le positionner)
  const menu = document.createElement('div');
  menu.className = 'file-menu';
  menu.dataset.anchorId = btn.id || ''; // pour savoir qui l’a ouvert
  menu.innerHTML = `
    <button data-action="new">Nouveau</button>
    <button data-action="open">Ouvrir</button>
    <button data-action="save">Sauvegarder</button>
  `;
  Object.assign(menu.style, {
    position: 'fixed',
    zIndex: 2000,
    background: '#fff',
    border: '1px solid #ccc',
    borderRadius: '8px',
    boxShadow: '0 8px 24px rgba(0,0,0,.12)',
    padding: '4px',
    visibility: 'hidden',
    opacity: '0',
  });
  document.body.appendChild(menu);

  // style des items
  menu.querySelectorAll('button').forEach(b => {
    Object.assign(b.style, {
      display: 'block',
      width: '100%',
      padding: '8px 10px',
      textAlign: 'left',
      background: 'transparent',
      border: 'none',
      borderRadius: '6px',
      cursor: 'pointer'
    });
    b.addEventListener('mouseenter', () => b.style.background = '#f3f4f6');
    b.addEventListener('mouseleave', () => b.style.background = 'transparent');
    b.addEventListener('click', async (ev) => {
      const act = ev.currentTarget.dataset.action;
      closeMenu();
      if (act === 'new')  {
        if (typeof opts.onNew === 'function') return opts.onNew();
        console.log('[File] Nouveau');
      }
      if (act === 'open') {
        if (typeof opts.onOpen === 'function') return opts.onOpen();
        if (typeof doImport === 'function') doImport();
      }
      if (act === 'save') {
        if (typeof opts.onSave === 'function') return opts.onSave();
        console.log('[File] Sauvegarder');
      }
    });
  });

  // 2) positionner AU-DESSUS du bouton (ou en dessous si pas de place)
  try {
    positionMenuOverBtn(btn, menu);
  } catch {
    const r = btn.getBoundingClientRect();
    Object.assign(menu.style, {
      left: `${Math.round(r.left)}px`,
      top: `${Math.round(r.top - 120)}px`,
    });
  }

  // 3) montrer avec une petite anim
  menu.style.visibility = 'visible';
  menu.animate(
    [
      { opacity: 0, transform: 'translateY(6px)' },
      { opacity: 1, transform: 'translateY(0)' }
    ],
    { duration: 140, easing: 'ease-out', fill: 'forwards' }
  );

  openMenu = menu;

  // fermer si clic ailleurs (différé pour ne pas capter ce même clic)
  setTimeout(() => {
    const onDocClick = (ev) => {
      if (menu.contains(ev.target)) return;
      // ⇩ ferme aussi si on reclique sur le bouton ancre ⇩
      if (ev.target === btn) { closeMenu(); return; }
      document.removeEventListener('click', onDocClick);
      closeMenu();
    };
    document.addEventListener('click', onDocClick);
  }, 0);

  document.addEventListener('keydown', onKeyDown);
}

// File sheet appelée par le bouton "Fichier" sur mobile
// function openFileSheet() {
//   // Si déjà ouverte, fermer
//   const existing = document.querySelector('.file-sheet');
//   if (existing) { existing.remove(); return; }

//   const sheet = document.createElement('div');
//   sheet.className = 'file-sheet';
//   sheet.innerHTML = `
//     <div class="file-sheet__backdrop"></div>
//     <div class="file-sheet__panel">
//       <h3>Fichier</h3>
//       <button data-action="new">Nouveau</button>
//       <button data-action="open">Ouvrir</button>
//       <button data-action="save">Sauvegarder</button>
//       <button class="cancel">Fermer</button>
//     </div>
//   `;
//   document.body.appendChild(sheet);

//   // Animation d'apparition
//   requestAnimationFrame(() => sheet.classList.add('visible'));

//   // Fermer sur clic backdrop ou "Fermer"
//   sheet.querySelector('.file-sheet__backdrop').onclick =
//   sheet.querySelector('.cancel').onclick = () => {
//     sheet.classList.remove('visible');
//     setTimeout(() => sheet.remove(), 280);
//   };

//   // Actions
//   sheet.querySelectorAll('button[data-action]').forEach(b => {
//     b.onclick = e => {
//       const act = e.target.dataset.action;
//       sheet.classList.remove('visible');
//       setTimeout(() => sheet.remove(), 280);
//       if (act === 'new') console.log('Nouveau');
//       if (act === 'open') doImport();
//       if (act === 'save') console.log('Sauvegarder');
//     };
//   });
// }
function openFileSheet() {
  // Si déjà ouverte → fermer
  const existing = document.querySelector('.file-sheet');
  if (existing) { existing.remove(); return; }

  const sheet = document.createElement('div');
  sheet.className = 'file-sheet';
  sheet.innerHTML = `
    <div class="file-sheet__backdrop"></div>
    <div class="file-sheet__panel" role="dialog" aria-modal="true">
      <span class="file-sheet__handle" aria-hidden="true"></span>
      <h3 class="file-sheet__title">Fichier</h3>
      <ul class="file-sheet__list">
        <li class="file-sheet__item" data-action="new">
          <svg class="file-sheet__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 5v14M5 12h14"/>
          </svg>
          <div class="file-sheet__text">
            <span class="file-sheet__titleText">Nouveau</span>
            <span class="file-sheet__subtitle">Réinitialiser le planning</span>
          </div>
        </li>
        <li class="file-sheet__item" data-action="open">
          <svg class="file-sheet__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M4 4h7l3 3h6v13H4z"/>
          </svg>
          <div class="file-sheet__text">
            <span class="file-sheet__titleText">Ouvrir</span>
            <span class="file-sheet__subtitle">Importer un fichier Excel</span>
          </div>
        </li>
        <li class="file-sheet__item" data-action="save">
          <svg class="file-sheet__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M19 21H5a2 2 0 0 1-2-2V5h11l5 5v9a2 2 0 0 1-2 2z"/>
            <path d="M17 21v-8H7v8M7 5v4h8"/>
          </svg>
          <div class="file-sheet__text">
            <span class="file-sheet__titleText">Sauvegarder</span>
            <span class="file-sheet__subtitle">Exporter vers Excel</span>
          </div>
        </li>
      </ul>
      <div class="file-sheet__footer">
        <button class="file-sheet__close">Fermer</button>
      </div>
    </div>
  `;
  document.body.appendChild(sheet);

  const panel   = sheet.querySelector('.file-sheet__panel');
  const backdrop= sheet.querySelector('.file-sheet__backdrop');
  const handle  = sheet.querySelector('.file-sheet__handle');

  // Apparition
  requestAnimationFrame(() => sheet.classList.add('visible'));

  // Fermer helper
  const close = () => {
    sheet.classList.remove('visible');
    panel.style.transform = `translateY(100%)`;
    setTimeout(() => sheet.remove(), 260);
  };

  // Clicks
  backdrop.addEventListener('click', close);
  sheet.querySelector('.file-sheet__close').addEventListener('click', close);
  sheet.querySelectorAll('.file-sheet__item').forEach(li => {
    li.addEventListener('click', () => {
      const act = li.dataset.action;
      close();
      if (act === 'new')  console.log('[File] Nouveau');
      if (act === 'open') doImport?.();
      if (act === 'save') doExport?.();
    });
  });

  // ----- Swipe-down to close (drag handle) -----
  let startY = 0, dragging = false, baseY = 0;

  const begin = (y) => {
    dragging = true;
    startY = y;
    // position de départ (0)
    baseY = 0;
    panel.style.transition = 'none';
  };
  const move = (y) => {
    if (!dragging) return;
    const dy = Math.max(0, y - startY);
    panel.style.transform = `translateY(${dy}px)`;
  };
  const end = (y) => {
    if (!dragging) return;
    dragging = false;
    const dy = Math.max(0, y - startY);
    const shouldClose = dy > 80; // seuil de fermeture
    panel.style.transition = 'transform .22s cubic-bezier(.22,.8,.24,1)';
    if (shouldClose) { close(); }
    else { panel.style.transform = 'translateY(0)'; }
  };

  // Touch + Mouse (sur la poignée ET le panel haut)
  const startEvt = (e) => begin(e.touches ? e.touches[0].clientY : e.clientY);
  const moveEvt  = (e) => { e.preventDefault?.(); move(e.touches ? e.touches[0].clientY : e.clientY); };
  const endEvt   = (e) => end(e.changedTouches ? e.changedTouches[0].clientY : e.clientY);

  handle.addEventListener('touchstart', startEvt, { passive: true });
  handle.addEventListener('mousedown',  startEvt);
  window.addEventListener('touchmove',  moveEvt,  { passive: false });
  window.addEventListener('mousemove',  moveEvt);
  window.addEventListener('touchend',   endEvt);
  window.addEventListener('mouseup',    endEvt);
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

// --- Handler du file input caché (import Excel effectif) ---
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

      // // 2) Carte d’en-têtes (détection robuste de "Activité" et "Hyperlien")
      // const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
      // const norm = (s) => (s ?? '')
      //   .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
      //   .trim().toLowerCase();

      // // headers: map nomNormalisé -> index de colonne (c)
      // const headers = {};
      // for (let c = range.s.c; c <= range.e.c; c++) {
      //   const addr = XLSX.utils.encode_cell({ r: range.s.r, c });
      //   const cell = ws[addr];
      //   const txt  = (cell && String(cell.v)) || '';
      //   const key  = norm(txt);
      //   if (key) headers[key] = c;
      // }

      // const colActivite = headers['activite'];   // normalizeRowsKeys garantit un nom normalisé

      // 0) range de la feuille
      const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');

      // 1) Récupère la ligne d'entêtes brute (array)
      const headerRow = (XLSX.utils.sheet_to_json(ws, { header: 1, range: range.s.r })[0] || []);

      // 2) Trouve l'index de la colonne "Activite" en normalisant l'entête
      const colActivite = headerRow.findIndex(h => normalizeHeaderToCanon(h) === 'Activite');

      // 3) Si on a une colonne Activité, on va lire les hyperliens des cellules (A2..An selon la colonne)
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

      // 4) normalisation colonnes + __uuid + Date->dateint 
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

        // __uuid garanti
        if (!o.__uuid) {
          o.__uuid = (crypto.randomUUID?.()) || `${Date.now()}_${i}`;
        }
        return o;
      });
      
      dfRows = sortDf(dfRows);

      console.log('✅ Import df OK', dfRows.length, 'lignes');
    
      // 5) Carnet d’adresses (optionnel, 2e onglet)
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
  });

  // updateTogglePos();
  window.addEventListener('resize', updateTogglePos);
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


function isStandaloneIOS(){
  const ua = navigator.userAgent || "";
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
  return isIOS && standalone;
}

function getSafeBottom() {
  // iOS notch etc.
  return 'env(safe-area-inset-bottom, 0px)';
}

function syncBottomBarTogglePosition() {
  if (isSplitterDragging) return;
  const bar = document.querySelector('.bottom-bar');
  const tog = document.querySelector('.bottom-toggle');
  if (!bar || !tog) return;

  // Mesurer la hauteur réellement rendue
  const h = Math.max(0, Math.round(bar.getBoundingClientRect().height));

  // Place la languette juste au-dessus de la barre, en tenant compte du safe-area
  tog.style.bottom = `calc(${getSafeBottom()} + ${h}px)`;
}

function setSafeGap(px){
  document.documentElement.style.setProperty('--safe-gap', `${px}px`);
}

// function computeSafeGap(){
//   if (isSplitterDragging) return;
//   const vv = window.visualViewport;
//   if (!vv) {
//     setSafeGap(0);
//     return;
//   }
//   // Espace “perdu” en bas : innerHeight - (viewport visible + offsetTop)
//   const gap = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
//   setSafeGap(gap); // pas besoin de déplacer la bottom bar au dessus du clavier sur mobile
// }

// function computeSafeGap() {
//   if (isSplitterDragging) return;

//   const vv = window.visualViewport;
//   let gap = 0;

//   if (vv) {
//     // Espace “perdu” en bas : innerHeight - (viewport visible + offsetTop)
//     gap = Math.max(0, Math.round(window.innerHeight - (vv.height + vv.offsetTop)));
//   }

//   // ⛔ borne anti-envol: en haut de page, on n'autorise PAS d'augmentation
//   const atTop = (window.scrollY || document.documentElement.scrollTop || 0) <= 0;

//   const prev = parseInt(
//     getComputedStyle(document.documentElement).getPropertyValue('--safe-gap'),
//     10
//   ) || 0;

//   if (atTop && gap > prev) {
//     gap = prev; // on gèle vers le haut quand on “tire” en haut de page
//   }

//   // (optionnel) clamp raisonnable
//   const MAX_GAP = 180;
//   gap = Math.max(0, Math.min(MAX_GAP, gap));

//   setSafeGap(gap); 
// }

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

function wireContext() {
  ctx.on('df:changed',        () => scheduleGlobalRefresh());
  ctx.on('carnet:changed',    () => scheduleGlobalRefresh());
  ctx.on('history:change', (st) => {
    document.getElementById('btn-undo')?.toggleAttribute('disabled', !st.canUndo);
    document.getElementById('btn-redo')?.toggleAttribute('disabled', !st.canRedo);
  });

  // état initial des boutons Undo/Redo
  const st = ctx.historyState ? ctx.historyState() : { canUndo: false, canRedo: false };
  document.getElementById('btn-undo')?.toggleAttribute('disabled', !st.canUndo);
  document.getElementById('btn-redo')?.toggleAttribute('disabled', !st.canRedo);
}

// ------- Boot -------
document.addEventListener('DOMContentLoaded', async () => {
  console.log('⏳ DOM prêt, initialisation du contexte...');

  // 1️⃣ Contexte métier (singleton)
  window.ctx = await AppContext.ready();

  // 2️⃣ Branchements UI
  wireContext();
  wireBottomBar();
  wireGrids();
  wireExpanders();
  wireExpanderSplitters();
  addButtons();

  // 3️⃣ Premier rendu
  await refreshAllGrids();

  console.log('✅ Application initialisée');
});
