/** Types de la page d'accueil, partagés avec le front (voir `web/src/home.ts`). */

export type HomeControllerSupport = 'none' | 'partial' | 'full';

/** Sources d'activité dérivée, toujours des bornes et jamais une date exacte. */
export type HomeLastActivitySource =
  'sync_delta' | 'recent_window' | 'achievement';

export type HomeLastActivityPrecision = 'upper_bound' | 'lower_bound';

/** Temps choisi dans le menu : une préférence, jamais une durée de session. */
export type HomeTemps = 30 | 45 | 60 | 120;

export type HomeIntention = 'continuer' | 'decouvrir' | 'finir';

export type HomeLancement = 'tous' | 'deja' | 'jamais';

export interface HomeGenre {
  id: number;
  label: string;
}

/** Jeu renvoyé par l'accueil, enrichi d'une raison courte calculée serveur. */
export interface HomeGame {
  appId: number;
  name: string;
  genres: string[];
  controllerSupport: HomeControllerSupport;
  headerImageUrl: string | null;
  playtimeForever: number;
  playtimeLast2Weeks: number;
  lastActivityAt: string | null;
  lastActivitySource: HomeLastActivitySource | null;
  lastActivityPrecision: HomeLastActivityPrecision | null;
  achievementsUnlocked: number | null;
  achievementsTotal: number | null;
  /** Raison courte construite côté serveur ; le front ne recalcule pas. */
  reason: string | null;
}

/** Jeu de référence de la sélection, avec son genre principal déduit. */
export interface HomeAnchor {
  appId: number;
  name: string;
  genres: string[];
  /** Alignés index par index sur `genres` (voir `genre_ids`). */
  genreIds: number[];
  controllerSupport: HomeControllerSupport;
  headerImageUrl: string | null;
  mainGenre: HomeGenre | null;
}

export interface HomeSelection {
  anchor: HomeAnchor | null;
  /** Genre à privilégier (bonus de score, jamais un filtre strict). */
  genre: HomeGenre | null;
  /** Préférence de découverte, 10 à 100. */
  decouverte: number;
  /** `true` = manette complète ou partielle. */
  manette: boolean;
  lancement: HomeLancement;
  /** `true` = jeux proches du 100 % de succès. */
  progression: boolean;
  items: HomeGame[];
}

export interface HomeCategories {
  aFinir: HomeGame[];
  aDecouvrir: HomeGame[];
  aRetrouver: HomeGame[];
}

/** Signaux lisibles du dialogue « Pourquoi ce jeu ? ». */
export interface HomeMenuSignals {
  continuite: string;
  progression: string;
  decouverte: string;
  similarite: string;
  temps: string;
  manette: string;
}

export interface HomeMenuResponse {
  temps: HomeTemps;
  intention: HomeIntention;
  manette: boolean;
  resultat: HomeGame | null;
  signals: HomeMenuSignals | null;
}

export interface HomeResponse {
  jeuDuMoment: HomeGame | null;
  selection: HomeSelection;
  categories: HomeCategories;
  menu: HomeMenuResponse;
  ancresRecentes: HomeGame[];
}
