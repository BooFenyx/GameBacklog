import { Module } from '@nestjs/common';
import { GamesService } from './games.service.js';

@Module({
  providers: [GamesService],
  exports: [GamesService],
})
export class GamesModule {}