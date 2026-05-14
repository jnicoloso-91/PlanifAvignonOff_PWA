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
  wakeActivitesGridsRendering,
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
export const contextState = { modified: false };

// === DEBUG PREVENT DEFAULT ===
// ===    A Conserver...     ===
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

  contextState.modified = ctx.getMetaParam('contextState')?.modified || false;

  ctx.on('df:changed',        () => {
    refreshActivitesGrids(); 
    contextState.modified = true;
    ctx.setMetaParam('contextState', contextState);
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

function scrollInputAboveKeyboard(input, { pad = 20 } = {}) {
  if (!input) return false;

  const vv = window.visualViewport;
  if (!vv) return false;

  const r = input.getBoundingClientRect();

  const visibleBottom =
    vv.offsetTop + vv.height - pad;

  const visibleTop =
    vv.offsetTop + pad;

  let delta = 0;

  if (r.bottom > visibleBottom) {
    delta = r.bottom - visibleBottom;
  }
  else if (r.top < visibleTop) {
    delta = r.top - visibleTop;
  }

  if (Math.abs(delta) < 2) {
    return false;
  }

  window.scrollBy({
    top: delta,
    left: 0,
    behavior: 'auto'
  });

  return true;
}

// Permet à la page de monter au dessus du clavier si edition champ texte sur mobile (avec restore scrollY en fin d'édition)
function enableKeyboardAutoScroll() {

  function waitKeyboardAndScroll(el, initialScrollY) {
    let done = false;
    let tries = 0;

    const cleanup = () => {
      window.visualViewport?.removeEventListener("resize", onVV);
      window.visualViewport?.removeEventListener("scroll", onVV);
    };

    const attempt = () => {
      if (done) return;

      tries++;

      const didScroll = scrollInputAboveKeyboard(el, { pad: 20 });

      if (didScroll) {
        restoreScrollY = initialScrollY;
        done = true;
        cleanup();
        return;
      }

      if (tries >= 8) {
        cleanup();
        return;
      }

      setTimeout(attempt, 80);
    };

    const onVV = () => {
      setTimeout(attempt, 30);
    };

    window.visualViewport?.addEventListener("resize", onVV);
    window.visualViewport?.addEventListener("scroll", onVV);

    setTimeout(attempt, 120);
  }

  const isMobile =
    window.matchMedia("(pointer: coarse)").matches;

  if (!isMobile) return;

  let restoreScrollY = null;

  document.addEventListener('focusin', (e) => {

    const el = e.target;

    if (!(el instanceof HTMLInputElement ||
          el instanceof HTMLTextAreaElement)) {
      return;
    }

    // input géré ailleurs
    if (el.dataset.keyboardManaged === "true") return;

    const sc =
      document.scrollingElement || document.documentElement;

    const initialScrollY = sc.scrollTop;

    // setTimeout(() => {

    //   let didAnyScroll = false;

    //   let n = 0;
    //   function retry() {
    //     n++;

    //     const didScroll = scrollInputAboveKeyboard(el, { pad: 20 });
    //     if (didScroll) didAnyScroll = true;

    //     if (didScroll || n >= 6) {
    //       if (didAnyScroll) restoreScrollY = initialScrollY;
    //       return;
    //     }

    //     setTimeout(retry, 80);
    //   }

    //   retry();

    // }, 250);
    waitKeyboardAndScroll(el, initialScrollY);
  });

  document.addEventListener('focusout', () => {

    if (restoreScrollY == null) return;

    const y = restoreScrollY;
    restoreScrollY = null;

    setTimeout(() => {

      const sc =
        document.scrollingElement || document.documentElement;

      sc.scrollTo({
        top: y,
        behavior: 'auto'
      });

    }, 350);
  });
}

// Gestion du retour au programme après visite d’un lien d’activité
function handleVisibilityChange() {
  function handleReturnToApp() {
    if (document.visibilityState !== "visible") return;

    const force = sessionStorage.getItem("forceProgrammeOnReturn");

    if (force) {
      sessionStorage.removeItem("forceProgrammeOnReturn");

      // 🔁 retour forcé sur la page Programme
      window.pager?.setPage?.(
        window.pager?.getPageIndexByClass?.("page--planning") ?? 1,
        false
      );
    }

    // kick layout sur les grilles pour éviter des grilles partiellement redessinées
    try {
      // petit délai pour laisser iOS finir de restaurer viewport/layout
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          try {
            wakeActivitesGridsRendering?.();
          } catch {}
        });
      });
    } catch {}    
  }

  window.addEventListener("pageshow", () => handleReturnToApp());
  window.addEventListener("focus", () => handleReturnToApp());
  document.addEventListener("visibilitychange", () => handleReturnToApp());
}

// Affiche le nom du fichier Excel courant
function showExcelFileName() {
    const fn = ctx.getMetaParam?.('excelFileName');
    const btn = document.getElementById("pg-next");
    btn.innerHTML = (fn) ? fn : '&#8644;';

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
  showExcelFileName();

  console.log('✅ Application initialisée');

  // Pour DEBUG sans DevTools
  // logToPage('✅ Application initialisée');
});