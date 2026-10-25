import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { SessionGuard } from '../auth/session.guard.js';
import { SearchQueryDto } from './dto/search-query.dto.js';
import { SearchRateLimitService } from './search-rate-limit.service.js';
import { SearchService, type SearchResponse } from './search.service.js';

/**
 * `GET /api/search` — recherche par nom (`mode=name`) ou sémantique
 * (`mode=semantic`) dans la bibliothèque de l'utilisateur connecté.
 *
 * La limite de fréquence s'applique avant tout travail coûteux : le mode nom
 * a un seuil large (aperçu pendant la frappe), le mode sémantique un seuil
 * strict (un appel Gemini par recherche).
 */
@Controller('search')
@UseGuards(SessionGuard)
export class SearchController {
  constructor(
    private readonly searchService: SearchService,
    private readonly rateLimit: SearchRateLimitService,
  ) {}

  @Get()
  async rechercher(
    @Query() dto: SearchQueryDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SearchResponse> {
    const decision = this.rateLimit.tryConsume(
      req.session.steamId as string,
      dto.mode === 'semantic' ? 'semantic' : 'name',
    );

    if (!decision.allowed) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil(decision.retryAfterMs / 1000),
      );
      res.setHeader('Retry-After', String(retryAfterSeconds));
      throw new HttpException(
        'Limite de recherche atteinte : réessaie dans un instant.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return this.searchService.search(req.session.userId as number, dto);
  }
}
