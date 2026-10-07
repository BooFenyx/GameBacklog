# AGENTS.md — GameBacklog (fst-2026-groupe-08)

> Ce fichier est rédigé en français, comme le reste du projet. Les commandes, options de
> CLI et noms de fichiers restent en anglais : ils ne se traduisent pas.

## À lire en premier

`fiche_projet.md` (racine, en français) est la spécification produit de référence : modèle
de données, champs des entités, pipeline d'import, conception de la recherche
vectorielle, stack et liste des éléments hors périmètre. Lis-la avant d'implémenter
quoi que ce soit. Les décisions architecturales doivent rester cohérentes avec elle.

## État du projet

**Authentification Steam et bibliothèque fonctionnelles.** L'authentification passe par
OpenID 2.0 (Steam), la session est gérée par `express-session` (cookie `httpOnly`,
7 jours, `MemoryStore` en dev). La bibliothèque récupère les jeux possédés via la Steam
Web API (`IPlayerService/GetOwnedGames`). Le front a 4 pages (Connexion, bibliothèque,
accueil, 404) avec React Router et un provider de session.

**Embeddings et base de données : infrastructure en place, pas encore branchée.** Le
module `api/src/embedding/` génère des embeddings via l'API Gemini (`gemini-embedding-001`,
1024 dimensions, retour `null` si la clé manque). Le module `api/src/db/` expose Drizzle
(`pg` + pgvector) via un token global `DB` : schéma 5 tables dont `games.embedding
vector(1024)`. Rien n'injecte encore `DB` ni `EmbeddingService` — aucun pipeline d'import
ni persistance n'existe. Les migrations s'appliquent automatiquement au démarrage de
l'API (verrou advisory).

**Non implémenté :** recherche vectorielle, pipeline d'import/persistance des jeux,
branchement des embeddings, mise en ligne (socle prêt, rien n'est encore déployé).

**Fichiers clés :**
- `api/src/auth/` — authentification OpenID, session, guard
- `api/src/library/` — récupération des jeux possédés
- `api/src/embedding/` — service d'embedding Gemini (non branché)
- `api/src/db/` — module Drizzle global, token `DB`, schéma pgvector
- `api/drizzle.config.ts` + `api/drizzle/` — config et migrations
- `render.yaml` — blueprint Render (API seule)
- `api/src/app.setup.ts` — câblage (session, CORS, helmet, ValidationPipe)
- `web/src/auth/` — provider et contexte de session
- `web/src/api.ts` — helper `urlApi()` (base `VITE_API_URL`)
- `web/vercel.json` — rewrite SPA pour Vercel
- `web/src/pages/` — pages de l'application
- `web/src/components/RootLayout.tsx` — layout avec navigation et bandeau auth

## Structure — deux paquets indépendants, pas de racine npm

La racine ne contient **aucun `package.json`**. `api/` et `web/` ont chacun leur propre
`package.json` + `package-lock.json` et doivent être installés et lancés indépendamment :

- `cd api && npm install && npm run start:dev` → http://localhost:3000
- `cd web && npm install && npm run dev` → http://localhost:5173

Il n'existe donc **aucune commande `npm` utilisable depuis la racine** : n'y lance jamais
`install`, `build` ou `test`, tu n'y verrouillerais rien et les paquets ne seraient pas
couverts. Un seul `.gitignore` à la racine couvre les deux côtés : `coverage/`, `.vitest/`,
les `*.tsbuildinfo` et les fichiers d'éditeur.

`vitest` est aligné en **5.x dans les deux paquets**. Ils gardent chacun leur `node_modules`,
donc deux copies de `vitest` sur le disque : c'est normal et voulu pour deux paquets
autonomes, pas un oubli. Ne tente pas de mutualiser.

Les deux paquets déclarent `"engines": { "node": ">=22.12.0" }`, plancher imposé par
`vitest` 5.

## Commandes (toutes vérifiées fonctionnelles)

| Où | Commande | Remarques |
|---|---|---|
| `api/` | `npm run start:dev` | Mode watch Nest |
| `api/` | `npm run lint` | **oxlint** avec `--type-aware` (nécessite `oxlint-tsgolint`, déjà en devDep) |
| `api/` | `npm run format` | Prettier : guillemets simples, `trailingComma: all` |
| `api/` | `npm test` | vitest 5, `**/*.spec.ts` hors `*.e2e-spec.ts` |
| `api/` | `npm run test:cov` | idem + couverture v8, summarized |
| `api/` | `npm run test:e2e` | config séparée, `**/*.e2e-spec.ts` uniquement |
| `api/` | `npm run build` | `nest build` → `api/dist` |
| `api/` | `npm run db:generate` | drizzle-kit → nouvelle migration dans `api/drizzle/` |
| `api/` | `npm run db:migrate` | Applique les migrations (base via `docker compose up -d`) |
| `api/` | `npm run db:studio` | Drizzle Studio (interface web) |
| `web/` | `npm run lint` | ESLint 10, flat config |
| `web/` | `npm run build` | `tsc -b && vite build` — le `tsc -b` est le **seul** typecheck du projet |
| `web/` | `npm run dev` / `npm run preview` | |

Exécution ciblée de tests (depuis `api/`) :
- un seul fichier : `npx vitest run src/auth/auth.service.spec.ts`
- par nom de test : `npx vitest run -t "Steam"`
- debug : `npm run test:debug`

`npm test` n'inclut **pas** les tests e2e — lance `npm run test:e2e` séparément. Ordre
suggéré avant commit : `api: lint -> test -> test:e2e`, `web: lint -> build`.

Toutes les routes de l'API sont sous le préfixe `/api` (`setGlobalPrefix` dans
`api/src/app.setup.ts`). Le point de terminaison par défaut est donc `http://localhost:3000/api`.

## Conventions de code

### API (`api/`)

- **ESM strict** : `package.json` contient `"type": "module"`, `tsconfig.json` utilise
  `module`/`moduleResolution: nodenext`. Les imports relatifs **exigent l'extension `.js`** :
  écris `import { AuthService } from './auth.service.js'`, même si le fichier est un `.ts`.
- **Prettier** : guillemets simples, points-virgules, `trailingComma: all`.
- **NestJS** : controllers, services, modules, guards. Les routes sont préfixées par `/api`.

### Web (`web/`)

- **Bundler mode** : la résolution est de type *bundler*, les imports se font **sans extension**.
- **Aucune config Prettier** : style du scaffold Vite — pas de points-virgules, guillemets
  simples, pas de virgules finales. ESLint n'impose rien de tout cela ici.
- **React 19 + React Router 7** : fonctionnel (hooks), pas de classes.

### Tests

- **API** : `*.spec.ts` (unitaires), `*.e2e-spec.ts` (e2e). Configs vitest séparées.
- **Web** : `vitest` est en devDependency mais **aucun script `test`** dans `package.json`.
  Ajouter un test côté web implique d'ajouter aussi le script dans `web/package.json`.
- Le `tsc -b` de `npm run build` exclut déjà `src/**/*.test.*` et `src/**/*.spec.*` :
  sans ça, le premier test web ferait échouer le build, car `tsconfig.app.json` ne déclare
  que `types: ["vite/client"]` et ignore donc les globals vitest.

### Commits

- Les messages de commit sont en **français** (voir `git log`). Suis cette langue.
- La spécification, le `README.md` et les commentaires de code sont en français ; garde les
  chaînes visibles par l'utilisateur et la documentation cohérentes avec cela.
- Hors périmètre selon la spécification, ne pas implémenter : Epic/GOG, fonctionnalités
  sociales, lancement automatique de jeux, import du catalogue Steam complet,
  recommandations générées par un LLM.

## Mise à jour de l'AGENTS.md

Ce fichier est maintenu par l'agent. Après chaque fonctionnalité terminée, l'agent doit
mettre à jour les sections « État du projet » et « Fichiers clés » pour refléter le
travail effectué.

**Aucune modification de ce fichier ne peut être faite sans validation préalable du
développeur.** L'agent doit présenter un plan décrit des modifications envisagées
(sections concernées, contenu ajouté ou modifié) et attendre la confirmation explicite
du développeur avant d'appliquer les changements.

## Pièges techniques

**ESM dans `api/` — les imports relatifs exigent l'extension `.js`.** `api/package.json`
contient `"type": "module"` et `tsconfig.json` utilise `module`/`moduleResolution:
nodenext`, donc `import { AppController } from './app.controller'` ne se résout pas.
Écris toujours `'./app.controller.js'`, même si le fichier est un `.ts`. Ne transpose pas
cette règle à `web/` : là, la résolution est de type *bundler* et les imports se font sans
extension.

**Deux cultures de lint/format différentes — ne les mélange pas.**
- `api/` : géré par Prettier. Guillemets simples, points-virgules, virgules finales.
- `web/` : **aucune config Prettier du tout**, donc style du scaffold Vite — pas de
  points-virgules, guillemets simples, pas de virgules finales. ESLint n'impose rien de
  tout cela ici.

**`web/` a `vitest` en devDependency mais aucun script `test`.** Ajouter un test côté web
implique d'ajouter aussi le script dans `web/package.json`. Le `tsc -b` de `npm run build`
exclut déjà `src/**/*.test.*` et `src/**/*.spec.*` : sans ça, le premier test web ferait
échouer le build, car `tsconfig.app.json` ne déclare que `types: ["vite/client"]` et ignore
donc les globals vitest.

**`@vitest/coverage-v8` est épinglé à l'exact, volontairement.** Vitest déclare ce paquet en
peer dependency avec une version **exacte** (`5.0.2`), pas un range. Ne le passe pas en
`^5.0.2` : à la sortie de `5.0.3`, npm installerait la nouvelle version et le peer ne serait
plus satisfait. Bump coordonné des deux paquets, pas de caret.

**`vite` doit être déclaré explicitement dans `api/package.json`.** En vitest 4, vite était une
dépendance directe de vitest ; en vitest 5 il n'est plus qu'un peer dependency obligatoire. Sans
la déclaration, npm l'installe quand même mais comme dépendance fantôme non déclarée.

**`resolve: { tsconfigPaths: true }` remplace le plugin `vite-tsconfig-paths`.** Vite 8 gère
nativement les alias de `tsconfig.json`. Le plugin a été retiré car il ne résolvait rien
(`api/tsconfig.json` ne déclare ni `paths` ni `baseUrl`) et n'affichait qu'un avertissement.
Conserve l'option native : elle s'activera dès que `nest g library` créera des alias.

**Les `*.tsbuildinfo` sont ignorés par git.** `tsconfig.json` active `incremental: true`,
donc `api/tsconfig.build.tsbuildinfo` se régénère à chaque `npm run build` (≈130 Ko de JSON
sur une seule ligne). Le motif `*.tsbuildinfo` est dans le `.gitignore` racine : ne le
retire pas et ne le reclasse pas dans git, sinon chaque build pollue le diff.

Attention, ce motif n'avait pas fonctionné jusqu'au nettoyage du squelette :
`api/tsconfig.build.tsbuildinfo` avait été commité dans `b65a40b`, et `.gitignore` ne
s'applique qu'aux fichiers **non** suivis. Le fichier a été retiré de l`index
(`git rm --cached`) ; la règle s'applique désormais pour de bon.

**Le `.env` est à la racine, mais vit le cwd.** `ConfigModule.forRoot` résout
`fs.existsSync` **relativement au cwd**, donc depuis `api/` un chemin doit être `../.env` et
non `../../.env` : `api/` est directement sous la racine du dépôt, pas sous `apps/api/`.
`app.module.ts` passe `envFilePath: '../.env'`, chemin unique volontairement. Un chemin
inexistant est ignoré silencieusement, ce qui laisse le déploiement (Render) s'appuyer sur
les variables d'environnement injectées. Ne le passe pas en tableau : `@nestjs/config`
n'applique `resolve()` que sur la forme scalaire, et l'ordre d'un tableau se lit à l'envers
(premier chemin existant l'emporte).

**Le câblage de l'application est dans `app.setup.ts`, pas dans `main.ts`.** `configureApp`
pose cookie-parser, helmet, `ValidationPipe`, le préfixe `/api`, CORS et `trust proxy`. Elle
est appelée par `main.ts` **et** par `test/app.e2e-spec.ts` : c'est délibéré, pour que le
test e2e exerce le vrai câblage. Un test qui instancierait l'application sans passer par
`configureApp` ne couvrirait rien de ce qui précède.

**CORS et proxy Vite sont tous deux présents, et c'est nécessaire.** `web/vite.config.ts`
proxifie `/api` vers `:3000`, ce qui rend les deux origines identiques en dev et permet un
cookie `sameSite=Lax` sur `http://localhost`. Le `enableCors` de `app.setup.ts` sert au
déploiement, où Render sert `web` et `api` sur des origines distinctes. Retire l'un des deux
et l'authentification par cookie casse dans un des deux environnements.

**Le `ValidationPipe` est global et strict.** `whitelist` +
`forbidNonWhitelisted` signifient qu'un champ non déclaré dans un DTO provoque un 400, pas
qu'il est silencieusement ignoré. C'est voulu : ajoute la propriété au DTO, ne la supprime
pas du client.

## Sécurité — à corriger avant mise en ligne

**Dette de sécurité connue, à traiter avant la mise en ligne.** Points volontairement
laissés de côté :

- **CSP désactivée.** `helmet` est branché mais avec `contentSecurityPolicy: false`, car une
  CSP stricte bloque les scripts inline et le WebSocket du HMR de Vite. Le vrai CSP reste à
  écrire pour la production.
- **Aucun rate limiting.** La spécification exige que l'entrée de recherche soit « limitée en
  fréquence par utilisateur » (`fiche_projet.md`). `@nestjs/throttler` n'a pas été installé :
  il raisonne par IP, ce qui n'est pas la clé demandée et serait à remplacer dès que la
  session Steam existera. À implémenter par utilisateur, en s'appuyant sur la session.
- **Pas de timeout sur les appels externes.** `verifySteamCallback`,
  `fetchPlayerSummary` et l'appel Gemini de `EmbeddingService.embed` n'ont pas de
  timeout : si le service distant ne répond pas, la requête reste suspendue. Un
  `AbortSignal.timeout(5000)` ou similaire serait prudent.
- **Pas de validation de `openid.mode`.** Le callback ne vérifie pas que le mode est
  `id_res` (un `cancel` avec un `claimed_id` pourrait passer si la signature est valide).

## Base de données

La base locale est la seule chose dans `docker-compose.yml` :

```
docker compose up -d     # pgvector/pgvector:pg16 sur :5432, user/pw/db = gamebacklog
```

Cela correspond au `DATABASE_URL` du `.env` racine. Utilise pgvector, pas du Postgres
classique — la spécification exige une recherche par similarité vectorielle sur
`Game.embedding`.

Drizzle est configuré : `api/drizzle.config.ts` (charge `../.env`), schéma dans
`api/src/db/schema.ts`, migrations dans `api/drizzle/` (0000 générée). `npm run db:migrate`
applique à la main, **mais ce n'est plus nécessaire** : `DbModule` applique les migrations
manquantes au démarrage, sous verrou advisory (`pg_advisory_lock`) pour sérialiser les
démarreurs concurrents (workers e2e, chevauchement de déploiements). La 0000 crée
`CREATE EXTENSION IF NOT EXISTS vector` — obligatoire sur une base fraîche type Neon.

`DbModule` est global et **exige `DATABASE_URL` et une base joignable au boot** : la
migration s'exécute immédiatement, la base doit donc être up avant l'API (c'est le cas
sur Render).

## Environnement

Variables requises, toutes côté API uniquement, jamais dans git : `DATABASE_URL`,
`STEAM_API_KEY`, `EMBEDDING_API_KEY`, `SESSION_SECRET`, `FRONTEND_URL`. Elles sont chargées
par `ConfigModule.forRoot()` dans `app.module.ts`, à partir du `.env` **racine**. Les trois
clés (`STEAM_API_KEY`, `EMBEDDING_API_KEY`, `SESSION_SECRET`) sont vides dans le dépôt :
rien de lié à Steam ou aux embeddings n'est testable avant de les remplir.

`STEAM_API_KEY` est requise pour l'authentification (profil) et la bibliothèque (jeux).
Sans elle, `fetchPlayerSummary` renvoie `null` et `ownedGames` lève un 503.

`EMBEDDING_MODEL` et `EMBEDDING_DIMENSIONS` sont optionnels (défauts :
`gemini-embedding-001` / `1024`). Changer les dimensions exige une migration de
`games.embedding`.

## Cible de déploiement

Hébergement retenu — **départ de la fiche**, qui prévoyait Render pour le front :
**Vercel** (`web`) + **Render** (`api`) + **Neon** (PostgreSQL).

- `render.yaml` (racine) : blueprint de l'API — `New → Blueprint` sur Render le
  crée avec les bonnes commandes. Les variables `sync: false` (`DATABASE_URL`,
  `STEAM_API_KEY`, `EMBEDDING_API_KEY`, `FRONTEND_URL`) sont demandées **une
  seule fois** à la création, `SESSION_SECRET` est générée. Auto-deploy à chaque
  push, plan gratuit.
- `web/vercel.json` : rewrite SPA. Import du dépôt sur Vercel avec
  Root Directory = `web`, et variable d'environnement **`VITE_API_URL`** = URL de
  l'API Render (au build). Sans elle, les appels `/api` du front restent relatifs
  et cassent en prod (`web/src/api.ts` lit cette variable).
- Migrations appliquées au démarrage de l'API (voir « Base de données ») :
  **pousser suffit, aucune commande après l'ajout d'une fonctionnalité.**
- Cookie de session : `sameSite=none` + `secure` en production, car
  `*.vercel.app` et `*.onrender.com` sont deux **sites** différents (`lax`
  supprimerait le cookie des requêtes cross-site). En dev, `lax` est conservé
  (localhost, même site malgré les ports). Câblage dans `app.setup.ts` :
  ne pas y toucher sans re-vérifier le flux Steam.
- Sessions : store PostgreSQL (`connect-pg-simple`, table `session` créée au
  premier usage) quand `NODE_ENV=production`, `MemoryStore` sinon — c'est ce qui
  évite de déconnecter tout le monde à chaque redéploiement.

Aucune CI, aucune GitHub Action et aucun Dockerfile — le fichier compose sert
uniquement au développement local. Rien n'est encore réellement déployé.
