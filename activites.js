// activites.js
import {
  MIN_DAY, 
  MAX_DAY, 
  dateintToDate, 
  dateToDateint,
  mmToHHhMM, 
  mmFromHHhMM,
  debutMinute, 
  dureeMinute, 
  dateintToPretty,
  recalcFin,
} from './utils-date.js';

import {
  logToPage,
} from './utils.js';

let _ctx = null;
let _MARGE = null;
let _compteurNouvelleActivite = null;

export function creerActivitesAPI(ctx) {

  // Enregistrement local de la référence de contexte
  if (!_ctx) { _ctx = ctx };
  if (!_MARGE) { _MARGE = ctx.meta.MARGE };

  // ---------- API publique ----------
  return {

    /** 
     * Initialisation de la période à programmer
     */
    async initPeriodeProgrammation(df) {

      let periodeDebut = null;
      let periodeFin   = null;

      // dates valides tirées du df
      const diList = _getDatesFromRows(df);
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
        const fest = await _getDatesFestival();
        periodeDebut = fest.debut;
        periodeFin   = fest.fin;
      }

      _ctx.updMetaParams({
        "periode_a_programmer_debut" : periodeDebut, 
        "periode_a_programmer_fin"   : periodeFin
      });

      // garde-fou si pas encore initialisé
      if (!_ctx.getMetaParam("periode_a_programmer_debut") || !_ctx.getMetaParam("periode_a_programmer_fin")) {
        const fest = await _getDatesFestival();
        _ctx.updMetaParams({
          "periode_a_programmer_debut" : fest.debut, 
          "periode_a_programmer_fin"   : fest.fin
        });
      }
    },

    /** 
     * Renvoie la période à programmer
     */
    getPeriodeProgrammation() {
      return {
        debut: _ctx?.getMetaParam("periode_a_programmer_debut") ?? null,
        fin:   _ctx?.getMetaParam("periode_a_programmer_fin") ?? null
      };
    },

    /**
     * Renvoie les créneaux disponibles en fonction d'un tableau d'activités
     * @param {Array<object>} df                    - tableau des activités (programmées + non programmées)
     * @param {Array<object>} activitesProgrammees  - tableau des activités programmées (triées par Date puis Debut_dt)
     * @param {boolean} traiter_pauses              - ignoré pour l’instant
     * @param {{periodeDebut?:number, periodeFin?:number}} opts
     * @returns {Array<object>}  liste de créneaux pour la grille
     */
    getCreneaux(df, activitesProgrammees, traiter_pauses = false, opts = {}) {
      const creneaux = [];
      let bornes = []; // liste des [min,max] déjà vus pour la journée courante (évite doublons)

      const periodeDebut = dateToDateint(_ctx.getMetaParam("periode_a_programmer_debut")); // dateint
      const periodeFin   = dateToDateint(_ctx.getMetaParam("periode_a_programmer_fin")); // dateint

      // ---- Jours libres sur la période (si fournie) ----
      if (Number.isFinite(periodeDebut) && Number.isFinite(periodeFin)) {
        const setProg = new Set((activitesProgrammees || []).map(r => r.Date));
        for (let jour = periodeDebut; jour <= periodeFin; jour++) {
          if (!setProg.has(jour)) {
            if (_existActivitesProgrammables(_getActivitesNonProgrammees(df), jour, traiter_pauses)) {
              const fakeRow = { Date: jour };
              creneaux.push(_creerCreneau(fakeRow, MIN_DAY, MAX_DAY, "", "", "Journée"));
            }
          }
        }
      }

      if ((activitesProgrammees?.length || 0) > 0) {
        // let jourCourant = activitesProgrammees[0].Date;

        for (let i = 0; i < activitesProgrammees.length; i++) {
          const row = activitesProgrammees[i];
          const d = debutMinute(row), du = dureeMinute(row);
          const heureDebut = Number.isFinite(d) ? d : null;
          const heureFin   = (Number.isFinite(d) && Number.isFinite(du)) ? d + du : null;

          // // changement de jour → reset des bornes anti-doublons
          // if (row.Date !== jourCourant) {
          //   bornes = [];
          //   jourCourant = row.Date;
          // }

          // ---- Créneau AVANT ----
          if (heureDebut != null) {
            if (_getActivitesProgrammablesAvant(df, activitesProgrammees, row, traiter_pauses).length > 0) {
              // (en Python, on vérifie qu'il existe des programmables avant; ici on passe outre tant que les fonctions manquent)
              const [bMin, bMax, prev] = _getCreneauBoundsAvant(activitesProgrammees, row);
              // Valide et pas doublon ?
              if (bMin < bMax) {
                const key = `${row.Date}-${bMin}-${bMax}`;
                if (!bornes.includes(key)) {
                  bornes.push(key);
                  creneaux.push(
                    _creerCreneau(row, bMin, bMax, prev?.Activite || prev?.Activité || "", row.Activite || row.Activité || "", "Avant")
                  );
                }
              }
            }
          }

          // ---- Créneau APRÈS ----
          if (heureFin != null) {
            if (_getActivitesProgrammablesApres(df, activitesProgrammees, row, traiter_pauses).length > 0) {
              const [bMin, bMax, next] = _getCreneauBoundsApres(activitesProgrammees, row);
              const max = (bMax == null ? MAX_DAY : bMax);
              if (bMin < max) {
                const key = `${row.Date}-${bMin}-${max}`;
                if (!bornes.includes(key)) {
                  bornes.push(key);
                  creneaux.push(
                    _creerCreneau(row, bMin, max, row.Activite || row.Activité || "", next?.Activite || next?.Activité || "", "Après")
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
    },

    /**
     * Renvoie la liste des activités programmées à partir d'un tableau d'activités :
     * celles qui ont une Date valide, et des champs Début, Durée, Activité non vides.
     * On suppose qu'il s'agit bien d'un tableau d'activités contenant les champs nécessaires 
     * et trié selon Date et Début.
     *
     * @param {Array<object>} df  - tableau d’activités (équivalent d'un DataFrame)
     * @returns {Array<object>}   - activités programmées triées
     */
    getActivitesProgrammees(df) {
      return _getActivitesProgrammees(df);
    },

    /**
     * Renvoie la liste des activités non programmées à partir d'un tableau d'activités :
     * celles sans Date, mais avec Debut, Duree et Activite définies.
     * On suppose qu'il s'agit bien d'un tableau d'activités contenant les champs nécessaires 
     * et trié selon Date et Début.
     * @param {Array<Object>} df - tableau d'activités
     * @returns {Array<Object>} nouveau tableau trié
     */
    getActivitesNonProgrammees(df = []) {
      return _getActivitesNonProgrammees(df);
    },

    /**
     * Renvoie les activités programmables sur un créneau donné
     * @param {*} df              - tableau des activités (programmées + non programmées)
     * @param {*} creneau         - creneau sur lequel rechercher
     * @param {*} traiterPauses   - ignoré pour l’instant
     * @returns 
     */
    getActivitesProgrammables(df, creneau, traiterPauses = false) {
      if (!_estCreneauValide(creneau)) return [];   // ⬅️ sécurité immédiate

      let proposables = [];

      if (!df || df.length <= 0) return proposables;

      const typeCreneau = creneau["__type_creneau"];
      const idx = creneau["__srcUuid"];
      const dateRef = Number(creneau["Date"]) || 0; // date_ref doit être un int

      if (typeCreneau === "Avant" || typeCreneau === "Après") {
        const activitesProgrammees = _getActivitesProgrammees(df);
        if (!activitesProgrammees || activitesProgrammees.length <= 0) return proposables;

        let ligneRef = null;
        try {
          ligneRef = activitesProgrammees.find(r => r.__uuid === idx);
          if (!ligneRef) throw new Error("uuid source du créneau introuvable dans activités programmées");
        } catch (err) {
          console.warn("Erreur getActivitesProgrammables :", err);
          return proposables;
        }

        if (typeCreneau === "Avant") {
          proposables = _getActivitesProgrammablesAvant(df, activitesProgrammees, ligneRef, traiterPauses);
        } else {
          proposables = _getActivitesProgrammablesApres(df, activitesProgrammees, ligneRef, traiterPauses);
        }

      } else if (typeCreneau === "Journée") {
        proposables = _getActivitesProgrammablesSurJourneeEntiere(dateRef, traiterPauses);
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
    },

    /**
     * cellEditor de la colonne Date de la grille des activités programmées
     * @param {*} row 
     * @returns 
     */
    getOptionsDateForActiviteProgrammee(row) {
      // if (_estActiviteReservee(row)) return [];
      const cur = row?.Date != null ? dateintToPretty(row.Date) : '';
      const jours = _getJoursPossibles(row);     
      const pretty = _toPrettyArray(jours);

      let opts = [];
      if (_estActiviteReservee(row)) {
        opts = [cur];
      } else {
        if (pretty.length) opts = [cur, ...pretty, ''];
        else               opts = [cur, ''];
      }
      // nettoie doublons/vides consécutifs
      opts = opts.filter((v,i,self)=> i===0 || v!==self[i-1]);
      return opts;
    },

    /**
     * cellEditor de la colonne Date de la grille des activités non programmées
     * @param {*} row 
     * @returns 
     */
    getOptionsDateForActiviteNonProgrammee(row) {
      const jours = _getJoursPossibles(row);     
      const pretty = _toPrettyArray(jours);
      const opts = pretty.length ? [''].concat(pretty) : [];   // "" = laisser vide
      return opts;
    },

    /**
     * Indique si l'activité passée en paramètre est programmable
     */
    estActiviteProgrammable(row) {
        const jp = _getJoursPossibles(row);
        return (Array.isArray(jp) && jp.length > 0);
    },

    /**
     * Indique si une activité est réservée
     * @param {*} row 
     * @returns 
     */
    estActiviteReservee(row) {
      return _estActiviteReservee(row);
    },

    /**
     * Crée une nouvelle activité 
     * @param {*} df  -> utilisé pour créer un nom d'activité unique qui ne soit pas déja alloué dans df
     * @returns nouvelleActivite
     */
    async creerActivite(df) {
      const nouveauNom = getNouveauNomActivite(df);
      const nouvelleActivite =     {
          __uuid: crypto.randomUUID?.() || String(Date.now()),
          Date: null, 
          Debut: "09h00", 
          Duree: "1h00",
          Activite: nouveauNom, 
          Lieu: null, 
          Sessions: null,
          Relaches: null, 
          Style: null,
          Reserve: null, 
          Priorite: null, 
          Hyperlien: `https://www.festivaloffavignon.com/resultats-recherche?recherche=${nouveauNom.trim().replace(/\s+/g, '+')}`,
        }
      nouvelleActivite.Fin = recalcFin(nouvelleActivite);
      return nouvelleActivite;
    },

    /**
     * Cherche un nom d'activité non encore alloué dans un DataFrame
     * @param {*} df 
     * @returns 
     */
    getNouveauNomActivite(df, prefix='Activité') {
      if (!Array.isArray(df)) return prefix;
      if (!prefix) prefix = 'Activité';

      // 🔹 Extraire les noms existants
      const nomsExistants = df
        .map(r => (r.Activite ?? '').toString().trim())
        .filter(n => n.length > 0);

      // 🔹 Initialiser ou incrémenter le compteur global
      _compteurNouvelleActivite = 0;

      // 🔹 Boucle de recherche d’un nom libre
      while (true) {
        _compteurNouvelleActivite += 1;
        const nomCandidat = (prefix != 'Activité' && _compteurNouvelleActivite == 1) ? `${prefix}` : `${prefix} ${_compteurNouvelleActivite}`;
        if (!nomsExistants.includes(nomCandidat)) {
          return nomCandidat;
        }
      }
    },


    /**
     * Crée de nouvelles activités en utilisant le clipboard pour initialiser les champs
     * @param {*} df  
     * @returns nouvellesActivites
     */
    // async creerActivitesParCollage(df, parser=null) {
    //   let raw = null;
    //   try { await _getClipBoardText(df, parser=null); } catch { return null; }

    //   if (raw == null) return;

    //   let parsed = null;

    //   if (!parser) {
    //     if (_looksLikeUrl(raw)) { 
    //       if (raw.includes("https://festival-avignon.com/fr/edition-2025/programmation/par-categorie")) {
    //         parsed = await _asyncCallAvecOverlayAttente(parseAvignonInProgPageUrl, raw, 'Echec collage');
    //       } 
    //       else if (raw.includes("https://festival-avignon.com/fr/edition-2025/programmation/")) {
    //         parsed = await _asyncCallAvecOverlayAttente(parseAvignonInSpecPageUrl, raw, 'Echec collage');
    //       } 
    //       else if (raw.includes("https://www.festivaloffavignon.com/programme")) {
    //         parsed = await _asyncCallAvecOverlayAttente(parseAvignonOffProgPageUrl, raw, 'Echec collage');
    //       } 
    //       else if (raw.includes("www.festivaloffavignon.com/spectacles")) {
    //         parsed = await _asyncCallAvecOverlayAttente(parseAvignonOffSpecPageUrl, raw, 'Echec collage');
    //       } 
    //       else {
    //         alert("Il n'existe pas de parser pour cette adresse");
    //       }
    //     } else {
    //       switch (true) {
    //         case isAvignonOffSpecPageText(raw):
    //           parsed = _syncCallAvecOverlayAttente(parseAvignonOffSpecPageText, raw, 'Echec collage');
    //           break;
    //         case isAvignonOffProgPageText(raw):
    //           parsed = _syncCallAvecOverlayAttente(parseAvignonOffProgPageText, raw, 'Echec collage');
    //           break;
    //         case isAvignonInProgPageText(raw):
    //           parsed = _syncCallAvecOverlayAttente(parseAvignonInProgPageText, raw, 'Echec collage');
    //           break;
    //         case isAvignonInSpecPageText(raw):
    //           parsed = _syncCallAvecOverlayAttente(parseAvignonInSpecPageText, raw, 'Echec collage');
    //           break;
    //       }
    //     }
    //     if (!parsed || parsed.length == 0) {
    //       alert("Aucune valeur valide à coller. Commencer par aller dans un catalogues, afficher le programme ou la page d'un spectacle et copier le texte de la page");
    //       return null;
    //     }
    //   } else {
    //     if (parser == 'parseAvignonOffProgPage') {
    //       parsed = parseAvignonOffProgPageText(raw);
    //       if (!parsed || parsed.length == 0) {
    //         alert("Aucune valeur valide à coller. Commencer par aller dans le catalogue du Off, afficher le programme, sélectionner les spectacles désirés et copier le texte de la page");
    //         return null;
    //       }
    //     } else if (parser == 'parseAvignonInProgPage') {
    //       parsed = parseAvignonInProgPageText(raw);
    //       if (!parsed || parsed.length == 0) {
    //         alert("Aucune valeur valide à coller. Commencer par aller dans le catalogue du In, afficher le programme, sélectionner les spectacles désirés et copier le texte de la page");
    //         return null;
    //       }
    //     } 
    //   }

    //   const nouvellesActivites = [];
    //   if (!parsed || parsed.length == 0) parsed = [{...PARSED_DEFAULT}];

    //   for (const row of parsed) {
    //     const nouveauNom = getNouveauNomActivite(df, row.Activite);
    //     const nouvelleActivite = {
    //         __uuid: crypto.randomUUID?.() || String(Date.now()),
    //         Date: null, 
    //         Debut: row.Debut || null, 
    //         Duree: row.Duree || null,
    //         Activite: nouveauNom, 
    //         Lieu: row.Lieu || null, 
    //         Sessions: row.Sessions || null,
    //         Relaches: row.Relaches || null, 
    //         Style: row.Style || null,
    //         Orga: row.Orga || null,
    //         Reserve: null, 
    //         Priorite: null, 
    //         Hyperlien: row.Hyperlien || `https://www.festivaloffavignon.com/resultats-recherche?recherche=${nouveauNom.trim().replace(/\s+/g, '+')}`,
    //       }
    //       nouvellesActivites.push(nouvelleActivite);
    //   }
    //   recalcFinForAll(nouvellesActivites);
    //   return nouvellesActivites;
    // },

    /** 
     * Indique si une valeur est valide pour le champ Debut d'une activité
     * "10h00" (1–2 chiffres pour l’heure, 2 chiffres pour les minutes) 
     */
    estHeureValide(val) {
      if (val == null) return false;
      const s = String(val).trim();
      return /^\d{1,2}h\d{2}$/.test(s);
    },

    /** 
     * Indique si une valeur est valide pour le champ Duree d'une activité
     * "1h00" (minutes 00–59) 
     */
    estDureeValide(val) {
      if (val == null) return false;
      const s = String(val).trim();
      return /^\d{1,2}h[0-5]\d$/.test(s);
    },

    /**
     * Indique si une valeur est valide pour le champ Sessions d'une activité
     * - vide => true
     * - sinon, tous les tokens (séparés par virgules au niveau 0) doivent être valides
     * ───────────────────────────────────────────────────────────
     * Format(s) acceptés, séparés par des virgules :
     *  - "9", "09" (mois courant et année courante implicites), 
     *  - "9/7", "09/07" (année courante implicite) , 
     *  - "09/07/25" ou "09/07/2025"
     *  - "(9, 16, 23)/7" pour énumérer des dates du même mois
     *  - "[9-12]/07", [30/07-01/08] pour une période
     *  - "jours pairs" | "jours impairs"
     *  - chaîne vide => tous les jours de la période programmation
     * On valide que *tous* les tokens sont valides.
     * ───────────────────────────────────────────────────────────
     */
    estSessionsValide(val, { default_year = null, default_month = null } = {}) {
      const s = String(val ?? '').trim();
      if (s === '') return true;               // vide = OK (pas de relâche)
      
      const tokens = _tokenizeSpecs(s);
      if (!tokens.length) return false;

      const now = new Date();
      const defaultYear = now.getFullYear();
      const defaultMonth = now.getMonth() + 1;

      // Tous les tokens doivent être valides
      return tokens.every(tok => _parseOneToken(tok, { defaultMonth, defaultYear }));
    },

    /**
     * Indique si une valeur est valide pour le champ Relaches d'une activité
     * - vide => true
     * - sinon, tous les tokens (séparés par virgules au niveau 0) doivent être valides
     * ───────────────────────────────────────────────────────────
     * Format(s) acceptés, séparés par des virgules :
     *  - "9", "09" (mois courant et année courante implicites), 
     *  - "9/7", "09/07" (année courante implicite) , 
     *  - "09/07/25" ou "09/07/2025"
     *  - "(9, 16, 23)/7" pour énumérer des dates du même mois
     *  - "[9-12]/07", [30/07-01/08] pour une période
     *  - "jours pairs" | "jours impairs"
     *  - chaîne vide => pas de jours de relâche
     * On valide que *tous* les tokens sont valides.
     * ───────────────────────────────────────────────────────────
     */
    estRelachesValide(val) {
      const s = String(val ?? '').trim();
      if (s === '') return true;               // vide = OK (pas de relâche)
      
      const tokens = _tokenizeSpecs(s);
      if (!tokens.length) return false;

      const now = new Date();
      const defaultYear = now.getFullYear();
      const defaultMonth = now.getMonth() + 1;

      // Tous les tokens doivent être valides
      return tokens.every(tok => _parseOneToken(tok, { defaultMonth, defaultYear }));
    },

    /**
     * Indique si une valeur est valide pour le champ Reserve d'une activité
     * @param {*} val 
     * @returns 
     */
    estReserveValide(val) {
      const s = String(val ?? '').trim().toLowerCase();
      return s === '' || s === 'oui' || s === 'non';
    },

  };
}

/**
 * Tri par Date (YYYYMMDD) puis Début ("HHhMM") d'un tableau d'activités.
 * - Les lignes SANS Date vont à la fin, triées entre elles par Début.
 * - Ne modifie PAS le tableau d'origine.
 *
 * @param {Array<Object>} df
 * @param {Object} [opts]
 * @param {boolean} [opts.desc=false] - sens du tri pour les lignes AVEC date
 * @param {string}  [opts.dateKey='Date']
 * @param {string}  [opts.timeKey='Début']  // <-- accent
 * @returns {Array<Object>}
 */
export function sortDf(df, opts = {}) {
  const {
    desc = false,
    dateKey = 'Date',
    timeKey = 'Debut',
  } = opts;

  const dir = desc ? -1 : 1;

  const parseDateInt = (d) => {
    if (d == null || d === '') return null;
    const n = Number(d);
    return Number.isFinite(n) ? n : null; // attend YYYYMMDD
  };

  const parseTimeHhMM = (t) => {
    if (t == null || t === '') return null;
    const m = String(t).trim().match(/^(\d{1,2})h(\d{2})$/i);
    if (!m) return null;
    const hh = Number(m[1]), mm = Number(m[2]);
    if (!Number.isFinite(hh) || !Number.isFinite(mm) || hh >= 24 || mm >= 60) return null;
    return hh * 60 + mm; // minutes depuis 00:00
  };

  const indexed = df.map((r, i) => ({
    r,
    i,
    d: parseDateInt(r[dateKey]),
    m: parseTimeHhMM(r[timeKey]),
  }));

  indexed.sort((A, B) => {
    const aNoDate = A.d == null;
    const bNoDate = B.d == null;

    // 0) Sans date : toujours APRES ceux avec date
    if (aNoDate && !bNoDate) return 1;
    if (!aNoDate && bNoDate) return -1;

    if (!aNoDate && !bNoDate) {
      // 1) Les deux ont une date -> comparer Date
      if (A.d !== B.d) return (A.d - B.d) * dir;

      // 2) Puis l'heure (nulls après)
      const aNull = A.m == null, bNull = B.m == null;
      if (aNull && bNull) return A.i - B.i;   // stabilité
      if (aNull) return 1;
      if (bNull) return -1;
      return (A.m - B.m) * dir;
    }

    // 3) Les deux sont sans date -> trier par Début (nulls après)
    const aNull = A.m == null, bNull = B.m == null;
    if (aNull && bNull) return A.i - B.i;
    if (aNull) return 1;
    if (bNull) return -1;
    return A.m - B.m;
  });

  return indexed.map(x => x.r);
}


/**
 * Indique si une activité est réservée
 * @param {*} row 
 * @returns 
 */
function _estActiviteReservee(row) {
  return String(row?.Reserve ?? '')
    .trim()
    .toLowerCase() === 'oui';
};

/**
 * Renvoie true s'il existe AU MOINS une activité programmable
 * (i.e. non en relâche) pour la journée `dateRef` (AAAAMMJJ).
 *
 * @param {Array<object>} activitesNonProgrammees - liste des activités non programmées
 * @param {number} dateRef - entier AAAAMMJJ
 * @param {boolean} [traiter_pauses=false] - si true, on considère qu'il y a toujours des activités programmables
 * @returns {boolean}
 */
function _existActivitesProgrammables(activitesNonProgrammees, dateRef, traiter_pauses = false) {
  if (traiter_pauses) return true;
  if (!Array.isArray(activitesNonProgrammees) || activitesNonProgrammees.length === 0) return false;

  return activitesNonProgrammees.some(r => {
    return _estDateProgrammable(r.Sessions, r.Relaches, dateRef);
  });
}


/**
 * Renvoie la liste des activités programmées à partir d'un tableau d'activités :
 * celles qui ont une Date valide, et des champs Début, Durée, Activité non vides.
 * On suppose qu'il s'agit bien d'un tableau d'activités contenant les champs nécessaires 
 * et trié selon Date et Début.
 *
 * @param {Array<object>} df  - tableau d’activités (équivalent d'un DataFrame)
 * @returns {Array<object>}   - activités programmées triées
 */
function _getActivitesProgrammees(df) {
  if (!Array.isArray(df)) return [];

  const estFloatValide = v => {
    const n = parseFloat(v);
    return Number.isFinite(n) && n > 0;
  };

  const isNotNull = v => v !== null && v !== undefined && v !== '';

  const filtered = df.filter(r =>
    estFloatValide(r.Date) &&
    isNotNull(r.Debut) &&
    isNotNull(r.Duree) &&
    isNotNull(r.Activite)
  );

  return filtered;
}

/**
 * Renvoie la liste des activités non programmées à partir d'un tableau d'activités :
 * celles sans Date, mais avec Debut, Duree et Activite définies.
 * On suppose qu'il s'agit bien d'un tableau d'activités contenant les champs nécessaires 
 * et trié selon Date et Début.
 * @param {Array<Object>} df - tableau d'activités
 * @returns {Array<Object>} nouveau tableau trié
 */
function _getActivitesNonProgrammees(df = []) {
  if (!Array.isArray(df)) return [];

  // const filtered = df.filter(r =>
  //     (r.Date == null || r.Date === '') &&   // Date manquante
  //     r.Debut != null && r.Duree != null && r.Activite != null &&
  //     r.Debut !== '' && r.Duree !== '' && r.Activite !== ''
  //   )
  const filtered = df.filter(r =>
      (r.Date == null || r.Date === '') &&   // Date manquante
      r.Activite != null &&
      r.Activite !== ''
    )

  return filtered;
}

/**
 * Renvoie le tableau des dates (colonne Date) d'un tableau d'acticités
 * @param {*} rows 
 * @returns 
 */
function _getDatesFromRows(rows) {
  const out = [];
  for (const r of (rows || [])) {
    const di = Number(r?.Date);
    if (Number.isFinite(di) && di >= 10000101) out.push(di);
  }
  return out;
}

// Considère qu’une ligne "non programmée" n’a pas de Date exploitable
function _estActiviteNonProgrammee(row) {
  const d = row?.Date;
  return d == null || d === '' || Number.isNaN(+d);
}

// Renvoie les dates du Festival: fetch best-effort + cache
// NB: CORS probablement bloqué -> fallback manuel activé automatiquement
async function _getDatesFestival(state = window.appState) {
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


/**
 * Liste des activités non programmées (df) posables AVANT la ligne de ref.
 * - df : toutes les activités (programmées + non) — on parcourt uniquement celles sans Date
 * - activitesProgrammees : uniquement les programmées
 * - ligneRef : activité de référence
 * - traiter_pauses : ignoré ici
 */
function _getActivitesProgrammablesAvant(df, activitesProgrammees, ligneRef, traiter_pauses = true) {
  const proposables = [];
  const [debut_min, fin_max] = _getCreneauBoundsAvant(activitesProgrammees, ligneRef);
  if (!(debut_min < fin_max)) return proposables;

  for (let idx = 0; idx < (df?.length || 0); idx++) {
    const row = df[idx];
    if (!_estActiviteNonProgrammee(row)) continue;

    const d = debutMinute(row), du = dureeMinute(row);
    if (!Number.isFinite(d) || !Number.isFinite(du)) continue;
    const h_debut = d, h_fin = d + du;

    if (h_debut >= (debut_min + _MARGE) && h_fin <= (fin_max - _MARGE) && _estDateProgrammable(row.Sessions, row.Relaches, ligneRef.Date)) {
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
function _getActivitesProgrammablesApres(df, activitesProgrammees, ligneRef, traiter_pauses = true) {
  const proposables = [];

  const dRef = Number.isFinite(debutMinute(ligneRef)) ? debutMinute(ligneRef) : MIN_DAY;
  const duRef = Number.isFinite(dureeMinute(ligneRef)) ? dureeMinute(ligneRef) : 0;
  const finRef = dRef + duRef;
  if (finRef > MAX_DAY) return proposables; // changement de jour -> pas d'après

  const [debut_min, fin_max] = _getCreneauBoundsApres(activitesProgrammees, ligneRef);
  if (fin_max != null && !(debut_min < fin_max)) return proposables;

  for (let idx = 0; idx < (df?.length || 0); idx++) {
    const row = df[idx];
    if (!_estActiviteNonProgrammee(row)) continue;

    const d = debutMinute(row), du = dureeMinute(row);
    if (!Number.isFinite(d) || !Number.isFinite(du)) continue;
    const h_debut = d, h_fin = d + du;

    const borneHaute = (fin_max == null) ? MAX_DAY : (fin_max - _MARGE);
    if (h_debut >= (debut_min + _MARGE) && h_fin <= borneHaute && _estDateProgrammable(row.Sessions, row.Relaches, ligneRef.Date)) {
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
function _getCreneauBoundsAvant(activitesProgrammees, ligneRef) {
  const dateRef  = ligneRef.Date;
  const debutRef = Number.isFinite(debutMinute(ligneRef)) ? debutMinute(ligneRef) : MIN_DAY;

  const sameDay = (activitesProgrammees || [])
    .filter(r => r.Date === dateRef)
    .sort((a,b) => (debutMinute(a) ?? 0) - (debutMinute(b) ?? 0));

  let prev = null;
  for (const r of sameDay) {
    const d = debutMinute(r);
    if (Number.isFinite(d) && d < debutRef) prev = r;
    else if ((d ?? 0) >= debutRef) break;
  }

  const prevFin = prev ? (debutMinute(prev) + (dureeMinute(prev) || 0)) : MIN_DAY;
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
function _getCreneauBoundsApres(activitesProgrammees, ligneRef) {
  const dateRef  = ligneRef.Date;
  const dRef = Number.isFinite(debutMinute(ligneRef)) ? debutMinute(ligneRef) : MIN_DAY;
  const duRef = Number.isFinite(dureeMinute(ligneRef)) ? dureeMinute(ligneRef) : 0;
  const finRef = dRef + duRef;

  if (finRef > MAX_DAY) return [finRef, null, null]; // déborde jour suivant -> pas d'"après"

  const sameDay = (activitesProgrammees || [])
    .filter(r => r.Date === dateRef)
    .sort((a,b) => (debutMinute(a) ?? 0) - (debutMinute(b) ?? 0));

  let next = null;
  for (const r of sameDay) {
    const rDeb = debutMinute(r) || 0;
    const rFin = rDeb + (dureeMinute(r) || 0);
    if (rFin > finRef) { next = r; break; }
  }

  const fin_max   = next ? debutMinute(next) : null;
  const debut_min = finRef;

  return [debut_min, fin_max, next];
}

// Création d’un objet créneau
function _creerCreneau(row, borneMin, borneMax, avant, apres, typeCreneau) {
  const dateStr = (row.Date != null) ? String(row.Date) : "";
  const start   = Math.max(MIN_DAY, Math.min(borneMin ?? MIN_DAY, MAX_DAY));
  const endRaw  = (borneMax == null ? MAX_DAY : borneMax);
  const end     = Math.max(MIN_DAY, Math.min(endRaw, MAX_DAY));
  return {
    Date: dateStr,                         // string pour éviter l’icône filtre numérique
    Début: mmToHHhMM(start),
    Fin:   mmToHHhMM(end),
    'Activité avant': avant || '',
    'Activité après': apres || '',
    __type_creneau: typeCreneau,           // "Avant" | "Après" | "Journée"
    __srcUuid: row.__uuid,
    __uuid: crypto.randomUUID(),
  };
}

function _estCreneauValide(creneau) {
  if (!creneau || typeof creneau !== 'object') return false;
  const t = creneau.__type_creneau;
  return t === 'Avant' || t === 'Après' || t === 'Journée';
}

/**
 * Détermine si une date est programmable, ie. est dans Sessions et pas dans Relaches.
 * 
 * @param {string|null} relachesVal - Description des relâches (ex: "[5-26]", "(8,25)/07", "jours pairs", etc.)
 * @param {number|null} dateVal - Date sous forme d'entier AAAAMMJJ (ex: 20250721)
 * @param {Date} [today] - Date de référence pour l'année/mois par défaut
 * @returns {boolean} - true = jour jouable / false = relâche
 */
function _estDateProgrammable(sessionsVal, relachesVal, dateVal, today = new Date()) {
  if (dateVal == null) return true;

  const dv = Number(dateVal);
  if (!Number.isFinite(dv)) return true;

  const dy = Math.floor(dv / 10000);
  const dm = Math.floor((dv / 100) % 100);
  const dd = dv % 100;
  const defY = today.getFullYear();
  const defM = today.getMonth() + 1;

  const y2k = y => (Number.isFinite(y) && y < 100 ? (y < 50 ? 2000 + y : 1900 + y) : y);
  const mkDateInt = (y, m, d) => (y * 10000 + m * 100 + d);
  const parseDayMaybeDmY = (s, yy, mm) => {
    const parts = s.split("/").map(x => x.trim());
    let d, m = mm, y = yy;
    if (parts.length === 3) [d, m, y] = parts.map(n => Number(n));
    else if (parts.length === 2) [d, m] = parts.map(n => Number(n));
    else if (parts.length === 1) d = Number(parts[0]);
    y = y2k(y);
    return [y, m, d];
  };

  const sessionsTxt = String(sessionsVal || '').trim().toLowerCase();
  const relachesTxt  = String(relachesVal  || '').trim().toLowerCase();

  const openIntervals = [];
  const regroupSessionsDays = [];
  const closedIntervals = [];
  const regroupRelacheDays = [];

  // --- Fenêtres de représentation [A–B]  
  for (const m of sessionsTxt.matchAll(/\[\s*([0-9/]+)\s*[-–]\s*([0-9/]+)\s*\]\s*(?:\/(\d{1,2})(?:\/(\d{2,4}))?)?/g)) {
    const [_, aTxt, bTxt, mmTxt, yyTxt] = m;
    const mmDef = mmTxt ? Number(mmTxt) : defM;
    const yyDef = yyTxt ? y2k(Number(yyTxt)) : defY;
    const [Ay, Am, Ad] = parseDayMaybeDmY(aTxt, yyDef, mmDef);
    const [By, Bm, Bd] = parseDayMaybeDmY(bTxt, yyDef, mmDef);
    const aDi = mkDateInt(Ay, Am, Ad);
    const bDi = mkDateInt(By, Bm, Bd);
    if (Number.isFinite(aDi) && Number.isFinite(bDi)) {
      openIntervals.push(aDi <= bDi ? [aDi, bDi] : [bDi, aDi]);
    }
  }

  // --- Jours de représentation (a,b,c)
  for (const m of sessionsTxt.matchAll(/\(\s*([\d\s,]+)\s*\)\s*(?:\/(\d{1,2})(?:\/(\d{2,4}))?)?/g)) {
    const [_, joursTxt, mmTxt, yyTxt] = m;
    const mmDef = mmTxt ? Number(mmTxt) : defM;
    const yyDef = yyTxt ? y2k(Number(yyTxt)) : defY;
    const jours = joursTxt.split(",").map(x => Number(x.trim())).filter(n => Number.isFinite(n));
    for (const jd of jours) regroupSessionsDays.push(mkDateInt(yyDef, mmDef, jd));
  }

  // --- Jours isolés de représentation
  for (const part of sessionsTxt.split(",").map(p => p.trim())) {
    if (!part || /jour/.test(part)) continue;
    if (/^\[.*\]$|^<.*>$|^\(.*\)$/.test(part)) continue;
    const mday = part.match(/^(\d{1,2})(?:\/(\d{1,2})(?:\/(\d{2,4}))?)?$/);
    if (!mday) continue;
    const d = Number(mday[1]);
    const mm = mday[2] ? Number(mday[2]) : defM;
    const yy = mday[3] ? y2k(Number(mday[3])) : defY;
    if (Number.isFinite(d) && Number.isFinite(mm) && Number.isFinite(yy)) {
      regroupSessionsDays.push(mkDateInt(yy, mm, d));
    }
  }

  // --- Parité représentations
  let pariteSessions = null;
  if (/\bjours?\s+pairs?\b/.test(sessionsTxt))  pariteSessions = "pair";
  if (/\bjours?\s+impairs?\b/.test(sessionsTxt)) pariteSessions = "impair";

  // --- Fenêtres de relâche [A–B]
  for (const m of relachesTxt.matchAll(/\[\s*([0-9/]+)\s*[-–]\s*([0-9/]+)\s*\]\s*(?:\/(\d{1,2})(?:\/(\d{2,4}))?)?/g)) {
    const [_, aTxt, bTxt, mmTxt, yyTxt] = m;
    const mmDef = mmTxt ? Number(mmTxt) : defM;
    const yyDef = yyTxt ? y2k(Number(yyTxt)) : defY;
    const [Ay, Am, Ad] = parseDayMaybeDmY(aTxt, yyDef, mmDef);
    const [By, Bm, Bd] = parseDayMaybeDmY(bTxt, yyDef, mmDef);
    const aDi = mkDateInt(Ay, Am, Ad);
    const bDi = mkDateInt(By, Bm, Bd);
    if (Number.isFinite(aDi) && Number.isFinite(bDi)) {
      closedIntervals.push(aDi <= bDi ? [aDi, bDi] : [bDi, aDi]);
    }
  }

  // --- Jours de relâche (a,b,c)
  for (const m of relachesTxt.matchAll(/\(\s*([\d\s,]+)\s*\)\s*(?:\/(\d{1,2})(?:\/(\d{2,4}))?)?/g)) {
    const [_, joursTxt, mmTxt, yyTxt] = m;
    const mmDef = mmTxt ? Number(mmTxt) : defM;
    const yyDef = yyTxt ? y2k(Number(yyTxt)) : defY;
    const jours = joursTxt.split(",").map(x => Number(x.trim())).filter(n => Number.isFinite(n));
    for (const jd of jours) regroupRelacheDays.push(mkDateInt(yyDef, mmDef, jd));
  }

  // --- Jours isolés de relâche
  for (const part of relachesTxt.split(",").map(p => p.trim())) {
    if (!part || /jour/.test(part)) continue;
    if (/^\[.*\]$|^<.*>$|^\(.*\)$/.test(part)) continue;
    const mday = part.match(/^(\d{1,2})(?:\/(\d{1,2})(?:\/(\d{2,4}))?)?$/);
    if (!mday) continue;
    const d = Number(mday[1]);
    const mm = mday[2] ? Number(mday[2]) : defM;
    const yy = mday[3] ? y2k(Number(mday[3])) : defY;
    if (Number.isFinite(d) && Number.isFinite(mm) && Number.isFinite(yy)) {
      regroupRelacheDays.push(mkDateInt(yy, mm, d));
    }
  }

  // --- Parité relâches
  let pariteRelaches = null;
  if (/\bjours?\s+pairs?\b/.test(relachesTxt))  pariteRelaches = "pair";
  if (/\bjours?\s+impairs?\b/.test(relachesTxt)) pariteRelaches = "impair";

  // ===== Étape 1 : exclusions (relâches), si présentes
  for (const [lo, hi] of closedIntervals) {
    if (lo <= dv && dv <= hi) return false;
  }
  if (regroupRelacheDays.length && regroupRelacheDays.includes(dv)) return false;
  if (pariteRelaches) {
    const isEven = dd % 2 === 0;
    if ((pariteRelaches === "pair" && isEven) || (pariteRelaches === "impair" && !isEven)) return false;
  }

  // ===== Étape 2 : inclusions (sessions)
  for (const [lo, hi] of openIntervals) {
    if (lo <= dv && dv <= hi) return true;
  }
  if (regroupSessionsDays.length && regroupSessionsDays.includes(dv)) return true;
  if (pariteSessions) {
    const isEven = dd % 2 === 0;
    if ((pariteSessions === "pair" && isEven) || (pariteSessions === "impair" && !isEven)) return true;
  }

  // ===== Étape 3 : défaut
  // S'il y a AU MOINS une contrainte de sessions et aucune ne matche -> false (non programmable)
  if (openIntervals.length || regroupSessionsDays.length || pariteSessions) return false;
  // Sinon, aucune contrainte de sessions -> true (programmable par défaut)
  return true;
}

// Renvoie la 1ère activité programmée du jour (par heure)
function _premiereActiviteProgrammeeDuJour(jour) {
  const L = _getActivitesProgrammees(_ctx.df).filter(r => r.Date === jour)
                  .map(r => ({...r, _min: mmFromHHhMM(r['Debut']), _dur: mmFromHHhMM(r['Duree'])||0}))
                  .filter(r => r._min!=null)
                  .sort((a,b)=>a._min - b._min);
  return L[0] || null;
}

// Renvoie la liste (triée) des activités programmées du jour
function _ActivitesProgrammeesDuJourTriees(jour){
  return _getActivitesProgrammees(_ctx.df).filter(r => r.Date === jour)
               .map(r => ({...r, _min: mmFromHHhMM(r['Debut']), _dur: mmFromHHhMM(r['Duree'])||0}))
               .filter(r => r._min!=null)
               .sort((a,b)=>a._min - b._min);
}

// Calcule les jours possibles pour poser une activité
function _getJoursPossibles(rowActivite) {
  const jours = [];
  const debutMinute = mmFromHHhMM(rowActivite['Debut']);
  const duree    = mmFromHHhMM(rowActivite['Duree']);
  if (debutMinute == null || !duree) return jours;
  const finAct   = debutMinute + duree;

  for (let jour = dateToDateint(_ctx.getMetaParam("periode_a_programmer_debut")); jour <= dateToDateint(_ctx.getMetaParam("periode_a_programmer_fin")); jour++) {
    if (!_estDateProgrammable(rowActivite.Sessions, rowActivite.Relaches, jour)) continue;

    const jList = _ActivitesProgrammeesDuJourTriees(jour);
    if (jList.length === 0) { // journée libre
      jours.push(jour);
      continue;
    }

    // 1) créneau 00:00 → première activité
    const first = jList[0];
    const borne_inf = 0;           // 00:00
    const borne_sup = first._min;  // début de la 1ère activité
    if (debutMinute >= borne_inf && finAct <= (borne_sup - _MARGE)) {
      jours.push(jour);
      continue;
    }

    // 2) créneaux entre activités programmées
    let ok = false;
    for (const ref of jList) {
      const [debut_min, fin_max ] = _getCreneauBoundsApres(jList, ref);
      const afterMin = debut_min + _MARGE;
      const beforeMax = (fin_max == null) ? null : (fin_max - _MARGE);
      const fits = (debutMinute >= afterMin) && (beforeMax == null ? true : finAct <= beforeMax);
      if (fits) { ok = true; break; }
    }
    if (ok) jours.push(jour);
  }
  return jours; // tableau de dateint
}

function _toPrettyArray(arrInt){
  return (arrInt||[]).slice().sort((a,b)=>a-b).map(di => dateintToPretty(di));
}

/**
 * Renvoie les activités programmables sur une journée entière donc les activités qui ne sont pas relaches ce jour
 * @param {*} dateRef 
 * @param {*} traiterPauses 
 * @returns 
 */
function _getActivitesProgrammablesSurJourneeEntiere(dateRef, traiterPauses = true) {
  const proposables = [];
  const nonProgrammees = _ctx?.df?.filter(r => !r.Date) || [];  // équiv. activites_non_programmees

  for (const row of nonProgrammees) {
    if (_estDateProgrammable(row.Sessions, row.Relaches, dateRef)) {
      const nouvelleLigne = { ...row };
      delete nouvelleLigne.Debut_dt;
      delete nouvelleLigne.Duree_dt;
      nouvelleLigne.__type_activite = 'ActiviteExistante';
      nouvelleLigne.__index = row.__uuid;
      proposables.push(nouvelleLigne);
    }
  }

  if (traiterPauses) {
    const DUREE_REPAS = _ctx?.meta?.DUREE_REPAS ?? 3600000; // 1h par défaut (ms)
    const BASE_DATE = new Date(2000, 0, 1);

    // --- fonction d'aide pour formater une durée en "1h30" ---
    const dureeStr = (ms) => {
      const totalMin = Math.round(ms / 60000);
      const h = Math.floor(totalMin / 60);
      const m = totalMin % 60;
      return m ? `${h}h${m}` : `${h}h00`;
    };

    const completerLigne = (ligne) => ({
      ...ligne,
      Date: dateRef,
      Reserve: '',
      Relaches: '',
      Priorite: '',
      Lieu: '',
    });

    const mkPause = (heure, typeRepas) => {
      const h = new Date(BASE_DATE);
      h.setHours(heure, 0, 0, 0);
      const fin = new Date(h.getTime() + DUREE_REPAS);
      return completerLigne({
        Debut: `${heure}h00`,
        Fin: `${fin.getHours()}h${String(fin.getMinutes()).padStart(2, '0')}`,
        Duree: dureeStr(DUREE_REPAS),
        Activite: `Pause ${typeRepas}`,
        __type_activite: typeRepas,
        __uuid: crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`
      });
    };

    proposables.push(mkPause(12, 'déjeuner'));
    proposables.push(mkPause(20, 'dîner'));
  }

  return proposables;
}

// async function _getClipBoardText() {
//   try {
//     const txt = await navigator.clipboard.readText();
//     // console.log('Texte du presse-papier :', txt);
//     return txt;
//   } catch (err) {
//     console.warn('Impossible de lire le presse-papier :', err);
//     // alert("⚠️ Pour coller, autorisez l’accès au presse-papier ou collez manuellement.");
//     return null;
//   }
// }

// Split top-level par virgules (ignore celles dans les parenthèses)
function _tokenizeSpecs(s) {
  const out = [];
  let cur = '', depth = 0;
  for (const ch of String(s || '')) {
    if (ch === '(') depth++;
    if (ch === ')') depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; }
    else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function _isIntInRange(x, min, max) {
  const n = Number(x);
  return Number.isInteger(n) && n >= min && n <= max;
}

/**
 * @param {string} tok
 * @param {{ defaultMonth?: number, defaultYear?: number }} [opts]
 */
function _parseOneToken(tok, { defaultMonth, defaultYear } = {}) {
  const t = String(tok || '').toLowerCase().trim();
  if (!t) return false;

  // 1) Parité
  if (/^jours?\s+(pairs?|impairs?)$/.test(t)) return true;

  // 2) Jour isolé: "23" ou "23/7"
  {
    const m = t.match(/^(\d{1,2})(?:\/(0?[1-9]|1[0-2]))?$/);
    if (m) {
      const [, d, mm] = m;
      const M = mm ? Number(mm) : (defaultMonth ?? null);
      return _isIntInRange(d, 1, 31) && (M == null || _isIntInRange(M, 1, 12));
    }
  }

  // 3) Liste: "(9,16,23)" ou "(9,16,23)/7"
  {
    const m = t.match(/^\(\s*([0-9,\s]+)\s*\)(?:\/(0?[1-9]|1[0-2]))?$/);
    if (m) {
      const [, list, mm] = m;
      const M = mm ? Number(mm) : (defaultMonth ?? null);
      const days = list.split(',').map(s => s.trim()).filter(Boolean);
      if (!days.length) return false;
      if (M != null && !_isIntInRange(M, 1, 12)) return false;
      return days.every(d => _isIntInRange(d, 1, 31));
    }
  }

  // 4) Intervalle: "[5-26]", "[5-26]/7"
  {
    const m = t.match(/^\[\s*(\d{1,2})\s*-\s*(\d{1,2})\s*\](?:\/(0?[1-9]|1[0-2]))?$/);    
    if (m) {
      const [, d1, d2, mm] = m;
      const M = mm ? Number(mm) : (defaultMonth ?? null);
      const okDays = _isIntInRange(d1, 1, 31) && _isIntInRange(d2, 1, 31) && Number(d1) <= Number(d2);
      const okMonth = (M == null) || _isIntInRange(M, 1, 12);
      return okDays && okMonth;
    }
  }

  return false;
}

