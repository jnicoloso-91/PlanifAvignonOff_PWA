// NoteRenderer.js
export class NoteRenderer {
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
    const raw   = params.data?.HyperlienBR || '';
    const href  = String(
      raw ||
      ("https://www.billetreduc.com/search.htm?se=" +
        encodeURIComponent(params.data?.Activite || ''))
    );

    e.textContent = label;

    const hasNote = (params.data?.Note != null) && String(params.data?.Note).trim() !== "";

    if (!hasNote) {
      // Cellule passive
      this.eGui = e;
      return;
    }

    e.style.cursor = 'pointer';
    
    // hover visuel (optionnel mais sympa)
    e.addEventListener('mouseenter', () => {
      e.style.textDecoration = 'underline';
      e.style.opacity = '0.9';
    });
    e.addEventListener('mouseleave', () => {
      e.style.textDecoration = 'none';
      e.style.opacity = '1';
    });

    // // 👉 sélection AVANT navigation
    // e.addEventListener('pointerdown', () => {
    //   try {
    //     if (params.column && params.node?.rowIndex != null) {
    //       params.api?.setFocusedCell?.(params.node.rowIndex, params.column);
    //     }
    //     params.node?.setSelected?.(true, true);
    //   } catch {}
    // });

    // // 👉 ouverture lien
    // e.addEventListener('click', (ev) => {
    //   ev.stopPropagation();

    //   // même logique que tes autres renderers
    //   window.open(href, '_blank', 'noopener');
    // });
    e.addEventListener('click', (ev) => {
      ev.stopPropagation();

      const alreadySelected = !!params.node?.isSelected?.();

      // 1er clic : sélection seulement
      if (!alreadySelected) {
        ev.preventDefault();

        try {
          if (params.column && params.node?.rowIndex != null) {
            params.api?.setFocusedCell?.(params.node.rowIndex, params.column);
          }
          params.node?.setSelected?.(true, true);
        } catch {}

        return;
      }

      // 2e clic sur ligne déjà sélectionnée : ouverture
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