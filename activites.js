// ===============================
// Utilitaires activités
// ===============================

import {
  MIN_DAY, 
  MAX_DAY, 
  dateintToDate, 
  dateintToPretty,
  dateToDateint,
  dateToInt,
  mmToHHhMM, 
  mmFromHHhMM,
  heureMinute, 
  dureeMinute, 
  prettyToDateint,
  recalcFin,
} from './utils-date.js';

import {
  genUUID,
  richValueGetValue,
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
      return _getPeriodeProgrammation();
    },

    /**
     * Renvoie les créneaux disponibles en fonction d'un tableau d'activités
     * @param {Array<object>} df                    - tableau des activités (programmées + non programmées)
     * @param {Array<object>} activitesProgrammees  - tableau des activités programmées (triées par Date)
     * @param {boolean} traiter_pauses              - ignoré pour l’instant
     * @param {{periodeDebut?:number, periodeFin?:number}} opts
     * @returns {Array<object>}  liste de créneaux pour la grille
     */
    getCreneaux(df, activitesProgrammees, traiter_pauses = false, opts = {}) {
      if (!df) return [];
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

      const apNonChevauchables = activitesProgrammees.filter( a => !_estActiviteChevauchable(a));

      if ((apNonChevauchables?.length || 0) > 0) {
        // let jourCourant = activitesProgrammees[0].Date;

        for (let i = 0; i < apNonChevauchables.length; i++) {
          const row = apNonChevauchables[i];
          const d = heureMinute(row), du = dureeMinute(row);
          const heureDebut = Number.isFinite(d) ? d : null;
          const heureFin   = (Number.isFinite(d) && Number.isFinite(du)) ? d + du : null;

          // ---- Créneau AVANT ----
          if (heureDebut != null) {
            if (_getActivitesProgrammablesAvant(df, apNonChevauchables, row, traiter_pauses).length > 0) {
              const [bMin, bMax, prev] = _getCreneauBoundsAvant(apNonChevauchables, row);
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
            if (_getActivitesProgrammablesApres(df, apNonChevauchables, row, traiter_pauses).length > 0) {
              const [bMin, bMax, next] = _getCreneauBoundsApres(apNonChevauchables, row);
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
     * Renvoie la liste des plages libres entre activités d'un tableaau d'activités.
     * Contrairement à getCreneaux on ne vérifie pas s'il existe des activités programmables 
     * dans chacune des plages libres trouvées.
     * @param {*} activites 
     */
    getPlagesLibres(activites) {
      return _getPlagesLibres(activites);
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
          // console.warn("Erreur getActivitesProgrammables :", err);
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
     * Renvoie les jours de programmation possibles pour une activité donnée 
     * (i.e. les jours pour lesquels l’activité est programmable).
     * @param {*} row 
     * @returns 
     */
    getJoursPossibles(row) {
      return _getJoursPossibles(row);
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
     * Renvoie true si la row en paramètre est une activité programmée.
     * i.e. Date valide, et des champs Début, Durée, Activité non vides.
     *
     * @param {object} r    - row activité
     * @returns {boolean}   - true / false
     */
    estActiviteProgrammee(r) {
      return _estActiviteProgrammee(r);
    },

    /**
     * Renvoie true si la row en paramètre est une activité non programmée.
     * i.e. sans Date, mais avec Debut, Duree et Activite définies.
     *
     * @param {object} r    - row activité
     * @returns {boolean}   - true / false
     */
    estActiviteNonProgrammee(r) {
      return _estActiviteNonProgrammee(r);
    },

    /**
     * Indique si l'activité passée en paramètre est programmable sur la période de programmation
     * (i.e. s'il existe des jours pour lesquels elle peut être programmée).
     */
    estActiviteProgrammable(activite) {
        const jp = _getJoursPossibles(activite);
        return (Array.isArray(jp) && jp.length > 0);
    },

    /**
     * Renvoie true si une activité est programmable à une date donnée 
     * (i.e. non en relâche et dans la période de validité et compatible 
     * avec les activités déjà programmées).
     *
     * @param {object} activite - activité
     * @param {number} dateRef - date au format dateint (AAAAMMJJ)
     * @param {Array<Object>} activitesProgrammees - tableau des activités programmées (optionnel)
     * @returns {boolean}
     */
    // @ts-ignore
    estActiviteProgrammableADate(activite, dateRef, {activitesProgrammees=null, marge=null}={}) {
      if (!_estActiviteValideADate(activite, dateRef)) return false;

      if (!marge) {
        const meta = (_ctx.meta) || {};
        marge = Math.max(0, Number(meta.MARGE ?? 30) | 0); // minutes
      }

      if(!activitesProgrammees) activitesProgrammees = _getActivitesProgrammees(_ctx.df);
      const activitesProgrammeesDuJour = activitesProgrammees.filter(r => r.Date === dateRef);

      if (!activitesProgrammeesDuJour || activitesProgrammeesDuJour.length <=0) return true;

      const plagesLibres = _getPlagesLibres(activitesProgrammeesDuJour);

      for (const pl of plagesLibres) {
        const plDeb = mmFromHHhMM(pl.Début);
        const plFin = mmFromHHhMM(pl.Fin);
        
        if (
          ((plDeb  <= mmFromHHhMM(activite.Debut) - marge) || plDeb == 0) && 
          ((mmFromHHhMM(activite.Debut) + mmFromHHhMM(activite.Duree) + marge <= plFin) || plFin == mmFromHHhMM('23h59'))
        ) return true;
      }

      return false;
    },

    /**
     * Renvoie true si une activité est valide à une date donnée 
     * (i.e. non en relâche et dans la période de validité).
     * Cela ne vérifie pas la compatibilité avec les activités déjà programmées.
     *
     * @param {object} activite - activité
     * @param {number} dateRef - date au format dateint (AAAAMMJJ)
     * @returns {boolean}
     */
    estActiviteValideADate(activite, dateRef) {
      return _estActiviteValideADate(activite, dateRef);
    },

    /**
     * Détermine si une date est valide, ie. est dans Session et pas dans Relache.
     * @param {number|null} dateVal - Date sous forme d'entier AAAAMMJJ (ex: 20250721)
     * @param {string|null} sessionVal - Description des dates de session (ex: "[5-26], [5-26] lu ma", "(8,25)/07", "jours pairs", etc.)
     * @param {string|null} relacheVal - Description des dates de relâche (grammaire identique à celle des sessions)
     * @returns {boolean} - true = jour jouable / false = relâche
     */
    estDateValide(dateVal, sessionVal, relacheVal) {
      return _estDateValide(dateVal, sessionVal, relacheVal);
    },

    /**
     * Détermine si une date in intervalle de dates ou une suite de dates sont valides, ie. dans Session et pas dans Relache.
     * @param {*} dates 
     * @param {*} sessionVal 
     * @param {*} relacheVal 
     * @returns 
     */
    datesMatchesSessionRelache(dates, sessionVal, relacheVal) {
      // 1) intervalle [d1-d2]
      const range = _getMinMaxFromPrettyRange(dates);
      if (range) {
        const [d1, d2] = range;
        const dates = _expandRangeToDateintList(d1, d2);
        return dates.some(dateVal => _estDateValide(dateVal, sessionVal, relacheVal));
      }

      // 2) date simple "dd/mm" ou "dd/mm/yyyy"
      const d = prettyToDateint(dates);
      if (d != null) {
        return _estDateValide(d, sessionVal, relacheVal);
      }

      // 3) jour de semaine "jeudi", "lun", ...
      const wd = _parseWeekdayFR(dates);
      if (wd != null) {
        const dates = _expandWeekdayToDateInts(wd);
        return dates.some(dateVal => _estDateValide(dateVal, sessionVal, relacheVal));
      }

      return false;
    },

    /**
     * Indique si une activité est réservée
     * @param {*} activite 
     * @returns 
     */
    estActiviteReservee(activite) {
      return _estActiviteReservee(activite);
    },

    /**
     * Indique si une activité est priorisée
     * @param {*} activite 
     * @returns 
     */
    estActiviteMarquee(activite) {
      return _estActiviteMarquee(activite);
    },

    /**
     * Indique si une activité est une pause
     * @param {*} activite 
     * @returns 
     */
    estPause(activite) {
      return _estPause(activite);
    },

    /**
     * Renvoie la plage de débuts possibles pour poser une pause déjeuner ou dîner à une date donnée
     * compte tenu des activités déja programmées.
     * @param {number} dateRef - date au format dateint (AAAAMMJJ)
     * @param {*} typePause - type de pause (déjeuner ou dîner)
     * @param {number} marge - marge entre activités en minutes (optionnel)
     * @returns 
     */
    // @ts-ignore
    getPausePlageDebut(dateRef, typePause, {activitesProgrammees=null, marge=null}={}) {

      const meta = (_ctx.meta) || {};
      const duree = Math.max(0, Number(meta.DUREE_REPAS ?? 60) | 0); // minutes

      if (!marge) {
        marge = Math.max(0, Number(meta.MARGE ?? 30) | 0); // minutes
      }

      // --- Fenêtres des repas (en minutes depuis minuit)
      const DEJ_DEBUT_MIN = 11 * 60;  // 12:00
      const DEJ_DEBUT_MAX = 14 * 60;  // 14:00
      const DIN_DEBUT_MIN = 19 * 60;  // 19:00
      const DIN_DEBUT_MAX = 21 * 60;  // 21:00

      let debutMin = 0;
      let debutMax = 0;

      switch (true) {
        case typePause === 'déjeuner':
          debutMin = DEJ_DEBUT_MIN;
          debutMax = DEJ_DEBUT_MAX;
          break;
        case typePause === 'dîner':
          debutMin = DIN_DEBUT_MIN;
          debutMax = DIN_DEBUT_MAX;
          break;
        default:
          return null;
      }

      if(!activitesProgrammees) activitesProgrammees = _getActivitesProgrammees(_ctx.df);
      const activitesProgrammeesDuJour = activitesProgrammees.filter(r => r.Date === dateRef);
      
      if (!activitesProgrammeesDuJour || activitesProgrammeesDuJour.length <=0) return [debutMin, debutMax];

      const plagesLibres = _getPlagesLibres(activitesProgrammeesDuJour);

      for (const pl of plagesLibres) {
        const plDeb = mmFromHHhMM(pl.Début);
        const plFin = mmFromHHhMM(pl.Fin);
        if ((plDeb  <= debutMax - marge) && ((plFin - Math.max(plDeb + marge, debutMin)) >= duree + marge)) return [Math.max(plDeb + marge, debutMin), Math.min(plFin - duree - marge, debutMax)];
      }
      
      return null;

    },

    /**
     * Crée une nouvelle activité 
     * @param {*} df  -> utilisé pour créer un nom d'activité unique qui ne soit pas déja alloué dans df
     * @returns nouvelleActivite
     */
    async creerActivite(df) {
      const nouveauNom = _getNouveauNomActivite(df);
      const nouvelleActivite =     {
          __uuid: genUUID(),
          Date: null, 
          Debut: "09h00", 
          Duree: "1h00",
          Activite: nouveauNom, 
          Lieu: null, 
          Session: null,
          Relache: null, 
          Style: null,
          Orga: null,
          Reserve: null, 
          Marqueur: null, 
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
      return _getNouveauNomActivite(df, prefix=prefix);
    },

    /** 
     * Indique si une valeur est valide pour le champ Debut d'une activité
     * "10h00" (1–2 chiffres pour l’heure, 2 chiffres pour les minutes) 
     */
    estHeureValide(val) {
      return _estHeureValide(val);
    },

    /** 
     * Indique si une valeur est valide pour le champ Duree d'une activité
     * "1h00" (minutes 00–59) 
     */
    estDureeValide(val) {
      return _estDureeValide(val);
    },

    /**
     * Indique si une valeur est valide pour le champ Session d'une activité
     * - vide => true
     * - sinon, tous les tokens (séparés par virgules au niveau 0) doivent être valides
     * ───────────────────────────────────────────────────────────
     * Format(s) acceptés, séparés par des virgules :
     *  - "9", "09", 
     *  - "9/7", "09/07", 
     *  - "09/07/25" ou "09/07/2025",
     *  - "(9, 16, 23)/7" pour énumérer des dates du même mois,
     *  - "[9-12]/07", "[30/07-01/08]" pour une période,
     *  - "jours pairs" | "jours impairs",
     *  - chaîne vide => tous les jours de la période programmation.
     * Mois et année par défaut = mois et année du début de la période de programmation.
     * On valide que *tous* les tokens sont valides.
     * ───────────────────────────────────────────────────────────
     */
    estSessionValide(val, { default_year = null, default_month = null } = {}) {
      return _estSessionValide(val, { default_year, default_month } );
    },

    /**
     * Indique si une valeur est valide pour le champ Relache d'une activité
     * - vide => true
     * - sinon, tous les tokens (séparés par virgules au niveau 0) doivent être valides
     * ───────────────────────────────────────────────────────────
     * Format(s) acceptés, séparés par des virgules :
     *  - "9", "09", 
     *  - "9/7", "09/07", 
     *  - "09/07/25" ou "09/07/2025",
     *  - "(9, 16, 23)/7" pour énumérer des dates du même mois,
     *  - "[9-12]/07", "[30/07-01/08]" pour une période,
     *  - "jours pairs" | "jours impairs",
     *  - chaîne vide => pas de jours de relâche.
     * Mois et année par défaut = mois et année du début de la période de programmation.
     * On valide que *tous* les tokens sont valides.
     * ───────────────────────────────────────────────────────────
     */
    estRelacheValide(val) {
      return _estRelacheValide(val);
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

    /**
     * Rapport de vérification de cohérence d'un tableau d'activités
     * @param {*} rows 
     * @returns 
     */
    getLogVerifierCoherenceJS(rows) {
      if (!Array.isArray(rows) || rows.length === 0) return '';

      const erreurs = [];

      // ---- Helpers ----
      const estEntier = (x) => {
        if (x == null) return false;
        const s = String(x).trim();
        if (!s) return false;
        const n = Number(s);
        return Number.isFinite(n) && Number.isInteger(n);
      };
      const norm = (s) => String(s ?? '')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g,' ').trim().toLowerCase();

      const isPause = (row) => {
        const val = String(row?.Activite ?? '').trim();
        if (!val) return false;
        const first = val.split(/\s+/)[0].toLowerCase();
        return first === 'pause'; 
      };

      const isTimeHhmm = (s) => typeof s === 'string' && /^\d{1,2}h\d{2}$/i.test(s.trim());
      const isTimeColon = (s) => typeof s === 'string' && /^\d{1,2}:\d{2}(:\d{2})?$/.test(s.trim());
      const isTimeLike = (v) => isTimeHhmm(String(v)) || isTimeColon(String(v));

      const hhmmToMinutes = (s) => {
        if (!s) return null;
        const t = String(s).trim().toLowerCase();
        let m = t.match(/^(\d{1,2})h(\d{2})$/);
        if (m) return (+m[1]) * 60 + (+m[2]);
        m = t.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
        if (m) return (+m[1]) * 60 + (+m[2]);
        return null;
      };

      const getDebutMinutes = (r) => hhmmToMinutes(r?.Debut);
      const getDureeMinutes = (r) => hhmmToMinutes(richValueGetValue(r?.Duree));

      const shortName = (s) => s; // !s ? "" : s.length <= 20 ? s.slice(0,20) : s.slice(0,20) + "...";

      // Lignes pertinentes (activité non vide) pour doublons
      const rowsValid = rows.filter(r => r && String(r.Activite ?? '').trim() !== '');

      // 1) 🔁 Doublons d’activités (même Activite normalisée), hors pauses
      {
        const seen = new Map();
        for (const r of rowsValid) {
          if (isPause(r)) continue;
          const key = norm(r.Activite)+norm(r.Debut)+norm(r.Lieu)+r.Session+r.Relache;
          if (!seen.has(key)) seen.set(key, []);
          seen.get(key).push(r);
        }
        for (const [_, arr] of seen.entries()) {
          if (arr.length > 1) {
            const bloc = ['🟠 Doublons d’activités :'];
            for (const row of arr) {
              const dateStr = row?.Date ? dateintToPretty(row?.Date) : 'Vide'; 
              const heureStr = String(row?.Debut ?? '').trim() || 'Vide';
              const dureeStr = String(row?.Duree ?? '').trim() || 'Vide';
              bloc.push(`${dateStr} - ${heureStr} - ${row?.Activite ?? ''} (${dureeStr})`);
            }
            erreurs.push(bloc.join('\n'));
          }
        }
      }

      // 2) ⛔ Chevauchements (Date/Debut/Duree)
      {
        const rowsSorted = [...rows].sort((a,b) => {
          const da = estEntier(a?.Date) ? parseInt(a.Date,10) : Number.MAX_SAFE_INTEGER;
          const db = estEntier(b?.Date) ? parseInt(b.Date,10) : Number.MAX_SAFE_INTEGER;
          if (da !== db) return da - db;
          const ta = getDebutMinutes(a) ?? Number.MAX_SAFE_INTEGER;
          const tb = getDebutMinutes(b) ?? Number.MAX_SAFE_INTEGER;
          return ta - tb;
        });

        const chev = [];
        for (let i = 1; i < rowsSorted.length; i++) {
          const r1 = rowsSorted[i - 1], r2 = rowsSorted[i];
          if (!estEntier(r1?.Date) || !estEntier(r2?.Date)) continue;
          if (parseInt(r1.Date,10) !== parseInt(r2.Date,10)) continue;

          const d1 = getDebutMinutes(r1);
          const du1 = getDureeMinutes(r1);
          const d2 = getDebutMinutes(r2);
          if (d1 == null || du1 == null || d2 == null) continue;

          const fin1 = d1 + du1;
          if (d2 < fin1) chev.push([r1, r2]);
        }
        if (chev.length) {
          const bloc = ['🔴 Chevauchements:'];
          for (const [r1, r2] of chev) {
            bloc.push(`${r1.Activite} (${r1.Debut} / ${r1.Duree}) chevauche ${r2.Activite} (${r2.Debut} / ${r2.Duree}) le ${dateintToPretty(r1.Date)}`);
          }
          erreurs.push(bloc.join('\n'));
        }
      }

      // 3) 🕒 Erreurs de format (Date, Heure, Durée, Session/Relache)
      {
        const bloc = [];
        rows.forEach((row, idx) => {
          const isEmptyProg = ['Activite','Debut','Duree'].every(c => {
            const v = row?.[c];
            return v == null || String(v).trim() === '';
          });
          if (isEmptyProg) return;

          const sName = shortName(row.Activite);

          // Date invalide (si fournie)
          if (row.Date != null && String(row.Date).trim() !== '' && !estEntier(row.Date)) {
            bloc.push(`Date invalide à la ligne ${idx + 2} : ${row.Date} (${sName})`);
          }

          // Heure/Durée si Activite présente
          if (String(row?.Activite ?? '').trim() !== '') {
            const h = row?.Debut, d = richValueGetValue(row?.Duree);
            if (!isTimeLike(String(h ?? ''))) bloc.push(`Heure invalide à la ligne ${idx + 2} : ${h} (${sName})`);
            if (!isTimeLike(String(d ?? ''))) bloc.push(`Durée invalide à la ligne ${idx + 2} : ${d} (${sName})`);
          }

          // Session/Relache 
          if (!_estSessionValide(row?.Session)) {
            bloc.push(`Période de validité invalide à la ligne ${idx + 2} : ${row?.Session} (${sName})`);
          }
          if (!_estRelacheValide(row?.Relaches ?? row?.Relache)) {
            const v = row?.Relaches ?? row?.Relache;
            bloc.push(`Relâches invalides à la ligne ${idx + 2} : ${v} (${sName})`);
          }
        });
        if (bloc.length) erreurs.push('🕒 Erreurs de format:\n' + bloc.join('\n'));
      }

      // 4) 🛑 Date incompatible avec Session/Relache (via _estDateValide)
      {
        const bloc = [];
        rows.forEach((row, idx) => {
          if (!estEntier(row?.Date)) return;
          const dateInt = parseInt(row.Date, 10);
          const sessionVal = row?.Session ?? row?.Session ?? '';
          const RelacheVal = row?.Relaches ?? row?.Relache ?? '';

          // On signale si la date n'est PAS valide (i.e. en relâche ou hors session)
          const ok = _estDateValide(dateInt, sessionVal, RelacheVal);
          if (!ok && String(row?.Activite ?? '').trim() !== '') {
            bloc.push(`${row.Activite} non programmable le ${dateInt} selon Validité/Relâches (ligne ${idx + 2})`);
          }
        });
        if (bloc.length) erreurs.push('🛑 Dates incompatibles avec Validité/Relâches:\n' + bloc.join('\n'));
      }

      // 5) ⚠️ Heures non renseignées
      {
        const bloc = [];
        rows.forEach((row, idx) => {
          const isEmptyProg = ['Activite','Debut','Duree'].every(c => {
            const v = row?.[c];
            return v == null || String(v).trim() === '';
          });
          if (isEmptyProg) return;

          const sName = shortName(row.Activite);

          if (String(row?.Activite ?? '').trim() !== '') {
            const h = String(row?.Debut ?? '').trim();
            if (!h) bloc.push(`Heure vide à la ligne ${idx + 2} (${sName})`);
          }
        });
        if (bloc.length) erreurs.push('⚠️ Heures non renseignées:\n' + bloc.join('\n'));
      }

      // 6) ⚠️ Durées nulles ou vides (0 minute)
      {
        const bloc = [];
        rows.forEach((row, idx) => {
          const isEmptyProg = ['Activite','Debut','Duree'].every(c => {
            const v = row?.[c];
            return v == null || String(v).trim() === '';
          });
          if (isEmptyProg) return;

          const sName = shortName(row.Activite);

          const dMin = getDureeMinutes(row);
          if (dMin === 0) {
            const dStr = String(row?.Duree ?? '').trim();
            const msg = dStr ? `Durée nulle à la ligne ${idx + 2} (${sName})` : `Durée vide à la ligne ${idx + 2} (${sName})`;
            bloc.push(msg);
          }
        });
        if (bloc.length) erreurs.push('⚠️ Durées nulles ou vides:\n' + bloc.join('\n'));
      }

      // ---- Rendu HTML ----
      let contenu = "<div style='font-size:14px'>";
      for (const bloc of erreurs) {
        const lignes = String(bloc).split('\n');
        if (/^[🟠🔴⚠️🛑⛔]/.test(lignes[0])) {
          contenu += `<p><strong>${_esc(lignes[0])}</strong></p><ul>`;
          for (const l of lignes.slice(1)) contenu += `<li>${_esc(l)}</li>`;
          contenu += `</ul>`;
        } else {
          contenu += `<p>${_esc(bloc)}</p>`;
        }
      }
      contenu += "</div>";
      return contenu;
    },

    /**
     * Construit la liste des séances (dates "YYYY-MM-DD") à partir de Session / Relache.
     *
     * Grammaire gérée (côté Session) :
     *  - Intervalles :
     *      [d1-d2]
     *      [d1-d2]/mm
     *      [d1-d2]/mm/yyyy
     *      [d1/mm1-d2/mm2]/yyyy
     *
     *  - Listes :
     *      (d1, d2, ...)
     *      (d1, d2, ...)/mm
     *      (d1, d2, ...)/mm/yyyy
     *      (d1/mm, d2/mm2, ...)
     *
     *  - Dates isolées :
     *      d
     *      d/mm
     *      d/mm/yyyy
     *
     * Règles de complétion :
     *  - année par défaut : editionYearFallback si fourni, sinon année courante
     *  - mois par défaut : mois courant
     *
     * On construit un ensemble de dates candidates (AAAAMMJJ), puis on les filtre
     * avec _estDateValide(dateInt, sessionVal, relacheVal).
     *
     * @param {string|null} sessionVal
     * @param {string|null} relacheVal
     * @param {number|null} editionYearFallback - année par défaut si souhaité
     * @returns {string[]} tableau de dates "YYYY-MM-DD"
     */
    buildSeancesFromSessionRelache(sessionVal, relacheVal, editionYearFallback = null) {
      const sessionTxt = String(sessionVal || "").trim();
      if (!sessionTxt) return [];

      const now = new Date();
      const baseYear  = Number.isFinite(editionYearFallback) ? editionYearFallback : now.getFullYear();
      const baseMonth = now.getMonth() + 1; // 1..12

      // 🔴 IMPORTANT : une seule Set pour TOUTE la chaîne
      const candidateDates = new Set();

      // ---------- Helpers ----------

      function dateIntToIso(di) {
        const y  = Math.floor(di / 10000);
        const m  = Math.floor((di / 100) % 100);
        const d  = di % 100;
        const mm = String(m).padStart(2, "0");
        const dd = String(d).padStart(2, "0");
        return `${y}-${mm}-${dd}`;
      }

      function parseDateFragment(raw) {
        if (!raw) return { d: null, m: null, y: null };
        const parts = String(raw).trim().split("/").map(s => s.trim()).filter(Boolean);
        let d = null, m = null, y = null;

        if (parts.length === 3) {
          d = Number(parts[0]);
          m = Number(parts[1]);
          y = Number(parts[2]);
        } else if (parts.length === 2) {
          d = Number(parts[0]);
          m = Number(parts[1]);
        } else if (parts.length === 1) {
          d = Number(parts[0]);
        }

        if (!Number.isFinite(d)) d = null;
        if (!Number.isFinite(m)) m = null;
        if (!Number.isFinite(y)) y = null;

        return { d, m, y };
      }

      function normalizeYear(y, defaultYear) {
        if (!Number.isFinite(y)) y = defaultYear;
        if (y < 100) {
          y = (y < 50) ? (2000 + y) : (1900 + y);
        }
        return y;
      }

      function fragmentToDateInt(frag, mmSuffix, yySuffix) {
        const d = frag.d;
        if (!Number.isFinite(d)) return null;

        let m = frag.m;
        let y = frag.y;

        // mois
        if (mmSuffix != null && !Number.isFinite(m)) {
          m = Number(mmSuffix);
        }
        if (!Number.isFinite(m)) {
          m = baseMonth;
        }

        // année
        if (yySuffix != null && !Number.isFinite(y)) {
          y = Number(yySuffix);
        }
        y = normalizeYear(y, baseYear);

        if (!Number.isFinite(m) || m < 1 || m > 12) return null;

        const js = new Date(y, m - 1, d);
        if (
          js.getFullYear() !== y ||
          js.getMonth() + 1 !== m ||
          js.getDate() !== d
        ) {
          return null;
        }

        return y * 10000 + m * 100 + d;
      }

      function splitTopLevelByComma(text) {
        const parts = [];
        let buf = "";
        let depthSquare = 0;
        let depthParen = 0;

        for (let i = 0; i < text.length; i++) {
          const c = text[i];

          if (c === "[") depthSquare++;
          else if (c === "]" && depthSquare > 0) depthSquare--;
          else if (c === "(") depthParen++;
          else if (c === ")" && depthParen > 0) depthParen--;

          if (c === "," && depthSquare === 0 && depthParen === 0) {
            const segment = buf.trim();
            if (segment) parts.push(segment);
            buf = "";
            continue;
          }

          buf += c;
        }

        const last = buf.trim();
        if (last) parts.push(last);
        return parts;
      }

      function parseSuffix(rawSuffix) {
        const s = String(rawSuffix || "").trim();
        if (!s.startsWith("/")) {
          return { mmSuffix: null, yySuffix: null };
        }

        const body = s.slice(1).trim();
        if (!body) {
          return { mmSuffix: null, yySuffix: null };
        }

        const parts = body.split("/").map(x => x.trim()).filter(Boolean);

        if (parts.length === 1) {
          const token = parts[0];
          if (token.length === 2) {
            return { mmSuffix: token, yySuffix: null };    // /mm
          }
          if (token.length === 4) {
            return { mmSuffix: null, yySuffix: token };    // /yyyy
          }
          return { mmSuffix: null, yySuffix: null };
        }

        if (parts.length === 2) {
          const mm = parts[0] || null;
          const yy = parts[1] || null;
          return { mmSuffix: mm, yySuffix: yy };           // /mm/yyyy
        }

        return { mmSuffix: null, yySuffix: null };
      }

      // ---------- 1) Découpage en segments ----------

      const segments = splitTopLevelByComma(sessionTxt);
      // DEBUG : à commenter ensuite
      // console.log("Segments:", segments);

      for (const segRaw of segments) {
        const seg = segRaw.trim();
        if (!seg) continue;

        // DEBUG : à commenter ensuite
        // console.log("Segment:", seg);

        // CAS 1 : Intervalle [a-b](/mm[/yyyy]?)
        if (/^\s*\[/.test(seg)) {
          const m = seg.match(/\[\s*([^\]]+)\s*\]\s*(.*)$/);
          if (!m) continue;

          const inside     = m[1];          // "04-25" ou "28/07-04/08"
          const suffixPart = m[2] || "";    // "/07", "/2025", "/07/2025" ou ""

          const { mmSuffix, yySuffix } = parseSuffix(suffixPart);

          const dashIdx = inside.indexOf("-");
          if (dashIdx < 0) continue;

          const left  = inside.slice(0, dashIdx).trim();
          const right = inside.slice(dashIdx + 1).trim();

          const fragA = parseDateFragment(left);
          const fragB = parseDateFragment(right);

          const diA = fragmentToDateInt(fragA, mmSuffix, yySuffix);
          const diB = fragmentToDateInt(fragB, mmSuffix, yySuffix);
          if (!diA || !diB) continue;

          let di = Math.min(diA, diB);
          const hi = Math.max(diA, diB);

          while (di <= hi) {
            candidateDates.add(di);
            const y  = Math.floor(di / 10000);
            const m2 = Math.floor((di / 100) % 100);
            const d2 = di % 100;
            const next = new Date(y, m2 - 1, d2 + 1);
            di = next.getFullYear() * 10000 + (next.getMonth() + 1) * 100 + next.getDate();
          }

          continue;
        }

        // CAS 2 : Liste (d1, d2, ...) (/mm[/yyyy]?)
        if (/^\s*\(/.test(seg)) {
          const m = seg.match(/\(\s*([^)]+)\s*\)\s*(.*)$/);
          if (!m) continue;

          const inside     = m[1];          // "10, 11" ou "10/08, 11/08"
          const suffixPart = m[2] || "";    // "/08", "/08/2025", ...

          const { mmSuffix, yySuffix } = parseSuffix(suffixPart);

          const tokens = inside.split(",").map(s => s.trim()).filter(Boolean);
          for (const tok of tokens) {
            const frag = parseDateFragment(tok);
            const di   = fragmentToDateInt(frag, mmSuffix, yySuffix);
            if (di) candidateDates.add(di);
          }

          continue;
        }

        // CAS 3 : dates isolées dans le segment
        const reSingle = /\b(\d{1,2}(?:\/\d{1,2}(?:\/\d{2,4})?)?)\b/g;
        let mSingle;
        while ((mSingle = reSingle.exec(seg)) !== null) {
          const tok  = mSingle[1];
          const frag = parseDateFragment(tok);
          const di   = fragmentToDateInt(frag, null, null);
          if (di) candidateDates.add(di);
        }
      }

      // ---------- 2) Filtrage via _estDateValide ----------

      const sorted = Array.from(candidateDates).sort((a, b) => a - b);
      const seances = [];

      for (const di of sorted) {
        if (_estDateValide(di, sessionVal, relacheVal)) {
          seances.push(dateIntToIso(di));
        }
      }

      return seances;
    },

  }
}

/**
 * Construit une clef de spectacle à partir des colonnes Activite, Lieu, Debut et Session/Relache transformé en seances
 * Cette définition de clef est partagée avec le worker CloudFlare et permet de lui demander de filtrer des entrées de 
 * l'index global utilisé pour les fonctions de scoring par similarité (embeddings).
 * @param {*} row 
 * @returns 
 */
export function makeFullKey(row) {
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

  const activite = norm(row.Activite || row.activite);
  const lieu     = norm(row.Lieu || row.lieu);
  const debut    = normHour(row.Debut || row.debut);

  return `${activite}||${lieu}||${debut}`;
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

  // indexed.sort((A, B) => {
  //   const aNoDate = A.d == null;
  //   const bNoDate = B.d == null;

  //   // 0) Sans date : toujours APRES ceux avec date
  //   if (aNoDate && !bNoDate) return 1;
  //   if (!aNoDate && bNoDate) return -1;

  //   if (!aNoDate && !bNoDate) {
  //     // 1) Les deux ont une date -> comparer Date
  //     if (A.d !== B.d) return (A.d - B.d) * dir;

  //     // 2) Puis l'heure (nulls après)
  //     const aNull = A.m == null, bNull = B.m == null;
  //     if (aNull && bNull) return A.i - B.i;   // stabilité
  //     if (aNull) return 1;
  //     if (bNull) return -1;
  //     return (A.m - B.m) * dir;
  //   }

  //   // 3) Les deux sont sans date -> trier par Début (nulls après)
  //   const aNull = A.m == null, bNull = B.m == null;
  //   if (aNull && bNull) return A.i - B.i;
  //   if (aNull) return 1;
  //   if (bNull) return -1;
  //   return A.m - B.m;
  // });
  indexed.sort((A, B) => {
    const aNoDate = A.d == null;
    const bNoDate = B.d == null;

    // 🔹 NOUVEAU : helper 3ᵉ clé = Activite (ordre alpha, insensible à la casse)
    const cmpActivite = () => {
      const aLabel = (A.r?.Activite ?? '').toString().trim();
      const bLabel = (B.r?.Activite ?? '').toString().trim();

      const aEmpty = aLabel === '';
      const bEmpty = bLabel === '';

      // on place les lignes sans Activite après celles qui en ont une
      if (aEmpty && !bEmpty) return 1;
      if (!aEmpty && bEmpty) return -1;

      if (!aEmpty || !bEmpty) {
        const cmp = aLabel.localeCompare(bLabel, 'fr', {
          sensitivity: 'base',
          numeric: true,
        });
        if (cmp !== 0) return cmp * dir;
      }

      // fallback ultra-stable : index d'origine
      return A.i - B.i;
    };

    // 0) Sans date : toujours APRES ceux avec date
    if (aNoDate && !bNoDate) return 1;
    if (!aNoDate && bNoDate) return -1;

    if (!aNoDate && !bNoDate) {
      // 1) Les deux ont une date -> comparer Date
      if (A.d !== B.d) return (A.d - B.d) * dir;

      // 2) Puis l'heure (nulls après)
      const aNull = A.m == null, bNull = B.m == null;
      if (aNull && bNull) {
        // 🔹 AVANT : return A.i - B.i;
        // 🔹 MAINTENANT : 3ᵉ clé = Activite
        return cmpActivite();
      }
      if (aNull) return 1;
      if (bNull) return -1;

      const diffM = A.m - B.m;
      if (diffM !== 0) return diffM * dir;

      // 3ᵉ clé si même heure
      return cmpActivite();
    }

    // 3) Les deux sont sans date -> trier par Début (nulls après)
    const aNull = A.m == null, bNull = B.m == null;
    if (aNull && bNull) {
      // 🔹 AVANT : return A.i - B.i;
      // 🔹 MAINTENANT : 3ᵉ clé = Activite
      return cmpActivite();
    }
    if (aNull) return 1;
    if (bNull) return -1;

    const diffM2 = A.m - B.m;
    if (diffM2 !== 0) return diffM2 * dir;

    // même heure, sans date -> Activite
    return cmpActivite();
  });

  return indexed.map(x => x.r);
}

function _esc(s){return String(s)
  .replace(/&/g,'&amp;')
  .replace(/</g,'&lt;')
  .replace(/>/g,'&gt;')
  .replace(/"/g,'&quot;')
  .replace(/'/g,'&#39;');
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
 * Indique si une activité est priorisée
 * @param {*} row 
 * @returns 
 */
function _estActiviteMarquee(row) {
  return (row.Marqueur !== null && row.Marqueur !== ""); // Number.isInteger(row.Marqueur);
};

/**
 * Détermine si une activité (row) est chevauchable
 * (Marqueur négatif ou commençant par '-')
 * @param {{ Marqueur?: any }} row
 * @returns {boolean}
 */
function _estActiviteChevauchable(row) {
  const p = row?.Marqueur;
  if (p == null) return false;

  // cas number
  if (typeof p === "number") {
    return p < 0;
  }

  // cas string
  const s = String(p).trim();
  if (!s) return false;

  return s.startsWith("-");
} 

/**
 * Renvoie true si une activité est valide à une date donnée
 * (i.e. non en relâche et dans la période de validité) pour la journée `dateRef` (AAAAMMJJ).
 * Cela ne verifie pas la compatibilité avec les activités déjà programmées
 *
 * @param {object} activite - activité
 * @param {number} dateRef - entier AAAAMMJJ
 * @returns {boolean}
 */
function _estActiviteValideADate(activite, dateRef) {
  return _estDateValide(dateRef, activite.Session, activite.Relache) && _estHeureValide(activite.Debut) && _estDureeValide(richValueGetValue(activite.Duree));
}


/**
 * Renvoie true s'il existe AU MOINS une activité programmable à une date donnée (dateRef)
 * (i.e. non en relâche et dans la période de validité) pour la journée `dateRef` (AAAAMMJJ).
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
    return _estDateValide(dateRef, r.Session, r.Relache) && _estHeureValide(r.Debut) && _estDureeValide(richValueGetValue(r.Duree));
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
    isNotNull(richValueGetValue(r.Duree)) &&
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
 * Renvoie true si la row en paramètre est une activité programmée.
 * i.e. Date valide, et des champs Début, Durée, Activité non vides.
 *
 * @param {object} r    - row activité
 * @returns {boolean}   - true / false
 */
function _estActiviteProgrammee(r) {
  if (!(typeof r === "object" && r!= null)) return false;

  const estFloatValide = v => {
    const n = parseFloat(v);
    return Number.isFinite(n) && n > 0;
  };

  const isNotNull = v => v !== null && v !== undefined && v !== '';

  return (
    estFloatValide(r.Date) &&
    isNotNull(r.Debut) &&
    isNotNull(richValueGetValue(r.Duree)) &&
    isNotNull(r.Activite)
  );
}

/**
 * Renvoie la liste des activités non programmées à partir d'un tableau d'activités :
 * i.e. sans Date, mais avec Debut, Duree et Activite définies.
 * 
 * @param {object} r    - row activité
 * @returns {boolean}   - true / false
 */
function _estActiviteNonProgrammee(r) {
  if (!(typeof r === "object" && r!= null)) return false;

  return (
    (r.Date == null || r.Date === '') &&   // Date manquante
    r.Activite != null &&
    r.Activite !== ''
  );
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

// Vérifie qu'une activité est potentiellement programmable 
// i.e. qu'elle n'est pas déjà programmée et que son heure de début et sa durée sont valides
function _estActiviteProgrammable(row) {
  const d = row?.Date;
  return (d == null || d === '' || Number.isNaN(+d)) && _estHeureValide(row?.Debut) && _estDureeValide(richValueGetValue(row?.Duree));
}

// Renvoie les dates du Festival: fetch best-effort + cache
// NB: CORS probablement bloqué -> fallback manuel activé automatiquement
async function _getDatesFestival(state = window.appState) {
  if (!state) state = (window.appState = {});
  if (state.festival_debut && state.festival_fin) {
    return { debut: state.festival_debut, fin: state.festival_fin };
  }

  // Fallback par défaut (à ajuster si besoin)
  const FALLBACK_DEBUT = new Date(2026, 6, 4);   // 04 juillet 2026 (mois 0-based)
  const FALLBACK_FIN   = new Date(2026, 6, 25);  // 25 juillet 2026

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
    if (!_estActiviteProgrammable(row)) continue;

    const d = heureMinute(row), du = dureeMinute(row);
    if (!Number.isFinite(d) || !Number.isFinite(du)) continue;
    const h_debut = d, h_fin = d + du;

    // if (h_debut >= (debut_min + _MARGE) && h_fin <= (fin_max - _MARGE) && _estDateValide(ligneRef.Date, row.Session, row.Relache)) {
    //   const nouvelle = { ...row }; // delete nouvelle.Debut_dt; delete nouvelle.Duree_dt;
    //   nouvelle.__type_activite = 'ActiviteExistante';
    //   nouvelle.__uuid = row.__uuid;
    //   proposables.push(nouvelle);
    // }
    if (_estDateValide(ligneRef.Date, row.Session, row.Relache) && 
      //((_estActiviteChevauchable(row) && (h_fin <= fin_max)) ||   // Condition pour les activités chevauchables
      (h_debut >= (debut_min + _MARGE) && h_fin <= (fin_max - _MARGE)))) {                  // Condition pour les activités non chevauchables
      const nouvelle = { ...row }; // delete nouvelle.Debut_dt; delete nouvelle.Duree_dt;
      nouvelle.__type_activite = 'ActiviteExistante';
      nouvelle.__uuid = row.__uuid;
      proposables.push(nouvelle);
    }
  }

  if (traiter_pauses) _ajouterPauses(proposables, activitesProgrammees, ligneRef, "Avant");

  return proposables;
}

/**
 * Liste des activités non programmées (df) posables APRÈS la ligne de ref.
 * - Respecte: si fin_ref passe au lendemain → rien (comme Python)
 * - fin_max peut être null (alors borne haute = 23:59)
 */
function _getActivitesProgrammablesApres(df, activitesProgrammees, ligneRef, traiter_pauses = true) {
  const proposables = [];

  const dRef = Number.isFinite(heureMinute(ligneRef)) ? heureMinute(ligneRef) : MIN_DAY;
  const duRef = Number.isFinite(dureeMinute(ligneRef)) ? dureeMinute(ligneRef) : 0;
  const finRef = dRef + duRef;
  if (finRef > MAX_DAY) return proposables; // changement de jour -> pas d'après

  const [debut_min, fin_max] = _getCreneauBoundsApres(activitesProgrammees, ligneRef);
  if (fin_max != null && !(debut_min < fin_max)) return proposables;

  for (let idx = 0; idx < (df?.length || 0); idx++) {
    const row = df[idx];
    if (!_estActiviteProgrammable(row)) continue;

    const d = heureMinute(row), du = dureeMinute(row);
    if (!Number.isFinite(d) || !Number.isFinite(du)) continue;
    const h_debut = d, h_fin = d + du;

    const borneHaute = (fin_max == null) ? MAX_DAY : (fin_max - _MARGE);
    // if (h_debut >= (debut_min + _MARGE) && (h_fin <= borneHaute || borneHaute === MAX_DAY) && _estDateValide(ligneRef.Date, row.Session, row.Relache)) {
    //   const nouvelle = { ...row }; //delete nouvelle.Debut_dt; delete nouvelle.Duree_dt;
    //   nouvelle.__type_activite = 'ActiviteExistante';
    //   nouvelle.__uuid = row.__uuid;
    //   proposables.push(nouvelle);
    // }
    if (_estDateValide(ligneRef.Date, row.Session, row.Relache) && 
      //((_estActiviteChevauchable(row) && (h_debut >= debut_min)) ||   // Condition pour les activités chevauchables
      (h_debut >= (debut_min + _MARGE) && (h_fin <= borneHaute || borneHaute === MAX_DAY)))) {                  // Condition pour les activités non chevauchables
      const nouvelle = { ...row }; //delete nouvelle.Debut_dt; delete nouvelle.Duree_dt;
      nouvelle.__type_activite = 'ActiviteExistante';
      nouvelle.__uuid = row.__uuid;
      proposables.push(nouvelle);
    }
  }

  if (traiter_pauses) _ajouterPauses(proposables, activitesProgrammees, ligneRef, "Après");
  
  return proposables;
}

/**
 * Retourne [debut_min, fin_max, prevRow] pour l’activité de référence.
 * - debut_min : fin de l’activité précédente le même jour, ou 00:00
 * - fin_max   : début de l’activité de ref (mm depuis minuit)
 */
function _getCreneauBoundsAvant(activitesProgrammees, ligneRef) {
  const dateRef  = ligneRef.Date;
  const debutRef = Number.isFinite(heureMinute(ligneRef)) ? heureMinute(ligneRef) : MIN_DAY;
  const duRef = Number.isFinite(dureeMinute(ligneRef)) ? dureeMinute(ligneRef) : 0;
  const finRef = debutRef + duRef;

  const sameDay = (activitesProgrammees || [])
    .filter(r => r.Date === dateRef)
    .sort((a,b) => (heureMinute(a) ?? 0) - (heureMinute(b) ?? 0));

  let prev = null;
  for (const r of sameDay) {
    if (_estActiviteChevauchable(r)) continue; // activité chevauchable
    const d = heureMinute(r);
    if (Number.isFinite(d) && d < debutRef) prev = r;
    else if ((d ?? 0) >= debutRef) break;
  }

  const prevFin = prev ? (heureMinute(prev) + (dureeMinute(prev) || 0)) : MIN_DAY;
  const debut_min = prevFin;
  const fin_max   = _estActiviteChevauchable(ligneRef) ? finRef : debutRef;   // Prio < 0 => activité chavauchable 

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
  const debutRef = Number.isFinite(heureMinute(ligneRef)) ? heureMinute(ligneRef) : MIN_DAY;
  const duRef = Number.isFinite(dureeMinute(ligneRef)) ? dureeMinute(ligneRef) : 0;
  const finRef = debutRef + duRef;

  if (finRef > MAX_DAY) return [finRef, null, null]; // déborde jour suivant -> pas d'"après"

  const sameDay = (activitesProgrammees || [])
    .filter(r => r.Date === dateRef)
    .sort((a,b) => (heureMinute(a) ?? 0) - (heureMinute(b) ?? 0));

  let next = null;
  for (const r of sameDay) {
    if (_estActiviteChevauchable(r)) continue; // activité chevauchable
    const rDeb = heureMinute(r) || 0;
    const rFin = rDeb + (dureeMinute(r) || 0);
    if (rFin > finRef) { next = r; break; }
  }

  const fin_max   = next ? heureMinute(next) : null;
  const debut_min = _estActiviteChevauchable(ligneRef) ? debutRef : finRef;   // Prio < 0 => activité chavauchable 


  return [debut_min, fin_max, next];
}

function _getCreneauUuid(date, uuid, type) {
  if (!uuid) return String(date);
  return `${uuid}-${type}`;
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
    'Activité-avant': avant || '',
    'Activité-après': apres || '',
    __type_creneau: typeCreneau,           // "Avant" | "Après" | "Journée"
    __srcUuid: row.__uuid,
    __uuid: _getCreneauUuid(dateStr, row.__uuid, typeCreneau), //genUUID(),
  };
}

function _estCreneauValide(creneau) {
  if (!creneau || typeof creneau !== 'object') return false;
  const t = creneau.__type_creneau;
  return t === 'Avant' || t === 'Après' || t === 'Journée';
}


/**
 *  Défauts pour mois/année -> mois/année du début de la période de progammation (ou de today si absent)
 */
function getMonthYearDefault() {
  let defY, defM;

  const d0 = _getPeriodeProgrammation().debut;

  const ref =
    (d0 instanceof Date && !isNaN(d0.getTime()))
      ? d0
      : (d0 ? new Date(d0) : null);

  if (ref instanceof Date && !isNaN(ref.getTime())) {
    defY = ref.getFullYear();
    defM = ref.getMonth() + 1;
  } else {
    const today = new Date()
    defY = today.getFullYear();
    defM = today.getMonth() + 1;
  }
  return [defY, defM];
}

/**
 * Détermine si une date est valide, ie. est dans Session et pas dans Relache.
 * @param {number|null} dateVal - Date sous forme d'entier AAAAMMJJ (ex: 20250721)
 * @param {string|null} sessionVal - Description des dates de session (ex: "[5-26], [5-26] lu ma", "(8,25)/07", "jours pairs", etc.)
 * @param {string|null} relacheVal - Description des dates de relâche (grammaire identique à celle des sessions)
 * @returns {boolean} - true = jour jouable / false = relâche
 */
function _estDateValide(dateVal, sessionVal, relacheVal) {
  if (dateVal == null) return true;

  const dv = Number(dateVal);
  if (!Number.isFinite(dv)) return true;

  // Jour dans dateVal
  const dd = dv % 100;

  // Récupération du mois et de l'année par défaut
  const [defY, defM] = getMonthYearDefault();

  // --- Helpers ---
  const y2k = (y) => (Number.isFinite(y) && y < 100 ? (y < 50 ? 2000 + y : 1900 + y) : y);
  const mkDateInt = (y, m, d) => (y * 10000 + m * 100 + d);

  // "12", "12/07", "12/07/2025" -> [y,m,d] avec yy/mm défaut si absent
  const parseDayMaybeDmY = (s, yy, mm) => {
    const parts = String(s).split("/").map(x => x.trim());
    let d, m = mm, y = yy;
    if (parts.length === 3) [d, m, y] = parts.map(n => Number(n));
    else if (parts.length === 2) [d, m] = parts.map(n => Number(n));
    else if (parts.length === 1) d = Number(parts[0]);
    y = y2k(y);
    return [y, m, d];
  };

  // Liste "12,21,25" ou "12 21 25" (avec NBSP, espaces multiples...)
  const _parseDaysList = (raw) => {
    if (!raw) return [];
    const s = String(raw)
      .replace(/\u00A0/g, ' ')   // NBSP -> space
      .replace(/\s+/g, ' ')      // espaces multiples -> un
      .trim();
    return s
      .split(/[,\s]+/)           // virgules OU espaces
      .map(x => Number(x.trim()))
      .filter(n => Number.isFinite(n) && n >= 1 && n <= 31);
  };

  // Codes jours courts
  const WEEKDAY_SHORT = ['di','lu','ma','me','je','ve','sa'];
  const weekdayCodeForDateInt = (di) => {
    const y = Math.floor(di / 10000);
    const m = Math.floor((di / 100) % 100);
    const d = di % 100;
    const js = new Date(y, m - 1, d);
    const dow = js.getDay(); // 0=dimanche
    return WEEKDAY_SHORT[dow] || null;
  };

  // --- Helpers pour les jours de semaine
  const WEEKDAYS_ORDER = ['lu','ma','me','je','ve','sa','di'];
  const weekdayCodeFromDateInt = (di) => {
    const y = Math.floor(di / 10000);
    const m = Math.floor((di / 100) % 100);
    const d = di % 100;
    const jsDate = new Date(y, m - 1, d);
    const dow = jsDate.getDay(); // 0=dimanche ... 6=samedi
    // On mappe sur lu ma me... en partant de dimanche=di
    const map = ['di','lu','ma','me','je','ve','sa'];
    return map[dow];
  };

  const parseWeekdaysSuffix = (txt) => {
    if (!txt) return null;
    // on cherche tous les tokens lu|ma|...
    const m = txt.match(/\b(lu|ma|me|je|ve|sa|di)\b/g);
    if (!m || !m.length) return null;
    // unicité + tri dans l’ordre lu→di
    const set = new Set(m);
    return WEEKDAYS_ORDER.filter(code => set.has(code));
  };

  const sessionTxt = String(sessionVal || '').trim().toLowerCase();
  const relacheTxt = String(relacheVal || '').trim().toLowerCase();

  // On passe maintenant les intervalles sous forme d'objets { lo, hi, days }
  const openIntervals   = [];   // inclusions: {lo, hi, days:Set|null}
  const regroupSessionDays = []; // inclusions: dates uniques (int)
  const closedIntervals = [];   // exclusions: {lo, hi, days:Set|null}
  const regroupRelacheDays = []; // exclusions: dates uniques

  // ====== SESSION (inclusions) ======

  // Fenêtres de représentation [A–B] (/MM[/YYYY] optionnel) + éventuels jours "lu ma ..."
  //
  // Exemples supportés :
  //   [01/07/25-30/07/25]
  //   [10-13]/08
  //   [01/07/25-30/07/25] lu ma me
  //
  const reIntervalSess =
    /\[\s*([0-9/]+)\s*[-–]\s*([0-9/]+)\s*\](?:\/(\d{1,2})(?:\/(\d{2,4}))?)?([^;\[]*)/g;

  for (const m of sessionTxt.matchAll(reIntervalSess)) {
    const [, aTxt, bTxt, mmTxt, yyTxt, suffix] = m;

    const mmDef = mmTxt ? Number(mmTxt) : defM;
    const yyDef = yyTxt ? y2k(Number(yyTxt)) : defY;

    const [Ay, Am, Ad] = parseDayMaybeDmY(aTxt, yyDef, mmDef);
    const [By, Bm, Bd] = parseDayMaybeDmY(bTxt, yyDef, mmDef);

    const aDi = mkDateInt(Ay, Am, Ad);
    const bDi = mkDateInt(By, Bm, Bd);
    if (!Number.isFinite(aDi) || !Number.isFinite(bDi)) continue;

    const lo = Math.min(aDi, bDi);
    const hi = Math.max(aDi, bDi);

    const wdTxt = suffix ? suffix.trim() : '';
    const days = parseWeekdaysSuffix(wdTxt); // null => tous les jours
    openIntervals.push({ lo, hi, days });
  }

  // Jours listés (a,b,c) (/MM[/YYYY] optionnel)
  for (const m of sessionTxt.matchAll(/\(\s*([\d\s,]+)\s*\)\s*(?:\/(\d{1,2})(?:\/(\d{2,4}))?)?/g)) {
    const [ , rawJours, mmTxt, yyTxt ] = m;
    const mmDef = mmTxt ? Number(mmTxt) : defM;
    const yyDef = yyTxt ? y2k(Number(yyTxt)) : defY;
    for (const jd of _parseDaysList(rawJours)) {
      regroupSessionDays.push(mkDateInt(yyDef, mmDef, jd));
    }
  }

  // --- Jours isolés de représentation (hors [] et ())
  {
    const sessionStripped = sessionTxt
      .replace(/\[[^\]]*\]/g, ' ')    // retire [ ... ] (intervalles déjà traités)
      .replace(/\([^)]*\)/g, ' ')     // retire ( ... )
      .replace(/<[^>]*>/g, ' ')       // retire < ... >
      .replace(/\b\d{1,2}h\d{0,2}\b/gi, ' ')     // retire "14h" / "14h30"
      .replace(/\b\d{1,3}\s*min(?:s)?\b/gi, ' ');// retire "55min";

    const reIso = /\b(\d{1,2})(?:\/(\d{1,2})(?:\/(\d{2,4}))?)?\b/g;
    for (const m of sessionStripped.matchAll(reIso)) {
      const startIdx = m.index ?? 0;

      // ne pas interpréter "/07" comme un jour isolé (c'est le mois)
      if (startIdx > 0 && sessionStripped[startIdx - 1] === '/') continue;

      const d  = Number(m[1]);
      const mm = m[2] ? Number(m[2]) : defM;      
      const yy = m[3] ? y2k(Number(m[3])) : defY; 
      if (Number.isFinite(d) && d >= 1 && d <= 31 &&
          Number.isFinite(mm) && mm >= 1 && mm <= 12 &&
          Number.isFinite(yy)) {
        regroupSessionDays.push(mkDateInt(yy, mm, d));
      }
    }
  }

  // Parité
  let pariteSession = null;
  if (/\bjours?\s+pairs?\b/.test(sessionTxt))   pariteSession = "pair";
  if (/\bjours?\s+impairs?\b/.test(sessionTxt)) pariteSession = "impair";

  // ====== RELÂCHES (exclusions) ======

  // Fenêtres de relâche "[A–B]" (/MM[/YYYY] optionnel) + éventuels jours ("lu ma ve")
  const reIntervalRel =
    /\[\s*([0-9/]+)\s*[-–]\s*([0-9/]+)\s*\](?:\/(\d{1,2})(?:\/(\d{2,4}))?)?([^;]*)/g;

  for (const m of relacheTxt.matchAll(reIntervalRel)) {
    const [, aTxt, bTxt, mmTxt, yyTxt, suffix] = m;

    const mmDef = mmTxt ? Number(mmTxt) : defM;
    const yyDef = yyTxt ? y2k(Number(yyTxt)) : defY;

    const [Ay, Am, Ad] = parseDayMaybeDmY(aTxt, yyDef, mmDef);
    const [By, Bm, Bd] = parseDayMaybeDmY(bTxt, yyDef, mmDef);

    const aDi = mkDateInt(Ay, Am, Ad);
    const bDi = mkDateInt(By, Bm, Bd);
    if (!Number.isFinite(aDi) || !Number.isFinite(bDi)) continue;

    const lo = Math.min(aDi, bDi);
    const hi = Math.max(aDi, bDi);

    const wdTxt = suffix ? suffix.trim() : '';
    const days = parseWeekdaysSuffix(wdTxt); // null => tous les jours
    closedIntervals.push({ lo, hi, days });
  }
  
  // Jours listés (a,b,c)
  for (const m of relacheTxt.matchAll(/\(\s*([\d\s,]+)\s*\)\s*(?:\/(\d{1,2})(?:\/(\d{2,4}))?)?/g)) {
    const [, rawJours, mmTxt, yyTxt] = m;
    const mmDef = mmTxt ? Number(mmTxt) : defM;
    const yyDef = yyTxt ? y2k(Number(yyTxt)) : defY;
    for (const jd of _parseDaysList(rawJours)) {
      regroupRelacheDays.push(mkDateInt(yyDef, mmDef, jd));
    }
  }

  // --- Jours isolés de relâche (hors [] et ())
  {
    const relacheStripped = relacheTxt
      .replace(/\[[^\]]*\]/g, ' ')
      .replace(/\([^)]*\)/g, ' ')
      .replace(/<[^>]*>/g, ' ')
      .replace(/\b\d{1,2}h\d{0,2}\b/gi, ' ')
      .replace(/\b\d{1,3}\s*min(?:s)?\b/gi, ' ');

    const reIso = /\b(\d{1,2})(?:\/(\d{1,2})(?:\/(\d{2,4}))?)?\b/g;
    for (const m of relacheStripped.matchAll(reIso)) {
      const startIdx = m.index ?? 0;

      if (startIdx > 0 && relacheStripped[startIdx - 1] === '/') continue;

      const d  = Number(m[1]);
      const mm = m[2] ? Number(m[2]) : defM;
      const yy = m[3] ? y2k(Number(m[3])) : defY;
      if (Number.isFinite(d) && d >= 1 && d <= 31 &&
          Number.isFinite(mm) && mm >= 1 && mm <= 12 &&
          Number.isFinite(yy)) {
        regroupRelacheDays.push(mkDateInt(yy, mm, d));
      }
    }
  }

  // Parité relâche
  let pariteRelache = null;
  if (/\bjours?\s+pairs?\b/.test(relacheTxt))   pariteRelache = "pair";
  if (/\bjours?\s+impairs?\b/.test(relacheTxt)) pariteRelache = "impair";

  // === Jour de semaine du dateVal ===
  const dayCode = weekdayCodeForDateInt(dv); // "lu"..."di"

  // ===== Étape 1 : Exclusions (relâches)
  for (const it of closedIntervals) {
    const { lo, hi, days } = it;
    if (lo <= dv && dv <= hi) {
      // pas de contrainte de jours -> relâche
      if (!days) return false;

      // Avec contrainte de jours : on regarde le code jour de dv
      const wd = weekdayCodeFromDateInt(dv); // ex "lu", "ma", ...
      if (days.includes(wd)) return false;
    }
  }
  if (regroupRelacheDays.length && regroupRelacheDays.includes(dv)) return false;
  if (pariteRelache) {
    const isEven = dd % 2 === 0;
    if ((pariteRelache === "pair" && isEven) || (pariteRelache === "impair" && !isEven)) return false;
  }

  // ===== Étape 2 : Inclusions (sessions)
  for (const iv of openIntervals) {
    const { lo, hi, days } = iv;
    if (lo <= dv && dv <= hi) {
      // Sans contrainte de jours → OK directement
      if (!days || !days.length) return true;

      // Avec contrainte de jours : on regarde le code jour de dv
      const wd = weekdayCodeFromDateInt(dv); // ex "lu", "ma", ...
      if (days.includes(wd)) return true;
    }
  }
  if (regroupSessionDays.length && regroupSessionDays.includes(dv)) return true;
  if (pariteSession) {
    const isEven = dd % 2 === 0;
    if ((pariteSession === "pair" && isEven) || (pariteSession === "impair" && !isEven)) return true;
  }

  // ===== Étape 3 : défaut
  // S'il y a des contraintes de Session mais aucune ne matche -> false
  if (openIntervals.length || regroupSessionDays.length || pariteSession) return false;

  // Sinon, aucune contrainte de Session -> true (programmable par défaut)
  return true;
}

/**
 * Indique si une valeur est valide pour le champ Relache d'une activité
 * - vide => true
 * - sinon, tous les tokens (séparés par virgules au niveau 0) doivent être valides
 * ───────────────────────────────────────────────────────────
 * Format(s) acceptés, séparés par des virgules :
 *  - "9", "09", 
 *  - "9/7", "09/07", 
 *  - "09/07/25" ou "09/07/2025",
 *  - "(9, 16, 23)/7" pour énumérer des dates du même mois,
 *  - "[9-12]/07", "[30/07-01/08]" pour une période,
 *  - "jours pairs" | "jours impairs",
 *  - chaîne vide => pas de jours de relâche.
 * Mois et année par défaut = mois et année du début de la période de programmation.
 * On valide que *tous* les tokens sont valides.
 * ───────────────────────────────────────────────────────────
 */
function _estRelacheValide(val) {
  const s = String(val ?? '').trim();
  if (s === '') return true;               // vide = OK (pas de relâche)
  
  const tokens = _tokenizeSpecs(s);
  if (!tokens.length) return false;

  const now = new Date();
  const defaultYear = now.getFullYear();
  const defaultMonth = now.getMonth() + 1;

  // Tous les tokens doivent être valides
  return tokens.every(tok => _parseOneToken(tok, { defaultMonth, defaultYear }));
}

/**
 * Indique si une valeur est valide pour le champ Session d'une activité
 * - vide => true
 * - sinon, tous les tokens (séparés par virgules au niveau 0) doivent être valides
 * ───────────────────────────────────────────────────────────
 * Format(s) acceptés, séparés par des virgules :
 *  - "9", "09", 
 *  - "9/7", "09/07", 
 *  - "09/07/25" ou "09/07/2025",
 *  - "(9, 16, 23)/7" pour énumérer des dates du même mois,
 *  - "[9-12]/07", "[30/07-01/08]" pour une période,
 *  - "jours pairs" | "jours impairs",
 *  - chaîne vide => tous les jours de la période programmation.
 * Mois et année par défaut = mois et année du début de la période de programmation.
 * On valide que *tous* les tokens sont valides.
 * ───────────────────────────────────────────────────────────
 */
function _estSessionValide(val, { default_year = null, default_month = null } = {}) {
  const s = String(val ?? '').trim();
  if (s === '') return true;               // vide = OK (pas de relâche)
  
  const tokens = _tokenizeSpecs(s);
  if (!tokens.length) return false;

  const now = new Date();
  const defaultYear = now.getFullYear();
  const defaultMonth = now.getMonth() + 1;

  // Tous les tokens doivent être valides
  return tokens.every(tok => _parseOneToken(tok, { defaultMonth, defaultYear }));
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
function _getActivitesProgrammeesDuJourTriees(jour){
  return _getActivitesProgrammees(_ctx.df).filter(r => r.Date === jour)
               .map(r => ({...r, _min: mmFromHHhMM(r['Debut']), _dur: mmFromHHhMM(r['Duree'])||0}))
               .filter(r => r._min!=null)
               .sort((a,b)=>a._min - b._min);
}

// Calcule les jours possibles pour programmer une activité en tenant compte 
// de la période de programmation des séances et relaches et des activités déja programmées
function _getJoursPossibles(rowActivite) {
  const jours = [];
  const heureMinute = mmFromHHhMM(rowActivite['Debut']);
  const duree    = mmFromHHhMM(rowActivite['Duree']);
  if (heureMinute == null || duree == null) return jours;
  const finAct   = heureMinute + duree;

  for (let jour = dateToDateint(_ctx.getMetaParam("periode_a_programmer_debut")); jour <= dateToDateint(_ctx.getMetaParam("periode_a_programmer_fin")); jour++) {
    if (!_estDateValide(jour, rowActivite.Session, rowActivite.Relache)) continue;

    if (_estActiviteChevauchable(rowActivite)) {
      jours.push(jour);
      continue;
    }

    const jList = _getActivitesProgrammeesDuJourTriees(jour);
    if (jList.length === 0) { // journée libre
      jours.push(jour);
      continue;
    }

    // 1) créneau 00:00 → première activité
    const first = jList[0];
    const borne_inf = 0;           // 00:00
    const borne_sup = first._min;  // début de la 1ère activité
    if (heureMinute >= borne_inf && finAct <= (borne_sup - _MARGE)) {
      jours.push(jour);
      continue;
    }

    // 2) créneaux entre activités programmées
    let ok = false;
    for (const ref of jList) {
      const [debut_min, fin_max ] = _getCreneauBoundsApres(jList, ref);
      const afterMin = debut_min + _MARGE;
      const beforeMax = (fin_max == null) ? null : (fin_max - _MARGE);
      const fits = (heureMinute >= afterMin) && (beforeMax == null ? true : finAct <= beforeMax);
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
 * Renvoie les activités programmables sur une journée entière donc les activités qui ne sont pas relache ce jour
 * @param {*} dateRef 
 * @param {*} traiterPauses 
 * @returns 
 */
function _getActivitesProgrammablesSurJourneeEntiere(dateRef, traiterPauses = true) {
  const proposables = [];
  const nonProgrammees = _getActivitesNonProgrammees(_ctx?.df); 

  for (const row of nonProgrammees) {
    if (_estActiviteValideADate(row, dateRef)) {
      const nouvelleLigne = { ...row };
      // delete nouvelleLigne.Debut_dt;
      // delete nouvelleLigne.Duree_dt;
      nouvelleLigne.__type_activite = 'ActiviteExistante';
      nouvelleLigne.__index = row.__uuid;
      proposables.push(nouvelleLigne);
    }
  }

  if (traiterPauses) {
    // minutes (meta par défaut : 60 min)
    const meta = _ctx?.meta || {};
    const DUREE_REPAS = Math.max(0, Number(meta.DUREE_REPAS ?? 60) | 0); // minutes

    const pad2 = n => { n = n|0; return n < 10 ? '0'+n : ''+n; };
    const minToHhmm = t => `${(t/60|0)}h${pad2(t%60)}`;
    const dureeStr = m => `${(m/60|0)}h${pad2(m%60)}`;

    const completerLigne = (ligne) => ({
      ...ligne,
      Date: dateRef,    // conserve ton dateRef
      Reserve: '',
      Relache: '',
      Marqueur: '',
      Lieu: '',
    });

    // minuteOfDay = minutes depuis 00:00
    const mkPauseAt = (minuteOfDay, typeRepas) => {
      const debut = minuteOfDay | 0;
      const fin   = debut + DUREE_REPAS;
      return completerLigne({
        Debut:  minToHhmm(debut),
        Fin:    minToHhmm(fin),
        Duree:  dureeStr(DUREE_REPAS),
        Activite: `Pause ${typeRepas}`,
        __type_activite: typeRepas,
        __uuid: genUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`
      });
    };

    // Exemples : 12:00 et 20:00
    proposables.push(mkPauseAt(12 * 60, 'déjeuner'));
    proposables.push(mkPauseAt(20 * 60, 'dîner'));
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
 * Valide un "token" de Session / Relâche.
 * Gère notamment :
 *  - parité : "jours pairs", "jours impairs"
 *  - jour isolé : "23", "23/7", "23/07/25"
 *  - liste : "(9,16,23)", "(9,16,23)/7", "(9,16,23)/07/25"
 *  - intervalle :
 *       [5-26]
 *       [5-26]/07
 *       [19/11-03/12]
 *       [19/11/25-03/12/26]
 *       [10-13]/08 ma me
 *       [19/11-03/12] me je ve
 *
 * Règles pour les intervalles :
 *  - soit on factorise mois(/année) : [10-13]/08 ou [10-13]/08/25
 *  - soit on met les mois (et années) dans chacune des bornes : [10/11-01/12], [10/11/25-01/12/26]
 *  - pas de mélange "mois externe" + "mois interne"
 *  - pas de mélange "année sur une borne seulement"
 *
 * @param {string} tok
 * @param {{ defaultMonth?: number, defaultYear?: number }} [opts]
 */
function _parseOneToken(tok, { defaultMonth, defaultYear } = {}) {
  let t = String(tok || '').toLowerCase().trim();
  if (!t) return false;

  // 1) Parité
  if (/^jours?\s+(pairs?|impairs?)$/.test(t)) return true;

  // Helpers
  const _validMonth = (m) => m == null || _isIntInRange(m, 1, 12);
  const _validDay   = (d) => _isIntInRange(d, 1, 31);
  const _validYear  = (y) => y == null || Number.isFinite(Number(y));

  // 2) Jour isolé : "23", "23/7", "23/07/25"
  {
    const m = t.match(/^(\d{1,2})(?:\/(0?[1-9]|1[0-2]))?(?:\/(\d{2,4}))?$/);
    if (m) {
      const [, d, mm, yy] = m;
      const D = Number(d);
      const M = mm ? Number(mm) : (defaultMonth ?? null);
      const Y = yy ? Number(yy) : (defaultYear ?? null);
      return _validDay(D) && _validMonth(M) && _validYear(Y);
    }
  }

  // 3) Liste : "(9,16,23)", "(9,16,23)/7", "(9,16,23)/07/25"
  {
    const m = t.match(/^\(\s*([0-9,\s]+)\s*\)(?:\/(0?[1-9]|1[0-2]))?(?:\/(\d{2,4}))?$/);
    if (m) {
      const [, list, mm, yy] = m;
      const M = mm ? Number(mm) : (defaultMonth ?? null);
      const Y = yy ? Number(yy) : (defaultYear ?? null);
      if (!_validMonth(M) || !_validYear(Y)) return false;

      const days = list.split(',').map(s => s.trim()).filter(Boolean);
      if (!days.length) return false;
      return days.every(d => _validDay(Number(d)));
    }
  }

  // 4) Intervalle avec éventuellement des jours de semaine :
  //    "[10-13]/08 ma me", "[19/11-03/12] me je ve", etc.
  //
  //    On sépare la "partie intervalle" du suffixe de jours de semaine.
  //    Les jours de semaine sont facultatifs et ignorés pour la validation.
  if (t.startsWith('[')) {
    // lu, ma, me, je, ve, sa, di + versions longues
    const reDaysSuffix =
      /^(\[[^\]]+\](?:\/\d{1,2}(?:\/\d{2,4})?)?)\s+(?:lu|ma|me|je|ve|sa|di|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)(?:[\s,]+(?:lu|ma|me|je|ve|sa|di|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche))*$/;
    const md = t.match(reDaysSuffix);
    let main = t;
    if (md) {
      main = md[1].trim(); // on ne garde que la partie [ ... ](/MM[/YY])
    }

    // Intervalle général :
    // [d1[-/m1[/y1]] - d2[-/m2[/y2]]] (mois/année facultatifs sur chaque borne)
    // avec éventuellement "/MM[/YY]" factorisé après le crochet.
    const reInterval = /^\[\s*(\d{1,2})(?:\/(\d{1,2})(?:\/(\d{2,4}))?)?\s*-\s*(\d{1,2})(?:\/(\d{1,2})(?:\/(\d{2,4}))?)?\s*\](?:\/(\d{1,2})(?:\/(\d{2,4}))?)?$/;

    const m = main.match(reInterval);
    if (m) {
      const [
        _whole,
        d1, m1, y1,
        d2, m2, y2,
        mExt, yExt,
      ] = m;

      const D1 = Number(d1);
      const D2 = Number(d2);
      const M1 = m1 ? Number(m1) : null;
      const M2 = m2 ? Number(m2) : null;
      const Y1 = y1 ? Number(y1) : null;
      const Y2 = y2 ? Number(y2) : null;
      const Mext = mExt ? Number(mExt) : null;
      const Yext = yExt ? Number(yExt) : null;

      // jours valides
      if (!_validDay(D1) || !_validDay(D2)) return false;

      // Cas A : mois (et éventuellement année) factorisés après le crochet :
      //   [10-13]/08
      //   [10-13]/08/25
      if (Mext != null) {
        // pas le droit d'avoir aussi des mois/années internes
        if (M1 != null || M2 != null || Y1 != null || Y2 != null) return false;
        if (!_validMonth(Mext) || !_validYear(Yext)) return false;
        return true;
      }

      // Cas B : pas de mois externe → on regarde les bornes
      // - si un mois est renseigné sur une borne, il doit l'être sur l'autre
      if ((M1 != null) !== (M2 != null)) return false;
      if (!_validMonth(M1) || !_validMonth(M2)) return false;

      // - si une année est renseignée sur une borne, elle doit l'être sur l'autre
      if ((Y1 != null) !== (Y2 != null)) return false;
      if (!_validYear(Y1) || !_validYear(Y2)) return false;

      // Ici on ne vérifie pas l'ordre chronologique (d1<=d2) en cas de
      // changement de mois/année : on se contente de la validité syntaxique.
      // Pour un intervalle intra-mois sans mois : [5-26] → OK
      // Pour intra-mois avec mois: [5/07-26/07] → OK
      // Pour inter-mois: [19/11-03/12] → OK (M1, M2 tous deux présents)
      // Pour inter-années: [19/11/25-03/12/26] → OK (Y1, Y2 tous deux présents)
      return true;
    }
  }

  // 5) Intervalle simple d'origine : "[5-26]", "[5-26]/7"
  // (on le garde pour compat, mais il sera en pratique déjà capté par la regex ci-dessus)
  {
    const m = t.match(/^\[\s*(\d{1,2})\s*-\s*(\d{1,2})\s*\](?:\/(0?[1-9]|1[0-2]))?$/);
    if (m) {
      const [, d1, d2, mm] = m;
      const D1 = Number(d1);
      const D2 = Number(d2);
      const M  = mm ? Number(mm) : (defaultMonth ?? null);
      const okDays  = _validDay(D1) && _validDay(D2) && D1 <= D2;
      const okMonth = _validMonth(M);
      return okDays && okMonth;
    }
  }

  // Rien de ce qui précède n'a matché → non valide
  return false;
}

/**
 * Ajoute des pauses (déjeuner, dîner, café) dans une liste de propositions pour un créneau donné.
 *
 * @param {Array<Object>} proposables - liste mutable de lignes "proposables"
 * @param {Array<Object>} activites_programmees - DataFrame-like (liste d'activités)
 * @param {Object} ligne_ref - activité de référence
 * @param {'Avant'|'Après'} type_creneau
 */
function _ajouterPauses(proposables, activites_programmees, ligne_ref, type_creneau) {
  const date_ref = ligne_ref.Date;

  // --- Constantes "Session"
  const meta = (_ctx.meta) || {};
  const MARGE       = Math.max(0, Number(meta.MARGE        ?? 30) | 0); // minutes
  const DUREE_REPAS = Math.max(0, Number(meta.DUREE_REPAS  ?? 60) | 0); // minutes
  const DUREE_CAFE  = Math.max(0, Number(meta.DUREE_CAFE   ?? 60) | 0); // minutes

  // --- Fenêtres des repas (en minutes depuis minuit)
    const DEJ_DEBUT_MIN = 11 * 60;  // 12:00
    const DEJ_DEBUT_MAX = 14 * 60;  // 14:00
    const DIN_DEBUT_MIN = 19 * 60;  // 19:00
    const DIN_DEBUT_MAX = 21 * 60;  // 21:00

  // --- Helpers minutes
  function pad2(n) { n = n|0; return (n < 10 ? '0' : '') + n; }
  function minToHhmm(total) {
    total = Math.max(0, total|0); // borne basse 0
    const h = Math.floor(total / 60);
    const mm = total % 60;
    return `${h}h${pad2(mm)}`;
  }
  function clamp(x, lo, hi) { return Math.max(lo, Math.min(x, hi)); }
  function dureeStr(minutes) {
    const h = Math.floor((minutes|0) / 60), mm = (minutes|0) % 60;
    return `${h}h${pad2(mm)}`;
  }
  const completerLigne = (d) => ({
    ...d,
    Date: date_ref,
    Reserve: 'Non',
    Relache: null,
  });

  // --- Bornes du créneau (en minutes)
  let debut_min, fin_max; // fin_max peut être null si "Après" dépasse 23:59
  if (type_creneau === 'Avant') {
    ([debut_min, fin_max]  = _getCreneauBoundsAvant(activites_programmees, ligne_ref)); // minutes
  } else if (type_creneau === 'Après') {
    ([debut_min, fin_max] = _getCreneauBoundsApres(activites_programmees, ligne_ref)); // minutes (fin_max peut être null)
  } else {
    console.error("type_creneau doit être 'Avant' ou 'Après'");
    return;
  }

  // --- 1) Pause repas (déjeuner / dîner)
  const ajouterPauseRepas = (pause_debut_min, pause_debut_max, type_repas) => {
    if (_pauseDejaExistante(activites_programmees, date_ref, type_repas)) return;

    if (type_creneau === 'Avant') {
      // position candidate = fin_max - (durée repas + marge), bornée dans [fenêtre repas]
      let h_repas = fin_max - (DUREE_REPAS + MARGE);
      h_repas = clamp(h_repas, pause_debut_min, pause_debut_max);

      if ((h_repas - MARGE) >= debut_min && (h_repas + MARGE) <= fin_max) {
        proposables.push(completerLigne({
          Debut:  minToHhmm(h_repas),
          Fin:    minToHhmm(h_repas + DUREE_REPAS),
          Duree:  dureeStr(DUREE_REPAS),
          Activite: `Pause ${type_repas}`,
          __type_activite: type_repas,
          __uuid: genUUID()
        }));
      }

    } else { // 'Après'
      // position candidate = debut_min + marge, bornée dans [fenêtre repas]
      let h_repas = debut_min + MARGE;
      h_repas = clamp(h_repas, pause_debut_min, pause_debut_max);

      const repFin = h_repas + DUREE_REPAS;
      const borneFinOk = (fin_max == null) || (repFin <= fin_max);
      if ((h_repas - MARGE) >= debut_min && borneFinOk) {
        proposables.push(completerLigne({
          Debut:  minToHhmm(h_repas),
          Fin:    minToHhmm(repFin),
          Duree:  dureeStr(DUREE_REPAS),
          Activite: `Pause ${type_repas}`,
          __type_activite: type_repas,
          __uuid: genUUID()
        }));
      }
    }
  };

  // --- 2) Pause café
  const ajouterPauseCafe = () => {
    if (_estPause(ligne_ref)) return;

    const idx = activites_programmees.findIndex(r => r === ligne_ref);
    const lieuRef  = ligne_ref.Lieu || null;
    const lignePrev = idx > 0 ? activites_programmees[idx - 1] : null;
    const ligneNext = idx < activites_programmees.length - 1 ? activites_programmees[idx + 1] : null;
    const Lieu_prev = lignePrev?.Lieu;
    const Lieu_next = ligneNext?.Lieu;

    if (type_creneau === 'Avant') {
      const h_cafe = (fin_max - DUREE_CAFE);
      if (lieuRef && Lieu_prev && lieuRef === Lieu_prev) {
        if (h_cafe >= debut_min) {
          proposables.push(completerLigne({
            Debut: minToHhmm(h_cafe),
            Fin:   minToHhmm(h_cafe + DUREE_CAFE),
            Duree: dureeStr(DUREE_CAFE),
            Activite: 'Pause café',
            __type_activite: 'café',
            __uuid: genUUID()
          }));
        }
      } else {
        const margeCafe = (debut_min === 0) ? 0 : MARGE;
        if (h_cafe >= (debut_min + margeCafe)) {
          proposables.push(completerLigne({
            Debut: minToHhmm(h_cafe),
            Fin:   minToHhmm(h_cafe + DUREE_CAFE),
            Duree: dureeStr(DUREE_CAFE),
            Activite: 'Pause café',
            __type_activite: 'café',
            __uuid: genUUID()
          }));
        }
      }

    } else { // 'Après'
      const h_cafe = debut_min;
      const finCafe = h_cafe + DUREE_CAFE;

      if (lieuRef && Lieu_next && lieuRef === Lieu_next) {
        if (fin_max == null || finCafe <= fin_max) {
          proposables.push(completerLigne({
            Debut: minToHhmm(h_cafe),
            Fin:   minToHhmm(finCafe),
            Duree: dureeStr(DUREE_CAFE),
            Activite: 'Pause café',
            __type_activite: 'café',
            __uuid: genUUID()
          }));
        }
      } else {
        const margeCafe = (fin_max != null) ? MARGE : 0;
        const borneOk = (fin_max == null) || (finCafe <= (fin_max - margeCafe));
        if (borneOk) {
          proposables.push(completerLigne({
            Debut: minToHhmm(h_cafe),
            Fin:   minToHhmm(finCafe),
            Duree: dureeStr(DUREE_CAFE),
            Activite: 'Pause café',
            __type_activite: 'café',
            __uuid: genUUID()
          }));
        }
      }
    }
  };

  // --- Appels
  ajouterPauseRepas(DEJ_DEBUT_MIN, DEJ_DEBUT_MAX, 'déjeuner');
  ajouterPauseRepas(DIN_DEBUT_MIN, DIN_DEBUT_MAX, 'dîner');
  // ajouterPauseCafe(); // décommente si tu veux proposer les cafés aussi
}


/**
 * Vérifie si une pause d’un type donné est déjà présente pour un jour donné
 * dans la liste des activités programmées.
 *
 * @param {Array<Object>} activites_programmees - Liste d'activités (chaque objet doit avoir .Date et .Activite)
 * @param {number|string} jour - Date (entier YYYYMMDD ou équivalent)
 * @param {string} type_pause - Type de pause à rechercher ("déjeuner", "dîner", "café", etc.)
 * @returns {boolean}
 */
function _pauseDejaExistante(activites_programmees, jour, type_pause) {
  if (!Array.isArray(activites_programmees) || !type_pause) return false;

  const typeLower = String(type_pause).toLowerCase();

  return activites_programmees.some(a =>
    a &&
    a.Date == jour && // comparaison non stricte volontaire (nombre ou chaîne)
    typeof a.Activite === 'string' &&
    a.Activite.toLowerCase().includes(typeLower)
  );
}

/**
 * Cherche un nom d'activité non encore alloué dans un DataFrame
 * @param {*} df 
 * @returns 
 */
function _getNouveauNomActivite(df, prefix='Activité') {
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
}

/** 
 * Indique si une valeur est valide pour le champ Debut d'une activité
 * "10h00" (1–2 chiffres pour l’heure, 2 chiffres pour les minutes) 
 */
function _estHeureValide(val) {
  if (val == null) return false;
  const s = String(val).trim();
  return /^\d{1,2}h\d{2}$/.test(s);
}

/** 
 * Indique si une valeur est valide pour le champ Duree d'une activité
 * "1h00" (minutes 00–59) 
 */
function _estDureeValide(val) {
  if (val == null) return false;
  const s = String(val).trim();
  return /^\d{1,2}h[0-5]\d$/.test(s);
}

function _estPause(activite) {
  const val = String(activite?.Activite ?? '').trim();
  return _estNomPause(val);
}

function _estNomPause(val) {
  if (!val) return false;
  const mots = String(val).trim().split(/\s+/);
  if (!mots.length) return false;
  return mots[0].toLowerCase() === 'pause';
}

/**
 * Renvoie la liste des plages libres entre activités d'un tableaau d'activités.
 * Contrairement à getCreneaux on ne vérifie pas s'il existe des activités programmables 
 * dans chacune des plages libres trouvées.
 * @param {*} activites 
 */
function _getPlagesLibres(activites) {
  const creneaux = [];
  let bornes = []; // liste des [min,max] déjà vus (évite doublons)

    for (const row of activites) {
      const d = heureMinute(row), du = dureeMinute(row);
      const heureDebut = Number.isFinite(d) ? d : null;
      const heureFin   = (Number.isFinite(d) && Number.isFinite(du)) ? d + du : null;

      // ---- Créneau AVANT ----
      if (heureDebut != null) {
          const [bMin, bMax, prev] = _getCreneauBoundsAvant(activites, row);
          if (bMin < bMax) {
            const key = `${row.Date}-${bMin}-${bMax}`;
            if (!bornes.includes(key)) {
              bornes.push(key);
              creneaux.push(
                _creerCreneau(row, bMin, bMax, prev?.Activite || prev?.Activité || "", row.Activite || row.Activité || "", "Avant")
              );
            }
          }
      }

      // ---- Créneau APRÈS ----
      if (heureFin != null) {
          const [bMin, bMax, next] = _getCreneauBoundsApres(activites, row);
          const max = (bMax == null ? MAX_DAY : bMax);
          if (bMin < max) {
            const key = `${row.Date}-${bMin}-${max}`;
            if (!bornes.includes(key)) {
              bornes.push(key);
              creneaux.push(
                _creerCreneau(row, bMin, max, row.Activite || row.Activité || "", next?.Activite || next?.Activité || "", "Après")
              );
            }
          }
        }
    }

  // tri par Date (string -> int)
  creneaux.sort((a,b) => (parseInt(a.Date,10) || 0) - (parseInt(b.Date,10) || 0));
  return creneaux;
}

/** 
 * Renvoie la période à programmer
 */
function _getPeriodeProgrammation() {
  return {
    debut: _ctx?.getMetaParam("periode_a_programmer_debut") ?? null,
    fin:   _ctx?.getMetaParam("periode_a_programmer_fin") ?? null
  };
}

// renvoie sous forme de dateint les bornes d'un intervalle de type [d1-d2] avec d1 et d2 pretty ou [10-13]/08 ou [10-13]/08/25
function _getMinMaxFromPrettyRange(chip) {
  const s = String(chip || "").trim();

  // 1) Nouveau format : [15-16]/07 ou [15-16]/07/26 ou [15-16]/07/2026
  {
    const m = s.match(/^\[\s*(\d{1,2})\s*-\s*(\d{1,2})\s*\]\s*\/\s*(\d{1,2})(?:\s*\/\s*(\d{2}|\d{4}))?\s*$/);
    if (m) {
      const d1 = parseInt(m[1], 10);
      const d2 = parseInt(m[2], 10);
      const mm = parseInt(m[3], 10);
      const yyRaw = m[4];

      // normalise année si 2 chiffres
      let year = null;
      if (yyRaw) {
        const y = parseInt(yyRaw, 10);
        year = (yyRaw.length === 2) ? (2000 + y) : y;
      }

      // deux pretty compatibles avec prettyToDateint
      const p1 = `${d1}/${mm}${year ? `/${year}` : ""}`;
      const p2 = `${d2}/${mm}${year ? `/${year}` : ""}`;

      const a = prettyToDateint(p1);
      const b = prettyToDateint(p2);
      if (a == null || b == null) return null;

      return [Math.min(a, b), Math.max(a, b)];
    }
  }

  // 2) Format existant : [d1-d2] ou d1-d2 (en pretty)
  const inside = s.startsWith("[") && s.endsWith("]") ? s.slice(1, -1).trim() : s;
  const m = inside.match(/^(.+?)\s*-\s*(.+)$/);
  if (!m) return null;

  const a = prettyToDateint(m[1]);
  const b = prettyToDateint(m[2]);
  if (a == null || b == null) return null;

  return [Math.min(a, b), Math.max(a, b)];
}

// renvoie liste de dateInt entre deux dateint a et b inclus (a/b en YYYYMMDD int)
function _expandRangeToDateintList(a, b) {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  const out = [];
  let d = dateintToDate(lo);
  const end = dateintToDate(hi);

  // garde-fou (évite boucle infinie si date invalide)
  for (let i = 0; i < 370; i++) {
    const di = dateToInt(d.getFullYear(), d.getMonth() + 1, d.getDate());
    out.push(di);
    if (di === hi) break;
    d.setDate(d.getDate() + 1);
    if (d > end && di !== hi) break;
  }
  return out;
}

// jour de semaine en FR -> 0..6 (0=dimanche)
function _parseWeekdayFR(s) {
  const t = String(s || "").trim().toLowerCase();
  const map = {
    "dimanche": 0, "dim": 0,
    "lundi": 1, "lun": 1,
    "mardi": 2, "mar": 2,
    "mercredi": 3, "mer": 3,
    "jeudi": 4, "jeu": 4,
    "vendredi": 5, "ven": 5,
    "samedi": 6, "sam": 6,
  };
  return (t in map) ? map[t] : null;
}

// toutes les dates du weekday entre meta.dateMinInt et meta.dateMaxInt
function _expandWeekdayToDateInts(weekday) {
  const {debut, fin} = _getPeriodeProgrammation();
  if (!debut || !fin) return []; // il faut un bornage 
  const days = _expandRangeToDateintList(dateToDateint(debut), dateToDateint(fin));
  return days.filter(di => dateintToDate(di).getDay() === weekday);
}