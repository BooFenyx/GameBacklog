import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** Base de la Steam Web API (authentifiée par `STEAM_API_KEY`). */
const STEAM_API_BASE = 'https://api.steampowered.com';

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

  constructor(private readonly config: ConfigService) {}

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
      response = await fetch(url);
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
