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

> Historique : `MenuSoir` a été retiré de l’interface (voir D36). Le principe
> reste valable pour tout fetch avec debounce.

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

Implémenté dans `parametresDepuisSelection` (`web/src/home.ts`) : la sélection
initiale ne recopie jamais `selection.genre.id` dans les réglages.

### D23. Dialogues natifs

`DialogueAncre` et `DialogueAffiner` utilisent `<dialog>` + `showModal()` :
Échap et clic sur le fond ferment, le focus revient au bouton déclencheur
(comportement natif), le corps défile indépendamment sur mobile.

### D24. Ancre et 404

Changer d’ancre remet `genreId` à `null` (le nouveau jeu a son propre genre
principal). Un 404 « Jeu de référence introuvable » ramène l’ancre au jeu
précédemment affiché avec un message non bloquant et un bouton « Réessayer ».

### D25. Le menu suit l’ancre du deck

> Historique : le menu du soir a été retiré de l’interface (voir D36).

`SelectionChef` remonte l’ancre de chaque réponse via `onAncreChange` ;
`Accueil` la passe à `MenuSoir`. Les réglages du menu (temps, intention,
manette) restent indépendants de ceux du deck. Le menu ne se recharge pas
quand seul un réglage du deck change (dépendance sur `anchor.appId`).

## Tranche 7 — Copilote

> Historique : le copilote a été retiré de l’interface (voir D35). Les helpers
> et tests correspondants ont été supprimés.

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

## Tranche 8 — Transparence et polish

### D29. « Pourquoi » ne montre que des signaux lisibles

`DialoguePourquoi` affiche les `reason` du deck et les `signals` du menu. Aucun
score brut n’est exposé, ni dans l’API ni dans le front. Le détail technique
(embedding, pgvector, genre bonus) est replié dans un `<details>`.

### D30. Sources statiques

`DialogueSources` décrit la provenance réelle : `GetOwnedGames`, `appdetails`,
schémas et progression de succès, activité dérivée, embeddings d’import. Il
rappelle qu’aucun appel Steam/Gemini n’est fait au chargement, qu’aucune durée
de session n’existe et qu’aucune date exacte n’est affichée.

### D31. Rechargement dès la fin de l’étape `library`

Le polling `/api/sync` déclenche un rechargement de l’accueil dès que le job
quitte l’étape `library`, sans attendre `details`, `achievements` et
`embeddings`. Les cartes apparaissent donc dès que la bibliothèque est
affichable.

### D32. CSS mort purgé

La liste socle de la tranche 4 (`.accueil-selection-liste`, `.accueil-carte`,
`.accueil-carte-media/corps/genres/titre/raison/meta`) a été retirée : le deck
la remplace. `.accueil-carte-badges` et `.accueil-carte-actions` restent
partagés par le deck et le menu.

### D33. `AGENTS.md` mis à jour pour l’accueil

Sur la branche d’accueil, `AGENTS.md` reflète l’accueil : sections « État du
projet », « Fichiers clés », et Écarts 3/20 passés en ✅ Résolu. L’accueil n’est
plus listé dans « Non implémenté ». **Node 24, les embeddings v2 et le rate
limiting des lectures relèvent de la branche de préparation déploiement final**,
pas de cette branche.

### D34. Petits correctifs de la revue finale

- Les deux instances de `DialoguePourquoi` (deck et menu) ont des `id` de titre
  distincts : plus de doublon d’`id` dans le DOM.
- L’`autoFocus` du champ de recherche d’ancre a été retiré : le dialogue fermé
  ne peut plus voler le focus au chargement de la page.
- « Réessayer » efface l’erreur avant de relancer : le squelette de chargement
  réapparaît au lieu de laisser la carte d’erreur pendant la requête.

## Refonte UI du 3 novembre 2026

### D35. Copilote retiré

`CopiloteBarre` et ses presets (« plus calme », « plus court »,
« surprends-moi ») sont supprimés : la barre « Une autre envie » ne servait pas
assez. Les helpers `presetCopilote` / `messageCopilote` et leurs tests sont
retirés. Les boutons **Affiner la sélection** et **Changer de jeu** prennent sa
place sous le deck, en évidence ; **Pourquoi ces jeux ?** reste discret dans
l’en-tête.

### D36. Menu du soir retiré de l’interface

`MenuSoir` n’est plus affiché ; le composant et son CSS sont supprimés. Les
endpoints `GET /api/home/menu` et les types associés restent côté API pour un
usage futur. Les sources sont déplacées dans un discret pied de page.

### D37. Catégories enrichies et dynamiques

`CategoriesAccueil` devient une vraie section : cartes **de taille fixe**
(image 150 px + contenu 128 px), raison lisible, progression réelle des succès
pour « À finir », genres pour « À découvrir », activité et temps pour
« À retrouver ». L'API renvoie jusqu'à **9 jeux par catégorie** ; le front les
affiche par **pages de 3**. Un bouton **D’autres jeux** fait tourner les pages
à la demande (pas de flèches par section). La pagination est testée dans
`categories.ts`/`categories.test.ts` ; les liens filtrent la bibliothèque
(`etat=jamais`, `tri=recent`, `tri=temps`).

### D38. Swipe corrigé

Le geste ne sélectionne plus le texte et ne déclenche plus le drag natif de
l’image : `user-select: none`, `-webkit-user-drag: none`, `draggable={false}`,
`onDragStart` annulé, `preventDefault()` au `pointerdown` hors liens/boutons,
nettoyage de la sélection et capture du pointeur. Le reste (seuil, `pointerup`
global, `releasePointerCapture`, clic accidentel) est conservé.

### D39. Correctifs ciblés du 3 novembre 2026

- `parametresDepuisSelection` ne recopie plus le genre principal dans
  `genreId` : il reste `null` jusqu’au premier clic, conformément à D22.
- Le filtre `progression` utilise `NULLIF(g.achievements_total, 0)` : un jeu
  sans succès (`achievements_total = 0`) ne peut plus provoquer de division par
  zéro.
- L’e2e de progression couvre explicitement les jeux à
  `achievements_total = 0`.

## Reste à faire avant merge

### `AGENTS.md`

Mis à jour pour l’accueil (État du projet, Fichiers clés, écarts 3/20). Node 24,
les embeddings v2 et le rate limiting sont documentés sur la branche de
préparation déploiement final, pas ici.

### Vérifications manuelles restantes

- Connexion Steam réelle, import terminé, page à 390 px sans scroll horizontal.
- Flèches, swipe gauche/droite, clavier, points, `prefers-reduced-motion`.
- Changer de jeu, Affiner, catégories, dialogues Pourquoi/Sources.
- Lighthouse accessibilité et console propre (non exécutés dans cet
  environnement).









