# Feature — Refonte de la fiche de jeu (PR3)

> Fiche de conception de la PR3, sur la branche `feature/refonte-fiche-jeu`.
> Elle prolonge la refonte de l'affichage commencée par la bibliothèque
> (`docs/features/refonte-bibliotheque.md`, PR2) et réutilise son socle de
> tokens. Contrairement à la PR2, elle **modifie l'API** (`appdetails`) et doit
> donc rester séparée. La spécification produit de référence reste
> `fiche_projet.md`.

## 1. Contexte & objectif

La fiche actuelle (`web/src/pages/JeuDetail.tsx`) est fonctionnelle mais
rudimentaire :

- une image d'en-tête, un titre, une description courte, une liste de
  définitions et une liste plate de succès ;
- un chargement réduit à « Chargement de la fiche… » ;
- aucun visuel de jeu, aucune galerie, aucune hiérarchie entre les informations ;
- les succès débloqués et verrouillés sont mélangés dans une seule liste.

Surtout, l'API jette une grande partie de ce que Steam renvoie déjà :
`GET /api/games/:appId` n'expose que `shortDescription`, alors que
`appdetails` fournit la description longue, les captures d'écran, les
développeurs, les éditeurs, le site officiel, les plateformes, Metacritic et
une image de fond. `mapAppDetails` ne mappe que les champs nécessaires à la
bibliothèque et aux filtres.

Objectif de la PR3 : **faire de la fiche de jeu une page complète, immersive et
lisible**, en récupérant les données déjà disponibles chez Steam et en
réutilisant le langage visuel de la PR2. La DA finale reste hors périmètre :
la fiche ne doit consommer que des tokens.

**Critères de réussite**

- On comprend le jeu, son état dans la bibliothèque et ses succès sans faire
  défiler une `dl` brute.
- La description longue est lisible, sans HTML injecté.
- Les captures sont consultables sans alourdir le premier chargement.
- Les succès sont hiérarchisés : progression, filtre débloqués/verrouillés,
  dates de déblocage.
- La page est utilisable à 375 px comme à 1440 px.
- Aucun appel Steam supplémentaire à l'ouverture de la fiche : les données de
  `appdetails` sont déjà en base, seuls les succès restent à la demande.
- `npm run lint`, `npm test`, `npm run test:e2e` et `npm run build` passent
  dans `api/` ; `npm run lint`, `npm test` et `npm run build` passent dans
  `web/`.

## 2. Périmètre

**Dans le périmètre**

- Enrichissement du mapping `appdetails` et migration de la table `games`.
- Backfill des fiches existantes via la version de mapping.
- Extension de la réponse `GET /api/games/:appId`.
- Refonte de la page : hero, description en blocs, galerie, colonne latérale,
  succès, états, responsive, accessibilité.
- Réutilisation des tokens et primitives de la PR2.
- Tests unitaires du mapping et de la conversion HTML.
- Documentation de la fiche et mise à jour d'`AGENTS.md` en fin de branche
  (validation explicite requise).

**Hors périmètre**

- Lancement automatique d'un jeu, fonctions sociales, notes/avis.
- Prix, DLC, configurations matérielles, films, `support_info`.
- Pagination serveur des succès : l'API renvoie la liste complète, le front
  limite le rendu initial.
- Refonte de la bibliothèque, de la recherche ou de l'accueil.
- DA finale, mode clair, i18n.
- Nouvelle route : la fiche reste `/jeu/:appId`.

## 3. État actuel

### 3.1 Front

`web/src/pages/JeuDetail.tsx` :

- type `FicheJeu` déclaré localement, sans module client partagé ;
- `fetch` inline dans un `useEffect`, avec `AbortController` ;
- états `chargement | erreur | pret` ;
- image d'en-tête, `h1`, lien retour, `shortDescription`, `dl` d'infos,
  bouton `steam://run/<appId>`, liste plate de succès ;
- aucun squelette, aucune galerie, aucun filtre de succès ;
- le message d'erreur et le chargement sont des paragraphes simples.

### 3.2 API

- `api/src/games/games.service.ts` :
  - `AppDetails` ne contient que `shortDescription`, genres, catégories,
    manette, date de sortie et image d'en-tête ;
  - `AppdetailsData` ne type que ces champs ;
  - `mapAppDetails` ignore `detailed_description`, `screenshots`,
    `developers`, `publishers`, `website`, `platforms`, `metacritic`,
    `background` et `background_raw` ;
  - `userGameDetail` joint `library_entries ⋈ games` et renvoie les champs
    actuels ;
  - `FILTERS_VERSION = 1` sert de version de mapping ; `stepDetails` refait les
    fiches dont la version est inférieure.
- `api/src/games/games.controller.ts` :
  - `GameDetailResponse` ajoute `achievements` et `steamUrl` ;
  - les succès sont chargés à la demande par `AchievementsService`.
- `api/src/db/schema.ts` : `games` ne possède pas les colonnes riches.
- `api/drizzle/` : migrations `0000` → `0004`. La prochaine sera `0005`.

### 3.3 Contraintes connues

- Les fiches sont partagées entre utilisateurs : une seule fiche par `appId`.
- Les succès sont chargés à l'ouverture (`GetSchemaForGame` +
  `GetPlayerAchievements`), jamais à l'import.
- `achievementsUnlocked` reste un compteur ; le total n'est disponible que dans
  la fiche.
- La CSP Vercel autorise déjà les images Steam (`*.steamstatic.com`,
  `*.akamaihd.net`, `*.steamcontent.com`, `*.steampowered.com`).
- Le profil Steam peut être privé : l'API renvoie alors une liste de succès
  vide, sans distinguer « jeu sans succès » et « succès inaccessibles ».
- La fiche ne doit pas déclencher d'appel `appdetails` à l'ouverture : les
  données sont lues en base.

## 4. Données & API

### 4.1 Nouvelles colonnes

Migration `0005`, générée avec `npm run db:generate` puis relue :

| Colonne | Type Drizzle | Source `appdetails` | Usage |
|---|---|---|---|
| `description_blocks` | `jsonb` → `DescriptionBlock[]` | `detailed_description` converti | Corps de la fiche |
| `screenshots` | `jsonb` → `CaptureEcran[]` | `screenshots[]`, max 6 | Galerie |
| `developers` | `text[]` | `developers` | Colonne latérale |
| `publishers` | `text[]` | `publishers` | Colonne latérale |
| `website` | `text` | `website` | Lien externe |
| `platforms` | `text[]` | `platforms` | Badges Windows/macOS/Linux |
| `metacritic_score` | `integer` | `metacritic.score` | Note |
| `metacritic_url` | `text` | `metacritic.url` | Lien |
| `background_image_url` | `text` | `background_raw` puis `background` | Fond du hero |

Toutes les colonnes de collection ont un défaut vide (`[]`) et sont
`notNull`, pour que les fiches existantes restent lisibles avant le backfill.

### 4.2 Types partagés

Côté API (`games.service.ts`) et côté front (`web/src/games.ts`) :

```ts
export type DescriptionBlock =
  | { type: 'paragraphe'; texte: string }
  | { type: 'titre'; texte: string }
  | { type: 'liste'; items: string[] }

export type CaptureEcran = {
  miniature: string
  pleine: string
}

export type Plateforme = 'windows' | 'mac' | 'linux'

export type Metacritic = {
  score: number
  url: string | null
}
```

### 4.3 Conversion de la description

`detailed_description` est du HTML Steam. On ne l'injecte **jamais** dans le
front : `htmlToBlocks` le convertit en blocs de texte.

Règles :

- `<p>`, `<div>`, `<br>` → séparateurs de paragraphes ;
- `<h1>` à `<h4>` → `{ type: 'titre', texte }` ;
- `<ul>` / `<ol>` / `<li>` → `{ type: 'liste', items }` ;
- `<strong>`, `<b>`, `<em>`, `<i>`, `<a>`, `<span>` → texte seul, balises
  retirées ;
- `<script>`, `<style>`, `<img>`, `<iframe>` et tout le reste → supprimés ;
- entités HTML décodées (`&amp;`, `&lt;`, `&gt;`, `&quot;`, `&#39;`,
  `&nbsp;`, entités numériques) ;
- espaces normalisés, blocs vides supprimés ;
- repli sur `shortDescription` si `description_blocks` est vide.

La fonction est pure et testée (voir §9). Aucune dépendance de sanitisation
n'est ajoutée : le front ne reçoit que des chaînes.

### 4.4 Captures et images

- `mapScreenshots` ne garde que les entrées avec une URL `http(s)` valide.
- Déduplique par `path_full`.
- Limite à **6 captures** pour borner la réponse.
- Stocke `path_thumbnail` (miniature) et `path_full` (pleine taille). La
  galerie charge les miniatures ; la pleine taille n'est demandée qu'à
  l'ouverture du dialogue.
- `backgroundImageUrl = background_raw ?? background ?? null`.
- Le hero utilise `backgroundImageUrl` en desktop ; en mobile, il peut retomber
  sur `headerImageUrl` pour limiter le poids. Si aucune image, dégradé de
  tokens.

### 4.5 Plateformes et Metacritic

- `mapPlatforms` renvoie les plateformes dans l'ordre `windows`, `mac`,
  `linux`, uniquement si le booléen Steam est vrai.
- `metacritic` n'est stocké que si le score est un entier fini ; l'URL est
  conservée si elle est `http(s)`.
- Pas de score inventé, pas de note sur 100 si Steam ne la fournit pas.

### 4.6 Version de mapping et backfill

- `FILTERS_VERSION` passe de `1` à `2`. Le commentaire est mis à jour : la
  constante versionne désormais **tout le mapping de fiche**, pas seulement les
  identifiants de filtres.
- `stepDetails` sélectionne déjà `details_fetched_at IS NULL OR
  filters_version < FILTERS_VERSION` : les fiches existantes seront rechargées.
- `needsFilters(userId)` déclenche un import au login si des fiches déjà
  récupérées n'ont pas la version courante.
- Le throttle `APPDETAILS_THROTTLE_MS` (300 ms par défaut) limite la pression
  sur le Store ; la progression de l'étape `details` est déjà suivie.
- Un `Synchroniser` manuel permet de relancer le backfill.
- Si les filtres et les détails doivent un jour évoluer séparément, scinder en
  `FILTERS_VERSION` / `DETAILS_VERSION` ; ce n'est pas nécessaire aujourd'hui.

### 4.7 Réponse `GET /api/games/:appId`

`UserGameDetail` et `GameDetailResponse` sont étendus :

```ts
export interface GameDetailResponse extends UserGameDetail {
  descriptionBlocks: DescriptionBlock[]
  screenshots: CaptureEcran[]
  developers: string[]
  publishers: string[]
  website: string | null
  platforms: Plateforme[]
  metacritic: Metacritic | null
  backgroundImageUrl: string | null
  achievements: { total: number; unlocked: number; list: AchievementDto[] }
  steamUrl: string
}
```

- `steamUrl` reste `steam://run/${appId}`.
- Le front construit le lien Store
  (`https://store.steampowered.com/app/${appId}`) à partir de `appId` : pas de
  champ API supplémentaire.
- Les succès restent chargés à la demande et renvoyés en une seule fois.

### 4.8 Sécurité

- Aucun `dangerouslySetInnerHTML` pour la description.
- Les URL d'images et de liens externes sont filtrées sur le protocole
  `http(s)`.
- Les liens externes utilisent `target="_blank"` et `rel="noreferrer"`.
- La CSP de production n'a pas besoin d'être élargie : les hôtes Steam sont
  déjà autorisés. Vérifier `web/vercel.json` après ajout de la galerie.
- Les captures et le fond sont des URL distantes : pas de téléchargement ni de
  stockage binaire côté API.

## 5. Expérience cible

### 5.1 Hero

- Image de fond (`backgroundImageUrl`) avec voile dégradé vers le fond de page ;
  repli sur `headerImageUrl`, puis sur un dégradé de tokens.
- Retour « ← Bibliothèque » en haut.
- Titre du jeu, année de sortie, chips de genres, badge manette, temps de jeu
  principal.
- Actions : `Lancer sur Steam` (principal, `steam://run/<appId>`) et
  `Voir sur Steam` (secondaire, lien Store).
- Le hero ne doit pas être une simple image posée au-dessus du contenu : il
  porte l'identité du jeu et se fond dans la page.

### 5.2 Structure

Desktop ≥ 1024 px : deux colonnes.

- **Colonne principale** : description, galerie, succès.
- **Colonne latérale** (320 px, sticky) : informations, plateformes, activité,
  progression des succès, liens externes.

Mobile : une seule colonne, la colonne latérale devient des sections après le
hero (ou avant les succès selon l'ordre validé en maquette). L'ordre doit
rester : identité → description → galerie → infos/activité → succès.

### 5.3 Description

- Rendu des `descriptionBlocks` : paragraphes, titres, listes.
- Largeur de lecture confortable (`~72ch`), interlignage aéré.
- Repli sur `shortDescription` si les blocs sont vides.
- Si aucune description, masquer la section.
- Pas de « Lire plus » dans un premier temps : la description Steam est
  généralement raisonnable. Si elle dépasse un seuil (ex. 1 200 caractères),
  un repli « Lire la suite » peut être ajouté sans changer l'API.

### 5.4 Galerie

- Section « Captures d'écran » si au moins une capture.
- Bande de vignettes 16:9, chargées en lazy.
- Clic sur une vignette → `<dialog>` plein écran avec l'image `pleine`.
- Fermeture par bouton, `Échap`, clic sur le fond ; focus rendu à la vignette.
- `alt` utile : « Capture d'écran 2 de Portal 2 ».
- Si une image échoue, la vignette est masquée ou remplacée par un fond de
  tokens, sans casser la grille.

### 5.5 Colonne latérale

**Informations**

- Date de sortie, développeurs, éditeurs, genres, catégories, manette.
- Plateformes (Windows/macOS/Linux) en badges.
- Metacritic : score et lien si disponible.
- Site officiel : lien externe si disponible.

**Mon activité**

- Temps de jeu total, temps sur les 2 dernières semaines, dernière partie.
- Succès : `N/M` et pourcentage, avec barre de progression.
- Si `playtimeForever = 0` : « Jamais lancé » mis en avant.
- Le partiel manette affiche l'avertissement : « Certaines actions peuvent
  nécessiter le clavier ou la souris. »

### 5.6 Succès

- En-tête : `Succès — N/M` et pourcentage.
- Barre de progression accessible (`role="progressbar"`, `aria-valuenow`,
  `aria-valuemin`, `aria-valuemax`).
- Filtres `Tous`, `Débloqués`, `Verrouillés` (boutons `aria-pressed`).
- Grille de cartes : icône, nom, description, date de déblocage pour les
  débloqués ; les verrouillés sont estompés mais lisibles.
- Rendu initial limité à 12 succès, puis « Afficher tous les succès ».
- Si la liste est vide : message générique « Aucun succès disponible pour ce
  jeu (jeu sans succès ou profil Steam privé). »
- Pas de total inventé, pas de score global Steam (non fourni par l'API
  actuelle).

### 5.7 États

| État | Rendu |
|---|---|
| Chargement | Squelette : hero, deux colonnes, lignes de succès |
| Erreur réseau | Message + `Réessayer` + retour bibliothèque |
| 404 | « Ce jeu n'est pas dans ta bibliothèque. » + retour |
| Jeu sans succès | Message dédié dans la section succès |
| Jeu sans captures | Section galerie masquée |
| Jeu sans description longue | Repli description courte, sinon section masquée |
| Image manquante | Dégradé + initiale, pas d'icône cassée |

### 5.8 Responsive

- ≥ 1024 px : hero large, deux colonnes, sidebar sticky.
- 768–1023 px : une colonne, sidebar en sections, galerie en grille 2 colonnes.
- < 768 px : une colonne, hero plus compact, galerie en scroll horizontal ou
  grille 2 colonnes, succès en une colonne, CTA pleine largeur.
- Les textes longs ne doivent jamais provoquer de scroll horizontal.

### 5.9 Accessibilité

- Un seul `h1` (le titre du jeu), sections en `h2`.
- `aria-label` explicite sur les liens externes.
- Dialogue natif `<dialog>` avec focus et `Échap`.
- `prefers-reduced-motion` pour le hero, les transitions et le dialogue.
- Contrastes des badges et des succès verrouillés.
- Navigation clavier complète : retour, CTA, galerie, filtres de succès.
- Images décoratives en `alt=""`, captures avec `alt` descriptif.
- Lighthouse accessibilité ≥ 95.

## 6. Maquette & socle design

- La fiche est ajoutée à la maquette de travail
  `/tmp/opencode/maquette-refonte.html` (non versionnée) : hero, description,
  galerie, colonne latérale, succès, états, responsive.
- La maquette utilise les mêmes tokens que `theme.css` (PR2).
- Nouveaux tokens spécifiques à la fiche, à ajouter dans `theme.css` et non
  dans les composants :
  - `--fiche-hero-hauteur`, `--fiche-hero-voile` ;
  - `--fiche-colonne-largeur` ;
  - `--galerie-vignette-largeur` ;
  - `--succes-icone-taille`.
- Les composants partagés `Etiquette`, `Icones` et, si nécessaire,
  `BarreProgression` viennent de `web/src/components/ui/`.
- Aucune couleur de marque en dur dans les composants de la fiche.

## 7. Composants & fichiers

**API**

- `api/src/db/schema.ts` — nouvelles colonnes `games`.
- `api/drizzle/0005_*.sql` — migration générée.
- `api/src/games/games.service.ts` — types, `htmlToBlocks`, mapping,
  `upsertFromDetails`, `userGameDetail`, `FILTERS_VERSION`.
- `api/src/games/games.controller.ts` — `GameDetailResponse`.
- `api/src/games/games.service.spec.ts` — tests de mapping et de conversion.

**Web**

- `web/src/games.ts` — types `FicheJeu`, `DescriptionBlock`, `CaptureEcran`,
  `Plateforme`, `Metacritic`, `ErreurFiche`, `chargerFicheJeu`.
- `web/src/pages/JeuDetail.tsx` — orchestration et états.
- `web/src/components/jeu/EnteteJeu.tsx` — hero.
- `web/src/components/jeu/DescriptionJeu.tsx` — blocs de description.
- `web/src/components/jeu/GalerieJeu.tsx` — vignettes + dialogue.
- `web/src/components/jeu/PanneauJeu.tsx` — colonne latérale.
- `web/src/components/jeu/SuccesJeu.tsx` — progression, filtres, grille.
- `web/src/components/jeu/SqueletteJeu.tsx` — chargement.
- `web/src/components/ui/BarreProgression.tsx` — si absent de la PR2.
- `web/src/App.css` ou `web/src/styles/fiche.css` — styles de la fiche.
- `web/src/styles/theme.css` — tokens spécifiques à la fiche.

**Documentation**

- `docs/features/refonte-fiche-jeu.md` — cette fiche.
- `docs/features/refonte-bibliotheque.md` — référence du socle design.
- `AGENTS.md` — mise à jour en fin de branche, après validation.

**À ne pas modifier**

- `web/src/pages/Bibliotheque.tsx`, `web/src/components/filtres/*`,
  `web/src/pages/Recherche.tsx`, `web/src/pages/Accueil.tsx`.
- Le contrat de `GET /api/library` et `GET /api/search`.
- Le comportement des succès à la demande (pas de chargement à l'import).

## 8. Découpage en tranches & commits

La branche est créée depuis `feature/refonte-bibliotheque` pour hériter du
socle de tokens ; elle sera rebasée sur `main` après le merge de la PR2. Ne pas
mélanger API et UI dans un même commit.

1. `feat(api): enrichir les fiches appdetails` — migration, types, mapping,
   conversion HTML, backfill `FILTERS_VERSION = 2`, réponse, tests.
2. `feat(web): client et types de la fiche de jeu` — `games.ts`, aucun
   changement visuel.
3. `feat(web): hero, description et colonne latérale de la fiche`.
4. `feat(web): galerie et succès de la fiche`.
5. `feat(web): squelettes, erreurs et responsive de la fiche`.
6. `docs: fiche de la refonte de la fiche de jeu` — cette fiche.
7. `docs: mettre à jour AGENTS.md` — après validation explicite.

Chaque commit doit passer les vérifications de son paquet. Un commit API ne
doit pas embarquer de UI, et inversement.

## 9. Tests & recette

**Automatique — API**

```bash
cd api
npm run lint
npm test
npm run test:e2e
npm run build
```

Tests unitaires à ajouter :

- `htmlToBlocks` :
  - paragraphes séparés par `<p>` et `<br>` ;
  - titres `h1`–`h4` ;
  - listes `ul`/`ol` ;
  - balises inline retirées ;
  - entités décodées ;
  - balises dangereuses (`<script>`, `<img onerror>`) supprimées ;
  - entrée vide ou `undefined` → `[]`.
- `mapScreenshots` : URL manquante, déduplication, limite 6.
- `mapPlatforms` : ordre et booléens absents.
- `mapAppDetails` : nouveaux champs, valeurs par défaut, `background_raw`
  prioritaire.
- `upsertFromDetails` : écriture des nouvelles colonnes (test existant étendu).
- `userGameDetail` : sélection des nouveaux champs (si le faux DB le permet).

**Automatique — Web**

```bash
cd web
npm run lint
npm test
npm run build
```

- Tests purs pour `chargerFicheJeu` si un mock `fetch` est simple à mettre en
  place ; sinon, garder les tests sur les helpers de rendu (filtre des succès,
  pourcentage).
- `tsc -b` exclut déjà les fichiers de test : vérifier que le build reste vert.

**Manuel**

- Jeu avec captures / sans captures.
- Jeu avec description longue / sans description longue.
- Développeurs, éditeurs, site, Metacritic, plateformes présents ou absents.
- Jeu jamais lancé, joué récemment, joué il y a longtemps.
- 0 succès, 1 succès, dizaines de succès, succès tous débloqués / tous
  verrouillés / mélangés.
- Profil Steam privé ou `STEAM_API_KEY` absente : message de succès adapté.
- Titre très long, image manquante, date de sortie absente, manette partielle.
- Chargement, 404, erreur réseau + `Réessayer`.
- Galerie : clavier, `Échap`, focus rendu, image plein écran.
- 375 / 768 / 1024 / 1440 px.
- Vérifier qu'aucun HTML de description n'est interprété (test avec une fiche
  mockée contenant `<script>`).
- Lighthouse accessibilité ≥ 95.

## 10. Risques & décisions

| Risque | Parade |
|---|---|
| Backfill long sur une grosse bibliothèque | throttle 300 ms, progression `details`, `Synchroniser` manuel, reprise au redémarrage |
| HTML Steam mal converti | `htmlToBlocks` testé, repli sur `shortDescription`, aucun HTML injecté |
| Description trop longue | largeur de lecture limitée, option « Lire la suite » si nécessaire |
| Captures lourdes | miniatures dans la galerie, pleine taille uniquement dans le dialogue, max 6 |
| Fond de hero trop lourd | `background_raw` en desktop, repli `header_image` en mobile, dégradé sinon |
| Milliers de succès | rendu initial 12, bouton « Afficher tous les succès », pas de pagination API |
| Profil privé | message générique, pas de blocage de la fiche |
| URL externes | filtre `http(s)`, `rel="noreferrer"`, CSP inchangée |
| Conflit avec la PR2 | branche empilée, rebase après merge, tokens uniquement dans `theme.css` |
| Migration sur base existante | colonnes `notNull` avec défauts vides, backfill par version |
| `FILTERS_VERSION` détourné | commentaire mis à jour ; scission possible plus tard |

**Décisions actées**

- L'enrichissement API se fait sur `feature/refonte-fiche-jeu`, pas sur la
  branche bibliothèque.
- La description longue est convertie en **blocs de texte sûrs**, jamais en
  HTML.
- Les captures sont limitées à 6 et chargées en deux tailles.
- `FILTERS_VERSION` passe à 2 et versionne le mapping complet.
- Le hero utilise `background_raw` en desktop et `header_image` en repli.
- Les succès sont rendus par lots de 12, sans pagination serveur.
- Le CTA principal reste `steam://run/<appId>` ; le lien Store est secondaire.
- Pas de prix, DLC, films, configurations matérielles ni notes sociales.
- La DA finale reste hors périmètre : seuls les tokens changent.

## 11. Références

- `fiche_projet.md:19` — détail d'un jeu : description, genres, manette, temps
  de jeu, succès, lien de lancement.
- `docs/features/refonte-bibliotheque.md` — socle de tokens, composants
  partagés, conventions de la PR2.
- `docs/features/filtres-recherche.md` — filtres et facettes (contexte).
- `api/src/games/games.service.ts` — mapping `appdetails` et fiche utilisateur.
- `api/src/games/games.controller.ts` — réponse `GET /api/games/:appId`.
- `api/src/achievements/achievements.service.ts` — succès à la demande.
- `api/src/db/schema.ts` — table `games`, colonnes et types.
- `web/src/pages/JeuDetail.tsx` — page actuelle.
- `web/vercel.json` — CSP et hôtes d'images autorisés.
- `AGENTS.md` — conventions, état du projet, pièges ESM/CSS.
