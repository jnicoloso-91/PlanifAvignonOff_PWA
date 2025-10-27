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
 * Parser du HTML d'une page de description de spectacle du catalogue Avignon Off 
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
 * Parse le texte brut des pages catégorie Avignon Off.
 * Recherche des séquences du type :
 *   Affiche du spectacle : <Titre>
 *   <Titre>                (parfois répété)
 *   <Lieu> du <d1> au <d2> <HHhMM> <HhMM>
 *   <Style>
 *   Ticket'Off (ligne suivante – ignorée ici)
 *
 * Renvoie: Array<{...PARSED_DEFAULT}>
 */
// export function parseAvignonOffCatPageText(text) {
//   if (!text) return [];

//   // Normalisation douce : CRLF -> LF, trim des lignes
//   const lines = String(text)
//     .replace(/\r\n?/g, '\n')
//     .split('\n')
//     .map(l => l.replace(/\s+/g, ' ').trim());

//   const results = [];
//   const isAffiche = (s) => /affiche du spectacle\s*:?/i.test(s);
//   const isEmpty = (s) => !s || s === '';

//   for (let i = 0; i < lines.length; i++) {
//     if (!isAffiche(lines[i])) continue;

//     // ----- 1) ACTIVITÉ (titre)
//     // Titre peut être sur la même ligne après ":" ou à la ligne suivante
//     let activite = null;
//     const mSameLine = lines[i].match(/affiche du spectacle\s*:?\s*(.+)$/i);
//     if (mSameLine && mSameLine[1] && mSameLine[1].trim()) {
//       activite = mSameLine[1].trim();
//     }

//     // Cherche la première ligne non vide suivante si pas trouvé (ou si doublon)
//     let j = i + 1;
//     while (!activite && j < lines.length && isEmpty(lines[j])) j++;
//     if (!activite && j < lines.length) {
//       activite = lines[j];
//       j++;
//     } else {
//       // On saute la ligne suivante si elle répète le titre tel quel
//       if (j < lines.length && lines[j] && activite && lines[j].toLowerCase() === activite.toLowerCase()) {
//         j++;
//       }
//     }

//     // ----- 2) LIEU + DATES + HEURE + DURÉE (sur une même ligne en général)
//     // Exemple : "PETIT CHIEN (THÉÂTRE LE) du 5 au 26 19h05 1h10"
//     // On accepte des variantes : accents, espaces, ordre souple pour HHhMM & HhMM.
//     let lieu = null, debut = null, duree = null, sessions = null;

//     // Avance jusqu’à la prochaine ligne non vide plausible
//     while (j < lines.length && isEmpty(lines[j])) j++;

//     if (j < lines.length) {
//       const line = lines[j];

//       // Détection "du X au Y" (X,Y = 1..31) – assez permissif
//       // On capture le lieu avant " du " ; on cherche ensuite heure et durée n’importe où.
//       const duAu = line.match(/\bdu\s+(\d{1,2})\b.*?\bau\s+(\d{1,2})\b/i);
//       // Heure type 19h05
//       const mHeure = line.match(/\b(\d{1,2}h\d{2})\b/);
//       // Durée type 1h10 (on prend la *deuxième* occurrence h/mm si deux h:mm sur la ligne)
//       const hTokens = [...line.matchAll(/\b(\d{1,2}h\d{2})\b/g)].map(x => x[1]);

//       // Lieu = tout avant " du " si présent, sinon la ligne jusqu’à l’heure
//       let lieuCandidate = line;
//       const idxDu = line.toLowerCase().indexOf(' du ');
//       if (idxDu > 0) {
//         lieuCandidate = line.slice(0, idxDu).trim();
//       } else if (mHeure) {
//         lieuCandidate = line.slice(0, line.indexOf(mHeure[0])).trim();
//       }
//       if (lieuCandidate) lieu = lieuCandidate;

//       if (mHeure) {
//         // S'il y a deux h:mm, on suppose 1) heure début, 2) durée
//         if (hTokens.length >= 2) {
//           debut = hTokens[0];
//           duree = hTokens[1];
//         } else {
//           debut = mHeure[1];
//           // Durée absente : on laisse à null
//         }
//       }

//       if (duAu) {
//         const d1 = _pad3(duAu[1]);
//         const d2 = _pad3(duAu[2]);
//         // Par convention Off : juillet → "/07"
//         sessions = `[${d1}-${d2}]/07`;
//       }

//       j++;
//     }

//     // ----- 3) STYLE : ligne suivante non vide qui n’est pas un mot-clé (Ticket'Off, etc.)
//     let style = null;
//     while (j < lines.length && isEmpty(lines[j])) j++;
//     if (j < lines.length) {
//       const cand = lines[j];
//       if (!/^ticket'?off\b/i.test(cand) && !isAffiche(cand)) {
//         style = cand;
//         j++;
//       }
//     }

//     // (Relâches, Hyperlien : non fournis dans l’exemple → null)
//     const item = {
//       ...PARSED_DEFAULT,
//       Activite: activite || null,
//       Debut: debut || null,
//       Duree: duree || null,
//       Lieu: lieu || null,
//       Sessions: sessions || null,
//       Relaches: null,
//       Style: style || null,
//       Hyperlien: null
//     };

//     // Ajoute l’item si on a au moins un titre ou un lieu détecté
//     if (item.Activite || item.Lieu) {
//       results.push(item);
//     }

//     // Continue la boucle principale à partir de j (mais i++ reprendra de toute façon)
//     // On n’avance pas i ici pour rester simple; coût négligeable.
//   }

//   return results;
// }

// export function parseAvignonOffCatPageText(text) {
//   if (!text) return [];
//   const lines = String(text).replace(/\r\n?/g, '\n').split('\n').map(l => l.trim());
//   const results = [];
//   const reAffiche = /affiche du spectacle\b/i;
//   const reDuAu = /\bdu\s+(\d{1,2})\s+au\s+(\d{1,2})\b/i;

//   for (let i = 0; i < lines.length; i++) {
//     if (!reAffiche.test(lines[i])) continue;

//     // --- 1) ACTIVITÉ : toujours la 1re ligne non vide APRÈS "Affiche du spectacle ..."
//     let j = i + 1;
//     while (j < lines.length && !lines[j]) j++;
//     if (j >= lines.length) continue;

//     const activite = _stripQuotes(lines[j]);
//     const activiteN = _norm(activite);
//     j++; // avance après le titre

//     // --- 2) SAUTER les lignes qui répètent/étendent le titre (ex: Titre "sous-titre")
//     while (j < lines.length) {
//       const l = lines[j];
//       if (!l) { j++; continue; }
//       const lN = _norm(_stripQuotes(l));
//       if (lN === activiteN || lN.startsWith(activiteN + ' ')) { j++; continue; }
//       break;
//     }

//     // --- 3) LIEU + DATES + HEURE/DURÉE (chercher la prochaine ligne contenant "du <d1> au <d2>")
//     let lieu = null, debut = null, duree = null, sessions = null;
//     let k = j, foundIdx = -1;
//     const mmToHHhMM = (mins) => {
//       const m = Math.max(0, Number(mins) || 0);
//       const hh = Math.floor(m / 60);
//       const mm = m % 60;
//       return `${String(hh).padStart(1, '0')}h${String(mm).padStart(2, '0')}`;
//     };

//     for (; k < lines.length; k++) {
//       const l = lines[k];
//       if (!l) continue;
//       if (reAffiche.test(l)) break; // nouveau bloc → stop
//       if (reDuAu.test(l)) { foundIdx = k; break; }
//     }
//     if (foundIdx !== -1) {
//       const l = lines[foundIdx];

//       // Lieu = tout avant " du "
//       const idxDu = l.toLowerCase().indexOf(' du ');
//       lieu = (idxDu > 0 ? l.slice(0, idxDu) : l).trim();

//       // Sessions [DD-DD]/07 (ou branche vers extractPeriodeJouee si tu veux le mois réel)
//       const mDates = l.match(reDuAu);
//       if (mDates) {
//         const d1 = _pad3(+mDates[1]);
//         const d2 = _pad3(+mDates[2]);
//         sessions = `[${d1}-${d2}]/07`;
//       }

//       // Heures & Durée
//       //  - hTokens : "14h55", "1h20" …
//       //  - mTokens : "55min", "75 min", "90mins" …
//       const hTokens = [...l.matchAll(/\b(\d{1,2})h(\d{2})\b/gi)]
//         .map(m => ({ t: `${m[1].padStart(2,'0')}h${m[2]}`, idx: m.index }));
//       const mTokens = [...l.matchAll(/\b(\d{1,3})\s*m(?:in)?s?\b/gi)]
//         .map(m => ({ mins: Number(m[1]), idx: m.index }));

//       // Début = 1er token "HHhMM" rencontré
//       if (hTokens.length >= 1) {
//         debut = hTokens[0].t;
//       }

//       // Durée : priorité au 2e "hToken" après l'heure de début, sinon à un "minToken" après
//       if (debut) {
//         const startIdx = hTokens[0].idx ?? 0;
//         const durH = hTokens.find((x, i) => i > 0 && x.idx > startIdx);
//         if (durH) {
//           duree = durH.t; // ex. "1h20"
//         } else {
//           const durM = mTokens.find(x => x.idx > startIdx) || mTokens[0];
//           if (durM) duree = mmToHHhMM(durM.mins);
//         }
//       } else {
//         // Cas très rare : pas d'heure de début trouvée mais une durée en minutes présente
//         if (mTokens.length) {
//           duree = mmToHHhMM(mTokens[0].mins);
//         }
//       }

//       j = foundIdx + 1;
//     }

//     // --- 4) STYLE : 1re ligne non vide qui suit (hors Ticket'Off / nouveau bloc)
//     let style = null;
//     while (j < lines.length) {
//       const l = lines[j];
//       if (!l) { j++; continue; }
//       if (/^ticket'?off\b/i.test(l)) { j++; continue; }
//       if (reAffiche.test(l)) break;
//       style = l;
//       j++;
//       break;
//     }

//     results.push({
//       ...PARSED_DEFAULT,
//       Activite: activite || null,
//       Debut: debut || null,
//       Duree: duree || null,
//       Lieu: lieu || null,
//       Sessions: sessions || null,
//       Relaches: null,
//       Style: style || null,
//       Hyperlien: null
//     });
//   }

//   return results;
// }


export function parseAvignonOffCatPageText(text) {
  if (!text) return [];
  const rawLines = String(text).replace(/\r\n?/g, '\n').split('\n');
  const lines = rawLines.map(s => _strip(s)); // on garde les vides pour sauter proprement
  const out = [];

  for (let i = 0; i < lines.length; i++) {
    const l1 = lines[i];
    if (!/^\s*affiche du spectacle\b/i.test(l1)) continue;

    // Ligne 2 : Titre (première ligne non vide après l1)
    let j = i + 1;
    while (j < lines.length && !lines[j]) j++;
    if (j >= lines.length) break;
    const Activite = _stripQuotes(lines[j]);
    j++;

    // Ligne 3 : Info (première ligne non vide après)
    while (j < lines.length && !lines[j]) j++;
    if (j >= lines.length) break;
    const infoLine = lines[j];
    const { Lieu, Sessions, Debut, Duree } = _parseInfoLine(infoLine);
    j++;

    // Ligne 4 : Style (première ligne non vide après)
    while (j < lines.length && !lines[j]) j++;
    let Style = null;
    if (j < lines.length) {
      const s = lines[j];
      if (!/^ticket'?off\b/i.test(s) && !/^\s*affiche du spectacle\b/i.test(s)) {
        Style = s;
      }
    }

    out.push({
      ...PARSED_DEFAULT,
      Activite,
      Lieu: Lieu || null,
      Sessions: Sessions || null,
      Debut: Debut || null,
      Duree: Duree || null,
      Style: Style || null,
      Relaches: null,
      Orga: "Off",
      Hyperlien: null
    });

    // Avancer i jusqu'au début du prochain bloc pour éviter rescan inutile
    i = j;
  }

  return out;
}


/**
 * Détermine si le texte correspond à une page CATEGORIE
 * (ex : "festival Off Avignon  > Programme")
 */
export function isAvignonOffCatPageText(text) {
  if (!text) return false;
  const lines = String(text)
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(l => l.trim());
  return lines.some(l => l === 'festival Off Avignon  > Programme');
}

/**
 * Détermine si le texte correspond à une page SPECTACLE
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

function _norm(s) {
  return String(s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // enlève accents
    .replace(/\s+/g, ' ')                             // espaces multiples -> simple
    .trim();
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

