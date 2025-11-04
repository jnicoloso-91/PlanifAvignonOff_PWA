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

// Merge deux tableaux sans duplication.
// cols donne les colonnes à tester.
// Si deux lignes ont la même valeur sur les colonnes données par cols la première est gardée.
export function mergeRowsNoDupMultiKey(arr1, arr2, cols, normalizer) {
  const map = new Map();
  // On conserve l’ordre d’arrivée : d’abord arr1, puis arr2
  for (const r of arr1) {
    const k = _buildKey(r, cols, normalizer);
    if (!map.has(k)) map.set(k, r);
  }
  for (const r of arr2) {
    const k = _buildKey(r, cols, normalizer);
    if (!map.has(k)) map.set(k, r);
  }
  return Array.from(map.values());
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

// Normalizer par défaut : trim + lower + sans accents
const _defaultNormalizer = v => String(v ?? '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/\s+/g, ' ').trim().toLowerCase();

// Séparateur sûr (Unit Separator) pour éviter les collisions
const SEP = '\x1F';

function _buildKey(row, cols, normalizer = _defaultNormalizer) {
  return cols.map(c => normalizer(row?.[c])).join(SEP);
}

