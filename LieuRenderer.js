// export class LieuRenderer {
//   init(p) {
//     this.p = p;

//     // conteneur principal
//     const wrap = document.createElement('div');
//     wrap.className = 'cell-lieu';

//     // icône à gauche
//     const icon = document.createElement('button');
//     icon.className = 'lieu-icon';
//     icon.type = 'button';
//     icon.textContent = '📍';
//     icon.title = 'Ouvrir dans Plans ou Google Maps';
//     icon.addEventListener('click', (ev) => {
//       ev.stopPropagation();
//       // pas de preventDefault -> on laisse la navigation se faire
//       // ev.preventDefault();

//       const lieu = p.value ?? '';
//       const addr = resolveAddress(p.context, lieu);
//       if (!addr) return;

//       const url = buildDirectionsUrl(addr);
//       // window.open(url, '_blank', 'noopener,noreferrer');
//       openExternalSmart(url);

//     });

//     // texte du lieu
//     const title = document.createElement('span');
//     title.className = 'lieu-title';

//     // sous-texte (adresse résolue)
//     const sub = document.createElement('span');
//     sub.className = 'lieu-sub';

//     wrap.append(icon, title, sub);

//     this.el = wrap;
//     this.$icon = icon;
//     this.$title = title;
//     this.$sub = sub;

//     this.refresh(p);
//   }

//   getGui() { return this.el; }

//   refresh(p) {
//     this.p = p;
//     const lieu = p.value ?? '';
//     const addr = resolveAddress(p.context, lieu);
//     this.$title.textContent = lieu || '';
//     this.$sub.textContent = addr ? ` — ${addr}` : '';
//     this.el.title = [lieu, addr].filter(Boolean).join('\n');
//     return true;
//   }
// }

export class LieuRenderer {
  init(p) {
    this.p = p;

    // conteneur principal
    const e = document.createElement('div');
    e.className = 'cell-lieu';

    const lieu = p.value ?? '';
    const addr = resolveAddress(lieu);
    if (!addr) return;
    const url = buildDirectionsUrl(addr);

    // conteneur principal
    const a = document.createElement('a');
    a.href = url;
    a.textContent = '📍';
    a.title = 'Itinéraire';
    a.style.flex = '0 0 auto';
    a.style.textDecoration = 'none';
    a.style.cursor = 'pointer';
    a.style.marginLeft = '.4rem';
    a.style.fontSize = '1rem';

    // --- Détection de la plateforme ---
    const ua = navigator.userAgent || '';
    const isIOS = /iPad|iPhone|iPod/.test(ua) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;

    // --- Ajustement du comportement ---
    if (isIOS && isStandalone) {
      // ✅ Cas PWA iOS : ouvrir dans la même vue, éviter le bug "page blanche + OK"
      a.removeAttribute('target');
      a.rel = 'noopener';
      a.addEventListener('click', (e) => {
        e.stopPropagation();
        window.location.assign(url); // navigation directe dans la webview
      });
    } else {
      // ✅ Cas Safari/Android/Desktop : ouvrir dans un nouvel onglet
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.addEventListener('click', (e) => e.stopPropagation());
    }

    // texte du lieu
    const title = document.createElement('span');
    title.className = 'lieu-title';

    // sous-texte (adresse résolue)
    const sub = document.createElement('span');
    sub.className = 'lieu-sub';

    // --- Insertion dans le renderer ---
    e.append(a, title, sub);

    this.el = e;
    this.$icon = a;
    this.$title = title;
    this.$sub = sub;

    this.refresh(p);
  }

  getGui() { return this.el; }

  refresh(p) {
    this.p = p;
    const lieu = p.value ?? '';
    const addr = resolveAddress(lieu);
    this.$title.textContent = lieu || '';
    this.$sub.textContent = addr ? ` — ${addr}` : '';
    this.el.title = [lieu, addr].filter(Boolean).join('\n');
    return true;
  }
}


export default LieuRenderer;

function normalizeText(s) {
  return (s ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

/**
 * Résout l’adresse d’un lieu à partir du carnet.
 * @param {string} lieu - Nom du lieu (ex. "La Scala").
 * @param {Array<Object>} carnet - Tableau [{ Nom, Adresse, Tel, Web }, ...].
 * @param {string} [cityDefault="Avignon"] - Ville par défaut pour le fallback.
 * @returns {[string, string]} [adresse lisible, adresse encodée pour URL].
 */
function resolveAddressFast(lieu, carnet = [], cityDefault = 'Avignon') {
  if (!lieu) return [cityDefault, encodeURIComponent(cityDefault)];

  const key = normalizeText(lieu);
  let addr = '';

  if (Array.isArray(carnet) && carnet.length > 0) {
    // 1️⃣ recherche exacte
    let hit = carnet.find(r => normalizeText(r.Nom) === key);

    // 2️⃣ sinon "contains"
    if (!hit && key) {
      hit = carnet.find(r => normalizeText(r.Nom).includes(key));
    }

    // 3️⃣ Si trouvé → récupérer Adresse
    if (hit?.Adresse) {
      addr = String(hit.Adresse).trim();
    }
  }

  // 4️⃣ Fallback "lieu, ville"
  if (!addr) {
    addr = lieu ? `${lieu}, ${cityDefault}` : cityDefault;
  }

  return [addr, encodeURIComponent(addr)];
}


function resolveAddress(lieu) {
  if (!lieu) return '';
  const carnet = window.ctx?.carnet;
  const cityDefault = window.ctx?.meta?.cityDefault || 'Avignon';

  const key = normalizeText(lieu);
  let addr = null;

  if (Array.isArray(carnet) && carnet.length > 0) {
    // 1️⃣ recherche exacte
    let hit = carnet.find(r => normalizeText(r.Nom) === key);

    // 2️⃣ sinon "contains"
    if (!hit && key) {
      hit = carnet.find(r => normalizeText(r.Nom).includes(key));
    }

    // 3️⃣ Si trouvé → récupérer Adresse
    if (hit?.Adresse) {
      addr = String(hit.Adresse).trim();
    }
  }

  return addr ?? `${lieu} (${cityDefault})`;
}

function buildDirectionsUrl(address) {
  const q = encodeURIComponent(address);
  const ua = navigator.userAgent || '';
  const onApple = /iPhone|iPad|Macintosh/.test(ua);

  // “daddr” = destination, “dirflg=w” = mode piéton
  return onApple
    ? `http://maps.apple.com/?daddr=${q}&dirflg=w`
    : `https://www.google.com/maps/dir/?api=1&destination=${q}&travelmode=walking`;
}

function openExternalSmart(url) {
  if (!url) return;
  const ua = navigator.userAgent || '';
  const isIOS = /iPad|iPhone|iPod/.test(ua); 
    // || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;

  try {
    if (isIOS && isStandalone) {
      // PWA iOS : naviguer dans l’onglet courant (pas de _blank)
      window.location.assign(url);
    } else {
      // Safari / Desktop : _blank ok
      const w = window.open(url, '_blank', 'noopener,noreferrer');
      if (!w) window.location.assign(url); // fallback si popup bloquée
    }
  } catch {
    window.location.assign(url);
  }
}
