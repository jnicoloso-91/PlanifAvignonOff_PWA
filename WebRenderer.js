// ===== Web renderer =====
// export class WebRenderer {
//   init(params){
//     const raw = (params.value ?? '').toString().trim();
//     if (!raw) { this.e = document.createTextNode(''); return; }

//     const href = /^https?:\/\//i.test(raw) ? raw : ('https://' + raw);

//     this.e = document.createElement('div');
//     Object.assign(this.e.style, {
//       display:'flex', alignItems:'center', gap:'.5rem', width:'100%', overflow:'hidden'
//     });

//     // icône 🌐
//     const a = document.createElement('a');
//     a.href = href;
//     a.title = 'Ouvrir le site';
//     a.style.textDecoration = 'none';
//     a.style.flex = '0 0 auto';
//     a.addEventListener('click', (ev) => {
//       ev.stopPropagation();
//       openPreferNewTab(href);
//     }, { passive:false });

//     const icon = document.createElement('span');
//     icon.textContent = '🌐';
//     icon.style.fontSize = '1.05rem';
//     a.appendChild(icon);

//     // texte (host ou URL)
//     const span = document.createElement('span');
//     Object.assign(span.style, {
//       flex:'1 1 auto', overflow:'hidden', textOverflow:'ellipsis'
//     });
//     // Affiche le host si possible
//     try { span.textContent = new URL(href).host || raw; }
//     catch { span.textContent = raw; }

//     this.e.append(a, span);
//   }
//   getGui(){ return this.e; }
//   refresh(){ return false; }
// }

// // Ouverture fiable (iOS PWA friendly)
// function openPreferNewTab(url){
//   if (!url) return;
//   const ua = navigator.userAgent || "";
//   const isIOS =
//     /iPad|iPhone|iPod/.test(ua) ||
//     (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1) ||
//     (ua.includes("Mac") && "ontouchend" in window);

//   // iOS/PWA: accrocher l'ouverture au geste utilisateur
//   if (isIOS) {
//     try {
//       const w = window.open('about:blank', '_blank');
//       if (w) { w.location.href = url; return; }
//     } catch(_) {}
//   }
//   try { window.open(url, '_blank', 'noopener'); return; } catch(_) {}
//   try { window.open(url, '_top'); return; } catch(_) {}
//   try { window.location.assign(url); } catch(_) {}
// }
// export class WebRenderer {
//   init(p) {
//     const value = (p.value ?? '').toString().trim();
//     const href  = value ? (/^https?:\/\//i.test(value) ? value : `https://${value}`) : '';

//     // wrapper: TOUJOURS un élément (jamais un TextNode)
//     const wrap = document.createElement('div');
//     wrap.style.display = 'flex';
//     wrap.style.alignItems = 'center';
//     wrap.style.gap = '.4rem';
//     wrap.style.width = '100%';
//     wrap.style.overflow = 'hidden';

//     // Icône 🌐 à gauche
//     const icon = document.createElement('span');
//     icon.textContent = '🌐';
//     icon.style.flex = '0 0 auto';
//     icon.style.fontSize = '1rem';
//     icon.style.opacity = '.9';

//     // Lien (ou texte gris si vide)
//     const a = document.createElement('a');
//     a.style.flex = '1 1 auto';
//     a.style.overflow = 'hidden';
//     a.style.textOverflow = 'ellipsis';
//     a.style.whiteSpace = 'nowrap';
//     a.style.textDecoration = 'none';
//     a.style.color = 'inherit';
//     a.addEventListener('click', (ev) => ev.stopPropagation());

//     if (href) {
//       a.href   = href;
//       a.target = '_blank';
//       a.rel    = 'noopener noreferrer';
//       a.textContent = value;
//       a.title  = value;
//     } else {
//       // Valeur vide → affiche “—” en gris italique, pas de lien
//       a.textContent = '—';
//       a.style.fontStyle = 'italic';
//       a.style.opacity = '.6';
//       a.removeAttribute('href');
//     }

//     wrap.append(icon, a);
//     this.eGui = wrap;
//   }
//   getGui(){ return this.eGui; }
//   refresh(){ return false; }
// }

export class WebRenderer {
  init(p) {
    const value = (p.value ?? '').toString().trim();
    const href  = value ? (/^https?:\/\//i.test(value) ? value : `https://${value}`) : '';

    // wrapper: icône (cliquable) + texte (non cliquable)
    const wrap = document.createElement('div');
    wrap.style.display = 'flex';
    wrap.style.alignItems = 'center';
    wrap.style.gap = '.4rem';
    wrap.style.width = '100%';
    wrap.style.overflow = 'hidden';

    // Icône 🌐 à gauche – seul élément cliquable
    const iconLink = document.createElement('a');
    iconLink.style.flex = '0 0 auto';
    iconLink.style.textDecoration = 'none';
    iconLink.style.opacity = '.9';
    iconLink.title = 'Ouvrir le site';
    // stoppe la propagation → n’interrompt pas sélection/édition
    iconLink.addEventListener('click', ev => ev.stopPropagation());

    const icon = document.createElement('span');
    icon.textContent = '🌐';
    icon.style.fontSize = '1rem';
    iconLink.appendChild(icon);

    if (href) {
      iconLink.href = href;
      iconLink.target = '_blank';
      iconLink.rel = 'noopener noreferrer';
    } else {
      // Pas d’URL → cache l’icône
      iconLink.style.display = 'none';
    }

    // Texte : non cliquable, pour garder la sélection/édition AG Grid
    const txt = document.createElement('span');
    txt.style.flex = '1 1 auto';
    txt.style.overflow = 'hidden';
    txt.style.textOverflow = 'ellipsis';
    txt.style.whiteSpace = 'nowrap';

    if (value) {
      txt.textContent = value;
      txt.title = value;
    } else {
      txt.textContent = '—';
      txt.style.fontStyle = 'italic';
      txt.style.opacity = '.6';
    }

    wrap.append(iconLink, txt);
    this.eGui = wrap;
  }
  getGui(){ return this.eGui; }
  refresh(){ return false; }
}

