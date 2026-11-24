# GameBacklog

**Aider un joueur à décider quoi jouer dans sa bibliothèque Steam — en langage naturel.**

[Démo en ligne](https://fst-2026-groupe-08.vercel.app) · [État de l'API](https://fst-2026-groupe-08.onrender.com/api/health)

---

## Le problème

Un joueur PC avec plusieurs centaines de jeux Steam passe plus de temps à choisir qu'à jouer. Les outils existants — tri par nom, par temps de jeu, par date d'achat — supposent qu'il sait déjà ce qu'il cherche.

Or sa vraie question est : **« qu'est-ce que j'ai envie de jouer maintenant ? »**. Elle s'exprime en ambiance, en mécanique, en matériel — pas en titre. Steam ne sait pas y répondre.

## Ce que fait l'application

- **Connexion Steam** (OpenID) et import de la bibliothèque avec suivi de progression.
- **Accueil personnalisé** : jeux à relancer, jeux jamais lancés, jeux proches de ses habitudes récentes.
- **Bibliothèque** : temps de jeu, activité récente, genres, filtres et tris classiques.
- **Recherche en langage naturel** : « un jeu calme avec des énigmes, jouable à la manette ».
- **Fiche jeu** : description, genres, support manette, succès obtenus, lancement direct dans Steam.

## La partie intéressante : la recherche sémantique

La recherche ne repose pas sur des mots-clés. Chaque jeu est converti en **vecteur** à partir de sa description et de ses genres, stocké dans PostgreSQL via l'extension **pgvector**. La requête de l'utilisateur est vectorisée de la même manière, et les résultats sont classés par similarité.

C'est ce qui permet de trouver « un jeu calme avec des énigmes » alors que ni « calme » ni « énigmes » n'apparaissent dans la fiche du jeu. Une recherche par mots-clés ne peut pas le faire.

Le projet embarque aussi une **procédure d'évaluation des embeddings** (`npm run eval:embeddings`) pour mesurer la pertinence des résultats et comparer les modèles, plutôt que de les choisir au hasard.

## Stack

| Couche | Technologies |
|---|---|
| **Front** | React, React Router, TypeScript, Vite |
| **API** | Node.js, NestJS, TypeScript, Drizzle ORM |
| **Base** | PostgreSQL + pgvector |
| **Authentification** | Steam OpenID, sessions Express (`connect-pg-simple`) |
| **Tests** | Jest (unitaires et end-to-end) |
| **Déploiement** | Vercel (front), Render (API), Neon (base) |
| **CI** | GitHub Actions |

## Lancer le projet en local

Prérequis : Node.js 24 (voir `.nvmrc`), Docker, Git.

```bash
git clone https://github.com/BooFenyx/GameBacklog.git
cd GameBacklog

cp .env.example .env          # renseigner les clés (voir ci-dessous)
docker compose up -d          # PostgreSQL + pgvector

cd api && npm ci && cd ../web && npm ci && cd ..
```

Variables à renseigner dans `.env` :

| Variable | Rôle |
|---|---|
| `STEAM_API_KEY` | Clé Steam Web API |
| `EMBEDDING_API_KEY` | Clé du fournisseur d'embeddings |
| `SESSION_SECRET` | Chaîne aléatoire de 32 octets |

Puis, dans deux terminaux :

```bash
cd api && npm run start:dev   # http://localhost:3000
cd web && npm run dev         # http://localhost:5173
```

L'application exige un compte Steam dont les **détails de jeux sont publics**.

## Tests

```bash
cd api && npm test            # unitaires
cd api && npm run test:e2e    # end-to-end
```

## Crédits

Projet réalisé en binôme dans le cadre du M2 Informatique de l'Université de Lorraine :
Mathys Bertrand ([@BooFenyx](https://github.com/BooFenyx))
et [@GamersOD](https://github.com/GamersOD).

Cette copie est un fork personnel du dépôt de groupe, allégé de la documentation de travail interne.
