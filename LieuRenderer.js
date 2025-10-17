// LieuRenderer.js
// Marche sur Firefox mais pb sur lieu vide, sur IOS retour page blanche
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

// Marche sur Firefox mais pb sur lieu vide
// export class LieuRenderer {
//   init(p) {
//     this.p = p;

//     // conteneur principal
//     const e = document.createElement('div');
//     e.className = 'cell-lieu';

//     const lieu = p.value ?? '';
//     const addr = resolveAddress(lieu);
//     if (!addr) return;
//     const url = buildDirectionsUrl(addr);

//     // conteneur principal
//     const a = document.createElement('a');
//     a.href = url;
//     a.textContent = '📍';
//     a.title = 'Itinéraire';
//     a.style.flex = '0 0 auto';
//     a.style.textDecoration = 'none';
//     a.style.cursor = 'pointer';
//     a.style.marginLeft = '.4rem';
//     a.style.fontSize = '1rem';

//     // --- Détection de la plateforme ---
//     const ua = navigator.userAgent || '';
//     const isIOS = /iPad|iPhone|iPod/.test(ua) ||
//       (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
//     const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;

//     // --- Ajustement du comportement ---
//     if (isIOS && isStandalone) {
//       // ✅ Cas PWA iOS : ouvrir dans la même vue, éviter le bug "page blanche + OK"
//       a.removeAttribute('target');
//       a.rel = 'noopener';
//       a.addEventListener('click', (e) => {
//         e.stopPropagation();
//         window.location.assign(url); // navigation directe dans la webview
//       });
//     } else {
//       // ✅ Cas Safari/Android/Desktop : ouvrir dans un nouvel onglet
//       a.target = '_blank';
//       a.rel = 'noopener noreferrer';
//       a.addEventListener('click', (e) => e.stopPropagation());
//     }

//     // texte du lieu
//     const title = document.createElement('span');
//     title.className = 'lieu-title';

//     // sous-texte (adresse résolue)
//     const sub = document.createElement('span');
//     sub.className = 'lieu-sub';

//     // --- Insertion dans le renderer ---
//     e.append(a, title, sub);

//     this.el = e;
//     this.$icon = a;
//     this.$title = title;
//     this.$sub = sub;

//     this.refresh(p);
//   }

//   getGui() { return this.el; }

//   refresh(p) {
//     this.p = p;
//     const lieu = p.value ?? '';
//     const addr = resolveAddress(lieu);
//     this.$title.textContent = lieu || '';
//     this.$sub.textContent = addr ? ` — ${addr}` : '';
//     this.el.title = [lieu, addr].filter(Boolean).join('\n');
//     return true;
//   }
// }

// Pb sur lieu vide résolu, marche sur Firefox et IOS avec PWA impec, avec Safari appelle Iti Apple web dans la meme fenetre -> necessite de faire < pour revenir à l'appli
// export class LieuRenderer {
//   init(params) {
//     this.params = params;

//     // conteneur principal
//     const e = document.createElement('div');
//     e.style.display = 'flex';
//     e.style.alignItems = 'center';
//     e.style.gap = '.4rem';
//     e.style.width = '100%';
//     e.style.overflow = 'hidden';

//     // icône lien
//     const a = document.createElement('a');
//     a.textContent = '📍';
//     a.title = 'Itinéraire';
//     a.style.flex = '0 0 auto';
//     a.style.textDecoration = 'none';
//     a.style.display = 'inline-flex';
//     a.style.alignItems = 'center';
//     a.style.opacity = '.85';
//     a.addEventListener('mouseenter', () => (a.style.opacity = '1'));
//     a.addEventListener('mouseleave', () => (a.style.opacity = '.85'));
//     a.addEventListener('click', (ev) => {
//       // on laisse le navigateur ouvrir le lien,
//       // mais on n’impacte pas la sélection de la grille
//       ev.stopPropagation();
//     });

//     // libellé lieu
//     const txt = document.createElement('span');
//     txt.style.flex = '1 1 auto';
//     txt.style.overflow = 'hidden';
//     txt.style.textOverflow = 'ellipsis';

//     e.append(a, txt);

//     // mémos
//     this.eGui = e;
//     this.$a = a;
//     this.$txt = txt;

//     this.refresh(params);
//   }

//   getGui() {
//     return this.eGui;
//   }

//   refresh(params) {
//     this.params = params || this.params || {};
//     const lieu = (this.params.value ?? '').toString().trim();
//     this.$txt.textContent = lieu;

//     // URL d’itinéraire
//     let url = '';
//     if (lieu) {
//       const addr = resolveAddress(lieu);     // ← ta fonction existante
//       if (addr) url = buildDirectionsUrl(addr); // ← ta fonction existante
//     }

//     if (url) {
//       // activer le lien en NOUVEL onglet (ne touche pas à l’URL de l’app)
//       this.$a.href = url;
//       this.$a.target = '_blank';
//       this.$a.rel = 'noopener noreferrer';
//       this.$a.style.pointerEvents = 'auto';
//       this.$a.style.opacity = '.85';
//       this.$a.title = 'Itinéraire';
//     } else {
//       // pas d’adresse → désactiver visuellement l’icône
//       this.$a.removeAttribute('href');
//       this.$a.removeAttribute('target');
//       this.$a.removeAttribute('rel');
//       this.$a.style.pointerEvents = 'none';
//       this.$a.style.opacity = '.35';
//       this.$a.title = '';
//     }
//     return true;
//   }

//   destroy() {
//     // rien de spécial ici
//   }
// }

// Pb sur lieu vide résolu, IOS impex en mode Safari et PWA (ouverture app iti Apple y compros en mode Safari)
export class LieuRenderer {
  init(p) {
    this.p = p;

    // conteneur principal
    const e = document.createElement('div');
    e.className = 'cell-lieu';
    e.style.display = 'flex';
    e.style.alignItems = 'center';
    e.style.gap = '.4rem';
    e.style.width = '100%';
    e.style.overflow = 'hidden';

    // lien/icone
    const a = document.createElement('a');
    a.textContent = '📍';
    a.title = 'Itinéraire';
    a.style.flex = '0 0 auto';
    a.style.textDecoration = 'none';
    a.style.cursor = 'pointer';
    a.style.marginLeft = '.4rem';
    a.style.fontSize = '1rem';

    // titre (lieu)
    const title = document.createElement('span');
    title.className = 'lieu-title';
    title.style.flex = '1 1 auto';
    title.style.overflow = 'hidden';
    title.style.textOverflow = 'ellipsis';

    // sous-texte (adresse)
    const sub = document.createElement('span');
    sub.className = 'lieu-sub';
    sub.style.opacity = '.7';

    e.append(a, title, sub);

    // mémos
    this.el = e;
    this.$icon = a;
    this.$title = title;
    this.$sub = sub;

    // config plateforme (détermine la façon d’ouvrir)
    const ua = navigator.userAgent || '';
    this.isIOS =
      /iPad|iPhone|iPod/.test(ua) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    this.isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator.standalone === true;

    // handler click unique (réutilisé à chaque refresh)
    this.onIconClick = (e) => {
      // 'url' est recalculée dans refresh et posée sur dataset
      const url = this.$icon.dataset.url;
      if (!url) return;
      e.stopPropagation();
      if (this.isIOS && this.isStandalone) {
        // PWA iOS : naviguer dans la webview pour éviter l'écran blanc "OK"
        window.location.assign(url);
      } else {
        // Safari/Android/Desktop : nouvel onglet
        window.open(url, '_blank', 'noopener');
      }
    };
    this.$icon.addEventListener('click', this.onIconClick);

    this.refresh(p);
  }

  getGui() { return this.el; }

  refresh(p) {
    this.p = p || this.p || {};
    const lieu = (this.p.value ?? '').trim();

    // ⚠️ utilise ta résolution d’adresse (prévois un fallback “Ville” si tu préfères)
    // Si tu as la version qui renvoie [addr, addrEnc], adapte ici :
    // const [addr, addrEnc] = resolveAddressFast(lieu, window.ctx?.carnet);
    // const url = `https://www.google.com/maps/dir/?api=1&destination=${addrEnc}`;
    const addr = resolveAddress(lieu) || '';              // string
    const url  = addr ? buildDirectionsUrl(addr) : '';    // string ou ''

    // Mise à jour du contenu texte
    this.$title.textContent = lieu || '';
    this.$sub.textContent   = addr ? ` — ${addr}` : '';
    this.el.title           = [lieu, addr].filter(Boolean).join('\n');

    // Mise à jour de l’icône + lien
    if (url) {
      this.$icon.style.opacity = '0.9';
      this.$icon.style.pointerEvents = 'auto';
      // on stocke l’URL sur l’élément pour le handler clic
      this.$icon.dataset.url = url;
      // sémantique : garder un <a>, mais on gère le click nous-mêmes
      this.$icon.removeAttribute('href');  // on évite les navigations natives imprévisibles
      this.$icon.removeAttribute('target');
      this.$icon.rel = 'noopener';
    } else {
      // Pas d’adresse → désactiver visuellement
      this.$icon.style.opacity = '0.35';
      this.$icon.style.pointerEvents = 'none';
      delete this.$icon.dataset.url;
      this.$icon.removeAttribute('href');
      this.$icon.removeAttribute('target');
      this.$icon.removeAttribute('rel');
    }

    return true; // AG Grid: rerender ok
  }

  destroy() {
    // nettoyage listener
    if (this.$icon && this.onIconClick) {
      this.$icon.removeEventListener('click', this.onIconClick);
    }
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
  // return onApple
  //   ? `http://maps.apple.com/?daddr=${q}&dirflg=w`
  //   : `https://www.google.com/maps/dir/?api=1&destination=${q}&travelmode=walking`;
  return onApple
    ? `https://www.google.com/maps/dir/?api=1&destination=${q}&travelmode=walking`
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
