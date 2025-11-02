// parsers.js

import { 
  mmToHHhMM,
  mmToHhmm,
  pad2,
  parseDurationToHhmm,
} from './utils-date.js';

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
    Hyperlien: null
};

/**
 * Parser d'une page programme du catalogue Avignon In donnée par son URL
 * @param {*} doc 
 * @returns 
 */
export async function parseAvignonInProgPageUrl(url, { fetcher = _fetchViaCloudFlareWorker } = {}) {
  const res  = await fetcher(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} on ${url}`);
  const html = await res.text();
  const doc  = new DOMParser().parseFromString(html, 'text/html');
  return parseAvignonInProgPageDom(doc, url);
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
 * @param {*} doc 
 * @returns 
 */
export async function parseAvignonInSpecPageUrl(url, { fetcher = _fetchViaCloudFlareWorker } = {}) {
  const res  = await fetcher(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} on ${url}`);
  const html = await res.text();
  const doc  = new DOMParser().parseFromString(html, 'text/html');
  const parsed = parseAvignonInSpecPageDom(doc, url);
  if (parsed) parsed.Hyperlien = url;
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

  const out = [{ ...PARSED_DEFAULT, Activite, Style, Duree, Lieu, Orga: 'In', Hyperlien }];
  // Si vraiment rien, renvoie null pour signaler l'échec
  if (Object.values(out).every(v => v == null)) return null;
  return out;
}

/**
 * Parser d'une page spectacle du catalogue Avignon In donnée par son texte
 * @param {*} doc 
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
 * @param {number}  opts.maxPages   - sécurité (par défaut 50)
 * @param {number}  opts.delayMs    - pause entre requêtes (120ms par défaut)
 * @param {boolean} opts.verbose    - logs console
 * @returns {Promise<Array>}        - liste d’objets parsés (Activite, Lieu, Session, Debut, Duree, Style, Hyperlien)
 */
export async function parseAvignonOffProgPageUrl(url, { maxPages = 50, delayMs = 120, verbose = false } = {}) {
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

  // "du 5 au 26"  -> "[05-26]/07"
  // "le 17"       -> "[17-17]/07"
  const parseSession = (txt) => {
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
    const Session = parseSession(dateTxt) || null;

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
 * @param {*} doc 
 * @returns 
 */
export async function parseAvignonOffSpecPageUrl(url, { fetcher = _fetchViaCloudFlareWorker } = {}) {
  const res  = await fetcher(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} on ${url}`);
  const html = await res.text();
  const doc  = new DOMParser().parseFromString(html, 'text/html');
  const parsed = parseAvignonOffSpecPageDom(doc, url);
  if (parsed) parsed.Hyperlien = url;
  return parsed;
}

/**
 * Parser d'une page spectacle du catalogue Avignon Off donnée par son Dom
 * parseListingHtml(html, { url })
 * @param {string} html
 * @param {{url?: string}} opts
 * @return {{Activite:string|null, Lieu:string|null, Relache:string|null, Debut:string|null, Duree:string|null, Hyperlien:string|null}}
 */
export function parseAvignonOffSpecPageDom(doc, { url=null } = {}) {
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
  
    const session = _parseSession(bigText);
    if (session && session.length) res.Session = session;
  }

  res.Orga = "Off";

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
function _normalizeDuree(hhmm) {
  const m = /(\d{1,2})h(\d{1,2})/.exec(_norm(hhmm));
  if (!m) return null;
  const h = String(parseInt(m[1],10));
  const mm = String(parseInt(m[2],10)).padStart(2,'0');
  return `${h}h${mm}`;
}

/** Extrait les dates de représentation en token */
function _parseSession(text) {
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
function _parseRelache(text) {
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
function _parseRelacheAvecParite(text) {
  const t = _norm(text || "");
  // cherche "... , relâche jours X" OU "... , jours X"
  const m = /(?:^|,|\s)(rel[aâ]che\s+)?(jours?\s+pairs?|jours?\s+impairs?)(?:\s|$)/i.exec(t);
  if (!m) return null;

  const hadRelachePrefix = !!m[1];
  const pariteFound = m[2].trim().toLowerCase(); // "jours pairs" | "jours impairs"
  return hadRelachePrefix ? pariteFound : _invertParite(pariteFound);
}

// Extrait Lieu / Session / Debut / Duree depuis la ligne 3
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

  // Session: "du d1 au d2" OU "le d"
  let Session = null;
  const mDuAu = l.match(/\bdu\s+(\d{1,2})\s+au\s+(\d{1,2})\b/i);
  const mLe   = l.match(/\ble\s+(\d{1,2})\b/i);
  if (mDuAu) {
    const d1 = pad2(+mDuAu[1]);
    const d2 = pad2(+mDuAu[2]);
    Session = `[${d1}-${d2}]/${moisNum}`;
  } else if (mLe) {
    const d = pad2(+mLe[1]);
    Session = `[${d}-${d}]/${moisNum}`;
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

  return { Lieu, Session, Debut, Duree };
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
  for (const [k, v] of fd.entries()) params.append(k, v);
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

// Construit Session & Debut à partir de ev.calendar[].dateSummary
function _calendarToSessionAndDebut(calendarArr) {
  const parts = (calendarArr || [])
    .map(c => _sqlDateToParts(c?.dateSummary))
    .filter(Boolean);
  if (!parts.length) return { Session: null, Debut: null };

  // Debut = heure du 1er
  const first = parts[0];
  const Debut = (first.hh!=null && first.mm!=null) ? `${pad2(first.hh)}h${pad2(first.mm)}` : null;

  // regroupe par (y,mo) pour tolérer plusieurs mois
  const byMonth = new Map();
  for (const p of parts) {
    const key = `${p.y}-${pad2(p.mo)}`;
    if (!byMonth.has(key)) byMonth.set(key, new Set());
    byMonth.get(key).add(p.d);
  }

  const segments = [];
  for (const [key, daysSet] of byMonth) {
    const mm = key.slice(5,7);
    const days = [...daysSet].map(d => pad2(d)).sort();
    const seg = (days.length === 1)
      ? `[${days[0]}-${days[0]}]/${mm}`
      : `(${days.join(',')})/${mm}`;
    segments.push(seg);
  }

  // S'il n'y a qu'un mois, renvoie un seul segment ; sinon join
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
    ? _absolutize(`/fr/edition-2025/programmation/${slug}-${id}`, pageUrl)
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

