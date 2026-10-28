# Feature — Filtres de la bibliothèque et de la recherche

> Fiche de conception de la PR 1 (`feature/filtres-recherche`). La refonte
> visuelle des cartes est traitée dans la PR 2 (`feature/refonte-bibliotheque`).

## 1. Contexte & objectif

La bibliothèque et la recherche ne permettaient que deux filtres : le texte et
le support manette. La spec demande des filtres classiques (genres, mode de jeu,
temps de jeu) et une recherche qui reste utilisable sur une grosse
bibliothèque.

Objectif : **filtrer, trier et paginer côté serveur**, avec des données de
filtrage stables, sans refonte visuelle des cartes.

## 2. Périmètre

**Dans le périmètre**

- Identifiants Steam des genres et catégories stockés en base.
- Backfill des fiches existantes via le pipeline de synchronisation.
- Filtres : genres, modes de jeu, manette, état, durée.
- Tri : nom, temps de jeu, dernière partie.
- Pagination serveur (48 par page, « Afficher plus »).
- Facettes avec compteurs (`/api/library/facets`).
- Même jeu de filtres sur la recherche par nom et la recherche sémantique.
- URL comme source de vérité pour les filtres.
- Barre d'outils et panneau de filtres partagés.

**Hors périmètre**

- Refonte des cartes, vue liste, squelettes, purge CSS (PR 2).
- i18n : tout reste en français.
- Rafraîchissement périodique des fiches (`appdetails`).
- Filtres sauvegardés nommés.

## 3. Données

### 3.1 Ce qui est stocké

| Colonne | Rôle |
|---|---|
| `games.genres` | Libellés français Steam, affichage et texte d'embedding |
| `games.categories` | Libellés français Steam, fallback d'affichage |
| `games.genre_ids` | Ids Steam, **source de vérité des filtres** |
| `games.category_ids` | Ids Steam, filtres de mode et badges |
| `games.filters_version` | Version du mapping appliqué (backfill) |

`genres` / `genre_ids` et `categories` / `category_ids` sont **alignés index par
index** : même boucle, même ordre, dédoublonnage par id dans
`mapTaxonomie` (`api/src/games/games.service.ts`).

### 3.2 Pourquoi les ids

Les libellés Steam sont localisés (`l=french`), parfois dupliqués
(`Workshop Steam` = ids 30 et 51) et peuvent changer (CS2 était `FPS`, Steam
renvoie aujourd'hui `Action + Free-to-play`). Les ids restent stables.

**Décision** : on garde `l=french` pour les descriptions et les embeddings
(aucune réindexation), et on utilise les ids uniquement pour filtrer.

### 3.3 Backfill

1. La migration 0004 ajoute les colonnes et les index GIN (valeurs par défaut
   vides).
2. `FILTERS_VERSION = 1` dans `games.service.ts`.
3. `stepDetails` sélectionne `details_fetched_at IS NULL OR filters_version < 1`.
4. `upsertFromDetails` écrit `filtersVersion = 1` **même si les tableaux sont
   vides** (un jeu sans genre ne doit pas être retenté indéfiniment).
5. Au login, `SyncService.needsFilters(userId)` déclenche un import si des
   fiches **déjà récupérées** n'ont pas le mapping courant.
   Les fiches jamais récupérées sont exclues pour éviter une boucle de sync à
   chaque connexion sur un jeu retiré du Store.
6. La progression de chaque étape porte sur le nombre d'éléments à traiter,
   plus sur la taille de la bibliothèque : la barre ne recule plus.

## 4. Sémantique des filtres

| Groupe | Paramètre | Valeurs | Règle |
|---|---|---|---|
| Texte | `q` | ≤ 100 (bibliothèque) / ≤ 300 (recherche) | Sous-chaîne, casse ignorée |
| Genres | `genres` | ids CSV, max 8 | **OR** dans le groupe |
| Modes | `modes` | `solo,multi,coop,pvp,local,crossplay` | OR dans le groupe |
| Manette | `manette` | `full` | Support complet uniquement ; le partiel est affiché sur la fiche du jeu |
| État | `etat` | `jamais`, `joue` | Une valeur |
| Durée | `duree` | `0-2,2-10,10-50,50plus` | OR dans le groupe |
| Tri | `tri` | `nom`, `temps`, `recent` | Défaut `nom` |

- **OR intra-groupe, AND inter-groupes.**
- `50plus` et non `50+` : le `+` serait décodé en espace dans une query string.
- Le filtre « Joué récemment » a été retiré : peu utile et souvent vide.
- Le support **partiel** n'est pas filtrable : le compteur exact est souvent nul et le
  filtre « partielle » renvoyait aussi les jeux complets, ce qui prêtait à confusion. La
  fiche du jeu affiche le niveau réel et un avertissement pour le partiel.- Durées en minutes : `< 120`, `120–599`, `600–2999`, `≥ 3000`.
- Modes Steam (ids vérifiés) :

```ts
solo: [2]
multi: [1, 9, 27, 36, 37, 38, 39, 48, 49]
coop: [9, 38, 39, 48]
pvp: [49, 36, 37]
local: [24, 37, 39, 48]
crossplay: [27]
```

## 5. Contrats d'API

### 5.1 `GET /api/library`

```http
GET /api/library?q=portal&genres=25,23&modes=coop&manette=full&etat=joue&duree=2-10&tri=temps&limit=48&offset=0
```

```json
{
  "items": [{
    "appId": 620,
    "name": "Portal 2",
    "headerImageUrl": "https://…",
    "genres": ["Action", "Aventure"],
    "modes": ["solo", "multi", "coop", "local"],
    "controllerSupport": "full",
    "playtimeForever": 1200,
    "playtimeLast2Weeks": 0,
    "lastPlayedAt": "2024-03-12T00:00:00.000Z",
    "achievementsUnlocked": 12
  }],
  "total": 42,
  "limit": 48,
  "offset": 0,
  "hasMore": false
}
```

- `categories` et `shortDescription` ne sont plus renvoyés dans la liste.
- `total` vient de `COUNT(*) OVER()` ; `hasMore` d'une ligne demandée en plus.

### 5.2 `GET /api/library/facets`

```json
{
  "total": 133,
  "genres": [{ "id": 25, "label": "Aventure", "count": 46 }],
  "modes": [{ "value": "coop", "label": "Coop", "count": 58 }],
  "manettes": [{ "value": "full", "label": "Manette complète", "count": 72 }],
  "etats": [{ "value": "jamais", "label": "Jamais lancé", "count": 14 }],
  "durees": [{ "value": "2-10", "label": "2 à 10 h", "count": 31 }]
}
```

- Compteurs **globaux** à la bibliothèque de l'utilisateur (v1).
- Une seule lecture, agrégée en mémoire (`agregerFacettes`).
- Les libellés de genres viennent des tableaux stockés ; fallback `Genre <id>`.

### 5.3 `GET /api/search`

Mêmes filtres, plus `q` (obligatoire) et `mode`. Ajouts :

- `total` dans l'enveloppe ;
- `modes` dans chaque résultat ;
- `criteria` enrichi (manette, modes, genres résolus, état, durée).

## 6. SQL

```sql
g.genre_ids && $n::int[]          -- OR sur les genres
g.category_ids && $n::int[]       -- OR sur les modes
g.controller_support = 'full'
le.playtime_forever = 0
le.playtime_forever > 0
le.playtime_forever >= 120 AND le.playtime_forever < 600
```

Tri :

```sql
ORDER BY lower(g.name), g.app_id
ORDER BY le.playtime_forever DESC, lower(g.name), g.app_id
ORDER BY le.last_played_at DESC NULLS LAST, lower(g.name), g.app_id
```

Index :

```sql
CREATE INDEX games_genre_ids_gin ON games USING gin (genre_ids);
CREATE INDEX games_category_ids_gin ON games USING gin (category_ids);
CREATE INDEX library_entries_user_playtime_idx
  ON library_entries (user_id, playtime_forever DESC);
CREATE INDEX library_entries_user_last_played_idx
  ON library_entries (user_id, last_played_at DESC);
```

## 7. Front

### 7.1 URL

`/bibliotheque?q=portal&genres=25&modes=coop&tri=temps`
`/recherche?q=coop&mode=semantic&genres=25`

- Les valeurs par défaut ne sont pas écrites.
- `q` est débouncé à 250 ms et écrit en `replace` (pas d'entrée d'historique
  par frappe) ; les filtres utilisent `push` (le retour annule le dernier).
- Les valeurs inconnues sont ignorées à la lecture.

### 7.2 Composants

| Fichier | Rôle |
|---|---|
| `web/src/filters.ts` | Types, libellés, lecture/écriture URL, compteur |
| `web/src/library.ts` | Client `/api/library` et `/api/library/facets` |
| `web/src/format.ts` | `formaterDuree`, `formaterDate`, `formaterDepuis` |
| `web/src/components/filtres/SidebarFiltres.tsx` | Colonne de filtres desktop : sections repliables, manette, compteurs |
| `web/src/components/filtres/BarreFiltres.tsx` | Recherche, tri, puces actives, bouton Filtres mobile |
| `web/src/components/filtres/PanneauFiltres.tsx` | `<dialog>` accessible pour mobile et recherche |
| `web/src/components/filtres/PuceFiltre.tsx` | Puce d'un filtre actif |

### 7.3 Comportement

- La bibliothèque utilise une **colonne de filtres** sur desktop (genres, modes,
  temps de jeu, manette) ; sur mobile, elle devient le panneau `<dialog>`.
- Les sections sont **repliables** ; la manette est un interrupteur en bas de la
  colonne, pas une section.
- Le bouton `‹` ferme la colonne : elle glisse vers la gauche et un onglet
  vertical « Filtres » apparaît au bord gauche après l’animation. Un clic sur
  l’onglet la rouvre ; la grille gagne une colonne quand la colonne est fermée.
- Les libellés des modes sont : `Solo`, `Multi en ligne`, `Multi Local`, `Coop`,
  `PvP`, `CrossPlay`. Les valeurs d’URL restent `solo`, `multi`, `local`, `coop`,
  `pvp`, `crossplay`.
- La bibliothèque conserve son markup de cartes actuel (la refonte est en PR 2).
- `Afficher plus` ajoute la page suivante (offset = nombre d'éléments affichés).
- Un import en cours désactive « Synchroniser » ; à la fin, la liste et les
  facettes sont rechargées une seule fois.
- Un état vide avec filtres propose « Effacer les filtres ».
- Le compteur de résultats est en `aria-live="polite"`.

## 8. Tests

- `api/src/games/games.service.spec.ts` : ids chaîne/nombre, dédoublonnage,
  tableaux parallèles, tableaux vides, `filtersVersion`.
- `api/src/sync/sync.service.spec.ts` : `needsFilters`, `enqueue` sans reset.
- `api/src/search/search.service.spec.ts` : filtres SQL, critères, `total`.
- `api/test/library.e2e-spec.ts` : enveloppe, filtres, tri, pagination,
  facettes, paramètres invalides.
- `api/test/search.e2e-spec.ts` : filtres en nom et sémantique, `total`.
- `web/src/filters.test.ts` : aller-retour URL, valeurs inconnues, compteur.

## 9. Limites connues

- Les compteurs de facettes ne tiennent pas compte des filtres actifs (v1).
- Les jeux sans métadonnées Steam (Dota 2, jeux retirés) n'apparaissent pas
  quand un filtre de genre est actif.
- Les libellés restent en français : pas d'i18n.
- `total` vaut 0 si `offset` dépasse la fin de la liste (fenêtre SQL absente).
- Un jeu retiré du Store peut garder `filters_version = 0` ; il n'est pas
  auto-resynchronisé, mais « Synchroniser » le retente.
