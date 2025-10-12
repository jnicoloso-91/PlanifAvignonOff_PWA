// app.js (module)
import { df_getAll, df_getAllOrdered, df_putMany, df_clear, carnet_getAll, carnet_clear, carnet_putMany } from './db.mjs';
import { prettyToDateint, dateintToPretty, ymdToDateint, safeDateint } from './utils-date.js';
import { getCreneaux } from './activites.js'; 

// ===== Multi-grilles =====
const ROW_H=32, HEADER_H=32, PAD=4;
const hFor = n => HEADER_H + ROW_H * Math.max(0,n) + PAD;

const grids = new Map();           // id -> { api, el, loader }
let activeGridId = null;

// Mémorise le créneau sélectionné (grille C)
let selectedSlot = null;

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

function openExp(exp){
  const pane = paneOf(exp);
  exp.classList.add('open');
  // anim 0 -> target
  enableTransition(pane);
  pane.style.setProperty('max-height','none','important');
  pane.style.setProperty('min-height','0px','important');

  setH(pane, 0);           // point de départ
  pane.offsetHeight;       // reflow
  const target = restoreTargetHeight(exp);
  requestAnimationFrame(()=> setH(pane, target));  // déclenche l’easing
}

function closeExp(exp){
  const pane = paneOf(exp);
  // mémorise la hauteur actuelle
  savePaneHeight(exp);
  enableTransition(pane);
  const h = Math.round(pane.getBoundingClientRect().height);
  setH(pane, h);           // point de départ
  pane.offsetHeight;       // reflow
  requestAnimationFrame(()=> setH(pane, 0)); // easing vers 0

  // après l’anim on nettoie, puis retire .open
  pane.addEventListener('transitionend', function onEnd(e){
    if (e.propertyName !== 'height') return;
    pane.removeEventListener('transitionend', onEnd);
    pane.style.removeProperty('height');
    exp.classList.remove('open');
  });
}

// quelque part au module (une fois)
const isTouchDevice = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);

// état local pour le double-tap
let lastTapKey = null;
let lastTapTime = 0;
const TAP_DELAY_MS = 350; // fenêtre de double-tap

// function maybeStartEditOnDoubleTap(p) {
//   if (!isTouchDevice) return;                 // desktop = double-clic natif
//   if (!p.colDef?.editable) return;            // colonne non éditable → noop

//   const key = `${p.rowIndex}|${p.colDef.field}`;
//   const now = performance.now();

//   if (lastTapKey === key && (now - lastTapTime) < TAP_DELAY_MS) {
//     p.api.startEditingCell({ rowIndex: p.rowIndex, colKey: p.colDef.field });
//     lastTapKey = null; lastTapTime = 0;       // reset
//   } else {
//     lastTapKey = key; lastTapTime = now;      // 1er tap : on mémorise
//   }
// }

// --- Touch editing: double-tap + long-press (iOS friendly) ---
// function enableTouchEdit(api, gridEl, opts = {}) {
//   if (!api || !gridEl) return;

//   const DOUBLE_TAP_MS  = opts.doubleTapMs  ?? 450;
//   const DOUBLE_TAP_PX  = opts.doubleTapPx  ?? 12;
//   const LONG_PRESS_MS  = opts.longPressMs  ?? 500;
//   const isTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
//   if (!isTouch) return; // Desktop: laisse le double-clic normal

//   let last = { key: null, t: 0, x: 0, y: 0 };
//   let pressTimer = null;
//   let moved = false;

//   // renvoie {rowIndex, colKey, key} depuis un élément du DOM
//   const cellFromEvent = (evt) => {
//     const cellEl = evt.target?.closest?.('.ag-cell');
//     if (!cellEl) return null;
//     const colKey = cellEl.getAttribute('col-id');               // ag-Grid met col-id
//     // ag-Grid n’expose pas le rowIndex en data-attr; on le trouve via la position visuelle:
//     const rowEl = cellEl.closest('.ag-row');
//     let rowIndex = null;
//     if (rowEl) {
//       const ri = rowEl.getAttribute('row-index');               // souvent présent
//       rowIndex = ri != null ? parseInt(ri, 10) : null;
//     }
//     // fallback si row-index manquant: on cherche la cellule active via API (optionnel)
//     if (rowIndex == null) {
//       const pt = evt.changedTouches?.[0] || evt.touches?.[0] || evt;
//       const elAt = document.elementFromPoint(pt.clientX, pt.clientY);
//       const rowEl2 = elAt?.closest?.('.ag-row');
//       const ri2 = rowEl2?.getAttribute?.('row-index');
//       if (ri2 != null) rowIndex = parseInt(ri2, 10);
//     }
//     if (rowIndex == null || !colKey) return null;
//     return { rowIndex, colKey, key: `${rowIndex}|${colKey}` };
//   };

//   const startEdit = ({ rowIndex, colKey }) => {
//     api.startEditingCell({ rowIndex, colKey });
//   };

//   const clearPressTimer = () => { if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; } };

//   gridEl.addEventListener('touchstart', (e) => {
//     // ignore si ce n’est pas une cellule
//     const cell = cellFromEvent(e);
//     if (!cell) return;

//     moved = false;

//     // planifier long-press
//     clearPressTimer();
//     const t0 = performance.now();
//     const t = e.touches[0];
//     const x0 = t.clientX, y0 = t.clientY;

//     pressTimer = setTimeout(() => {
//       if (!moved) startEdit(cell);
//     }, LONG_PRESS_MS);

//     // stocke pour double-tap
//     gridEl._lastTouchMeta = { cell, t0, x0, y0 };
//   }, { passive: true });

//   gridEl.addEventListener('touchmove', (e) => {
//     const meta = gridEl._lastTouchMeta;
//     if (!meta) return;
//     const t = e.touches[0];
//     const dx = Math.abs(t.clientX - meta.x0);
//     const dy = Math.abs(t.clientY - meta.y0);
//     if (dx > DOUBLE_TAP_PX || dy > DOUBLE_TAP_PX) {
//       moved = true;
//       clearPressTimer(); // on annule le long-press si on bouge trop
//     }
//     // ne pas preventDefault ici, on ne veut pas bloquer le scroll si l’utilisateur scrolle vraiment
//   }, { passive: true });

//   gridEl.addEventListener('touchend', (e) => {
//     const meta = gridEl._lastTouchMeta;
//     if (!meta) return;
//     clearPressTimer();

//     // si on a bougé, c’était un scroll → pas d’édition
//     if (moved) { gridEl._lastTouchMeta = null; return; }

//     const cell = cellFromEvent(e);
//     if (!cell) { gridEl._lastTouchMeta = null; return; }

//     const now = performance.now();
//     const dt  = now - (last.t || 0);
//     const tpt = e.changedTouches[0];
//     const dx  = Math.abs((tpt.clientX) - (last.x || 0));
//     const dy  = Math.abs((tpt.clientY) - (last.y || 0));
//     const sameCell = (last.key === cell.key);

//     if (sameCell && dt <= DOUBLE_TAP_MS && dx <= DOUBLE_TAP_PX && dy <= DOUBLE_TAP_PX) {
//       // double-tap validé
//       startEdit(cell);
//       last = { key: null, t: 0, x: 0, y: 0 }; // reset
//     } else {
//       // 1er tap : on mémorise et on laisse la sélection normale
//       last = { key: cell.key, t: now, x: tpt.clientX, y: tpt.clientY };
//     }

//     gridEl._lastTouchMeta = null;
//   }, { passive: true });

//   // si l’utilisateur quitte la surface
//   gridEl.addEventListener('touchcancel', () => {
//     clearPressTimer();
//     gridEl._lastTouchMeta = null;
//   });
// }
// export function enableTouchEdit(api, gridEl, opts = {}) {
//   if (!api || !gridEl) return;

//   // en haut de la fonction
//   const DEBUG = !!opts.debug;
//   const FORCE = !!opts.forceTouch;
//   const log = (...a) => { if (DEBUG) console.debug('[TouchEdit]', ...a); };

//   // ...puis remplace tous les tests "pointerType === 'touch'" par:
//   const isTouchPtr = (e) => FORCE || e.pointerType === 'touch';

//   // Détection tactile (tu peux forcer en debug)
//   const isTouchCapable = ('PointerEvent' in window) && ((navigator.maxTouchPoints || 0) > 0 || !!opts.forceTouch);
//   if (!isTouchCapable) { log('skip (no touch capability)'); return; }

//   const DOUBLE_TAP_MS = opts.doubleTapMs ?? 450;
//   const DOUBLE_TAP_PX = opts.doubleTapPx ?? 14;
//   const LONG_PRESS_MS = opts.longPressMs ?? 500;

//   let last = { key: null, t: 0, x: 0, y: 0 };
//   let pressTimer = null;
//   let downMeta = null;
//   let moved = false;

//   const clearPressTimer = () => { if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; } };

//   // Extrait {rowIndex, colKey, key} depuis l’event
//   const cellFromEvent = (evt) => {
//     const el = evt.target?.closest?.('.ag-cell');
//     if (!el) return null;
//     const colKey = el.getAttribute('col-id');
//     const rowEl = el.closest('.ag-row');
//     const riAttr = rowEl?.getAttribute('row-index');
//     const rowIndex = riAttr != null ? parseInt(riAttr, 10) : null;
//     if (rowIndex == null || !colKey) return null;
//     return { rowIndex, colKey, key: `${rowIndex}|${colKey}` };
//   };

//   const startEdit = ({ rowIndex, colKey }) => {
//     log('→ startEditingCell', rowIndex, colKey);
//     api.startEditingCell({ rowIndex, colKey });
//   };

//   const onPointerDown = (e) => {
//     if (!e.isPrimary || e.pointerType !== 'touch') return;
//     const cell = cellFromEvent(e);
//     if (!cell) return;

//     moved = false;
//     downMeta = { cell, x: e.clientX, y: e.clientY, t: performance.now() };
//     clearPressTimer();
//     pressTimer = setTimeout(() => { if (!moved) startEdit(cell); }, LONG_PRESS_MS);

//     log('pointerdown', downMeta);
//   };

//   const onPointerMove = (e) => {
//     if (!downMeta || !e.isPrimary || e.pointerType !== 'touch') return;
//     const dx = Math.abs(e.clientX - downMeta.x);
//     const dy = Math.abs(e.clientY - downMeta.y);
//     if (dx > DOUBLE_TAP_PX || dy > DOUBLE_TAP_PX) {
//       moved = true;
//       clearPressTimer();
//       log('move cancel (dx,dy)=', dx, dy);
//     }
//   };

//   const onPointerUp = (e) => {
//     if (!downMeta || !e.isPrimary || e.pointerType !== 'touch') { downMeta = null; clearPressTimer(); return; }

//     const cell = cellFromEvent(e);
//     clearPressTimer();

//     if (moved || !cell) { downMeta = null; log('pointerup ignored (moved or no cell)'); return; }

//     const now = performance.now();
//     const dt = now - (last.t || 0);
//     const dx = Math.abs(e.clientX - (last.x || 0));
//     const dy = Math.abs(e.clientY - (last.y || 0));
//     const sameCell = last.key === cell.key;

//     log('pointerup', { dt, dx, dy, sameCell });

//     if (sameCell && dt <= DOUBLE_TAP_MS && dx <= DOUBLE_TAP_PX && dy <= DOUBLE_TAP_PX) {
//       startEdit(cell);
//       last = { key: null, t: 0, x: 0, y: 0 };
//     } else {
//       last = { key: cell.key, t: now, x: e.clientX, y: e.clientY };
//       log('single tap memorized', last);
//     }

//     downMeta = null;
//   };

//   gridEl.addEventListener('pointerdown', onPointerDown, { passive: true });
//   gridEl.addEventListener('pointermove', onPointerMove, { passive: true });
//   gridEl.addEventListener('pointerup', onPointerUp, { passive: true });
//   gridEl.addEventListener('pointercancel', () => { clearPressTimer(); downMeta = null; }, { passive: true });

//   log('listeners attached on', gridEl);
// }
// export function enableTouchEdit(api, gridEl, opts = {}) {
//   if (!api || !gridEl) return;

//   // en haut de la fonction
//   const DEBUG = !!opts.debug;
//   const FORCE = !!opts.forceTouch;
//   const log = (...a) => { if (DEBUG) console.debug('[TouchEdit]', ...a); };

//   // ...puis remplace tous les tests "pointerType === 'touch'" par:
//   const isTouchPtr = (e) => FORCE || e.pointerType === 'touch';

//   // Détection tactile (tu peux forcer en debug)
//   const isTouchCapable = ('PointerEvent' in window) && ((navigator.maxTouchPoints || 0) > 0 || !!opts.forceTouch);
//   if (!isTouchCapable) { log('skip (no touch capability)'); return; }

//   const DOUBLE_TAP_MS = opts.doubleTapMs ?? 450;
//   const DOUBLE_TAP_PX = opts.doubleTapPx ?? 14;
//   const LONG_PRESS_MS = opts.longPressMs ?? 500;

//   let last = { key: null, t: 0, x: 0, y: 0 };
//   let pressTimer = null;
//   let downMeta = null;
//   let moved = false;

//   const clearPressTimer = () => { if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; } };

//   // Extrait {rowIndex, colKey, key} depuis l’event
//   const cellFromEvent = (evt) => {
//     const el = evt.target?.closest?.('.ag-cell');
//     if (!el) return null;
//     const colKey = el.getAttribute('col-id');
//     const rowEl = el.closest('.ag-row');
//     const riAttr = rowEl?.getAttribute('row-index');
//     const rowIndex = riAttr != null ? parseInt(riAttr, 10) : null;
//     if (rowIndex == null || !colKey) return null;
//     return { rowIndex, colKey, key: `${rowIndex}|${colKey}` };
//   };

//   const startEdit = ({ rowIndex, colKey }) => {
//     log('→ startEditingCell', rowIndex, colKey);
//     api.startEditingCell({ rowIndex, colKey });
//   };

//   const onPointerDown = (e) => {
//     if (!e.isPrimary || !isTouchPtr(e)) return;
//     const cell = cellFromEvent(e);
//     if (!cell) return;

//     moved = false;
//     downMeta = { cell, x: e.clientX, y: e.clientY, t: performance.now() };
//     clearPressTimer();
//     pressTimer = setTimeout(() => { if (!moved) startEdit(cell); }, LONG_PRESS_MS);

//     log('pointerdown', downMeta);
//   };

//   const onPointerMove = (e) => {
//     if (!downMeta || !e.isPrimary || e.pointerType !== 'touch') return;
//     const dx = Math.abs(e.clientX - downMeta.x);
//     const dy = Math.abs(e.clientY - downMeta.y);
//     if (dx > DOUBLE_TAP_PX || dy > DOUBLE_TAP_PX) {
//       moved = true;
//       clearPressTimer();
//       log('move cancel (dx,dy)=', dx, dy);
//     }
//   };

//   const onPointerUp = (e) => {
//     if (!downMeta || !e.isPrimary || e.pointerType !== 'touch') { downMeta = null; clearPressTimer(); return; }

//     const cell = cellFromEvent(e);
//     clearPressTimer();

//     if (moved || !cell) { downMeta = null; log('pointerup ignored (moved or no cell)'); return; }

//     const now = performance.now();
//     const dt = now - (last.t || 0);
//     const dx = Math.abs(e.clientX - (last.x || 0));
//     const dy = Math.abs(e.clientY - (last.y || 0));
//     const sameCell = last.key === cell.key;

//     log('pointerup', { dt, dx, dy, sameCell });

//     if (sameCell && dt <= DOUBLE_TAP_MS && dx <= DOUBLE_TAP_PX && dy <= DOUBLE_TAP_PX) {
//       startEdit(cell);
//       last = { key: null, t: 0, x: 0, y: 0 };
//     } else {
//       last = { key: cell.key, t: now, x: e.clientX, y: e.clientY };
//       log('single tap memorized', last);
//     }

//     downMeta = null;
//   };

//   // gridEl.addEventListener('pointerdown', onPointerDown, { passive: true });
//   // gridEl.addEventListener('pointermove', onPointerMove, { passive: true });
//   // gridEl.addEventListener('pointerup', onPointerUp, { passive: true });
//   // gridEl.addEventListener('pointercancel', () => { clearPressTimer(); downMeta = null; }, { passive: true });
//   // AVANT
//   gridEl.addEventListener('pointerdown', onPointerDown, { passive: true });
//   gridEl.addEventListener('pointermove', onPointerMove, { passive: true });
//   gridEl.addEventListener('pointerup', onPointerUp, { passive: true });
//   gridEl.addEventListener('pointercancel', () => { clearPressTimer(); downMeta = null; }, { passive: true });

//   // APRÈS (plus robuste)
//   gridEl.addEventListener('pointerdown', onPointerDown, { passive: true });
//   gridEl.addEventListener('pointermove', onPointerMove, { passive: true });

//   // capter la fin du geste même si on sort de la grille
//   window.addEventListener('pointerup', onPointerUp, { passive: true });
//   window.addEventListener('pointercancel', () => { clearPressTimer(); downMeta = null; }, { passive: true });
//   log('listeners attached on', gridEl);
// }
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
    { field:'Début', width, suppressSizeToFit:true,
      comparator:(a,b)=>{
        const ma=parseHHhMM(a)??Infinity, mb=parseHHhMM(b)??Infinity;
        return ma-mb;
      }
    },
    { field:'Activité', minWidth:200, flex:1, cellRenderer: ActiviteRenderer },
    { field:'Durée', width, suppressSizeToFit:true },
    { field:'Fin',   width, suppressSizeToFit:true },
    { field:'Lieu',  minWidth:160, flex:1 },
    { field:'Relâche', minWidth:60, flex:.5 },
    { field:'Réservé', minWidth:60, flex:.5 },
    { field:'Priorité',minWidth:60, flex:.5 },
    { field:'Hyperlien', minWidth:120, flex:2 }
  ];
}

const dateintStrToPretty = (d) => dateintToPretty(Number(d)); 

// Colonnes créneaux (grille C) 
function buildColumnsCreneaux(){
  let width = window.matchMedia("(max-width: 750px)").matches ? 60 : 90;
  return [
    { field:'Date', headerName:'Date', width, suppressSizeToFit:true,
      valueFormatter:p=>dateintStrToPretty(p.value),
      comparator:(a,b)=>(safeDateint(a)||0)-(safeDateint(b)||0)
    },
    { field:'Début', width, suppressSizeToFit:true,
      comparator:(a,b)=>{
        const ma=parseHHhMM(a)??Infinity, mb=parseHHhMM(b)??Infinity;
        return ma-mb;
      }
    },
    { field:'Fin', width, suppressSizeToFit:true,
      comparator:(a,b)=>{
        const ma=parseHHhMM(a)??Infinity, mb=parseHHhMM(b)??Infinity;
        return ma-mb;
      }
    },
    { field:'Activité avant', headerName:'Activité avant', minWidth:160, flex:1},
    { field:'Activité après', headerName:'Activité après', minWidth:160, flex:1},
  ];
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

    // onCellClicked: (p) => {
    //   // iOS/mobile : 2 taps rapides pour éditer
    //   maybeStartEditOnDoubleTap(p);
    // },
    onCellKeyDown: (p) => {
      // bonus: Enter déclenche l’édition (utile sur desktop)
      if (p.event?.key === 'Enter' && p.colDef?.editable) {
        p.api.startEditingCell({ rowIndex: p.rowIndex, colKey: p.colDef.field });
        p.event.preventDefault?.();
      }
    },
    suppressNoRowsOverlay: true,
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

async function refreshGrid(gridId){
  const g = grids.get(gridId);
  if (!g?.api) return;

  const rows = await (g.loader ? g.loader() : df_getAllOrdered());
  g.api.setGridOption('rowData', rows || []);

  const pane = g.el.closest('.st-expander-body');
  if (pane) {
    const cnt   = Array.isArray(rows) ? rows.length : 0;
    const hOpen = hFor(Math.min(cnt,5));
    const hMax  = hFor(cnt);
    pane.dataset.maxContentHeight = String(hMax);

    // pas d’anim lors d’un refresh automatique
    const cur = parseFloat(getComputedStyle(pane).height)||0;
    if (hOpen > cur) { disableTransition(pane); setH(pane, hOpen); enableTransition(pane); }

    try { g.api.onGridSizeChanged(); g.api.sizeColumnsToFit(); } catch {}
  }
}

async function refreshAllGrids() {
  const ids = Array.from(grids.keys());
  await Promise.all(ids.map(id => refreshGrid(id)));
}

// ===== Loaders pour chaque grille =====

// 1) Programmées : Date non nulle
async function loadProgrammees(){
  const all = await df_getAll();
  return (all||[])
    .filter(r => r.Date != null && r.Date !== '')
    .sort((a,b)=>{
      const da = Number(a.Date)||0, db = Number(b.Date)||0;
      if (da!==db) return da-db;
      const ma = parseHHhMM(a['Début'])??Infinity, mb = parseHHhMM(b['Début'])??Infinity;
      return ma-mb;
    });
}

// 2) Non programmées : Date vide/null
async function loadNonProgrammees(){
  const all = await df_getAll();
  return (all||[])
    .filter(r => r.Date == null || r.Date === '')
    .sort((a,b)=>{
      const ma = parseHHhMM(a['Début'])??Infinity, mb = parseHHhMM(b['Début'])??Infinity;
      return ma-mb;
    });
}

async function loadCreneaux() {
  const toutes = await df_getAll();                      
  const prog   = (await df_getAllOrdered()).filter(r => Number.isFinite(r.Date));
  // prog est supposé trié Date/Debut_dt; sinon trie-le !

  // période optionnelle (si tu l’as en state)
  const periode = { periodeDebut: 20251021, periodeFin: 20251024 }; // exemple

  return getCreneaux(toutes, prog, false, periode);
}

// 4) Activités programmables 
async function loadProgrammables(){
  if (!selectedSlot) return [];
  const all = await df_getAll();

  // Contraintes minimales (à affiner plus tard) :
  // - activité sans Date (non programmée)
  // - durée <= capacité du créneau
  // NB: on ignore les conflits salle/relâche/etc. pour l’instant.
  const cap = Number(selectedSlot?.Capacité) || (() => {
    const s = parseHHhMM(selectedSlot?.Début);
    const e = parseHHhMM(selectedSlot?.Fin);
    return (s!=null && e!=null && e>s) ? (e-s) : Infinity;
  })();

  return (all||[])
    .filter(r => r.Date == null || r.Date === '')
    .map(r => {
      const mins = parseDureeMin(r['Durée']) ?? Infinity;
      return { ...r, __fit: mins <= cap ? 1 : 0, __mins: mins };
    })
    .sort((a,b)=>{
      // Favoriser ceux qui rentrent dans le créneau
      if (a.__fit !== b.__fit) return b.__fit - a.__fit;
      // puis par priorité si tu veux (optionnel)
      const pa = Number(a['Priorité'])||0, pb = Number(b['Priorité'])||0;
      if (pa!==pb) return pb-pa;
      // puis par durée croissante
      return (a.__mins||Infinity) - (b.__mins||Infinity);
    });
}

// 5) Carnet d'adresses
async function loadCarnet() {
  const all = await carnet_getAll();
  return (all || [])
    .filter(r => r.Nom != null && r.Nom !== '')
    .sort((a, b) => {
      const na = (a.Nom || '').toString()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .toLowerCase().trim();
      const nb = (b.Nom || '').toString()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .toLowerCase().trim();
      return na.localeCompare(nb, 'fr', { sensitivity: 'base' });
    });
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

    // function begin(clientY, e) {
    //   dragging = true;
    //   startY = clientY;
    //   hTop = Math.round(paneTop.getBoundingClientRect().height);

    //   // bornes
    //   dyMin = -hTop;
    //   const maxH = Number(paneTop.dataset.maxContentHeight) || hTop;
    //   dyMax = Math.max(0, maxH - hTop);

    //   // ❌ coupe TOUTE transition/animation (INLINE + !important)
    //   prevTransition = paneTop.style.transition || '';
    //   prevAnimation  = paneTop.style.animation  || '';
    //   paneTop.style.setProperty('transition', 'none', 'important');
    //   paneTop.style.setProperty('animation',  'none', 'important');
    //   paneTop.style.willChange = 'height';

    //   setH(paneTop, hTop);
    //   document.body.style.userSelect = 'none';
    //   document.body.style.cursor = 'row-resize';
    //   e?.preventDefault?.();
    // }

    // function update(clientY, e) {
    //   if (!dragging) return;
    //   const dyRaw = clientY - startY;
    //   const dy = Math.max(dyMin, Math.min(dyMax, dyRaw));   // clamp
    //   setH(paneTop, hTop + dy);

    //   // notifie la grille du haut
    //   try {
    //     const gridDiv = paneTop.querySelector('div[id^="grid"]');
    //     for (const g of (window.grids?.values?.() || [])) {
    //       if (g.el === gridDiv) { g.api.onGridSizeChanged(); break; }
    //     }
    //   } catch {}
    //   // ❌ ne surtout pas faire e.preventDefault ici
    //   // iOS doit pouvoir générer le tap→click pour AG Grid
    //   // e?.preventDefault?.();
    // }

    // function finish() {
    //   if (!dragging) return;
    //   dragging = false;

    //   // restaure transition/animation (enlève l’inline qui forçait 'none')
    //   paneTop.style.removeProperty('transition');
    //   paneTop.style.removeProperty('animation');
    //   if (prevTransition) paneTop.style.transition = prevTransition;
    //   if (prevAnimation)  paneTop.style.animation  = prevAnimation;
    //   paneTop.style.willChange = '';

    //   // mémorise la hauteur atteinte
    //   const expTop = paneTop.closest('.st-expander');
    //   if (expTop) {
    //     const h = Math.round(paneTop.getBoundingClientRect().height);
    //     if (h > 0) localStorage.setItem(`paneHeight:${expTop.id}`, String(h));
    //   }

    //   document.body.style.userSelect = '';
    //   document.body.style.cursor = '';
    // }

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

    // function begin(clientY, e) {
    //   dragging = true;
    //   startY = clientY;

    //   // hauteur actuelle
    //   hTop = Math.round(paneTop.getBoundingClientRect().height);

    //   // ✅ bornes : 0 (peut tout cacher, header compris) … contenu (header + rowsWanted)
    //   minH = 0;
    //   maxH = computeContentHeight(paneTop);

    //   // coupe les transitions pendant le drag
    //   prevTransition = paneTop.style.transition || '';
    //   prevAnimation  = paneTop.style.animation  || '';
    //   paneTop.style.setProperty('transition', 'none', 'important');
    //   paneTop.style.setProperty('animation',  'none', 'important');
    //   paneTop.style.willChange = 'height';

    //   setH(paneTop, hTop);
    //   document.body.style.userSelect = 'none';
    //   document.body.style.cursor = 'row-resize';
    // }

    // function update(clientY, e) {
    //   if (!dragging) return;
    //   const dy = clientY - startY;
    //   const targetH = Math.max(minH, Math.min(hTop + dy, maxH)); // ✅ 0 … contenu
    //   setH(paneTop, targetH);

    //   // notifie la grille du haut
    //   try {
    //     const gridDiv = paneTop.querySelector('div[id^="grid"]');
    //     for (const g of (window.grids?.values?.() || [])) {
    //       if (g.el === gridDiv) { g.api.onGridSizeChanged(); break; }
    //     }
    //   } catch {}
    // }


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


    // // Souris
    // handle.addEventListener('mousedown', e => { if (e.button !== 0) return; begin(e.clientY, e); });
    // window.addEventListener('mousemove', e => update(e.clientY, e));
    // window.addEventListener('mouseup', finish);

    // // Tactile
    // handle.addEventListener('touchstart', e => begin(e.touches[0].clientY, e), { passive: true });
    // window.addEventListener('touchmove', e => { if (!dragging) return; update(e.touches[0].clientY, e); e.preventDefault(); }, { passive: false });
    // window.addEventListener('touchend', finish);
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

    // // Tactile
    // handle.addEventListener('touchstart', e => {
    //   // if (isFromGrid(e)) return;          // pas nécessaire ici, la cible = poignée
    //   begin(e.touches[0].clientY, e);
    // }, { passive: true });

    // window.addEventListener('touchmove', e => {
    //   if (!dragging) return;                 // 👈 clé: rien si pas en drag
    //   // if (isFromGrid(e)) return;          // utile si tu avais un listener global
    //   e.preventDefault();                    // 👈 seulement pendant le drag
    //   update(e.touches[0].clientY, e);
    // }, { passive: false });

    // window.addEventListener('touchend', finish);    
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
    gridId: 'grid-non-prog',
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
    columnsBuilder: buildColumnsActivites
  });

  // 5) Carnet d’adresses
  createGridController({
    gridId: 'grid-carnet',
    elementId: 'gridE',
    loader: loadCarnet,
    columnsBuilder: buildColumnsCarnet
  });

}

// function wireExpanders(){
//   document.querySelectorAll('.st-expander').forEach(exp=>{
//     const header = exp.querySelector('.st-expander-header');
//     if (!header) return;
//     header.addEventListener('click', ()=>{
//       if (exp.classList.contains('open')) closeExp(exp);
//       else openExp(exp);
//     });
//     // démarrage ouvert avec easing
//     openExp(exp);
//   });
// }
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

// ------- Misc Helpers -------

// util
const $ = id => document.getElementById(id);

// Helpers heure/durée
const parseHHhMM = (s) => {
  const m = /(\d{1,2})h(\d{2})/i.exec(String(s ?? ''));
  if (!m) return null;
  const hh = +m[1], mm = +m[2];
  if (Number.isNaN(hh) || Number.isNaN(mm) || hh>=24 || mm>=60) return null;
  return hh*60 + mm;
};
const parseDureeMin = (s) => parseHHhMM(s); // même format "1h20" -> minutes

// ===== Date helpers: Excel/pretty <-> dateint (yyyymmdd) =====
const TODAY = new Date();
const CUR_Y = TODAY.getFullYear();
const CUR_M = TODAY.getMonth() + 1;

// Excel (Windows) : 1899-12-30 base
function excelSerialToYMD(serial) {
  if (typeof serial !== 'number' || !isFinite(serial)) return null;
  const ms = (serial - 0) * 86400000; // jours -> ms
  const base = Date.UTC(1899, 11, 30); // 1899-12-30
  const d = new Date(base + ms);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
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
async function doImport() {
  // déclenche l’input caché
  const fi = $('fileInput');
  if (fi) fi.click();
}

// Export Excel
async function doExport() {
  try {
    const rows = await df_getAll();
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
  await df_putMany(sample);
  await refreshGrid();
}

// Test Python 
async function doPythonTest() {
  try {
    const t0 = performance.now();
    const pyodide = await getPyodideOnce();
    const t1 = performance.now();

    const code = `
      def pretty_duration(hhmm: str) -> str:
          try:
              hh, mm = hhmm.lower().split('h')
              return f"{int(hh):02d}:{int(mm):02d}"
          except Exception:
              return hhmm

      pretty_duration("1h20")
      `;
    const out = await pyodide.runPythonAsync(code);
    const t2 = performance.now();
    alert(`Pyodide OK : ${out}\nInit: ${(t1-t0).toFixed(1)} ms, Exec: ${(t2-t1).toFixed(1)} ms`);
  } catch (e) {
    console.error(e);
    alert('Pyodide KO');
  }
}

// Init Pyodide (singleton)
let pyodideReady = null;
async function getPyodideOnce() {
  if (!pyodideReady) {
    pyodideReady = (async () => {
      const pyodide = await loadPyodide(); // script déjà inclus dans index.html
      return pyodide;
    })();
  }
  return pyodideReady;
}

// ------- Bottom Bar -------
function wireBottomBar() {
  const bar = document.getElementById('bottomBar');
  const scroller = document.getElementById('bottomBarScroller');
  if (!bar || !scroller) return;

  // Click actions
  scroller.addEventListener('click', (e) => {
    const btn = e.target.closest('.bb-btn');
    if (!btn) return;
    const act = btn.dataset.action;

    // optional visual toggle
    scroller.querySelectorAll('.bb-btn').forEach(b => b.classList.remove('is-active'));
    btn.classList.add('is-active');
    setTimeout(() => btn.classList.remove('is-active'), 200);

    // Route actions (adapt to your handlers)
    switch (act) {
      case 'import':      doImport(); break;
      case 'export':      doExport(); break;
      case 'reload':      doReload(); break;
      case 'undo':        /* your undo() */        console.log('undo'); break;
      case 'redo':        /* your redo() */        console.log('redo'); break;
      case 'add':         doAdd(); break;
      case 'python test': doPythonTest(); break;
    }
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
      let rows = XLSX.utils.sheet_to_json(ws, { defval: null, raw: true });

      // 2) Carte d’en-têtes (détection robuste de "Activité" et "Hyperlien")
      const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
      const norm = (s) => (s ?? '')
        .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
        .trim().toLowerCase();

      // headers: map nomNormalisé -> index de colonne (c)
      const headers = {};
      for (let c = range.s.c; c <= range.e.c; c++) {
        const addr = XLSX.utils.encode_cell({ r: range.s.r, c });
        const cell = ws[addr];
        const txt  = (cell && String(cell.v)) || '';
        const key  = norm(txt);
        if (key) headers[key] = c;
      }

      const colActivite = headers['activite'] ?? headers['activité']; // tolère les deux
      const colHyperlienHeader = headers['hyperlien']; // si une colonne existe déjà

      // 3) Si on a une colonne Activité, on va lire les hyperliens des cellules (A2..An selon la colonne)
      if (typeof colActivite === 'number') {
        for (let i = 0; i < rows.length; i++) {
          const r = i + 1; // +1 car row 0 = ligne 2 en Excel (entête sur r0)
          const addr = XLSX.utils.encode_cell({ r: range.s.r + 1 + i, c: colActivite });
          const cell = ws[addr];
          const link = cell?.l?.Target || cell?.l?.target || null;

          // S’il y a déjà une colonne "Hyperlien" dans Excel, on la garde prioritaire,
          // sinon on remplit depuis le lien de la cellule Activité.
          if (!rows[i].Hyperlien && link) {
            rows[i].Hyperlien = link;
          }
        }
      }

      // 4) normalisation colonnes + __uuid + Date->dateint 
      rows = rows.map((r, i) => {
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

        // --- Début en minutes pour tri ---
        // const m = /(\d{1,2})h(\d{2})/i.exec(String(o['Début'] ?? o['Debut'] ?? ''));
        // const mins = m ? (parseInt(m[1],10)||0)*60 + (parseInt(m[2],10)||0) : 0;

        // __uuid garanti
        if (!o.__uuid) {
          o.__uuid = (crypto.randomUUID?.()) || `${Date.now()}_${i}`;
        }
        return o;
      });
      
      await df_clear();
      await df_putMany(rows);

      console.log('✅ Import OK', rows.length, 'lignes');
    
      // 5) Carnet d’adresses (optionnel, 2e onglet)
      const ca  = wb.Sheets[wb.SheetNames[1]]; // 2e onglet = Carnet
      if (ca) {
        let caRows = XLSX.utils.sheet_to_json(ca, { defval: null, raw: true });
        caRows = normalizeImportedRows(caRows);

        caRows = caRows.map((r, i) => {
          const o = { ...r };
          // __uuid garanti
          if (!o.__uuid) {
            o.__uuid = (crypto.randomUUID?.()) || `${Date.now()}_${i}`;
          }
          return o;
        });

        await carnet_clear();
        await carnet_putMany(caRows);
        console.log('✅ Import Carnet OK', caRows.length, 'lignes');
      }

      await refreshAllGrids();

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

// ---------- iOS fix: lock scroll horizontal sur la bottom bar ----------
// function lockHorizontalScroll() {
//   const scroller = document.querySelector('.bottom-bar__scroller');
//   if (!scroller) return;

//   let startX = 0, startY = 0, startLeft = 0, lock = null;

//   scroller.addEventListener('touchstart', (e) => {
//     const t = e.touches[0];
//     startX = t.clientX;
//     startY = t.clientY;
//     startLeft = scroller.scrollLeft;
//     lock = null; // indéterminé au départ
//   }, { passive: true });

//   scroller.addEventListener('touchmove', (e) => {
//     const t = e.touches[0];
//     const dx = t.clientX - startX;
//     const dy = t.clientY - startY;

//     if (lock === null) lock = (Math.abs(dx) > Math.abs(dy)) ? 'x' : 'y';

//     if (lock === 'x') {
//       scroller.scrollLeft = startLeft - dx;
//       e.preventDefault(); // bloque le scroll vertical de la page
//     }
//   }, { passive: false });
// }
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

function computeSafeGap(){
  if (isSplitterDragging) return;
  const vv = window.visualViewport;
  if (!vv) {
    setSafeGap(0);
    return;
  }
  // Espace “perdu” en bas : innerHeight - (viewport visible + offsetTop)
  const gap = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
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

// ------- Boot -------
document.addEventListener('DOMContentLoaded', () => {
  wireGrids();
  wireExpanders();
  wireExpanderSplitters();
  wireBottomBar();
});
