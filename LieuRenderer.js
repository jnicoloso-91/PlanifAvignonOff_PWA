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
    a.textContent = '🧭';
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

    title.style.cursor = 'pointer';
    title.title = 'Recherche Google';

    this.onTitleClick = (e) => {
      const lieu = this.$title.textContent?.trim() || "";
      if (!lieu) return;

      e.stopPropagation();

      const alreadySelected = !!this.p.node?.isSelected?.();

      // 1er clic : sélection seulement
      if (!alreadySelected) {
        e.preventDefault();

        try {
          if (this.p.column && this.p.node?.rowIndex != null) {
            this.p.api?.setFocusedCell?.(
              this.p.node.rowIndex,
              this.p.column
            );
          }

          this.p.node?.setSelected?.(true, true);
        } catch {}

        return;
      }

      // 2e clic : recherche Google
      const href = buildGoogleSearchUrl(lieu);
      openExternalSmart(href);
      // window.open(href, '_blank', 'noopener');
    };

    e.append(a, title); //, sub);

    // mémos
    this.el = e;
    this.$icon = a;
    this.$title = title;

    // Branchement du click sur title
    this.$title.addEventListener('click', this.onTitleClick);

    this.$title.addEventListener('mouseenter', () => {
      this.$title.style.textDecoration = 'underline';
      this.$title.style.opacity = '0.9';
    });

    this.$title.addEventListener('mouseleave', () => {
      this.$title.style.textDecoration = 'none';
      this.$title.style.opacity = '1';
    });

    // config plateforme (détermine la façon d’ouvrir)
    const ua = navigator.userAgent || '';
    this.isIOS =
      /iPad|iPhone|iPod/.test(ua) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    this.isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator.standalone === true;

    this.onIconPointerDown = () => {
      try {
        if (p.column && p.node?.rowIndex != null) {
          p.api?.setFocusedCell?.(p.node.rowIndex, p.column);
        }
        p.node?.setSelected?.(true, true);
      } catch {}
    };

    this.$icon.addEventListener('pointerdown', this.onIconPointerDown);      

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

    // ⚠️ utilise la résolution d’adresse (avec un fallback “Ville”)
    const addr = resolveAddress(lieu) || '';              // string
    const url  = addr ? buildDirectionsUrl(addr) : '';    // string ou ''

    // Mise à jour du contenu texte
    this.$title.textContent = lieu || '';

    if (lieu) {
      this.$title.style.pointerEvents = 'auto';
      this.$title.style.opacity = '1';
    } else {
      this.$title.style.pointerEvents = 'none';
      this.$title.style.opacity = '0.6';
    }

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
    if (this.$icon && this.onIconPointerDown) {
      this.$icon.removeEventListener('pointerdown', this.onIconPointerDown);
    }
    if (this.$title && this.onTitleClick) {
      this.$title.removeEventListener('click', this.onTitleClick);
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

export function resolveAddress(lieu) {
  if (!lieu) return '';
  const carnet = window.ctx?.carnet;
  const cityDefault = window.ctx?.meta?.city_default || 'Avignon';

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

export function resolveWebAddress(lieu) {
  if (!lieu) return '';
  const carnet = window.ctx?.carnet;
  const cityDefault = window.ctx?.meta?.city_default || 'Avignon';

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
      addr = String(hit.Web).trim();
    }
  }

  return addr ?? `${lieu} ${cityDefault}`;
}

export function buildDirectionsUrl(address) {
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

export function buildGoogleSearchUrl(lieu) {
  return `https://www.google.com/search?q=${encodeURIComponent(resolveWebAddress(lieu))}`;
}

