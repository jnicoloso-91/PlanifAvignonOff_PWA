// parsers.js

import { 
  mmToHHhMM,
} from './utils-date.js';

/**
 * Objets retournes par les parsers
 */
export const PARSED_DEFAULT = {
    Activite: null,
    Debut: null,    // "HHhMM"
    Duree: null,    // "HhMM"
    Lieu: null,
    Sessions: null,
    Relaches: null,
    Style: null,
    Orga: null,
    Hyperlien: null
};

/**
 * Parser HTML d'une page programme du catalogue Avignon In
 * @param {*} doc 
 * @returns 
 */
export function parseAvignonInProgPageHtml(doc) {
  const pad2 = n => String(Number(n)||0).padStart(2,'0');

  // petits utilitaires
  const getText = sel => doc.querySelector(sel)?.textContent || '';
  const pickMonth = s => {
    const m = String(s).toLowerCase().match(/\b(janvier|fevrier|février|mars|avril|mai|juin|juillet|aout|août|septembre|octobre|novembre|decembre|décembre)\b/);
    return m ? pad2(MOIS[m[1]]) : null;
  };
  const minutesToHhmm = (mins) => {
    const m = Math.max(0, Number(mins)||0), h = Math.floor(m/60), mm = m%60;
    return `${h}h${String(mm).padStart(2,'0')}`;
  };

  const results = [];
  // Heuristique: blocs contenant "Archive 20xx"
  doc.querySelectorAll('section, article, .bloc, .card').forEach(bloc => {
    const txt = bloc.textContent.replace(/\s+/g,' ').trim();
    if (!/\bArchive\s+\d{4}\b/i.test(txt)) return;

    // Titre = premier Hx dans le bloc
    const activite = bloc.querySelector('h1,h2,h3')?.textContent.trim() || null;

    // Dates = ligne avec "<jour(s)> <mois> <année>"
    const lineDates = [...bloc.querySelectorAll('p, li, div, span')]
      .map(x=>x.textContent.trim())
      .find(s => /\b(janvier|fevrier|février|mars|avril|mai|juin|juillet|aout|août|septembre|octobre|novembre|decembre|décembre)\b\s+\d{4}/i.test(s));

    let Sessions = null;
    if (lineDates) {
      const mm = pickMonth(lineDates) || '07';
      const before = lineDates.split(/\b(janvier|fevrier|février|mars|avril|mai|juin|juillet|aout|août|septembre|octobre|novembre|decembre|décembre)\b/i)[0]
        .replace(/\bet\b/gi, ',').replace(/[·\.]/g, ',');
      const days = before.split(',').map(x => (x.match(/(\d{1,2})\s*$/)||[])[1]).filter(Boolean).map(d=>pad2(d));
      if (days.length === 1) Sessions = `${days[0]}/${mm}`;
      else if (days.length > 1) Sessions = `(${days.join(',')})/${mm}`;
    }

    // Lieu = un élément “lieu/salle” (à affiner selon DOM réel)
    const Lieu = bloc.querySelector('[class*="salle"], [class*="lieu"], [class*="site"]')?.textContent.trim() || null;

    // Durée
    let Duree = null;
    const durLine = [...bloc.querySelectorAll('p, li, div, span')]
      .map(x=>x.textContent)
      .find(s => /dur[ée]e?\s*:|(\d{1,3})\s*m(?:in)?s?\b|\b\d{1,2}h(\d{0,2})\b/i.test(s||''));
    if (durLine) {
      const mH = durLine.match(/(\d{1,2})\s*h\s*(\d{0,2})\b/i);
      const mM = durLine.match(/(\d{1,3})\s*m(?:in)?s?\b/i);
      if (mH) {
        const h = Number(mH[1])||0, mm = mH[2] ? Number(mH[2]) : 0;
        Duree = `${h}h${String(mm).padStart(2,'0')}`;
      } else if (mM) {
        Duree = minutesToHhmm(Number(mM[1])||0);
      }
    }

    // Style (tags)
    const Style = [...bloc.querySelectorAll('.liste-tags .tag, .tags .tag')]
      .map(x => x.textContent.trim())
      .filter(Boolean)
      .join(' ') || null;

    if (activite && (Sessions || Lieu || Duree)) {
      results.push({ 
        ...PARSED_DEFAULT, 
        Activite: activite, 
        Sessions, 
        Lieu, 
        Duree, 
        Style, 
        Orga:'In',
      });
    }
  });

  return results;
}

/**
 * Parser HTML d'une page programme du catalogue Avignon Off 
 * @param {*} doc 
 * @returns 
 */
export function parseAvignonOffProgPageHtml(doc) {
  const pad2 = n => String(Number(n)||0).padStart(2,'0');

  const minutesToHhmm = (mins) => {
    const m = Math.max(0, Number(mins)||0), h = Math.floor(m/60), mm = m%60;
    return `${h}h${String(mm).padStart(2,'0')}`;
  };
  const normalizeHhmmLoose = (s) => {
    const m = String(s||'').match(/^(\d{1,2})h(\d{0,2})$/i);
    if (!m) return null;
    return `${Number(m[1])}h${String(m[2] ? Number(m[2]) : 0).padStart(2,'0')}`;
  };
  const parseMonthYear = (s) => {
    const m = String(s||'').toLowerCase().match(/\b(janvier|fevrier|février|mars|avril|mai|juin|juillet|aout|août|septembre|octobre|novembre|decembre|décembre)\b(?:\s+(\d{4}))?/i);
    if (!m) return {mm:null, yyyy:null};
    return { mm: MOIS[m[1]] ? pad2(MOIS[m[1]]) : null, yyyy: m[2] || null };
  };

  const items = [];
  // Sélecteurs assez permissifs sur OFF cat
  doc.querySelectorAll('.vignette-spectacle, .carte-spectacle, article, .spectacle').forEach(card => {
    // 1) Titre
    const titre = card.querySelector('h2, h3, .titre, .card-title')?.textContent.trim() || null;

    // 2) Ligne info (Lieu + dates + heures)
    const infoNode = card.querySelector('.lieu-dates, .meta, .salle-date, .infos, .baseline');
    const info = infoNode?.textContent.replace(/\s+/g,' ').trim() || '';

    // 3) Style (tags)
    const style = [...card.querySelectorAll('.liste-tags .tag, .tags .tag')]
      .map(t => t.textContent.trim())
      .filter(Boolean)
      .join(' ') || null;

    // 4) Hyperlien (si dispo)
    const href = card.querySelector('a[href]')?.getAttribute('href') || null;

    // 5) Extraire Lieu / Sessions / Heures / Durée
    let lieu = info;
    // couper avant " du " / " le " / 1er horaire
    const low = info.toLowerCase();
    let cut = -1;
    const iDu = low.indexOf(' du '), iLe = low.indexOf(' le ');
    if (iDu > -1) cut = iDu; else if (iLe > -1) cut = iLe;
    if (cut === -1) {
      const mH = info.match(/\b\d{1,2}h\d{0,2}\b/i);
      if (mH) cut = info.indexOf(mH[0]);
    }
    if (cut > 0) lieu = info.slice(0, cut).trim();

    // sessions
    const { mm } = parseMonthYear(info);
    const monthOut = mm || '07';
    let sessions = null;
    const mDuAu = info.match(/\bdu\s+(\d{1,2})\s+au\s+(\d{1,2})\b/i);
    const mLe   = info.match(/\ble\s+(\d{1,2})\b/i);
    if (mDuAu) {
      sessions = `[${pad2(+mDuAu[1])}-${pad2(+mDuAu[2])}]/${monthOut}`;
    } else if (mLe) {
      const d = pad2(+mLe[1]);
      sessions = `[${d}-${d}]/${monthOut}`;
    }

    // heures & durée
    let Debut = null, Duree = null;
    const hTokens = [...info.matchAll(/\b(\d{1,2})h(\d{0,2})\b/gi)]
      .map(m => ({ t: normalizeHhmmLoose(`${m[1]}h${m[2]??''}`), idx: m.index }))
      .filter(x => x.t);
    const mTokens = [...info.matchAll(/\b(\d{1,3})\s*m(?:in)?s?\b/gi)]
      .map(m => ({ mins: Number(m[1]), idx: m.index }));

    if (hTokens.length) {
      Debut = hTokens[0].t;
      const startPos = hTokens[0].idx ?? 0;
      const durH = hTokens.find((x,i)=> i>0 && x.idx > startPos);
      if (durH) Duree = durH.t;
      else if (mTokens.length) Duree = minutesToHhmm(mTokens.find(x=>x.idx>startPos)?.mins ?? mTokens[0].mins);
    } else if (mTokens.length) {
      Duree = minutesToHhmm(mTokens[0].mins);
    }

    // push
    if (titre) {
      items.push({
        ...PARSED_DEFAULT,
        Activite: titre,
        Lieu: lieu || null,
        Sessions: sessions,
        Debut: Debut,
        Duree: Duree,
        Style: style,
        Orga: 'Off',
        Hyperlien: href
      });
    }
  });

  return items;
}

/**
 * Parser HTML d'une page spectacle du catalogue Avignon Off 
 * parseListingHtml(html, { url })
 * @param {string} html
 * @param {{url?: string}} opts
 * @return {{Activite:string|null, Lieu:string|null, Relaches:string|null, Debut:string|null, Duree:string|null, Hyperlien:string|null}}
 */
export function parseAvignonOffSpecPageHtml(html, { url=null } = {}) {
  const res = {...PARSED_DEFAULT};
  if (!html || typeof html !== 'string') return res;

  let doc;
  try { doc = new DOMParser().parseFromString(html, 'text/html'); }
  catch { return res; }

  // Activité
  const titleTxt = _clean(doc.querySelector('title')?.textContent || "");
  if (titleTxt) {
    const part = titleTxt.split('–')[0].split('-')[0].trim();
    res.Activite = part || titleTxt;
  }

  // Style = 1er tag dans .intro-spectacle > .liste-tags
  {
    const tagEl = doc.querySelector('.intro-spectacle .liste-tags .tag');
    if (tagEl) {
      const styleTxt = tagEl.textContent.trim().replace(/\s+/g, ' ');
      if (styleTxt) res.Style = styleTxt;
    }
  }

  // Lieu
  const lieuSection = doc.querySelector('section.lieu-spectacle');
  if (lieuSection) {
    const aTheatre = lieuSection.querySelector('a[href*="/theatres/"]') || lieuSection.querySelector('a');
    const lieuTxt = _clean(aTheatre?.textContent || "");
    if (lieuTxt) res.Lieu = lieuTxt;
  }

  // Infos (Relâche / Début / Durée)
  const infos = doc.querySelector('section.infos-spectacle');
  if (infos) {
    const spans = Array.from(infos.querySelectorAll('span'))
      .map(s => _clean(s.textContent || ''))
      .filter(Boolean);

    // Concat pour matcher les patterns "du X au Y..., (relâche )? jours pairs/impairs"
    const bigText = spans.join(' • ');

    // Heures
    for (const s of spans) {
      if (!res.Debut) {
        const h = _normalizeHeure(s);
        if (h) { res.Debut = h; continue; }
      }
      if (!res.Duree) {
        const d = _normalizeDuree(s);
        if (d) { res.Duree = d; continue; }
      }
    }

    // Relâche = (liste explicite) + (période + parité interprétée)
    const parts = [];
    const explicite = _parseRelaches(bigText);
    if (explicite) parts.push(explicite);

    const relachesParite = _parseRelachesAvecParite(bigText);
    if (relachesParite) parts.push(relachesParite);

    if (parts.length) res.Relaches = parts.join(', ');
  
    const sessions = _parseSessions(bigText);
    if (sessions && sessions.length) res.Sessions = sessions;
  }

  res.Orga = "Off";

  return [res];
}



/**
 * Parse le texte brut de la page catalogue Avignon In.
 * @param {*} text 
 * @returns 
 */
// export function parseAvignonInProgPageText(text) {
//   if (!text) return [];

//   // ---- Découpage en blocs (entre 2 lignes "Archive YYYY") ----
//   const lines = String(text).replace(/\r\n?/g, '\n').split('\n'); // on garde les lignes vides
//   const reArchive = /^archive\s+\d{4}$/i;

//   // indices des lignes "Archive YYYY"
//   const archIdx = [];
//   for (let i = 0; i < lines.length; i++) {
//     if (reArchive.test(lines[i]?.trim())) archIdx.push(i);
//   }
//   if (!archIdx.length) return [];

//   const results = [];

//   for (let a = 0; a < archIdx.length; a++) {
//     const endIdx = archIdx[a];                        // position de "Archive YYYY"
//     const startIdx = (a > 0 ? archIdx[a - 1] + 1 : 0); // début de bloc = après l'archive précédente

//     // extrait les lignes du bloc (sans l'archive de fin)
//     const block = lines.slice(startIdx, endIdx);

//     // indices des lignes non vides du bloc
//     const nonEmptyIdx = [];
//     for (let i = 0; i < block.length; i++) {
//       if (_isNonEmpty(block[i])) nonEmptyIdx.push(i);
//     }
//     if (nonEmptyIdx.length < 3) continue; // bloc trop court pour être fiable

//     // --- TITRE : première non-vide du bloc ---
//     const iTitre = nonEmptyIdx[0];
//     const Activite = _stripQuotes(block[iTitre]);

//     // --- DATES : chercher depuis le bas la 1re ligne qui parse comme dates ---
//     let iDate = -1, Sessions = null;
//     for (let k = nonEmptyIdx.length - 1; k >= 0; k--) {
//       const idx = nonEmptyIdx[k];
//       const parsed = _parseDates(block[idx]);
//       if (parsed && parsed.sessions) {
//         iDate = idx;
//         Sessions = parsed.sessions;
//         break;
//       }
//     }
//     if (iDate < 0) continue; // sans dates, on ignore le bloc

//     // --- LIEU : 1re non-vide **sous** la ligne des dates ---
//     let iLieu = -1;
//     for (let i = iDate + 1; i < block.length; i++) {
//       if (_isNonEmpty(block[i])) { iLieu = i; break; }
//     }
//     if (iLieu < 0) continue;
//     const Lieu = block[iLieu].trim();

//     // --- DURÉE (optionnelle) : d’abord sous le lieu (bas de bloc), sinon entre lieu et dates ---
//     let Duree = null;
//     // zone sous le lieu
//     for (let i = block.length - 1; i > iLieu; i--) {
//       const t = block[i]?.trim(); if (!t) continue;
//       const d = _parseDuree(t);
//       if (d) { Duree = d; break; }
//     }
//     // fallback entre lieu et dates (rare)
//     if (!Duree) {
//       for (let i = iLieu - 1; i > iDate; i--) {
//         const t = block[i]?.trim(); if (!t) continue;
//         const d = _parseDuree(t);
//         if (d) { Duree = d; break; }
//       }
//     }

//     // --- STYLE : remonter **au-dessus** des dates, ignorer "Avec ..." et les lignes longues ---
//     // let iStyle = -1;
//     // for (let i = iDate - 1; i >= 0; i--) {
//     //   const t = block[i];
//     //   if (!_isNonEmpty(t)) continue;
//     //   if (/^avec\b/i.test(t)) continue;
//     //   if (!_looksLikeStyle(t)) continue;
//     //   iStyle = i;
//     //   break;
//     // }
//     // 
//     // // fallback : 1re non-vide au-dessus des dates si l'heuristique échoue
//     // if (iStyle < 0) {
//     //   for (let i = iDate - 1; i >= 0; i--) {
//     //     if (_isNonEmpty(block[i])) { iStyle = i; break; }
//     //   }
//     // }
//     // const Style = iStyle >= 0 ? block[iStyle].trim() : null;


//     // --- STYLE --- (gère PC : 1 ligne, et iPhone : bloc de puces)
//     const isBulletLine = (t) => /^[\u2022•\-\*]\s+/.test(t); // •, -, *
//     const bulletText = (t) => t.replace(/^[\u2022•\-\*]\s+/, '').trim();
//     const isAvecLine = (t) => /^avec\b/i.test(t);
//     const isReadMore = (t) => /^en savoir plus\b/i.test(t);

//     // Heuristique “nom de personne” : 2+ mots, chacun Capitalisé (gère accents et tirets)
//     const isPersonName = (t) => {
//       const w = t.trim().split(/\s+/);
//       if (w.length < 2) return false;
//       const rxWord = /^[A-ZÀÂÄÇÉÈÊËÎÏÔÖÙÛÜŸ][a-zàâäçéèêëîïôöùûüÿ'’\-]+$/;
//       return w.every(s => rxWord.test(s));
//     };

//     // Mise en forme : première majuscule, reste en minuscule
//     const normalizeStyleCase = (s) => {
//       const parts = s.trim().split(/\s+/);
//       if (!parts.length) return s.trim();
//       const head = parts[0].charAt(0).toUpperCase() + parts[0].slice(1).toLowerCase();
//       const tail = parts.slice(1).map(x => x.toLowerCase());
//       return [head, ...tail].join(' ');
//     };

//     let Style = null;

//     // 1) Chercher un bloc de puces CONTIGÜ juste au-dessus des dates (format iPhone)
//     let topBullet = -1, bottomBullet = -1;
//     for (let i = iDate - 1; i >= 0; i--) {
//       const t = block[i] && block[i].trim();
//       if (!t || isReadMore(t)) continue;            // saute vides et "En savoir plus"
//       if (isBulletLine(t)) {
//         // étendre vers le haut tant que c'est des puces (pour attraper le bloc entier)
//         bottomBullet = (bottomBullet === -1) ? i : bottomBullet;
//         topBullet = i;
//         continue;
//       }
//       // si on a déjà vu des puces et on tombe sur autre chose -> on s'arrête
//       if (bottomBullet !== -1) break;
//     }

//     if (bottomBullet !== -1) {
//       // on a un bloc [topBullet..bottomBullet] de puces : extraire les items
//       const items = [];
//       for (let i = topBullet; i <= bottomBullet; i++) {
//         const t = bulletText(block[i].trim());
//         if (!t || isAvecLine(t)) continue;
//         items.push(t);
//       }

//       // garder les items jusqu’au premier “nom de personne”
//       const styleTokens = [];
//       for (const it of items) {
//         if (isPersonName(it)) break;           // stop à l’auteur
//         styleTokens.push(it);
//       }

//       if (styleTokens.length) {
//         Style = normalizeStyleCase(styleTokens.join(' ')); // ex. "Spectacle pluridisciplinaire"
//       }
//     }

//     // 2) Fallback PC : une seule ligne “style” directement au-dessus des dates
//     if (!Style) {
//       // heuristique “ligne courte, pas 'Avec', pas bullet, pas read-more”
//       for (let i = iDate - 1; i >= 0; i--) {
//         const t = block[i] && block[i].trim();
//         if (!t) continue;
//         if (isReadMore(t) || isBulletLine(t) || isAvecLine(t)) continue;
//         if (t.length > 60) continue;                // trop descriptif
//         if (isPersonName(t)) continue;              // éviter l’auteur
//         Style = normalizeStyleCase(t);
//         break;
//       }
//     }

//     // fallback ultime : prendre la 1re non-vide au-dessus des dates (si rien trouvé)
//     if (!Style) {
//       for (let i = iDate - 1; i >= 0; i--) {
//         const t = block[i] && block[i].trim();
//         if (t && !isReadMore(t)) { Style = t; break; }
//       }
//     }
//     // Fin STYLES

//     results.push({
//       ...PARSED_DEFAULT,
//       Activite,
//       Style,
//       Lieu,
//       Duree: Duree || null,
//       Sessions: Sessions || null,
//       Debut: null,
//       Relaches: null,
//       Orga: 'In',
//       Hyperlien: null
//     });
//   }

//   return results;
// }
// ===== PARSEUR AVIGNON IN – compatible PC & iPhone (puces) =====

export function parseAvignonInProgPageText(text) {

  if (!text) return [];

  // ---- Helpers locaux ----
  // const _pad3 = n => String(Number(n) || 0).padStart(2, '0');
  // const _normSpaces = s => String(s || '').replace(/[\u00A0\u2000-\u200B]/g, ' ');
  // const _stripQuotes = s => String(s || '').replace(/^[\s"'«]+|[\s"'»]+$/g, '').trim();
  // const _isNonEmpty = s => !!(s && String(s).trim());

  // Normalisation entrée (espaces & accents)
  const normIn = (s) => String(s || '')
    .replace(/[\u00A0\u202F\u2000-\u200B]/g, ' ')  // NBSP, NARROW NBSP, etc. → espace
    .replace(/[‐-‒–—]/g, '-')                      // tous les tirets → '-'
    .replace(/\s+/g, ' ')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .trim();

  // --- Constante MOIS (numérique) ---
  // const MOIS = {
  //   janvier: 1, fevrier: 2, 'février': 2, mars: 3, avril: 4, mai: 5, juin: 6,
  //   juillet: 7, aout: 8, 'août': 8, septembre: 9, octobre: 10, novembre: 11,
  //   decembre: 12, 'décembre': 12
  // };

  // --- Parser durée -> "HhMM" ---
  const parseDuree = (line) => {
    if (!line) return null;
    const txt = normIn(line).toLowerCase().replace(/^duree?\s*:/i, '').trim();
    const mh = txt.match(/(\d{1,2})\s*h\s*(\d{0,2})\b/);
    if (mh) {
      const h = Number(mh[1]) || 0;
      const mm = mh[2] ? Number(mh[2]) : 0;
      return `${h}h${_pad3(mm)}`;
    }
    const mm = txt.match(/(\d{1,3})\s*m(?:in)?s?\b/);
    if (mm) {
      const mins = Number(mm[1]) || 0;
      const h = Math.floor(mins / 60), m = mins % 60;
      return `${h}h${_pad3(m)}`;
    }
    return null;
  };

  // --- Parser dates -> { sessions, year } ---
  // Ex:
  //  - "vendredi 11 juillet 2025"         -> "11/07"
  //  - "8, 9, 10 ... juillet 2025"        -> "(08,09,10,...)/07"
  //  - "9, 10 et 11 juillet 2025"         -> "(09,10,11)/07"
  const parseDatesShort = (line) => {
    if (!line) return { sessions: null, year: null };
    const raw = _normSpaces(line).trim();

    const reMY = /\b(janvier|fevrier|février|mars|avril|mai|juin|juillet|aout|août|septembre|octobre|novembre|decembre|décembre)\b\s+(\d{4})/i;
    const mMY = raw.match(reMY);
    if (!mMY) return { sessions: null, year: null };

    const monthTxt = mMY[1].toLowerCase();
    const year = mMY[2];
    const mNum = MOIS[monthTxt];
    if (!mNum) return { sessions: null, year: null };
    const mm = _pad3(mNum);

    const before = raw.slice(0, mMY.index)
      .replace(/\bet\b/gi, ',')
      .replace(/[·\.]/g, ',');  // médian/points → virgules
    const daySeq = before
      .replace(/\bet\b/gi, ',')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
      .map(x => x.match(/(\d{1,2})\s*$/)?.[1])
      .filter(Boolean)
      .map(n => _pad3(n));

    if (daySeq.length === 0) return { sessions: null, year };

    // dédoublonne en préservant l'ordre
    const seen = new Set();
    const days = daySeq.filter(d => (seen.has(d) ? false : (seen.add(d), true)));

    const sessions = (days.length === 1)
      ? `${days[0]}/${mm}`
      : `(${days.join(',')})/${mm}`;

    return { sessions, year };
  };

  // --- Helpers de détection Style (iPhone vs PC) ---
  const isReadMore = t =>
    /^(en savoir plus|voir plus|plus d'infos)/i.test((t||'').trim());
  const isAvecLine   = t => /^avec\b/i.test((t||'').trim());
  const isBulletLine = (t) => {
    const s = (t || '');
    // tabs en tête OU puces unicode OU tirets normalisés
    return /^\t+/.test(s) || /^[\s]*[•\*\-]\s+/.test(s);
  };
  const bulletText = (t) =>
    String(t || '').replace(/^[\s\t]*[•\*\-]\s+/, '').trim();
  const isPersonName = (t) => {
    const w = (t || '').trim().split(/\s+/);
    if (w.length < 2) return false;
    const rx = /^[A-ZÀÂÄÇÉÈÊËÎÏÔÖÙÛÜŸ][a-zàâäçéèêëîïôöùûüÿ'’\-]+$/;
    return w.every(x => rx.test(x));
  };
  const normalizeStyleCase = (s) => {
    const parts = (s || '').trim().split(/\s+/);
    if (!parts.length) return (s || '').trim();
    const head = parts[0].slice(0,1).toUpperCase() + parts[0].slice(1).toLowerCase();
    const tail = parts.slice(1).map(x => x.toLowerCase());
    return [head, ...tail].join(' ');
  };
  function getBulletRangeAbove(block, iDate) {
    let bottom = -1, top = -1;
    for (let i = iDate - 1; i >= 0; i--) {
      const t = block[i]?.trim();
      if (!t || isReadMore(t)) continue;
      if (isBulletLine(block[i])) {
        bottom = (bottom === -1) ? i : bottom;
        top = i;
        continue;
      }
      if (bottom !== -1) break;
    }
    return (bottom !== -1) ? { top, bottom } : null;
  }
  function detectBlockFlavor(block, iDate) {
    const r = getBulletRangeAbove(block, iDate);
    return r ? { flavor: 'iphone-bullets', range: r } : { flavor: 'pc-line', range: null };
  }

  // --- Découpage en blocs ---
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n'); // on garde vides
  const reArchive = /^archive\s+\d{4}$/i;

  const archIdx = [];
  for (let i = 0; i < lines.length; i++) {
    if (reArchive.test((lines[i]||'').trim())) archIdx.push(i);
  }
  if (!archIdx.length) return [];

  const results = [];

  for (let a = 0; a < archIdx.length; a++) {
    const endIdx = archIdx[a];
    const startIdx = (a > 0 ? archIdx[a - 1] + 1 : 0);
    const block = lines.slice(startIdx, endIdx);

    const nonEmptyIdx = [];
    for (let i = 0; i < block.length; i++) {
      if (_isNonEmpty(block[i])) nonEmptyIdx.push(i);
    }
    if (nonEmptyIdx.length < 3) continue;

    // --- Activité (titre) ---
    const iTitre = nonEmptyIdx[0];
    const Activite = _stripQuotes(block[iTitre]);

    // --- Dates ---
    let iDate = -1, Sessions = null;
    for (let k = nonEmptyIdx.length - 1; k >= 0; k--) {
      const idx = nonEmptyIdx[k];
      const parsed = parseDatesShort(block[idx]);
      if (parsed && parsed.sessions) {
        iDate = idx;
        Sessions = parsed.sessions;
        break;
      }
    }
    if (iDate < 0) continue;

    // --- Lieu ---
    let iLieu = -1;
    for (let i = iDate + 1; i < block.length; i++) {
      if (_isNonEmpty(block[i])) { iLieu = i; break; }
    }
    if (iLieu < 0) continue;
    const Lieu = block[iLieu].trim();

    // --- Durée (optionnelle) ---
    let Duree = null;
    for (let i = block.length - 1; i > iLieu; i--) {
      const t = block[i]?.trim(); if (!t) continue;
      const tClean = String(t).split(/\bArchive\s+\d{4}\b/i)[0].trim();
      const d = parseDuree(tClean);
      if (d) { Duree = d; break; }
    }
    if (!Duree) {
      for (let i = iLieu - 1; i > iDate; i--) {
        const t = block[i]?.trim(); if (!t) continue;
        const d = parseDuree(t);
        if (d) { Duree = d; break; }
      }
    }

    // --- STYLE (auto iPhone vs PC) ---
    let Style = null;
    const det = detectBlockFlavor(block, iDate);

    if (det.flavor === 'iphone-bullets') {
      const { top, bottom } = det.range;
      const items = [];
      for (let i = top; i <= bottom; i++) {
        let t = bulletText(block[i]);
        if (!t) continue;
        if (isAvecLine(t)) continue;
        if (isPersonName(t)) break; // on s'arrête au 1er item -> auteur
        items.push(t);
      }
      if (items.length) {
        Style = normalizeStyleCase(items.join(' ')); // ex. "Spectacle pluridisciplinaire"
      }
    } else {
      // PC : 1 ligne « style » au-dessus des dates, filtrée
      for (let i = iDate - 1; i >= 0; i--) {
        const t = block[i]?.trim();
        if (!t) continue;
        if (isReadMore(t) || isAvecLine(t) || isBulletLine(t)) continue;
        if (t.length > 60) continue;     // trop descriptif
        if (isPersonName(t)) continue;   // éviter l’auteur
        Style = normalizeStyleCase(t);
        break;
      }
    }

    // Fallback ultime : 1re non-vide au-dessus des dates (si rien trouvé)
    if (!Style) {
      for (let i = iDate - 1; i >= 0; i--) {
        const t = block[i]?.trim();
        if (t && !isReadMore(t)) { Style = t; break; }
      }
    }

    results.push({
      ...PARSED_DEFAULT,
      Activite,
      Style,
      Lieu,
      Duree: Duree || null,
      Sessions: Sessions || null,
      Debut: null,
      Relaches: null,
      Orga: 'In',
      Hyperlien: null,
    });
  }

  return results;
}

/**
 * Parse le texte brut de la page catalogue Avignon Off.
 * Recherche des séquences du type :
 *   Affiche du spectacle : <Titre>
 *   <Titre>                (parfois répété)
 *   <Lieu> du <d1> au <d2> <HHhMM> <HhMM>
 *   <Style>
 *   Ticket'Off (ligne suivante – ignorée ici)
 *
 * Renvoie: Array<{...PARSED_DEFAULT}>
 */
// export function parseAvignonOffProgPageText(text) {
//   if (!text) return [];
//   const rawLines = String(text).replace(/\r\n?/g, '\n').split('\n');
//   const lines = rawLines.map(s => _strip(s)); // on garde les vides pour sauter proprement
//   const out = [];

//   for (let i = 0; i < lines.length; i++) {
//     const l1 = lines[i];
//     if (!/^\s*affiche du spectacle\b/i.test(l1)) continue;

//     // Ligne 2 : Titre (première ligne non vide après l1)
//     let j = i + 1;
//     while (j < lines.length && !lines[j]) j++;
//     if (j >= lines.length) break;
//     const Activite = _stripQuotes(lines[j]);
//     j++;

//     // Ligne 3 : Info (première ligne non vide après)
//     while (j < lines.length && !lines[j]) j++;
//     if (j >= lines.length) break;
//     const infoLine = lines[j];
//     const { Lieu, Sessions, Debut, Duree } = _parseInfoLine(infoLine);
//     j++;

//     // Ligne 4 : Style (première ligne non vide après)
//     while (j < lines.length && !lines[j]) j++;
//     let Style = null;
//     if (j < lines.length) {
//       const s = lines[j];
//       if (!/^ticket'?off\b/i.test(s) && !/^\s*affiche du spectacle\b/i.test(s)) {
//         Style = s;
//       }
//     }

//     out.push({
//       ...PARSED_DEFAULT,
//       Activite,
//       Lieu: Lieu || null,
//       Sessions: Sessions || null,
//       Debut: Debut || null,
//       Duree: Duree || null,
//       Style: Style || null,
//       Relaches: null,
//       Orga: "Off",
//       Hyperlien: null
//     });

//     // Avancer i jusqu'au début du prochain bloc pour éviter rescan inutile
//     i = j;
//   }

//   return out;
// }
// export function parseAvignonOffProgPageText(text) {
//   if (!text) return [];
//   const lines = String(text).replace(/\r\n?/g, '\n').split('\n').map(l => l.trim());
//   const out = [];

//   const reAffiche = /\baffiche du spectacle\b/i;
//   const reDuAu    = /\bdu\s+(\d{1,2})\s+au\s+(\d{1,2})\b/i;
//   const reLe      = /\ble\s+(\d{1,2})\b/i;

//   for (let i = 0; i < lines.length; i++) {
//     const l = lines[i];
//     const isBlockStart = reAffiche.test(l) || _isImageLine(l);
//     if (!isBlockStart) continue;

//     // --- 1) ACTIVITÉ : 1ère ligne non vide après le marqueur (sauter images) ---
//     let j = i + 1;
//     while (j < lines.length && (!lines[j] || _isImageLine(lines[j]))) j++;
//     if (j >= lines.length) break;
//     const activite = lines[j].replace(/^["«]+|["»]+$/g, '').trim();
//     j++;

//     // Skip répétition/variante du titre
//     const activiteNorm = activite.toLowerCase();
//     while (j < lines.length) {
//       const l2 = lines[j];
//       if (!l2) { j++; continue; }
//       if (_isImageLine(l2)) { j++; continue; }
//       const l2n = l2.replace(/^["«]+|["»]+$/g, '').trim().toLowerCase();
//       if (l2n === activiteNorm || l2n.startsWith(activiteNorm + ' ')) { j++; continue; }
//       break;
//     }

//     // --- 2) LIEU + DATES + HEURE/DURÉE : prochaine ligne "info" ---
//     let lieu = null, debut = null, duree = null, sessions = null;
//     let foundIdx = -1;
//     for (let k = j; k < lines.length; k++) {
//       const lk = lines[k];
//       if (!lk) continue;
//       if (reAffiche.test(lk) || _isImageLine(lk)) break; // nouveau bloc
//       if (reDuAu.test(lk) || reLe.test(lk) || /\b\d{1,2}h\d{0,2}\b/i.test(lk) || /\b\d{1,3}\s*m(?:in)?s?\b/i.test(lk)) {
//         foundIdx = k; break;
//       }
//     }

//     if (foundIdx !== -1) {
//       const info = lines[foundIdx];

//       // Lieu = avant " du " / " le " ; sinon avant 1ère heure
//       const loTxt = info.toLowerCase();
//       let cut = -1;
//       const loDu = loTxt.indexOf(' du ');
//       const loLe = loTxt.indexOf(' le ');
//       if (loDu > -1) cut = loDu;
//       else if (loLe > -1) cut = loLe;
//       if (cut === -1) {
//         const mH = info.match(/\b\d{1,2}h\d{0,2}\b/i);
//         if (mH) cut = info.indexOf(mH[0]);
//       }
//       lieu = (cut > 0 ? info.slice(0, cut) : info).trim();

//       // Mois/année réels
//       const { mm } = _parseMonthYear(info);
//       const monthOut = mm || '07';

//       // Sessions
//       const mDuAu = info.match(reDuAu);
//       const mLe   = info.match(reLe);
//       if (mDuAu) {
//         const d1 = _pad3(+mDuAu[1]);
//         const d2 = _pad3(+mDuAu[2]);
//         sessions = `[${d1}-${d2}]/${monthOut}`;
//       } else if (mLe) {
//         const d = _pad3(+mLe[1]);
//         sessions = `[${d}-${d}]/${monthOut}`;
//       }

//       // Heures & Durée
//       const hTokens = [...info.matchAll(/\b(\d{1,2})h(\d{0,2})\b/gi)]
//         .map(m => ({ t: _normalizeHhmmLoose(`${m[1]}h${m[2] ?? ''}`), idx: m.index }))
//         .filter(x => x.t); // garde uniquement ceux normalisés correctement

//       const mTokens = [...info.matchAll(/\b(\d{1,3})\s*m(?:in)?s?\b/gi)]
//         .map(m => ({ mins: Number(m[1]), idx: m.index }));

//       if (hTokens.length >= 1) {
//         // premier "HhMM" = Début
//         debut = hTokens[0].t;
//         const startPos = hTokens[0].idx ?? 0;

//         // chercher une seconde "HhMM" après le début pour la Durée, sinon "NN min"
//         const durH = hTokens.find((x, n) => n > 0 && x.idx > startPos);
//         if (durH) {
//           duree = durH.t; // déjà normalisé
//         } else {
//           const durM = mTokens.find(x => x.idx > startPos) || mTokens[0];
//           if (durM) duree = mmToHHhMM(durM.mins);
//         }
//       } else if (mTokens.length) {
//         // pas d'heure, mais une durée en minutes présente
//         duree = mmToHHhMM(mTokens[0].mins);
//       }

//       j = foundIdx + 1;
//     }

//     // --- 3) STYLE : 1ère non-vide après, en sautant Ticket'Off/images ---
//     let style = null;
//     for (let k = j; k < lines.length; k++) {
//       const lk = lines[k];
//       if (!lk) continue;
//       if (/^ticket'?off\b/i.test(lk)) continue;
//       if (reAffiche.test(lk) || _isImageLine(lk)) break; // prochain bloc
//       style = lk.trim();
//       break;
//     }

//     out.push({
//       ...PARSED_DEFAULT,
//       Activite: activite || null,
//       Lieu: lieu || null,
//       Sessions: sessions || null,
//       Debut: debut || null,        // "HhMM" normalisé (ex: 9h00, 10h05)
//       Duree: duree || null,        // "HhMM" normalisé (ex: 0h55, 1h20)
//       Style: style || null,
//       Relaches: null,
//       Hyperlien: null
//     });
//   }

//   return out;
// }
export function parseAvignonOffProgPageText(text) {
  if (!text) return [];
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n').map(l => l.trim());
  const out = [];

  const reAffiche = /\baffiche du spectacle\b/i;         // sans exiger de « : »
  const reDuAu    = /\bdu\s+(\d{1,2})\s+au\s+(\d{1,2})\b/i;
  const reLe      = /\ble\s+(\d{1,2})\b/i;

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const isBlockStart = reAffiche.test(l) || _isImageLine(l);
    if (!isBlockStart) continue;

    // --- 1) ACTIVITÉ : 1ère ligne non vide après (ignorer images) ---
    let j = i + 1;
    while (j < lines.length && (!lines[j] || _isImageLine(lines[j]))) j++;
    if (j >= lines.length) break;
    const activite = lines[j].replace(/^["«]+|["»]+$/g, '').trim();
    j++;

    // sauter une éventuelle répétition immédiate du titre
    const activiteNorm = activite.toLowerCase();
    while (j < lines.length) {
      const l2 = lines[j];
      if (!l2) { j++; continue; }
      if (_isImageLine(l2)) { j++; continue; }
      const l2n = l2.replace(/^["«]+|["»]+$/g, '').trim().toLowerCase();
      if (l2n === activiteNorm || l2n.startsWith(activiteNorm + ' ')) { j++; continue; }
      break;
    }

    // --- 2) LIGNE INFO (Lieu + dates + heure + durée) ---
    let lieu = null, debut = null, duree = null, sessions = null;
    let foundIdx = -1;
    for (let k = j; k < lines.length; k++) {
      const lk = lines[k];
      if (!lk) continue;
      if (reAffiche.test(lk) || _isImageLine(lk)) break; // prochain bloc
      // accepte "du/au", "le", heures "Hh(MM)" ou durées "NN min"
      if (reDuAu.test(lk) || reLe.test(lk) ||
          /\b\d{1,2}h\d{0,2}\b/i.test(lk) || /\b\d{1,3}\s*m(?:in)?s?\b/i.test(lk)) {
        foundIdx = k; break;
      }
    }

    if (foundIdx !== -1) {
      const info = lines[foundIdx];

      // Lieu = avant " du " / " le " ; sinon avant 1ère heure
      const loTxt = info.toLowerCase();
      let cut = -1;
      const loDu = loTxt.indexOf(' du ');
      const loLe = loTxt.indexOf(' le ');
      if (loDu > -1) cut = loDu; else if (loLe > -1) cut = loLe;
      if (cut === -1) {
        const mH = info.match(/\b\d{1,2}h\d{0,2}\b/i);
        if (mH) cut = info.indexOf(mH[0]);
      }
      lieu = (cut > 0 ? info.slice(0, cut) : info).trim();

      // Sessions avec mois réel si présent, sinon fallback (07)
      const { mm } = _parseMonthYear(info);
      const monthOut = mm || '07';
      const mDuAu = info.match(reDuAu);
      const mLe   = info.match(reLe);
      if (mDuAu) {
        const d1 = _pad3(+mDuAu[1]);
        const d2 = _pad3(+mDuAu[2]);
        sessions = `[${d1}-${d2}]/${monthOut}`;
      } else if (mLe) {
        const d = _pad3(+mLe[1]);
        sessions = `[${d}-${d}]/${monthOut}`;
      }

      // Heures & Durée (Hh, HhM, HhMM) + "NN min"
      const hTokens = [...info.matchAll(/\b(\d{1,2})h(\d{0,2})\b/gi)]
        .map(m => ({ t: _normalizeHhmmLoose(`${m[1]}h${m[2] ?? ''}`), idx: m.index }))
        .filter(x => x.t);

      const mTokens = [...info.matchAll(/\b(\d{1,3})\s*m(?:in)?s?\b/gi)]
        .map(m => ({ mins: Number(m[1]), idx: m.index }));

      if (hTokens.length >= 1) {
        // premier horaire = Début
        debut = hTokens[0].t;
        const startPos = hTokens[0].idx ?? 0;

        // Durée : seconde heure après le début, sinon "NN min"
        const durH = hTokens.find((x, n) => n > 0 && x.idx > startPos);
        if (durH) {
          duree = durH.t;
        } else {
          const durM = mTokens.find(x => x.idx > startPos) || mTokens[0];
          if (durM) duree = mmToHHhMM(durM.mins);
        }
      } else if (mTokens.length) {
        // pas d'horaire, mais une durée en minutes
        duree = mmToHHhMM(mTokens[0].mins);
      }

      j = foundIdx + 1;
    }

    // --- 3) STYLE : 1ère non-vide après, en retirant "Ticket'Off" éventuel sur la même ligne ---
    let style = null;
    for (let k = j; k < lines.length; k++) {
      const lk = lines[k];
      if (!lk) continue;
      if (reAffiche.test(lk) || _isImageLine(lk)) break; // prochain bloc
      let s = lk.trim();
      s = s.replace(/\bTicket'?Off\b/i, '').trim(); // <- nettoyage
      if (!s) continue;
      style = s;
      break;
    }

    out.push({
      ...PARSED_DEFAULT,
      Activite: activite || null,
      Lieu: lieu || null,
      Sessions: sessions || null,
      Debut: debut || null,
      Duree: duree || null,
      Style: style || null,
      Relaches: null,
      Orga: 'Off',
      Hyperlien: null
    });
  }

  return out;
}

/**
 * Parser du texte d'une page de description de spectacle du catalogue Avignon Off 
 * @param {*} text 
 * @returns 
 */
export function parseAvignonOffSpecPageText(text) {
  const res = {...PARSED_DEFAULT};
  if (!text) return res;

  const txt = String(text).trim();
  const txtNorm = _norm(txt).toLowerCase();

  // --- Activité : 1re ligne après "programme >" sinon 1re ligne non vide ---
  {
    const m = txt.match(/programme\s*>\s*(.+)/i);
    if (m) {
      const line = m[1].trim().split(/\r?\n/)[0]?.trim();
      if (line) res.Activite = line;
    }
    if (!res.Activite) {
      const lines = txt.split(/\r?\n/);
      for (let raw of lines) {
        const line = raw.trim();
        if (!line) continue;
        if (/festival\s+off\s+avignon\s*>\s*programme/i.test(line)) continue; // saute l'entête
        res.Activite = line;
        break;
      }
    }
  }

  // --- Style : 1re ligne non vide après le titre (en sautant la répétition du titre) ---
  {
    const txt = String(text || '');
    const lines = txt.replace(/\r\n?/g, '\n').split('\n').map(l => l.trim());

    // Helper de normalisation pour comparer des chaînes (accents/casse/espaces)
    const _norm = s => String(s || '')
      .toLowerCase()
      .normalize('NFD').replace(/\p{Diacritic}/gu, '')
      .replace(/\s+/g, ' ')
      .trim();

    // Retrouve l'index du breadcrumb "festival Off Avignon > Programme > ..."
    const idxBreadcrumb = lines.findIndex(l =>
      /^festival\s+off\s+avignon\s*>\s*programme\s*>\s*\S/i.test(l)
    );

    // Détermine l'index de départ pour chercher le Style
    let i = Math.max(0, idxBreadcrumb) + 1;

    // Si la ligne suivante répète le titre, saute-la
    if (res.Activite && i < lines.length && _norm(lines[i]) === _norm(res.Activite)) {
      i++;
    }

    // Avance jusqu'à la 1re ligne non vide significative
    while (i < lines.length) {
      const cand = lines[i];
      if (cand) {
        // Filtrage de quelques libellés parasites fréquents
        if (/^affiche du spectacle\s*:?/i.test(cand)) { i++; continue; }
        if (/^ticket'?off\b/i.test(cand))            { i++; continue; }
        if (/^festival\s+off\s+avignon\s*>/i.test(cand)) { i++; continue; } // sécurité

        res.Style = cand; // ex: "Théâtre classique", "Seul·e en scène", "Humour", etc.
        break;
      }
      i++;
    }
  }


  // --- Lieu : première ligne après 'lieu' jugée pertinente ---
  {
    const m = txt.match(/\blieu\b(.*)/is);
    if (m) {
      const tail = m[1] || '';
      const lines = tail.split(/\r?\n/);
      for (let raw of lines) {
        const cand = raw.trim();
        if (!cand) continue;
        if (/nom de la salle|nombre de places|t[eé]l[eé]phone|programmation|voir toute/i.test(cand)) continue;
        if (cand.length >= 3) {
          res.Lieu = _clean_lieu(cand);
          break;
        }
      }
    }
  }

  // --- Début : première occurrence HHhMM ---
  {
    const m = txtNorm.match(/\b(\d{1,2})h(\d{2})\b/i);
    if (m) {
      const [_, h, mm] = m;
      res.Debut = `${_pad2(h)}h${_pad2(mm)}`;
    }
  }

  // --- Durée : première occurrence HhMM (sans confondre avec "Début") ---
  {
    const m = txtNorm.match(/\b(\d{1,2})h(\d{2})\b/i);
    if (m) {
      const h = parseInt(m[1],10), mm = parseInt(m[2],10);
      const cand = `${h}h${_pad2(mm)}`;

      if (res.Debut && res.Debut.toLowerCase() === `${_pad2(h)}h${_pad2(mm)}`) {
        // chercher une 2e occurrence
        const m2 = txtNorm.match(/\b(\d{1,2})h(\d{2})\b.*?\b(\d{1,2})h(\d{2})\b/is);
        if (m2) {
          const h2 = parseInt(m2[3],10), mm2 = parseInt(m2[4],10);
          res.Duree = `${h2}h${_pad2(mm2)}`;
        }
      } else {
        res.Duree = cand;
      }
    }
  }

  // --- Hyperlien : ligne commençant par "Hyperlien <url...>" ---
  {
    const m = txt.match(/^\s*hyperlien\s+([^\s].*)$/gim);
    if (m && m.length > 0) {
      const line = m[0]; // 1ère correspondance
      const url = line.replace(/^\s*hyperlien\s+/i, '').trim();
      if (url) res.Hyperlien = url;
    }
  }

  // -------- Relâche --------
  const relParts = [];
  let parite = null;

  // Liste explicite : “relâche les 9, 16, 23 juillet”
  {
    const m = txtNorm.match(/rel[aâ]che\s+les\s+([0-9,\s]+)\s+([a-zéû]+)/i);
    if (m) {
      const joursStr = m[1] || '';
      const moisTxt = (m[2] || '').toLowerCase();
      const moisNum = MOIS[moisTxt];
      if (moisNum) {
        const jours = joursStr.split(',').map(s => s.trim()).filter(s => /^\d+$/.test(s));
        if (jours.length) {
          const part = `(${jours.map(j => String(parseInt(j,10))).join(',')})/${moisNum}`;
          relParts.push(part);
        }
      }
    }
  }

    // Jours pairs/impairs
  {
    const re = /rel[aâ]che(?:s)?(?:\s+les)?\s+jours?\s+(pairs?|impairs?)/i;
    const m = String(txtNorm).toLowerCase().match(re);
    if (!m) return null;

    parite = /\bpairs?\b/.test(m[1]) ? 'jours pairs' : 'jours impairs';
  }

  if (parite) relParts.push(parite);
  if (relParts.length) res.Relaches = relParts.join(', ');

  // Intervalle de représentation à stocker dans Sessions : “du X au Y <mois>”
  let periode_jouee = null;
  {
    const re = /du\s+(\d{1,2})\s+au\s+(\d{1,2})\s+([a-zéû]+)/i;
    const m = String(txtNorm).toLowerCase().match(re);
    if (!m) return null;

    const d1 = String(m[1]).padStart(2, '0');
    const d2 = String(m[2]).padStart(2, '0');
    const moisTxt = m[3].normalize('NFD').replace(/\p{Diacritic}/gu, '');

    const moisNum = MOIS[moisTxt];
    if (!moisNum) return null;

    periode_jouee = `[${d1}-${d2}]/${moisNum}`;
  }

  if (periode_jouee.length) res.Sessions = periode_jouee;

  res.Orga = "Off";

  return [res];
}



/**
 * Détermine si le texte correspond à une page CATALOGUE du In
 * @param {*} text 
 * @returns 
 */
// export function isAvignonInProgPageText(text) {
//   if (!text) return false;

//   const lines = String(text).replace(/\r\n?/g, '\n').split('\n').map(l => l.trim());
//   const reArchive = /^archive\s+\d{4}$/i;

//   // remonte de N “niveaux” en ignorant les lignes vides
//   const pickAbove = (start, steps = 1) => {
//     let idx = start;
//     for (let s = 0; s < steps; s++) {
//       idx--;
//       while (idx >= 0 && !lines[idx]) idx--; // saute vides
//     }
//     return { idx, text: idx >= 0 ? lines[idx] : null };
//   };

//   for (let i = 0; i < lines.length; i++) {
//     if (!reArchive.test(lines[i])) continue;

//     const { text: tDuree } = pickAbove(i, 1); // Durée : 2 lignes au-dessus (avec vides)
//     const { text: tLieu  } = pickAbove(i, 2); // Lieu
//     const { text: tDate  } = pickAbove(i, 3); // Dates
//     /* const { text: tAvec } = */ pickAbove(i, 4); // (ignorer)
//     const { text: tStyle } = pickAbove(i, 5); // Style
//     /* const { text: tSous  } = */ pickAbove(i, 6); // (ignorer)
//     const { text: tTitre } = pickAbove(i, 7); // Titre

//     // Vérifs avec TES helpers
//     const okTitre = !!(tTitre && _norm(tTitre));
//     const okStyle = !!(tStyle && _norm(tStyle));
//     const okLieu  = !!(tLieu  && _norm(tLieu));
//     const okDuree = !!(tDuree && _parseDuree(tDuree));               // renvoie une durée normalisée ou null
//     const d = tDate ? _parseDates(tDate) : null;                      // { sessions, year }
//     const okDate  = !!(d && d.sessions);

//     if (okTitre && okStyle && okLieu && okDuree && okDate) {
//       return true; // trouvé au moins un bloc valide
//     }
//   }

//   return false;
// }
export function isAvignonInProgPageText(text) {
  if (!text) return false;

  // --- normalisation locale (espaces & accents) ---
  const normIn = (s) => String(s || '')
    .replace(/[\u00A0\u202F\u2000-\u200B]/g, ' ')  // NBSP, NARROW NBSP, etc. → espace
    .replace(/[‐-‒–—]/g, '-')                      // tous les tirets → '-'
    .replace(/\s+/g, ' ')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .trim();

  const lines = String(text).replace(/\r\n?/g, '\n').split('\n').map(l => l.trim());
  const reArchive = /^archive\s+\d{4}$/i;

  // remonte à la ligne non vide précédente en sautant "En savoir plus ..." et bullets/menu
  const stepUp = (fromIdx) => {
    let idx = fromIdx - 1;
    while (idx >= 0) {
      const raw = lines[idx];
      const t = raw && raw.trim();
      if (t) {
        // skip menus / bullets / "En savoir plus ..."
        if (/^en savoir plus\b/i.test(t)) { idx--; continue; }
        if (/^[•\-\u2022]/.test(t))       { idx--; continue; }
        return { idx, text: t };
      }
      idx--;
    }
    return { idx: -1, text: null };
  };

  // helpers tolérants : utilisent tes helpers si présents, sinon fallback simple
  const parseDureeSafe = (s) => {
    const n = normIn(s);
    if (typeof _parseDuree === 'function') return _parseDuree(n) || null;
    // fallback minimal: "Durée : 1h10" | "2h" | "50 min"
    const mH = n.match(/(\d{1,2})\s*h\s*(\d{0,2})\b/i);
    if (mH) {
      const h = Number(mH[1]) || 0;
      const mm = mH[2] ? Number(mH[2]) : 0;
      return `${h}h${String(mm).padStart(2,'0')}`;
    }
    const mM = n.match(/(\d{1,3})\s*m(?:in)?s?\b/i);
    if (mM) {
      const mins = Number(mM[1]) || 0;
      const h = Math.floor(mins/60), mm = mins%60;
      return `${h}h${String(mm).padStart(2,'0')}`;
    }
    return null;
  };

  const parseDatesSafe = (s) => {
    const n = normIn(s);
    if (typeof _parseDates === 'function') return _parseDates(n) || null;
    // fallback minimal : reconnaît "... <mois> <année>" + jours séparés par , ou "et"
    // const MOIS = {
    //   janvier:1, fevrier:2, 'février':2, mars:3, avril:4, mai:5, juin:6,
    //   juillet:7, aout:8, 'août':8, septembre:9, octobre:10, novembre:11, decembre:12, 'décembre':12
    // };
    const m = n.match(/\b(janvier|fevrier|février|mars|avril|mai|juin|juillet|aout|août|septembre|octobre|novembre|decembre|décembre)\b\s+(\d{4})/i);
    if (!m) return null;
    const mm = String(MOIS[m[1].toLowerCase()] || '').padStart(2,'0');
    const before = n.slice(0, m.index).replace(/\bet\b/gi, ',');
    const days = before.split(',').map(x => (x.match(/(\d{1,2})\s*$/)||[])[1]).filter(Boolean);
    if (!days.length) return null;
    const seq = [...new Set(days.map(d => String(d).padStart(2,'0')))];
    const sessions = (seq.length === 1) ? `${seq[0]}/${mm}` : `(${seq.join(',')})/${mm}`;
    return { sessions, year: m[2] };
  };

  for (let i = 0; i < lines.length; i++) {
    if (!reArchive.test(lines[i])) continue;

    // On remonte : Durée (optionnelle) -> Lieu -> Dates
    const dur   = stepUp(i);            // Durée (souvent "Durée : ...")
    const lieu  = dur.idx >= 0 ? stepUp(dur.idx) : { idx:-1, text:null };
    const date  = lieu.idx >= 0 ? stepUp(lieu.idx) : { idx:-1, text:null };

    const okDate  = !!(date.text && parseDatesSafe(date.text)?.sessions);
    const okLieu  = !!(lieu.text && normIn(lieu.text));
    const okDuree = !!(dur.text && parseDureeSafe(dur.text));

    // critère souple : au moins une Date valide, et (Lieu ou Durée) présent
    if (okDate && (okLieu || okDuree)) return true;
  }

  return false;
}

/**
 * Détermine si le texte correspond à une page CATALOGUE du Off
 * (ex : "festival Off Avignon  > Programme")
 */
// export function isAvignonOffProgPageText(text) {
//   if (!text) return false;
//   const lines = String(text)
//     .replace(/\r\n?/g, '\n')
//     .split('\n')
//     .map(l => l.trim());
//   return lines.some(l => l === 'festival Off Avignon  > Programme');
// }
export function isAvignonOffProgPageText(text) {
  if (!text) return false;

  const lines = String(text)
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(l => l.trim());

  const reAffiche = /\baffiche du spectacle\b/i;
  const reImg = /!\[[^\]]*\]\([^)]+\)|<img\b[^>]*\bsrc\s*=\s*["'][^"']+["']|https?:\/\/\S+\.(?:png|jpe?g|gif|webp|svg)(?:\?\S*)?|^data:image\//i;
  const reInfo = /\bdu\s+\d{1,2}\s+au\s+\d{1,2}\b|\ble\s+\d{1,2}\b|\b\d{1,2}h\d{0,2}\b|\b\d{1,3}\s*m(?:in)?s?\b/i;

  const isBlockStart = (s) => reAffiche.test(s) || reImg.test(s);

  for (let i = 0; i < lines.length; i++) {
    if (!isBlockStart(lines[i])) continue;

    // 1) Chercher le titre (1re ligne non vide après, en sautant les images)
    let j = i + 1;
    while (j < lines.length && (!lines[j] || reImg.test(lines[j]))) j++;
    if (j >= lines.length || !lines[j]) continue; // pas de titre → pas un bloc valide
    // titre trouvé → poursuivre

    // 2) Chercher la ligne info avant le prochain bloc
    let k = j + 1;
    let hasInfo = false;
    for (; k < lines.length; k++) {
      const lk = lines[k];
      if (!lk) continue;
      if (isBlockStart(lk)) break;           // prochain bloc → stop ici
      if (reInfo.test(lk)) { hasInfo = true; break; }
    }
    if (hasInfo) return true; // au moins un bloc détectable
  }

  return false;
}

/**
 * Détermine si le texte correspond à une page SPECTACLE du Off
 * (ex : "festival Off Avignon  > Programme > Cache Cache")
 */
export function isAvignonOffSpecPageText(text) {
  if (!text) return false;
  const lines = String(text)
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(l => l.trim());
  return lines.some(l => /^festival Off Avignon\s*>\s*Programme\s*>\s*\S/.test(l));
}



// --- helpers ---

const MOIS = {
  'janvier': 1, 'fevrier': 2, 'février': 2, 'mars': 3, 'avril': 4,
  'mai': 5, 'juin': 6, 'juillet': 7, 'aout': 8, 'août': 8,
  'septembre': 9, 'octobre': 10, 'novembre': 11, 'decembre': 12, 'décembre': 12
};

const _isNonEmpty = s => !!(s && String(s).trim());

function _norm(s) {
  return String(s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // enlève accents
    .replace(/\s+/g, ' ')                             // espaces multiples -> simple
    .trim();
}

function _normSpaces(s) {
  // remplace NBSP, fines insécables, etc. par des spaces
  return String(s || '').replace(/[\u00A0\u2000-\u200B]/g, ' ');
}

const _strip = s => String(s || '').trim();

function _stripQuotes(s){ return String(s).replace(/^[\s"'«]+|[\s"'»]+$/g,'').trim(); }

function _clean_lieu(s) {
  return String(s || '')
    .replace(/^(lieu\s*[:\-]\s*)/i, '')
    .replace(/^(theatre|théâtre)\s*[:\-]\s*/i, '')
    .trim();
}

function _pad2(n){ n = parseInt(n ?? 0, 10); return (n<10?'0':'') + n; }

function _pad3(n) { return String(n).padStart(2, '0'); }

const _clean = s => (s ?? "").toString().replace(/\s+/g, " ").trim();

function _normalizeHeure(hhmm) {
  const m = /(\d{1,2})h(\d{1,2})/.exec(_norm(hhmm));
  if (!m) return null;
  const h = String(parseInt(m[1],10)).padStart(2,'0');
  const mm = String(parseInt(m[2],10)).padStart(2,'0');
  return `${h}h${mm}`;
}
function _normalizeDuree(hhmm) {
  const m = /(\d{1,2})h(\d{1,2})/.exec(_norm(hhmm));
  if (!m) return null;
  const h = String(parseInt(m[1],10));
  const mm = String(parseInt(m[2],10)).padStart(2,'0');
  return `${h}h${mm}`;
}

/** Extrait les dates de représentation en token */
function _parseSessions(text) {
  const t = _norm(text || "");
  const m = /du\s+(\d{1,2})\s+au\s+(\d{1,2})\s+([a-zéû]+)/i.exec(t);
  if (!m) return null;

  const d1 = parseInt(m[1], 10);
  const d2 = parseInt(m[2], 10);
  const moisTxt = m[3];
  const mois = MOIS[moisTxt] || null;
  if (!mois) return null;

  return `[${d1}-${d2}]/${mois}`;
}

// "(9,16,23)/7"
function _parseRelaches(text) {
  const t = _norm(text);
  const m = /rel[aâ]che\s+les\s+([0-9,\s]+)\s+([a-zéû]+)/i.exec(t);
  if (!m) return null;
  const jours = (m[1] || "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean)
    .map(s => String(parseInt(s,10)));
  const mois = MOIS[m[2]] || null;
  if (!jours.length || !mois) return null;
  return `(${jours.join(",")})/${mois}`;
}

// Inversion de parité pour passer "jours joués" -> "relâche"
function _invertParite(parite /* "jours pairs" | "jours impairs" */) {
  if (!parite) return null;
  return /pairs?/.test(parite) ? "jours impairs" : "jours pairs";
}

/** Extrait les dates de relâche exprimées sous la forme ("jours pairs" / "jours impairs").
 *    Règle : 
 *    - si texte contient "relâche jours X" -> renvoie "jours X"
 *    - si texte contient "jours X" (joués) -> renvoie l'inverse pour la relâche
 */
function _parseRelachesAvecParite(text) {
  const t = _norm(text || "");
  // cherche "... , relâche jours X" OU "... , jours X"
  const m = /(?:^|,|\s)(rel[aâ]che\s+)?(jours?\s+pairs?|jours?\s+impairs?)(?:\s|$)/i.exec(t);
  if (!m) return null;

  const hadRelachesPrefix = !!m[1];
  const pariteFound = m[2].trim().toLowerCase(); // "jours pairs" | "jours impairs"
  return hadRelachesPrefix ? pariteFound : _invertParite(pariteFound);
}

// Extrait Lieu / Sessions / Debut / Duree depuis la ligne 3
function _parseInfoLine(line, defaultMonth = '07') {
  const l = _strip(line);

  // Mois texte optionnel (ex: "juillet", "août")
  const moisMatch = l.toLowerCase().match(/\b(janvier|fevrier|février|mars|avril|mai|juin|juillet|aout|août|septembre|octobre|novembre|decembre|décembre)\b/);
  const moisNum = moisMatch ? MOIS[moisMatch[1].toLowerCase()] : defaultMonth;

  // Lieu = avant " du " ou " le " ; sinon avant la 1re heure "HHhMM"
  const idxDu = l.toLowerCase().indexOf(' du ');
  const idxLe = l.toLowerCase().indexOf(' le ');
  let cut = -1;
  if (idxDu > -1) cut = idxDu;
  else if (idxLe > -1) cut = idxLe;
  if (cut === -1) {
    const mH = l.match(/\b\d{1,2}h\d{2}\b/i);
    if (mH) cut = l.indexOf(mH[0]);
  }
  const Lieu = _strip(cut > 0 ? l.slice(0, cut) : l);

  // Sessions: "du d1 au d2" OU "le d"
  let Sessions = null;
  const mDuAu = l.match(/\bdu\s+(\d{1,2})\s+au\s+(\d{1,2})\b/i);
  const mLe   = l.match(/\ble\s+(\d{1,2})\b/i);
  if (mDuAu) {
    const d1 = _pad3(+mDuAu[1]);
    const d2 = _pad3(+mDuAu[2]);
    Sessions = `[${d1}-${d2}]/${moisNum}`;
  } else if (mLe) {
    const d = _pad3(+mLe[1]);
    Sessions = `[${d}-${d}]/${moisNum}`;
  }

  // Heures & Durée (supporte "HHhMM" et "NNmin")
  const hTokens = [...l.matchAll(/\b(\d{1,2})h(\d{2})\b/gi)]
    .map(m => ({ t: `${String(m[1]).padStart(2,'0')}h${m[2]}`, idx: m.index }));
  const mTokens = [...l.matchAll(/\b(\d{1,3})\s*m(?:in)?s?\b/gi)]
    .map(m => ({ mins: Number(m[1]), idx: m.index }));

  let Debut = null, Duree = null;
  if (hTokens.length >= 1) {
    Debut = hTokens[0].t;
    const startIdx = hTokens[0].idx ?? 0;
    const durH = hTokens.find((x, i) => i > 0 && x.idx > startIdx);
    if (durH) {
      Duree = durH.t;                    // ex. "1h20"
    } else {
      const durM = mTokens.find(x => x.idx > startIdx) || mTokens[0];
      if (durM) Duree = mmToHHhMM(durM.mins); // ex. "55min" -> "0h55"
    }
  } else if (mTokens.length) {
    // Pas d'heure trouvée mais durée présente (rare)
    Duree = mmToHHhMM(mTokens[0].mins);
  }

  return { Lieu, Sessions, Debut, Duree };
}

function _parseDuree(line) {
  if (!line) return null;
  const txt = line.toLowerCase().trim().replace(/^duree?\s*:/, '').trim();
  // "HhMM" ou "Hh" / "H h MM"
  const mH = txt.match(/(\d{1,2})\s*h\s*(\d{0,2})\b/);
  if (mH) {
    const h = Number(mH[1]) || 0;
    const mm = mH[2] ? Number(mH[2]) : 0;
    return `${String(h)}h${String(mm).padStart(2, '0')}`;
  }
  // "75 min", "90mins"
  const mM = txt.match(/(\d{1,3})\s*m(?:in)?s?\b/);
  if (mM) return mmToHHhMM(Number(mM[1]));
  return null;
}

/**
 * "vendredi 11 juillet 2025"      -> { sessions:"11/07", year:"2025" }
 * "8, 9, 10, …, 26 juillet 2025"  -> { sessions:"08,09,...,26/07", year:"2025" }
 * "9, 10 et 11 juillet 2025"      -> { sessions:"09,10,11/07", year:"2025" }
 */
function _parseDates(line) {
  if (!line) return { sessions: null, year: null };

  const raw = _normSpaces(line).trim();

  // repère "<mois> <année>"
  const reMonthYear = /\b(janvier|fevrier|février|mars|avril|mai|juin|juillet|aout|août|septembre|octobre|novembre|decembre|décembre)\b\s+(\d{4})/i;
  const mMY = raw.match(reMonthYear);
  if (!mMY) return { sessions: null, year: null };

  const monthTxt = mMY[1].toLowerCase();
  const year = mMY[2];
  const mNum = MOIS[monthTxt];
  if (!mNum) return { sessions: null, year: null };

  // ⚙️ ici on met le mois sur 2 chiffres sans modifier la const MOIS d’origine
  const mm = _pad3(Number(mNum));

  const before = raw.slice(0, mMY.index).trim();

  // extrait toutes les occurrences de jours
  const daySeq = before
    .replace(/\bet\b/gi, ',')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map(x => x.match(/\d{1,2}$/)?.[0])
    .filter(Boolean)
    .map(n => _pad3(+n));

  const seen = new Set();
  const days = daySeq.filter(d => (seen.has(d) ? false : (seen.add(d), true)));

  if (days.length === 0) return { sessions: null, year };

  if (days.length === 1) {
    return { sessions: `${days[0]}/${mm}`, year };
  } else {
    return { sessions: `(${days.join(',')})/${mm}`, year };
  }
}

// “Un cran” = sauter blanc(s) puis prendre la non-vide suivante
function _stepUp(lines, fromIdx, startIdx) {
  let i = fromIdx - 1;
  // sauter >= 0 blancs
  while (i > startIdx && !lines[i]?.trim()) i--;
  return (i > startIdx && lines[i]?.trim()) ? i : -1;
}

const _looksLikeStyle = (line) => {
    const t = (line || '').trim();
    if (!t) return false;
    if (/^avec\b/i.test(t)) return false;    // ignore "Avec ..."
    if (t.length > 60) return false;         // lignes trop longues = descriptions
    const words = t.split(/\s+/);
    if (words.length > 8) return false;      // heuristique simple
    return true;
  };

  // Extrait mois/année depuis la ligne info (ex: "... juillet 2025")
// normalise "HhM?" / "Hh" -> "HhMM" (H sans zéro initial, MM sur 2 chiffres)
function _normalizeHhmmLoose(s) {
  if (!s) return null;
  const m = String(s).match(/^(\d{1,2})h(\d{0,2})$/i);
  if (!m) return null;
  const h = Number(m[1]);                 // jamais padder l'heure
  const mm = m[2] === undefined || m[2] === '' ? 0 : Number(m[2]);
  return `${h}h${_pad3(mm)}`;
}

function _isImageLine(raw) {
  const s = String(raw || '').trim();
  if (!s) return false;
  if (/!\[[^\]]*\]\([^)]+\)/i.test(s)) return true;                         // Markdown
  if (/<img\b[^>]*\bsrc\s*=\s*["'][^"']+["']/i.test(s)) return true;        // HTML
  if (/^https?:\/\/\S+\.(png|jpe?g|gif|webp|svg)(\?\S*)?$/i.test(s)) return true; // URL
  if (/^data:image\/(png|jpe?g|gif|webp|svg);base64,/i.test(s)) return true;     // data URI
  return false;
}

function _parseMonthYear(info) {
  const m = String(info || '')
    .toLowerCase()
    .match(/\b(janvier|fevrier|février|mars|avril|mai|juin|juillet|aout|août|septembre|octobre|novembre|decembre|décembre)\b(?:\s+(\d{4}))?/i);
  if (!m) return { mm: null, yyyy: null };
  const mm = MOIS[m[1]] ? _pad3(MOIS[m[1]]) : null;
  const yyyy = m[2] || null;
  return { mm, yyyy };
}