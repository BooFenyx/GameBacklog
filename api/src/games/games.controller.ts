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
import { AchievementsService } from '../achievements/achievements.service.js';
import { SessionGuard } from '../auth/session.guard.js';
import { GamesService, type UserGameDetail } from './games.service.js';
import type { AchievementDto } from '../achievements/achievements.service.js';

/** Réponse de `GET /api/games/:appId`. */
export interface GameDetailResponse extends UserGameDetail {
  achievements: { total: number; unlocked: number; list: AchievementDto[] };
  steamUrl: string;
}

/**
 * `GET /api/games/:appId` — fiche d'un jeu de la bibliothèque de l'utilisateur
 * (image, description, genres, manette, temps de jeu, succès débloqués).
 * Les succès sont chargés **à la demande** (`GetSchemaForGame` +
 * `GetPlayerAchievements`), jamais à l'import.
 */
@Controller('games')
@UseGuards(SessionGuard)
export class GamesController {
  constructor(
    private readonly gamesService: GamesService,
    private readonly achievements: AchievementsService,
  ) {}

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

    const steamId = req.session.steamId as string;
    const liste = await this.achievements.getUserAchievements(
      steamId,
      userId,
      detail.id,
      appId,
    );
    const unlocked = liste.filter((succes) => succes.unlockedAt).length;

    return {
      ...detail,
      achievements: { total: liste.length, unlocked, list: liste },
      steamUrl: `steam://run/${appId}`,
    };
  }
}