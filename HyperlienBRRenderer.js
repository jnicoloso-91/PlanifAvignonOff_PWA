// HyperlienBRRenderer.js
export class HyperlienBRRenderer {
  init(params) {
    this.params = params;

    const e = document.createElement('div');
    e.style.display = 'flex';
    e.style.alignItems = 'center';
    e.style.gap = '.4rem';
    e.style.width = '100%';
    e.style.overflow = 'hidden';

    const label = (params.value != null ? String(params.value) : '').trim();
    const raw   = params.data?.HyperlienBR || '';
    const href  = String(raw || ("https://www.billetreduc.com/search.htm?se="+encodeURIComponent(params.data?.Activite || '')));

    // lien-icône (ouvre NOUVEL onglet)
    const a = document.createElement('a');
    a.href = href;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.title = 'Ouvrir le site';
    a.style.textDecoration = 'none';
    a.style.flex = '0 0 auto';
    a.style.display = 'inline-flex';
    a.style.alignItems = 'center';
    a.style.opacity = '.85';
    a.addEventListener('mouseenter', () => a.style.opacity = '1');
    a.addEventListener('mouseleave', () => a.style.opacity = '.85');
    a.addEventListener('click', (ev) => {
        // important : ne PAS mettre preventDefault ici,
        // on laisse le navigateur ouvrir le nouvel onglet.
        ev.stopPropagation(); // évite de changer la sélection de la ligne
    });

    const icon = document.createElement('span');
    icon.textContent = '🔗';
    icon.style.fontSize = '1rem';
    a.appendChild(icon);

    const txt = document.createElement('span');
    txt.textContent = label;
    txt.style.flex = '1 1 auto';
    txt.style.overflow = 'hidden';
    txt.style.textOverflow = 'ellipsis';

    e.appendChild(a);
    e.appendChild(txt);
    this.eGui = e;
  }
  
  getGui() { return this.eGui; }

  refresh() { return false; }
}

