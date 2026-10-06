import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { SessionGuard } from '../auth/session.guard.js';
import { LibraryService, type BibliothequeGame } from './library.service.js';

/**
 * `GET /api/library` — jeux possédés de l'utilisateur connecté.
 * Le `SessionGuard` garantit qu'un `steamId` est présent dans la session.
 */
@Controller('library')
@UseGuards(SessionGuard)
export class LibraryController {
  constructor(private readonly libraryService: LibraryService) {}

  @Get()
  jeux(@Req() req: Request): Promise<BibliothequeGame[]> {
    return this.libraryService.ownedGames(req.session.steamId as string);
  }
}
