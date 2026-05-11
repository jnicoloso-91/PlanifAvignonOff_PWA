// SearchActiviteRenderer.js
export class SearchActiviteRenderer {
  init(params) {
    this.params = params;

    const e = document.createElement('div');
    e.style.display = 'block';
    e.style.width = '100%';
    e.style.height = '100%';
    e.style.overflow = 'hidden';
    e.style.textOverflow = 'ellipsis';
    e.style.whiteSpace = 'nowrap';

    const label = (params.value != null ? String(params.value) : '').trim();

    e.textContent = label;

    if (!label) {
      this.eGui = e;
      return;
    }

    const raw   = params.data?.Hyperlien || '';
    const href  = String(raw || ("https://www.festivaloffavignon.com/resultats-recherche?recherche="+encodeURIComponent(label)));

    e.style.cursor = 'pointer';

    // hover
    e.addEventListener('mouseenter', () => {
      e.style.textDecoration = 'underline';
      e.style.opacity = '0.9';
    });

    e.addEventListener('mouseleave', () => {
      e.style.textDecoration = 'none';
      e.style.opacity = '1';
    });

    // 1er clic = sélection
    // 2e clic = ouverture catalogue
    e.addEventListener('click', (ev) => {
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

    this.eGui = e;
  }

  getGui() {
    return this.eGui;
  }

  refresh() {
    return false;
  }
}