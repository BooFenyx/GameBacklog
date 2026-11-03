import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { AuthModule } from './auth/auth.module.js';
import { LibraryModule } from './library/library.module.js';
import { EmbeddingModule } from './embedding/embedding.module.js';
import { UsersModule } from './users/users.module.js';
import { GamesModule } from './games/games.module.js';
import { SyncModule } from './sync/sync.module.js';
import { SearchModule } from './search/search.module.js';
import { HomeModule } from './home/home.module.js';
import { DbModule } from './db/db.module.js';
import { validateEnv } from './config/env.validation.js';

@Module({
  imports: [
    // `isGlobal` rend `ConfigService` injectable partout sans réimporter le
    // module. `envFilePath` est un chemin unique, volontairement : le `.env` est
    // mutualisé entre `api` et `web` et vit à la racine du dépôt, soit un cran
    // au-dessus de `api/`. Un chemin inexistant est ignoré silencieusement, ce
    // qui laisse le déploiement s'appuyer sur les variables d'environnement.
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '../.env',
      // Échoue au démarrage si une variable requise manque en production (voir
      // `validateEnv`) : un `SESSION_SECRET` absent rendrait les sessions
      // forgeables. Sans effet en développement et dans les tests.
      validate: validateEnv,
    }),
    DbModule,
    AuthModule,
    LibraryModule,
    EmbeddingModule,
    UsersModule,
    GamesModule,
    SyncModule,
    SearchModule,
    HomeModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
