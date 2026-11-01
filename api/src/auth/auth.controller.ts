import {
  Controller,
  Get,
  Header,
  Logger,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { AuthService, type SteamProfile } from './auth.service.js';
import { UsersService } from '../users/users.service.js';
import { SyncService } from '../sync/sync.service.js';

@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly authService: AuthService,
    private readonly config: ConfigService,
    private readonly usersService: UsersService,
    private readonly syncService: SyncService,
  ) {}

  /**
   * Origine publique du front, sans slash final. Sert de `realm` OpenID, de
   * base de `return_to` et de cible des redirections post-login.
   *
   * Elle ne peut pas être déduite de `req.get('host')` : en production le front
   * (Vercel) proxifie `/api` vers l'API (Render), donc l'hôte vu par le
   * contrôleur est celui de l'API et non celui du navigateur.
   */
  private frontendUrl(): string {
    return (
      this.config.get<string>('FRONTEND_URL') || 'http://localhost:5173'
    ).replace(/\/+$/, '');
  }

  /**
   * `GET /api/auth/steam` — redirige le navigateur vers Steam pour
   * l'authentification OpenID.
   */
  @Get('steam')
  steamLogin(@Res() res: Response): void {
    const realm = this.frontendUrl();
    const returnTo = `${realm}/api/auth/steam/return`;
    res.redirect(this.authService.buildSteamLoginUrl(returnTo, realm));
  }

  /**
   * `GET /api/auth/steam/return` — callback Steam. Vérifie la réponse,
   * récupère le profil, ouvre la session puis renvoie le navigateur vers le front.
   */
  @Get('steam/return')
  async steamReturn(@Req() req: Request, @Res() res: Response): Promise<void> {
    const frontendUrl = this.frontendUrl();

    try {
      const steamId = await this.authService.verifySteamCallback(
        req.query as Record<string, unknown>,
      );
      if (!steamId) {
        res.redirect(`${frontendUrl}/?auth=error`);
        return;
      }

      const profile = await this.authService.fetchPlayerSummary(steamId);
      // Persiste l'utilisateur (création ou mise à jour, jamais de suppression).
      const userId = await this.usersService.upsertFromProfile(
        profile ?? { steamId, displayName: '', avatarUrl: null },
      );

      // Nouvel identifiant de session à l'ouverture de session : sans ça, un
      // identifiant placé par un tiers (fixation de session) survivrait à
      // l'authentification. La session régénérée est sauvegardée par
      // express-session avant la redirection.
      await new Promise<void>((resolve, reject) => {
        req.session.regenerate((error) => (error ? reject(error) : resolve()));
      });

      req.session.steamId = steamId;
      req.session.userId = userId;
      req.session.user = profile ?? {
        steamId,
        displayName: '',
        avatarUrl: '',
        profileUrl: '',
      };

      // Import initial de la bibliothèque, une seule fois : la liste des jeux
      // Steam est récupérée au premier login puis mise en cache en base
      // (`sync_jobs`, `library_entries`, `games`). Le sync ne repart pas quand
      // un import s'est déjà terminé (`done`), sauf si des fiches n'ont pas
      // encore reçu le mapping courant (`needsFilters`), si les compteurs de
      // succès manquent (`needsAchievements`) ou si des embeddings restent à
      // produire (`needsEmbeddings`, faux quand le quota Gemini est épuisé).
      // Le front peut aussi relancer à la main via `POST /api/sync`.
      const statut = await this.usersService.syncStatusOf(userId);
      const [
        aRemapper,
        succesAMettreAJour,
        activiteAMettreAJour,
        embeddingsAMettreAJour,
      ] = await Promise.all([
        this.syncService.needsFilters(userId),
        this.syncService.needsAchievements(userId),
        this.syncService.needsLibraryActivity(userId),
        this.syncService.needsEmbeddings(userId),
      ]);
      if (
        statut !== 'done' ||
        aRemapper ||
        succesAMettreAJour ||
        activiteAMettreAJour ||
        embeddingsAMettreAJour
      ) {
        void this.syncService.enqueue(userId);
      }

      res.redirect(`${frontendUrl}/?auth=success`);
    } catch (error) {
      this.logger.error('Échec du callback Steam', error as Error);
      res.redirect(`${frontendUrl}/?auth=error`);
    }
  }

  /**
   * `GET /api/auth/me` — renvoie `{ user }` avec le profil de session, ou
   * `{ user: null }`. L'objet englobant est volontaire : un `null` nu serait
   * sérialisé en corps vide, que `res.json()` du front ne sait pas lire. Le
   * `no-store` empêche un navigateur ou un proxy de mettre en cache l'état de
   * connexion.
   */
  @Get('me')
  @Header('Cache-Control', 'no-store')
  me(@Req() req: Request): { user: SteamProfile | null } {
    return { user: req.session.user ?? null };
  }

  /** `POST /api/auth/logout` — détruit la session. */
  @Post('logout')
  logout(@Req() req: Request, @Res() res: Response): void {
    req.session.destroy(() => {
      res.status(204).end();
    });
  }
}
