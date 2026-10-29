import { Module } from '@nestjs/common';
import { AchievementsModule } from '../achievements/achievements.module.js';
import { EmbeddingModule } from '../embedding/embedding.module.js';
import { GamesModule } from '../games/games.module.js';
import { LibraryModule } from '../library/library.module.js';
import { UsersModule } from '../users/users.module.js';
import { SyncController } from './sync.controller.js';
import { SyncService } from './sync.service.js';

@Module({
  imports: [
    LibraryModule,
    GamesModule,
    AchievementsModule,
    EmbeddingModule,
    UsersModule,
  ],
  controllers: [SyncController],
  providers: [SyncService],
  exports: [SyncService],
})
export class SyncModule {}