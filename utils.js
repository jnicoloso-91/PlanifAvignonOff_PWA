// ===============================
// Utilitaires divers
// ===============================

// Appel d'une fonction après n frames
export function afterFrames(n, fn) {
  if (n <= 0) return fn();
  requestAnimationFrame(() => afterFrames(n - 1, fn));
}

// Attend la fin de deux frames
export const waitAF = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

// Renvoie un identifiant unique universel
export function genUUID() {
  if (crypto?.randomUUID) return crypto.randomUUID();

  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;

  let s = '';
  for (let i = 0; i < 16; i++) {
    if (i === 4 || i === 6 || i === 8 || i === 10) s += '-';
    s += b[i].toString(16).padStart(2, '0');
  }
  return s;
} 

// helper pour éviter les surprises dans les innerHTML
export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function escapeAttr(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Enlève la partie origin d'une URL
export function stripOrigin(url) {
  const u = new URL(url);
  return u.pathname + u.search + u.hash;
}

// Ouvre une URL
export function openUrl(u, IosPwaMode=true){
  if (!u) return;
  const url = /^https?:\/\//i.test(u) ? u : ('https://' + u);

  try {
    if (IosPwaMode) {
      // Vérifie si on est dans une PWA iOS
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
        || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
      // @ts-ignore
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
  } finally {
    sessionStorage.setItem("forceProgrammeOnReturn", "1"); // permet de forcer le retour au programme après visite du lien
  }
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
 * Merge deux tableaux d'objets sans duplication basée sur une clé composite.
 *
 * - Les lignes sont identifiées comme doublons si les valeurs des colonnes `keyCols`
 *   sont égales (après application éventuelle du `normalizer`).
 * - Les lignes de `arr1` servent de base.
 * - Les lignes de `arr2` sont appliquées par-dessus (merge champ par champ).
 * - Les colonnes listées dans `excludeCols` ne sont jamais écrasées dans `arr1`.
 *
 * Comportement :
 * - Présent uniquement dans arr1 → conservé
 * - Présent uniquement dans arr2 → ajouté
 * - Présent dans les deux → merge (arr2 écrase arr1 sauf colonnes exclues)
 *
 * @param {Array<Object>} arr1 - Tableau de base (priorité pour les colonnes exclues)
 * @param {Array<Object>} arr2 - Tableau à merger par-dessus
 * @param {Array<string>} keyCols - Colonnes constituant la clé de déduplication
 * @param {Object} [options] - Options de merge
 * @param {Array<string>} [options.excludeCols=["Marqueur"]] - Colonnes à ne pas écraser dans arr1
 * @param {(value:any)=>string} [options.normalizer] - Fonction de normalisation appliquée aux valeurs des clés avant comparaison
 *
 * @returns {Array<Object>} Nouveau tableau fusionné sans doublons
 */
export function mergeRowsNoDupMultiKey(
  arr1,
  arr2,
  keyCols,
  {
    excludeCols = ["Marqueur"],
    normalizer = defaultNormalizer
  } = {}
) {  
  const map = new Map();

  for (const r of arr1) {
    const k = buildKey(r, keyCols, normalizer);
    map.set(k, { ...r });
  }

  for (const r2 of arr2) {
    const k = buildKey(r2, keyCols, normalizer);
    if (!map.has(k)) {
      map.set(k, { ...r2 });
    } else {
      const r1 = map.get(k);

      for (const key of Object.keys(r2)) {
        if (excludeCols.includes(key)) continue;

        const val = r2[key];
        if (val !== undefined && val !== null) {
          r1[key] = val;
        }
      }
    }
  }

  return Array.from(map.values());
}

/**
 * Surcharge ou insère des lignes de arr2 dans arr1.
 *
 * - Pour chaque ligne de arr2 :
 *   - si arr1 contient une ligne qui matche sur keyCols → surcharge cette ligne de arr1 avec les valeurs de arr2 sur les colonnes overloadCols
 *   - sinon → insertion
 *
 * @param {Array<object>} arr1
 * @param {Array<object>} arr2
 * @param {Array<string>} keyCols
 * @param {Array<string>} overloadCols
 * @returns {Array<object>} nouveau tableau
 */
export function overloadRowsOrInsert(arr1, arr2, keyCols, overloadCols) {
  if (!Array.isArray(arr1) || !Array.isArray(arr2) || !keyCols?.length) {
    return arr1;
  }

  // Copie de travail
  const result = arr1.map(r => (r && typeof r === "object" ? { ...r } : r));

  for (const row of arr2) {
    if (!row || typeof row !== "object") continue;

    let found = false;

    for (let i = 0; i < result.length; i++) {
      const r = result[i];
      if (!r || typeof r !== "object") continue;

      const isMatch = keyCols.every(col => r?.[col] === row?.[col]);
      if (!isMatch) continue;

      found = true;

      // surcharge ciblée
      for (const col of overloadCols) {
        if (Object.prototype.hasOwnProperty.call(row, col) && row[col] != null) {
          r[col] = row[col];
        }
      }
    }

    // si aucune ligne matchée → insertion
    if (!found) {
      result.push({ ...row });
    }
  }

  return result;
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

export function isAndroid() {
  return /Android/.test(navigator.userAgent);
}

export function isStandalonePWA() {
  return window.matchMedia('(display-mode: standalone)').matches
// @ts-ignore
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
export const defaultNormalizer = v => String(v ?? '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/\s+/g, ' ').trim().toLowerCase();

// Séparateur sûr (Unit Separator) pour éviter les collisions
const SEP = '\x1F';

export function buildKey(row, cols, normalizer = defaultNormalizer) {
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
// ex: "1h30"   -> null
//     "≈2h"    -> "≈"
export function richValueGetQuality(rv) {
  if (rv == null) return null;
  const s = String(rv).trim();
  if (!s) return null;

  const first = s[0];
  return /[0-9]/.test(first) ? null : first;
}

// Retourne vrai si rv != null et "quality" == null (1er caractère numérique)
// ex: "1h30"         -> good
//     "≈2h" ou ""    -> bad
export function richValueGoodQuality(rv) {
  return (rv !== null && richValueGetQuality(rv) === null);
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

export function includesSafe(str, searchString) {
    // Vérifie si str est une chaîne valide
    if (typeof str !== 'string') {
        return false;
    }
    // Utilise includes pour vérifier la présence de searchString
    return str.includes(searchString);
}

// Conversion safe d'une String en Number
export function toNumberSafe(v, def = null) {
  if (v == null) return def;

  const s = String(v).trim().replace(',', '.');

  if (s === '') return def;

  const n = Number(s);

  return Number.isFinite(n) ? n : def;
} 
