# AGENTS.md — GameBacklog (fst-2026-groupe-08)

> Ce fichier est rédigé en français, comme le reste du projet. Les commandes, options de
> CLI et noms de fichiers restent en anglais : ils ne se traduisent pas.

## À lire en premier

`fiche_projet.md` (racine, en français) est la spécification produit de référence : modèle
de données, champs des entités, pipeline d'import, conception de la recherche
vectorielle, stack et liste des éléments hors périmètre. Lis-la avant d'implémenter
quoi que ce soit. Les décisions architecturales doivent rester cohérentes avec elle.

## État du projet

**Authentification Steam et import de bibliothèque fonctionnels.** L'authentification
passe par OpenID 2.0 (Steam, callback validé en `id_res`), la session est gérée par
`express-session` (cookie `httpOnly`, 7 jours, `MemoryStore` en dev, store PostgreSQL en
prod). Au callback, l'utilisateur est upserté dans `users` puis un import est mis en file
(`SyncService`) s'il n'est pas déjà `done`. La bibliothèque est **lue depuis la base**
(`library_entries ⋈ games`), plus jamais depuis Steam au fil des requêtes.

**Pipeline d'import en tâche de fond (`api/src/sync/`).** Trois étapes reprises au
redémarrage : `library` (persistance des `library_entries` depuis `GetOwnedGames`),
`details` (fiches `appdetails` manquantes), `embeddings` (texte
`nom + description + genres + catégories` → Gemini `gemini-embedding-001`, 1024 dims,
stocké dans `games.embedding`). Progression suivie par `GET /api/sync`, relance par
`POST /api/sync`. Un job interrompu (`running`) est remis en file au boot.

**Succès à la demande.** `GET /api/games/:appId` renvoie la fiche complète (description,
genres, catégories, support manette, temps de jeu) et charge les succès
(`GetSchemaForGame` + `GetPlayerAchievements`) uniquement à l'ouverture de la fiche.

**Front.** Pages Connexion, accueil, bibliothèque, détail d'un jeu (`/jeu/:appId`) et 404,
avec React Router et un provider de session. La bibliothèque sonde `GET /api/sync` toutes
les 2 s et s'affiche dès que l'étape `library` est passée.

**Sécurité.** CSP de production en place : stricte côté API (`app.setup.ts`, `default-src
'none'`, prod uniquement) et via les en-têtes Vercel côté front (CSP SPA + `nosniff` +
`Referrer-Policy`). Pas encore de rate limiting (reporté, voir Écart 10).

**Non implémenté :** recherche vectorielle (seule l'indexation des embeddings est faite),
accueil calculé (à relancer / à découvrir / proches), filtres et tri de la bibliothèque,
rate limiting par utilisateur, mise en ligne (socle et déploiement continu front
prêts, rien n'est encore réellement déployé).

**Fichiers clés :**
- `api/src/auth/` — authentification OpenID (validation `id_res`, timeouts), session, guard
- `api/src/sync/` — pipeline d'import (3 étapes, reprise, progression)
- `api/src/library/` — `ownedGames` (Steam, à l'import) et `savedLibrary` (lecture base)
- `api/src/games/` — fiches `appdetails`, détail utilisateur, `GET /api/games/:appId`
- `api/src/achievements/` — succès à la demande (`GetSchemaForGame` / `GetPlayerAchievements`)
- `api/src/users/` — upsert utilisateur, `syncStatus`
- `api/src/embedding/` — service d'embedding Gemini + rate limiter (100 rpm / 1000 j)
- `api/src/db/` — module Drizzle global, token `DB`, schéma pgvector
- `api/drizzle.config.ts` + `api/drizzle/` — config et migrations (0000→0003)
- `render.yaml` — blueprint Render (API seule)
- `api/src/app.setup.ts` — câblage (session, CORS, helmet + CSP conditionnelle en prod, ValidationPipe)
- `web/src/auth/` — provider et contexte de session
- `web/src/sync.ts` — suivi du job d'import (`lireSync`, `relancerSync`)
- `web/src/api.ts` — helper `urlApi()`, base relative (pas de `VITE_API_URL` en prod)
- `web/vercel.json` — rewrite `/api` + SPA et en-têtes de sécurité (CSP) pour Vercel, `git.deploymentEnabled: false`
- `.github/workflows/deploy.yml` — déploiement continu du front (CLI Vercel + token) sur push `main`
- `web/src/pages/` — pages de l'application (dont `JeuDetail.tsx`)
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
pose cookie-parser, helmet (CSP stricte en production, désactivée en dev/test), `ValidationPipe`,
le préfixe `/api`, CORS et `trust proxy`. Elle
est appelée par `main.ts` **et** par `test/app.e2e-spec.ts` : c'est délibéré, pour que le
test e2e exerce le vrai câblage. Un test qui instancierait l'application sans passer par
`configureApp` ne couvrirait rien de ce qui précède.

**CORS et proxy Vite sont tous deux présents, et c'est nécessaire.** `web/vite.config.ts`
proxifie `/api` vers `:3000`, ce qui rend les deux origines identiques en dev et permet un
cookie `sameSite=Lax` sur `http://localhost`. En production, `web/vercel.json` fait de même
par un rewrite externe `/api` → Render, donc le navigateur reste same-origin. Le `enableCors`
de `app.setup.ts` (restreint à `FRONTEND_URL`) couvre l'accès direct à l'API. Retire le
rewrite ou le proxy de dev et l'authentification par cookie casse dans un des deux
environnements.

**Le `ValidationPipe` est global et strict.** `whitelist` +
`forbidNonWhitelisted` signifient qu'un champ non déclaré dans un DTO provoque un 400, pas
qu'il est silencieusement ignoré. C'est voulu : ajoute la propriété au DTO, ne la supprime
pas du client.

**Pas de cycle entre `AuthModule`, `SyncModule` et `LibraryModule`.** `AuthModule` importe
`SyncModule` (enqueue au callback) et `SyncModule` importe `LibraryModule`. `LibraryModule`
ne doit donc **pas** importer `AuthModule` : un cycle provoque au démarrage un
`ReferenceError: Cannot access 'AuthModule' before initialization` (ESM, graphe évalué
dans l'ordre des imports). Le `SessionGuard` n'a aucune dépendance et s'utilise par
référence de classe (`@UseGuards(SessionGuard)`), comme dans `GamesModule` et `SyncModule` :
nul besoin d'importer `AuthModule` pour l'obtenir. Corollaire : `SyncService` est injecté par
`AuthController`, donc `SyncModule` doit l'`export`.

## Sécurité — état des points ouverts

**Points volontairement laissés de côté :**

- **Aucun rate limiting.** La spécification exige que l'entrée de recherche soit « limitée en
  fréquence par utilisateur » (`fiche_projet.md`). `@nestjs/throttler` n'a pas été installé :
  il raisonne par IP, ce qui n'est pas la clé demandée. **Décision : reporté**, le site n'étant
  pas encore exposé aux robots/crawlers ; à implémenter par utilisateur (clé de session) quand
  la recherche arrivera (voir Écart 10).

Résolus depuis : **timeouts** (`AbortSignal.timeout(5000)`), **validation de
`openid.mode === 'id_res'`** (voir Écarts 15 et 16) et **CSP de production** (voir Écart 14).

## Écarts spec ↔ code

Liste des écarts entre `fiche_projet.md` (spec) et le code réel, classés par gravité. Chaque
écart indique ce que demande la spec et l'état réel (✅ Résolu, ⚠️ Partiel, ou ce qu'il
reste à corriger).

### Écarts critiques

#### Écart 1 — Pipeline d'import de la bibliothèque — ✅ Résolu

| | Détail |
|---|---|
| **Spec** | « Connexion : authentification via Steam (OpenID), puis **import de la bibliothèque** avec suivi de progression. » (`fiche_projet.md:15`) — « L'import se fait en **tâche de fond** avec reprise : les entrées de bibliothèque d'abord, puis les fiches manquantes, puis les embeddings. » (`fiche_projet.md:39`) |
| **État** | ✅ Résolu — `api/src/sync/sync.service.ts` : `enqueue()` déclenché au callback (`api/src/auth/auth.controller.ts`) si le `syncStatus` n'est pas `done`, trois étapes reprises (`onModuleInit` remet les jobs `running` en `pending`). `ownedGames()` (Steam) n'est appelé qu'à l'import ; `savedLibrary(userId)` sert la page (`library_entries ⋈ games`). |

#### Écart 2 — Recherche vectorielle absente

| | Détail |
|---|---|
| **Spec** | « Recherche : saisie libre (« un jeu calme avec des énigmes, jouable à la manette ») et résultats classés. » (`fiche_projet.md:18`) — « embedding de la requête, puis SQL unique combinant **filtres stricts** (support manette, dans la bibliothèque de l'utilisateur) et **tri par similarité cosinus**. » (`fiche_projet.md:45`) — « liste de 10 jeux de la bibliothèque de l'utilisateur, avec le score de similarité et les critères respectés. » (`fiche_projet.md:46`) |
| **Code réel** | Aucun contrôleur de recherche n'existe dans `api/src/`. Aucun service de recherche n'existe. `web/src/components/RootLayout.tsx:37-39` : `<span className="nav-avenir" title="Bientôt disponible">Recherche</span>` — la navigation est désactivée. `api/src/embedding/embedding.service.ts` est désormais injecté par le `SyncService` (indexation), mais aucune requête n'embedde une saisie utilisateur. |
| **Correction** | Créer un `SearchModule` avec un contrôleur `GET /api/search?q=...` qui embeds la requête, interroge pgvector avec `ORDER BY embedding <=> $1`, filtre par `controllerSupport` et `userId`, renvoie 10 résultats avec score. |

#### Écart 3 — Page d'accueil non fonctionnelle

| | Détail |
|---|---|
| **Spec** | « Accueil : jeux à relancer ou à découvrir dans sa propre bibliothèque (jamais lancés, laissés en cours, proches de ses derniers jeux). » (`fiche_projet.md:16`) — « proximité vectorielle avec les jeux récemment lancés, sans appel supplémentaire à un modèle. » (`fiche_projet.md:48`) |
| **Code réel** | `web/src/pages/Accueil.tsx:4-20` : trois sections vides avec messages fixes — « Aucun jeu importé pour le moment. » / « Arrive avec la recherche par similarité. » Aucune donnée réelle n'est affichée. |
| **Correction** | Implémenter trois requêtes SQL : (1) jeux avec `playtimeLast2Weeks > 0` mais `playtimeForever` faible (à relancer), (2) jeux avec `playtimeForever = 0` (à découvrir), (3) jeux dont l'embedding est proche des derniers joués (proximité vectorielle). |

#### Écart 5 — Page de détail d'un jeu — ✅ Résolu

| | Détail |
|---|---|
| **Spec** | « Détail d'un jeu : description, genres, support manette, temps de jeu, succès obtenus, lien pour lancer le jeu dans Steam. » (`fiche_projet.md:19`) |
| **État** | ✅ Résolu — `api/src/games/games.controller.ts` expose `GET /api/games/:appId` (fiche + succès de l'utilisateur via `SessionGuard`), route `web/src/App.tsx` `/jeu/:appId` → `web/src/pages/JeuDetail.tsx` (description, genres, manette, temps de jeu, succès, lien `steam://run/<appId>`). |

#### Écart 7 — Embeddings branchés — ✅ Résolu

| | Détail |
|---|---|
| **Spec** | « Indexation (une fois par jeu, à l'import) : texte `nom + description + genres + catégories` → embedding stocké dans `Game.embedding` (pgvector). » (`fiche_projet.md:43`) |
| **État** | ✅ Résolu — `SyncService` (étape `embeddings`) injecte `EmbeddingService` (`embedGame`) et écrit `games.embedding` + `games.embeddingModel`. Un `EmbeddingRateLimiter` (100 rpm / 1000 j, persisté dans `rate_limits`) protège le quota Gemini ; le job reprend plus tard en cas de `QuotaReachedError`. |

#### Écart 8 — Fiches Steam (appdetails) récupérées — ✅ Résolu

| | Détail |
|---|---|
| **Spec** | « Game : … shortDescription, genres[], categories[], controllerSupport, releaseDate, headerImageUrl, embedding, embeddingModel, detailsFetchedAt — Source: Store `appdetails` » (`fiche_projet.md:26`) |
| **État** | ✅ Résolu — `api/src/games/games.service.ts` : `fetchAppDetails(appId)` appelle `https://store.steampowered.com/api/appdetails?appids=<id>` (timeout, jamais d'exception), `mapAppDetails`/`mapControllerSupport`/`parseReleaseDate` normalisent la fiche, `upsertFromDetails`/`upsertBasic` alimentent `games` (étape `details` du `SyncService`). |

### Écarts élevés

#### Écart 4 — Page bibliothèque — ⚠️ Partiel

| | Détail |
|---|---|
| **Spec** | « Bibliothèque : liste des jeux avec **temps de jeu, dernière utilisation, genres, filtres et tri classiques**. » (`fiche_projet.md:17`) |
| **État** | ⚠️ Partiel — champs enrichis faits : `GET /api/library` renvoie `playtimeForever`, `playtimeLast2Weeks`, `lastPlayedAt`, `genres`, `categories`, `controllerSupport`, `shortDescription`, `headerImageUrl`, `achievementsUnlocked` (`BibliothequeGamePersiste`), affichés dans `web/src/pages/Bibliotheque.tsx`. **Manquent** : filtres et tri (voir Écart 19). |

#### Écart 6 — Succès à la demande — ✅ Résolu

| | Détail |
|---|---|
| **Spec** | « Achievement : id, gameId, apiName, displayName, description, iconUrl — Source: `GetSchemaForGame` » (`fiche_projet.md:28`) — « UserAchievement : userId, achievementId, unlockedAt — Source: `GetPlayerAchievements` » (`fiche_projet.md:29`) — « Les succès (`Achievement`, `UserAchievement`) sont chargés **à la demande**, à l'ouverture du détail d'un jeu » (`fiche_projet.md:38`) |
| **État** | ✅ Résolu — `api/src/achievements/` : `getGameAchievements` (`GetSchemaForGame`, cache `achievements`) et `getUserAchievements` (`GetPlayerAchievements`, upsert `user_achievements` + compteur `library_entries.achievementsUnlocked`), appelés par `GamesService` au `GET /api/games/:appId`. `apiname` est normalisé en `apiName`. |

#### Écart 9 — Utilisateur persisté en base — ✅ Résolu

| | Détail |
|---|---|
| **Spec** | « User : id, steamId (unique), displayName, avatarUrl, lastSyncAt, syncStatus (pending / running / done / error), createdAt — Source: Steam OpenID + `GetPlayerSummaries` » (`fiche_projet.md:25`) |
| **État** | ✅ Résolu — le callback Steam (`api/src/auth/auth.controller.ts`) upsert l'utilisateur dans `users` (`displayName`, `avatarUrl`) via `UsersService`, puis met à jour `syncStatus` et `lastSyncAt` au fil du job (`SyncService`). `userId` est stocké en session pour les routes suivantes. |

### Écarts moyens (robustesse, sécurité, complétude)

#### Écart 10 — Rate limiting sur la recherche absent

| | Détail |
|---|---|
| **Spec** | « Entrée : phrase libre, longueur limitée (ex. 300 caractères), **limitée en fréquence par utilisateur**. » (`fiche_projet.md:44`) |
| **Code réel** | Aucun rate limiting n'existe. `@nestjs/throttler` n'est pas installé. La recherche n'existant pas, la limitation n'est pas encore applicable. |
| **Correction** | **Reporté** tant que le site n'est pas exposé aux robots/crawlers. Implémenter un guard de rate limiting par `steamId` (clé de session, pas par IP) sur la route de recherche, une fois celle-ci créée. |

#### Écart 11 — Repli si échec de la recherche absent

| | Détail |
|---|---|
| **Spec** | « Repli si échec (erreur, quota 429, latence excessive) : recherche classique par filtres (genre, manette, temps de jeu) et recherche textuelle sur le nom, avec un message d'information à l'utilisateur. » (`fiche_projet.md:47`) |
| **Code réel** | Non implémenté (la recherche n'existe pas). |
| **Correction** | Dans le service de recherche, encapsuler l'appel à Gemini dans un try/catch avec timeout. Sur échec, basculer sur une recherche SQL `LIKE` + filtres, et retourner un flag `degraded: true` au front. |

#### Écart 14 — CSP désactivée — ✅ Résolu

| | Détail |
|---|---|
| **Spec** | Non mentionné explicitement dans la spec. |
| **État** | ✅ Résolu — CSP stricte activée **en production** sur l'API (`api/src/app.setup.ts` : `default-src 'none'`, `base-uri`, `frame-ancestors`, `form-action`, désactivée en dev/test) et sur le front via les en-têtes Vercel (`web/vercel.json` : CSP SPA, `X-Content-Type-Options: nosniff`, `Referrer-Policy`). `style-src` autorise l'inline (une style inline dans `Bibliotheque.tsx`) et `img-src` les hôtes d'images Steam (`*.steamstatic.com`, `*.akamaihd.net`, `*.steamcontent.com`, `*.steampowered.com`) — à confirmer une fois le site déployé. |

#### Écart 15 — Timeouts sur les appels externes — ✅ Résolu

| | Détail |
|---|---|
| **Spec** | Non mentionné. |
| **État** | ✅ Résolu — `AbortSignal.timeout(5000)` ajouté aux appels `verifySteamCallback` / `fetchPlayerSummary` (`api/src/auth/auth.service.ts`), `EmbeddingService.embed`, `LibraryService.ownedGames` et `GamesService.fetchAppDetails`. |

#### Écart 17 — Lien pour lancer le jeu dans Steam — ✅ Résolu

| | Détail |
|---|---|
| **Spec** | « Détail d'un jeu : … lien pour lancer le jeu dans Steam. » (`fiche_projet.md:19`) |
| **État** | ✅ Résolu — `web/src/pages/JeuDetail.tsx` affiche un lien `steam://run/<appId>`. **Note** : « Lancement automatique des jeux » reste hors périmètre (`fiche_projet.md:64`), mais la spec demandait un **lien** cliquable, ce qui est fait. |

### Écarts faibles (incohérences mineures)

#### Écart 12 — Hébergement : spec vs réalité

| | Détail |
|---|---|
| **Spec** | « Hébergement : Render (Front + API), Neon (PostgreSQL) » (`fiche_projet.md:58`) |
| **Code réel** | `render.yaml:1-4` : « Le front est hébergé sur Vercel (voir web/vercel.json) ; ce fichier ne décrit que l'API. » `web/vercel.json` existe. La décision Vercel + Render + Neon est implémentée et documentée dans la section « Cible de déploiement » de ce fichier. |
| **Correction** | Mettre à jour `fiche_projet.md:58` pour refléter la décision Vercel + Render + Neon. La spec est obsolète sur ce point. |

#### Écart 13 — DTO validés : pipe en place mais aucun DTO concret

| | Détail |
|---|---|
| **Spec** | « API : NestJS + TypeScript (DTO validés) » (`fiche_projet.md:54`) |
| **Code réel** | `api/src/app.setup.ts:65-71` : `ValidationPipe` est configuré globalement avec `whitelist: true, forbidNonWhitelisted: true, transform: true`. **Mais** aucun fichier `*dto.ts` n'existe dans le codebase. Aucune classe DTO n'est définie. |
| **Correction** | Créer des DTO pour chaque route acceptant un corps ou des paramètres de requête (recherche, filtres de bibliothèque). |

#### Écart 16 — Validation de `openid.mode` — ✅ Résolu

| | Détail |
|---|---|
| **Spec** | Non mentionné. |
| **État** | ✅ Résolu — `verifySteamCallback` (`api/src/auth/auth.service.ts`) rejette les réponses dont `openid.mode` n'est pas `id_res` avant toute validation de signature. |

#### Écart 18 — Message d'aide si profil privé

| | Détail |
|---|---|
| **Spec** | « Message d'aide si le profil est privé. » (`fiche_projet.md:15`) |
| **Code réel** | L'échec survient désormais à l'import : `LibraryService.ownedGames` lève `ServiceUnavailableException` (« profil privé ou clé invalide »), le `SyncService` la capture et stocke le message dans `sync_jobs.error` ; le front l'affiche (`web/src/pages/Bibliotheque.tsx`). **Mais** pas de message d'aide spécifique (comment rendre le profil public). |
| **Correction** | Ajouter un message d'aide explicite dans le front : « Ton profil Steam est privé. Rends-le public dans les paramètres Steam pour importer ta bibliothèque. » |

#### Écart 19 — Tri et filtres de la bibliothèque absents

| | Détail |
|---|---|
| **Spec** | « Bibliothèque : liste des jeux avec temps de jeu, dernière utilisation, genres, **filtres et tri classiques**. » (`fiche_projet.md:17`) |
| **Code réel** | `web/src/pages/Bibliotheque.tsx` : aucune fonctionnalité de filtre ou tri. `api/src/library/library.controller.ts` : route `GET /api/library` sans paramètres de requête. |
| **Correction** | Ajouter des paramètres `?tri=nom\|temps\|date&filtre_genre=&filtre_manette=&filtre_joues=` et les contrôles correspondants dans le front. |

#### Écart 20 — Jeux à relancer / à découvrir absents

| | Détail |
|---|---|
| **Spec** | « Accueil : jeux à relancer ou à découvrir dans sa propre bibliothèque (jamais lancés, laissés en cours, proches de ses derniers jeux). » (`fiche_projet.md:16`) |
| **Code réel** | `web/src/pages/Accueil.tsx:4-20` : sections vides avec messages fixes. |
| **Correction** | Implémenter les trois requêtes SQL décrites dans l'Écart 3. |

### Priorités d'implémentation

Ordre recommandé pour combler les écarts restants :

1. **Recherche vectorielle** (Écarts 2, 10, 11) : `SearchModule` avec pgvector, rate limiting par `steamId`, fallback dégradé. Gros morceau restant.
2. **Accueil calculé** (Écarts 3, 20) : trois requêtes SQL (à relancer, à découvrir, proches).
3. **Bibliothèque enrichie** (Écarts 4, 19) : filtres et tri.
4. **Sécurité et robustesse** (Écart 18) : message d'aide si profil privé. Prérequis avant mise en ligne.
5. **Divers** (Écarts 12, 13) : mettre à jour `fiche_projet.md` (hébergement), créer les DTO.

## Base de données

La base locale est la seule chose dans `docker-compose.yml` :

```
docker compose up -d     # pgvector/pgvector:pg16 sur :5432, user/pw/db = gamebacklog
```

Cela correspond au `DATABASE_URL` du `.env` racine. Utilise pgvector, pas du Postgres
classique — la spécification exige une recherche par similarité vectorielle sur
`Game.embedding`.

Drizzle est configuré : `api/drizzle.config.ts` (charge `../.env`), schéma dans
`api/src/db/schema.ts`, migrations dans `api/drizzle/` (0000→0003). `npm run db:migrate`
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

`EMBEDDING_RATE_LIMIT_PER_MINUTE` et `EMBEDDING_RATE_LIMIT_PER_DAY` sont optionnels
(défauts : `100` / `1000`) : ils plafonnent les appels Gemini, le job reprenant plus tard
au-delà du quota.

## Cible de déploiement

Hébergement retenu — **départ de la fiche**, qui prévoyait Render pour le front :
**Vercel** (`web`) + **Render** (`api`) + **Neon** (PostgreSQL).

- `render.yaml` (racine) : blueprint de l'API — `New → Blueprint` sur Render le
  crée avec les bonnes commandes. Build `npm ci --include=dev && npm run build` :
  le `--include=dev` est **indispensable**, car `NODE_ENV=production` ferait
  omettre les devDependencies requises par `nest build` (`@nestjs/cli`,
  `typescript`). `NODE_VERSION=22` fixe le plancher `>=22.12.0`. Les variables
  `sync: false` (`DATABASE_URL`, `STEAM_API_KEY`, `EMBEDDING_API_KEY`,
  `FRONTEND_URL`) sont demandées **une seule fois** à la création,
  `SESSION_SECRET` est générée. Auto-deploy à chaque push, plan gratuit.
- `web/vercel.json` : **rewrite externe** `/api/:path*` → URL de l'API Render,
  catch-all SPA, et en-têtes de sécurité (CSP, `nosniff`, `Referrer-Policy`).
  Import du dépôt sur Vercel avec Root Directory = `web`. **Ne pas définir
  `VITE_API_URL`** : les appels `/api` du front restent relatifs et passent par
  le rewrite, ce qui rend le navigateur **same-origin** (cookie first-party).
- Déploiement du front : **GitHub Actions** (`.github/workflows/deploy.yml`),
  déclenché par un push sur `main` (donc à chaque merge de PR). Le workflow
  utilise la CLI Vercel avec un token (`VERCEL_TOKEN`, `VERCEL_ORG_ID`,
  `VERCEL_PROJECT_ID` en secrets GitHub) : il construit l'artefact
  (`vercel build`) puis le déploie (`vercel deploy --prebuilt --prod`). Le
  déploiement par token ne contrôle **pas** l'auteur du commit, contrairement à
  l'intégration Git native de Vercel (réservée au propriétaire du compte Hobby) :
  `git.deploymentEnabled: false` dans `web/vercel.json` la désactive, et tout
  contributeur peut déployer en mergant une PR.
- `FRONTEND_URL` (Render) = origine Vercel en `https`, **sans slash final** :
  elle sert de `realm` OpenID et de base de `return_to`
  (`api/src/auth/auth.controller.ts`). Ordre : déployer l'API d'abord, reporter
  son URL dans `web/vercel.json`, déployer le front, puis renseigner l'URL Vercel
  dans `FRONTEND_URL` et redéployer l'API.
- Neon : utiliser la chaîne **directe** (non-pooler) + `sslmode=require` ; le
  pooler transactionnel est incompatible avec le `pg_advisory_lock` de session
  pris par `DbModule` au démarrage (voir « Base de données »).
- Migrations appliquées au démarrage de l'API (voir « Base de données ») :
  **pousser suffit, aucune commande après l'ajout d'une fonctionnalité.**
- Cookie de session : `sameSite=lax` + `secure` en production, `lax` seul en
  dev. Le front proxifie `/api`, donc le navigateur ne voit qu'un seul domaine
  public (same-site) et le cookie reste first-party — compatible Safari,
  contrairement à `none`. Câblage dans `app.setup.ts` : ne pas y toucher sans
  re-vérifier le flux Steam.
- Sessions : store PostgreSQL (`connect-pg-simple`, table `session` créée au
  premier usage) quand `NODE_ENV=production`, `MemoryStore` sinon — c'est ce qui
  évite de déconnecter tout le monde à chaque redéploiement.

Le fichier compose sert uniquement au développement local ; le seul pipeline
d'intégration est le workflow GitHub Actions de déploiement du front
(`.github/workflows/deploy.yml`). Aucun Dockerfile. Rien n'est encore réellement
déployé.
