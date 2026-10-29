import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import type { FacettesBibliotheque } from '../catalog/facets.js';
import { SessionGuard } from '../auth/session.guard.js';
import { LibraryQueryDto } from './dto/library-query.dto.js';
import { LibraryService, type BibliothequePage } from './library.service.js';

/**
 * `GET /api/library` — jeux possédés de l'utilisateur connecté, lus depuis la
 * base (`library_entries ⋈ games`), filtrés, triés et paginés.
 * `GET /api/library/facets` — compteurs des filtres disponibles.
 * Le `SessionGuard` garantit qu'un `userId` est présent dans la session.
 */
@Controller('library')
@UseGuards(SessionGuard)
export class LibraryController {
  constructor(private readonly libraryService: LibraryService) {}

  @Get()
  jeux(
    @Req() req: Request,
    @Query() query: LibraryQueryDto,
  ): Promise<BibliothequePage> {
    return this.libraryService.savedLibrary(
      req.session.userId as number,
      query,
    );
  }

  @Get('facets')
  facettes(@Req() req: Request): Promise<FacettesBibliotheque> {
    return this.libraryService.facets(req.session.userId as number);
  }
}
