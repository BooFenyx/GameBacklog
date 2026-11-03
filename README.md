# GameBacklog

Backlog Steam intelligent. Voir [`fiche_projet.md`](./fiche_projet.md) pour la présentation du projet.

## Prérequis

- [Node.js](https://nodejs.org/) **24** (voir `.nvmrc`, `nvm use`) et npm
- [Git](https://git-scm.com/)
- [Docker Desktop](https://www.docker.com/products/docker-desktop/)

## Installation

```bash
# 1. Récupérer le projet
git clone <URL_DU_DEPOT>
cd gamebacklog

# 2. Créer le fichier de configuration
cp .env.example .env

# 3. Lancer la base de données (PostgreSQL + pgvector)
docker compose up -d
# L'extension vector est créée par la migration 0000 au démarrage de l'API.

# 4. Installer les dépendances
cd api && npm ci
cd ../web && npm ci
cd ..
```

Le déploiement (Vercel + Render + Neon) est décrit dans
[`docs/deploiement.md`](./docs/deploiement.md).

## OpenCode (agent de code)

Le projet est développé avec [OpenCode](https://opencode.ai), un agent de code en terminal. Installation :

```bash
# Avec npm (Node.js déjà installé)
npm i -g opencode-ai@latest

# Ou sur macOS / Linux avec Homebrew
brew install opencode

# Ou avec le script d'installation
curl -fsSL https://opencode.ai/install | bash
```

Sous Windows, utilise la commande npm ci-dessus (ou `scoop bucket add extras; scoop install extras/opencode`).

Vérifier l'installation, puis le lancer à la racine du projet :

```bash
opencode --version
cd gamebacklog
opencode
```

### Extension VsCode et utilisation de base.

Installer l'extension VsCode [OpenCode](https://marketplace.visualstudio.com/items?itemName=sst-dev.opencode)

Une fois installé, un onglet devrait apparaitre en haut à droite de la fenêtre de développement, -la.
Une fois ouverte, tape `/` suivi d'une commande. Tape `/` seul pour voir la liste.
 
| Commande | À quoi ça sert |
|---|---|
| `/connect` | Ajouter un fournisseur de modèle IA et saisir sa clé API (à faire une seule fois) |
| `/models` | Choisir le modèle utilisé |
| `/init` | Créer ou mettre à jour le fichier `AGENTS.md` (les règles du projet pour l'agent) |
| `/new` | Démarrer une nouvelle conversation (une par tâche) |
| `/sessions` | Retrouver une ancienne conversation |
| `/undo` | Annuler le dernier message et les modifications de fichiers qu'il a faites |
| `/redo` | Rétablir ce qui vient d'être annulé |
| `/help` | Afficher l'aide |
| `/exit` | Quitter OpenCode |
 
`/undo` et `/redo` utilisent Git : le projet doit être un dépôt Git.
 
Raccourcis utiles :
 
- `@` suivi d'un nom de fichier pour le donner en référence à l'agent (ex. `@api/src/main.ts`)
- `Tab` pour passer du mode **build** (l'agent peut modifier les fichiers) au mode **plan** (lecture seule, pour analyser ou planifier)
Premier lancement : `/connect`, choisis un fournisseur, colle ta clé, puis `/models` pour sélectionner un modèle.


## Configuration

Ouvre `.env` et renseigne :

| Variable | Valeur |
|---|---|
| `STEAM_API_KEY` | Clé Steam Web API |
| `EMBEDDING_API_KEY` | Clé du fournisseur d'embeddings |
| `SESSION_SECRET` | Chaîne aléatoire (voir ci-dessous) |

Les autres variables ont déjà une valeur par défaut pour le développement local.

Générer `SESSION_SECRET` :

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Lancement

Dans deux terminaux :

```bash
# API : http://localhost:3000
cd api && npm run start:dev
```

```bash
# Front : http://localhost:5173
cd web && npm run dev
```

Pour utiliser l'application, il faut un compte Steam dont les **détails des jeux sont publics**.