// // ActiviteRenderer.js
// export class ActiviteRenderer {
//   init(params) {
//     this.params = params;

//     const e = document.createElement('div');
//     e.style.display = 'flex';
//     e.style.alignItems = 'center';
//     e.style.gap = '.4rem';
//     e.style.width = '100%';
//     e.style.overflow = 'hidden';

//     const label = (params.value != null ? String(params.value) : '').trim();
//     const raw   = params.data?.Hyperlien || '';
//     const href  = String(raw || ("https://www.festivaloffavignon.com/resultats-recherche?recherche="+encodeURIComponent(label)));

//     // lien-icône (ouvre NOUVEL onglet)
//     const a = document.createElement('a');
//     a.href = href;
//     a.target = '_blank';
//     a.rel = 'noopener noreferrer';
//     a.title = 'Ouvrir le site';
//     a.style.textDecoration = 'none';
//     a.style.flex = '0 0 auto';
//     a.style.display = 'inline-flex';
//     a.style.alignItems = 'center';
//     a.style.opacity = '.85';
//     a.addEventListener('mouseenter', () => a.style.opacity = '1');
//     a.addEventListener('mouseleave', () => a.style.opacity = '.85');

//     a.addEventListener('click', (ev) => {

//       const alreadySelected = !!params.node?.isSelected?.();

//       // Toujours empêcher la propagation
//       ev.stopPropagation();

//       // Si pas encore sélectionnée :
//       // on sélectionne ET on bloque la navigation
//       if (!alreadySelected) {
//         ev.preventDefault();

//         try {
//           params.node?.setSelected?.(true, true);
//         } catch {}

//         return;
//       }

//       // sinon : navigation autorisée
//     });

//     // a.addEventListener('pointerdown', () => {
//     //   try {
//     //     params.node?.setSelected?.(true, true);
//     //   } catch {}
//     // });

//     const icon = document.createElement('span');
//     icon.textContent = '🔗';
//     icon.style.fontSize = '1rem';
//     a.appendChild(icon);

//     const txt = document.createElement('span');
//     txt.textContent = label;
//     txt.style.flex = '1 1 auto';
//     txt.style.overflow = 'hidden';
//     txt.style.textOverflow = 'ellipsis';

//     e.appendChild(a);
//     e.appendChild(txt);
//     this.eGui = e;
//   }
  
//   getGui() { return this.eGui; }

//   refresh() { return false; }
// }


import {
  openPopoverNear,
} from './infos-plus.js';

// ActiviteRenderer.js
export class ActiviteRenderer {
  init(params) {
    this.params = params;

    const row = params.data || {};

    const e = document.createElement('div');
    e.style.display = 'flex';
    e.style.alignItems = 'center';
    e.style.gap = '.4rem';
    e.style.width = '100%';
    e.style.overflow = 'hidden';

    const label = (params.value != null ? String(params.value) : '').trim();

    const raw  = row.Hyperlien || '';
    const href = String(
      raw ||
      ("https://www.festivaloffavignon.com/resultats-recherche?recherche=" +
        encodeURIComponent(label))
    );

    // ---------------------------------------------------
    // Lien site
    // ---------------------------------------------------

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

      ev.stopPropagation();

      // 1er clic => sélection uniquement
      if (!alreadySelected) {
        ev.preventDefault();

        try {
          params.node?.setSelected?.(true, true);
        } catch {}

        return;
      }

      // sinon navigation autorisée
    });

    const icon = document.createElement('span');
    icon.textContent = '🔗';
    icon.style.fontSize = '1rem';

    a.appendChild(icon);

    // ---------------------------------------------------
    // Texte activité
    // ---------------------------------------------------

    const txt = document.createElement('span');

    txt.textContent = label;
    txt.style.flex = '1 1 auto';
    txt.style.minWidth = '0';
    txt.style.overflow = 'hidden';
    txt.style.textOverflow = 'ellipsis';
    txt.style.whiteSpace = 'nowrap';

    // ---------------------------------------------------
    // Bouton infos i+
    // ---------------------------------------------------

    const hasInfo = !!(row.__desc_summary || row.__avis_summary);
    let btn = null;

    if (hasInfo) {

      btn = document.createElement('button');

      btn.type = 'button';
      btn.textContent = 'i+';

      btn.style.flex = '0 0 auto';
      btn.style.cursor = 'pointer';
      btn.style.fontSize = '.8rem';
      btn.style.lineHeight = '1';
      btn.style.padding = '2px 4px';
      btn.style.border = 'none';
      btn.style.background = 'transparent';

      btn.title = 'Infos';

      btn.addEventListener('click', (e) => {

        e.preventDefault();
        e.stopPropagation();

        try {
          params.node?.setSelected?.(true, true);
        } catch {}

        openPopoverNear(btn, {
          title: row.Activite || row.activite || "Détails",
          style: row.Style,
          desc: row.__desc_summary,
          avis: row.__avis_summary,
          mood: row.Mood,
          note: row?.Note || null,
        });
      });
    }

    // ---------------------------------------------------

    e.appendChild(a);
    e.appendChild(txt);

    if (btn) e.appendChild(btn);

    this.eGui = e;
  }

  getGui() {
    return this.eGui;
  }

  refresh() {
    return false;
  }
}