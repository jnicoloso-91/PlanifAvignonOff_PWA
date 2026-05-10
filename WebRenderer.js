// ===== Web renderer =====
export class WebRenderer {
  init(params) {
    const value = (params.value ?? '').toString().trim();
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
    // iconLink.addEventListener('click', ev => ev.stopPropagation());

    // 1er clic = sélection
    // 2e clic = lancement appel
    iconLink.addEventListener('click', (ev) => {
      ev.stopPropagation();

      const alreadySelected = !!params.node?.isSelected?.();

      if (!alreadySelected) {
        ev.preventDefault();

        try {
          if (params.column && params.node?.rowIndex != null) {
            params.api?.setFocusedCell?.(
              params.node.rowIndex,
              params.column
            );
          }

          params.node?.setSelected?.(true, true);
        } catch {}

        return;
      }

      window.open(href, '_blank', 'noopener');
    });

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

