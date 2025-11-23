// Crée une mini-console dans la page pour afficher les logs sur iPhone
export function logToPage(...args) {
  let el = document.getElementById('debug-console');
  if (!el) {
    el = document.createElement('pre');
    el.id = 'debug-console';
    el.style.position = 'fixed';
    el.style.bottom = '0';
    el.style.left = '0';
    el.style.width = '100%';
    el.style.maxHeight = '40vh';
    el.style.overflowY = 'auto';
    el.style.background = 'rgba(0,0,0,0.75)';
    el.style.color = '#0f0';
    el.style.fontSize = '11px';
    el.style.fontFamily = 'monospace';
    el.style.padding = '4px 6px';
    el.style.zIndex = '9999';
    el.style.whiteSpace = 'pre-wrap';
    el.style.pointerEvents = 'none';
    document.body.appendChild(el);
  }
  el.textContent += args.map(a => 
    typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)
  ).join(' ') + '\n';
}

// Ouvre une URL
export function openUrl(u, IosPwaMode=true){
  if (!u) return;
  const url = /^https?:\/\//i.test(u) ? u : ('https://' + u);

  if (IosPwaMode) {
    // Vérifie si on est dans une PWA iOS
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
      || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const isStandalone = window.navigator.standalone === true
      || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);

    // Cas iOS PWA → créer un lien temporaire pour forcer Safari
    if (isIOS && isStandalone) {
      // logToPage('Début openUrl en mode PWA')
      const a = document.createElement('a');
      a.href = url;
      a.target = '_blank';
      a.rel = 'noopener,noreferrer';
      // important : il faut un geste utilisateur pour que le click() fonctionne
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      // logToPage('Fin openUrl en mode PWA')
      return;
    }
  }

  // Desktop / Android (ou fallback iOS)
  // logToPage('Début openUrl en mode Standard');
  const domain = new URL(url).hostname.replace(/\W+/g, '_');
  const windowName = `avignon_${domain}`;
  try { window.open(url, windowName, 'noopener'); } 
  catch(_) { window.location.assign(url); }
  // logToPage(`Fin openUrl en mode Standard sur ${windowName}`);
}

// Est-ce qu'une string ressemble à une URL
export function looksLikeUrl(text) {
  if (!text) return false;
  const re = /^(https?:\/\/)?([\w-]+\.)+[\w-]+(\/[\w\-._~:/?#[\]@!$&'()*+,;=%]*)?$/i;
  return re.test(text.trim());
}

// Merge deux tableaux sans duplication.
// col donne la colonne à tester.
// Si deux lignes ont la même valeur sur la colonne donnée par col la première est gardée.
export function mergeRowsNoDup(arr1, arr2, col) {
  const map = new Map();
  for (const r of [...arr1, ...arr2]) {
    const key = String(r[col] || '').trim().toLowerCase();
    if (!map.has(key)) map.set(key, r);
  }
  return Array.from(map.values());
}

/**
 * Merge deux tableaux sans duplication.
 * Si deux lignes ont la même valeur sur les colonnes données par keyCols 
 * les valeurs de arr1 sont appliquées sur les colonnes données overloadCols 
 * ou sur toutes les colonnes si overloadCols est null.
 * @param {*} arr1 
 * @param {*} arr2 
 * @param {*} keyCols       colonnes à tester pour considérer qu'il y a doublon.
 * @param {*} overloadCols  colonnes à surcharger en cas de doublon.
 * @param {*} normalizer    fonction de normalisation des valeurs à comparer.
 * 
 * @returns 
 */
export function mergeRowsNoDupMultiKey(arr1, arr2, keyCols, overloadCols, normalizer) {
  const map = new Map();
  // On conserve l’ordre d’arrivée : d’abord arr1, puis arr2
  for (const r of arr1) {
    const k = _buildKey(r, keyCols, normalizer);
    if (!map.has(k)) map.set(k, r);
  }
  for (const r of arr2) {
    const k = _buildKey(r, keyCols, normalizer);
    if (!map.has(k)) map.set(k, r);
  }
  return Array.from(map.values());
}

/**
 * Surcharge ou insère une ligne dans le tableau rows.
 *
 * - Si rows contient des lignes qui matchent row sur keyCols → on les surcharge sur overloadCols
 * - Sinon → on ajoute row au tableau
 *
 * @param {Array<object>} rows
 * @param {object}        row
 * @param {Array<string>} keyCols
 * @param {Array<string>} overloadCols
 * @returns {Array<object>}  nouveau tableau
 */
export function overloadRowsOrInsert(rows, row, keyCols, overloadCols) {
  if (!Array.isArray(rows) || !row) return rows;

  let found = false;

  const newRows = rows.map(r => {
    if (!r || typeof r !== 'object') return r;

    const isMatch = keyCols.every(col => (r?.[col] === row?.[col]));

    if (!isMatch) return r;

    found = true;

    const updated = { ...r };
    for (const col of overloadCols) {
      if (Object.prototype.hasOwnProperty.call(row, col) && row[col]) {
        updated[col] = row[col];
      }
    }
    return updated;
  });

  if (!found) {
    // On ajoute une copie de row
    newRows.push({ ...row });
  }

  return newRows;
}

export function isIOS() {
  const ua = navigator.userAgent || '';
  const platform = navigator.platform || '';
  const maxTP = navigator.maxTouchPoints || 0;

  // iPhone / iPod / iPad (anciens)
  if (/iP(hone|od|ad)/.test(ua)) return true;

  // iPadOS 13+ se déclare comme "MacIntel" mais avec écran tactile
  if (platform === 'MacIntel' && maxTP > 1) return true;

  return false;
}

export function isStandalonePWA() {
  return window.matchMedia('(display-mode: standalone)').matches
      || window.navigator.standalone === true; // iOS Safari
}

export function estNumerique(val) {
  return typeof val === 'number'
    ? Number.isFinite(val)
    : !isNaN(val) && isFinite(Number(val));
}

export function capitalizeFirst(str) {
  const s = String(str ?? '').trim();
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Normalizer par défaut : trim + lower + sans accents
const _defaultNormalizer = v => String(v ?? '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/\s+/g, ' ').trim().toLowerCase();

// Séparateur sûr (Unit Separator) pour éviter les collisions
const SEP = '\x1F';

function _buildKey(row, cols, normalizer = _defaultNormalizer) {
  return cols.map(c => normalizer(row?.[c])).join(SEP);
}

// Retourne la valeur "nue" (sans indicateur de qualité)
// ex: "~1h30"   -> "1h30"
//     "1h30"    -> "1h30"
//     null/""   -> null
export function richValueGetValue(rv) {
  if (rv == null) return null;
  const s = String(rv).trim();
  if (!s) return null;

  const first = s[0];
  // si le 1er char est un chiffre, on considère qu'il n'y a pas de quality
  if (/[0-9]/.test(first)) return s;

  // sinon on enlève juste ce premier char
  return s.slice(1);
}

// Retourne la "quality" (1er caractère si non numérique) ou null
// ex: "1h30"  -> ""
//     "≈2h"    -> "≈"
//     "1h30"   -> null
export function richValueGetQuality(rv) {
  if (rv == null) return null;
  const s = String(rv).trim();
  if (!s) return null;

  const first = s[0];
  return /[0-9]/.test(first) ? null : first;
}

// Construit une richValue à partir de value + quality
// ex: richValueSet("1h30", "~") -> "~1h30"
//     richValueSet("1h30", null) -> "1h30"
export function richValueSet(value, quality = null) {
  const v = value == null ? '' : String(value).trim();
  const q = quality == null ? '' : String(quality);

  if (!q) return v;          // pas de quality → juste la valeur
  return q + v;              // on préfixe
}

// Retourne [value, quality] en une fois
// ex: richValueGet("1h30") -> ["1h30", ""]
export function richValueGet(rv) {
  return [richValueGetValue(rv), richValueGetQuality(rv)];
}