// activites.js
import {
  MIN_DAY, MAX_DAY, MARGE,
  dateintToDate, mmToStr, debutMin, dureeMin
} from './utils-date.js';

// ===== Stubs (placeholders à remplacer plus tard) =====
// Renvoie vrai si au moins une activité programmable existe ce jour-là.
// Pour l’instant: on suppose OUI (comme demandé “oublier les non définies”).
function existActivitesProgrammables(/*jour, traiter_pauses*/) { return true; }

/**
 * Renvoie la liste (triée) des activités programmées :
 * celles qui ont une Date valide, et des champs Début, Durée, Activité non vides.
 *
 * @param {Array<object>} df  - tableau d’activités (équivalent du DataFrame)
 * @returns {Array<object>}   - activités programmées triées
 */
export function getActivitesProgrammees(df) {
  if (!Array.isArray(df)) return [];

  const estFloatValide = v => {
    const n = parseFloat(v);
    return Number.isFinite(n) && n > 0;
  };

  const isNotNull = v => v !== null && v !== undefined && v !== '';

  const filtered = df.filter(r =>
    estFloatValide(r.Date) &&
    isNotNull(r.Debut || r['Début']) &&
    isNotNull(r.Duree || r['Durée']) &&
    isNotNull(r.Activite || r['Activité'])
  );

  // Tri par Date (numérique) puis par Debut_dt ou Debut (HHhMM)
  filtered.sort((a, b) => {
    const da = Number(a.Date) || 0;
    const db = Number(b.Date) || 0;
    if (da !== db) return da - db;

    // Si tu as une propriété Debut_dt (Date JS)
    if (a.Debut_dt && b.Debut_dt) return a.Debut_dt - b.Debut_dt;

    // Sinon on retombe sur le texte "HHhMM"
    const parseTime = s => {
      const m = /(\d{1,2})h(\d{2})/i.exec(String(s || ''));
      return m ? (+m[1]) * 60 + (+m[2]) : 0;
    };
    return parseTime(a.Debut || a['Début']) - parseTime(b.Debut || b['Début']);
  });

  return filtered;
}

export function getDatesFromRows(rows) {
  const out = [];
  for (const r of (rows || [])) {
    const di = Number(r?.Date);
    if (Number.isFinite(di) && di >= 10000101) out.push(di);
  }
  return out;
}

// Considère qu’une ligne "non programmée" n’a pas de Date exploitable
export function isUnscheduled(row) {
  const d = row?.Date;
  return d == null || d === '' || Number.isNaN(+d);
}

// ====== Festival: fetch best-effort + cache ======
// NB: CORS probablement bloqué -> fallback manuel activé automatiquement
export async function getDatesFestival(state = window.appState) {
  if (!state) state = (window.appState = {});
  if (state.festival_debut && state.festival_fin) {
    return { debut: state.festival_debut, fin: state.festival_fin };
  }

  // Fallback par défaut (à ajuster si besoin)
  const FALLBACK_DEBUT = new Date(2025, 6, 5);   // 5 juillet 2025 (mois 0-based)
  const FALLBACK_FIN   = new Date(2025, 6, 26);  // 26 juillet 2025

  // Tente un fetch (souvent bloqué par CORS, donc on timeoute vite)
  async function fetchOffFestivalDates() {
    const url = 'https://www.festivaloffavignon.com/';
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);

    try {
      const res = await fetch(url, { signal: ctrl.signal, mode: 'cors' });
      clearTimeout(timer);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const txt = await res.text();

      // Cherche des motifs comme : "du 5 au 26 juillet 2025"
      // Tolère espaces, majuscules/minuscules
      const re = /du\s+(\d{1,2})\s+juillet\s+au\s+(\d{1,2})\s+juillet\s+(20\d{2})/i;
      const m = re.exec(txt);
      if (m) {
        const d1 = parseInt(m[1], 10);
        const d2 = parseInt(m[2], 10);
        const y  = parseInt(m[3], 10);
        const debut = new Date(y, 6, d1);
        const fin   = new Date(y, 6, d2);
        return { debut, fin };
      }
    } catch (_) {
      // CORS/timeout/parse: on tombe en fallback
    } finally {
      clearTimeout(timer);
    }
    return { debut: FALLBACK_DEBUT, fin: FALLBACK_FIN };
  }

  const { debut, fin } = await fetchOffFestivalDates();

  state.festival_debut = debut || FALLBACK_DEBUT;
  state.festival_fin   = fin   || FALLBACK_FIN;
  return { debut: state.festival_debut, fin: state.festival_fin };
}

// ====== Période à programmer ======
export async function initialiserPeriodeProgrammation(rows, state = window.appState) {
  if (!state) state = (window.appState = {});
  if (typeof state.nouveau_fichier === 'undefined') state.nouveau_fichier = true;

  // Si nouveau fichier -> réinitialise la période
  if (state.nouveau_fichier === true) {
    state.nouveau_fichier = false;

    let periodeDebut = null;
    let periodeFin   = null;

    // dates valides tirées du DF (rows)
    const diList = getDatesFromRows(rows);
    if (diList.length > 0) {
      const minDi = Math.min(...diList);
      const maxDi = Math.max(...diList);
      const dMin  = dateintToDate(minDi);
      const dMax  = dateintToDate(maxDi);
      if (dMin && dMax) {
        periodeDebut = dMin;
        periodeFin   = dMax;
      }
    }

    // si rien trouvé -> dates du festival
    if (!periodeDebut || !periodeFin) {
      const fest = await getDatesFestival(state);
      periodeDebut = fest.debut;
      periodeFin   = fest.fin;
    }

    state.periode_a_programmer_debut = periodeDebut;
    state.periode_a_programmer_fin   = periodeFin;
  }

  // garde-fou si pas encore initialisé
  if (!state.periode_a_programmer_debut || !state.periode_a_programmer_fin) {
    const fest = await getDatesFestival(state);
    state.periode_a_programmer_debut = fest.debut;
    state.periode_a_programmer_fin   = fest.fin;
  }

  return {
    debut: state.periode_a_programmer_debut,
    fin:   state.periode_a_programmer_fin
  };
}


/**
 * Liste des activités non programmées (df) posables AVANT la ligne de ref.
 * - df : toutes les activités (programmées + non) — on parcourt uniquement celles sans Date
 * - activitesProgrammees : uniquement les programmées
 * - ligneRef : activité de référence
 * - traiter_pauses : ignoré ici
 */
function getActivitesProgrammablesAvant(df, activitesProgrammees, ligneRef, traiter_pauses = true) {
  const proposables = [];
  const [debut_min, fin_max] = getCreneauBoundsAvant(activitesProgrammees, ligneRef);
  if (!(debut_min < fin_max)) return proposables;

  for (let idx = 0; idx < (df?.length || 0); idx++) {
    const row = df[idx];
    if (!isUnscheduled(row)) continue;

    const d = debutMin(row), du = dureeMin(row);
    if (!Number.isFinite(d) || !Number.isFinite(du)) continue;
    const h_debut = d, h_fin = d + du;

    if (h_debut >= (debut_min + MARGE) && h_fin <= (fin_max - MARGE)) {
      const nouvelle = { ...row }; delete nouvelle.Debut_dt; delete nouvelle.Duree_dt;
      nouvelle.__type_activite = 'ActiviteExistante';
      nouvelle.__uuid = row.__uuid;
      proposables.push(nouvelle);
    }
  }
  return proposables;
}

/**
 * Liste des activités non programmées (df) posables APRÈS la ligne de ref.
 * - Respecte: si fin_ref passe au lendemain → rien (comme Python)
 * - fin_max peut être null (alors borne haute = 23:59)
 */
function getActivitesProgrammablesApres(df, activitesProgrammees, ligneRef, traiter_pauses = true) {
  const proposables = [];

  const dRef = Number.isFinite(debutMin(ligneRef)) ? debutMin(ligneRef) : MIN_DAY;
  const duRef = Number.isFinite(dureeMin(ligneRef)) ? dureeMin(ligneRef) : 0;
  const finRef = dRef + duRef;
  if (finRef > MAX_DAY) return proposables; // changement de jour -> pas d'après

  const [debut_min, fin_max] = getCreneauBoundsApres(activitesProgrammees, ligneRef);
  if (fin_max != null && !(debut_min < fin_max)) return proposables;

  for (let idx = 0; idx < (df?.length || 0); idx++) {
    const row = df[idx];
    if (!isUnscheduled(row)) continue;

    const d = debutMin(row), du = dureeMin(row);
    if (!Number.isFinite(d) || !Number.isFinite(du)) continue;
    const h_debut = d, h_fin = d + du;

    const borneHaute = (fin_max == null) ? MAX_DAY : (fin_max - MARGE);
    if (h_debut >= (debut_min + MARGE) && h_fin <= borneHaute) {
      const nouvelle = { ...row }; delete nouvelle.Debut_dt; delete nouvelle.Duree_dt;
      nouvelle.__type_activite = 'ActiviteExistante';
      nouvelle.__uuid = row.__uuid;
      proposables.push(nouvelle);
    }
  }
  return proposables;
}

/**
 * Retourne [debut_min, fin_max, prevRow] pour l’activité de référence.
 * - debut_min : fin de l’activité précédente le même jour, ou 00:00
 * - fin_max   : début de l’activité de ref (mm depuis minuit)
 */
function getCreneauBoundsAvant(activitesProgrammees, ligneRef) {
  const dateRef  = ligneRef.Date;
  const debutRef = Number.isFinite(debutMin(ligneRef)) ? debutMin(ligneRef) : MIN_DAY;

  const sameDay = (activitesProgrammees || [])
    .filter(r => r.Date === dateRef)
    .sort((a,b) => (debutMin(a) ?? 0) - (debutMin(b) ?? 0));

  let prev = null;
  for (const r of sameDay) {
    const d = debutMin(r);
    if (Number.isFinite(d) && d < debutRef) prev = r;
    else if ((d ?? 0) >= debutRef) break;
  }

  const prevFin = prev ? (debutMin(prev) + (dureeMin(prev) || 0)) : MIN_DAY;
  const debut_min = prevFin;
  const fin_max   = debutRef;

  return [debut_min, fin_max, prev];
}

/**
 * Retourne [debut_min, fin_max, nextRow] pour l’activité de référence.
 * - debut_min : fin de l’activité de ref
 * - fin_max   : début de l’activité suivante le même jour, ou null (jusqu’à 23:59)
 *
 * NB: Si l’activité de ref déborde sur le lendemain, on calque le comportement Python:
 *     "Pas d'activités programmables après si le jour a changé" → on renvoie un créneau invalide.
 */
function getCreneauBoundsApres(activitesProgrammees, ligneRef) {
  const dateRef  = ligneRef.Date;
  const dRef = Number.isFinite(debutMin(ligneRef)) ? debutMin(ligneRef) : MIN_DAY;
  const duRef = Number.isFinite(dureeMin(ligneRef)) ? dureeMin(ligneRef) : 0;
  const finRef = dRef + duRef;

  if (finRef > MAX_DAY) return [finRef, null, null]; // déborde jour suivant -> pas d'"après"

  const sameDay = (activitesProgrammees || [])
    .filter(r => r.Date === dateRef)
    .sort((a,b) => (debutMin(a) ?? 0) - (debutMin(b) ?? 0));

  let next = null;
  for (const r of sameDay) {
    const rDeb = debutMin(r) || 0;
    const rFin = rDeb + (dureeMin(r) || 0);
    if (rFin > finRef) { next = r; break; }
  }

  const fin_max   = next ? debutMin(next) : null;
  const debut_min = finRef;

  return [debut_min, fin_max, next];
}

// ===== Création d’un objet créneau =====
function creerCreneau(row, borneMin, borneMax, avant, apres, typeCreneau) {
  const dateStr = (row.Date != null) ? String(row.Date) : "";
  const start   = Math.max(MIN_DAY, Math.min(borneMin ?? MIN_DAY, MAX_DAY));
  const endRaw  = (borneMax == null ? MAX_DAY : borneMax);
  const end     = Math.max(MIN_DAY, Math.min(endRaw, MAX_DAY));
  return {
    Date: dateStr,                         // string pour éviter l’icône filtre numérique
    Début: mmToStr(start),
    Fin:   mmToStr(end),
    'Activité avant': avant || '',
    'Activité après': apres || '',
    __type_creneau: typeCreneau,           // "Avant" | "Après" | "Journée"
    __uuid: (crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`)
  };
}

// ===== Renvoie les créneaux disponibles en fonction d'un tableau d'activités =====
/**
 * @param {Array<object>} activites                 - toutes activités (programmées + non programmées)
 * @param {Array<object>} activitesProgrammees  - uniquement programmées (triées par Date puis Debut_dt)
 * @param {boolean} traiter_pauses              - ignoré pour l’instant
 * @param {{periodeDebut?:number, periodeFin?:number}} opts
 * @returns {Array<object>}  liste de créneaux pour la grille
 */
export function getCreneaux(activites, activitesProgrammees, traiter_pauses = false, opts = {}) {
  const creneaux = [];
  let bornes = []; // liste des [min,max] déjà vus pour la journée courante (évite doublons)

  const periodeDebut = opts.debut ?? null; // dateint
  const periodeFin   = opts.fin   ?? null; // dateint

  // ---- Jours libres sur la période (si fournie) ----
  if (Number.isFinite(periodeDebut) && Number.isFinite(periodeFin)) {
    const setProg = new Set((activitesProgrammees || []).map(r => r.Date));
    for (let jour = periodeDebut; jour <= periodeFin; jour++) {
      if (!setProg.has(jour)) {
        if (existActivitesProgrammables(jour, traiter_pauses)) {
          const fakeRow = { Date: jour };
          creneaux.push(creerCreneau(fakeRow, MIN_DAY, MAX_DAY, "", "", "Journée"));
        }
      }
    }
  }

  if ((activitesProgrammees?.length || 0) > 0) {
    let jourCourant = activitesProgrammees[0].Date;

    for (let i = 0; i < activitesProgrammees.length; i++) {
      const row = activitesProgrammees[i];
      const d = debutMin(row), du = dureeMin(row);
      const heureDebut = Number.isFinite(d) ? d : null;
      const heureFin   = (Number.isFinite(d) && Number.isFinite(du)) ? d + du : null;

      // changement de jour → reset des bornes anti-doublons
      if (row.Date !== jourCourant) {
        bornes = [];
        jourCourant = row.Date;
      }

      // ---- Créneau AVANT ----
      if (heureDebut != null) {
        if (getActivitesProgrammablesAvant(activites, activitesProgrammees, row, traiter_pauses).length > 0) {
          // (en Python, on vérifie qu'il existe des programmables avant; ici on passe outre tant que les fonctions manquent)
          const [bMin, bMax, prev] = getCreneauBoundsAvant(activitesProgrammees, row);
          // Valide et pas doublon ?
          if (bMin < bMax) {
            const key = `${bMin}-${bMax}`;
            if (!bornes.includes(key)) {
              bornes.push(key);
              creneaux.push(
                creerCreneau(row, bMin, bMax, prev?.Activite || prev?.Activité || "", row.Activite || row.Activité || "", "Avant")
              );
            }
          }
        }
      }

      // ---- Créneau APRÈS ----
      if (heureFin != null) {
        if (getActivitesProgrammablesApres(activites, activitesProgrammees, row, traiter_pauses).length > 0) {
          const [bMin, bMax, next] = getCreneauBoundsApres(activitesProgrammees, row);
          const max = (bMax == null ? MAX_DAY : bMax);
          if (bMin < max) {
            const key = `${bMin}-${max}`;
            if (!bornes.includes(key)) {
              bornes.push(key);
              creneaux.push(
                creerCreneau(row, bMin, max, row.Activite || row.Activité || "", next?.Activite || next?.Activité || "", "Après")
              );
            }
          }
        }
      }
    }
  }

  // tri par Date (string -> int)
  creneaux.sort((a,b) => (parseInt(a.Date,10) || 0) - (parseInt(b.Date,10) || 0));
  return creneaux;
}

function isCreneauValide(creneau) {
  if (!creneau || typeof creneau !== 'object') return false;
  const t = creneau.__type_creneau;
  return t === 'Avant' || t === 'Après' || t === 'Journée';
}

export function getActivitesProgrammables(activites, creneau, traiterPauses = false) {
  if (!isCreneauValide(creneau)) return [];   // ⬅️ sécurité immédiate

  let proposables = [];

  if (!activites || activites.length <= 0) return proposables;

  const typeCreneau = creneau["__type_creneau"];
  const idx = creneau["__uuid"];
  const dateRef = Number(creneau["Date"]) || 0; // date_ref doit être un int

  if (typeCreneau === "Avant" || typeCreneau === "Après") {
    const activitesProgrammees = getActivitesProgrammees(activites);
    if (!activitesProgrammees || activitesProgrammees.length <= 0) return proposables;

    let ligneRef = null;
    try {
      ligneRef = activitesProgrammees.find(r => r._uuid === creneau._uuid);
      if (!ligneRef) throw new Error("index hors limite");
    } catch (err) {
      console.warn("Erreur getActivitesProgrammables :", err);
      return proposables;
    }

    if (typeCreneau === "Avant") {
      proposables = getActivitesProgrammablesAvant(activites, activitesProgrammees, ligneRef, traiterPauses);
    } else {
      proposables = getActivitesProgrammablesApres(activites, activitesProgrammees, ligneRef, traiterPauses);
    }

  } else if (typeCreneau === "Journée") {
    proposables = getActivitesProgrammablesSurJourneeEntiere(dateRef, traiterPauses);
  }

  // tri par "Début" croissant
  if (proposables && proposables.length > 0) {
    proposables.sort((a, b) => {
      const parse = v => {
        const m = /(\d{1,2})h(\d{2})/i.exec(String(v || ""));
        return m ? (+m[1]) * 60 + (+m[2]) : 0;
      };
      return parse(a["Début"] || a.Debut) - parse(b["Début"] || b.Debut);
    });
  }

  // impose la Date du créneau sur toutes les lignes proposées
  for (const p of proposables) p.Date = String(creneau["Date"] ?? "");

  return proposables;
}
