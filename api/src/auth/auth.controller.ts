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

@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly authService: AuthService,
    private readonly config: ConfigService,
    private readonly usersService: UsersService,
  ) {}

  /**
   * `GET /api/auth/steam` — redirige le navigateur vers Steam pour
   * l'authentification OpenID.
   */
  @Get('steam')
  steamLogin(@Req() req: Request, @Res() res: Response): void {
    const realm = `${req.protocol}://${req.get('host')}`;
    const returnTo = `${realm}/api/auth/steam/return`;
    res.redirect(this.authService.buildSteamLoginUrl(returnTo, realm));
  }

  /**
   * `GET /api/auth/steam/return` — callback Steam. Vérifie la réponse,
   * récupère le profil, ouvre la session puis renvoie le navigateur vers le front.
   */
  @Get('steam/return')
  async steamReturn(@Req() req: Request, @Res() res: Response): Promise<void> {
    const frontendUrl =
      this.config.get<string>('FRONTEND_URL') || 'http://localhost:5173';

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
