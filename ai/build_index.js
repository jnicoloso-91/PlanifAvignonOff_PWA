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
// async function loadJsonArray(filePath) {
//   const txt = await fs.readFile(filePath, "utf8");
//   const data = JSON.parse(txt);
//   if (!Array.isArray(data)) {
//     throw new Error(`Fichier ${filePath} ne contient pas un tableau JSON`);
//   }
//   return data;
// }
async function loadJsonArray(filePath) {
  try {
    const txt = await fs.readFile(filePath, "utf8");
    const data = JSON.parse(txt);

    if (!Array.isArray(data)) {
      throw new Error(`Fichier ${filePath} ne contient pas un tableau JSON`);
    }

    return data;

  } catch (err) {
    if (err.code === "ENOENT") {
      console.warn(`⚠️ Fichier absent: ${filePath} → []`);
      return [];
    }

    // ❗ JSON invalide ou autre erreur = on ne masque pas
    throw err;
  }
}

// Construit le texte pour l'embedding à partir d'une ligne normalisée
function buildEmbeddingText(item) {
  const parts = [];

  // 1) Titre — toujours utile
  if (item.activite) {
    parts.push(`Titre : ${item.activite}`);
  }

  // 2) Style — signal très important
  if (item.style) {
    // phrase explicite
    parts.push(`Style : ${item.style}`);
    // duplication légère pour renforcer le style sans faire de hack par catégorie
    parts.push(`${item.style}`);
  }

  // 3) Description — cœur sémantique
  if (item.desc_summary) {
    parts.push(`Description (résumé) : ${item.desc_summary}`);
  } else if (item.description) {
    parts.push(`Description : ${item.description}`);
  }

  // 4) Distribution (auteur·ice / équipe artistique)
  if (item.distribution) {
    parts.push(`Distribution (auteur·ice / équipe artistique) : ${item.distribution}`);
  }

  // 5) Contexte lieu / section — léger
  if (item.lieu) {
    parts.push(`Lieu : ${item.lieu}`);
  }
  if (item.section) {
    parts.push(`Section : ${item.section.toUpperCase()}`);
  }

  // 6) Avis spectateurs (texto, pas forcément la note brute)
  if (item.avis_summary) {
    parts.push(`Avis (résumé) : ${item.avis_summary}`);
  } else if (item.avis) {
    parts.push(`Avis spectateurs : ${item.avis}`);
  }
  if (item.avis_obj && (item.avis_obj.note != null || item.avis_obj.count != null)) {
    const n = item.avis_obj.note != null ? `${item.avis_obj.note}/10` : "n/a";
    const c = item.avis_obj.count != null ? `${item.avis_obj.count} avis` : "";
    parts.push(`Note : ${n}${c ? ` (${c})` : ""}`);
  }

  // 7) Ancrage temporel minimal (sans heures)
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

// 1) Helpers avis_obj
function parseAvisObject(avisStr) {
  const s = (avisStr || "").toString();
  // ex: "Note 10/10 (74 avis) — Commentaires: ..."
  const m = s.match(/(\d+(?:[.,]\d+)?)\s*\/\s*10.*?\((\d+)\s*avis\)/i);
  if (m) {
    const note = Number(String(m[1]).replace(",", "."));
    const count = Number(m[2]);
    return {
      note: Number.isFinite(note) ? note : null,
      count: Number.isFinite(count) ? count : null
    };
  }
  return { note: null, count: null };
}

function truncateText(s, max = 1200) {
  if (!s) return "";
  const t = String(s);
  return t.length > max ? (t.slice(0, max) + "…") : t;
}

// 2) Appel OpenAI pour résumés (offline)
async function summarizeOneItemPremium(item, apiKey) {
  const avisObj = item.avis_obj || parseAvisObject(item.avis || "");

  const payload = {
    activite: item.activite || "",
    style: item.style || "",
    description: truncateText(item.description || "", 1600),
    distribution: truncateText(item.distribution || "", 900),
    avis_obj: avisObj,
    avis_brut: truncateText(item.avis || "", 1200)
  };

  const system = `
Tu produis des résumés courts et homogènes pour un catalogue du Festival d'Avignon.
Tu n'inventes rien. Tu utilises UNIQUEMENT les champs fournis.
Tu renvoies STRICTEMENT un JSON valide, sans texte autour.
Contraintes:
- desc_summary: Résume la description en 1 ou 2 phrases maximum (100 mots maximum).
  Style neutre, informatif. Ne fais pas de promotion. Ne rajoute aucune information absente du texte.
- avis_summary: À partir des avis spectateurs, fais une synthèse en UNE phrase courte (60 mots maximum). 
  - Mentionne uniquement les points qui reviennent le plus souvent. Style factuel, pas enthousiaste. Ne recite pas la note globale.
  - Si pas d'avis (note/count null et avis_brut vide): avis_summary = "Pas d’avis disponibles."
- mood: En te basant sur la description et les avis, donnes deux ou trois mots-clés décrivant l'ambiance générale du spectacle (ex: "poétique", "engagé", "festif", "intimiste", etc.). Si tu ne peux pas déterminer un mot-clé clair, mets "indéterminé".
`.trim();

  const user = `
Données:
${JSON.stringify(payload, null, 2)}

Réponds au format:
{
  "desc_summary": "...",
  "avis_summary": "..."
  "mood": "..."  
}
`.trim();

  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0.2,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user }
      ],
      response_format: { type: "json_object" }
    })
  });

  if (!resp.ok) {
    const txt = await resp.text().catch(() => "");
    throw new Error(`summarizeOneItemPremium OpenAI ${resp.status}: ${txt}`);
  }

  const data = await resp.json();
  const content = data?.choices?.[0]?.message?.content || "{}";
  let js;
  try { js = JSON.parse(content); } catch { js = {}; }

  const desc_summary = cleanString(js?.desc_summary) || null;
  const avis_summary = cleanString(js?.avis_summary) || null;
  const mood = cleanString(js?.mood) || null;

  console.log(`${item.activite}: ${desc_summary.length} - ${avis_summary.length} - ${mood.length}`);

  return { avisObj, desc_summary, avis_summary, mood };
}

// enrichIndexWithPremiumSummaries(allItems, apiKey, options)
//
// - allItems : array d'items déjà normalisés (avec uuid, activite, style, description, distribution, avis, ...)
// - apiKey   : OPENAI_API_KEY
// - options  : { cachePath, maxItems, force, batch, sleepMs }
//
// Dépendances attendues dans le module : fs (fs/promises), parseAvisObject, summarizeOneItemPremium
export async function enrichIndexWithPremiumSummaries(allItems, apiKey, {
  cachePath = "summaries_cache.json",
  maxItems = Infinity,
  force = false,
  batch = 6,
  sleepMs = 350
} = {}) {
  
  // -----------------------------
  // 0) Load cache
  // -----------------------------
  let cache = {};
  try {
    const txt = await fs.readFile(cachePath, "utf8");
    cache = JSON.parse(txt) || {};
  } catch {
    cache = {};
  }

  // -----------------------------
  // 1) Key builder (stable signature)
  //    If description/avis/etc change => new key => regenerate
  // -----------------------------
  function hash32(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) {
      h = (h * 31 + str.charCodeAt(i)) >>> 0;
    }
    return h;
  }

  function keyForSummary(it) {
    const a    = it.activite     || "";
    const s    = it.style        || "";
    const d    = it.description  || "";
    const dist = it.distribution || "";
    const av   = it.avis         || "";
    const sig  = `${a}||${s}||${d}||${dist}||${av}`;
    const h    = hash32(sig);
    return `${it.uuid}::${h}`;
  }

  // -----------------------------
  // 2) Build todo list (items missing cache or forced)
  // -----------------------------
  const todo = [];
  for (const it of allItems) {
    // always keep avis_obj available (even if summaries are cached)
    it.avis_obj = it.avis_obj || parseAvisObject(it.avis || "");

    const k = keyForSummary(it);
    const hit = cache[k];

    if (!force && hit && (hit.desc_summary || hit.avis_summary || hit.mood)) {
      it.desc_summary = hit.desc_summary || null;
      it.avis_summary = hit.avis_summary || null;
      it.avis_obj     = hit.avis_obj || it.avis_obj;
      it.mood         = hit.mood || null;
      continue;
    }

    todo.push({ it, k });
    if (todo.length >= maxItems) break;
  }

  console.log(
    `Premium summaries: ${todo.length} à générer (cache: ${Object.keys(cache).length})`
  );

  // -----------------------------
  // 3) Runner (limited concurrency)
  // -----------------------------
  let i = 0;
  while (i < todo.length) {
    const chunk = todo.slice(i, i + batch);

    await Promise.all(chunk.map(async ({ it, k }) => {
      const out = await summarizeOneItemPremium(it, apiKey);

      it.avis_obj     = out.avisObj;
      it.desc_summary = out.desc_summary;
      it.avis_summary = out.avis_summary;
      it.mood         = out.mood;

      cache[k] = {
        avis_obj: out.avisObj,
        desc_summary: out.desc_summary,
        avis_summary: out.avis_summary,
        mood: out.mood
      };
    }));

    i += chunk.length;

    // checkpoint write
    await fs.writeFile(cachePath, JSON.stringify(cache, null, 2), "utf8");

    // polite sleep
    if (sleepMs) await new Promise(r => setTimeout(r, sleepMs));

    console.log(`Premium summaries: ${i}/${todo.length} OK (checkpoint écrit)`);
  }

  return allItems;
}

async function main() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error("Erreur: OPENAI_API_KEY non défini dans l'environnement.");
    process.exit(1);
  }

  const offPath = process.argv[2] || "off_2026.json";
  const inPath  = process.argv[3] || "in_2026.json";
  const outPath = process.argv[4] || "index_avignon_2026.json";

  console.log(`Chargement Off depuis ${offPath}...`);
  const offData = await loadJsonArray(offPath);

  console.log(`Chargement In depuis ${inPath}...`);
  const inData = await loadJsonArray(inPath);

  // 1) Concat brut
  const allRaw = [...offData, ...inData];

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
      session:     cleanString(r.Session     ?? r.session),
      relache:     cleanString(r.Relache     ?? r.relache),
      seances:     Array.isArray(r.Seances || r.seances)
                     ? (r.Seances || r.seances)
                     : [],
      section,
      hyperlien:   cleanString(r.Hyperlien   ?? r.hyperlien),
      hyperlienBR: cleanString(r.HyperlienBR ?? r.hyperlienBR),

      // 🔹 nouveaux champs enrichis
      description:  cleanString(r.Description  ?? r.description),
      distribution: cleanString(r.Distribution ?? r.distribution),

      // Avis (potentiellement enrichi via BilletRéduc)
      avis:        cleanString(r.Avis ?? r.avis),
      avis_obj:    parseAvisObject(r.Avis ?? r.avis),
    };
  });

  console.log(`Total items à indexer : ${allItems.length}`);

  await enrichIndexWithPremiumSummaries(allItems, apiKey, {
    cachePath: "summaries_cache.json",
    batch: 6,       // concurrency
    sleepMs: 350,   // “gentil”
    force: false
  });

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
        avis_obj: item.avis_obj ?? parseAvisObject(item.avis || ""),
        desc_summary: item.desc_summary ?? null,
        avis_summary: item.avis_summary ?? null,
        mood: item.mood ?? null,
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
