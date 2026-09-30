# AGENTS.md — GameBacklog (fst-2026-groupe-08)

> Ce fichier est rédigé en français, comme le reste du projet. Les commandes, options de
> CLI et noms de fichiers restent en anglais : ils ne se traduisent pas.

## À lire en premier

`fiche_projet.md` (racine, en français) est la spécification produit de référence : modèle
de données, champs des entités, pipeline d'import, conception de la recherche
vectorielle, stack et liste des éléments hors périmètre. Lis-la avant d'implémenter
quoi que ce soit. Les décisions architecturales doivent rester cohérentes avec elle.

État actuel : **squelette uniquement**. L'infrastructure est branchée (`.env`, CORS, proxy,
`ValidationPipe`, cookie-parser, préfixe `/api`, config vitest) mais **aucune fonctionnalité
n'existe**. `web/src/App.tsx` est le boilerplate Vite d'origine, non modifié, et le seul point
d'entrée de l'API est `GET /api` qui renvoie `'Hello World!'`. Tout ce qui est mentionné
ci-dessous au sujet de Steam, des embeddings, de l'authentification et de la recherche relève
de la spécification, pas de code existant.

## Structure — deux paquets indépendants, pas de racine npm

La racine ne contient **aucun `package.json`**. Un `package.json` racine avait été créé par
erreur (une seule devDependency `vitest`, zéro script, sans script ni config qui le
référence) ; il a été supprimé, sa devDependency étant déjà déclarée dans `web/`.

`api/` et `web/` ont chacun leur propre `package.json` + `package-lock.json` et doivent être
installés et lancés indépendamment :

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
| `web/` | `npm run lint` | ESLint 10, flat config |
| `web/` | `npm run build` | `tsc -b && vite build` — le `tsc -b` est le **seul** typecheck du projet |
| `web/` | `npm run dev` / `npm run preview` | |

Exécution ciblée de tests (depuis `api/`) :
- un seul fichier : `npx vitest run src/app.controller.spec.ts`
- par nom de test : `npx vitest run -t "Hello World"`
- debug : `npm run test:debug`

`npm test` n'inclut **pas** les tests e2e — lance `npm run test:e2e` séparément. Ordre
suggéré avant commit : `api: lint -> test -> test:e2e`, `web: lint -> build`.

Toutes les routes de l'API sont sous le préfixe `/api` (`setGlobalPrefix` dans
`api/src/app.setup.ts`). Le point de terminaison par défaut est donc `http://localhost:3000/api`.

## Pièges

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
plus satisfait. Bump Coordiné des deux paquets, pas de caret.

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
s'applique qu'aux fichiers **non** suivis. Le fichier a été retiré de l'index
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

**Dette de sécurité connue, à traiter avant la mise en ligne.** Deux points, volontairement
laissés de côté :
- **CSP désactivée.** `helmet` est branché mais avec `contentSecurityPolicy: false`, car une
  CSP stricte bloque les scripts inline et le WebSocket du HMR de Vite. Le vrai CSP reste à
  écrire pour la production.
- **Aucun rate limiting.** La spécification exige que l'entrée de recherche soit « limitée en
  fréquence par utilisateur » (`fiche_projet.md`). `@nestjs/throttler` n'a pas été installé :
  il raisonne par IP, ce qui n'est pas la clé demandée et serait à remplacer dès que la
  session Steam existera. À implémenter par utilisateur, en s'appuyant sur la session.

**`.env.example` porte les valeurs de développement, pas les secrets.** `DATABASE_URL` et
`FRONTEND_URL` y sont renseignées pour que le `cp .env.example .env` du `README.md` produise
un `.env` qui démarre l'API et la base. Les trois clés restent vides à remplir. C'est
volontaire : `FRONTEND_URL=` (vide) donnerait `''` comme origine CORS, car `main.ts` teste
avec `||` et non `??`. Le fichier reste commité, donc n'y mets jamais de secret.

## Base de données

La base locale est la seule chose dans `docker-compose.yml` :

```
docker compose up -d     # pgvector/pgvector:pg16 sur :5432, user/pw/db = gamebacklog
```

Cela correspond au `DATABASE_URL` du `.env` racine. Utilise pgvector, pas du Postgres
classique — la spécification exige une recherche par similarité vectorielle sur
`Game.embedding`.

Drizzle (`drizzle-orm`, `pg`, `drizzle-kit`) est installé mais **pas encore configuré** :
il n'y a ni `drizzle.config.ts` ni dossier de migrations. Les créer relève de ta
responsabilité ; il n'existe pas encore de script `db:*`.

## Environnement

Variables requises, toutes côté API uniquement, jamais dans git : `DATABASE_URL`,
`STEAM_API_KEY`, `EMBEDDING_API_KEY`, `SESSION_SECRET`, `FRONTEND_URL`. Elles sont chargées
par `ConfigModule.forRoot()` dans `app.module.ts`, à partir du `.env` **racine**. Les trois
clés (`STEAM_API_KEY`, `EMBEDDING_API_KEY`, `SESSION_SECRET`) sont vides dans le dépôt :
rien de lié à Steam ou aux embeddings n'est testable avant de les remplir.

## Conventions

- Les messages de commit sont en **français** (voir `git log`). Suis cette langue.
- La spécification, le `README.md` et les commentaires de code sont en français ; garde les
  chaînes visibles par l'utilisateur et la documentation cohérentes avec cela.
- Hors périmètre selon la spécification, ne pas implémenter : Epic/GOG, fonctionnalités
  sociales, lancement automatique de jeux, import du catalogue Steam complet,
  recommandations générées par un LLM.

## Cible de déploiement

Render pour `web` + `api`, Neon pour PostgreSQL (d'après `fiche_projet.md`). Il n'y a
**aucune CI**, aucune GitHub Action et aucun Dockerfile — le fichier compose sert
uniquement au développement local. La configuration de déploiement n'existe pas encore
dans le dépôt.
