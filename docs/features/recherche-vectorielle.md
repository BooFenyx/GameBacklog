# Feature — Recherche vectorielle

> Fiche de conception **et** plan d'implémentation. La spécification produit de
> référence reste `fiche_projet.md` (voir §1). Ce document décrit l'expérience
> utilisateur, le contrat d'API, la conception technique, les tests et le
> découpage en commits.

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

Objectif : une **barre de recherche unique**, disponible sur toutes les pages,
avec deux modes explicites — recherche par **nom de jeu** et recherche
**sémantique** — et une page de résultats paginée.

## 2. Périmètre

**Dans le périmètre**

- Barre de recherche globale dans l'en-tête, y compris sur la page Bibliothèque.
- Deux modes choisis par l'utilisateur : `Nom de jeu` et `Description textuelle`.
- Prévisualisation **uniquement** en mode nom, sans appel Gemini.
- Recherche sémantique à la validation, avec embedding Gemini et tri pgvector.
- Priorité simple aux jeux dont le nom se rapproche d'un jeu cité dans la requête.
- Pagination « Afficher plus de résultats » sur la page de résultats.
- Filtre strict optionnel sur le support manette.
- Limitation de fréquence par utilisateur, distincte pour les deux modes.
- Repli dégradé (recherche par nom) avec message informatif.
- Page `/recherche` facilement remaniable, non présente dans la navigation.

**Hors périmètre**

- Génération de texte / reranking par un LLM (cf. `fiche_projet.md:67`).
- Recherche hors de la bibliothèque de l'utilisateur.
- Table de franchises ou normalisation avancée des titres.
- Filtres et tri de la bibliothèque (Écart 19) : chantier séparé.
- Recherche par similarité de l'accueil (Écarts 3/20) : chantier séparé.

## 3. État actuel (revue de code)

### Réutilisable tel quel

- **Embedding** : `EmbeddingService.embed(text): Promise<number[] | null>`
  (`api/src/embedding/embedding.service.ts:58`). Renvoie `null` si la clé est
  absente, si Gemini répond en erreur ou renvoie un vecteur vide ; lève
  `QuotaReachedError` sur HTTP 429 ou quota journalier épuisé.
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

- Aucun `SearchModule` / `SearchService` / `SearchController` n'existe.
- Aucun DTO dans le dépôt. Le `ValidationPipe` global
  (`api/src/app.setup.ts:89-95`) combine `whitelist` et
  `forbidNonWhitelisted` : **tout query param non déclaré provoque un 400**.
- Pas de rate limiting par utilisateur (`@nestjs/throttler` non installé, et
  raisonne par IP : non retenu).
- Pas de repli dégradé.
- Front : le lien « Recherche » est désactivé
  (`web/src/components/RootLayout.tsx:37-39`) ; aucune barre ni page.

### Pièges à respecter

- **ESM côté `api/`** : imports relatifs avec extension `.js`.
- **Pas d'extension ni de point-virgule côté `web/`** (style scaffold Vite).
- **Sérialisation du vecteur** : passer `JSON.stringify(vector)` avec un cast
  `$1::vector` en SQL brut, plutôt que de compter sur l'ORM.
- **Quota partagé** : une recherche peut échouer (429) pendant un import
  d'embeddings en cours ; c'est précisément le cas que couvre le repli.
- **Aucun index ANN requis** : pour des bibliothèques de quelques centaines de
  jeux, le tri séquentiel `ORDER BY embedding <=> $1` suffit.
- **Pas de script `test` côté `web/`** : aucun test front prévu ici.

## 4. Expérience utilisateur

### La barre de recherche

La barre vit dans `RootLayout`, entre la navigation et le bloc compte. Elle est
visible quand la session est ouverte. Elle fonctionne sur toutes les pages,
notamment Bibliothèque, indépendamment des futurs filtres de bibliothèque.

À droite du champ, un bouton-icône affiche le mode courant : une étiquette pour
**Nom de jeu** (mode par défaut), un presse-papiers pour **Description
textuelle**. Un clic bascule le mode et l'icône, et affiche 2 secondes une
petite annonce sous la barre (« Recherche par nom » / « Recherche par
description »).

Le mode est **toujours choisi explicitement** : aucune détection automatique.

| Mode | Pendant la frappe | À la validation (`Entrée`) |
|---|---|---|
| Nom de jeu | Aperçu de 7 résultats, SQL seul, **aucun Gemini** | Ouvre `/recherche?q=...&mode=name` |
| Description textuelle | Aucun appel réseau | Ouvre `/recherche?q=...&mode=semantic` |

L'aperçu est une liste déroulante sous la barre (navigation clavier, `Échap` ou
clic extérieur pour fermer, clic → fiche du jeu). En mode description, il n'y a
**aucun aperçu** : la recherche coûte un appel Gemini et doit rester une action
volontaire.

### La page de résultats

`/recherche` est une route protégée, absente de la navigation : on y arrive par
la barre. Elle lit `q`, `mode` et `manette` dans l'URL. Sa structure est
volontairement simple pour être remaniée sans toucher à la logique :

- en-tête « Résultats pour « … » » + mode + filtre manette ;
- liste de cartes (`CarteResultatRecherche`) : image, nom, description, genres,
  temps de jeu, score, badge de provenance, critères ;
- bouton **« Afficher plus de résultats »** tant que `hasMore` est vrai ;
- états : chargement initial, chargement complémentaire, vide, erreur, dégradé,
  limite de fréquence atteinte (429).

Un changement de requête, de mode ou de filtre réinitialise la liste et annule
la requête précédente (`AbortController`).

## 5. Contrat d'API

### Requête

```
GET /api/search?q=<phrase>&mode=<name|semantic>&manette=<full|partial>&limit=<1..50>&offset=<>=0>
```

- `q` : requis, trimé, 1 à 300 caractères. Les espaces seuls sont refusés.
- `mode` : requis, `name` ou `semantic`.
- `manette` : optionnel.
  - `full` → `controller_support = 'full'`.
  - `partial` → `controller_support IN ('partial', 'full')`.
- `limit` : optionnel, défaut 20, maximum 50. L'aperçu envoie 7.
- `offset` : optionnel, défaut 0.
- Authentification : `SessionGuard` (401 sans session).

### Réponse `200`

```jsonc
{
  "mode": "semantic",
  "results": [
    {
      "appId": 400,
      "name": "Portal",
      "shortDescription": "…",
      "headerImageUrl": "https://…",
      "genres": ["Puzzle"],
      "controllerSupport": "full",
      "playtimeForever": 320,
      "lastActivityAt": "2024-01-02T03:04:05.000Z",
      "lastActivitySource": "achievement",
      "lastActivityPrecision": "lower_bound",
      "score": 0.8123,
      "source": "series",
      "criteria": ["Se rapproche de Portal"]
    }
  ],
  "offset": 0,
  "limit": 20,
  "hasMore": false,
  "degraded": false
}
```

- `score` : `1 - distance cosinus`, valeur réelle (peut être négative). `null`
  en mode nom et en repli dégradé.
- `source` : `name`, `semantic` ou `series`.
- `criteria` : libellés lisibles des filtres et rapprochements respectés.
- `lastActivityAt`, `lastActivitySource`, `lastActivityPrecision` : activité dérivée, comme
  dans la bibliothèque et la fiche (voir `docs/analyse-donnees-steam.md`). `lastPlayedAt`
  n'existe plus.
- `hasMore` : calculé en demandant `limit + 1` lignes puis en tronquant. Aucun
  `COUNT` supplémentaire.

### Ordre des résultats

- `name` : égalité exacte, puis préfixe, puis présence dans le nom ; à égalité,
  nom le plus court puis alphabétique.
- `semantic` : jeux de la série citée d'abord, puis score cosinus décroissant.
- L'ordre est stable entre les pages (`OFFSET`).

### Réponse en repli

```jsonc
{
  "mode": "semantic",
  "results": [ /* résultats par nom, paginés */ ],
  "offset": 0,
  "limit": 20,
  "hasMore": false,
  "degraded": true,
  "message": "Recherche sémantique indisponible : résultats par nom."
}
```

Le repli cherche par le **jeu cité** s'il y en a un (`Portal` dans « un jeu
comme Portal »), sinon par la requête entière. Il ne filtre pas sur
`embedding IS NOT NULL`.

### Codes d'erreur

| Code | Cas |
|---|---|
| `400` | `q` absent/vide/trop long, `mode` invalide, `limit`/`offset` invalides, paramètre non déclaré |
| `401` | Aucune session Steam |
| `429` | Limite de fréquence par utilisateur dépassée ; en-tête `Retry-After` |
| `200` | Succès, y compris en repli dégradé |

## 6. Conception technique

### 6.1 Module NestJS

```
api/src/search/
├── dto/search-query.dto.ts
├── search.module.ts
├── search.controller.ts
├── search.service.ts
├── search-rate-limit.service.ts
├── query-embedding-cache.service.ts
└── *.spec.ts
```

- `SearchModule` importe `EmbeddingModule` (qui exporte `EmbeddingService`).
  `DB` est global (`@Global()` sur `DbModule`).
- `SearchController` : `@Controller('search')` + `@UseGuards(SessionGuard)`.
- `SearchModule` est ajouté aux `imports` de `api/src/app.module.ts`.
- Pas de cycle : `SearchModule` n'a besoin ni d'`AuthModule` ni de `SyncModule`.

### 6.2 DTO et pagination

`SearchQueryDto` : `q` trimé (1–300), `mode` (`name|semantic`), `manette`
optionnel, `limit` (1–50, défaut 20), `offset` (≥ 0, défaut 0). `@Type(() => Number)`
convertit les query params, qui arrivent en chaînes.

### 6.3 Limitation de fréquence par utilisateur (Écart 10)

`SearchRateLimitService`, en mémoire, fenêtre glissante de 60 s par `steamId` :

- mode `semantic` : `SEARCH_RATE_LIMIT_PER_MINUTE` (défaut 20) ;
- mode `name` : `SEARCH_NAME_RATE_LIMIT_PER_MINUTE` (défaut 120), sinon la
  frappe serait bloquée par l'aperçu.

`tryConsume(steamId, kind)` renvoie `{ allowed: true }` ou
`{ allowed: false, retryAfterMs }`. Le contrôleur lève une 429 avec
`Retry-After`. Les clés inactives sont purgées périodiquement.

**Limites assumées** : état par instance et perdu au redémarrage. Acceptable
tant que l'API tourne sur une seule instance (plan gratuit Render). À migrer
vers un compteur persisté si l'API est répliquée.

### 6.4 Recherche par nom

SQL brut, littéral (pas de jokers `LIKE`), filtré sur la bibliothèque :

```sql
SELECT g.app_id, g.name, g.short_description, g.header_image_url, g.genres,
       g.controller_support, le.playtime_forever,
       le.last_activity_at, le.last_activity_source, le.last_activity_precision
FROM library_entries le
JOIN games g ON g.id = le.game_id
WHERE le.user_id = $1
  AND strpos(lower(g.name), lower($2)) > 0
  [AND g.controller_support …]
ORDER BY
  CASE
    WHEN lower(g.name) = lower($2) THEN 0
    WHEN strpos(lower(g.name), lower($2)) = 1 THEN 1
    ELSE 2
  END,
  length(g.name),
  g.name
LIMIT $3 OFFSET $4;
```

`strpos` évite le piège des jokers `%` et `_` saisis par l'utilisateur. Le
service demande `limit + 1` lignes pour calculer `hasMore`.

### 6.5 Recherche sémantique

1. **Embedding de la requête** : `this.embedding.embed(dto.q, { maxWaitMs })`.
   - `null` → repli dégradé.
   - `QuotaReachedError` → repli dégradé.
   - `'busy'` (quota minute saturé) → repli dégradé.
2. **Jeu cité** : chercher dans la bibliothèque le plus long nom de jeu contenu
   dans la requête, insensible à la casse. Si `« jeu du style de The Witness »`
   contient `The Witness`, c'est la référence.
3. **SQL vectoriel** :

```sql
SELECT
  g.app_id, g.name, g.short_description, g.header_image_url, g.genres,
  g.controller_support, le.playtime_forever,
  le.last_activity_at, le.last_activity_source, le.last_activity_precision,
  1 - (g.embedding <=> $1::vector) AS score,
  CASE
    WHEN $3::text IS NOT NULL AND strpos(lower(g.name), lower($3)) > 0
    THEN 1 ELSE 0
  END AS series_match
FROM library_entries le
JOIN games g ON g.id = le.game_id
WHERE le.user_id = $2
  AND g.embedding IS NOT NULL
  [AND g.controller_support …]
  [AND 1 - (g.embedding <=> $1::vector) >= $seuil]
ORDER BY series_match DESC, g.embedding <=> $1::vector, g.app_id
LIMIT $4 OFFSET $5;
```

- Paramètres : `[JSON.stringify(embedding), userId, referenceTitle, limit + 1, offset]`.
- `<=>` = distance cosinus pgvector ; `score = 1 - distance`.
- Les jeux sans embedding sont exclus (pas encore indexés).
- `source = series_match ? 'series' : 'semantic'`.

### 6.6 Priorité de série — version simple

Pas de table de franchises, pas de normalisation de titre. On réutilise le nom
du jeu cité :

- `Portal` cité → les jeux dont le nom contient `Portal` (`Portal`, `Portal 2`,
  `Portal Stories…`) passent devant, badgés `series`.
- `The Witness` cité → `The Witness` passe devant (dans la mesure du possible).
- `Borderlands 2` cité ne remonte pas nécessairement `Borderlands 1/3/4` :
  compromis assumé pour ne pas complexifier.

Le score reste affiché pour les résultats `series`.

### 6.7 Latence et quota Gemini

`RateLimitService.acquire(maxWaitMs?)` accepte une attente maximale :

- import d'embeddings : comportement inchangé (attente jusqu'à libération) ;
- recherche : `SEARCH_EMBEDDING_MAX_WAIT_MS` (défaut 1500). Si l'attente
  nécessaire dépasse ce seuil, `acquire` renvoie `'busy'` **sans consommer de
  créneau** ; la recherche bascule immédiatement en repli dégradé.

`EmbeddingService.embed(text, { maxWaitMs })` propage l'option et renvoie
`null` sur `'busy'`.

### 6.8 Cache des embeddings de requête

Cache mémoire partagé entre utilisateurs : clé = requête normalisée (minuscules,
espaces compactés), TTL 1 h, taille bornée (500 entrées), déduplication des
appels concurrents. Il réduit les appels Gemini sur les recherches répétées.
État par instance, perdu au redémarrage : suffisant pour ce périmètre.

### 6.9 Repli dégradé (Écart 11)

Déclenché quand l'embedding est indisponible (clé absente, erreur réseau,
timeout, 429/quota, `'busy'`). On réutilise la recherche par nom :

- sur le titre du jeu cité s'il existe ;
- sinon sur la requête entière.

`degraded: true`, `score: null`, `message` explicite, résultats paginés.

## 7. Front

- **`web/src/components/BarreRecherche.tsx`** : champ, bouton-icône de mode
  (étiquette / presse-papiers), annonce de bascule 2 s, aperçu 7 résultats
  (mode nom uniquement), navigation clavier, `AbortController`.
- **`web/src/components/CarteResultatRecherche.tsx`** : présentation d'un
  résultat, réutilisable sur la page.
- **`web/src/pages/Recherche.tsx`** : lecture de l'URL, chargement, pagination
  « Afficher plus », états, filtre manette.
- **`web/src/search.ts`** : types (`ModeRecherche`, `ResultatRecherche`,
  `ReponseRecherche`) et fonction d'appel.
- **`web/src/App.tsx`** : route protégée `/recherche`.
- **`web/src/components/RootLayout.tsx`** : intégration de la barre, suppression
  du `<span className="nav-avenir">Recherche</span>`.
- **`web/src/App.css`** : styles de la barre, du bouton de mode, de l'annonce,
  de l'aperçu, des cartes, du bouton « Afficher plus » et du responsive.

Style scaffold Vite : pas de point-virgule, guillemets simples, pas de virgule
finale.

## 8. Tests

- **DTO** : trim, vide refusé, 300 caractères max, `mode` invalide, `manette`
  invalide, conversion et bornes de `limit`/`offset`.
- **Rate limiting** : autorise sous le seuil, bloque au-delà, `retryAfterMs`,
  libération après la fenêtre, indépendance par utilisateur et par mode.
- **Recherche par nom** : SQL, classement exact/préfixe/contenu, filtre manette,
  pagination, `hasMore`.
- **Recherche sémantique** : SQL vectoriel, score, priorité de série, filtre
  manette, seuil, pagination, repli sur `null`/`QuotaReachedError`/`'busy'`.
- **Cache** : deuxième appel identique sans nouvel embedding, TTL, borne.
- **e2e** (`api/test/search.e2e-spec.ts`) : 401 sans session, 400 avec `q`
  manquant, mode `name` sans appel Gemini, mode `semantic` avec embedding
  factice, pagination, 429.
- **Commandes** :
  - `api/` : `npm run lint && npm test && npm run test:e2e`
  - `web/` : `npm run lint && npm run build`

## 9. Découpage en commits

Chaque commit est cohérent, buildable et testé.

| # | Message de commit (français) | Contenu |
|---|---|---|
| 1 | `docs: réviser la fiche recherche (modes, série, pagination)` | Ce document. |
| 2 | `feat(api): DTO, pagination et limites de fréquence` | DTO + `SearchRateLimitService` + specs. Pas encore branché. |
| 3 | `feat(api): recherche par nom` | `search.service.ts` (mode nom) + specs. |
| 4 | `feat(api): recherche vectorielle, priorité de série, repli et endpoint` | Embedding, SQL pgvector, série, cache, `maxWaitMs`, repli, contrôleur, module, câblage `app.module.ts`, e2e. |
| 5 | `feat(web): barre de recherche globale et page de résultats` | Barre, aperçu, modes, page, route, nav, styles. |
| 6 | `docs: mettre à jour AGENTS.md (recherche)` | Sections « État du projet »/« Fichiers clés », écarts 2/10/11/13 — **validation préalable du développeur requise**. |

Les anciens commits 4 (service sémantique) et 5 (endpoint) sont fusionnés :
l'endpoint et le service sont livrés ensemble pour rester testables de bout en
bout.

## 10. Tâches détaillées

1. [commit 1] Mettre à jour cette fiche.
2. [commit 2] DTO + `SearchRateLimitService` + tests + `.env.example`.
3. [commit 3] `SearchService` : mode nom + pagination + tests.
4. [commit 4] Mode sémantique + contrôleur + module + câblage + e2e.
5. [commit 5] Barre globale + page de résultats + styles.
6. [commit 6] Mise à jour d'`AGENTS.md` (après validation).

## 11. Impacts & configuration

- **Base de données** : aucune migration (`games.embedding` existe).
- **Variables d'environnement** (toutes optionnelles, défauts en code) :
  - `SEARCH_RATE_LIMIT_PER_MINUTE=20`
  - `SEARCH_NAME_RATE_LIMIT_PER_MINUTE=120`
  - `SEARCH_PAGE_SIZE=20`
  - `SEARCH_MIN_SCORE=` (vide = désactivé)
  - `SEARCH_EMBEDDING_MAX_WAIT_MS=1500`
- **Quota Gemini** : réutilise `EMBEDDING_API_KEY` et le quota partagé.
- **API** : nouvelle route `GET /api/search`, sous le préfixe global `/api`.

## 12. Références

- Spécification : `fiche_projet.md:18,42-48`.
- Écarts : `AGENTS.md` (Écarts 2, 10, 11, 13).
- Embedding : `api/src/embedding/embedding.service.ts`.
- Quota : `api/src/embedding/rate-limiter.service.ts`.
- Schéma : `api/src/db/schema.ts:32-55`.
- Session : `api/src/auth/session.guard.ts`.
- Front : `web/src/App.tsx`, `web/src/components/RootLayout.tsx`.
