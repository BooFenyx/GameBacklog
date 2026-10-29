# Feature — Refonte de l'affichage de la bibliothèque (PR2)

> Fiche de conception de la PR2, sur la branche `feature/refonte-bibliotheque`.
> La refonte de la fiche de jeu est traitée séparément dans
> `docs/features/refonte-fiche-jeu.md` (branche `feature/refonte-fiche-jeu`) :
> elle implique un enrichissement de l'API et ne doit pas être mélangée à cette
> PR. La spécification produit de référence reste `fiche_projet.md`. La PR1
> (filtres, facettes, colonne latérale) est décrite dans
> `docs/features/filtres-recherche.md`.

## 1. Contexte & objectif

La PR1 a rendu la bibliothèque filtrable, triable et paginée, avec une colonne
de filtres repliable sur desktop. Le commit `66fc31e` a posé une première base
visuelle : coquille pleine largeur, `box-sizing` global, grille de cartes avec
image 16:9, badge d'état, chips de genres et badges de mode.

Il reste trois problèmes :

1. **La carte est encore une boîte bordée** : l'information est concaténée dans
   une seule ligne (`20 h de jeu · joué il y a 8 j · 12 succès`), les badges se
   mélangent aux genres et la hiérarchie ne guide pas l'œil.
2. **Il n'existe qu'une vue grille** : sur une grosse bibliothèque, une vue
   liste compacte est plus rapide à parcourir quand on cherche un titre précis.
3. **Les états et le socle CSS sont fragiles** : pas de squelettes, pas de
   bouton « Réessayer », des classes mortes et des doublons dans `App.css`, et
   aucune couche de tokens sémantiques. Le changement de DA annoncé deviendrait
   une réécriture règle par règle.

Objectif de la PR2 : **rendre la bibliothèque lisible, scannable et agréable
sur desktop comme sur mobile, avec une vue grille et une vue liste**, sans
modifier l'API ni la colonne de filtres livrée en PR1. La PR2 pose aussi le
**socle de tokens** qui sera réutilisé par la fiche de jeu et par la future DA.

**Critères de réussite**

- On comprend l'état d'un jeu en moins de deux secondes : jamais lancé, joué
  récemment, temps de jeu, genres, modes, manette, succès.
- La grille ne dépasse jamais ~400 px de large par carte et gagne des colonnes
  sur grand écran.
- La vue liste reste lisible à 375 px et ne casse pas la pagination.
- Un changement de filtre ne fait plus disparaître la liste.
- La DA peut changer en modifiant `theme.css` seul, sans repasser sur chaque
  composant.
- `npm run lint`, `npm test` et `npm run build` passent dans `web/`.

## 2. Périmètre

**Dans le périmètre**

- Socle de tokens sémantiques et alias des variables existantes.
- Purge du CSS mort et des doublons, sans changement visuel.
- Carte de jeu en grille : image, état, titre, méta, chips, badges.
- Vue liste compacte et bascule grille/liste mémorisée.
- Squelettes de chargement, états vides, erreur avec réessai.
- Responsive et accessibilité de la grille et de la liste.
- Maquette HTML de travail, non versionnée.
- Tests des fonctions pures et recette manuelle.

**Hors périmètre**

- Backend, contrats d'API et filtres : stables depuis la PR1.
- **Fiche de jeu** : branche et fiche dédiées (`refonte-fiche-jeu.md`).
- Accueil calculé, page de recherche et page publique.
- DA finale, mode clair, i18n, branding global (logo, favicon, OG image).
- Refonte de la colonne de filtres ou du panneau mobile.

## 3. État actuel après `66fc31e`

- `web/src/pages/Bibliotheque.tsx` :
  - colonne `SidebarFiltres` + résultats ;
  - toolbar `BarreFiltres` avec recherche, tri, puces actives, compteur ;
  - grille `.liste-jeux` et carte `.jeu-carte` ;
  - `metaJeu()` concatène temps de jeu, dernière partie et succès dans une
    seule chaîne ;
  - `etatJeu()` et `libelleMode()` sont des helpers locaux non testés.
- La coquille est déjà corrigée : `#root` pleine largeur, `.topbar-inner` et
  `.contenu` en padding seul, `box-sizing: border-box` global.
- La barre de résultats n'est plus collante : son fond semi-opaque se découpait
  sur le dégradé et laissait voir les cartes au travers.
- Un changement de filtre ne vide plus la grille : la liste reste affichée et
  s'estompe via `.biblio-resultats--maj`.
- La grille utilise `repeat(auto-fill, minmax(300px, 1fr))`, puis 260 px sous
  1200 px. Elle gagne des colonnes au lieu d'étirer des cartes géantes.
- Champs disponibles par jeu : `appId`, `name`, `headerImageUrl`, `genres`,
  `modes`, `controllerSupport`, `playtimeForever`, `playtimeLast2Weeks`,
  `lastPlayedAt`, `achievementsUnlocked`.
- `achievementsUnlocked` est un **compteur de succès débloqués**, pas un total :
  ne jamais afficher `12/40` sur une carte sans ouvrir la fiche.
- `web/src/App.css` contient encore :
  - des classes mortes : `.nav-avenir`, `.bibliotheque-barre`,
    `.bibliotheque-recherche`, `.bibliotheque-tri`, `.carte-vide`,
    `.jeu-liste`, `.jeu`, `.jeu-duree`, `.jeu-dernier` ;
  - des sélecteurs dupliqués : `.bibliotheque`, `.bibliotheque-tete`,
    `.liste-jeux`, `.liste-jeux li`, `.jeu-nom` ;
  - des couleurs de marque codées en dur (`rgba(184, 155, 255, …)`,
    `rgba(61, 245, 255, …)`, `#120f1c`, `#0b0812`) qui empêchent un changement
    de DA centralisé.
- `.sr-only` est utilisé par la barre de recherche : **ne pas le supprimer**.
- Les assets `web/src/assets/hero.png`, `react.svg`, `vite.svg` et
  `web/public/icons.svg` ne sont pas utilisés. Le favicon `web/public/favicon.svg`
  est le seul asset de marque réellement chargé.
- `web/package.json` possède déjà un script `test` (`vitest run`) et
  `web/src/filters.test.ts` existe. Contrairement à une note ancienne
  d'`AGENTS.md`, il n'y a pas de script à ajouter pour tester le front.

## 4. Principes de conception & socle de tokens

### 4.1 Principes

- **Image-first** : l'image du jeu porte la carte ; le texte vient ensuite.
- **Surfaces superposées, pas de boîtes empilées** : un fond de page, une
  surface de carte, des chips flottantes. Les bordures servent de séparation
  fine, pas de structure principale.
- **Un seul accent** : le dégradé violet → cyan marque l'action et l'état
  actif ; il n'est pas répété sur chaque bordure.
- **Hiérarchie typographique** : titre > méta > chips > badges. Une seule
  information forte par niveau.
- **Rythme constant** : échelle d'espace et de rayons unique, pas de valeurs
  magiques dans les composants.
- **Mouvement sobre** : transitions courtes, désactivées si
  `prefers-reduced-motion`.
- **DA remplaçable** : aucun composant ne connaît une couleur de marque. Les
  composants consomment des tokens sémantiques ; la DA finale ne modifie que
  `theme.css`.

### 4.2 Tokens

Créer `web/src/styles/theme.css`, importé avant `index.css` dans `main.tsx` :

```css
:root {
  /* Primitives de marque — à remplacer lors du changement de DA */
  --primaire-400: #b89bff;
  --secondaire-400: #3df5ff;
  --neutre-950: #050308;
  --neutre-900: #0b0812;
  --neutre-850: #14101f;
  --neutre-800: #1c162b;
  --neutre-700: #32284a;
  --neutre-300: #c7c2d3;
  --neutre-50: #f5f3ff;

  /* Tokens sémantiques — consommés par les composants */
  --couleur-fond: var(--neutre-950);
  --couleur-surface-1: var(--neutre-850);
  --couleur-surface-2: var(--neutre-800);
  --couleur-texte: var(--neutre-300);
  --couleur-texte-fort: var(--neutre-50);
  --couleur-bordure: var(--neutre-700);
  --couleur-accent: var(--primaire-400);
  --couleur-accent-2: var(--secondaire-400);
  --couleur-accent-doux: color-mix(in oklab, var(--couleur-accent) 18%, transparent);
  --couleur-accent-bordure: color-mix(in oklab, var(--couleur-accent) 60%, transparent);

  /* Rayons, espace, typographie, ombres */
  --rayon-sm: 8px;
  --rayon-md: 12px;
  --rayon-lg: 18px;
  --rayon-pilule: 999px;
  --espace-1: 4px;
  --espace-2: 8px;
  --espace-3: 12px;
  --espace-4: 16px;
  --espace-5: 24px;
  --espace-6: 32px;
  --espace-7: 48px;
  --typo-titre-1: clamp(2rem, 1.4rem + 2vw, 3rem);
  --typo-titre-2: 1.375rem;
  --typo-texte: 1rem;
  --typo-petit: 0.8125rem;
  --ombre-carte: 0 18px 40px -28px rgba(0, 0, 0, 0.8);
  --ombre-survol: 0 24px 60px -30px var(--couleur-accent);
  --anneau-focus: 0 0 0 2px var(--couleur-fond), 0 0 0 4px var(--couleur-accent);
}

/* Alias de compatibilité : l'existant continue de fonctionner pendant la
   migration, mais plus aucun nouveau composant ne doit utiliser ces noms. */
:root {
  --bg: var(--couleur-fond);
  --bg-surface: var(--couleur-surface-1);
  --bg-elev: var(--couleur-surface-2);
  --border: var(--couleur-bordure);
  --text: var(--couleur-texte);
  --text-h: var(--couleur-texte-fort);
  --accent: var(--couleur-accent);
  --accent-2: var(--couleur-accent-2);
  --accent-bg: var(--couleur-accent-doux);
  --accent-border: var(--couleur-accent-bordure);
  --accent-glow: color-mix(in oklab, var(--couleur-accent) 45%, transparent);
  --accent-glow-2: color-mix(in oklab, var(--couleur-accent-2) 40%, transparent);
  --shadow: var(--ombre-survol);
}
```

Règles :

- Aucune couleur de marque en dur dans les nouveaux composants.
- Les anciennes variables restent des **alias** vers les tokens sémantiques :
  changer la DA = changer les primitives, sans casser la PR1.
- Les dégradés du `body` et les valeurs `rgba(...)` de marque passent aussi par
  des tokens (`--fond-degrade-1`, `--fond-degrade-2`, etc.) ou `color-mix`.
- Le nom des tokens est en français, comme le reste du projet.

## 5. Expérience cible

### 5.1 En-tête de la bibliothèque

- Titre `Bibliothèque`, résumé `N jeux · M jamais lancés`, bouton
  `Synchroniser` à droite.
- Sous 768 px, le résumé passe sous le titre et le bouton reste accessible.
- Le bandeau de progression d'import reste compact et ne pousse pas la grille.

### 5.2 Barre de résultats

La barre actuelle est conservée : recherche, tri, puces actives, compteur.
Ajouter uniquement **la bascule grille/liste** à droite, via un slot
`actions?: ReactNode` optionnel sur `BarreFiltres` (comportement inchangé pour
la page de recherche).

Le bouton **Filtres** reste à gauche : il est le premier contrôle de la barre
sur mobile et tablette, là où la colonne latérale est remplacée par le panneau.
Sur desktop, la colonne de filtres reste à gauche et le bouton est masqué.

Le tri par nom s'affiche **`Nom (A → Z)`**, pour rendre l'ordre explicite.

La barre **n'est pas collante** : le fond semi-opaque se découpait sur le
dégradé et laissait voir les images au travers. Elle reste dans le flux.

### 5.3 Carte en grille

Ordre visuel :

1. **Image 16:9** (`460 × 215`), `loading="lazy"`, `decoding="async"`,
   `aspect-ratio` pour éviter le CLS, repli dégradé + initiale si l'image
   manque.
2. **Badge d'état** en overlay : `Jamais lancé`, `Joué cette semaine` ou
   `Joué`.
3. **Titre** sur 2 lignes maximum.
4. **Méta** : `20 h de jeu` en valeur forte, puis `joué il y a 8 j` en valeur
   secondaire ; `Jamais lancé` si le temps de jeu est nul.
5. **Chips de genres** : 2 visibles + `+N` (avec `title` ou libellé accessible).
6. **Badges de mode** : `Solo`, `Multi en ligne`, `Multi Local`, `Coop`, `PvP`,
   `CrossPlay` (uniquement les modes présents).
7. **Manette** : badge discret si `full` ; le partiel n'est pas affiché sur la
   carte (il l'est sur la fiche).
8. **Succès** : `12 succès` si `achievementsUnlocked > 0`, sans total inventé.

La carte entière est cliquable via un overlay `Link`, avec `aria-label`
enrichi : « Ouvrir Portal 2 — jamais lancé, coopération, manette complète ».
Le survol soulève la carte, éclaire la bordure et renforce l'image ; pas de
translation supérieure à 3 px.

Largeur : `repeat(auto-fill, minmax(300px, 1fr))`, 260 px sous 1200 px. Une
carte ne dépasse jamais ~400 px.

### 5.4 Vue liste

Une ligne compacte, alignée en colonnes sur desktop :

```text
[image 120×68] Portal 2   [Action][Aventure]   [Solo][Coop]   20 h   il y a 8 j   🎮   12 succès
```

- Image, titre, chips de genres, badges de mode, temps de jeu, dernière partie,
  succès, manette.
- La ligne entière est cliquable ; le survol ajoute une barre d'accent à gauche
  et un léger fond.
- Sur mobile, la ligne redevient une carte compacte : image à gauche, titre et
  méta à droite, chips en dessous.
- La liste utilise la même hauteur de vignette et les mêmes tokens que la
  grille pour que la bascule ne donne pas l'impression de changer de produit.

### 5.5 Bascule grille/liste

- Deux boutons-icônes dans la barre de résultats, groupe `aria-label="Mode
  d'affichage"`, `aria-pressed` sur le bouton actif.
- Icônes SVG inline en `currentColor`, pas de dépendance externe.
- Préférence mémorisée dans `localStorage`, clé
  `gamebacklog:biblio:vue`, valeurs `grille` (défaut) et `liste`.
- Lecture tolérante : `try/catch` autour du stockage, repli sur `grille` si la
  valeur est absente ou inconnue. Pas de préférence dans l'URL : elle ne doit
  pas polluer les filtres partageables.
- La bascule ne relance pas la requête : elle change seulement le rendu.

### 5.6 États

| État | Rendu |
|---|---|
| Chargement initial | 6–9 squelettes de cartes, animation désactivée si `prefers-reduced-motion` |
| Changement de filtre | La liste reste affichée et s'estompe (`--maj`), pas de retour à « Chargement… » |
| Chargement « Afficher plus » | Bouton avec indicateur, pas de saut de grille |
| Bibliothèque vide | Message + bouton `Synchroniser` |
| Filtres sans résultat | Message + `Effacer les filtres` |
| Erreur réseau/API | Message + `Réessayer` (nouveau) |
| Import en cours | Bandeau de progression existant, compact |

Le bouton `Réessayer` incrémente un compteur de rechargement ; il ne vide pas
la liste déjà affichée.

### 5.7 Responsive

- ≥ 1200 px : 3 colonnes avec filtres ouverts, 4 fermés.
- 1024–1200 px : 2 colonnes ouverts, 3 fermés.
- 768–1023 px : 2 colonnes, colonne de filtres remplacée par le panneau mobile
  (le point de rupture actuel est `1023px`, à conserver).
- < 768 px : 1 colonne, carte compacte, toolbar en colonne.
- La vue liste reste disponible partout ; sur mobile, elle devient une carte
  compacte plutôt qu'un tableau horizontal.

### 5.8 Accessibilité

- `aria-live="polite"` sur le compteur de résultats (déjà en place).
- `aria-label` de carte avec les informations clés.
- Focus visible sur la carte, les chips, les boutons de bascule et les liens.
- `prefers-reduced-motion` pour les squelettes et les transitions.
- Contrastes des chips/badges sur fond sombre.
- Navigation clavier complète dans la grille et la liste.
- Les images décoratives ont `alt=""` ; le titre porte le sens.
- La bascule expose son état avec `aria-pressed`, pas seulement une couleur.

## 6. Maquette de travail

Avant de toucher au React, une maquette HTML autonome est construite dans
`/tmp/opencode/maquette-refonte.html` et prévisualisée dans le panneau Review
(`browser.preview`). Elle n'est **pas versionnée** : c'est un artefact de
travail, pas une source de vérité.

Contenu :

- coquille : topbar, nav, recherche, compte ;
- bibliothèque : en-tête, barre de résultats, colonne de filtres, grille de
  6 cartes, 6 lignes de liste, bascule, états squelette/vide/erreur ;
- cas limites : sans image, sans genre, sans mode, jamais lancé, récent,
  manette partielle, titre long ;
- responsive 1440 / 1024 / 768 / 375 px ;
- mêmes noms de tokens que `theme.css`.

La maquette est itérée avec le développeur jusqu'à validation de la structure,
de la hiérarchie et des composants. Les décisions validées sont reportées dans
cette fiche ; la maquette peut ensuite être jetée.

## 7. Données & API

Aucun changement backend n'est nécessaire pour la bibliothèque.

- La page reçoit déjà tout ce dont les cartes ont besoin.
- Le total de succès n'est pas disponible dans la liste : ne pas l'inventer.
- Les images Steam sont des URL absolues ; la CSP Vercel autorise déjà les
  domaines Steam (`*.steamstatic.com`, `*.akamaihd.net`, `*.steamcontent.com`,
  `*.steampowered.com`).
- Le repli d'image reste côté front (dégradé + initiale), sans requête
  supplémentaire.
- La pagination reste à 48 jeux par page (`LIMITE_BIBLIOTHEQUE`).

## 8. Composants & fichiers

**À créer**

- `web/src/styles/theme.css` — tokens primitifs, sémantiques et alias.
- `web/src/components/ui/Etiquette.tsx` — chips et badges avec variantes de ton.
- `web/src/components/ui/Icones.tsx` — icônes SVG inline (`grille`, `liste`,
  `manette`, `chevron`).
- `web/src/components/bibliotheque/ImageJeu.tsx` — image + repli.
- `web/src/components/bibliotheque/CarteJeu.tsx` — carte grille.
- `web/src/components/bibliotheque/LigneJeu.tsx` — ligne de la vue liste.
- `web/src/components/bibliotheque/SqueletteCarte.tsx` — squelette grille/liste.
- `web/src/components/bibliotheque/BasculeVue.tsx` — bascule grille/liste.
- `web/src/components/bibliotheque/useVueBibliotheque.ts` — préférence
  `localStorage`, helpers purs testables.

**À modifier**

- `web/src/pages/Bibliotheque.tsx` — utilise les nouveaux composants, la vue et
  les squelettes ; garde la logique de filtres, de pagination et de sync.
- `web/src/components/filtres/BarreFiltres.tsx` — slot `actions` optionnel.
- `web/src/App.css` — purge puis styles des nouveaux composants.
- `web/src/index.css` — tokens de fond et typographie, sans couleurs de marque
  en dur.
- `web/src/main.tsx` — import de `styles/theme.css` avant `index.css`.
- `web/src/format.ts` — réutiliser `formaterDuree`, `formaterDepuis` ; ne pas
  dupliquer le formatage.
- `docs/features/refonte-bibliotheque.md` — cette fiche.

**À ne pas modifier**

- `api/` : aucun contrat ni migration dans cette PR.
- `SidebarFiltres.tsx`, `PanneauFiltres.tsx` : la colonne et le panneau sont
  stables depuis la PR1. `BarreFiltres.tsx` ne reçoit qu'un slot optionnel.
- Les pages accueil, détail et recherche.
- `web/public/favicon.svg` et `.sr-only`.

## 9. Nettoyage CSS

Ordre recommandé, avant toute nouvelle règle :

1. Supprimer les classes mortes listées en §3.
2. Fusionner les sélecteurs dupliqués (`.bibliotheque`, `.bibliotheque-tete`,
   `.liste-jeux`, `.liste-jeux li`, `.jeu-nom`).
3. Remplacer les couleurs de marque codées en dur par les tokens.
4. Vérifier que les classes de la PR1 (`.biblio-layout`, `.filtres-sidebar`,
   `.filtre-*`, `.onglet-filtres`) ne sont pas touchées.
5. Comparer visuellement avant/après : le nettoyage ne doit produire **aucun
   changement visuel**.
6. Vérifier avec `grep` qu'une classe supprimée n'est plus référencée dans les
   `.tsx`.
7. Supprimer les assets inutilisés (`hero.png`, `react.svg`, `vite.svg`,
   `public/icons.svg`) dans un commit dédié, après vérification.

Le renommage des conteneurs de la bibliothèque est autorisé dans la tranche
« cartes » : `.liste-jeux` devient `.biblio-grille` / `.biblio-liste` pour
distinguer les deux vues. Vérifier qu'aucune autre page n'utilise ces classes
(la recherche utilise `.carte-resultat`, l'accueil `.cartes`).

## 10. Découpage en tranches & commits

La maquette n'est pas commitée. Chaque tranche doit pouvoir être relue et
testée indépendamment. Ne pas mélanger la purge CSS et les changements visuels.

1. `docs: élargir la fiche de la refonte de la bibliothèque` — cette fiche.
2. `refactor(web): poser les tokens sémantiques et purger le CSS mort` — aucun
   changement visuel attendu.
3. `feat(web): extraire la carte de jeu et ses étiquettes` — `CarteJeu`,
   `Etiquette`, `ImageJeu`, méta séparée, badge succès.
4. `feat(web): vue liste et bascule grille/liste` — `LigneJeu`, `BasculeVue`,
   préférence `localStorage`.
5. `feat(web): squelettes, états vides et erreurs de la bibliothèque`.
6. `feat(web): responsive et accessibilité de la bibliothèque`.
7. `docs: mettre à jour la fiche de la refonte de la bibliothèque` — si des
   décisions changent en cours de route.

Chaque commit doit passer `npm run lint`, `npm test` et `npm run build` dans
`web/`. Les tests manuels de la §11 sont à refaire avant chaque commit visuel.

## 11. Tests & recette

**Automatique**

```bash
cd web
npm run lint
npm test
npm run build
```

- Ajouter des tests purs pour `lireVue` / `ecrireVue` (préférence, valeur
  inconnue, stockage indisponible) et, si les helpers sont extraits,
  `etatJeu` / `metaJeu`.
- Ne pas introduire de dépendance DOM pour ces tests.
- `tsc -b` exclut déjà `src/**/*.test.*` et `src/**/*.spec.*` : vérifier que le
  build reste vert après ajout de tests.
- `web/package.json` possède déjà `"test": "vitest run"` ; ne pas le retirer.

**Manuel**

- 0 jeu, 1 jeu, 8 jeux, 130 jeux.
- Jeu sans image, sans genre, sans mode.
- Jamais lancé, joué récemment, joué il y a longtemps.
- Grille et liste, bascule persistée après rechargement.
- Filtres ouverts/fermés, 3 → 4 colonnes.
- Changement de filtre : la liste s'estompe sans disparaître.
- « Afficher plus » : pas de saut de grille.
- Erreur réseau : `Réessayer` recharge sans perdre la liste.
- Mobile 375 px, tablette 768 px, desktop 1440 px.
- Clavier, lecteur d'écran, `prefers-reduced-motion`.
- Lighthouse accessibilité ≥ 95.

## 12. Risques & décisions

| Risque | Parade |
|---|---|
| La purge CSS modifie le rendu | commit dédié, comparaison visuelle avant/après, `grep` des classes |
| Les alias de tokens créent un cycle | alias uniquement vers des primitives, jamais l'inverse |
| Carte trop chargée | max 2 chips de genres + `+N`, badges de mode compacts, une seule méta forte |
| CLS sur les images | `aspect-ratio`, `width`/`height`, repli dégradé |
| Succès sans total | afficher « N succès », jamais « N/Total » |
| Vue liste coûteuse sur 1 000 jeux | l'API pagine 48 par page ; la liste reste bornée |
| Filtres et cartes se chevauchent | ne pas toucher à `SidebarFiltres`/`PanneauFiltres` |
| Régression mobile | tester 375/768 px et le panneau de filtres existant |
| `localStorage` indisponible | `try/catch`, repli sur `grille` |
| Conflit avec la branche fiche de jeu | le socle de tokens est livré ici ; la branche fiche part de cette base |

**Décisions actées**

- La colonne de filtres A (sidebar repliable + onglet) est livrée en PR1 et sert
  de base ; la PR2 ne la refait pas.
- Pas d'i18n, interface 100 % française.
- Le partiel manette reste affiché uniquement sur la fiche du jeu.
- Le total de succès n'est pas ajouté à l'API pour cette PR.
- La carte est extraite dans `CarteJeu.tsx` (la décision inverse de la première
  tranche est abandonnée au profit de composants testables).
- Un changement de filtre ne vide plus la grille : l'ancienne liste reste
  affichée, estompée, le temps de la requête.
- La vue par défaut est la grille ; le choix est mémorisé dans `localStorage`.
- Le bouton **Filtres** reste à gauche : premier contrôle sur mobile/tablette,
  colonne latérale à gauche sur desktop.
- Le tri par nom affiche **`Nom (A → Z)`**.
- La DA finale est hors PR2 : `theme.css` est le seul point à modifier.
- La fiche de jeu part sur `feature/refonte-fiche-jeu` et sa propre fiche.

## 13. Références

- `fiche_projet.md:17` — bibliothèque, temps de jeu, filtres et tri.
- `docs/features/filtres-recherche.md` — contrats, facettes, colonne de filtres.
- `docs/features/refonte-fiche-jeu.md` — refonte de la fiche de jeu (PR3).
- `AGENTS.md` — conventions, état du projet, pièges CSS/ESM.
- `web/src/pages/Bibliotheque.tsx` — page et logique actuelles.
- `web/src/library.ts` — types `JeuBibliotheque`, `ReponseBibliotheque`.
- `web/src/filters.ts` — filtres, tri et sérialisation URL.
- `web/src/format.ts` — `formaterDuree`, `formaterDepuis`.
