import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';

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
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
