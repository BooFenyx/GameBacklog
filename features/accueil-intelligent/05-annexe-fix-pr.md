# Accueil intelligent — annexe de PR (décisions et fixes finaux)

> Document de suivi des **écarts assumés** entre le plan
> (`04-plan-implementation.md`) et l’implémentation réelle. Il sert de checklist
> de revue avant merge : chaque point est un choix volontaire, pas un oubli.
> À compléter au fil des tranches.

## Tranche 1 — API socle `GET /api/home`

### D1. Ordre `Action` avant `RPG` dans le genre principal

**Écart** : le tableau du plan (§7.2) liste `RPG` avant `Action`.

**Choix** : `Action` est évalué avant `RPG` dans `genre-principal.ts`.

**Pourquoi** : Hades porte les genres `Action`, `Indépendant`, `RPG` et sa
description réelle contient à la fois « rogue-like » (Action) et
« dungeon crawler » (RPG). Le test verrouillé attend **Action**. L’exemple du
plan (Cyberpunk 2077, sans genre `Action`, classé `RPG`) reste respecté : la
règle `Action` est ignorée quand le genre n’est pas dans `games.genres`.

**À valider en revue** : si l’ordre du tableau doit primer, il faudra changer le
test Hades et assumer `RPG` pour ce jeu.

### D2. « À découvrir » n’exige pas un embedding

**Écart** : le SQL de référence (§8.4) filtre `g.embedding IS NOT NULL`.

**Choix** : la section inclut les jeux jamais lancés même sans embedding ; le
tri se fait par similarité quand les deux vecteurs existent, sinon par nom.

**Pourquoi** : sans `EMBEDDING_API_KEY`, une bibliothèque fraîchement importée
n’a aucun embedding. Filtrer strictement viderait la section « À découvrir »
alors que `playtime_forever = 0` est une donnée fiable et suffisante. Aucun faux
score n’est affiché.

### D3. Sept requêtes SQL par appel, aucun cache

**Choix** : `GET /api/home` exécute le jeu du moment, les ancres, deux jeux de
candidats (deck et menu) et trois catégories. Pas de cache mémoire.

**Pourquoi** : décision verrouillée « aucun cache au premier lot ». À mesurer
sur une bibliothèque de 1 000+ jeux avant d’envisager un cache 30 s.

### D4. Départage du jeu du moment par embedding

**Écart** : le SQL de référence (§8.1) termine par `lower(g.name)`.

**Choix** : `(g.embedding IS NOT NULL) DESC` est ajouté avant le nom.

**Pourquoi** : applique le repli §7.1 « premier jeu avec embedding » quand tous
les temps de jeu sont nuls, sans changer l’ordre des jeux joués.

### D5. Raisons et signaux construits côté serveur

Les libellés respectent les règles « aucune date exacte » et « aucune durée de
session » : « Joué depuis ta dernière sync », « Ces 14 derniers jours »,
« Dernier succès », et pour le menu « Préférence de 45 min (pas une durée de
partie) ». Le front ne recalcule aucun score.

### D6. Nettoyage des e2e

`api/test/home.e2e-spec.ts` supprime les jeux semés (`APP_IDS`) en `afterEach`.
L’utilisateur de test est conservé, comme dans `search.e2e-spec.ts` et
`library.e2e-spec.ts` : le supprimer pendant qu’un import de fond tourne
provoquerait des « Utilisateur inconnu » dans les logs du scheduler.

## Tranche 2 — API sélection paramétrable

### D7. Booléens stricts

**Écart** : le snippet du plan (§6.5) transforme toute valeur en
`value === true || value === 'true' || value === '1'`, donc `manette=partial`
devenait silencieusement `false`.

**Choix** : la transformation n’accepte que `true/false`, `'true'/'false'` et
`'1'/'0'` ; toute autre valeur reste telle quelle et `@IsBoolean` répond 400.

**Pourquoi** : cohérent avec `whitelist` + `forbidNonWhitelisted`. Un client qui
envoie `manette=partial` doit être corrigé, pas interprété comme « pas de
manette ».

### D8. Genre inconnu et ancre non possédée

- `anchor` absent → jeu du moment ; `anchor` fourni mais non possédé → 404
  « Jeu de référence introuvable ».
- `genre` absent → genre principal de l’ancre ; `genre=0` → aucun bonus ;
  `genre > 0` inconnu dans la bibliothèque → 400 « Genre inconnu »
  (`libellesGenresUtilisateur` sert de source de vérité).
- Une bibliothèque vide sans `anchor` répond 200 avec `anchor: null`,
  `items: []` (les valeurs de remplissage `decouverte`/`manette`/`lancement`/
  `progression` sont conservées telles quelles).

## Tranche 3 — API menu

### D9. L’ancre reste candidate, le deck l’exclut

`GET /api/home/menu` utilise les mêmes candidats que le deck **sans** la
condition `g.id <> ancre.id` : le jeu du moment peut gagner, c’est souvent la
bonne réponse à « Continuer ». Le deck, lui, ne propose que des voisins.

### D10. Le temps est une préférence, jamais une durée de session

`temps` (30/45/60/120) ne sert qu’à pondérer continuité, progression et temps
de jeu déjà connu. Les `signals` renvoyés contiennent explicitement
« Préférence de 45 min (pas une durée de partie) ». Aucune durée de session
n’est inventée, aucune date exacte n’est exposée.

### D11. Grammaire des raisons

Les raisons gèrent le singulier : « 1 succès restant sur 10 » et non
« 1 succès restants ». Les raisons restent construites côté serveur, le front
ne recalcule rien.

## Tranche 4 — Web socle

### D12. Facettes chargées seulement à la tranche 6

Le plan §9.2 demande `chargerFacettes` au montage. La tranche 4 n’en a pas
besoin : le state serait inutilisé (`noUnusedLocals`). Les facettes sont donc
branchées avec le panneau « Affiner » (tranche 6), sans double appel.

### D13. Le menu garde son ancien résultat pendant un fetch

`MenuSoir` initialise son état avec `home.menu` (aucun appel au montage), puis
débounce 150 ms + `AbortController` sur tout changement de temps, d’intention,
de manette ou d’ancre. L’ancien résultat reste affiché pendant le calcul ; une
réponse périmée est ignorée.

### D14. La page ne fait que lire l’API

`Accueil` charge `/api/home` et `/api/sync` (polling 2 s tant qu’un import
tourne, puis un seul rechargement). Aucun appel Steam ou Gemini, aucun
`localStorage`, aucun état global. Une erreur de `lireSync` affiche un statut
neutre et ne bloque pas les données déjà chargées.

### D15. Images de la tranche 4

La liste socle réutilise `ImageJeu` (16:9) et `headerImageUrl`. Le deck portrait
6/7 et son repli initiales arrivent en tranche 5, sans modifier `ImageJeu`.

## Tranche 5 — Deck

### D16. Animation d’entrée, pas de sortie

Le plan décrit une carte sortante qui part à gauche. Pour éviter le flash de la
carte suivante et le chevauchement, le deck anime la **nouvelle carte de
devant** : elle entre de la droite (suivant) ou de la gauche (précédent). Les
positions des autres cartes glissent en fondu. Animations verrouillées 430 ms.

### D17. Une seule carte interactive

La carte de devant porte `data-position="0"` ; les autres sont `inert` et
`aria-hidden="true"`. Un lecteur d’écran et le clavier ne peuvent donc pas
activer « Lancer » sur une carte masquée.

### D18. Glissement robuste

`pointerdown` sur la carte de devant uniquement (pas sur un lien/bouton),
`pointerup`/`pointercancel` écoutés **sur `window`**, `releasePointerCapture`
dans un `try/catch`, seuil de 20 % de la largeur (borné 50–90 px). Un geste de
plus de 8 px neutralise le clic suivant sur une flèche pendant 250 ms.

### D19. Images du deck

`ImagePortrait` essaie dans l’ordre : portrait Steam
`library_600x900.jpg`, puis `headerImageUrl`, puis initiales sur dégradé. Le
portrait est chargé en `eager` (une seule carte visible à la fois) et les autres
cartes restent `inert`.

### D20. Accessibilité et mouvement réduit

Flèches avec `aria-label`, points avec `aria-current`, compteur `01 / 05`,
annonce `aria-live` du jeu affiché, focus visible sur le deck et les flèches.
`prefers-reduced-motion` supprime animations et transitions du deck.

## Tranche 6 — Ancre et affinage

### D21. `genreIds` ajouté à l’ancre

Le plan ne liste que `genres` dans `HomeAnchor`. Le repli du panneau Affiner
« si les facettes sont indisponibles, afficher les genres de l’ancre » exige
leurs ids Steam pour pouvoir envoyer `genre=<id>`. `HomeAnchor` expose donc
`genreIds`, aligné index par index sur `genres` (même convention que `games`).
Aucun changement de base, aucune migration.

### D22. Le genre par défaut n’est pas adopté dans l’état de requête

Quand `genreId = null` (« genre principal de l’ancre »), la réponse renvoie le
genre retenu. Le panneau lit ce genre via `selection.genre` pour l’état actif
des chips, mais la requête suivante garde `genreId = null` tant que
l’utilisateur n’a pas cliqué un genre. Cela évite un second appel identique
après chaque réponse et conserve la sémantique « défaut = serveur ».

### D23. Dialogues natifs

`DialogueAncre` et `DialogueAffiner` utilisent `<dialog>` + `showModal()` :
Échap et clic sur le fond ferment, le focus revient au bouton déclencheur
(comportement natif), le corps défile indépendamment sur mobile.

### D24. Ancre et 404

Changer d’ancre remet `genreId` à `null` (le nouveau jeu a son propre genre
principal). Un 404 « Jeu de référence introuvable » ramène l’ancre au jeu
précédemment affiché avec un message non bloquant et un bouton « Réessayer ».

### D25. Le menu suit l’ancre du deck

`SelectionChef` remonte l’ancre de chaque réponse via `onAncreChange` ;
`Accueil` la passe à `MenuSoir`. Les réglages du menu (temps, intention,
manette) restent indépendants de ceux du deck. Le menu ne se recharge pas
quand seul un réglage du deck change (dépendance sur `anchor.appId`).

## Tranche 7 — Copilote

### D26. Parseur local, aucun LLM

`presetCopilote` normalise la demande (minuscules, sans accents) et reconnaît
`calme`, `court`, `rapide`, `surprends`, `autre`, `comme`, `défaut`. Toute autre
phrase répond « Je n’ai pas compris… ». Le copilote ne résout **jamais** un
titre : pour choisir un jeu précis, on passe par « Changer de jeu ».

### D27. Presets et filtres réels

- « Plus calme » cherche `Aventure`, `Simulation` ou `Occasionnel` dans les
  facettes (repli : genres de l’ancre), met `decouverte = 10` ; si aucun genre
  calme n’existe, garde le genre principal et le dit honnêtement.
- « Plus court » met `decouverte = 100`, `lancement = tous` : il privilégie les
  jeux les moins joués, **sans promettre** une durée de session.
- « Surprends-moi » tire une ancre parmi `ancresRecentes` (hors ancre courante
  s’il y en a une autre), remet `genre = défaut` et `decouverte = 100`.
- « Défaut / comme » remet les réglages par défaut en gardant l’ancre.

Chaque preset met à jour l’état du panneau Affiner : le résumé affiché reste
cohérent avec le deck.

### D28. Réponses courtes et honnêtes

Les réponses sont templatées côté front (`messageCopilote`) et ne contiennent
aucune durée de session ni date exacte. Aucun appel réseau propre au copilote :
il réutilise `/api/home/selection`.






