import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DbModule } from '../db/db.module.js';
import { GamesModule } from '../games/games.module.js';
import { EmbeddingModule } from './embedding.module.js';

/**
 * Contexte minimal du script d'évaluation des embeddings.
 *
 * Il n'importe ni `SyncModule` ni les contrôleurs : lancer le script ne
 * déclenche aucun import de bibliothèque. `GamesModule` fournit
 * `embeddingInputFor`, `EmbeddingModule` le service Gemini et `DbModule`
 * applique les migrations au démarrage.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '../.env' }),
    DbModule,
    EmbeddingModule,
    GamesModule,
  ],
})
export class EvaluationModule {}
