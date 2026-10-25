import { Module } from '@nestjs/common';
import { EmbeddingModule } from '../embedding/embedding.module.js';
import { QueryEmbeddingCacheService } from './query-embedding-cache.service.js';
import { SEARCH_CLOCK } from './search-clock.js';
import { SearchController } from './search.controller.js';
import { SearchRateLimitService } from './search-rate-limit.service.js';
import { SearchService } from './search.service.js';

@Module({
  imports: [EmbeddingModule],
  controllers: [SearchController],
  providers: [
    SearchService,
    SearchRateLimitService,
    QueryEmbeddingCacheService,
    { provide: SEARCH_CLOCK, useValue: () => Date.now() },
  ],
})
export class SearchModule {}
