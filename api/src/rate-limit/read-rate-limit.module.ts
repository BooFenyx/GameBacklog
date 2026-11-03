import { Global, Module } from '@nestjs/common';
import { LectureRateLimitGuard } from './lecture-rate-limit.guard.js';
import { ReadRateLimitService } from './read-rate-limit.service.js';

/**
 * Limitation des routes de lecture, disponible partout sans import répété.
 * La recherche conserve `SearchRateLimitService` et ses fenêtres par mode.
 */
@Global()
@Module({
  providers: [ReadRateLimitService, LectureRateLimitGuard],
  exports: [ReadRateLimitService, LectureRateLimitGuard],
})
export class ReadRateLimitModule {}
