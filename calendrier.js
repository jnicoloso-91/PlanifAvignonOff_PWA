// ===============================
//  EXPORT .ICS — Date: YYYYMMDD + Debut + __uuid
// ===============================

const pad2 = n => String(n).padStart(2, '0');

const toICSDateUTC = (d) => {
  if (!(d instanceof Date) || isNaN(d)) return '';
  return (
    d.getUTCFullYear() +
    pad2(d.getUTCMonth() + 1) +
    pad2(d.getUTCDate()) + 'T' +
    pad2(d.getUTCHours()) +
    pad2(d.getUTCMinutes()) +
    pad2(d.getUTCSeconds()) + 'Z'
  );
};

const escICS = (s='') => String(s)
  .replace(/\\/g, '\\\\').replace(/;/g, '\\;')
  .replace(/,/g, '\\,').replace(/\n/g, '\\n');

// Debut: "HH:MM" | "9h" | "9h30" | "0930" | "9"
function parseTimeParts(timeStr='') {
  const s = String(timeStr).trim();
  let m;
  if ((m = s.match(/^(\d{1,2}):(\d{1,2})$/))) return { hh:+m[1], mm:+m[2] };
  if ((m = s.match(/^(\d{1,2})h(\d{0,2})?$/i))) return { hh:+m[1], mm:+(m[2]||0) };
  if ((m = s.match(/^(\d{3,4})$/))) { const v=m[1]; return { hh:+v.slice(0, v.length-2), mm:+v.slice(-2) }; }
  if ((m = s.match(/^(\d{1,2})$/))) return { hh:+m[1], mm:0 };
  return { hh:0, mm:0 };
}

// Date: YYYYMMDD uniquement
function parseYYYYMMDD(dateVal) {
  const s = String(dateVal).trim();
  if (!/^\d{8}$/.test(s)) return null;
  return { y:+s.slice(0,4), m:+s.slice(4,6), d:+s.slice(6,8) };
}

function buildDateFromRow(row) {
  const di = parseYYYYMMDD(row.Date ?? row['DATE']);
  if (!di) return null;
  const { hh, mm } = parseTimeParts(row.Debut ?? row['DEBUT'] ?? row['Heure']);
  return new Date(di.y, (di.m||1)-1, di.d||1, hh||0, mm||0, 0, 0);
}

function parseDureeToMin(dur='') {
  const s = String(dur).toLowerCase().replace(/\s+/g,'').trim();
  let m;
  if (!s) return 60;
  if ((m = s.match(/^(\d+)\s*min$/))) return +m[1];
  if ((m = s.match(/^(\d+)h(\d{0,2})?$/))) return (+m[1])*60 + +(m[2]||0);
  if ((m = s.match(/^(\d{1,2}):(\d{2})$/))) return (+m[1])*60 + +m[2];
  if ((m = s.match(/^(\d+)$/))) return +m[1];
  return 60;
}

function addMinutes(date, mins=0) {
  const d = new Date(date.getTime());
  d.setMinutes(d.getMinutes() + (mins||0));
  return d;
}

// UID RFC 5545
function makeUID() {
  // UID globalement unique, conforme RFC5545
  return `${crypto.randomUUID()}@in-off`;
}

export function rowsToICS(rows, {
  title = 'In & Off',
  onlyReserved = false,
  filename = 'In&Off.ics'
} = {}) {
  const now = new Date();
  const dtstamp = toICSDateUTC(now);

  const filtered = (rows || []).filter(r => {
    if (!onlyReserved) return true;
    const v = String(r?.Reserve || r?.RESERVE || '').toLowerCase();
    return v === 'oui' || v === 'true' || v === 'x';
  });

  const lines = [
    'BEGIN:VCALENDAR',
    'PRODID:-//YourApp//Avignon Off Export//FR',
    'VERSION:2.0',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escICS(title)}`
  ];

  for (const r of filtered) {
    const start = buildDateFromRow(r);
    if (!start) continue;
    const end = addMinutes(start, parseDureeToMin(r.Duree || r['Durée'] || r.Duration || ''));

    const summary = escICS(r.Activite || r['Activité'] || r.Titre || 'Spectacle');
    const location = escICS(r.Theatre || r['Théâtre'] || r.Lieu || '');
    const url = (r.Hyperlien || r.URL || r.Lien || '').toString();
    const description = escICS([r.Auteurs, r.Compagnie, r.Note, url].filter(Boolean).join('\n'));

    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${makeUID()}`);
    lines.push(`DTSTAMP:${dtstamp}`);
    lines.push(`DTSTART:${toICSDateUTC(start)}`);
    lines.push(`DTEND:${toICSDateUTC(end)}`);
    lines.push(`SUMMARY:${summary}`);
    if (location)    lines.push(`LOCATION:${location}`);
    if (description) lines.push(`DESCRIPTION:${description}`);
    if (url)         lines.push(`URL:${escICS(url)}`);
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');

//   // UTF-8 sans BOM + CRLF → compatible Outlook
//   const encoder = new TextEncoder();
//   const blob = new Blob([encoder.encode(lines.join('\r\n') + '\r\n')], { type: 'text/calendar' });
    // UTF-8 avec BOM + CRLF → compatible tous clients y compris Outlook desktop
    const bom = new Uint8Array([0xEF, 0xBB, 0xBF]);   // marqueur BOM UTF-8
    const text = lines.join('\r\n') + '\r\n';
    const encoder = new TextEncoder();
    const blob = new Blob([bom, encoder.encode(text)], {
    type: 'text/calendar;charset=utf-8'
    });

  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
}

// ===============================
//  EXPORT .ICS (Version TZID Europe/Paris)
//  Date: YYYYMMDD  |  Debut: "HH:MM" | "9h30" | "0930" | "9"
// ===============================

// Date locale (sans Z) pour DTSTART/DTEND
const toICSDateLocal = (d) =>
  d.getFullYear()
  + pad2(d.getMonth() + 1)
  + pad2(d.getDate())
  + 'T'
  + pad2(d.getHours())
  + pad2(d.getMinutes())
  + pad2(d.getSeconds());

// Bloc VTIMEZONE (Europe/Paris)
function parisVTZ() {
  return [
    'BEGIN:VTIMEZONE',
    'TZID:Europe/Paris',
    'X-LIC-LOCATION:Europe/Paris',
    'BEGIN:DAYLIGHT',
    'TZOFFSETFROM:+0100',
    'TZOFFSETTO:+0200',
    'TZNAME:CEST',
    'DTSTART:19700329T020000',
    'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU;BYHOUR=2;BYMINUTE=0;BYSECOND=0',
    'END:DAYLIGHT',
    'BEGIN:STANDARD',
    'TZOFFSETFROM:+0200',
    'TZOFFSETTO:+0100',
    'TZNAME:CET',
    'DTSTART:19701025T030000',
    'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU;BYHOUR=3;BYMINUTE=0;BYSECOND=0',
    'END:STANDARD',
    'END:VTIMEZONE'
  ];
}

// // UID global (RFC5545)
// const makeUID = () => `${crypto.randomUUID()}@in-off`;

// ===== Export principal =====
export function rowsToICS_TZID(rows, {
  title = 'In & Off',
  onlyReserved = false,
  filename = 'In&Off.ics'
} = {}) {
  const now = new Date();
  const dtstamp = toICSDateUTC(now);

  const filtered = (rows || []).filter(r => {
    if (!onlyReserved) return true;
    const v = String(r?.Reserve || r?.RESERVE || '').toLowerCase();
    return v === 'oui' || v === 'true' || v === 'x';
  });

  const lines = [
    'BEGIN:VCALENDAR',
    'PRODID:-//YourApp//Avignon Off Export//FR',
    'VERSION:2.0',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escICS(title)}`,
    ...parisVTZ() // <<< bloc VTIMEZONE
  ];

  for (const r of filtered) {
    const start = buildDateFromRow(r);
    if (!start) continue;
    const end = addMinutes(start, parseDureeToMin(r.Duree || r['Durée'] || r.Duration || ''));

    const summary = escICS(r.Activite || r['Activité'] || r.Titre || 'Spectacle');
    const location = escICS(r.Theatre || r['Théâtre'] || r.Lieu || '');
    const url = (r.Hyperlien || r.URL || r.Lien || '').toString();
    const description = escICS([r.Auteurs, r.Compagnie, r.Note, url].filter(Boolean).join('\n'));

    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${makeUID()}`);
    lines.push(`DTSTAMP:${dtstamp}`);
    lines.push(`DTSTART;TZID=Europe/Paris:${toICSDateLocal(start)}`);
    lines.push(`DTEND;TZID=Europe/Paris:${toICSDateLocal(end)}`);
    lines.push(`SUMMARY:${summary}`);
    if (location)    lines.push(`LOCATION:${location}`);
    if (description) lines.push(`DESCRIPTION:${description}`);
    if (url)         lines.push(`URL:${escICS(url)}`);
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');

  // UTF-8 **avec BOM** + CRLF → Outlook classique OK
  const bom = new Uint8Array([0xEF, 0xBB, 0xBF]);
  const text = lines.join('\r\n') + '\r\n';
  const encoder = new TextEncoder();
  const blob = new Blob([bom, encoder.encode(text)], {
    type: 'text/calendar;charset=utf-8'
  });

  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
}
