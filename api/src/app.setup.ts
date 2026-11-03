import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import cookieParser from 'cookie-parser';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import helmet from 'helmet';
import { IpRateLimit } from './rate-limit/ip-rate-limit.js';

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
  // Une origine CORS ne doit jamais se terminer par un slash : sinon
  // `Access-Control-Allow-Origin` ne correspond à aucune origine navigateur.
  // `auth.controller.ts` normalise déjà `FRONTEND_URL` pour OpenID ; on aligne
  // le CORS sur la même valeur pour éviter deux comportements selon la route.
  const origineFront = frontendUrl.replace(/\/+$/, '');

  // Nécessaire derrière le proxy de Render, sinon le cookie de session est
  // interprété sur le mauvais protocole.
  app.set('trust proxy', 1);

  // `/api/auth/*` est anonyme : le limiteur par `steamId` des lectures ne peut
  // pas s'appliquer. On borne les boucles avant le middleware de session, pour
  // qu'une requête rejetée ne crée justement pas de session en base. La limite
  // est volontairement large (60/min) : un utilisateur normal ne fait que
  // quelques allers-retours avec Steam. Configurable pour un événement.
  const limiteAuth = Number(
    process.env.AUTH_RATE_LIMIT_PER_MINUTE ?? '60',
  );
  const authRateLimit = new IpRateLimit(
    Number.isFinite(limiteAuth) && limiteAuth > 0 ? limiteAuth : 60,
  );
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (
      req.method !== 'OPTIONS' &&
      (req.path === '/api/auth/steam' ||
        req.path === '/api/auth/steam/return')
    ) {
      const retryAfterMs = authRateLimit.retryAfterMs(
        IpRateLimit.cleClient(req),
      );
      if (retryAfterMs > 0) {
        res.setHeader(
          'Retry-After',
          String(Math.max(1, Math.ceil(retryAfterMs / 1000))),
        );
        res.setHeader('Cache-Control', 'no-store');
        res.status(429).json({
          statusCode: 429,
          message: 'Trop de tentatives de connexion : réessaie plus tard.',
        });
        return;
      }
    }
    next();
  });

  app.use(cookieParser(sessionSecret));

  // CSP stricte en production : l'API ne sert que du JSON, aucune ressource
  // exécutable n'a besoin d'être autorisée. En développement elle reste
  // désactivée : le front (Vite sur :5173) possède sa propre politique et la
  // CSP n'a pas à gêner un éventuel rendu direct des réponses de l'API.
  app.use(
    helmet({
      contentSecurityPolicy: production
        ? {
            directives: {
              defaultSrc: ["'none'"],
              baseUri: ["'none'"],
              frameAncestors: ["'none'"],
              formAction: ["'none'"],
            },
          }
        : false,
    }),
  );

  // Aucune réponse de l'API n'est cachable : elles sont toutes liées à la
  // session. On le déclare explicitement car, en production, `/api` passe par
  // un rewrite externe Vercel qui met en cache les réponses de l'origine quand
  // celle-ci renvoie des en-têtes de cache.
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  const PgStore = connectPgSimple(session);

  // Session de connexion. `MemoryStore` convient au développement ; en
  // production le store est PostgreSQL, sinon chaque redéploiement Render
  // déconnecterait tout le monde. `sameSite: 'lax'` dans les deux cas : en
  // production le front (Vercel) proxifie `/api` vers l'API (Render), donc le
  // navigateur est toujours **same-site** (un seul domaine public) et le cookie
  // reste first-party — compatible Safari, contrairement à `none`. `secure` en
  // production pour traverser le proxy HTTPS de Render.
  app.use(
    session({
      secret: sessionSecret,
      resave: false,
      saveUninitialized: false,
      store:
        production && databaseUrl
          ? new PgStore({
              conObject: {
                connectionString: databaseUrl,
                // Le store de session interroge la base avant chaque
                // contrôleur : il doit échouer vite, pas attendre un client
                // libre indéfiniment si Neon est indisponible.
                max: 5,
                connectionTimeoutMillis: 5_000,
                idleTimeoutMillis: 30_000,
                statement_timeout: 15_000,
              },
              createTableIfMissing: true,
            })
          : undefined,
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
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

  // En production, le front proxifie `/api` : les requêtes navigateur sont
  // same-origin et n'ont pas besoin de CORS. On le laisse néanmoins, restreint
  // à l'origine du front, pour couvrir un accès direct à l'API et le proxy de
  // développement (`web/vite.config.ts`).
  app.enableCors({ origin: origineFront, credentials: true });
}
