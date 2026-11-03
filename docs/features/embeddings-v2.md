# Embeddings v2 — texte enrichi, backfill versionné, évaluation

> Chantier issu des écarts/limites listés dans `AGENTS.md` : la pertinence de la
> similarité était le point faible connu. Ce lot ne change ni le modèle ni la
> dimension (Gemini `gemini-embedding-001`, 1 024), seulement le **texte indexé**
> et la façon de le versionner.

## 1. Ce qui change

### Texte d'embedding v2

`EmbeddingService.buildText` construit désormais :

```text
nom. description courte. description longue (≤ 1 200 caractères). Genres: …. Catégories: ….
```

- La **description longue** vient de `games.description_blocks`, convertie en
  texte brut par `texteDepuisBlocs` (paragraphes, titres, listes).
- Les espaces sont normalisés et les points doubles évités (`joindrePhrases`).
- Une description longue identique à la courte n'est pas dupliquée.
- `EMBEDDING_TEXT_VERSION = 2` est la source de vérité.

La description longue apporte l'ambiance et le vocabulaire absent des genres
Steam (« rogue-like », « metroidvania », etc.) sans nouvel appel de modèle au
chargement.

### Versionnement et backfill

- Nouvelle colonne `games.embedding_text_version` (migration `0012`), défaut `0`.
- `SyncService` reindexe un jeu si `embedding IS NULL` **ou** si
  `embedding_text_version < EMBEDDING_TEXT_VERSION`.
- `needsEmbeddings` et `pendingEmbeddings` incluent donc les embeddings
  obsolètes : un simple login après déploiement suffit à reprendre le backfill,
  dans la limite du budget d'étape et du quota Gemini.
- L'ancien embedding reste en place jusqu'à son remplacement : la recherche
  continue de fonctionner pendant le backfill.

## 2. Évaluation

### Jeu de requêtes

`api/scripts/eval-embeddings.json` contient six requêtes en langage naturel et
les `appId` attendus (jeux publics). Le script ignore les attendus absents de la
bibliothèque et le signale.

### Script

```bash
cd api
npm run eval:embeddings            # évalue les embeddings stockés
npm run eval:embeddings:backfill   # réindexe la version courante puis évalue
```

Le script démarre un contexte Nest minimal (`EvaluationModule`), sans
`SyncModule` ni contrôleur : il ne déclenche aucun import. Il utilise le vrai
Gemini (`EMBEDDING_API_KEY`) et la base locale (`DATABASE_URL`).

Métriques affichées : précision@5, précision@10 et MRR, par requête puis en
moyenne, avec le top 5 des titres.

### Résultats mesurés (base locale, 123 jeux)

Mesure sur la même bibliothèque, avant puis après backfill v2, avec le jeu de
requêtes initial :

| Version | P@5 | P@10 | MRR |
|---|---|---|---|
| v1 (nom + description courte + genres + catégories) | 0,778 | 0,833 | 0,611 |
| v2 (description longue ajoutée) | 0,778 | 0,833 | 0,597 |

**Conclusion honnête** : sur ce petit jeu de requêtes, v2 est **neutre** en
précision et très légèrement inférieur en MRR. La description longue n'a pas
dégradé les résultats, mais n'a pas produit de gain mesurable. Le texte v2 est
conservé comme base plus riche ; la prochaine piste est la **recherche hybride**
(vectoriel + lexical) et un jeu d'évaluation plus large, pas un nouveau
changement de texte à l'aveugle.

Après correction du jeu de requêtes (Portal ajouté aux attendus de la requête
« laboratoire »), v2 mesure P@5 0,861, P@10 0,917, MRR 0,764 — mais la
comparaison avec v1 n'est plus strictement à jeu de requêtes identique.

## 3. Commandes et vérifications

- `cd api && npm run lint && npm test && npm run test:e2e && npm run build`
- Migration appliquée automatiquement par `DbModule` au démarrage.
- Le backfill réel a réindexé **121 jeux** (2 sans texte exploitable), sans
  échec, sur la base locale.

## 4. Limites

- Le jeu d'évaluation est petit et lié à une bibliothèque : il ne prouve pas
  une amélioration générale.
- Aucun reranking LLM (hors périmètre).
- Un changement futur de `buildText` doit incrémenter
  `EMBEDDING_TEXT_VERSION` pour déclencher le backfill.
- Le quota Gemini reste la contrainte : le backfill est repris par le sync, pas
  forcé en une passe infinie.
