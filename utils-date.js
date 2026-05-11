// ===============================
// Utilitaires dayes
// ===============================

import { 
  richValueSet,
  richValueGetValue, 
  richValueGetQuality,
} from './utils.js';

// Bornes "intra-jour" (minutes depuis minuit)
export const MIN_DAY = 0;                 // 00:00
export const MAX_DAY = 23 * 60 + 59;      // 23:59

// Vérifie si val est un entier ressemblant à yyyymmdd
export function isDateint(val) {
  // ✅ 1) Vérifie que c’est un entier à 8 chiffres
  const n = Number(val);
  if (!Number.isInteger(n) || n < 10000101 || n > 99991231) return false;

  // ✅ 2) Décompose en y/m/d
  const y = Math.floor(n / 10000);
  const m = Math.floor((n % 10000) / 100);
  const d = n % 100;

  // ✅ 3) Vérifie bornes simples
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;

  // ✅ 4) Vérifie cohérence réelle via Date
  const dt = new Date(y, m - 1, d);
  return (
    dt.getFullYear() === y &&
    dt.getMonth() === m - 1 &&
    dt.getDate() === d
  );
}

// Renvoie true sur une date de weekend
export function isWeekendDateInt(di) {
  const y = (di / 10000) | 0;
  const m = ((di / 100) | 0) % 100 - 1;
  const d = di % 100;

  const day = new Date(y, m, d).getDay();
  return day === 0 || day === 6;
}

// yyyymmdd -> {y,m,d}
export function dateintToYmd(di) {
  const y = Math.floor(di / 10000);
  const m = Math.floor((di % 10000) / 100);
  const d = di % 100;
  return { y, m, d };
}

export function pad2(n){ n = parseInt(n ?? 0, 10); return (n<10?'0':'') + n; }

// Parse "HH:MM" ou "HHhMM" ou "HHMM" en minutes depuis minuit (number) ou null si invalide
export function parseHHMM(s) {
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

// minutes -> "HHhMM"
export function mmToHHhMM(mins) {
  const m = Math.max(0, Number(mins) || 0);
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${h}h${pad2(mm)}`;
}

// "HHhMM" -> minutes (accepte aussi HH:MM)
export function mmFromHHhMM(hm) {
  if (!hm) return null;
  const s = String(hm).trim().toLowerCase();

  // format "10h00"
  let m = /^(\d{1,2})h(\d{2})$/.exec(s);

  // format "10:00"
  if (!m) m = /^(\d{1,2}):(\d{2})$/.exec(s);

  if (!m) return null;

  const h = Number(m[1]);
  const min = Number(m[2]);
  if (isNaN(h) || isNaN(min)) return null;

  return h * 60 + min;
}

// minutes -> "HhMM"
export function mmToHhmm(total) {
  const t = Math.max(0, Number(total) || 0);
  const h = Math.floor(t / 60), mm = t % 60;
  return `${h}h${pad2(mm)}`;
}

// "HhMM" -> minutes (ex: "1h20" => 80)
export function mmFromHhMM(s) {
  if (!s) return null;
  const m = String(s).match(/^\s*(\d{1,2})h(\d{2})\s*$/i);
  if (!m) return null;
  const H = +m[1], M = +m[2];
  return H * 60 + M;
}

// minutes -> {h, m}
export function mmToHM(totalMin) {
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return { h, m };
}

// Récupère à la volée les minutes depuis minuit pour une activité
export function heureMinute(row) {
  // if (Number.isFinite(row?.Debut_dt)) return row.Debut_dt;
  if (row?.['Début']) return mmFromHHhMM(row['Début']);
  if (row?.['Debut']) return mmFromHHhMM(row['Debut']);
  return null;
}
export function dureeMinute(row) {
  // if (Number.isFinite(row?.Duree_dt)) return row.Duree_dt;
  if (row?.['Durée']) return mmFromHhMM(row['Durée']);
  if (row?.['Duree']) return mmFromHhMM(row['Duree']);
  return null;
}

// Permet de faire des comparaisons "inter-jours"
export function absMinute(dateint, minutesSinceMidnight) {
  return (Number(dateint) || 0) * 1440 + (Number(minutesSinceMidnight) || 0);
}

// Petit util générique
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// Parse “pretty” utilisateur vers dateint (dd[/mm][/yy])
export function prettyToDateint(value) {
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
export function dateintToPretty(di) {
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

export const dateintStrToPretty = (d) => dateintToPretty(Number(d)); 

export function ymdToDateint({ y, m, d }) { return y*10000 + m*100 + d; }

export function safeDateint(v) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 10000101 ? n : null;
}

export function dateintToDate(di) {
  const n = Number(di);
  if (!Number.isFinite(n) || n < 10000101) return null;
  const y = Math.floor(n / 10000);
  const m = Math.floor((n % 10000) / 100);
  const d = n % 100;
  const dt = new Date(Date.UTC(y, m - 1, d));
  // garde en local time si tu préfères : new Date(y, m-1, d)
  return dt;
}

export function dateintToDateLongFR(di) {
  return new Intl.DateTimeFormat("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric"
  }).format(dateintToDate(di));
}

// parse "20250712" ou "12/07[/2025]" -> 20250712
export function toDateint(v) {
  if (v == null) return null;
  if (typeof v === 'number') return v;
  const s = String(v).trim();
  if (/^\d{8}$/.test(s)) return parseInt(s, 10);
  return prettyToDateint(s);
}

export const parseHHhMM = (s) => {
  const m = /(\d{1,2})h(\d{2})/i.exec(String(s ?? ''));
  if (!m) return null;
  const hh = +m[1], mm = +m[2];
  if (Number.isNaN(hh) || Number.isNaN(mm) || hh>=24 || mm>=60) return null;
  return hh*60 + mm;
};


// "Durée : 1h30" | "Durée : 55 min" → "1h30" | "0h55"
export function parseDurationToHhmm(txt) {
  if (!txt) return null;
  const s = txt.replace(/\s+/g, ' ').trim().toLowerCase();

  // 1h / 1h30 / 01h05
  let m = s.match(/(\d{1,2})\s*h(?:\s*([0-5]?\d))?/);
  if (m) {
    const h = Number(m[1]) || 0;
    const mm = m[2] ? Number(m[2]) : 0;
    return `${h}h${pad2(mm)}`;
  }
  // 55 min / 90min
  m = s.match(/(\d{1,3})\s*m(?:in)?s?/);
  if (m) {
    const total = Math.max(0, Number(m[1]) || 0);
    const h = Math.floor(total / 60), mm = total % 60;
    return `${h}h${pad2(mm)}`;
  }
  return null;
}

// Excel (Windows) : 1899-12-30 base
export function excelSerialToYMD(serial) {
  if (typeof serial !== 'number' || !isFinite(serial)) return null;
  const ms = (serial - 0) * 86400000; // jours -> ms
  const base = Date.UTC(1899, 11, 30); // 1899-12-30
  const d = new Date(base + ms);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
}

// Compare deux string de type HHhmm (13h20) en minutes pour les comparer
export function compareHM(a, b) {
  // "13h20" -> minutes
  const m = s => {
    const m = /(\d{1,2})h(\d{2})/i.exec(String(s||''));
    return m ? (+m[1])*60 + (+m[2]) : 0;
  };
  return m(a) - m(b);
}

/** Convertit y,m,d en entier AAAAMMJJ */
export function dateToInt(y, m, d) {
  return y * 10000 + m * 100 + d;
}

/** Convertit toute valeur "date-like" en AAAAMMJJ (ou null) */
export function dateToDateint(x, defaultYear, defaultMonth) {
  const today = new Date();
  const defY = defaultYear ?? today.getFullYear();
  const defM = defaultMonth ?? today.getMonth() + 1;

  if (x == null || (typeof x === 'number' && isNaN(x))) return null;

  // déjà entier AAAAMMJJ ?
  try {
    const n = parseInt(x, 10);
    if (n >= 1e7 && n <= 99991231) return n;
  } catch {}

  // objets Date ou date-like
  if (x && typeof x === 'object' && 'getFullYear' in x)
    return dateToInt(x.getFullYear(), x.getMonth() + 1, x.getDate());
  if (x && typeof x.year === 'number')
    return dateToInt(x.year, x.month, x.day);

  // Excel serial (base 1899-12-30)
  if (typeof x === 'number' && x > 59 && x < 600000) {
    const base = new Date(1899, 11, 30);
    const dte = new Date(base.getTime() + x * 86400000);
    return dateToInt(dte.getFullYear(), dte.getMonth() + 1, dte.getDate());
  }

  const s = String(x).trim();
  if (!s) return null;

  // jour simple 1..31
  if (/^\d+$/.test(s)) {
    const n = parseInt(s, 10);
    if (n >= 1 && n <= 31) return dateToInt(defY, defM, n);
  }

  // formats dd/mm[/yy[yy]]
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?$/);
  if (m) {
    let [_, dStr, moStr, yStr] = m;
    let d = parseInt(dStr, 10);
    let mo = parseInt(moStr, 10);
    let y = yStr ? parseInt(yStr, 10) : defY;
    if (y < 100) y += (y >= 70 ? 1900 : 2000);
    const dte = new Date(y, mo - 1, d);
    // @ts-ignore
    if (!isNaN(dte)) return dateToInt(y, mo, d);
  }

  // parsing souple
  try {
    const parsed = new Date(Date.parse(s));
    // @ts-ignore
    if (!isNaN(parsed))
      return dateToInt(parsed.getFullYear(), parsed.getMonth() + 1, parsed.getDate());
  } catch {}

  return null;
}

// Dateint (YYYYMMDD) -> 'YYYY-MM-DD' 
export function dateintToIso(dint){ 
  if (!dint) return '';
  const s = String(dint);
  if (s.length !== 8) return '';
  return `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`;
}

// 'YYYY-MM-DD' -> Dateint (YYYYMMDD) 
export function isoToDateint(iso){  
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return null;
  return Number(`${m[1]}${m[2]}${m[3]}`);
}

// Durées: minutes -> "HhMM" 
export function minutesToPretty(min){
  min = Math.max(0, Number(min||0)|0);
  const h = Math.floor(min/60), m = min%60;
  return `${h}h${String(m).padStart(2,'0')}`;
}

// Durées: minutes <- "HhMM" 
export function prettyToMinutes(s){
  if (!s) return 0;
  const m = /^(\d{1,2})h(\d{2})$/.exec(String(s).trim());
  if (!m) return 0;
  return (Number(m[1])|0)*60 + (Number(m[2])|0);
}

// Date → "YYYY-MM-DD"  (toujours le jour local, sans décalage UTC)
export function localDateToIsoDate(d) {
  if (!(d instanceof Date)) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Objet Date en LOCAL (00:00 locale)
export function isoDateToLocalDate(s) {
  if (!s) return null;
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

// Timestamp UTC (ms) à minuit UTC
export function isoDateToUtcMs(s) {
  if (!s) return null;
  const [y, m, d] = s.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

/**
 * Recalcule la colonne Fin d'une activité en fonction des colonnes Debut et Duree
 * @param {*} row 
 * @returns 
 */
export function recalcFin(row) {
  if (!row?.Debut || !row?.Duree) return null;

  const [h1, m1] = row.Debut.split("h").map(Number);
  const [h2, m2] = richValueGetValue(row.Duree).split("h").map(Number);

  const total = h1 * 60 + m1 + h2 * 60 + m2;
  const hh = Math.floor((total / 60) % 24);
  const mm = total % 60;

  return richValueSet(`${String(hh).padStart(2, "0")}h${String(mm).padStart(2, "0")}`, richValueGetQuality(row.Duree));
}

/**
 * Recalcule la colonne Fin d'un tableau d'activités en fonction des colonnes Debut et Duree
 * @param {*} rows 
 * @returns 
 */
export function recalcFinForAll(rows) {
  for (const r of rows) {
    r.Fin = recalcFin(r);
  }
  return rows;
}