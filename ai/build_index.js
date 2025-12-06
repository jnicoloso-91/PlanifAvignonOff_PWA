// build_index.mjs
import fs from "fs/promises";
import path from "path";
import process from "process";

import {
  parseAvignonInSpecPageUrl,
  parseAvignonOffSpecPageUrl,
  getAvisBilletReduc,
} from './parsers.js';

// Config
const MODEL = "text-embedding-3-small"; // const MODEL = "text-embedding-3-large"; => index > 100Mo
const EMBEDDING_DIM = 512; // ou 1536 pour rester large
const BATCH_SIZE = 64;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Enrichit allRaw "sur place" : Description / Distribution / Avis
async function enrichAllRawWithDetailsAndAvis(
  allRaw,
  { polite = true } = {}
) {
  for (let i = 0; i < allRaw.length; i++) {
    const r = allRaw[i];

    const orga      = (r.Orga || r.orga || "").toLowerCase();
    const hyperlien = r.Hyperlien || r.hyperlien || null;
    const hyperlienBR = r.HyperlienBR || r.hyperlienBR || null;
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
        } else if (orga === "in") {
          const parsed = await parseAvignonInSpecPageUrl(hyperlien);
          const row    = Array.isArray(parsed) ? parsed[0] : parsed;

          if (row) {
            if (row.Description)  r.Description  = row.Description;
            if (row.Distribution) r.Distribution = row.Distribution;
          }
        }
      }
    } catch (e) {
      console.warn("Enrichissement In/Off détaillé impossible pour", activite, hyperlien, e);
    }

    // --- 2) Avis BilletRéduc (via URL de recherche)
    try {
      if (activite) {
        const { avis } = await getAvisBilletReduc(activite);
        if (avis) {
          // Tu peux soit stocker l’objet complet, soit une version texte compactée
          // Ici je fais un texte compact qui passera bien dans les embeddings existants
          const notePart = avis.Note ? `Note ${avis.Note}` : "";
          const commentsPart =
            avis.Comments && avis.Comments.length
              ? `Commentaires: ${avis.Comments.join(" || ")}`
              : "";

          const avisText = [notePart, commentsPart].filter(Boolean).join(" — ");
          if (avisText) {
            r.Avis = avisText;
          }
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

// Util pour normaliser les champs
function cleanString(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

// Charge un JSON (tableau)
async function loadJsonArray(filePath) {
  const txt = await fs.readFile(filePath, "utf8");
  const data = JSON.parse(txt);
  if (!Array.isArray(data)) {
    throw new Error(`Fichier ${filePath} ne contient pas un tableau JSON`);
  }
  return data;
}

// Construit le texte pour l'embedding à partir d'une ligne normalisée
// function buildEmbeddingText(item) {
//   const parts = [];

//   if (item.activite) parts.push(item.activite);
//   if (item.debut)    parts.push(item.debut);
//   if (item.duree)    parts.push(item.duree);
//   if (item.fin)      parts.push(item.fin);
//   if (item.style)    parts.push(`Style : ce spectacle est de style ou de catégorie ${item.style}`);
//   if (item.lieu)     parts.push(`Lieu : ${item.lieu}`);
//   if (item.section)  parts.push(`Section : ${item.section.toUpperCase()}`);
//   if (item.avis)     parts.push(`Avis : ${item.avis}`);

//   // On pourrait ajouter un résumé date/heure très compact :
//   if (Array.isArray(item.seances) && item.seances.length) {
//     // n’ajoute pas toutes les séances pour éviter d’allonger trop la chaîne
//     const first = item.seances[0].slice(0, 10); // "YYYY-MM-DD"
//     parts.push(`Joue en juillet, première séance le ${first}`);
//   }

//   return parts.join(" | ");
// }
function buildEmbeddingText(item) {
  const parts = [];

  // Titre
  if (item.activite) {
    parts.push(`Titre : ${item.activite}`);
  }

  // Horaire & durée
  if (item.debut) {
    parts.push(`Heure de début : ${item.debut}`);
  }
  if (item.duree) {
    parts.push(`Durée : ${item.duree}`);
  }
  if (item.fin) {
    parts.push(`Heure de fin : ${item.fin}`);
  }

  // Style / section / lieu
  if (item.style) {
    parts.push(`Style : ce spectacle est de style ou de catégorie ${item.style}`);
  }
  if (item.lieu) {
    parts.push(`Lieu : ${item.lieu}`);
  }
  if (item.section) {
    parts.push(`Section : ${item.section.toUpperCase()}`);
  }

  // Description & distribution enrichies (In/Off)
  if (item.description) {
    parts.push(`Description : ${item.description}`);
  }
  if (item.distribution) {
    parts.push(`Distribution (auteur·ice / équipe artistique) : ${item.distribution}`);
  }

  // Avis spectateurs (BilletRéduc ou autres)
  if (item.avis) {
    parts.push(`Avis spectateurs : ${item.avis}`);
  }

  // Info minimale sur les séances (pour l'ancrage temporel)
  if (Array.isArray(item.seances) && item.seances.length) {
    const first = String(item.seances[0]).slice(0, 10); // "YYYY-MM-DD"
    parts.push(`Première séance en juillet le ${first}`);
  }

  return parts.join(" | ");
}

// Appel API embeddings batch
async function fetchEmbeddingsBatch(texts, apiKey) {
  const resp = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: MODEL,
      input: texts
    })
  });

  if (!resp.ok) {
    const txt = await resp.text().catch(() => "");
    throw new Error(`Erreur OpenAI embeddings (${resp.status}): ${txt}`);
  }

  const data = await resp.json();
  if (!data.data || !Array.isArray(data.data)) {
    throw new Error("Réponse embeddings invalide");
  }
  return data.data.map(d => d.embedding);
}

async function main() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error("Erreur: OPENAI_API_KEY non défini dans l'environnement.");
    process.exit(1);
  }

  const offPath = process.argv[2] || "off_2025.json";
  const inPath  = process.argv[3] || "in_2025.json";
  const outPath = process.argv[4] || "index_avignon_2025.json";

  console.log(`Chargement Off depuis ${offPath}...`);
  const offData = await loadJsonArray(offPath);

  console.log(`Chargement In depuis ${inPath}...`);
  const inData = await loadJsonArray(inPath);

  // 1) Concat brut
  const allRaw = [...offData, ...inData];

  // 2) Enrichissement In/Off (description, distribution) + BilletRéduc (avis)
  console.log("Enrichissement In / Off (description, distribution) + BilletRéduc (avis)...");
  await enrichAllRawWithDetailsAndAvis(allRaw, { polite: true });

  // 3) Normalisation des items pour l'index
  const allItems = allRaw.map((r, idx) => {
    const section = (r.Section || r.section || "").toString().toLowerCase() || null;

    return {
      uuid: r.__uuid || `no-uuid-${idx}`,
      activite:    cleanString(r.Activite    ?? r.activite),
      debut:       cleanString(r.Debut       ?? r.debut),
      duree:       cleanString(r.Duree       ?? r.duree),
      fin:         cleanString(r.Fin         ?? r.fin),
      style:       cleanString(r.Style       ?? r.style),
      lieu:        cleanString(r.Lieu        ?? r.lieu),
      section,
      seances:     Array.isArray(r.Seances || r.seances)
                     ? (r.Seances || r.seances)
                     : [],
      hyperlien:   cleanString(r.Hyperlien   ?? r.hyperlien),
      hyperlienBR: cleanString(r.HyperlienBR ?? r.hyperlienBR),

      // 🔹 nouveaux champs enrichis
      description:  cleanString(r.Description  ?? r.description),
      distribution: cleanString(r.Distribution ?? r.distribution),

      // Avis (potentiellement enrichi via BilletRéduc)
      avis:        cleanString(r.Avis        ?? r.avis)
    };
  });

  console.log(`Total items à indexer : ${allItems.length}`);

  // 4) Construction des textes pour embeddings
  const texts = allItems.map(buildEmbeddingText);

  // 5) Calcul embeddings par batch
  const indexed = [];
  for (let i = 0; i < allItems.length; i += BATCH_SIZE) {
    const batchItems = allItems.slice(i, i + BATCH_SIZE);
    const batchTexts = texts.slice(i, i + BATCH_SIZE);

    console.log(`Batch ${i}–${i + batchItems.length - 1}...`);
    const embeddings = await fetchEmbeddingsBatch(batchTexts, apiKey);

    batchItems.forEach((item, k) => {
      let emb = embeddings[k] || [];
      if (Array.isArray(emb) && Number.isFinite(EMBEDDING_DIM)) {
        emb = emb.slice(0, EMBEDDING_DIM);
      }
      indexed.push({
        ...item,
        embedding: emb
      });
    });
  }

  console.log(`Écriture de l'index dans ${outPath}...`);
  await fs.writeFile(outPath, JSON.stringify(indexed, null, 2), "utf8");
  console.log("Terminé ✅");
}

main().catch((e) => {
  console.error("Erreur build_index:", e);
  process.exit(1);
});
