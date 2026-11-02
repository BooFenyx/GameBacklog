# AGENTS.md — GameBacklog (fst-2026-groupe-08)

> Ce fichier est rédigé en français, comme le reste du projet. Les commandes, options de
> CLI et noms de fichiers restent en anglais : ils ne se traduisent pas.

## À lire en premier

`fiche_projet.md` (racine, en français) est la spécification produit de référence : modèle
de données, champs des entités, pipeline d'import, conception de la recherche
vectorielle, stack et liste des éléments hors périmètre. Lis-la avant d'implémenter
quoi que ce soit. Les décisions architecturales doivent rester cohérentes avec elle.

## Méthode de travail — une feature par tranches

**Ne jamais développer une fonctionnalité entière d'un seul coup.** Une feature se découpe
en **tranches verticales** : chacune doit pouvoir être implémentée, testée, relue et
commitée indépendamment. Exemple de découpage : données/migration → API → client → UI →
documentation.

Pour chaque tranche :

1. **Annoncer la tranche** et son périmètre au développeur avant de commencer.
2. **Implémenter uniquement cette tranche**, sans anticiper les suivantes.
3. **Lancer les vérifications** du paquet concerné :
   - `api/` : `npm run lint`, `npm test`, `npm run test:e2e`, `npm run build` ;
   - `web/` : `npm run lint`, `npm test`, `npm run build`.
4. **Faire un retour court** au développeur : ce qui est fait, fichiers touchés, résultat
   des vérifications, ce qui reste, risques éventuels.
5. **Attendre sa validation** (et son autorisation de commit) avant de passer à la tranche
   suivante.
6. **Commiter la tranche** une fois validée, avec un message en français.

**Ne jamais coder toute la feature puis découper les commits a posteriori** : les états
intermédiaires ne seraient pas testés et la revue serait artificielle.

### Points bloquants

Dès qu'une décision, une erreur, une ambiguïté de spec, un accès manquant (clé API, base,
droit) ou un comportement inattendu **bloque la tranche** : s'arrêter et le signaler au
développeur avec le contexte, les options possibles et une recommandation. Ne pas
contourner en silence et ne pas inventer une règle métier.

### Commits

- **Ne jamais commiter sans validation explicite du développeur.**
- Un commit = une tranche (ou une intention) ; messages en français.
- Chaque commit doit compiler et passer les tests de son paquet.
- Ne pas mélanger une migration, une API et une refonte UI dans le même commit.

## État du projet

**Authentification Steam et import de bibliothèque fonctionnels.** L'authentification
passe par OpenID 2.0 (Steam, callback validé en `id_res`), la session est gérée par
`express-session` (cookie `httpOnly`, 7 jours, `MemoryStore` en dev, store PostgreSQL en
prod). Au callback, l'utilisateur est upserté dans `users` puis un import est mis en file
(`SyncService`) s'il n'est pas déjà `done`. La bibliothèque est **lue depuis la base**
(`library_entries ⋈ games`), plus jamais depuis Steam au fil des requêtes.

**Pipeline d'import en tâche de fond (`api/src/sync/`).** Quatre étapes reprises au
redémarrage : `library` (persistance des `library_entries` depuis `GetOwnedGames`),
`details` (fiches `appdetails` manquantes), `achievements` (compteurs de succès,
schéma Steam une fois par jeu et progression du joueur avec TTL), `embeddings`
(texte `nom + description + genres + catégories` → Gemini `gemini-embedding-001`,
1024 dims, stocké dans `games.embedding`). Progression suivie par `GET /api/sync`,
relance par `POST /api/sync`. Un job interrompu (`running`) est remis en file au
boot. Chaque étape respecte un budget (`SYNC_STEP_MAX_MS`, 15 min par défaut,
`0` = illimité) et reprend à `job.step` à la passe suivante. L'étape
`achievements` traite les jeux manquants par lots de `ACHIEVEMENTS_BATCH_SIZE`
(200) jusqu'à épuisement : `ACHIEVEMENTS_MAX_GAMES_PER_SYNC=0` supprime le
plafond total. Les fiches Steam gèrent les 429 et les jeux délistés
(`details_attempts`, `details_next_retry_at`, `details_last_error`) ; les
embeddings s'arrêtent proprement sur quota (`done` + `pendingEmbeddings`).
`needsAchievements` et `needsEmbeddings` relancent la sync au login s'il reste
des reliquats.

**Activité dérivée.** `library_entries` ne stocke plus `last_played_at` : elle expose
`last_activity_at`, `last_activity_source` (`sync_delta` / `recent_window` /
`achievement`), `last_activity_precision` (`upper_bound` / `lower_bound`) et
`last_seen_at`. `deriverActivite` (`api/src/sync/activite.ts`) s'exécute à l'étape
`library` : une hausse de `playtime_forever` entre deux syncs datées donne `sync_delta`,
`playtime_2weeks > 0` donne `recent_window`, le dernier succès donne `achievement` (borne
basse). Pas de `sync_delta` sans `last_seen_at` ni en cas de baisse de `playtime_forever`.
`GET /api/library`, `/api/search` et `/api/games/:appId` renvoient les trois champs
d'activité et plus `lastPlayedAt` ; `/api/library/facets` renvoie `lastActivityDisponible`.
`releaseDate` est une chaîne `YYYY-MM-DD`. **Limite Steam** : `rtime_last_played` n'est
fourni qu'au propriétaire de la clé Web API ; il n'est jamais lu, même pour ce compte, donc
mêmes données pour tous.

**Succès et compteurs.** L'étape `achievements` précharge
`games.achievements_total` / `games.achievements_fetched_at` et
`library_entries.achievements_unlocked` / `library_entries.achievements_fetched_at`.
Un jeu jamais lancé n'appelle pas `GetPlayerAchievements` : seul le schéma est
demandé. `GET /api/library` renvoie `achievementsTotal` et
`achievementsUnlocked` (`null` tant que la donnée n'est pas prête) ; les cartes
et la liste affichent `12 / 51`, `— / total` ou masquent le badge.
`GET /api/games/:appId` ne charge plus les succès : il renvoie la fiche et les
compteurs. `GET /api/games/:appId/achievements` charge la liste détaillée à la
demande, avec le cache et le TTL de l'étape `achievements`.

**Front.** Pages Connexion, accueil, bibliothèque, détail d'un jeu (`/jeu/:appId`) et 404,
avec React Router et un provider de session. La bibliothèque sonde `GET /api/sync` toutes
les 2 s ; elle est filtrée, triée et paginée via l'URL (`/bibliotheque?genres=25&modes=coop&tri=temps`)
et s'affiche dès que l'étape `library` est passée. Le bandeau d'import affiche l'erreur
réelle et les reliquats (`pendingDetails`, `detailsUnavailable`, `pendingAchievements`,
`pendingEmbeddings`) via `web/src/import.ts` (`etatImport`). Sur desktop, une **colonne de filtres**
repliable accompagne les résultats ; elle se ferme en glissant à gauche et un onglet
vertical permet de la rouvrir. La carte et la vue liste utilisent les tokens de
`web/src/styles/theme.css` ; le bouton Filtres reste à gauche sur mobile/tablette.
La vue liste a des **colonnes fixes** (image, titre, tags, modes, temps, activité,
manette, succès) : les lignes restent alignées, le titre passe sur deux lignes si besoin,
tous les genres sont affichés et la manette non supportée est barrée. Les tags d'état
« Joué » / « Jamais lancé » sont retirés (la méta porte l'information), « jamais lancé »
reste en rouge et un jeu à 100 % de succès affiche un badge doré avec couronne. La grille
garde `2 tags + N`. L'activité dérivée est affichée via `web/src/activite.ts`
(libellés courts sur carte/liste, longs sur la fiche et la recherche) ; le tri
« Activité récente » est masqué quand `lastActivityDisponible` est faux, avec repli
silencieux sur `nom`.

**Filtres et facettes.** `GET /api/library` (`api/src/library/`) accepte `q`, `genres`,
`modes`, `manette`, `etat`, `duree`, `tri`, `limit`/`offset`, et renvoie une enveloppe
`{ items, total, limit, offset, hasMore }`. `GET /api/library/facets` renvoie les compteurs
des genres, modes, manettes, états et durées. Les filtres sont appliqués en SQL à partir des
**ids Steam** stockés dans `games.genre_ids` / `games.category_ids` (les libellés restent
utilisés pour l'affichage et les embeddings). **Genres et modes se combinent en ET
exclusif** (`@>` pour les genres, une condition d'intersection par mode) ; les
durées restent en OR, leurs tranches étant mutuellement exclusives. Les mêmes
filtres s'appliquent aux deux modes de `GET /api/search`. Front : `web/src/filters.ts`
(URL), `web/src/library.ts` (client), `web/src/components/filtres/SidebarFiltres.tsx`
(colonne desktop repliable : genres, modes, temps de jeu, manette en bas), `BarreFiltres`
(barre de résultats, puces actives, bouton mobile) et `PanneauFiltres` (`<dialog>` pour
mobile et recherche). Les sections sont repliables ; la manette est un interrupteur hors
section. Libellés des modes : `Solo`, `Multi en ligne`, `Multi Local`, `Coop`, `PvP`,
`CrossPlay` (valeurs d'URL inchangées).

**Recherche vectorielle.** `GET /api/search` (`api/src/search/`) accepte `mode=name`
(SQL `ILIKE` + priorité de série) ou `mode=semantic` (embedding de la requête via Gemini,
tri pgvector `<=>`), avec filtres stricts (bibliothèque de l'utilisateur, `manette`, genres,
modes, état, durée) et pagination (`limit`/`offset`, `hasMore`, `total`). Limitation par
`steamId` (20/min sémantique, 120/min nom, 429 + `Retry-After`), cache d'embeddings de
requête (TTL 1 h, 500 entrées) et repli dégradé (`degraded`) si Gemini échoue ou dépasse
~1,5 s. Front : barre globale dans `RootLayout` (modes nom/description, aperçu 7 résultats
en mode nom, **aucun Gemini à la frappe**, bouton-icône intégré) et page protégée
`/recherche` (mêmes filtres que la bibliothèque, « Afficher plus », états dégradé/quota/erreur).

**Sécurité.** CSP de production en place : stricte côté API (`app.setup.ts`, `default-src
'none'`, prod uniquement) et via les en-têtes Vercel côté front (CSP SPA + `nosniff` +
`Referrer-Policy`). Rate limiting en place sur `GET /api/search` par `steamId` (voir
Écart 10) ; les autres routes ne sont pas limitées.

**Non implémenté :** accueil calculé (sources autorisées : `playtime_forever`,
`playtime_2weeks`, `last_activity_source` ; dates exactes interdites), amélioration des
embeddings (piste à étudier séparément, sans modifier le code de ce lot), purge du CSS mort
et stabilisation des champs exacts des cartes/listes, mise en ligne (socle et déploiement
continu front prêts, rien n'est encore réellement déployé).

**Fichiers clés :**
- `api/src/auth/` — authentification OpenID (validation `id_res`, timeouts), session, guard
- `api/src/sync/` — pipeline d'import (4 étapes, lots de succès sans plafond total, reprise par étape, budget `SYNC_STEP_MAX_MS`, progression, backfill `filters_version`, compteurs de succès)
- `api/src/sync/activite.ts` — dérivation pure de l'activité (`sync_delta`, `recent_window`, `achievement`)
- `api/src/library/` — `ownedGames` (Steam, à l'import), `savedLibrary` (lecture filtrée/triée/paginée) et `facets`
- `api/src/catalog/` — modes Steam, durées, conditions SQL des filtres (ET genres/modes, OR durées), libellés de genres, agrégation des facettes
- `api/src/games/` — fiches `appdetails`, détail utilisateur, `GET /api/games/:appId` et `/achievements`
- `api/src/achievements/` — cache du schéma, compteurs, TTL, liste détaillée (`GetSchemaForGame` / `GetPlayerAchievements`)
- `api/src/users/` — upsert utilisateur, `syncStatus`
- `api/src/embedding/` — service d'embedding Gemini + rate limiter (100 rpm / 1000 j, `remainingToday`, réservation de 80 % à l'import)
- `api/src/search/` — `GET /api/search` (nom/sémantique/série), filtres partagés, limite par `steamId`, cache d'embeddings de requête, DTO
- `api/src/db/` — module Drizzle global, token `DB`, schéma pgvector
- `api/src/db/pg-utc.ts` — lecture UTC des `timestamp` sans fuseau (OID 1114)
- `api/drizzle.config.ts` + `api/drizzle/` — config et migrations (0000→0010 ; 0005 compteurs de succès, 0006 champs de fiche, 0007 correctif manette, 0008 dates de sortie, 0009 activité + drop `last_played_at`, 0010 import robuste)
- `render.yaml` — blueprint Render (API seule)
- `api/src/app.setup.ts` — câblage (session, CORS, helmet + CSP conditionnelle en prod, ValidationPipe)
- `web/src/auth/` — provider et contexte de session
- `web/src/sync.ts` — suivi du job d'import (`lireSync`, `relancerSync`)
- `web/src/import.ts` — `etatImport` : bandeau d'import (erreur, reliquats, reprise)
- `web/src/api.ts` — helper `urlApi()`, base relative (pas de `VITE_API_URL` en prod)
- `web/src/styles/` — `theme.css` (tokens), `bibliotheque.css`, `fiche.css`
- `web/src/search.ts` — client de recherche (`rechercherJeux`, `ErreurRecherche`)
- `web/src/activite.ts` — types et libellés de l'activité dérivée
- `web/src/filters.ts` — types, libellés et sérialisation URL des filtres
- `web/src/library.ts` — client `/api/library` et `/api/library/facets`
- `web/src/games.ts` — client de la fiche (`chargerFicheJeu`) et des succès (`chargerSuccesJeu`)
- `web/src/format.ts` — formats partagés (durée, date, date relative)
- `web/src/components/bibliotheque/` — `CarteJeu`, `LigneJeu`, `BasculeVue`, `SqueletteCarte`, helpers d'affichage
- `web/src/components/jeu/` — `EnteteJeu`, `DescriptionJeu`, `GalerieJeu`, `PanneauJeu`, `SuccesJeu`, `SqueletteJeu`
- `web/src/components/ui/` — `Etiquette`, `Icones`, `BarreProgression`
- `web/src/components/filtres/` — colonne latérale (`SidebarFiltres`), barre de résultats (`BarreFiltres`), panneau `<dialog>` (`PanneauFiltres`), puces actives
- `web/src/components/BarreRecherche.tsx` — barre globale (modes, aperçu, bouton-icône de mode)
- `web/src/components/CarteResultatRecherche.tsx` — carte d'un résultat de recherche
- `web/src/pages/Bibliotheque.tsx` — page `/bibliotheque` (filtres, tri, pagination, sync, grille/liste)
- `web/src/pages/JeuDetail.tsx` — page `/jeu/:appId` (fiche et succès chargés séparément)
- `web/src/pages/Recherche.tsx` — page `/recherche` (filtres partagés, pagination, états)
- `docs/analyse-donnees-steam.md` — analyse Steam + section « Import volumineux »
- `docs/features/recherche-vectorielle.md` — fiche de la fonctionnalité recherche
- `docs/features/filtres-recherche.md` — fiche de la fonctionnalité filtres/facettes
- `docs/features/refonte-bibliotheque.md` — fiche du prototype bibliothèque
- `docs/features/refonte-fiche-jeu.md` — fiche du prototype fiche de jeu
- `web/vercel.json` — rewrite `/api` + SPA et en-têtes de sécurité (CSP) pour Vercel, `git.deploymentEnabled: false`
- `.github/workflows/deploy.yml` — déploiement continu du front (CLI Vercel + token, alignement de l'auteur du commit) sur push `main`
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

**L'activité dérivée remplace `lastPlayedAt`.** Ne jamais réintroduire `lastPlayedAt`,
`last_played_at` ou `rtime_last_played` : Steam ne fournit `rtime_last_played` qu'au
propriétaire de la clé Web API, et le lot du 31/10/2026 a supprimé l'asymétrie. Les dates
d'activité sont en `timestamptz` ; `unlocked_at` reste un `timestamp` sans fuseau et exige
`AT TIME ZONE 'UTC'` pour alimenter `last_activity_at`. Pas de `sync_delta` sans
`last_seen_at` (première sync) ni si `playtime_forever` baisse. Le champ lu dans
`GetOwnedGames` est `playtime_2weeks`, la colonne DB garde `playtime_last_2_weeks`.

**`sql<Date>` n'est pas un cast runtime.** Drizzle renvoie la valeur brute du pilote
(`string` pour un `timestamp` sans fuseau). Utilise `max(colonne)` ou
`.mapWith(parseTimestampUtc)` ; n'utilise **jamais** `new Date(chaine)` pour une date UTC
(le processus l'interpréterait en heure locale). Le correctif est `normaliserDernierSucces`.

**Boucle de lots de succès.** Chaque lot doit exclure les jeux déjà tentés
(`notInArray`), sinon la boucle resélectionne les mêmes jeux à l'infini. Un 429 peut
laisser `processed` égal au total alors que `pending*` reste > 0 : traiter les reliquats,
pas `processed`, comme source de vérité. Le budget d'étape (`SYNC_STEP_MAX_MS`) ne doit
jamais provoquer une pause sans progrès, sous peine de boucle infinie.

**Quota embeddings.** Un quota épuisé termine le job en `done` avec
`pendingEmbeddings > 0` (et `needsEmbeddings` vrai), jamais en `error` : les jeux sans
embedding restent intacts et seront repris. L'import réserve 80 % de la fenêtre minute
pour ne pas affamer la recherche.

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

**La CLI Vercel contrôle l'auteur du commit même avec un token.** Depuis
`vercel@44+`, `vercel deploy` (même `--prebuilt`, même avec `--token`) envoie
l'auteur de `HEAD` et Vercel exige qu'il ait accès au projet. Sur le plan Hobby,
l'auteur doit être le **propriétaire** du compte. Un échec « Git author … must
have access to the team » ou « commit author email is not a valid email » n'est
donc pas un bug de configuration, et **déconnecter l'intégration Git ne suffit
pas**. Le `deploy.yml` réécrit l'auteur dans le runner
(`git commit --amend --reset-author` vers `VERCEL_DEPLOYER_EMAIL`) ; cet email
doit être **vérifié sur GitHub** et lié au compte Vercel (Login Connections), pas
seulement l'email Vercel. Un email `noreply` mal formé (identifiant converti en
notation scientifique) est un piège connu et échoue.

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

- **Rate limiting limité à la recherche.** La spécification exige que l'entrée de recherche
  soit « limitée en fréquence par utilisateur » (`fiche_projet.md`) : c'est fait par
  `steamId` sur `GET /api/search` (voir Écart 10). Les autres routes (bibliothèque, détail
  d'un jeu, sync) ne sont toujours pas limitées ; `@nestjs/throttler` n'a pas été installé
  car il raisonne par IP, ce qui n'est pas la clé demandée.

Résolus depuis : **timeouts** (`AbortSignal.timeout(5000)`), **validation de
`openid.mode === 'id_res'`** (voir Écarts 15 et 16), **CSP de production** (voir Écart 14)
et **rate limiting de la recherche** (voir Écart 10).

## Écarts spec ↔ code

Liste des écarts entre `fiche_projet.md` (spec) et le code réel, classés par gravité. Chaque
écart indique ce que demande la spec et l'état réel (✅ Résolu, ⚠️ Partiel, ou ce qu'il
reste à corriger).

### Écarts critiques

#### Écart 1 — Pipeline d'import de la bibliothèque — ✅ Résolu

| | Détail |
|---|---|
| **Spec** | « Connexion : authentification via Steam (OpenID), puis **import de la bibliothèque** avec suivi de progression. » (`fiche_projet.md:15`) — « L'import se fait en **tâche de fond** avec reprise : les entrées de bibliothèque d'abord, puis les fiches manquantes, puis les embeddings. » (`fiche_projet.md:39`) |
| **État** | ✅ Résolu — `api/src/sync/sync.service.ts` : `enqueue()` déclenché au callback (`api/src/auth/auth.controller.ts`) si le `syncStatus` n'est pas `done`, **quatre étapes** reprises (`onModuleInit` remet les jobs `running` en `pending`) : `library`, `details`, `achievements`, `embeddings`. `ownedGames()` (Steam) n'est appelé qu'à l'import ; `savedLibrary(userId)` sert la page (`library_entries ⋈ games`). L'import est découpé en lots de succès (200) sans plafond total, avec budget par étape (`SYNC_STEP_MAX_MS`), reprise `job.step` et reliquats exposés par `GET /api/sync`. Les limites Steam (~200 `appdetails`/5 min, 429) et Gemini (100/min, 1 000/j) sont absorbées par throttle, backoff et reprise. |

#### Écart 2 — Recherche vectorielle

| | Détail |
|---|---|
| **Spec** | « Recherche : saisie libre (« un jeu calme avec des énigmes, jouable à la manette ») et résultats classés. » (`fiche_projet.md:18`) — « embedding de la requête, puis SQL unique combinant **filtres stricts** (support manette, dans la bibliothèque de l'utilisateur) et **tri par similarité cosinus**. » (`fiche_projet.md:45`) — « liste de 10 jeux de la bibliothèque de l'utilisateur, avec le score de similarité et les critères respectés. » (`fiche_projet.md:46`) |
| **État** | ✅ Résolu — `api/src/search/` : `GET /api/search` (`search.controller.ts`) avec `SessionGuard`, `SearchQueryDto` (`mode=name\|semantic`, filtres partagés `genres`/`modes`/`manette`/`etat`/`duree`, `limit`/`offset`), `SearchService` (nom via `ILIKE` + priorité de série, sémantique via embedding Gemini et tri pgvector `<=>`, filtres stricts bibliothèque/genres/modes, pagination `hasMore` + `total`), `SearchRateLimitService` par `steamId` et cache d'embeddings de requête. Front : `web/src/components/BarreRecherche.tsx` (modes nom/description, aperçu 7 résultats en mode nom, aucun Gemini à la frappe) et `web/src/pages/Recherche.tsx` (route protégée `/recherche`, mêmes filtres que la bibliothèque, « Afficher plus », états dégradé/quota/erreur). `<span className="nav-avenir">` retiré de `RootLayout.tsx`. |

#### Écart 3 — Page d'accueil non fonctionnelle

| | Détail |
|---|---|
| **Spec** | « Accueil : jeux à relancer ou à découvrir dans sa propre bibliothèque (jamais lancés, laissés en cours, proches de ses derniers jeux). » (`fiche_projet.md:16`) — « proximité vectorielle avec les jeux récemment lancés, sans appel supplémentaire à un modèle. » (`fiche_projet.md:48`) |
| **Code réel** | `web/src/pages/Accueil.tsx:4-20` : trois sections vides avec messages fixes — « Aucun jeu importé pour le moment. » / « Arrive avec la recherche par similarité. » Aucune donnée réelle n'est affichée. |
| **Correction** | « À relancer » = `playtime_2weeks > 0` ou `last_activity_source = 'recent_window'` ; « à découvrir » = `playtime_forever = 0` ; « proches » = embeddings des jeux `recent_window`/`playtime_2weeks`. **Jamais** de date exacte de dernière partie. Réaccord hors lot (voir `docs/analyse-donnees-steam.md` §6.7). |

#### Écart 5 — Page de détail d'un jeu — ✅ Résolu

| | Détail |
|---|---|
| **Spec** | « Détail d'un jeu : description, genres, support manette, temps de jeu, succès obtenus, lien pour lancer le jeu dans Steam. » (`fiche_projet.md:19`) |
| **État** | ✅ Résolu — `GET /api/games/:appId` renvoie la fiche et les compteurs lus en base ; `GET /api/games/:appId/achievements` charge la liste détaillée. Route `web/src/App.tsx` `/jeu/:appId` → `web/src/pages/JeuDetail.tsx` (description, genres, manette, temps de jeu, succès, lien `steam://run/<appId>`), avec fiche et succès chargés séparément. |

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

#### Écart 4 — Page bibliothèque — ✅ Résolu

| | Détail |
|---|---|
| **Spec** | « Bibliothèque : liste des jeux avec **temps de jeu, activité récente (approximative), genres, filtres et tri classiques**. » (`fiche_projet.md:17`) |
| **État** | ✅ Résolu — `GET /api/library` renvoie une page `{ items, total, limit, offset, hasMore }` avec `playtimeForever`, `playtimeLast2Weeks`, `lastActivityAt`, `lastActivitySource`, `lastActivityPrecision`, `genres`, `modes`, `controllerSupport`, `headerImageUrl`, `achievementsUnlocked`. `GET /api/library/facets` fournit les compteurs et `lastActivityDisponible`. Le tri `recent` utilise `last_activity_at DESC NULLS LAST, playtime_last_2_weeks DESC` ; l'option est masquée quand `lastActivityDisponible` est faux, avec repli sur `nom`. Le front (`web/src/pages/Bibliotheque.tsx`) affiche une colonne de filtres repliable sur desktop, la barre de résultats, les filtres actifs, le tri, la pagination et les états vides/erreur. La colonne se ferme en glissant à gauche ; un onglet vertical la rouvre et la grille gagne une colonne. Sur mobile, le panneau `<dialog>` est utilisé. La refonte visuelle des cartes est prévue en PR2. |

#### Écart 6 — Succès à la demande — ✅ Résolu

| | Détail |
|---|---|
| **Spec** | « Achievement : id, gameId, apiName, displayName, description, iconUrl — Source: `GetSchemaForGame` » (`fiche_projet.md:28`) — « UserAchievement : userId, achievementId, unlockedAt — Source: `GetPlayerAchievements` » (`fiche_projet.md:29`) — « Les succès (`Achievement`, `UserAchievement`) sont chargés **à la demande**, à l'ouverture du détail d'un jeu » (`fiche_projet.md:38`) |
| **État** | ✅ Résolu — `api/src/achievements/` : l'étape `achievements` du sync précharge les compteurs (`getUserAchievementsDetail` via `refreshForSync`), avec cache du schéma, TTL de 24 h et lots de 200 jeux sans plafond total (reliquats repris ensuite). `GET /api/library` expose `achievementsTotal`/`achievementsUnlocked` pour la grille et la liste. `GET /api/games/:appId/achievements` charge la liste détaillée à la demande ; `apiname` est normalisé en `apiName`. |

#### Écart 9 — Utilisateur persisté en base — ✅ Résolu

| | Détail |
|---|---|
| **Spec** | « User : id, steamId (unique), displayName, avatarUrl, lastSyncAt, syncStatus (pending / running / done / error), createdAt — Source: Steam OpenID + `GetPlayerSummaries` » (`fiche_projet.md:25`) |
| **État** | ✅ Résolu — le callback Steam (`api/src/auth/auth.controller.ts`) upsert l'utilisateur dans `users` (`displayName`, `avatarUrl`) via `UsersService`, puis met à jour `syncStatus` et `lastSyncAt` au fil du job (`SyncService`). `userId` est stocké en session pour les routes suivantes. |

### Écarts moyens (robustesse, sécurité, complétude)

#### Écart 10 — Rate limiting sur la recherche — ✅ Résolu

| | Détail |
|---|---|
| **Spec** | « Entrée : phrase libre, longueur limitée (ex. 300 caractères), **limitée en fréquence par utilisateur**. » (`fiche_projet.md:44`) |
| **État** | ✅ Résolu — `SearchRateLimitService` (`api/src/search/search-rate-limit.service.ts`) limite `GET /api/search` par `steamId` (clé de session, pas par IP) : 20/min en sémantique, 120/min en nom, compteur en mémoire. Dépassement → `429` + `Retry-After`. `@nestjs/throttler` n'a pas été installé (il raisonne par IP). |

#### Écart 11 — Repli si échec de la recherche — ✅ Résolu

| | Détail |
|---|---|
| **Spec** | « Repli si échec (erreur, quota 429, latence excessive) : recherche classique par filtres (genre, manette, temps de jeu) et recherche textuelle sur le nom, avec un message d'information à l'utilisateur. » (`fiche_projet.md:47`) |
| **État** | ✅ Résolu — `SearchService` retombe sur la recherche par nom (`LIKE`/`ILIKE` + filtres manette/bibliothèque) si l'embedding Gemini échoue, dépasse `SEARCH_EMBEDDING_MAX_WAIT_MS` (~1,5 s) ou est refusé par le rate limiter (`'busy'`), et renvoie `degraded: true` avec un `message` ; le front affiche l'état dégradé. |

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

#### Écart 13 — DTO validés — ✅ Résolu

| | Détail |
|---|---|
| **Spec** | « API : NestJS + TypeScript (DTO validés) » (`fiche_projet.md:54`) |
| **État** | ✅ Résolu — `ValidationPipe` global (`api/src/app.setup.ts` : `whitelist: true, forbidNonWhitelisted: true, transform: true`) est effectivement exercé par `SearchQueryDto` et `LibraryQueryDto` (`api/src/search/dto/search-query.dto.ts`, `api/src/library/dto/library-query.dto.ts`), les points d'entrée acceptant des paramètres de requête. Corollaire : toute nouvelle route à paramètres doit livrer son DTO. |

#### Écart 16 — Validation de `openid.mode` — ✅ Résolu

| | Détail |
|---|---|
| **Spec** | Non mentionné. |
| **État** | ✅ Résolu — `verifySteamCallback` (`api/src/auth/auth.service.ts`) rejette les réponses dont `openid.mode` n'est pas `id_res` avant toute validation de signature. |

#### Écart 18 — Message d'aide si profil privé — ✅ Résolu

| | Détail |
|---|---|
| **Spec** | « Message d'aide si le profil est privé. » (`fiche_projet.md:15`) |
| **État** | ✅ Résolu — `LibraryService.ownedGames` lève `ServiceUnavailableException` (« profil privé ou clé invalide »), le `SyncService` stocke le message dans `sync_jobs.error`, et `web/src/pages/Bibliotheque.tsx` affiche l'aide explicite : « Ton profil Steam est privé. Rends-le public dans les paramètres Steam pour importer ta bibliothèque. » |

#### Écart 19 — Tri et filtres de la bibliothèque — ✅ Résolu

| | Détail |
|---|---|
| **Spec** | « Bibliothèque : liste des jeux avec temps de jeu, dernière utilisation, genres, **filtres et tri classiques**. » (`fiche_projet.md:17`) |
| **État** | ✅ Résolu — `LibraryQueryDto` (`api/src/library/dto/`) valide `q`, `genres`, `modes`, `manette`, `etat`, `duree`, `tri`, `limit`/`offset`. `LibraryService.savedLibrary` applique les filtres en SQL (`construireConditions`), trie (`nom`/`temps`/`recent`) et pagine. **Genres et modes sont combinés en ET exclusif** (`genre_ids @>`, une condition par mode) ; les durées restent en OR. Les facettes sont exposées par `GET /api/library/facets`. Le front sérialise les filtres dans l'URL et réutilise le même panneau sur `/recherche`. |

#### Écart 20 — Jeux à relancer / à découvrir absents

| | Détail |
|---|---|
| **Spec** | « Accueil : jeux à relancer ou à découvrir dans sa propre bibliothèque (jamais lancés, laissés en cours, proches de ses derniers jeux). » (`fiche_projet.md:16`) |
| **Code réel** | `web/src/pages/Accueil.tsx:4-20` : sections vides avec messages fixes. |
| **Correction** | Mêmes sources que l'Écart 3 : `playtime_2weeks` / `last_activity_source = 'recent_window'` pour « à relancer », `playtime_forever = 0` pour « à découvrir », embeddings des jeux récents pour « proches ». Aucune date exacte. Réaccord hors lot. |

### Priorités d'implémentation

Ordre recommandé pour combler les écarts restants :

1. **Accueil calculé** (Écarts 3, 20) : trois requêtes SQL (à relancer, à découvrir, proches).
2. **Finaliser la refonte visuelle de la bibliothèque** : préciser les champs exacts des cartes/listes, purger le CSS mort et valider la fiche de jeu sur sa branche.
3. **Divers** (Écart 12) : mettre à jour `fiche_projet.md` (hébergement).

## Base de données

La base locale est la seule chose dans `docker-compose.yml` :

```
docker compose up -d     # pgvector/pgvector:pg16 sur :5432, user/pw/db = gamebacklog
```

Cela correspond au `DATABASE_URL` du `.env` racine. Utilise pgvector, pas du Postgres
classique — la spécification exige une recherche par similarité vectorielle sur
`Game.embedding`.

Drizzle est configuré : `api/drizzle.config.ts` (charge `../.env`), schéma dans
`api/src/db/schema.ts`, migrations dans `api/drizzle/` (0000→0010 ; 0005 compteurs
de succès, 0006 champs de fiche, 0007 correctif manette, 0008 dates de sortie, 0009 activité
+ drop `last_played_at`, 0010 import robuste). `npm run db:migrate`
applique à la main, **mais ce n'est plus nécessaire** : `DbModule` applique les migrations
manquantes au démarrage, sous verrou advisory (`pg_advisory_lock`) pour sérialiser les
démarreurs concurrents (workers e2e, chevauchement de déploiements). La 0000 crée
`CREATE EXTENSION IF NOT EXISTS vector` — obligatoire sur une base fraîche type Neon.
Les 0005 à 0010 sont idempotentes (`IF NOT EXISTS`) pour les bases de dev
partagées ; l'ordre reste 0005 → 0010, la branche fiche empilant la 0006.

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

Réglages d'import, tous optionnels : `SYNC_STEP_MAX_MS` (`900000`, `0` = illimité),
`APPDETAILS_THROTTLE_MS` (`1500`), `ACHIEVEMENTS_BATCH_SIZE` (`200`),
`ACHIEVEMENTS_MAX_GAMES_PER_SYNC` (`0` = illimité, déprécié) et
`ACHIEVEMENTS_THROTTLE_MS` (`200`).

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
  `VERCEL_PROJECT_ID`, `VERCEL_DEPLOYER_EMAIL` en secrets GitHub) : il construit
  l'artefact (`vercel build`) puis le déploie (`vercel deploy --prebuilt --prod`).
  **La CLI (>= v44) contrôle l'auteur du commit même en déploiement par token** :
  Vercel exige que l'auteur de `HEAD` soit le propriétaire du compte Hobby. Le
  workflow réécrit donc l'auteur dans le runner avant de déployer
  (`git config user.email` puis `git commit --amend --reset-author` vers
  `VERCEL_DEPLOYER_EMAIL`, une adresse vérifiée sur GitHub et liée au compte
  Vercel) — l'amend n'est jamais poussé, l'historique GitHub reste intact.
  `git.deploymentEnabled: false` dans `web/vercel.json` désactive en plus
  l'intégration Git native : tout contributeur peut donc déployer en mergant une
  PR.
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
