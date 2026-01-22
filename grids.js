// ===============================
// Utilitaires AG Grid
// ===============================

import { 
  waitAF,
  estNumerique,
  capitalizeFirst,
  richValueGetValue,
  afterFrames,
} from './utils.js';

import { 
  parseHHhMM, 
  prettyToDateint, 
  dateintToPretty, 
  safeDateint, 
  recalcFin,
} from './utils-date.js';

import { 
  log,
} from './debug.js';

import {
  ctx,
  activitesAPI,
} from './app.js'; 

import { 
  openExpanderAsync,
  scrollExpanderIntoViewCenteredAsync,
  openExpander,
} from './expanders.js'; 

import {
  rerenderProgrammeCalendar,
  isProgrammeCalendarVisible,
  saveProgrammeGridHeight,
} from './calendar.js';

import { sortDf } from './activites.js'; 

import { ActiviteRenderer } from './ActiviteRenderer.js';
import { HyperlienRenderer } from './HyperlienRenderer.js';
import { HyperlienBRRenderer } from './HyperlienBRRenderer.js';
import { AvisRenderer } from './AvisRenderer.js';
import { LieuRenderer } from './LieuRenderer.js';
import { infosPlusPopoverCellRenderer } from './infos-plus.js';

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


// ------- Multi-grilles -------
export const grids = new Map();           // id -> { api, el, loader }
window.grids = grids;
export let activeGridId = null;

// ------- Créneau sélectionné -------
let selectedSlot = null;

// ------- Helpers -------
const dateintStrToPretty = (d) => dateintToPretty(Number(d)); 
const $ = id => document.getElementById(id);

const ROW_H=32, HEADER_H=32, PAD=4;                            // valeurs en pixels
const hFor = n => HEADER_H + ROW_H * Math.max(0,n) + PAD;      // calcule hauteur totale de grid pour n lignes

function colorDate(dateInt) {
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

function wireSingleScrollerHeaderSync(gridId) {
  const h = grids.get(gridId);
  if (!h) return;
  const gridEl = h.el;
  const bodyVp   = gridEl.querySelector(".ag-body-viewport");
  const headerVp = gridEl.querySelector(".ag-header-viewport");
  if (!bodyVp || !headerVp) return;

  // évite double binding
  if (bodyVp.__bbHeaderSync) return;
  bodyVp.__bbHeaderSync = true;

  bodyVp.addEventListener("scroll", () => {
    // sync du header sur le scrollLeft du body
    headerVp.scrollLeft = bodyVp.scrollLeft;
  }, { passive: true });
}

function isFromGrid(e){ 
  return !!e.target?.closest('.ag-root'); 
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

function savePaneHeight(exp){
  const h = Math.round(paneOf(exp).getBoundingClientRect().height);
  if (h>0) localStorage.setItem(`paneHeight:${exp.id}`, String(h));
}

function displayedRows(pane){
  try {
    const gridDiv = pane.querySelector('div[id^="grid"]');
    for (const g of grids.values()) if (g.el === gridDiv) return g.api.getDisplayedRowCount() || 0;
  } catch {}
  return 0;
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

// Rend active une grille donnée
export function setActiveGridId(gridId){
  activeGridId = gridId;
  grids.forEach(g => g?.el?.classList.toggle('is-active-grid', g.id === gridId));
}

// Rend active une grille donnée
export function getActiveGridId(){
  return activeGridId;
}

// récupère la row sélectionnée (ou la focussée) dans une ag-Grid
export function getSelectedRowSafe(api) {
  if (!api) return null;
  const sel = api.getSelectedRows?.() || [];
  if (sel.length) return sel[0];
  const fc = api.getFocusedCell?.();
  const r = fc ? api.getDisplayedRowAtIndex?.(fc.rowIndex) : null;
  return r?.data || null;
}

// Renvoie la row de la ligne séléectionnée dans une grille donnée par son gridId
export function getSelectedRow(gridId) {
  const h = grids.get(gridId);
  if (!h) return null;
  const sel = h.api.getSelectedRows?.() || [];
  return sel?.[0];
}

// Renvoie l'uuid de la ligne séléectionnée dans une grille donnée par son gridId
export function getSelectedRowUuid(gridId) {
  return getSelectedRow(gridId)?.__uuid || null;
}

// Renvoie les rows d'une grille à partir de son gridId
export function getRowsFromGridId(gridId) {
  const h = grids.get(gridId);             // handle de la grille
  if (!h || !h.api) return [];         // sécurité si non initialisée
  const rows = [];
  h.api.forEachNode(node => {
    if (node?.data) rows.push(node.data);
  });
  return rows;
}

// Récupère l'API d'une grille par son id (selon ta structure window.grids)
export function getGridApiById(gridId) {
  return window.grids?.get(gridId)?.api || null;
}

// util AG Grid (inchangé)
export function collectGridApis(gridsLike) {
  if (!gridsLike) return [];
  if (Array.isArray(gridsLike)) return gridsLike.map(h => h?.api).filter(a => a?.onGridSizeChanged);
  if (typeof gridsLike?.forEach === 'function') { const out=[]; gridsLike.forEach(v=>out.push(v?.api||v)); return out.filter(a=>a?.onGridSizeChanged); }
  if (gridsLike?.api?.onGridSizeChanged) return [gridsLike.api];
  if (typeof gridsLike === 'object') return Object.values(gridsLike).map(h=>h?.api).filter(a=>a?.onGridSizeChanged);
  return [];
}

// Vérifie un nom est un nom de colonne 
function hasColId(gridApi, colId) {
  return !!gridApi
    .getColumnDefs()
    ?.some(col => col.colId === colId || col.field === colId);
}

/**
 * Trie une grille sur une colonne
 * @param {*} gridId 
 * @param {*} colId 
 * @param {*} sort
 * @returns 
 */
export function setSortModel(gridId, colId, sort) {
  const handle = window.grids?.get(gridId);
  if (!handle) return;
  const api = handle.api;
  if (!api) return;

  try {
    if (hasColId(api, colId)) {
      api.applyColumnState({
        state: [
          { colId: "Activite", sort: "asc" }
        ],
        defaultState: { sort: null } // enlève les autres tris
      });
    }
  } catch (e) {
    console.error(e);
  }
}

/**
 * Sélectionne par __uuid et rend visible
 * @param {*} gridId 
 * @param {*} uuid 
 * @param {*} param2 
 * @returns 
 */
export function selectRowByUuid(gridId, uuid, { align='middle', flash=true } = {}) {
  const h = grids.get(gridId);
  if (!h || !uuid) return false;
  const api = h.api;
  const gridEl = h.el;
  let /** @type {any} */ node = null;

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
export async function getRowNodeAndElByUuid(gridId, uuid, { ensureVisible = true, paints = 2, debug = false } = {}) {
  
  // CSS.escape polyfill safe
  const cssEscape = (window.CSS && CSS.escape) ? CSS.escape : (s) => String(s).replace(/["\\#:.%]/g, '\\$&');

  const h = grids.get(gridId);
  if (!h || !uuid) return { api: null, node: null, rowEl: null, el: h?.el || null }; //, nbRowsPred: null };

  const api = h.api;
  let /** @type {any} */ node = null;
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

// Renvoie la ligne voisine (suivante ou précédente) d'une row donnée par son uuid.
export function getLigneVoisine(rows, uuid) {
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
export function getLigneVoisineUuid(rows, uuid) {
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
  let hyperlinkBRCol = null;
  let avisCol = null;

  // a) Construire toutes les colonnes sauf "Hyperlien" "HyperlienGoogle" "HyperlienBR" 
  for (const field of knownFields) {
    if (field === 'Hyperlien') continue;  // on la traitera ensuite
    if (field === 'HyperlienGoogle') continue;  // on la traitera ensuite
    if (field === 'HyperlienBR') continue;  // on la traitera ensuite

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

  // b) Ajouter les colonnes "Hyperlien" "HyperlienGoogle" et "HyperlienBR" en dernier 
  if (knownFields.has('Hyperlien') || knownFields.has('HyperlienGoogle') || knownFields.has('HyperlienBR')) {
    const base = baseMap.get('Hyperlien');
    hyperlinkCol = base || {
      field: 'Hyperlien',
      headerName: 'Page Web',
      minWidth: 100,
      flex: 1,
      sortable: true,
      filter: true,
    };
    newColDefs.push(hyperlinkCol);

    const baseAvis = baseMap.get('HyperlienGoogle');
    avisCol = baseAvis || {
      field: 'HyperlienGoogle',
      headerName: 'Google',
      minWidth: 100,
      flex: 1,
      sortable: true,
      filter: true,
    };
    newColDefs.push(avisCol);

    const baseBR = baseMap.get('HyperlienBR');
    hyperlinkBRCol = baseBR || {
      field: 'HyperlienBR',
      headerName: 'Billet Réduc',
      minWidth: 100,
      flex: 1,
      sortable: true,
      filter: true,
    };
    newColDefs.push(hyperlinkBRCol);
  }

  // 6) Appliquer proprement aux options du grid
  // (AG Grid v29+ ; évite setColumnDefs déprécié)
  api.setGridOption('columnDefs', newColDefs);
  api.onColumnEverythingChanged?.();
  ensureWheelScrollOnGrid(handle);
  requestAnimationFrame(() => { restoreGridStateFromMeta(gridId); });  
}

// Met à jour la definition des colonnes sur les grilles qui affichent des activités
export function rebuildColumnsForActiviteGrids(dfRows) {
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
    { field:'__desc_summary', headerName: '', width:30, minWidth:30, filter: false, sortable: false ,  editable: false, cellClass: "col-padding-tight", cellRenderer: infosPlusPopoverCellRenderer },
    { field:'Style', headerName: 'Style', minWidth:150, flex:0.6 },
    { field:'Mood', headerName: 'Ton', minWidth:150, flex:0.6 },
    { field:'Note', headerName: 'Note', width, minWidth:width },
    { field:'Duree', headerName: 'Durée', width, suppressSizeToFit:true, valueParser: valueParserDuree },
    { field:'Fin', headerName: 'Fin', width, suppressSizeToFit:true, editable: false, valueParser: valueParserHeure },
    { field:'Lieu', headerName: 'Lieu', minWidth:160, flex:1, cellRenderer: LieuRenderer },
    { field:'Session', headerName: 'Séances', width:widthSR, minWidth:widthSR, valueParser: valueParserSession, onCellValueChanged: updSeances },
    { field:'Relache', headerName: 'Relâches', width:widthSR, minWidth:widthSR, valueParser: valueParserRelache, onCellValueChanged: updSeances },
    { field:'Orga', headerName: 'Orga', width, minWidth:width },
    { field:'Reserve', headerName: 'Réservé', width, minWidth:width, valueParser: valueParserReserve },
    { field:'Priorite', headerName: 'Priorité', width, minWidth:width, valueParser: valueParserNumerique },
    { field:'Hyperlien', headerName: 'Page Web', minWidth:120, flex:1, cellRenderer: HyperlienRenderer },
    { field:'HyperlienGoogle', headerName: 'Google', minWidth:120, flex:1, cellRenderer: AvisRenderer },
    { field:'HyperlienBR', headerName: 'Billet Réduc', minWidth:120, flex:1, cellRenderer: HyperlienBRRenderer },
  ];
}

function buildColumnsActivitesProgrammees() {
  /** @type {Array<Record<string, any>>} */
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
    onCellValueChanged: updFin,
  };

  cols[iDuree] = {
    ...cols[iDuree] ,
    editable: (p) => !activitesAPI.estActiviteReservee(p.data),
    onCellValueChanged: updFin,
  };

  cols[iReserve] = {
    ...cols[iReserve] ,
    onCellValueChanged: (p) => {
      onCellValueChangedCommon(p);
      const btn = document.getElementById('btn-deprogrammer');
      (/** @type {HTMLButtonElement} */ (btn)).disabled = activitesAPI.estActiviteReservee(p.data);
    },
  };

  return cols
}

function buildColumnsActivitesNonProgrammees() {
  /** @type {Array<Record<string, any>>} */
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
    onCellValueChanged: updFin,
  };

  cols[iDuree] = {
    ...cols[iDuree] ,
    onCellValueChanged: updFin,
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
  if (!activitesAPI.estDureeValide(richValueGetValue(params.newValue))) {
    alert("⛔ Format attendu : HhMM (ex : 1h00 ou 0h30)");
    return params.oldValue;
  }
  else return params.newValue;
}
function valueParserSession (params) {
  if (!activitesAPI.estSessionValide(params.newValue)) {
    alert(`⛔ Format attendu = suite d'expressions suivantes, séparées par des virgules :
  - "9", "09" 
  - "9/7", "09/07" 
  - "09/07/25" ou "09/07/2025"
  - "(9, 16, 23)/7" pour énumérer des dates du même mois
  - "[9-12]/07", "[30/07-01/08]" pour une période
  - "[9-12]/07 lu ma", "[30/07-01/08] lu ma" pour des jours de la semaine sur une période 
  - "jours pairs" | "jours impairs"
  - chaîne vide => tous les jours de la période de programmation
Mois et année par défaut = mois et année du début de la période de programmation.
    `);
    return params.oldValue;
  }
  else return params.newValue;
}
function valueParserRelache (params) {
  if (!activitesAPI.estRelacheValide(params.newValue)) {
    alert(`⛔ Format attendu = suite d'expressions suivantes, séparées par des virgules :
  - "9", "09" 
  - "9/7", "09/07" 
  - "09/07/25" ou "09/07/2025"
  - "(9, 16, 23)/7" pour énumérer des dates du même mois
  - "[9-12]/07", "[30/07-01/08]" pour une période
  - "[9-12]/07 lu ma", "[30/07-01/08] lu ma" pour des jours de la semaine sur une période 
  - "jours pairs" | "jours impairs"
  - chaîne vide => pas de jours de relâche
Mois et année par défaut = mois et année du début de la période de programmation.
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

// Fait un sizeColumnsToFit sur une grille
function safeSizeToFitFor(id){
  const g = grids.get(id);
  if (!g?.api) return;
  setTimeout(()=>{ try{ g.api.sizeColumnsToFit(); }catch{} },0);
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

// Scroll X mobile avec inertie (fling) - ne pas simplifier et revenir au scroll natif
function wireAgTouchScrollRouter(gridId) {
  const h = grids.get(gridId);
  if (!h) return;

  const gridEl = h.el;
  const bodyVp = gridEl.querySelector(".ag-body-viewport");
  const xVp    = gridEl.querySelector(".ag-body-horizontal-scroll-viewport");
  if (!bodyVp || !xVp) return;

  if (gridEl.__bbTouchRouter) return;
  gridEl.__bbTouchRouter = true;

  let sx=0, sy=0, lastX=0, engaged=false, horiz=false;

  const DEADZONE = 10;     // px
  const RATIO = 1.15;      // plus petit = plus facile de prendre X

  // ── inertie (fling)
  let flingRaf = 0;
  let vx = 0;                 // px/ms (vitesse du doigt)
  const samples = [];         // {t, x}
  const MAX_SAMPLES = 6;

  const MAX_V = 2.2;          // px/ms
  const BASE_FRICTION = 0.0038;
  const EDGE_ZONE = 80;
  const EDGE_BOOST = 0.010;

  function stopFling() {
    if (flingRaf) cancelAnimationFrame(flingRaf);
    flingRaf = 0;
    vx = 0;
    samples.length = 0;
  }

  function pushSample(t, x) {
    samples.push({ t, x });
    while (samples.length > MAX_SAMPLES) samples.shift();
  }

  function computeVelocity() {
    if (samples.length < 2) return 0;
    const last = samples[samples.length - 1];

    let i = samples.length - 2;
    while (i > 0 && (last.t - samples[i].t) < 40) i--;
    const a = samples[i];

    const dt = last.t - a.t;
    if (dt <= 0) return 0;

    const dx = last.x - a.x;
    return dx / dt; // dx>0 = doigt vers la droite
  }

  function startFling() {
    vx = Math.max(-MAX_V, Math.min(MAX_V, vx));
    if (Math.abs(vx) < 0.05) return;

    let prevT = performance.now();

    const step = (now) => {
      const dt = now - prevT;
      prevT = now;

      const maxScroll = Math.max(0, xVp.scrollWidth - xVp.clientWidth);
      const cur = xVp.scrollLeft;

      // vx > 0 => doigt à droite => scrollLeft veut diminuer (vers 0)
      // vx < 0 => doigt à gauche  => scrollLeft veut augmenter (vers max)
      const distToEdge = (vx > 0) ? cur : (maxScroll - cur);
      const edgeFactor = Math.max(0, Math.min(1, (EDGE_ZONE - distToEdge) / EDGE_ZONE));
      const friction = BASE_FRICTION + EDGE_BOOST * edgeFactor * edgeFactor;

      const dx = vx * dt;
      let next = cur - dx;

      if (next < 0) next = 0;
      if (next > maxScroll) next = maxScroll;

      xVp.scrollLeft = next;

      const decay = Math.exp(-friction * dt);
      vx *= decay;

      const atLeft  = next <= 0.5;
      const atRight = next >= (maxScroll - 0.5);

      if (Math.abs(vx) < 0.02 || (vx > 0 && atLeft) || (vx < 0 && atRight)) {
        stopFling();
        return;
      }

      flingRaf = requestAnimationFrame(step);
    };

    flingRaf = requestAnimationFrame(step);
  }

  bodyVp.addEventListener("touchstart", (e) => {
    if (!e.touches || e.touches.length !== 1) return;
    stopFling();

    const t = e.touches[0];
    sx = lastX = t.clientX;
    sy = t.clientY;
    engaged = false;
    horiz = false;

    const now = performance.now();
    pushSample(now, lastX);
  }, { passive: true });

  bodyVp.addEventListener("touchmove", (e) => {
    if (!e.touches || e.touches.length !== 1) return;
    const t = e.touches[0];

    const dx0 = t.clientX - sx;
    const dy0 = t.clientY - sy;

    if (!engaged) {
      if (Math.abs(dx0) < DEADZONE && Math.abs(dy0) < DEADZONE) return;
      engaged = true;
      horiz = Math.abs(dx0) > Math.abs(dy0) * RATIO;
      if (!horiz) return; // vertical => on laisse le Y natif (bodyVp)
    }

    if (horiz) {
      const now = performance.now();
      const dx = t.clientX - lastX;
      lastX = t.clientX;

      const prev = xVp.scrollLeft;
      const maxScroll = Math.max(0, xVp.scrollWidth - xVp.clientWidth);
      const next = Math.max(0, Math.min(maxScroll, prev - dx));

      if (next === prev) return; // butée

      e.preventDefault();
      e.stopPropagation();

      xVp.scrollLeft = next;

      pushSample(now, t.clientX);
    }
  }, { passive: false });

  function endGesture() {
    if (!horiz) {
      stopFling();
      return;
    }

    vx = computeVelocity();

    // si fling impossible (butée), ne pas lancer
    const maxScroll = Math.max(0, xVp.scrollWidth - xVp.clientWidth);
    const cur = xVp.scrollLeft;
    const blocked =
      (vx > 0 && cur <= 0.5) ||
      (vx < 0 && cur >= maxScroll - 0.5);

    if (blocked) {
      stopFling();
      return;
    }

    startFling();
  }

  bodyVp.addEventListener("touchend", endGesture, { passive: true });
  bodyVp.addEventListener("touchcancel", endGesture, { passive: true });
}

// Reajuste la taille du expander-body en fonction du nbre de lignes jusqu'à 5 lignes max
// Appelé par onModelUpdated et onFirstDataRendered
function autosizeFromGridSafe(handle, pane) {
  if (!handle?.api || !pane) return;

  const cnt = handle.api.getDisplayedRowCount?.();
  // ⚠️ Ignore les états transitoires
  if (cnt == null || cnt <= 0) return;

  const rowH = handle.api.getSizesForCurrentTheme?.().rowHeight || 32;
  const headerH = handle.api.getHeaderHeight?.() || 32;
  const chrome = 4;

  const targetRows = Math.min(cnt, 5);
  const hTarget    = headerH + rowH * targetRows + chrome;
  const hMaxCur    = headerH + rowH * cnt      + chrome;
  const hMaxPred   = Number(pane.dataset.maxContentHeight) || 0;

  // 👉 Ne JAMAIS réduire automatiquement : on n’augmente que si nécessaire
  const cur = parseFloat(getComputedStyle(pane).height) || 0;
  if (hTarget > hMaxPred && hTarget > cur) {
    pane.style.setProperty('height', `${hTarget}px`, 'important');
    const exp = pane.closest('.st-expander');
    if (exp?.id) localStorage.setItem(`paneHeight:${exp.id}`, String(hTarget)); // sauvegarde pour openExp()
  }

  pane.dataset.maxContentHeight = String(hMaxCur);
  try { handle.api.onGridSizeChanged(); handle.api.sizeColumnsToFit(); } catch {}

  // S'il s'agit de grid-programmees et que l'on est en mode calendar,
  // on enregistre la hauteur calculée de la grille 
  const gridId = handle.api.getGridOption('context')?.gridId;
  if (gridId === 'grid-programmees' && isProgrammeCalendarVisible()) {
    saveProgrammeGridHeight(hTarget);
    return;
  };
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

  // nb de lignes à prendre en compte pour le calcul
  let n = Math.min(maxRows, nbRows);
  if (nbRows > maxRows) { // dans ce cas on interdit seulement de dépasser le nombre de lignes du tableau à afficher
    if (displayed >= nbRows) { 
      n = nbRows;         // interdiction de dépasser le nombre de lignes du tableau à afficher
    } else if (nbRows <= nbRowsPred) {
      return null;        // pas de resize auto
    }
  } 

  // padding interne du pane si il y en a (à ajuster si nécessaire)
  const paddingPane = (nbRows > n) ? 8 : 8;

  const desired = Math.round(hHeader + (rowH * n) + paddingPane);
  return Math.max(desired, hHeader + 8);
}

// Retaille le expander-bodyen fonction du row count
// Appelé en fin de refreshGrid
function autoSizePanelFromRowCount(pane, gridEl, api, gridId, { nbRows=null, nbRowsPred=null, maxRows = 5 } = {}) {
  if (!pane || !gridEl) return;

  // S'il s'agit de grid-programmees et que l'on est en mode calendar pas de resize auto
  if (gridId === 'grid-programmees' && isProgrammeCalendarVisible()) return;

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
      requestAnimationFrame(() => wireAgTouchScrollRouter(gridId));
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
    onCellFocused: () => setActiveGridId(gridId),
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

    onColumnMoved: (p) => saveGridStateToMeta(p, gridId),
    onColumnPinned: (p) => saveGridStateToMeta(p, gridId),
    onColumnVisible: (p) => saveGridStateToMeta(p, gridId),
    onSortChanged: (p) => {
      saveGridStateToMeta(p, gridId); 
      ensureRowVisibleAndGetEl(gridId, getSelectedRowUuid(gridId));
    },
  
    // floatingFilter: true,
    // suppressMenuHide: false,
    // suppressColumnVirtualisation: false,

    // enableBrowserTooltips: true,
    // suppressTouch: false,
  }
};

function updateGridCounters(api, badgeEl) {
  if (!api || !badgeEl) return;

  const displayed = api.getDisplayedRowCount
    ? api.getDisplayedRowCount()
    : api.getModel().getRowCount();

  const total = api.getModel()?.rootNode?.allLeafChildren?.length ?? displayed;
  badgeEl.textContent = `${displayed} / ${total}`;
}

const gridOptionsActivitesProgrammees = {
  rowSelection: 'single',
  onSelectionChanged(params) {
    const sel = params.api.getSelectedRows();
    const btn = document.getElementById('btn-deprogrammer');
    (/** @type {HTMLButtonElement} */ (btn)).disabled = (sel.length > 0) ? activitesAPI.estActiviteReservee(sel[0]) : true;
  },
  onFilterChanged: p => { updateGridCounters(p.api, document.getElementById('badge-prog')); saveGridStateToMeta(p, 'grid-programmees'); },
}

function colorActiviteProgrammable(row) {
  return activitesAPI.estActiviteProgrammable(row) ? COULEUR_ACTIVITE_PROGRAMMABLE : null;
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
  onFilterChanged: p => { updateGridCounters(p.api, document.getElementById('badge-non-prog')); saveGridStateToMeta(p, 'grid-non-programmees'); },
}

const gridOptionsCreneaux = {
  onSelectionChanged: () => onCreneauxSelectionChanged(),
  onFilterChanged: p => { updateGridCounters(p.api, document.getElementById('badge-creneaux')); saveGridStateToMeta(p, 'grid-creneaux'); },
}

const gridOptionsActivitesProgrammables = {
  onSelectionChanged: (p) => {
    const sels = p.api.getSelectedRows();
    const hasSel = !!sels?.length;
    document.getElementById('btn-programmer')?.toggleAttribute('disabled', !hasSel);
    synchronizeSelection(p, 'grid-non-programmees'); 
  },
  onFilterChanged: p => { updateGridCounters(p.api, document.getElementById('badge-programmables')); saveGridStateToMeta(p, 'grid-programmables'); },
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

function saveGridStateToMeta(e, gridId) {
  const api = e.api;
  if (!api) return;

  const columnState = api.getColumnState?.() || [];
  const filterModel = api.getFilterModel?.() || null;

  const prev = ctx.getMeta()?.gridState || {};

  const next = {
    ...prev,
    [gridId]: {
      columnState,
      filterModel,
    },
  };

  ctx.setMetaParam('gridState', next);
}

function restoreGridStateFromMeta(gridId) {
  const handle = window.grids?.get(gridId);
  if (!handle) return;
  const api = handle.api;
  if (!api) return;

  const meta = ctx.getMeta?.() || {};
  const allStates = meta.gridState || {};
  const state = allStates[gridId];
  if (!state) return;

  const { columnState, filterModel } = state;

  // 1) Colonnes : ordre, tri, pinning, visibilité
  if (columnState && Array.isArray(columnState) && columnState.length) {
    api.applyColumnState?.({
      state: columnState,
      applyOrder: true,   // important pour restaurer l’ordre
    });
  }

  // 2) Filtres
  if (filterModel) {
    api.setFilterModel?.(filterModel);
    api.onFilterChanged?.(); // pour forcer la prise en compte
  }
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

function traiterPauses() {
  return localStorage.getItem('exp-creneaux:avec-pauses') === '1';
}

async function loadGridCreneaux() {
  const activites = ctx.df;                      
  const activitesProgrammees = activitesAPI.getActivitesProgrammees(activites);
  const periodeProgrammation = activitesAPI.getPeriodeProgrammation();
  // Two-level shallow copy OBLIGATOIRE sinon AgGrid écrit directement dans les tableaux de ctx => catastrophe !!
  return activitesAPI.getCreneaux(activites, activitesProgrammees, traiterPauses(), periodeProgrammation).map(r => ({...r}));
}

// attendre qu'AG Grid ait peint
function nextPaint(times=2) {
  return new Promise(r => {
    const step = () => (times-- > 0) ? requestAnimationFrame(step) : r();
    requestAnimationFrame(step);
  });
}

async function loadGridActivitesProgrammables(){
  if (!selectedSlot) return [];
  const activites = ctx.df;                      
  // Two-level shallow copy OBLIGATOIRE sinon AgGrid écrit directement dans les tableaux de ctx => catastrophe !!
  return activitesAPI.getActivitesProgrammables(activites, selectedSlot, traiterPauses()).map(r => ({...r}));
}

// Sélectionne + rend visible + retourne DOM de la ligne si possible
async function ensureRowVisibleAndGetEl(gridId, uuid) {
  const h = grids.get(gridId);
  if (!h) return { api:null, node:null, rowEl:null };

  const api = h.api;
  let /** @type {any} */ node = null;
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

// ------- Phantom flight -------
const PHANTOM_WITH_OFFSET = false;      // effet fantôme avec ou sans offset 
const PHANTOM_DEFAULT_OFFSET = 0;   // décalage horizontal par default de la trajectoire de l'effet fantôme
const PHANTOM_DEFAULT_DURATION = 680;  // durée par default de la trajectoire de l'effet fantôme

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

// Fait exécuter un vol de ligne fantome de la ligne sélectionnée d'une grille à la ligne sélectionnée d'une autre
// Si gridOrigine = gridCible, utilisez le paramètre srcRow pour spécifier la row de départ du vol
async function doPhantomFlight (gridOrigine, gridCible, expCible) { 

  if (isProgrammeCalendarVisible()) return;

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

/**
 * Déplace une ligne d’une grille source vers une grille destination en lançant un vol fantôme
 * @param {*} srcGrid 
 * @param {*} dstGrid 
 * @param {*} dstExp 
 * @param {*} srcUuid 
 * @param {*} dstUuid 
 * @param {*} param5 
 */
export async function dropRowFromSrcGridToDstGrid(srcGrid, dstGrid, dstExp, srcUuid, dstUuid, { scroll=true }={}) {

  // 1) sélectionne le voisin dans la source (pas besoin de centrer ici)
  selectRowByUuid(srcGrid, srcUuid, { ensure: null, flash: null });

  // 2) ouvre l’expander cible et scrolle jusqu’à lui
  await openExpanderAsync(dstExp);
  if (scroll) await scrollExpanderIntoViewCenteredAsync(document.getElementById(dstExp), { duration: 400 });

  // 3) sélectionne la ligne cible dans la grille destination
  selectRowByUuid(dstGrid, dstUuid, { ensure: null, flash: false });

  // 4) centre VRAIMENT la ligne dans la grille et récupère son élément DOM
  const { rowEl } = await ensureRowVisibleAndGetEl(dstGrid, dstUuid);
  await waitAF(); // laisse le layout se stabiliser

  // 5) lance le phantom flight vers l’élément centré
  doPhantomFlight(srcGrid, dstGrid, dstExp); 
}

// Quand on édite une colonne qui nécessite de recalculer Fin
function updFin(params) {
  const uuid = params.node.id;
  let df = ctx.getDf().slice();
  const idx = df.findIndex(r => r.__uuid === uuid);
  if (idx < 0) return;

  // 1) on construit la ligne mise à jour
  let row = { ...df[idx], ...params.data };

  // 2) on recalcule Fin à partir de cette ligne
  row.Fin = recalcFin(row);

  // 3) on remet la ligne dans le df
  df[idx] = row;

  df = sortDf(df);
  ctx.setDf(df);    
}

// Quand on édite une Session ou Relache
function updSeances(params) {
  const uuid = params.node.id;
  let df = ctx.getDf().slice();
  const idx = df.findIndex(r => r.__uuid === uuid);
  if (idx < 0) return;

  // 1) on construit la ligne mise à jour
  let row = { ...df[idx], ...params.data };

  // 2) on recalcule Fin à partir de cette ligne
  row.__seances = activitesAPI.buildSeancesFromSessionRelache(row.Session, row.Relache);

  // 3) on remet la ligne dans le df
  df[idx] = row;

  df = sortDf(df);
  ctx.setDf(df);    
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
  if (idx < 0) return;
  df[idx] = { ...df[idx], ...params.data }; df[idx].Date = di; 
  df = sortDf(df);
  ctx.setDf(df);        

  // Si drop dans une autre grille: 
  // - sélectionne la ligne voisine dans la grille de départ
  // - ouvre l’expander de la grille de destination et sélectionne la ligne
  if (params.newValue == "") {
    dropRowFromSrcGridToDstGrid('grid-programmees', 'grid-non-programmees', 'exp-non-programmees', uuidVoisin, uuid, { scroll:false });
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
  if (idx < 0) return;
  df[idx] = { ...df[idx], ...params.data }; df[idx].Date = di; 
  df = sortDf(df);
  ctx.setDf(df);        

  // Si drop dans une autre grille: 
  // - sélectionne la ligne voisine dans la grille de départ
  // - ouvre l’expander de la grille de destination et sélectionne la   
  dropRowFromSrcGridToDstGrid('grid-non-programmees', 'grid-programmees', 'exp-programmees', uuidVoisin, uuid, { scroll:true });
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
    context: { ...(common.context || {}), ...((/** @type {any} */ (optionsPatch)).context || {}), gridId },
  };

  const api = window.agGrid.createGrid(el, gridOptions);
  autoOpenSelectOnEdit(api);
  (/** @type {any} */ (el)).__agApi = api; // ⟵ pour retrouver l’API depuis le pane
  const handle = { id: gridId, el, api, loader, columnsBuilder }; //, nbRowsPred: null };
  grids.set(gridId, handle);
  if (!getActiveGridId()) setActiveGridId(gridId);
  requestAnimationFrame(() => { restoreGridStateFromMeta(gridId); });  
  return handle;
}

// Rafraichit une grille
export async function refreshGrid(gridId) {
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

    finish();
  };

  // laisse AG Grid peindre les nouvelles rows
  requestAnimationFrame(() => requestAnimationFrame(selectAfterPaint));
}

// Rafraichit toutes les grilles
export async function refreshAllGrids() {
  const ids = Array.from(grids.keys());
  await Promise.all(ids.map(id => refreshGrid(id)));
}

// Rafraichit toutes les grilles d'activités (utilisé par la callback de modification de contexte ctx.onChange sur df)
// Sauf 'grid-programmables' qui se redessine automatiquement du fait de la callback onSelectionChanged sur la grille des créneaux disponibles
export async function refreshActivitesGrids() {
  refreshGrid('grid-programmees');
  refreshGrid('grid-creneaux');
  refreshGrid('grid-non-programmees');

  // ✅ si on est en mode calendrier : re-render du calendrier
  // (après 3 frames pour laisser le temps à grid-programmees de finir de se redessiner 
  // et notamment à la sélection courante d'être appliquée)
  if (isProgrammeCalendarVisible()) {
    afterFrames(3, () => rerenderProgrammeCalendar({ defaultHour: 9 }));
  }
}

// Coalessance évitant les rafraîchissements multiples dans la même frame dus à des mutations multiples de contexte dans une fonction 
// (à utiliser éventuellement dans les onChange de AppContext à la place de refreshAllGrids)
let refreshPending = false;
export async function scheduleGlobalRefresh() {
  if (refreshPending) return;
  refreshPending = true;
  requestAnimationFrame(async () => {
    refreshPending = false;
    await refreshAllGrids();
  });
}

// Rechargement des grilles
export async function doRechargerGrilles() {
  const activeGridId = getActiveGridId();
  if (activeGridId) await refreshGrid(activeGridId);
  else await refreshAllGrids();
}

export function wireGrids() {
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

