// build_index.mjs
import fs from "fs/promises";
import path from "path";
import process from "process";

// Config
const MODEL = "text-embedding-3-small"; // const MODEL = "text-embedding-3-large"; => index > 100Mo
const EMBEDDING_DIM = 512; // ou 1536 pour rester large
const BATCH_SIZE = 64;

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
function buildEmbeddingText(item) {
  const parts = [];

  if (item.activite) parts.push(item.activite);
  if (item.debut)    parts.push(item.debut);
  if (item.duree)    parts.push(item.duree);
  if (item.fin)      parts.push(item.fin);
  if (item.style)    parts.push(`Style : ce spectacle est de style ou de catégorie ${item.style}`);
  if (item.lieu)     parts.push(`Lieu : ${item.lieu}`);
  if (item.section)  parts.push(`Section : ${item.section.toUpperCase()}`);
  if (item.avis)     parts.push(`Avis : ${item.avis}`);

  // On pourrait ajouter un résumé date/heure très compact :
  if (Array.isArray(item.seances) && item.seances.length) {
    // n’ajoute pas toutes les séances pour éviter d’allonger trop la chaîne
    const first = item.seances[0].slice(0, 10); // "YYYY-MM-DD"
    parts.push(`Joue en juillet, première séance le ${first}`);
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

  // Normalisation des items
  const allRaw = [...offData, ...inData];

  const allItems = allRaw.map((r, idx) => {
    const section = (r.Section || r.section || "").toString().toLowerCase() || null;

    return {
      uuid: r.__uuid || `no-uuid-${idx}`,
      activite: cleanString(r.Activite ?? r.activite),
      debut: cleanString(r.Debut ?? r.debut),
      duree: cleanString(r.Duree ?? r.duree),
      fin: cleanString(r.Fin ?? r.fin),
      style: cleanString(r.Style ?? r.style),
      lieu: cleanString(r.Lieu ?? r.lieu),
      section,
      seances: Array.isArray(r.Seances || r.seances) ? (r.Seances || r.seances) : [],
      hyperlien: cleanString(r.Hyperlien ?? r.hyperlien),
      hyperlienBR: cleanString(r.HyperlienBR ?? r.hyperlienBR),
      avis: cleanString(r.Avis ?? r.avis)
    };
  });

  console.log(`Total items à indexer : ${allItems.length}`);

  // Construction des textes pour embeddings
  const texts = allItems.map(buildEmbeddingText);

  // Calcul embeddings par batch
  const indexed = [];
  for (let i = 0; i < allItems.length; i += BATCH_SIZE) {
    const batchItems = allItems.slice(i, i + BATCH_SIZE);
    const batchTexts = texts.slice(i, i + BATCH_SIZE);

    console.log(`Batch ${i}–${i + batchItems.length - 1}...`);
    const embeddings = await fetchEmbeddingsBatch(batchTexts, apiKey);

    // batchItems.forEach((item, k) => {
    //   indexed.push({
    //     ...item,
    //     embedding: embeddings[k]
    //   });
    // });
    batchItems.forEach((item, k) => {
    let emb = embeddings[k] || [];
    if (Array.isArray(emb) && Number.isFinite(EMBEDDING_DIM)) {
      // on garde seulement les EMBEDDING_DIM premières composantes
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
