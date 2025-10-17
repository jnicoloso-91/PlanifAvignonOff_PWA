export class LieuRenderer {
  init(p) {
    this.p = p;

    // conteneur principal
    const wrap = document.createElement('div');
    wrap.className = 'cell-lieu';

    // icône à gauche
    const icon = document.createElement('button');
    icon.className = 'lieu-icon';
    icon.type = 'button';
    icon.textContent = '📍';
    icon.title = 'Ouvrir dans Plans ou Google Maps';
    icon.addEventListener('click', (ev) => {
      ev.stopPropagation();
      ev.preventDefault();

      const lieu = p.value ?? '';
      const addr = resolveAddress(p.context, lieu);
      if (!addr) return;

      const url = buildDirectionsUrl(addr);
      window.open(url, '_blank', 'noopener,noreferrer');
    });

    // texte du lieu
    const title = document.createElement('span');
    title.className = 'lieu-title';

    // sous-texte (adresse résolue)
    const sub = document.createElement('span');
    sub.className = 'lieu-sub';

    wrap.append(icon, title, sub);

    this.el = wrap;
    this.$icon = icon;
    this.$title = title;
    this.$sub = sub;

    this.refresh(p);
  }

  getGui() { return this.el; }

  refresh(p) {
    this.p = p;
    const lieu = p.value ?? '';
    const addr = resolveAddress(p.context, lieu);
    this.$title.textContent = lieu || '';
    this.$sub.textContent = addr ? ` — ${addr}` : '';
    this.el.title = [lieu, addr].filter(Boolean).join('\n');
    return true;
  }
}

export default LieuRenderer;

function resolveAddress(ctx, lieu) {
  if (!lieu) return '';
  const map = ctx?.carnetMap;
  const city = ctx?.meta?.cityDefault || 'Avignon';
  const addr = map?.get(lieu);
  return addr ?? `${lieu} (${city})`;
}

function buildDirectionsUrl(address) {
  const q = encodeURIComponent(address);
  const ua = navigator.userAgent || '';
  const onApple = /iPhone|iPad|Macintosh/.test(ua);

  // “daddr” = destination, “dirflg=w” = mode piéton
  return onApple
    ? `http://maps.apple.com/?daddr=${q}&dirflg=w`
    : `https://www.google.com/maps/dir/?api=1&destination=${q}&travelmode=walking`;
}
