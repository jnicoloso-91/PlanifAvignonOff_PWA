// src/index.js

// ---------------------------------------------------------
// Config CORS & proxy
// ---------------------------------------------------------

const ALLOW_ORIGINS = ["*"];

const TARGET_WHITELIST = [
  "www.festivaloffavignon.com",
  "festivaloffavignon.com",
  "www.festival-avignon.com",
  "festival-avignon.com",
  "www.billetreduc.com",
  "billetreduc.com"
];

function corsHeaders(origin) {
  const allowOrigin = ALLOW_ORIGINS.includes("*")
    ? "*"
    : ALLOW_ORIGINS.includes(origin)
    ? origin
    : "null";

  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization,X-Requested-With",
    "Access-Control-Max-Age": "86400"
  };
}

function isAllowedTarget(targetUrl) {
  try {
    const u = new URL(targetUrl);
    return TARGET_WHITELIST.includes(u.host);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------
// IA : helpers index global + similarité
// ---------------------------------------------------------

// Cache en mémoire globale du worker (tant qu'il reste "chaud")
let EMBEDDINGS_INDEX_CACHE = null;
let EMBEDDINGS_INDEX_LOADING = null;

/**
 * Charge l'index global d'embeddings depuis une URL (JSON)
 * env.EMBEDDINGS_INDEX_URL doit pointer vers un JSON de la forme :
 * [
 *   {
 *     "uuid": "abc-123",
 *     "activite": "...",
 *     "style": "...",
 *     "lieu": "...",
 *     "sessions": "...",
 *     "relaches": null,
 *     "hyperlien": "...",
 *     "hyperlienBR": null,
 *     "embedding": [0.01, -0.02, ...]
 *   },
 *   ...
 * ]
 */
async function loadEmbeddingsIndex(env) {
  if (EMBEDDINGS_INDEX_CACHE) {
    return EMBEDDINGS_INDEX_CACHE;
  }
  if (EMBEDDINGS_INDEX_LOADING) {
    // si un chargement est déjà en cours, on attend la même promesse
    return EMBEDDINGS_INDEX_LOADING;
  }

  const url = env && env.EMBEDDINGS_INDEX_URL;
  if (!url) {
    throw new Error("EMBEDDINGS_INDEX_URL non configurée dans les variables d'environnement");
  }

  EMBEDDINGS_INDEX_LOADING = (async () => {
    const resp = await fetch(url);
    if (!resp.ok) {
      const txt = await resp.text().catch(() => "");
      throw new Error(`Échec de chargement de l'index embeddings (${resp.status}): ${txt}`);
    }
    const data = await resp.json();
    // on ne vérifie pas tout en profondeur, on assume un JSON cohérent
    EMBEDDINGS_INDEX_CACHE = data;
    return data;
  })();

  return EMBEDDINGS_INDEX_LOADING;
}

/**
 * Similarité cosinus entre deux vecteurs (arrays de nombres).
 */
function cosineSimilarity(a, b) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const len = Math.min(a.length, b.length);

  for (let i = 0; i < len; i++) {
    const ai = a[i] || 0;
    const bi = b[i] || 0;
    dot += ai * bi;
    na += ai * ai;
    nb += bi * bi;
  }

  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * Appelle l'API OpenAI pour obtenir l'embedding d'une requête textuelle.
 */
async function embedQuery(text, env) {
  const apiKey = env && env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY non configurée");
  }

  const trimmed = (text || "").trim();
  if (!trimmed) {
    throw new Error("Texte de requête vide (query)");
  }

  const resp = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "text-embedding-3-large", // ou text-embedding-3-small si tu veux alléger
      input: trimmed
    })
  });

  if (!resp.ok) {
    const txt = await resp.text().catch(() => "");
    throw new Error(`Erreur OpenAI embeddings (${resp.status}): ${txt}`);
  }

  const data = await resp.json();
  const emb = data?.data?.[0]?.embedding;
  if (!emb) {
    throw new Error("Réponse embeddings sans vecteur usable");
  }

  return emb;
}

function timeToMinutes(t) {
  if (!t) return null;
  const s = String(t).trim().toLowerCase();

  // accepte "HHhMM", "HH:MM", "HhMM", "H:MM", etc.
  const m = s.match(/^(\d{1,2})[h:](\d{1,2})$/);
  if (!m) return null;

  let h = Number(m[1]);
  let mn = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(mn)) return null;

  return h * 60 + mn;
}

function norm(v) {
  return v == null ? "" : String(v).trim().toLowerCase();
}

function normHour(v) {
  if (v == null) return "";

  const s = String(v).trim().toLowerCase();

  // gère : 09h00, 9h00, 9:00, 09:00
  const m = s.match(/^(\d{1,2})[:h](\d{2})$/);
  if (!m) return s; // fallback brut si format exotique

  const h = String(Number(m[1])); // supprime les zéros
  const min = m[2];

  return `${h}h${min}`; // ✅ format canonique : "9h00", "14h30"
}

function normText(s) {
  return (s || "")
    .toString()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

function normList(arr) {
  return (arr || [])
    .map(x => normText(x))
    .filter(x => x.length > 0);
}

function seancesSignatureFromIndexItem(item) {
  const seances = Array.isArray(item.seances) ? item.seances : [];
  return seances
    .map(s => norm(s))           // "2025-07-10t17:30:00"
    .map(s => s.replace(/\s+/g, ""))         // vire espaces
    .map(s => s.replace(/:00$/, ""))        // optionnel : normalise secondes
    .sort()
    .join(",");
}

function makeFullKey(item) {
  const activite = norm(item.activite);
  const lieu     = norm(item.lieu);
  const debut    = normHour(item.debut);        // "hh:mm"
  //const seancesSig = seancesSignatureFromIndexItem(item);

  // return `${activite}||${lieu}||${debut}||${seancesSig}`;
  return `${activite}||${lieu}||${debut}`;
}

function truncate(str, maxLen) {
  const s = (str || "").toString();
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen - 1) + "…";
}

// Construction d'un contexte pour interrogation IA à partir de keys et scores
function buildRichContextSnippet(items) {
  return items.map((it, idx) => {
    const title = it.lien_markdown || it.activite || "(sans titre)";

    const seances       = it.seances && it.seances.length ? `Dates de représentation : ${it.seances.join(", ")}.` : "";
    const dates         = it.dates && it.dates.length ? `Dates de planification : ${it.dates.join(", ")}.` : "";

    return `
### ${idx + 1}. ${title}

- Style : ${it.style || "?"}
- Mood : ${it.mood || "?"}
- Lieu : ${it.lieu || "?"}
- Festival : ${it.section || "?"}
- Début : ${it.debut || "?"}
- Fin : ${it.fin || "?"}
- Durée : ${it.duree || "?"}
- Description : ${it.description || "?"}
- Distribution : ${it.distribution || "?"}
- Avis spectateurs : ${it.avis || "?"} 
- Période de représentation : ${it.session || "?"} 
- Relâches : ${it.relache || "?"} 
${dates ? "- " + dates : ""}
${seances ? "- " + seances : ""}
${it.desc_summary ? "- Description résumée : " + it.desc_summary : ""}
${it.avis_summary ? "- Avis résumé : " + it.avis_summary : ""}
- Score : ${it.score || "?"}
`;
  }).join("\n");
}

// Retourne la partie Auteurs de la distribution
function getAuteurs(distribution) {
  if (!distribution) return "";

  const s = distribution.trim();

  // doit COMMENCER par "de "
  if (!/^de\s+/i.test(s)) return "";

  // enlève le "de "
  const rest = s.replace(/^de\s+/i, "");

  // coupe sur " avec " si présent
  const idx = rest.search(/\s+avec\s+/i);

  if (idx === -1) {
    return rest.trim();
  }

  return rest.slice(0, idx).trim();
}

function getDistributionSansAuteurs(distribution) {
  function escapeRegExp(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  
  if (!distribution) return "";

  const auteurs = getAuteurs(distribution);
  if (!auteurs) return distribution.trim();

  let s = distribution;

  // enlève "de <auteurs>"
  s = s.replace(
    new RegExp(`\\bde\\s+${escapeRegExp(auteurs)}\\b`, "i"),
    ""
  );

  // nettoyage cosmétique
  s = s
    .replace(/\s{2,}/g, " ")
    .replace(/^\s*avec\s+/i, "avec ")
    .trim();

  return s;
}

// Indique si un item de l'index satisfait un filtre sur la distribution
function matchesDistributionFilter(item, distributionFilter) {
  if (!distributionFilter) {
    return true; // Si aucun filtre de distribution, considérer comme match
  }

  // AUTEURS
  const autValues = []
      .concat(Array.isArray(distributionFilter.auteurs) ? distributionFilter.auteurs : [])
      .map(v => normText(v))
      .filter(Boolean);

  const authorMatch = (autValues.length > 0) && (() => {
      const aut = normText(getAuteurs(item.distribution || ""));
      return aut && autValues.some(tok => aut.includes(tok));
  })();

  if (autValues.length > 0 && !authorMatch) return false;

  // ACTEURS + COMPAGNIES
  const distValues = []
      .concat(Array.isArray(distributionFilter.acteurs) ? distributionFilter.acteurs : [])
      .concat(Array.isArray(distributionFilter.compagnies) ? distributionFilter.compagnies : [])
      .map(v => normText(v))
      .filter(Boolean);

  const distributionMatch =  (distValues.length > 0) && (() => {
      const dist = normText(getDistributionSansAuteurs(item.distribution || ""));
      return dist && distValues.some(tok => dist.includes(tok));
  })();

  if (distValues.length > 0 && !distributionMatch) return false;

  return true;
}

// essaye d’extraire une note et un count d’un champ avis texte
function parseAvisObject(avisStr) {
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

// Tokenisation 
function tokenize(s) {
  return normText(s)
    .split(/[^a-z0-9]+/i)
    .filter(Boolean);
}

// Sélection avec dose de random
function pickWithSelectionMode(scored, limit, selectionMode = "scored") {
  const base = scored.slice(); // on ne modifie pas l’original

  if (!base.length || limit <= 0) return [];

  if (selectionMode === "scored") {
    // 🔹 Top strict, tri déjà fait par score
    return base.slice(0, limit);
  }

  // 🔹 Mode “random / diversifié” :
  //    on ajoute un petit jitter aléatoire au score pour rebrasser l’ordre,
  //    tout en restant fortement biaisé vers les meilleurs.
  const JITTER_AMPLITUDE = 0.10; // 0.10 ~ 10% de bruit

  const jittered = base.map(item => ({
    ...item,
    jitterScore: item.score + (Math.random() - 0.5) * JITTER_AMPLITUDE
  }));

  jittered.sort((a, b) => b.jitterScore - a.jitterScore);

  return jittered.slice(0, limit);
}

// Score d'overlap simple entre deux listes de tokens
function overlapScore(tokensA, tokensB) {
  if (!tokensA.length || !tokensB.length) return 0;
  const setB = new Set(tokensB);
  let inter = 0;
  for (const t of tokensA) {
    if (setB.has(t)) inter++;
  }
  // on normalise par la taille de A pour rester dans [0,1]
  return inter / tokensA.length;
}

// Analyse de la query pour décider quels axes sont importants
function analyzeQueryFacets(query, noteWeight = 0) {
  const q = normText(query);

  // Heuristiques très simples, neutres, sans référence à un style particulier
  const talksAboutStyle = /\b(style|genre|comedie|tragédie|drame|stand up|concert|musical|danse|theatre)\b/.test(q);
  const talksAboutPeople = /\b(auteur|equipe artistique|distribution|metteur en scene|acteur|actrice|compagnie)\b/.test(q);
  const talksAboutMood  = /\b(ambiance|ton|onirique|sombre|humour|poetique)\b/.test(q);
  const talksAboutReviews = /\b(avis|note|bien note|meilleures critiques|critiques)\b/.test(q);

  // Poids de base
  let wEmb  = 1.0;
  let wStyle = 0.0;
  let wDist  = 0.0;
  let wDesc  = 0.0;
  let wAvis  = 0.0;

  if (talksAboutStyle) {
    wStyle = 0.5;   // on renforce un peu le style
  }
  if (talksAboutPeople) {
    wDist = 0.4;    // on renforce la distribution
  }
  if (talksAboutMood) {
    wDesc = 0.3;    // ambiance -> description un peu plus importante
  }
  if (talksAboutReviews || (noteWeight && Number(noteWeight) !== 0)) {
    wAvis = 0.5 * Math.min(1, Math.max(0, Number(noteWeight) || 0)); // on respecte ton slider
  }

  // Normalisation douce : on évite que tout explose, mais on ne force pas à somme=1
  // On garde embeddigs comme base dominante
  const factor = 1 / (1 + wStyle + wDist + wDesc + wAvis * 0.5);
  wEmb   *= factor;
  wStyle *= factor;
  wDist  *= factor;
  wDesc  *= factor;
  // wAvis reste en partie piloté par noteWeight, pas forcément dans la même somme

  return { wEmb, wStyle, wDist, wDesc, wAvis };
}

const DEFAULT_CHAT_NOTE_WEIGHT = 0.5; // tu ajustes si tu veux

function scoreItemForChat(item, qEmb, noteWeight = DEFAULT_CHAT_NOTE_WEIGHT) {
  // 1) score sémantique
  let semScore = 0;
  if (qEmb) {
    semScore = cosineSimilarity(qEmb, item.embedding || []);
  }

  // 2) bonus de note (BilletReduc)
  const avisObj = parseAvisObject(item.avis || "");
  const avisBonus = avisObj.note != null ? noteWeight * avisObj.note : 0;

  const totalScore = semScore + avisBonus;

  return { totalScore, avisObj };
}

function computeStyleMatchScore(item, queryTokens) {
  if (!item.style) return 0;
  const styleTokens = tokenize(item.style);
  return overlapScore(styleTokens, queryTokens); // entre 0 et 1
}

function computeDistributionMatchScore(item, queryTokens) {
  if (!item.distribution) return 0;
  const distTokens = tokenize(item.distribution);
  return overlapScore(distTokens, queryTokens); // 0..1
}

function computeDescriptionMatchScore(item, queryTokens) {
  if (!item.description) return 0;
  // Pour éviter que la description très longue écrase tout, on peut
  // réduire à un résumé ou prendre seulement les 40 premiers mots.
  const descShort = tokenize(item.description).slice(0, 40);
  return overlapScore(descShort, queryTokens); // 0..1
}

// Note spectateur normalisée ~ [0,1] si tu as avis_note ou note globale
function computeAvisScore(item) {
  // Ex: si tu as item.avis_note = 9.2 sur 10
  if (typeof item.avis_note === "number") {
    return Math.max(0, Math.min(1, item.avis_note / 10));
  }
  // Sinon, dernier recours : petite heuristique sur la chaîne "Note 9/10 (35 avis)"
  if (item.avis && typeof item.avis === "string") {
    const m = item.avis.match(/(\d+(?:[.,]\d+)?)\s*\/\s*10/);
    if (m) {
      const n = Number(m[1].replace(",", "."));
      if (!Number.isNaN(n) && n >= 0 && n <= 10) {
        return n / 10;
      }
    }
  }
  return 0;
}

/**
 * Route /ai/semantic-wf
 * Recherche sémantique dans l'index global, applique un filtre et renvoie les items triés par score.
 * Body JSON :
 *   {
 *     query: "texte de l'utilisateur",
 *     topK: 30,                  // optionnel
 *     filters: { ... },          // optionnel, QueryIntent.filters
 *     scope: { ... }             // optionnel, QueryIntent.scope
 *   }
 *
 * Réponse JSON :
 * tableau trié par score des items de l'index filtré, plus pour chaque item son score et un objet avis
 */
async function handleSemanticSearchWithFilters(req, env, headersCORS) {
  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      {
        status: 405,
        headers: { ...headersCORS, "Content-Type": "application/json" }
      }
    );
  }

  let payload;
  try {
    payload = await req.json();
  } catch {
    return new Response(
      JSON.stringify({ error: "Body JSON invalide" }),
      {
        status: 400,
        headers: { ...headersCORS, "Content-Type": "application/json" }
      }
    );
  }

  const query   = payload?.query;
  const alreadySeen  = Array.isArray(payload?.already_seen) ? payload.already_seen : [];
  const topK    = Number.isFinite(payload?.topK) ? payload.topK : 30;
  const filters = payload?.filters || null;
  const scope   = payload?.scope   || null;
  const selectionMode = payload?.selection_mode || "scored"; // "scored" ou "random

  if (!query || typeof query !== "string") {
    return new Response(
      JSON.stringify({ error: "Champ 'query' (string) requis dans le body" }),
      {
        status: 400,
        headers: { ...headersCORS, "Content-Type": "application/json" }
      }
    );
  }

  try {
    // 1) Charger index + embedding de la requête en parallèle
    const [index, qEmb] = await Promise.all([
      loadEmbeddingsIndex(env),
      embedQuery(query, env)
    ]);

    let filteredIndex = index;
    filteredIndex = filteredIndex.filter(item => {
      const k = makeFullKey(item);
      return (!alreadySeen.includes(k));
    });

    // -----------------------------------------------------
    // Filtrage par section / festival (In / Off)
    // -----------------------------------------------------
    let wantedSections = null;

    if (filters && Array.isArray(filters.sections) && filters.sections.length > 0) {
      wantedSections = new Set(
        filters.sections
          .map(s => s && s.value ? normText(s.value) : "")
          .filter(Boolean)
      );
    } else if (scope && Array.isArray(scope.festival) && scope.festival.length > 0) {
      wantedSections = new Set(
        scope.festival.map(s => normText(s))
        .filter(Boolean)
        );
    }

    if (wantedSections && wantedSections.size > 0) {
      filteredIndex = filteredIndex.filter(item => {
        const section = normText(item.section || "");
        if (!section) return false;
        return wantedSections.has(section);
      });
    }

    // -----------------------------------------------------
    // Filtrage par activité (shows)
    // filtres.shows[].value ~ colonne Activite du catalogue
    // -----------------------------------------------------
    if (filters && Array.isArray(filters.shows) && filters.shows.length > 0) {
      const actValues = filters.shows
        .map(c => (c && c.value ? normText(c.value) : ""))
        .filter(Boolean);

      if (actValues.length > 0) {
        filteredIndex = filteredIndex.filter(item => {
          const activite = normText(item.activite || "");
          if (!activite) return false;
          // match souple : contient une des catégories demandées
          return actValues.some(act => activite.includes(act));
        });
      }
    }

    // -----------------------------------------------------
    // Filtrage par style (categories)
    // filtres.categories[].value ~ colonne Style du catalogue
    // -----------------------------------------------------
    if (filters && Array.isArray(filters.categories) && filters.categories.length > 0) {
      const catValues = filters.categories
        .map(c => (c && c.value ? normText(c.value) : ""))
        .filter(Boolean);

      if (catValues.length > 0) {
        filteredIndex = filteredIndex.filter(item => {
          const style = normText(item.style || "");
          if (!style) return false;
          // match souple : contient une des catégories demandées
          return catValues.some(cat => style.includes(cat));
        });
      }
    }

    // -----------------------------------------------------
    // Filtrage par mood (ton, humeur)
    // -----------------------------------------------------
    if (filters && Array.isArray(filters.mood) && filters.mood.length > 0) {
      const moodValues = filters.mood
        .map(c => (c && c.value ? normText(c.value) : ""))
        .filter(Boolean);

      if (moodValues.length > 0) {
        filteredIndex = filteredIndex.filter(item => {
          const mood = normText(item.mood || "");
          if (!mood) return false;
          // match souple : contient une des mood demandées
          return moodValues.some(cat => mood.includes(cat));
        });
      }
    }

    // -----------------------------------------------------
    // Filtrage par keywords sur description et avis  
    // -----------------------------------------------------
    if (filters && Array.isArray(filters.keywords) && filters.keywords.length > 0) {
      const kwdValues = filters.keywords
        .map(c => (c && c.value ? normText(c.value) : ""))
        .filter(Boolean);

      if (kwdValues.length > 0) {
        filteredIndex = filteredIndex.filter(item => {
          const desc = normText(item.description || "");
          const avis = normText(item.avis || "");
          const descS = normText(item.desc_summary || "");
          const avisS = normText(item.avis_summary || "");
          const dist = normText(item.distribution || "");
          const act = normText(item.activite || "");
          if (!desc && !avis) return false;
          // match souple : kwd demandé dans description ou avis
          return kwdValues.some(kwd => desc.includes(kwd) || avis.includes(kwd) || descS.includes(kwd) || avisS.includes(kwd) || dist.includes(kwd) || act.includes(kwd));
        });
      }
    }

    // -----------------------------------------------------
    // Filtrage par lieux (venues)
    // -----------------------------------------------------
    if (filters && Array.isArray(filters.venues) && filters.venues.length > 0) {
      const venueNames = filters.venues
        .map(v => (v && v.name ? normText(v.name) : ""))
        .filter(Boolean);

      if (venueNames.length > 0) {
        filteredIndex = filteredIndex.filter(item => {
          const lieu = normText(item.lieu || "");
          if (!lieu) return false;
          return venueNames.some(name => lieu.includes(name));
        });
      }
    }

    // -----------------------------------------------------
    // Filtrage par dates / heures (seances[])
    // - filters.dates.from / to : "YYYY-MM-DD"
    // - filters.time_window.start / end : "HHhMM"
    // -----------------------------------------------------
    const hasDateFilter   = filters && filters.dates && (filters.dates.from || filters.dates.to);
    const hasTimeFilter   = filters && filters.time_window && (filters.time_window.start || filters.time_window.end);

    if (hasDateFilter || hasTimeFilter) {
      const fromDate = filters?.dates?.from || null; // "YYYY-MM-DD"
      const toDate   = filters?.dates?.to   || null;
    
      const fromTimeStr = filters?.time_window?.start || null; // "HHhMM" ou "HH:MM"
      const toTimeStr   = filters?.time_window?.end   || null;
    
      const fromTimeMin = timeToMinutes(fromTimeStr);
      const toTimeMin   = timeToMinutes(toTimeStr);
    
      filteredIndex = filteredIndex.filter(item => {
        // Heure
        if (hasTimeFilter) {
          if (!item.debut) return false;
          const itemTimeMin = timeToMinutes(item.debut);
          if (itemTimeMin == null) return false;
    
          if (fromTimeMin != null && itemTimeMin < fromTimeMin) return false;
          if (toTimeMin   != null && itemTimeMin > toTimeMin)   return false;
        }
    
        // Date via seances (qui sont maintenant sans heure : "YYYY-MM-DD")
        const seances = Array.isArray(item.seances) ? item.seances : [];
        if (!seances.length) return false;
    
        return seances.some(se => {
          const dateStr = se.slice(0, 10);   // "YYYY-MM-DD"
    
          if (fromDate && dateStr < fromDate) return false;
          if (toDate   && dateStr > toDate)   return false;
    
          return true;
        });
      });
    }
    
    // ❗ Ici, on NE fait PAS de fallback sur tout l'index :
    // si les filtres sont trop restrictifs -> 0 résultats, c'est plus honnête.

    // -----------------------------------------------------
    // Calcul des scores cosinus
    // -----------------------------------------------------
    const scored = filteredIndex.map((item) => {
      const { totalScore, avisObj } = scoreItemForChat(item, qEmb);
      return {
        uuid: item.uuid,
        activite: item.activite ?? null,
        debut: item.debut ?? null,
        duree: item.duree ?? null,
        fin: item.fin ?? null,
        style: item.style ?? null,
        lieu: item.lieu ?? null,
        session: item.session ?? null,
        relache: item.relache ?? null,
        section: item.section ?? null,
        desc_summary: item.desc_summary ?? null,
        avis_summary: item.avis_summary ?? null,
        mood: item.mood ?? null,
        hyperlien: item.hyperlien ?? null,
        hyperlienBR: item.hyperlienBR ?? null,
        avis: avisObj,
        _index_key: makeFullKey(item),
        score: totalScore,
        distribution: item.distribution
      };
    });

    // Tri décroissant
    scored.sort((a, b) => b.score - a.score);

    // Mise en tête de scored des items qui passent le filtrage sur la distribution
    //let matchesDistribution = scored.filter(item => matchesDistributionFilter(item, filters?.distribution));
    //let nonMatchesDistribution = scored.filter(item => !matchesDistributionFilter(item, filters?.distribution));
    //let scoredWithDistributionFilterMatchAtHead = matchesDistribution.concat(nonMatchesDistribution);
    //const totalMatches = scoredWithDistributionFilterMatchAtHead.length;

    // Suppression du champ distribution pour le retour
    //scoredWithDistributionFilterMatchAtHead = scoredWithDistributionFilterMatchAtHead.map(item => {
    //  const { distribution, ...rest } = item;
    //  return rest;
    //});

    // 🧩 sélection finale en fonction du mode
    ////const picked = pickWithSelectionMode(scoredWithDistributionFilterMatchAtHead, topK, selectionMode);
    //const picked = scoredWithDistributionFilterMatchAtHead.slice(0, topK);

    // On ne retient que ceux qui matchent la distribution puis on enlève le champ distribution pour le retour
    let matchesDistribution = scored.filter(item => matchesDistributionFilter(item, filters?.distribution));
    let finalList = matchesDistribution.map(item => {
      const { distribution, ...rest } = item;
      return rest;
    });

    // On ne retient que les topK premiers
    const picked = finalList.slice(0, topK);

    // ✅ indicateurs pour le front
    const totalMatches = finalList.length;
    const returned     = picked.length;
    const isTruncated  = returned < totalMatches;

    return new Response(
      JSON.stringify({
        results: picked,
        total_matches: totalMatches,
        is_truncated: isTruncated,
        sl: scored.length
      }),
      { status: 200, headers: { ...headersCORS, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("AI semantic error:", e);
    return new Response(
      JSON.stringify({ error: "Erreur interne backend IA (semantic)" }),
      {
        status: 500,
        headers: { ...headersCORS, "Content-Type": "application/json" }
      }
    );
  }
}

/**
 * Route /ai/semantic-wk
 * Recherche sémantique dans l'index, filtre les items par clef et les renvoie triés par score.
 * Body JSON :
 *  { 
 *    query: string, 
 *    keys: string[], 
 *    workerTopK,
 *    selectionMode,
 *    distributionFilter
 *  }
 *
 * Réponse JSON :
 * { results: [ { key, score }, ... ] }
 */
async function handleSemanticSearchWithK(req, env, headersCORS) {
  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      {
        status: 405,
        headers: { ...headersCORS, "Content-Type": "application/json" }
      }
    );
  }

  let payload;
  try {
    payload = await req.json();
  } catch {
    return new Response(
      JSON.stringify({ error: "Body JSON invalide" }),
      {
        status: 400,
        headers: { ...headersCORS, "Content-Type": "application/json" }
      }
    );
  }

  const query = payload?.query;
  const keys  = Array.isArray(payload?.keys) ? payload.keys : [];
  const topK  = Number.isFinite(payload?.topK) ? payload.topK : 30;
  const selectionMode = payload?.selection_mode || "scored"; // "scored" ou "random
  const distributionFilter = payload?.distribution_filter;   // tel que dans QueryIntent
  const moodFilter = payload?.mood_filter;   // tel que dans QueryIntent
  const kwdFilter = payload?.kwd_filter;   // tel que dans QueryIntent

  if (!query || typeof query !== "string") {
    return new Response(
      JSON.stringify({ error: "Champ 'query' (string) requis dans le body" }),
      {
        status: 400,
        headers: { ...headersCORS, "Content-Type": "application/json" }
      }
    );
  }

  if (!keys.length) {
    return new Response(
      JSON.stringify({ results: [] }),
      {
        status: 200,
        headers: { ...headersCORS, "Content-Type": "application/json" }
      }
    );
  }

  try {
    const [index, qEmb] = await Promise.all([
      loadEmbeddingsIndex(env),
      embedQuery(query, env)
    ]);

    const keySet = new Set(
      keys
        .map(k => (k ? String(k) : ""))
        .filter(Boolean)
    );

    // Sous-ensemble de l’index limité aux keys demandées
    let subset = index.filter(item => {
      const k = makeFullKey(item);
      return keySet.has(k);
    });

    // Filtrage sur mood
    if (moodFilter) {
      const moodValues = moodFilter
        .map(c => (c && c.value ? normText(c.value) : ""))
        .filter(Boolean);

      if (moodValues.length > 0) {
        subset = subset.filter(item => {
          const mood = normText(item.mood || "");
          if (!mood) return false;
          return moodValues.some(tok => mood.includes(tok));
        });
      }
    }

    // Filtrage sur description et avis  
    if (kwdFilter) {
      const kwdValues = kwdFilter
        .map(c => (c && c.value ? normText(c.value) : ""))
        .filter(Boolean);

      if (kwdValues.length > 0) {
        subset = subset.filter(item => {
          const desc = normText(item.description || "");
          const avis = normText(item.avis || "");
          const descS = normText(item.desc_summary || "");
          const avisS = normText(item.avis_summary || "");
          const dist = normText(item.distribution || "");
          const act = normText(item.activite || "");
          if (!desc && !avis) return false;
          // match souple : kwd demandé dans description ou avis
          return kwdValues.some(kwd => desc.includes(kwd) || avis.includes(kwd) || descS.includes(kwd) || avisS.includes(kwd) || dist.includes(kwd) || act.includes(kwd));
        });
      }
    }

    const total_matches = subset.length;
    const is_truncated  = total_matches > topK;

    // --- Scoring ---
    const scored = subset.map(item => {
      const k = makeFullKey(item);
      const { totalScore, avisObj } = scoreItemForChat(item, qEmb);
      return {
        key: k,
        desc_summary: item.desc_summary ?? null,
        avis_summary: item.avis_summary ?? null,
        mood: item.mood ?? null,
        avis: avisObj,
        score: totalScore,
        distribution: item.distribution
      };
    });

    scored.sort((a, b) => b.score - a.score);

    // Mise en tête de scored des items qui passent le filtrage sur la distribution
    //let matchesDistribution = scored.filter(item => matchesDistributionFilter(item, distributionFilter));
    //let nonMatchesDistribution = scored.filter(item => !matchesDistributionFilter(item, distributionFilter));
    //let scoredWithDistributionFilterMatchAtHead = matchesDistribution.concat(nonMatchesDistribution);

    // Suppression du champ distribution pour le retour
    //scoredWithDistributionFilterMatchAtHead = scoredWithDistributionFilterMatchAtHead.map(item => {
    //  const { distribution, ...rest } = item;
    //  return rest;
    //});

    // 🧩 sélection finale en fonction du mode
    //const picked = pickWithSelectionMode(scoredWithDistributionFilterMatchAtHead, topK, selectionMode);
    //const picked = scoredWithDistributionFilterMatchAtHead.slice(0, topK);

    // On ne retient que ceux qui matchent la distribution puis on enlève le champ distribution pour le retour
    let matchesDistribution = scored.filter(item => matchesDistributionFilter(item, distributionFilter));
    let finalList = matchesDistribution.map(item => {
      const { distribution, ...rest } = item;
      return rest;
    });

    // On ne retient que les topK premiers
    const picked = finalList.slice(0, topK);

    // --- Réponse enrichie (symétrique à semantic-with-filters) ---
    return new Response(
      JSON.stringify({
        results: picked,
        total_matches,
        is_truncated
      }),
      { status: 200, headers: { ...headersCORS, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("AI semantic-bykey error:", e);
    return new Response(
      JSON.stringify({ error: "Erreur interne backend IA (semantic-bykey)" }),
      {
        status: 500,
        headers: { ...headersCORS, "Content-Type": "application/json" }
      }
    );
  }
}

/**
 * Route /ai/semantic-wkk
 * Recherche sémantique dans l'index, filtre les items par clef, keywords et les renvoie triés par score.
 * Body JSON :
 *  { 
 *    query: string,
 *    candidate_keys: string[], 
 *    distribution_keywords: string[], 
 *    note_weight: number,
 *    topK: number
 *  }
 *
 * Réponse JSON :
 * { results: [ { key, score }, ... ] }
 */
async function handleSemanticSearchWithKK(req, env, headersCORS) {
  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      {
        status: 405,
        headers: { ...headersCORS, "Content-Type": "application/json" }
      }
    );
  }

  let payload;
  try {
    payload = await req.json();
  } catch {
    return new Response(
      JSON.stringify({ error: "Body JSON invalide" }),
      {
        status: 400,
        headers: { ...headersCORS, "Content-Type": "application/json" }
      }
    );
  }

  const query         = (payload && payload.query) || "";
  const candidateKeys = Array.isArray(payload?.candidate_keys) ? payload.candidate_keys : [];

  // ⚙️ Viennent des contraintes côté front
  const distriKeywords  = normList(payload?.distribution_keywords);   // tableau normalisé
  const moodKeywords    = normList(payload?.mood_keywords);           // tableau normalisé
  const genKeywords     = normList(payload?.generic_keywords);        // tableau normalisé
  const noteWeight      = Number(payload?.note_weight ?? 0) || 0;     // slider 0→1

  const topK = Number.isFinite(payload?.topK) ? payload.topK : (candidateKeys.length || 500);

  const apiKey = env && env.OPENAI_API_KEY;
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: "OPENAI_API_KEY not configured" }),
      {
        status: 500,
        headers: { ...headersCORS, "Content-Type": "application/json" }
      }
    );
  }

  try {
    // 1) Charger index + embedding de la requête (si non vide)
    const [index, qEmb] = await Promise.all([
      loadEmbeddingsIndex(env),
      query && query.trim() ? embedQuery(query, env) : Promise.resolve(null)
    ]);

    // 2) Sous-ensemble limité aux candidats programmateur (si fourni)
    let filtered = index;
    if (candidateKeys.length) {
      const keySet = new Set(candidateKeys);
      filtered = filtered.filter(item => keySet.has(makeFullKey(item)));
    }

    // 3) FILTRE DUR sur description et avis (contraintes explicites)
    if (genKeywords.length) {
      const kwN = genKeywords.map(kw => normText(kw)).filter(Boolean);
      filtered = filtered.filter(item => {
        const descN = normText(item.description || "");
        const avisN = normText(item.avis || "");
        const descSN = normText(item.desc_summary || "");
        const avisSN = normText(item.avis_summary || "");
        const distN = normText(item.distribution || "");
        const actN = normText(item.activite || "");
      return kwN.some(kw => descN.includes(kw) || avisN.includes(kw) || descSN.includes(kw) || avisSN.includes(kw) || distN.includes(kw) || actN.includes(kw));
      });
    }

    // 4) FILTRE DUR sur distribution_keywords (contraintes explicites)
    if (distriKeywords.length) {
      const kwN = distriKeywords.map(kw => normText(kw)).filter(Boolean);
      filtered = filtered.filter(item => {
        const distrN = normText(item.distribution || "");
        return kwN.some(kw => distrN.includes(kw));
      });
    }

    // 5) FILTRE DUR sur mood_keywords (contraintes explicites)
    if (moodKeywords.length) {
      const kwN = moodKeywords.map(kw => normText(kw)).filter(Boolean);
      filtered = filtered.filter(item => {
        const moodN = normText(item.mood || "");
        return kwN.some(kw => moodN.includes(kw));
      });
    }

    // 6) Préparation des facettes pour le scoring
    const queryTokens = tokenize(query || "");
    const { wEmb, wStyle, wDist, wDesc, wAvis } = analyzeQueryFacets(query || "", noteWeight);

    // 7) Scoring : embeddings + style + distribution + description + avis
    const scored = filtered.map(item => {
      let embScore = 0;
      if (qEmb) {
        embScore = cosineSimilarity(qEmb, item.embedding || []);
      }

      const styleScore = computeStyleMatchScore(item, queryTokens);        // 0..1
      const distScore  = computeDistributionMatchScore(item, queryTokens); // 0..1
      const descScore  = computeDescriptionMatchScore(item, queryTokens);  // 0..1

      // Avis : on réutilise la fonction de parsing qui rend un objet structuré
      const avisObj = parseAvisObject(item.avis || "");
      let avisScore = 0;
      if (avisObj && avisObj.note != null) {
        // normalisation 0..1 sur une note sur 10
        const n = Number(avisObj.note);
        if (Number.isFinite(n)) {
          avisScore = Math.max(0, Math.min(1, n / 10));
        }
      }

      const totalScore =
        wEmb   * embScore +
        wStyle * styleScore +
        wDist  * distScore +
        wDesc  * descScore +
        wAvis  * avisScore;

      return {
        uuid: item.uuid,
        activite: item.activite ?? null,
        style: item.style ?? null,
        lieu: item.lieu ?? null,
        section: item.section ?? null,
        seances: item.seances ?? [],
        debut: item.debut ?? null,
        desc_summary: item.desc_summary ?? null,
        avis_summary: item.avis_summary ?? null,
        mood: item.mood ?? null,        

        // ✅ objet structuré (ex: { note: 9.2, count: 35 })
        avis: avisObj,

        _index_key: makeFullKey(item),
        score: totalScore,

        // (optionnel, utile pour debug)
        // _embScore: embScore,
        // _styleScore: styleScore,
        // _distScore: distScore,
        // _descScore: descScore,
        // _avisScore: avisScore
      };
    });

    // 8) Tri + topK
    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, topK);

    return new Response(
      JSON.stringify({ results: top }),
      {
        status: 200,
        headers: { ...headersCORS, "Content-Type": "application/json" }
      }
    );
  } catch (e) {
    console.error("AI semantic+keywords error:", e);
    return new Response(
      JSON.stringify({ error: "Erreur interne backend IA (semantic+keywords)" }),
      {
        status: 500,
        headers: { ...headersCORS, "Content-Type": "application/json" }
      }
    );
  }
}

/**
 * Route /ai/semantic-explain
 * Récupère une liste d'items contenant key+score et une query, en fait un contexte+query et appelle l'IA.
 */
async function handleSemanticExplain(req, env, headersCORS) {
  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: { ...headersCORS, "Content-Type": "application/json" } }
    );
  }

  let payload;
  try {
    payload = await req.json();
  } catch {
    return new Response(
      JSON.stringify({ error: "Body JSON invalide" }),
      {
        status: 400,
        headers: { ...headersCORS, "Content-Type": "application/json" }
      }
    );
  }

  const query = (payload?.query || "").trim();
  const items = Array.isArray(payload?.items) ? payload.items : [];
  const selectionOrigin = (payload?.origin || "").trim();
  const totalMatches = payload?.total_matches || null;
  const semanticEmbeddingQuery = (payload?.semantic?.embedding_query || "").trim();
  const freeSpeechContext = payload.free_speech_context || "";
  
  if (!query) {
    return new Response(
      JSON.stringify({ error: "Champ 'query' requis" }),
      { status: 400, headers: { ...headersCORS, "Content-Type": "application/json" } }
    );
  }

  if (!items.length) {
    return new Response(
      JSON.stringify({ error: "Champ 'items' (liste de {key,score}) requis" }),
      { status: 400, headers: { ...headersCORS, "Content-Type": "application/json" } }
    );
  }

  const apiKey = env && env.OPENAI_API_KEY;
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: "OPENAI_API_KEY not configured" }),
      { status: 500, headers: { ...headersCORS, "Content-Type": "application/json" } }
    );
  }

  try {
    const index = await loadEmbeddingsIndex(env); // déjà existant

    const extraMap = new Map(); // key -> { score:number, dates:string[] }
    const keySet   = new Set();
    
    for (const it of items) {
      const k = String(it.key || "").trim();
      if (!k) continue;
    
      const score = Number(it.score) || 0;
      const date  = (typeof it.date === "string" && it.date.trim()) ? it.date.trim() : null;
    
      keySet.add(k);
    
      if (!extraMap.has(k)) {
        extraMap.set(k, { score, dates: date ? [date] : [] });
        continue;
      }
    
      const cur = extraMap.get(k);
    
      // meilleur score
      if (score > (cur.score ?? -Infinity)) cur.score = score;
    
      // dates (dédup)
      if (date && !cur.dates.includes(date)) cur.dates.push(date);
    }
    
    if (!keySet.size) {
      return new Response(
        JSON.stringify({ error: "Aucune clé exploitable dans 'items'" }),
        { status: 400, headers: { ...headersCORS, "Content-Type": "application/json" } }
      );
    }

    // On retrouve les items complets dans l’index
    const matched = [];
    for (const item of index) {
      const k = makeFullKey(item);
      if (!k || !keySet.has(k)) continue;
    
      matched.push({
        uuid: item.uuid,
        activite: item.activite ?? null,
        lien_markdown: item.hyperlien && item.activite
          ? `[${item.activite}](${item.hyperlien})`
          : (item.activite ?? null),
    
        style: item.style ?? null,
        mood: item.mood ?? null,
        lieu: item.lieu ?? null,
        section: item.section ?? null,
        debut: item.debut ?? null,
        fin: item.fin ?? null,
        duree: item.duree ?? null,
        seances: item.seances ?? [],
        description: item.description ?? null,
        distribution: item.distribution ?? null,
        desc_summary: item.desc_summary ?? null,
        avis_summary: item.avis_summary ?? null,   // ✅ fix
        avis: item.avis ?? null,
    
        _index_key: k,
        score: extraMap.get(k)?.score ?? 0,
        dates: extraMap.get(k)?.dates ?? []
      });
    }
    
    if (!matched.length) {
      return new Response(
        JSON.stringify({
          answer: "Je n'ai pas trouvé de spectacles correspondants dans l'index pour ces résultats.",
          results: [],
          context_used: ""
        }),
        { status: 200, headers: { ...headersCORS, "Content-Type": "application/json" } }
      );
    }

    matched.sort((a, b) => (b.score || 0) - (a.score || 0));

    const MAX_CONTEXT_ITEMS = 20;
    const contextItems   = matched.slice(0, MAX_CONTEXT_ITEMS);
    const contextSnippet = buildRichContextSnippet(contextItems);

    const systemPrompt = `
- Tu participes à un assistant de programmation de spectacles pour le Festival d'Avignon (In & Off).
- Tu es le dernier étage d'un pipeline RAG comprenant un premier étage "Understand" qui produit un objet JSON contenant une interprétation textuelle canonique de la demande utilisateur ("Semantic query").
- Tu reçois en entrée :
  - "Demande de l'utilisateur": la demande brute de l'utilisateur
  - "Semantic query": l'interprétation de la demande utilisateur fournie par l'étage Understand du RAG
  - "Sélection de spectacles": une sélection de spectacles qui matchent les critères de la demande utilisateur 
  - "Origine de la sélection": origine de la sélection 
    - "full_festival": catalogues des festivals In & Off
    - "local_stock": stock local de l'utilisateur 
    - "current_schedule": planning / programme de l'utilisateur
  - "total_matches": nombre total de spectacles qui matchent les critères de la demande utilisateur 
  - "Free speech context": le contexte conversationnel
- Tu produis la réponse à la demande utilisateur en t'appuyant sur ces éléments.
- La sélection de spectacles que tu reçois en entrée correspond aux SEULS résultats à présenter à l'utilisateur.
- Cette sélection n'est pas nécessairement complète, elle peut comprendre moins de spectacles que "total_matches" qui donne le nombre total de spectacles qui matchent les critères de l'utilisateur.
  - Tiens-en compte dans ta réponse: si la sélection comprend moins de spectacles que "total_matches" utilise des formules comme "voici quelques..." "Voici une sélection...",
  - Sinon utilise des formules comme "Voici l'ensemble des spectacles qui ..." ou "Voici les spectacles qui..."
- Utilise prioritairement "Semantic query" plutot que la demande brute pour formuler ta réponse (fallback sur la demande brute si absent)
- N'INVENTE PAS. Si tu ne sais pas dis-le et demande des précisions.
- TU N'AS PAS LE DROIT DE CITER D'AUTRES SPECTACLES QUE CEUX FOURNIS DANS LA SELECTION.
- Si la sélection de spectacles est vide c'est qu'il n'y a plus de nouveaux résultats à présenter à l'utilisateur compte tenu de l'historique des résultas déja présentés.
  Dans ce cas réponds qu'il n'y a plus de nouveaux résultats à lui présenter.
- Si on te demande un AUTEUR ou un ACTEUR, cherche dans le champ Distribution de la sélection de spectacles, PAS DANS LE CONTEXTE CONVERSATIONNEL.
- Si on te demande le nombre de spectacles correspondant à la recherche, donne la valeur de "total_matches".
- Contextualise ta réponse en fonction du contexte conversationnel. Si on te demande de résumer la sélection après une recherche répond : "Voici un résumé de la sélection"
    
━━━━━━━━━━━━━━━━━━━━
1) FORMAT DE LA SELECTION 
━━━━━━━━━━━━━━━━━━━━

La sélection de spectacles fournie en entrée contient pour chaque spectacle, sont TITRE et tout ou partie des champs suivants :
- Style: style du spectacle
- Mood: ton, humeur, ambiance générale
- Lieu: lieu / théâtre où se tient le spectacle
- Festival: nom du festival organisateur 
- Début: heure de début (HHhMM)
- Fin: heure de fin (HHhMM)
- Durée: durée (HHhMM)
- Période de représentation: période pendant laquelle est jouée le spectacle
- Relâches: jours / période de relâche
- Dates de représentation: dates des séances de représentation (dates au format YYYY-MM-DD séparées par des virgules)
- Dates de planification: dates auxquelles est programmé le spectacle dans le planning utilisateur (dates au format YYYY-MM-DD séparées par des virgules)
- Description: description du spectacle
- Distribution: distribution ("De [auteurs] | Avec : [acteurs, équipe technique, compagnie, ...])
- Avis spectateurs: exemple : "Note x/10 (yy avis) - Commentaires spectateurs"
- Description résumée: résumé de la description
- Avis résumé: résumé des commentaires spectateurs 
- lien_markdown: titre + URL formatés
- Score: score du spectacle par embeddings avec query

A) IMPORTANT — DISTINCTION CRITIQUE DES DATES
Il existe DEUX types de dates distinctes et NON INTERCHANGEABLES :

1) Dates de représentation (champ: Dates de représentation)
   - Correspondent aux jours où le spectacle est joué dans le catalogue.
   - Elles décrivent le calendrier général du spectacle.
   - Elles NE DOIVENT JAMAIS être utilisées pour analyser des conflits de planning.

2) Dates de planification (champ: Dates de planification)
   - Correspondent aux dates EFFECTIVEMENT programmées dans le planning de l'utilisateur.
   - Elles peuvent être absentes, partielles ou différentes des dates de représentation.

RÈGLE ABSOLUE :
- Tu NE DOIS JAMAIS déduire des dates de planification à partir des dates de représentation.

B) FORMAT DATES
- Dans la sélection les dates sont au format YYYY-MM-DD.
- Dans la demande tu peux avoir des formats différents (DD/MM/YYYYY, DD/MM, DD Nom_de_mois par exemple) avec des mois et années implicites
  - Si le mois est omis tu prends le mois courant (le 23 -> YYYY-07-23 si mois courant = juillet)
  - Si l'année est omise tu prends l'année courante (le 23 juillet -> 2025-07-23 si mois courant = juillet et année = 2025)
- Pour faire des comparaisons de dates tu dois TOUJOURS convertir le format de l'utilisateur dans le format YYYY-MM-DD de la sélection.
  Exemple: 04/07 ou 4 juillet -> 2025-07-04 si année courante = 2025

C) FORMAT HEURES
  - Dans la sélection les heures et durées sont au format HHhMM.
  - Dans la demande tu peux avoir des formats différents (HH:MM par exemple)
  - Pour faire des comparaisons d'heures/minutes tu dois TOUJOURS convertir te ramener à un nombre de minutes et en sortie reconvertir en HHhMM.

D) DISTRIBUTION
- Le champ Distribution contient l'(les) auteur(s), les acteurs, l'équipe technique, la compagnie.
- Le nom du(des) auteur(s) est au début du champ Distribution précédé par "De"
- Le nom des acteurs suit précédé de "Avec"
- Les noms des participant à l'équipe technique, la compagnie suivent éventuellement
- SI L'UTILISATEUR DEMANDE LES AUTEURS / ACTEURS CHERCHE DANS CES RUBRIQUES. N'invente pas, si tu ne trouves pas dis que tu ne trouves pas les informations demandées dans le champ Distribution.

━━━━━━━━━━━━━━━━━━━━
2) RÈGLES OPERATIONNELLES 
━━━━━━━━━━━━━━━━━━━━

A) EXPLOITATION DE LA SELECTION:
- Tu DOIS t’appuyer EXCLUSIVEMENT sur la sélection fournie.
- Tu NE DOIS JAMAIS citer un spectacle absent de la sélection.
- Tu NE DOIS JAMAIS inventer une information absente de la sélection.

- Tu NE DOIS JAMAIS renvoyer l'utilisateur
  vers des sources externes
  ("consulter le programme", "voir le catalogue", etc.)
  si l'information est présente dans la sélection fournie.

B) CONDITION MATCHING:
Quand on te pose une question du style : "Ces spectacles jouent ils le 15/07 ?", "Ce spectacle est il joué dans le Off / In":
- si tous les spectacles matchent la condition, réponds quelque chose comme : "oui ils respectent tous cette condition"
- si seuls certains matchent, réponds quelque chose comme : "voici ceux qui ..." et tu les cites
- si aucun matche, réponds quelque chose comme : "Désolé, aucun ne ..." ou "Non ce spectacle ne ..."

- INTERDICTION: Tu n’as PAS le droit de répondre "Non" ou "Aucun" sans avoir testé la condition pour CHAQUE spectacle de la sélection.

- Si TOUS les spectacles matchent la condition :
  ➜ tu NE DOIS PAS les lister individuellement,
  ➜ tu réponds uniquement par une confirmation globale.

- Si on te pose une question par rapport à une sélection vide, répond quelque chose comme: "Désolé il n'existe aucun spectacle correspondant à votre demande".

━━━━━━━━━━━━━━━━━━━━
3) ÉQUIVALENCES TERMINOLOGIQUES 
━━━━━━━━━━━━━━━━━━━━

Dans toute la conversation, les expressions suivantes sont STRICTEMENT ÉQUIVALENTES
et désignent TOUJOURS le même concept :

- "programme"
- "planning"
- "planning de l'utilisateur"
- "activités programmées"
- "spectacles programmés"
- "spectacles du planning"

➡️ Elles désignent UNIQUEMENT les spectacles effectivement présents
dans le planning de l'utilisateur (avec des dates de planification).

Tu ne dois JAMAIS interpréter ces termes comme :
- le catalogue général
- les dates de représentation théoriques
- des spectacles non programmés

━━━━━━━━━━━━━━━━━━━━
4) RÈGLES LEXICALES  
━━━━━━━━━━━━━━━━━━━━

A) Sens de "jouer" / "joue" / "jouent" / "est joué"
- Par défaut, dans une question de type :
  "ce spectacle joue-t-il le … ?"
  "ces spectacles jouent-ils le … ?"
  "est-il joué le … ?"
  "ils jouent quand ?"
  le verbe "jouer" se rapporte TOUJOURS aux DATES DE REPRÉSENTATION.

- "jouer" NE signifie PAS "être programmé".

- "jouer" ne se rapporte JAMAIS aux DATES DE PLANIFICATION !

B) Règle de non-confusion (OBLIGATOIRE)
- Tu ne dois JAMAIS utiliser les Dates de planification pour répondre à une question 
  qui demande à quelle date un spectacle est "joué". Dans ce cas tu dois utiliser les Dates de représentation.

  Quand l'utilisateur pose une question sur des spectacles de la sélection
  en utilisant des verbes comme :
  - "jouer", "joue", "jouent", "se joue", "est joué"
  
  ET qu'il mentionne :
  - une date précise
  - ou une plage de dates
  - ou une question fermée (ex : "jouent-ils le 04/07 ?")
  
  ALORS tu DOIS interpréter la question
  COMME PORTANT SUR LES DATES DE REPRÉSENTATION.

C) Horaires d'un spectacle = heures de début et de fin (champs "Début" et "Fin" de la sélection). 
   Si on te demande les horaires d'un spectacle tu dois donner ses heures de début et de fin.

━━━━━━━━━━━━━━━━━━━━
5) PRÉSENTATION DES RÉSULTATS
━━━━━━━━━━━━━━━━━━━━

A) FORMAT STANDARD
Si la demande implique de citer des spectacles, utilise le FORMAT STANDARD suivant :
Titre — Style — Lieu - Note (nombre d'avis)
  [- Informations complémentaires selon le type de sortie]

Pour le Titre, UTILISE IMPERATIVEMENT le Titre donné dans la sélection avec son index et son lien_markdown.
- Recopie-le EXACTEMENT tel quel :
  - aucun caractère modifié
  - pas de gras, italique, guillemets ou décorations
- Si aucun lien_markdown n’est fourni, utilise le titre en texte brut.

B) INFORMATIONS COMPLEMENTAIRES (TRÈS IMPORTANTE — À APPLIQUER AVANT D’ÉCRIRE) :

1) Détermine d’abord le "type de sortie" :

- "STANDARD": la demande correspond à une recherche de spectacles ou un résumé sur la sélection courante.
  (ex: "cherche 3 spectacles du off style ...", "redonne la sélection", "compare", "analyse la sélection", "lequel me conseilles-tu ?").

- "DETAILS_ON": tu cites un spectacle pour donner des informations complémentaires demandées EXPLICITEMENT par l'utilisateur
  (ex: "précise le descriptif", "résume les avis", "donne les horaires", "quel est le ton, l'humeur, le mood").

- "DETAILS_OFF": tu cites un spectacle seulement pour préciser la réponse à une question sur la sélection courante
  (ex: "jouent-ils le 15/07 ?", "à quelle heure ?", "où ?", "quels jours ?", "y a-t-il des relâches ?",

2) Sortie attendue :

- "STANDARD": .
  ➜ Tu ajoutes à la suite du FORMAT DE BASE les informations standard suivantes:
     - Description: (utilise "Description résumée" sinon résume "Description" en 100 mots max)
     - Avis: (utilise "Avis résumé" sinon résume "Avis" en 60 mots max)
     - Mood: (champ Mood ou 2–3 mots max)

- "DETAILS_ON": .
  ➜ Tu ajoutes à la suite du FORMAT DE BASE les seules informations complémentaires demandées 
  ➜ retour à la ligne + tiret pour chaque information complémentaire citée 
  ➜ PAS DE LIGNE VIDE entre le titre et les informations complémentaires citées.

- "DETAILS_OFF": 
  ➜ FORMAT DE BASE uniquement 
  ➜ Pas de saut de ligne entre les spectacles 

━━━━━━━━━━━━━━━━━━━━
6) ANALYSE DES CONFLITS / CHEVAUCHEMENTS D’HORAIRES
━━━━━━━━━━━━━━━━━━━━
DÉFINITION :
Un conflit horaire existe UNIQUEMENT si deux spectacles :
- ont un chevauchement strict entre leurs créneaux horaires [Début, Fin].
- ET sont programmés le MÊME JOUR (dates de planification identiques) SEULEMENT si la sélection concerne le PLANNING

REGLES :
- NE FAIS PAS cette analyse si on ne te demande pas EXPLICITEMENT une ANALYSE DE CONFLITS.
- NE DIS PAS que tu ne peux pas faire cette analyse si on ne te demande pas EXPLICITEMENT une ANALYSE DE CONFLITS.

PROCÉDURE OBLIGATOIRE :
Si on te demande une analyse de conflits, deux cas se présentent:
A) Origine de la sélection: current_schedule (planning de l'utilisateur) 
B) Sinon

A) current_schedule 
  1) Identifie les DATES DE PLANIFICATION pour chaque spectacle.
  2) Si un spectacle n’a PAS de dates de planification :
    - Dis explicitement que l’analyse de conflit est impossible pour ce spectacle.
    - N’utilise PAS les dates de représentation comme substitut.
  3) Compare uniquement les spectacles partageant AU MOINS UNE date de programmation identique.
  4) Pour chaque date commune :
    - analyse les chevauchements d'horaires [Début, Fin].
  5) Même s'il ne s'agit pas d'un conflit, signale comme une remarque les marges entre spectacles STRICTEMENT inférieures à 30 minutes.

B) Sinon
  1) analyse simplement les chevauchements d'horaires [Début, Fin].
  2) signale comme une remarque les marges entre spectacles STRICTEMENT inférieures à 30 minutes.
   
INTERDICTIONS :
- Ne compare JAMAIS deux spectacles sur la base des dates de représentation.
- NE signale PAS les marges égales à 30 minutes (seulement celles STRICTEMENT inférieures à 30 minutes).

━━━━━━━━━━━━━━━━━━━━
7) ANALYSE DES INCOHÉRENCES DE DATES
━━━━━━━━━━━━━━━━━━━━
DÉFINITION :
Une incohérence existe si :
- une date de programmation
- n’appartient pas aux dates de représentation

REGLES :
- NE FAIS cette analyse que si on te demande EXPLICITEMENT une ANALYSE D'INCOHERENCE DE DATES.
- NE DIS PAS que tu ne peux pas faire cette analyse si on ne te la demande pas EXPLICITEMENT.
- Signale l’incohérence clairement, sans extrapoler.
`.trim();

    const userPrompt = `
### Demande de l'utilisateur:
${query}

### Semantic query:
${semanticEmbeddingQuery ? semanticEmbeddingQuery : "(Aucune interprétation fournie par l'étage Understand — utilise la demande utilisateur brute ci-dessus)"}

### Sélection de spectacles:
${contextSnippet}

### Origine de la sélection:
- type: ${selectionOrigin} 
- description: ${
  selectionOrigin === "current_schedule"
    ? "Sélection issue du planning de l'utilisateur."
    : selectionOrigin === "local_stock"
      ? "Sélection issue du stock de l'utilisateur."
      : "Sélection issue d'un catalogue."
}

### total_matches:
${totalMatches ? totalMatches : "Inconnu"}

` +
(freeSpeechContext
  ? `Free speech context: "${freeSpeechContext}"

`
  : "") +
`### Consignes:
- Réponds uniquement à partir de la **Sélection de spectacles** fournie.
- Ne cite aucun spectacle qui ne figure pas dans la sélection.
- Si la sélection ne permet pas de répondre complètement, dis-le explicitement.
- Si on te demande le nombre de spectacles prends la valeur de total_matches.
`.trim();

// Eléments retirés du user prompt
//### Contexte de la sélection:
//- type: ${selectionContext} 
//- description: ${
//  selectionContext === "current_utterance_results"
//    ? "Résultats de la demande de l'utilisateur."
//    : selectionContext === "base_utterance_results"
//      ? "Résultats de la demande précédente."
//      : "Contexte non spécifié."
//}

//- Respecte strictement le **Contexte de la sélection**.

    const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4.1",
        temperature: 0.4,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user",   content: userPrompt }
        ]
      })
    });

    if (!openaiRes.ok) {
      const txt = await openaiRes.text().catch(() => "");
      console.error("OpenAI /ai/semantic-explain error:", openaiRes.status, txt);
      return new Response(
        JSON.stringify({ error: "Erreur OpenAI sur /ai/semantic-explain" }),
        { status: 500, headers: { ...headersCORS, "Content-Type": "application/json" } }
      );
    }

    const data   = await openaiRes.json();
    const answer = data?.choices?.[0]?.message?.content || "";

    const matchedFinal = [];
    for (const item of matched) {
      if (!answer.includes(item.activite) ) continue;
      if (!answer.includes(item.lieu) ) continue;
      matchedFinal.push(item);
    }

    return new Response(
      JSON.stringify({
        answer,
        results: matchedFinal,
        context_used: contextSnippet
      }),
      { status: 200, headers: { ...headersCORS, "Content-Type": "application/json" } }
    );

  } catch (e) {
    console.error("AI semantic-explain route error:", e);
    return new Response(
      JSON.stringify({ error: "Erreur interne backend IA (semantic-explain)" }),
      { status: 500, headers: { ...headersCORS, "Content-Type": "application/json" } }
    );
  }
}

// ---------------------------------------------------------
// IA : route /ai/query-understand – interprétation intelligente
// ---------------------------------------------------------

async function handleQueryUnderstand(req, env, headersCORS) {
  if (req.method !== "POST") {
    return new Response("Method not allowed", {
      status: 405,
      headers: headersCORS
    });
  }

  let payload;
  try {
    payload = await req.json();
  } catch {
    return new Response(
      JSON.stringify({ error: "Body JSON invalide" }),
      {
        status: 400,
        headers: { ...headersCORS, "Content-Type": "application/json" }
      }
    );
  }

  const utterance = (payload && payload.utterance) || payload.message || "";
  const editionYear = payload.edition_year || 2025;
  const freeSpeechContext = payload.free_speech_context || "";

  if (!utterance || typeof utterance !== "string") {
    return new Response(
      JSON.stringify({ error: "Champ 'utterance' (string) requis dans le body" }),
      {
        status: 400,
        headers: { ...headersCORS, "Content-Type": "application/json" }
      }
    );
  }

  const apiKey = env && env.OPENAI_API_KEY;
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: "OPENAI_API_KEY not configured" }),
      {
        status: 500,
        headers: { ...headersCORS, "Content-Type": "application/json" }
      }
    );
  }

  const systemPrompt = `
Tu es un analyseur de requêtes pour un assistant chargé d'aider des utilisateurs à choisir des spectacles 
pour le festival d'Avignon (In & Off).

Tu dois convertir la requête utilisateur en un objet JSON complet "QueryIntent".
- "QueryIntent" sera utilisée par ton caller pour faire une sélection de spectacles dans les catalogues 
  des festivals In et Off d'Avignon ou dans un stock ou un planning de spectacles local à l'application de l'utilisateur.
- "QueryIntent" comprend obligatoirement "semantic.embedding_query" (texte canonicalisé) qui sera utilisé par les étapes 
  de recherche pour calculer les embeddings et effectuer le rerank ; 

Tu disposes en entrée de:
- "Previous intent JSON": l'objet "QueryIntent" de la demande précédente (appelé ci-dessous previous_intent)
- "Free speech context": échanges précédents

REGLES ABSOLUES:
- Tu réponds STRICTEMENT avec un JSON valide, pas de texte avant ou après.
- Pas de markdown, pas de commentaire, pas de single quotes. Seulement un simple objet JSON.

- Si un même élément de l’utterance peut raisonnablement alimenter plusieurs filtres (champ filters de QueryIntent), 
  tu DOIS IMPERATIVEMENT le renseigner dans tous les filtres pertinents (ex: un auteur → filters.distribution.auteurs ET filters.keywords).
  Exemple: “une pièce de Sophocle” → distribution.auteurs=["Sophocle"] ET keywords=["Sophocle"]

Voici le schema de "QueryIntent" (en mode "search_shows" tu dois produire toujours toutes les top-level keys, 
même si certaines sub-keys sont vides):

{
  "version": "3",
  "utterance": "<demande utilisateur brute>",
  "intent": "search_shows" | "free_speech" | "unknown",
  "free_answer": string,           // Réponse libre, i.e. hors intent "search_shows"
  "scope": {
    "festival": ["in", "off"],     // les sections concernées
    "edition_year": 2025,
    "search_space": "none" | "local_stock" | "current_schedule" | "full_festival"
  },
  "results": {
    "limit": number,
    "selection_mode": "random" | "scored"     
  },
  "filters": {
    "dates": {
      "from": string | null,       // "YYYY-MM-DD"
      "to": string | null,
      "origin": "explicit" | "inferred" | "system_default" | "implicit_default" | "not_specified"
    },
    "time_window": {
      "start": string | null,      // "HHhMM"
      "end": string | null,
      "origin": "<origin>"
    },
    "categories": [
      { "value": string, "origin": "<origin>" }   // style des spectacles demandés (Théâtre, Danse, etc.)
    ],
    "mood": [
      { "value": string, "origin": "<origin>" }   // qualifie le ton, l'humeur, l'ambiance d'un spectacle (onirique, humoristique, etc.)
    ],
    "distribution": {                             // Renseigne les auteurs, acteurs, compagnies demandés 
      "acteurs": [string],
      "auteurs": [string],
      "compagnies": [string]
    },
    "keywords": [
      { "value": string, "origin": "<origin>" }   // mots clefs qui qualifient l'intention de l'utilisateur
    ],
    "shows": [
      { "value": string, "origin": "<origin>" }   // nom des spectacles demandés
    ],
    "sections": [
      { "value": "in" | "off", "origin": "<origin>" }
    ],
    "venues": [
      { "name": string, "origin": "<origin>" }    // la colonne "lieu" des catalogues
    ],
    "audience": {
      "min_age_max": number | null,
      "family_friendly": boolean | null,
      "origin": "<origin>"
    },
    "duration": {
      "max_minutes": number | null,
      "min_minutes": number | null,
      "origin": "<origin>"
    },
    "note": {
      "max_note": number | null,        // Note max demandée
      "min_note": number | null,        // Note min demandée
      "max_avis_count": number | null,  // Nombre d'avis max demandée
      "min_avis_count": number | null   // Nombre d'avis min demandée
    },
    "price": {
      "max_euros": number | null,
      "origin": "<origin>"
    },
    "language": {
      "values": [string],
      "origin": "<origin>"
    }
  },
  "semantic": {
    "embedding_query": string,      // reformulation optimisée de la recherche demandée
    "use_for_rerank": boolean
  },
  "meta": {
    "uses_previous_intent": boolean,
    "previous_intent_relation": "none" | "others" | "same_but_modified" | "refine",
    "reuse_previous_selection": boolean,
  }
}

TU DOIS POUR CHAQUE DEMANDE COMMENCER PAR EVALUER intent;
SI intent = "search_shows" TU DOIS POUR CHAQUE DEMANDE REEVALUER SYSTEMATIQUEMENT tous les champs de meta, scope, filters et semantic.

CHECKLIST
Ai-je bien rempli tous les champs de meta, scope, filters et semantic ?
  
ÉQUIVALENCES TERMINOLOGIQUES (RÈGLE IMPORTANTE)

  1. Planning de l'utilisateur
    Dans toute la conversation, les expressions suivantes sont STRICTEMENT ÉQUIVALENTES et désignent TOUJOURS le planning de l'utilisateur :
    - "programme"
    - "planning"
    - "planning de l'utilisateur"
    - "activités programmées"
    - "spectacles programmés"
    - "spectacles du planning"
    
    ➡️ Elles désignent UNIQUEMENT les spectacles effectivement présents
    dans le planning de l'utilisateur (avec des dates de planification).
    
    Tu ne dois JAMAIS interpréter ces termes comme :
    - le catalogue général
    - les dates de représentation théoriques
    - des spectacles non programmés
    
    Ces équivalences restent valables :
    - quelle que soit la position dans la conversation
    - même en cas de nouvelle phrase isolée
    - même si la formulation est courte ("le programme", "3 autres", "le planning")

    Tu ne dois JAMAIS réinterpréter ces termes différemment
    en fonction du contexte conversationnel.
  
  2. Spectacle
  Dans toute la conversation, les expressions suivantes sont STRICTEMENT ÉQUIVALENTES :
  - "spectacle"
  - "show"
  - "pièce de théâtre"
  - "oeuvre"

  3. DÉSAMBIGUÏSATION "JOUER" (IMPORTANT)
  - Les verbes "jouer / joue / jouent / est joué" se rapportent par défaut aux DATES DE REPRÉSENTATION.
  - Ils ne se rapportent jamais aux DATES DE PLANIFICATION.
  
RÈGLES CARDINALES (À RESPECTER AVANT TOUTE AUTRE RÈGLE)

  1. Toute mention de "programme", "planning", "activités programmées"
     implique le planning de l'utilisateur (-> search_space = "current_schedule").
     
  2. En mode "search_shows", TU DOIS TOUJOURS:
    - produire un QueryIntent complet
    - réévaluer results.limit et scope.search_space en fonction de la demande.
  
  3. Demande utilisateur avec "ces spectacles" / "cette sélection" / "les mêmes"
    - Les expressions "ces spectacles", "ces 3 spectacles", "ceux que tu viens de proposer", "cette sélection", "les mêmes", "ceux-là" 
      désignent la SÉLECTION COURANTE quel que soit l’espace de recherche d’origine (scope.search_space).
  
RÈGLE PRIORITAIRE — DETERMINATION DU intent

  La première chose que tu dois faire est de déterminer si intent = "free_speech" | "search_shows" | "unknown". 

  Dans tous les cas tu utilises le contexte de chat fourni dans "Free speech context" pour établir ta réponse 
  et détecter dans la demande des références implicites aux échanges précédents:
  - "Free Speech context" est formé d'une liste d'échanges.
  - Chaque échange comprend une paire:
    - "Utilisateur": la demande utilisateur
    - "Assistant": la réponse de l'assistant 
  
  1. intent = "free_speech"
    SI la requête de l'utilisateur :
    - porte clairement sur une information d'ordre général, culturelle ou factuelle  
    - ELLE NE CONCERNE PAS:
      - les catalogues des festivals In et Off, 
      - le stock de l'utilisateur
      - le planning / programme de l'utilisateur
      - la sélection courante

    ALORS :
    - intent = "free_speech"
    - free_answer = réponse directe en langage naturel
    - scope.search_space = "none"
    - results.limit = valeur de previous_intent 
    
    Exemples:
    - "qui est Molière ?" → free_answer
    - "c'est quoi le théâtre contemporain ?" → free_answer
    - "que signifie relâche ?" → free_answer
    - "quelle est la différence entre in et off ?" → free_answer
    - "cite une pièce de Molière" -> free_answer (il s'agit d'une recherche mais qui ne mentionne explicitement ni les catalogues IN et Off, ni le stock / programme / planning de l'utilisateur, ni la sélection courante))

    Si l'utilisateur te demande à quelles informations tu as accès, tu brodes autour du fait que tu as accès aux catalogues In et Off du festival d'Avignon 
    ainsi qu'à son stock et à son planning / programme de spectacles. Les informations disponibles dans les catalogues sont:
    - le nom du spectacle
    - les dates de séances
    - les heures de début et de fin de spectacle
    - la durée de spectacle
    - le lieu du spectacle (nom du théâtre)
    - la description du spectacle
    - le style du spectacle
    - l'ambiance, le ton, l'humeur générale (mood)
    - la distribution (auteurs, acteurs, compagnies)
    - les avis spectateurs (note, nombre d'avis entre parenthèses, résumé des avis)

  2. intent = "search_shows"
  - Si previous_intent = "free_speech", tu passe en mode intent = "search_shows" si l'utilisateur demande une recherche ou un résumé, une analyse qui mentionnent EXPLICITEMENT:
    - les catalogues des festivals In et/ou Off
    - le stock de l'utilisateur
    - le planning / programme de l'utilisateur
    - la sélection courante
  - Si previous_intent = "search_shows", tu restes dans ce mode tant que l'utilisateur ne pose pas une question d'ordre général qui n'est pas en rapport avec une nouvelle recherche ou la recherche précédente
    (auquel cas tu passes en mode "free_speech").
  - Si tu as une question sur le nombre de spectacles total du Off / In / Stock / Planning / Programme tu passes en mode intent = "search_shows" en mettant dans scope 
    et filters.sections les valeurs correspondant à l'espace de recherche demandé.

  - Exemples:
    - "3 spectacles du Off style théâtre"
    - "cherche / propose / donne 3 spectacles du stock entre telle et telle heure / qui jouent tel jour"
    - "analyse les conflits horaires du planning / programme"
    - "cette pièce est-elle jouée dans le Off ?"

  - A partir de là, tu DOIS IMPERATIVEMENT distinguer entre les 3 sous-cas suivants:
    a) NOUVELLE RECHERCHE
    b) MODIFICATIONS DES CRITERES RECHERCHE POUR LA MEME RECHERCHE
    c) AUTRES RESULTATS POUR LA MEME RECHERCHE
    d) COMPLEMENTS SUR LA SELECTION COURANTE 

    a) NOUVELLE RECHERCHE 
      L'utilisateur demande une nouvelle recherche:
      - sans lien avec la recherche précédente ou la sélection courante, 
      - ni référence explicite ou implicite aux résultats précédents ou la sélection courante,
      - ou avec un scope différent de celui de la demande précédente (scope != previous_intent.scope)
      - ou si previous_intent.intent = "free_speech". 
      - ou REPETE la demande précédente.

      Exemples:
      - "trouve / cherche / propose 3 nouveaux spectacles avec tel ou tel critère"
      - "maintenant trouve des spectacles de danse"
      - "cherche des spectacles jeune public"
      - "et pour demain matin ?"
      - "cherche d'autres possibilités"
      - "ce choix ne convient pas, cherche autre chose"
      - "3 spectacles du off ..."
      - "Fais un résumé du planning"
      
      Il peut s'agir d'une demande explicite ou implicite sur:
      - les catalogues des festivals In et/ou Off (défaut dans ce cas)
      - le stock de l'utilisateur
      - le planning (programme) de l'utilisateur
        
      Il peut s'agir d'une recherche directe ("cherche / trouve / donne / propose des spectacles qui..." ou "n spectacles qui ...") 
      ou d'une demande d'analyse (résume / analyse / donne ton avis sur...).

      Tu es aussi dans ce cas si on te demande d'analyser les conflits de dates, d'horaires. 

      Dans tous ces cas TU DOIS METTRE IMPERATIVEMENT dans meta:
        - meta.uses_previous_intent = false
        - meta.previous_intent_relation = "none"
        - meta.reuse_previous_selection = false   <-- TRES IMPORTANT 
      
      Puis évaluer "QueryIntent" en fonction des critères de recherche que tu détectes dans la demande de l'utilisateur.
      
      Il est notamment TRES IMPORTANT d'évaluer:
      - results.limit si l'utilisateur donne un nouveau nombre de spectacles à sélectionner (par ex. "3 autres").
      - scope si l'utilisateur change le scope de recherche. Notamment:
        - search_space: "local_stock" si la demande porte sur le stock 
        - search_space: "current_schedule" si la demande porte sur le planning / programme / activités programmées / activités prévues.
        - search_space: "full_festival" sinon
      - filters en fonction des critères de recherche spécifiés dans la demande.

    b) MODIFICATIONS DES CRITERES RECHERCHE POUR LA MEME RECHERCHE
      L'utilisateur demande à MODIFIER les critères de la recherche précédente.
      
      ATTENTION: 
      - TU NE PEUX PAS être dans ce cas que si "previous_intent" n'est pas fourni
      - Il DOIT exister un lien EXPLICITE avec la demande précédente (previous_intent.utterance).

      Exemples:
      - "cherche en trois autres pour le lendemain"
      - "cherche deux spectacles de stand-up pour les mêmes dates"
      - "quels sont ceux qui respectent tel ou tel critère"
          
      Dans ce cas TU DOIS METTRE IMPERATIVEMENT dans meta :
      - meta.uses_previous_intent = true
      - meta.reuse_previous_selection = false   ← TRÈS IMPORTANT
      - meta.previous_intent_relation = "same_but_modified"

      Et ensuite:
      - Tu REEVALUES results.limit ET scope (TRES IMPORTANT) en fonction de la demande utilisateur (utterance).
      - Tu METS A JOUR les critères de sélection de previous_intent (filters) selon la requête utilisateur.
        Exemples: 
        - "cherche en trois autres pour le lendemain" -> tu dois changer results.limit et filters.dates
        - "cherche deux spectacles de stand-up pour les mêmes dates" -> tu dois changer filters.categories
      - Tu REEVALUES previous_intent.semantic.embedding_query

    c) AUTRES RESULTATS POUR LA MEME RECHERCHE
      L'utilisateur demande de nouveaux résultats pour la même recherche (follow-up).
      L’utilisateur demande explicitement "d’autres", "encore", "3 autres", "nouveaux"
      
      ATTENTION: 
      - TU NE PEUX PAS être dans ce cas que si previous_intent n'est pas fourni ou si previous_intent.intent = "free_speech" 
      - Il DOIT exister un lien EXPLICITE avec la demande précédente (previous_intent.utterance).
      - Si l'utilisateur repète la demande précédente, tu es dans le cas NOUVELLE RECHERCHE (uses_previous_intent = false) et non dans ce cas 

      Exemples:
      - "3 autres"
      - "encore 3"
      - "3 autres du même style"
      - "d'autres du même style"
      - "encore des spectacles comme ça"
      - "encore des propositions"
      - "encore 3 du même type"
      - "continue"
          
      Dans ce cas TU DOIS METTRE IMPERATIVEMENT dans meta :
      - meta.uses_previous_intent = true
      - meta.reuse_previous_selection = false   ← TRÈS IMPORTANT
      - meta.previous_intent_relation = "others" 

      Et ensuite:
      - Tu REEVALUES results.limit (TRES IMPORTANT) en fonction de la demande utilisateur (utterance).
      - Tu REEVALUES semantic.embedding_query (car results.limit peut changer)
      - Tu RECOPIES previous_intent.filters dans filters.
      - Tu RECOPIES previous_intent.scope dans scope.

    d) COMPLEMENTS SUR LA SELECTION COURANTE
      L’utilisateur demande des COMPLEMENTS D'INFORMATION, une ANALYSE sur la sélection courante et ne modifie 
      ni le scope, ni les critères de recherche.

      L’utilisateur demande une VÉRIFICATION / INFORMATION sur la sélection courante (dates, avis, résumé, comparaison, conflits, etc.)
      (exemples: "jouent-ils le 04/07 ?", "quels avis ?", "résume-les", "compare-les") :

      La demande contient une référence explicite à la sélection courante, comme par exemple: 
      - "ces spectacles", 
      - "les 3 précédents", 
      - "ceux-là", "ceux la", "ceux que tu viens de proposer", 
      - "la sélection", "la sélection courante",
      - "les spectacles proposés", "les propositions"
      et demande une analyse/comparaison/résumé sur ces résultats.

      TU N'ES PAS DANS CE CAS SI scope, results.limit et filters CHANGENT.
    
      En résumé:
      - SI previous_intent est fourni
      - ET SI scope, results.limit et filters ne changent pas par rapport à previous_intent
      - ET SI il existe un lien implicite ou explicite avec la demande précédente (previous_intent.utterance)
      - ALORS tu es dans ce cas.

      Exemples :
      - "peux-tu faire un résumé de ces spectacles ?"
      - "compare ces 3 spectacles"
      - "analyse ceux que tu viens de proposer"
      - "résume les avis sur ces spectacles"
      - "as tu des informations complémentaires sur les descriptifs, distributions, avis, notes ?"
      - "analyse la sélection"
      
      Dans ce cas TU DOIS METTRE IMPERATIVEMENT dans meta:
      - meta.uses_previous_intent = true
      - meta.reuse_previous_selection = true   ← on veut garder EXACTEMENT la même sélection
      - meta.previous_intent_relation = "refine"

      Et ensuite:
      - Tu RECOPIES previous_intent.semantic.embedding_query dans semantic.embedding_query
      - Tu RECOPIES previous_intent.filters dans filters
      - Tu RECOPIES previous_intent.scope dans scope.
  
  3. intent = "unknown"
  - Mets intent = "unknown" si tu n'es ni dans le cas "free_speech" ni dans le cas "search_shows".

REGLES D'INTERPRETATION:
  
  1) filters.sections et scope.festival
  - Si l'utilisateur mentionne EXPLICITEMENT "Off", mets dans filters.sections: [{ "value": "off", "origin": "explicit" }].
  - Si l'utilisateur mentionne EXPLICITEMENT "In", mets dans filters.sections: [{ "value": "in", "origin": "explicit" }].
  - Si l'utilisateur mentionne EXPLICITEMENT "In et Off" ou similaire, met à la fois "in" and "off" dans le tableau filters.sections.
  - scope.festival doit contenir les mêmes sections que celles mises dans filters.sections.
  - Si rien n'est mentionné mets [].

  2) scope.search_space
  - IMPORTANT: tu DOIS IMPERATIVEMENT réaffecter cette valeur selon les règles suivantes A CHAQUE DEMANDE, 
    même si tu considères que tu es en mode "reuse_previous_selection" = true.

  - "local_stock": ne mets cette valeur que si l'utilisateur mentionne EXPLICITEMENT pour l'espace de recherche ou d'analyse: son stock de spectacles.
    Examples:
      - "choisis dans mon stock"
      - "dans le stock courant / local"
  
  - "current_schedule": ne mets cette valeur que si l'utilisateur mentionne EXPLICITEMENT pour l'espace de recherche ou d'analyse: son planning, son programme 
    ou ses spectacles ou activités déjà programmés / prévus. 
    Examples:
    - "cherche dans mon planning"
    - "cherche dans mon programme"
    - "parmi ce que j'ai déjà programmé"
    - "dans ce que j'ai prévu"
  
  - "full_festival": mets cette valeur si l'utilisateur demande EXPLICITEMENT de choisir dans les catalogues / le festival In / le festival Off 
    ou comme valeur par défaut pour une nouvelle recherche.
    Examples:
    - "propose 3 spectacles du Off"
    - "je cherche un spectacle du In"
    - "choisis dans les catalogues In & Off"
    - "choisis dans les catalogues"
  
  - "none": quand tu n'es pas en mode "search_shows".  

  - Référence implicite:
    Si l'espace de recherche n'est pas mentionné TU GARDE LA VALEUR DE previous_intent (scope.search_space = previous_intent.scope.search_space).

  3) results.limit
  - Cette variable traduit le nombre de spectacles demandés.
    Exemples: 
    - "propose 3 spectacles"
    - "donne-moi 2 idées"
  - Si rien n'est mentionné dans la demande mets "10" comme default.
  
  4) filters.categories
  - Cette variable correspond à la colonne "style" du catalogue de spectacles.
  - les valeurs possibles sont:
    "Art du récit"
    "Arts de la marionnette"
    "Arts du cirque"
    "Cabaret"
    "Café-théâtre Non disponible sur Ticket'Off"
    "Café-théâtre"
    "Chanson"
    "Cirque contemporain"
    "Cirque"
    "Clown"
    "Comédie"
    "Concert"
    "Conférence-spectacle"
    "Conte"
    "Cycle d'événements"
    "Danse contemporaine"
    "Danse traditionnelle"
    "Danse"
    "Danse-théâtre"
    "Expérimental"
    "Exposition"
    "Humour"
    "Improvisation"
    "Installation"
    "Jonglerie"
    "Lecture"
    "Magie"
    "Marionnette-objet"
    "Mime"
    "Musique"
    "Performance"
    "Pluridisciplinaire"
    "Poésie"
    "Présentation"
    "Rencontre"
    "Rencontre-débat"
    "Scène ouverte"
    "Seul·e en scène"
    "Show-case"
    "Spectacle musical"
    "Stand-up"
    "Théâtre citoyen"
    "Théâtre classique"
    "Théâtre contemporain"
    "Théâtre d'objet"
    "Théâtre masqué"
    "Théâtre musical"
    "Théâtre"
    "Tragédie"
  - Exemple: "style theatre classique"  → mets { "value": "Théâtre classique", "origin": "explicit" or "inferred" }.
  - il faut prendre la dénomination complète (par exemple pour une demande "theatre classique" il faut mettre en retour la catégorie "Théâtre classique" et non la catégorie "Théatre")

  5) filters.mood
  - Recopie dans cette variable les mots clefs de la demande utilisateur qui qualifient le mood, l'ambiance, le ton, l'humeur, l'ambiance générale du spectacle.
  - N'invente pas.
  - INPORTANT : mets chaque mot clef au singulier ("intimistes" -> "intimiste").
  - Exemple: "des spectacles intimistes et engagés" -> filters.mood = [intimiste, engagé]

  6) filters.keywords
  - Mets dans cette variable 
    - les mots clefs que l'utilisateur souhaite rechercher dans la description du spectacle et les avis du public 
    - les thèmes de spectacles souhaité par l'utilisateur 
    - les noms propres (notamment ceux des personnages que tu connais).
  - Ils seront utilisés pour filtrer les spectacles par description et avis du public et faire une shortlist qui te sera ensuite soumise pour réponse finale.
  - Soit plutôt englobant sur les synonymes.
  - Recopies-y les noms propres tels quels.
  - Tu dois repérer dans la demande les noms propres de personnages que tu connais et les mettre dans cette rubrique.
  - Exemples: 
    - "un spectacle avec tel mot [clef] dans la description ou les avis"
    - "un spectacle sur Me Too" -> tu mets quelque chose comme [ Me Too, MeToo, féminisme, droit des femmes, violences sexuelles ]  
    - plus généralement "un spectacle sur tel thème" -> tu mets le thème
    - "une pièce de Molière -> tu mets [ Molière ] dans filters.keywords ET filters.distribution.auteurs

    7) filters.shows
    - Mets dans cette variable les noms de spectacles / pièces de théâtre que tu reconnais dans la demande.
  
    8) filters.dates
  - Cette variable correspond à des demandes du style: "les spectacles de telle date à telle date".
  - Tu mets les dates au format: "YYYY-MM-DD" en utilisant le mois et l'année courants si on te demande des chose du style 05/07 ou 05 juillet (YYYY-07-05)

  9) filters.time_window
  - Cette variable correspond à des demandes du style: "les spectacles de telle heure à telle heure".
  - Attention tu mets les heures au format français : HHhmm (et non HH:MM)

  10) filters.distribution
  - Ce filtre correspond à la colonne "distribution" du catalogue:
  - Dans "auteurs" tu dois mettre les auteurs demandés séparés par des virgules 
  - Dans "acteurs" tu dois mettre les acteurs demandés séparés par des virgules 
  - Dans "compagnies" tu dois mettre les compagnies demandées séparés par des virgules
  - Tu dois repérer dans la demande les noms propres de personnages que tu connais comme auteurs, acteurs, compagnies et les mettre dans la rubrique ad-hoc de filter.distribution
    SAUF si la demande est vague auquel cas tu mets le nom dans filters.keywords.

  - "auteurs": un auteur doit être spécifié par des demandes EXPLICITES comme "une pièce DE untel" ou "une pièce avec untel en tant qu'auteur" .
  - "acteurs": un acteur doit être spécifié par des demandes EXPLICITES comme "une pièce AVEC untel" ou "une pièce avec untel en tant qu'acteur" ..

  - Si la demande est VAGUE tu ne mets le nom dans filters.keywords et non dans filters.distribution.
    exemple : "un spectacle QUI PARLE DE ..."
  
  11) filters.availability
  - Tu mets "only_future_performances" à true SEULEMENT s'il est EXPLICITEMENT demandé de ne considérer que les spectacles à venir.

  12) semantic.embedding_query
  - Tu DOIS fournir une reformulation CANONIQUE, COURTE et AUTONOME de la requête, optimisée pour une recherche par similarité (embeddings).
  - Exigences de canonicalisation :
    - Pas de pronoms anaphoriques ni de références conversationnelles (remplace "ces spectacles" par "sélection courante" si besoin).
    - Dates : format YYYY-MM-DD.
    - Heures : format HHhMM.
    - Préciser les sections quand elles sont implicites ("in" / "off").
    - Éviter formules inutiles ("propose-moi", "donne-moi", "tu peux me").
    - Inclure mots-clés pertinents (auteur, style, lieu) et mots propres écrits en clair.
  - Objectif : le texte doit être autonome et stable pour produire des embeddings identiques si la même intention est réutilisée.
  - Comportement par défaut : tu REGENERES systématiquement "semantic.embedding_query" pour chaque demande.
  - EXCEPTION: si "meta.reuse_previous_selection === true" alors TU DOIS REUTILISER EXACTEMENT "previous_intent.semantic.embedding_query" sans la modifier.

  13) origins
  - "explicit": l'information est clairement demandée par l'utilisateur.
  - "inferred": l'information est déduite par toi de la demande de l'utilisateur.
  - "system_default": l'information est imposée par une règle système (i.e. exclude_relache = true par imposée design).
  - "implicit_default": valeur par defaut non déduite d'une règle système.
  - "not_specified": information non fournie ou pas déductible.
  
  14) results.selection_mode
  - "random" = valeur par défaut.
  - "scored" = tu mets cette valeur SEULEMENT si l'utilisateur demande EXPLICITEMENT les meilleurs candidats / résultats dans une recherche.
  
  15) analyse de conflits d'horaires / d'incohérence de dates
  - Si on te demande une analyse de conflits d'horaires, il s'agit de vérifier que les spectacles de la sélection sont compatibles quant à leurs dates
    de début et de fin. 
  - Une analyse de conflits d'horaires implique TOUJOURS :
    - intent = "search_shows"

  - Si on te demande une analyse d'incohérence de dates, il s'agit de vérifier que les dates de planification appartiennent bien aux dates de représentation.    
  - Une analyse d'incohérence de dates implique TOUJOURS :
    - intent = "search_shows"
    - scope.search_space = "current_schedule"
`.trim();
  
  const previousIntent = payload.previous_intent || null;
  
/*   const previousIntentSnippet = previousIntent
    ? `Previous intent JSON:\n${JSON.stringify(previousIntent)}\n\n`
    : "";
 */  
  const previousIntentSnippet = "";
  
  const userPrompt =
    `
  User utterance: "${utterance}"
  
  ${previousIntentSnippet}Context:
  - Festival year: ${editionYear}
  
  ` +
    (freeSpeechContext
      ? `Free speech context: "${freeSpeechContext}"
  
  `
      : "") +
  `Produit un objet JSON QueryIntent COMPLET selon le schema et les règles ci-dessus.
  `.trim();
    

  try {
    const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4.1",
        temperature: 0,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ]
      })
    });

    if (!openaiRes.ok) {
      const txt = await openaiRes.text().catch(() => "");
      console.error("OpenAI /ai/query-understand error:", openaiRes.status, txt);
      return new Response(
        JSON.stringify({
          error: "Erreur OpenAI sur /ai/query-understand",
          status: openaiRes.status
        }),
        {
          status: 500,
          headers: { ...headersCORS, "Content-Type": "application/json" }
        }
      );
    }

    const data = await openaiRes.json();
    const raw = data?.choices?.[0]?.message?.content || "";

    // On essaie de parser le JSON retourné
    let jsonParsed;
    try {
      jsonParsed = JSON.parse(raw);
    } catch (e) {
      console.error("Query-understand JSON parse error, raw:", raw);
      return new Response(
        JSON.stringify({
          error: "Réponse modèle non parseable en JSON",
          raw
        }),
        {
          status: 500,
          headers: { ...headersCORS, "Content-Type": "application/json" }
        }
      );
    }

    jsonParsed.meta = jsonParsed.meta || {};
    
    return new Response(JSON.stringify(jsonParsed), {
      status: 200,
      headers: { ...headersCORS, "Content-Type": "application/json" }
    });
  } catch (e) {
    console.error("AI query-understand route error:", e);
    return new Response(
      JSON.stringify({ error: "Erreur interne backend IA (query-understand)" }),
      {
        status: 500,
        headers: { ...headersCORS, "Content-Type": "application/json" }
      }
    );
  }
}

/**
 * Route /ai/intention
 * Classifie une requête utilisateur comme "semantic" ou "chat".
 */
async function handleIntentClassifier(req, env, headersCORS) {

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: headersCORS });
  }

  try {
    const body = await req.json();
    const message = body?.message || "";

    if (!message || typeof message !== "string") {
      return new Response(
        JSON.stringify({ error: "Missing 'message' string in body" }),
        {
          status: 400,
          headers: { ...headersCORS, "Content-Type": "application/json" }
        }
      );
    }

    const apiKey = env && env.OPENAI_API_KEY;
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "OPENAI_API_KEY not configured" }),
        {
          status: 500,
          headers: { ...headersCORS, "Content-Type": "application/json" }
        }
      );
    }

    const prompt = `
  Tu es un classifieur d'intention pour l'application "In & Off".
  Tu dois répondre STRICTEMENT par un seul mot : "semantic" ou "chat".

  - Réponds "semantic" lorsque l'utilisateur demande des SUGGESTIONS ou RECOMMANDATIONS de spectacles (ex : "propose", "je cherche un spectacle", "idées de spectacles", "je voudrais voir", "tu me conseilles quoi", etc.).
  - Réponds "chat" lorsque l'utilisateur pose une question générale, demande une explication, un résumé, une analyse, etc.

  Ne rajoute rien d'autre, pas de phrase, pas de ponctuation : juste semantic ou chat.

  Question utilisateur :
  "${message}"
  `.trim();

    const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "Tu es un classifieur d'intentions strict." },
          { role: "user", content: prompt }
        ],
        max_tokens: 5,
        temperature: 0
      })
    });

    if (!openaiRes.ok) {
      const txt = await openaiRes.text().catch(() => "");
      console.error("OpenAI /ai/intention error:", openaiRes.status, txt);
      return new Response(
        JSON.stringify({
          error: "Erreur OpenAI sur /ai/intention",
          status: openaiRes.status
        }),
        {
          status: 500,
          headers: { ...headersCORS, "Content-Type": "application/json" }
        }
      );
    }

    const data = await openaiRes.json();
    let intent = data?.choices?.[0]?.message?.content || "";
    intent = intent.trim().toLowerCase();

    // Sécurisation : tout ce qui n'est pas "semantic" → "chat"
    if (intent !== "semantic" && intent !== "chat") {
      intent = "chat";
    }

    return new Response(
      JSON.stringify({ intent }),
      {
        status: 200,
        headers: { ...headersCORS, "Content-Type": "application/json" }
      }
    );
  } catch (e) {
    console.error("AI intention route error:", e);
    return new Response(
      JSON.stringify({ error: "Erreur interne backend IA (intention)" }),
      {
        status: 500,
        headers: { ...headersCORS, "Content-Type": "application/json" }
      }
    );
  }
}

/**
 * Route /ai 
 * Chat général.
 */
async function handleChatAI(req, env, headersCORS) {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: headersCORS });
  }

  try {
    const body = await req.json();
    const message = body?.message || "";
    const context = body?.context || "";

    if (!message || typeof message !== "string") {
      return new Response(
        JSON.stringify({ error: "Missing 'message' string in body" }),
        {
          status: 400,
          headers: { ...headersCORS, "Content-Type": "application/json" }
        }
      );
    }

    const apiKey = env && env.OPENAI_API_KEY;
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "OPENAI_API_KEY not configured" }),
        {
          status: 500,
          headers: { ...headersCORS, "Content-Type": "application/json" }
        }
      );
    }

    const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              "Tu es un assistant intégré à l'application In & Off. " +
              "Tu aides à analyser, expliquer et optimiser des plannings de spectacles du Festival d'Avignon. " +
              "IMPORTANT :\n" +
              "- Quand tu parles de spectacles précis, ne les invente pas. " +
              "  Ne cite des spectacles que si l'utilisateur les mentionne ou si le contexte fourni (planning, résultats de recherche) les contient déjà.\n" +
              "- Si tu dois donner des exemples hypothétiques, dis clairement que ce sont des exemples imaginaires.\n" +
              "- Quand tu parles d'un spectacle réel du festival, précise autant que possible l'année, le festival (In ou Off) et le lieu, " +
              "  si ces informations sont présentes dans le contexte ou dans la question.\n"          
          },
          {
            role: "user",
            content:
              (context ? `Contexte:\n${context}\n\n` : "") +
              `Question:\n${message}`
          }
        ]
      })
    });

    if (!openaiRes.ok) {
      const txt = await openaiRes.text().catch(() => "");
      console.error("OpenAI chat error:", openaiRes.status, txt);
      return new Response(
        JSON.stringify({
          error: "Erreur OpenAI",
          status: openaiRes.status,
          upstream: txt
        }),
        {
          status: 500,
          headers: { ...headersCORS, "Content-Type": "application/json" }
        }
      );
    }

    const data = await openaiRes.json();
    const replyText =
      data?.choices?.[0]?.message?.content || "Je n'ai pas réussi à générer de réponse utile.";

    return new Response(
      JSON.stringify({ reply: replyText }),
      {
        status: 200,
        headers: { ...headersCORS, "Content-Type": "application/json" }
      }
    );
  } catch (e) {
    console.error("AI route error:", e);
    return new Response(
      JSON.stringify({ error: "Erreur interne backend IA" }),
      {
        status: 500,
        headers: { ...headersCORS, "Content-Type": "application/json" }
      }
    );
  }
}

/**
 * Route /ai/summarize_one
 * Résumé premium d’un spectacle (description + avis + mood)
 */
async function handleSummarizeOneAI(req, env, headersCORS) {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: headersCORS });
  }

  try {
    const body = await req.json();
    const item = body?.item;

    if (!item || typeof item !== "object") {
      return new Response(
        JSON.stringify({ error: "Missing 'item' object in body" }),
        {
          status: 400,
          headers: { ...headersCORS, "Content-Type": "application/json" }
        }
      );
    }

    const apiKey = env && env.OPENAI_API_KEY;
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "OPENAI_API_KEY not configured" }),
        {
          status: 500,
          headers: { ...headersCORS, "Content-Type": "application/json" }
        }
      );
    }

    const result = await summarizeOneItemPremiumWorker(item, apiKey);

    return new Response(
      JSON.stringify(result),
      {
        status: 200,
        headers: { ...headersCORS, "Content-Type": "application/json" }
      }
    );
  } catch (e) {
    console.error("Summarize route error:", e);
    return new Response(
      JSON.stringify({ error: "Erreur interne backend IA" }),
      {
        status: 500,
        headers: { ...headersCORS, "Content-Type": "application/json" }
      }
    );
  }
}

async function summarizeOneItemPremiumWorker(item, apiKey) {
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
- avis_summary: Une phrase factuelle (60 mots max). 
  Si pas d'avis: "Pas d’avis disponibles."
- mood: 2 ou 3 mots-clés d’ambiance, sinon "indéterminé".
`.trim();

  const user = `
Données:
${JSON.stringify(payload, null, 2)}

Réponds au format:
{
  "desc_summary": "...",
  "avis_summary": "...",
  "mood": "..."
}
`.trim();

  const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
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

  if (!openaiRes.ok) {
    const txt = await openaiRes.text().catch(() => "");
    throw new Error(`OpenAI error ${openaiRes.status}: ${txt}`);
  }

  const data = await openaiRes.json();
  const content = data?.choices?.[0]?.message?.content || "{}";

  let js;
  try { js = JSON.parse(content); } catch { js = {}; }

  return {
    avisObj,
    desc_summary: cleanString(js?.desc_summary) || null,
    avis_summary: cleanString(js?.avis_summary) || null,
    mood: cleanString(js?.mood) || null
  };
}

function truncateText(s, maxLen) {
  s = String(s ?? "");
  return s.length <= maxLen ? s : s.slice(0, maxLen - 1) + "…";
}

function cleanString(s) {
  if (s == null) return "";
  return String(s).replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------
// Export Cloudflare Worker
// ---------------------------------------------------------

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const origin = req.headers.get("Origin") || "";
    const headersCORS = corsHeaders(origin);

    // Préflight CORS
    if (req.method === "OPTIONS") {
      return new Response("ok", { status: 200, headers: headersCORS });
    }

    // 🔹 Route /ai/intention : classification chat vs semantic
    if (url.pathname === "/ai/intention") {
      return handleIntentClassifier(req, env, headersCORS);
    }

    // 🔹 Route /ai/query-understand : détection d'intentions
    if (url.pathname === "/ai/query-understand") {
      return handleQueryUnderstand(req, env, headersCORS);
    }

    // 🔹 Route /ai/semantic-wf : filtrage puis scoring sémantique par similarité sur l'index global
    if (url.pathname === "/ai/semantic-wf") {
      return handleSemanticSearchWithFilters(req, env, headersCORS);
    }

    // 🔹 Route /ai/semantic-wk : filtrage par clefs puis scoring sémantique par similarité sur l'index global 
    if (url.pathname === "/ai/semantic-wk") {
      return handleSemanticSearchWithK(req, env, headersCORS);
    }

    // 🔹 Route /ai/semantic-wkk : filtrage par clefs et keywords puis scoring sémantique par similarité sur l'index global 
    if (url.pathname === "/ai/semantic-wkk") {
      return handleSemanticSearchWithKK(req, env, headersCORS);
    }

    // 🔹 Route /ai/semantic-from-intent : recherche basée sur QueryIntent
    if (url.pathname === "/ai/semantic-explain") {
      return handleSemanticExplain(req, env, headersCORS);
    }

    // 🔹 Route /ai/summarize_one : renvoie un résumé premium d'un spectacle
    if (url.pathname === "/ai/summarize_one") {
      return handleSummarizeOneAI(req, env, headersCORS);
    }
        
    // 🔹 Route /ai : chat "classique"
    if (url.pathname === "/ai") {
      return handleChatAI(req, env, headersCORS);
    }

    // -----------------------------------------------------
    // À partir d'ici : PROXY EXISTANT (Off / In / BilletReduc)
    // -----------------------------------------------------

    const target = url.searchParams.get("url");
    if (!target) {
      return new Response("Missing url parameter", { status: 400, headers: headersCORS });
    }
    if (!isAllowedTarget(target)) {
      return new Response("Target not allowed", { status: 403, headers: headersCORS });
    }

    const baseHeaders = new Headers({
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/127 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
      "Cache-Control": "no-cache"
    });

    const ct = req.headers.get("Content-Type");
    if (ct) baseHeaders.set("Content-Type", ct);

    const init = {
      method: req.method,
      headers: baseHeaders
    };

    if (req.method !== "GET" && req.method !== "HEAD") {
      init.body = await req.arrayBuffer();
    }

    let resp = await fetch(target, init);

    // Retry 403 avec referer pour le In
    if (resp.status === 403) {
      const t = new URL(target);
      const referer = `${t.origin}/fr/edition-2025/programmation`;
      baseHeaders.set("Referer", referer);
      resp = await fetch(target, { ...init, headers: baseHeaders });
    }

    const targetHost = new URL(target).host;

    // 🔴 Cas spécial BilletReduc : ISO-8859-1 *ou* UTF-8 selon la page
    if (targetHost.endsWith("billetreduc.com")) {
      const buf = await resp.arrayBuffer();

      // 1) décodage “historique” en latin1
      let text = new TextDecoder("iso-8859-1").decode(buf);

      // 2) si le HTML annonce utf-8, on refait le décodage correctement
      if (/<meta[^>]+charset=["']?utf-8["']?/i.test(text)) {
        text = new TextDecoder("utf-8").decode(buf);
      }

      const outHeaders = new Headers(resp.headers);
      outHeaders.set("Content-Type", "text/html; charset=utf-8");
      for (const [k, v] of Object.entries(headersCORS)) {
        outHeaders.set(k, v);
      }

      return new Response(text, {
        status: resp.status,
        headers: outHeaders
      });
    }

    // 🟢 Cas général (Off, In, etc.)
    const outHeaders = new Headers(resp.headers);
    if (!outHeaders.get("Content-Type")) {
      outHeaders.set("Content-Type", "text/html; charset=UTF-8");
    }
    for (const [k, v] of Object.entries(headersCORS)) {
      outHeaders.set(k, v);
    }

    return new Response(resp.body, { status: resp.status, headers: outHeaders });
  }
};
