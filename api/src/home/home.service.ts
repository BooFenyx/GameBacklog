import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { libellesGenresUtilisateur } from '../catalog/genres.js';
import { DB, type Db } from '../db/db.module.js';
import {
  ACTIVITE_POIDS,
  HOME_ANCRES_TAILLE,
  HOME_CATEGORIE_TAILLE,
  HOME_DECOUVERTE_DEFAUT,
  HOME_DECOUVERTE_MAX,
  HOME_DECOUVERTE_MIN,
  HOME_MENU_INTENTION_DEFAUT,
  HOME_MENU_MANETTE_DEFAUT,
  HOME_MENU_TEMPS_DEFAUT,
  HOME_SELECTION_TAILLE,
  MENU_POIDS_INTENTION,
  MENU_PREFERENCE_TEMPS,
  NOUVEAUTE_POIDS,
  SELECTION_POIDS,
} from './home.constants.js';
import { genrePrincipal } from './genre-principal.js';
import type {
  HomeAnchor,
  HomeCategories,
  HomeControllerSupport,
  HomeGame,
  HomeGenre,
  HomeIntention,
  HomeLastActivityPrecision,
  HomeLastActivitySource,
  HomeMenuResponse,
  HomeMenuSignals,
  HomeResponse,
  HomeSelection,
  HomeTemps,
} from './home.types.js';
import type { HomeSelectionQueryDto } from './dto/home-selection-query.dto.js';
import type { HomeMenuQueryDto } from './dto/home-menu-query.dto.js';

/** Ligne commune `library_entries ⋈ games` lue par l'accueil. */
interface LigneAccueil {
  id: number;
  appId: number;
  name: string;
  shortDescription: string | null;
  genres: string[] | null;
  genreIds: number[] | null;
  controllerSupport: HomeControllerSupport;
  headerImageUrl: string | null;
  achievementsTotal: number | null;
  achievementsUnlocked: number | null;
  playtimeForever: number;
  playtimeLast2Weeks: number;
  lastActivityAt: Date | string | null;
  lastActivitySource: HomeLastActivitySource | null;
  lastActivityPrecision: HomeLastActivityPrecision | null;
}

/** Candidat scoré : la ligne d'accueil plus la similarité calculée en SQL. */
interface LigneCandidat extends LigneAccueil {
  similarite: number | string | null;
  similariteEmbedding: boolean;
}

/** Filtres appliqués aux candidats du deck (le genre n'en fait jamais partie). */
export interface FiltresSelection {
  /** `true` = manette complète ou partielle. */
  manette: boolean;
  lancement: 'tous' | 'deja' | 'jamais';
  /** `true` = ratio de succès ≥ 75 %. */
  progression: boolean;
}

/** Filtres par défaut du deck : aucun filtre. */
const FILTRES_SELECTION_DEFAUT: FiltresSelection = {
  manette: false,
  lancement: 'tous',
  progression: false,
};

/** Colonnes communes à toutes les lectures de l'accueil. */
const COLONNES_ACCUEIL = `
  g.id,
  g.app_id AS "appId",
  g.name,
  g.short_description AS "shortDescription",
  g.genres,
  g.genre_ids AS "genreIds",
  g.controller_support AS "controllerSupport",
  g.header_image_url AS "headerImageUrl",
  CASE
    WHEN g.achievements_fetched_at IS NULL THEN NULL
    ELSE g.achievements_total
  END AS "achievementsTotal",
  CASE
    WHEN le.achievements_fetched_at IS NULL THEN NULL
    ELSE le.achievements_unlocked
  END AS "achievementsUnlocked",
  le.playtime_forever AS "playtimeForever",
  le.playtime_last_2_weeks AS "playtimeLast2Weeks",
  le.last_activity_at AS "lastActivityAt",
  le.last_activity_source AS "lastActivitySource",
  le.last_activity_precision AS "lastActivityPrecision"
`;

/** Date renvoyée au front en ISO ; `pg` rend déjà un `Date` pour timestamptz. */
function normaliserDate(valeur: Date | string | null): string | null {
  if (valeur === null) return null;
  return valeur instanceof Date ? valeur.toISOString() : valeur;
}

/** Ramène une similarité cosinus dans [0, 1] (bruit flottant de pgvector). */
export function bornerSimilarite(valeur: number): number {
  if (!Number.isFinite(valeur)) return 0;
  return Math.min(Math.max(valeur, 0), 1);
}

/** Poids d'activité dérivée, 0 quand aucune activité n'est connue. */
export function poidsActivite(source: HomeLastActivitySource | null): number {
  return source ? ACTIVITE_POIDS[source] : 0;
}

/**
 * Progression de succès, 0 tant que la donnée n'est pas disponible, que le jeu
 * n'a pas de succès ou qu'il est déjà à 100 %.
 */
export function poidsProgression(
  unlocked: number | null,
  total: number | null,
): number {
  if (unlocked === null || total === null || total <= 0 || unlocked >= total) {
    return 0;
  }
  return unlocked / total;
}

/** Nouveauté déduite du temps de jeu (jamais d'une durée de session). */
export function poidsNouveaute(playtimeForever: number): number {
  if (playtimeForever <= 0) return NOUVEAUTE_POIDS.jamaisLance;
  if (playtimeForever < 120) return NOUVEAUTE_POIDS.moinsDe2h;
  if (playtimeForever < 600) return NOUVEAUTE_POIDS.moinsDe10h;
  return NOUVEAUTE_POIDS.autre;
}

/** Curseur 10 → 100 % converti en poids 0,10 → 1,00. */
export function normaliserDecouverte(decouverte: number): number {
  const borne = Math.min(
    Math.max(decouverte, HOME_DECOUVERTE_MIN),
    HOME_DECOUVERTE_MAX,
  );
  return borne / 100;
}

/** Nombre de genres Steam communs à deux jeux (sans doublon). */
export function compterGenresCommuns(
  genreIdsCandidat: number[] | null,
  genreIdsAncre: number[] | null,
): number {
  const ancre = new Set(genreIdsAncre ?? []);
  return new Set((genreIdsCandidat ?? []).filter((id) => ancre.has(id))).size;
}

export interface EntreeScoreSelection {
  similarite: number;
  matchGenre: boolean;
  lastActivitySource: HomeLastActivitySource | null;
  achievementsUnlocked: number | null;
  achievementsTotal: number | null;
  playtimeForever: number;
  decouverte: number;
}

/** Score hybride du deck : ambience + bonus genre + activité + progression. */
export function scoreSelection(entree: EntreeScoreSelection): number {
  const activite = poidsActivite(entree.lastActivitySource);
  const progression = poidsProgression(
    entree.achievementsUnlocked,
    entree.achievementsTotal,
  );
  const nouveaute = poidsNouveaute(entree.playtimeForever);
  const decouverte = normaliserDecouverte(entree.decouverte);

  const base =
    SELECTION_POIDS.similarite * bornerSimilarite(entree.similarite) +
    SELECTION_POIDS.genre * (entree.matchGenre ? 1 : 0) +
    SELECTION_POIDS.activite * activite +
    SELECTION_POIDS.progression * progression;

  return (
    (1 - SELECTION_POIDS.decouverteMax * decouverte) * base +
    SELECTION_POIDS.decouverteMax * decouverte * nouveaute
  );
}

export interface EntreePreferenceTemps {
  temps: HomeTemps;
  continuite: number;
  progression: number;
  playtimeForever: number;
}

/** Préférence de temps du menu : un classement, pas une promesse de durée. */
export function preferenceTemps(entree: EntreePreferenceTemps): number {
  const poids = MENU_PREFERENCE_TEMPS[entree.temps];
  const duree =
    poids.dureeMax > 0
      ? Math.min(entree.playtimeForever / poids.dureeMax, 1)
      : 0;
  return (
    poids.continuite * entree.continuite +
    poids.progression * entree.progression +
    poids.duree * duree
  );
}

export interface EntreeScoreMenu {
  similarite: number;
  lastActivitySource: HomeLastActivitySource | null;
  achievementsUnlocked: number | null;
  achievementsTotal: number | null;
  playtimeForever: number;
  intention: HomeIntention;
  temps: HomeTemps;
}

/** Score du menu, selon l'intention et la préférence de temps. */
export function scoreMenu(entree: EntreeScoreMenu): number {
  const continuite = poidsActivite(entree.lastActivitySource);
  const progression = poidsProgression(
    entree.achievementsUnlocked,
    entree.achievementsTotal,
  );
  const decouverte = entree.playtimeForever === 0 ? 1 : 0;
  const similarite = bornerSimilarite(entree.similarite);
  const preference = preferenceTemps({
    temps: entree.temps,
    continuite,
    progression,
    playtimeForever: entree.playtimeForever,
  });
  const poids = MENU_POIDS_INTENTION[entree.intention];

  return (
    poids.continuite * continuite +
    poids.progression * progression +
    poids.similarite * similarite +
    poids.decouverte * decouverte +
    poids.temps * preference
  );
}

/** Libellé de continuité partagé par la raison et les signaux du menu. */
function libelleContinuite(
  source: HomeLastActivitySource | null,
): string | null {
  switch (source) {
    case 'sync_delta':
      return 'Joué depuis ta dernière sync';
    case 'recent_window':
      return 'Joué ces 14 derniers jours';
    case 'achievement':
      return 'Dernier succès';
    default:
      return null;
  }
}

/** Succès restants, ou `null` quand la progression est inconnue ou terminée. */
function succesRestants(
  unlocked: number | null,
  total: number | null,
): number | null {
  if (unlocked === null || total === null || total <= 0) return null;
  const restants = total - unlocked;
  return restants > 0 ? restants : null;
}

function motGenre(nombre: number): string {
  return nombre === 1 ? 'genre en commun' : 'genres en commun';
}

function libelleSuccesRestants(restants: number): string {
  return restants === 1 ? '1 succès restant' : `${restants} succès restants`;
}

export interface EntreeRaisonSelection {
  genre: HomeGenre | null;
  matchGenre: boolean;
  genresCommuns: number;
  nomAncre: string;
}

/** Raison courte d'une carte du deck. */
export function raisonSelection(entree: EntreeRaisonSelection): string {
  if (entree.genre && entree.matchGenre) {
    return `Même genre · ${entree.genre.label}`;
  }
  if (entree.genresCommuns > 0) {
    return `Voisin de ${entree.nomAncre} · ${entree.genresCommuns} ${motGenre(
      entree.genresCommuns,
    )}`;
  }
  return `Proche de ${entree.nomAncre}`;
}

export interface EntreeRaisonMenu {
  intention: HomeIntention;
  lastActivitySource: HomeLastActivitySource | null;
  achievementsUnlocked: number | null;
  achievementsTotal: number | null;
  playtimeForever: number;
  genresCommuns: number;
  nomAncre: string;
}

/** Raison courte du résultat du menu. */
export function raisonMenu(entree: EntreeRaisonMenu): string {
  const restants = succesRestants(
    entree.achievementsUnlocked,
    entree.achievementsTotal,
  );

  switch (entree.intention) {
    case 'finir':
      if (restants !== null && entree.achievementsTotal !== null) {
        return `${libelleSuccesRestants(
          restants,
        )} sur ${entree.achievementsTotal}`;
      }
      return `Proche de ${entree.nomAncre}`;
    case 'decouvrir': {
      const base = entree.playtimeForever === 0 ? 'Jamais lancé' : 'Déjà lancé';
      return entree.genresCommuns > 0
        ? `${base} · ${entree.genresCommuns} ${motGenre(entree.genresCommuns)}`
        : base;
    }
    case 'continuer':
    default: {
      const base =
        libelleContinuite(entree.lastActivitySource) ??
        `Proche de ${entree.nomAncre}`;
      return restants !== null
        ? `${base} · ${libelleSuccesRestants(restants)}`
        : base;
    }
  }
}

export interface EntreeSignauxMenu {
  temps: HomeTemps;
  manette: boolean;
  controllerSupport: HomeControllerSupport;
  lastActivitySource: HomeLastActivitySource | null;
  achievementsUnlocked: number | null;
  achievementsTotal: number | null;
  playtimeForever: number;
  genresCommuns: number;
  similariteEmbedding: boolean;
  nomAncre: string;
}

/** Signaux lisibles du dialogue « Pourquoi ce jeu ? ». */
export function signauxMenu(entree: EntreeSignauxMenu): HomeMenuSignals {
  const progression =
    entree.achievementsTotal !== null &&
    entree.achievementsTotal > 0 &&
    entree.achievementsUnlocked !== null
      ? `${entree.achievementsUnlocked} succès sur ${entree.achievementsTotal}`
      : 'Progression inconnue';

  let similarite: string;
  if (entree.similariteEmbedding) {
    similarite = `Ambiance proche de ${entree.nomAncre}`;
  } else if (entree.genresCommuns > 0) {
    similarite = `${entree.genresCommuns} ${motGenre(
      entree.genresCommuns,
    )} avec ${entree.nomAncre}`;
  } else {
    similarite = `Aucun genre en commun avec ${entree.nomAncre}`;
  }

  let manette: string;
  if (!entree.manette) {
    manette = 'Manette non filtrée';
  } else {
    manette =
      entree.controllerSupport === 'partial'
        ? 'Manette partielle'
        : 'Manette complète';
  }

  return {
    continuite:
      libelleContinuite(entree.lastActivitySource) ??
      'Aucune activité récente connue',
    progression,
    decouverte: entree.playtimeForever === 0 ? 'Jamais lancé' : 'Déjà lancé',
    similarite,
    temps: `Préférence de ${entree.temps} min (pas une durée de partie)`,
    manette,
  };
}

/** Raison d'une carte « À finir ». */
export function raisonAFinir(
  unlocked: number | null,
  total: number | null,
): string {
  if (unlocked === null || total === null || total <= 0) {
    return 'Progression inconnue';
  }
  const restants = total - unlocked;
  if (restants <= 0) return '100 % de succès';
  return `${restants} ${restants === 1 ? 'succès restant' : 'succès restants'}`;
}

/** Raison d'une carte « À retrouver » : une borne, jamais une date exacte. */
export function raisonRetrouver(source: HomeLastActivitySource | null): string {
  switch (source) {
    case 'sync_delta':
      return 'Joué récemment';
    case 'recent_window':
      return 'Ces 14 derniers jours';
    case 'achievement':
      return 'Dernier succès';
    default:
      return 'Activité récente';
  }
}

@Injectable()
export class HomeService {
  constructor(@Inject(DB) private readonly db: Db) {}

  /**
   * Accueil par défaut en une requête : jeu du moment, deck, catégories, menu
   * et ancres récentes. Aucun appel Steam ou Gemini : tout est lu en base.
   */
  async getHome(userId: number): Promise<HomeResponse> {
    const moment = await this.chargerJeuDuMoment(userId);
    if (!moment) return this.reponseVide();

    const genre = genrePrincipal(moment);

    const [items, categories, menu, ancresRecentes] = await Promise.all([
      this.chargerSelection(userId, moment, genre, HOME_DECOUVERTE_DEFAUT),
      this.chargerCategories(userId, moment),
      this.chargerMenu(
        userId,
        moment,
        HOME_MENU_TEMPS_DEFAUT,
        HOME_MENU_INTENTION_DEFAUT,
        HOME_MENU_MANETTE_DEFAUT,
      ),
      this.chargerAncresRecentes(userId),
    ]);

    return {
      jeuDuMoment: this.versHomeGame(moment, null),
      selection: this.construireSelection(moment, genre, items),
      categories,
      menu,
      ancresRecentes: ancresRecentes.map((ligne) =>
        this.versHomeGame(ligne, null),
      ),
    };
  }

  /**
   * Sélection paramétrable : ancre libre (jeu possédé), genre prioritaire,
   * découverte, manette (complète + partielle), lancement et progression.
   * Le genre reste un bonus de score, jamais un `WHERE`.
   */
  async getSelection(
    userId: number,
    dto: HomeSelectionQueryDto,
  ): Promise<HomeSelection> {
    const moment =
      dto.anchor === undefined
        ? await this.chargerJeuDuMoment(userId)
        : await this.chargerJeuParAppId(userId, dto.anchor);

    if (!moment) {
      if (dto.anchor !== undefined) {
        throw new NotFoundException('Jeu de référence introuvable');
      }
      return {
        anchor: null,
        genre: null,
        decouverte: dto.decouverte,
        manette: dto.manette,
        lancement: dto.lancement,
        progression: dto.progression,
        items: [],
      };
    }

    const mainGenre = genrePrincipal(moment);
    const genre =
      dto.genre === undefined
        ? mainGenre
        : dto.genre === 0
          ? null
          : await this.chargerGenre(userId, dto.genre);

    const items = await this.chargerSelection(
      userId,
      moment,
      genre,
      dto.decouverte,
      {
        manette: dto.manette,
        lancement: dto.lancement,
        progression: dto.progression,
      },
    );

    return {
      anchor: this.versAnchor(moment, mainGenre),
      genre,
      decouverte: dto.decouverte,
      manette: dto.manette,
      lancement: dto.lancement,
      progression: dto.progression,
      items,
    };
  }

  /**
   * Menu du soir : temps, intention, manette et ancre. Le jeu de référence
   * reste candidat (c’est souvent la bonne réponse à « Continuer »).
   */
  async getMenu(
    userId: number,
    dto: HomeMenuQueryDto,
  ): Promise<HomeMenuResponse> {
    const moment =
      dto.anchor === undefined
        ? await this.chargerJeuDuMoment(userId)
        : await this.chargerJeuParAppId(userId, dto.anchor);

    if (!moment) {
      if (dto.anchor !== undefined) {
        throw new NotFoundException('Jeu de référence introuvable');
      }
      return {
        temps: dto.temps,
        intention: dto.intention,
        manette: dto.manette,
        resultat: null,
        signals: null,
      };
    }

    return this.chargerMenu(
      userId,
      moment,
      dto.temps,
      dto.intention,
      dto.manette,
    );
  }

  private reponseVide(): HomeResponse {
    return {
      jeuDuMoment: null,
      selection: {
        anchor: null,
        genre: null,
        decouverte: HOME_DECOUVERTE_DEFAUT,
        manette: false,
        lancement: 'tous',
        progression: false,
        items: [],
      },
      categories: { aFinir: [], aDecouvrir: [], aRetrouver: [] },
      menu: {
        temps: HOME_MENU_TEMPS_DEFAUT,
        intention: HOME_MENU_INTENTION_DEFAUT,
        manette: HOME_MENU_MANETTE_DEFAUT,
        resultat: null,
        signals: null,
      },
      ancresRecentes: [],
    };
  }

  private versAnchor(
    moment: LigneAccueil,
    mainGenre: HomeGenre | null,
  ): HomeAnchor {
    return {
      appId: moment.appId,
      name: moment.name,
      genres: moment.genres ?? [],
      genreIds: moment.genreIds ?? [],
      controllerSupport: moment.controllerSupport,
      headerImageUrl: moment.headerImageUrl,
      mainGenre,
    };
  }

  private construireSelection(
    moment: LigneAccueil,
    genre: HomeGenre | null,
    items: HomeGame[],
  ): HomeSelection {
    return {
      anchor: this.versAnchor(moment, genre),
      genre,
      decouverte: HOME_DECOUVERTE_DEFAUT,
      manette: false,
      lancement: 'tous',
      progression: false,
      items,
    };
  }

  /**
   * Jeu du moment : fenêtre de 14 jours d'abord, puis activité dérivée, puis
   * temps de jeu. Replis : jeu le plus joué, premier jeu avec embedding, puis
   * bibliothèque vide (`null`). `rtime_last_played` n'est jamais lu.
   */
  private async chargerJeuDuMoment(
    userId: number,
  ): Promise<LigneAccueil | null> {
    const result = await this.db.$client.query(
      `
        SELECT ${COLONNES_ACCUEIL}
        FROM library_entries le
        JOIN games g ON g.id = le.game_id
        WHERE le.user_id = $1
        ORDER BY
          (le.playtime_last_2_weeks > 0) DESC,
          le.last_activity_at DESC NULLS LAST,
          le.playtime_forever DESC,
          (g.embedding IS NOT NULL) DESC,
          lower(g.name)
        LIMIT 1
      `,
      [userId],
    );

    return (result.rows[0] as LigneAccueil | undefined) ?? null;
  }

  /** Ancre choisie par `appId` : uniquement un jeu possédé par l'utilisateur. */
  private async chargerJeuParAppId(
    userId: number,
    appId: number,
  ): Promise<LigneAccueil | null> {
    const result = await this.db.$client.query(
      `
        SELECT ${COLONNES_ACCUEIL}
        FROM library_entries le
        JOIN games g ON g.id = le.game_id
        WHERE le.user_id = $1 AND g.app_id = $2
        LIMIT 1
      `,
      [userId, appId],
    );

    return (result.rows[0] as LigneAccueil | undefined) ?? null;
  }

  /**
   * Genre demandé : il doit exister dans la bibliothèque de l'utilisateur.
   * Le front n'envoie que des ids de facettes ; un id inconnu est une erreur
   * client (400), pas un deck vide silencieux.
   */
  private async chargerGenre(
    userId: number,
    genreId: number,
  ): Promise<HomeGenre> {
    const libelles = await libellesGenresUtilisateur(this.db, userId, [
      genreId,
    ]);
    const label = libelles.get(genreId);
    if (!label) throw new BadRequestException('Genre inconnu');
    return { id: genreId, label };
  }

  /** Ancres récentes, dans le même ordre que le jeu du moment. */
  private async chargerAncresRecentes(userId: number): Promise<LigneAccueil[]> {
    const result = await this.db.$client.query(
      `
        SELECT ${COLONNES_ACCUEIL}
        FROM library_entries le
        JOIN games g ON g.id = le.game_id
        WHERE le.user_id = $1
        ORDER BY
          (le.playtime_last_2_weeks > 0) DESC,
          le.last_activity_at DESC NULLS LAST,
          le.playtime_forever DESC,
          (g.embedding IS NOT NULL) DESC,
          lower(g.name)
        LIMIT $2
      `,
      [userId, HOME_ANCRES_TAILLE],
    );

    return result.rows as LigneAccueil[];
  }

  /**
   * Candidats de l'utilisateur avec leur similarité à l'ancre.
   *
   * La similarité vient de `games.embedding` déjà stocké (aucun appel Gemini) ;
   * si l'un des deux embeddings manque, on retombe sur les genres communs.
   * Le genre n'est pas un `WHERE` : il n'entre que dans le score.
   */
  private async chargerCandidats(
    userId: number,
    jeuDuMomentId: number,
    filtres: FiltresSelection,
    exclureAncre: boolean,
  ): Promise<LigneCandidat[]> {
    const conditions = [
      'le.user_id = $1',
      "(NOT $3::boolean OR g.controller_support IN ('full', 'partial'))",
      `($4::text = 'tous'
        OR ($4::text = 'deja' AND le.playtime_forever > 0)
        OR ($4::text = 'jamais' AND le.playtime_forever = 0))`,
      `(NOT $5::boolean OR (
        g.achievements_fetched_at IS NOT NULL
        AND le.achievements_fetched_at IS NOT NULL
        AND g.achievements_total > 0
        AND le.achievements_unlocked IS NOT NULL
        AND le.achievements_unlocked::float8 / NULLIF(g.achievements_total, 0) >= 0.75
      ))`,
    ];
    if (exclureAncre) conditions.push('g.id <> ancre.id');

    const result = await this.db.$client.query(
      `
        WITH ancre AS (
          SELECT id, embedding, genre_ids
          FROM games
          WHERE id = $2
        )
        SELECT
          ${COLONNES_ACCUEIL},
          (g.embedding IS NOT NULL AND ancre.embedding IS NOT NULL)
            AS "similariteEmbedding",
          CASE
            WHEN g.embedding IS NOT NULL AND ancre.embedding IS NOT NULL
              THEN (1 - (g.embedding <=> ancre.embedding))::float8
            ELSE (
              cardinality(ARRAY(
                SELECT unnest(g.genre_ids)
                INTERSECT
                SELECT unnest(ancre.genre_ids)
              ))::float8 / GREATEST(cardinality(ancre.genre_ids), 1)
            )
          END AS similarite
        FROM library_entries le
        JOIN games g ON g.id = le.game_id
        CROSS JOIN ancre
        WHERE ${conditions.join('\n          AND ')}
        ORDER BY g.app_id
      `,
      [
        userId,
        jeuDuMomentId,
        filtres.manette,
        filtres.lancement,
        filtres.progression,
      ],
    );

    return result.rows as LigneCandidat[];
  }

  private async chargerSelection(
    userId: number,
    moment: LigneAccueil,
    genre: HomeGenre | null,
    decouverte: number,
    filtres: FiltresSelection = FILTRES_SELECTION_DEFAUT,
  ): Promise<HomeGame[]> {
    const lignes = await this.chargerCandidats(
      userId,
      moment.id,
      filtres,
      true,
    );
    const ancreGenreIds = moment.genreIds ?? [];

    const classement = lignes.map((ligne) => {
      const matchGenre =
        genre !== null &&
        genre.id > 0 &&
        (ligne.genreIds ?? []).includes(genre.id);
      const genresCommuns = compterGenresCommuns(ligne.genreIds, ancreGenreIds);
      const similarite = bornerSimilarite(Number(ligne.similarite ?? 0));

      return {
        ligne,
        matchGenre,
        genresCommuns,
        similarite,
        score: scoreSelection({
          similarite,
          matchGenre,
          lastActivitySource: ligne.lastActivitySource,
          achievementsUnlocked: ligne.achievementsUnlocked,
          achievementsTotal: ligne.achievementsTotal,
          playtimeForever: ligne.playtimeForever,
          decouverte,
        }),
      };
    });

    classement.sort(
      (a, b) =>
        b.score - a.score ||
        Number(b.matchGenre) - Number(a.matchGenre) ||
        b.similarite - a.similarite ||
        a.ligne.name.localeCompare(b.ligne.name, 'fr'),
    );

    return classement.slice(0, HOME_SELECTION_TAILLE).map((entree) =>
      this.versHomeGame(
        entree.ligne,
        raisonSelection({
          genre,
          matchGenre: entree.matchGenre,
          genresCommuns: entree.genresCommuns,
          nomAncre: moment.name,
        }),
      ),
    );
  }

  private async chargerMenu(
    userId: number,
    moment: LigneAccueil,
    temps: HomeTemps,
    intention: HomeIntention,
    manette: boolean,
  ): Promise<HomeMenuResponse> {
    // Le jeu du moment reste candidat : c'est souvent la bonne réponse à
    // « Continuer ». Seul le deck exclut l'ancre.
    const lignes = await this.chargerCandidats(
      userId,
      moment.id,
      { manette, lancement: 'tous', progression: false },
      false,
    );
    const ancreGenreIds = moment.genreIds ?? [];

    const classement = lignes.map((ligne) => {
      const similarite = bornerSimilarite(Number(ligne.similarite ?? 0));
      return {
        ligne,
        similarite,
        genresCommuns: compterGenresCommuns(ligne.genreIds, ancreGenreIds),
        score: scoreMenu({
          similarite,
          lastActivitySource: ligne.lastActivitySource,
          achievementsUnlocked: ligne.achievementsUnlocked,
          achievementsTotal: ligne.achievementsTotal,
          playtimeForever: ligne.playtimeForever,
          intention,
          temps,
        }),
      };
    });

    classement.sort(
      (a, b) =>
        b.score - a.score ||
        b.similarite - a.similarite ||
        poidsActivite(b.ligne.lastActivitySource) -
          poidsActivite(a.ligne.lastActivitySource) ||
        a.ligne.name.localeCompare(b.ligne.name, 'fr'),
    );

    const meilleur = classement[0];
    if (!meilleur) {
      return { temps, intention, manette, resultat: null, signals: null };
    }

    return {
      temps,
      intention,
      manette,
      resultat: this.versHomeGame(
        meilleur.ligne,
        raisonMenu({
          intention,
          lastActivitySource: meilleur.ligne.lastActivitySource,
          achievementsUnlocked: meilleur.ligne.achievementsUnlocked,
          achievementsTotal: meilleur.ligne.achievementsTotal,
          playtimeForever: meilleur.ligne.playtimeForever,
          genresCommuns: meilleur.genresCommuns,
          nomAncre: moment.name,
        }),
      ),
      signals: signauxMenu({
        temps,
        manette,
        controllerSupport: meilleur.ligne.controllerSupport,
        lastActivitySource: meilleur.ligne.lastActivitySource,
        achievementsUnlocked: meilleur.ligne.achievementsUnlocked,
        achievementsTotal: meilleur.ligne.achievementsTotal,
        playtimeForever: meilleur.ligne.playtimeForever,
        genresCommuns: meilleur.genresCommuns,
        similariteEmbedding: meilleur.ligne.similariteEmbedding,
        nomAncre: moment.name,
      }),
    };
  }

  private async chargerCategories(
    userId: number,
    moment: LigneAccueil,
  ): Promise<HomeCategories> {
    const [aFinir, aDecouvrir, aRetrouver] = await Promise.all([
      this.chargerAFinir(userId),
      this.chargerADecouvrir(userId, moment.id),
      this.chargerARetrouver(userId),
    ]);

    return { aFinir, aDecouvrir, aRetrouver };
  }

  /**
   * À finir : succès récupérés des deux côtés, jeu possédant des succès et
   * progression non terminée. Les jeux à 100 % sortent de la section.
   */
  private async chargerAFinir(userId: number): Promise<HomeGame[]> {
    const result = await this.db.$client.query(
      `
        SELECT ${COLONNES_ACCUEIL}
        FROM library_entries le
        JOIN games g ON g.id = le.game_id
        WHERE le.user_id = $1
          AND le.playtime_forever > 0
          AND g.achievements_fetched_at IS NOT NULL
          AND le.achievements_fetched_at IS NOT NULL
          AND g.achievements_total > 0
          AND le.achievements_unlocked IS NOT NULL
          AND le.achievements_unlocked < g.achievements_total
        ORDER BY
          (le.achievements_unlocked::float8 / g.achievements_total) DESC,
          le.last_activity_at DESC NULLS LAST,
          lower(g.name)
        LIMIT $2
      `,
      [userId, HOME_CATEGORIE_TAILLE],
    );

    return (result.rows as LigneAccueil[]).map((ligne) =>
      this.versHomeGame(
        ligne,
        raisonAFinir(ligne.achievementsUnlocked, ligne.achievementsTotal),
      ),
    );
  }

  /**
   * À découvrir : jeux jamais lancés, classés par similarité au jeu du moment.
   * Sans embedding de part et d'autre, le tri retombe sur le nom (pas de faux
   * score affiché).
   */
  private async chargerADecouvrir(
    userId: number,
    jeuDuMomentId: number,
  ): Promise<HomeGame[]> {
    const result = await this.db.$client.query(
      `
        WITH ancre AS (
          SELECT embedding FROM games WHERE id = $2
        )
        SELECT ${COLONNES_ACCUEIL}
        FROM library_entries le
        JOIN games g ON g.id = le.game_id
        CROSS JOIN ancre
        WHERE le.user_id = $1
          AND le.playtime_forever = 0
        ORDER BY
          CASE
            WHEN g.embedding IS NOT NULL AND ancre.embedding IS NOT NULL
              THEN g.embedding <=> ancre.embedding
            ELSE 0
          END,
          lower(g.name)
        LIMIT $3
      `,
      [userId, jeuDuMomentId, HOME_CATEGORIE_TAILLE],
    );

    return (result.rows as LigneAccueil[]).map((ligne) =>
      this.versHomeGame(ligne, 'Jamais lancé'),
    );
  }

  private async chargerARetrouver(userId: number): Promise<HomeGame[]> {
    const result = await this.db.$client.query(
      `
        SELECT ${COLONNES_ACCUEIL}
        FROM library_entries le
        JOIN games g ON g.id = le.game_id
        WHERE le.user_id = $1
          AND le.playtime_forever > 0
          AND le.last_activity_at IS NOT NULL
        ORDER BY
          le.last_activity_at DESC NULLS LAST,
          le.playtime_last_2_weeks DESC,
          lower(g.name)
        LIMIT $2
      `,
      [userId, HOME_CATEGORIE_TAILLE],
    );

    return (result.rows as LigneAccueil[]).map((ligne) =>
      this.versHomeGame(ligne, raisonRetrouver(ligne.lastActivitySource)),
    );
  }

  private versHomeGame(ligne: LigneAccueil, raison: string | null): HomeGame {
    return {
      appId: ligne.appId,
      name: ligne.name,
      genres: ligne.genres ?? [],
      controllerSupport: ligne.controllerSupport,
      headerImageUrl: ligne.headerImageUrl,
      playtimeForever: ligne.playtimeForever,
      playtimeLast2Weeks: ligne.playtimeLast2Weeks,
      lastActivityAt: normaliserDate(ligne.lastActivityAt),
      lastActivitySource: ligne.lastActivitySource,
      lastActivityPrecision: ligne.lastActivityPrecision,
      achievementsUnlocked: ligne.achievementsUnlocked,
      achievementsTotal: ligne.achievementsTotal,
      reason: raison,
    };
  }
}
