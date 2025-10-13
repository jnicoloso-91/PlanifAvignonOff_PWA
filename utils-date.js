// utils-date.js — helpers communs "date/heure" pour app.js et activites.js

// Bornes "intra-jour" (minutes depuis minuit)
export const MIN_DAY = 0;                 // 00:00
export const MAX_DAY = 23 * 60 + 59;      // 23:59

// Petite marge (métier) — ajuste si besoin
export const MARGE = 30;                   // en minutes

// yyyymmdd -> {y,m,d}
export function dateintToYmd(di) {
  const y = Math.floor(di / 10000);
  const m = Math.floor((di % 10000) / 100);
  const d = di % 100;
  return { y, m, d };
}

// "HHhMM" -> minutes (ex: "09h30" => 570)
export function hmStrToMinutes(hm) {
  if (!hm) return null;
  const m = String(hm).match(/^\s*(\d{1,2})h(\d{2})\s*$/i);
  if (!m) return null;
  const H = +m[1], M = +m[2];
  if (H < 0 || H > 23 || M < 0 || M > 59) return null;
  return H * 60 + M;
}

// "XhYY" -> minutes (ex: "1h20" => 80)
export function durationStrToMinutes(s) {
  if (!s) return null;
  const m = String(s).match(/^\s*(\d{1,2})h(\d{2})\s*$/i);
  if (!m) return null;
  const H = +m[1], M = +m[2];
  return H * 60 + M;
}

// minutes -> "HHhMM"
export function mmToStr(m) {
  const mm = Math.max(0, Math.min(MAX_DAY, Math.floor(m ?? 0)));
  const hh = Math.floor(mm / 60);
  const mi = mm % 60;
  return `${String(hh).padStart(2, '0')}h${String(mi).padStart(2, '0')}`;
}

// Récupère à la volée les minutes depuis minuit pour une ligne
// Priorité aux champs numériques *_dt si présents, sinon parse les chaînes "Début"/"Durée"
export function debutMin(row) {
  if (Number.isFinite(row?.Debut_dt)) return row.Debut_dt;
  if (row?.['Début']) return hmStrToMinutes(row['Début']);
  if (row?.['Debut']) return hmStrToMinutes(row['Debut']);
  return null;
}
export function dureeMin(row) {
  if (Number.isFinite(row?.Duree_dt)) return row.Duree_dt;
  if (row?.['Durée']) return durationStrToMinutes(row['Durée']);
  if (row?.['Duree']) return durationStrToMinutes(row['Duree']);
  return null;
}

// Utile si un jour tu fais des comparaisons "inter-jours"
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

// parse "20250712" ou "12/07[/2025]" -> 20250712
export function toDateint(v) {
  if (v == null) return null;
  if (typeof v === 'number') return v;
  const s = String(v).trim();
  if (/^\d{8}$/.test(s)) return parseInt(s, 10);
  // si tu as déjà prettyToDateint, utilise-la :
  if (typeof window.prettyToDateint === 'function') return window.prettyToDateint(s);
  // fallback "jj/mm[/aa|aaaa]"
  const p = s.split(/[\/.-]/).map(x => x.trim());
  if (!p.length) return null;
  const d = +p[0], m = +(p[1] || (new Date().getMonth()+1));
  let y = +(p[2] || new Date().getFullYear());
  if (y < 100) y += 2000;
  if (!d || !m || !y) return null;
  return y*10000 + m*100 + d;
}

export const parseHHhMM = (s) => {
  const m = /(\d{1,2})h(\d{2})/i.exec(String(s ?? ''));
  if (!m) return null;
  const hh = +m[1], mm = +m[2];
  if (Number.isNaN(hh) || Number.isNaN(mm) || hh>=24 || mm>=60) return null;
  return hh*60 + mm;
};

// Excel (Windows) : 1899-12-30 base
export function excelSerialToYMD(serial) {
  if (typeof serial !== 'number' || !isFinite(serial)) return null;
  const ms = (serial - 0) * 86400000; // jours -> ms
  const base = Date.UTC(1899, 11, 30); // 1899-12-30
  const d = new Date(base + ms);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
}


