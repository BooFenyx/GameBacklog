import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { SessionGuard } from '../auth/session.guard.js';
import {
  LibraryService,
  type BibliothequeGamePersiste,
} from './library.service.js';

/**
 * `GET /api/library` — jeux possédés de l'utilisateur connecté, lus depuis la
 * base (`library_entries ⋈ games`). Le `SessionGuard` garantit qu'un `steamId`
 * est présent dans la session.
 */
@Controller('library')
@UseGuards(SessionGuard)
export class LibraryController {
  constructor(private readonly libraryService: LibraryService) {}

  @Get()
  jeux(@Req() req: Request): Promise<BibliothequeGamePersiste[]> {
    return this.libraryService.savedLibrary(req.session.userId as number);
  }
}
