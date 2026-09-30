# GameBacklog — Fiche projet

## Nom
**GameBacklog**

## Pour qui
Un **joueur PC avec une grosse bibliothèque Steam** (plusieurs centaines de jeux, dont beaucoup jamais lancés) qui passe plus de temps à choisir un jeu qu'à y jouer.

## Problème
Aujourd'hui, le joueur parcourt sa bibliothèque Steam à la main : tri par nom, par temps de jeu ou par date, quelques filtres. Ces outils supposent qu'il sait déjà ce qu'il cherche. Or sa vraie question est : **« Qu'est-ce que j'ai envie de jouer maintenant ? »**, exprimée en termes d'ambiance, de mécanique ou de matériel, pas de titre.

## Parcours
**Connexion Steam → import de la bibliothèque → accueil → recherche selon ses envies → fiche du jeu.**

1. **Connexion** : authentification via Steam (OpenID), puis import de la bibliothèque avec suivi de progression. Message d'aide si le profil est privé.
2. **Accueil** : jeux à relancer ou à découvrir dans sa propre bibliothèque (jamais lancés, laissés en cours, proches de ses derniers jeux).
3. **Bibliothèque** : liste des jeux avec temps de jeu, dernière utilisation, genres, filtres et tri classiques.
4. **Recherche** : saisie libre (« un jeu calme avec des énigmes, jouable à la manette ») et résultats classés.
5. **Détail d'un jeu** : description, genres, support manette, temps de jeu, succès obtenus, lien pour lancer le jeu dans Steam.

## Données

| Entité | Champs principaux | Source |
|---|---|---|
| **User** | `id`, `steamId` (unique), `displayName`, `avatarUrl`, `lastSyncAt`, `syncStatus` (`pending` / `running` / `done` / `error`), `createdAt` | Steam OpenID + `GetPlayerSummaries` |
| **Game** *(partagé entre tous les utilisateurs)* | `id`, `appId` (unique), `name`, `shortDescription`, `genres[]`, `categories[]`, `controllerSupport` (`none` / `partial` / `full`), `releaseDate`, `headerImageUrl`, `embedding` (`vector(N)`), `embeddingModel`, `detailsFetchedAt` | Store `appdetails` |
| **LibraryEntry** | `id`, `userId`, `gameId`, `playtimeForever` (min), `playtimeLast2Weeks` (min), `lastPlayedAt`, `achievementsUnlocked`. Contrainte unique (`userId`, `gameId`) | `GetOwnedGames` |
| **Achievement** | `id`, `gameId`, `apiName`, `displayName`, `description`, `iconUrl` | `GetSchemaForGame` |
| **UserAchievement** | `userId`, `achievementId`, `unlockedAt`. Contrainte unique (`userId`, `achievementId`) | `GetPlayerAchievements` |

**Relations**
* `User 1 ── N LibraryEntry N ── 1 Game`
* `Game 1 ── N Achievement`
* `User 1 ── N UserAchievement N ── 1 Achievement`

**Règles de conception**
* `Game` est mis en cache une seule fois et réutilisé par tous les utilisateurs. Les fiches Steam (limitées en débit) ne sont jamais rechargées inutilement.
* Les succès (`Achievement`, `UserAchievement`) sont chargés **à la demande**, à l'ouverture du détail d'un jeu, pour ne pas multiplier les appels à l'import.
* L'import se fait en **tâche de fond** avec reprise : les entrées de bibliothèque d'abord, puis les fiches manquantes, puis les embeddings.

## Brique IA
* **Usage** : recherche sur les données (embeddings + recherche vectorielle), au sein d'une recherche hybride.
* **Indexation** (une fois par jeu, à l'import) : texte `nom + description + genres + catégories` → embedding stocké dans `Game.embedding` (pgvector).
* **Entrée** : phrase libre, longueur limitée (ex. 300 caractères), limitée en fréquence par utilisateur.
* **Traitement** : embedding de la requête, puis SQL unique combinant **filtres stricts** (support manette, dans la bibliothèque de l'utilisateur) et **tri par similarité cosinus**.
* **Sortie** : liste de 10 jeux de la bibliothèque de l'utilisateur, avec le score de similarité et les critères respectés.
* **Repli si échec** (erreur, quota 429, latence excessive) : recherche classique par filtres (genre, manette, temps de jeu) et recherche textuelle sur le nom, avec un message d'information à l'utilisateur.
* **Accueil** : proximité vectorielle avec les jeux récemment lancés, sans appel supplémentaire à un modèle.

## Stack
| Partie | Choix |
|---|---|
| Front | React + Vite + TypeScript |
| API | NestJS + TypeScript (DTO validés) |
| Base de données | PostgreSQL + pgvector, accès via ORM avec support vectoriel (Drizzle) |
| Données jeux | Steam Web API + Store `appdetails` |
| IA | API d'embeddings (Gemini ou Mistral, modèle unique fixé) |
| Hébergement | Render (Front + API), Neon (PostgreSQL) |

Toutes les clés (Steam, modèle) restent **côté API**, hors dépôt Git.

## Hors périmètre
* Autres plateformes (Epic, GOG) et données hors Steam (durée de jeu type HowLongToBeat).
* Fonctions sociales : amis, notes, avis.
* Lancement automatique des jeux.
* Import exhaustif du catalogue Steam : uniquement les jeux de l'utilisateur.
* Recommandations avancées nécessitant un gros historique, génération de texte par un modèle de langage.