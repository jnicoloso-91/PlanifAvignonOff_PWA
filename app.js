// app.js (module)
import { df_getAll, df_putMany, df_clear } from './db.mjs';

// ------- État global -------
let gridApi = null;
let gridOptions = null;

// ------- Colonnes -------
function buildColumns() {
  return [
    {
      field: 'Date',
        headerName: 'Date',
        width: 60,
        suppressSizeToFit: true,
        sort: 'asc',
        comparator: (a,b) => (a??0) - (b??0), // tri numérique sur int
        valueFormatter: p => intToPretty(p.value),       // int -> pretty
        valueParser:   p => parseDateToInt(p.newValue),  // saisie -> int
    },
    { field: 'Début',   width: 60, suppressSizeToFit: true },
    { field: 'Durée',   width: 60, suppressSizeToFit: true },
    { field: 'Fin',   width: 60, suppressSizeToFit: true },
    { field: 'Activité', minWidth: 200, flex: 1, cellRenderer: ActiviteRenderer },
    { field: 'Lieu', minWidth: 200,     flex: 1 },
    { field: 'Relâche', minWidth: 50,  flex: 0.5 },
    { field: 'Réservé', minWidth: 50,  flex: 0.5 },
    { field: 'Priorité', minWidth: 50, flex: 0.5 },
    { field: 'Hyperlien', minWidth: 100, flex: 1 }, // utile en debug; tu peux la masquer si tu veux
  ];  
}

// ------- Helpers -------
// Palette pastel (ajuste si tu veux)
const DAY_COLORS = [
  '#fdf6e3', '#e8f4ff', '#eef6ff', '#f3f7e7', '#fbefff',
  '#eaf7f3', '#fff4ea', '#f2f2ff'
];

function colorForDate(dateInt) {
  if (dateInt == null || Number.isNaN(dateInt)) return null;
  const i = Math.abs(Number(dateInt)) % DAY_COLORS.length;
  return DAY_COLORS[i];
}

function pad2(n){ return String(n).padStart(2,'0'); }

function parseDateToInt(val, {defaultYear=null, defaultMonth=null} = {}) {
  if (val == null) return null;
  const s = String(val).trim();
  if (!s) return null;

  // yyyymmdd
  if (/^\d{8}$/.test(s)) {
    const y = +s.slice(0,4), m = +s.slice(4,6), d = +s.slice(6,8);
    return (m>=1&&m<=12&&d>=1&&d<=31) ? y*10000+m*100+d : null;
  }
  // dd
  if (/^\d{1,2}$/.test(s)) {
    const base = new Date();
    const y = defaultYear ?? base.getFullYear();
    const m = defaultMonth ?? (base.getMonth()+1);
    const d = +s;
    return (d>=1&&d<=31) ? y*10000+m*100+d : null;
  }
  // dd/mm(/yy|yyyy)
  const m1 = s.match(/^(\d{1,2})\s*\/\s*(\d{1,2})(?:\s*\/\s*(\d{2,4}))?$/);
  if (m1) {
    const d = +m1[1], m = +m1[2];
    let y = m1[3] != null ? +m1[3] : (defaultYear ?? new Date().getFullYear());
    if (y < 100) y = 2000 + y;
    return (m>=1&&m<=12&&d>=1&&d<=31) ? y*10000+m*100+d : null;
  }
  // nombre → tente int 8 chiffres
  const n = Number(s);
  if (Number.isFinite(n)) {
    const i = Math.trunc(n);
    if (/^\d{8}$/.test(String(i))) {
      const y = Math.trunc(i/10000), m = Math.trunc((i/100)%100), d = i%100;
      return (m>=1&&m<=12&&d>=1&&d<=31) ? i : null;
    }
  }
  return null;
}

function intToPretty(di) {
  if (!Number.isInteger(di)) return '';
  const y = Math.trunc(di/10000), m = Math.trunc((di/100)%100), d = di%100;
  const now = new Date();
  return (y === now.getFullYear())
    ? `${pad2(d)}/${pad2(m)}`
    : `${pad2(d)}/${pad2(m)}/${y}`;
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
  const rows = await df_getAll();             // <- pas d’argument
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
      defaultColDef: { resizable: true, sortable: true, filter: true },
      rowData: [],
      getRowId: p => p.data?.__uuid,          // clé stable
      onGridReady: async () => {
        await refreshGrid();
        params.api.sizeColumnsToFit();
        // safeSizeToFit();
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
// function activityCellRenderer(params) {
//   const e = document.createElement('div');
//   e.style.display = 'flex';
//   e.style.alignItems = 'center';
//   e.style.gap = '0.35rem';
//   e.style.width = '100%';
//   e.style.overflow = 'hidden';

//   const label = params.value != null ? String(params.value) : '';
//   const href  = (params.data && params.data.Hyperlien) 
//               ? String(params.data.Hyperlien).trim()
//               : `https://www.festivaloffavignon.com/resultats-recherche?recherche=${encodeURIComponent(label)}`;

//   const txt = document.createElement('span');
//   txt.textContent = label;
//   txt.style.flex = '1 1 auto';
//   txt.style.overflow = 'hidden';
//   txt.style.textOverflow = 'ellipsis';
//   txt.style.cursor = 'pointer';
//   e.appendChild(txt);

//   // --- helper: click synthétique pour la sélection AG Grid correcte ---
//   function tapSelectViaSyntheticClick(el) {
//     const cell = el.closest?.('.ag-cell');
//     if (!cell) return;
//     try {
//       cell.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
//       cell.dispatchEvent(new MouseEvent('mouseup',   { bubbles: true }));
//       cell.dispatchEvent(new MouseEvent('click',     { bubbles: true }));
//     } catch (_) {}
//   }

//   // --- Long-press minimal cross-platform ---
//   (function attachLongPress(el, url) {
//     let t0 = 0, pressed = false, moved = false, timer = null;
//     const DELAY = 550, THRESH = 8;

//     function clearT(){ if (timer){ clearTimeout(timer); timer = null; } }

//     function onDown(ev){
//       const p = ev.touches ? ev.touches[0] : ev;
//       pressed = true; moved = false;
//       const sx = p.clientX, sy = p.clientY;
//       clearT();
//       timer = setTimeout(() => {
//         if (pressed && !moved) {
//           openNewTab(url);
//           pressed = false;
//         }
//       }, DELAY);

//       function onMove(ev2){
//         const q = ev2.touches ? ev2.touches[0] : ev2;
//         if (!q) return;
//         if (Math.abs(q.clientX - sx) > THRESH || Math.abs(q.clientY - sy) > THRESH) {
//           moved = true; clearT();
//         }
//       }
//       function onUp(){
//         pressed = false; clearT();
//         el.removeEventListener('mousemove', onMove, true);
//         el.removeEventListener('mouseup', onUp, true);
//         el.removeEventListener('touchmove', onMove, true);
//         el.removeEventListener('touchend', onUp, true);
//       }

//       el.addEventListener('mousemove', onMove, true);
//       el.addEventListener('mouseup', onUp, true);
//       el.addEventListener('touchmove', onMove, true);
//       el.addEventListener('touchend', onUp, true);
//     }

//     function openNewTab(u){
//       if (!u) return;
//       // essai ancre (meilleur pour iOS)
//       try {
//         const a = document.createElement('a');
//         a.href = u; a.target = '_blank'; a.rel = 'noopener';
//         a.style.position = 'absolute'; a.style.left = '-9999px';
//         document.body.appendChild(a); a.click(); a.remove(); return;
//       } catch(_) {}
//       // fallback
//       try { window.open(u, '_blank', 'noopener'); } catch(_) {
//         try { window.location.assign(u); } catch(_){}
//       }
//     }

//     el.addEventListener('mousedown', onDown, true);
//     el.addEventListener('touchstart', onDown, true);
//     el.addEventListener('contextmenu', (e)=>e.preventDefault(), true);

//     // tap court = sélection de la cellule (pas d’ouverture)
//     el.addEventListener('click', (e)=>{ tapSelectViaSyntheticClick(el); }, true);
//   })(txt, href);

//   return e;
// }
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
function wireExpander() {
  const det = document.getElementById('gridExpander');
  if (!det) return;
  det.addEventListener('toggle', () => {
    if (det.open) {
      // ouvrir → (re)monter la grille et recalculer les tailles
      createOrAttachGrid();
      safeSizeToFit();
    }
  });
}

// ------- Boutons -------
function wireButtons() {
  const $ = id => document.getElementById(id);

  // Import Excel
  const btnImport = $('btnImport');
  const fileInput = $('fileInput');
  if (btnImport && fileInput) {
    btnImport.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async (ev) => {
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

        // 4) __uuid garanti + (optionnel) Date → dateint, etc.
        rows = rows.map((r, i) => {
          const o = { ...r };
          if (!o.__uuid) {
            o.__uuid = (crypto.randomUUID?.()) || `${Date.now()}_${i}`;
          }
          return o;
        });

        // 5) à toi d’éventuellement convertir o.Date en dateint ici

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

  // Export Excel
  const btnExport = $('btnExport');
  if (btnExport) {
    btnExport.addEventListener('click', async () => {
      try {
        const rows = await df_getAll();
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.json_to_sheet(rows || []);

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
    });
  }


  // Recharger
  const btnReload = $('btnReload');
  if (btnReload) {
    btnReload.addEventListener('click', async () => {
      await refreshGrid();
    });
  }

  // Seed (avec __uuid)
  const btnSeed = $('btnSeed');
  if (btnSeed) {
    btnSeed.addEventListener('click', async () => {
      const sample = [
        { __uuid: crypto.randomUUID?.() || `${Date.now()}-a`,
          Date: 20250721, Début:'13h20', Durée:'1h20', Activité:"Activité 1", Lieu:"Roi René", Relâche:"", Réservé:"", Priorité:"" },
        { __uuid: crypto.randomUUID?.() || `${Date.now()}-b`,
          Date: 20250722, Début:'15h00', Durée:'1h10', Activité:"Activité 2", Lieu:"La Scala", Relâche:"", Réservé:"", Priorité:""  },
      ];
      await df_putMany(sample);
      await refreshGrid();
    });
  }

  // Test Python (Pyodide)
  const btnPy = $('btnPy');
  if (btnPy) {
    btnPy.addEventListener('click', onPythonTest);
  }
}

// ------- Pyodide (POC) -------
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

async function onPythonTest() {
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
  }

  // Ouvre par défaut au démarrage
  exp.classList.add("open");
  createOrAttachGrid();
  safeSizeToFit();
}

// ------- Boot -------
document.addEventListener('DOMContentLoaded', () => {
  wireButtons();
  wireCustomExpander();
  // ⛔️ à supprimer : ce bloc ne vaut que pour <details>
  // const det = document.getElementById('gridExpander');
  // if (det && det.open) { createOrAttachGrid(); }
});
