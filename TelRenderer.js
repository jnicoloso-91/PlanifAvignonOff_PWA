// ===== Tel renderer =====
export class TelRenderer {
  init(params){
    const e = document.createElement('div');
    e.style.display='flex';
    e.style.alignItems='center';
    e.style.gap='.5rem';
    e.style.width='100%';
    e.style.overflow='hidden';
    e.style.touchAction='manipulation';
    e.className = 'cell-tel';

    const raw = (params.value ?? '').toString().trim();
    const phones = parsePhones(raw);
    const primary = phones[0] || '';
    const href = toTelHref(primary);

    // icône 📞 (cliquable)
    const a = document.createElement('a');
    a.textContent = '📞';
    a.style.flex='0 0 auto';
    a.style.textDecoration='none';
    a.style.userSelect='none';
    a.style.opacity = href ? '1' : '.35';
    a.title = href ? `Appeler ${primary}` : 'Numéro invalide';
    if (href) a.href = href;

    // éviter de perturber la sélection/édition AG Grid
    // a.addEventListener('click', ev => ev.stopPropagation());

    // 1er clic = sélection
    // 2e clic = lancement appel
    a.addEventListener('click', (ev) => {
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

    // texte (affiche tel principal “joli”)
    const txt = document.createElement('span');
    txt.style.flex='1 1 auto';
    txt.style.overflow='hidden';
    txt.style.textOverflow='ellipsis';
    txt.textContent = primary ? prettyFR(primary) : raw;

    // badge multi
    if (phones.length > 1) {
      const badge = document.createElement('span');
      badge.textContent = `+${phones.length - 1}`;
      badge.style.flex='0 0 auto';
      badge.style.fontSize='0.72rem';
      badge.style.opacity='.7';
      badge.style.padding='0 6px';
      badge.style.border='1px solid rgba(0,0,0,.15)';
      badge.style.borderRadius='999px';
      e.appendChild(a); e.appendChild(txt); e.appendChild(badge);
    } else {
      e.append(a, txt);
    }

    this.eGui = e;
  }
  getGui(){ return this.eGui; }
  refresh(){ return false; }
}

// === Helpers ===
function parsePhones(raw){
  const s = String(raw || '').trim();
  if (!s) return [];
  // coupe sur / , ; ou " ou " (et garde les morceaux non vides)
  return s.split(/[\/;,]| ou /i)
    .map(x => x.trim())
    .filter(Boolean);
}

function toTelHref(s){
  if (!s) return '';
  const plus = s.trim().startsWith('+');
  const digits = s.replace(/[^0-9]/g,'');
  if (!digits) return '';
  return `tel:${plus ? '+' : ''}${digits}`;
}

function prettyFR(x){
  // simple format lisible pour les numéros français, sans muter la valeur réelle
  const d = x.replace(/[^\d]/g,'');
  return d.replace(/(\d{2})(?=\d)/g,'$1 ').trim(); // → 06 12 34 56 78
}



// export class TelRenderer {
//   init(params){
//     this.e = document.createElement('div');
//     Object.assign(this.e.style, {
//       display:'flex', alignItems:'center', gap:'.5rem', width:'100%', overflow:'hidden'
//     });

//     const raw = (params.value ?? '').toString().trim();

//     // icône 📞 (lien tel:)
//     const telHref = normalizeTel(raw) || '#';
//     const a = document.createElement('a');
//     a.href = telHref;
//     a.title = 'Appeler';
//     a.style.textDecoration = 'none';
//     a.style.flex = '0 0 auto';
//     a.addEventListener('click', ev => ev.stopPropagation());

//     const icon = document.createElement('span');
//     icon.textContent = '📞';
//     icon.style.fontSize = '1.05rem';
//     a.appendChild(icon);
//     this.e.appendChild(a);

//     // texte (numéro affiché)
//     const txt = document.createElement('span');
//     Object.assign(txt.style, {
//       flex:'1 1 auto', overflow:'hidden', textOverflow:'ellipsis'
//     });
//     txt.textContent = raw;
//     this.e.appendChild(txt);

//   }
//   getGui(){ return this.e; }
//   refresh(){ return false; }
// }

// // ===== Helpers =====
// function normalizeTel(s){
//   if (!s) return "";
//   s = String(s).trim();
//   const plus = s.startsWith("+");
//   const digits = s.replace(/[^0-9]/g, "");
//   if (!digits) return "";
//   return (plus ? "tel:+"+digits : "tel:"+digits);
// }

