import { Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { SessionGuard } from '../auth/session.guard.js';
import { SyncService, type SyncJobResponse } from './sync.service.js';

/**
 * `POST /api/sync` — relance l'import (tâche de fond) ;
 * `GET /api/sync` — état du job courant.
 * Le `SessionGuard` garantit `steamId` et `userId` en session.
 */
@Controller('sync')
@UseGuards(SessionGuard)
export class SyncController {
  constructor(private readonly syncService: SyncService) {}

  @Post()
  relancer(@Req() req: Request): Promise<SyncJobResponse> {
    return this.syncService.enqueue(req.session.userId as number);
  }

  @Get()
  statut(@Req() req: Request): Promise<SyncJobResponse | null> {
    return this.syncService.currentJob(req.session.userId as number);
  }
}