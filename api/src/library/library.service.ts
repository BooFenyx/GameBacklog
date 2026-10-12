import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { eq } from 'drizzle-orm';
import { Inject } from '@nestjs/common';
import { DB, type Db } from '../db/db.module.js';
import { games, libraryEntries } from '../db/schema.js';

/** Base de la Steam Web API (authentifiée par `STEAM_API_KEY`). */
const STEAM_API_BASE = 'https://api.steampowered.com';
/** Abandon d'un appel externe après 5 s pour ne pas laisser la requête suspendue. */
const EXTERNAL_CALL_TIMEOUT_MS = 5000;

/** Jeu renvoyé au front pour la page bibliothèque. */
export interface BibliothequeGame {
  appId: number;
  name: string;
  /** Temps de jeu total en minutes (source `GetOwnedGames`). */
  playtimeForever: number;
  /** Temps de jeu sur les deux dernières semaines, en minutes. */
  playtimeLast2Weeks: number;
  lastPlayedAt: Date | null;
}

/** Jeu persisté en base (`library_entries ⋈ games`), enrichi pour la page. */
export interface BibliothequeGamePersiste extends BibliothequeGame {
  genres: string[];
  categories: string[];
  controllerSupport: 'none' | 'partial' | 'full';
  shortDescription: string | null;
  headerImageUrl: string | null;
  achievementsUnlocked: number;
}

/** Forme de la réponse de `IPlayerService/GetOwnedGames`. */
interface GetOwnedGamesResponse {
  response?: {
    game_count?: number;
    games?: Array<{
      appid: number;
      name?: string;
      playtime_forever?: number;
      playtime_last_2_weeks?: number;
      rtime_last_played?: number;
    }>;
  };
}

@Injectable()
export class LibraryService {
  private readonly logger = new Logger(LibraryService.name);

  constructor(
    private readonly config: ConfigService,
    @Inject(DB) private readonly db: Db,
  ) {}

  /**
   * Bibliothèque persistée de l'utilisateur (`library_entries ⋈ games`) : les
   * jeux ne sont récupérés depuis Steam qu'une seule fois, à l'import (voir
   * `SyncService`). Cette lecture sert la page Bibliothèque sans recontacter
   * Steam, et fonctionne donc même sans `STEAM_API_KEY`.
   */
  async savedLibrary(userId: number): Promise<BibliothequeGamePersiste[]> {
    const rows = await this.db
      .select({
        appId: games.appId,
        name: games.name,
        playtimeForever: libraryEntries.playtimeForever,
        playtimeLast2Weeks: libraryEntries.playtimeLast2Weeks,
        lastPlayedAt: libraryEntries.lastPlayedAt,
        genres: games.genres,
        categories: games.categories,
        controllerSupport: games.controllerSupport,
        shortDescription: games.shortDescription,
        headerImageUrl: games.headerImageUrl,
        achievementsUnlocked: libraryEntries.achievementsUnlocked,
      })
      .from(libraryEntries)
      .innerJoin(games, eq(libraryEntries.gameId, games.id))
      .where(eq(libraryEntries.userId, userId))
      .orderBy(games.name);
    return rows as BibliothequeGamePersiste[];
  }

  /**
   * Récupère les jeux possédés d'un joueur (`GetOwnedGames`) et les renvoie
   * triés par nom. La clé Steam reste côté serveur : jamais transmise au front.
   */
  async ownedGames(steamId: string): Promise<BibliothequeGame[]> {
    const key = this.config.get<string>('STEAM_API_KEY');
    if (!key) {
      throw new ServiceUnavailableException(
        'STEAM_API_KEY absente : import Steam impossible',
      );
    }

    const url =
      `${STEAM_API_BASE}/IPlayerService/GetOwnedGames/v1/` +
      `?key=${encodeURIComponent(key)}&steamid=${encodeURIComponent(steamId)}` +
      '&include_appinfo=true&include_played_free_games=true&format=json';

    let response: Response;
    try {
      response = await fetch(url, {
        signal: AbortSignal.timeout(EXTERNAL_CALL_TIMEOUT_MS),
      });
    } catch (error) {
      this.logger.error('Steam injoignable', error as Error);
      throw new ServiceUnavailableException('Steam est injoignable');
    }

    if (!response.ok) {
      // 401/403 : profil privé ou clé invalide.
      this.logger.warn(`GetOwnedGames a répondu ${response.status}`);
      throw new ServiceUnavailableException(
        `Steam a refusé l'accès (${response.status}) : profil privé ou clé invalide`,
      );
    }

    const data = (await response.json()) as GetOwnedGamesResponse;

    return (data.response?.games ?? [])
      .filter((game) => typeof game.name === 'string' && game.name.length > 0)
      .map((game) => ({
        appId: game.appid,
        name: game.name as string,
        playtimeForever: game.playtime_forever ?? 0,
        playtimeLast2Weeks: game.playtime_last_2_weeks ?? 0,
        lastPlayedAt: game.rtime_last_played
          ? new Date(game.rtime_last_played * 1000)
          : null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  }
}
