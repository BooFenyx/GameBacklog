import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { SessionGuard } from '../auth/session.guard.js';
import { LectureRateLimitGuard } from '../rate-limit/lecture-rate-limit.guard.js';
import { LimiteLecture } from '../rate-limit/limite-lecture.decorator.js';
import { HomeSelectionQueryDto } from './dto/home-selection-query.dto.js';
import { HomeMenuQueryDto } from './dto/home-menu-query.dto.js';
import { HomeService } from './home.service.js';
import type {
  HomeMenuResponse,
  HomeResponse,
  HomeSelection,
} from './home.types.js';

/**
 * `GET /api/home` — accueil calculé depuis la bibliothèque importée.
 *
 * Aucun appel Steam ou Gemini au chargement : le jeu du moment, le deck, les
 * catégories et le menu sont lus en base. Les tranches suivantes ajouteront
 * `/selection` et `/menu`, avec leurs DTO dédiés.
 */
@LimiteLecture('home')
@Controller('home')
@UseGuards(SessionGuard, LectureRateLimitGuard)
export class HomeController {
  constructor(private readonly homeService: HomeService) {}

  @Get()
  accueil(@Req() req: Request): Promise<HomeResponse> {
    return this.homeService.getHome(req.session.userId as number);
  }

  @Get('selection')
  selection(
    @Req() req: Request,
    @Query() dto: HomeSelectionQueryDto,
  ): Promise<HomeSelection> {
    return this.homeService.getSelection(req.session.userId as number, dto);
  }

  @Get('menu')
  menu(
    @Req() req: Request,
    @Query() dto: HomeMenuQueryDto,
  ): Promise<HomeMenuResponse> {
    return this.homeService.getMenu(req.session.userId as number, dto);
  }
}
