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
    document.body.appendChild(el);
  }
  el.textContent += args.map(a => 
    typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)
  ).join(' ') + '\n';
}

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
      logToPage('Début openUrl en mode PWA')
      const a = document.createElement('a');
      a.href = url;
      a.target = '_blank';
      a.rel = 'noopener,noreferrer';
      // important : il faut un geste utilisateur pour que le click() fonctionne
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      logToPage('Fin openUrl en mode PWA')
      return;
    }
  }

  // Desktop / Android (ou fallback iOS)
  logToPage('OpenUrl en mode Standard')
  try { window.open(url, '_blank', 'noopener'); return; } catch(_) {}
  try { window.open(url, '_top'); return; } catch(_) {}
  try { window.location.assign(url); } catch(_) {}
}
