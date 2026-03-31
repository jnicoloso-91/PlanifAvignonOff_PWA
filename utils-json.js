// ===============================
// Module Utils Json
// Contient des helpers permettant de générer les Json permettant de builder les index AI
// ===============================

import {
  escapeAttr,
} from './utils.js';

import { 
  activitesAPI,
} from './app.js'; 

import { 
  makeFullKey 
} from './activites.js'; 

import {
  parseAvignonInSpecPageUrl, 
  parseAvignonOffSpecPageUrl, 
  getBilletReducAvis,
} from './parsers.js';

// Pause d’exécution
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Téléchargement d’un objet JSON
function downloadJson(data, filename = 'export.json') {
  const blob = new Blob(
    [JSON.stringify(data, null, 2)],
    { type: 'application/json' }
  );
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();

  URL.revokeObjectURL(url);
}

// Enrichissement d'un df avec champ Mood
// A utiliser en mode console pour compléter un catalogue avec le champ Mood si absent
async function enrichDfWithMood(df, {
  basePath = "./ai",                      // chemin relatif depuis la page
  indexName = "index_avignon_2025.json",  // nom de l'index à utiliser
  overwrite = false,                      // écraser un mood existant ?
  log = true
} = {}) {
  if (!Array.isArray(df)) {
    throw new Error("df doit être un tableau");
  }

  // 1) Chargement des fichiers
  const all = await fetch(`${basePath}/${indexName}`).then(r => r.json());

  // 2) Construction map clé -> mood
  const moodMap = new Map();

  for (const it of all) {
    const key = makeFullKey(it);
    if (!key) continue;
    if (it.mood) {
      moodMap.set(key, it.mood);
    }
  }

  // 3) Enrichissement du df
  let copied = 0;
  let skipped = 0;

  for (const row of df) {
    const key = makeFullKey(row);
    if (!key) {
      skipped++;
      continue;
    }

    if (!overwrite && row.Mood) {
      skipped++;
      continue;
    }

    const mood = moodMap.get(key);
    if (mood) {
      row.Mood = mood;
      copied++;
    } else {
      skipped++;
    }
  }

  if (log) {
    console.log(
      `Mood enrichi : ${copied} lignes | ignorées : ${skipped} | index moods : ${moodMap.size}`
    );
  }

  return df;
}

// Enrichissement d'un df avec champ __distribution
// A utiliser en mode console pour compléter un catalogue avec le champ Distribution du json si absent
async function enrichDfWithDistribution(df, {
  basePath = "./ai",                      // chemin relatif depuis la page
  indexName = "index_avignon_2025.json",  // nom de l'index à utiliser
  overwrite = false,                      // écraser un mood existant ?
  log = true
} = {}) {
  if (!Array.isArray(df)) {
    throw new Error("df doit être un tableau");
  }

  // 1) Chargement des fichiers
  const all = await fetch(`${basePath}/${indexName}`).then(r => r.json());

  // 2) Construction map clé -> distribution
  const distriMap = new Map();

  for (const it of all) {
    const key = makeFullKey(it);
    if (!key) continue;
    if (it.mood) {
      distriMap.set(key, it.distribution);
    }
  }

  // 3) Enrichissement du df
  let copied = 0;
  let skipped = 0;

  for (const row of df) {
    const key = makeFullKey(row);
    if (!key) {
      skipped++;
      continue;
    }

    if (!overwrite && row.Mood) {
      skipped++;
      continue;
    }

    const distribution = distriMap.get(key);
    if (distribution) {
      row.__distribution = distribution;
      copied++;
    } else {
      skipped++;
    }
  }

  if (log) {
    console.log(
      `Distribution enrichi : ${copied} lignes | ignorées : ${skipped} | index moods : ${distriMap.size}`
    );
  }

  return df;
}

// Enrichissement d'un df avec InfoPlus
// A utiliser en mode console pour compléter un catalogue avec les champs desc_summary et avis_summary si absents
async function enrichDfWithInfoPlus(df, {
  basePath = "./ai",                      // chemin relatif depuis la page
  indexName = "index_avignon_2025.json",  // nom de l'index à utiliser
  overwrite = false,                      // écraser un mood existant ?
  log = true
} = {}) {
  if (!Array.isArray(df)) {
    throw new Error("df doit être un tableau");
  }

  // 1) Chargement des fichiers
  const all = await fetch(`${basePath}/${indexName}`).then(r => r.json());

  console.log(`enrichDfWithInfoPlus: loaded ${all.length} entries from info-plus index`);

  // 2) Construction map clé -> mood
  const infoMap = new Map();

  for (const it of all) {
    const key = makeFullKey(it);
    if (!key) continue;
    if (it.desc_summary || it.avis_summary) {
      infoMap.set(key, {desc_summary:it.desc_summary || null, avis_summary:it.avis_summary || null} );
    }
  }

  // 3) Enrichissement du df
  let copied = 0;
  let skipped = 0;

  for (const row of df) {
    const key = makeFullKey(row);
    if (!key) {
      skipped++;
      continue;
    }

    if (!overwrite && row.desc_summary && row.avis_summary) {
      skipped++;
      continue;
    }

    const infoPlus = infoMap.get(key);
    if (infoPlus) {
      row.__desc_summary = escapeAttr(infoPlus.desc_summary);
      row.__avis_summary = escapeAttr(infoPlus.avis_summary);
      copied++;
    } else {
      skipped++;
    }
  }

  if (log) {
    console.log(
      `summaries : ${copied} lignes | ignorées : ${skipped} | index : ${infoMap.size}`
    );
  }

  return df;
}

/**
 * Enrichit un tableau de rows activité avec : Description / Distribution / Avis
 * @param {*} rows     tableau de rows activité
 * @param {*} polite   tempo entre chaque interrogation web
 */
async function enrichWithDetailsAndAvis(
  rows,
  { polite = true } = {}
) {
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];

    const orga      = (r.Orga || r.orga || r.Section || r.section || "").toLowerCase();
    const hyperlien = r.Hyperlien || r.hyperlien || null;
    const activite  = r.Activite || r.activite || null;

    // --- 1) Détail In / Off → Description + Distribution
    try {
      if (hyperlien && activite) {
        if (orga === "off") {
          const parsed = await parseAvignonOffSpecPageUrl(hyperlien);
          const row    = Array.isArray(parsed) ? parsed[0] : parsed;

          if (row) {
            if (row.Description)  r.Description  = row.Description;
            if (row.Distribution) r.Distribution = row.Distribution;
          }

          console.log(`Description & distribution ajoutés à ${activite}`);

        } else if (orga === "in") {
          const parsed = await parseAvignonInSpecPageUrl(hyperlien);
          const row    = Array.isArray(parsed) ? parsed[0] : parsed;

          if (row) {
            if (row.Description)  r.Description  = row.Description;
            if (row.Distribution) r.Distribution = row.Distribution;
          }

          console.log(`Description & distribution ajoutés à ${activite}`);

        }
      }
    } catch (e) {
      console.warn("Enrichissement In/Off détaillé impossible pour", activite, hyperlien, e);
    }

    // --- 2) Avis BilletRéduc (via URL de recherche)
    try {
      if (activite) {
        const { avis } = await getBilletReducAvis(activite);
        if (avis) {
          // On peut soit stocker l'objet complet, soit une version texte compacté
          // Ici on choisit le texte compacté qui passe dans les embeddings existants
          const notePart = avis.Note ? `Note ${avis.Note}` : "";
          const commentsPart =
            avis.Comments && avis.Comments.length
              ? `Commentaires: ${avis.Comments.join(" || ")}`
              : "";

          const avisText = [notePart, commentsPart].filter(Boolean).join(" — ");
          if (avisText) {
            r.Avis = avisText;
          }

          console.log(`Avis ajoutés à ${activite}`);

        }
      }
    } catch (e) {
      console.warn("Enrichissement Avis BilletReduc impossible pour", activite, e);
    }

    // --- Throttling "gentil"
    if (polite) {
      // On ne fait pas d'appel pour tous les items => ne dormir que si un fetch a vraiment eu lieu
      await sleep(1500 + Math.random() * 1000); // 1.5–2.5s
    }
  }
}

/**
 * Construit les données source pour le build_index IA.
 *
 * @param {Array<object>} df
 * @param {string} sectionLabel                 - "off" ou "in"
 * @param {number|null} editionYear             - ex: 2025 (facultatif, sert de fallback pour l'année)
 */
function buildAiExportFromDf(df, sectionLabel, editionYear = null) {
  function cleanField(v) {
    if (v == null) return null;
    const s = String(v).trim();
    return s.length ? s : null;
  }

  if (!Array.isArray(df)) return [];

  const out = [];
  const section = sectionLabel || null;

  for (const r of df) {
    if (!r) continue;
    if (String(r.Orga || '').toLowerCase() !== sectionLabel.toLowerCase()) continue;

    const sessionVal = cleanField(r.Session);
    const relacheVal = cleanField(r.Relache);

    const seances = activitesAPI.buildSeancesFromSessionRelache(
      sessionVal,
      relacheVal,
      editionYear
    );

    const row = {
      Activite: cleanField(r.Activite),
      Debut: cleanField(r.Debut),
      Duree: cleanField(r.Duree),
      Fin: cleanField(r.Fin),
      Style: cleanField(r.Style),
      Lieu: cleanField(r.Lieu),
      Session: cleanField(r.Session),
      Relache: cleanField(r.Relache),
      Hyperlien: cleanField(r.Hyperlien),
      HyperlienGoogle: cleanField(r.HyperlienGoogle),
      HyperlienBR: cleanField(r.HyperlienBR),
      Section: section,      // 🔹 nouveau champ : "off" ou "in"
      Seances: seances,      // 🔹 nouveau champ : tableau ISO
      __uuid: r.__uuid || null
    };

    out.push(row);
  }

  return out;
}

/**
 * Extrait une note au format "10 (xx avis)" à partir d'une chaîne Avis.
 * Exemple Avis: "Note 9/10 (35 avis) — Commentaires: ..."
 * -> "9 (35 avis)"
 */
function extractNoteFromAvis(avisRaw) {
  if (!avisRaw) return null;
  const s = String(avisRaw);

  // Cas complet : "Note 9/10 (35 avis)"
  let m = s.match(/(\d{1,2})\s*\/\s*10\s*\((\d+)\s*avis\)/i);
  if (m) {
    const note  = m[1];
    const count = m[2];
    return `${note} (${count} avis)`;
  }

  // Cas plus simple (sécurité) : "9/10" sans le nombre d'avis
  m = s.match(/(\d{1,2})\s*\/\s*10\b/i);
  if (m) {
    const note = m[1];
    return `${note} (avis)`;
  }

  return null;
}

/**
 * Exporte le json servant à faire l'index pour le In et le Off
 * @param {*} orga          doit valoir 'in' ou 'off' 
 * @param {*} editionYear   année de l'édition (2025 par défaut)
 */
export async function exportJsonForAi(orga, editionYear = 2025) {
  const df = ctx.df;
  const jsonData = buildAiExportFromDf(df, orga, editionYear);
  await enrichWithDetailsAndAvis(jsonData, { polite: true });

  const filename = `${orga}_${editionYear}.json`;
  downloadJson(jsonData, filename);
  alert( `Infos téléchargées dans ${filename}`)
}

/**
 * Demande le nom d'un catalogue JSON (in_20XX.json / off_20XX.json)
 * et met à jour df.Note à partir du champ Avis du JSON,
 * en faisant le matching via makeFullKey(row).
 */
function importNotesFromAiJson() {

  const input = document.createElement("input");
  input.type = "file";
  input.accept = "application/json";

  input.addEventListener("change", (ev) => {
// @ts-ignore
    const file = ev.target.files && ev.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target.result;
// @ts-ignore
        const data = JSON.parse(text);

        if (!Array.isArray(data)) {
          alert("Le fichier JSON doit contenir un tableau d'objets.");
          return;
        }

        // --- Map index_key -> Note "10 (xx avis)"
        const noteMap = new Map();

        for (const r of data) {
          if (!r) continue;

          // On reconstruit une "row" minimale compatible avec makeFullKey
          const fakeRow = {
            Activite: r.Activite ?? r.activite ?? null,
            Debut:    r.Debut    ?? r.debut    ?? null,
            Lieu:     r.Lieu     ?? r.lieu     ?? null,
            __seances: r.__seances || r.Seances || r.seances || null
          };

          const key = makeFullKey(fakeRow);
          if (!key) continue;

          const avisRaw = r.Avis ?? r.avis ?? null;
          if (!avisRaw) continue;

          const noteStr = extractNoteFromAvis(avisRaw);
          if (!noteStr) continue;

          noteMap.set(key, noteStr);
        }

        console.log("NoteMap construit, entrées:", noteMap.size);

        // --- Parcours du df courant
        let df = ctx.getDf().slice();
        let updated = 0;
        let matched = 0;

        for (let i = 0; i < df.length; i++) {
          const row = df[i];
          if (!row) continue;

          const key = makeFullKey(row);
          if (!key) continue;

          if (noteMap.has(key)) {
            matched++;
            const noteStr = noteMap.get(key);

            // on écrase / crée le champ Note
            df[i] = {
              ...row,
              Note: noteStr
            };
            updated++;
          }
        }

        ctx.setDf(df);

        alert(
          `Import terminé.\n` +
          `Matches trouvés: ${matched}\n` +
          `Lignes mises à jour (Note): ${updated}`
        );
      } catch (err) {
        console.error("Erreur importNotesFromAiJson:", err);
        alert("Erreur lors de la lecture ou du parsing du JSON.");
      }
    };

    reader.readAsText(file, "utf-8");
  });

  input.click();
}

