// ===============================
// Utilitaires Calendrier
// ===============================

import { 
  afterFrames,
} from './utils.js'; 

import { 
  prettyToMinutes, 
} from './utils-date.js';

import {
  getSelectedRow,
  getSelectedRowUuid,
  selectRowByUuid,
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
  addExpanderButton,
} from './expanders.js'; 

import {
  openPopoverNear,
} from './infos-plus.js';

const PX_PER_MIN = 1.1;         // 1.0..1.4

// Cache de la hauteur de la grille grid-programmees (px)
let _cachedGridHeightPx = null;

// Cache de la hauteur calculée du calendrier (px)
let _cachedCalHeightPx = null;

// --- helpers temps (fallback) ---
function parseHHMM(s) {
  if (!s) return null;
  const str = String(s).trim();

  // "11:05"
  let m = /^(\d{1,2}):(\d{2})$/.exec(str);
  if (m) return (Number(m[1])|0)*60 + (Number(m[2])|0);

  // "11h05"
  m = /^(\d{1,2})h(\d{2})$/.exec(str);
  if (m) return (Number(m[1])|0)*60 + (Number(m[2])|0);

  // "1105" (rare)
  m = /^(\d{1,2})(\d{2})$/.exec(str);
  if (m) return (Number(m[1])|0)*60 + (Number(m[2])|0);

  return null;
}
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

// Renvoie le conteneur scroll du calendrier
function getDaysScroll() {
  return document.querySelector("#calA .cal-days-scroll");
}

// Renvoie le noeud jour du calendrier pour une dateint donnée
function getDayNode(dateInt) {
  return document.querySelector(`#calA .cal-day[data-dateint="${dateInt}"]`);
}

// Renvoie la colonne jour du calendrier pour une dateint donnée
function getDayColumn(dateInt) {
  return document.querySelector(`#calA .cal-day[data-dateint="${dateInt}"]`);
}

// Renvoie le body jour du calendrier pour une dateint donnée
function getDayBody(dateInt) {
  const col = getDayColumn(dateInt);
  return col?.querySelector(".cal-day__body") || null;
}

// Renvoie l’élément event du calendrier pour un uuid donné
function getEventNodeByUuid(uuid) {
  if (!uuid) return null;
  return document.querySelector(`#calA .cal-ev[data-uuid="${CSS.escape(uuid)}"]`);
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
  const day = getDayNode(dateInt);
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

// Centre un event sélectionné dans le jour
function centerSelectedEventInDay(selectedUuid, { smooth = true } = {}) {
  if (!selectedUuid) return false;

  /** @type {HTMLElement} */
  const ev = document.querySelector(`#calA .cal-ev[data-uuid="${CSS.escape(selectedUuid)}"]`);
  if (!ev) return false;

  const dayBody = ev.closest(".cal-day")?.querySelector(".cal-day__body");
  if (!dayBody) return false;

  // header sticky (optionnel)
  const header = ev.closest(".cal-day")?.querySelector(".cal-day__header");
  const headerH = header?.getBoundingClientRect().height || 0;

  // 🎯 ancre = centre du TITRE (sinon haut de l’event)
  /** @type {HTMLElement} */
  const titleEl = ev.querySelector(".cal-ev__title");
  const anchorY = titleEl
    ? ev.offsetTop + titleEl.offsetTop + titleEl.offsetHeight / 2
    : ev.offsetTop;

  const viewportH = dayBody.clientHeight;
  let target = anchorY - (viewportH - headerH) / 2;

  const maxScroll = dayBody.scrollHeight - viewportH;
  target = Math.max(0, Math.min(target, maxScroll));

  if (smooth && "scrollTo" in dayBody) {
    dayBody.scrollTo({ top: target, behavior: "smooth" });
  } else {
    dayBody.scrollTop = target;
  }

  return true;
}

// Scroll un jour à une heure donnée
function scrollDayToHour(dateInt, hour = 9, { smooth = true } = {}) {
  const dayBody = getDayBody(dateInt);
  if (!dayBody) return false;

  const minutes = Math.max(0, Math.min(24 * 60, hour * 60));
  const y = Math.round(minutes * PX_PER_MIN);

  if (smooth && "scrollTo" in dayBody) {
    dayBody.scrollTo({ top: y, behavior: "smooth" });
  } else {
    dayBody.scrollTop = y;
  }
  return true;
}

/**
 * Centre le calendrier sur un jour + event sélectionné ou heure fallback
 * @param {*} param0 
 * @returns 
 */
function snapProgrammeCalendar({
  dateInt,
  selectedUuid = null,
  fallbackHour = 9,
  smooth = true
} = {}) {
  if (!dateInt) return;

  // 1) centre la colonne jour (scroll horizontal)
  centerDayInViewport(dateInt, { smooth });

  // 2) attendre layout stable (meilleur que setTimeout)
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const ok = selectedUuid ? centerSelectedEventInDay(selectedUuid, { smooth }) : false;
      if (!ok) scrollDayToHour(dateInt, fallbackHour, { smooth });
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

// Ajuste la hauteur du calendrier en fonction de la grille
function setCalHeightFromGrid() {
  const gridA = document.getElementById("gridA");
  const calA  = document.getElementById("calA");
  if (!gridA || !calA) return;

  const h = Math.max(320, Math.round(gridA.getBoundingClientRect().height));
  calA.style.height = h + "px";
}

// Scroll le calendrier horizontalement pour afficher un jour donné
function scrollCalendarToDay(calSlot, dateInt) {
  const scroller = calSlot.querySelector(".cal-days-scroll");
  const dayEl = calSlot.querySelector(`.cal-day[data-dateint="${dateInt}"]`);
  if (!scroller || !dayEl) return;

  const sRect = scroller.getBoundingClientRect();
  const dRect = dayEl.getBoundingClientRect();
  const curLeft = scroller.scrollLeft;

  // center in view
  const delta = (dRect.left - sRect.left) - (sRect.width/2 - dRect.width/2);
  scroller.scrollTo({ left: curLeft + delta, behavior: "smooth" });
}

// Scroll le calendrier verticalement pour afficher un event donné
function scrollCalendarToEvent(calA, uuid, {
  gapTopPx = 12,
  gapBottomPx = 16,
  smooth = false,
  preferBottom = true,
  bottomBias = 0.75, // 0.5=center, 0.75=plutôt bas, 0.9=très bas
} = {}) {
  if (!calA || !uuid) return false;

  const ev = calA.querySelector(`.cal-ev[data-uuid="${CSS.escape(uuid)}"]`);
  if (!ev) return false;

  const dayBody = ev.closest(".cal-day__body");
  if (!dayBody) return false;

  const viewportH = dayBody.clientHeight;

  // ✅ Position réelle de l’event DANS le scroller
  const bodyRect = dayBody.getBoundingClientRect();
  const evRect = ev.getBoundingClientRect();
  const evTop = (evRect.top - bodyRect.top) + dayBody.scrollTop;
  const evH = evRect.height;
  const evBottom = evTop + evH;

  const maxScroll = Math.max(0, dayBody.scrollHeight - viewportH);

  // Intervalle de scroll qui garantit que l’event est entièrement visible
  // (avec gaps) : scrollTop ∈ [minForBottom, maxForTop]
  const minForBottom = Math.max(0, (evBottom + gapBottomPx) - viewportH);
  const maxForTop = Math.max(0, evTop - gapTopPx);

  let targetTop;

  const usableViewport = Math.max(0, viewportH - gapTopPx - gapBottomPx);

  // 1) Event trop grand pour tenir entièrement -> on privilégie le haut visible
  // (tu ne peux pas avoir haut+bas visibles si evH > usableViewport)
  if (evH >= usableViewport) {
    targetTop = maxForTop;
  }
  // 2) Event normal : vise une position plutôt basse, puis force visibilité complète
  else if (preferBottom) {
    const desiredEvTopInViewport = gapTopPx + usableViewport * bottomBias;
    targetTop = evTop - desiredEvTopInViewport;

    // ✅ Forcer l’event entièrement visible
    targetTop = Math.max(minForBottom, Math.min(targetTop, maxForTop));
  }
  // 3) Fallback centrage + visibilité complète
  else {
    targetTop = evTop - (viewportH - evH) / 2;
    targetTop = Math.max(minForBottom, Math.min(targetTop, maxForTop));
  }

  // Clamp final absolu
  targetTop = Math.max(0, Math.min(targetTop, maxScroll));

  dayBody.scrollTo({
    top: targetTop,
    behavior: smooth ? "smooth" : "auto",
  });

  return true;
}

// Scroll tous les jours du calendrier à une heure donnée
function scrollAllDaysToHour(daysEl, hour = 9) {
  const dayNodes = daysEl.querySelectorAll(".cal-day");
  if (!dayNodes.length) return;

  for (const day of dayNodes) {
    const body = day.querySelector(".cal-day__body");
    const tl   = day.querySelector(".cal-timeline");
    if (!body || !tl) continue;

    const pxPerMin = parseFloat(tl.dataset.pxPerMin || "1.1");
    const top = Math.round(hour * 60 * pxPerMin);

    body.scrollTop = top;
  }
}

// Scroll tous les jours du calendrier au premier event ou à une heure fallback
function scrollAllDaysToFirstEventOrHour(
  daysEl,
  fallbackHour = 9,
  {
    gapPx = 12   // 👈 espace visuel sous le header
  } = {}
) {
  if (!daysEl) return;

  const dayNodes = daysEl.querySelectorAll(".cal-day");
  if (!dayNodes.length) return;

  for (const day of dayNodes) {
    const body = day.querySelector(".cal-day__body");
    const tl   = day.querySelector(".cal-timeline");
    if (!body || !tl) continue;

    let targetTop;

    // 1️⃣ premier event du jour
    const firstEv = tl.querySelector(".cal-ev");

    if (firstEv) {
      // position de l'event dans la timeline
      targetTop = firstEv.offsetTop - gapPx;
    } else {
      // 2️⃣ fallback → heure par défaut
      const pxPerMin =
        parseFloat(tl.dataset.pxPerMin) ||
        parseFloat(getComputedStyle(tl).getPropertyValue("--px-per-min")) ||
        1.1;

      targetTop = Math.round(fallbackHour * 60 * pxPerMin) - gapPx;
    }

    // 3️⃣ clamp de sécurité
    const maxScroll = body.scrollHeight - body.clientHeight;
    body.scrollTop = Math.max(0, Math.min(targetTop, maxScroll));
  }
}

// Indique si le calendrier est visible
export function isProgrammeCalendarVisible() {
  const calA = document.getElementById("calA");
  // hidden prend le dessus si tu l’utilises
  return !!calA && !calA.hidden && calA.style.display !== "none";
}

// Sélectionne un event dans le calendrier par son uuid
function selectEventByUuid(uuid) {
  if (!uuid) return;
  const daysEl  = document.getElementById("calADays"); // ✅ conteneur des colonnes
  daysEl.querySelectorAll(".cal-ev.is-selected").forEach(x => x.classList.remove("is-selected"));
  const ev = getEventNodeByUuid(uuid);
  if (ev) ev.classList.add('is-selected');
}

// Sélectionne l’event courant dans le calendrier
export function selectCurrentEventInCalendar() {
  const selUuid = getSelectedRowUuid('grid-programmees');
  selectEventByUuid(selUuid);
}

// Scroll et sélectionne l’event courant dans le calendrier
function snapToCurrentSelectedEvent() {
  const calA = document.getElementById("calA");
  const selD = getSelectedProgrammeDateInt();
  const selUuid = getSelectedRowUuid('grid-programmees');
  scrollCalendarToDay?.(calA, selD); 
  scrollCalendarToEvent?.(calA, selUuid);                       // scroll vertical vers l'event sélectionné
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

  // iOS PWA : _blank est souvent mauvais => on navigue DANS la webview (comportement voulu)
  if (isIOS && isStandalone) {
    window.location.assign(url);
    return;
  }

  // Sinon : ouvrir en nouvel onglet. Pas de fallback assign.
  const w = window.open(url, '_blank', 'noopener,noreferrer');
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

// Render calendar
function renderProgrammeCalendar(daysEl, rows, pp, selectedDateInt) {
  if (!daysEl) return;

  const days = buildDaysRange(pp) || [];

  // ---------- byDay ----------
  const byDay = new Map();
  for (const d of days) byDay.set(d, []);

  for (const r of (rows || [])) {
    const d = r.Date;
    if (!d || !byDay.has(d)) continue;
    byDay.get(d).push(r);
  }

  // tri par heure de début dans chaque jour
  for (const [d, list] of byDay) {
    list.sort((a, b) => (parseHHMM(a.Debut) ?? 0) - (parseHHMM(b.Debut) ?? 0));
  }

  // ---------- constants ----------
  const DAY_MINUTES = 24 * 60;
  const timelineH = Math.round(DAY_MINUTES * PX_PER_MIN);

  const fmtDay = (dint) => {
    const s = String(dint);
    const y = s.slice(0, 4), m = s.slice(4, 6), d = s.slice(6, 8);
    return `${d}/${m}/${y}`;
  };

  // ---------- reset + build ----------
  daysEl.innerHTML = "";

  for (const dint of days) {
    const list = byDay.get(dint) || [];

    const dayNode = document.createElement("div");
    dayNode.className = "cal-day";
    dayNode.dataset.dateint = String(dint);

    dayNode.innerHTML = `
      <div class="cal-day__header">
        <div class="cal-day__title">${fmtDay(dint)}</div>
        <div class="cal-day__meta">${list.length} év.</div>
      </div>
      <div class="cal-day__body">
        <div class="cal-timeline"></div>
      </div>
    `;

    /** @type {HTMLElement} */
    const tl = dayNode.querySelector(".cal-timeline");
    // IMPORTANT : height pilotée par JS (pas par CSS)
    tl.style.height = `${timelineH}px`;
    tl.style.minHeight = `${timelineH}px`;
    tl.dataset.pxPerMin = String(PX_PER_MIN);

    // hour lines + labels (0..24)
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
      const startMin = parseHHMM(r.Debut) ?? 0;

      const durMin =
        (typeof prettyToMinutes === "function")
          ? prettyToMinutes(r.Duree)
          : (parseHHMM(r.Duree) ?? 0);

      const endMin = clamp(startMin + (durMin || 0), 0, DAY_MINUTES);

      const top = Math.round(startMin * PX_PER_MIN);
      const height = Math.max(18, Math.round((endMin - startMin) * PX_PER_MIN));

      const ev = document.createElement("div");
      ev.className = "cal-ev";
      ev.style.top = `${top}px`;
      ev.style.height = `${height}px`;
      ev.dataset.uuid = r.__uuid || "";
      ev.dataset.dateint = String(dint);
      ev.dataset.startMin = String(startMin);
      ev.dataset.endMin   = String(endMin);

      const timeLabel = `${r.Debut || ""} → ${r.Fin || ""}`.trim();

      const raw = r.Hyperlien || '';
      const href = raw || (
        "https://www.festivaloffavignon.com/resultats-recherche?recherche=" +
        encodeURIComponent(r.Activite || '')
      );

      const hasInfo = !!(r.__desc_summary || r.__avis_summary);
      const infoBtnHtml = hasInfo
        ? `<button type="button" class="cal-ev__info" aria-label="Infos" title="Infos">ℹ︎+</button>`
        : "";

      ev.innerHTML = `
        <div class="cal-ev__time">
          <span class="cal-ev__timeText">${timeLabel}</span>
          ${infoBtnHtml}
        </div>
        <a class="cal-ev__title"
          href="${href}"
          target="_blank"
          rel="noopener">
          ${r.Activite ?? ""}
        </a>
        <div class="cal-ev__place">${r.Lieu ?? ""}</div>
      `;

      ev.addEventListener("click", (e) => {
        e.stopPropagation();
        daysEl.querySelectorAll(".cal-ev.is-selected").forEach(x => x.classList.remove("is-selected"));
        ev.classList.add("is-selected");

        snapProgrammeCalendar({
          dateInt: dint,
          selectedUuid: r.__uuid,
          fallbackHour: 9,
          smooth: true
        });     

        try {
          selectRowByUuid?.("grid-programmees", r.__uuid);
        } catch {}
      });

      if (hasInfo) {
        const btn = ev.querySelector(".cal-ev__info");
        if (btn) {
          // btn.addEventListener("click", (e) => {
          //   e.preventDefault();
          //   e.stopPropagation(); // ne pas déclencher la sélection / double tap / lien

          //   openPopoverNear(btn, {
          //     title: r.Activite || r.activite || "Détails",
          //     style: r.Style,
          //     desc: r.__desc_summary,
          //     avis: r.__avis_summary,
          //     mood: r.Mood,
          //     note: r?.Note || null,
          //   });
          // }, { passive: false }); BIGBUG
        }
      }

      bindItineraryGesture(ev, r.Lieu);

      tl.appendChild(ev);
    }

    daysEl.appendChild(dayNode);
  }

  queueMicrotask(() => {
    scrollAllDaysToFirstEventOrHour(daysEl, 9);
    selectCurrentEventInCalendar();
  });
  
}

// Re-render calendar (data + sélection + scroll)
export function rerenderProgrammeCalendar({ snapDay = true, defaultHour = 9 } = {}) {
  const calA = document.getElementById("calA");
  const calADays = document.getElementById("calADays");
  if (!calA || !calADays) return;

  const rows = getProgrammeCalendarDataSource();

  let pp = activitesAPI.getPeriodeProgrammation?.();
  pp = normalizePeriodeFromRowsIfNeeded(pp, rows);

  const selD = getSelectedProgrammeDateInt();
  const selUuid = getSelectedRowUuid('grid-programmees'); 

  renderProgrammeCalendar(calADays, rows, pp, selD);

  // post-render snapping
  requestAnimationFrame(() => {
    scrollAllDaysToFirstEventOrHour(calADays, defaultHour);         // scroll jusqu'aupremier event ou defaultHour par défaut
    if (snapDay && selD) scrollCalendarToDay?.(calA, selD);         // scroll horizontal vers le jour de l’event sélectionné
    if (selUuid) {
      scrollCalendarToEvent?.(calA, selUuid);                       // scroll vertical vers l'event sélectionné
      selectEventByUuid(selUuid);                                   // sélection visuelle de l’event  
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
    console.error("[CAL] missing calA or calADays", { calA, daysEl });
    return;
  }

  // toggle (ne dépend que de hidden)
  if (gridA) gridA.style.display = "none";
  calA.hidden = false;

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
      selectedUuid: selected || null,
      fallbackHour: 9,
      smooth: false  // au premier affichage, souvent mieux en auto
    });
  });
}

// Affiche la grille
function showProgrammeGrid() {
  const gridA = document.getElementById("gridA");
  const calA  = document.getElementById("calA");

  if (calA) calA.hidden = true;
  if (gridA) gridA.style.display = "";

  try {
    for (const g of (window.grids?.values?.() || [])) {
      if (g.el === gridA) { g.api.onGridSizeChanged(); break; }
    }
  } catch {}

}

// Synchronise la hauteur du calendrier avec le panel
export function attachProgrammeCalendarHeightSync() {
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

  // si ton expander anime sa height via transition, un petit "rappel"
  body.addEventListener("transitionend", (e) => {
    if (e.propertyName === "height") apply();
  });

  // expose pour debug si tu veux
  window.__applyProgrammeCalHeight = apply;
}

let _calAxisLockInstalled = false;

// Scroll X mobile avec inertie (fling) - ne pas simplifier et revenir au scroll natif
export function enableCalAxisLock() {
  if (_calAxisLockInstalled) return;
  _calAxisLockInstalled = true;

  const root = document.querySelector("#programme-panel");
  if (!root) return;

  const getDaysScroll = () => document.querySelector("#programme-panel #calA .cal-days-scroll");

  const isInDayBody = (t) => !!t && !!t.closest?.("#programme-panel #calA .cal-day__body");
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
      e.preventDefault();
      e.stopPropagation();

      daysScroll.scrollLeft = next;

      // samples pour vitesse (ok car il y a eu du mouvement réel)
      pushSample(now, t.clientX);
      lastMoveT = now;
    }  
  }, { capture: true, passive: false }); // BIGBUG

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

// public: à appeler après init grid + wireExpanderButtons
export function wireProgrammeCalendarToggle() {
  const id = "btn-prog-view";

  // const ICON_GRID = `
  //   <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
  //     stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  //     <rect x="3" y="3" width="7" height="7"></rect>
  //     <rect x="14" y="3" width="7" height="7"></rect>
  //     <rect x="3" y="14" width="7" height="7"></rect>
  //     <rect x="14" y="14" width="7" height="7"></rect>
  //   </svg>`;

  // const ICON_CAL = `
  //   <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
  //     stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  //     <rect x="3" y="4" width="18" height="18" rx="2"></rect>
  //     <line x1="16" y1="2" x2="16" y2="6"></line>
  //     <line x1="8" y1="2" x2="8" y2="6"></line>
  //     <line x1="3" y1="10" x2="21" y2="10"></line>
  //   </svg>`;

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
  if (sel) scrollCalendarToDay(dom.calEl, sel);
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
  return `${crypto.randomUUID()}@in-off`;
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
