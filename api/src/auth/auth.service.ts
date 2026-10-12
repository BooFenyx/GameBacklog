import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** Point de terminaison OpenID 2.0 fourni par Steam. */
const STEAM_OPENID_ENDPOINT = 'https://steamcommunity.com/openid/login';
/** Base de la Steam Web API (authentifiée par `STEAM_API_KEY`). */
const STEAM_API_BASE = 'https://api.steampowered.com';
/** Abandon d'un appel externe après 5 s pour ne pas laisser la requête suspendue. */
const EXTERNAL_CALL_TIMEOUT_MS = 5000;

export interface SteamProfile {
  steamId: string;
  displayName: string;
  avatarUrl: string;
  profileUrl: string;
}

/** Forme de la réponse de `ISteamUser/GetPlayerSummaries`. */
interface GetPlayerSummariesResponse {
  response?: {
    players?: Array<{
      steamid: string;
      personaname: string;
      avatarfull: string;
      profileurl: string;
    }>;
  };
}

declare module 'express-session' {
  interface SessionData {
    steamId?: string;
    userId?: number;
    user?: SteamProfile | null;
  }
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(private readonly config: ConfigService) {}

  /**
   * Construit l'URL vers laquelle rediriger le navigateur pour que
   * l'utilisateur s'authentifie sur Steam. Aucune clé n'est nécessaire :
   * l'identité est obtenue via le `claimed_id` OpenID renvoyé au retour.
   */
  buildSteamLoginUrl(returnTo: string, realm: string): string {
    const params = new URLSearchParams({
      'openid.ns': 'http://specs.openid.net/auth/2.0',
      'openid.mode': 'checkid_setup',
      'openid.return_to': returnTo,
      'openid.realm': realm,
      'openid.identity': 'http://specs.openid.net/auth/2.0/identifier_select',
      'openid.claimed_id': 'http://specs.openid.net/auth/2.0/identifier_select',
    });

    return `${STEAM_OPENID_ENDPOINT}?${params.toString()}`;
  }

  /**
   * Vérifie la réponse OpenID en la faisant re-valider par Steam
   * (`check_authentication`), puis extrait le SteamID64 du `claimed_id`.
   * Renvoie `null` si la réponse n'est pas valide.
   */
  async verifySteamCallback(
    query: Record<string, unknown>,
  ): Promise<string | null> {
    // Seul un retour réel (`id_res`) est accepté : un `cancel` avec un
    // `claimed_id` ne doit pas passer, même avec une signature valide.
    if (query['openid.mode'] !== 'id_res') {
      this.logger.warn(`openid.mode inattendu: ${String(query['openid.mode'])}`);
      return null;
    }

    const claimedId =
      typeof query['openid.claimed_id'] === 'string'
        ? query['openid.claimed_id']
        : null;
    if (!claimedId) {
      return null;
    }

    const body = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (key.startsWith('openid.') && typeof value === 'string') {
        body.set(key, value);
      }
    }
    body.set('openid.mode', 'check_authentication');

    const response = await fetch(STEAM_OPENID_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(EXTERNAL_CALL_TIMEOUT_MS),
    });
    const text = await response.text();
    if (!/is_valid\s*:\s*true/i.test(text)) {
      this.logger.warn('Réponse OpenID invalide');
      return null;
    }

    const match = claimedId.match(/\/id\/(\d{17,25})$/);
    return match ? match[1] : null;
  }

  /**
   * Récupère le profil public (nom, avatar) depuis la Steam Web API.
   * Renvoie `null` si la clé est absente ou le profil inaccessible.
   */
  async fetchPlayerSummary(steamId: string): Promise<SteamProfile | null> {
    const key = this.config.get<string>('STEAM_API_KEY');
    if (!key) {
      this.logger.warn('STEAM_API_KEY absente : profil non récupéré');
      return null;
    }

    const url = `${STEAM_API_BASE}/ISteamUser/GetPlayerSummaries/v2/?key=${encodeURIComponent(
      key,
    )}&steamids=${encodeURIComponent(steamId)}`;

    const response = await fetch(url, {
      signal: AbortSignal.timeout(EXTERNAL_CALL_TIMEOUT_MS),
    });
    if (!response.ok) {
      this.logger.warn(`GetPlayerSummaries a répondu ${response.status}`);
      return null;
    }

    const data = (await response.json()) as GetPlayerSummariesResponse;
    const player = data.response?.players?.[0];
    if (!player) {
      return null;
    }

    return {
      steamId: player.steamid,
      displayName: player.personaname,
      avatarUrl: player.avatarfull,
      profileUrl: player.profileurl,
    };
  }
}
