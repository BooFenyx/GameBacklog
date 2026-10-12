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
import { DbModule } from './db/db.module.js';

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
    }),
    DbModule,
    AuthModule,
    LibraryModule,
    EmbeddingModule,
    UsersModule,
    GamesModule,
    SyncModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
