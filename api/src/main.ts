import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // `ConfigModule.forRoot` a chargé le `.env` racine pendant `create()`, donc
  // `FRONTEND_URL` est disponible ici. `||` et non `??` : une variable présente
  // mais vide (`FRONTEND_URL=`) donnerait `''` comme origine CORS.
  //
  // Ces replis ne concernent que le développement : en production, `validateEnv`
  // (câblé dans `ConfigModule`) a déjà fait échouer le démarrage si
  // `FRONTEND_URL` ou `SESSION_SECRET` manquent. Le secret de dev ci-dessous
  // n'est donc jamais utilisé en production.
  configureApp(
    app,
    process.env.FRONTEND_URL || 'http://localhost:5173',
    process.env.SESSION_SECRET || 'dev-insecure-session-secret',
    process.env.DATABASE_URL,
  );

  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
