# Feature — Refonte de l'affichage de la bibliothèque (PR2)

> Fiche de conception et plan d'implémentation de la PR2. La PR1 a livré la
> recherche par filtres, la colonne latérale et les facettes
> (`docs/features/filtres-recherche.md`). Cette PR se concentre sur **les cartes,
> la vue liste, les états et la propreté du CSS**. La spécification produit de
> référence reste `fiche_projet.md`.

## 1. Contexte & objectif

La PR1 a rendu la bibliothèque filtrable, triable et paginée, avec une colonne
de filtres repliable sur desktop. Les cartes, elles, sont restées dans leur
version initiale : une image, un titre et une longue ligne d'informations
concaténées (`20 h • 35 min en 2 sem • joué il y a 8 j • Action, Aventure •
manette complète • 12 succès`). Sur une grille à 2 ou 3 colonnes, cette ligne
devient difficile à lire et les informations importantes — « jamais lancé »,
mode de jeu, manette — ne ressortent pas.

Objectif de la PR2 : **rendre la liste des jeux lisible, scannable et agréable
sur desktop comme sur mobile**, sans modifier le backend ni la colonne de
filtres livrée en PR1.

## 2. Périmètre

**Dans le périmètre**

- Nouvelle carte de jeu en grille : image, badges, chips de genres, méta, modes.
- Vue **liste** compacte et bascule grille/liste.
- Image de repli et prévention du décalage de mise en page (CLS).
- Squelettes de chargement, états vides et erreurs.
- Nettoyage du CSS mort et des doublons accumulés depuis les branches
  d'affichage précédentes.
- Responsive et accessibilité de la grille/liste.
- Tests des fonctions pures et recette manuelle.

**Hors périmètre**

- Backend, contrats d'API et filtres (stables depuis la PR1).
- Accueil calculé, fiche détail, page de recherche et page publique.
- i18n, traduction, mode clair.
- Branding global (favicon, logo, OG image) : à traiter dans une passe de
  finition séparée.

## 3. État actuel après la PR1

- `web/src/pages/Bibliotheque.tsx` :
  - colonne `SidebarFiltres` + résultats ;
  - toolbar (`BarreFiltres`) avec recherche, tri, puces actives, compteur ;
  - grille `.liste-jeux` et carte `.jeu-carte` historiques ;
  - `infosJeu()` concatène toutes les informations dans une seule chaîne.
- Champs disponibles par jeu : `appId`, `name`, `headerImageUrl`, `genres`,
  `modes`, `controllerSupport`, `playtimeForever`, `playtimeLast2Weeks`,
  `lastPlayedAt`, `achievementsUnlocked`.
- `achievementsUnlocked` est un **compteur de succès débloqués**, pas un total :
  ne pas afficher `12/40` sur une carte sans ouvrir la fiche.
- `web/src/App.css` contient encore :
  - des classes mortes : `.nav-avenir`, `.bibliotheque-barre`,
    `.bibliotheque-recherche`, `.bibliotheque-tri`, `.carte-vide`,
    `.jeu-liste`, `.jeu`, `.jeu-duree`, `.jeu-dernier` ;
  - des sélecteurs dupliqués : `.bibliotheque`, `.bibliotheque-tete`,
    `.liste-jeux`, `.liste-jeux li`, `.jeu-nom` ;
  - des styles de cartes/fiches qui se chevauchent avec les ajouts de la PR1.
- `.sr-only` est utilisé par la barre de recherche : **ne pas le supprimer**.
- Les assets `web/src/assets/hero.png`, `react.svg`, `vite.svg` et
  `web/public/icons.svg` ne sont pas utilisés ; le favicon actuel n'est pas un
  logo GameBacklog. À traiter hors PR2.

## 4. Expérience cible

### 4.1 Carte en grille

Ordre visuel :

1. **Image 16:9** (`460 × 215`), `loading="lazy"`, `decoding="async"`, avec
   repli dégradé + initiale si l'image manque.
2. **Badge d'état** en overlay : `Jamais lancé` ou `Joué cette semaine`.
3. **Titre** sur 2 lignes maximum.
4. **Chips de genres** : 2 visibles + `+N` (tooltip ou titre accessible).
5. **Méta** : `12 h de jeu` ou `Jamais lancé`, puis `joué il y a 3 j`.
6. **Badges de mode** : `Solo`, `Multi en ligne`, `Multi Local`, `Coop`, `PvP`,
   `CrossPlay` (uniquement les modes présents).
7. **Manette** : icône/badge discret si `full` ; le partiel n'est pas affiché
   sur la carte (il l'est sur la fiche).
8. **Succès** : `12 succès` si `achievementsUnlocked > 0`, sans total inventé.

La carte entière est cliquable (overlay `Link`), avec `aria-label` enrichi :
« Ouvrir Portal 2 — jamais lancé, coopération, manette complète ».

### 4.2 Vue liste

Une ligne compacte :

```
[image 120×68] Portal 2              [Action][Aventure]   [Solo][Coop]   20 h   il y a 8 j   🎮
```

- Image, titre, chips de genres, modes, temps de jeu, dernière partie.
- Sur mobile, la ligne redevient une carte compacte.
- Bascule **Grille / Liste** dans la barre de résultats, mémorisée dans
  `localStorage` (pas dans l'URL pour ne pas polluer les filtres).

### 4.3 Barre de résultats

La barre actuelle est conservée (recherche, tri, puces actives, compteur).
Ajouter uniquement :
- la bascule grille/liste ;
- éventuellement un compteur « 8 résultats » déjà présent.

### 4.4 États

| État | Rendu |
|---|---|
| Chargement initial | 6–9 squelettes de cartes, animation désactivée si `prefers-reduced-motion` |
| Chargement « Afficher plus » | bouton avec indicateur, pas de saut de grille |
| Bibliothèque vide | message + bouton Synchroniser |
| Filtres sans résultat | message + « Effacer les filtres » |
| Erreur réseau/API | message + « Réessayer » |
| Import en cours | bandeau de progression existant, compact |

### 4.5 Responsive

- ≥ 1200 px : 3 colonnes avec filtres ouverts, 4 fermés.
- 1024–1200 px : 2 colonnes ouverts, 3 fermés.
- 768–1023 px : 2 colonnes, colonne de filtres remplacée par le panneau mobile.
- < 768 px : 1 colonne, carte compacte, toolbar en colonne.
- La vue liste est prioritaire sur mobile si la grille devient trop dense.

### 4.6 Accessibilité

- `aria-live="polite"` sur le compteur de résultats (déjà en place).
- `aria-label` de carte avec les informations clés.
- Focus visible sur la carte, les chips et la bascule.
- `prefers-reduced-motion` pour les squelettes et les transitions de carte.
- Contrastes des chips/badges sur fond sombre.
- Navigation clavier complète dans la grille et la liste.

### 4.7 Design tokens

Avant d'ajouter de nouvelles règles, poser quelques variables dans `index.css`
ou `App.css` :

```css
--card-radius: 12px;
--chip-radius: 999px;
--card-border: color-mix(in oklab, var(--accent) 18%, var(--border));
--card-border-hover: color-mix(in oklab, var(--accent) 55%, var(--accent-2) 45%);
```

Objectif : supprimer les `!important` et les répétitions de couleurs dans les
cartes.

## 5. Données & API

Aucun changement backend n'est nécessaire.

- La page reçoit déjà tout ce dont les cartes ont besoin.
- Le total de succès n'est pas disponible dans la liste : ne pas l'inventer.
- Les images Steam sont des URL absolues ; la CSP Vercel autorise déjà les
  domaines Steam (`*.steamstatic.com`, `*.akamaihd.net`, `*.steamcontent.com`,
  `*.steampowered.com`).
- Le repli d'image doit rester côté front (dégradé + initiale), sans requête
  supplémentaire.

## 6. Composants et fichiers

**À créer**

- `web/src/components/bibliotheque/CarteJeu.tsx` — carte grille.
- `web/src/components/bibliotheque/LigneJeu.tsx` — ligne de la vue liste.
- `web/src/components/bibliotheque/SqueletteCarte.tsx` — squelette.
- `web/src/components/bibliotheque/Etiquettes.tsx` — chips de genres, badges de
  mode, badge manette, badge d'état.
- `web/src/components/bibliotheque/BasculeVue.tsx` — grille/liste.
- éventuellement `web/src/components/bibliotheque/ImageJeu.tsx` — image + repli.

**À modifier**

- `web/src/pages/Bibliotheque.tsx` — remplacer le markup de carte, ajouter la
  vue et les squelettes.
- `web/src/format.ts` — réutiliser `formaterDuree`, `formaterDepuis`.
- `web/src/App.css` — purge puis styles des nouveaux composants.
- `web/src/index.css` — tokens éventuels.
- `docs/features/refonte-bibliotheque.md` — cette fiche.

**À ne pas modifier**

- `api/` : aucun contrat ni migration.
- `SidebarFiltres.tsx`, `BarreFiltres.tsx`, `PanneauFiltres.tsx` : la colonne et
  les filtres sont stables depuis la PR1.
- Les pages accueil, détail et recherche.

## 7. Nettoyage CSS

Ordre recommandé, avant toute nouvelle règle :

1. Supprimer les classes mortes listées en §3.
2. Fusionner les sélecteurs dupliqués (`.bibliotheque`, `.bibliotheque-tete`,
   `.liste-jeux`, `.liste-jeux li`, `.jeu-nom`).
3. Vérifier que les nouvelles classes de la PR1 (`.biblio-layout`,
   `.filtres-sidebar`, `.filtre-*`, `.onglet-filtres`) ne sont pas touchées.
4. Comparer visuellement avant/après : le nettoyage ne doit produire **aucun
   changement visuel**.
5. Vérifier avec `grep` qu'une classe supprimée n'est plus référencée dans les
   `.tsx`.

## 8. Tests et recette

**Automatique**

- `web/` : `npm run lint`, `npm test`, `npm run build`.
- Ajouter des tests purs pour les helpers de la vue (formatage, préférence
  grille/liste) sans introduire de dépendance DOM si possible.
- Si des tests de composants sont ajoutés, déclarer le script et vérifier que
  `tsc -b` exclut toujours les fichiers de test.

**Manuel**

- 0 jeu, 1 jeu, 8 jeux, 130 jeux.
- Jeu sans image, jeu sans genre, jeu sans mode.
- Jamais lancé, joué récemment, joué il y a longtemps.
- Grille et liste, bascule persistée après rechargement.
- Filtres ouverts/fermés, 3 → 4 colonnes.
- Mobile 375 px, tablette 768 px, desktop 1440 px.
- Clavier, lecteur d'écran, `prefers-reduced-motion`.
- Lighthouse accessibilité ≥ 95.

## 9. Découpage en commits

1. `refactor(web): purger le CSS mort et les doublons` — aucun changement visuel.
2. `feat(web): carte de jeu et étiquettes` — `CarteJeu`, chips, badges, image de
   repli.
3. `feat(web): vue liste et bascule grille/liste` — `LigneJeu`, préférence
   `localStorage`.
4. `feat(web): squelettes, états vides et erreurs`.
5. `feat(web): responsive et accessibilité`.
6. `docs: mettre à jour la fiche de la refonte` — si des décisions changent en
   cours de route.

Chaque commit doit passer `npm run lint`, `npm test` et `npm run build` dans
`web/`. Ne pas mélanger la purge CSS et les changements visuels dans le même
commit.

## 10. Risques et décisions

| Risque | Parade |
|---|---|
| La purge CSS modifie le rendu | commit dédié, comparaison visuelle avant/après |
| Carte trop chargée | max 2 chips de genres + `+N`, badges de mode compacts |
| CLS sur les images | `aspect-ratio`, `width`/`height`, repli dégradé |
| Succès sans total | afficher « N succès », jamais « N/Total » |
| Vue liste coûteuse sur 1 000 jeux | l'API pagine 48 par page ; la liste reste bornée |
| Filtres et cartes se chevauchent | ne pas toucher à `SidebarFiltres`/`BarreFiltres` |
| Régression mobile | tester 375/768 px et le panneau de filtres existant |

**Décisions actées**

- La colonne de filtres A (sidebar repliable + onglet) est livrée en PR1 et sert
  de base ; la PR2 ne la refait pas.
- Pas d'i18n, interface 100 % française.
- Le partiel manette reste affiché uniquement sur la fiche du jeu.
- Le total de succès n'est pas ajouté à l'API pour cette PR.

## 11. Références

- `fiche_projet.md:17` — bibliothèque, temps de jeu, filtres et tri.
- `docs/features/filtres-recherche.md` — contrats, facettes, colonne de filtres.
- `AGENTS.md` — conventions, état du projet, pièges CSS/ESM.
