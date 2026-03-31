// parsers.js

import { 
  richValueGoodQuality,
  includesSafe,
  stripOrigin,
} from './utils.js';

import { 
  mmToHHhMM,
  mmToHhmm,
  pad2,
  parseDurationToHhmm,
} from './utils-date.js';

import {
  openSheetProgress,
} from './sheets.js';

/**
 * Objets retournes par les parsers
 */
export const PARSED_DEFAULT = {
    Activite: null,
    Debut: null,    // "HHhMM"
    Duree: null,    // "HhMM"
    Lieu: null,
    Session: null,
    Relache: null,
    Style: null,
    Orga: null,
    Note: null,
    Hyperlien: null,
    HyperlienBR: null,
    Avis: null,
};

/**
 * Essaye d’extraire une note et un count d’un champ avis de type texte
 * @param {*} avisStr 
 * @returns 
 */
export function parseAvisObject(avisStr) {
  if (!avisStr || typeof avisStr !== "string") {
    return { note: null, count: null };
  }

  // Exemples supportés :
  // "Note 10/10 (74 avis) — ..."
  // "9/10 (35 avis)"
  const noteMatch = avisStr.match(/(\d+(?:[.,]\d+)?)\s*\/\s*10/);
  const countMatch = avisStr.match(/\((\d+)\s*avis\)/i);

  const note = noteMatch
    ? Number(noteMatch[1].replace(",", "."))
    : null;

  const count = countMatch
    ? Number(countMatch[1])
    : null;

  return {
    note: Number.isFinite(note) ? note : null,
    count: Number.isFinite(count) ? count : null
  };
}

/**
 * Extrait une note à partir d'un objet Avis { Note: "..." }
 * @param {*} avis 
 * @returns 
 */
export function getNoteFromAvis(avis) {
  let note = null;
  if (avis) {
    const avisObj = parseAvisObject(avis.Note);
    const notePart = (avisObj.note) ? `${String(avisObj.note)}` : null;
    const countPart = (avisObj.count) ? `(${String(avisObj.count)} avis)` : null;
    if (notePart || countPart) note = `${notePart} ${countPart}`;
  }
  return note;
}

const _summaryCache = new Map(); // key = uuid

/**
 * Enrichissement d'une row Activite avec __desc_summary, __avis_summary et Mood via worker AI
 * A l'issue les champs Description, Distribution, Avis s'ils existent sont supprimés
 * @param {*} row 
 */
export async function enrichWithAbstractPremiumOneRow(row) {

  // Récupération des détails de la page spectacle de BilletReduc associée
  const details = await getBilletReducDetailedInfos(row);
  if (!details) {
    return;
  }

  // Mise à jour des champs de la row dépendants des détails de la page spectacle de BilletReduc
  if (!richValueGoodQuality(row.Debut) && richValueGoodQuality(details.debut)) row.Debut = details.debut;
  if (!richValueGoodQuality(row.Duree) && richValueGoodQuality(details.duree)) row.Duree = details.duree;
  row.HyperlienBR = details.detailUrl;
  row.Note = getNoteFromAvis(details.avis_obj);

  // Construction du paramètre du worker AI
  const item = {
    activite: row.Activite || '',
    lieu: row.Lieu || '',
    style: row.Style || '',
    description: details.description || '',
    distribution: details.distribution || '',
    avis_obj: details.avis_obj || '',
  };

  // Appel du worker AI pour résumé
  try {

    const summary = await _summarizeOneItemViaWorker(item);

    row.__desc_summary = summary.desc_summary;
    row.__avis_summary = summary.avis_summary;
    row.Mood = summary.mood;

  } catch (e) {
    console.log(`ERREUR: ${e?.message || String(e)}`);
  } 

  delete row.Description;
  delete row.Distribution;
  delete row.Avis;

}

/**
 * Enrichissement d'un tableau de rows Activite avec __desc_summary, __avis_summary et Mood via worker AI
 * A l'issue les champs Description, Distribution, Avis s'ils existent sont supprimés
 * @param {Object} param - L'objet contenant les paramètres rows et df.
 * @param {Array<any>} param.rows - Le tableau de lignes Activite à enrichir.
 * @param {Array<any>} param.df - Le tableau de données supplémentaires.
 */
export async function enrichWithAbstractPremium(param) {

  // Renvoie les rows d'un dataframe qui ont déjà un résumé premium pour une clé donnée
  function _getRowsWithAbstractPremium(df, key) {
      // Filtrer les lignes qui correspondent à la clé donnée et ont les champs requis et non nuls
      const matchingRows = df.filter(row =>
          row.Activite === key.Activite &&
          row.Lieu === key.Lieu &&
          '__desc_summary' in row && row.__desc_summary != null &&
          '__avis_summary' in row && row.__avis_summary != null &&
          'Mood' in row && row.Mood != null
      );

      // Retourner le tableau des lignes correspondantes
      return matchingRows;
  }

  const rows = param.rows;
  const df = param.df;

  // Ouverture de la sheet de progression
  const sheet = openSheetProgress({ title: "Génération Infos+", initialTotal: rows.length, cancellable: false });

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];    

    // Vérifie si abstracts déjà présents dans le dataframe existant
    const rowsWithAbstractPremiumAlreadyThere = _getRowsWithAbstractPremium(df, { Activite: row.Activite, Lieu: row.Lieu });

    if (rowsWithAbstractPremiumAlreadyThere.length > 0) {
      const rowRef = rowsWithAbstractPremiumAlreadyThere[0];
      row.__desc_summary = rowRef.__desc_summary;
      row.__avis_summary = rowRef.__avis_summary;
      row.Mood = rowRef.Mood;

      if (!richValueGoodQuality(row.Debut) && richValueGoodQuality(rowRef.Debut)) row.Debut = rowRef.Debut;
      if (!richValueGoodQuality(row.Duree) && richValueGoodQuality(rowRef.Duree)) row.Duree = rowRef.Duree;
      if (includesSafe(row.HyperlienBR, "search") && !includesSafe(rowRef.HyperlienBR, "search")) row.HyperlienBR = rowRef.HyperlienBR;
      if (row.Note == null && rowRef.Note != null) row.Note = rowRef.Note;

      delete row.Description;
      delete row.Distribution;
      delete row.Avis;

      sheet.tickOk();
      continue;
    }

    // Log dans la sheet de progression
    sheet.log(`Génération Infos+ pour ${row.Activite}`);

    // Récupération des détails de la page spectacle de BilletReduc associée
    const details = await getBilletReducDetailedInfos(row);
    if (!details) {
      sheet.tickOk();
      continue;
    }

    // Mise à jour des champs de la row dépendants des détails de la page spectacle de BilletReduc
    if (!richValueGoodQuality(row.Debut) && richValueGoodQuality(details.debut)) row.Debut = details.debut;
    if (!richValueGoodQuality(row.Duree) && richValueGoodQuality(details.duree)) row.Duree = details.duree;
    row.HyperlienBR = details.detailUrl;
    row.Note = getNoteFromAvis(details.avis_obj);

    // Construction du paramètre du worker AI
    const item = {
      activite: row.Activite || '',
      lieu: row.Lieu || '',
      style: row.Style || '',
      description: details.description || row.Description || '',
      distribution: details.distribution || row.Distribution || '',
      avis_obj: details.avis_obj || row.Avis || '',
    };

    // Appel du worker AI pour résumé
    try {

      const summary = await _summarizeOneItemViaWorker(item);

      row.__desc_summary = summary.desc_summary;
      row.__avis_summary = summary.avis_summary;
      row.Mood = summary.mood;

    } catch (e) {
      sheet.tickErr(`  ERREUR: ${e?.message || String(e)}`);
    } 

    delete row.Description;
    delete row.Distribution;
    delete row.Avis;

    sheet.tickOk();
  }

  sheet.close();
}

/**
 * Parser d'une page programme du catalogue Avignon In donnée par son URL
 * @param {*} url 
 * @returns 
 */
export async function parseAvignonInProgPageUrl(url, { fetcher = _fetchViaCloudFlareWorker } = {}) {
  const res  = await fetcher(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} on ${url}`);
  const html = await res.text();
  const doc  = new DOMParser().parseFromString(html, 'text/html');
  const all = parseAvignonInProgPageDom(doc, url);

  await _enrichAllWithDetails(all, parseAvignonInProgPageDom);

  return all;

}

/**
 * Parser d'une page programme du catalogue Avignon In donnée par son Dom
 * @param {*} doc 
 * @returns 
 */
export function parseAvignonInProgPageDom(doc, pageUrl = '') {
  const out = [];
  const comps = [...doc.querySelectorAll('program-by-category')];
  if (!comps.length) return out;

  for (const el of comps) {
    const payload = _extractEventsPayload(el);
    if (!payload?.length) continue;
    for (const ev of payload) {
      const mapped = _mapEventToRow(ev, pageUrl);
      if (mapped) out.push(mapped);
    }
  }
  return out;
}

/**
 * Parse le texte brut de la page catalogue Avignon In.
 * @param {*} text 
 * @returns 
 */
export function parseAvignonInProgPageText(text) {

  if (!text) return [];

  // ---- Helpers locaux ----
  // const pad2 = n => String(Number(n) || 0).padStart(2, '0');
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
      return `${h}h${pad2(mm)}`;
    }
    const mm = txt.match(/(\d{1,3})\s*m(?:in)?s?\b/);
    if (mm) {
      const mins = Number(mm[1]) || 0;
      const h = Math.floor(mins / 60), m = mins % 60;
      return `${h}h${pad2(m)}`;
    }
    return null;
  };

  // --- Parser dates -> { session, year } ---
  // Ex:
  //  - "vendredi 11 juillet 2025"         -> "11/07"
  //  - "8, 9, 10 ... juillet 2025"        -> "(08,09,10,...)/07"
  //  - "9, 10 et 11 juillet 2025"         -> "(09,10,11)/07"
  const parseDatesShort = (line) => {
    if (!line) return { session: null, year: null };
    const raw = _normSpaces(line).trim();

    const reMY = /\b(janvier|fevrier|février|mars|avril|mai|juin|juillet|aout|août|septembre|octobre|novembre|decembre|décembre)\b\s+(\d{4})/i;
    const mMY = raw.match(reMY);
    if (!mMY) return { session: null, year: null };

    const monthTxt = mMY[1].toLowerCase();
    const year = mMY[2];
    const mNum = MOIS[monthTxt];
    if (!mNum) return { session: null, year: null };
    const mm = pad2(mNum);

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
      .map(n => pad2(n));

    if (daySeq.length === 0) return { session: null, year };

    // dédoublonne en préservant l'ordre
    const seen = new Set();
    const days = daySeq.filter(d => (seen.has(d) ? false : (seen.add(d), true)));

    const session = (days.length === 1)
      ? `${days[0]}/${mm}`
      : `(${days.join(',')})/${mm}`;

    return { session, year };
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
    let iDate = -1, Session = null;
    for (let k = nonEmptyIdx.length - 1; k >= 0; k--) {
      const idx = nonEmptyIdx[k];
      const parsed = parseDatesShort(block[idx]);
      if (parsed && parsed.session) {
        iDate = idx;
        Session = parsed.session;
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
      Session: Session || null,
      Debut: null,
      Relache: null,
      Orga: 'In',
      Hyperlien: null,
    });
  }

  return results;
}

/**
 * Parser d'une page spectacle du catalogue Avignon In donnée par son URL
 * @param {*} url 
 * @returns 
 */
export async function parseAvignonInSpecPageUrl(url, { fetcher = _fetchViaCloudFlareWorker } = {}) {
  const res  = await fetcher(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} on ${url}`);
  const html = await res.text();
  const doc  = new DOMParser().parseFromString(html, 'text/html');
  const parsed = parseAvignonInSpecPageDom(doc, url);
  if (parsed) parsed[0].Hyperlien = url;
  return parsed;
}

/**
 * Parser d'une page spectacle du catalogue Avignon In donnée par son Dom
 * @param {*} doc 
 * @returns 
 */
export function parseAvignonInSpecPageDom(doc, pageUrl = null) {

  const text = s => (s || '').replace(/\s+/g, ' ').trim();

  // --- Titre / Activité
  const Activite = text(
    doc.querySelector('.event-titling h1[itemprop="name"]')?.textContent
  ) || null;

  // --- Style (catégories)
  const cats = [...doc.querySelectorAll('ul.list_categories li')]
    .map(li => text(li.textContent))
    .filter(Boolean);
  const Style = cats.length ? cats.join(' / ') : null;

  // --- Durée (gère les <abbr>h</abbr>)
  const dureeContainer = doc.querySelector('.additional_info__text');
  const dureeTxt = _plainifyWithAbbr(dureeContainer);   // ex. "Durée : 2h10"
  const Duree = parseDurationToHhmm(dureeTxt);

  // --- Lieu
  // ex. <div itemprop="location" ...><a ...><span class="title_link">Chartreuse ...</span> ...
  let Lieu = text(doc.querySelector('[itemprop="location"] .title_link')?.textContent)
          || text(doc.querySelector('[itemprop="location"] [itemprop="name"]')?.textContent)
          || null;

  // --- Hyperlien (optionnel)
  const Hyperlien = pageUrl || null;

  // --- 🔹 Description (bloc itemprop="description")
  // <div itemprop="description" class="text"><div> ... </div></div>
  const descRoot = doc.querySelector('div[itemprop="description"].text');
  const Description = descRoot ? text(descRoot.textContent || '') : null;
  // (si tu préfères garder le HTML riche pour plus tard : descRoot.innerHTML.trim())

  // --- 🔹 Distribution (bloc .artists)
  // <div class="artists"><p>de Lotte Reiniger et Carl Koch</p></div>
  const artistsEl = doc.querySelector('div.artists');
  const Distribution = artistsEl ? text(artistsEl.textContent || '') : null;

  const out = [{ 
    ...PARSED_DEFAULT, 
    Activite, 
    Style, 
    Duree, 
    Lieu, 
    Orga: 'In', 
    Hyperlien,
    Description,
    Distribution
   }];

  // Si vraiment rien, renvoie null pour signaler l'échec
  if (Object.values(out).every(v => v == null)) return null;
  return out;
}

/**
 * Parser d'une page spectacle du catalogue Avignon In donnée par son texte
 * @param {*} text 
 * @returns 
 */
export function parseAvignonInSpecPageText(text) {
  if (!text) return null;

  const lines = String(text)
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(l => l.replace(/\u00A0/g, ' ').trim()) // remplace NBSP
    .filter(l => l.length);

  const norm = s => String(s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  const findIndex = (re) => lines.findIndex(l => re.test(norm(l)));
  const nextNonEmpty = (i, offs = 1) => {
    let j = i + offs;
    while (j < lines.length && !lines[j]) j++;
    return j < lines.length ? lines[j] : null;
  };

  let Activite = null;
  let Style = null;
  let Lieu = null;
  let Duree = null;

  // 1) Titre : ligne juste après "Partager"
  const shareIdx = findIndex(/^partager$/i);
  if (shareIdx >= 0) {
    Activite = nextNonEmpty(shareIdx, 1);
    // 2) Style : la ligne suivante si ce n'est pas "Archive 20xx"
    const maybeStyle = nextNonEmpty(shareIdx, 2);
    if (maybeStyle && !/^archive\s+\d{4}$/i.test(norm(maybeStyle))) {
      Style = maybeStyle;
    }
  }

  // 3) Lieu & Durée : dans le bloc "Infos pratiques"
  const infosIdx = findIndex(/^infos? pratiques?$/i);
  if (infosIdx >= 0) {
    // Lieu = ligne après, + éventuellement la ligne suivante si elle ressemble à une adresse
    const l1 = nextNonEmpty(infosIdx, 1);
    const l2 = nextNonEmpty(infosIdx, 2);
    const isAddressLike = s => !!s && /(\b\d{2,5}\b|\bavignon\b|rue|place|boulevard|avenue|cours)/i.test(s);
    if (l1 && isAddressLike(l2)) {
      Lieu = `${l1} ${l2}`.replace(/\s+/g, ' ').trim();
    } else {
      Lieu = l1 || null;
    }

    // Durée : cherche la première ligne "Durée :" APRÈS "Infos pratiques"
    for (let j = infosIdx + 1; j < lines.length; j++) {
      const ln = lines[j];
      if (/^photos$|^audiovisuel$|^presentation$|^présentation$/i.test(norm(ln))) break; // fin de section
      if (/^dure[eé]\s*:/.test(norm(ln)) || /dure[eé]/i.test(ln)) {
        Duree = parseDurationToHhmm(ln);
        if (Duree) break;
      }
    }
  }

  const out = [{ ...PARSED_DEFAULT, Activite, Style, Duree, Lieu, Orga: 'In', }];
  return Object.values(out).every(v => v == null) ? null : out;
}

/**
 * Parser d'une page programme du catalogue Avignon Off donnée par son URL
 * @param {string} url - URL du programme (ex: https://www.festivaloffavignon.com/programme)
 * @param {object}  opts
 * @param {number}  opts.maxPages   - sécurité (par défaut 1000)
 * @param {number}  opts.delayMs    - pause entre requêtes (150ms par défaut)
 * @param {boolean} opts.verbose    - logs console
 * @returns {Promise<Array>}        - liste d’objets parsés (Activite, Lieu, Session, Debut, Duree, Style, Hyperlien)
 */
export async function parseAvignonOffProgPageUrl(
  url, 
  { maxPages = 1000, delayMs = 150, verbose = false } = { maxPages: 1000, delayMs: 150, verbose: false }
) {

  const seen = new Set();
  const all  = [];

  // 1) Page initiale (GET)
  const res0 = await _fetchViaCloudFlareWorker(url);
  const html0 = await res0.text();
  const doc0 = _parseHTML(html0);

  // 2) Parser la page 1
  const pushItems = (items) => {
    let added = 0;
    for (const it of (items || [])) {
      const key = _makeKey(it);
      if (!seen.has(key)) { seen.add(key); all.push(it); added++; }
    }
    return added;
  };

  let added = pushItems(parseAvignonOffProgPageDom(doc0));
  if (verbose) console.debug('[OFF] page 1:', { added, total: all.length });

  // 3) Lire le formulaire & les champs
  const form = doc0.querySelector('#js-form-filtres');
  if (!form) {
    if (verbose) console.warn('[OFF] Form #js-form-filtres introuvable – on retourne la page 1 uniquement.');
    return all;
  }

  const pageField   = _detectPageField(form);               // 'page' | 'current_page' | 'paged'
  let currentPage   = _readCurrentPage(form, pageField);    // ex. 1
  let nextPage      = currentPage + 1;

  // 4) Boucle pages suivantes (POST même URL)
  for (let i = 2; i <= maxPages; i++, nextPage++) {
    // reconstruire les params à chaque tour (garde tous les filtres)
    const params = _formToParams(form);
    _setNextPageParams(params, pageField, nextPage);

    // (optionnel) si le site exige un token/nonce, il sera déjà dans le form
    const res = await _fetchViaCloudFlareWorker(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body: params.toString()
    });

    const html = await res.text();
    const doc  = _parseHTML(html);

    const items = parseAvignonOffProgPageDom(doc) || [];
    const nAdded = pushItems(items);

    if (verbose) console.debug(`[OFF] page ${nextPage}:`, { added: nAdded, total: all.length });
    if (nAdded === 0) break;                // plus rien de nouveau → fin

    // mettre à jour 'form' à partir de la nouvelle page (les filtres/valeurs peuvent évoluer)
    const newForm = doc.querySelector('#js-form-filtres');
    if (newForm) {
      // On repartira au tour suivant avec les derniers champs
      // (au cas où la page renvoie un nouveau current_page, un nouveau nonce, etc.)
      form.innerHTML = newForm.innerHTML;
    }

    if (delayMs) await new Promise(r => setTimeout(r, delayMs));
  }
  
  await _enrichAllWithDetails(all, parseAvignonOffProgPageDom);

  return all;
}

/**
 * Parser d'une page programme du catalogue Avignon Off donnée par son Dom
 * @param {*} doc 
 * @returns 
 */
export function parseAvignonOffProgPageDom(doc) {

  // mois par défaut si non indiqué sur la carte (OFF = juillet)
  const DEFAULT_MM = '07';

  const items = [];

  doc.querySelectorAll('.global-card.spectacle-card, .spectacle-card').forEach(card => {
    // Titre & lien
    const aTitle = card.querySelector('a.card-nom');
    const Activite = aTitle?.textContent?.trim() || null;
    const Hyperlien = aTitle?.getAttribute('href') || null;

    // Lieu
    const Lieu = card.querySelector('.card-content .theatre')?.textContent?.replace(/\s+/g,' ')?.trim() || null;

    // Session (dates)
    const dateTxt = card.querySelector('.card-content .date')?.textContent || '';
    const Session = _parseSession(dateTxt) || null;

    // Heures & durée
    const debutTxt = card.querySelector('.horaire-c .heure')?.textContent?.trim() || '';
    const Debut = _normalizeHhmmLoose(debutTxt) || null;

    let Duree = null;
    const dureeTxt = card.querySelector('.horaire-c .duree')?.textContent?.trim() || '';
    if (dureeTxt) {
      const mH = dureeTxt.match(/(\d{1,2})h(\d{0,2})/i);
      const mM = dureeTxt.match(/(\d{1,3})\s*m(?:in)?s?/i);
      if (mH) {
        Duree = _normalizeHhmmLoose(`${mH[1]}h${mH[2] ?? ''}`);
      } else if (mM) {
        Duree = mmToHhmm(Number(mM[1]) || 0);
      }
    }

    // Style (prendre uniquement les <span class="tag">, ignorer le <a class="tag tag-orange"> Ticket'Off)
    const styleSpans = card.querySelectorAll('.liste-tags > span.tag');
    const Style = styleSpans.length
      ? Array.from(styleSpans).map(el => el.textContent.trim()).filter(Boolean).join(' ')
      : null;

    if (Activite) {
      items.push({
        ...PARSED_DEFAULT,
        Activite,
        Lieu,
        Session: Session || null,                 // si null et tu veux forcer juillet : mettre DEFAULT_MM
        Debut,
        Duree,
        Style,
        Orga: 'Off',
        Hyperlien
      });
    }
  });

  return items;
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
    let lieu = null, debut = null, duree = null, session = null;
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

      // Session avec mois réel si présent, sinon fallback (07)
      const { mm } = _parseMonthYear(info);
      const monthOut = mm || '07';
      const mDuAu = info.match(reDuAu);
      const mLe   = info.match(reLe);
      if (mDuAu) {
        const d1 = pad2(+mDuAu[1]);
        const d2 = pad2(+mDuAu[2]);
        session = `[${d1}-${d2}]/${monthOut}`;
      } else if (mLe) {
        const d = pad2(+mLe[1]);
        session = `[${d}-${d}]/${monthOut}`;
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
      Session: session || null,
      Debut: debut || null,
      Duree: duree || null,
      Style: style || null,
      Relache: null,
      Orga: 'Off',
      Hyperlien: null
    });
  }

  return out;
}

/**
 * Parser d'une page spectacle du catalogue Avignon Off donnée par son URL
 * @param {*} url 
 * @returns 
 */
export async function parseAvignonOffSpecPageUrl(url, { fetcher = _fetchViaCloudFlareWorker } = {}) {
  const res  = await fetcher(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} on ${url}`);
  const html = await res.text();
  const doc  = new DOMParser().parseFromString(html, 'text/html');
  const parsed = parseAvignonOffSpecPageDom(doc, url);
  if (parsed) parsed[0].Hyperlien = url;
  return parsed;
}

/**
 * @typedef {typeof PARSED_DEFAULT & { Description?: any, Distribution?: any }} ParsedSpec
 */

/**
 * Parser d'une page spectacle du catalogue Avignon Off donnée par son Dom
 * parseListingHtml(html, { url })
 * @param {Document} doc
 * @param {{url?: string}} opts
 * @return {ParsedSpec[]}
 */ 
export function parseAvignonOffSpecPageDom(doc, { url=null } = {}) {
  /** @type {ParsedSpec} */
  const res = {...PARSED_DEFAULT};

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
    const explicite = _parseRelache(bigText);
    if (explicite) parts.push(explicite);

    const relacheParite = _parseRelacheAvecParite(bigText);
    if (relacheParite) parts.push(relacheParite);

    if (parts.length) res.Relache = parts.join(', ');
  
    // Sessions
    const session = _parseSession(bigText);
    if (session && session.length) res.Session = session;
  }

  res.Orga = "Off";

  // 🔹 Hyperlien (URL de la fiche)
  if (url) {
    res.Hyperlien = url;
    res.HyperlienBR = url;
  }

  // 🔹 Description : meta[name="description"]
  {
    const metaDesc = doc.querySelector('meta[name="description"]');
    if (metaDesc) {
      const desc = _clean(metaDesc.getAttribute("content") || "");
      if (desc) res.Description = desc;
    }
  }

  // 🔹 Distribution : concatène Auteur + Equipe artistique
  {
    const AUTHOR_KEYWORDS = [
      "auteur", "autrice", "auteurice", "auteur⸱ice",
      "texte", "d'après", "d apres"
    ];

    const TEAM_KEYWORDS = [
      "équipe artistique",
      "équipe",
      "distribution",
      "interpr",          // interprètes / interprétation
      "mise en scène",
      "avec"
    ];

    const sections = Array.from(doc.querySelectorAll("section"));

    const auteursParts = [];
    const equipeParts  = [];

    for (const section of sections) {
      const h3 = section.querySelector(".h3");
      if (!h3) continue;

      const title = _text(h3.textContent || "").toLowerCase();

      const isAuthorSection = AUTHOR_KEYWORDS.some(kw => title.includes(kw));
      const isTeamSection   = TEAM_KEYWORDS.some(kw => title.includes(kw));

      if (!isAuthorSection && !isTeamSection) continue;

      const fb = section.querySelector(".fond-blanc");
      if (!fb) continue;

      const blockTxt = _text(fb.textContent || "");
      if (!blockTxt) continue;

      if (isAuthorSection) {
        auteursParts.push(blockTxt);
      }
      if (isTeamSection) {
        equipeParts.push(blockTxt);
      }
    }

    // Construction finale du champ Distribution
    let distrib = [];

    if (auteursParts.length) {
      distrib.push(auteursParts.join(" | "));
    }

    if (equipeParts.length) {
      // On préfixe avec "Avec : ..." pour homogénéiser HORS In
      distrib.push("Avec : " + equipeParts.join(" ; "));
    }

    if (distrib.length) {
      res.Distribution = distrib.join(" | ");
    }
  }
  return [res];
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
      res.Debut = `${pad2(h)}h${pad2(mm)}`;
    }
  }

  // --- Durée : première occurrence HhMM (sans confondre avec "Début") ---
  {
    const m = txtNorm.match(/\b(\d{1,2})h(\d{2})\b/i);
    if (m) {
      const h = parseInt(m[1],10), mm = parseInt(m[2],10);
      const cand = `${h}h${pad2(mm)}`;

      if (res.Debut && res.Debut.toLowerCase() === `${pad2(h)}h${pad2(mm)}`) {
        // chercher une 2e occurrence
        const m2 = txtNorm.match(/\b(\d{1,2})h(\d{2})\b.*?\b(\d{1,2})h(\d{2})\b/is);
        if (m2) {
          const h2 = parseInt(m2[3],10), mm2 = parseInt(m2[4],10);
          res.Duree = `${h2}h${pad2(mm2)}`;
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
  if (relParts.length) res.Relache = relParts.join(', ');

  // Intervalle de représentation à stocker dans Session : “du X au Y <mois>”
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

  if (periode_jouee.length) res.Session = periode_jouee;

  res.Orga = "Off";

  return [res];
}

/**
 * Parser d'une page programme de BilletReduc à partir d’une URL comportant base + dt + region + idrub.
 *
 * @param {string} baseUrl - ex: "https://www.billetreduc.com/search.htm?dt=2025-11&region=J"
 * @param {object} opts
 * @param {number} [opts.maxPages=100]
 * @param {number} [opts.delayMs=200]
 * @param {boolean}[opts.verbose=false]
 * @param {string} [opts.refURL=null]
 * @param {any}    [opts.refActivite=null]
 * @returns {Promise<Array>}   liste d’objets parsés (Activite, Lieu, Session, Debut, Duree, Style, Hyperlien, Orga)
 */
export async function parseBilletReducProgPageUrl(
  baseUrl = 'https://www.billetreduc.com/search.htm?',
  { maxPages = 100, delayMs = 200, verbose = false, refURL=null, refActivite=null } = {}
) {

  const urlPage = (page) =>
    page === 1
      ? `${baseUrl}`
      : `${baseUrl}&LISTEPEpg=${page}`;

  const seen = new Set();
  const all  = [];

  const pushItems = (items, page) => {
    let added = 0;
    for (const it of items || []) {
      const key = _makeKeyBilletReduc(it);
      if (!seen.has(key)) {
        seen.add(key);
        all.push(it);
        added++;
      }
    }
    if (verbose) console.debug(`[BilletReduc] page ${page}: +${added}, total=${all.length}`);
    return added;
  };

  // 1) Page 1 (GET)
  for (let page = 1; page <= maxPages; page++) {
    const url = urlPage(page);
    if (verbose) console.debug('[BilletReduc] fetching', url);

    const res = await _fetchViaCloudFlareWorker(url);    // même helper que pour le Off
    if (!res.ok) {
      if (verbose) console.warn('[BilletReduc] HTTP error', res.status);
      break;
    }
    const html = await res.text();
    const doc  = _parseHTML(html);                       // ton helper DOMParser

    const items = parseBilletReducProgPageDom(doc, refURL, refActivite);
    const added = pushItems(items, page);

    // Si aucune nouvelle activité → on suppose qu'il n'y a plus de page suivante
    if (!added) break;

    if (delayMs) {
      await new Promise(r => setTimeout(r, delayMs));
    }
  }

  return all;
}

/**
 * Parse le DOM d’une page programme de BilletReduc obtenue par parseBilletReducProgPageUrl 
 * Retourne une liste d’activités "explosées" par horaire :
 *   - même Activite/Lieu/Hyperlien
 *   - une ligne par horaire (Debut) avec Session propre.
 * 
 * @param {*} doc 
 * @param {*} refURL 
 * @param {*} refActivite 
 * @returns 
 */
function parseBilletReducProgPageDom(doc, refURL=null, refActivite=null) {
  const items = [];
  const table = doc.querySelector('#preliste');
  if (!table) return items;

  // ordre canonique pour les codes de jours
  const DAY_ORDER = ['lu', 'ma', 'me', 'je', 've', 'sa', 'di'];

  table.querySelectorAll('td.bgbeige').forEach(td => {
    // Titre & lien
    const aTitle = td.querySelector('h3.h4 a.head.gtm-select-event');
    const Activite  = aTitle?.textContent?.trim() || null;
    let Hyperlien   = aTitle?.getAttribute('href') || null;

    // Si le lien est relatif → préfixer
    if (Hyperlien && Hyperlien.startsWith('/')) {
      Hyperlien = 'https://www.billetreduc.com' + Hyperlien;
    }

    // Si refURL est présent on teste le match avec Hyperlien si no match on passe
    if (refURL && refURL !== Hyperlien) return;

    // HyperlienBR
    const HyperlienBR = Hyperlien;

    // Lieu
    const lieuSpan = td.querySelector('span.lieu a');
    const Lieu = lieuSpan?.textContent?.replace(/\s+/g, ' ')?.trim() || null;

    // Bloc dates / horaires brut
    const pSb   = td.querySelector('p.sb');
    const sbRaw = pSb?.textContent || '';

    // Catégorie → Style
    const catA  = td.querySelector('span.small a');
    const Style = catA?.textContent?.replace(/\s+/g, ' ')?.trim() || null;

    // BilletReduc ne donne pas la durée → approx
    const Duree = '~1h30';

    if (!Activite) return;

    const parsed = _parseBilletReducDatesEtHoraires(sbRaw);

    if (!parsed) {
      // fallback brut si on n'a rien compris
      if (refActivite) {
        items.push({
          ...refActivite,
          Session: sbRaw || refActivite.Session,
          Duree: refActivite.Duree || Duree,
        });
        return;
      }
      else {
        items.push({
          ...PARSED_DEFAULT,
          Activite,
          Lieu,
          Session: sbRaw || null,
          Debut: null,
          Duree,
          Style,
          Orga: 'BilletReduc',
          Hyperlien,
          HyperlienBR,
        });
        return;
      }
    }

    const { rangePart, items: horaires } = parsed;

    // Aucun horaire découpé → une seule entrée générique
    if (!horaires || !horaires.length) {
      if (refActivite) {
        items.push({
          ...refActivite,
          Session: rangePart || sbRaw || refActivite.Session,
          Duree: refActivite.Duree || Duree,
        });
        return;
      }
      else {
        items.push({
          ...PARSED_DEFAULT,
          Activite,
          Lieu,
          Session: rangePart || sbRaw || null,
          Debut: null,
          Duree,
          Style,
          Orga: 'BilletReduc',
          Hyperlien,
          HyperlienBR,
        });
        return;
      }
    }

    // ========= REGROUPEMENT des horaires =========
    // clé = type + rangePart + session + début
    const agg = new Map();
    for (const h of horaires) {
      const debut = h.Debut || null;
      const sessionUnique = h.session || null; // pour les “Le 20/11 à 14h45…”

      const key = sessionUnique
        ? `single|${sessionUnique}|${debut || ''}`
        : `range|${rangePart || ''}|${debut || ''}`;

      let entry = agg.get(key);
      if (!entry) {
        entry = {
          Debut: debut,
          session: sessionUnique,
          allDays: false,
          days: new Set(), // codes "lu ma me…"
        };
        agg.set(key, entry);
      }

      // Si pas de session unique : on fusionne les jours
      if (!sessionUnique) {
        if (!h.days || !h.days.length) {
          // pas de jours = “tous les jours” → on marque, et on peut ignorer les autres
          entry.allDays = true;
          entry.days.clear();
        } else if (!entry.allDays) {
          for (const d of h.days) entry.days.add(d);
        }
      }
    }

    // ========= Génération des activités à partir de l’agrégat =========
    for (const entry of agg.values()) {
      let Session;

      if (entry.session) {
        // Cas “date unique” : session imposée (ex: "22/11" ou "22/11/25")
        Session = entry.session;
      } else {
        let daysPart = '';

        if (!entry.allDays) {
          const orderedDays = DAY_ORDER.filter(d => entry.days.has(d));
          if (orderedDays.length) {
            daysPart = ' ' + orderedDays.join(' ');
          }
        }

        // simplification : si [x-y] et “tous les jours” → on garde juste [x-y]
        if (rangePart && (entry.allDays || entry.days.size === DAY_ORDER.length)) {
          Session = rangePart;
        } else {
          Session = (rangePart || '') + daysPart;
        }
      }

      if (refActivite) {
        items.push({
          ...refActivite,
          Session: Session || refActivite.Session,
          Duree: refActivite.Duree || Duree,
          Debut: entry.Debut || refActivite.Debut,
        });
      }
      else {
        items.push({
          ...PARSED_DEFAULT,
          Activite,
          Lieu,
          Session,
          Debut: entry.Debut || null,
          Duree,
          Style,
          Orga: 'BilletReduc',
          Hyperlien,
          HyperlienBR,
        });
      }
    }
  });

  return items;
}

/**
 * Parser d'une page spectacle du site Billet réduc donnée par son URL
 * @param {*} url 
 * @returns 
 */
export async function parseBilletReducSpecPageUrl(url, { fetcher = _fetchViaCloudFlareWorker, fetchHoraire = true } = {}) {
  const res  = await fetcher(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} on ${url}`);
  const html = await res.text();
  const doc  = new DOMParser().parseFromString(html, 'text/html');
  let parsed = parseBilletReducSpecPageDom(doc);
  if (parsed && fetchHoraire) {
    const refActivite = parsed[0];
    refActivite.Hyperlien = url;
    refActivite.HyperlienBR = url;
    const searchURL= _getBilletReducSearchURL(refActivite.Activite);
    parsed = await parseBilletReducProgPageUrl(searchURL, { refURL:url, refActivite });
  }
  return parsed;
}

/**
 * Parser d'une page spectacle du site Billet réduc donnée par son HTML
 * @param {Document} doc
 * @returns {object|null}  (Activite, Lieu, Session, Duree, Style, Hyperlien)
 */
function parseBilletReducSpecPageDom(doc) {
  const root = doc.querySelector('.event_details');
  if (!root) return null;

  // --- Activité (titre)
  const Activite = root.querySelector('.event_title h1')?.textContent?.trim() || null;
  if (!Activite) return null;

  // --- Lieu
  const Lieu = root
    .querySelector('.event_infos .event_detail_venue_link')
    ?.textContent?.replace(/\s+/g, ' ')
    ?.trim() || null;

  // --- Session (intervalle de dates)
  const dateTxt = root.querySelector('.event_dates span')?.textContent?.trim() || '';
  const Session = _parseBilletReducDetailDateRange(dateTxt) || (dateTxt || null);

  // --- Durée (dans .event_data span contenant "h" ou "min")
  let dureeRaw = null;
  const dataSpans = Array.from(root.querySelectorAll('.event_data span'));
  for (const sp of dataSpans) {
    const t = sp.textContent || '';
    if (/\d/.test(t) && /(h|min)/i.test(t)) {
      dureeRaw = t;
      break;
    }
  }
  if (!dureeRaw) {
    const rootDesc = doc.querySelector('.event_description');
    const desc =
      rootDesc?.querySelector('#event-long-bio') ||
      rootDesc?.querySelector('.event_description_text') ||
      rootDesc?.querySelector('.event_description');

    if (desc) {
      const txt = desc.textContent || '';

      // Capture après "Durée :" (tolérant)
      const m = txt.match(/durée\s*[:\-]?\s*([^\n\r.;]+)/i);
      if (m) {
        dureeRaw = m[1].trim();
      }
    }
  }

  const Duree = _parseBilletReducDetailDuree(dureeRaw);

  // --- Style = tags concaténés (.event_tags .tag / .public_tag)
  const styleParts = [];
  root.querySelectorAll('.event_tags .tag, .event_tags .public_tag').forEach(el => {
    const t = el.textContent?.replace(/\s+/g, ' ').trim();
    if (t) styleParts.push(t);
  });
  const Style = styleParts.length ? styleParts.join(' ') : null;

  // ── Description (bloc "event_description")
  let Description = null;
  const /** @type {HTMLElement} */ descEl =
    doc.querySelector(".event_description .event_description_text#event-long-bio")
    || doc.querySelector(".event_description .event_description_text");

  if (descEl) {
    // récupère le texte, garde les sauts, supprime espaces parasites
    Description = (descEl.innerText || descEl.textContent || "")
      .replace(/\u00a0/g, " ")      // nbsp
      .replace(/[ \t]+\n/g, "\n")   // trim fin de ligne
      .replace(/\n{3,}/g, "\n\n")   // max 2 retours
      .trim();
  }

  // ── Distribution
  let Distribution = null;
  const rows = doc.querySelectorAll(
    ".event_artists .event_artists_container_row"
  );

  if (rows.length) {
    const lines = [];

    rows.forEach(row => {
      const titleEl = row.querySelector(".artist_row_title");
      if (!titleEl) return;

      const role = titleEl.textContent.replace(/\s*:\s*$/, "").trim();

      const names = Array.from(row.querySelectorAll("a"))
        .map(a => a.textContent.trim())
        .filter(Boolean);

      if (role && names.length) {
        lines.push(`${role} : ${names.join(", ")}`);
      }
    });

    if (lines.length) {
      Distribution = lines.join("\n");
    }
  }

  // -----------------------------
  // 🔹 Avis BilletRéduc
  // -----------------------------
  let avisNote = null;
  const avisComments = [];

  // Note globale + nb d'avis
  const reviewsHeader = doc.querySelector('.reviews_container_header_left');
  if (reviewsHeader) {
    const noteSpan = reviewsHeader.querySelector('.review_note');
    const countSpan = reviewsHeader.querySelector('.review_count');

    const noteTxt = noteSpan ? _text(noteSpan.textContent || '') : '';
    const countTxt = countSpan ? _text(countSpan.textContent || '') : '';

    const combined = _text([noteTxt, countTxt].filter(Boolean).join(' '));
    if (combined) {
      avisNote = combined; // ex: "9/10 (35 avis)"
    }
  }

  // Avis textuels (jusqu'à 4)
  const reviewNodes = doc.querySelectorAll(
    '.review_card.customer_review_card .review_card_content_desc'
  );
  for (const node of Array.from(reviewNodes)) {
    const txt = _text(node.textContent || '');
    if (!txt) continue;
    avisComments.push(txt);
    if (avisComments.length >= 4) break; // on limite à 4 avis
  }

  let Avis = null;
  if (avisNote || avisComments.length) {
    Avis = {
      Note: avisNote,
      Comments: avisComments
    };
  }

  return [{
    ...PARSED_DEFAULT,
    Activite,
    Lieu,
    Session,
    Duree,
    Style,
    Orga: 'BilletReduc',
    Avis,
    Description,
    Distribution
  }];
}

/**
 * Parser d'une page collection du site Billet réduc donnée par son URL
 * @param {*} url 
 * @returns 
 */
export async function parseBilletReducCollecPageUrl(url, { fetcher = _fetchViaCloudFlareWorker } = {}) {
  const res  = await fetcher(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} on ${url}`);
  const html = await res.text();
  const doc  = new DOMParser().parseFromString(html, 'text/html');
  const parsed = parseBilletReducCollecPageDom(doc);
  if (parsed) /** @type {any} */ (parsed).Hyperlien = url;
  return parsed;
}

// Parser d'une page collection du site Billet réduc donnée par son HTML
export function parseBilletReducCollecPageDom(docOrRoot) {
  const root = docOrRoot?.querySelectorAll
    ? docOrRoot
    : new DOMParser().parseFromString(String(docOrRoot || ''), 'text/html');

  const items = [];

  // Chaque bloc carte
  root.querySelectorAll('.event_card_information').forEach(card => {
    const a = card.querySelector('h3.event_name a.event_link');
    const ActiviteRaw  = a?.textContent || '';
    let   HyperlienRaw = a?.getAttribute('href') || '';

    const Activite = ActiviteRaw.trim() || null;
    if (!Activite) return; // rien à faire

    // Normalisation du lien
    let Hyperlien = HyperlienRaw || null;
    if (Hyperlien && Hyperlien.startsWith('/')) {
      Hyperlien = 'https://www.billetreduc.com' + Hyperlien;
    }

    items.push({
      ...PARSED_DEFAULT,
      Activite,
      Hyperlien,
      Orga: 'BilletReduc',
      // les autres champs restent à null (Lieu, Session, Debut, Duree, Style…)
    });
  });

  return items;
}

/**
 * @typedef {Object} BilletReducAvisResult
 * @property {object|null} avis
 * @property {string|null} detailUrl
 */

/**
 * Recupère les avis Billet Reduc d'un spectacle 
 * @param {*} activite 
 * @param {*} param1 
 * @returns {Promise<BilletReducAvisResult>}  
 */
export async function getBilletReducAvis(
  activite,
  { fetcher = _fetchViaCloudFlareWorker } = {}
) {
  const defaultResult = { avis: null, detailUrl: null };

  if (!activite) {
    return defaultResult;
  }

  // Construire l’URL de recherche (on encode proprement)
  const urlBR = _getBilletReducSearchURL(activite);

  try {
    // 1) Page de recherche BilletRéduc
    const resSearch = await fetcher(urlBR);
    if (!resSearch.ok) {
      console.warn(`HTTP ${resSearch.status} on search ${urlBR}`);
      return defaultResult;
    }

    const htmlSearch = await resSearch.text();
    // Debug éventuel :
    // console.log("BilletReduc search HTML length =", htmlSearch.length);

    // 👉 On PARSE TOUJOURS, même si le head contient noBot & co
    const docSearch = new DOMParser().parseFromString(htmlSearch, "text/html");

    // 2) Essayer de trouver les liens de résultats
    const detailUrl = _findBilletReducDetailUrlFromSearchDoc(
      docSearch,
      urlBR,
      activite
    );

    if (!detailUrl) {
      console.warn(
        "Aucun lien de fiche BilletReduc trouvé dans la page de recherche pour",
        activite,
        "via",
        urlBR
      );
      return defaultResult;
    }

    // 3) Page de détail BilletRéduc + parse
    const parsed = await parseBilletReducSpecPageUrl(detailUrl, { fetcher, fetchHoraire:false });
    const row    = Array.isArray(parsed) ? parsed[0] : parsed;

    const avis = row && row.Avis ? row.Avis : null;

    return { avis, detailUrl };
  } catch (e) {
    console.warn("getBilletReducAvis error for", activite, "via", urlBR, e);
    return defaultResult;
  }
}

/**
 * @typedef {Object} getBilletReducDetailedInfosResult
 * @property {string|null} debut
 * @property {string|null} duree
 * @property {object|null} avis_obj
 * @property {string|null} description
 * @property {string|null} distribution
 * @property {string|null} detailUrl
 */

/**
 * Recupère les informations détaillées d'une activité à partir de la page Billet Reduc correspondante
 * @param {*} activite 
 * @param {*} param1 
 * @returns {Promise<getBilletReducDetailedInfosResult>}  
 */
export async function getBilletReducDetailedInfos(
  activite,
  { fetcher = _fetchViaCloudFlareWorker } = {}
) {

  const defaultResult = { debut: null, duree: null, avis_obj: null, description: null, distribution: null, detailUrl: null };

  if (!activite || typeof activite !== 'object' || !('Activite' in activite)) {
    return defaultResult;
  }
  
  const activiteNom = activite.Activite;

  // Si on a déjà un objet avec les infos détaillées → on les retourne directement
  // Debut, Duree non significatifs dans ce test
  const detailesInfosAlreadyDefined = 
      'Description' in activite && activite.Description != null &&
      'Distribution' in activite && activite.Distribution != null &&
      'Avis' in activite && activite.Avis != null &&
      'HyperlienBR' in activite && activite.HyperlienBR != null;

  if (detailesInfosAlreadyDefined) {
    return {
      debut: activite.Debut,
      duree: activite.Duree,
      avis_obj: activite.Avis,
      description: activite.Description,
      distribution: activite.Distribution,
      detailUrl: activite.HyperlienBR
    };
  }

  // Construire l’URL de recherche (on encode proprement)
  const urlBR = _getBilletReducSearchURL(activiteNom);

  try {
    // 1) Page de recherche BilletRéduc
    const resSearch = await fetcher(urlBR);
    if (!resSearch.ok) {
      console.warn(`HTTP ${resSearch.status} on search ${urlBR}`);
      return defaultResult;
    }

    const htmlSearch = await resSearch.text();
    // Debug éventuel :
    // console.log("BilletReduc search HTML length =", htmlSearch.length);

    // 👉 On PARSE TOUJOURS, même si le head contient noBot & co
    const docSearch = new DOMParser().parseFromString(htmlSearch, "text/html");

    // 2) Essayer de trouver les liens de résultats
    const detailUrl = _findBilletReducDetailUrlFromSearchDoc(
      docSearch,
      urlBR,
      activiteNom
    );

    if (!detailUrl) {
      console.warn(
        "Aucun lien de fiche BilletReduc trouvé dans la page de recherche pour",
        activiteNom,
        "via",
        urlBR
      );
      return defaultResult;
    }

    // 3) Page de détail BilletRéduc + parse
    const parsed = await parseBilletReducSpecPageUrl(detailUrl, { fetcher, fetchHoraire:false });
    const row    = Array.isArray(parsed) ? parsed[0] : parsed;

    const debut = row && row.Debut ? row.Debut : null;
    const duree = row && row.Duree ? row.Duree : null;
    const avis_obj = row && row.Avis ? row.Avis : null;
    const description = row && row.Description ? row.Description : null;
    const distribution = row && row.Distribution ? row.Distribution : null;

    return { debut, duree, avis_obj, description, distribution, detailUrl };
  } catch (e) {
    console.warn("getBilletReducAvis error for", activiteNom, "via", urlBR, e);
    return defaultResult;
  }
}

/**
 * Détermine si le texte correspond à une page CATALOGUE du In
 * @param {*} text 
 * @returns 
 */
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
    const session = (seq.length === 1) ? `${seq[0]}/${mm}` : `(${seq.join(',')})/${mm}`;
    return { session, year: m[2] };
  };

  for (let i = 0; i < lines.length; i++) {
    if (!reArchive.test(lines[i])) continue;

    // On remonte : Durée (optionnelle) -> Lieu -> Dates
    const dur   = stepUp(i);            // Durée (souvent "Durée : ...")
    const lieu  = dur.idx >= 0 ? stepUp(dur.idx) : { idx:-1, text:null };
    const date  = lieu.idx >= 0 ? stepUp(lieu.idx) : { idx:-1, text:null };

    const okDate  = !!(date.text && parseDatesSafe(date.text)?.session);
    const okLieu  = !!(lieu.text && normIn(lieu.text));
    const okDuree = !!(dur.text && parseDureeSafe(dur.text));

    // critère souple : au moins une Date valide, et (Lieu ou Durée) présent
    if (okDate && (okLieu || okDuree)) return true;
  }

  return false;
}

/**
 * Détermine si le texte correspond à une page Spectacle du In
 * @param {*} text 
 * @returns 
 */
export function isAvignonInSpecPageText(text) {
  if (!text) return false;

  // Prépare les lignes (sans vides), et une normalisation "accents/espaces"
  const lines = String(text)
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(l => l.replace(/\u00A0/g, ' ').trim())
    .filter(l => l.length);

  const norm = s => String(s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  const findIndex = (re) => lines.findIndex(l => re.test(norm(l)));

  // Ancres clés (ordre logique attendu sur ces pages)
  const shareIdx   = findIndex(/^partager$/i);                  // "Partager"
  const infosIdx   = findIndex(/^infos? pratiques?$/i);         // "Infos pratiques"
  const archiveIdx = findIndex(/^archive\s+\d{4}$/i);           // "Archive 2025" (souvent présent)

  if (shareIdx < 0 || infosIdx < 0) return false;               // minimum requis

  // Il doit y avoir un "titre" juste après "Partager"
  const titleLine = lines[shareIdx + 1] || '';
  if (!titleLine || /^archive\s+\d{4}$/i.test(norm(titleLine))) return false;

  // Une "Durée" doit apparaître 
  const hasDuree    = lines.some(l => /^dure[eé]\s*:/i.test(norm(l)));

  // Bonus (souple) : "Archive 20xx" après le titre (quand présent)
  // if (archiveIdx >= 0 && archiveIdx <= shareIdx) {
  //   // "Archive 20xx" ne devrait pas être avant le bloc principal
  //   return false;
  // }

  return true;
}

/**
 * Détermine si le texte correspond à une page CATALOGUE du Off
 * (ex : "festival Off Avignon  > Programme")
 */
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



// --- helpers généraux ---

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

function _text(s) {
  return (s || "")
    .replace(/\s+/g, " ")  // remplace tous les espaces multiples par un simple
    .trim();               // supprime espaces en début/fin
}

const _strip = s => String(s || '').trim();

function _stripQuotes(s){ return String(s).replace(/^[\s"'«]+|[\s"'»]+$/g,'').trim(); }

function _clean_lieu(s) {
  return String(s || '')
    .replace(/^(lieu\s*[:\-]\s*)/i, '')
    .replace(/^(theatre|théâtre)\s*[:\-]\s*/i, '')
    .trim();
}

const _clean = s => (s ?? "").toString().replace(/\s+/g, " ").trim();

function _normalizeHeure(hhmm) {
  const m = /(\d{1,2})h(\d{1,2})/.exec(_norm(hhmm));
  if (!m) return null;
  const h = String(parseInt(m[1],10)).padStart(2,'0');
  const mm = String(parseInt(m[2],10)).padStart(2,'0');
  return `${h}h${mm}`;
}
function _normalizeDuree(dureeTxt) {
  const mH = dureeTxt.match(/(\d{1,2})h(\d{0,2})/i);
  const mM = dureeTxt.match(/(\d{1,3})\s*m(?:in)?s?/i);
  if (mH) {
    return _normalizeHhmmLoose(`${mH[1]}h${mH[2] ?? ''}`);
  } else if (mM) {
    return mmToHhmm(Number(mM[1]) || 0);
  }
  return null;
}

// "du 5 au 26"  -> "[05-26]/07"
// "le 17"       -> "17/07"
const _parseSession = (txt) => {
  if (!txt) return null;
  const s = String(txt).toLowerCase().replace(/\s+/g, ' ').trim();

  // optionnel: essayer de capter un mois dans la ligne
  const mMonth = s.match(/\b(janvier|fevrier|février|mars|avril|mai|juin|juillet|aout|août|septembre|octobre|novembre|decembre|décembre)\b/);
  const moisNum = mMonth ? ({
    janvier:1, fevrier:2, 'février':2, mars:3, avril:4, mai:5, juin:6,
    juillet:7, aout:8, 'août':8, septembre:9, octobre:10, novembre:11,
    decembre:12, 'décembre':12
  }[mMonth[1]] || 7) : 7;

  const mm = pad2(moisNum || 7);

  const mDuAu = s.match(/\bdu\s+(\d{1,2})\s+au\s+(\d{1,2})\b/i);
  if (mDuAu) {
    const d1 = pad2(mDuAu[1]), d2 = pad2(mDuAu[2]);
    return `[${d1}-${d2}]/${mm}`;
  }
  const mLe = s.match(/\ble\s+(\d{1,2})\b/i);
  if (mLe) {
    const d = pad2(mLe[1]);
    return `[${d}-${d}]/${mm}`;
  }
  // si juste "5-26" sans "du/au"
  const mDash = s.match(/\b(\d{1,2})\s*-\s*(\d{1,2})\b/);
  if (mDash) {
    const d1 = pad2(mDash[1]), d2 = pad2(mDash[2]);
    return `[${d1}-${d2}]/${mm}`;
  }
  return null;
};

// "Relâche le 17"       -> "17/07"
function _parseRelache(txt) {
  if (!txt) return null;

  const s = String(txt)
    .toLowerCase()
    .replace(/[•|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const MOIS_MAP = {
    janvier:1, fevrier:2, 'février':2, mars:3, avril:4, mai:5, juin:6,
    juillet:7, aout:8, 'août':8, septembre:9, octobre:10, novembre:11,
    decembre:12, 'décembre':12
  };
  const MONTH_RE = /(janvier|fevrier|février|mars|avril|mai|juin|juillet|aout|août|septembre|octobre|novembre|decembre|décembre)\b/;
  const pad2 = n => String(n).padStart(2, '0');

  let jours = [];
  let moisNum = null;

  // 1️⃣ Cas complet : "relâche les 10, 12 et 20 juillet"
  let m = s.match(/rel[aâ]ches?\s*(?:[:\-]|\s+)?(?:le|les)?\s*([0-9,\s;et\-er]+?)\s+(janvier|fevrier|février|mars|avril|mai|juin|juillet|aout|août|septembre|octobre|novembre|decembre|décembre)\b/);

  if (m) {
    const joursRaw = m[1] || '';
    const moisStr = m[2];
    moisNum = MOIS_MAP[moisStr] || null;
    jours = (joursRaw.match(/\d{1,2}/g) || []).map(x => String(parseInt(x, 10)));
  } else {
    // 2️⃣ Cas partiel : "relâche le 15" avec mois ailleurs
    const mDays = s.match(/rel[aâ]ches?\s*(?:[:\-]|\s+)?(?:le|les)?\s*([0-9,\s;et\-er]+)/);
    if (!mDays) return null;

    const joursRaw = mDays[1] || '';
    jours = (joursRaw.match(/\d{1,2}/g) || []).map(x => String(parseInt(x, 10)));

    const mMonth = s.match(MONTH_RE);
    if (mMonth) moisNum = MOIS_MAP[mMonth[1]] || null;
  }

  if (!moisNum) moisNum = 7; // fallback: juillet

  // unicité, nettoyage
  jours = Array.from(new Set(jours)).filter(Boolean);
  if (!jours.length || !moisNum) return null;

  const joursStr = jours.length === 1
    ? jours[0]                      // une seule date → pas de parenthèses
    : `(${jours.join(",")})`;       // plusieurs → entre parenthèses

  return `${joursStr}/${pad2(moisNum)}`;
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
function _parseRelacheAvecParite(text) {
  const t = _norm(text || "");
  // cherche "... , relâche jours X" OU "... , jours X"
  const m = /(?:^|,|\s)(rel[aâ]che\s+)?(jours?\s+pairs?|jours?\s+impairs?)(?:\s|$)/i.exec(t);
  if (!m) return null;

  const hadRelachePrefix = !!m[1];
  const pariteFound = m[2].trim().toLowerCase(); // "jours pairs" | "jours impairs"
  return hadRelachePrefix ? pariteFound : _invertParite(pariteFound);
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
 * "vendredi 11 juillet 2025"      -> { session:"11/07", year:"2025" }
 * "8, 9, 10, …, 26 juillet 2025"  -> { session:"08,09,...,26/07", year:"2025" }
 * "9, 10 et 11 juillet 2025"      -> { session:"09,10,11/07", year:"2025" }
 */
function _parseDates(line) {
  if (!line) return { session: null, year: null };

  const raw = _normSpaces(line).trim();

  // repère "<mois> <année>"
  const reMonthYear = /\b(janvier|fevrier|février|mars|avril|mai|juin|juillet|aout|août|septembre|octobre|novembre|decembre|décembre)\b\s+(\d{4})/i;
  const mMY = raw.match(reMonthYear);
  if (!mMY) return { session: null, year: null };

  const monthTxt = mMY[1].toLowerCase();
  const year = mMY[2];
  const mNum = MOIS[monthTxt];
  if (!mNum) return { session: null, year: null };

  // ⚙️ ici on met le mois sur 2 chiffres sans modifier la const MOIS d’origine
  const mm = pad2(Number(mNum));

  const before = raw.slice(0, mMY.index).trim();

  // extrait toutes les occurrences de jours
  const daySeq = before
    .replace(/\bet\b/gi, ',')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map(x => x.match(/\d{1,2}$/)?.[0])
    .filter(Boolean)
    .map(n => pad2(+n));

  const seen = new Set();
  const days = daySeq.filter(d => (seen.has(d) ? false : (seen.add(d), true)));

  if (days.length === 0) return { session: null, year };

  if (days.length === 1) {
    return { session: `${days[0]}/${mm}`, year };
  } else {
    return { session: `(${days.join(',')})/${mm}`, year };
  }
}

// Extrait mois/année depuis la ligne info (ex: "... juillet 2025")
// normalise "HhM?" / "Hh" -> "HhMM" (H sans zéro initial, MM sur 2 chiffres)
function _normalizeHhmmLoose(s) {
  if (!s) return null;
  const m = String(s).match(/^(\d{1,2})h(\d{0,2})$/i);
  if (!m) return null;
  const h = Number(m[1]);                 // jamais padder l'heure
  const mm = m[2] === undefined || m[2] === '' ? 0 : Number(m[2]);
  return `${h}h${pad2(mm)}`;
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
  const mm = MOIS[m[1]] ? pad2(MOIS[m[1]]) : null;
  const yyyy = m[2] || null;
  return { mm, yyyy };
}

function _normalizeTitle(str) {
  return String(str || "")
    .normalize("NFD")                    // sépare les accents
    .replace(/[\u0300-\u036f]/g, "")    // enlève les accents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")        // tout le reste → espaces
    .trim();
}


// ==== Fetchers ====

// Fetcher AllOrigins en mode raw (renvoie du HTML/texte sans CORS)
async function _fetchViaAllOriginsRaw(urlToFetch) {
  const encoded = encodeURIComponent(urlToFetch);
  const apiUrl = `https://api.allorigins.win/raw?url=${encoded}`; // ou /get?url=... pour JSON {contents,...}
  const res = await fetch(apiUrl);          // HTTPS obligatoire
  if (!res.ok) throw new Error(`AllOrigins error ${res.status}`);
  const text = await res.text();           // HTML / texte de la page
  return text;
}

// Fetcher perso via worker CloudFlare 
const PROXY = 'https://off-proxy.joel-nicoloso.workers.dev';

export async function _fetchViaCloudFlareWorker(url, options = {}) {
  const isExternal = /^https?:\/\//i.test(url) && !url.includes(location.host);
  const finalUrl = isExternal ? `${PROXY}/?url=${encodeURIComponent(url)}` : url;
  const res = await fetch(finalUrl, options);
  if (!res.ok) throw new Error(`_fetchViaCloudFlareWorker failed ${res.status}`);
  return res;
}

// ==== Helpers ProgPageOff (soumet #js-form-filtres comme le site) ====

function _parseHTML(html) {
  return new DOMParser().parseFromString(html, 'text/html');
}

// Convertit un <form> en URLSearchParams (en gardant tous les filtres actifs)
function _formToParams(formEl) {
  // FormData gère inputs/checkbox/radios/select multiples
  const fd = new FormData(formEl);
  const params = new URLSearchParams();
  for (const [k, v] of /** @type {any} */ (fd).entries()) params.append(k, v);
  return params;
}

// Détecte le nom du champ "page" (parfois 'page', parfois 'current_page')
function _detectPageField(formEl) {
  const pageNames = ['page', 'current_page', 'paged'];
  for (const n of pageNames) {
    if (formEl.querySelector(`[name="${n}"]`)) return n;
  }
  // fallback : s’il y a un input de type hidden avec valeur numérique
  const guess = [...formEl.querySelectorAll('input[type="hidden"][name]')]
    .find(i => /^\d+$/.test(i.value || ''));
  return guess?.name || 'page';
}

// Lit la valeur page actuelle (1 par défaut si vide)
function _readCurrentPage(formEl, pageField) {
  const inp = formEl.querySelector(`[name="${pageField}"]`);
  const val = inp ? Number(inp.value || '1') : 1;
  return Number.isFinite(val) ? val : 1;
}

// Met à jour params pour demander la "prochaine" page
function _setNextPageParams(params, pageField, nextPage) {
  params.set(pageField, String(nextPage));
  // beaucoup de sites s’attendent à next_page=true
  params.set('next_page', 'true');
  return params;
}

// Dédup simple par triplet clé
function _makeKey(it) {
  return [it.Activite, it.Lieu, it.Session].map(x => x || '').join('||');
}

// ==== Helpers ProgPageIn ====
// Récupère le JSON d’événements contenu dans :events / events / data-events / :props.events
function _extractEventsPayload(el) {
  // 1) candidates d'attributs susceptibles de contenir les events
  const attrNames = [':events','events','data-events',':props','props'];
  let raw = null;

  for (const name of attrNames) {
    if (el.hasAttribute(name)) {
      raw = el.getAttribute(name);
      if (raw) break;
    }
  }
  if (!raw) return [];

  // 2) Décodage des entités HTML fréquentes
  raw = _decodeHtmlEntities(raw);

  // 3) Deux cas: a) c'est directement un tableau JSON; b) c'est un objet { events: [...] }
  //    On sécurise un chouïa : trim et vérifs de début/fin
  const t = raw.trim();

  // Direct: "[{...}, {...}]"
  if (t.startsWith('[')) {
    try { return JSON.parse(t); } catch {}
  }

  // Objet: "{ ... "events": [ ... ] ... }"
  try {
    const obj = JSON.parse(t);
    if (Array.isArray(obj?.events)) return obj.events;
  } catch {}

  // Dernier recours : parfois le serveur échappe les quotes en &quot;
  // (on a déjà fait un _decodeHtmlEntities, donc on s’arrête là si ça rate)
  return [];
}

function _decodeHtmlEntities(s) {
  if (!s) return s;
  // simple decode commun : &quot; &amp; &#x27; &#34; etc.
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&#x27;/gi, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function _orNull(v){ return v ?? null; }

function _absolutize(path, baseUrl) {
  try { return new URL(path, baseUrl || 'https://festival-avignon.com').href; }
  catch { return path; }
}

// Parse "YYYY-MM-DD HH:MM:SS" 
function _sqlDateToParts(s) {
  if (!s) return null;
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::\d{2})?)?$/);
  if (!m) return null;
  const [, y, mo, d, hh, mm] = m;
  return { y:+y, mo:+mo, d:+d, hh: hh!=null?+hh:null, mm: mm!=null?+mm:null };
}

function _calendarToSessionAndDebut(calendarArr) {
  const parts = (calendarArr || [])
    .map(c => _sqlDateToParts(c?.dateSummary)) // doit renvoyer { y, mo, d, hh, mm }
    .filter(Boolean);

  if (!parts.length) return { Session: null, Debut: null };

  // Debut = heure du premier créneau (on prend le plus tôt si mélangé)
  const partsSorted = [...parts].sort((a,b) =>
    a.y - b.y || a.mo - b.mo || a.d - b.d || (a.hh ?? 0) - (b.hh ?? 0) || (a.mm ?? 0) - (b.mm ?? 0)
  );
  const first = partsSorted[0];
  const Debut = (first.hh != null && first.mm != null) ? `${pad2(first.hh)}h${pad2(first.mm)}` : null;

  // Regroupe par (y,mo)
  const byMonth = new Map();
  for (const p of parts) {
    const key = `${p.y}-${pad2(p.mo)}`;
    if (!byMonth.has(key)) byMonth.set(key, new Set());
    byMonth.get(key).add(p.d);
  }

  // Trie les mois (y,mo) pour un rendu stable
  const monthKeys = [...byMonth.keys()].sort((a,b) => a.localeCompare(b));

  const segments = [];
  for (const key of monthKeys) {
    const mm = key.slice(5, 7);
    const days = [...byMonth.get(key)]
      .map(Number)
      .filter(Number.isFinite)
      .sort((a,b) => a - b);

    if (days.length === 1) {
      // ⟶ jour unique : "DD/MM"
      segments.push(`${pad2(days[0])}/${mm}`);
    } else {
      // ⟶ liste de jours : "(DD,DD,...)/MM"
      const dlist = days.map(d => pad2(d)).join(',');
      segments.push(`(${dlist})/${mm}`);
    }
  }

  const Session = segments.length === 1 ? segments[0] : segments.join('; ');
  return { Session, Debut };
}

// Choisit un style pertinent parmi les catégories
function _pickStyleFromCategories(categories) {
  const cats = (categories || []).map(c => (c?.title || '').trim()).filter(Boolean);
  if (!cats.length) return null;
  // Option 1 : on prend la 1re catégorie non générique
  const GENERIQUES = new Set(['Spectacles', 'Pour les anglophones']);
  const picked = cats.find(t => !GENERIQUES.has(t)) || cats[0];
  // Option 2 (si tu préfères) : return cats.join(' / ');
  return picked;
}

// Mapping principal pour ce payload 
function _mapEventToRow(ev, pageUrl) {
  const Activite = ev.title || ev.name || null;

  // Lieu
  const Lieu = ev.place?.title || ev.place?.name || ev.location?.name || null;

  // Style
  const Style = _pickStyleFromCategories(ev.categories);

  // URL fiche
  const id   = ev.id;
  const slug = ev.titleSlug || ev.slug;
  const Hyperlien = (slug && id)
    ? _absolutize(`/fr/edition-2026/programmation/${slug}-${id}`, pageUrl)
    : (ev.url || null);

  // Session & Debut depuis calendar[]
  const { Session, Debut: DebutFromCal } = _calendarToSessionAndDebut(ev.calendar);

  // Durée
  const Duree = (ev.duration != null) ? mmToHhmm(ev.duration) : null;

  // Debut explicite (si un autre champ existe) ; sinon celui du calendar
  const Debut = (ev.startHourStr || ev.startHour || null) ? _normalizeDebutLoose(ev.startHourStr || ev.startHour)
                                                          : DebutFromCal;

  const row = {
    Activite: _orNull(Activite),
    Debut: _orNull(Debut),
    Duree: _orNull(Duree),
    Lieu: _orNull(Lieu),
    Session: _orNull(Session),
    Relache: null,
    Style: _orNull(Style),
    Orga: 'In',
    Hyperlien: _orNull(Hyperlien)
  };

  // Ignore si vraiment vide
  if (Object.values(row).every(v => v == null)) return null;
  return row;
}

// Tolère "13h", "13:00", "13h00"
function _normalizeDebutLoose(h) {
  if (!h) return null;
  const s = String(h).trim().toLowerCase().replace(/\s+/g,'');
  let m = s.match(/^(\d{1,2})[:h](\d{2})$/);
  if (m) return `${pad2(+m[1])}h${pad2(+m[2])}`;
  m = s.match(/^(\d{1,2})$/);
  if (m) return `${pad2(+m[1])}h00`;
  m = s.match(/^(\d{1,2})h$/);
  if (m) return `${pad2(+m[1])}h00`;
  return null;
}


// ==== Helpers SpecPageIn ====
function _plainifyWithAbbr(el) {
  if (!el) return '';
  const clone = el.cloneNode(true);
  for (const ab of clone.querySelectorAll('abbr')) {
    ab.replaceWith(document.createTextNode(ab.textContent || ''));
  }
  return clone.textContent.replace(/\s+/g, ' ').trim();
}

// ==== Helpers ProgBilletReduc ====

// Construire l’URL de recherche (on encode proprement)
function _getBilletReducSearchURL(activiteNom) {
  const q = encodeURIComponent(activiteNom.trim());
  return `https://www.billetreduc.com/search.htm?se=${q}`;
}

// Construit une clé pour dédoublonner
function _makeKeyBilletReduc(it) {
  return [
    it.Activite || '',
    it.Lieu || '',
    it.Debut || '',
    it.Session || '',
    it.Hyperlien || ''
  ].join('@@');
}

function _extractDays(s) {
  const jours = [];
  s.split(/,|et/).forEach(tok => {
    const j = _abbrDay(tok.trim());
    if (j) jours.push(j);
  });
  return jours;
}

function _expandDays(j1, j2) {
  const all = ['lu','ma','me','je','ve','sa','di'];
  const i1 = all.indexOf(_abbrDay(j1));
  const i2 = all.indexOf(_abbrDay(j2));
  if (i1 === -1 || i2 === -1) return [];
  if (i1 <= i2) return all.slice(i1, i2 + 1);
  return [...all.slice(i1), ...all.slice(0, i2 + 1)];
}

function _abbrDay(j) {
  j = j.slice(0,3);
  const map = {
    lun:'lu', mar:'ma', mer:'me', jeu:'je', ven:'ve', sam:'sa', dim:'di'
  };
  return map[j] || null;
}

function _moisToNum(m) {
  if (!m) return '??';
  
  const map = {
    '1':'01','01':'01','janvier':'01',
    '2':'02','02':'02','fevrier':'02','février':'02',
    '3':'03','03':'03','mars':'03',
    '4':'04','04':'04','avril':'04',
    '5':'05','05':'05','mai':'05',
    '6':'06','06':'06','juin':'06',
    '7':'07','07':'07','juillet':'07',
    '8':'08','08':'08','aout':'08','août':'08',
    '9':'09','09':'09','septembre':'09',
    '10':'10','octobre':'10',
    '11':'11','novembre':'11',
    '12':'12','decembre':'12','décembre':'12'
  };
  return map[m] || '??';
}

function _parseBilletReducDatesEtHoraires(txt) {
  if (!txt) return null;

  // normalisation : accents + espaces
  let str = txt.normalize('NFD').replace(/\p{Diacritic}/gu, '');
  str = str.replace(/\s+/g, ' ').trim().toLowerCase();

  const items = [];
  let rangePart = null;
  const currentYear = new Date().getFullYear();

  // === 1) Plage de dates "du 19/11/2025 au 03/05/2026" ===
  const mRange = str.match(
    /du\s+(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?\s+au\s+(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?/
  );
  if (mRange) {
    const [, d1, m1, y1, d2, m2, y2] = mRange;
    const a1 = y1 ? y1.padStart(2, '0') : '';
    const a2 = y2 ? y2.padStart(2, '0') : '';
    rangePart =
      `[${d1.padStart(2, '0')}/${m1.padStart(2, '0')}` +
      (a1 ? '/' + a1.slice(-2) : '') +
      `-${d2.padStart(2, '0')}/${m2.padStart(2, '0')}` +
      (a2 ? '/' + a2.slice(-2) : '') +
      `]`;
  }

  // === 2) Cas spécial "du jeudi au samedi à 19h" ===
  const mRangeDays = str.match(
    /du\s+(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\s+au\s+(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\s+a\s+(\d{1,2}(?:h\d{0,2})?)/
  );
  if (mRangeDays) {
    const [, j1, j2, heure] = mRangeDays;
    const jours = _expandDays(j1, j2);
    items.push({
      days: jours,
      Debut: _normalizeHhmmLoose(heure),
    });
    return { rangePart: rangePart || null, items };
  }

  // === 3) Cas générique multi-segments :
  // "mardi et vendredi à 18h30, mercredi et jeudi à 16h30 et 18h30, samedi à 14h30"
  const dayPattern = '(?:lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)';
  const reMulti = new RegExp(
    `(${dayPattern}(?:\\s*(?:,|et)\\s*${dayPattern})*)\\s+a\\s+` +
      `((?:\\d{1,2}(?:h\\d{0,2})?)(?:\\s*et\\s*\\d{1,2}(?:h\\d{0,2})?)*)`,
    'g'
  );

  for (const m of str.matchAll(reMulti)) {
    const joursRaw  = m[1];   // ex: "mardi et vendredi" ou "mercredi et jeudi"
    const heuresRaw = m[2];   // ex: "16h30 et 18h30"

    const jours = _extractDays(joursRaw); // → ['ma','ve'] etc.
    const heures = heuresRaw
      .split(/\s*et\s*/i)
      .map(h => _normalizeHhmmLoose(h))
      .filter(Boolean);

    for (const Debut of heures) {
      items.push({ days: jours, Debut });
    }
  }

  // === 4) Cas "Le jeudi 20 novembre 2025 à 14h45" / "Le samedi 22 novembre à 11h00"
  const mOneDate = str.match(
    /le\s+(?:lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)?\s*(\d{1,2})\s*(?:\/| )?([0-9]{1,2}|janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre)?(?:\s*(\d{4}))?\s+a\s+(\d{1,2}(?:h\d{0,2})?)/
  );
  if (mOneDate) {
    const [, jourNum, moisTxt, anTxt, heureTxt] = mOneDate;
    const mois = _moisToNum(moisTxt); // "11" par ex.

    // Année : celle du texte si présente, sinon année courante
    const year = anTxt ? Number(anTxt) : currentYear;
    const yy   = String(year % 100).padStart(2, '0');
    const dd   = jourNum.padStart(2, '0');
    const mm   = mois;

    // Règle demandée :
    //  - si year == année courante -> "JJ/MM"
    //  - sinon -> "JJ/MM/AA"
    const session = (year === currentYear)
      ? `${dd}/${mm}`
      : `${dd}/${mm}/${yy}`;

    const Debut = _normalizeHhmmLoose(heureTxt);
    items.push({ days: [], Debut, session });
    return { rangePart: session, items };
  }

  // === 5) Aucun bloc horaire détecté, mais plage de dates connue ===
  if (!items.length && rangePart) {
    items.push({ days: [], Debut: null });
  }

  return { rangePart, items };
}

// "20 novembre au 20 décembre 2025" -> "[20/11/25-20/12/25]"
function _parseBilletReducDetailDateRange(txt) {
  if (!txt) return null;

  let s = String(txt).normalize('NFD').replace(/\p{Diacritic}/gu, '');
  s = s.replace(/\s+/g, ' ').trim().toLowerCase();

  // ex : "20 novembre au 20 decembre 2025"
  const re = /(\d{1,2})\s+([a-z]+)\s+au\s+(\d{1,2})\s+([a-z]+)\s+(\d{4})/;
  const m = s.match(re);
  if (!m) return null;

  const [, d1, mois1, d2, mois2, yearStr] = m;
  const mm1 = _moisToNum(mois1);
  const mm2 = _moisToNum(mois2);
  if (!mm1 || !mm2) return null;

  const yy = yearStr.slice(-2);
  const dd1 = d1.padStart(2, '0');
  const dd2 = d2.padStart(2, '0');

  return `[${dd1}/${mm1}/${yy}-${dd2}/${mm2}/${yy}]`;
}

// Durée "1 h 15 min" ou "1h15" -> "1h15"
function _parseBilletReducDetailDuree(dureeTxt) {
  if (!dureeTxt) return null;
  const s = dureeTxt.replace(/\s+/g, ' ').trim().toLowerCase();

  // "1 h 15 min" / "1h15" / "1 h" / "75 min"
  let minutes = 0;

  let m = s.match(/(\d{1,2})\s*h(?:\s*(\d{1,2})\s*min)?/);
  if (m) {
    const h = Number(m[1] || 0);
    const mn = Number(m[2] || 0);
    minutes = h * 60 + mn;
  } else {
    m = s.match(/(\d{1,3})\s*min/);
    if (m) {
      minutes = Number(m[1] || 0);
    }
  }

  if (!minutes || !Number.isFinite(minutes) || minutes <= 0) return null;

  // mmToHhmm :
  const h = Math.floor(minutes / 60);
  const mn = minutes % 60;
  return `${h}h${String(mn).padStart(2, '0')}`;
}

// ==== Helpers getBilletReduc ====

// Trouve une URL de page de détail à partir d'une page de recherche BilletReduc
function _findBilletReducDetailUrlFromSearchDoc(searchDoc, searchUrl, activite) {
  if (!searchDoc || !searchUrl || !activite) return null;

  const base = new URL(searchUrl);
  const targetNorm = _normalizeTitle(activite);
  if (!targetNorm) return null;

  // Tous les liens de résultats de recherche
  const anchors = Array.from(
    searchDoc.querySelectorAll('a.gtm-select-event, a.head.gtm-select-event')
  );

  // Aucun lien → typiquement page "désolé, nous n’avons pas..." ou noBot → on sort proprement
  if (!anchors.length) {
    return null;
  }

  // On cherche UNIQUEMENT un match exact sur le titre normalisé
  for (const a of anchors) {
    const href = a.getAttribute("href");
    const txt  = a.textContent || "";
    if (!href || !txt) continue;

    const tNorm = _normalizeTitle(txt);
    if (!tNorm) continue;

    if (tNorm === targetNorm) {
      // Premier match exact trouvé → on construit l'URL absolue et on s'arrête
      const detailUrl = new URL(href, base.origin).toString();
      return detailUrl;
    }
  }

  // AUCUN match exact → on ne prend rien (on évite de se tromper de spectacle)
  return null;
}

// ==== Helpers enrichWithAbstractPremium ====

// Renvoie le résumé d’un item via le worker AI
async function _summarizeOneItemViaWorker(item) {
  const key = `${item.activite}-${item.lieu}`;
  if (_summaryCache.has(key)) {
    return _summaryCache.get(key);
  }

  const resp = await fetch("https://off-proxy.joel-nicoloso.workers.dev/ai/summarize_one", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ item })
  });

  if (!resp.ok) {
    const txt = await resp.text().catch(() => "");
    throw new Error(`summarize_one error ${resp.status}: ${txt}`);
  }

  const res = await resp.json();
  _summaryCache.set(key, res);
  return res;
}

async function _enrichAllWithDetails(all, specPageUrlParser) {
  if (!Array.isArray(all) || all.length === 0) return all;

  await Promise.all(
    all.map(async (row) => {
      try {
        const url = row.Hyperlien;
        if (!url) return;

        /** @type {any} */
        const detail = await specPageUrlParser(url);
        if (!detail) return;

        row.Description  = detail[0].Description || "";
        row.Distribution = detail[0].Distribution || "";

      } catch (err) {
        console.warn("[OFF] détail KO:", row.Hyperlien, err);
      }
    })
  );

   return all;
}