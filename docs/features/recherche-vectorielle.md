# Feature — Recherche vectorielle

> Fiche de conception **et** plan d'implémentation. La spécification produit de
> référence reste `fiche_projet.md` (voir §1). Ce document décrit le contrat
> d'API, la conception technique, les tests et le découpage en commits.

## 1. Contexte & objectif

La spec (`fiche_projet.md`) demande une recherche en langage naturel : « un jeu
calme avec des énigmes, jouable à la manette » (`fiche_projet.md:18`), traitée
par embedding de la requête puis tri par similarité cosinus sur la bibliothèque
de l'utilisateur (`fiche_projet.md:42-47`).

Cette feature comble les écarts identifiés dans `AGENTS.md` :

| Écart | Objet |
|---|---|
| 2 | Recherche vectorielle absente (aucun contrôleur ni service) |
| 10 | Rate limiting par utilisateur absent |
| 11 | Repli si échec de la recherche absent |
| 13 | Aucun DTO, alors que le `ValidationPipe` global est strict |

Objectif : `GET /api/search?q=...` renvoie jusqu'à 10 jeux de la bibliothèque de
l'utilisateur, classés par similarité avec la requête, avec score et critères.

## 2. Périmètre

**Dans le périmètre**

- Embedding de la requête via le service Gemini existant.
- Recherche pgvector filtrée sur la bibliothèque de l'utilisateur, tri cosinus,
  `LIMIT 10`.
- Filtre strict optionnel sur le support manette.
- Limitation de fréquence par utilisateur.
- Repli dégradé (recherche textuelle + filtres) avec message informatif.
- Page front `/recherche` et activation du lien de navigation.

**Hors périmètre**

- Génération de texte / reranking par un LLM (cf. `fiche_projet.md:67`).
- Recherche hors de la bibliothèque de l'utilisateur (catalogue Steam complet).
- Recherche par similarité de l'accueil (Écarts 3/20) : chantier séparé.

## 3. État actuel (revue de code)

### Réutilisable tel quel

- **Embedding** : `EmbeddingService.embed(text): Promise<number[] | null>`
  (`api/src/embedding/embedding.service.ts:58`). Renvoie `null` si la clé est
  absente, si Gemini répond en erreur ou renvoie un vecteur vide ; lève
  `QuotaReachedError` sur HTTP 429 ou quota journalier épuisé. Le timeout
  externe est déjà de 5 s (`embedding.service.ts:13`).
- **Quota partagé** : `RateLimitService` (100/min, 1000/jour, persisté dans
  `rate_limits`) — `api/src/embedding/rate-limiter.service.ts`. La recherche
  consomme le **même** quota Gemini que l'import d'embeddings.
- **Colonne pgvector** : `games.embedding vector(1024)` + `games.embeddingModel`
  (`api/src/db/schema.ts:48`). **Aucune migration n'est nécessaire.**
- **SQL brut** : `db.$client.query(sql, params)` déjà utilisé
  (`api/src/embedding/rate-limiter.service.ts:120`).
- **Session** : `req.session.steamId` / `req.session.userId` ; `SessionGuard`
  s'utilise par référence de classe, sans importer `AuthModule`
  (`api/src/auth/session.guard.ts`).
- **Front** : helper `urlApi()` et appels `fetch(..., { credentials: 'include' })`
  (`web/src/api.ts`, `web/src/sync.ts`).

### À créer

- Aucun `SearchModule` / `SearchService` / `SearchController` n'existe
  (grep `search|recherche|cosine|<=>` → 0 occurrence).
- Aucun DTO dans le dépôt. Le `ValidationPipe` global
  (`api/src/app.setup.ts:89-95`) combine `whitelist` et
  `forbidNonWhitelisted` : **tout query param non déclaré provoque un 400**. Un
  DTO pour `q` est donc obligatoire.
- Pas de rate limiting par utilisateur (`@nestjs/throttler` non installé, et
  raisonne par IP : non retenu).
- Pas de repli dégradé.
- Front : le lien « Recherche » est désactivé
  (`web/src/components/RootLayout.tsx:37-39`) ; aucune route ni page.

### Pièges à respecter

- **ESM côté `api/`** : imports relatifs avec extension `.js`.
- **Pas d'extension ni de point-virgule côté `web/`** (style scaffold Vite).
- **Sérialisation du vecteur** : passer `JSON.stringify(vector)` avec un cast
  `$1::vector` en SQL brut, plutôt que de compter sur l'ORM pour convertir un
  `number[]` en `vector` (comportement peu fiable avec `node-postgres`).
- **Quota partagé** : une recherche peut échouer (429) pendant un import
  d'embeddings en cours ; c'est précisément le cas que couvre le repli.
- **Aucun index ANN requis** : pour des bibliothèques de quelques centaines de
  jeux, le tri séquentiel `ORDER BY embedding <=> $1 LIMIT 10` suffit. Un index
  HNSW pourra être ajouté plus tard si le volume l'exige (hors périmètre ici).
- **Pas de script `test` côté `web/`** : tout test front impliquerait d'ajouter
  le script à `web/package.json` (aucun test front prévu dans cette feature).

## 4. Contrat d'API

### Requête

```
GET /api/search?q=<phrase>&manette=<full|partial>
```

- `q` : requis, chaîne, 1 à 300 caractères (`fiche_projet.md:44`).
- `manette` : optionnel, `full` ou `partial`.
  - `full` → `controller_support = 'full'`.
  - `partial` → `controller_support IN ('partial', 'full')` (au moins partiel).
- Authentification : `SessionGuard` (401 sans session).

### Réponse `200`

```jsonc
{
  "results": [
    {
      "appId": 292030,
      "name": "The Witcher 3: Wild Hunt",
      "shortDescription": "…",
      "headerImageUrl": "https://…",
      "genres": ["RPG", "Aventure"],
      "controllerSupport": "full",
      "playtimeForever": 3720,
      "lastPlayedAt": "2024-01-02T03:04:05.000Z",
      "score": 0.8123,
      "criteria": ["Dans ta bibliothèque", "Manette complète"]
    }
  ],
  "degraded": false
}
```

- `score` : `1 - distance cosinus`, dans `[0, 1]`. `null` en repli dégradé (pas
  de comparaison vectorielle).
- `criteria` : libellés lisibles des filtres respectés.

### Réponse en repli

Même forme, `degraded: true`, `score: null`, et un champ `message` explicatif :

```jsonc
{
  "results": [ /* résultats textuels */ ],
  "degraded": true,
  "message": "Recherche sémantique indisponible : résultats par nom."
}
```

### Codes d'erreur

| Code | Cas |
|---|---|
| `400` | `q` absent/vide/trop long, ou paramètre non déclaré (DTO strict) |
| `401` | Aucune session Steam |
| `429` | Limite de fréquence par utilisateur dépassée (fenêtre glissante) |
| `200` | Succès, y compris en repli dégradé |

> La réponse est **toujours un objet englobant** (`{ results, degraded }`), et
> non un tableau nu : cela permet de transporter l'état dégradé et évite le cas
> d'un corps vide (cf. la leçon de `GET /api/auth/me`,
> `api/src/auth/auth.controller.ts:117-121`).

## 5. Conception technique

### 5.1 Module NestJS

Nouveau dossier `api/src/search/` :

```
api/src/search/
├── dto/search-query.dto.ts
├── search.module.ts
├── search.controller.ts
├── search.service.ts
├── search-rate-limit.service.ts
└── search.service.spec.ts
```

- `SearchModule` importe `EmbeddingModule` (qui exporte déjà `EmbeddingService`).
  `DB` est global (`@Global()` sur `DbModule`), aucune import à faire.
- `SearchController` : `@Controller('search')` + `@UseGuards(SessionGuard)`,
  méthode `@Get()` recevant `@Query() dto: SearchQueryDto`.
- `SearchModule` est ajouté aux `imports` de `api/src/app.module.ts`.
- Pas de cycle : `SearchModule` n'a besoin ni d'`AuthModule` ni de `SyncModule`.

### 5.2 DTO

`api/src/search/dto/search-query.dto.ts` :

```ts
import { IsIn, IsOptional, IsString, Length } from 'class-validator';

export class SearchQueryDto {
  @IsString()
  @Length(1, 300)
  q!: string;

  @IsOptional()
  @IsIn(['full', 'partial'])
  manette?: 'full' | 'partial';
}
```

`class-validator` et `class-transformer` sont déjà des dépendances
(`api/package.json:32-33`).

### 5.3 Rate limiting par utilisateur (Écart 10)

`SearchRateLimitService` en mémoire, calé sur le motif `MinuteWindow`
(`api/src/embedding/rate-limiter.service.ts:20`), mais **clé = `steamId`** :

- `Map<steamId, number[]>` de timestamps, fenêtre glissante de 60 s.
- Seuil : `SEARCH_RATE_LIMIT_PER_MINUTE` (défaut proposé : 20).
- `consume(steamId)` renvoie `false` si la limite est atteinte ; le contrôleur
  lève alors une `HttpException` 429.
- Tests unitaires sans horloge réelle (`now` injectable, comme `MinuteWindow`).

**Limites assumées** : état par instance et perdu au redémarrage. Acceptable
tant que l'API tourne sur une seule instance (plan gratuit Render). À migrer
vers un compteur persisté (table `rate_limits`) si l'API est répliquée.

### 5.4 Requête vectorielle

Dans `SearchService.search(userId, dto)`, après validation :

1. **Embedding de la requête** : `this.embedding.embed(dto.q)`.
   - Si `null` → repli dégradé.
   - Si `QuotaReachedError` → repli dégradé.
2. **SQL** (brut, `db.$client.query`), vecteur sérialisé en JSON et casté :

```sql
SELECT
  g.app_id,
  g.name,
  g.short_description,
  g.header_image_url,
  g.genres,
  g.controller_support,
  le.playtime_forever,
  le.last_played_at,
  1 - (g.embedding <=> $1::vector) AS score
FROM library_entries le
JOIN games g ON g.id = le.game_id
WHERE le.user_id = $2
  AND g.embedding IS NOT NULL
  -- filtre manette optionnel :
  --   AND g.controller_support = 'full'
  --   AND g.controller_support IN ('partial', 'full')
ORDER BY g.embedding <=> $1::vector
LIMIT 10;
```

- Paramètres : `[JSON.stringify(embedding), userId]`.
- `<=>` = distance cosinus pgvector ; `score = 1 - distance`.
- Les jeux sans embedding sont exclus (pas encore indexés).

### 5.5 Repli dégradé (Écart 11)

Déclenché quand l'embedding de la requête est indisponible (clé absente, erreur
réseau, timeout 5 s, 429/quota). Requête SQL classique :

```sql
SELECT g.app_id, g.name, g.short_description, g.header_image_url, g.genres,
       g.controller_support, le.playtime_forever, le.last_played_at
FROM library_entries le
JOIN games g ON g.id = le.game_id
WHERE le.user_id = $1
  AND g.name ILIKE '%' || $2 || '%'
  [AND g.controller_support …]
ORDER BY le.playtime_forever DESC
LIMIT 10;
```

- `degraded: true`, `score: null`, `message` explicite.
- La recherche textuelle ne filtre pas sur `embedding IS NOT NULL` (utile si
  l'indexation n'est pas terminée).

## 6. Front

- **Nouvelle page** `web/src/pages/Recherche.tsx` : formulaire de saisie (champ
  `q`, contrôle manette), état de chargement, liste de résultats (image, nom,
  genres, temps de jeu, score, `criteria`), bandeau `message` si
  `degraded`.
- **Route** `/recherche` protégée par `RouteProtegee` dans `web/src/App.tsx`.
- **Navigation** : remplacer le `<span className="nav-avenir">Recherche</span>`
  par un `<NavLink to="/recherche">Recherche</NavLink>`
  (`web/src/components/RootLayout.tsx:37-39`).
- **Appel** : `fetch(urlApi('/api/search?...'), { credentials: 'include' })`,
  style sans point-virgule. Gérer 401 (redirection) et 429 (message).
- **Styles** dans `web/src/App.css` (pas de config Prettier, style Vite).

## 7. Tests

- **Unitaire** `api/src/search/search.service.spec.ts` (DB et `EmbeddingService`
  mockés) :
  - tri vectoriel : bonne requête SQL, mapping `score`/`criteria` ;
  - filtre manette (`full` vs `partial`) ;
  - repli si `embed` renvoie `null` ;
  - repli si `embed` lève `QuotaReachedError`.
- **Unitaire** `SearchRateLimitService` : autorise sous le seuil, bloque au-delà,
  libère après expiration de la fenêtre.
- **e2e** `api/test/search.e2e-spec.ts` : session ouverte via le callback OpenID,
  seed d'un jeu avec un vecteur factice de 1024 dimensions, `GET /api/search`,
  vérification du 401 sans session et du 400 avec `q` manquant.
- **Commandes de vérification** (voir `AGENTS.md`) :
  - `api/` : `npm run lint && npm test && npm run test:e2e`
  - `web/` : `npm run lint && npm run build`

## 8. Découpage en commits

L'objectif est d'éviter un unique commit volumineux : chaque commit est
**cohérent, buildable et testé** (lint + tests verts avant de committer).

| # | Message de commit (français) | Contenu |
|---|---|---|
| 1 | `docs: fiche de feature pour la recherche vectorielle` | Ce document uniquement. |
| 2 | `feat(api): DTO validé et limiteur de fréquence par utilisateur` | `dto/search-query.dto.ts`, `search-rate-limit.service.ts` + specs. Pas encore branché. |
| 3 | `feat(api): service de recherche vectorielle pgvector` | `search.service.ts` (chemin vectoriel) + unit specs. |
| 4 | `feat(api): repli dégradé de la recherche` | Branche de repli texte + flag `degraded` + tests. |
| 5 | `feat(api): endpoint GET /api/search` | `search.controller.ts`, `search.module.ts`, câblage `app.module.ts`, e2e. |
| 6 | `feat(web): page de recherche et lien de navigation` | `Recherche.tsx`, route `App.tsx`, nav `RootLayout.tsx`, styles. |
| 7 | `docs: mettre à jour AGENTS.md (recherche vectorielle)` | Sections « État du projet »/« Fichiers clés » et écarts 2/10/11/13 — **validation préalable du développeur requise** (`AGENTS.md`). |

> Les commits 2 à 4 peuvent être regroupés si la revue le souhaite, mais l'ordre
> garantit qu'aucun commit intermédiaire ne casse le build.

## 9. Tâches détaillées

1. [commit 1] Rédiger ce document.
2. [commit 2] DTO + `SearchRateLimitService` + tests.
3. [commit 3] `SearchService` : embedding de requête + SQL vectoriel + tests.
4. [commit 4] Repli dégradé + tests.
5. [commit 5] Contrôleur + module + câblage + e2e.
6. [commit 6] Page front + route + navigation + styles.
7. [commit 7] Mise à jour d'`AGENTS.md` (après validation).

## 10. Impacts & configuration

- **Base de données** : aucune migration (colonne `games.embedding` existante).
- **Variables d'environnement** : ajouter `SEARCH_RATE_LIMIT_PER_MINUTE=20`
  (optionnel, défaut en code) à `.env.example`.
- **Quota Gemini** : réutilise `EMBEDDING_API_KEY` et le quota partagé ; aucune
  nouvelle clé.
- **API** : nouvelle route `GET /api/search`, sous le préfixe global `/api`.

## 11. Références

- Spécification : `fiche_projet.md:18,42-48`.
- Écarts : `AGENTS.md` (Écarts 2, 10, 11, 13).
- Embedding : `api/src/embedding/embedding.service.ts`.
- Quota : `api/src/embedding/rate-limiter.service.ts`.
- Schéma : `api/src/db/schema.ts:32-55`.
- Session : `api/src/auth/session.guard.ts`.
- SQL brut existant : `api/src/embedding/rate-limiter.service.ts:120`.
- Front : `web/src/App.tsx`, `web/src/components/RootLayout.tsx`.
