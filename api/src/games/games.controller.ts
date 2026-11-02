import {
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  AchievementsService,
  type SuccesDetail,
} from '../achievements/achievements.service.js';
import { SessionGuard } from '../auth/session.guard.js';
import { GamesService, type UserGameDetail } from './games.service.js';

/** Réponse de `GET /api/games/:appId`. */
export interface GameDetailResponse extends UserGameDetail {
  steamUrl: string;
}

/**
 * `GET /api/games/:appId` — fiche d'un jeu de la bibliothèque de l'utilisateur
 * (image, description, genres, manette, temps de jeu, compteurs de succès).
 *
 * La fiche ne charge plus la liste des succès : elle lit les compteurs en base.
 * `GET /api/games/:appId/achievements` charge la liste détaillée à la demande
 * (`GetSchemaForGame` + `GetPlayerAchievements`).
 */
@Controller('games')
@UseGuards(SessionGuard)
export class GamesController {
  constructor(
    private readonly gamesService: GamesService,
    private readonly achievements: AchievementsService,
  ) {}

  @Get(':appId/achievements')
  async succes(
    @Param('appId', ParseIntPipe) appId: number,
    @Req() req: Request,
  ): Promise<SuccesDetail> {
    const userId = req.session.userId as number;
    const detail = await this.gamesService.userGameDetail(appId, userId);
    if (!detail) {
      throw new NotFoundException('Jeu introuvable dans la bibliothèque');
    }

    return this.achievements.getUserAchievementsDetail(
      req.session.steamId as string,
      userId,
      detail.id,
      appId,
    );
  }

  @Get(':appId')
  async fiche(
    @Param('appId', ParseIntPipe) appId: number,
    @Req() req: Request,
  ): Promise<GameDetailResponse> {
    const userId = req.session.userId as number;
    const detail = await this.gamesService.userGameDetail(appId, userId);
    if (!detail) {
      throw new NotFoundException('Jeu introuvable dans la bibliothèque');
    }

    return {
      ...detail,
      steamUrl: `steam://run/${appId}`,
    };
  }
}
