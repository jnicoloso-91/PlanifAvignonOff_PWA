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
  wireProgrammeCalendar,
} from './calendar.js';

import {
  wireExpanders,
  wireExpanderButtons,
  wireExpanderSplitters
} from './expanders.js';

import { logToPage } from './debug.js';

export let ctx = null;
export let activitesAPI = null;

// === DEBUG PREVENT DEFAULT ===
// const DBG_PREVENT_KEY = Symbol.for("dbgPreventDefaultInstalled");

// (function debugPreventDefault() {
//   if (globalThis[DBG_PREVENT_KEY]) return;
//   globalThis[DBG_PREVENT_KEY] = true;

//   const orig = Event.prototype.preventDefault;

//   Event.prototype.preventDefault = function() {
//     if (
//       this.type === "touchmove" ||
//       this.type === "touchstart" ||
//       this.type === "pointermove" ||
//       this.type === "pointerdown" ||
//       this.type === "wheel"
//     ) {
//       console.log("[preventDefault]", {
//         type: this.type,
//         target: this.target,
//         currentTarget: this.currentTarget
//       });
//       console.trace();
//     }
//     return orig.call(this);
//   };
// })();

// === DEBUG POINTER CAPTURE ===
// const DBG_CAPTURE_KEY = Symbol.for("dbgPointerCaptureInstalled");

// (function debugPointerCapture() {
//   if (globalThis[DBG_CAPTURE_KEY]) return;
//   globalThis[DBG_CAPTURE_KEY] = true;

//   const orig = Element.prototype.setPointerCapture;
//   if (!orig) return;

//   Element.prototype.setPointerCapture = function(pointerId) {
//     console.log("[setPointerCapture]", this, { pointerId });
//     console.trace();
//     return orig.call(this, pointerId);
//   };
// })();

// === DEBUG EVENT LISTENER ===
// const DBG_LISTENER_KEY = Symbol.for("dbgAddListenerInstalled");

// (function debugAddEventListener() {
//   if (globalThis[DBG_LISTENER_KEY]) return;
//   globalThis[DBG_LISTENER_KEY] = true;

//   const orig = EventTarget.prototype.addEventListener;

//   EventTarget.prototype.addEventListener = function(type, listener, options) {
//     const opts = typeof options === "boolean" ? { capture: options } : (options || {});
//     if (
//       type === "touchstart" ||
//       type === "touchmove" ||
//       type === "touchend" ||
//       type === "pointerdown" ||
//       type === "pointermove" ||
//       type === "pointerup" ||
//       type === "wheel"
//     ) {
//       console.log("[addEventListener]", {
//         target: this,
//         type,
//         passive: opts.passive,
//         capture: !!opts.capture,
//         once: !!opts.once,
//         listener
//       });
//     }
//     return orig.call(this, type, listener, options);
//   };
// })();

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

    // kick layout sur les grilles pour éviter des grilles partiellement redessinées
    try {
      // petit délai pour laisser iOS finir de restaurer viewport/layout
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          try {
            logToPage('✅ refresh');
            refreshActivitesGrids?.();
          } catch {}

          // kick spécifique des grilles visibles
          try {
            for (const g of (window.grids?.values?.() || [])) {
              if (!g?.api || !g?.el) continue;

              logToPage(`✅ kick`);

              const cs = getComputedStyle(g.el);
              const visible =
                cs.display !== "none" &&
                cs.visibility !== "hidden" &&
                g.el.offsetParent !== null;

              if (!visible) continue;

              g.api.onGridSizeChanged?.();
              g.api.refreshCells?.({ force: true });
              g.api.redrawRows?.();

              const bodyVp = g.el.querySelector(".ag-body-viewport");
              if (bodyVp) {
                bodyVp.scrollTop = bodyVp.scrollTop + 1;
                bodyVp.scrollTop = bodyVp.scrollTop - 1;
              }
            }
          } catch {}

        });
      });
    } catch {}    
  }

  window.addEventListener("pageshow", () => handleReturnToApp());
  window.addEventListener("focus", () => handleReturnToApp());
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
  wireProgrammeCalendar();
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