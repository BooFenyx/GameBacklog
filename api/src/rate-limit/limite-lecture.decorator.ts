import { SetMetadata } from '@nestjs/common';
import type { ReadRateLimitKind } from './read-rate-limit.service.js';

export const LIMITE_LECTURE = 'limite_lecture';

/** Associe une route de lecture à sa fenêtre de limitation par `steamId`. */
export const LimiteLecture = (kind: ReadRateLimitKind) =>
  SetMetadata(LIMITE_LECTURE, kind);
