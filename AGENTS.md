# AGENTS.md — GameBacklog (fst-2026-groupe-08)

> Ce fichier est rédigé en français, comme le reste du projet. Les commandes, options de
> CLI et noms de fichiers restent en anglais : ils ne se traduisent pas.

## À lire en premier

`fiche_projet.md` (racine, en français) est la spécification produit de référence : modèle
de données, champs des entités, pipeline d'import, conception de la recherche
vectorielle, stack et liste des éléments hors périmètre. Lis-la avant d'implémenter
quoi que ce soit. Les décisions architecturales doivent rester cohérentes avec elle.

État actuel : **squelette uniquement**. `web/src/App.tsx` est le boilerplate Vite
d'origine, non modifié, et `api/src/` est le module d'accueil Nest par défaut. Tout ce qui
est mentionné ci-dessous au sujet de Steam, des embeddings, de l'authentification et de la
recherche relève de la spécification, pas de code existant.

## Structure — ce n'est pas un workspace npm

Le `package.json` racine déclare une seule devDependency, `vitest`, et **zéro script**.
Ce n'est pas une racine de workspace. `api/` et `web/` ont chacun leur propre
`package.json` + `package-lock.json` et doivent être installés et lancés indépendamment :

- `cd api && npm install && npm run start:dev` → http://localhost:3000
- `cd web && npm install && npm run dev` → http://localhost:5173

Ne lance jamais `install`/`build`/`test` depuis la racine en supposant que ça couvre les
paquets.

## Commandes (toutes vérifiées fonctionnelles)

| Où | Commande | Remarques |
|---|---|---|
| `api/` | `npm run start:dev` | Mode watch Nest |
| `api/` | `npm run lint` | **oxlint** avec `--type-aware` (nécessite `oxlint-tsgolint`, déjà en devDep) |
| `api/` | `npm run format` | Prettier : guillemets simples, `trailingComma: all` |
| `api/` | `npm test` | vitest, `**/*.spec.ts` uniquement |
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
implique d'ajouter aussi le script dans `web/package.json`.

**Les `*.tsbuildinfo` sont ignorés par git.** `tsconfig.json` active `incremental: true`,
donc `api/tsconfig.build.tsbuildinfo` se régénère à chaque `npm run build` (≈130 Ko de JSON
sur une seule ligne). Le motif `*.tsbuildinfo` est dans le `.gitignore` racine : ne le
retire pas et ne le reclasse pas dans git, sinon chaque build pollue le diff.

**Pas de CORS ni de proxy de dev.** `api/src/main.ts` ne contient pas
`app.enableCors()` et `web/vite.config.ts` n'a pas de `server.proxy`. Les appels depuis le
navigateur entre `:5173` et `:3000` échoueront tant qu'aucun des deux côtés n'est ajouté.
`.env` définit `FRONTEND_URL=http://localhost:5173`.

**`.env.example` ne contient que les noms de variables, sans valeurs** — garde ça ainsi, le
fichier est commité. Les vrais secrets vivent dans le `.env` racine, ignoré par git.

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
`STEAM_API_KEY`, `EMBEDDING_API_KEY`, `SESSION_SECRET`, `FRONTEND_URL`. `@nestjs/config`
est une dépendance mais `AppModule` n'importe pas `ConfigModule.forRoot()`, donc rien ne
charge encore le `.env`.

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
