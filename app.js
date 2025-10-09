// app.js (module)
import { df_getAll, df_getAllOrdered, df_putMany, df_clear } from './db.mjs';

// ------- État global -------
let gridApi = null;
let gridOptions = null;

// ------- Colonnes -------
function buildColumns() {
  let width = window.matchMedia("(max-width: 750px)").matches ? 70 : 90;
  return [
    {
      field: 'Date',
      headerName: 'Date',
      width: width,
      suppressSizeToFit: true,
      // sort: 'asc',
      valueFormatter: p => dateintToPretty(p.value),
      valueParser: p => {
        // l’utilisateur saisit "dd[/mm][/yy]" -> on re-range un dateint
        const di = prettyToDateint(p.newValue);
        return di ?? p.oldValue ?? null;
      },
      comparator: (a, b) => (safeDateint(a)||0) - (safeDateint(b)||0),
    },
    { field: 'Début', 
      width: width,
      suppressSizeToFit: true,
      comparator: (a,b) => {
        const pa = /(\d{1,2})h(\d{2})/i.exec(String(a||'')); 
        const pb = /(\d{1,2})h(\d{2})/i.exec(String(b||'')); 
        const ma = pa ? (+pa[1])*60 + (+pa[2]) : 0;
        const mb = pb ? (+pb[1])*60 + (+pb[2]) : 0;
        return ma - mb;
      }
    },
    { field: 'Activité', minWidth: 200, flex: 1, cellRenderer: ActiviteRenderer },
    { field: 'Durée',   width: width, suppressSizeToFit: true },
    { field: 'Fin',   width: width, suppressSizeToFit: true },
    { field: 'Lieu', minWidth: 200,     flex: 1 },
    { field: 'Relâche', minWidth: 50,  flex: 0.5 },
    { field: 'Réservé', minWidth: 50,  flex: 0.5 },
    { field: 'Priorité', minWidth: 50, flex: 0.5 },
    { field: 'Hyperlien', minWidth: 100, flex: 2 }, 
  ];  
}

// ------- Helpers -------
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

function safeSizeToFit() {
  if (!gridApi) return;
  setTimeout(() => {
    try { gridApi.sizeColumnsToFit(); } catch {}
  }, 0);
}

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
async function refreshGrid() {
  const rows = await df_getAllOrdered();             // <- pas d’argument
  if (!gridApi) return;
  gridApi.setGridOption('rowData', rows || []);
  safeSizeToFit();
}

function createOrAttachGrid() {
  const eGrid = document.getElementById('grid');
  if (!eGrid) return;

  if (!gridOptions) {
    gridOptions = {
      columnDefs: buildColumns(),
      defaultColDef: { editable: true, resizable: true, sortable: true, filter: true },
      rowData: [],
      getRowId: p => p.data?.__uuid,          // clé stable
      onGridReady: async () => {
        await refreshGrid();
        safeSizeToFit();
      },
      getRowStyle: p => {
        const c = colorForDate(p.data?.Date);
        return c ? { '--day-bg': c } : null;     // on pousse la couleur en variable CSS
      },
    };
  }
  if (!gridApi) {
    // v31+
    gridApi = window.agGrid.createGrid(eGrid, gridOptions);
  }
}

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
function wireCustomExpander() {
  const exp = document.getElementById("gridExpander");
  const header = exp?.querySelector(".st-expander-header");
  const body   = exp?.querySelector(".st-expander-body");
  if (!exp || !header || !body) return;

  // Chevron: optionnel, juste pour l’animation
  // const chevron = header.querySelector(".chevron");

  const toggle = () => {
    const open = exp.classList.toggle("open");
    header.setAttribute("aria-expanded", String(open));
    if (open) {
      // première ouverture -> instancie la grille si besoin
      if (!window.gridApi) {
        createOrAttachGrid();
      }
      // ajuste la taille des colonnes
      safeSizeToFit();
    }
  };

  header.addEventListener("click", toggle);
  // (facultatif) prise en charge tactile
  header.addEventListener("touchstart", (e) => { e.preventDefault(); toggle(); }, {passive:false});

  // Poignée de redimensionnement
const handle = exp.querySelector(".expander-resizer");
if (handle) {
  let startY, startH, dragging = false;
  const gridEl = document.getElementById("grid");

  // Souris
  handle.addEventListener("mousedown", e => {
    dragging = true;
    startY = e.clientY;
    startH = gridEl.offsetHeight;
    document.body.style.userSelect = "none";
  });
  window.addEventListener("mousemove", e => {
    if (!dragging) return;
    const newH = Math.min(900, Math.max(240, startH + (e.clientY - startY)));
    gridEl.style.height = `${newH}px`;
    try { window.gridApi?.onGridSizeChanged?.(); } catch(_) {}
    try { window.gridApi?.sizeColumnsToFit?.(); } catch(_) {}
  });
  window.addEventListener("mouseup", () => {
    dragging = false;
    document.body.style.userSelect = "";
  });

  // Tactile (iOS/Android)
  handle.addEventListener("touchstart", e => {
    const t = e.touches[0];
    dragging = true;
    startY = t.clientY;
    startH = gridEl.offsetHeight;
    document.body.style.userSelect = "none";
  }, { passive: true });

  window.addEventListener("touchmove", e => {
    if (!dragging) return;
    const t = e.touches[0];
    const newH = Math.min(900, Math.max(240, startH + (t.clientY - startY)));
    gridEl.style.height = `${newH}px`;
    try { window.gridApi?.onGridSizeChanged?.(); } catch(_) {}
    try { window.gridApi?.sizeColumnsToFit?.(); } catch(_) {}
  }, { passive: true });

  window.addEventListener("touchend", () => {
    dragging = false;
    document.body.style.userSelect = "";
  });
}

  // Ouvre par défaut au démarrage
  exp.classList.add("open");
  createOrAttachGrid();
  safeSizeToFit();
}

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
async function doReload() {
  await refreshGrid();
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
const $ = id => document.getElementById(id);

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

      // 4) normalisation colonnes + __uuid + Date->dateint + tri date/debut
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
        const m = /(\d{1,2})h(\d{2})/i.exec(String(o['Début'] ?? o['Debut'] ?? ''));
        const mins = m ? (parseInt(m[1],10)||0)*60 + (parseInt(m[2],10)||0) : 0;

        // __uuid garanti
        if (!o.__uuid) {
          o.__uuid = (crypto.randomUUID?.()) || `${Date.now()}_${i}`;
        }
        return o;
      });

      await df_clear();
      await df_putMany(rows);

      await refreshGrid();
      console.log('✅ Import OK', rows.length, 'lignes');
    } catch (e) {
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
    toggle.style.bottom = bar.classList.contains('hidden')
      ? '0'
      : `${barHeight}px`;
  };

  toggle.addEventListener('click', () => {
    const hidden = bar.classList.toggle('hidden');
    toggle.classList.toggle('rotated', hidden);
    updateTogglePos();
    setTimeout(syncBottomBarTogglePosition, 180);
  });

  updateTogglePos();
  window.addEventListener('resize', updateTogglePos);
}

// ---------- iOS fix: lock scroll horizontal sur la bottom bar ----------
function lockHorizontalScroll() {
  const scroller = document.querySelector('.bottom-bar__scroller');
  if (!scroller) return;

  let startX = 0, startY = 0, startLeft = 0, lock = null;

  scroller.addEventListener('touchstart', (e) => {
    const t = e.touches[0];
    startX = t.clientX;
    startY = t.clientY;
    startLeft = scroller.scrollLeft;
    lock = null; // indéterminé au départ
  }, { passive: true });

  scroller.addEventListener('touchmove', (e) => {
    const t = e.touches[0];
    const dx = t.clientX - startX;
    const dy = t.clientY - startY;

    if (lock === null) lock = (Math.abs(dx) > Math.abs(dy)) ? 'x' : 'y';

    if (lock === 'x') {
      scroller.scrollLeft = startLeft - dx;
      e.preventDefault(); // bloque le scroll vertical de la page
    }
  }, { passive: false });
}

function isStandaloneIOS(){
  const ua = navigator.userAgent || "";
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
  return isIOS && standalone;
}

// function syncSafeLayout(){
//   // robust dvh (avoid iOS address-bar jumps)
//   const dvh = window.visualViewport ? window.visualViewport.height : window.innerHeight;
//   document.documentElement.style.setProperty('--dvh', dvh + 'px');

//   // place toggle right above the bar (bar height + safe-bottom)
//   const bar = document.querySelector('.bottom-bar');
//   const tog = document.querySelector('.bottom-toggle');
//   if (bar && tog){
//     const h = Math.round(bar.getBoundingClientRect().height); // includes padding-bottom safe area
//     tog.style.bottom = `calc(env(safe-area-inset-bottom, 0px) + ${h}px)`;
//   }

//   // give the page enough bottom padding so content never hides under the bar
//   if (bar){
//     const h = Math.round(bar.getBoundingClientRect().height);
//     document.body.style.paddingBottom = `calc(env(safe-area-inset-bottom, 0px) + ${h}px)`;
//   }
// }

// function initSafeAreaWatch(){
//   // recalc on resize, orientation, keyboard pop, etc.
//   window.addEventListener('resize', syncSafeLayout);
//   if (window.visualViewport){
//     window.visualViewport.addEventListener('resize', syncSafeLayout);
//   }
//   // observe bottom bar height changes (collapsed/expanded)
//   const bar = document.querySelector('.bottom-bar');
//   if (bar){
//     new ResizeObserver(syncSafeLayout).observe(bar);
//   }
//   // first paint (2 RAFs helps on iOS)
//   requestAnimationFrame(()=>requestAnimationFrame(syncSafeLayout));
// }

// function getSafeBottom() {
//   // iOS notch etc.
//   return 'env(safe-area-inset-bottom, 0px)';
// }

// function syncBottomBarTogglePosition() {
//   const bar = document.querySelector('.bottom-bar');
//   const tog = document.querySelector('.bottom-toggle');
//   if (!bar || !tog) return;

//   // Mesurer la hauteur réellement rendue
//   const h = Math.max(0, Math.round(bar.getBoundingClientRect().height));

//   // Place la languette juste au-dessus de la barre, en tenant compte du safe-area
//   tog.style.bottom = `calc(${getSafeBottom()} + ${h}px)`;
// }

// /* Recalcule après :
//    - chargement,
//    - redimensionnement/orientation,
//    - changements de taille de la barre (ouverture/fermeture, contenu qui wrap).
// */
// function initBottomBarAutoLayout() {
//   const bar = document.querySelector('.bottom-bar');
//   if (!bar) return;

//   // Observe les changements de taille de la barre
//   const ro = new ResizeObserver(() => syncBottomBarTogglePosition());
//   ro.observe(bar);

//   // Orientation / clavier mobile / viewport iOS
//   window.addEventListener('resize', syncBottomBarTogglePosition);
//   if (window.visualViewport) {
//     window.visualViewport.addEventListener('resize', syncBottomBarTogglePosition);
//   }

//   // Premier sync après stabilisation du layout
//   requestAnimationFrame(() => {
//     requestAnimationFrame(syncBottomBarTogglePosition);
//   });
// }

function hardPinBottom() {
  const bar = document.querySelector('.bottom-bar');
  if (!bar) return;

  const vv = window.visualViewport;
  let gap = 0;

  if (vv) {
    gap = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
  }

  bar.style.bottom = gap + 'px';
}

// --- initialisation robuste ---
function initSafeAreaWatch() {
  // Premier calage rapide
  hardPinBottom();

  // Recalage après stabilisation du viewport (iOS au lancement)
  setTimeout(hardPinBottom, 450);

  // Recalage à chaque rotation ou resize viewport
  const vv = window.visualViewport;
  if (vv) {
    vv.addEventListener('resize', hardPinBottom);
    vv.addEventListener('scroll', hardPinBottom);
  }

  window.addEventListener('orientationchange', () =>
    setTimeout(hardPinBottom, 400)
  );

  // Recalage après retour d’arrière-plan (quand la PWA revient active)
  window.addEventListener('pageshow', () =>
    setTimeout(hardPinBottom, 200)
  );
}

// ------- Boot -------
document.addEventListener('DOMContentLoaded', () => {
  wireCustomExpander();
  wireBottomBar();
  wireHiddenFileInput();
  wireBottomBarToggle();
  lockHorizontalScroll();
  initSafeAreaWatch();
  // initBottomBarAutoLayout();   
  // setTimeout(syncBottomBarTogglePosition, 1000);
  // setTimeout(syncSafeLayout, 1000); 
  // setTimeout(document.getElementById('toggleBar').click(), 500);
  // setTimeout(document.getElementById('toggleBar').click(), 1500);
});
