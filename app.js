// ===============================
// Module principal de In & Off
// ===============================

import { AppContext } from './AppContext.js';

import { 
  creerActivitesAPI, 
} from './activites.js'; 

import {
  wireBottomBar,
  wireAppKebab,
} from './menus.js';

import {
  rebuildColumnsForActiviteGrids,
  refreshActivitesGrids,
  wireGrids,
} from './grids.js';

import {
  wireInfosPlusPopup,
} from './infos-plus.js';

import {
  attachProgrammeCalendarHeightSync,
  enableCalAxisLock,
} from './calendar.js';

import {
  wireExpanders,
  wireExpanderButtons,
  wireExpanderSplitters
} from './expanders.js';

import { logToPage } from './debug.js';

export let ctx = null;
export let activitesAPI = null;

function wireContext() {

  // Initialisation de la periode de programmation si contexte vide
  if (!ctx.df || ctx.df?.length == 0) activitesAPI.initPeriodeProgrammation();

  ctx.on('df:changed',        () => {
    refreshActivitesGrids(); 
  });

  // ctx.on('carnet:changed',    () => {
  //   refreshCarnetGrid(); 
  // });

  ctx.on('history:change', ({ domain, ...st })  => {
    if (domain === 'df') {
      document.getElementById('btn-undo')?.toggleAttribute('disabled', !st.canUndo);
      document.getElementById('btn-redo')?.toggleAttribute('disabled', !st.canRedo);
    }
  });

  // état initial des boutons Undo/Redo
  const st = ctx.historyState ? ctx.historyState('df') : { canUndo: false, canRedo: false };
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

    // ✅ 1) Input géré par un système custom → on s’efface
    if (el.dataset.keyboardManaged === "true") return;

    // ✅ 2) Fallback legacy (ce pour quoi ce code existe vraiment)
    setTimeout(() => {
      el.scrollIntoView({
        behavior: 'smooth',
        block: 'center'
      });
    }, 300);
  });
}

// Gestion du retour au programme après visite d’un lien d’activité
function handleVisibilityChange() {
  function handleReturnToApp() {
    if (document.visibilityState !== "visible") return;

    const force = sessionStorage.getItem("forceProgrammeOnReturn");
    if (!force) return;

    sessionStorage.removeItem("forceProgrammeOnReturn");

    // 🔁 retour forcé sur la page Programme
    window.pager?.setPage?.(
      window.pager?.getPageIndexByClass?.("page--planning") ?? 1,
      false
    );
  }

  document.addEventListener("pageshow", () => handleReturnToApp());
  document.addEventListener("focus", () => handleReturnToApp());
  document.addEventListener("visibilitychange", () => handleReturnToApp());
}

document.addEventListener('DOMContentLoaded', async () => {
  console.log('⏳ DOM prêt, initialisation du contexte...');

  // 1️⃣ Contexte métier (singleton)
  window.ctx = await AppContext.ready();
  ctx = window.ctx;

  // Creation de l'API pour le module activites.js
  activitesAPI = creerActivitesAPI(ctx);

  // 2️⃣ Branchements UI
  // initPageLogger();
  wireContext();
  wireBottomBar();
  wireGrids();
  wireExpanders();
  wireExpanderSplitters();
  wireExpanderButtons();
  attachProgrammeCalendarHeightSync();
  enableCalAxisLock();
  wireAppKebab();
  initSheetGrids();
  wireInfosPlusPopup();
  enableKeyboardAutoScroll();
  rebuildColumnsForActiviteGrids(ctx.df);
  handleVisibilityChange();

  console.log('✅ Application initialisée');

  // Pour DEBUG
  // logToPage('✅ Application initialisée');
});