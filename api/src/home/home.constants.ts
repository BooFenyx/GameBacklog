import type { HomeIntention, HomeTemps } from './home.types.js';

/** Nombre de jeux du deck « Sélection du chef ». */
export const HOME_SELECTION_TAILLE = 5;

/** Nombre d'ancres proposées pour le sélecteur et le copilote. */
export const HOME_ANCRES_TAILLE = 5;

/** Nombre de jeux par catégorie (l'UI en affiche 3 à la fois et fait défiler). */
export const HOME_CATEGORIE_TAILLE = 9;

/** Préférence de découverte par défaut, en pourcentage. */
export const HOME_DECOUVERTE_DEFAUT = 30;

/** Bornes du curseur de découverte : 0 n'est pas proposé. */
export const HOME_DECOUVERTE_MIN = 10;
export const HOME_DECOUVERTE_MAX = 100;

/** Menu par défaut : 45 min, continuer, sans filtre manette. */
export const HOME_MENU_TEMPS_DEFAUT: HomeTemps = 45;
export const HOME_MENU_INTENTION_DEFAUT: HomeIntention = 'continuer';
export const HOME_MENU_MANETTE_DEFAUT = false;

/**
 * Poids du score de la sélection. Le genre est un **bonus** (jamais un filtre)
 * et la découverte est plafonnée à 30 % pour ne pas écraser la similarité.
 */
export const SELECTION_POIDS = {
  similarite: 0.55,
  genre: 0.5,
  activite: 0.1,
  progression: 0.05,
  decouverteMax: 0.3,
} as const;

/** Poids d'activité dérivée, selon la source. */
export const ACTIVITE_POIDS = {
  sync_delta: 1,
  recent_window: 0.8,
  achievement: 0.5,
} as const;

/** Poids de nouveauté : préférence calculée sur le temps de jeu, pas une session. */
export const NOUVEAUTE_POIDS = {
  jamaisLance: 1,
  moinsDe2h: 0.7,
  moinsDe10h: 0.4,
  autre: 0.1,
} as const;

/**
 * Préférence de temps du menu. `temps` reste une préférence : aucune durée de
 * session n'est connue ni promise.
 */
export const MENU_PREFERENCE_TEMPS = {
  30: { continuite: 0.15, progression: 0.85, duree: 0, dureeMax: 1800 },
  45: { continuite: 0.3, progression: 0.7, duree: 0, dureeMax: 1800 },
  60: { continuite: 0.55, progression: 0.25, duree: 0.2, dureeMax: 1800 },
  120: { continuite: 0.4, progression: 0.2, duree: 0.4, dureeMax: 3600 },
} as const;

/**
 * Poids du score du menu par intention. Toutes les intentions partagent la même
 * formule : les signaux non pertinents ont simplement un poids nul.
 */
export const MENU_POIDS_INTENTION = {
  continuer: {
    continuite: 0.45,
    progression: 0.2,
    similarite: 0.25,
    decouverte: 0,
    temps: 0.1,
  },
  decouvrir: {
    continuite: 0,
    progression: 0,
    similarite: 0.3,
    decouverte: 0.6,
    temps: 0.1,
  },
  finir: {
    continuite: 0.25,
    progression: 0.55,
    similarite: 0,
    decouverte: 0,
    temps: 0.2,
  },
} as const;
