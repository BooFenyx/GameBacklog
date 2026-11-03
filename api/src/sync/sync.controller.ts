import { Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { SessionGuard } from '../auth/session.guard.js';
import { LectureRateLimitGuard } from '../rate-limit/lecture-rate-limit.guard.js';
import { LimiteLecture } from '../rate-limit/limite-lecture.decorator.js';
import { SyncService, type SyncJobResponse } from './sync.service.js';

/**
 * `POST /api/sync` — relance l'import (tâche de fond) ;
 * `GET /api/sync` — état du job courant.
 * Le `SessionGuard` garantit `steamId` et `userId` en session. La limite de
 * lecture borne le polling (2 s côté front) et la relance manuelle ; le
 * cooldown de `SyncService` empêche en plus d'enchaîner les imports complets.
 */
@Controller('sync')
@LimiteLecture('sync')
@UseGuards(SessionGuard, LectureRateLimitGuard)
export class SyncController {
  constructor(private readonly syncService: SyncService) {}

  @Post()
  relancer(@Req() req: Request): Promise<SyncJobResponse> {
    return this.syncService.enqueue(req.session.userId as number, {
      forcerFiches: true,
    });
  }

  @Get()
  statut(@Req() req: Request): Promise<SyncJobResponse | null> {
    return this.syncService.currentJob(req.session.userId as number);
  }
}
