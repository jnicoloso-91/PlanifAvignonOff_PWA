// activites.js
import {
  MIN_DAY, MAX_DAY, MARGE,
  mmToStr, debutMin, dureeMin, isUnscheduled
} from './utils-date.js';

// ===== Stubs (placeholders à remplacer plus tard) =====
// Renvoie vrai si au moins une activité programmable existe ce jour-là.
// Pour l’instant: on suppose OUI (comme demandé “oublier les non définies”).
function existActivitesProgrammables(/*jour, traiter_pauses*/) { return true; }

// ==============================================
// ACTIVITÉS PROGRAMMABLES AVANT / APRÈS (stubs)
// ==============================================
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
      nouvelle.__index = row.__index ?? idx;
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
      nouvelle.__index = row.__index ?? idx;
      proposables.push(nouvelle);
    }
  }
  return proposables;
}

// -------------
// BORNES AVANT
// -------------
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

// -------------
// BORNES APRÈS
// -------------
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
    __index: row.__index ?? row.__idx ?? null,
    __uuid: (crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`)
  };
}

// ===== Fonction principale =====
/**
 * @param {Array<object>} dfAll                 - toutes activités (programmées + non programmées)
 * @param {Array<object>} activitesProgrammees  - uniquement programmées (triées par Date puis Debut_dt)
 * @param {boolean} traiter_pauses              - ignoré pour l’instant
 * @param {{periodeDebut?:number, periodeFin?:number}} opts
 * @returns {Array<object>}  liste de créneaux pour la grille
 */
export function getCreneaux(dfAll, activitesProgrammees, traiter_pauses = false, opts = {}) {
  const creneaux = [];
  let bornes = []; // liste des [min,max] déjà vus pour la journée courante (évite doublons)

  const periodeDebut = opts.periodeDebut ?? null; // dateint
  const periodeFin   = opts.periodeFin   ?? null; // dateint

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

      // ---- Créneau APRÈS ----
      if (heureFin != null) {
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

  // tri par Date (string -> int)
  creneaux.sort((a,b) => (parseInt(a.Date,10) || 0) - (parseInt(b.Date,10) || 0));
  return creneaux;
}


