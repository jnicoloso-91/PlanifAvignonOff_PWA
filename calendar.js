// ===============================
// Utilitaires Calendrier
// ===============================

import { 
  genUUID,
  afterFrames,
} from './utils.js'; 

import { 
  prettyToMinutes, 
  parseHHMM,
  isWeekendDateInt,
  toDateint,
} from './utils-date.js';

import {
  ensureRowVisible,
  getSelectedRow,
  getSelectedRowUuid,
  selectRowByUuid,
  selectCreneauFromSrcUuid,
} from './grids.js';

import { 
  resolveAddress, 
  buildDirectionsUrl, 
} from './LieuRenderer.js';

import { 
  ctx,
  activitesAPI,
} from './app.js'; 

import { 
  sortDf, 
} from './activites.js'; 

import { 
  addExpanderButton,
} from './expanders.js'; 

import {
  openPopoverNear,
} from './infos-plus.js';

import {
  openSheetReprogrammer,
} from './sheets.js';
import { logToPage } from './debug.js';

export const PX_PER_MIN = 1.1;         // 1.0..1.4

// Cache de la hauteur de la grille grid-programmees (px)
let _cachedGridHeightPx = null;

// Cache de la hauteur calculée du calendrier (px)
let _cachedCalHeightPx = null;

// --- helpers temps ---

// Clamp un nombre n entre a et b
function clamp(n, a, b){ return Math.max(a, Math.min(b, n)); }

// --- helpers days range ---
function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function dateToDateInt(d){
  return (d.getFullYear()*10000) + ((d.getMonth()+1)*100) + d.getDate();
}

// Renvoie la racine du calendrier
function getCalRoot() {
  return document.getElementById("calA");
}

// Renvoie le container des jours du calendrier
export function getCalDays() {
  return document.getElementById("calADays");
}

// Renvoie le conteneur du scroller de jours du calendrier
export function getDaysScroll() {
  return document.querySelector("#calA .cal-days-scroll");
}

// Renvoie la colonne jour du calendrier pour une dateint donnée
function getDayColumn(dateInt) {
  return document.querySelector(`#calA .cal-col[data-dateint="${dateInt}"]`);
}

// Renvoie l’élément event du calendrier pour un uuid donné
function getEventNodeByUuid(uuid) {
  if (!uuid) return null;
  return document.querySelector(`#calA .cal-ev[data-uuid="${CSS.escape(uuid)}"]`);
}

// Renvoie le scroll container d'un élément
function getScrollContainer(el) {
  let cur = el.parentElement;

  while (cur) {
    const style = getComputedStyle(cur);
    const overflowY = style.overflowY;

    if (overflowY === "auto" || overflowY === "scroll") {
      return cur;
    }

    cur = cur.parentElement;
  }

  return document.scrollingElement; // fallback page
} 

// Renvoie true si un élément est partiellement visible dans son scroll container
function isCalendarEventVisible(eventNode, { partial = true } = {}) { 
  if (!eventNode) return false;
  const container = getScrollContainer(eventNode);
  if (!container) return false;

  const elRect = eventNode.getBoundingClientRect();
  const cRect  = container.getBoundingClientRect();

  if (partial) {
    return (
      elRect.bottom > cRect.top &&
      elRect.top < cRect.bottom &&
      elRect.right > cRect.left &&
      elRect.left < cRect.right
    );
  } else {
    return (
      elRect.top >= cRect.top &&
      elRect.bottom <= cRect.bottom &&
      elRect.left >= cRect.left &&
      elRect.right <= cRect.right
    );
  }
}

// Scroll le calendrier pour rendre un event visible (si pas déjà visible)
export function ensureCalendarEventVisible(uuid, { partial = true, smooth = true, checkVisibility = true, targetTop = null } = {}) {
  const ev = getEventNodeByUuid(uuid);
  if (!ev) return false;
  if (checkVisibility && isCalendarEventVisible(ev, { partial })) {
    return true;
  }
  const row = ctx.df?.find(r => r && r.__uuid === uuid);
  const dateInt = Number(row?.Date) || null;
  scrollCalendarToDay(dateInt);
  scrollCalendarToEvent(uuid, { smooth, targetTop });
  return true;
}

// Renvoie le body de l’expander du calendrier
function getProgrammePaneBody() {
  return document.querySelector("#exp-programmees .st-expander-body");
}

// Renvoie la hauteur actuelle de l’expander du calendrier (px)
function getProgrammePaneHeightPx() {
  const body = getProgrammePaneBody();
  return body ? Math.round(body.getBoundingClientRect().height) : null;
}

// Sauvegarde la hauteur de l’expander de grid-programmees pour le mode grille (px)
export function saveProgrammeGridHeight(h=null) {
  if (h == null) h = getProgrammePaneHeightPx();
  if (h != null && h > 0) _cachedGridHeightPx = h;
}

// Sauvegarde la hauteur actuelle de l’expander du calendrier si pas déjà suavegardée (px)
function saveProgrammeGridHeightOnce() {
  if (_cachedGridHeightPx != null) return;
  const h = getProgrammePaneHeightPx();
  if (h != null && h > 0) _cachedGridHeightPx = h;
}

// Restaure la hauteur de l’expander du calendrier sauvegardée pour le mode grille (px)
function restoreProgrammeGridHeight() {
  const body = getProgrammePaneBody();
  if (!body) return;
  if (_cachedGridHeightPx != null) {
    (/** @type {HTMLElement} */ (body)).style.setProperty("height", `${_cachedGridHeightPx}px`, "important");
  }
  _cachedGridHeightPx = null;
}

// Convertit "heures visibles" -> hauteur max expander (px)
function hoursToCalMaxHeightPx(hours) {
  // viewport timeline px (minutes * px/min)
  const timelinePx = Math.round(hours * 60 * PX_PER_MIN);

  // overhead : header expander + paddings internes + header jour + gap
  // On met une marge safe ; si tu veux, on le mesurera dynamiquement.
  const overhead = 110;

  return timelinePx + overhead;
}

// Convertit vh -> px
function vhToPx(vh) {
  return Math.round(window.innerHeight * (vh / 100));
}

// Hauteur par défaut du calendrier (px)
function programmeCalDefaultHeightPx() {
  const defCalPx = hoursToCalMaxHeightPx(5); // 5h visibles (9->14)
  const fiftyVhPx = vhToPx(32);

  return Math.min(defCalPx, fiftyVhPx);
}

// Hauteur max absolue du calendrier (px)
export function programmeCalAbsoluteMaxHeightPx() {
  // 24h visibles max
  return hoursToCalMaxHeightPx(24);
}

// Applique la hauteur par défaut du calendrier (px)
function applyProgrammeCalendarDefaultHeight() {
  const body = getProgrammePaneBody();
  if (!body) return;
  if (_cachedCalHeightPx === null) _cachedCalHeightPx = programmeCalDefaultHeightPx();
  (/** @type {HTMLElement} */ (body)).style.setProperty("height", `${_cachedCalHeightPx}px`, "important");
}

// Récupère le jour sélectionné (dateint) depuis grid-programmees
function getSelectedProgrammeDateInt() {
  try {
    const row = getSelectedRow?.("grid-programmees");
    const d = row?.Date ?? row?.date ?? row?.DATE;
    return (d|0);
  } catch {
    return null;
  }
}

// Construit un tableau de dateints couvrant la période donnée
function buildDaysRange(pp) {
  if (!pp?.debut || !pp?.fin) return [];
  const start = startOfDay(pp.debut);
  const end = startOfDay(pp.fin);
  if (end < start) return [];
  const out = [];
  let cur = start;
  while (cur <= end) {
    out.push(dateToDateInt(cur));
    cur = addDays(cur, 1);
  }
  return out;
}

// Centre un jour donné dans le viewport du calendrier (scroll horizontal)
function centerDayInViewport(dateInt, { smooth = true } = {}) {
  const scroller = getDaysScroll();
  const day = getDayColumn(dateInt);
  if (!scroller || !day) return false;

  const scRect = scroller.getBoundingClientRect();
  const dRect  = day.getBoundingClientRect();

  // centre de la colonne jour par rapport au viewport scroll horizontal
  const dayCenter = (dRect.left - scRect.left) + (dRect.width / 2);
  const targetLeft = scroller.scrollLeft + dayCenter - (scRect.width / 2);

  scroller.scrollTo({
    left: Math.max(0, targetLeft),
    behavior: smooth ? "smooth" : "auto"
  });

  return true;
}

/**
 * Centre le calendrier sur un jour + event sélectionné ou heure fallback
 * @param {*} param0 
 * @returns 
 */
function snapProgrammeCalendar({
  dateInt,
  uuid = null,
  fallbackHour = 9,
  smooth = true
} = {}) {
  if (!dateInt) return;

  // 1) centre la colonne jour (scroll horizontal)
  centerDayInViewport(dateInt, { smooth });

  // 2) attendre layout stable (meilleur que setTimeout)
  requestAnimationFrame(() => {
    requestAnimationFrame(async () => {
      if (uuid) {
        await waitForScrollCalendarToStabilize();
        scrollCalendarToEvent(uuid, { dateInt, smooth: true, preferBottom: false }); 
      }
    });
  });
}

// Normalise la période pour qu’elle recouvre les dates des rows
function normalizePeriodeFromRowsIfNeeded(pp, rows) {
  // rows dates
  const dints = (rows || [])
    .map(r => r.Date)
    .filter(n => typeof n === "number" && n > 10000101);

  if (!dints.length) return pp; // rien à faire

  const minD = Math.min(...dints);
  const maxD = Math.max(...dints);

  const ppStart = pp?.debut ? dateToDateInt(pp.debut) : null;
  const ppEnd   = pp?.fin   ? dateToDateInt(pp.fin)   : null;

  // si pp absent ou ne recouvre rien du tout, on reconstruit
  const ppInvalid =
    !ppStart || !ppEnd ||
    (ppEnd < minD) ||
    (ppStart > maxD);

  if (!ppInvalid) return pp;

  // construit debut/fin en Date locale (00:00)
  const toDate = (dint) => {
    const s = String(dint);
    const y = +s.slice(0, 4), m = +s.slice(4, 6), d = +s.slice(6, 8);
    return new Date(y, m - 1, d);
  };

  return { debut: toDate(minD), fin: toDate(maxD) };
}

// Scroll le calendrier horizontalement pour afficher un jour donné
export function scrollCalendarToDay(dateInt) {
  const cal = getCalRoot();
  if (!cal) return;

  const scroller = cal.querySelector(".cal-days-scroll");
  const dayEl = cal.querySelector(`.cal-col[data-dateint="${dateInt}"]`);
  if (!scroller || !dayEl) return;

  const sRect = scroller.getBoundingClientRect();
  const dRect = dayEl.getBoundingClientRect();
  const curLeft = scroller.scrollLeft;

  // center in view
  const delta =
    (dRect.left - sRect.left) -
    (sRect.width / 2 - dRect.width / 2);

  scroller.scrollTo({
    left: curLeft + delta,
    behavior: "smooth"
  });
}

// Scroll le calendrier verticalement pour afficher un event donné
function scrollCalendarToEvent(uuid, {
  dateInt = null,
  gapTopPx = 12,
  gapBottomPx = 16,
  smooth = false,
  preferBottom = true,
  bottomBias = 0.75, // 0.5=center, 0.75=plutôt bas, 0.9=très bas
  targetTop = null,
} = {}) {
  const calA = getCalRoot();
  if (!calA || !uuid) return false;

  // const ev = calA.querySelector(`.cal-ev[data-uuid="${CSS.escape(uuid)}"]`);
  let ev = null;

  if (dateInt != null) {
    ev = calA.querySelector(
      `.cal-ev[data-uuid="${CSS.escape(uuid)}"][data-dateint="${dateInt}"]`
    );
  }

  if (!ev) {
    ev = calA.querySelector(`.cal-ev[data-uuid="${CSS.escape(uuid)}"]`);
  }

  if (!ev) return false;

  const scroller = calA.querySelector(".cal-scroll-y");
  if (!scroller) return false;

  const viewportH = scroller.clientHeight;

  // ✅ Position réelle de l’event dans le scroller global
  const scrollerRect = scroller.getBoundingClientRect();
  const evRect = ev.getBoundingClientRect();
  const evTop = (evRect.top - scrollerRect.top) + scroller.scrollTop;
  const evH = evRect.height;
  const evBottom = evTop + evH;

  const maxScroll = Math.max(0, scroller.scrollHeight - viewportH);

  // Intervalle de scroll qui garantit que l’event est entièrement visible
  const minForBottom = Math.max(0, (evBottom + gapBottomPx) - viewportH);
  const maxForTop = Math.max(0, evTop - gapTopPx);

  if (targetTop == null) {
    const usableViewport = Math.max(0, viewportH - gapTopPx - gapBottomPx);

    if (evH >= usableViewport) {
      targetTop = maxForTop;
    }
    else if (preferBottom) {
      const desiredEvTopInViewport = gapTopPx + usableViewport * bottomBias;
      targetTop = evTop - desiredEvTopInViewport;
      targetTop = Math.max(minForBottom, Math.min(targetTop, maxForTop));
    }
    else {
      targetTop = evTop - (viewportH - evH) / 2;
      targetTop = Math.max(minForBottom, Math.min(targetTop, maxForTop));
    }

    targetTop = Math.max(0, Math.min(targetTop, maxScroll));
  }

  scroller.scrollTo({
    top: targetTop,
    behavior: smooth ? "smooth" : "auto",
  });

  return true;
}

// Indique si le calendrier est visible
export function isProgrammeCalendarVisible() {
  const calA = document.getElementById("calA");
  // hidden prend le dessus si tu l’utilises
  return !!calA && !calA.hidden && calA.style.display !== "none";
}

// Sélectionne un event dans le calendrier par son uuid (i.e. met 'is-selected' sur ev, ne séléctionne pas la row correspondante dans la grille) 
function selectEventByUuid(uuid) {
  if (!uuid) return;
  const daysEl  = document.getElementById("calADays"); // ✅ conteneur des colonnes
  daysEl.querySelectorAll(".cal-ev.is-selected").forEach(x => x.classList.remove("is-selected"));
  const ev = getEventNodeByUuid(uuid);
  if (ev) ev.classList.add('is-selected');
}

// Sélectionne l’event courant dans le calendrier
function selectCurrentEventInCalendar() {
  const selUuid = getSelectedRowUuid('grid-programmees');
  selectEventByUuid(selUuid);
}

// Construire l’URL externe de recherche d’itinéraire vers une adresse
function openDirectionsExternal(url) {
  if (!url) return;

  const ua = navigator.userAgent || '';
  const isIOS =
    /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  const isStandalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;

  // iOS : on appelle directement l'appli google maps 
  // (dans ce cas l'url retournée par buildDirectionsUrl est celle de l'appli pas celle de la webview)
  if (isIOS) {
    window.location.href = url;
    return;
  }

  // Sinon : ouvrir en nouvel onglet. Pas de fallback assign.
  const w = window.open(url, '_blank'); //, 'noopener,noreferrer');
  if (!w) {
    // popup bloqué : ne pas casser l'app
    console.warn("[CAL] popup blocked for directions");
    // option : toast / hint user
  }
}

// Branchement sur la recherche d'itinéraire par double click/tap sur event
function bindItineraryGesture(el, lieu) {
  if (!lieu) return;

  const addr = resolveAddress(lieu) || '';              // string
  const url  = addr ? buildDirectionsUrl(addr) : '';    // string ou ''

  const isTouch = matchMedia('(pointer: coarse)').matches;
  const isMouse = matchMedia('(pointer: fine)').matches;

  // Desktop : double click
  if (isMouse) {
    el.addEventListener('dblclick', e => {
      e.preventDefault();
      e.stopPropagation();
      openDirectionsExternal(url);
    });
  }

  // Mobile : double tap
  if (isTouch) {
    let last = 0;
    el.addEventListener('touchend', e => {
      const now = Date.now();
      if (now - last < 280) {
        e.preventDefault();
        openDirectionsExternal(url);
      }
      last = now;
    });
  }
}

// DOM mount
function ensureProgrammeCalendarDOM() {
  const host = document.getElementById("gridA");
  if (!host) return null;

  const body = host.closest(".st-expander-body");
  if (!body) return null;

  // Déjà monté ?
  let wrap = body.querySelector(".programme-host-wrap");
  if (wrap) {
    return {
      wrap,
      gridEl: wrap.querySelector(".programme-grid-slot"),
      calEl: wrap.querySelector(".programme-cal-slot"),
    };
  }

  // Wrapper principal
  wrap = document.createElement("div");
  wrap.className = "programme-host-wrap";

  // Slot grille
  const gridSlot = document.createElement("div");
  gridSlot.className = "programme-grid-slot";

  // Slot calendrier
  const calSlot = document.createElement("div");
  calSlot.className = "programme-cal-slot is-hidden";

  // Montage DOM
  body.insertBefore(wrap, host);
  gridSlot.appendChild(host);     // on déplace #gridA dedans
  wrap.appendChild(gridSlot);
  wrap.appendChild(calSlot);

  return { wrap, gridEl: gridSlot, calEl: calSlot };
}

// Recupère toutes les rows d'une grille par son id (ex: "grid-creneaux")
function getAllRowsFromGrid(gridId) {
  const h = window.grids?.get(gridId);
  const api = h?.api;
  if (!api) return [];
  const out = [];
  api.forEachNode?.(n => { if (n?.data) out.push(n.data); });
  return out;
}

// Récupère le 1er créneau d'une journée (dateInt) parmi les rows de grid-creneaux
function getFirstCreneauOfDay(creneauxRows, dateInt) {
  const d = String(dateInt);
  const list = (creneauxRows || []).filter(r => String(r?.Date ?? "") === d);
  if (!list.length) return null;

  list.sort((a,b) => (parseHHMM(a.Debut) ?? 999999) - (parseHHMM(b.Debut) ?? 999999));
  return list[0] || null;
}

// Récupère le créneau "journée" d'une journée (dateInt) parmi les rows de grid-creneaux
function getJourneeCreneauOfDay(creneauxRows, dateInt) {
  const d = String(dateInt);
  return (creneauxRows || []).find(r =>
    String(r?.Date ?? "") === d &&
    String(r?.__type_creneau ?? "").toLowerCase() === "journée"
  ) || null;
}

/**
 * Sélectionne un event dans le calendrier par son uuid + centre dessus + synchronise la sélection dans la grille
 * @param {*} param0 
 * @returns 
 */
function selectCalendarEventAndSync({ daysEl, dateInt, uuid, smooth = true, snap=true } = {}) {
  if (!uuid) return false;

  // visuel calendrier
  daysEl?.querySelectorAll(".cal-ev.is-selected").forEach(x => x.classList.remove("is-selected"));
  const evEl = daysEl?.querySelector(`.cal-ev[data-uuid="${CSS.escape(uuid)}"]`);
  if (evEl) evEl.classList.add("is-selected");

  // snap calendrier (comme handler de click)
  if (snap) {
    try {
      snapProgrammeCalendar?.({
        dateInt,
        uuid,
        fallbackHour: 9,
        smooth
      });
    } catch {}
  }

  // sélection grid-programmees -> onSelectionChanged de la grille fera le reste
  try { 
    selectRowByUuid?.("grid-programmees", uuid); 
    selectCreneauFromSrcUuid?.(uuid);
  } catch {}

  return true;
}

// Désélectionne tous les events du calendrier et de la grille grid-programmees 
function deselectAllCalendarEvents(daysEl) {
  if (!daysEl) return;

  // 1️⃣ clear selection calendrier
  daysEl.querySelectorAll(".cal-ev.is-selected")
    .forEach(x => x.classList.remove("is-selected"));

  // 2️⃣ clear sélection grid-programmees
  try {
    const handle = window.grids?.get("grid-programmees");
    handle?.api?.deselectAll?.();
  } catch {}
}

// Sélectionne le premier creneau du jour dans le calendrier en partant du header du jour.
function pickCreneauFromDay(daysEl, dayNode, dateInt) {
  const creneaux = getAllRowsFromGrid("grid-creneaux");

  // ✅ fallback journée vide : priorité au créneau Type="Journée"
  const journee = getJourneeCreneauOfDay(creneaux, dateInt);
  if (journee?.__uuid) {

    // 1️⃣ clear selection calendrier et grille
    // Sinon le OnSelectionChanged de grid-creneaux va resélectionner la sélection courante
    // Et recentrer le calender sur le day correspondant.
    deselectAllCalendarEvents(daysEl);

    // 3️⃣ sélectionner le créneau journée + snap dessus
    selectRowByUuid("grid-creneaux", journee.__uuid);
    ensureRowVisible?.("grid-creneaux", journee.__uuid);
    return;
  }

  // ✅ cas nominal : 1er créneau (Avant/Après) trié par Debut
  const cr = getFirstCreneauOfDay(creneaux, dateInt);
  const uuid = cr?.__srcUuid || null;
  if (uuid) {
    const ok = selectCalendarEventAndSync({ daysEl, dateInt, uuid, smooth: true });
    if (ok) return;
  }

  // --- fallback (option 1) : journée pleine / pas de créneau => prendre 1er event du jour
  const firstEv = dayNode?.querySelector(".cal-timeline .cal-ev");
  const uuid2 = firstEv?.dataset?.uuid || null;
  if (uuid2) {
    selectCalendarEventAndSync({ daysEl, dateInt, uuid: uuid2, smooth: true });
    return;
  }

  // dernier fallback : juste snap sur le jour (heure par défaut)
  try {
    snapProgrammeCalendar?.({ dateInt, uuid: null, fallbackHour: 9, smooth: true });
  } catch {}
}

// Trouve l’uuid d’un event à sélectionner avant de déprogrammer une journée 
function findAnchorEventUuidForDayDelete(rows, targetDateInt, { daysRange = null } = {}) {
  const dateInt = Number(targetDateInt);
  if (!dateInt) return null;

  // rows = tes rows "programmees" (avec Date, __uuid, Debut, etc.)
  // Optionnel: daysRange = tableau des dates affichées (buildDaysRange(pp))
  const inRange = (d) => !daysRange || daysRange.includes(d);

  // 1) candidates previous day: Date < dateInt
  const prev = (rows || [])
    .filter(r => Number(r?.Date) < dateInt && r?.__uuid && inRange(Number(r.Date)))
    .sort((a,b) => (Number(a.Date) - Number(b.Date)) || ((parseHHMM(a.Debut)||0) - (parseHHMM(b.Debut)||0)));

  if (prev.length) {
    // dernier événement du jour précédent => en fait "dernier événement avant dateInt"
    return prev[prev.length - 1];
  }

  // 2) candidates next day: Date > dateInt
  const next = (rows || [])
    .filter(r => Number(r?.Date) > dateInt && r?.__uuid && inRange(Number(r.Date)))
    .sort((a,b) => (Number(a.Date) - Number(b.Date)) || ((parseHHMM(a.Debut)||0) - (parseHHMM(b.Debut)||0)));

  if (next.length) {
    // premier événement du jour suivant (ou premier après dateInt)
    return next[0];
  }

  return null;
}

// Render calendar
function getProgrammeCalendarScrollTop(daysEl) {
  const scroller = daysEl?.querySelector(".cal-scroll-y");
  return scroller ? scroller.scrollTop : 0;
}

// Set le scroll top du calendar
function setProgrammeCalendarScrollTop(daysEl, top) {
  const scroller = daysEl?.querySelector(".cal-scroll-y");
  if (scroller) scroller.scrollTop = top || 0;
}

// Renvoie le next dateint
function nextDateInt(dateInt) {
  const s = String(dateInt);
  const y = Number(s.slice(0,4));
  const m = Number(s.slice(4,6)) - 1;
  const d = Number(s.slice(6,8));

  const dt = new Date(y, m, d);
  dt.setDate(dt.getDate() + 1);

  const yy = dt.getFullYear();
  const mm = String(dt.getMonth()+1).padStart(2,"0");
  const dd = String(dt.getDate()).padStart(2,"0");

  return Number(`${yy}${mm}${dd}`);
}

// Render du calendar
function renderProgrammeCalendar(daysEl, rows, pp, selectedDateInt) {
  if (!daysEl) return;

  const days = buildDaysRange(pp) || [];

  // ---------- byDay ----------
  const byDay = new Map();
  for (const d of days) byDay.set(d, []);

  for (const r of (rows || [])) {

    const d = r.Date;
    if (!d) continue;

    const startMin = parseHHMM(r.Debut) ?? 0;

    const durMin =
      (typeof prettyToMinutes === "function")
        ? prettyToMinutes(r.Duree)
        : (parseHHMM(r.Duree) ?? 0);

    let remaining = durMin || 0;
    let curDate = d;
    let curStart = startMin;

    while (remaining > 0) {

      if (!byDay.has(curDate)) break;

      const segEnd = Math.min(24*60, curStart + remaining);
      const segDur = segEnd - curStart;

      const seg = {
        ...r,
        _segStartMin: curStart,
        _segEndMin: segEnd,
        _segIsContinuation: curDate !== d,
        _segContinuesNext: (curStart + remaining) > 24*60
      };

      byDay.get(curDate).push(seg);

      remaining -= segDur;
      curDate = nextDateInt(curDate);
      curStart = 0;
    }
  }

  for (const [d, list] of byDay) {
    list.sort((a, b) => (a._segStartMin ?? parseHHMM(a.Debut) ?? 0) - (b._segStartMin ?? parseHHMM(b.Debut) ?? 0));
  }

  // ---------- constants ----------
  const DAY_MINUTES = 24 * 60;
  const timelineH = Math.round(DAY_MINUTES * PX_PER_MIN);

  const fmtDay = (dint) => {
    const s = String(dint);
    const y = s.slice(0, 4), m = s.slice(4, 6), d = s.slice(6, 8);
    return `${d}/${m}/${y}`;
  };

  // ---------- save previous global scroll ----------
  const prevScrollTop = getProgrammeCalendarScrollTop(daysEl);

  // ---------- reset ----------
  daysEl.innerHTML = "";
  daysEl.classList.add("cal-grid");

  // ---------- root structure ----------
  const headRow = document.createElement("div");
  headRow.className = "cal-head-row";

  const scrollY = document.createElement("div");
  scrollY.className = "cal-scroll-y";

  const cols = document.createElement("div");
  cols.className = "cal-cols";

  scrollY.appendChild(cols);
  daysEl.appendChild(headRow);
  daysEl.appendChild(scrollY);

  for (const dint of days) {
    const list = byDay.get(dint) || [];
    const isWeekend = isWeekendDateInt(dint);

    // ===== HEADER =====
    const header = document.createElement("div");
    header.className = "cal-day__header";
    header.dataset.dateint = String(dint);

    header.innerHTML = `
      <div class="cal-day__title">${fmtDay(dint)}</div>
      <div class="cal-day__actions">
        <div class="cal-day__meta">${list.length} év.</div>
      </div>
    `;

    if (isWeekend) {
      header.querySelector(".cal-day__title")
        ?.setAttribute("data-weekend", "true");
    }

    const headerHandler = (e) => {
      e.preventDefault?.();
      e.stopPropagation?.();
      pickCreneauFromDay(daysEl, header, dint);
    };

    header.addEventListener("click", headerHandler);
    header.addEventListener("touchstart", headerHandler, { passive: false });

    headRow.appendChild(header);

    // ===== COLUMN =====
    const col = document.createElement("div");
    col.className = "cal-col";
    col.dataset.dateint = String(dint);

    const tl = document.createElement("div");
    tl.className = "cal-timeline";
    tl.style.height = `${timelineH}px`;
    tl.style.minHeight = `${timelineH}px`;
    tl.dataset.pxPerMin = String(PX_PER_MIN);

    // zone nuit 00:00 → 07:00
    const nightStartMin = 0;
    const nightEndMin = 7 * 60;

    const nightTop = Math.round(nightStartMin * PX_PER_MIN);
    const nightHeight = Math.round((nightEndMin - nightStartMin) * PX_PER_MIN);

    const night = document.createElement("div");
    night.className = "cal-night";
    night.style.top = `${nightTop}px`;
    night.style.height = `${nightHeight}px`;

    tl.appendChild(night);

    // hour lines + labels
    for (let h = 0; h <= 24; h++) {
      const y = Math.round(h * 60 * PX_PER_MIN);

      const hr = document.createElement("div");
      hr.className = "cal-hour";
      hr.style.top = `${y}px`;

      const lab = document.createElement("div");
      lab.className = "cal-hour__label";
      lab.style.top = `${y}px`;
      lab.textContent = `${String(h).padStart(2, "0")}:00`;

      tl.appendChild(hr);
      tl.appendChild(lab);
    }

    // events blocks
    for (const r of list) {
      const startMin = r._segStartMin ?? (parseHHMM(r.Debut) ?? 0);

      const durMin =
        (typeof prettyToMinutes === "function")
          ? prettyToMinutes(r.Duree)
          : (parseHHMM(r.Duree) ?? 0);

      const endMin = r._segEndMin ?? clamp(startMin + (durMin || 0), 0, DAY_MINUTES);

      const top = Math.round(startMin * PX_PER_MIN);
      const height = Math.max(18, Math.round((endMin - startMin) * PX_PER_MIN));

      const ev = document.createElement("div");
      ev.className = "cal-ev";
      ev.style.top = `${top}px`;
      ev.style.height = `${height}px`;
      ev.dataset.uuid = r.__uuid || "";
      ev.dataset.dateint = String(dint);
      ev.dataset.startMin = String(startMin);
      ev.dataset.endMin = String(endMin);

      if (r._segIsContinuation) ev.classList.add("is-continuation-prev");
      if (r._segContinuesNext) ev.classList.add("is-continuation-next");

      const timeLabel = `${r.Debut || ""} → ${r.Fin || ""}`.trim();

      const raw = r.Hyperlien || "";
      const href = raw || (
        "https://www.festivaloffavignon.com/resultats-recherche?recherche=" +
        encodeURIComponent(r.Activite || "")
      );

      const titleHtml =
        `<a class="cal-ev__title"
            href="${href}"
            target="_blank"
            rel="noopener">
            ${r.Activite ?? ""}
        </a>`;

      const hasInfo = !!(r.__desc_summary || r.__avis_summary);
      const infoBtnHtml = hasInfo
        ? `<button type="button" class="cal-ev__info" aria-label="Infos" title="Infos">ℹ︎+</button>`
        : "";

      ev.innerHTML = `
        <div class="cal-ev__time">
          <span class="cal-ev__timeText">${timeLabel}</span>
          ${infoBtnHtml}
        </div>
        ${titleHtml}
        <div class="cal-ev__place">${r.Lieu ?? ""}</div>
      `;

      ev.addEventListener("click", (e) => {
        e.stopPropagation();
        daysEl.querySelectorAll(".cal-ev.is-selected").forEach(x => x.classList.remove("is-selected"));
        ev.classList.add("is-selected");

        snapProgrammeCalendar({
          dateInt: dint,
          uuid: r.__uuid,
          fallbackHour: 9,
          smooth: true
        });

        try {
          selectRowByUuid?.("grid-programmees", r.__uuid);
          selectCreneauFromSrcUuid?.(r.__uuid);
        } catch {}
      });

      if (hasInfo) {
        const btn = ev.querySelector(".cal-ev__info");
        if (btn) {
          btn.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();

            openPopoverNear(btn, {
              title: r.Activite || r.activite || "Détails",
              style: r.Style,
              desc: r.__desc_summary,
              avis: r.__avis_summary,
              mood: r.Mood,
              note: r?.Note || null,
            });
          }, { passive: false });
        }
      }

      bindItineraryGesture(ev, r.Lieu);

      tl.appendChild(ev);
    }

    col.appendChild(tl);
    cols.appendChild(col);
  }

  queueMicrotask(() => {
    setProgrammeCalendarScrollTop(daysEl, prevScrollTop);
    selectCurrentEventInCalendar();
  });
}

// Re-render calendar (data + sélection + scroll)
export function rerenderProgrammeCalendar({ snapDay = true, defaultHour = 9, defaultDay = null, snapFirstEvent = false } = {}) {
  const calA = document.getElementById("calA");
  const calADays = document.getElementById("calADays");
  if (!calA || !calADays) return;

  const rows = getProgrammeCalendarDataSource();

  let pp = activitesAPI.getPeriodeProgrammation?.();
  pp = normalizePeriodeFromRowsIfNeeded(pp, rows);

  const selD = defaultDay ? defaultDay : getSelectedProgrammeDateInt();
  const selUuid = getSelectedRowUuid('grid-programmees'); 
  // const prevScrollTops = getCalDayScrollTops(calADays);
  
  renderProgrammeCalendar(calADays, rows, pp, selD);

  // post-render snapping
  requestAnimationFrame(() => {
    if (snapDay && selD) scrollCalendarToDay?.(selD);         // scroll horizontal vers le jour de l’event sélectionné
    if (selUuid) {
      ensureCalendarEventVisible(selUuid);                          // scroll minimal pour rendre l’event visible
      selectEventByUuid(selUuid);                                   // sélection visuelle de l’event  
    }
    else if (snapFirstEvent && rows.length > 0) {
      ensureCalendarEventVisible(rows[0].__uuid); 
    }
  });
}

// Toggle: grid <-> calendar
const KEY_PROG_VIEW = "exp-programmees:view"; // "grid" | "calendar"
function getProgrammeViewMode(){
  try { return localStorage.getItem(KEY_PROG_VIEW) || "grid"; } catch { return "grid"; }
}
function setProgrammeViewMode(v){
  try { localStorage.setItem(KEY_PROG_VIEW, v); } catch {}
}

// Récupère les lignes filtrées de la grille programmees
function getFilteredProgrammeRows() {
  const g = window.grids?.get("grid-programmees");
  if (!g) return [];

  const rows = [];
  g.api.forEachNodeAfterFilterAndSort(node => {
    if (node.data) rows.push(node.data);
  });
  return rows;
}

// Attend que la grille programmees soit prête (firstDataRendered)
function waitForProgrammeGridReadyOnce(timeoutMs = 1200) {
  return new Promise((resolve) => {
    const g = window.grids?.get?.("grid-programmees");
    if (!g?.api) return resolve(false);

    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      try { g.api.removeEventListener("firstDataRendered", onFirst); } catch {}
      resolve(ok);
    };

    const onFirst = () => finish(true);

    // Si déjà rendu (parfois true selon version / timing)
    try {
      const rowCount = g.api.getDisplayedRowCount?.() ?? 0;
      if (rowCount > 0) return finish(true);
    } catch {}

    try { g.api.addEventListener("firstDataRendered", onFirst); } catch {}

    setTimeout(() => finish(false), timeoutMs);
  });
}

// Récupère le data source du calendrier 
// les lignes de la grille programmees filtrées si possible
function getProgrammeCalendarDataSource() {
  const activites = ctx.df;
  let rows = getFilteredProgrammeRows?.() || [];

  // Au cas où on se retrouve avec une string de type jj/mm dans le data source...
  if (rows) for (const r of rows) r.Date = toDateint(r.Date);

  // fallback : au boot getFilteredProgrammeRows peut être vide alors que ctx.df est ok
  if ((!rows || rows.length === 0) && Array.isArray(activites) && activites.length) {
    rows = activitesAPI.getActivitesProgrammees(activites).map(r => ({...r}));
  }

  return rows;
}

// Affiche le calendrier
async function showProgrammeCalendar() {
  const gridA   = document.getElementById("gridA");
  const calA    = document.getElementById("calA");
  const daysEl  = document.getElementById("calADays"); // ✅ conteneur des colonnes

  if (!calA || !daysEl) {
    return;
  }

  // toggle (ne dépend que de hidden)
  // if (gridA) gridA.style.display = "none";
  // calA.hidden = false;
  if (gridA) {
    gridA.hidden = true;
    gridA.style.display = "none";
  }

  if (calA) {
    calA.hidden = false;
    calA.style.display = "";
  }

  window.__applyProgrammeCalHeight?.();

  // ✅ attendre que la grille programme ait réellement un modèle (sinon filteredRows = [])
  await waitForProgrammeGridReadyOnce();

  // Data source
  const rows = getProgrammeCalendarDataSource()

  // periode programmation
  let pp = activitesAPI.getPeriodeProgrammation?.();
  pp = normalizePeriodeFromRowsIfNeeded(pp, rows);

  // Dateint de l'activité sélectionnée
  const selD = getSelectedProgrammeDateInt();

  // render -> on remplit calADays, on ne reconstruit plus les wrappers
  renderProgrammeCalendar(daysEl, rows, pp, selD);

  // scroll to selected day + event
  queueMicrotask(() => {
    const selected = getSelectedRowUuid('grid-programmees'); 
    snapProgrammeCalendar({
      dateInt: selD || (buildDaysRange(activitesAPI.getPeriodeProgrammation())?.[0]),
      uuid: selected || (rows.length > 0 ? rows[0].__uuid : null),
      fallbackHour: 9,
      smooth: false  // au premier affichage, souvent mieux en auto
    });
  });
}

// Affiche la grille
function showProgrammeGrid() {
  const gridA = document.getElementById("gridA");
  const calA  = document.getElementById("calA");

  // if (calA) calA.hidden = true;
  // if (gridA) gridA.style.display = "";
  if (calA) {
    calA.hidden = true;
    calA.style.display = "none";
  }

  if (gridA) {
    gridA.hidden = false;
    gridA.style.display = "";
  }

  try {
    const h = window.grids.get("grid-programmees");
    h?.api?.onGridSizeChanged();
  } catch {}

  const ensureSelectedRowVisible = () => {
    ensureRowVisible("grid-programmees", getSelectedRowUuid("grid-programmees")); 
  }

  afterFrames(10, ensureSelectedRowVisible);

}

// Synchronise la hauteur du calendrier avec le panel
function attachProgrammeCalendarHeightSync() {
  const panel = document.getElementById("programme-panel");
  if (!panel) return;

  /** @type {HTMLElement} */
  const body = panel.querySelector(".st-expander-body");
  /** @type {HTMLElement} */
  const calA = panel.querySelector("#calA");
  if (!body || !calA) return;

  const apply = () => {
    // hauteur du viewport réel (celle du slider)
    const h = body.clientHeight;

    // garde-fous (évite 0 pendant un collapse / animation)
    if (h && h > 0) {
      calA.style.height = `${h}px`;
    }
  };

  // initial
  apply();

  // suit le slider / resize
  const ro = new ResizeObserver(() => apply());
  ro.observe(body);

  // si expander anime sa height via transition, un petit "rappel"
  body.addEventListener("transitionend", (e) => {
    if (e.propertyName === "height") apply();
  });

  // expose pour debug si tu veux
  window.__applyProgrammeCalHeight = apply;
}

let _calAxisLockInstalled = false;

// Scroll X mobile avec inertie (fling) - ne pas simplifier et revenir au scroll natif
function enableCalAxisLock() {
  if (_calAxisLockInstalled) return;
  _calAxisLockInstalled = true;

  const root = document.querySelector("#programme-panel");
  if (!root) return;

  const getDaysScroll = () => document.querySelector("#programme-panel #calA .cal-days-scroll");

  const isInDayBody = (t) => !!t && !!t.closest?.("#programme-panel #calA .cal-scroll-y");
  const isInCal = (t) => !!t && !!t.closest?.("#programme-panel #calA");

  let mode = null;       // null | "x" | "y"
  let startX = 0, startY = 0;
  let lastX = 0;
  const THRESH = 7;

  // ── inertie
  let flingRaf = 0;
  let vx = 0;               // px/ms
  let lastMoveT = 0;
  const samples = [];       // {t, x}
  const MAX_SAMPLES = 6;

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
    // vitesse moyenne sur les ~80-120ms derniers
    if (samples.length < 2) return 0;

    const last = samples[samples.length - 1];
    // cherche un point pas trop proche pour éviter le bruit
    let i = samples.length - 2;
    while (i > 0 && (last.t - samples[i].t) < 40) i--;

    const a = samples[i];
    const dt = (last.t - a.t);
    if (dt <= 0) return 0;

    const dx = (last.x - a.x);
    return dx / dt; // px/ms (note: dx positif = doigt vers la droite)
  }

  function startFling(daysScroll) {
    const MAX_V = 2.2;      // px/ms
    vx = Math.max(-MAX_V, Math.min(MAX_V, vx));
    if (Math.abs(vx) < 0.05) return;

    let prevT = performance.now();
    const BASE_FRICTION = 0.0038; // friction “normale”
    const EDGE_ZONE = 80;         // px : zone proche bord où on freine plus
    const EDGE_BOOST = 0.010;     // friction ajoutée quand on est très proche

    const step = (now) => {
      const dt = now - prevT;
      prevT = now;

      const maxScroll = Math.max(0, daysScroll.scrollWidth - daysScroll.clientWidth);
      const cur = daysScroll.scrollLeft;

      // vx > 0 => doigt va à droite => scrollLeft veut diminuer => bord concerné = gauche (0)
      // vx < 0 => doigt va à gauche  => scrollLeft veut augmenter => bord concerné = droite (maxScroll)
      const distToEdge = (vx > 0) ? cur : (maxScroll - cur);

      // friction augmentée progressivement à l’approche du bord
      const edgeFactor = Math.max(0, Math.min(1, (EDGE_ZONE - distToEdge) / EDGE_ZONE));
      const friction = BASE_FRICTION + EDGE_BOOST * edgeFactor * edgeFactor;

      // déplacement
      const dx = vx * dt;
      let next = cur - dx;

      // clamp
      if (next < 0) next = 0;
      if (next > maxScroll) next = maxScroll;

      daysScroll.scrollLeft = next;

      // décélération
      const decay = Math.exp(-friction * dt);
      vx *= decay;

      const atLeft = next <= 0.5;
      const atRight = next >= (maxScroll - 0.5);

      // stop : vitesse faible, ou on est à la butée DANS le sens du mouvement
      if (Math.abs(vx) < 0.02 ||
          (vx > 0 && atLeft) ||
          (vx < 0 && atRight)) {
        stopFling();
        return;
      }

      flingRaf = requestAnimationFrame(step);
    };

    flingRaf = requestAnimationFrame(step);
  }

  // Important: capture pour passer avant ton pager
  document.addEventListener("touchstart", (e) => {
    if (!isInCal(e.target)) return;

    stopFling();

    const t = e.touches?.[0];
    if (!t) return;

    mode = null;
    startX = lastX = t.clientX;
    startY = t.clientY;

    lastMoveT = performance.now();
    pushSample(lastMoveT, lastX);
  }, { capture: true, passive: true });

  document.addEventListener("touchmove", (e) => {
    // On ne s’occupe QUE des gestes démarrés dans le body (zone verticale)
    const target = e.target;
    if (!(target instanceof Element)) return;
    if (!target.closest("programme-cal")) return;
    if (!isInDayBody(e.target)) return;

    const t = e.touches?.[0];
    if (!t) return;

    const dx0 = t.clientX - startX;
    const dy0 = t.clientY - startY;

    if (!mode) {
      if (Math.abs(dx0) + Math.abs(dy0) < THRESH) return;

      let nextMode = (Math.abs(dx0) > Math.abs(dy0)) ? "x" : "y";

      // ✅ si on s'apprête à prendre l'axe X, vérifie qu'on peut scroller dans ce sens
      if (nextMode === "x") {
        const daysScroll = getDaysScroll();
        if (daysScroll) {
          const maxScroll = Math.max(0, daysScroll.scrollWidth - daysScroll.clientWidth);
          const cur = daysScroll.scrollLeft;

          // dx0 > 0 => doigt vers la droite => scrollLeft diminue (vers 0)
          // dx0 < 0 => doigt vers la gauche  => scrollLeft augmente (vers max)
          const blockedAtStart =
            (dx0 > 0 && cur <= 0.5) ||
            (dx0 < 0 && cur >= maxScroll - 0.5);

          if (blockedAtStart) {
            nextMode = "y"; // on refuse de capturer en X
            startX = lastX = t.clientX;
            startY = t.clientY;
          }
        }
      }

      mode = nextMode;
    }

    if (mode === "x") {
      const daysScroll = getDaysScroll();
      if (!daysScroll) return;

      const now = performance.now();

      // delta depuis le dernier move
      const dx = t.clientX - lastX;
      lastX = t.clientX;

      const prev = daysScroll.scrollLeft;
      const maxScroll = Math.max(0, daysScroll.scrollWidth - daysScroll.clientWidth);

      const cur = daysScroll.scrollLeft;

      // dx > 0 => doigt va à droite => scrollLeft veut diminuer => si cur ~ 0, bloqué
      // dx < 0 => doigt va à gauche  => scrollLeft veut augmenter => si cur ~ max, bloqué
      const blocked =
        (dx > 0 && cur <= 0.5) ||
        (dx < 0 && cur >= maxScroll - 0.5);

      if (blocked) {
        // ✅ on est en butée dans ce sens : on abandonne le mode X
        // et on laisse le scroll vertical natif reprendre immédiatement
        mode = "y";

        // reset de référence pour éviter les gros dx au prochain move
        startX = lastX = t.clientX;
        startY = t.clientY;

        // on coupe l'inertie X en cours (sinon on peut relancer un fling “inutile”)
        samples.length = 0;
        vx = 0;

        return;
      }
      // mapping identique: scrollLeft -= dx
      const next = Math.max(0, Math.min(maxScroll, prev - dx));

      // ✅ si on est en butée (aucun déplacement possible), ne pas capturer
      // sinon tu provoques le “quelques pixels puis retour”
      if (next === prev) {
        // important: ne pas enregistrer de samples sinon tu fling vers une direction impossible
        return;
      }

      // ✅ on ne capture le geste que si on bouge réellement
      if (e.cancelable) e.preventDefault();
      // e.stopPropagation();

      daysScroll.scrollLeft = next;

      // samples pour vitesse (ok car il y a eu du mouvement réel)
      pushSample(now, t.clientX);
      lastMoveT = now;
    }  
  }, { capture: true, passive: false });

  const reset = (e) => {
    if (!isInCal(e.target)) return;

    if (mode === "x") {
      const daysScroll = getDaysScroll();
      if (daysScroll) {
        vx = computeVelocity(); // px/ms (doigt)

      const maxScroll = Math.max(0, daysScroll.scrollWidth - daysScroll.clientWidth);
      const cur = daysScroll.scrollLeft;

      // vx > 0 => fling vers la droite => scrollLeft diminue => si cur ~ 0, inutile
      // vx < 0 => fling vers la gauche  => scrollLeft augmente => si cur ~ max, inutile
      const blocked =
        (vx > 0 && cur <= 0.5) ||
        (vx < 0 && cur >= maxScroll - 0.5);

      if (blocked) {
        stopFling();
        return;
      }
        startFling(daysScroll);
      }
    }

    mode = null;
    samples.length = 0;
  };

  document.addEventListener("touchend", reset, { capture: true, passive: true });
  document.addEventListener("touchcancel", reset, { capture: true, passive: true });
}

let suppressCtxUntil = 0;

// Supprime le menu contextuel apres long press
function suppressContextMenu(ms = 600) {
  suppressCtxUntil = Date.now() + ms;
}

const calRoot = document.getElementById("calA");
calRoot?.addEventListener("contextmenu", (e) => {
  if (Date.now() < suppressCtxUntil) {
    e.preventDefault();
    e.stopPropagation();
  }
}, { capture: true });

// Branchement du long press sur event (desktop + mobile) pour activer la sheet de reprogrammation
export function wireCalendarLongPress(daysEl, {
  pressMs = 520,
  movePx = 12,
  onLongPress = null, // ({ evEl, uuid, dateInt }) => void
} = {}) {
  if (!daysEl) return;

  let tId = 0;
  let startX = 0, startY = 0;
  let active = false;
  let targetEv = null;

  function clear() {
    if (tId) clearTimeout(tId);
    tId = 0;
    active = false;
    targetEv = null;
  }

  function getEvElFromTarget(target) {
    const el = (target instanceof Element) ? target : null;
    if (!el) return null;
    // ⚠️ évite de déclencher si on tape sur le bouton info / un lien
    if (el.closest(".cal-ev__info, a")) return null;
    return el.closest(".cal-ev");
  }

  function startPress(e) {
    // Un seul pointer / bouton principal
    if (e.pointerType === "mouse" && e.button !== 0) return;

    
    const evEl = /** @type {HTMLElement} */ (getEvElFromTarget(e.target));
    if (!evEl) return;

    const uuid = evEl.dataset.uuid || "";
    const dateInt = evEl.dataset.dateint || "";
    if (!uuid) return;

    // arm timer
    active = true;
    targetEv = evEl;
    startX = e.clientX;
    startY = e.clientY;

    tId = window.setTimeout(() => {
      // toujours actif + même target
      if (!active || !targetEv) return;

      // petit feedback visuel (optionnel)
      targetEv.classList.add("is-longpress");
      setTimeout(() => targetEv?.classList.remove("is-longpress"), 180);

      onLongPress?.({ evEl: targetEv, uuid, dateInt });
      clear();
    }, pressMs);
  }

  function movePress(e) {
    if (!active) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if ((dx*dx + dy*dy) > (movePx*movePx)) {
      clear();
    }
  }

  function endPress() { clear(); }

  // Pointer events (Android / desktop / iOS récent)
  daysEl.addEventListener("pointerdown", startPress, { passive: true });
  daysEl.addEventListener("pointermove", movePress, { passive: true });
  daysEl.addEventListener("pointerup", endPress, { passive: true });
  daysEl.addEventListener("pointercancel", endPress, { passive: true });

  // si l’utilisateur scrolle un container parent, on annule (important)
  const scrollers = daysEl.querySelectorAll(".cal-scroll-y");
  scrollers.forEach(sc => sc.addEventListener("scroll", endPress, { passive: true }));

  return () => {
    clear();
    daysEl.removeEventListener("pointerdown", startPress);
    daysEl.removeEventListener("pointermove", movePress);
    daysEl.removeEventListener("pointerup", endPress);
    daysEl.removeEventListener("pointercancel", endPress);
    scrollers.forEach(sc => sc.removeEventListener("scroll", endPress));
  };
}

// Attend 2 frames
function after2RAF(){
  return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

// Attend qu'un scroller se stabilise
function waitScrollStable(scrollerEl, { timeoutMs = 700, stableFrames = 4 } = {}) {
  return new Promise((resolve) => {
    if (!scrollerEl) return resolve(false);

    const t0 = performance.now();
    let last = scrollerEl.scrollTop;
    let stable = 0;

    const tick = () => {
      const now = performance.now();
      const cur = scrollerEl.scrollTop;

      if (Math.abs(cur - last) < 0.5) stable++;
      else stable = 0;

      last = cur;

      if (stable >= stableFrames) return resolve(true);
      if (now - t0 > timeoutMs) return resolve(false);

      requestAnimationFrame(tick);
    };

    requestAnimationFrame(tick);
  });
}

// Attend la stabilisation d'un day scroll 
export async function waitForScrollCalendarToStabilize() {
    await after2RAF();
    const scroller = getCalDays()?.querySelector?.(".cal-scroll-y");
    await waitScrollStable(scroller, { timeoutMs: 900, stableFrames: 5 });
}

// Initialise les interactions du calendrier (long press, height sync, axis lock)
export function wireProgrammeCalendar() {
  attachProgrammeCalendarHeightSync();
  enableCalAxisLock();
  wireCalendarLongPress(document.getElementById("calADays"), {
    onLongPress: async ({ evEl, uuid, dateInt }) => {
      suppressContextMenu();
      selectCalendarEventAndSync({daysEl:getCalDays(), dateInt, uuid });
      // await waitForScrollCalendarToStabilize()
      openSheetReprogrammer(uuid);
    }
  });
}

// public: à appeler dans wireExpanderButtons
export function wireProgrammeCalendarToggle() {
  const id = "btn-prog-view";

  const ICON_CAL = `
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
        xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="3" ry="3"/>
      <path d="M8 12l3 3 5-5"/>
    </svg>`;

  const ICON_GRID = `
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
        xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="3" ry="3"/>
    </svg>`;
    
  function renderBtn(mode) {
    const isCal = mode === "calendar";
    const icon = isCal ? ICON_CAL : ICON_GRID;
    const label = isCal ? "Calendrier" : "Calendrier";
    return `<span class="exp-icon">${icon}</span><span class="exp-label">${label}</span>`;
  }

  addExpanderButton({
    expanderId: "exp-programmees",
    id,
    title: "Basculer grille/calendrier",
    innerHTML: renderBtn(getProgrammeViewMode()),
    onClick: async () => {
      const cur = getProgrammeViewMode();
      const next = (cur === "grid") ? "calendar" : "grid";
      setProgrammeViewMode(next);

      // sync label
      const btn = document.getElementById(id);
      if (btn) {
        btn.innerHTML = renderBtn(next);
        btn.classList.toggle("is-on", next === "calendar");
        btn.setAttribute("aria-pressed", String(next === "calendar"));
      }

      if (next === "calendar") {
        saveProgrammeGridHeight();
        applyProgrammeCalendarDefaultHeight();        
        await showProgrammeCalendar();
      } else {
        _cachedCalHeightPx = null;
        showProgrammeGrid();
        restoreProgrammeGridHeight();
        // scroll vers la ligne sélectionnée une fois la grille visible (deferred)
        afterFrames(2, () => {selectRowByUuid("grid-programmees", getSelectedRowUuid("grid-programmees"), { align: "middle", scroll: true });});
      }
    }
  });

  // apply saved mode at startup
  queueMicrotask(async () => {
    const mode = getProgrammeViewMode();
    const btn = document.getElementById(id);
    if (btn) btn.innerHTML = renderBtn(mode);
    if (mode === "calendar") {
      afterFrames(2, () => applyProgrammeCalendarDefaultHeight());        
      await showProgrammeCalendar();
    } else {
      showProgrammeGrid();
    }
  });
}

// Optionnel: si la sélection change dans la grille, recentrer le calendrier si visible
function onProgrammeSelectionChanged() {
  if (getProgrammeViewMode() !== "calendar") return;
  const dom = ensureProgrammeCalendarDOM();
  if (!dom || dom.calEl.classList.contains("is-hidden")) return;

  const sel = getSelectedProgrammeDateInt();
  if (sel) scrollCalendarToDay(sel);
}

// Empêche le scroll de la page quand on scroll horizontalement dans le calendrier
function lockPageScrollInCalendar(scrollerEl) {
  if (!scrollerEl) return () => {};

  // iOS Safari: passive listeners par défaut => il faut {passive:false}
  let active = false;
  let startX = 0, startY = 0;
  const THRESH = 6; // px avant de décider l’axe

  const onTouchStart = (e) => {
    if (!e.touches || e.touches.length !== 1) return;
    active = true;
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
  };

  const onTouchMove = (e) => {
    if (!active || !e.touches || e.touches.length !== 1) return;

    const x = e.touches[0].clientX;
    const y = e.touches[0].clientY;
    const dx = x - startX;
    const dy = y - startY;

    // Dès qu’on détecte un geste plutôt horizontal => on bloque le scroll page
    if (Math.abs(dx) > THRESH && Math.abs(dx) > Math.abs(dy)) {
      e.preventDefault(); // stop scroll page
    }
  };

  const onTouchEnd = () => { active = false; };

  scrollerEl.addEventListener("touchstart", onTouchStart, { passive: true });
  scrollerEl.addEventListener("touchmove",  onTouchMove,  { passive: false }); // IMPORTANT
  scrollerEl.addEventListener("touchend",   onTouchEnd,   { passive: true });
  scrollerEl.addEventListener("touchcancel",onTouchEnd,   { passive: true });

  // cleanup
  return () => {
    scrollerEl.removeEventListener("touchstart", onTouchStart);
    scrollerEl.removeEventListener("touchmove",  onTouchMove);
    scrollerEl.removeEventListener("touchend",   onTouchEnd);
    scrollerEl.removeEventListener("touchcancel",onTouchEnd);
  };
}

// ===============================
//  EXPORT .ICS (Version TZID Europe/Paris)
//  Date: YYYYMMDD  |  Debut: "HH:MM" | "9h30" | "0930" | "9"
// ===============================

const pad2 = n => String(n).padStart(2, '0');

const toICSDateUTC = (d) => {
  if (!(d instanceof Date) || isNaN(d.getTime())) return '';
  return (
    d.getUTCFullYear() +
    pad2(d.getUTCMonth() + 1) +
    pad2(d.getUTCDate()) + 'T' +
    pad2(d.getUTCHours()) +
    pad2(d.getUTCMinutes()) +
    pad2(d.getUTCSeconds()) + 'Z'
  );
};

const escICS = (s='') => String(s)
  .replace(/\\/g, '\\\\').replace(/;/g, '\\;')
  .replace(/,/g, '\\,').replace(/\n/g, '\\n');

// Debut: "HH:MM" | "9h" | "9h30" | "0930" | "9"
function parseTimeParts(timeStr='') {
  const s = String(timeStr).trim();
  let m;
  if ((m = s.match(/^(\d{1,2}):(\d{1,2})$/))) return { hh:+m[1], mm:+m[2] };
  if ((m = s.match(/^(\d{1,2})h(\d{0,2})?$/i))) return { hh:+m[1], mm:+(m[2]||0) };
  if ((m = s.match(/^(\d{3,4})$/))) { const v=m[1]; return { hh:+v.slice(0, v.length-2), mm:+v.slice(-2) }; }
  if ((m = s.match(/^(\d{1,2})$/))) return { hh:+m[1], mm:0 };
  return { hh:0, mm:0 };
}

// Date: YYYYMMDD uniquement
function parseYYYYMMDD(dateVal) {
  const s = String(dateVal).trim();
  if (!/^\d{8}$/.test(s)) return null;
  return { y:+s.slice(0,4), m:+s.slice(4,6), d:+s.slice(6,8) };
}

function buildDateFromRow(row) {
  const di = parseYYYYMMDD(row.Date ?? row['DATE']);
  if (!di) return null;
  const { hh, mm } = parseTimeParts(row.Debut ?? row['DEBUT'] ?? row['Heure']);
  return new Date(di.y, (di.m||1)-1, di.d||1, hh||0, mm||0, 0, 0);
}

function parseDureeToMin(dur='') {
  const s = String(dur).toLowerCase().replace(/\s+/g,'').trim();
  let m;
  if (!s) return 60;
  if ((m = s.match(/^(\d+)\s*min$/))) return +m[1];
  if ((m = s.match(/^(\d+)h(\d{0,2})?$/))) return (+m[1])*60 + +(m[2]||0);
  if ((m = s.match(/^(\d{1,2}):(\d{2})$/))) return (+m[1])*60 + +m[2];
  if ((m = s.match(/^(\d+)$/))) return +m[1];
  return 60;
}

function addMinutes(date, mins=0) {
  const d = new Date(date.getTime());
  d.setMinutes(d.getMinutes() + (mins||0));
  return d;
}

// UID RFC 5545
function makeUID() {
  // UID globalement unique, conforme RFC5545
  return `${genUUID()}@in-off`;
}

// Date locale (sans Z) pour DTSTART/DTEND
const toICSDateLocal = (d) =>
  d.getFullYear()
  + pad2(d.getMonth() + 1)
  + pad2(d.getDate())
  + 'T'
  + pad2(d.getHours())
  + pad2(d.getMinutes())
  + pad2(d.getSeconds());

// Bloc VTIMEZONE (Europe/Paris)
function parisVTZ() {
  return [
    'BEGIN:VTIMEZONE',
    'TZID:Europe/Paris',
    'X-LIC-LOCATION:Europe/Paris',
    'BEGIN:DAYLIGHT',
    'TZOFFSETFROM:+0100',
    'TZOFFSETTO:+0200',
    'TZNAME:CEST',
    'DTSTART:19700329T020000',
    'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU;BYHOUR=2;BYMINUTE=0;BYSECOND=0',
    'END:DAYLIGHT',
    'BEGIN:STANDARD',
    'TZOFFSETFROM:+0200',
    'TZOFFSETTO:+0100',
    'TZNAME:CET',
    'DTSTART:19701025T030000',
    'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU;BYHOUR=3;BYMINUTE=0;BYSECOND=0',
    'END:STANDARD',
    'END:VTIMEZONE'
  ];
}

// Exports calendrier (standard)
export function rowsToICS(rows, {
  title = 'In & Off',
  onlyReserved = false,
  filename = 'In&Off.ics'
} = {}) {
  const now = new Date();
  const dtstamp = toICSDateUTC(now);

  const filtered = (rows || []).filter(r => {
    if (!onlyReserved) return true;
    const v = String(r?.Reserve || r?.RESERVE || '').toLowerCase();
    return v === 'oui' || v === 'true' || v === 'x';
  });

  const lines = [
    'BEGIN:VCALENDAR',
    'PRODID:-//YourApp//Avignon Off Export//FR',
    'VERSION:2.0',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escICS(title)}`
  ];

  for (const r of filtered) {
    const start = buildDateFromRow(r);
    if (!start) continue;
    const end = addMinutes(start, parseDureeToMin(r.Duree || r['Durée'] || r.Duration || ''));

    const summary = escICS(r.Activite || r['Activité'] || r.Titre || 'Spectacle');
    const location = escICS(r.Theatre || r['Théâtre'] || r.Lieu || '');
    const url = (r.Hyperlien || r.URL || r.Lien || '').toString();
    const description = escICS([r.Auteurs, r.Compagnie, r.Note, url].filter(Boolean).join('\n'));

    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${makeUID()}`);
    lines.push(`DTSTAMP:${dtstamp}`);
    lines.push(`DTSTART:${toICSDateUTC(start)}`);
    lines.push(`DTEND:${toICSDateUTC(end)}`);
    lines.push(`SUMMARY:${summary}`);
    if (location)    lines.push(`LOCATION:${location}`);
    if (description) lines.push(`DESCRIPTION:${description}`);
    if (url)         lines.push(`URL:${escICS(url)}`);
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');

//   // UTF-8 sans BOM + CRLF → compatible Outlook
//   const encoder = new TextEncoder();
//   const blob = new Blob([encoder.encode(lines.join('\r\n') + '\r\n')], { type: 'text/calendar' });
    // UTF-8 avec BOM + CRLF → compatible tous clients y compris Outlook desktop
    const bom = new Uint8Array([0xEF, 0xBB, 0xBF]);   // marqueur BOM UTF-8
    const text = lines.join('\r\n') + '\r\n';
    const encoder = new TextEncoder();
    const blob = new Blob([bom, encoder.encode(text)], {
    type: 'text/calendar;charset=utf-8'
    });

  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
}

// Exports calendrier (TZID Europe/Paris)
// UID global (RFC5545)
export function rowsToICS_TZID(rows, {
  title = 'In & Off',
  onlyReserved = false,
  filename = 'In&Off.ics'
} = {}) {
  const now = new Date();
  const dtstamp = toICSDateUTC(now);

  const filtered = (rows || []).filter(r => {
    if (!onlyReserved) return true;
    const v = String(r?.Reserve || r?.RESERVE || '').toLowerCase();
    return v === 'oui' || v === 'true' || v === 'x';
  });

  const lines = [
    'BEGIN:VCALENDAR',
    'PRODID:-//YourApp//Avignon Off Export//FR',
    'VERSION:2.0',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escICS(title)}`,
    ...parisVTZ() // <<< bloc VTIMEZONE
  ];

  for (const r of filtered) {
    const start = buildDateFromRow(r);
    if (!start) continue;
    const end = addMinutes(start, parseDureeToMin(r.Duree || r['Durée'] || r.Duration || ''));

    const summary = escICS(r.Activite || r['Activité'] || r.Titre || 'Spectacle');
    const location = escICS(r.Theatre || r['Théâtre'] || r.Lieu || '');
    const url = (r.Hyperlien || r.URL || r.Lien || '').toString();
    const description = escICS([r.Auteurs, r.Compagnie, r.Note, url].filter(Boolean).join('\n'));

    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${makeUID()}`);
    lines.push(`DTSTAMP:${dtstamp}`);
    lines.push(`DTSTART;TZID=Europe/Paris:${toICSDateLocal(start)}`);
    lines.push(`DTEND;TZID=Europe/Paris:${toICSDateLocal(end)}`);
    lines.push(`SUMMARY:${summary}`);
    if (location)    lines.push(`LOCATION:${location}`);
    if (description) lines.push(`DESCRIPTION:${description}`);
    if (url)         lines.push(`URL:${escICS(url)}`);
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');

  // UTF-8 **avec BOM** + CRLF → Outlook classique OK
  const bom = new Uint8Array([0xEF, 0xBB, 0xBF]);
  const text = lines.join('\r\n') + '\r\n';
  const encoder = new TextEncoder();
  const blob = new Blob([bom, encoder.encode(text)], {
    type: 'text/calendar;charset=utf-8'
  });

  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
}

// Fait flasher un event
export function flashCalendarEvent(uuid) {
  const ev = document.querySelector(
    `.cal-ev[data-uuid="${CSS.escape(String(uuid))}"]`
  );

  if (!ev) return false;

  ev.classList.remove("calendar-event-attention");
  void /** @type {HTMLElement} */(ev).offsetWidth;
  ev.classList.add("calendar-event-attention");

  setTimeout(() => {
    ev.classList.remove("calendar-event-attention");
  }, 1400);

  return true;
}
