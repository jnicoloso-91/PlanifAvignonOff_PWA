// app.js (module)
import { df_getAll, df_getAllOrdered, df_putMany, df_clear, carnet_getAll, carnet_clear, carnet_putMany } from './db.mjs';


// ===== Multi-grilles =====
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

// Retourne l'handle grid (map "grids") à partir d'un panneau .st-expander-body
// function findGridHandleInPane(pane) {
//   if (!window.grids) return null;
//   const gridDiv = pane?.querySelector?.('div[id^="grid"]');
//   if (!gridDiv) return null;
//   for (const g of grids.values()) if (g.el === gridDiv) return g;
//   return null;
// }

// Mesure header/row/rowCount
// function measureGridMetrics(pane) {
//   const gridRoot = pane.querySelector('.ag-root, .ag-theme-quartz, div[id^="grid"]');
//   const header = gridRoot?.querySelector('.ag-header, .ag-header-viewport');
//   const firstRow = gridRoot?.querySelector('.ag-center-cols-container .ag-row, .ag-center-cols-viewport .ag-row');

//   const headerH = header ? Math.round(header.getBoundingClientRect().height) : 32;
//   const rowH = firstRow ? Math.round(firstRow.getBoundingClientRect().height)
//                         : (parseInt(getComputedStyle(gridRoot).getPropertyValue('--ag-row-height')) || 32);

//   let rowCount = 0;
//   const handle = findGridHandleInPane(pane);
//   try { rowCount = handle?.api?.getDisplayedRowCount?.() ?? 0; } catch {}
//   return { headerH, rowH, rowCount };
// }

// Hauteur utile pour n lignes
// function usefulHeightFor(pane, n) {
//   const { headerH, rowH } = measureGridMetrics(pane);
//   const chrome = 4; // petit jeu anti-scrollbar
//   return Math.max(0, headerH + rowH * Math.max(0, n) + chrome);
// }

// Auto-tailler : si rows<=5 -> pile rows ; sinon -> 5 lignes
// function autoSizePaneToRows(pane) {
//   const { rowCount } = measureGridMetrics(pane);
//   const targetRows = Math.min(rowCount, 5);
//   const h = usefulHeightFor(pane, targetRows);
//   pane.style.height = `${h}px`;
//   // Stocke la butée max (= taille tout le contenu)
//   const hMax = usefulHeightFor(pane, rowCount);
//   pane.dataset.maxContentHeight = String(hMax);
// }

// Mesure la hauteur "utile" pour N lignes (header + N * rowHeight + marge scroll)
// function computeGridUsefulHeight(pane, maxRows = Infinity) {
//   const gridDiv = pane?.querySelector?.('.ag-root, .ag-theme-quartz, div[id^="grid"]');
//   if (!gridDiv) return null;

//   const header = gridDiv.querySelector('.ag-header') || gridDiv.querySelector('.ag-header-viewport');
//   const firstRow = gridDiv.querySelector('.ag-center-cols-container .ag-row, .ag-center-cols-viewport .ag-row');

//   const headerH = header ? Math.round(header.getBoundingClientRect().height) : 32;
//   const rowH    = firstRow ? Math.round(firstRow.getBoundingClientRect().height) : 32;

//   // nombre de lignes actuellement affichées (après filtre/sort)
//   let rowCount = 0;
//   const handle = findGridHandleInPane(pane);
//   try {
//     rowCount = handle?.api?.getDisplayedRowCount?.() ?? 0;
//   } catch {}

//   const n = Math.min(rowCount, maxRows);
//   const chrome = 4; // petite marge anti-scrollbar
//   return headerH + rowH * n + chrome; // px
// }

// // Trouve l'handle de grille (depuis la Map grids) pour un pane .st-expander-body
// function findGridHandleInPane(pane) {
//   if (!window.grids) return null;
//   const gridDiv = pane?.querySelector?.('div[id^="grid"]');
//   if (!gridDiv) return null;
//   for (const g of grids.values()) if (g.el === gridDiv) return g;
//   return null;
// }

// // Mesures robustes (header/row/rowCount)
// function measureGridMetrics(pane) {
//   const gridRoot = pane.querySelector('.ag-root') || pane.querySelector('.ag-theme-quartz') || pane.querySelector('div[id^="grid"]');
//   const header = gridRoot?.querySelector('.ag-header, .ag-header-viewport');
//   const anyRow = gridRoot?.querySelector('.ag-center-cols-container .ag-row, .ag-center-cols-viewport .ag-row');

//   const headerH = header ? Math.round(header.getBoundingClientRect().height) : 32;
//   // tente CSS var ag sinon fallback 32
//   const cssRowH = parseInt(getComputedStyle(gridRoot).getPropertyValue('--ag-row-height')) || 0;
//   const rowH = anyRow ? Math.round(anyRow.getBoundingClientRect().height) : (cssRowH || 32);

//   let rowCount = 0;
//   try { rowCount = findGridHandleInPane(pane)?.api?.getDisplayedRowCount?.() ?? 0; } catch {}
//   return { headerH, rowH, rowCount };
// }

// function usefulHeightFor(pane, rows) {
//   const { headerH, rowH } = measureGridMetrics(pane);
//   const chrome = 4;
//   return Math.max(0, headerH + rowH * Math.max(0, rows) + chrome);
// }

// // planifie après rendu : 2 rAF + microtask pour laisser AG Grid peindre
// function afterGridPaint(pane, fn) {
//   requestAnimationFrame(() => requestAnimationFrame(() => queueMicrotask(fn)));
// }

// // Auto-ajuste : ≤5 lignes → pile ; sinon → 5 lignes. Stocke la butée max (contenu total).
// function autoSizePaneToRows(pane) {
//   const { rowCount } = measureGridMetrics(pane);
//   const targetRows = Math.min(rowCount, 5);
//   const h = usefulHeightFor(pane, targetRows);
//   pane.style.height = `${h}px`;

//   // hauteur max = tout le contenu (pour le clamp du splitter)
//   const maxH = usefulHeightFor(pane, rowCount);
//   pane.dataset.maxContentHeight = String(maxH);
// }

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

function usefulHeightFor(pane, rows) {
  const { headerH, rowH } = measureGridMetrics(pane);
  const chrome = 4;
  return Math.max(0, headerH + rowH * Math.max(0, rows) + chrome);
}

// function afterGridPaint(pane, fn) {
//   // laisse AG Grid peindre : 2 rAF + microtask
//   requestAnimationFrame(() => requestAnimationFrame(() => queueMicrotask(fn)));
// }

// function autoSizePaneToRows(pane) {
//   const { rowCount } = measureGridMetrics(pane);
//   const targetRows = Math.min(rowCount, 5);
//   const h = usefulHeightFor(pane, targetRows);
//   pane.style.height = `${h}px`;
//   const maxH = usefulHeightFor(pane, rowCount);
//   pane.dataset.maxContentHeight = String(maxH || h);
// }

// Hauteurs de référence (AG Grid Quartz ~ 28–32). Ajuste si besoin.
// const AG_ROW_H      = 32;  // hauteur d’une ligne
// const AG_HEADER_H   = 32;  // hauteur d’entête
// const AG_CHROME_PAD = 4;   // petite marge anti-scrollbar

// function heightForRows(rowCount) {
//   const n = Math.max(0, rowCount);
//   return AG_HEADER_H + AG_ROW_H * n + AG_CHROME_PAD; // px
// }

// /**
//  * Autosize déterministe : si rows<=5 -> pile ; sinon -> 5 lignes.
//  * Stocke aussi la butée max (= toute la hauteur contenu = header + N * rowH).
//  */
// function autosizePaneFromRowCount(pane, rowCount) {
//   const targetRows = Math.min(rowCount, 5);
//   const hTarget = heightForRows(targetRows);
//   const hMax    = heightForRows(rowCount);

//   pane.style.height = `${hTarget}px`;
//   pane.dataset.maxContentHeight = String(hMax);
// }

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

const ROW_H=32, HEADER_H=32, PAD=4;
const hFor = n => HEADER_H + ROW_H * Math.max(0,n) + PAD;

function paneOf(exp){ return exp.querySelector('.st-expander-body'); }

// function gridHandleOfPane(pane){
//   if (!window.grids) return null;
//   const gridDiv = pane?.querySelector?.('div[id^="grid"]');
//   for (const g of grids?.values?.() || []) if (g.el === gridDiv) return g;
//   return null;
// }

// clé de stockage par expander
// function paneKey(exp){ return `paneHeight:${exp.id || 'unknown'}`; }

// lit le nb de lignes affichées (fallback: 0)
// function displayedRows(pane){
//   try { return gridHandleOfPane(pane)?.api?.getDisplayedRowCount?.() ?? 0; }
//   catch { return 0; }
// }

// function savePaneHeight(exp){
//   const pane = paneOf(exp);
//   if (!pane) return;
//   const h = Math.round(pane.getBoundingClientRect().height);
//   if (h > 0) localStorage.setItem(paneKey(exp), String(h));
// }

// function restorePaneHeight(exp){
//   const pane = paneOf(exp);
//   if (!pane) return;

//   // hauteur sauvegardée (ignore 0/NaN)
//   let saved = Number(localStorage.getItem(paneKey(exp)));
//   if (!Number.isFinite(saved) || saved <= 1) saved = null;

//   // butée max (contenu courant)
//   const cnt = displayedRows(pane);
//   const hMax = Math.max(Number(pane.dataset.maxContentHeight) || 0, hFor(cnt));

//   // fallback si pas de saved : auto ≤ 5 lignes
//   const autoH = hFor(Math.min(cnt, 5));

//   // target = min(saved || auto, hMax)
//   const target = Math.min(saved ?? autoH, hMax);

//   // pose la hauteur (et neutralise tout plafond éventuel)
//   pane.style.setProperty('max-height', 'none', 'important');
//   pane.style.setProperty('min-height', '0px', 'important');
//   // pane.style.setProperty('height', `${Math.max(0, Math.round(target))}px`, 'important');
//   setPaneHeightSmooth(pane, Math.max(0, Math.round(target)), true);

//   // notifier ag-Grid
//   try {
//     const g = gridHandleOfPane(pane);
//     g?.api?.onGridSizeChanged?.();
//     g?.api?.sizeColumnsToFit?.();
//   } catch {}
// }

// function setPaneHeightSmooth(pane, px, animate=true) {
//   if (!pane) return;
//   if (!animate) {
//     // coupe temporairement la transition pour éviter flash à l'import
//     pane.style.transition = 'none';
//     pane.style.setProperty('height', `${px}px`, 'important');
//     pane.offsetHeight; // force reflow
//     pane.style.transition = ''; // restore
//   } else {
//     pane.style.setProperty('height', `${px}px`, 'important');
//   }
// }

// const paneOf = exp => exp.querySelector('.st-expander-body');

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

// Colonnes créneaux (grille C) 
function buildColumnsCreneaux(){
  let width = window.matchMedia("(max-width: 750px)").matches ? 60 : 90;
  return [
    { field:'Date', headerName:'Date', width, suppressSizeToFit:true,
      valueFormatter:p=>dateintToPretty(p.value),
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
    onGridReady: async () => {
      await refreshGrid(gridId);
      safeSizeToFitFor(gridId);
    },
    // // onFirstDataRendered: () => safeSizeToFitFor(gridId),
    // onFirstDataRendered: (p) => {
    //   const pane = p.api?.getGridBodyElement?.()?.closest('.st-expander-body') || p.api?.gridBodyCtrl?.eGridBody?.closest?.('.st-expander-body');
    //   if (pane) afterGridPaint(pane, () => autoSizePaneToRows(pane));
    // },
    // // onModelUpdated: () => safeSizeToFitFor(gridId),
    // onModelUpdated: (p) => {
    //   const pane = grids.get(gridId)?.el?.closest('.st-expander-body');
    //   if (pane) afterGridPaint(pane, () => autoSizePaneToRows(pane));
    // },

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
    rowSelection: 'single'
  };

  const api = window.agGrid.createGrid(el, gridOptions);
  const handle = { id: gridId, el, api, loader, columnsBuilder };
  grids.set(gridId, handle);
  if (!activeGridId) setActiveGrid(gridId);
  return handle;
}

function setActiveGrid(gridId){
  activeGridId = gridId;
  grids.forEach(g => g?.el?.classList.toggle('is-active-grid', g.id === gridId));
}

// async function refreshGrid(gridId){
//   const g = grids.get(gridId);
//   if (!g?.api) return;
//   const rows = await (g.loader ? g.loader() : df_getAllOrdered());
//   g.api.setGridOption('rowData', rows || []);
//   safeSizeToFitFor(gridId);
// }

// const ROW_H=32, HEADER_H=32, PAD=4;
// const hFor = n => HEADER_H + ROW_H * Math.max(0,n) + PAD;

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

// 3) Créneaux disponibles 
async function loadCreneaux(){
  // Placeholder : laisse vide. Exemple de format si tu veux tester :
  // return [
  //   { __uuid:'slot-1', Date:20250722, Début:'14h00', Fin:'16h00', Capacité:120 },
  //   { __uuid:'slot-2', Date:20250722, Début:'18h00', Fin:'19h30', Capacité:90  },
  // ];
  return [];
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

// function wireExpanderSplitters() {
//   document.querySelectorAll('.v-splitter').forEach(sp => {
//     const handle = sp.querySelector('.v-splitter__handle');
//     if (!handle) return;

//     const topId = sp.getAttribute('data-top');
//     const bottomId = sp.getAttribute('data-bottom');

//     // 👉 On redimensionne les PANNEAUX (st-expander-body), pas les div#gridX
//     const paneTop = document.querySelector(`#${topId} .st-expander-body`);
//     const paneBot = document.querySelector(`#${bottomId} .st-expander-body`);
//     if (!paneTop || !paneBot) return;

//     // helper pour min-height en px (sinon 140)
//     const getMinH = (el, fallback = 140) => {
//       const v = parseFloat(getComputedStyle(el).minHeight);
//       return Number.isFinite(v) && v > 0 ? v : fallback;
//     };

//     // petit helper pour ne recalculer que la/les grilles concernées
//     const bumpGridsIn = (pane) => {
//       // essaie de trouver un conteneur grid à l'intérieur
//       const gridDiv = pane.querySelector('div[id^="grid"]');
//       if (!gridDiv) return;
//       // si tu as la map `grids` (id -> { el, api }), utilise-la
//       if (typeof grids !== 'undefined' && grids instanceof Map) {
//         for (const g of grids.values()) {
//           if (g.el === gridDiv) {
//             try { g.api?.onGridSizeChanged?.(); g.api?.sizeColumnsToFit?.(); } catch {}
//             return;
//           }
//         }
//       }
//       // fallback: recalcule toutes (moins optimal mais sûr)
//       try { grids?.forEach(g => { g.api?.onGridSizeChanged?.(); g.api?.sizeColumnsToFit?.(); }); } catch {}
//     };

//     let dragging = false;
//     let startY = 0, hTop = 0, minTop = 0, dyMin = 0; // pas de dyMax ici (pas de borne sup)

//     const begin = (clientY, e) => {
//       dragging = true;
//       isSplitterDragging = true;

//       // Figer la hauteur actuelle en px (si c'était en vh/%)
//       hTop   = Math.round(paneTop.getBoundingClientRect().height);
//       paneTop.style.height = `${hTop}px`;
//       paneTop.style.willChange = 'height';

//       // la hauteur du bas RESTE telle quelle (on ne la touche pas)
//       minTop = getMinH(paneTop);
//       // borne basse du delta : hTop + dy >= minTop -> dy >= (minTop - hTop)
//       dyMin  = minTop - hTop;

//       startY = clientY;

//       // iOS : on bloque le scroll de page pendant le drag
//       document.body.style.userSelect = 'none';
//       document.body.style.cursor = 'row-resize';
//       e?.preventDefault?.();
//     };

//     const update = (clientY, e) => {
//       if (!dragging) return;

//       const dyRaw = clientY - startY;
//       // clamp du delta seulement sur la borne basse (min haut)
//       const dy = Math.max(dyMin, dyRaw);

//       // on change UNIQUEMENT la hauteur du panneau du haut
//       paneTop.style.height = `${hTop + dy}px`;

//       // recalcule la/les grilles affectées
//       bumpGridsIn(paneTop);

//       // iOS : empêcher le scroll de page pendant le drag
//       e?.preventDefault?.();
//     };

//     const finish = () => {
//       dragging = false;
//       isSplitterDragging = false;
//       document.body.style.userSelect = '';
//       document.body.style.cursor = '';
//       paneTop.style.willChange = '';
//       try { handle.releasePointerCapture?.(); } catch {}
//     };

//     // Pointer Events (unifiés, iOS ok)
//     if (window.PointerEvent) {
//       handle.addEventListener('pointerdown', (e) => {
//         if (e.pointerType === 'mouse' && e.button !== 0) return;
//         try { handle.setPointerCapture(e.pointerId); } catch {}
//         begin(e.clientY, e);
//       });
//       handle.addEventListener('pointermove',  (e) => update(e.clientY, e));
//       handle.addEventListener('pointerup',     finish);
//       handle.addEventListener('pointercancel', finish);
//       handle.addEventListener('lostpointercapture', finish);
//     } else {
//       // Fallback touch
//       handle.addEventListener('touchstart', e => begin(e.touches[0].clientY, e), { passive: true });
//       handle.addEventListener('touchmove',  e => { update(e.touches[0].clientY, e); }, { passive: false });
//       handle.addEventListener('touchend',   finish);
//       // Fallback souris
//       handle.addEventListener('mousedown', (e) => {
//         if (e.button !== 0) return;
//         begin(e.clientY, e);
//         const onMove = ev => update(ev.clientY, ev);
//         const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp, true); finish(); };
//         window.addEventListener('mousemove', onMove);
//         window.addEventListener('mouseup', onUp, true);
//         e.preventDefault();
//       });
//     }
//   });
// }


// function wireExpanderSplitters() {
//   document.querySelectorAll('.v-splitter').forEach(sp => {
//     const handle = sp.querySelector('.v-splitter__handle');
//     if (!handle) return;

//     const topId = sp.getAttribute('data-top');
//     const bottomId = sp.getAttribute('data-bottom');
//     const paneTop = document.querySelector(`#${topId} .st-expander-body`);
//     const paneBot = document.querySelector(`#${bottomId} .st-expander-body`);
//     if (!paneTop || !paneBot) return;

//     let dragging=false, startY=0, hTop=0, dyMin=0, dyMax=Infinity;

//     const begin = (clientY, e) => {
//       dragging = true;
//       hTop = Math.round(paneTop.getBoundingClientRect().height);

//       // fige la hauteur courante (et empêche la page de scroller pendant le drag)
//       paneTop.style.setProperty('height', `${hTop}px`, 'important');
//       paneTop.style.willChange = 'height';
//       document.body.style.userSelect = 'none';
//       document.body.style.cursor = 'row-resize';

//       // min : on peut réduire jusqu’à 0
//       dyMin = -hTop;

//       // max : contenu total (posé par refreshGrid/onModelUpdated)
//       let maxH = Number(paneTop.dataset.maxContentHeight) || hTop;
//       // Si aucune butée n’est posée (cas extrême), garde au moins hTop
//       if (!Number.isFinite(maxH) || maxH <= 0) maxH = hTop;

//       dyMax = Math.max(0, maxH - hTop);

//       startY = clientY;
//       e?.preventDefault?.();
//     };

//     const update = (clientY, e) => {
//       if (!dragging) return;
//       const dyRaw = clientY - startY;
//       const dy = Math.max(dyMin, Math.min(dyMax, dyRaw));
//       paneTop.style.setProperty('height', `${hTop + dy}px`, 'important');
//       try { findGridHandleInPane(paneTop)?.api?.onGridSizeChanged?.(); } catch {}
//       e?.preventDefault?.();
//     };

//     const finish = () => {
//       dragging = false;
//       document.body.style.userSelect = '';
//       document.body.style.cursor = '';
//       paneTop.style.willChange = '';
//       try { handle.releasePointerCapture?.(); } catch {}
//       const expTop = paneTop.closest('.st-expander');
//       if (expTop) savePaneHeight(expTop);
//       // setPaneHeightSmooth(paneTop, hTop + dy, true);
//     };
    
//     if (window.PointerEvent) {
//       handle.addEventListener('pointerdown', (e) => { if (e.pointerType==='mouse' && e.button!==0) return; try{handle.setPointerCapture(e.pointerId);}catch{} begin(e.clientY, e); });
//       handle.addEventListener('pointermove',  (e) => update(e.clientY, e));
//       handle.addEventListener('pointerup',     finish);
//       handle.addEventListener('pointercancel', finish);
//       handle.addEventListener('lostpointercapture', finish);
//     } else {
//       handle.addEventListener('touchstart', e => begin(e.touches[0].clientY, e), { passive: true });
//       handle.addEventListener('touchmove',  e => { update(e.touches[0].clientY, e); }, { passive: false });
//       handle.addEventListener('touchend',   finish);
//       handle.addEventListener('mousedown', (e) => {
//         if (e.button !== 0) return;
//         begin(e.clientY, e);
//         const onMove = ev => update(ev.clientY, ev);
//         const onUp   = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp, true); finish(); };
//         window.addEventListener('mousemove', onMove);
//         window.addEventListener('mouseup', onUp, true);
//         e.preventDefault();
//       });
//     }
//   });
// }

// function wireExpanderSplitters() {
//   const splitters = document.querySelectorAll('.expander-splitter');
//   if (!splitters.length) return;

//   let dragging = false;
//   let startY = 0;
//   let hTop = 0;
//   let dyMin = 0;
//   let dyMax = 0;
//   let paneTop = null;

//   function begin(clientY, e) {
//     // panneau du dessus
//     const sp = e?.currentTarget || e?.target;
//     const expTop = sp?.previousElementSibling?.closest('.st-expander');
//     if (!expTop) return;

//     paneTop = expTop.querySelector('.st-expander-body');
//     if (!paneTop) return;

//     // mesures initiales
//     hTop = Math.round(paneTop.getBoundingClientRect().height);
//     startY = clientY;

//     // bornes
//     dyMin = -hTop; // peut se réduire jusqu’à 0
//     const maxH = Number(paneTop.dataset.maxContentHeight) || hTop;
//     dyMax = Math.max(0, maxH - hTop); // butée haute

//     // préparation
//     disableTransition(paneTop);                     // ❌ aucune anim pendant drag
//     paneTop.style.willChange = 'height';
//     document.body.style.userSelect = 'none';
//     document.body.style.cursor = 'row-resize';
//     dragging = true;

//     e?.preventDefault?.();
//   }

//   function update(clientY, e) {
//     if (!dragging || !paneTop) return;

//     // déplacement brut
//     const dyRaw = clientY - startY;

//     // clampé entre min et max
//     const dy = Math.max(dyMin, Math.min(dyMax, dyRaw));

//     // applique la nouvelle hauteur
//     setH(paneTop, hTop + dy);

//     // met à jour la grille
//     try {
//       const g = findGridHandleInPane(paneTop);
//       g?.api?.onGridSizeChanged?.();
//     } catch {}

//     e?.preventDefault?.();
//   }

//   function finish() {
//     if (!dragging) return;
//     dragging = false;

//     // hauteur finale réelle
//     const finalH = Math.round(paneTop.getBoundingClientRect().height);

//     // réactive les transitions pour les prochaines ouvertures/fermetures
//     enableTransition(paneTop);
//     setH(paneTop, finalH);

//     // sauvegarde la hauteur dans localStorage
//     const expTop = paneTop.closest('.st-expander');
//     if (expTop) savePaneHeight(expTop);

//     // nettoyage
//     document.body.style.userSelect = '';
//     document.body.style.cursor = '';
//     paneTop.style.willChange = '';
//     paneTop = null;
//   }

//   // 🔗 branchements
//   splitters.forEach(sp => {
//     // souris
//     sp.addEventListener('mousedown', e => begin(e.clientY, e));
//     window.addEventListener('mousemove', e => update(e.clientY, e));
//     window.addEventListener('mouseup', finish);

//     // tactile
//     sp.addEventListener('touchstart', e => begin(e.touches[0].clientY, e), { passive: true });
//     window.addEventListener('touchmove', e => {
//       if (!dragging) return;
//       update(e.touches[0].clientY, e);
//       e.preventDefault();
//     }, { passive: false });
//     window.addEventListener('touchend', finish);
//   });
// }

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
      dragging = true;
      startY = clientY;
      hTop = Math.round(paneTop.getBoundingClientRect().height);

      // bornes
      dyMin = -hTop;
      const maxH = Number(paneTop.dataset.maxContentHeight) || hTop;
      dyMax = Math.max(0, maxH - hTop);

      // ❌ coupe TOUTE transition/animation (INLINE + !important)
      prevTransition = paneTop.style.transition || '';
      prevAnimation  = paneTop.style.animation  || '';
      paneTop.style.setProperty('transition', 'none', 'important');
      paneTop.style.setProperty('animation',  'none', 'important');
      paneTop.style.willChange = 'height';

      setH(paneTop, hTop);
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'row-resize';
      e?.preventDefault?.();
    }

    function update(clientY, e) {
      if (!dragging) return;
      const dyRaw = clientY - startY;
      const dy = Math.max(dyMin, Math.min(dyMax, dyRaw));   // clamp
      setH(paneTop, hTop + dy);

      // notifie la grille du haut
      try {
        const gridDiv = paneTop.querySelector('div[id^="grid"]');
        for (const g of (window.grids?.values?.() || [])) {
          if (g.el === gridDiv) { g.api.onGridSizeChanged(); break; }
        }
      } catch {}
      e?.preventDefault?.();
    }

    function finish() {
      if (!dragging) return;
      dragging = false;

      // restaure transition/animation (enlève l’inline qui forçait 'none')
      paneTop.style.removeProperty('transition');
      paneTop.style.removeProperty('animation');
      if (prevTransition) paneTop.style.transition = prevTransition;
      if (prevAnimation)  paneTop.style.animation  = prevAnimation;
      paneTop.style.willChange = '';

      // mémorise la hauteur atteinte
      const expTop = paneTop.closest('.st-expander');
      if (expTop) {
        const h = Math.round(paneTop.getBoundingClientRect().height);
        if (h > 0) localStorage.setItem(`paneHeight:${expTop.id}`, String(h));
      }

      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    }

    // Souris
    handle.addEventListener('mousedown', e => { if (e.button !== 0) return; begin(e.clientY, e); });
    window.addEventListener('mousemove', e => update(e.clientY, e));
    window.addEventListener('mouseup', finish);

    // Tactile
    handle.addEventListener('touchstart', e => begin(e.touches[0].clientY, e), { passive: true });
    window.addEventListener('touchmove', e => { if (!dragging) return; update(e.touches[0].clientY, e); e.preventDefault(); }, { passive: false });
    window.addEventListener('touchend', finish);
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

// function wireExpanders() {
//   document.querySelectorAll('.st-expander').forEach(exp => {
//     const header = exp.querySelector('.st-expander-header');
//     if (!header) return;

//     header.addEventListener('click', () => {
//       const open = exp.classList.toggle('open');
//       header.setAttribute('aria-expanded', String(open));

//       // recalculer la taille des grilles si on ouvre
//       if (open) {
//         const gridDiv = exp.querySelector('div[id^="grid"]');
//         if (gridDiv) {
//           try {
//             const id = Array.from(grids.keys()).find(k =>
//               grids.get(k)?.el === gridDiv
//             );
//             if (id) {
//               grids.get(id)?.api?.onGridSizeChanged?.();
//               grids.get(id)?.api?.sizeColumnsToFit?.();
//             }
//           } catch {}
//         }
//       }
//     });
//   });
// }

// function wireExpanders() {
//   document.querySelectorAll('.st-expander').forEach(exp => {
//     const header = exp.querySelector('.st-expander-header');
//     const pane   = exp.querySelector('.st-expander-body');
//     if (!header || !pane) return;

//     const open = () => {
//       exp.classList.add('open');
//       header.setAttribute('aria-expanded', 'true');
//       // on ne fait plus l’autosize ici : refreshGrid l’a déjà fait (depuis les données)
//     };
//     const close = () => {
//       exp.classList.remove('open');
//       header.setAttribute('aria-expanded', 'false');
//       // pane.style.height = '';
//       pane.style.removeProperty('height');   // autorise fermeture réelle
//       savePaneHeight(exp);
//     };

//     header.addEventListener('click', () => exp.classList.contains('open') ? close() : open());
//     open(); // démarrage ouvert
//   });
// }

// function wireExpanders(){
//   document.querySelectorAll('.st-expander').forEach(exp => {
//     const header = exp.querySelector('.st-expander-header');
//     const pane   = paneOf(exp);
//     if (!header || !pane) return;

//     const openExp = () => {
//       exp.classList.add('open');
//       header.setAttribute('aria-expanded', 'true');
//       // restaurer la dernière hauteur (ou auto si pas de sauvegarde)
//       restorePaneHeight(exp);
//     };

//     const closeExp = () => {
//       // sauvegarder AVANT de fermer
//       savePaneHeight(exp);
//       exp.classList.remove('open');
//       header.setAttribute('aria-expanded', 'false');
//       // laisser le CSS fermer (max-height:0 sur l’état fermé)
//       pane.style.removeProperty('height');
//     };

//     header.addEventListener('click', () => {
//       if (exp.classList.contains('open')) closeExp(); else openExp();
//     });

//     // démarrage ouvert → restaure
//     openExp();
//   });
// }

function wireExpanders(){
  document.querySelectorAll('.st-expander').forEach(exp=>{
    const header = exp.querySelector('.st-expander-header');
    if (!header) return;
    header.addEventListener('click', ()=>{
      if (exp.classList.contains('open')) closeExp(exp);
      else openExp(exp);
    });
    // démarrage ouvert avec easing
    openExp(exp);
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

function safeSizeToFitFor(id){
  const g = grids.get(id);
  if (!g?.api) return;
  setTimeout(()=>{ try{ g.api.sizeColumnsToFit(); }catch{} },0);
}

// Padding 2 chiffres pour jour/mois "1" -> "01"
const pad2 = n => String(n).padStart(2, '0');

// ===== Date helpers: Excel/pretty <-> dateint (yyyymmdd) =====
const TODAY = new Date();
const CUR_Y = TODAY.getFullYear();
const CUR_M = TODAY.getMonth() + 1;

function hmToMinutes(hm) {
  if (!hm) return -1;
  const m = String(hm).match(/(\d{1,2})h(\d{2})/i);
  if (!m) return -1;
  return parseInt(m[1],10)*60 + parseInt(m[2],10);
}

// Excel (Windows) : 1899-12-30 base
function excelSerialToYMD(serial) {
  if (typeof serial !== 'number' || !isFinite(serial)) return null;
  const ms = (serial - 0) * 86400000; // jours -> ms
  const base = Date.UTC(1899, 11, 30); // 1899-12-30
  const d = new Date(base + ms);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
}

// "dd/mm" | "dd/mm/yy" | "dd/mm/yyyy"
function parseSmartDateToYMD(s, defY = CUR_Y, defM = CUR_M) {
  if (s == null) return null;
  const t = String(s).trim();
  if (!t) return null;

  // Excel serial ?
  if (!Number.isNaN(+t) && t.trim() !== '') {
    const n = Number(t);
    if (Number.isFinite(n) && n > 59) { // évite les petites valeurs ambiguës
      const ymd = excelSerialToYMD(n);
      if (ymd) return ymd;
    }
  }

  const m = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/.exec(t);
  if (!m) return null;
  let d = +m[1], mm = +m[2];
  let y = m[3] ? +m[3] : defY;
  if (m[3] && m[3].length === 2) y = 2000 + y;
  if (!(y>=1900 && mm>=1 && mm<=12 && d>=1 && d<=31)) return null;

  // contrôle validité réelle (ex: 31/11 KO)
  const dt = new Date(Date.UTC(y, mm-1, d));
  if (dt.getUTCFullYear() !== y || (dt.getUTCMonth()+1) !== mm || dt.getUTCDate() !== d) return null;

  return { y, m: mm, d };
}

function ymdToDateint({ y, m, d }) { return y*10000 + m*100 + d; }
function safeDateint(v) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 10000101 ? n : null;
}

// Parse “pretty” utilisateur vers dateint (dd[/mm][/yy])
function prettyToDateint(value) {
  if (!value) return null;

  // si c’est déjà un entier (ou convertible)
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && /^\d{8}$/.test(value)) return parseInt(value, 10);

  let s = String(value).trim();
  if (!s) return null;

  const today = new Date();
  const curY = today.getFullYear();
  const curM = today.getMonth() + 1;

  //  "jj", "jj/mm", "jj/mm/aa" ou "jj/mm/yyyy" -> int yyyymmdd
  const parts = s.split(/[\/\-\.]/).map(p => p.trim());
  let d = 1, m = curM, y = curY;

  if (parts.length === 1) {
    // "jj"
    d = parseInt(parts[0], 10);
  } else if (parts.length === 2) {
    // "jj/mm"
    d = parseInt(parts[0], 10);
    m = parseInt(parts[1], 10);
  } else if (parts.length >= 3) {
    // "jj/mm/aa" ou "jj/mm/yyyy"
    d = parseInt(parts[0], 10);
    m = parseInt(parts[1], 10);
    y = parseInt(parts[2], 10);
    if (y < 100) y += 2000; // normalise 25 -> 2025
  }

  if (isNaN(d) || isNaN(m) || isNaN(y)) return null;

  return y * 10000 + m * 100 + d;
}

// Affichage “pretty" d’un dateint:
// - même année => "dd/mm"
// - sinon => "dd/mm/yy"
function dateintToPretty(di) {
  if (di == null) return '';

  // Si déjà une string, on ne touche pas
  if (typeof di === 'string') return di;

  // Si c'est un petit nombre (ex: "21")
  if (di < 1000) {
    return String(di).padStart(2, '0');
  }

  // Si c’est un format complet yyyymmdd
  if (di >= 10000000) {
    const y = Math.floor(di / 10000);
    const m = Math.floor((di % 10000) / 100);
    const d = di % 100;

    const today = new Date();
    const curY = today.getFullYear();
    const curM = today.getMonth() + 1;

    // Cas 1 : même année et même mois → jj (sur 2 digits)
    // if (y === curY && m === curM) {
    //   return `${String(d).padStart(2, '0')}`;
    // }

    // Cas 2 : même année, mois différent → jj/mm (2 digits)
    if (y === curY) {
      return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}`;
    }

    // Cas 3 : année différente → jj/mm/aa (2 digits partout)
    return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${String(y).slice(-2).padStart(2, '0')}`;
  }

  return '';
}

function todayInt(){
  const d = new Date();
  return d.getFullYear()*10000 + (d.getMonth()+1)*100 + d.getDate();
}

// function safeSizeToFit() {
//   if (!gridApi) return;
//   setTimeout(() => {
//     try { gridApi.sizeColumnsToFit(); } catch {}
//   }, 0);
// }

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

// ------- Grille -------
// async function refreshGrid() {
//   const rows = await df_getAllOrdered();             // <- pas d’argument
//   if (!gridApi) return;
//   gridApi.setGridOption('rowData', rows || []);
//   safeSizeToFit();
// }

// function createOrAttachGrid() {
//   const eGrid = document.getElementById('grid');
//   if (!eGrid) return;

//   if (!gridOptions) {
//     gridOptions = {
//       columnDefs: buildColumns(),
//       defaultColDef: { editable: true, resizable: true, sortable: true, filter: true },
//       rowData: [],
//       getRowId: p => p.data?.__uuid,          // clé stable
//       onGridReady: async () => {
//         await refreshGrid();
//         safeSizeToFit();
//         setTimeout(hardPinBottom, 100)
//       },
//       getRowStyle: p => {
//         const c = colorForDate(p.data?.Date);
//         return c ? { '--day-bg': c } : null;     // on pousse la couleur en variable CSS
//       },
//     };
//   }
//   if (!gridApi) {
//     // v31+
//     gridApi = window.agGrid.createGrid(eGrid, gridOptions);
//   }
// }

// ------- Renderers -------
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


// ------- Expander (details/summary) -------
// function wireCustomExpander() {
//   const exp = document.getElementById("gridExpander");
//   const header = exp?.querySelector(".st-expander-header");
//   const body   = exp?.querySelector(".st-expander-body");
//   if (!exp || !header || !body) return;

//   // Chevron: optionnel, juste pour l’animation
//   // const chevron = header.querySelector(".chevron");

//   const toggle = () => {
//     const open = exp.classList.toggle("open");
//     header.setAttribute("aria-expanded", String(open));
//     if (open) {
//       // première ouverture -> instancie la grille si besoin
//       if (!window.gridApi) {
//         createOrAttachGrid();
//       }
//       // ajuste la taille des colonnes
//       safeSizeToFit();
//     }
//   };

//   header.addEventListener("click", toggle);
//   // (facultatif) prise en charge tactile
//   header.addEventListener("touchstart", (e) => { e.preventDefault(); toggle(); }, {passive:false});

//   // Poignée de redimensionnement
//   const handle = exp.querySelector(".expander-resizer");
//   if (handle) {
//     let startY, startH, dragging = false;
//     const gridEl = document.getElementById("grid");

//   // Souris
//   handle.addEventListener("mousedown", e => {
//     dragging = true;
//     startY = e.clientY;
//     startH = gridEl.offsetHeight;
//     document.body.style.userSelect = "none";
//   });
//   window.addEventListener("mousemove", e => {
//     if (!dragging) return;
//     const newH = Math.min(900, Math.max(240, startH + (e.clientY - startY)));
//     gridEl.style.height = `${newH}px`;
//     try { window.gridApi?.onGridSizeChanged?.(); } catch(_) {}
//     try { window.gridApi?.sizeColumnsToFit?.(); } catch(_) {}
//   });
//   window.addEventListener("mouseup", () => {
//     dragging = false;
//     document.body.style.userSelect = "";
//   });

//   // Tactile (iOS/Android)
//   handle.addEventListener("touchstart", e => {
//     const t = e.touches[0];
//     dragging = true;
//     startY = t.clientY;
//     startH = gridEl.offsetHeight;
//     document.body.style.userSelect = "none";
//   }, { passive: true });

//   window.addEventListener("touchmove", e => {
//     if (!dragging) return;
//     const t = e.touches[0];
//     const newH = Math.min(900, Math.max(240, startH + (t.clientY - startY)));
//     gridEl.style.height = `${newH}px`;
//     try { window.gridApi?.onGridSizeChanged?.(); } catch(_) {}
//     try { window.gridApi?.sizeColumnsToFit?.(); } catch(_) {}
//   }, { passive: true });

//   window.addEventListener("touchend", () => {
//     dragging = false;
//     document.body.style.userSelect = "";
//   });
// }

//   // Ouvre par défaut au démarrage
//   exp.classList.add("open");
//   createOrAttachGrid();
//   safeSizeToFit();
// }

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
