import { Module } from '@nestjs/common';
import { EmbeddingService } from './embedding.service.js';
import { RateLimitService } from './rate-limiter.service.js';

@Module({
  providers: [EmbeddingService, RateLimitService],
  exports: [EmbeddingService, RateLimitService],
})
export class EmbeddingModule {}
