// ===============================
// Utilitaires Expanders
// ===============================

import { 
  genUUID,
  waitAF,
} from './utils.js';

import { 
  toDateint,
} from './utils-date.js';

import { 
  ctx,
  activitesAPI,
} from './app.js'; 

import { 
  sortDf, 
} from './activites.js'; 

// import {
//   openKebabMenu,
//   doAjouterColonne,
//   doSupprimerColonne,
// } from './menus.js';

import {
  grids,
  getSelectedRowSafe,
  getSelectedRow,
  selectRowByUuid,
  getLigneVoisineUuid,
  refreshGrid,
  dropRowFromSrcGridToDstGrid,
  refreshAllGrids,
  ensurePrioColumnVisible,
} from './grids.js';

import {
  isProgrammeCalendarVisible,
  programmeCalAbsoluteMaxHeightPx,
  wireProgrammeCalendarToggle,
} from './calendar.js';

import {
  openSheetExclusive,
  openSheetFiltres,
} from './sheets.js';

const $ = id => document.getElementById(id);
const MIN_OPEN_PX = 16;          // jamais ouvrir en dessous de ça
const ANIM_TIMEOUT_OPEN  = 900;  // fallback Safari si pas de transitionend
const ANIM_TIMEOUT_CLOSE = 700;

// =======================
// Expanders
// =======================

// Enlève le no-anim sur un pane (pour animation de transition hauteur)
function enableTransition(pane){
  pane.classList.remove('no-anim');
  if (pane.style.transition === 'none') pane.style.transition = '';
}

// Ajoute le no-anim sur un pane (pour animation de transition hauteur)
function disableTransition(pane){ 
  pane.classList.add('no-anim'); 
}

// Définit la hauteur d’un pane 
function setH(pane, px){ 
  pane.style.setProperty('height', `${Math.round(px)}px`, 'important'); 
}

// Calcule la hauteur minimale d’un pane (header + 1 ligne)
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

// Calcule la hauteur idéale d’un pane (header + toutes les lignes affichées)
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
  requestAnimationFrame(() => { 
    pane.style.height = `${target}px`; 
  });

  // La code ci-dessous est désactivé car le contenu n'est pas nécessairement rendu à temps
  // et dans ce cas l'ouverture se fait à une hauteur trop petite. C'est autoresizeFromGridSafe()
  // qui se charge de réajuster après coup si besoin.

  // 2 frames plus tard, on re-mesure (AG Grid a pu peindre) et on corrige si besoin
  // requestAnimationFrame(() => requestAnimationFrame(() => {
  //   if (exp.dataset.animating !== '1') {
  //     console.log('anim open already ended');
  //     return;           // déjà fini
  //   }
  //   if (pane.dataset.userSized === '1') {
  //     console.log('anim open user sized, skip adjust');
  //     return;          // l’utilisateur contrôle
  //   }
  //   const contentH = pane.scrollHeight|0;
  //   if (contentH >= MIN_OPEN_PX && Math.abs(contentH - target) > 2) {
  //     pane.style.height = `${contentH}px`;
  //     localStorage.setItem(`paneHeight:${exp.id}`, String(contentH));
  //     console.log('anim open adjust to content height', contentH);
  //   }
  // }));
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

// Retourne la hauteur actuelle de l'expander (0 si fermé)
function offsetTopWithin(el, ancestor){
  let top = 0, n = el;
  while (n && n !== ancestor){
    top += n.offsetTop;
    n = n.offsetParent;
  }
  return top;
}

// Trouve le conteneur qui scrolle
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

// Effectue un scroll fluide vers une cible
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

// Scrolle l'expander dans le viewport (aligné en haut)
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

// Centre l'expander dans le viewport (en tenant compte du header),
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

// Version async de scrollExpanderIntoViewCentered
export async function scrollExpanderIntoViewCenteredAsync(exp, opts){
  await scrollExpanderIntoViewCentered(exp, opts); // si elle ne renvoie pas de promesse, ajoute `await waitAF()`
  await waitAF();
}

// Rend visible un expander
export function scrollToExpander(expId) {
  const exp = document.getElementById(expId);
  if (!exp) return;
  scrollExpanderIntoViewCentered(exp);
}

// Rend visible un expander (async)
function scrollToExpanderAsync(expId) {
  const exp = document.getElementById(expId);
  if (!exp) return;
  scrollExpanderIntoViewCenteredAsync(exp);
}

// Ouvre un expander
export function openExpander(expId){
  const exp = document.getElementById(expId);
  if (!exp) return;
  if (!exp.classList.contains('open')) {
    if (typeof openExp === 'function') openExp(exp);
    else exp.classList.add('open');
  }
}

// Ouvre un expander (async)
export function openExpanderAsync(id){
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

// ===== Boutons d'expanders =====
export function addExpanderButton({expanderId, id, title, innerHTML, onClick}) {
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

function agGridHasHeaderFilters(gridId) {
  const gridApi = window.grids?.get(gridId).api;
  const defs = gridApi.getColumnDefs?.() || [];
  return defs.some(col => !!col.filter);
}

export function wireExpanders(){
  document.querySelectorAll('.st-expander').forEach((exp) => {
    const /** @type {HTMLElement} */ header = exp.querySelector('.st-expander-header');
    const /** @type {HTMLElement} */ body   = exp.querySelector('.st-expander-body');
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
      const t = /** @type {HTMLElement} */ (e.target);
      if (t.closest('.header-actions,[data-no-toggle]')) return;

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

export function wireExpanderButtons() {

  // Toggle Vue Programme (Grid <-> Calendrier Jour) sur exp-programmees
  wireProgrammeCalendarToggle();

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
  // if (agGridHasHeaderFilters('grid-non-programmees')) addExpanderButton({
  //   expanderId: 'exp-non-programmees',
  //   id: 'btn-col-non-prog',
  //   title: 'Colonnes', 
  //   innerHTML: `
  //     <span class="exp-icon" aria-hidden="true">
  //       <!-- Icône Colonnes -->
  //       <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
  //           stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  //         <path d="M12 8a4 4 0 1 1 0 8a4 4 0 0 1 0-8z" />
  //         <path d="M3 12h2m14 0h2M12 3v2m0 14v2
  //                 M5.6 5.6l1.4 1.4M17 17l1.4 1.4
  //                 M17 7l1.4-1.4M5.6 18.4L7 17" />
  //       </svg>
  //     </span>
  //     <span class="exp-label">Colonnes</span>
  //   `,
  //   onClick: () => {
  //     openKebabMenu($('btn-col-non-prog'), {
  //       items: [
  //         { id:'add-column',       label:"Ajouter",        onClick: ()=>doAjouterColonne() },
  //         { id:'suppress-column',  label:'Supprimer',      onClick: ()=>doSupprimerColonne() },
  //       ]
  //     });
  //   },
  // });

  // Bouton Prio sur Activités Non Programmées
  if (agGridHasHeaderFilters('grid-non-programmees')) addExpanderButton({
    expanderId: 'exp-non-programmees',
    id: 'btn-setprio-non-prog',
    title: 'SetPrio', 
    innerHTML: `
      <span class="exp-icon" aria-hidden="true">
        <!-- Icône étoile fine (priorité) -->
        <svg viewBox="0 0 24 24" width="18" height="18"
            fill="none" stroke="currentColor" stroke-width="1.6"
            stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M12 3.5l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 17.8 6.8 19.5l1-5.8-4.2-4.1 5.8-.8L12 3.5z"></path>
        </svg>
      </span>
      <span class="exp-label">SetPrio</span>
    `,
    onClick: () => { doSetPrio(); },
  });

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
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
          xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <rect x="3" y="3" width="18" height="18" rx="3" ry="3"/>
        <path d="M8 12l3 3 5-5"/>
      </svg>`;

    const ICON_PAUSE_OFF = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
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
      const label = isOn ? 'Avec pauses' : 'Avec pauses';
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
        try { onChange?.(); } catch(e) { console.error(e); }
      }
    });

    // 🔁 sync immédiat (au cas où l’innerHTML a bougé après insertion)
    queueMicrotask(() => syncAvecPausesButtonFromStorage(id));
  })();
}

// ===== Wiring des splitters =====

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

/**
 * @param {HTMLElement} target
 * @param {HTMLElement|Document|null} scroller
 * @param {{
 *   pad?: number,
 *   extraPad?: number,
 *   behavior?: ScrollBehavior
 * }} opts
 */
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

function getSafeBottomPx() {
  const probe = document.createElement("div");
  probe.style.cssText = `
    position: fixed;
    left: 0; right: 0; bottom: 0;
    height: env(safe-area-inset-bottom, 0px);
    pointer-events: none;
    visibility: hidden;
  `;
  document.body.appendChild(probe);
  const h = Math.round(probe.getBoundingClientRect().height || 0);
  probe.remove();
  return h;
}

export function wireExpanderSplitters() {
  document.querySelectorAll('.v-splitter').forEach(sp => {
    if (!(sp instanceof HTMLElement)) return;
    const /** @type {HTMLElement} */ handle = sp.querySelector('.v-splitter__handle') || sp;

    const topId = sp.getAttribute('data-top');
    const bottomId = sp.getAttribute('data-bottom');
    const /** @type {HTMLElement} */ paneTop = document.querySelector(`#${topId} .st-expander-body`);
    const /** @type {HTMLElement} */ paneBot = document.querySelector(`#${bottomId} .st-expander-body`);
    // 🆕 on autorise l’absence de paneBot si c’est le dernier
    const isLast = sp.dataset.last === '1' || bottomId === '__end__';
    if (!paneTop || (!paneBot && !isLast)) return;

    const expTop = paneTop.closest('.st-expander');        // parent expander (top)
    const scroller = findPageScroller(paneTop);

    let dragging = false, startY = 0, hTop = 0, dyMin = 0, dyMax = 0;
    let prevTransition = '', prevAnimation = '';
    let lastHFrame = null;        // previous frame paneTop height (px) during drag

    // 🆕 auto-grow state
    let autoGrowRaf = null;
    let autoGrowActive = false;
    let lastClientY = 0;
    let prevClientY = 0;
    let nearBottomLatch = false;  // hystérésis
    const LATCH_PX = 14;          // marge anti-flap (10–20px)

    let pinned = false;
    let pinAtY = 0;               // Y doigt au moment où on pin (repère)
    let pinDy0 = 0;               // dy au moment où on pin (repère)
    let autoGrowExtra = 0;        // px ajoutés par auto-grow (temps)

    let rafPending = false;
    let pendingY = 0;
    let fingerLimit = 0;

    const setH = (pane, px) => pane.style.setProperty('height', `${Math.max(0, Math.round(px))}px`, 'important');

    // limite basse “visible” dans le même repère que getBoundingClientRect()
    function getBottomLimitPx() {
      const PAD = 8; // marge de confort
      return window.innerHeight - (getBottomBarH() + getSafeBottomPx() + PAD);
    }

    function getBottomBarH() {
      const bb = document.getElementById("bottomBar");
      return bb ? Math.round(bb.offsetHeight || bb.getBoundingClientRect().height || 0) : 0;
    }

    function getFingerLimitPx() {
      const PAD = 8;
      const vv = window.visualViewport;

      // Bas du viewport visible, exprimé dans le repère "layout" (comme clientY)
      const viewBottom = vv ? (vv.offsetTop + vv.height) : window.innerHeight;

      return viewBottom - (getBottomBarH() + getSafeBottomPx() + PAD);
    }

    function begin(clientY, e) {
      // const expTop = paneTop.closest('.st-expander');
      if (!expTop || !expTop.classList.contains('open')) return;  // 🔒

      dragging = true;
      startY = clientY;
      lastClientY = clientY;
      prevClientY = clientY;
      autoGrowExtra = 0;
      nearBottomLatch = false;

      rafPending = false;
      pendingY = 0;
      fingerLimit = getFingerLimitPx(); // calc une fois au début du drag

      autoGrowActive = false;
      if (autoGrowRaf) { cancelAnimationFrame(autoGrowRaf); autoGrowRaf = null; }

      hTop = Math.round(paneTop.getBoundingClientRect().height);
      lastHFrame = hTop;

      // limite haute : on peut tout cacher (header compris)
      dyMin = -hTop;

      // limite basse : borne “contenu max”
      let maxH = calcMaxHForPane(paneTop); // default (grid & autres panes)
      const isProgrammePane = (expTop && expTop.id === "exp-programmees");
      if (isProgrammePane && isProgrammeCalendarVisible()) {
        maxH = programmeCalAbsoluteMaxHeightPx();  // cap à 24h visibles en mode calendrier
      }

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

      pinDy0 = 0;
      pinned = false;
      pinAtY = 0;
    }

    function tickAutoGrow() {
      if (!dragging || !autoGrowActive) { autoGrowRaf = null; return; }
      
      // ✅ si le doigt remonte au-dessus du pin, on coupe net
      if (lastClientY < pinAtY) {
        autoGrowActive = false;
        autoGrowRaf = null;
        return;
      }

      const SPEED = 6;

      // ✅ pousse uniquement l’extra, pas le fingerDelta
      autoGrowExtra += SPEED;

      // dy = dy au pin + extra + delta du doigt depuis le pin
      const fingerDelta = lastClientY - pinAtY;
      let dy = pinDy0 + autoGrowExtra + fingerDelta;
      dy = Math.max(dyMin, Math.min(dy, dyMax));

      setH(paneTop, hTop + dy);

      // garder le handle visible
      scrollBottomIntoView(handle, scroller, {
        pad: 12,
        extraPad: getSafeBottomPx() + getBottomBarH(),
        behavior: "auto",
      });

      // notify AG Grid
      try {
        const gridDiv = paneTop.querySelector('div[id^="grid"]');
        for (const g of (window.grids?.values?.() || [])) {
          if (g.el === gridDiv) { g.api.onGridSizeChanged(); break; }
        }
      } catch {}

      if (dy >= dyMax) { autoGrowActive = false; autoGrowRaf = null; return; }
      autoGrowRaf = requestAnimationFrame(tickAutoGrow);
    }

    function update(clientY, e) {
      if (!dragging) return;
      lastClientY = clientY;

      const goingDown = (clientY - prevClientY) > 0;
      prevClientY = clientY;
      
      if (isLast && !pinned && (clientY % 12 === 0)) {
        fingerLimit = getFingerLimitPx();
      }

      let dy = Math.max(dyMin, Math.min(clientY - startY, dyMax));

      // --- Déclenchement du pin (finger-only, robuste Android lent) ---
      if (isLast && !pinned) {
        // optionnel: n’autoriser le pin que si on descend
        if (goingDown && clientY >= fingerLimit) {
          pinned = true;
          pinAtY = clientY;
          pinDy0 = dy;
          autoGrowExtra = 0;

          autoGrowActive = true;
          if (!autoGrowRaf) autoGrowRaf = requestAnimationFrame(tickAutoGrow);
        }
      }    

      // 2) Mode pinned : croissance/décroissance continue sans lever le doigt
      if (isLast && pinned) {
        const fingerDelta = clientY - pinAtY; // peut être négatif

        // dy courant (continu) AVANT de toucher aux états
        let dyNow = pinDy0 + autoGrowExtra + fingerDelta;
        dyNow = Math.max(dyMin, Math.min(dyNow, dyMax));

        if (fingerDelta < 0) {
          // 1) stop autogrow immédiatement
          if (autoGrowActive) {
            autoGrowActive = false;
            if (autoGrowRaf) { cancelAnimationFrame(autoGrowRaf); autoGrowRaf = null; }
          }

          // 2) ✅ "bake" la hauteur courante comme nouvelle base
          //    => évite le retour brutal à pinDy0 (4-5 lignes)
          pinDy0 = dyNow;
          autoGrowExtra = 0;

          // 3) ✅ rebase le repère doigt (fingerDelta repart de 0)
          pinAtY = clientY;

          // dy devient exactement dyNow (continuité parfaite)
          dy = pinDy0;
        } else {
          // mouvement vers le bas (ou stable) : calcul normal
          dy = dyNow;
        }

        // (optionnel) dé-pin quand on est revenu en “mode normal”
        // Ici tu peux choisir un critère simple :
        // si on n'a plus d'extra et qu'on est revenu sous le pin => on repasse non pinned
        if (!autoGrowActive && autoGrowExtra === 0 && (clientY - pinAtY) <= 0) {
          pinned = false;
          startY = clientY - dy; // rebase pour transition douce
        }
      }

      // 3) Appliquer la hauteur finale (une seule fois “logiquement”)
      setH(paneTop, hTop + dy);

      // notify AG Grid (inchangé)
      try {
        const gridDiv = paneTop.querySelector('div[id^="grid"]');
        for (const g of (window.grids?.values?.() || [])) {
          if (g.el === gridDiv) { g.api.onGridSizeChanged(); break; }
        }
      } catch {}
    }

    function finish() {
      if (!dragging) return;
      dragging = false;
      lastHFrame = null;

      // 🆕 coupe l’auto-grow
      autoGrowActive = false;
      if (autoGrowRaf) { cancelAnimationFrame(autoGrowRaf); autoGrowRaf = null; }

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

    handle.addEventListener('pointerdown', ( /** @type {PointerEvent} */ e) => {
      if (!e.isPrimary) return;
      e.preventDefault();                 // IMPORTANT
      begin(e.clientY, e);
      if (!dragging) return;              // begin peut refuser si expander fermé
      try { handle.setPointerCapture(e.pointerId); } catch {}
    }, { passive: false });

    handle.addEventListener('pointermove', ( /** @type {PointerEvent} */ e) => {
      if (!dragging || !e.isPrimary) return;
      pendingY = e.clientY;

      if (rafPending) return;
      rafPending = true;

      requestAnimationFrame(() => {
        rafPending = false;
        update(pendingY, e);
      });
    }, { passive: true });

    handle.addEventListener('pointerup', ( /** @type {PointerEvent} */ e) => {
      if (!dragging) return;
      try { handle.releasePointerCapture(e.pointerId); } catch {}
      finish();
    }, { passive: true });

    handle.addEventListener('pointercancel', ( /** @type {PointerEvent} */ e) => {
      if (!dragging) return;
      try { handle.releasePointerCapture(e.pointerId); } catch {}
      finish();
    }, { passive: true });    
    
  });
}

// =======================
// Actions des boutons d'expanders
// =======================

function createWheelPicker(wrapEl) {
  const wheel = wrapEl.querySelector(".wheel");

  function installWheelSmart(wheelEl, { itemPx = 36 } = {}) {
    let locked = false;

    wheelEl.addEventListener("wheel", (ev) => {
      if (ev.ctrlKey) return;

      const isMouseLike = Math.abs(ev.deltaY) >= 50; // seuil à ajuster
      if (!isMouseLike) return; // trackpad => scroll natif

      ev.preventDefault();
      ev.stopPropagation();

      if (locked) return;
      locked = true;

      const dir = ev.deltaY > 0 ? 1 : -1;
      wheelEl.scrollTo({ top: wheelEl.scrollTop + dir * itemPx, behavior: "smooth" });

      setTimeout(() => { locked = false; }, 140);
    }, { passive: false });
  }

  function getCenteredItem() {
    const r = wheel.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const el = document.elementFromPoint(cx, cy);
    return el?.closest?.(".wheel-item") || null;
  }

  function getValue() {
    const it = /** @type {HTMLElement} */ (getCenteredItem());
    const v = it?.dataset?.v ?? "";
    return v === "" ? null : parseInt(v, 10);
  }

  function setValue(v) {
    const target = [...wheel.querySelectorAll(".wheel-item")]
      .find(el => (el.dataset.v ?? "") === String(v ?? ""));
    if (!target) return;

    const top =
      target.offsetTop -
      (wheel.clientHeight / 2 - target.clientHeight / 2);

    wheel.scrollTo({ top, behavior: "instant" });
  }

  installWheelSmart(wheel);
  return { getValue, setValue };
}

function getUuidsFromSelection(gridApi) {
  return new Set(
    gridApi.getSelectedNodes()
      .map(n => n?.data?.__uuid)
      .filter(Boolean)
  );
}

function getUuidsFromFilter(gridApi) {
  const s = new Set();
  gridApi.forEachNodeAfterFilter(n => {
    const id = n?.data?.__uuid;
    if (id) s.add(id);
  });
  return s;
}

function applyPrioriteImmutable(df, uuids, prioVal) {
  if (!uuids.size) return df;
  let changed = false;
  const out = df.slice();

  for (let i = 0; i < out.length; i++) {
    const r = out[i];
    if (uuids.has(r?.__uuid)) {
      out[i] = { ...r, Priorite: prioVal };
      changed = true;
    }
  }
  return changed ? out : df;
}

let _prioPopup = null;

function getOrCreatePrioPopup() {
  if (_prioPopup) return _prioPopup;

  // 1) créer DOM une fois
  const backdrop = document.createElement("div");
  backdrop.className = "prio-popup-backdrop";
  backdrop.hidden = true;

  backdrop.innerHTML = `
    <div class="prio-popup" role="dialog" aria-modal="true">
      <div class="prio-title">Priorité</div>

      <div class="wheel-wrap">
        <div class="wheel">
          <div class="wheel-spacer"></div>
          <div class="wheel-item" data-v="">Aucune</div>
          <div class="wheel-item" data-v="1">1</div>
          <div class="wheel-item" data-v="2">2</div>
          <div class="wheel-item" data-v="3">3</div>
          <div class="wheel-item" data-v="4">4</div>
          <div class="wheel-item" data-v="5">5</div>
          <div class="wheel-spacer"></div>
        </div>
        <div class="wheel-indicator"></div>
      </div>

      <div class="prio-actions">
        <button type="button" class="bb-btn is-primary" data-action="filter">
          Appliquer à filtre
        </button>
        <button type="button" class="bb-btn is-primary" data-action="selection">
          Appliquer à sélection
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(backdrop);

  const popup = /** @type {HTMLElement} */ (backdrop.querySelector(".prio-popup"));
  const picker = createWheelPicker(popup.querySelector(".wheel-wrap"));

  // 2) état dynamique (mis à jour à chaque open)
  let gridApi = null;
  let ctx = null;

  function close() {
    backdrop.hidden = true;
  }

  function onKey(ev) {
    if (ev.key === "Escape" && !backdrop.hidden) close();
  }

  function onBackdrop(ev) {
    // ferme si clic hors popup (fond)
    if (popup.contains(ev.target)) return;
    close();
  }

  // 3) listeners installés UNE FOIS
  document.addEventListener("keydown", onKey, true);
  backdrop.addEventListener("pointerdown", onBackdrop, true);

  popup.querySelectorAll("button[data-action]").forEach((b) => {
    /** @type {HTMLButtonElement} */
    const btn = /** @type {any} */ (b);

    // pointerdown > click (plus fiable avec swipe/drag)
    btn.addEventListener("pointerdown", (ev) => {
      ev.preventDefault();

      if (!gridApi || !ctx) { close(); return; }

      const prioVal = picker.getValue();
      const mode = btn.dataset.action;

      const uuids =
        mode === "selection"
          ? getUuidsFromSelection(gridApi)
          : getUuidsFromFilter(gridApi);

      ctx.mutateDf((df) => applyPrioriteImmutable(df, uuids, prioVal));

      if (mode === "selection") {
        // si on applique à la sélection, on peut se retrouver avec des lignes déplacées hors de la page courante → scroll pour les rendre visibles
        const node = gridApi.getSelectedNodes?.()[0];
        const rowIdx = node?.rowIndex ?? null;
        gridApi.ensureIndexVisible(rowIdx, 'middle');
      }

      // visible à l'écran (scroll horizontal). Si tu veux aussi dé-hider, c'est autre chose.
      gridApi.ensureColumnVisible?.("Priorite");

      close();
    }, true);
  });

  _prioPopup = {
    open({ gridApi: ga, ctx: c, defaultValue = null }) {
      gridApi = ga;
      ctx = c;
      const btnSel = /** @type {HTMLButtonElement} */ (popup.querySelector('button[data-action="selection"]'));
      if (btnSel) {
        const hasSelection = gridApi?.getSelectedNodes?.().length > 0;
        btnSel.disabled = !hasSelection;
      }
      picker.setValue(defaultValue);
      backdrop.hidden = false;
    },
    close
  };

  return _prioPopup;
}

function openPrioPopup({ gridApi, ctx, defaultValue = null }) {
  getOrCreatePrioPopup().open({ gridApi, ctx, defaultValue });
}

// function showPrioMenuUnderButton(btnEl, { onPick }) {
//   let cleaned = false;

//   const cleanup = () => {
//     if (cleaned) return;
//     cleaned = true;

//     document.removeEventListener("pointerdown", onDocPointerDown, true);
//     document.removeEventListener("keydown", onKeyDown, true);
//     window.visualViewport?.removeEventListener("resize", onViewportChange);
//     window.visualViewport?.removeEventListener("scroll", onViewportChange);

//     menu.remove();
//   };

//   // --- menu
//   const menu = document.createElement("div");
//   Object.assign(menu.style, {
//     position: "fixed",
//     zIndex: "999999",
//     minWidth: "80px",
//     background: "white",
//     border: "1px solid rgba(0,0,0,0.12)",
//     borderRadius: "10px",
//     boxShadow: "0 10px 30px rgba(0,0,0,0.18)",
//     padding: "6px",
//   });

//   const values = ["Aucune", "1", "2", "3", "4", "5"];
//   for (const v of values) {
//     const item = document.createElement("button");
//     item.type = "button";
//     item.textContent = v;
//     item.className = 'kebab-menu__item';

//     item.addEventListener("pointerenter", () => item.style.background = "rgba(0,0,0,0.06)");
//     item.addEventListener("pointerleave", () => item.style.background = "transparent");

//     item.addEventListener("click", (ev) => {
//       ev.preventDefault();
//       ev.stopPropagation();
//       cleanup();
//       const prioVal = (v === "Aucune") ? null : parseInt(v, 10);
//       try { onPick?.(prioVal); } catch {}
//     });

//     menu.appendChild(item);
//   }

//   document.body.appendChild(menu);

//   // --- position
//   const r = btnEl.getBoundingClientRect();
//   const margin = 6;

//   let left = r.left;
//   let top = r.bottom + margin;

//   const vw = window.innerWidth;
//   const vh = window.innerHeight;

//   const mw = menu.offsetWidth;
//   const mh = menu.offsetHeight;

//   if (left + mw > vw - 8) left = Math.max(8, vw - mw - 8);
//   if (top + mh > vh - 8) top = Math.max(8, r.top - mh - margin);

//   menu.style.left = `${left}px`;
//   menu.style.top = `${top}px`;

//   // --- handlers (fermés sur cleanup)
//   function onDocPointerDown(ev) {
//     const t = ev.target;
//     if (t instanceof Node && (menu.contains(t) || btnEl.contains(t))) return;
//     cleanup();
//   }

//   function onKeyDown(ev) {
//     if (ev.key === "Escape") cleanup();
//   }

//   function onViewportChange() {
//     cleanup();
//   }

//   document.addEventListener("pointerdown", onDocPointerDown, true);
//   document.addEventListener("keydown", onKeyDown, true);
//   window.visualViewport?.addEventListener("resize", onViewportChange);
//   window.visualViewport?.addEventListener("scroll", onViewportChange);

//   // retourner cleanup au caller
//   return cleanup;
// }

// function applyPrioriteToUuids(df, uuidsSet, prioVal) {
//   if (!Array.isArray(df) || !uuidsSet?.size) return df;

//   let changed = false;
//   const out = df.slice(); // copie du tableau

//   for (let i = 0; i < out.length; i++) {
//     const row = out[i];
//     const id = row?.__uuid;
//     if (!id || !uuidsSet.has(id)) continue;

//     // copie row + modif
//     const next = { ...row, Priorite: prioVal };
//     out[i] = next;
//     changed = true;
//   }

//   return changed ? out : df;
// }

// let closePrioMenu = null;

// function doSetPrio() {
//   const btnEl = document.getElementById('btn-setprio-non-prog');
//   const h = grids.get('grid-non-programmees');
//   const gridApi = h?.api;

//   if (!btnEl || !gridApi) return;

//   toggle : si déjà ouvert → fermer
//   if (closePrioMenu) {
//     closePrioMenu();
//     closePrioMenu = null;
//     return;
//   }

//   closePrioMenu = showPrioMenuUnderButton(btnEl, {
//     onPick: (prioVal) => {
//       closePrioMenu = null;

//       const uuids = new Set();
//       gridApi.forEachNodeAfterFilter((n) => {
//         const id = n?.data?.__uuid;
//         if (id) uuids.add(id);
//       });

//       ctx.mutateDf((df) => {
//         return applyPrioriteToUuids(df, uuids, prioVal);
//       });

//       ensurePrioColumnVisible(gridApi, "Priorite");

//       refreshAllGrids?.();
//     }
//   });
// }

function doSetPrio() {
  const h = grids.get("grid-non-programmees");
  const gridApi = h?.api;
  openPrioPopup({ gridApi, ctx, defaultValue: null });
}

// Suppression d'une activité
async function doSupprimerActivite() {
  const row = getSelectedRow('grid-non-programmees');
  if (!row) return;
  const uuid = row.__uuid;
  const uuidVoisin = getLigneVoisineUuid(grids.get('grid-non-programmees').api, uuid);

  ctx.dfRemove(row.__uuid);
  
  // Maj des sélections
  setTimeout(() => {
    selectRowByUuid('grid-non-programmees', uuidVoisin, { ensure: 'center', flash: null });
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
  const uuidVoisin = getLigneVoisineUuid(grids.get('grid-programmables'), uuid);

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
        payload.__uuid = genUUID();
      }
      next.push(payload);
    }

    // trie final 
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
  dropRowFromSrcGridToDstGrid('grid-programmables', 'grid-programmees', 'exp-programmees', uuidVoisin, uuid, {scroll:true});
}

// Déprogrammation d'une activité programmée
async function doDeprogrammerActivite() {
  const row = getSelectedRow('grid-programmees');
  if (!row) return;  
  if (activitesAPI.estActiviteReservee(row)) return;
  const uuid = row.__uuid;
  const uuidVoisin = getLigneVoisineUuid(grids.get('grid-programmees'), uuid);

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

  dropRowFromSrcGridToDstGrid('grid-programmees', 'grid-non-programmees', 'exp-non-programmees', uuidVoisin, uuid, {scroll:false});
}
