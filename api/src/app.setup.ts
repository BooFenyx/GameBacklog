import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';

/**
 * Câblage partagé entre `main.ts` et le test e2e, pour que les deux
 * exercent exactement la même application.
 */
export function configureApp(
  app: NestExpressApplication,
  frontendUrl: string,
): void {
  // Nécessaire derrière le proxy de Render, sinon le cookie de session est
  // interprété sur le mauvais protocole.
  app.set('trust proxy', 1);

  app.use(cookieParser());

  // La CSP est désactivée : elle bloque les scripts inline et le WebSocket du
  // HMR de Vite. À configurer avant le déploiement (cf. AGENTS.md).
  app.use(helmet({ contentSecurityPolicy: false }));

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.setGlobalPrefix('api');

  // Nécessaire en plus du proxy Vite, car sur Render `web` et `api` sont sur
  // deux origines distinctes et doivent exposer leurs cookies.
  app.enableCors({ origin: frontendUrl, credentials: true });
}
