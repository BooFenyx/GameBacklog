# Accueil intelligent

> Fiche de fonctionnalité. Le détail des décisions et écarts de la PR est
> consigné dans `features/accueil-intelligent/05-annexe-fix-pr.md`.

## Objectif

Répondre à « je joue à quoi ce soir ? » à partir de la bibliothèque Steam déjà
importée. La page ne résume pas la bibliothèque : elle propose un jeu du moment,
cinq voisins et trois catégories enrichies.

## Parcours

1. La connexion Steam importe la bibliothèque en tâche de fond.
2. L’accueil lit la base et calcule la sélection côté serveur.
3. L’utilisateur change d’ancre ou affine la sélection avec les boutons dédiés.
4. Chaque carte renvoie vers la fiche du jeu ou lance `steam://run/<appId>`.

Aucun appel Steam ou Gemini n’est fait au chargement de l’accueil.

## API

| Route | Rôle |
|---|---|
| `GET /api/home` | Jeu du moment, sélection par défaut (5), catégories (jusqu’à 9 jeux par section), menu (45 min / continuer), ancres récentes (5) |
| `GET /api/home/selection` | Sélection paramétrable : `anchor`, `genre`, `decouverte`, `manette`, `lancement`, `progression` |
| `GET /api/home/menu` | Menu : `anchor`, `temps` (30/45/60/120), `intention` (`continuer`/`decouvrir`/`finir`), `manette`. Endpoint conservé côté API, plus affiché dans l’interface actuelle. |

Toutes les routes sont protégées par `SessionGuard`. Le `userId` vient
uniquement de la session, jamais de la requête.

### Règles de sélection

- **Jeu du moment** : fenêtre de 14 jours, puis activité dérivée, puis temps de
  jeu, puis embedding, puis nom. Jamais `rtime_last_played`.
- **Genre principal** : déduit du `short_description` et des genres Steam
  (`genre-principal.ts`). C’est un **bonus de score**, jamais un filtre strict.
- **Similarité** : `games.embedding` (1024 dims, pgvector `<=>`), repli sur les
  genres communs si un embedding manque.
- **Découverte** : curseur 10 → 100, poids de nouveauté plafonné à 30 %.
- **Catégories** : autour du jeu du moment (À finir, À découvrir, À retrouver).
- **Menu** : le jeu du moment reste candidat ; le temps choisi est une
  préférence, pas une durée de session.

## Données et limites

| Donnée | Source |
|---|---|
| Temps total, 14 jours | Steam `GetOwnedGames` |
| Genres, manette, image, description | Steam Store `appdetails` |
| Succès | `GetSchemaForGame` / `GetPlayerAchievements` |
| Activité | dérivée (`sync_delta`, `recent_window`, `achievement`) |
| Similarité | `games.embedding`, Gemini à l’import |

Steam ne fournit ni durée de session ni date exacte de dernière partie pour une
bibliothèque tierce. L’accueil affiche donc des bornes (« récemment », « ces
14 derniers jours », « dernier succès ») et ne promet jamais une durée.

## Front

- `web/src/home.ts` : types, client API, helpers purs (salutation, titres,
  libellés, sérialisation des paramètres, raisons, succès).
- `web/src/pages/Accueil.tsx` : chargement de `/api/home` et `/api/sync`,
  polling 2 s pendant l’import, bandeau d’erreur, états vides.
- `web/src/components/accueil/` :
  - `SelectionChef` : réglages, debounce 150 ms, `AbortController`, deck, boutons
    **Affiner** et **Changer de jeu** visibles sous le deck ;
  - `CarteSelection` : carte portrait, repli image, badges ;
  - `CategoriesAccueil` : trois colonnes de cartes enrichies (progression des
    succès pour À finir, genres pour À découvrir, activité pour À retrouver),
    affichées par pages de 3. Un bouton **D’autres jeux** fait tourner les pages
    à la demande.
  - `DialogueAncre`, `DialogueAffiner`, `DialoguePourquoi`, `DialogueSources`
    (Sources dans le pied de page).
- `web/src/styles/accueil.css` : styles scopés `.accueil-intelligent`, tokens de
  `theme.css`, `prefers-reduced-motion`.

La topbar et la recherche globale viennent de `RootLayout` : l’accueil ne les
recrée pas.

## Tests

- API : `api/src/home/*.spec.ts` (genre principal, scoring, raisons, menu) et
  `api/test/home.e2e-spec.ts` (session, bibliothèque vide, deck, filtres, menu).
- Web : `web/src/home.test.ts` (helpers purs, paramètres, titres) et
  `web/src/components/accueil/categories.test.ts` (pagination des catégories).

Commandes : `cd api && npm run lint && npm test && npm run test:e2e && npm run build`,
puis `cd web && npm run lint && npm test && npm run build`.

## Hors périmètre

- Aucun cache applicatif au premier lot.
- Aucune migration, aucune nouvelle dépendance.
- Aucun LLM : le copilote a été retiré de l’interface, aucune recommandation
  n’est générée par un modèle.
- Aucune recommandation hors bibliothèque.
