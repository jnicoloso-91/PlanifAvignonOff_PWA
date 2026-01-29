// ===============================
// Utilitaires Sheets
// ===============================

import {
  escapeHtml,
  escapeAttr,
} from './utils.js';

import { 
  dateToDateint,
  mmFromHHhMM,
  mmToHHhMM,
  isoDateToLocalDate,
  localDateToIsoDate,
} from './utils-date.js';

import { 
  ctx,
  activitesAPI,
} from './app.js'; 

import { 
  importFromUrlOrTxt,
} from './menus.js'; 

import {
  PARSED_DEFAULT, 
  enrichWithAbstractPremiumOneRow,
} from './parsers.js';

import { 
  sortDf, 
  makeFullKey 
} from './activites.js'; 

import {
  collectGridApis,
  getLigneVoisineUuid,
  enableTouchEdit,
  refreshAllGrids,
} from './grids.js';

import {
  isProgrammeCalendarVisible,
  rerenderProgrammeCalendar,
} from './calendar.js';

import { sortCarnet } from './carnet.js'; 
import { TelRenderer } from './TelRenderer.js';
import { WebRenderer } from './WebRenderer.js';

const overlayAttente = document.getElementById('overlay-attente'); // overlay d'attente

// lock/unlock scroll (iOS-safe)
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

/**
 * Obsolete (bug au basculement sur IOS => page grille disparait au retour en mode portrait)
 * @param {*} param0 
 * @returns 
 */
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
      // @ts-ignore
      const /** @type {HTMLElement} */ ae = document.activeElement;
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

/**
 * Ouverture d'une sheet modale exclusive
 * @param {*} param0 
 * @returns 
 */
export function openSheetExclusive({
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


  const /** @type {HTMLElement} */ panel    = root.querySelector('.' + classes.panel);
  const /** @type {HTMLElement} */ header   = root.querySelector('.' + classes.header);
  const /** @type {HTMLElement} */ headerRow= root.querySelector('.' + classes.headerRow);
  const /** @type {HTMLElement} */ bodyEl   = root.querySelector('[data-body]');
  const /** @type {HTMLElement} */ backdrop = root.querySelector('[data-backdrop]');
  const /** @type {HTMLElement} */ closeBtn = root.querySelector('.' + classes.closeBtn);

  // contenu
  const helpers = {
    close, root, panel, header, bodyEl,
    qs: (sel) => root.querySelector(sel),
    // @ts-ignore
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

function closeSheet(classes = {}) {
  const rootClass = classes.root || 'sheet-root';
  const visibleRoot = classes.visibleRoot || 'open';
  const root = document.querySelector('.' + rootClass);
  if (!root) return;
  root.classList.remove(visibleRoot);
  const /** @type {HTMLElement} */ panel = root.querySelector('.' + (classes.panel || 'sheet-panel'));
  if (panel) panel.style.transform = '';
  setTimeout(() => root.remove(), 260);
}

async function closeAnySheet({ immediate = false } = {}) {
  const /** @type {HTMLElement} */ wrap = document.querySelector('.sheet-wrap.is-open');
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
export function openSheetCarnet() {
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
        let /** @type {any} */ node = null;
        apiGrid.forEachNode?.(n => { if (!node && n.data?.__uuid === uuid) node = n; });
        node?.setSelected?.(true, true);
        apiGrid.ensureIndexVisible?.(node?.rowIndex ?? 0, 'middle');
      }

      btnAddC.addEventListener('click', () => {
        const row = { __uuid: crypto.randomUUID(), Nom: getNouveauNom(ctx.carnet), Adresse:'', Tel:'', Web:'' };
        ctx?.mutateCarnet?.(rows => [...(rows||[]), row]);
        setTimeout(() => selectRow(row.__uuid), 0);
      });

      btnDelC.addEventListener('click', () => {
        const sel = apiGrid.getSelectedRows?.()?.[0];
        if (!sel) return;
        const voisin = getLigneVoisineUuid(apiGrid, sel.__uuid)
        ctx?.mutateCarnet?.(rows => (rows||[]).filter(r => r.__uuid !== sel.__uuid));
        setTimeout(() => selectRow(voisin), 0);
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
export function openSheetParams() {
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

        ctx?.updMetaParams({
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
export function openSheetAide() {
  openSheetExclusive({
    title: 'Aide',
    panelMaxHeight: '70vh',
    panelHeight: '60vh',
    mount: (body) => {
      body.innerHTML = `
        <!-- Table des matières -->
        <div class="help-toc">
          <a data-target="generalites">Fonctionnalités générales</a>
          <a data-target="regles-programmation">Règles de programmation</a>
          <a data-target="ui">Interface utilisateur</a>
          <a data-target="ia">Interface IA</a>
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
            
            <p>Il vous offre une interface d'accès unifiée aux catalogues du In et du Off du festival d'Avignon, et peut répondre plus généralement à toute utilisation 
            nécessitant de rechercher des activités dans un catalogue et de les programmer.</p>
            
            <p style="margin-bottom: 0.2em"><u><i>In & Off</u></i> vous permettra notamment :</p>
            <ul style="margin-top: 0em; margin-bottom: 1em">
              <li>de <u><i>charger</u></i> des spectacles et des activités à programmer à partir d'un fichier Excel, ou par collage depuis des catalogues en ligne,</li>
              <li>de <u><i>programmer</u></i> des spectacles et activités, en évitant chevauchements et doublons,</li>
              <li>d'identifier les <u><i>plages libres</u></i> de votre programme de spectacles, ainsi que les <u><i>activités programmables</u></i> sur ces plages,</li>
              <li>de <u><i>naviguer</u></i> vers la description détaillée des spectacles et activités et lancer une <u><i>recherche d'itinéraire</u></i> vers vos sites de spectacles,</li>
              <li>de gérer un <u><i>carnet d'adresses</u></i> des sites de spectacles,</li>
              <li>de <u><i>sauvegarder</u></i> votre programme vers Excel ou votre application calendrier,</li>
              <li>de <u><i>vérifier la cohérence</u></i> de vos données (chevauchements d'activités, respect des marges entre activités, format des données).</li>
            </ul>            

            <p>Un <u><i>Assistant de programmation automatique</u></i> est là pour vous proposer des solutions instantannées de programmation répondant 
            à vos critères de dates et vos préférences stylistiques.</p> 
            
            <p>Vous pouvez également poser des questions à un <u><i>chatbot</u></i> sur les spectacles des catalogues.</p>

            <p>Pour démarrer : allez dans la page <u><i>Mon programme</u></i>, importez un catalogue (menu <u><i>Fichier/Importer...</u></i>), 
            choisissez une plage libre et appuyez sur le bouton <u><i>Programmer</u></i> ! 
            La période de programmation peut être modifiée en allant dans le menu <u><i>.../Paramètres</u></i>.</p>

            <p style="margin-bottom: 0.2em">Pour installer l'application :</p> 
            <ul style="margin-top: 0em; margin-bottom: 1em">
              <li>sur Android, item <u><i>Ajouter à l'écran d'accueil</u></i> dans menu Chrome (en haut à droite de l'écran),</li> 
              <li>sur Iphone ou Ipad item <u><i>Sur l'écran d'accueil</u></i> dans menu <u><i>Partager</u></i> de Safari,</li> 
              <li>sur macOS ou Windows icône <u><i>Installer...</u></i> depuis la barre d'adresse de Chrome ou <u><i>Installer ce site comme application</u></i> depuis menu <u><i>.../Apps</u></i> de Edge.</li> 
            </ul>            
            <p>Dans tous les cas vous pouvez utiliser <u><i>In & Off</u></i> dans votre navigateur depuis la <a href="https://jnicoloso-91.github.io/PlanifAvignonOff_PWA/" target="_blank" rel="noopener noreferrer">page github</a> de l'application.</p>
          </div>
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
            <svg viewBox="0 0 24 24" fill="none">
              <path d="M15 18l-6-6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            Retour
          </div>

          <div class="help-block">

            <h4>Page Catalogue</h3>
            <p>La page <u><i>Catalogue</u></i> propose un accès direct aux principales sources de spectacles :</p>
            <ul>
              <li>le catalogue du <u><i>In</u></i> du festival d’Avignon,</li>
              <li>le catalogue du <u><i>Off</u></i>,</li>
              <li>le site <u><i>Billet Réduc</u></i>.</li>
            </ul>
            <p>Ces liens permettent de consulter les spectacles et, le cas échéant, de copier leur contenu ou leur adresse afin de les importer dans l’application (fonction <u><i>Coller</u></i>).</p>

            <h4>Page Mon programme</h3>
            <p>La page <u><i>Mon programme</u></i> permet de construire et gérer un programme personnalisé de spectacles et d’activités.</p>

            <p>Elle est organisée autour de quatre tableaux :</p>
            <ul>
              <li><u><i>Programme</i></u> : tableau des activités <u><i>programmées</u></i> (activités avec une date de programmation).</li>
              <li><u><i>Plages libres</i></u> : tableau des plages libres entre les activités programmées (seules les plages pour lesquelles il existe des activités programmables sont affichées).</li>
              <li><u><i>Programmer…</i></u> : tableau des activités <u><i>programmables</u></i> dans la plage libre sélectionnée.</li>
              <li><u><i>Stock</i></u> : tableau des activités <u><i>non programmées</u></i> (activités sans date de programmation).</li>
            </ul>

            <p>Le bouton <u><i>Calendrier</u></i> du tableau <u><i>Programme</u></i> permet de choisir entre une présentation <u><i>calendrier</u></i> ou <u><i>grille</u></i>.</p>

            <p>Dans les tableaux <u><i>Programme</u></i>, <u><i>Plages libres</u></i> et <u><i>Programmer…</u></i>, les lignes sont colorisées en fonction de leur <u><i>Date</u></i>.</p>
            <p>Dans le tableau <u><i>Stock</u></i>, les activités programmables (celles pour lesquelles il existe une date de programmation possible) sont colorisées en vert menthe.</p>
            <p>Dans le tableau <u><i>Programme</u></i>, les activités <u><i>réservées</u></i> sont libellées en rouge (une activité réservée ne peut être ni déprogrammée ni reprogrammée).</p>

            <p>Les tableaux sont :</p>
            <ul>
              <li><u><i>triables</u></i> (clic sur les entêtes de colonnes),</li>
              <li><u><i>filtrables</u></i> (bouton <u><i>Filtrer</u></i> ou champs dans les entêtes selon la taille de l’écran),</li>
              <li><u><i>réordonnables</u></i> (déplacement des colonnes par glisser-déposer),</li>
            </ul>

            <p>Dans les tableaux <u><i>Programme</u></i> et <u><i>Stock</u></i>, toutes les informations sont éditables, <sauf :</p>
            <ul>
              <li>les heures de fin (calculées automatiquement),</li>
              <li>les dates, heures de début et durées des activités réservées (colonne <u><i>Réservé</u></i> = Oui).</li>
            </ul>

            <h4>Navigation</h4>
            <p>Dans les tableaux d'activités, des icônes associées à certaines colonnes permettent de naviguer vers des informations complémentaires:
            <ul>
              <li>L'icône <span class="help-icon" role="img" aria-label="Lien Web">🔗</span> des colonnes <u><i>Activité</u></i> et <u><i>Page Web</u></i> 
              permet d'afficher la page Web de l'activité,</li>
              <li>L'icône <span class="help-icon" role="img" aria-label="Itineraire">🧭</span> de la colonne <u><i>Lieu</u></i> permet de lancer une recherche d'itinéraire 
              sur le lieu de l'activité,</li>
              <li>L'icône <span class="help-icon" role="img" aria-label="Lien Web">🔗</span> des colonnes <u><i>Google</u></i> et <u><i>Billet Réduc</u></i> permet de lancer une recherche de l'activité sur Google et le site Billet Réduc.
              <li>L'icône <span class="help-icon" role="img" aria-label="Lien Web">i+</span> affiche des informations complémentaires sur les activités des catalogues : description, style, ton, avis.
            </ul>

            <p>La recherche d'itinéraire utilise l'application de recherche d'itinéraire choisie dans les paramètres de l'application (voir menu <u><i>Paramètres</u></i>) 
            et l'adresse du lieu d'activité renseignée dans le carnet d'adresse, ou à défaut le nom du lieu et un nom de ville défini dans les paramètres de l'application .</p>
                        
            <p>Dans l'affichage du <u><i>Programme</u></i> en mode <u><i>calendrier</u></i>, cliquez / tapez sur le nom de l'activité pour aller vers la page Web de l'activité et 
            double-cliquez / tapez pour lancer la recherche d'itinéraire.</p>
                        
            <h4>Programmation</h4>
            <p>Une activité peut être programmée (i.e. insérée dans le tableau <u><i>Programme</u></i> à une date donnée) de trois manières :</p>
            <ul>
              <li>
                en sélectionnant une <u><i>plage libre</u></i>, puis une activité dans le tableau <u><i>Programmer…</u></i>, puis en appuyant sur le bouton <u><i>Programmer</u></i> ;
              </li>
              <li>
                en sélectionnant une activité programmable dans le <u><i>Stock</u></i> puis en dépliant le menu de la colonne <u><i>Date</u></i> pour choisir une date possible ;
              </li>
              <li>
                en utilisant l’<u><i>Assistant programmation</u></i>, qui génère automatiquement un planning d’activités (voir menu “...”).
              </li>
            </ul>

            <p>Pour <u><i>déprogrammer</u></i> une activité, il suffit de la sélectionner dans le tableau <u><i>Programme</u></i> ou le <u><i>Calendrier</u></i> et d’appuyer sur le bouton <u><i>Supprimer</u></i>.
            Une fois déprogrammée, l’activité bascule dans le tableau <u><i>Stock</u></i>.</p>

            <p>Pour la <u><i>reprogrammer</u></i>, allez dans le <u><i>Stock</u></i>, double-cliquez sur la cellule <u><i>Date</u></i> de l'activité concernée et sélectionnez une autre date possible.</p>

            <h4>Barre d'outils</h4>
            <p>La barre d'outils en bas de la page <u><i>Mon programme</u></i> permet d’accéder aux fonctionnalités suivantes :</p>

            <ul>
              <li><u><i>Fichier</u></i> : nouveau programme ou stock, import Excel, import depuis catalogues en ligne, export vers Excel ou le calendrier, rapport de cohérence.</li>
              <li><u><i>Défaire</u></i> / <u><i>Refaire</u></i> : annuler ou rétablir une opération.</li>
              <li><u><i>Coller</u></i> : collage d’activités depuis le presse-papier (via URL ou copie du contenu d’une page catalogue ou d'une page de détail d'une activité).</li>
              <li><u><i>Ajouter</u></i> : ajout d’une nouvelle activité.</li>
            </ul>

            <h4>Menu “...”</h4>
            <p>Le menu “...” situé à droite de l'entête permet d’accéder aux fonctions complémentaires suivantes :</p>
            <ul>
              <li><u><i>Carnet d'adresses</u></i> : présente le carnet d'adresses des lieux d'activités / théâtres. Les champs <u><i>Nom</u></i> / <u><i>Adresse</i></u> / 
              <u><i>Téléphone</u></i> /<u><i>Web</u></i> de chaque entrée peuvent être édités et des boutons permettent d'ajouter / supprimer 
              des entrées, défaire / refaire ces opérations. Dans les colonnes Tel (Numéro de Téléphone) et Web (Adresse Web) des boutons permettent 
              d'appeler le numéro de téléphone ou aller sur le site Web correspondant. Les adresses ainsi renseignées sont utilisées pour la recherche d'itinéraire.</li>
              <li><u><i>Assistant programmation</u></i> : permet de générer automatiquement un programme de spectacles en donnant vos préférences par texte libre 
              et/ou en sélectionnant des critères de dates, horaires, nombre de spectacles par jour, prise en compte ou non du filtrage 
              courant sur le stock, mots clefs portant sur le style, le ton, les auteurs, les acteurs. Vous pouvez aisément regénérer de nouvelles solutions en appuyant sur le bouton <u><i>Générer</i></u>. 
              Pour chaque spectacle proposé vous pouvez l'activer, le désactiver, avoir une info bulle de détail ou aller sur sa page Web. Le bouton <u><i>Appliquer</i></u> vous permet d'appliquer la solution choisie.</li>
              <li><u><i>Assistant chat</u></i> : permet d'interroger une IA au travers d'une interface de chat sur les catalogues de spectacles 
              mis à disposition par l'application. Les résultats proposés par l'IA peuvent être collés dans votre stock.</li>
              <li><u><i>Assistant infos+</u></i> : permet de générer les informations complémentaires affichables dans les popup i+ disponibles dans les grilles et les plannings: 
              résumé du spectacle et des avis spectateurs, évaluation du ton du spectacle.</li>
              <li><u><i>Paramètres</u></i> : permet d'éditer les paramètres de l'application comprenant:
                <ul>
                  <li>la <u><i>période de programmation</u></i></li>
                  <li>la <u><i>marge</u></i> entre activités</li>
                  <li>la <u><i>durée</u></i> des pauses repas</li>
                  <li>le nom de <u><i>l'application d'itinéraire</u></i> (Google Maps, Apple, etc.)</li>
                  <li>la <u><i>ville</u></i> de recherche par défaut pour la recherche d'itinéraire.</li>
                </ul>
              </li>
              <li><u><i>Aide</u></i> : la présente aide</li>
            </ul>
          </div>
        </div>

        <div id="help-ia" class="help-chapter">
          <div class="help-back" data-back>
            <svg viewBox="0 0 24 24" fill="none"><path d="M15 18l-6-6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
            Retour
          </div>
          <div class="help-block">
            <p>Le menu "..." en haut à droite de l'application vous donne accès à deux assistants IA:</p>
            <ul style="margin-top: 0em">
              <li><u><i>Assistant programmation</u></i> : permet de générer automatiquement un programme de spectacles en donnant vos préférences par texte libre 
              et/ou en sélectionnant des critères de dates, horaires, nombre de spectacles par jour, prise en compte ou non du filtrage 
              courant sur le stock, mots clefs portant sur le style, le ton, les auteurs, les acteurs. Vous pouvez aisément regénérer de nouvelles solutions en appuyant sur le bouton <u><i>Générer</i></u>. 
              Pour chaque spectacle proposé vous pouvez l'activer, le désactiver, avoir une info bulle de détail ou aller sur sa page Web. Le bouton <u><i>Appliquer</i></u> vous permet d'appliquer la solution choisie.</li>
              <li><u><i>Assistant chat</u></i>: permet d'interroger une IA au travers d'une interface de chat sur les catalogues de spectacles 
              mis à disposition par l'application. Les résultats proposés par l'IA peuvent être collés dans votre stock.</li>
              <li><u><i>Assistant infos+</u></i> : permet de générer les informations complémentaires affichables dans les popup i+ disponibles dans les grilles et les plannings: 
              résumé du spectacle et des avis spectateurs, évaluation du ton du spectacle.</li>
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
                <li>Suite de dates de type jour ou jour/mois ou jour/mois/année, séparées par des virgules (mois ou année omis -> mois et année du début de la période de programmation)</li>
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

      // Navigation
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
export function openSheetCoherence(rows, {
  title = 'Cohérence des données',
} = {}) {
  const html = activitesAPI.getLogVerifierCoherenceJS(rows);

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

// Feuille Filtres 
export function openSheetFiltres(gridId) {
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

      // Returns unique words extracted from values of a field.
      // For each value (assumed possibly a CSV/list), split by `sep`, trim and collect unique tokens.
      function uniqueWords(rows, field, { max = 500, includeEmpty = false, sep = ',' } = {}) {
        const rawVals = uniqueValues(rows, field, { max, includeEmpty });
        const set = new Set();
        for (const v of rawVals) {
          if (!v) continue;
          const parts = String(v).split(sep);
          for (const p of parts) {
            const w = p.trim();
            if (!w) continue;
            set.add(w);
            if (set.size >= max) break;
          }
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
      function wireDatalistForFieldWords(field, rows) {
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

        const words = uniqueWords(rows, field);
        dl.replaceChildren(); // reset
        for (const w of words) {
          const san = sanitizeDatalistValue(w);
          if (!san) continue;
          const o = document.createElement('option');
          o.value = san;
          o.dataset.raw = String(w);
          dl.appendChild(o);
        }
      }

      function buildFilterLists(rows, fields) {
        fields.forEach(f => {
          try {
            if (String(f).toLowerCase() === 'mood') {
              wireDatalistForFieldWords(f, rows);
            } else {
              wireDatalistForField(f, rows);
            }
          } catch (e) {
            console.warn('buildFilterLists error for field', f, e);
          }
        });
      }
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


      // ===== Appliquer / hMaxCur=====
      const applyBtn = body.querySelector('#btn-apply');
      const clearBtn = body.querySelector('#btn-clear');
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
        if (isProgrammeCalendarVisible()) rerenderProgrammeCalendar();
        close();
      });

      clearBtn.addEventListener('click', () => {
        gridApi.setFilterModel({});
        gridApi.onFilterChanged?.();
        if (isProgrammeCalendarVisible()) rerenderProgrammeCalendar();
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

// Import depuis billet reduc
async function doImportFromBilletReduc({ rubrique, region, dt }) {
  const url = `https://www.billetreduc.com/search.htm?dt=${encodeURIComponent(dt)}&region=${encodeURIComponent(region)}&idrub=${encodeURIComponent(rubrique)}`;
  importFromUrlOrTxt(url, 'parseBilletReducProgPage');
}

// Feuille Import Billet Réduc 
export function openSheetImportBilletReduc() {
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

// =======================
// Backend AI
// =======================

const AI_CHAT_HISTORY_KEY = "in_off_ai_chat_history_v1";
const AI_LAST_SEMANTIC_INTENT_KEY = "in_off_ai_last_semantic_intent_v1";

// Private helper pour chat et programmation: merge auteurs from filters.distribution into filters.keywords
function mergeAuteursIntoKeywords(intent) {
  try {
    if (!intent || !intent.filters) return;
    const dist = intent.filters.distribution;
    const auteursStr = dist && typeof dist.auteurs === 'string' ? dist.auteurs : null;
    if (!auteursStr) return;

    const kwStr = intent.filters.keywords || '';
    const kws = kwStr.split(',').map(s => s.trim()).filter(Boolean);
    const auteurs = auteursStr.split(',').map(s => s.trim()).filter(Boolean);
    for (const a of auteurs) {
      const normA = a.toLowerCase();
      const exists = kws.some(k => k.toLowerCase() === normA);
      if (!exists) kws.push(a);
    }
    intent.filters.keywords = kws.join(', ');
  } catch (e) {
    console.warn('merge auteurs->keywords failed', e);
  }
}

// Private helper pour chat et programmation: merge acteurs (array or CSV string) into filters.keywords
function mergeActeursIntoKeywords(intent) {
  try {
    if (!intent || !intent.filters) return;
    const dist = intent.filters.distribution;
    const acteursStr = dist && typeof dist.acteurs === 'string' ? dist.acteurs : null;
    if (!acteursStr) return;

    const kwStr = intent.filters.keywords || '';
    const kws = kwStr.split(',').map(s => s.trim()).filter(Boolean);
    const acteurs = acteursStr.split(',').map(s => s.trim()).filter(Boolean);
    for (const a of acteurs) {
      const normA = a.toLowerCase();
      const exists = kws.some(k => k.toLowerCase() === normA);
      if (!exists) kws.push(a);
    }
    intent.filters.keywords = kws.join(', ');
  } catch (e) {
    console.warn('merge acteurs->keywords failed', e);
  }
}

// Contexte du chat IA 
let lastSemanticSelection = null;
let seenSemanticKeysGlobal = new Set(); // clés déjà proposées en mode "global"
let seenSemanticKeysLocal = new Set(); // clés déjà proposées en mode "local"
let lastPresentedResults = []; // à alimenter quand on affiches une liste pour le bouton collage

// Assistant Chat
export function openSheetAssistantChat() {
  // const contextSnapshot = buildAIContext(); // ton contexte global (planning, etc.)

  openSheetExclusive({
    title: "Assistant IA (bêta)",
    panelHeight: "auto",
    panelMaxHeight: "80vh",
    mount: (body, { close }) => {
      body.innerHTML = `
        <div class="ai-chat-container">

          <div id="ai-chat-log" class="ai-chat-log"></div>

          <p id="ai-error" class="ai-error" hidden></p>

          <div class="ai-input-wrapper">
            <textarea id="ai-request"
                      class="ai-input"
                      rows="3"
                      placeholder="Posez vos questions… (ex : propose 3 pièces de Molière du Off, résume la sélection, etc.)"></textarea>
          </div>
          <div class="ai-reset-wrapper">
            <button id="btn-ai-reset"
                    type="button"
                    class="bb-btn is-primary bb-btn-compact">
              Nouveau chat 
            </button>
            <button id="btn-ai-send"
                    type="button"
                    class="bb-btn is-primary bb-btn-compact">
              Envoyer
            </button>
            <button id="btn-ai-paste"
                    type="button"
                    class="bb-btn is-primary bb-btn-compact">
              Coller résultats 
            </button>
          </div>
        </div>
      `;

      const inputReq  = body.querySelector("#ai-request");
      const btnSend   = body.querySelector("#btn-ai-send");
      const btnReset  = body.querySelector("#btn-ai-reset");
      const btnPaste  = body.querySelector("#btn-ai-paste");
      const errEl     = body.querySelector("#ai-error");
      const chatLogEl = body.querySelector("#ai-chat-log");

      const chatHistory = loadChatHistoryFromStorage();
      let lastSemanticIntent = loadLastSemanticIntent();
      let baseUtterance = "";
      let selectionOrigin = "";
      let freeSpeechContext = "";
      let totalMatches = 0;

      const showError = (msg) => {
        if (!errEl) return;
        errEl.textContent = msg || "";
        errEl.hidden = !msg;
      };

      const clearError = () => showError("");

      function resetAIHistory() {
        try {
          if (typeof localStorage !== "undefined") {
            localStorage.removeItem(AI_CHAT_HISTORY_KEY);
            localStorage.removeItem(AI_LAST_SEMANTIC_INTENT_KEY);
          }
        } catch (e) {
          console.warn("resetAIHistory error:", e);
        }
      }

      function renderMarkdown(text, { convertNewlines = true } = {}) {
        if (!text) return "";

        // 1) Décoder quelques entités
        let s = text
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'");

        // 2) Échapper HTML dangereux
        s = s
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;");

        // 3) Liens [texte](https://url)
        s = s.replace(
          /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
          '<a href="$2" target="_blank" rel="noopener">$1</a>'
        );

        // 4) Gras **texte**
        s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");

        // 5) Italique *texte* (optionnel)
        s = s.replace(/\*([^*]+)\*/g, "<em>$1</em>");

        // 6) Newlines
        if (convertNewlines) {
          s = s.replace(/\n/g, "<br>");
        }

        return s;
      }

      function loadChatHistoryFromStorage() {
        try {
          if (typeof localStorage === "undefined") return [];
          const raw = localStorage.getItem(AI_CHAT_HISTORY_KEY);
          if (!raw) return [];
          const parsed = JSON.parse(raw);
          return Array.isArray(parsed) ? parsed : [];
        } catch (e) {
          console.warn("loadChatHistoryFromStorage error:", e);
          return [];
        }
      }

      function saveChatHistoryToStorage(history) {
        try {
          if (typeof localStorage === "undefined") return;
          localStorage.setItem(AI_CHAT_HISTORY_KEY, JSON.stringify(history));
        } catch (e) {
          console.warn("saveChatHistoryToStorage error:", e);
        }
      }

      function loadLastSemanticIntent() {
        try {
          if (typeof localStorage === "undefined") return null;
          const raw = localStorage.getItem(AI_LAST_SEMANTIC_INTENT_KEY);
          if (!raw) return null;
          return JSON.parse(raw);
        } catch (e) {
          console.warn("loadLastSemanticIntent error:", e);
          return null;
        }
      }

      function formatChatContent(text) {
        if (!text) return "";

        const lines = String(text).replace(/\r\n/g, "\n").split("\n");

        const out = [];
        let inList = false;

        const flushListIfNeeded = () => {
          if (inList) {
            out.push("</ul>");
            inList = false;
          }
        };

        for (const rawLine of lines) {
          const line = rawLine.trimEnd(); // on garde l'indentation à gauche si tu veux, mais pas nécessaire ici
          const trimmed = line.trim();

          // ligne vide
          if (!trimmed) {
            flushListIfNeeded();
            out.push("<br>");
            continue;
          }

          // 1) Titres Markdown: ###, ##, #
          const hm = trimmed.match(/^(#{1,6})\s+(.*)$/);
          if (hm) {
            flushListIfNeeded();
            const level = hm[1].length;           // 1..6
            const title = hm[2] || "";
            out.push(`<h${level} class="ai-h${level}">${renderMarkdown(title, { convertNewlines: false })}</h${level}>`);
            continue;
          }

          // puce "- " ou "• "
          const m = trimmed.match(/^([-•])\s+(.*)$/);
          if (m) {
            const itemText = m[2] || "";
            if (!inList) {
              out.push("<ul class='ai-list'>");
              inList = true;
            }
            out.push(`<li>${renderMarkdown(itemText, { convertNewlines: false })}</li>`);
            continue;
          }

          // sinon paragraphe normal
          flushListIfNeeded();
          out.push(`<p>${renderMarkdown(trimmed, { convertNewlines: false })}</p>`);
        }

        flushListIfNeeded();

        return out.join("");
      }

      function renderChat() {
        if (!chatLogEl) return;
        chatLogEl.innerHTML = "";

        for (const msg of chatHistory) {
          const div = document.createElement("div");
          div.classList.add("ai-chat-message", msg.role);
          if (msg.mode === "semantic") {
            div.classList.add("ai-chat-semantic");
          }

          div.innerHTML = formatChatContent(msg.content);

          chatLogEl.appendChild(div);
        }

        chatLogEl.scrollTop = chatLogEl.scrollHeight;
      }

      function addMessageToUI(msg) {
        chatHistory.push(msg);
        saveChatHistoryToStorage(chatHistory);
        renderChat();
      }

      // Construit un contexte "conversationnel" compact à partir de l'historique
      function buildContextFromHistory(maxPairs = 5, mode = null) {
        const pairs = [];
        let current = [];

        for (const msg of chatHistory) {
          if (mode !== null && msg.mode !== mode) continue;

          if (msg.role === "user") {
            if (current.length) pairs.push(current);
            current = [`Utilisateur: ${msg.content}`];
          } else if (msg.role === "assistant") {
            current.push(`Assistant: ${msg.content}`);
            pairs.push(current);
            current = [];
          }
        }

        if (current.length) pairs.push(current);

        return pairs
          .slice(-maxPairs)
          .map(p => p.join("\n"))
          .join("\n\n");
      }
      
      function dateISOToInt(iso) {
        if (!iso || typeof iso !== "string") return null;
        const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (!m) return null;
        const y = Number(m[1]);
        const mo = Number(m[2]);
        const d = Number(m[3]);
        if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return null;
        return y * 10000 + mo * 100 + d;
      }

      function getRowTimeHHMM(row) {
        if (row.Debut && /^\d{1,2}:\d{2}$/.test(row.Debut)) {
          return row.Debut;
        }
        return null;
      }

      function iterDateRangeInt(fromInt, toInt, cb) {
        if (!Number.isFinite(fromInt) || !Number.isFinite(toInt)) return;
        let cur = fromInt;
        while (cur <= toInt) {
          cb(cur);
          // incrément d'un jour
          let y = Math.floor(cur / 10000);
          let m = Math.floor((cur / 100) % 100);
          let d = cur % 100;
          const js = new Date(y, m - 1, d);
          js.setDate(js.getDate() + 1);
          y = js.getFullYear();
          m = js.getMonth() + 1;
          d = js.getDate();
          cur = y * 10000 + m * 100 + d;
        }
      }

      /**
       * Filtre le planning / stock courant selon QueryIntent.
       *
       * @param {Array<object>} df - tableau de lignes (planning ou stock)
       * @param {object} intentJson - QueryIntent retourné par /ai/query-understand
       * @returns {Array<object>}
       */
      function filterCurrentScheduleWithIntent(df, intentJson) {
        if (!Array.isArray(df) || !df.length || !intentJson) return [];

        const filters = intentJson.filters || {};
        const scope   = intentJson.scope   || {};

        let rows = df.slice();

        // --------------------------------
        // 0) Sections / festival (In / Off)
        // --------------------------------
        let wantedSections = null;

        if (Array.isArray(filters.sections) && filters.sections.length > 0) {
          wantedSections = new Set(
            filters.sections
              .map(s => s && s.value ? String(s.value).toLowerCase() : "")
              .filter(Boolean)
          );
        } else if (Array.isArray(scope.festival) && scope.festival.length > 0) {
          wantedSections = new Set(
            scope.festival.map(s => String(s).toLowerCase())
          );
        }

        if (wantedSections && wantedSections.size > 0) {
          rows = rows.filter(r => {
            const orga = String(r.Orga || r.Section || "").toLowerCase();
            if (!orga) return false;
            return wantedSections.has(orga);
          });
        }

        // --------------------------------
        // 1) Shows (Activite)
        // --------------------------------
        if (Array.isArray(filters.shows) && filters.shows.length > 0) {
          const actValues = filters.shows
            .map(c => (c && c.value ? String(c.value).toLowerCase() : ""))
            .filter(Boolean);

          if (actValues.length > 0) {
            rows = rows.filter(r => {
              const activite = String(r.Activite || "").toLowerCase();
              if (!activite) return false;
              return actValues.some(act => activite.includes(act));
            });
          }
        }

        // --------------------------------
        // 2) Catégories (Style)
        // --------------------------------
        if (Array.isArray(filters.categories) && filters.categories.length > 0) {
          const catValues = filters.categories
            .map(c => (c && c.value ? String(c.value).toLowerCase() : ""))
            .filter(Boolean);

          if (catValues.length > 0) {
            rows = rows.filter(r => {
              const style = String(r.Style || "").toLowerCase();
              if (!style) return false;
              return catValues.some(cat => style.includes(cat));
            });
          }
        }

        // --------------------------------
        // 3) Lieux (venues)
        // --------------------------------
        if (Array.isArray(filters.venues) && filters.venues.length > 0) {
          const venueNames = filters.venues
            .map(v => (v && v.name ? String(v.name).toLowerCase() : ""))
            .filter(Boolean);

          if (venueNames.length > 0) {
            rows = rows.filter(r => {
              const lieu = String(r.Lieu || r.Theatre || "").toLowerCase();
              if (!lieu) return false;
              return venueNames.some(name => lieu.includes(name));
            });
          }
        }

        // --------------------------------
        // 4) Dates + fenêtre horaire
        // --------------------------------
        const hasDateFilter =
          filters.dates && (filters.dates.from || filters.dates.to);
        const hasTimeFilter =
          filters.time_window && (filters.time_window.start || filters.time_window.end);

        let fromInt = null;
        let toInt   = null;

        if (hasDateFilter) {
          const fromDate = filters?.dates?.from || null; // "YYYY-MM-DD"
          const toDate   = filters?.dates?.to   || null;
          fromInt = fromDate ? dateISOToInt(fromDate) : null;
          toInt   = toDate   ? dateISOToInt(toDate)   : null;
        }

        const fromTime = filters?.time_window?.start || null; // "HH:MM"
        const toTime   = filters?.time_window?.end   || null;

        // pour les dates futures uniquement
        const onlyFuture = filters?.availability?.only_future_performances === true;

        if (hasDateFilter || hasTimeFilter || onlyFuture) {
          const today = new Date();
          const todayInt =
            today.getFullYear() * 10000 +
            (today.getMonth() + 1) * 100 +
            today.getDate();

          rows = rows.filter(r => {
            const rowHasDate = Number.isFinite(r.Date);
            const dateInt = rowHasDate ? Number(r.Date) : null;
            const timeStr = getRowTimeHHMM(r); // "HH:MM" ou null

            // --- CAS A : la ligne a déjà une date programmée ---
            if (rowHasDate) {
              // Filtre date (from/to)
              if (hasDateFilter) {
                if (fromInt && dateInt < fromInt) return false;
                if (toInt   && dateInt > toInt)   return false;
              }

              // Filtre future uniquement
              if (onlyFuture && dateInt < todayInt) return false;

              // Filtre heure (si demandé)
              if (hasTimeFilter) {
                if (!timeStr) return false;
                if (fromTime && timeStr < fromTime) return false;
                if (toTime   && timeStr > toTime)   return false;
              }

              // Ici, on ne consulte pas activitesAPI :
              // Date est déjà une session effectivement programmée.
              return true;
            }

            // --- CAS B : pas de Date : on se base sur activitesAPI + intervalle de dates ---
            // Si on n'a pas activitesAPI ou pas de filtre de date, on ne sait pas faire mieux
            if (!activitesAPI || !hasDateFilter) {
              // on applique éventuellement uniquement le filtre horaire (sans date)
              if (hasTimeFilter) {
                if (!timeStr) return false;
                if (fromTime && timeStr < fromTime) return false;
                if (toTime   && timeStr > toTime)   return false;
              }
              // pas de contrainte de date explicite gérable
              return true;
            }

            // Ici : pas de Date, mais hasDateFilter + activitesAPI → on teste si l'activité
            // est valide / programmable sur au moins UNE date du range.
            const act = r; // on suppose que "activite" est la ligne elle-même

            let anyMatch = false;
            const effFromInt = fromInt || todayInt; // si pas de from, on prend aujourd'hui pour onlyFuture
            const effToInt   = toInt   || (fromInt || todayInt); // borne sup minimale

            iterDateRangeInt(effFromInt, effToInt, (di) => {
              if (anyMatch) return;

              // validité session/relâche
              if (!activitesAPI.estActiviteValideADate(act, di)) return;

              // future uniquement ?
              if (onlyFuture && di < todayInt) return;

              // Si on veut être ultra strict sur des heures, on ne peut pas savoir ici (pas d'horaire par date)
              // donc on ignore la time_window dans ce cas B.

              anyMatch = true;
            });

            return anyMatch;
          });
        }

        // --------------------------------
        // 5) Tri (optionnel) pas de limit ce sera au worker de le faire apres scoring)
        // --------------------------------

        // rows.sort((a, b) => {
        //   const da = Number.isFinite(a.Date) ? Number(a.Date) : 0;
        //   const db = Number.isFinite(b.Date) ? Number(b.Date) : 0;
        //   if (da !== db) return da - db;

        //   const ta = getRowTimeHHMM(a) || "";
        //   const tb = getRowTimeHHMM(b) || "";
        //   return ta.localeCompare(tb);
        // });

        return rows;
      }

      // Helper : lit limit dans intentJson
      function getLimitFromIntent(intentJson, fallback = 10) {
        const n = intentJson?.results?.limit;
        if (Number.isFinite(n) && n > 0) return n;
        return fallback;
      }

      // Helper : lit selection_mode dans intentJson
      function getSelectionModeFromIntent(intentJson) {
        const raw = intentJson?.results?.selection_mode || "random";
        return raw; // "scored" | "random" | "augmented" | "augmented_random"...
      }

      // Chat "classique"
      // Appelle la route /ai du worker CloudFlare.
      async function callAI(message, context) {
        const res = await fetch("https://off-proxy.joel-nicoloso.workers.dev/ai", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message, context })
        });
        if (!res.ok) {
          const txt = await res.text().catch(() => "");
          console.warn("callAI HTTP error:", res.status, txt);
          throw new Error("Erreur HTTP " + res.status);
        }
        const js = await res.json();
        return js.reply || "";
      }

      // Analyse d'intention IA
      // Appelle la route /ai/query-understand du worker CloudFlare.
      // previousIntent: dernier QueryIntent semantic (ou null)
      async function callAIQueryUnderstand(message, previousIntent) {
        const body = {
          utterance: message,
          edition_year: 2025,
          free_speech_context: freeSpeechContext
        };
        if (previousIntent) {
          body.previous_intent = previousIntent;
        }

        const res = await fetch("https://off-proxy.joel-nicoloso.workers.dev/ai/query-understand", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body)
        });
        if (!res.ok) {
          const txt = await res.text().catch(() => "");
          console.warn("callAIQueryUnderstand HTTP error:", res.status, txt);
          throw new Error("Erreur HTTP " + res.status);
        }
        return await res.json(); // QueryIntent complet
      }

      // Permet de scorer par similarité relativement à une query un ensemble d'entrées de l'index global définies par des filtres et un scope.
      // Appelle la route /ai/semantic-wf du worker CloudFlare.
      // Cette fonction est utilisée pour filtrer via le paramètre filters, puis scorer l'index global, comme suite à une analyse d'intention IA.
      // Typiquement le paramètre filters provient de l'analyse d'intention IA qui renvoie un objet QueryIntent.filters à partir d'une query textuelle libre.
      async function scoreAISemanticWithFilters(query, already_seen, topK = 10, filters = null, scope = null, selectionMode="scored") {
        const body = { query, already_seen, topK, selection_mode: selectionMode };
        if (filters) body.filters = filters;
        if (scope)   body.scope   = scope;

        const res = await fetch("https://off-proxy.joel-nicoloso.workers.dev/ai/semantic-wf", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body)
        });
        if (!res.ok) {
          const txt = await res.text().catch(() => "");
          console.warn("scoreAISemanticWithFilters HTTP error:", res.status, txt);
          throw new Error("Erreur HTTP " + res.status);
        }

        const js = await res.json();

        console.log(`${js.sl} ${js.total_matches}`)

        return {
          results: Array.isArray(js.results) ? js.results : [],
          total_matches: Number.isFinite(js.total_matches)
            ? js.total_matches
            : (Array.isArray(js.results) ? js.results.length : 0),
          is_truncated:
            typeof js.is_truncated === "boolean"
              ? js.is_truncated
              : (Array.isArray(js.results) && js.results.length < topK)
        };
      }

      // Permet de scorer par similarité relativement à une query un ensemble d'entrées de l'index global définies des keys.
      // Appelle la route /ai/semantic-wk du worker CloudFlare.
      // Cette fonction est utilisée pour scorer des rows du df local après un filtrage local effectué comme suite à une analyse d'intention IA sur une query
      async function scoreAISemanticWithKeys(query, keys, topK=null, selectionMode="scored", distributionFilter=null, moodFilter=null, kwdFilter=null) {
        if (!query || !keys || !keys.length) return [];

        if (!topK) topK = keys.length;

        const res = await fetch("https://off-proxy.joel-nicoloso.workers.dev/ai/semantic-wk", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ 
            query, 
            keys, 
            topK, 
            selection_mode: selectionMode, 
            distribution_filter: distributionFilter, 
            mood_filter: moodFilter, 
            kwd_filter: kwdFilter })
        });

        if (!res.ok) {
          const txt = await res.text().catch(() => "");
          console.warn("scoreAISemanticWithKeys HTTP error:", res.status, txt);
          throw new Error("Erreur HTTP " + res.status);
        }
        const js = await res.json();

        return {
          scores: Array.isArray(js.results) ? js.results : [],
          total_matches: Number.isFinite(js.total_matches)
            ? js.total_matches
            : (Array.isArray(js.results) ? js.results.length : 0),
          is_truncated:
            typeof js.is_truncated === "boolean"
              ? js.is_truncated
              : (Array.isArray(js.results) && js.results.length < topK)
        };
      }

      // Interprétation via IA d'une sélection parmi les résultats d'une recherche
      async function callAISemanticExplain(query, semanticQuery, scoredResults) {
        const items = (scoredResults || []);

        if (!items.length) {
          return { answer: "Je n'ai pas de résultats exploitables pour une analyse.", results: [], context_used: "" };
        }

        const body = {
          query,
          semanticQuery,
          items,
          context: "current_utterance_results",
          origin: selectionOrigin,
          base_utterance: baseUtterance,
          total_matches: totalMatches,
          free_speech_context: freeSpeechContext
        };

        const resp = await fetch("https://off-proxy.joel-nicoloso.workers.dev/ai/semantic-explain", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body)
        });

        if (!resp.ok) {
          const txt = await resp.text().catch(() => "");
          console.error("callAISemanticExplain error:", resp.status, txt);
          throw new Error("Erreur backend semantic-explain");
        }

        return resp.json(); // { answer, results, context_used }
      }

      // Interprétation via IA des résultats de la sélection précédente
      async function callAISemanticExplainWithKeys(query, semanticQuery, selection) {
        const items = (selection?.items || []);

        if (!items.length) {
          return "Je n'ai pas de résultats exploitables pour une analyse.";
        }

        const body = {
          query,
          semanticQuery,
          items,
          context: "base_utterance_results",
          origin: selectionOrigin,
          base_utterance: baseUtterance,
          total_matches: totalMatches,
          free_speech_context: freeSpeechContext
        };

        const resp = await fetch("https://off-proxy.joel-nicoloso.workers.dev/ai/semantic-explain", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body)
        });

        if (!resp.ok) {
          const txt = await resp.text().catch(() => "");
          console.error("semantic-explain error", resp.status);
          throw new Error("Erreur semantic-explain");
        }

        const data = await resp.json();
        // on suppose { answer: "..." }
        return data?.answer || "";
      }

      // petite variété de fins de phrase
      const PRESENTATION_TAILS = [
        "qui pourraient vous intéresser",
        "correspondant à votre demande",
        "en lien avec votre requête",
        "susceptibles de vous plaire",
        "à explorer selon vos critères",
        "proches de ce que vous cherchez"
      ];

      function pickRandom(arr) {
        return arr[Math.floor(Math.random() * arr.length)];
      }

      // Gestion de la recherche sémantique globale (In & Off)
      async function handleGlobalSemanticSearch(raw, intentJson) {
        function formatResults(finalList) {

          let festivalsLabel = "";
          if (festivals.includes("in") && festivals.includes("off")) {
            festivalsLabel = "catalogues In&Off";
          } else if (festivals.includes("in")) {  
            festivalsLabel = "catalogue du In";
          } else if (festivals.includes("off")) {
            festivalsLabel = "catalogue du Off";
          }

          const tail = pickRandom(PRESENTATION_TAILS);

          let presentation;
          if (!isTruncatedFinal) {
            if (festivals.length > 1) {
              presentation = `Voici les résultats des ${festivalsLabel} ${tail}:\n`;
            } else {
              presentation = `Voici les résultats du ${festivalsLabel} ${tail}:\n`;
            }
          } else if (selectionMode === "random") {
            const followUpMarker = isFollowUp ? "autres" : "";
            if (festivals.length > 1) {
              presentation = `Voici quelques ${followUpMarker} suggestions choisies dans les ${festivalsLabel} ${tail}:\n`;
            } else {
              presentation = `Voici quelques ${followUpMarker} suggestions choisies dans le ${festivalsLabel} ${tail}:\n`;
            }
          } else {
            presentation = "Voici les meilleures suggestions correspondant à votre demande triées par pertinence:\n";
          }

          const lines = finalList.map((r, i) => {
            const titlePart = r.hyperlien
              ? `[${r.activite}](${r.hyperlien})`
              : `${r.activite}`;

            const noteBlock =
              r.avis && (r.avis.note != null || r.avis.count != null)
                ? ` - ${r.avis.note != null ? r.avis.note + "/10" : "Note ?"}${r.avis.count != null ? ` (${r.avis.count} avis)` : ""}`
                : "";

            const descBlock = r.desc_summary 
              ? `\n- **Description**: ${r.desc_summary}`
              : "";

            const avisBlock = r.avis_summary 
              ? `\n- **Avis**: ${r.avis_summary}`
              : "";

            const moodBlock = r.mood 
              ? `\n- **Mood**: ${r.mood}`
              : "";

            return (
              `${i + 1}. ${titlePart} — ${r.style || "Style inconnu"} — ${r.lieu || ""} ${noteBlock}` +
              `${descBlock}` +
              `${avisBlock}` +
              `${moodBlock}`
            );
          });

          return presentation + lines.join("\n");
        }

        const selectionMode = getSelectionModeFromIntent(intentJson);    // "random" | "scored"
        const limit         = getLimitFromIntent(intentJson, 10);        // nb demandé (ex: 3)
        const meta          = intentJson?.meta || {};
        const scope         = intentJson?.scope || null;
        const festivals     = scope?.festival || [];
        // const searchMode    = meta.search_mode || "simple";              // "simple" | "augmented"

        // isFollowUp: demande en lien avec l’intent précédent (ex: "3 autres", "analyse les mêmes")
        // others: demande de nouveaux résultats
        // sameButModified: nouvelle recherche avec previous_intent modifié  
        const isFollowUp = meta.uses_previous_intent;
        const others = meta.previous_intent_relation === "others";
        const sameButModified = meta.previous_intent_relation === "same_but_modified";

        // Requête sémantique effective
        const semanticQuery =
          intentJson?.semantic?.embedding_query && intentJson.semantic.embedding_query.trim()
            ? intentJson.semantic.embedding_query.trim()
            : raw;

        // Nombre de candidats demandés au worker
        // On demande un peu plus large sur les follow-up pour avoir de quoi éviter les répétitions.
        // const workerLimit = isFollowUp
        //   ? Math.min(limit * 4, 50)
        //   : Math.min(limit * 3, 50);
        const workerLimit = limit;

        // Si demande de nouveaux résultats on enlève les déjà vus 
        let alreadySeen = [];
        if (isFollowUp && others && seenSemanticKeysGlobal && seenSemanticKeysGlobal.size > 0) {
          alreadySeen = [...seenSemanticKeysGlobal]; 
        }

        const filters = intentJson?.filters || null;

        // Filtre et scoring sur index In/Off moins les déja vus (diversification + ranking gérés côté worker)
        const { results, total_matches, is_truncated } = await scoreAISemanticWithFilters(
          semanticQuery,
          alreadySeen,
          workerLimit,
          filters,
          scope,
          selectionMode
        );

        // Met à jour le totalMatches si on n'est pas en follow up
        if (!isFollowUp || (isFollowUp && sameButModified)) totalMatches = total_matches;
        
        if (!results || !results.length) {
          if (others) return "Désolé il n'existe aucun autre spectacle correspondant à votre demande."
          else return "Désolé il n'existe aucun spectacle correspondant à votre demande.";
        }

        let candidateList = results;

        // Liste finale passée à l'étage Explain (index filtré moins les déjà vus si demande de nouveaux résultats)
        const finalList = candidateList.slice(0, limit);
        const isTruncatedFinal = finalList.length < results.length || is_truncated;

        lastSemanticSelection = {
          origin: "global",
          items: finalList
            .map(r => ({
              key:   r._index_key,
              score: Number(r.score) || 0
            }))
            .filter(i => !!i.key),
          intent: intentJson
        };

        const explain = await callAISemanticExplain(raw, semanticQuery, lastSemanticSelection.items);
        lastPresentedResults = explain.results;

        // Marquer les déjà "vus"
        if (!seenSemanticKeysGlobal) {
          seenSemanticKeysGlobal = new Set();
        }
        lastPresentedResults.forEach(r => {
          if (r._index_key) {
            seenSemanticKeysGlobal.add(r._index_key);
          }
        });

        return explain.answer || "Je n'ai pas réussi à analyser ces spectacles.";

      }

      // Gestion de la recherche sémantique locale (planning / stock courant)
      async function handleLocalSemanticSearch(raw, intentJson) {
        function formatResults(finalList) {
          if (!finalList || !finalList.length) {
            return `Je n'ai trouvé aucun spectacle correspondant dans votre ${searchSpaceLabel}.`;
          }

          const lines = finalList.map((p, i) => {
            const r = p.row;
            const style = r.Style || "Style inconnu";
            const lieu  = r.Lieu || "";

            const titlePart = r.Hyperlien
              ? `[${r.Activite}](${r.Hyperlien})`
              : `${r.Activite}`;

            const noteBlock =
              p.avis && (p.avis.note != null || p.avis.count != null)
                ? ` - ${p.avis.note != null ? p.avis.note + "/10" : "Note ?"}${p.avis.count != null ? ` (${p.avis.count} avis)` : ""}`
                : "";

            const descBlock = p.desc_summary 
              ? `\n- **Description**: ${p.desc_summary}`
              : "";

            const avisBlock = p.avis_summary 
              ? `\n- **Avis**: ${p.avis_summary}`
              : "";

            const moodBlock = p.mood 
              ? `\n- **Mood**: ${p.mood}`
              : "";

            return (
              `${i + 1}. ${titlePart} — ${style} — ${lieu} ${noteBlock}` +
              `${descBlock}` +
              `${avisBlock}` +
              `${moodBlock}`
            );

          });

          const tail = pickRandom(PRESENTATION_TAILS);

          let presentation;
          if (!isTruncatedFinal) {
            presentation = `Voici les résultats choisies dans votre ${searchSpaceLabel} ${tail}:\n`;
          } else if (selectionMode === "random") {
            const followUpMarker = isFollowUp ? "autres" : "";
            presentation = `Voici quelques ${followUpMarker} suggestions issues de votre ${searchSpaceLabel} ${tail}:\n`;
          } else {
            presentation = `Voici les meilleures suggestions correspondant à votre demande classées par pertinence:\n`;
          }
          return presentation +
                lines.join("\n");
        }

        const toISO = (di) =>
          di && di >= 19000101
            ? `${String(Math.floor(di / 10000)).padStart(4, "0")}-${String(Math.floor((di / 100) % 100)).padStart(2, "0")}-${String(di % 100).padStart(2, "0")}`
            : null;

        const selectionMode       = getSelectionModeFromIntent(intentJson);           // "random" | "scored"
        const limit               = getLimitFromIntent(intentJson, 10);               // nb demandé
        const searchSpace         = intentJson?.scope?.search_space || "local_stock"; // "local_stock" | "current_schedule"
        const meta                = intentJson?.meta || {};
        const distributionFilter  =intentJson?.filters?.distribution || null
        const moodFilter          =intentJson?.filters?.mood || null
        const kwdFilter           =intentJson?.filters?.keywords || null
        
        const searchSpaceLabel = searchSpace === 'current_schedule' ? 'planning' : 'stock';

        // isFollowUp: demande en lien avec l’intent précédent (ex: "3 autres", "analyse les mêmes")
        // others: demande de nouveaux résultats
        // sameButModified: nouvelle recherche avec previous_intent modifié  
        const isFollowUp =meta.uses_previous_intent;
        const others = meta.previous_intent_relation === "others";
        const sameButModified = meta.previous_intent_relation === "same_but_modified";

        let df = ctx.df;

        if (searchSpace === 'local_stock') {
          df = activitesAPI.getActivitesNonProgrammees(df);
        } else if (searchSpace === 'current_schedule') {
          df = activitesAPI.getActivitesProgrammees(df);
        }
        if (!df.length) {
          return `Désolé je n'ai trouvé aucun spectacle correspondant à votre demande dans votre ${searchSpaceLabel}.`;
        }
        
        // Si demande de nouveaux résultats on enlève les déjà vus 
        if (isFollowUp && others && seenSemanticKeysLocal && seenSemanticKeysLocal.size > 0) {
          df = df.filter(r => { 
            const k = makeFullKey(r); 
            return k && !seenSemanticKeysLocal.has(k) 
          });
        }

        // Filtrage local
        const localRows = filterCurrentScheduleWithIntent(df, intentJson);
        if (!localRows.length) {
          if (others) return `Je n'ai pas trouvé de spectacles supplémentaires correspondant à votre demande dans votre ${searchSpaceLabel}.`;
          else return `Je n'ai pas trouvé de spectacles correspondant à votre demande dans votre ${searchSpaceLabel}.`;
        }

        // key -> [rows du planning local]
        const keyToLocalRows = new Map();

        for (const r of localRows) {
          const k = makeFullKey(r);
          if (!k) continue;
          if (!keyToLocalRows.has(k)) keyToLocalRows.set(k, []);
          keyToLocalRows.get(k).push(r);
        }
       
        // Requête sémantique effective
        const semanticQuery =
          intentJson?.semantic?.embedding_query && intentJson.semantic.embedding_query.trim()
            ? intentJson.semantic.embedding_query.trim()
            : raw;

        // Construction des clés locales + map key -> rows[]
        const keyToRows = new Map();
        const keys = [];

        for (const r of localRows) {
          const k = makeFullKey(r);
          if (!k) continue;
          keys.push(k);
          if (!keyToRows.has(k)) keyToRows.set(k, []);
          keyToRows.get(k).push(r);
        }

        if (!keys.length) {
          return `Je n'ai pas de clé exploitable pour traiter votre ${searchSpaceLabel}.`;
        }

        // Nombre de candidats demandés au worker (plus large sur follow-up pour éviter répétitions)
        // const workerTopK = isFollowUp
        //   ? Math.min(limit * 4, keys.length, 50)
        //   : Math.min(limit * 3, keys.length, 50);
        const workerTopK = limit;

        // Filtrage complémentaire (celui fait côté worker sur données index) et scoring  (diversification/ranking gérés côté worker)
        // @ts-ignore
        const { scores, total_matches, is_truncated } = await scoreAISemanticWithKeys(
          semanticQuery,
          keys,
          workerTopK,
          selectionMode,
          distributionFilter,
          moodFilter,
          kwdFilter
        );

        if (!scores || !scores.length) {
          if (others) return `Je n'ai pas trouvé de spectacles supplémentaires correspondant à votre demande dans votre ${searchSpaceLabel}.`;
          else return `Je n'ai pas trouvé de spectacles correspondant à votre demande dans votre ${searchSpaceLabel}.`;
        }

        // Met à jour le totalMatches si on n'est pas en follow up
        if (!isFollowUp || (isFollowUp && sameButModified)) totalMatches = total_matches;

        let candidateScores = scores;

        // Liste finale passée à l'étage Explain
        const finalScores = candidateScores.slice(0, limit);
        const isTruncatedFinal = finalScores.length < localRows.length || is_truncated;

        const items = [];
        for (const s of finalScores) {
          const key = s.key;
          if (!key) continue;

          const rows = keyToLocalRows.get(key);
          if (!rows || !rows.length) continue;

          for (const r of rows) {
            const dateInt = Number(r.Date) || null;
            items.push({
              key,
              score: Number(s.score) || 0,
              date: toISO(dateInt),         // "YYYY-MM-DD"
            });
          }
        }

        lastSemanticSelection = {
          origin: "local",
          items,          // ✅ [{ key, score }]
          intent: intentJson
        };

        const explain = await callAISemanticExplain(raw, semanticQuery, items);
        lastPresentedResults = explain.results;

        // Marquer les “vus” 
        if (!seenSemanticKeysLocal) {
          seenSemanticKeysLocal = new Set();
        }
        lastPresentedResults.forEach(s => {
          if (s._index_key) seenSemanticKeysLocal.add(s._index_key);
        });

        return explain.answer || "Je n'ai pas réussi à analyser ces spectacles.";

      }

      async function copyInputToClipboard() {
        const text = inputReq.value || "";
        if (!text) return;

        try {
          await navigator.clipboard.writeText(text);
        } catch (err) {
          fallbackCopyInput();
        }
      }

      function fallbackCopyInput() {
        inputReq.select();
        inputReq.setSelectionRange(0, inputReq.value.length); // mobile safe
        document.execCommand("copy");
      }

      // Envoi de requête
      async function send() {
        clearError();
        const raw = (inputReq?.value || "").trim();
        if (!raw) {
          showError("Merci de saisir une requête.");
          inputReq?.focus();
          return;
        }

        // 0) Construit le freeSpeechContext pour callAIQueryUnderstand
        freeSpeechContext = buildContextFromHistory(5); // mémorisation du contexte de chat libre

        // 1) Toujours logguer la question de l'utilisateur
        addMessageToUI({ role: "user", content: raw, mode: "chat" });

        // 2) Reset du champ de saisie
        if (inputReq) {
          await copyInputToClipboard();
          inputReq.value = "";
        }

        // 3) Message "L’IA réfléchit…"
        const thinkingMsg = { role: "assistant", content: "⏳ L’IA réfléchit…", mode: "chat" };
        addMessageToUI(thinkingMsg);

        btnSend.disabled = true;

        try {
          // 4) Analyse d'intention enrichie (/ai/query-understand)
          overlayAttente.hidden = false; // Affiche l'overlay d'attente
          const previousIntent = lastSemanticIntent || null;
          const intentJson = await callAIQueryUnderstand(raw, previousIntent);

          // Ajoute les auteurs et acteurs demandés dans les mots clefs
          mergeAuteursIntoKeywords(intentJson);
          mergeActeursIntoKeywords(intentJson);

          console.log(intentJson);

          lastSemanticIntent = intentJson || null;

          const topIntent      = intentJson?.intent || "unknown";
          const freeAnswer     = intentJson?.free_answer || null;
          const meta           = intentJson?.meta || {};
          
          // isFollowUp: demande en lien avec l’intent précédent (ex: "3 autres", "analyse les mêmes")
          // others: demande de nouveaux résultats
          const isFollowUp = meta.uses_previous_intent;
          const others = meta.previous_intent_relation === "others";

          // Correction de intentJson au cas où le retour de callAIQueryUnderstand est incohérent
          if (isFollowUp && intentJson && previousIntent) {
            intentJson.filters = previousIntent.filters;
            intentJson.scope = previousIntent.scope;
            intentJson.semantic = previousIntent.semantic;            
          }

          const searchSpace    = intentJson?.scope?.search_space || "full_festival";
          const semanticQuery  = intentJson?.semantic?.embedding_query && intentJson.semantic.embedding_query.trim()
              ? intentJson.semantic.embedding_query.trim()
              : raw;

          const isSearch = (topIntent === "search_shows");
          const freeSpeech = (topIntent === "free_speech");

          // 👉 Nouvelle recherche = on ne dépend PAS explicitement de l’intent précédent
          const isNewTopic =
            isSearch &&
            (!meta.uses_previous_intent ||
            meta.previous_intent_relation === "none");

          // Si c'est un nouveau "topic" de recherche, on réinitialise l'historique global
          if (isNewTopic) {
            seenSemanticKeysGlobal = new Set();
            seenSemanticKeysLocal = new Set();
            lastSemanticSelection = null;
          }
          
          // 4bis) Contexte historique pour le mode chat classique
          const histContext = buildContextFromHistory(5);
          
          let replyText = "";

          if (freeSpeech) {
            // 🔵 CAS 1 : Hors intent de recherche de spectacles
            //  💡 On utilise la réponse "libre" fournie par l’analyse d’intention IA
            replyText = freeAnswer;
          } else {
            // 🔵 CAS 2 : Intent de recherche de spectacles
            const canReusePreviousSelection =
              // searchMode === "augmented" &&
              meta.uses_previous_intent &&
              meta.reuse_previous_selection && 
              lastSemanticSelection &&
              Array.isArray(lastSemanticSelection.items) &&
              lastSemanticSelection.items.length > 0;

            if (canReusePreviousSelection) {
              // 🧠 CAS 2a : analyse des spectacles précédemment proposés
              // 💡 On NE refait PAS de recherche : on explique uniquement
              //    les spectacles de la sélection précédente.
              replyText = await callAISemanticExplainWithKeys(raw, semanticQuery, lastSemanticSelection);
            } else {
              // 🟦 CAS 2b : recherche "normale" (simple ou augmented)
              if (topIntent === "search_shows" && !meta.uses_previous_intent) {
                baseUtterance = semanticQuery;
                selectionOrigin = searchSpace; 
              }
              if (searchSpace === "local_stock" || searchSpace === "current_schedule") {
                replyText = await handleLocalSemanticSearch(raw, intentJson);
              } else {
                replyText = await handleGlobalSemanticSearch(raw, intentJson);
              }
            }
          }

          // 5) On enlève "L’IA réfléchit…"
          chatHistory.pop();

          // 6) On ajoute la réponse dans le log
          addMessageToUI({
            role: "assistant",
            content: replyText || "Je n'ai pas réussi à générer de réponse utile.",
            mode: topIntent === "search_shows" ? "semantic" : "chat"
          });

        } catch (e) {
          console.error("AI error in send():", e);
          // On enlève "L’IA réfléchit…"
          chatHistory.pop();
          addMessageToUI({
            role: "assistant",
            content: "Erreur lors de l'appel à l’IA.",
            mode: "chat"
          });
          showError("Erreur lors de l'appel à l’IA.");
        } finally {
          overlayAttente.hidden = true; // Masque l'overlay d'attente
          btnSend.disabled = false;
        }
      }

      // Construction d'une row de df à partir d'un résultat d'index 
      function buildRowFromIndexResult(r) {

        function capitalizeFirst(s) {
          if (!s) return s;
          return s.charAt(0).toUpperCase() + s.slice(1);
        }        

        // r = item renvoyé par le worker (index)
        // adapte si tes noms diffèrent (activite vs Activite, etc.)
        const row = {
          ...PARSED_DEFAULT,

          Activite: r.activite ?? "",
          Style:    r.style ?? "",
          Lieu:     r.lieu ?? "",
          Debut:    r.debut ?? "",
          Duree:    r.duree ?? "",
          Fin:      r.fin ?? "",
          Mood:     r.mood ?? "",

          Hyperlien:   r.hyperlien ?? null,
          HyperlienBR: r.hyperlienBR ?? null,

          Session:  r.session  ?? null,
          Relache:  r.relache  ?? null,

          Orga:     capitalizeFirst(r.section || ""), 
          Reserve:  "Non",
          Date:     null,

          __uuid: crypto.randomUUID(),
          __desc_summary: r.desc_summary,
          __avis_summary: r.avis_summary,
        };

        // (optionnel) cache séances si tu l’utilises :
        // @ts-ignore
        if (Array.isArray(r.seances)) row.__seances = r.seances;

        return row;
      }

      // Handler de collage de résultats 
      function handlePasteChatResultsIntoDf({ dedupe = true } = {}) {
        const df = Array.isArray(ctx?.getDf?.()) ? ctx.getDf() : (Array.isArray(ctx?.df) ? ctx.df : []);
        if (!df.length && !Array.isArray(df)) return;

        const results = Array.isArray(lastPresentedResults) ? lastPresentedResults : [];
        if (!results.length) {
          alert("Aucun résultat à coller (fait d'abord une recherche).");
          return;
        }

        // déduplication par clé (même logique que le worker)
        const existingKeys = new Set(df.map(r => makeFullKey(r)).filter(Boolean));

        const newRows = [];
        for (const r of results) {
          const row = buildRowFromIndexResult(r);
          const k = makeFullKey(row);
          if (dedupe && k && existingKeys.has(k)) continue;
          if (k) existingKeys.add(k);
          newRows.push(row);
        }

        if (!newRows.length) {
          alert("Tous ces spectacles sont déjà présents dans le tableau.");
          return;
        }

        let next = df.concat(newRows);
        next = sortDf(next);

        if (ctx?.setDf) ctx.setDf(next);
        else ctx.df = next;

        alert(`${newRows.length} spectacle(s) ajouté(s) au tableau.`);
      }

      // ===========================
      // Event handlers
      // ===========================

      btnSend?.addEventListener("click", send);

      inputReq?.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" && (ev.metaKey || ev.ctrlKey)) {
          ev.preventDefault();
          send();
        }
        if (ev.key === "Escape") {
          ev.preventDefault();
          close();
        }
      });

      btnReset?.addEventListener("click", () => {
        // 1. Effacer localStorage
        resetAIHistory();

        // 2. Effacer mémoire locale
        chatHistory.length = 0;
        lastSemanticIntent = null;

        // 3. Sauvegarder l'état vide & rafraîchir l'affichage
        saveChatHistoryToStorage(chatHistory);
        renderChat();

        inputReq.value = "";
        // 4. Eventuel feedback
        // showError("Historique réinitialisé.");
        // setTimeout(() => clearError(), 2000);
      });

      btnPaste?.addEventListener("click", () => {
        handlePasteChatResultsIntoDf({ dedupe: true });
      });

      // Premier rendu : on affiche l'historique déjà en storage
      renderChat();
      setTimeout(() => inputReq?.focus(), 20);
    }
  });
}

// Assistant Programmation
export function openSheetAssistantProgrammation() {
  const df    = ctx?.df || [];
  const meta  = ctx?.meta || {};
  const params = meta;
  const aiProg = meta?.aiProgramme || {};

  const globalDebRaw = params.periode_a_programmer_debut || "";
  const globalFinRaw = params.periode_a_programmer_fin   || "";

  // Cache IA pour le programmateur
  let lastIAConstraintsKey = null;
  let lastIACandidateSetKey = null;
  let lastIAScoreMap = null; // Map(indexKey -> score)
  let lastProgQueryText = null;
  let lastProgIntentJson = null;

  function normalizeDateForInput(val) {
    if (!val) return "";
    const s = String(val).trim();

    // Déjà au bon format
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

    // Format "20250721" -> "2025-07-21"
    if (/^\d{8}$/.test(s)) {
      return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
    }

    // Dernier recours : tenter un Date()
    const d = new Date(s);
    if (!isNaN(d.getTime())) {
      return d.toISOString().slice(0, 10);
    }

    return "";
  }

  const globalDeb = normalizeDateForInput(aiProg?.date_min || globalDebRaw);
  const globalFin = normalizeDateForInput(aiProg?.date_max || globalFinRaw);

  const defaultGap = params.MARGE != null ? Number(params.MARGE) : 30;

  openSheetExclusive({
    title: "Assistant programmation",
    panelHeight: "auto",
    panelMaxHeight: "85vh",
    mount: (body, { close }) => {
      body.innerHTML = `
        <div class="form">

          <!-- Description libre, style chat -->
          <div class="ai-chat-container">
            <textarea id="prog-request"
                      class="ai-input"
                      rows="3"
                      placeholder="Ex. : 3 jours, comédies, pas après 22h, max 4 spectacles/jour…">${aiProg.request || ""}</textarea>
          </div>

          <!-- SECTION : Période -->
          <div class="ai-section">
            <div class="form-row">
              <label for="prog-date-min">Début de la période à programmer</label>
              <input id="prog-date-min"
                     type="date"
                     value="${globalDeb}">
            </div>

            <div class="form-row">
              <label for="prog-date-max">Fin de la période à programmer</label>
              <input id="prog-date-max"
                     type="date"
                     value="${globalFin}">
            </div>
          </div>

          <!-- SECTION : Horaires & cadence -->
          <div class="ai-section">
            <div class="form-row">
              <label for="prog-debut-min">Heure de début au plus tôt</label>
              <input id="prog-debut-min"
                     type="time"
                     value="${aiProg.debut_min || "09:00"}">
            </div>

            <div class="form-row">
              <label for="prog-fin-max">Heure de fin au plus tard</label>
              <input id="prog-fin-max"
                     type="time"
                     value="${aiProg.fin_max || "00:00"}">
            </div>

            <div class="form-row">
              <label for="prog-max-par-jour">Max spectacles / jour</label>
              <input id="prog-max-par-jour"
                     type="number"
                     min="1"
                     value="${aiProg.max_par_jour != null ? aiProg.max_par_jour : 4}">
            </div>

            <div class="form-row">
              <label for="prog-gap-minutes">Marge minimale entre spectacles (min)</label>
              <input id="prog-gap-minutes"
                     type="number"
                     min="0"
                     step="5"
                     value="${aiProg.gap_minutes != null ? aiProg.gap_minutes : defaultGap}">
            </div>
            <div class="form-row">
              <label class="ai-checkbox">
                <span>Tenir compte des pauses repas</span>
                <input id="prog-traiter-pauses"
                      type="checkbox"
                      ${aiProg.traiter_pauses ? "checked" : ""}>
                </label>
            </div>
          </div>

          <!-- SECTION : Filtrage -->
          <div class="ai-section">
            <div class="form-row">
              <label class="ai-checkbox">
                <span>Utiliser uniquement les spectacles filtrés</span>
                <input id="prog-use-filters"
                       type="checkbox"
                       ${aiProg.utiliser_filtres_grille ? "checked" : ""}>
              </label>
            </div>

            <div class="form-row">
              <label>Mots-clés style</label>

              <div class="chipbox" id="prog-style-chipbox">
                <div class="chipbox-inputwrap">
                  <input id="prog-style-input" class="chipbox-input bb-input" type="text" placeholder="Ajouter un style…">
                  <datalist id="dl-prog-style"></datalist>
                </div>
                <div class="chipbox-chips" aria-label="styles sélectionnés"></div>
              </div>
            </div>

            <div class="form-row">
              <label>Dosage des styles</label>

              <div class="mixbox">
                <div class="mixbox-head">
                  <div class="mixbox-help">
                    Les % sont un objectif. Si un style manque de spectacles, on complète avec les autres.
                  </div>
                </div>

                <div id="prog-style-mix" class="mixrows"></div>
              </div>
            </div>

            <div class="form-row">
              <label>Mots-clés ton, humeur</label>

              <div class="chipbox" id="prog-mood-chipbox">
                <div class="chipbox-inputwrap">
                  <input id="prog-mood-input" class="chipbox-input bb-input" type="text" placeholder="Ajouter un ton…">
                  <datalist id="dl-prog-mood"></datalist>
                </div>
                <div class="chipbox-chips" aria-label="moods sélectionnés"></div>
              </div>
            </div>

            <div class="form-row">
              <label for="prog-distribution-keywords">Mots-clés auteurs, acteurs</label>
              <input id="prog-distribution-keywords"
                     type="text"
                     class="bb-input"
                     value="${(aiProg.mots_cles_distribution || []).join(", ")}"
                     placeholder="Ex. : noms d'auteurs, acteurs">
            </div>
            
            <div class="form-row">
              <label for="prog-general-keywords">Autres mots-clés</label>
              <input id="prog-general-keywords"
                     type="text"
                     class="bb-input"
                     value="${(aiProg.mots_cles_generaux || []).join(", ")}"
                     placeholder="">
            </div>
            
            <div class="form-row">
              <label for="prog-note-weight">
                Influence de la note : 
                <strong><span id="prog-note-weight-val">
                  ${aiProg.note_weight != null ? aiProg.note_weight : 1}
                </span></strong>
              </label>

              <input id="prog-note-weight"
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value="${aiProg.note_weight != null ? aiProg.note_weight : 1}">
            </div>
          </div>

          <!-- SECTION : Résultat -->
          <div id="prog-response-box"
                class="ai-response-box"
                style="width:100%;"
                hidden>
            <div class="ai-response-label">Programme généré</div>
            <div id="prog-response" class="ai-response-bubble"></div>
          </div>

          <p id="prog-error" class="ai-error" style="display:none;"></p>

        </div>

        <div class="sheet-footer has-border">
          <div class="form-actions">
            <button class="bb-btn" id="btn-prog-cancel">
              Annuler
            </button>
            <button class="bb-btn" id="btn-prog-gen">
              Générer
            </button>
            <button class="bb-btn is-primary" id="btn-prog-apply">
              Appliquer
            </button>
          </div>
        </div>
      `;

      // --- refs DOM
      const elReq      = body.querySelector("#prog-request");
      const elErr      = body.querySelector("#prog-error");
      const elRespBox  = body.querySelector("#prog-response-box");
      const elResp     = body.querySelector("#prog-response");
      const btnApply   = body.querySelector("#btn-prog-apply");
      const btnGen     = body.querySelector("#btn-prog-gen");
      const btnCancel  = body.querySelector("#btn-prog-cancel");

      const elDateMin  = body.querySelector("#prog-date-min");
      const elDateMax  = body.querySelector("#prog-date-max");
      const elDebMin   = body.querySelector("#prog-debut-min");
      const elFinMax   = body.querySelector("#prog-fin-max");
      const elMaxJour  = body.querySelector("#prog-max-par-jour");
      const elGapMin   = body.querySelector("#prog-gap-minutes");
      const eltraitPaus = body.querySelector("#prog-traiter-pauses");
      const elUseFilt  = body.querySelector("#prog-use-filters");
      const elDistKW   = body.querySelector("#prog-distribution-keywords");
      const elGenKW    = body.querySelector("#prog-general-keywords");

      const elNoteW    = body.querySelector("#prog-note-weight");
      const elNoteWV    = body.querySelector("#prog-note-weight-val");

      if (elNoteW && elNoteWV) {
        elNoteWV.textContent = elNoteW.value;

        elNoteW.addEventListener("input", () => {
          elNoteWV.textContent = elNoteW.value;
        });
      }

      // Initialisation des chipboxes (STYLE / MOOD)
      const styleInput = body.querySelector("#prog-style-input");
      const styleBox   = body.querySelector("#prog-style-chipbox");
      const styleDL    = body.querySelector("#dl-prog-style");

      const moodInput  = body.querySelector("#prog-mood-input");
      const moodBox    = body.querySelector("#prog-mood-chipbox");
      const moodDL     = body.querySelector("#dl-prog-mood");

      let _prevStyles = (aiProg?.mots_cles_style || []).slice();

      // Sécurité
      if (!styleInput || !styleBox || !moodInput || !moodBox) {
        console.warn("Chipbox: éléments manquants");
      } else {
        const rows = Array.isArray(ctx?.df) ? ctx.df : [];

        const styleSuggestions = uniqueValuesFromRows(rows, 'Style');
        const chipStyle = createChipBox({
          boxEl: styleBox,
          inputEl: styleInput,
          datalistEl: styleDL,
          initial: aiProg?.mots_cles_style || [],
          suggestions: styleSuggestions,
          onChange: () => {
            styleMixOnStylesChanged();
          }
        });

        const moodSuggestions = uniqueWordsFromRows(rows, 'Mood', { max: 500, sep: ',' });
        const chipMood = createChipBox({
          boxEl: moodBox,
          inputEl: moodInput,
          datalistEl: moodDL,
          initial: aiProg?.mots_cles_mood || [],
          suggestions: moodSuggestions,
          onChange: () => {
            styleMixOnStylesChanged();
          }
        });

        // Exposer pour buildConstraints()
        window._chipProgStyle = chipStyle;
        window._chipProgMood  = chipMood;
      }

      // Initialisation des dosages de styles
      const elStyleMix = body.querySelector("#prog-style-mix");

      function clampPct(x) {
        x = Number(x);
        if (!Number.isFinite(x)) return 0;
        return Math.max(0, Math.min(100, Math.round(x)));
      }

      /** Répartit équitablement 100 sur n styles, en entiers */
      function equalSplit(n) {
        n = Math.max(1, n|0);
        const base = Math.floor(100 / n);
        let rem = 100 - base * n;
        const arr = Array(n).fill(base);
        for (let i = 0; i < n && rem > 0; i++, rem--) arr[i] += 1;
        return arr;
      }

      // Handler de mise à jour des dosages de styles sur changement de style
      function styleMixOnStylesChanged() {
        const styles = window._chipProgStyle?.getValues() || [];
        const prevMixArr = readStyleMixFromUI(); // [{style,pct}]
        const prevMixMap = Object.fromEntries(prevMixArr.map(x => [x.style, clampPct(x.pct)]));

        const prevSet = new Set(_prevStyles);
        const newSet  = new Set(styles);

        const added   = styles.filter(s => !prevSet.has(s));
        const removed = _prevStyles.filter(s => !newSet.has(s));

        let nextMixMap = {};

        // 1) base: reprendre les anciens pcts pour les styles encore là
        for (const s of styles) nextMixMap[s] = clampPct(prevMixMap[s] ?? 0);

        // 2) cas ajout EXACTEMENT d’un style : appliquer TA règle
        if (added.length === 1 && removed.length === 0) {
          const newStyle = added[0];
          const newPct = Math.round(100 / styles.length);
          nextMixMap = rebalanceOthersProportional(nextMixMap, newStyle, newPct);
        } else {
          // suppression ou changements multiples : renormalise “proprement”
          nextMixMap = normalizeTo100KeepRatios(nextMixMap);
        }

        renderStyleMixUI(styles, mapToMixArr(nextMixMap));
        _prevStyles = styles.slice();
      }

      // Transforme un objet en tableau d'objets { style, pct }, en clampant pct.
      function mapToMixArr(m) {
        return Object.entries(m || {}).map(([style, pct]) => ({ style, pct: clampPct(pct) }));
      }

      // Normalisation des dosages de styles
      function normalizeTo100KeepRatios(map) {
        const styles = Object.keys(map || {});
        if (!styles.length) return {};

        const vals = styles.map(s => clampPct(map[s] ?? 0));
        const sum = vals.reduce((a,b)=>a+b,0);

        // tout à 0 => split égal
        if (sum <= 0) {
          const split = equalSplit(styles.length);
          const out = {};
          for (let i=0;i<styles.length;i++) out[styles[i]] = split[i];
          return out;
        }

        // renormalisation + arrondi largest remainder
        const scaled = vals.map(v => v * 100 / sum);
        const flo = scaled.map(v => Math.floor(v));
        let rem = 100 - flo.reduce((a,b)=>a+b,0);

        const frac = scaled
          .map((v,i)=>({i, f:v - Math.floor(v)}))
          .sort((a,b)=>b.f-a.f);

        for (let k=0; k<frac.length && rem>0; k++, rem--) flo[frac[k].i] += 1;

        const out = {};
        for (let i=0;i<styles.length;i++) out[styles[i]] = flo[i];
        return out;
      }

      // Recalcule les dosages de styles
      function rebalanceOthersProportional(pctsByStyle, changedStyle, changedPct) {
        const styles = Object.keys(pctsByStyle);

        const newMap = { ...pctsByStyle };
        newMap[changedStyle] = clampPct(changedPct);

        const others = styles.filter(s => s !== changedStyle);
        const targetOthers = 100 - newMap[changedStyle];

        if (!others.length) return { [changedStyle]: 100 };

        const curSumOthers = others.reduce((a, s) => a + (Number(newMap[s]) || 0), 0);

        // Si les autres étaient à 0, on fait un split égalitaire entre eux
        if (curSumOthers <= 0) {
          const base = Math.floor(targetOthers / others.length);
          let rem = targetOthers - base * others.length;
          for (const s of others) newMap[s] = base;
          for (let i = 0; i < others.length && rem > 0; i++, rem--) newMap[others[i]] += 1;
          return newMap;
        }

        // Répartition proportionnelle + arrondi (Largest Remainder)
        const scaled = others.map(s => ({
          s,
          v: (Number(newMap[s]) || 0) * targetOthers / curSumOthers
        }));

        for (const o of scaled) newMap[o.s] = Math.floor(o.v);

        let rem = targetOthers - others.reduce((a, s) => a + newMap[s], 0);
        scaled.sort((a, b) => (b.v - Math.floor(b.v)) - (a.v - Math.floor(a.v)));

        for (let i = 0; i < scaled.length && rem > 0; i++, rem--) {
          newMap[scaled[i].s] += 1;
        }

        return newMap;
      }

      /**
       * Rend une UI mix en gardant les valeurs existantes si possible.
       * - Si nouveaux styles : on conserve l’existant et on renormalise.
       * - Si suppression : on renormalise.
       */
      function renderStyleMixUI(styles, existingMix = []) {
        if (!elStyleMix) return;

        const prev = new Map((existingMix || []).map(x => [String(x.style), clampPct(x.pct)]));
        elStyleMix.replaceChildren();

        if (!styles.length) return;

        // 1) valeurs initiales : prendre l’existant, sinon 0
        const values = styles.map(st => prev.get(st) ?? 0);

        // --- détecter les styles nouvellement ajoutés
        const added = styles.filter(st => !prev.has(st));

        if (added.length) {
          const n = styles.length;

          // valeur par défaut d’un nouveau style
          const defNew = Math.round(100 / n);

          // appliquer la valeur par défaut aux nouveaux
          for (let i = 0; i < styles.length; i++) {
            if (added.includes(styles[i])) {
              values[i] = defNew;
            }
          }

          // cible pour les anciens
          const sumNew = styles.reduce(
            (s, st, i) => s + (added.includes(st) ? values[i] : 0),
            0
          );
          const targetOld = Math.max(0, 100 - sumNew);

          const oldIdx = styles
            .map((st, i) => ({ st, i }))
            .filter(o => !added.includes(o.st));

          const sumOld = oldIdx.reduce((s, o) => s + (values[o.i] || 0), 0);

          if (oldIdx.length) {
            if (sumOld <= 0) {
              // split égal si anciens à 0
              const base = Math.floor(targetOld / oldIdx.length);
              let rem = targetOld - base * oldIdx.length;
              for (const o of oldIdx) values[o.i] = base;
              for (let k = 0; k < oldIdx.length && rem > 0; k++, rem--) {
                values[oldIdx[k].i] += 1;
              }
            } else {
              // rebalance proportionnel + Largest Remainder
              const scaled = oldIdx.map(o => ({
                i: o.i,
                v: (values[o.i] || 0) * targetOld / sumOld
              }));

              for (const o of scaled) values[o.i] = Math.floor(o.v);

              let rem = targetOld - scaled.reduce((s, o) => s + values[o.i], 0);
              scaled.sort(
                (a, b) => (b.v - Math.floor(b.v)) - (a.v - Math.floor(a.v))
              );

              for (let k = 0; k < scaled.length && rem > 0; k++, rem--) {
                values[scaled[k].i] += 1;
              }
            }
          }

          // correction finale somme = 100
          let s2 = values.reduce((a, b) => a + b, 0);
          let rem2 = 100 - s2;
          const step = rem2 >= 0 ? 1 : -1;
          while (rem2 !== 0) {
            for (let i = 0; i < values.length && rem2 !== 0; i++) {
              const next = values[i] + step;
              if (next >= 0 && next <= 100) {
                values[i] = next;
                rem2 -= step;
              }
            }
            break; // sécurité
          }

        } else {
          // --- comportement existant (pas d’ajout)
          const sum0 = values.reduce((a, b) => a + b, 0);
          if (sum0 === 0) {
            const split = equalSplit(styles.length);
            for (let i = 0; i < styles.length; i++) values[i] = split[i];
          } else {
            const scaled = values.map(v => (v * 100) / sum0);
            const rounded = scaled.map(v => Math.floor(v));
            let rem = 100 - rounded.reduce((a, b) => a + b, 0);
            const frac = scaled
              .map((v, i) => ({ i, f: v - Math.floor(v) }))
              .sort((a, b) => b.f - a.f);

            for (let k = 0; k < frac.length && rem > 0; k++, rem--) {
              rounded[frac[k].i] += 1;
            }
            for (let i = 0; i < styles.length; i++) values[i] = rounded[i];
          }
        }

        // --- rendu UI
        for (let i = 0; i < styles.length; i++) {
          const style = styles[i];
          const pct0 = values[i];

          const row = document.createElement("div");
          row.className = "mixrow";
          row.setAttribute("data-style", style);

          const lab = document.createElement("label");
          lab.textContent = style;

          const inp = document.createElement("input");
          inp.type = "number";
          inp.min = "0";
          inp.max = "100";
          inp.step = "5";
          inp.value = String(pct0);

          row.appendChild(lab);
          row.appendChild(inp);
          elStyleMix.appendChild(row);
        }
      }

      /**
       * Ajuste automatiquement les autres % quand on change un style.
       * - Conserve la valeur du champ modifié.
       * - Répartit l’écart sur les autres, proportionnellement à leur valeur (ou égal si tous 0).
       */
      function rebalanceAfterEdit(changedStyle) {
        if (!elStyleMix) return;

        const mix = readStyleMixFromUI(); // [{style,pct}]
        if (!mix.length) return;

        // clamp + index changed
        for (const x of mix) x.pct = clampPct(x.pct);

        const idx = mix.findIndex(x => x.style === changedStyle);
        if (idx < 0) return;

        const sum = mix.reduce((s,x)=>s+x.pct,0);
        const delta = 100 - sum; // ce qu’il manque (>0) ou ce qu’il faut retirer (<0)
        if (delta === 0) return; 

        // autres indices
        const others = mix.map((x,i)=>i).filter(i => i !== idx);
        if (!others.length) {
          mix[idx].pct = 100;
        } else {
          const weightsSum = others.reduce((s,i)=>s+mix[i].pct,0);

          if (weightsSum === 0) {
            // répartir également sur les autres
            let rem = delta;
            const step = (rem >= 0) ? 1 : -1;
            while (rem !== 0) {
              for (const i of others) {
                if (rem === 0) break;
                const next = mix[i].pct + step;
                if (next >= 0 && next <= 100) {
                  mix[i].pct = next;
                  rem -= step;
                }
              }
              // sécurité anti-boucle infinie
              if (Math.abs(rem) > 2000) break;
            }
          } else {
            // répartir proportionnellement
            const adj = new Array(mix.length).fill(0);
            let applied = 0;

            for (const i of others) {
              const share = delta * (mix[i].pct / weightsSum);
              const a = (delta >= 0) ? Math.floor(share) : Math.ceil(share);
              adj[i] = a;
              applied += a;
            }

            // corriger le reste dû à l’arrondi
            let rem = delta - applied;

            // ordre de distribution : plus gros poids d'abord si delta>0, sinon aussi
            const order = others.slice().sort((a,b)=>mix[b].pct - mix[a].pct);

            const step = (rem >= 0) ? 1 : -1;
            while (rem !== 0) {
              for (const i of order) {
                if (rem === 0) break;
                const next = mix[i].pct + step;
                if (next >= 0 && next <= 100) {
                  mix[i].pct = next;
                  rem -= step;
                }
              }
              if (Math.abs(rem) > 2000) break;
            }

            // appliquer l’ajustement arrondi
            for (const i of others) {
              mix[i].pct = clampPct(mix[i].pct + adj[i]);
            }
          }

          // dernière passe : garantir somme=100 sans négatifs
          // (mini-correction)
          let s2 = mix.reduce((s,x)=>s+x.pct,0);
          let rem2 = 100 - s2;
          const step2 = (rem2 >= 0) ? 1 : -1;
          const order2 = others.slice(); // on évite de toucher changed
          while (rem2 !== 0 && order2.length) {
            for (const i of order2) {
              if (rem2 === 0) break;
              const next = mix[i].pct + step2;
              if (next >= 0 && next <= 100) {
                mix[i].pct = next;
                rem2 -= step2;
              }
            }
            if (Math.abs(rem2) > 2000) break;
          }
        }

        // réinjecte dans les inputs
        for (const row of elStyleMix.querySelectorAll("[data-style]")) {
          const style = row.getAttribute("data-style") || "";
          const input = row.querySelector("input");
          const x = mix.find(m => m.style === style);
          if (input && x) input.value = String(clampPct(x.pct));
        }
      }

      /** @returns {{style:string, pct:number}[]} */
      function readStyleMixFromUI() {
        if (!elStyleMix) return [];
        const rows = Array.from(elStyleMix.querySelectorAll("[data-style]"));
        const out = [];
        for (const row of rows) {
          const style = row.getAttribute("data-style") || "";
          const input = row.querySelector("input");
          const pct = input ? Number(input.value) : NaN;
          if (style) out.push({ style, pct: clampPct(pct) });
        }
        return out;
      }

      // Listener : quand l’utilisateur change un %
      elStyleMix?.addEventListener("input", (ev) => {
        const t = /** @type {HTMLElement} */ (ev.target);
        if (!t || t.tagName.toLowerCase() !== "input") return;
        const row = t.closest("[data-style]");
        const style = row?.getAttribute("data-style");
        if (!style) return;
        rebalanceAfterEdit(style);
      });

      // 1) rendu initial des dosages de styles
      renderStyleMixUI(window._chipProgStyle?.getValues() || [], aiProg?.style_mix || []);

      // Normalisation token
      function normToken(s) {
        return String(s ?? "")
          .trim()
          .replace(/\s+/g, " ");
      }

      // Normalisation clef
      function normKey(s) {
        // pour dédoublonner : insensible casse + accents
        return normToken(s)
          .normalize("NFD")
          .replace(/\p{Diacritic}/gu, "")
          .toLowerCase();
      }

      // Extrait les lignes uniques d'un tableau
      function uniqueValuesFromRows(rows, field, { max = 500, includeEmpty = false } = {}) {
        const set = new Set();
        for (const r of rows || []) {
          let v = r && r[field];
          if (v == null || v === '') { if (!includeEmpty) continue; v = '∅'; }
          set.add(String(v));
          if (set.size >= max) break;
        }
        return [...set].sort((a,b) => a.localeCompare(b,'fr',{numeric:true,sensitivity:'base'}));
      }

      // Extrait les mots uniques d'un tableau
      function uniqueWordsFromRows(rows, field, { max = 500, sep = ',' } = {}) {
        const raw = uniqueValuesFromRows(rows, field, { max });
        const set = new Set();
        for (const v of raw) {
          if (!v) continue;
          const parts = String(v).split(sep);
          for (const p of parts) {
            const w = p.trim();
            if (!w) continue;
            set.add(w);
            if (set.size >= max) break;
          }
          if (set.size >= max) break;
        }
        return [...set].sort((a,b) => a.localeCompare(b,'fr',{numeric:true,sensitivity:'base'}));
      }

      // /**
      //  * Creation d'une chipbox 
      //  * @param {{
      //  *   boxEl: HTMLElement,
      //  *   inputEl: HTMLInputElement,
      //  *   datalistEl?: HTMLDataListElement|null,
      //  *   initial?: string[],
      //  *   suggestions?: string[],
      //  *   onChange?: function,
      //  * }} args
      //  */
      // function createChipBox({ boxEl, inputEl, datalistEl = null, initial = [], suggestions = [], onChange=null }) {
      //   const chipsEl = /** @type {HTMLElement} */ (boxEl.querySelector(".chipbox-chips"));
      //   const map = new Map(); // key -> label (original)

      //   function render() {
      //     chipsEl.replaceChildren();
      //     for (const label of map.values()) {
      //       const chip = document.createElement("span");
      //       chip.className = "chip";
      //       chip.textContent = label;

      //       const btn = document.createElement("button");
      //       btn.type = "button";
      //       btn.setAttribute("aria-label", `Supprimer ${label}`);
      //       btn.textContent = "✕";
      //       btn.addEventListener("click", (ev) => {
      //         ev.preventDefault();
      //         ev.stopPropagation();
      //         map.delete(normKey(label));
      //         render();
      //         renderStyleMixUI(window._chipProgStyle?.getValues() || [], readStyleMixFromUI());
      //       });

      //       chip.appendChild(btn);
      //       chipsEl.appendChild(chip);
      //     }
      //   }

      //   function addToken(raw) {
      //     const label = normToken(raw);
      //     if (!label) return;
      //     const key = normKey(label);
      //     if (!key) return;
      //     if (map.has(key)) return; // anti doublon
      //     map.set(key, label);
      //     render();
      //     renderStyleMixUI(window._chipProgStyle?.getValues() || [], readStyleMixFromUI());
      //     if (typeof onChange === "function") {
      //       try { onChange(getValues()); } catch {}
      //     }
      //   }

      //   function removeToken(raw) {
      //     const key = normKey(raw);
      //     map.delete(key);
      //     render();
      //     renderStyleMixUI(window._chipProgStyle?.getValues() || [], readStyleMixFromUI());
      //     if (typeof onChange === "function") {
      //       try { onChange(getValues()); } catch {}
      //     }
      //   }

      //   function setValues(arr) {
      //     map.clear();
      //     for (const v of (arr || [])) addToken(v);
      //     render();
      //     renderStyleMixUI(window._chipProgStyle?.getValues() || [], readStyleMixFromUI());
      //     if (typeof onChange === "function") {
      //       try { onChange(getValues()); } catch {}
      //     }
      //   }

      //   function getValues() {
      //     return Array.from(map.values());
      //   }

      //   function setSuggestions(arr) {
      //     if (!datalistEl) return;

      //     datalistEl.replaceChildren();

      //     // 1) Normalise + dédoublonne
      //     const uniq = new Map(); // key -> label
      //     for (const s of arr || []) {
      //       const label = normToken(s);
      //       const key = normKey(label);
      //       if (!label || !key) continue;
      //       if (uniq.has(key)) continue;
      //       uniq.set(key, label);
      //     }

      //     // 2) Enlève les déjà sélectionnés
      //     for (const [k] of map) {
      //       uniq.delete(k);
      //     }

      //     // 3) Remplit le datalist
      //     for (const label of uniq.values()) {
      //       const opt = document.createElement("option");
      //       opt.value = label;
      //       datalistEl.appendChild(opt);
      //     }
      //   }

      //   function refreshSuggestionsForOpen() {
      //     setSuggestions(suggestions);
      //   }


      //   // clic sur la box -> focus input
      //   boxEl.addEventListener("click", (ev) => {
      //     const t = /** @type {HTMLElement} */ (ev.target);
      //     if (!t) return;

      //     // Ne focus que si on tape sur input (ou dedans)
      //     if (t === inputEl || t.closest?.("input") === inputEl)
      //       inputEl.focus();
      //     // if (t?.tagName?.toLowerCase() === "button") return;
      //     // inputEl.focus();
      //   });

      //   // Entrée ou virgule => créer chip
      //   inputEl.addEventListener("keydown", (ev) => {
      //     if (ev.key === "Enter" || ev.key === ",") {
      //       ev.preventDefault();
      //       addToken(inputEl.value);
      //       inputEl.value = "";
      //     } else if (ev.key === "Backspace" && !inputEl.value) {
      //       // backspace dans champ vide => supprime la dernière chip
      //       const last = Array.from(map.values()).pop();
      //       if (last) removeToken(last);
      //     }
      //   });

      //   // si l'utilisateur choisit une option du datalist, ça met la value dans l'input
      //   // => on la convertit immédiatement en chip
      //   inputEl.addEventListener("change", () => {
      //     const v = inputEl.value;
      //     if (!v) return;
      //     addToken(v);
      //     inputEl.value = "";
      //   });

      //   // Rafraîchir UNIQUEMENT au moment où le navigateur va potentiellement ouvrir le datalist
      //   inputEl.addEventListener("pointerdown", refreshSuggestionsForOpen);
      //   inputEl.addEventListener("focus", refreshSuggestionsForOpen);
      //   inputEl.addEventListener("keydown", (ev) => {
      //     if (ev.key === "ArrowDown") refreshSuggestionsForOpen();
      //   });

      //   // init
      //   if (datalistEl) {
      //     // relier input -> datalist
      //     if (datalistEl.id) inputEl.setAttribute("list", datalistEl.id);
      //     setSuggestions(suggestions);
      //   }
      //   // setValues(initial);

      //   return { addToken, setValues, getValues, setSuggestions };
      // }
/**
 * createChipBox 
 * - Mode natif : datalists natives
 * - Mode custom : datalists natives remplacées par dropdown custom (pour contourner errances IOS)
 *
 * @param {{
 *   boxEl: HTMLElement,
 *   inputEl: HTMLInputElement,
 *   datalistEl?: HTMLDataListElement|null,
 *   initial?: string[],
 *   suggestions?: string[],
 *   onChange?: Function|null,
 *   useCustomDropdown?: boolean,     // force custom (sinon auto iOS)
 *   scrollerEl?: HTMLElement|null,
 * }} args
 */
function createChipBox({
  boxEl,
  inputEl,
  datalistEl = null,
  initial = [],
  suggestions = [],
  onChange = null,
  useCustomDropdown = undefined,
  scrollerEl = null,
}) {

  /**
   * Version avec datalists natives
   */
  function initChipBoxNative({ boxEl, inputEl, datalistEl = null, initial = [], suggestions = [], onChange = null }) {
    const chipsEl = /** @type {HTMLElement} */ (boxEl.querySelector(".chipbox-chips"));
    const map = new Map(); // key -> label (original)

    function render() {
      chipsEl.replaceChildren();
      for (const label of map.values()) {
        const chip = document.createElement("span");
        chip.className = "chip";
        chip.textContent = label;

        const btn = document.createElement("button");
        btn.type = "button";
        btn.setAttribute("aria-label", `Supprimer ${label}`);
        btn.textContent = "✕";
        btn.addEventListener("click", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          map.delete(normKey(label));
          render();
          renderStyleMixUI(window._chipProgStyle?.getValues() || [], readStyleMixFromUI());
        });

        chip.appendChild(btn);
        chipsEl.appendChild(chip);
      }
    }

    function addToken(raw) {
      const label = normToken(raw);
      if (!label) return;
      const key = normKey(label);
      if (!key) return;
      if (map.has(key)) return; // anti doublon
      map.set(key, label);
      render();
      renderStyleMixUI(window._chipProgStyle?.getValues() || [], readStyleMixFromUI());
      if (typeof onChange === "function") {
        try { onChange(getValues()); } catch {}
      }
    }

    function removeToken(raw) {
      const key = normKey(raw);
      map.delete(key);
      render();
      renderStyleMixUI(window._chipProgStyle?.getValues() || [], readStyleMixFromUI());
      if (typeof onChange === "function") {
        try { onChange(getValues()); } catch {}
      }
    }

    function setValues(arr) {
      map.clear();
      for (const v of (arr || [])) addToken(v);
      render();
      renderStyleMixUI(window._chipProgStyle?.getValues() || [], readStyleMixFromUI());
      if (typeof onChange === "function") {
        try { onChange(getValues()); } catch {}
      }
    }

    function getValues() {
      return Array.from(map.values());
    }

    function setSuggestions(arr) {
      if (!datalistEl) return;

      datalistEl.replaceChildren();

      // 1) Normalise + dédoublonne
      const uniq = new Map(); // key -> label
      for (const s of arr || []) {
        const label = normToken(s);
        const key = normKey(label);
        if (!label || !key) continue;
        if (uniq.has(key)) continue;
        uniq.set(key, label);
      }

      // 2) Enlève les déjà sélectionnés
      for (const [k] of map) {
        uniq.delete(k);
      }

      // 3) Remplit le datalist
      for (const label of uniq.values()) {
        const opt = document.createElement("option");
        opt.value = label;
        datalistEl.appendChild(opt);
      }
    }

    function refreshSuggestionsForOpen() {
      setSuggestions(suggestions);
    }

    // clic sur la box -> focus input
    boxEl.addEventListener("click", (ev) => {
      const t = /** @type {HTMLElement} */ (ev.target);
      if (!t) return;

      // Ne focus que si on tape sur input (ou dedans)
      if (t === inputEl || t.closest?.("input") === inputEl)
        inputEl.focus();
    });

    // Entrée ou virgule => créer chip
    inputEl.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === ",") {
        ev.preventDefault();
        addToken(inputEl.value);
        inputEl.value = "";
      } else if (ev.key === "Backspace" && !inputEl.value) {
        // backspace dans champ vide => supprime la dernière chip
        const last = Array.from(map.values()).pop();
        if (last) removeToken(last);
      }
    });

    // si l'utilisateur choisit une option du datalist, ça met la value dans l'input
    // => on la convertit immédiatement en chip
    inputEl.addEventListener("change", () => {
      const v = inputEl.value;
      if (!v) return;
      addToken(v);
      inputEl.value = "";
    });

    // Rafraîchir UNIQUEMENT au moment où le navigateur va potentiellement ouvrir le datalist
    inputEl.addEventListener("pointerdown", refreshSuggestionsForOpen);
    inputEl.addEventListener("focus", refreshSuggestionsForOpen);
    inputEl.addEventListener("keydown", (ev) => {
      if (ev.key === "ArrowDown") refreshSuggestionsForOpen();
    });

    // init
    if (datalistEl) {
      // relier input -> datalist
      if (datalistEl.id) inputEl.setAttribute("list", datalistEl.id);
      setSuggestions(suggestions);
    }

    return { addToken, setValues, getValues, setSuggestions };
  }

  /**
   * Version custom avec datalists natives remplacées par dropdown custom
   */
  function initChipBoxCustom({ boxEl, inputEl, datalistEl = null, initial = [], suggestions = [], onChange = null, scrollerEl = null }) {
    const chipsEl = /** @type {HTMLElement} */ (boxEl.querySelector(".chipbox-chips"));
    const map = new Map(); // key -> label

    // --- iOS detection (simple & suffisante ici)
    const isIOS =
      /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

    // --- Choix : custom dropdown ?
    // Si non précisé => auto: iOS => custom, sinon natif
    const useCustom = (useCustomDropdown != null) ? !!useCustomDropdown : isIOS;

    // --- Dropdown custom (si activé)
    /** @type {HTMLElement | null} */
    let dd = null;                // container
    let isOpen = false;
    let filtered = [];            // suggestions filtrées et non sélectionnées
    let activeIndex = 0;

    // ============ Helpers UI ============
    function renderChips() {
      chipsEl.replaceChildren();

      for (const label of map.values()) {
        const chip = document.createElement("span");
        chip.className = "chip";
        chip.textContent = label;

        const btn = document.createElement("button");
        btn.type = "button";
        btn.setAttribute("aria-label", `Supprimer ${label}`);
        btn.textContent = "✕";
        btn.addEventListener("click", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          map.delete(normKey(label));
          renderChips();
          // ton hook UI
          renderStyleMixUI(window._chipProgStyle?.getValues() || [], readStyleMixFromUI());
          if (typeof onChange === "function") {
            try { onChange(getValues()); } catch {}
          }
          // refresh suggestions
          refreshSuggestions();
        });

        chip.appendChild(btn);
        chipsEl.appendChild(chip);
      }
    }

    function getValues() {
      return Array.from(map.values());
    }

    function addToken(raw) {
      const label = normToken(raw);
      if (!label) return;
      const key = normKey(label);
      if (!key) return;
      if (map.has(key)) return;

      map.set(key, label);
      renderChips();
      renderStyleMixUI(window._chipProgStyle?.getValues() || [], readStyleMixFromUI());

      if (typeof onChange === "function") {
        try { onChange(getValues()); } catch {}
      }
      refreshSuggestions();
    }

    function removeToken(raw) {
      map.delete(normKey(raw));
      renderChips();
      renderStyleMixUI(window._chipProgStyle?.getValues() || [], readStyleMixFromUI());

      if (typeof onChange === "function") {
        try { onChange(getValues()); } catch {}
      }
      refreshSuggestions();
    }

    function setValues(arr) {
      map.clear();
      for (const v of (arr || [])) {
        const label = normToken(v);
        const key = normKey(label);
        if (!label || !key) continue;
        if (!map.has(key)) map.set(key, label);
      }
      renderChips();
      renderStyleMixUI(window._chipProgStyle?.getValues() || [], readStyleMixFromUI());

      if (typeof onChange === "function") {
        try { onChange(getValues()); } catch {}
      }
      refreshSuggestions();
    }

    // ============ Suggestions (source) ============
    function normalizeSuggestionList(arr) {
      const uniq = new Map(); // key -> label
      for (const s of (arr || [])) {
        const label = normToken(s);
        const key = normKey(label);
        if (!label || !key) continue;
        if (!uniq.has(key)) uniq.set(key, label);
      }
      // enlever les déjà sélectionnés
      for (const k of map.keys()) uniq.delete(k);
      return Array.from(uniq.values());
    }

    function refreshSuggestions() {
      // 1) calculer filtered (pour custom)
      const all = normalizeSuggestionList(suggestions);
      const q = normToken(inputEl.value || "").toLowerCase();

      if (!q) {
        filtered = all;
      } else {
        filtered = all.filter(x => x.toLowerCase().includes(q));
      }

      // reset active index propre
      if (activeIndex >= filtered.length) activeIndex = 0;

      // 2) mettre à jour datalist (pour natif) — uniquement si custom OFF
      if (!useCustom && datalistEl) {
        datalistEl.replaceChildren();
        for (const label of all) {
          const opt = document.createElement("option");
          opt.value = label;
          datalistEl.appendChild(opt);
        }
      }

      // 3) rendre le custom si présent
      if (dd) renderDD();
    }

    function refreshAndOpenDD() {
        refreshSuggestions();
        if (filtered.length) openDD();
    }

    // ============ Dropdown custom ============
    function ensureDD() {
      if (!useCustom) return null;
      if (dd) return dd;

      dd = document.createElement("div");
      dd.className = "chipbox-dd";
      dd.setAttribute("role", "listbox");
      dd.setAttribute("aria-label", "Suggestions");

      const wrap = inputEl.closest(".chipbox-inputwrap") || boxEl;
      wrap.appendChild(dd);

      return dd;
    }

    function openDD() {
      if (!dd) return;
      dd.classList.add("open");
      isOpen = true;
    }

    function closeDD() {
      if (!dd) return;
      dd.classList.remove("open");
      isOpen = false;
    }

    function setActive(idx) {
      activeIndex = Math.max(0, Math.min(filtered.length - 1, idx));
      if (dd) renderDD();
    }

    function selectLabel(label) {
      addToken(label);
      inputEl.value = "";
      // 🔥 important : garder focus + réouvrir sans taper (fix critique #1)
      inputEl.focus({ preventScroll: true });
      refreshSuggestions();
      openDD();
    }

    function renderDD() {
      if (!dd) return;
      dd.replaceChildren();

      // rien => ferme
      if (!filtered.length) {
        closeDD();
        return;
      }

      const list = document.createElement("div");
      list.className = "chipbox-ddlist";

      filtered.forEach((label, idx) => {
        const it = document.createElement("div");
        it.className = "chipbox-dditem" + (idx === activeIndex ? " is-active" : "");
        it.setAttribute("role", "option");
        it.setAttribute("aria-selected", idx === activeIndex ? "true" : "false");
        it.textContent = label;

        // survol => highlight (critique #2)
        it.addEventListener("pointerenter", () => setActive(idx));

        list.appendChild(it);
      });

      dd.appendChild(list);
    }

    function scrollInputIntoView() {
      const sc = scrollerEl || boxEl.closest(".sheet-body, .modal-body, .bb-sheet-body, .sheet-content, .sheet") || null;
      // on tente un scroll “gentil”
      try {
        inputEl.scrollIntoView({ block: "nearest", inline: "nearest" });
        if (sc && typeof sc.scrollTo === "function") {
          // petit ajustement si besoin (optionnel)
        }
      } catch {}
    }

function installKeyboardViewportFix() {
  const vv = window.visualViewport;
  if (!vv) return () => {};

  const sc = scrollerEl
    || boxEl.closest(".sheet-body, .modal-body, .bb-sheet-body, .sheet-content, .sheet")
    || document.scrollingElement
    || document.documentElement;

  if (!(sc instanceof HTMLElement)) return () => {};

  const basePad = parseFloat(getComputedStyle(sc).paddingBottom || "0") || 0;

  function apply() {
    // hauteur “mangée” par clavier = innerHeight - visualViewport.height - offsetTop
    const kb = Math.max(0, (window.innerHeight - vv.height - vv.offsetTop));
    sc.style.paddingBottom = `${basePad + kb + 12}px`; // +12 pour respirer

    // remonte l’input si besoin (après layout)
    requestAnimationFrame(() => {
      try { inputEl.scrollIntoView({ block: "center", inline: "nearest" }); } catch {}
    });
  }

  function reset() {
    sc.style.paddingBottom = `${basePad}px`;
  }

  vv.addEventListener("resize", apply);
  vv.addEventListener("scroll", apply);

  inputEl.addEventListener("focus", apply, { passive: true });
  inputEl.addEventListener("blur", reset, { passive: true });

  return () => {
    vv.removeEventListener("resize", apply);
    vv.removeEventListener("scroll", apply);
    inputEl.removeEventListener("focus", apply);
    inputEl.removeEventListener("blur", reset);
    reset();
  };
}

function getClientXY(ev) {
  // PointerEvent / MouseEvent
  if (typeof ev.clientX === "number" && typeof ev.clientY === "number") {
    return { x: ev.clientX, y: ev.clientY };
  }
  // TouchEvent (fallback)
  const t = ev.changedTouches?.[0] || ev.touches?.[0];
  if (t) return { x: t.clientX, y: t.clientY };
  return null;
}

function onGlobalPick(ev) {
  if (!isOpen) return;

  const xy = getClientXY(ev);
  if (!xy) { closeDD(); return; }

  const hit = document.elementFromPoint(xy.x, xy.y);
  if (!(hit instanceof Element)) { closeDD(); return; }

  // 1) item dropdown => select
  const item = hit.closest(".chipbox-dditem");
  if (item && dd && dd.contains(item)) {
    ev.preventDefault();
    ev.stopImmediatePropagation();
    addToken(item.textContent || "");
    inputEl.value = "";
    closeDD();
    inputEl.focus({ preventScroll: true });
    return;
  }

  // 2) tap dans input => (ré)ouvrir
  if (hit === inputEl || inputEl.contains(hit)) {
    ev.preventDefault();
    ev.stopImmediatePropagation();
    refreshAndOpenDD();
    return;
  }

  // 3) tap dans le wrap input (mais pas input) => fermer
  const wrap = hit.closest(".chipbox-inputwrap");
  if (wrap && boxEl && boxEl.contains(wrap)) {
    closeDD();
    return;
  }

  // 4) inside chipbox => ne pas fermer
  if (boxEl && boxEl.contains(hit)) return;
  if (dd && dd.contains(hit)) return;

  closeDD();
}
    // ============ Wiring datalist natif ============
    if (!useCustom && datalistEl && datalistEl.id) {
      inputEl.setAttribute("list", datalistEl.id);
    } else {
      // iOS/custom : on évite que le natif se déclenche
      inputEl.removeAttribute("list");
    }

    // ============ Listeners (UNIFIÉS, sans if(useCustom) partout) ============
    // click sur box => focus input si click sur input
    boxEl.addEventListener("click", (ev) => {
      const t = /** @type {HTMLElement} */ (ev.target);
      if (!t) return;
      if (t === inputEl || t.closest?.("input") === inputEl) {
        inputEl.focus({ preventScroll: true });
      }
    });

    // input / focus : doit ouvrir la dropdown même sans taper 
    inputEl.addEventListener("focus", () => {
      ensureDD();          // si custom => crée dd; sinon dd reste null
      refreshSuggestions();
      if (dd) openDD();
      scrollInputIntoView();
    });

    inputEl.addEventListener("input", () => {
      refreshSuggestions();
      if (dd) openDD();
    });

    inputEl.addEventListener("pointerup", () => {
      refreshAndOpenDD();
    }, { passive: true });

    inputEl.addEventListener("click", () => {
      refreshAndOpenDD();
    });

    // Entrée / virgule => chip
    inputEl.addEventListener("keydown", (ev) => {
      // navigation dropdown custom si ouverte
      if (dd && isOpen && filtered.length) {
        if (ev.key === "ArrowDown") {
          ev.preventDefault();
          setActive(activeIndex + 1);
          refreshAndOpenDD();
          return;
        }
        if (ev.key === "ArrowUp") {
          ev.preventDefault();
          setActive(activeIndex - 1);
          return;
        }
        if (ev.key === "Enter") {
          ev.preventDefault();
          const pick = filtered[activeIndex];
          if (pick) selectLabel(pick);
          return;
        }
        if (ev.key === "Escape") {
          closeDD();
          return;
        }
      }

      // création chip (mode normal)
      if (ev.key === "Enter" || ev.key === ",") {
        ev.preventDefault();
        if (inputEl.value) addToken(inputEl.value);
        inputEl.value = "";
        refreshSuggestions();
        if (dd) openDD();
      } else if (ev.key === "Backspace" && !inputEl.value) {
        const last = Array.from(map.values()).pop();
        if (last) removeToken(last);
      }
    });

    // natif datalist : change => chip
    inputEl.addEventListener("change", () => {
      // Si custom : “change” peut arriver, mais on ignore (on gère via dd)
      if (dd) return;

      const v = inputEl.value;
      if (!v) return;
      addToken(v);
      inputEl.value = "";
      refreshSuggestions();
    });

    // document.addEventListener("pointerdown", (ev) => {
    //   if (!isOpen) return;

    //   const hit = document.elementFromPoint(ev.clientX, ev.clientY);
    //   if (!(hit instanceof Element)) {
    //     closeDD();
    //     return;
    //   }

    //   // ✅ 1) clic sur un item => sélection (ICI)
    //   const item = hit.closest(".chipbox-dditem");
    //   if (item && dd && dd.contains(item)) {
    //     ev.preventDefault();
    //     ev.stopImmediatePropagation(); // stoppe tout le reste (autres chipbox comprises)
    //     addToken(item.textContent || "");
    //     inputEl.value = "";
    //     closeDD();
    //     // optionnel mais souvent utile après sélection
    //     inputEl.focus();
    //     return;
    //   }

    //   // ✅ 1bis) clic sur l'input => (ré)ouvrir même si déjà focus
    //   if (hit === inputEl || inputEl.contains(hit)) {
    //     ev.preventDefault(); // évite des bizarreries iOS / sélection texte
    //     ev.stopImmediatePropagation();
    //     refreshAndOpenDD();    // <-- c'est LA différence
    //     return;
    //   }

    //   // ✅ 1ter) clic dans le wrap de l'input (mais pas dans l'input) => fermer
    //   const wrap = hit.closest(".chipbox-inputwrap");
    //   if (wrap && boxEl && boxEl.contains(wrap)) {
    //     closeDD();
    //     return;
    //   }

    //   // ✅ 2) clic à l'intérieur de cette chipbox => on ne ferme pas
    //   if (boxEl && boxEl.contains(hit)) return;
    //   if (dd && dd.contains(hit)) return;

    //   // ✅ 3) clic dehors => fermer
    //   closeDD();
    // }, { capture: true, passive: false });

// ⚠️ Important : écoute sur pointerup + touchend (pas seulement pointerdown)
document.addEventListener("pointerup", onGlobalPick, { capture: true, passive: false });
document.addEventListener("touchend", onGlobalPick, { capture: true, passive: false });

    // ============ API / init ============
    // init suggestions
    ensureDD(); // si custom => créé maintenant (sinon no-op)
    refreshSuggestions();

let cleanupViewportFix = () => {};
if (useCustom) cleanupViewportFix = installKeyboardViewportFix();

    // init values
    if (initial && initial.length) setValues(initial);

    return {
      addToken,
      removeToken,
      setValues,
      getValues,
      setSuggestions(arr) {
        suggestions = Array.isArray(arr) ? arr.slice() : [];
        refreshSuggestions();
      },
      destroy() {
try { cleanupViewportFix?.(); } catch {}
        try { dd?.remove(); } catch {}
        dd = null;
        isOpen = false;
      }
    };
  }

  // --- iOS detection (simple & suffisante ici)
  const isIOS =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

  // --- Choix : custom dropdown ?
  // Si non précisé => auto: iOS => custom, sinon natif
  const useCustom = (useCustomDropdown != null) ? !!useCustomDropdown : isIOS;

  if (useCustom) {
    return initChipBoxCustom({
      boxEl,
      inputEl,
      datalistEl,
      initial,
      suggestions,
      onChange,
      scrollerEl,
    });
  }

  else return initChipBoxNative({
    boxEl,
    inputEl,
    datalistEl,
    initial,
    suggestions,
    onChange,
  });
}

      btnApply.disabled = true;
      let progError = true;
      let selectedByDay = new Map();

      // Map<slotKey, boolean> implicite : un Set des slots EXCLUS
      let excludedKeys = new Set();

      // Génère une clé unique pour un créneau horaire en combinant __uuid, dayInt, et startMin.
      function slotKey(dayInt, slot) {
        const r = slot.row || {};
        return `${r.__uuid || ''}|${dayInt}|${slot.startMin ?? ''}`;
      }

      const showError = (msg) => {
        elErr.textContent = msg || "";
        elErr.style.display = msg ? "block" : "none";
      };
      const clearError = () => showError("");

      // Extrait et nettoie les mots-clés d'une chaîne d'entrée, séparés par des virgules.
      const parseKeywords = (inputEl) => {
        const raw = (inputEl?.value || "").trim();
        if (!raw) return [];
        return raw.split(",").map(s => s.trim()).filter(Boolean);
      };

      // Construit une structure de contraintes de programmation en fonction de l'UI
      function buildConstraints() {
        const noteWeight = elNoteW
          ? Math.min(1, Math.max(0, Number(elNoteW.value) || 0))
          : 0;
        const styleMix = readStyleMixFromUI();
        const constraints = {
          request: elReq.value || "",
          date_min: dateToDateint(elDateMin.value),
          date_max: dateToDateint(elDateMax.value),
          debut_min: elDebMin.value || null,
          fin_max: elFinMax.value || null,
          max_par_jour: elMaxJour.value ? Number(elMaxJour.value) : null,
          gap_minutes: elGapMin.value ? Number(elGapMin.value) : defaultGap,
          traiter_pauses: !!eltraitPaus.checked, 
          utiliser_filtres_grille: !!elUseFilt.checked,
          mots_cles_style: window._chipProgStyle?.getValues() || [],
          style_mix: styleMix,   
          mots_cles_mood:  window._chipProgMood?.getValues()  || [],
          mots_cles_distribution: parseKeywords(elDistKW),
          mots_cles_generaux: parseKeywords(elGenKW),
          note_weight: noteWeight,
          exclure_deja_programmes: true
        };
        return constraints;
      }

      // Sauvegarde les préférences
      function savePrefs(constraints) {
        try {
          if (ctx && typeof ctx.updMetaParams === "function") {
            ctx.updMetaParams({
              aiProgramme: { ...constraints }
            });
          } else if (ctx && typeof ctx.setMeta === "function") {
            ctx.setMeta({
              ...(ctx.meta || {}),
              aiProgramme: { ...constraints }
            });
          } else if (ctx && ctx.meta) {
            ctx.meta.aiProgramme = { ...constraints };
          }
        } catch (e) {
          console.warn("Impossible de sauvegarder aiProgramme dans meta:", e);
        }
      }

      // Conversion de constraints.debut_min en minutes
      function debutMinToMinutes(debut_min) {
        return debut_min ? mmFromHHhMM(debut_min) : null;
      }

      // Conversion de constraints.fin_max en minutes
      // Par convention constraints.fin_max à "00:00" signifie pas de contrainte de fin donc null converti en minutes
      function finMaxToMinutes(fin_max) {
        return fin_max ? 
        (mmFromHHhMM(fin_max) !== 0) ? mmFromHHhMM(fin_max) : null 
        : null; 
      }

      // Ajoute un jour à une date au format YYYYMMDD et retourne le nouveau format YYYYMMDD.
      function addOneDayDateint(dateInt) {
        const s = String(dateInt);
        if (s.length !== 8) return dateInt;
        const year  = Number(s.slice(0, 4));
        const month = Number(s.slice(4, 6)) - 1; // JS: 0-11
        const day   = Number(s.slice(6, 8));

        const d = new Date(year, month, day);
        d.setDate(d.getDate() + 1);

        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, "0");
        const dd = String(d.getDate()).padStart(2, "0");
        return Number(`${y}${m}${dd}`);
      }

      // Gère le conflit avec marge
      function slotsConflict(s1, e1, s2, e2, gap = 0) {
        if (s1 == null || e1 == null || s2 == null || e2 == null) return false;

        // Normalisation minuit
        if (e1 < s1) e1 += 1440;
        if (e2 < s2) e2 += 1440;

        // Application marge
        const A1 = s1 - gap;
        const A2 = e1 + gap;
        const B1 = s2;
        const B2 = e2;

        return !(A2 <= B1 || B2 <= A1); // overlap avec marge
      }

      // Transforme un dateint en label
      function dateintToLabel(di) {
        if (!di) return "";
        const s = String(di);
        if (s.length !== 8) return s;
        const y = s.slice(0, 4);
        const m = s.slice(4, 6);
        const d = s.slice(6, 8);
        return `${y}-${m}-${d}`; // ou tu peux mettre un format FR "dd/mm/yyyy" si tu préfères
      }

      // Normalise les minutes de début et de fin, ajustant la fin au lendemain si nécessaire.
      function normalizeStartEnd(sMin, eMin) {
        if (sMin == null || eMin == null) return [sMin, eMin];
        // si la fin est “avant” le début → spectacle qui finit le lendemain
        if (eMin < sMin) {
          return [sMin, eMin + 1440]; // +24h
        }
        return [sMin, eMin];
      }

      // Normalise le texte en supprimant les diacritiques et en convertissant en minuscules.
      function normText(s) {
        return (s || "")
          .toString()
          .normalize("NFD")
          .replace(/\p{Diacritic}/gu, "")
          .toLowerCase();
      }

      /**
       * Retourne la liste des activités candidates à la programmation,
       * après:
       *  1) filtres standard + mots-clés
       *  2) exclusion des déjà programmées
       *  3) filtrage par fenêtre horaire (Debut/Fin)
       *  4) vérification Session/Relâche vs date_min/date_max via ta fonction métier.
       */
      function getCandidateRows(constraints) {
        const df = ctx?.df || [];
        let rows = [];

        //
        // 1) Point de départ : ACTIVITÉS NON PROGRAMMÉES
        //    - Si "Utiliser uniquement les spectacles filtrés" est coché :
        //      -> on essaie d'abord de lire directement la grille `grid-non-programmees`
        //         (qui est déjà "non programmées" + filtres d'UI)
        //      -> sinon on retombe sur activitesAPI.getActivitesNonProgrammees ou Date null
        //
        if (constraints.utiliser_filtres_grille) {
          const handle = window.grids?.get?.("grid-non-programmees");
          const api = handle?.api;

          if (api && typeof api.forEachNodeAfterFilterAndSort === "function") {
            const tmp = [];
            api.forEachNodeAfterFilterAndSort((node) => {
              if (node?.data) tmp.push(node.data);
            });
            rows = tmp;
          } else {
            rows = activitesAPI.getActivitesNonProgrammees(df);
          }
        } else {
          // Pas de "filtre grille" => juste la liste des non programmées
          rows = activitesAPI.getActivitesNonProgrammees(df);
        }

        //
        // 2) Mots-clés sur la colonne Style 
        //    - mots_cles_style : au moins un doit apparaître dans Style
        //
        const sty = constraints.mots_cles_style || [];
        const hasMix = Array.isArray(constraints.style_mix) && constraints.style_mix.length > 0;

        // Si on a un dosage, on NE filtre PAS strictement sur les styles,
        // on laisse le picker faire le mix, et "other" servira de fallback.
        if (sty.length && !hasMix) {
          rows = rows.filter((r) => {
            if (!r) return false;
            const styleText = normText(r.Style);
            for (const kw of sty) {
              const needle = normText(kw);
              if (!needle) continue;
              if (styleText.includes(needle)) return true;
            }
            return false;
          });
        }

        //
        // 3) Fenêtre horaire Debut / Fin (en minutes)
        //       df.Debut >= debut_min ET df.Fin <= fin_max
        //
        const minMinutes = debutMinToMinutes(constraints.debut_min); 
        const maxMinutes = finMaxToMinutes(constraints.fin_max);

        if (minMinutes != null || maxMinutes != null) {
          rows = rows.filter((r) => {
            let sMin = mmFromHHhMM(r.Debut);
            let eMin = mmFromHHhMM(r.Fin);
            [sMin, eMin] = normalizeStartEnd(sMin, eMin);
            if (sMin == null || eMin == null) return false;

            if (minMinutes != null && sMin < minMinutes) return false;
            if (maxMinutes != null && eMin > maxMinutes) return false;

            return true;
          });
        }

        //
        // 4) on ne garde que les programmables :
        //    - Activites non programmées
        //    - éventuellement filtrées par la grille `grid-non-programmees`
        //    - filtrées par Style via les mots-clés
        //    - filtrées par fenêtre horaire
        //
        return rows;
      }

      // Normalisation d'un tableau de mots-clefs
      function normalizeKeywordsArray(v) {
        if (!v) return [];

        const arr = Array.isArray(v) ? v : [v];

        return Array.from(
          new Set(
            arr.flatMap(s =>
              String(s)
                .split(",")
                .map(x => x.trim())
                .filter(Boolean)
            )
          )
        );
      }

      // Demande à l'IA via worker de traduire une query utilisateur en intent structurée
      async function fetchProgQueryIntent(freeQuery, previousIntent = null) {
        if (!freeQuery || !freeQuery.trim()) return null;
        try {
          overlayAttente.hidden = false; // Affiche l'overlay d'attente
          const body = {
            utterance: freeQuery,
            // Pour info au modèle : on est dans un contexte "programmateur"
            search_space: "local_schedule",
            edition_year: 2025,
            // scope festival : tu peux adapter si tu as un contexte In/Off
            festival: "off",
          };

          if (previousIntent) {
            body.previous_intent = previousIntent;
          }

          const res = await fetch("https://off-proxy.joel-nicoloso.workers.dev/ai/query-understand", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body)
          });

          if (!res.ok) {
            console.warn("fetchProgQueryIntent HTTP", res.status);
            return null;
          }

          const js = await res.json();
          return js || null;

        } catch (e) {
          console.warn("fetchProgQueryIntent error:", e);
          return null;
        } finally {
          overlayAttente.hidden = true; // Masque l'overlay d'attente
        }
      }

      // Date ISO -> dateint
      function isoDateToDateint(iso) {
        if (!iso) return null;
        const parts = iso.split("-");
        if (parts.length !== 3) return null;
        const y = Number(parts[0]);
        const m = Number(parts[1]);
        const d = Number(parts[2]);
        if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
        return y * 10000 + m * 100 + d;
      }

      /**
       * Fusionne les contraintes du formulaire avec l'intent IA (QueryIntent).
       * - ne modifie PAS l'objet original (clone)
       */
      function mergeConstraintsWithIntent(formConstraints, intentJson) {
        if (!intentJson || typeof intentJson !== "object") {
          return { ...formConstraints };
        }

        const merged = { ...formConstraints };
        const filters = intentJson.filters || {};
        
        mergeAuteursIntoKeywords(intentJson);
        mergeActeursIntoKeywords(intentJson);

        // ====== DATES ======
        const intentDates = filters.dates || {};
        if (!merged.date_min && intentDates.from) {
          const di = isoDateToDateint(intentDates.from);
          if (di) merged.date_min = di;
        }
        if (!merged.date_max && intentDates.to) {
          const di = isoDateToDateint(intentDates.to);
          if (di) merged.date_max = di;
        }

        // ====== TIME WINDOW ======
        const tw = filters.time_window || {};
        if (!merged.debut_min && tw.start) {
          // tw.start "HH:MM" -> on garde tel quel
          merged.debut_min = tw.start.slice(0, 5);
        }
        if (!merged.fin_max && tw.end) {
          merged.fin_max = tw.end.slice(0, 5);
        }

        // ====== STYLE → mots_cles_style ======
        const catFilter = Array.isArray(filters.categories) ? filters.categories : [];
        const catValues = catFilter
          .map(c => c && c.value)
          .filter(Boolean);

        const existingStyleKw = Array.isArray(merged.mots_cles_style)
          ? merged.mots_cles_style
          : [];

        if (catValues.length) {
          merged.mots_cles_style = normalizeKeywordsArray([
            ...existingStyleKw,
            ...catValues
          ]);
        } else {
          merged.mots_cles_style = existingStyleKw;
        }

        // ====== MOOD → mots_cles_mood ======
        const moodFilter = Array.isArray(filters.mood) ? filters.mood : [];
        const moodValues = moodFilter
          .map(c => c && c.value)
          .filter(Boolean);

        const existingMoodKw = Array.isArray(merged.mots_cles_mood)
          ? merged.mots_cles_mood
          : [];

        if (moodValues.length) {
          merged.mots_cles_mood = normalizeKeywordsArray([
            ...existingMoodKw,
            ...moodValues
          ]);
        } else {
          merged.mots_cles_mood = existingMoodKw;
        }

        // ====== DISTRIBUTION → mots_cles_distribution ======
        const distributionFilter = filters.distribution || {};
        const names = [
          ...(distributionFilter.actors || []),
          ...(distributionFilter.authors || []),
          ...(distributionFilter.companies || [])
        ].filter(Boolean);

        const existingDistKw = Array.isArray(merged.mots_cles_distribution)
          ? merged.mots_cles_distribution
          : [];

        if (names.length) {
          merged.mots_cles_distribution = normalizeKeywordsArray([
            ...existingDistKw,
            ...names
          ]);
        } else {
          merged.mots_cles_distribution = existingDistKw;
        }

        // ====== KEYWORDS → mots_cles_generaux ======
        const kwdFilter = Array.isArray(filters.keywords) ? filters.keywords : [];
        const kwdValues = kwdFilter
          .map(c => c && c.value)
          .filter(Boolean);

        const existingGeneralKw = Array.isArray(merged.mots_cles_generaux)
          ? merged.mots_cles_generaux
          : [];

        if (kwdValues.length) {
          merged.mots_cles_generaux = normalizeKeywordsArray([
            ...existingGeneralKw,
            ...kwdValues
          ]);
        } else {
          merged.mots_cles_generaux = existingGeneralKw;
        }

        // NOTE : on laisse note_weight tel que choisi par le slider utilisateur

        return merged;
      }

      // Signature des contraintes IA
      function makeAIConstraintsKey(constraints) {
        const distriKW = normalizeKeywordsArray(constraints.mots_cles_distribution);
        const moodKW = normalizeKeywordsArray(constraints.mots_cles_mood);
        const genKW = normalizeKeywordsArray(constraints.mots_cles_generaux);
        const note     = Number(constraints.note_weight ?? 0);

        return JSON.stringify({
          request: (constraints.request || "").trim(),
          distribution_keywords: distriKW.sort(),  // tri pour que l’ordre n'importe pas
          mood_keywords: moodKW.sort(),
          generic_keywords: genKW.sort(),
          note
        });
      }

      // Construit une semantic query à partir des contraintes
      function buildSemanticQueryFromConstraints(constraints) {
        const parts = [];

        const req = (constraints.request || "").trim();
        if (req) {
          // texte libre de l'utilisateur
          parts.push(req);
        }

        const styleKws = constraints.mots_cles_style || [];
        if (styleKws.length) {
          parts.push(
            `Je privilégie les spectacles dont le style ou la catégorie correspond à : ${styleKws.join(", ")}.`
          );
        }

        const moodKws = constraints.mots_cles_mood || [];
        if (moodKws.length) {
          parts.push(
            `Je privilégie les spectacles dont le mood l'humeur ou le ton correspond à : ${moodKws.join(", ")}.`
          );
        }

        const distriKws = constraints.mots_cles_distribution || [];
        if (distriKws.length) {
          parts.push(
            `Je privilégie les spectacles dont la distribution (auteur·ice, équipe artistique, interprètes) contient : ${distriKws.join(", ")}.`
          );
        }

        const noteWeight = Number(constraints.note_weight ?? 0) || 0;
        if (noteWeight > 0) {
          parts.push(
            `Je souhaite que les spectacles bien notés par le public soient mis davantage en avant.`
          );
        }

        // Si rien du tout, on renvoie une chaîne vide (le worker gère query="" → semScore=0)
        return parts.join(" ");
      }

      // Application de l'IA Scoring aux candidats
      async function applyAIScoringToCandidates(candidates, constraints) {
        const rows = candidates || [];
        if (!rows.length) return rows;

        // const query = (constraints.request || "").trim();
        const query = buildSemanticQueryFromConstraints(constraints);

        const distriKW = normalizeKeywordsArray(constraints.mots_cles_distribution);
        const moodKW = normalizeKeywordsArray(constraints.mots_cles_mood);
        const genKW = normalizeKeywordsArray(constraints.mots_cles_generaux);

        // slider 0–100 → 0–1
        // const noteWeight = Math.max(0, Math.min(1, Number(constraints.note_weight ?? 0) / 100));
        const noteWeight = Math.max(0, Math.min(1, Number(constraints.note_weight ?? 0)));

        const hasAnyIA =
          query ||
          distriKW.length ||
          moodKW.length ||
          genKW.length ||
          noteWeight > 0;

        if (!hasAnyIA) {
          // Pas de contraintes IA → on ne touche pas aux candidats
          return rows;
        }

        const candidateKeys = rows.map(makeFullKey);
        const constraintsKey = makeAIConstraintsKey(constraints);
        const candidateSetKey = candidateKeys.slice().sort().join("||");

        // 🔁 1) Tentative de réutilisation du cache
        if (
          constraintsKey === lastIAConstraintsKey &&
          candidateSetKey === lastIACandidateSetKey &&
          lastIAScoreMap
        ) {
          // On ne refait PAS d'appel IA, on réapplique simplement les scores
          const scoredRows = rows
            .map(r => {
              const key = makeFullKey(r);
              if (!lastIAScoreMap.has(key)) return null;
              const meta  = lastIAScoreMap.get(key);
              const score = meta?.score ?? 0;
              const avis  = meta?.avis  ?? null;
              const desc  = meta?.desc_summary || null;
              const avisSummary = meta?.avis_summary || null;
              const mood  = meta?.mood || null;
              return {
                ...r,
                _aiScore: score,
                _aiAvis: avis,
                _aiDescSummary: desc,
                _aiAvisSummary: avisSummary,
                _aiMood: mood
              };
            })
            .filter(Boolean);

          return scoredRows;
        }

        // 🔁 2) Sinon : appel au worker pour recalculer les scores
        const body = {
          query: query,
          candidate_keys: candidateKeys,
          distribution_keywords: distriKW,
          mood_keywords: moodKW,
          generic_keywords: genKW,
          note_weight: noteWeight,
          topK: candidateKeys.length
        };

        try {
          overlayAttente.hidden = false; // Affiche l'overlay d'attente
          const res = await fetch(`https://off-proxy.joel-nicoloso.workers.dev/ai/semantic-wkk`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body)
          });

          if (!res.ok) {
            console.warn("program-score HTTP", res.status);
            return rows;
          }

          const js = await res.json();
          const results = Array.isArray(js.results) ? js.results : [];

          const scoreMap = new Map(
            results.map(r => [r._index_key, {
              score: Number(r.score) || 0,
              avis: r.avis || null,
              desc_summary: r.desc_summary || null,
              avis_summary: r.avis_summary || null,
              mood: r.mood || null
            }])
          );

          // on remplit le cache
          lastIAConstraintsKey = constraintsKey;
          lastIACandidateSetKey = candidateSetKey;
          lastIAScoreMap = scoreMap;

          const scoredRows = rows
            .map(r => {
              const key = makeFullKey(r);
              if (!scoreMap.has(key)) return null;
              const meta  = scoreMap.get(key);
              return {
                ...r,
                _aiScore: meta?.score ?? 0,
                _aiAvis: meta?.avis  ?? null,
                _aiDescSummary: meta?.desc_summary || null,
                _aiAvisSummary: meta?.avis_summary || null,
                _aiMood: meta?.mood || null
              };
            })
            .filter(Boolean);

          return scoredRows;
        } catch (e) {
          console.warn("applyAIScoringToCandidates error:", e);
          return rows;
        } finally {
          overlayAttente.hidden = true; // Masque l'overlay d'attente
        }
      }

      // Choisit le 1er style "match" dans row.Style
      function pickSelectedStyleForRow(row, selectedStyles) {
        const s0 = String(row?.Style || "");
        const s = s0
          .normalize("NFD")
          .replace(/\p{Diacritic}/gu, "")
          .toLowerCase();

        const matches = [];
        for (const st0 of selectedStyles || []) {
          const st = String(st0 || "")
            .normalize("NFD")
            .replace(/\p{Diacritic}/gu, "")
            .toLowerCase()
            .trim();
          if (!st) continue;

          if (s.includes(st)) matches.push(st0); // on retourne le libellé original
        }

        if (!matches.length) return null;
        if (matches.length === 1) return matches[0];

        // plusieurs styles matchés => choix aléatoire (évite le biais “toujours le 1er”)
        return matches[Math.floor(Math.random() * matches.length)];
      }

      /**
       * Normalise un mix [{style,pct}] en [{style, weight}] avec weight dans [0..1] et somme=1.
       * - Filtre les styles vides / pct <= 0
       * - Déduplique par style (dernier gagne)
       * @param {{style:string, pct:number}[]} styleMix
       * @returns {{style:string, weight:number}[]}
       */
      function normalizeMix(styleMix) {
        const tmp = new Map(); // style -> pct
        for (const it of styleMix || []) {
          const st = String(it?.style || "").trim();
          const pct = Number(it?.pct);
          if (!st) continue;
          if (!Number.isFinite(pct) || pct <= 0) continue;
          tmp.set(st, pct);
        }

        const arr = Array.from(tmp.entries()).map(([style, pct]) => ({
          style,
          pct: Number(pct) || 0
        }));

        const sum = arr.reduce((s, x) => s + x.pct, 0);
        if (sum <= 0) return [];

        return arr.map(x => ({
          style: x.style,
          weight: x.pct / sum
        }));
      }

      // Ne garde que les candidats placeables dans un intervalle de dates
      function precomputePossibleDatesForPeriod(candidates, dateMinInt, dateMaxInt) {
        const out = [];
        for (const r of candidates || []) {
          if (!r) continue;

          const poss = [];
          for (let d = dateMinInt; d <= dateMaxInt; d = addOneDayDateint(d)) {
            if (!activitesAPI.estActiviteValideADate(r, d)) continue;
            poss.push(d);
          }
          if (!poss.length) continue;

          // on stocke pour réutiliser dans la boucle
          r._progPossibleDates = poss;
          out.push(r);
        }
        return out;
      }

      // Style picker renvoyant un spectacle parmi des candidats en fonction d'un styleMix
      // Renvoie un spectacle du style le plus en retard parmi les spectacles placés
      function makePlacedAwareStylePicker(candidates, styleMix, {
        pickStyleForRow = pickSelectedStyleForRow, // (row, wantedStyles) => style|null
        placedState = null, // { placedByStyle: Map<string, number>, placedTotal: number }
      } = {}) {
        const list = Array.isArray(candidates) ? candidates.slice() : [];
        if (!list.length) {
          return { pick: () => null, accept: () => {}, reject: () => {} };
        }

        // Normalise mix -> [{style, weight}]
        const norm = normalizeMix(styleMix); // renvoie un ARRAY
        const wantedStyles = norm.map(x => x.style);

        // Si pas de mix utilisable => itérateur simple, 1 passage, sans doublon
        if (!wantedStyles.length) {
          shuffleArrayInPlace(list);
          let inflight = null;
          let idx = 0;

          return {
            pick() {
              inflight = (idx < list.length) ? list[idx++] : null;
              return inflight;
            },
            accept(row) { inflight = null; },
            reject(row) { inflight = null; },
          };
        }

        // Pools par style
        const byStyle = new Map();
        for (const st of wantedStyles) byStyle.set(st, []);

        const other = [];

        for (const r of list) {
          const st = pickStyleForRow(r, wantedStyles);
          if (st && byStyle.has(st)) byStyle.get(st).push(r);
          else other.push(r);
        }

        // Shuffle DANS chaque pool (variabilité sans casser le mix)
        for (const [, arr] of byStyle) shuffleArrayInPlace(arr);
        shuffleArrayInPlace(other);

        // Écarter les styles sans stock + renormaliser leurs poids
        const effective = normalizeMix(
          norm
            .filter(x => (byStyle.get(x.style)?.length || 0) > 0)
            .map(x => ({ style: x.style, pct: x.weight * 100 }))
        );
        const effStyles = effective.map(x => x.style);
        const weightByStyle = new Map(effective.map(x => [x.style, x.weight]));

        // ------------------------------------------------------------
        // ✅ Compteurs "PLACED" : internes OU partagés via placedState
        // ------------------------------------------------------------
        let placedByStyle;
        let placedTotalRef;

        if (placedState && placedState.placedByStyle instanceof Map) {
          placedByStyle = placedState.placedByStyle;

          // s'assurer que toutes les clés existent
          for (const s of effStyles) {
            if (!placedByStyle.has(s)) placedByStyle.set(s, 0);
          }

          // placedTotal en "ref" objet pour pouvoir l'incrémenter ici
          // (si tu veux un number simple, il faut le remettre dans placedState à chaque accept)
          if (typeof placedState.placedTotal !== "number") placedState.placedTotal = 0;
          placedTotalRef = placedState;
        } else {
          placedByStyle = new Map(effStyles.map(s => [s, 0]));
          placedTotalRef = { placedTotal: 0 };
        }

        let inflight = null;

        function takeOneFromStyle(st) {
          const arr = byStyle.get(st);
          if (!arr || !arr.length) return null;
          return arr.pop(); // ✅ consommé, ne reviendra jamais
        }

        function takeFallback() {
          if (other.length) return other.pop(); // consommé
          // sinon n’importe quel style restant
          for (const [st, arr] of byStyle) {
            if (arr.length) return arr.pop();
          }
          return null;
        }

        function chooseNextStylePlacedAware(effStyles, weightByStyle, placedByStyle, placedTotal, byStyle) {
          if (!effStyles?.length) return null;

          // si rien placé encore : tirage pondéré parmi ceux avec stock
          if (!placedTotal) {
            const avail = effStyles.filter(s => (byStyle.get(s)?.length || 0) > 0);
            if (!avail.length) return null;

            let sum = 0;
            for (const s of avail) sum += Math.max(0, Number(weightByStyle.get(s) || 0));
            if (sum <= 0) return avail[Math.floor(Math.random() * avail.length)];

            let r = Math.random() * sum;
            for (const s of avail) {
              r -= Math.max(0, Number(weightByStyle.get(s) || 0));
              if (r <= 0) return s;
            }
            return avail[avail.length - 1] || null;
          }

          let best = null;
          let bestRatio = Infinity;

          for (const s of effStyles) {
            const stock = byStyle.get(s)?.length || 0;
            if (stock <= 0) continue;

            const w = Math.max(0, Number(weightByStyle.get(s) || 0));
            if (w <= 0) continue;

            const placed = Number(placedByStyle.get(s) || 0);
            const target = w * placedTotal;              // cible "attendue"
            const ratio = target > 0 ? (placed / target) : Infinity; // <1 => en retard

            if (ratio < bestRatio) {
              bestRatio = ratio;
              best = s;
            }
          }

          return best;
        }

        return {
          pick() {
            if (!effStyles.length) {
              inflight = takeFallback();
              return inflight;
            }

            const placedTotal = Number(placedTotalRef.placedTotal || 0);

            // ✅ choisir le style en retard sur *PLACED*
            const st = chooseNextStylePlacedAware(
              effStyles,
              weightByStyle,
              placedByStyle,
              placedTotal,
              byStyle
            );

            inflight = (st ? takeOneFromStyle(st) : null) || takeFallback();
            return inflight;
          },

          accept(rowPlaced) {
            if (!inflight || inflight !== rowPlaced) return;

            // Créditer le style du row placé
            const st = pickStyleForRow(rowPlaced, effStyles);
            if (st) {
              if (!placedByStyle.has(st)) placedByStyle.set(st, 0);
              placedByStyle.set(st, (placedByStyle.get(st) || 0) + 1);
            }

            placedTotalRef.placedTotal = Number(placedTotalRef.placedTotal || 0) + 1;
            inflight = null;
          },

          reject(rowRejected) {
            if (!inflight || inflight !== rowRejected) return;
            // 🔥 brûlé dans CE picker/segment : on ne remet nulle part
            inflight = null;
          }
        };
      }

      // Mélange et retourne une *nouvelle* copie du tableau
      function shuffleArray(arr) {
        const a = arr.slice();
        shuffleArrayInPlace(a);
        return a;
      }

      // Mélange *en place* (Fisher–Yates)
      function shuffleArrayInPlace(a) {
        for (let i = a.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          if (i !== j) {
            const tmp = a[i];
            a[i] = a[j];
            a[j] = tmp;
          }
        }
        return a;
      }

      // Version "intelligente" du shuffleArrayInPlace à appeler quand il y a scoring IA
      function shuffleArrayWithScore(arr, {
        temperature = 0.35,   // 0.15 = très autoritaire | 0.6 = très exploratoire
        scoreProp   = "_aiScore",
        epsilon     = 1e-6
      } = {}) {
        if (!arr.length) return [];

        // 1) Extraction des scores
        const scores = arr.map(r => Number(r[scoreProp] ?? 0));

        // 2) Normalisation Z-score
        const mean = scores.reduce((s,x) => s + x, 0) / scores.length;
        const varPop = scores.reduce((s,x) => s + (x - mean) ** 2, 0) / scores.length;
        const sigma = Math.sqrt(varPop) || 1;

        const zscores = scores.map(s => (s - mean) / sigma);

        // 3) Softmax avec température
        const weights = zscores.map(z => Math.exp(z / temperature));
        const sumW = weights.reduce((s,w) => s + w, 0) + epsilon;
        const probs = weights.map(w => w / sumW);

        // 4) Tirage pondéré sans remise
        const shuffled = [];
        const pool = arr.map((row, i) => ({
          row,
          p: probs[i]
        }));

        while (pool.length) {
          const r = Math.random();
          let acc = 0;
          let idx = 0;

          for (; idx < pool.length; idx++) {
            acc += pool[idx].p;
            if (r <= acc) break;
          }

          shuffled.push(pool[idx].row);
          pool.splice(idx, 1);

          // renormalisation
          const sum = pool.reduce((s,o) => s + o.p, 0);
          for (const o of pool) o.p /= sum;
        }

        return shuffled;
      }

      // log des candidats par style
      function logCandidatesByStyle(candidates, styleMix, label = "") {
        const styles = styleMix.map(x => x.style);
        const counts = {};
        for (const s of styles) counts[s] = 0;

        let other = 0;

        for (const r of candidates) {
          const st = pickSelectedStyleForRow(r, styles);
          if (st && counts[st] != null) {
            counts[st]++;
          } else {
            other++;
          }
        }

        console.log(
          `🎭 Candidats par style${label ? " – " + label : ""}`
        );

        for (const s of styles) {
          console.log(`  ${s}: ${counts[s]}`);
        }

        console.log(`  autres / hors mix: ${other}`);
        console.log(`  total: ${candidates.length}`);
      }

      // Construction d'une nouvelle proposition de programme
      async function buildProgram(formConstraints) {
        const allRows = ctx?.df || [];

        // On clone les contraintes du formulaire
        let constraints = { ...formConstraints };

        const GAP_MIN = constraints.gap_minutes || defaultGap || 30;
        const GAP     = GAP_MIN;

        // ====== 1) Passe d'understanding sur la query (si présente) ======
        let intentJson = null;
        const freeQuery = constraints.request && constraints.request.trim();

        if (freeQuery) {
          try {
            if (freeQuery === lastProgQueryText && lastProgIntentJson) {
              // ✅ on réutilise le dernier intent si la query n'a pas changé
              intentJson = lastProgIntentJson;
            } else {
              const previousIntent = lastProgIntentJson || null;
              const fullQuery = "Je cherche des spectacles du stock avec les mots-clés, mood, filtres et autres critères de choix suivants : " + freeQuery; 
              intentJson = await fetchProgQueryIntent(fullQuery, previousIntent);
              lastProgQueryText  = freeQuery;
              lastProgIntentJson = intentJson || null;
            }

            if (intentJson && intentJson.intent === "search_shows") {
              constraints = mergeConstraintsWithIntent(constraints, intentJson);
            }
          } catch (e) {
            console.warn("buildProgram: erreur query-understand", e);
            // on continue avec les seules contraintes du formulaire
          }
        }

        // À partir d'ici, on travaille avec `constraints` (fusion formulaire + intent)
        const dateMinInt = constraints.date_min || null;
        const dateMaxInt = constraints.date_max || null;

        const minMinutes = debutMinToMinutes(constraints.debut_min);
        const maxMinutes = finMaxToMinutes(constraints.fin_max);

        const maxPerDay = constraints.max_par_jour || Infinity;

        if (!dateMinInt || !dateMaxInt) {
          // sans période on ne peut rien programmer proprement
          return new Map();
        }

        excludedKeys.clear();

        // ====== 2) Candidats issus des filtres "classiques" (df local) ======
        let rawCandidates = getCandidateRows(constraints) || [];

        // --- dosage style (optionnel) ---
        const styleMix = readStyleMixFromUI?.() || []; // [{style, pct}]
        // let nextCandidate = null; // function() -> row | null

        // ====== 3) Scoring IA + shuffle pondéré (ou aléatoire simple) ======
        const hasSemanticStuff =
          !!(constraints.request && constraints.request.trim()) ||
          (constraints.mots_cles_generaux && constraints.mots_cles_generaux.length) ||
          (constraints.mots_cles_distribution && constraints.mots_cles_distribution.length) ||
          (constraints.mots_cles_mood && constraints.mots_cles_mood.length) ||
          (constraints.note_weight != null && Number(constraints.note_weight) !== 0);

        if (rawCandidates.length && hasSemanticStuff) {
          // 🔹 scoring IA + filtre sur enrichissements (route /ai/semantic+keywords)
          rawCandidates = await applyAIScoringToCandidates(rawCandidates, constraints);
          rawCandidates = shuffleArrayWithScore(rawCandidates);
        } else {
          rawCandidates = shuffleArray(rawCandidates);
        }

        // 2) Slots déjà programmés (prog existant)
        const existingByDay = new Map(); // dateInt -> [{ startMin, endMin }]
        const progRows = activitesAPI.getActivitesProgrammees(ctx.df) || [];

        for (const r of progRows) {
          if (!r) continue;
          const dInt = r.Date != null ? Number(r.Date) : NaN;
          if (!dInt || isNaN(dInt)) continue;

          let sMin = mmFromHHhMM(r.Debut);
          let eMin = mmFromHHhMM(r.Fin);
          [sMin, eMin] = normalizeStartEnd(sMin, eMin);
          if (sMin == null || eMin == null) continue;

          if (!existingByDay.has(dInt)) existingByDay.set(dInt, []);
          existingByDay.get(dInt).push({ startMin: sMin, endMin: eMin });
        }

        // ============================================================
        // CAS 1 : pas de traitement des pauses -> ALGO CLASSIQUE
        // ============================================================
        if (!constraints.traiter_pauses) {
          const selectedByDay = new Map();

          // 1) préfiltre période : ne garder que ceux qui ont au moins une date possible
          rawCandidates = precomputePossibleDatesForPeriod(rawCandidates, dateMinInt, dateMaxInt);

          // 2) picker placed-aware
          const styleMix = readStyleMixFromUI?.() || [];
          const picker = makePlacedAwareStylePicker(rawCandidates, styleMix);

          logCandidatesByStyle(rawCandidates, styleMix);

          for (;;) {
            const r = picker.pick();
            if (!r) break;

            let sMin = mmFromHHhMM(r.Debut);
            let eMin = mmFromHHhMM(r.Fin);
            [sMin, eMin] = normalizeStartEnd(sMin, eMin);
            if (sMin == null || eMin == null) { picker.reject(); continue; }

            if (minMinutes != null && sMin < minMinutes) { picker.reject(); continue; }
            if (maxMinutes != null && eMin > maxMinutes) { picker.reject(); continue; }

            // ✅ dates possibles déjà calculées
            const possibleDates = Array.isArray(r._progPossibleDates) ? r._progPossibleDates.slice() : [];
            if (!possibleDates.length) { picker.reject(); continue; }

            shuffleArrayInPlace(possibleDates);

            let placed = false;
            for (const d of possibleDates) {
              const existingForDay = existingByDay.get(d) || [];
              const selectedForDay = selectedByDay.get(d) || [];

              const nbSpectacles = selectedForDay.filter(s => !activitesAPI.estPause(s.row)).length;
              if (nbSpectacles >= maxPerDay) continue;

              let conflict = false;
              for (const ex of existingForDay) {
                if (slotsConflict(sMin, eMin, ex.startMin, ex.endMin, GAP)) { conflict = true; break; }
              }
              if (conflict) continue;

              for (const ex of selectedForDay) {
                if (slotsConflict(sMin, eMin, ex.startMin, ex.endMin, GAP)) { conflict = true; break; }
              }
              if (conflict) continue;

              // ✅ placé !
              selectedForDay.push({ row: r, dateInt: d, startMin: sMin, endMin: eMin });
              selectedByDay.set(d, selectedForDay);

              if (!existingByDay.has(d)) existingByDay.set(d, []);
              existingByDay.get(d).push({ startMin: sMin, endMin: eMin });

              placed = true;
              break;
            }

            if (placed) picker.accept();
            else picker.reject();
          }
          return selectedByDay;
        }

        // ============================================================
        // CAS 2 : traiter_pauses === true -> 3 PLAGES + REPAS
        // ============================================================

        const selectedByDay = new Map();
        const usedUUID = new Set();   // pour ne pas utiliser la même activité plusieurs fois

        const meta = ctx.getMeta?.() || window.ctx?.meta || {};
        const DUREE_REPAS = Math.max(0, Number(meta.DUREE_REPAS ?? 60)   | 0);

        // Fenêtres de début de repas (en minutes)
        const DEJ_DEBUT_MIN = 12 * 60;  // 12:00
        const DEJ_DEBUT_MAX = 14 * 60;  // 14:00
        const DIN_DEBUT_MIN = 19 * 60;  // 19:00
        const DIN_DEBUT_MAX = 21 * 60;  // 21:00

        const FULL_START = minMinutes != null ? minMinutes : 0;
        const FULL_END   = maxMinutes; // => maxMinutes == null signifie : les activités du soir peuvent déborder 24h00 (remplace maxMinutes != null ? maxMinutes : (24 * 60);)

        // helper pour ajouter une "Pause déjeuner" / "Pause dîner" dans selected + busySlots
        function addMealPauseForDay(selectedForDay, busySlots, dateInt, type) {
          const isDej = (type === 'déjeuner');
          const winStart = isDej ? DEJ_DEBUT_MIN : DIN_DEBUT_MIN;
          const winEnd   = isDej ? DEJ_DEBUT_MAX : DIN_DEBUT_MAX;

          // 🛑 (1) Vérifier dans le df s'il existe déjà une pause de ce type pour ce jour
          const df = ctx.df || [];
          const alreadyHasPause = df.some(r =>
            r &&
            activitesAPI?.estPause?.(r) &&        // <<< correction ici
            r.__type_activite === type &&
            Number(r.Date || 0) === Number(dateInt)
          );
          if (alreadyHasPause) {
            return null;   
          }

          let lastEnd = 0;
          if (selectedForDay.length) {
            for (const s of selectedForDay) {
              if (s.endMin > lastEnd) lastEnd = s.endMin;
            }
          }

          const pausePlageDebut = activitesAPI.getPausePlageDebut(dateInt, type, {activitesProgrammees:progRows, marge:GAP})
          if (!pausePlageDebut) return null;

          const slotStart = Math.max(lastEnd + GAP, pausePlageDebut[0]);
          if (slotStart > pausePlageDebut[1]) return null;

          const slotEnd = slotStart + DUREE_REPAS;

          const row = {
            ...PARSED_DEFAULT,
            Activite: `Pause ${type}`,
            __type_activite: type,
            Debut: mmToHHhMM(slotStart),
            Fin:   mmToHHhMM(slotEnd),
            Duree: (() => {
              const h = Math.floor(DUREE_REPAS / 60);
              const m = DUREE_REPAS % 60;
              return `${h}h${String(m).padStart(2, '0')}`;
            })(),
            Date: dateInt,
            Reserve: 'Non',
            Relache: null,
            __uuid: crypto.randomUUID(),
          };

          selectedForDay.push({
            row,
            dateInt,
            startMin: slotStart,
            endMin: slotEnd,
          });
          busySlots.push({ startMin: slotStart, endMin: slotEnd });
          busySlots.sort((a, b) => a.startMin - b.startMin);

          return { startMin: slotStart, endMin: slotEnd };
        }

        function fillSegmentForDay(dateInt, segmentStart, segmentEnd, dayCandidates, busySlots, selectedForDay, picker) {
          const hasUpperBound = Number.isFinite(segmentEnd);
          if (hasUpperBound && segmentEnd <= segmentStart) return;

          // IMPORTANT: on ne doit pas retester le même candidat 2 fois dans ce segment
          // -> on garde un set local de "déjà proposés"
          const seen = new Set();

          for (;;) {
            let nbSpectacles = selectedForDay.filter(s => !activitesAPI.estPause(s.row)).length;
            if (nbSpectacles >= maxPerDay) break;

            const r = picker.pick();
            if (!r) break;

            // sécurité anti-boucle (si jamais ton picker renvoie 2 fois la même row)
            if (seen.has(r.__uuid || r)) {
              picker.reject(r);
              continue;
            }
            seen.add(r.__uuid || r);

            if (!r || !r.__uuid) { picker.reject(r); continue; }
            if (usedUUID.has(r.__uuid)) { picker.reject(r); continue; }

            let sMin = mmFromHHhMM(r.Debut);
            let eMin = mmFromHHhMM(r.Fin);
            [sMin, eMin] = normalizeStartEnd(sMin, eMin);
            if (sMin == null || eMin == null) { picker.reject(r); continue; }

            // doit être dans la plage du segment
            if (sMin < segmentStart) { picker.reject(r); continue; }
            if (hasUpperBound && eMin > segmentEnd) { picker.reject(r); continue; }

            // conflits ?
            let conflict = false;
            for (const bs of busySlots) {
              if (slotsConflict(sMin, eMin, bs.startMin, bs.endMin, GAP)) { conflict = true; break; }
            }
            if (!conflict) {
              for (const sl of selectedForDay) {
                if (slotsConflict(sMin, eMin, sl.startMin, sl.endMin, GAP)) { conflict = true; break; }
              }
            }
            if (conflict) { picker.reject(r); continue; }

            // OK on place
            selectedForDay.push({ row: r, dateInt, startMin: sMin, endMin: eMin });
            busySlots.push({ startMin: sMin, endMin: eMin });
            busySlots.sort((a, b) => a.startMin - b.startMin);
            usedUUID.add(r.__uuid);

            picker.accept(r);
          }
        }

        function prefilterCandidatesForSegment(dayCandidates, segmentStart, segmentEnd, {
          wantedStyles = null,   // tableau de styles du mix (ou null)
          strictMix = false
        } = {}) {
          const hasUpperBound = Number.isFinite(segmentEnd);

          return (dayCandidates || []).filter(r => {
            if (!r || !r.__uuid) return false;
            if (usedUUID.has(r.__uuid)) return false;

            let sMin = mmFromHHhMM(r.Debut);
            let eMin = mmFromHHhMM(r.Fin);
            [sMin, eMin] = normalizeStartEnd(sMin, eMin);
            if (sMin == null || eMin == null) return false;

            if (sMin < segmentStart) return false;
            if (hasUpperBound && eMin > segmentEnd) return false;

            if (strictMix && wantedStyles?.length) {
              const st = pickSelectedStyleForRow(r, wantedStyles);
              if (!st) return false;
            }
            return true;
          });
        }

        // Parcours jour par jour
        for (let d = dateMinInt; d <= dateMaxInt; d = addOneDayDateint(d)) {
          // Candidats jouables ce jour-là et pas encore utilisés
          const dayCandidates = rawCandidates.filter(r => {
            if (!r || !r.__uuid) return false;
            if (usedUUID.has(r.__uuid)) return false;
            // if (!activitesAPI.estActiviteProgrammableADate(r, d, {activitesProgrammees:progRows, marge:GAP})) return false;
            if (!activitesAPI.estActiviteValideADate(r, d)) return false;

            let sMin = mmFromHHhMM(r.Debut);
            let eMin = mmFromHHhMM(r.Fin);
            [sMin, eMin] = normalizeStartEnd(sMin, eMin);
            if (sMin == null || eMin == null) return false;

            if (FULL_START && sMin < FULL_START) return false;
            if (FULL_END && eMin > FULL_END)   return false;

            return true;
          });

          if (!dayCandidates.length && !(existingByDay.get(d)?.length)) {
            // rien à programmer, rien d'existant → on peut skipper ce jour-là
            continue;
          }

          const selectedForDay = [];
          const busySlots = [...(existingByDay.get(d) || [])].map(s => ({ ...s }))
            .sort((a, b) => a.startMin - b.startMin);

          // styles demandés
          const wanted = (normalizeMix(styleMix) || []).map(x => x.style);

          // état "placed" partagé sur la journée (pour que le dosage des styles s'applique sur la journée entière)
          const placedState = { placedByStyle: new Map(), placedTotal: 0 };

          // === 1) Plage matin : de FULL_START jusqu'à (14h - GAP)
          let morningEnd = (FULL_END) ? Math.min(FULL_END, DEJ_DEBUT_MAX - GAP) : DEJ_DEBUT_MAX - GAP;
          const segMorning = prefilterCandidatesForSegment(dayCandidates, FULL_START, morningEnd, {
            wantedStyles: wanted,
            strictMix: true
          });
          const pickerMorning = makePlacedAwareStylePicker(segMorning, styleMix, { placedState });
          const dejPlageDebut = activitesAPI.getPausePlageDebut(d, 'déjeuner', {activitesProgrammees:progRows, marge:GAP})
          if (dejPlageDebut) morningEnd = Math.min(morningEnd, dejPlageDebut[1] - GAP);
          fillSegmentForDay(d, FULL_START, morningEnd, dayCandidates, busySlots, selectedForDay, pickerMorning);

          // === 2) Pause déjeuner
          const dejSlot = addMealPauseForDay(selectedForDay, busySlots, d, 'déjeuner');

          // === 3) Plage après-midi : jusqu'à (21h - GAP)
          const afternoonStart = dejSlot ? (dejSlot.endMin + GAP) : morningEnd;
          let afternoonEnd = (FULL_END) ? Math.min(FULL_END, DIN_DEBUT_MAX - GAP) : DIN_DEBUT_MAX - GAP;
          const segAfternoon = prefilterCandidatesForSegment(dayCandidates, afternoonStart, afternoonEnd, {
            wantedStyles: wanted,
            strictMix: true
          });
          const pickerAfternoon = makePlacedAwareStylePicker(segAfternoon, styleMix, { placedState });
          const dinPlageDebut = activitesAPI.getPausePlageDebut(d, 'dîner', {activitesProgrammees:progRows, marge:GAP})
          if (dinPlageDebut) afternoonEnd = Math.min(afternoonEnd, dinPlageDebut[1] - GAP);
          fillSegmentForDay(d, afternoonStart, afternoonEnd, dayCandidates, busySlots, selectedForDay, pickerAfternoon);

          // === 4) Pause dîner
          const dinSlot = addMealPauseForDay(selectedForDay, busySlots, d, 'dîner');

          // === 5) Plage soir : [eveningStart, FULL_END]
          const eveningStart = dinSlot ? (dinSlot.endMin + GAP) : afternoonEnd;
          const segEvening = prefilterCandidatesForSegment(dayCandidates, eveningStart, FULL_END, {
            wantedStyles: wanted,
            strictMix: true
          });
          const pickerEvening = makePlacedAwareStylePicker(segEvening, styleMix, { placedState });
          fillSegmentForDay(d, eveningStart, FULL_END, dayCandidates, busySlots, selectedForDay, pickerEvening);

          if (selectedForDay.length) {
            selectedByDay.set(d, selectedForDay);
          }
        }

        return selectedByDay;
      }

      // Application du programme proposé sur df
      function applyProgramToDf(selectedByDay, simulate = false) {
        if (!selectedByDay) return 0;
        const dateByUUID = new Map();
        const pauseRows = []; // <- lignes de pauses à ajouter telles quelles

        for (const [dayInt, slots] of selectedByDay.entries()) {
          for (const slot of slots) {
            const r = slot.row;
            if (!r) continue;

            // Slot décoché -> on ignore tout (spectacle ou pause)
            const key = slotKey(dayInt, slot);
            if (excludedKeys.has(key)) continue;

            // PAUSE : on l'ajoutera telle quelle au df
            if (activitesAPI?.estPause?.(r)) {
              pauseRows.push(r);
              continue;
            }

            // SPECTACLE : comme avant, on prépare juste le changement de Date
            if (!r.__uuid) continue;

            dateByUUID.set(r.__uuid, dayInt);
          }
        }

        // Rien à faire
        if (!dateByUUID.size && !pauseRows.length) {
          return 0;
        }

        let addedCount = 0;

        if (!simulate) {
          ctx.mutateDf?.((rows) => {
            const src = rows || [];

            // 1) Comportement d'origine : recaler Date des lignes existantes
            const next = src.map((r) => {
              if (!r || !r.__uuid) return r;

              const newDate = dateByUUID.get(r.__uuid);
              if (!newDate) return r; // ligne non retenue

              if (Number(r.Date || 0) === Number(newDate)) {
                return r; // déjà à la bonne date
              }

              addedCount++;

              return {
                ...r,
                Date: newDate,
              };
            });

            // 2) Ajouter les PAUSES comme nouvelles lignes, telles quelles
            for (const pauseRow of pauseRows) {
              next.push(pauseRow);
              addedCount++;
            }

            return sortDf(next);
          });
        } else {
          // MODE SIMULATION : on compte sans modifier

          const src = ctx.df || [];
          for (const r of src) {
            if (!r || !r.__uuid) continue;
            const newDate = dateByUUID.get(r.__uuid);
            if (!newDate) continue;
            if (Number(r.Date || 0) === Number(newDate)) continue;
            addedCount++;
          }

          // + une entrée par pause ajoutée
          addedCount += pauseRows.length;
        }

        return addedCount;
      }

      // Présentation du programme proposé
      function summarizeProgram(selectedByDay, addedCount) {
        if (!addedCount) {
          return `<p>Aucune activité supplémentaire ne peut être proposée avec ces hypothèses.</p>`;
        }

        const parts = [];
        parts.push((addedCount == 1) ? `<p>✅ ${addedCount} nouvelle activité sélectionnée:</p>` : `<p>✅ ${addedCount} nouvelles activités sélectionnées:</p>` );

        const days = Array.from(selectedByDay.keys()).sort((a, b) => a - b);

        for (const dayInt of days) {
          const slots = selectedByDay.get(dayInt) || [];
          if (!slots.length) continue;

          const dayLabel = dateintToLabel(dayInt);
          parts.push(`<h4 class="prog-day">📅 ${dayLabel}</h4>`);
          parts.push(`<ul class="prog-day-list">`);

          // tri par heure
          const sortedSlots = [...slots].sort((a, b) => a.startMin - b.startMin);

          for (const slot of sortedSlots) {
            const r = slot.row || {};
            const h = mmToHHhMM(slot.startMin);
            const titre   = r.Activite || "(sans titre)";
            const style = r.Style || "";
            const theatre = r.Theatre   || "";
            const theatrePart = theatre ? ` <span class="prog-theatre">@ ${escapeHtml(theatre)}</span>` : "";
            const href    = r.Hyperlien || null;

            const desc = r._aiDescSummary || "";
            const avis = r._aiAvisSummary || "";
            const mood = r._aiMood || "";

            // bouton seulement si on a au moins un champ utile
            const infoBtnHtml =
              (desc || avis || mood)
                ? ` <button type="button"
                      class="bb-info-btn prog-info-btn"
                      data-title="${escapeAttr(titre)}"
                      data-style="${escapeAttr(style)}"
                      data-desc="${escapeAttr(desc)}"
                      data-avis="${escapeAttr(avis)}"
                      data-mood="${escapeAttr(mood)}"
                    >ℹ︎</button>`
                : "";

            const key     = slotKey(dayInt, slot);
            const isExcluded = excludedKeys.has(key);
            const checkedAttr = isExcluded ? "" : " checked";

            const avisObj = r._aiAvis || null;

            let avisTxt = null;
            if (avisObj && (avisObj.note || avisObj.count != null)) {
              // exemples : "9/10 (35 avis)" ou juste "9/10" ou juste "(35 avis)"
              const partsAvis = [];
              if (avisObj.note) {
                partsAvis.push(String(avisObj.note));
              }
              else {
                partsAvis.push('?');
              }
              if (avisObj.count != null) {
                partsAvis.push(`(${avisObj.count} avis)`);
              }
              if (partsAvis.length) {
                avisTxt = `${escapeHtml(`${partsAvis[0]} ${partsAvis[1]}`)}`; // note (count avis)
              }
            }

            const scoreTxt = null;
              // (typeof r._aiScore === "number")
              //   ? `score : ${r._aiScore.toFixed(2)}`
              //   : null;

            const metaTxt = [avisTxt, scoreTxt, r.Style].filter(Boolean).join(" - ");

            const metaHtml = metaTxt
              ? ` <span class="prog-meta">${metaTxt}</span>`
              : "";

            const titleHtml = href
              ? `<a href="${href}" target="_blank" rel="noopener" class="prog-link">${escapeHtml(titre)}</a>${metaHtml}`
              : `<span class="prog-title">${escapeHtml(titre)}</span>${metaHtml}`;

            parts.push(`
              <li class="prog-row" data-slot-key="${key}">
                <label class="prog-toggle-wrap">
                  <input type="checkbox" class="prog-toggle-input"${checkedAttr}>
                  <span class="prog-toggle-ui"></span>
                </label>
                <div class="prog-main">
                  <span class="prog-time">${h}</span>
                  ${titleHtml}${theatrePart}
                </div>
                ${infoBtnHtml}
              </li>
            `);
          }

          parts.push(`</ul>`);
        }

        return parts.join("\n");
      }

      // Génération d'un proposition de programme
      async function genProgram() {
        clearError();
        elRespBox.hidden = false;
        elResp.textContent = "⏳ Génération du programme…";

        try {
          const constraints   = buildConstraints();
          savePrefs(constraints);
          selectedByDay       = await buildProgram(constraints);
          const addedCount    = applyProgramToDf(selectedByDay, true);

          (function logFinalMix() {
            const mix = readStyleMixFromUI?.() || [];
            const wanted = mix.map(x => x.style);

            const picked = Object.fromEntries(wanted.map(s => [s, 0]));
            let total = 0;

            for (const slots of selectedByDay.values()) {
              for (const s of slots) {
                if (activitesAPI.estPause(s.row)) continue;
                total++;
                const st = pickSelectedStyleForRow(s.row, wanted);
                if (st) picked[st]++;
              }
            }

            console.group("📊 MIX FINAL PROGRAMMÉ");
            console.log("objectif :", mix);
            console.log("résultat :", picked);
            console.log(
              "ratios réels :",
              Object.fromEntries(
                Object.entries(picked).map(([k, v]) => [k, (v / total).toFixed(2)])
              )
            );
            console.log("total spectacles :", total);
            console.groupEnd();
          })();

          const summary       = summarizeProgram(selectedByDay, addedCount);
          elResp.innerHTML    = summary;
          body.scrollTop = body.scrollHeight;
          btnApply.disabled = (addedCount <= 0);
          progError = false;
        } catch (e) {
          console.error("generateProgram error:", e);
          showError("Erreur lors de la génération du programme.");
          elResp.textContent = "";
          btnApply.disabled = true;
          progError = true;
        }
      }

      // Application du programme proposé
      function applyProgram() {
        if (progError) return;

        try {
          const addedCount    = applyProgramToDf(selectedByDay);
          close();
        } catch (e) {
          console.error("applyProgram error:", e);
          showError("Erreur lors de l'application du programme.");
        }
      }

      btnGen.addEventListener("click", genProgram);
      btnApply.addEventListener("click", applyProgram);
      btnCancel.addEventListener("click", () => close());

      elResp.addEventListener('change', (e) => {
        const input = e.target.closest('.prog-toggle-input');
        if (!input) return;

        const li = input.closest('.prog-row');
        if (!li) return;

        const key = li.dataset.slotKey;
        if (!key) return;

        if (input.checked) {
          excludedKeys.delete(key);
        } else {
          excludedKeys.add(key);
        }
      });

      elReq.addEventListener("keydown", (ev) => {
        if (ev.key === "Escape") {
          ev.preventDefault();
          close();
        }
      });

      setTimeout(() => elReq.focus(), 20);
    }
  });
}

// Sheet “Compléter Infos+ & Ton”
// - détecte les rows incomplètes (Mood / __desc_summary / __avis_summary)
// - propose OK / Annuler
// - sur OK : boucle async + logs live
// - sur Annuler : stop + close
export function openSheetInfosPlus({
  title = "Génération Infos+",
  maxList = 60,
} = {}) {
  const df = ctx?.df || [];
  const rows = Array.isArray(df) ? df : [];

  const missing = rows.filter(r =>
    r && (r.Mood == null || r.__desc_summary == null || r.__avis_summary == null)
  );

  const esc = (s) => String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");

  const rowLabel = (r) => {
    const a = r?.Activite ?? r?.Spectacle ?? r?.Titre ?? "";
    const place = r?.Lieu ?? r?.Theatre ?? "";
    const bits = [a, place].filter(Boolean);
    return bits.join(" — ") || "(activité sans titre)";
  };

  let cancelled = false;

  openSheetExclusive({
    title,
    panelMaxHeight: "70vh",
    panelHeight: "60vh",
    mount: (body, { close }) => {
      body.innerHTML = `
        <div class="bb-enrich-sheet" style="display:flex; flex-direction:column; gap:10px; height:100%;">
          <div id="bb-out"
            style="
              flex:1 1 auto;
              min-height:0;
              overflow:auto;
              font-size:14px;
              line-height:1.4;
              border:1px solid rgba(0,0,0,.08);
              border-radius:10px;
              padding:10px;
              padding-bottom:calc(var(--footer-h) + env(safe-area-inset-bottom));
              scroll-padding-bottom:calc(var(--footer-h) + env(safe-area-inset-bottom));
              background:#fff;
              color:#111;
            ">          
          </div>

          <div class="sheet-footer has-border">
            <div class="form-actions">

              <!-- Bouton Annuler -->
              <button class="bb-btn is-primary" id="bb-cancel">
                Annuler
              </button>

              <!-- Bouton Enregistrer -->
              <button class="bb-btn is-primary" id="bb-ok">
                Ok
              </button>

            </div>
          </div>
          
        </div>
      `;

      const out = body.querySelector("#bb-out");
      const btnOk = body.querySelector("#bb-ok");
      const btnCancel = body.querySelector("#bb-cancel");

      const append = (txt) => {
        const div = document.createElement("div");
        div.innerHTML = (txt == null ? "" : String(txt));
        out.appendChild(div);
        out.scrollTop = out.scrollHeight;
      };

      const setBusy = (busy) => {
        btnOk.disabled = busy;
        btnCancel.textContent = busy ? "Annuler" : "Fermer";
      };

      // état initial
      if (!missing.length) {
        btnOk.style.display = "none";
        btnCancel.textContent = "Fermer";
        append("Tous les champs Infos+ et Ton sont renseignés, rien à faire ici.");
        btnCancel.addEventListener("click", () => close());
        return;
      }

      const shown = missing.slice(0, maxList);
      const more = missing.length - shown.length;

      const blank = () => {
        const div = document.createElement("div");
        div.appendChild(document.createElement("br"));
        out.appendChild(div);
        out.scrollTop = out.scrollHeight;
      };

      append(`Je vais mettre à jour Infos+ pour les activités suivante (${missing.length}) :`);
      shown.forEach((r) => {
        const label = rowLabel(r);
        const miss = [
          r?.__desc_summary == null ? "__desc_summary" : null,
          r?.__avis_summary == null ? "__avis_summary" : null,
          r?.Mood == null ? "Mood" : null,
        ].filter(Boolean).join(", ");
        append(`- ${label}`);
      });
      if (more > 0) append(`… +${more} autres`);
      blank();
      append("À tout moment vous pouvez annuler avec le bouton <strong>Annuler</strong>.");
      append("Bouton <strong>Ok</strong> pour lancer le traitement.");

      // Annuler / Fermer
      btnCancel.addEventListener("click", () => {
        cancelled = true;
        if (!btnOk.disabled) {
          // refreshAllGrids();
          close();
          return;
        }
        append("⛔ Annulation demandée…");
      });

      async function computeInfosPlusPatch(row) {
        const tmp = { ...row };                 // copie => pas d'effet sur DF
        await enrichWithAbstractPremiumOneRow(tmp);   // mute tmp

        return {
          __desc_summary: tmp.__desc_summary ?? null,
          __avis_summary: tmp.__avis_summary ?? null,
          Mood: tmp.Mood ?? null
        };
      }

      /**
       * @param {Array<any>} rowsToEnrich
       * @param {{
       *   isCancelled?: () => boolean,
       *   append?: (msg: string) => void
       * }} opts
       */
      async function buildInfosPlusPatchMap(rowsToEnrich, { isCancelled, append } = {}) {
        /** @type {Map<string, {__desc_summary:any,__avis_summary:any,Mood:any}>} */
        const patchByUuid = new Map();

        for (let i = 0; i < rowsToEnrich.length; i++) {
          if (isCancelled?.()) {
            append?.("⛔ Annulation demandée — commit partiel des éléments déjà calculés.");
            break;
          }

          const r = rowsToEnrich[i];
          const uuid = r?.__uuid;
          if (!uuid) {
            append?.(`(${i + 1}/${rowsToEnrich.length}) ❌ row sans __uuid, skip`);
            continue;
          }

          const label = r?.Activite || r?.Spectacle || "(sans titre)";
          append?.(`(${i + 1}/${rowsToEnrich.length}) ${label}`);

          try {
            const patch = await computeInfosPlusPatch(r);
            patchByUuid.set(uuid, patch);
            // append?.("   ✅ OK");
          } catch (e) {
            append?.(`   ❌ Erreur: ${String(e?.message || e)}`);
          }
        }

        return patchByUuid;
      }

      function commitInfosPlusPatchMap(patchByUuid) {
        if (!patchByUuid || patchByUuid.size === 0) return;

        ctx.mutateDf((rows) => {
          const next = (Array.isArray(rows) ? rows : []).map((r) => {
            const uuid = r?.__uuid;
            const patch = uuid ? patchByUuid.get(uuid) : null;
            if (!patch) return r;

            // patch uniquement les 3 champs
            return {
              ...r,
              __desc_summary: patch.__desc_summary,
              __avis_summary: patch.__avis_summary,
              Mood: patch.Mood
            };
          });

          return next; // pas de recalcFinForAll
        });
      }

      btnOk.addEventListener("click", async () => {
        cancelled = false;
        setBusy(true);
        append(blank());
        append("▶ C'est parti…");

        try {
          const patchByUuid = await buildInfosPlusPatchMap(missing, {
            isCancelled: () => cancelled,
            append
          });

          if (patchByUuid.size === 0) {
            append("ℹ️ Aucun patch à committer.");
          } else {
            append(`💾 Commit global: ${patchByUuid.size} activité(s) mises à jour (1 seul undo).`);
            commitInfosPlusPatchMap(patchByUuid);
          }
        } finally {
          setBusy(false);
          close();
        }
      });
    }
  });
}

// Sheet Progress
// - retourne un API { setTotal(n), setCurrent(txt), log(s), tickOk(msg), tickErr(msg), isCancelled(), close() }
export function openSheetProgress({
  title = "Traitement en cours…",
  initialTotal = 0,
  initialStatus = "",
  showLog = true,
  cancellable = true   // 👈 NOUVEAU
} = {}) {
  let cancelled = false;
  let done = 0;
  let ok = 0;
  let err = 0;
  let total = initialTotal;

  let elStatus, elBar, elLog, btnCancel;
  let _close = null;

  const render = () => {
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    if (elStatus) elStatus.textContent = `${done}/${total} — OK ${ok} — Erreurs ${err} — ${pct}%`;
    if (elBar) elBar.value = total > 0 ? done : 0;
  };

  const api = {
    setTotal(n) {
      total = Math.max(0, n | 0);
      if (elBar) elBar.max = Math.max(1, total);
      render();
    },
    log(s) {
      if (!showLog || !elLog) return;
      elLog.textContent += (elLog.textContent ? "\n" : "") + String(s);
      elLog.scrollTop = elLog.scrollHeight;
    },
    tickOk(msg) {
      done++; ok++;
      if (msg) api.log(msg);
      render();
    },
    tickErr(msg) {
      done++; err++;
      if (msg) api.log(msg);
      render();
    },
    isCancelled() {
      return cancelled;
    },
    close() {
      if (typeof _close === "function") _close();
    }
  };

  openSheetExclusive({
    title,
    panelMaxHeight: "55vh",
    panelHeight: showLog ? "45vh" : "25vh",
    mount: (body, { close }) => {
      _close = close;

      body.innerHTML = `
        <div style="font-size:14px; line-height:1.35; height:100%; display:flex; flex-direction:column; gap:10px;">
          <div style="display:flex; align-items:center; justify-content:space-between; gap:10px;">
            <div id="ip_status" style="font-weight:600;"></div>
            ${
              cancellable
                ? `<button id="ip_cancel" class="btn">Annuler</button>`
                : ``
            }
          </div>

          <progress id="ip_bar" value="0" max="${Math.max(1, total)}"
            style="width:100%; height:14px;"></progress>

          ${
            showLog
              ? `<pre id="ip_log"
                   style="flex:1; overflow:auto; margin:0; padding:10px;
                   border:1px solid rgba(255,255,255,.15);
                   border-radius:8px; white-space:pre-wrap;"></pre>`
              : ``
          }
        </div>
      `;

      elStatus = body.querySelector("#ip_status");
      elBar = body.querySelector("#ip_bar");
      elLog = body.querySelector("#ip_log");
      btnCancel = body.querySelector("#ip_cancel");

      if (btnCancel) {
        btnCancel.addEventListener("click", () => {
          cancelled = true;
          api.log("— Annulation demandée —");
          if (typeof close === "function") close();
        });
      }

      render();
    }
  });

  return api;
}