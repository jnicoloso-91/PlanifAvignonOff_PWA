// AvisRenderer.js
export class AvisRenderer {
  init(params) {
    this.params = params;

    const e = document.createElement('div');
    e.style.display = 'flex';
    e.style.alignItems = 'center';
    e.style.gap = '.4rem';
    e.style.width = '100%';
    e.style.overflow = 'hidden';

    const label = (params.value != null ? String(params.value) : '').trim();
    const raw   = params.data?.Avis || '';
    const href  = String(raw || ("https://www.google.com/search?q=spectacle+"+encodeURIComponent(params.data?.Activite || '')));

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

      const alreadySelected = !!params.node?.isSelected?.();

      // Toujours empêcher la propagation
      ev.stopPropagation();

      // Si pas encore sélectionnée :
      // on sélectionne ET on bloque la navigation
      if (!alreadySelected) {
        ev.preventDefault();

        try {
          params.node?.setSelected?.(true, true);
        } catch {}

        return;
      }

      // sinon : navigation autorisée
    });

    // a.addEventListener('pointerdown', () => {
    //   try {
    //     params.node?.setSelected?.(true, true);
    //   } catch {}
    // });

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

