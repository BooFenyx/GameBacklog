import { Module } from '@nestjs/common';
import { AchievementsModule } from '../achievements/achievements.module.js';
import { GamesController } from './games.controller.js';
import { GamesService } from './games.service.js';

@Module({
  imports: [AchievementsModule],
  controllers: [GamesController],
  providers: [GamesService],
  exports: [GamesService],
})
export class GamesModule {}