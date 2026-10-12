import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import helmet from 'helmet';

/**
 * Câblage partagé entre `main.ts` et les tests e2e, pour que les deux
 * exercent exactement la même application.
 *
 * `databaseUrl` est absente en développement et dans les tests : la session
 * tombe alors sur `MemoryStore`. En production elle est obligatoire (imposée
 * par `DbModule`), et le store passe en PostgreSQL via `connect-pg-simple`.
 */
export function configureApp(
  app: NestExpressApplication,
  frontendUrl: string,
  sessionSecret: string,
  databaseUrl?: string,
): void {
  const production = process.env.NODE_ENV === 'production';

  // Nécessaire derrière le proxy de Render, sinon le cookie de session est
  // interprété sur le mauvais protocole.
  app.set('trust proxy', 1);

  app.use(cookieParser());

  // La CSP est désactivée : elle bloque les scripts inline et le WebSocket du
  // HMR de Vite. À configurer avant le déploiement (cf. AGENTS.md).
  app.use(helmet({ contentSecurityPolicy: false }));

  const PgStore = connectPgSimple(session);

  // Session de connexion. `MemoryStore` convient au développement ; en
  // production le store est PostgreSQL, sinon chaque redéploiement Render
  // déconnecterait tout le monde. `sameSite: 'none'` en production car le
  // front (Vercel, `*.vercel.app`) et l'API (Render, `*.onrender.com`) sont
  // deux **sites** différents : `lax` supprimerait le cookie des requêtes
  // cross-site. `lax` suffit en dev (localhost, même site malgré les ports)
  // et survit à la redirection OpenID de Steam. `secure` en production pour
  // traverser le proxy HTTPS de Render (requis aussi par `none`).
  app.use(
    session({
      secret: sessionSecret,
      resave: false,
      saveUninitialized: false,
      store:
        production && databaseUrl
          ? new PgStore({
              conObject: { connectionString: databaseUrl },
              createTableIfMissing: true,
            })
          : undefined,
      cookie: {
        httpOnly: true,
        sameSite: production ? 'none' : 'lax',
        secure: production,
        maxAge: 1000 * 60 * 60 * 24 * 7,
      },
    }),
  );

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
