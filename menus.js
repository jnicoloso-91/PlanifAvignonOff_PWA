// ===============================
// Utilitaires Menus
// ===============================

import { 
  genUUID,
  isIOS,
  looksLikeUrl, 
  mergeRowsNoDupMultiKey, 
  overloadRowsOrInsert,
} from './utils.js';

import { 
  excelSerialToYMD, 
  prettyToDateint, 
  dateintToPretty, 
  ymdToDateint, 
  recalcFinForAll,
  isDateint,
} from './utils-date.js';

import { 
  exportJsonForAi, 
} from './utils-json.js';

import { 
  ctx,
  activitesAPI,
} from './app.js'; 

import { 
  scrollToExpander,
  openExpander,
} from './expanders.js'; 

import { sortCarnet } from './carnet.js'; 

import { 
  sortDf, 
} from './activites.js'; 

import {
  PARSED_DEFAULT, 
  getNoteFromAvis,
  enrichWithAbstractPremium,
  parseAvignonInProgPageUrl, 
  parseAvignonInSpecPageUrl, 
  parseAvignonOffProgPageUrl, 
  parseAvignonOffSpecPageUrl, 
  parseBilletReducProgPageUrl,
  parseBilletReducSpecPageUrl,
  parseBilletReducCollecPageUrl,

  parseAvignonInProgPageText,
  parseAvignonInSpecPageText, 
  parseAvignonOffProgPageText,
  parseAvignonOffSpecPageText, 
  
  isAvignonInProgPageText,
  isAvignonInSpecPageText,
  isAvignonOffProgPageText,
  isAvignonOffSpecPageText,
} from './parsers.js';

import {
  selectRowByUuid,
  rebuildColumnsForActiviteGrids,
  setSortModel,
  extractColumnKeys,
  areColumnKeysDifferent,
} from './grids.js';

import {
  openSheetCarnet,
  openSheetAssistantProgrammation,
  openSheetAssistantChat,
  openSheetParams,
  openSheetAide,
  openSheetCoherence,
  openSheetImportBilletReduc,
  openSheetInfosPlus,
  openSheetSearch,
} from './sheets.js';

import {
  rowsToICS,
} from './calendar.js';

import {
  openSheetExclusive,
} from './sheets.js';

import {
  openPopoverNear,
} from './infos-plus.js';

const $ = id => document.getElementById(id);
const overlayAttente = document.getElementById('overlay-attente'); // overlay d'attente

// ------- Bottom Bar -------
export function wireBottomBar() {
  
  const bar = document.getElementById('bottomBar');
  const scroller = document.getElementById('bottomBarScroller');
  if (!bar || !scroller) return;

  // petit flash visuel
  const pulse = (btn) => {
    if (!btn) return;
    btn.classList.add('bb-clicked');
    setTimeout(() => btn.classList.remove('bb-clicked'), 140);
  };

  // --- Fichier (menu) ---
  $('btn-file')?.addEventListener('click', (e) => {
    pulse(e.currentTarget);
    openFileMenuOrSheet(e.currentTarget);
  });

  // --- Undo / Redo ---
  $('btn-undo')?.addEventListener('click', async (e) => {
    pulse(e.currentTarget);
    doUndo();
  });
  $('btn-redo')?.addEventListener('click', async (e) => {
    pulse(e.currentTarget);
    doRedo();
  });

  // --- Ajouter avec collage ---
  $('btn-paste')?.addEventListener('click', (e) => {
    pulse(e.currentTarget);
    doAjouterActivitesParCollage();
  });

  // --- Rechercher ---
  $('btn-search')?.addEventListener('click', (e) => {
    pulse(e.currentTarget);
    openSheetSearch();
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
  // window.addEventListener('focusin', (e) => {
  //   if (e.target.closest('input, textarea, [contenteditable="true"]')) {
  //     bar.style.transform = 'translateY(120%)';
  //   }
  // });
  // window.addEventListener('focusout', () => {
  //   bar.style.transform = '';
  // });

  wireHiddenFileInput();
  lockHorizontalScroll();
  initSafeAreaWatch();
  setTimeout(wireBottomBarToggle, 300);
  // wireFileMenu();
}

// Appelle le menu contextuel ou la bottom sheet selon la taille d’écran
function openFileMenuOrSheet(anchorBtn) {
  const isSmallScreen = window.matchMedia('(max-width: 768px)').matches;
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.userAgent.includes('Mac') && 'ontouchend' in document); // iPadOS 13+

  if (isSmallScreen || isIOS) {
    openFileSheet(); // version mobile et iPad
  } else {
    openFileMenu(anchorBtn);  // version desktop
  }
}

// File menu/sheet inner HTML
const fileMenuSheetInnerHtml = () => {
  return `
    <ul class="file-sheet__list">
      <li class="file-sheet__item" data-action="new">
        <svg class="file-sheet__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
        <div class="file-sheet__text">
          <span class="file-sheet__titleText">Nouveau contexte</span>
          <span class="file-sheet__subtitle">Réinitialise le programme et le stock d'activités</span>
        </div>
      </li>
      <li class="file-sheet__item" data-action="initProg">
        <svg class="file-sheet__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
        <div class="file-sheet__text">
          <span class="file-sheet__titleText">Nouveau programme</span>
          <span class="file-sheet__subtitle">Réinitialise le programme d'activités</span>
        </div>
      </li>
      <li class="file-sheet__item" data-action="open">
        <svg class="file-sheet__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h7l3 3h6v13H4z"/></svg>
        <div class="file-sheet__text">
          <span class="file-sheet__titleText">Importer depuis Excel</span>
          <span class="file-sheet__subtitle">Importe un fichier Excel contenant une liste d'activités</span>
        </div>
      </li>
      <li class="file-sheet__item" data-action="importCatIn">
        <svg class="file-sheet__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h7l3 3h6v13H4z"/></svg>
        <div class="file-sheet__text">
          <span class="file-sheet__titleText">Importer le catalogue du In</span>
          <span class="file-sheet__subtitle">Importe le programme du catalogue du In</span>
        </div>
      </li>
      <li class="file-sheet__item" data-action="importCatOff">
        <svg class="file-sheet__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h7l3 3h6v13H4z"/></svg>
        <div class="file-sheet__text">
          <span class="file-sheet__titleText">Importer le catalogue du Off</span>
          <span class="file-sheet__subtitle">Importe le programme du catalogue du Off</span>
        </div>
      </li>
      <li class="file-sheet__item" data-action="importBilletReduc">
        <svg class="file-sheet__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h7l3 3h6v13H4z"/></svg>
        <div class="file-sheet__text">
          <span class="file-sheet__titleText">Importer depuis Billet Réduc</span>
          <span class="file-sheet__subtitle">Importe depuis le site de Billet Réduc</span>
        </div>
      </li>
      <li class="file-sheet__item" data-action="exportExcel">
        <svg class="file-sheet__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5h11l5 5v9a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8M7 5v4h8"/></svg>
        <div class="file-sheet__text">
          <span class="file-sheet__titleText">Exporter vers Excel</span>
          <span class="file-sheet__subtitle">Exporte la liste d'activités dans un fichier Excel</span>
        </div>
      </li>
      <li class="file-sheet__item" data-action="exportIcs">
        <svg class="file-sheet__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5h11l5 5v9a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8M7 5v4h8"/></svg>
        <div class="file-sheet__text">
          <span class="file-sheet__titleText">Exporter vers le calendrier</span>
          <span class="file-sheet__subtitle">Exporte le programme d'activités vers l'application calendrier</span>
        </div>
      </li>
      <li class="file-sheet__item" data-action="rapportCoherence">
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"
            viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"
            aria-hidden="true" focusable="false">
          <!-- Feuille -->
          <path d="M7 3h6l4 4v11a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3z"/>
          <path d="M13 3v4h4"/>
          <!-- Coche -->
          <path d="M8.8 13.2l2 2 4.2-4.2"/>
          <!-- Lignes de texte -->
          <path d="M8 18h8"/>
        </svg>
        <div class="file-sheet__text">
          <span class="file-sheet__titleText">Rapport de vérification de cohérence</span>
          <span class="file-sheet__subtitle">Edite un rapport sur la cohérence de la liste d'activités (chevauchements, formats)</span>
        </div>
      </li>
    </ul>
  `;
}

// Construit le menu fichier (desktop)
function openFileMenu(anchorBtn) {
  // évite doublons
  document.querySelectorAll('.kebab-menu.file-menu').forEach(m => m.remove());

  const menu = document.createElement('div');
  menu.className = 'kebab-menu';

  // items
  const items = [
    { id:'new',  label:'Nouveau contexte'     },
    { id:'initProg',  label:'Nouveau programme'     },
    { id:'open', label:'Importer depuis Excel'      },
    { id:'importCatIn', label:'Importer depuis le catalogue du In'      },
    { id:'importCatOff', label:'Importer depuis le catalogue du Off'      },
    { id:'importBilletReduc', label:'Importer depuis Billet Réduc'      },
    { id:'exportExcel', label:'Exporter vers Excel' },
    { id:'exportIcs', label:'Exporter vers le calendrier' },
    { id:'rapportCoherence', label:'Rapport de vérification de cohérence' },
  ];
  menu.innerHTML = `
    <div class="file-menu__panel" role="dialog" aria-modal="true">` +
      fileMenuSheetInnerHtml() +
    `</div>
  `;

  document.body.appendChild(menu);

  // première mesure invisible → position → afficher
  menu.getBoundingClientRect(); // force layout
  positionMenuOverBtn(anchorBtn, menu);
  // petite anim (via .show)
  requestAnimationFrame(() => menu.classList.add('show'));

  // actions
  const close = () => { menu.classList.remove('show'); setTimeout(()=>menu.remove(), 120); };

  menu.querySelectorAll('.file-sheet__item').forEach(li => {
    li.addEventListener('click', () => {
      const act = (/** @type {HTMLElement} */ (li)).dataset.action;
      close();
      if (act === 'new')  doNouveauContexte?.();
      if (act === 'initProg')  doNouveauProgramme?.();
      if (act === 'open') doImportExcel?.();
      if (act === 'importCatIn') doImportFromCatIn?.();
      if (act === 'importCatOff') doImportFromCatOff?.();
      if (act === 'importBilletReduc') openSheetImportBilletReduc?.();
      if (act === 'exportExcel') doExportExcel?.();
      if (act === 'exportIcs') doExportIcs?.();
      if (act === 'rapportCoherence') doVerifierCoherence?.();
    });
  });

  // fermeture externe / ESC
  const onDocClick = (e) => { if (!menu.contains(e.target) && e.target !== anchorBtn) { cleanup(); } };
  const onKey = (e) => { if (e.key === 'Escape') cleanup(); };
  function cleanup() {
    document.removeEventListener('click', onDocClick, true);
    document.removeEventListener('keydown', onKey, true);
    close();
  }
  setTimeout(() => { // évite de capter le même clic
    document.addEventListener('click', onDocClick, true);
    document.addEventListener('keydown', onKey, true);
  }, 0);
}

// Construit le menu fichier (mobile)
function openFileSheet() {
  const existing = document.querySelector('.file-sheet');
  if (existing) { existing.remove(); return; }

  const sheet = document.createElement('div');
  sheet.className = 'file-sheet';
  sheet.innerHTML = fileMenuSheetInnerHtml();

  sheet.innerHTML = `
    <div class="file-sheet__backdrop"></div>
    <div class="file-sheet__panel" role="dialog" aria-modal="true">
      <span class="file-sheet__handle" aria-hidden="true"></span>
      <div class="file-sheet__content">` +
        fileMenuSheetInnerHtml() +
        `<div class="file-sheet__footer">
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(sheet);

  /** @type {HTMLElement} */
  const panel    = sheet.querySelector('.file-sheet__panel');
  const backdrop = sheet.querySelector('.file-sheet__backdrop');
  const content  = sheet.querySelector('.file-sheet__content');

  // Apparition
  requestAnimationFrame(() => {
    sheet.classList.add('visible');
    panel.style.transform = 'translateY(0)';
  });

  // Fermer
  const close = () => {
    sheet.classList.remove('visible');
    panel.style.transform = 'translateY(100%)';
    setTimeout(() => sheet.remove(), 250);
  };

  // Boutons
  backdrop.addEventListener('click', close);
  sheet.querySelector('.file-sheet__close')?.addEventListener('click', close);
  sheet.querySelectorAll('.file-sheet__item').forEach(li => {
    li.addEventListener('click', () => {
      const act = (/** @type {HTMLElement} */ (li)).dataset.action;
      close();
      if (act === 'new')  doNouveauContexte?.();
      if (act === 'initProg')  doNouveauProgramme?.();
      if (act === 'open') doImportExcel?.();
      if (act === 'importCatIn') doImportFromCatIn?.();
      if (act === 'importCatOff') doImportFromCatOff?.();
      if (act === 'importBilletReduc') openSheetImportBilletReduc?.();
      if (act === 'exportExcel') doExportExcel?.();
      if (act === 'exportIcs') doExportIcs?.();
      if (act === 'rapportCoherence') doVerifierCoherence?.();
    });
  });

  // ====== GESTURE: swipe down partout (prioritaire) ======
  let dragging = false;
  let startY = 0;
  let lastY = 0;
  let startedInScrollable = false;
  let suppressClick = false;        // évite click fantôme après drag
  const THRESHOLD_PX = 10;          // distance pour considérer un vrai drag
  const CLOSE_PX     = 90;          // distance pour fermer

  // Helper: trouve si la cible est dans un scrollable (content)
  const isInScrollable = (el) => el && (el === content || content.contains(el));

  // Start drag si:
  //  - poignée/titre (toujours)
  //  - OU dans le contenu ET content.scrollTop === 0 ET mouvement vers le bas
  const onPointerDown = (e) => {
    const y = e.touches ? e.touches[0].clientY : e.clientY;
    startY = lastY = y;
    startedInScrollable = isInScrollable(e.target);
    dragging = true;
    sheet.classList.add('dragging');
    suppressClick = false;

    // Pour iOS: on captera touchmove
    // (pas de preventDefault ici, on attend de savoir si ça devient un drag)
  };

  const onPointerMove = (e) => {
    if (!dragging) return;
    const y = e.touches ? e.touches[0].clientY : e.clientY;
    const dy = y - startY;
    lastY = y;

    // Cas contenu scrollable : si on n’est pas tout en haut → laisser scroller, pas drag
    if (startedInScrollable) {
      const atTop = (content.scrollTop <= 0);
      if (!atTop && dy > 0) {
        // on laisse scroller, on annule le drag
        dragging = false;
        sheet.classList.remove('dragging');
        return;
      }
    }

    // Devient un drag dès qu’on dépasse le seuil vers le bas
    if (dy > THRESHOLD_PX) {
      e.preventDefault?.(); // bloque le scroll de page iOS
      panel.style.transform = `translateY(${dy}px)`;
      suppressClick = true; // on a réellement draggué → on ne veut pas déclencher de clic
    }
  };

  const onPointerUp = () => {
    if (!dragging) return;
    dragging = false;
    sheet.classList.remove('dragging');

    const dy = lastY - startY;
    if (dy > CLOSE_PX) {
      close();
      return;
    }
    // sinon, revenir en place
    panel.style.transition = 'transform .22s cubic-bezier(.22,.8,.24,1)';
    panel.style.transform = 'translateY(0)';
    setTimeout(() => panel.style.transition = '', 240);
  };

  // Écouteurs (panel capte tout; move/up sur window)
  // NB: pas de touch-action:none sur panel pour laisser le scroll à l’intérieur
  panel.addEventListener('touchstart', onPointerDown, { passive: true });
  panel.addEventListener('mousedown',  onPointerDown);
  window.addEventListener('touchmove', onPointerMove, { passive: false }); // iOS: on veut pouvoir preventDefault
  window.addEventListener('mousemove', onPointerMove);
  window.addEventListener('touchend',  onPointerUp);
  window.addEventListener('mouseup',   onPointerUp);

  // Évite le "tap" après un drag (click fantôme) dans le panel
  panel.addEventListener('click', (e) => {
    if (suppressClick) {
      e.stopPropagation();
      e.preventDefault();
      suppressClick = false;
    }
  }, true);
}

/**
 * Centre horizontalement au-dessus du bouton (fallback en dessous si pas la place)
 * @param {*} btn 
 * @param {*} menu 
 */
function positionMenuOverBtn(btn, menu) {
  const GAP = 8;
  const rBtn = btn.getBoundingClientRect();
  const vw = (window.visualViewport?.width)  || window.innerWidth;
  const vh = (window.visualViewport?.height) || window.innerHeight;

  // mesurer le menu (maintenant qu'il est dans le DOM)
  const rMenu = menu.getBoundingClientRect();
  let left = Math.round(rBtn.left + rBtn.width/2 - rMenu.width/2);
  left = Math.max(8, Math.min(left, vw - rMenu.width - 8)); // clamp horizontale

  // préférence : au-dessus
  let top = Math.round(rBtn.top - GAP - rMenu.height);
  if (top < 8) {
    // pas la place au-dessus → en dessous
    top = Math.round(rBtn.bottom + GAP);
    // clamp en bas si nécessaire
    if (top + rMenu.height > vh - 8) {
      top = Math.max(8, vh - 8 - rMenu.height);
    }
  }

  menu.style.left = left + 'px';
  menu.style.top  = top  + 'px';
}

// Handler du file input caché (import Excel effectif) 
function wireHiddenFileInput(){
  const fi = $('fileInput');
  if (!fi) return;

  fi.addEventListener('change', async (ev)=>{
    const input = /** @type {HTMLInputElement|null} */ (ev.target);
    if (!input) return;

    const f = input.files?.[0];
    if (!f) return;   

    importFromXlsxFile(f);

    input.value = ''; // reset pour permettre un re-import du même fichier
  });
}

// Désaccentue + nettoie (lowercase)
function normalizeHeaderRaw(s) {
  return String(s ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // enlève accents
    .trim()
    .toLowerCase();
}

// "mot mot" -> "MotMot" (PascalCase)
function toPascal(s) {
  return s
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .map(word => word ? word[0].toUpperCase() + word.slice(1) : '')
    .join('');
}

// Dictionnaire de canons (sur base normalisée lower/ASCII)
const CANON = {
  // colonnes usuelles
  'date': 'Date',
  'debut': 'Debut',
  'heure': 'Debut',
  'duree': 'Duree',
  'activite': 'Activite',
  'spectacle': 'Activite',
  'lieu': 'Lieu',
  'theatre': 'Lieu',
  'page web': 'Hyperlien',
  'google': 'HyperlienGoogle',
  'hyperliengoogle': 'HyperlienGoogle',
  'billet reduc': 'HyperlienBR',
  'hyperlienbr': 'HyperlienBR',
  'validite': 'Session',
  'session': 'Session',
  'sessions': 'Session',
  'seance': 'Session',
  'seances': 'Session',
  'relache': 'Relache',
  'relaches': 'Relache',
  'reserve': 'Reserve',
  'marqueur': 'Marqueur',
  'ton': 'Mood',
  // tolérances diverses
  'debut (HHhMM)': 'Debut',
  'duree (HhMM)': 'Duree',
  'tel': 'Tel',
  'telephone': 'Tel',
  'web': 'Web',
};

// Normalise un nom de colonne en canon JS (ASCII, sans espace)
function normalizeHeaderToCanon(header) {
  if (!header) return '';
  const raw = normalizeHeaderRaw(header);        // "début" -> "debut"
  if (raw in CANON) return CANON[raw];           // mapping connu -> "Debut"
  return toPascal(raw);                          // sinon "ma colonne" -> "MaColonne"
}

// Transforme toutes les lignes d'un tableau d'activités en renommant les propriétés (enlève accents, espaces, garde canons connus + PascalCase)
function normalizeRowsKeys(rows = [], { keepOriginal = false } = {}) {
  if (!Array.isArray(rows)) return [];
  return rows.map(src => {
    const out = {};
    for (const [key, val] of Object.entries(src || {})) {
      // on laisse tranquilles les clés techniques "__uuid" etc.
      if (key && key.startsWith?.('__')) { out[key] = val; continue; }

      const canon = normalizeHeaderToCanon(key);
      if (!canon) continue; // ignore colonnes vides

      // si keepOriginal, on garde aussi l'ancienne clé
      if (keepOriginal) out[key] = val;

      // pose/écrase la version canonique
      out[canon] = val;
    }
    return out;
  });
}

// Normalise les lignes importées en s'assurant que chaque ligne a un __uuid valide
function normalizeImportedRows(rows) {
  return (rows || []).map((r, i) => {
    const o = { ...r };
    let id = o.__uuid;
    const bad = id == null || id === '' || (typeof id === 'number' && Number.isNaN(id));
    if (bad) {
      id = genUUID();
    }
    o.__uuid = String(id);
    return o;
  });
}

// Import de fichier Excel
async function importFromXlsxFile(f, {add=false} = {}) {

  if (!f) return;
  try {
    overlayAttente.hidden = false; // Affiche l'overlay d'attente

    const buf = await f.arrayBuffer();
    const wb  = XLSX.read(buf, { type: 'array' });
    const ws  = wb.Sheets[wb.SheetNames[0]];

    // 1) JSON “classique” (valeurs) — garde toutes les colonnes
    let dfRows = XLSX.utils.sheet_to_json(ws, { defval: null, raw: true });
    dfRows = normalizeRowsKeys(dfRows);

    // 2) range de la feuille
    const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');

    // 3) Récupère la ligne d'entêtes brute (array)
    const headerRow = (XLSX.utils.sheet_to_json(ws, { header: 1, range: range.s.r })[0] || []);

    // 4) Trouve l'index de la colonne "Activite" en normalisant l'entête
    const colActivite = headerRow.findIndex(h => normalizeHeaderToCanon(h) === 'Activite');

    // 5) Si on a une colonne Activité, on va lire les hyperliens des cellules (A2..An selon la colonne)
    if (typeof colActivite === 'number' && colActivite >= 0) {
      for (let i = 0; i < dfRows.length; i++) {
        const r = i + 1; // +1 car row 0 = ligne 2 en Excel (entête sur r0)
        const addr = XLSX.utils.encode_cell({ r: range.s.r + 1 + i, c: colActivite });
        const cell = ws[addr];
        const link = cell?.l?.Target || cell?.l?.target || null;

        // Force type String sur colonne Activite
        dfRows[i].Activite = String(dfRows[i].Activite ?? "");

        // S’il y a déjà une colonne "Hyperlien" dans Excel, on la garde prioritaire,
        // sinon on remplit depuis le lien de la cellule Activité.
        if (!dfRows[i].Hyperlien && link) {
          dfRows[i].Hyperlien = link;
        }

        // S’il y a déjà une colonne "HyperlienGoogle" dans Excel, on la garde prioritaire,
        // sinon on remplit depuis le lien de la cellule Activité.
        if (!dfRows[i].HyperlienGoogle) {
          dfRows[i].HyperlienGoogle = `https://www.google.com/search?q=spectacle+${dfRows[i].Activite.trim().replace(/\s+/g, '+')}`;
        }

        // S’il y a déjà une colonne "HyperlienBR" dans Excel, on la garde prioritaire,
        // sinon on remplit depuis le lien de la cellule Activité.
        if (!dfRows[i].HyperlienBR) {
          dfRows[i].HyperlienBR = `https://www.billetreduc.com/search.htm?se=${dfRows[i].Activite.trim().replace(/\s+/g, '+')}`;
        }
      }
    }
    else { 
      alert("Echec de l'import : colonne Activite non trouvée");
      return;
    }

    // 6) normalisation colonnes + __uuid + Date->dateint 
    dfRows = dfRows.map((r, i) => {
      const o = { ...r };

      // --- Date -> dateint ---
      // Accepte Excel serial ou "dd/mm[/yy]"
      let di = null;
      if (o.Date != null && String(o.Date).trim() !== '') {
        // d'abord tentative pretty
        di = prettyToDateint(String(o.Date).trim());
        // sinon Excel serial
        if (!isDateint(di) && typeof o.Date === 'number') {
          const ymd = excelSerialToYMD(o.Date);
          if (ymd) di = ymdToDateint(ymd);
        }
      }
      o.Date = di || null; // stock interne = dateint ou null

      // Accepte Excel serial sur Session et Relache
      if (typeof o.Session === 'number') {
        if (o.Session < 0 || o.Session > 31) {
          const ymd = excelSerialToYMD(o.Session);
          if (ymd) {
            const di = ymdToDateint(ymd);
            o.Session = (isDateint(di)) ? dateintToPretty(di) : String(o.Session).trim();
          } else String(o.Session).trim();
        } else String(o.Session).trim();
      }
      if (typeof o.Relache === 'number') {
        if (o.Relache < 0 || o.Relache > 31) {
          const ymd = excelSerialToYMD(o.Relache);
          if (ymd) {
            const di = ymdToDateint(ymd);
            o.Relache = (isDateint(di)) ? dateintToPretty(di) : String(o.Relache).trim();
          } else String(o.Relache).trim();
        } else String(o.Relache).trim();
      }

      // 7) __uuid garanti
      if (!o.__uuid) {
        o.__uuid = genUUID();
      }
      return o;
    });
    
    if (!add) {
      // 8) Tri des données
      dfRows = sortDf(dfRows);

      console.log('✅ Import df OK', dfRows.length, 'lignes');
    
      // 9) Carnet d’adresses (optionnel, 2e onglet)
      let caRows = [];
      const ca  = wb.Sheets[wb.SheetNames[1]]; // 2e onglet = Carnet
      if (ca) {
        caRows = XLSX.utils.sheet_to_json(ca, { defval: null, raw: true });
        caRows = normalizeImportedRows(caRows);

        caRows = caRows.map((r, i) => {
          const o = { ...r };
          // __uuid garanti
          if (!o.__uuid) {
            o.__uuid = genUUID();
          }
          return o;
        });

        caRows = (caRows||[]).filter(r => r.Nom != null && r.Nom !== '');
        caRows = sortCarnet(caRows);

        console.log('✅ Import ca OK', caRows.length, 'lignes');
      }

      // 10) Recalcul de la colonne Fin
      recalcFinForAll(dfRows);

      // 11) Initialisation de la période de programmation
      activitesAPI.initPeriodeProgrammation(dfRows);      

      // 12) Enregistrement des données dans le contexte
      ctx.beginAction('import');
      try {
        ctx.setDf(dfRows);     
        ctx.setCarnet(caRows);      
      } finally {
        ctx.endAction();                   
      }

      // 13) Mise à jour des colonnes de grilles
      rebuildColumnsForActiviteGrids(dfRows);
    }
    else {
      recalcFinForAll(dfRows);
      if (!dfRows || dfRows.length == 0) return;
      // ctx.mutateDf(rows => sortDf([...nouvellesActivites, ...rows]));
      ctx.mutateDf(rows => sortDf(mergeRowsNoDupMultiKey(rows, dfRows, ['Activite', 'Debut', 'Lieu', 'Session'])));

      // Maj des sélections
      setTimeout(() => {
        scrollToExpander?.('exp-non-programmees');
        openExpander?.('exp-non-programmees');
        selectRowByUuid('grid-non-programmees', dfRows[0].__uuid, { ensure: 'center', flash: null });
      }, 50);  
    }
  }

  catch (e) {
    alert("Echec de l'import : " + e.message);
  } finally {
    overlayAttente.hidden = true; // Masque l'overlay d'attente
  }
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
    // syncBottomBarTogglePosition();
  });

  updateTogglePos();
  window.addEventListener('resize', updateTogglePos);
}

let isSplitterDragging = false; // pour geler les recalculs ailleurs

function syncBottomBarTogglePosition() {
  if (isSplitterDragging) return;
  const bar = document.querySelector('.bottom-bar');
/** @type {HTMLElement} */
  const toggle = document.querySelector('.bottom-toggle');
  if (!bar || !toggle) return;

  // Mesurer la hauteur réellement rendue
  const h = Math.max(0, Math.round(bar.getBoundingClientRect().height));

  // Place la languette juste au-dessus de la barre, en tenant compte du safe-area
  toggle.style.bottom = `calc(${getSafeBottom()} + ${h}px)`;
}

function lockHorizontalScroll() {
  const scroller = document.querySelector('.bottom-bar__scroller');
  if (!scroller) return;

  let startX = 0, startY = 0, startLeft = 0, lock = null;

  scroller.addEventListener('touchstart', (e) => {
    const te = /** @type {TouchEvent} */ (e);
    const t = te.touches[0];
    startX = t.clientX;
    startY = t.clientY;
    startLeft = scroller.scrollLeft;
    lock = null;
  }, { passive: true });

  scroller.addEventListener('touchmove', (e) => {
    const te = /** @type {TouchEvent} */ (e);
    const t = te.touches[0];
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

function getSafeBottom() {
  // iOS notch etc.
  return 'env(safe-area-inset-bottom, 0px)';
}

function setSafeGap(px){
  // document.documentElement.style.setProperty('--safe-gap', `${px}px`);
}

function computeSafeGap() {
  if (isSplitterDragging) return;

  const vv = window.visualViewport;
  let gap = 0;

  if (vv) {
    // Espace masqué en bas du viewport
    const raw = Math.round(window.innerHeight - (vv.height + vv.offsetTop));

    const KEYBOARD_THRESHOLD = 140;                 // ↓↓↓ si > 140 → clavier
    const keyboardLikely = (window.innerHeight - vv.height) > KEYBOARD_THRESHOLD;
    const pullDown = vv.offsetTop < 0;              // “stretch” iOS en tirant vers le bas

    if (!keyboardLikely && !pullDown) {
      // ✅ Cas "barre Safari" : applique un gap modéré (0..120px)
      const CHROME_MAX = 120;
      gap = Math.max(0, Math.min(CHROME_MAX, raw));
    } else {
      // ❌ On ignore clavier et pull-down pour ton besoin
      gap = 0;
    }
  }

  // (optionnel) garder une petite hystérésis en haut de page pour éviter des micro-sauts
  const atTop = (window.scrollY || document.documentElement.scrollTop || 0) <= 0;
  const prev = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--safe-gap'), 10) || 0;
  if (atTop && gap > prev) {
    gap = prev; // ne pas augmenter en “tirant” tout en haut
  }

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

// ------- Menu kebab -------
function createKebabItem(label, key) {
  const b = document.createElement('button');
  b.className = 'kebab-menu__item';
  b.type = 'button';
  b.dataset.action = key;
  b.textContent = label;
  return b;
}

function createKebabSep() {
  const d = document.createElement('div');
  d.className = 'kebab-sep';
  return d;
}

export function openKebabMenu(anchorBtn, { items = [], side = false } = {}) {
  if (!anchorBtn) return null;

  // prevent double-open on the same button
  if (anchorBtn.__menuOpen) {
    try { anchorBtn.__menuOpen.remove(); } catch {}
    anchorBtn.__menuOpen = null;
  }

  // 1) Build the menu (initially invisible so we can measure/position)
  const menu = document.createElement('div');
  menu.className = 'kebab-menu';

  let submenuCurrent = null;

  // Stop the click bubbling so outside-closer doesn’t fire
  menu.addEventListener('click', (e)=> e.stopPropagation());

  // Items
  for (const it of items) {
    // const sep = createKebabSep();
    const btn = createKebabItem(it.label, it.id);
    btn.addEventListener('mouseenter', ()=> btn.style.background = '#f3f4f6');
    btn.addEventListener('mouseleave', ()=> btn.style.background = 'transparent');
    btn.addEventListener('click', (e)=> {
      e.stopPropagation();
      if (it.submenu) submenuCurrent = openKebabMenu(btn, { items: it.submenu, side: true });
      else try { 
        it.onClick?.(); 
        if (submenuCurrent) submenuCurrent.close(); 
      } finally { closeMenu(); }
    });
    // menu.append(sep, btn);
    menu.appendChild(btn);
  }

  document.body.appendChild(menu);

  // 2) Position it relative to the anchor (above if not enough space below)
  const pos = () => {
    const r = anchorBtn.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;

    // IMPORTANT: menu doit être dans le DOM pour mesurer
    const m = menu.getBoundingClientRect();
    const PAD = 8;     // marge viewport
    const GAP = 6;     // espace entre anchor et menu

    let top, left;

    if (!side) {
      // Menu principal : sous le bouton, aligné à droite
      top  = r.bottom + GAP;
      left = r.right - m.width;

      // flip vertical si déborde en bas
      if (top + m.height > vh - PAD) {
        top = r.top - GAP - m.height;
      }

      // clamp viewport
      top  = Math.max(PAD, Math.min(top,  vh - PAD - m.height));
      left = Math.max(PAD, Math.min(left, vw - PAD - m.width));

      menu.style.left = `${Math.round(left)}px`;
      menu.style.top  = `${Math.round(top)}px`;
      menu.style.right = ""; // au cas où
    } else {
      // Sous-menu : à droite de l’item parent (sinon à gauche)
      top  = r.top;
      left = r.right + GAP;

      // si ça déborde à droite, ouvre à gauche
      if (left + m.width > vw - PAD) {
        left = r.left - GAP - m.width;
      }

      // clamp viewport (vertical + horizontal)
      top  = Math.max(PAD, Math.min(top,  vh - PAD - m.height));
      left = Math.max(PAD, Math.min(left, vw - PAD - m.width));

      menu.style.left = `${Math.round(left)}px`;
      menu.style.top  = `${Math.round(top)}px`;
      menu.style.right = ""; // IMPORTANT: on positionne en "left/top"
    }

    menu.style.visibility = "visible";

    requestAnimationFrame(() => {
      menu.style.opacity = "1";
      menu.style.transform = "translateY(0)";
    });
  };

  // 3) Close handlers (escape / outside click / resize)
  const closeMenu = () => {
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('click', onDocClick, true);
    window.removeEventListener('resize', onResize);
    try {
      menu.style.opacity = '0';
      menu.style.transform = 'translateY(6px)';
      setTimeout(()=> menu.remove(), 120);
    } catch { menu.remove(); }
    anchorBtn.__menuOpen = null;
  };

  const onKey = (e) => { if (e.key === 'Escape') closeMenu(); };
  const onResize = () => { closeMenu(); };

  // Important: defer outside-click to avoid closing immediately
  const onDocClick = (e) => {
    if (menu.contains(e.target) || e.target === anchorBtn) return menu;
    closeMenu();
  };

  // Prevent the very click that opened the button from closing the menu
  anchorBtn.addEventListener('click', (e)=> e.stopPropagation(), { once: true });

  // Arm listeners
  setTimeout(() => {
    document.addEventListener('click', onDocClick, true);
  }, 0);
  document.addEventListener('keydown', onKey);
  window.addEventListener('resize', onResize);

  // Position now (after in-DOM to get proper size)
  pos();
  anchorBtn.__menuOpen = menu;
  return { close: closeMenu };
}

// Rechargement de l'application
async function resetApp() {
  await caches.keys().then(keys =>
    Promise.all(keys.map(k => caches.delete(k)))
  );
  localStorage.clear();
  location.reload();
}

export function wireAppKebab() {
  const btn = document.getElementById('btn-app-kebab');
  if (!btn) return;
  
  btn.addEventListener('click', (e) => {
    e.stopPropagation();  // Évite que le clic se propage à un parent cliquable
    openKebabMenu(btn, {
      items: [
        { id:'carnet',    label:"Carnet d'adresses",        onClick: ()=>openSheetCarnet() },
        { id:'prog',      label:"Assistant programmation",  onClick: ()=>openSheetAssistantProgrammation() },
        { id:'chat',      label:"Assistant chat",           onClick: ()=>openSheetAssistantChat() },
        { id:'infosPlus', label:'Assistant infos+',         onClick: ()=>openSheetInfosPlus() },
        { id:'settings',  label:'Paramètres',               onClick: ()=>openSheetParams() },
        { id:'colonnes',  label:'Colonnes',                 submenu: 
          [
            { id:'add-column',       label:"Ajouter",        onClick: ()=>doAjouterColonne() },
            { id:'suppress-column',  label:'Supprimer',      onClick: ()=>doSupprimerColonne() },
          ]
        },
        { id:'reload',    label:'Reinit',                   onClick: async ()=> await resetApp() },
        { id:'help',      label:'Aide',                     onClick: ()=>openSheetAide() },
        { id:'JsonOff',   label:'Export JSON Off',          onClick: async ()=> await exportJsonForAi('off', 2026) },
        { id:'JsonIn',    label:'Export JSON In',           onClick: async ()=> await exportJsonForAi('in', 2026) },
      ]
    });
  }, { passive: true });

  // Câblage du bouton infos sur page--planning
  document.querySelector(".pageprog-info-btn")?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();

    openPopoverNear(e.currentTarget, {
      innerHTML: `
        <p style="margin-top: 0em; margin-bottom: 0.2em"><b>Programme :</b></p> 
        <ul style="padding-left: 1rem; margin-top: 0em; margin-bottom: 1em">
          <li>Votre programme de spectacles.</li>
          <li>Utiliser le menu <i>.../Paramètres</i> pour définir la période de programmation.</li>
          <li>Utiliser le bouton <i>Calendrier</i> pour passer en mode Calendrier ou en mode Liste.</li>
          <li>En mode Calendrier: double-click sur un spectacle -> application itinéraire, appui long sur un spectacle -> modification de la date de programmation.</li>
        </ul>
        <p style="margin-top: 0em; margin-bottom: 0.2em"><b>Plages libres :</b></p> 
        <ul style="padding-left: 1rem; margin-top: 0em; margin-bottom: 1em">
          <li>Plages libres dans votre programme de spectacles.</li>
          <li>Pour programmer un spectacle, sélectionner une plage libre dans cette liste, puis un spectacle à programmer dans la liste <i>Programmer...</i>, puis cliquer sur le bouton <i>Programmer</i>.</li>
          <li>Utiliser le bouton <i>Pauses</i> pour tenir compte ou pas des pauses repas.</li>
        </ul>
        <p style="margin-top: 0em; margin-bottom: 0.2em"><b>Programmer... :</b></p> 
        <ul style="padding-left: 1rem; margin-top: 0em; margin-bottom: 1em">
          <li>Spectacles programmables dans la plage libre sélectionnée.</li>
          <li>Sélectionner un spectacle dans cette liste et cliquer sur le bouton <i>Programmer</i> pour l'insérer dans le programme.</li>
          <li>Filtrer sur vos favoris pour être sûr de ne programmer que vos favoris.</li>
        </ul>
        <p style="margin-top: 0em; margin-bottom: 0.2em"><b>Stock :</b></p> 
        <ul style="padding-left: 1rem; margin-top: 0em; margin-bottom: 1em">
          <li>Ensemble des spectacles chargés dans votre application.</li>
          <li>Utiliser le menu <i>Fichier</i> pour charger le fichier Excel d'un programme préalablement exporté, ou importer un catalogue.</li>
          <li>Utiliser le bouton <i>Favori</i> pour mettre un marqueur de favoris sur le spectacle sélectionné ou le filtre courant.</li>
        </ul>
        <p style="margin-top: 0em; margin-bottom: 0.2em">Utiliser le menu <i>.../Aide</i> pour une aide détaillée.</p> 
      `
    });
  });
}

// ===== Actions =====

// Colonnes obligatoires d'un tableau d'activités
const MANDATORY_COLS = new Set([
  'Activite',
  'Date',
  'Debut',
  'Duree',
  'Fin',
  'Lieu',
  'Session',
  'Relache',
  'Style',
  'Mood',
  'Orga',
  'Reserve',
  'Marqueur',
  'Note',
  'Hyperlien',
  'HyperlienGoogle',
  'HyperlienBR',
  'Description',
  'Distribution',
  'Avis',
  '__desc_summary',
  '__avis_summary',
  '__uuid'
]);

// Ajout d'une colonne
export function doAjouterColonne() {
  const df  = ctx.df || [];

  openSheetExclusive({
    title: 'Ajouter une colonne',
    panelHeight: 'auto',
    panelMaxHeight: '40vh',
// !@ts-ignore
    mount: (body, { close }) => {
      body.innerHTML = `
        <div class="form">
          <div class="form-row">
            <label for="new-col-name">Nom de la nouvelle colonne</label>
            <input id="new-col-name"
                   type="text"
                   class="bb-input"
                   placeholder="Ex. Commentaire, Classement…"
                   autocomplete="off" />
          </div>
          <p class="form-error" id="new-col-error" style="display:none;color:#c00;font-size:0.85rem;"></p>
        </div>
        <div class="sheet-footer has-border">
          <div class="form-actions">
            <button type="button" id="btn-cancel-add-col" class="bb-btn">Annuler</button>
            <button type="button" id="btn-apply-add-col" class="bb-btn is-primary">Ajouter</button>
          </div>
        </div>
      `;

      const input = body.querySelector('#new-col-name');
      const errEl = body.querySelector('#new-col-error');
      const btnCancel = body.querySelector('#btn-cancel-add-col');
      const btnApply  = body.querySelector('#btn-apply-add-col');

      const showError = (msg) => {
        if (!errEl) return;
        errEl.textContent = msg || '';
        errEl.style.display = msg ? 'block' : 'none';
      };

      const clearError = () => showError('');

      // Ensemble des colonnes existantes (insensible à la casse)
      const existingFields = (() => {
        const s = new Set();

        // helper normalisation : " Nom " -> "nom"
        const add = (name) => {
          if (!name) return;
          const norm = String(name).trim().toLowerCase();
          if (!norm) return;
          s.add(norm);
        };

        // 1) Noms de champs du DF
        const rows = ctx.df || [];
        for (const r of rows) {
          if (!r || typeof r !== 'object') continue;
          for (const k of Object.keys(r)) {
            if (!k) continue;
            add(k);              // nom de champ (field)
          }
        }

        // 2) Noms de colonnes dans la grille (field + headerName)
        const handle = window.grids?.get('grid-programmees');    // ou une autre grille de référence
        const colDefs = handle?.api?.getColumnDefs?.() || [];
        for (const col of colDefs) {
          if (!col) continue;
          if (col.field)      add(col.field);       // champ interne
          if (col.headerName) add(col.headerName);  // titre visible
        }

        return s;
      })();

      function apply() {
        clearError();
        let name = (input.value || '').trim();

        // validations de base
        if (!name) {
          showError('Veuillez saisir un nom de colonne.');
          input.focus();
          return;
        }

        // on déconseille fortement de commencer par "__"
        if (name.startsWith('__')) {
          showError('Le préfixe "__" est réservé aux colonnes techniques.');
          input.focus();
          return;
        }

        // éviter les doublons (insensible à la casse)
        if (existingFields.has(name.toLowerCase())) {
          showError('Une colonne portant ce nom existe déjà.');
          input.focus();
          input.select();
          return;
        }

        // facultatif : limiter les caractères exotiques
        const sanitized = name.replace(/\s+/g, ' ').trim();
        name = sanitized;

        // On va construire le nouveau df et le garder pour rebuild
        let newDf = null;
        ctx.mutateDf?.(rows => {
          const src = rows || [];

          // on duplique chaque row en ajoutant la nouvelle clé
          const next = src.map(r => ({
            ...r,
            [name]: null,   
          }));

          // si df était vide : on crée une ligne vide pour que la colonne existe
          if (!next.length) {
            next.push({ [name]: null });
          }

          newDf = next;
          return next;
        });

        try {
          if (typeof rebuildColumnsForActiviteGrids === 'function') {
            rebuildColumnsForActiviteGrids(newDf || ctx.df || []);
          }
        } catch (e) {
          console.error('rebuildColumnsForActiviteGrids error:', e);
        }

        close();
      }

      btnCancel?.addEventListener('click', () => close());
      btnApply?.addEventListener('click', apply);

      input?.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') {
          ev.preventDefault();
          apply();
        }
        if (ev.key === 'Escape') {
          ev.preventDefault();
          close();
        }
      });

      // focus initial
      setTimeout(() => input?.focus(), 20);
    }
  });
}

// Suppression d'une colonne
export function doSupprimerColonne() {
  const df = window.ctx?.df || [];
  if (!Array.isArray(df) || df.length === 0) {
    alert('Aucune donnée chargée : impossible de supprimer une colonne.');
    return;
  }

  // Récupère la liste des colonnes à partir de la première ligne
  const sample = df[0] || {};
  const allFields = Object.keys(sample);

  // Colonnes candidates à la suppression : non techniques et non obligatoires
  const removable = allFields.filter(f =>
    f &&
    !MANDATORY_COLS.has(f) &&
    !f.startsWith('__')
  );

  if (!removable.length) {
    alert('Aucune colonne facultative à supprimer.');
    return;
  }

  openSheetExclusive({
    title: 'Supprimer une colonne',
    panelHeight: 'auto',
    panelMaxHeight: '40vh',
    mount: (body, { close }) => {
      const optionsHtml = removable
        .map(name => `<option value="${name}">${name}</option>`)
        .join('');

      body.innerHTML = `
        <div class="form">
          <div class="form-row">
            <label for="col-to-remove">Colonne à supprimer</label>
            <select id="col-to-remove" class="bb-input">
              ${optionsHtml}
            </select>
          </div>
        </div>
        <div class="sheet-footer has-border">
          <div class="form-actions">
            <button type="button" id="btn-cancel" class="bb-btn">Annuler</button>
            <button type="button" id="btn-apply" class="bb-btn is-primary">Supprimer</button>
          </div>
        </div>
      `;

      const sel   = body.querySelector('#col-to-remove');
      const btnOk = body.querySelector('#btn-apply');
      const btnKo = body.querySelector('#btn-cancel');

      btnKo.addEventListener('click', () => close());

      btnOk.addEventListener('click', () => {
        const col = sel.value?.trim();
        if (!col) {
          alert('Veuillez choisir une colonne à supprimer.');
          return;
        }
        if (MANDATORY_COLS.has(col)) {
          alert(`La colonne "${col}" est obligatoire et ne peut pas être supprimée.`);
          return;
        }

        // Confirmation de confort
        if (!confirm(`Supprimer la colonne "${col}" ?`)) return;

        if (!window.ctx?.mutateDf) {
          console.error('ctx.mutateDf est introuvable');
          return;
        }

        // Mise à jour du df (immutabilité "façon ctx.mutateDf")
        window.ctx.mutateDf(rows => {
          if (!Array.isArray(rows)) return rows;

          const next = rows.map(r => {
            if (!r || typeof r !== 'object') return r;
            const copy = { ...r };
            delete copy[col];
            return copy;
          });

          // Rebuild des colonnes des grilles d’activités avec le nouveau df
          try {
            rebuildColumnsForActiviteGrids?.(next);
          } catch (e) {
            console.error('rebuildColumnsForActiviteGrids error:', e);
          }

          return next;
        });

        close();
      });
    }
  });
}

// Reset du contexte
async function doNouveauContexte() {
  ctx.beginAction('Nouveau contexte');
  try {
  ctx.setDf([]);
  ctx.setCarnet([]);
  } finally {
    ctx.endAction();
  }
  activitesAPI.initPeriodeProgrammation(ctx.getDf());
  rebuildColumnsForActiviteGrids([]);
}

// Reset du programme
async function doNouveauProgramme() {
  ctx.mutateDf(rows => {
    if (!Array.isArray(rows) || !rows.length) return rows;

    // on part d'une copie superficielle du df
    let next = rows.slice();

    // indexation de df par __uuid -> index
    const indexById = new Map();
    next.forEach((r, i) => {
      if (r && r.__uuid != null) {
        indexById.set(r.__uuid, i);
      }
    });

    const prog = activitesAPI.getActivitesProgrammees(next) || [];
    if (!prog.length) {
      next = sortDf(next);
      return next;
    }

    // uuids des lignes à supprimer (pauses)
    const uuidsToDelete = new Set();

    for (const pr of prog) {
      const uuid = pr.__uuid;
      if (uuid == null) continue;

      const idx = indexById.get(uuid);
      if (idx === undefined) continue; // pas trouvé dans df → on ignore

      const rowInDf = next[idx];

      if (activitesAPI.estPause(pr)) {
        // on marque pour suppression (on ne fait pas encore de splice)
        uuidsToDelete.add(uuid);
      } else {
        // activité programmée normale : on garde la ligne mais Date = null
        next[idx] = { ...rowInDf, Date: null, Reserve:'Non' };
      }
    }

    // suppression effective des pauses
    if (uuidsToDelete.size > 0) {
      next = next.filter(r => !uuidsToDelete.has(r.__uuid));
    }

    next = sortDf(next);
    return next;
  });

  // recalcul de la période de prog sur le df nettoyé
  // activitesAPI.initPeriodeProgrammation(ctx.getDf());

  // on revient aux colonnes standard pour les grilles d'activités
  rebuildColumnsForActiviteGrids([]);
}

// Import Excel
async function doImportExcel() {
  // déclenche l’input caché
  const fi = $('fileInput');
  if (fi) fi.click();
}

// Import depuis catalogue du In
async function doImportFromCatIn() {
  // const f2025 = await fetch('https://docs.google.com/spreadsheets/d/1pZvcYOYfhllj95PQlpUunbyklXteMiGs/export?format=xlsx&id=1pZvcYOYfhllj95PQlpUunbyklXteMiGs&gid=336819867');
  const f2026 = await fetch('https://docs.google.com/spreadsheets/d/1II13iAjOsl9lH40kvuyzgR17a-zVLhNk/export?format=xlsx&id=1II13iAjOsl9lH40kvuyzgR17a-zVLhNk&gid=1067029202');
  importFromXlsxFile(f2026, {add:true});
}

// Import depuis catalogue du Off
async function doImportFromCatOff() {
  // const f2025 = await fetch('https://docs.google.com/spreadsheets/d/17qBLtxLC4S-e21zk1mPAD214aUilq_e7/export?format=xlsx&id=17qBLtxLC4S-e21zk1mPAD214aUilq_e7&gid=781555543');
  const f2026 = await fetch('https://docs.google.com/spreadsheets/d/1G3BBX1KZflK9BGyKiMqqRIDQNgw40jiH/export?format=xlsx&id=1G3BBX1KZflK9BGyKiMqqRIDQNgw40jiH&gid=1643688045');
  importFromXlsxFile(f2026, {add:true});
}

// Export Excel
async function doExportExcel() {

  // Change le nom des colonnes
  // mapping: { ancienNom: nouveauNom }
  function renameColumns(rows, mapping = {}) {
    return (rows || []).map(r => {
      const out = {};
      for (const [k, v] of Object.entries(r)) {
        const newKey = Object.prototype.hasOwnProperty.call(mapping, k) ? mapping[k] : k;
        out[newKey] = v;
      }
      return out;
    });
  }

  // order: tableau des clés selon lequel les colonnes sont réordonnées
  // dropUnknown: si true, on écarte les colonnes non listées
  function reorderColumns(rows, order = [], dropUnknown = false) {
    const has = Object.prototype.hasOwnProperty;
    return (rows || []).map(r => {
      const out = {};
      // d’abord les colonnes demandées
      for (const key of order) if (has.call(r, key)) out[key] = r[key];
      // puis le reste si on ne drop pas
      if (!dropUnknown) {
        for (const k of Object.keys(r)) if (!order.includes(k)) out[k] = r[k];
      }
      return out;
    });
  }

  // Supprime, renomme et réordonne
  function cleanRows(rows, colsToRemove, renameMap, order, dropUnknown = false) {
    let cleaned = rows.map(r => {
      const copy = { ...r };
      colsToRemove.forEach(c => {
        if (Object.prototype.hasOwnProperty.call(copy, c)) {
          delete copy[c];
        }
      });
      return copy;
    })
    return reorderColumns(renameColumns(cleaned, renameMap), order, dropUnknown);
  }

  // Renvoie pour chaque colonne la largeur du contenu le plus long
  function colWidths(rows) {
    const data = [Object.keys(rows[0]), ...rows.map(Object.values)];
    return data[0].map((_, colIndex) => {
      const maxLen = data.reduce((acc, row) => {
        const cell = row[colIndex];
        const cellValue = cell == null ? "" : String(cell);
        return Math.max(acc, cellValue.length);
      }, 0);
      // 1 unité ≈ largeur d’un caractère
      return { wch: Math.min(Math.max(maxLen + 2, 8), 50) }; // borne entre 8 et 50
    });
  }

  try {
    const wb = XLSX.utils.book_new();

    // Data
    const rows = ctx.df || [];

    let cleanData = rows.map(r => {
      const copy = { ...r, Date: dateintToPretty(r.Date) };
      return copy;
    })
    
    cleanData = cleanRows(cleanData, 
      ["__uuid", "Hyperlien", "__order", "__type_activite", "__index", "__seances"],
      { Debut: "Début", Duree: "Durée", Activite: "Activité", Session: "Séances", Relache: "Relâches", Mood: "Ton", Reserve: "Réservé", HyperlienBR: "Billet Réduc", HyperlienGoogle: "Google" },
      [ "Date", "Début", "Activité", "Style", "Ton", "Note", "Marqueur", "Durée", "Fin", "Lieu", "Séances", "Relâches", "Orga", "Réservé", "Billet Réduc", "Google", "__desc_summary", "__avis_summary", "__distribution" ],
      false
    );

    const wsData = XLSX.utils.json_to_sheet(cleanData);

    // Calcul automatique des largeurs
    wsData["!cols"] = colWidths(cleanData);

    // repérer la colonne "Activité" dans la ligne d'entête
    const range = XLSX.utils.decode_range(wsData['!ref'] || 'A1');
    let colActivite = null;
    for (let c = range.s.c; c <= range.e.c; c++) {
      const addr = XLSX.utils.encode_cell({ r: range.s.r, c });
      const v = wsData[addr]?.v;
      if (String(v).trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'') === 'activite') {
        colActivite = c;
        break;
      }
    }

    // pour chaque data row, si Hyperlien présent -> pose un lien sur la cellule Activité
    if (colActivite != null) {
      for (let i = 0; i < (rows?.length || 0); i++) {
        const r = range.s.r + 1 + i; // 1-based après entête
        const addr = XLSX.utils.encode_cell({ r, c: colActivite });
        const cell = wsData[addr] || (wsData[addr] = { t: 's', v: rows[i]?.Activité || '' });
        const url  = rows[i]?.Hyperlien;
        if (url) {
          cell.l = { Target: String(url) };
        }
      }
    }

    XLSX.utils.book_append_sheet(wb, wsData, 'data');

    // Carnet d'adresses
    const carnet = ctx.carnet || [];
    if (carnet.length > 0) {
      let cleanCarnet = cleanRows(carnet, 
        ["__uuid", "__order"],
        { Tel: "Téléphone" },
        [ "Nom", "Adresse", "Téléphone", "Web" ],
        false
      );
      const wsCarnet = XLSX.utils.json_to_sheet(cleanCarnet);
      wsCarnet["!cols"] = colWidths(cleanCarnet);
      XLSX.utils.book_append_sheet(wb, wsCarnet, 'Carnet');
    }

    XLSX.writeFile(wb, 'In & Off.xlsx');
  } catch (e) {
    console.error(e);
    alert('❌ Export KO');
  }
}

// Choix du mode d'export au format Ics
function chooseIcsExportMode() {
  return new Promise(resolve => {
    const dlg = document.createElement("dialog");
    dlg.className = "bb-dialog";

    dlg.innerHTML = `
      <form method="dialog" class="bb-dialog-body">

        <div class="bb-dialog-header">
          <h4>Exporter vers calendrier</h4>
          <button class="bb-dialog-close" value="cancel" aria-label="Fermer">x</button>
        </div>

        <div class="bb-dialog-actions">
          <button value="full" class="bb-btn is-primary">Programme complet</button>
          <button value="selected" class="bb-btn">Activité sélectionnée</button>
        </div>

      </form>
    `;

    document.body.appendChild(dlg);

    dlg.addEventListener("close", () => {
      const val = dlg.returnValue || "cancel";
      dlg.remove();
      resolve(val);
    }, { once: true });

    dlg.showModal();
  });
}

// Export du programme (complet ou activité sélectionnée) au format Ics
async function doExportIcs() {
  const choice = await chooseIcsExportMode();

  if (choice === "full") {
    return exportIcs();
  }

  if (choice === "selected") {
    return exportIcsSelected();
  }
}

// Export du programme complet au format Ics
async function exportIcs() {
  const filteredRows = [];
  window.grids?.get('grid-programmees').api.forEachNodeAfterFilterAndSort(node => {
    filteredRows.push(node.data);
  });  
  rowsToICS(activitesAPI.getActivitesProgrammees(filteredRows));
}

// Export de l'activité programmée sélectionnée au format Ics
async function exportIcsSelected() {
  const api = window.grids?.get('grid-programmees')?.api;
  if (!api) return;

  const selected = api.getSelectedRows?.() || [];
  if (!selected.length) return;

  rowsToICS(
    activitesAPI.getActivitesProgrammees(selected)
  );
}

// Détecte l’année de session à partir des champs Session et Relache
function detectSessionYear(sessionVal, relacheVal, editionYearFallback = null) {
  const txt = (String(sessionVal || '') + ' ' + String(relacheVal || '')).toLowerCase();

  // Années explicites 4 chiffres
  const reYear4 = /\b(20\d{2})\b/g;
  let m;
  while ((m = reYear4.exec(txt)) !== null) {
    const y = Number(m[1]);
    if (y >= 2000 && y <= 2099) return y;
  }

  // Années à 2 chiffres après un "/"
  const y2k = (y) => (Number.isFinite(y) && y < 100 ? (y < 50 ? 2000 + y : 1900 + y) : y);
  const reYear2 = /\/(\d{2})\b/g;
  while ((m = reYear2.exec(txt)) !== null) {
    const yy = Number(m[1]);
    const y = y2k(yy);
    if (y >= 2000 && y <= 2099) return y;
  }

  if (editionYearFallback && Number.isFinite(editionYearFallback)) return editionYearFallback;
  return (new Date()).getFullYear();
}

// Convertit un objet Date en entier AAAAMMJJ
function dateToInt(d) {
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return y * 10000 + m * 100 + day;
}

// Construit un tableau d’entiers de dates (AAAAMMJJ) entre startInt et endInt inclus
function rangeDateInts(startInt, endInt) {
  const out = [];
  if (!Number.isFinite(startInt) || !Number.isFinite(endInt)) return out;

  const y1 = Math.floor(startInt / 10000);
  const m1 = Math.floor((startInt / 100) % 100) - 1;
  const d1 = startInt % 100;

  const y2 = Math.floor(endInt / 10000);
  const m2 = Math.floor((endInt / 100) % 100) - 1;
  const d2 = endInt % 100;

  const cur = new Date(y1, m1, d1);
  const end = new Date(y2, m2, d2);

  while (cur <= end) {
    out.push(dateToInt(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

// Vérification de cohérence du tableau d'activités
async function doVerifierCoherence() {
  openSheetCoherence(ctx.df);
}

// Undo
async function doUndo() {
  const keys = extractColumnKeys(ctx.df);

  const tx = ctx.peekUndoTxId?.('df') || null;
  if (tx && ctx.peekUndoTxId?.('meta') === tx) {
    try { await ctx.undo('meta'); } catch {}
  }

  try { await ctx.undo('df'); } catch {}

  if (areColumnKeysDifferent(ctx.df, keys)) rebuildColumnsForActiviteGrids(ctx.df);
}

// Redo
async function doRedo() {
  const keys = extractColumnKeys(ctx.df);

  const tx = ctx.peekRedoTxId?.('df') || null;
  if (tx && ctx.peekRedoTxId?.('meta') === tx) {
    try { await ctx.redo('meta'); } catch {}
  }

  try { await ctx.redo('df'); } catch {}

  if (areColumnKeysDifferent(ctx.df, keys)) rebuildColumnsForActiviteGrids(ctx.df);
}

// Ajout activité avec collage
async function doAjouterActivitesParCollage() {
  await getClipBoardText();
}

async function getClipBoardText(parser=null) {
  const  btn  = /** @type {HTMLElement} */ document.getElementById('btn-paste');
  const popup = /** @type {HTMLElement} */ document.getElementById('paste-popup');
  const proxy = /** @type {HTMLElement} */ document.getElementById('paste-proxy');

  function openPastePopup() {
    popup.setAttribute('aria-hidden', 'false');

    // Positionner juste au-dessus du bouton (mesure réelle)
    requestAnimationFrame(() => {
      /** @type {HTMLElement} */
      const dialog = popup.querySelector('.pp-dialog');
      const rect = btn.getBoundingClientRect();
      const dlgW = dialog.offsetWidth, dlgH = dialog.offsetHeight;

      const top = Math.max(8, rect.top - dlgH - 8);
      const left = Math.min(
        window.innerWidth - dlgW - 8,
        Math.max(8, rect.left + rect.width/2 - dlgW/2)
      );
      dialog.style.top  = `${top + window.scrollY}px`;
      dialog.style.left = `${left + window.scrollX}px`;

      // Prépare la zone et assure un focus "solide"
      proxy.textContent = '';
      proxy.setAttribute('contenteditable', 'true');
      proxy.style.webkitUserSelect = 'text';    // iOS
      proxy.style.userSelect = 'text';

      let done = false;

      // ⚠️ Deux frames pour laisser Safari peindre puis focus
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          proxy.focus();
          // Place un caret explicite dans le contenteditable
          const sel = window.getSelection();
          const range = document.createRange();
          range.selectNodeContents(proxy);
          range.collapse(true);
          sel.removeAllRanges();
          sel.addRange(range);
        });
      });

      // --- LISTENERS ---

      // 1) beforeinput (iOS envoie insertFromPaste) 
      // => ne se déclenche que si le clipboard contient du texte
      const onBeforeInput = (e) => {
        if (e.inputType === 'insertFromPaste' && e.dataTransfer) {
          // 🟢 chemin idéal : on récupère direct
          done = true;
          e.preventDefault(); // évite l'insertion dans le DOM
          const txt = e.dataTransfer.getData('text/plain') || e.dataTransfer.getData('text') || '';
          finalize(txt);
        }
      };

      // 2) paste fallback : laisser coller, puis lire proxy.textContent 
      // => se declenche tout le temps sur paste utilisateur mais ne renvoie aucun texte
      // => sert uniquement à fermer la popup et avertir que la clipboard est vide lorsqu'il est vide
      const onPaste = () => {
        setTimeout(() => {
          const txt = (proxy.textContent || '').trim();
          // si !done le clipboard est effectivement vide => on alerte et on ferme la popup 
          if (!done) {
            cleanup(); 
          }
        }, 100);
      };

      // 3) input fallback ultime : si ni beforeinput ni paste n’ont capté 
      // => fermeture de la popup au premier caractère tapé
      const onInput = () => {
        setTimeout(() => {
          const txt = (proxy.textContent || '').trim();
          cleanup(); 
        }, 0);
      };

      const onBackdrop = (e) => {
        if (e.target.classList.contains('pp-backdrop')) cleanup();
      };

      proxy.addEventListener('beforeinput', onBeforeInput);
      proxy.addEventListener('paste', onPaste);
      proxy.addEventListener('input', onInput);
      popup.addEventListener('click', onBackdrop);

      (/** @type {any} */ (popup))._tmp = { onBeforeInput, onPaste, onInput, onBackdrop };
    });
  }

  function finalize(txt) {
    cleanup();
    importFromUrlOrTxt(txt, parser);
  }

  function cleanup() {
    popup.setAttribute('aria-hidden', 'true');
    if ((/** @type {any} */ (popup))._tmp) {
      proxy.removeEventListener('beforeinput',  (/** @type {any} */ (popup))._tmp.onBeforeInput);
      proxy.removeEventListener('paste',        (/** @type {any} */ (popup))._tmp.onPaste);
      proxy.removeEventListener('input',        (/** @type {any} */ (popup))._tmp.onInput);
      popup.removeEventListener('click',        (/** @type {any} */ (popup))._tmp.onBackdrop);
      (/** @type {any} */ (popup))._tmp = null;
    }
    // Réinitialise la zone
    proxy.blur();
    proxy.textContent = '';
    btn.focus();
  }

  // Avec IOS on utilise directement la paste popup 
  if (isIOS()) {
    openPastePopup();
  } 
  else {
    // Sinon on utilise navigator.clipboard?.readText() avec la paste popup en fallback
    try {
      const txt = await navigator.clipboard?.readText();
      if (txt) {
        importFromUrlOrTxt(txt, parser);
        return;
      }
    } catch {}
    // openPastePopup();
  }
};

// Appel d'une fonction asynchrone avec affichage overlay attente
async function asyncCallAvecOverlayAttente(fnct, param, msg="Echec") {
  let res = null;
  try {
    overlayAttente.hidden = false; // Affiche l'overlay d'attente
    res = await fnct(param);
  }
  catch (e) {
    console.error('❌ ' + msg + ' : ' + e);
    alert('❌ ' + msg + ' : ' + e.message);
  } finally {
    overlayAttente.hidden = true; // Masque l'overlay d'attente
    return res;
  }
}

// Appel d'une fonction synchrone avec affichage overlay attente
function syncCallAvecOverlayAttente(fnct, param, msg="Echec") {
  let res = null;
  try {
    overlayAttente.hidden = false; // Affiche l'overlay d'attente
    res = fnct(param);
  }
  catch (e) {
    console.error('❌ ' + msg + ' : ' + e);
    alert('❌ ' + msg + ' : ' + e.message);
  } finally {
    overlayAttente.hidden = true; // Masque l'overlay d'attente
    return res;
  }
}

// Importe des activités depuis une URL ou un texte brut
export async function importFromUrlOrTxt(raw, parser=null) {

  let parsed = null;
  let mergeMode = 0;

  if (!parser) {
    if (looksLikeUrl(raw)) { 
      if (raw.includes("https://festival-avignon.com/fr/edition-2026/programmation/par-categorie")) {
        parsed = await asyncCallAvecOverlayAttente(parseAvignonInProgPageUrl, raw, 'Echec collage');
      } 
      else if (raw.includes("https://festival-avignon.com/fr/edition-2026/programmation/")) {
        parsed = await asyncCallAvecOverlayAttente(parseAvignonInSpecPageUrl, raw, 'Echec collage');
      } 
      else if (raw.includes("https://www.festivaloffavignon.com/programme")) {
        parsed = await asyncCallAvecOverlayAttente(parseAvignonOffProgPageUrl, raw, 'Echec collage');
      } 
      else if (raw.includes("https://www.festivaloffavignon.com/spectacles")) {
        parsed = await asyncCallAvecOverlayAttente(parseAvignonOffSpecPageUrl, raw, 'Echec collage');
      } 
      else if (raw.includes("https://www.billetreduc.com/search")) {
        parsed = await asyncCallAvecOverlayAttente(parseBilletReducProgPageUrl, raw, 'Echec collage');
      } 
      else if (raw.includes("https://www.billetreduc.com/spectacle")) {
        parsed = await asyncCallAvecOverlayAttente(parseBilletReducSpecPageUrl, raw, 'Echec collage');
        // mergeMode = 1;
      } 
      else if (raw.includes("https://www.billetreduc.com/collection")) {
        parsed = await asyncCallAvecOverlayAttente(parseBilletReducCollecPageUrl, raw, 'Echec collage');
      } 
      else {
        alert("Il n'existe pas de lecteur pour cette adresse, essayez de coller après avoir copié le texte de la page.");
      }
    } else {
      switch (true) {
        case isAvignonInProgPageText(raw):
          parsed = syncCallAvecOverlayAttente(parseAvignonInProgPageText, raw, 'Echec collage');
          break;
        case isAvignonInSpecPageText(raw):
          parsed = syncCallAvecOverlayAttente(parseAvignonInSpecPageText, raw, 'Echec collage');
          break;
        case isAvignonOffProgPageText(raw):
          parsed = syncCallAvecOverlayAttente(parseAvignonOffProgPageText, raw, 'Echec collage');
          break;
        case isAvignonOffSpecPageText(raw):
          parsed = syncCallAvecOverlayAttente(parseAvignonOffSpecPageText, raw, 'Echec collage');
          break;
      }
    }
    if (!parsed || parsed.length == 0) {
      alert("Aucune valeur valide à coller. Commencer par aller dans un catalogue, afficher le programme ou la page d'un spectacle et copier l'adresse ou le texte de la page.");
      return null;
    }
  } else {
    if (parser == 'parseAvignonInProgPage') {
      if (looksLikeUrl(raw) && raw.includes("https://festival-avignon.com/fr/edition-2026/programmation/par-categorie")) {
        parsed = await asyncCallAvecOverlayAttente(parseAvignonInProgPageUrl, raw, 'Echec collage');
      }      
      if (!parsed || parsed.length == 0) {
        alert("Aucune activité valide à récupérer à l'adresse choisie.");
        return null;
      }
    } 
    else if (parser == 'parseAvignonOffProgPage') {
      if (looksLikeUrl(raw) && raw.includes("https://www.festivaloffavignon.com/programme")) {
        parsed = await asyncCallAvecOverlayAttente(parseAvignonOffProgPageUrl, raw, 'Echec collage');
      }
      if (!parsed || parsed.length == 0) {
        alert("Aucune activité valide à récupérer à l'adresse choisie.");
        return null;
      }
    } 
    else if (parser == 'parseBilletReducProgPage') {
      if (looksLikeUrl(raw) && raw.includes("https://www.billetreduc.com/search")) {
        parsed = await asyncCallAvecOverlayAttente(parseBilletReducProgPageUrl, raw, 'Echec collage');
      }
      if (!parsed || parsed.length == 0) {
        alert("Aucune activité valide à récupérer à l'adresse choisie.");
        return null;
      }
    } 
    if (!parsed || parsed.length == 0) {
      alert("Aucune valeur valide à coller. Commencer par aller dans un catalogue, afficher le programme ou la page d'un spectacle et copier le texte de la page.");
      return null;
    }
  }

  const nouvellesActivites = [];
  if (!parsed || parsed.length == 0) parsed = [{...PARSED_DEFAULT}];

  for (const row of parsed) {

    const nom = String(row.Activite ?? "");

    const hyperlienDefault = (nom) ? 
      (row.Orga.trim().toLowerCase() == 'off') ? 
      `https://www.festivaloffavignon.com/resultats-recherche?recherche=${nom.trim().replace(/\s+/g, '+')}` : 
      (row.Orga.trim().toLowerCase() == 'in') ? 
      `https://festival-avignon.com/fr/edition-2026/programmation/par-categorie`: 
      `https://www.billetreduc.com/search.htm?se=${nom.trim().replace(/\s+/g, '+')}` :
      null;

    const hyperlienBRDefault = (nom) ? 
      `https://www.billetreduc.com/search.htm?se=${nom.trim().replace(/\s+/g, '+')}` :
      null;

    const hyperlienGoogleDefault = (nom) ? 
      `https://www.google.com/search?q=spectacle+${nom.trim().replace(/\s+/g, '+')}` :
      null;

    const note = getNoteFromAvis(row.Avis);

    const nouvelleActivite = {
        __uuid: genUUID(),
        Date: null, 
        Debut: row.Debut || null, 
        Duree: row.Duree || null,
        Activite: nom, 
        Style: row.Style || null,
        Lieu: row.Lieu || null, 
        Session: row.Session || null,
        Relache: row.Relache || null, 
        Orga: row.Orga || null,
        Reserve: null, 
        Marqueur: null, 
        Note: note,
        Hyperlien: row.Hyperlien || hyperlienDefault,
        HyperlienGoogle: row.HyperlienGoogle || hyperlienGoogleDefault,
        HyperlienBR: row.HyperlienBR || hyperlienBRDefault,
        Mood: row?.Mood ?? null,
        __distribution: row?.Distribution ?? null,

        Description: row?.Description ?? null,    // champ supprimé apres passage par enrichWithAbstractPremium
        Distribution: row?.Distribution ?? null,  // champ supprimé apres passage par enrichWithAbstractPremium
        Avis: row?.Avis ?? null,                  // champ supprimé apres passage par enrichWithAbstractPremium
        
      }
      nouvellesActivites.push(nouvelleActivite);
  }

  if (!nouvellesActivites || nouvellesActivites.length == 0) return;

  // Remplacement de Description, Distribution, Avis de nouvellesActivites avec __desc_summary, __avis_summary et Mood via worker AI
  await asyncCallAvecOverlayAttente(enrichWithAbstractPremium, { rows:nouvellesActivites, df: ctx.df }, 'Echec enrichissement résumé');

  // Insertion des nouvelles lignes ou pour les lignes existantes surcharge des colonnes du paramètre overloadCols de overloadRowsOrInsert
  if (mergeMode == 1) { 
    ctx.mutateDf(rows => { 
      const next = sortDf(overloadRowsOrInsert(rows, nouvellesActivites, ['Activite', 'Lieu'], ['Duree', '__desc_summary', '__avis_summary', 'Mood'])); 
      recalcFinForAll(next); 
      return next;
    });
  }
  // Insertion des nouvelles lignes ou pour les lignes existantes surcharge de toutes les colonnes sauf la colonne Marqueur (ou les colonnes données par le paramètre excludeCols)
  else {
    recalcFinForAll(nouvellesActivites);
    ctx.mutateDf(rows => sortDf(mergeRowsNoDupMultiKey(rows, nouvellesActivites, ['Activite', 'Lieu', 'Debut'])));
  }

  // Maj des sélections
  setTimeout(() => {
    scrollToExpander?.('exp-non-programmees');
    openExpander?.('exp-non-programmees');
    selectRowByUuid('grid-non-programmees', nouvellesActivites[0].__uuid, { ensure: 'center', flash: null });
    const nbInstances = nouvellesActivites.filter(r => r?.Activite === nouvellesActivites[0].Activite && r?.Lieu === nouvellesActivites[0].Lieu).length
    if (nbInstances > 1) setSortModel('grid-non-programmees', 'Activite', 'asc');
  }, 100);
  
}

