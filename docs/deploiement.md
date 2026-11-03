# Déploiement — GameBacklog

Runbook de la production : front Vercel, API Render, base Neon PostgreSQL
(pgvector). Aucun secret ne doit être commité ; les variables listées ici vivent
dans les dashboards Render, Vercel et GitHub.

## URLs

| Élément | URL |
|---|---|
| Front | `https://fst-2026-groupe-08.vercel.app` |
| API | `https://fst-2026-groupe-08.onrender.com/api` |
| Santé API | `https://fst-2026-groupe-08.onrender.com/api/health` |

Le front appelle `/api` en relatif ; `web/vercel.json` réécrit ce préfixe vers
l'API Render. Le navigateur reste donc **same-origin** (cookie de session
first-party, `SameSite=Lax`).

## Architecture

```text
Navigateur
  └─ Vercel (SPA React) ── rewrite /api ──► Render (NestJS) ──► Neon (PostgreSQL + pgvector)
                                                   └─► Steam Web API / OpenID
                                                   └─► Google Gemini (embeddings)
```

## Ordre de déploiement

1. **API d'abord** : merge sur `main` → Render redéploie et applique les
   migrations manquantes au démarrage (`DbModule`).
2. Vérifier `GET /api/health` (200) et `GET /api/auth/steam` (302 vers Steam).
3. **Front ensuite** : le workflow GitHub Actions attend une CI verte puis
   déploie l'artefact Vercel.
4. Si l'origine du front change, mettre à jour `FRONTEND_URL` sur Render
   **sans slash final**, puis redéployer l'API.

## Variables Render (dashboard)

| Variable | Valeur |
|---|---|
| `NODE_ENV` | `production` |
| `NODE_VERSION` | `24` |
| `DATABASE_URL` | chaîne Neon **directe** (sans `-pooler`), `sslmode=require` |
| `STEAM_API_KEY` | clé Steam Web API |
| `EMBEDDING_API_KEY` | clé Google Gemini |
| `EMBEDDING_MODEL` | `gemini-embedding-001` |
| `EMBEDDING_DIMENSIONS` | `1024` |
| `SESSION_SECRET` | généré par Render (≥ 32 caractères) |
| `FRONTEND_URL` | `https://fst-2026-groupe-08.vercel.app` (sans slash) |

Optionnels : `EMBEDDING_RATE_LIMIT_PER_MINUTE` (100),
`EMBEDDING_RATE_LIMIT_PER_DAY` (1000),
`EMBEDDING_USER_RATE_LIMIT_PER_DAY` (100),
`AUTH_RATE_LIMIT_PER_MINUTE` (60), `SEARCH_RATE_LIMIT_PER_MINUTE` (20), `SEARCH_NAME_RATE_LIMIT_PER_MINUTE` (120),
`LIBRARY_RATE_LIMIT_PER_MINUTE` (120), `GAMES_RATE_LIMIT_PER_MINUTE` (120),
`HOME_RATE_LIMIT_PER_MINUTE` (180), `SYNC_RATE_LIMIT_PER_MINUTE` (120),
`SYNC_STEP_MAX_MS` (900000), `APPDETAILS_THROTTLE_MS` (1500),
`ACHIEVEMENTS_THROTTLE_MS` (200), `ACHIEVEMENTS_BATCH_SIZE` (200).

Build Render : `npm ci --include=dev && npm run build` (les devDependencies
`@nestjs/cli` et `typescript` sont nécessaires malgré `NODE_ENV=production`).
Start : `npm run start:prod`.

## Vercel

- **Root Directory = `web`** (réglage projet, hors dépôt) : sans lui, la CLI
  lancée depuis la racine du monorepo ne trouve ni `package.json` ni
  `vercel.json`.
- Framework Vite, install `npm ci`, build `npm run build`, output `dist` :
  ces valeurs sont explicites dans `web/vercel.json` depuis le correctif.
- Node 24 est épinglé par `web/package.json` (`"engines": { "node": "24.x" }`).
- `VITE_API_URL` doit rester **vide** : les appels `/api` passent par le
  rewrite same-origin et le cookie reste first-party.
- Domaine de production : `https://fst-2026-groupe-08.vercel.app`. S'il change,
  mettre à jour `web/vercel.json` (rewrite), `deploy.yml` (smoke test) et
  `FRONTEND_URL` sur Render.

## Variables et secrets GitHub

| Secret | Usage |
|---|---|
| `VERCEL_TOKEN` | CLI Vercel |
| `VERCEL_ORG_ID` | projet Vercel |
| `VERCEL_PROJECT_ID` | projet Vercel |
| `VERCEL_DEPLOYER_EMAIL` | email vérifié sur GitHub et lié à Vercel |

Le workflow `deploy.yml` réécrit l'auteur du commit dans le runner
(`git commit --amend --reset-author`) : la CLI Vercel exige que l'auteur de
`HEAD` ait accès au projet, même en déploiement par token. L'amend n'est jamais
poussé.

## Neon

- Utiliser la chaîne **directe** (non-pooler) : le pooler transactionnel est
  incompatible avec le `pg_advisory_lock` de session pris pour les migrations.
- `sslmode=require`.
- Région cohérente avec Render (`oregon`, US West) et Neon (`us-west-2`) pour
  limiter la
  latence API ↔ base.
- La migration `0000` crée `CREATE EXTENSION IF NOT EXISTS vector`. Ne pas la
  retirer.
- Vérifier une restauration de sauvegarde avant une migration de schéma.

## CI/CD

- `ci.yml` : lint, tests unitaires, **e2e avec PostgreSQL/pgvector**, build,
  audit des dépendances de production. Déclenché sur PR et sur `main`.
- `deploy.yml` : déclenché par `workflow_run` de `CI` en `success` sur `main`.
  Il construit puis déploie l'artefact Vercel, et vérifie `/api/health` puis `/`.
- Render redéploie automatiquement sur `main` (`autoDeploy: true`).
- La branche `main` doit être protégée : PR obligatoire, check `CI` requis, pas
  de force-push.

## Vérifications après déploiement

```bash
curl -fsS https://fst-2026-groupe-08.vercel.app/ > /dev/null
curl -fsS https://fst-2026-groupe-08.vercel.app/api/health
curl -sS -o /dev/null -w '%{http_code}\n' https://fst-2026-groupe-08.vercel.app/api/sync   # 401
curl -sS -D - -o /dev/null https://fst-2026-groupe-08.vercel.app/api/auth/steam | grep -i '^location:'
```

Parcours manuel : connexion Steam, retour, cookie, `/api/library`, import
(`/api/sync` progresse), fiche `/jeu/:appId`, recherche nom + sémantique,
`/accueil`, `/confidentialite`.

## Rollback

- **Vercel** : `vercel rollback <url> --token=… --yes`, ou redéployer le commit
  précédent.
- **Render** : dashboard → service → *Rollback* vers le déploiement précédent.
- **Base** : les migrations sont additives ; en cas d'incident, restaurer la
  sauvegarde Neon. Ne jamais supprimer une colonne dans une migration de
  déploiement sans sauvegarde vérifiée.

## Incidents connus

| Symptôme | Cause probable | Action |
|---|---|---|
| Front affiche « L'API ne répond pas encore » | cold start Render free (~50 s) | réessayer, ou passer au plan Starter / keep-alive |
| Toutes les routes `/api` en 404/502 | `web/vercel.json` ne pointe pas vers le service Render réel | aligner `render.yaml`, `vercel.json`, redéployer |
| CORS invalide sur appel direct | `FRONTEND_URL` avec slash final | retirer le slash, redéployer l'API |
| `/api/health` 503 | base Neon injoignable | vérifier `DATABASE_URL`, l'état Neon, les logs Render |
| Recherche sémantique dégradée | quota Gemini atteint | attendre la fenêtre, vérifier `EMBEDDING_USER_RATE_LIMIT_PER_DAY` |
| Import bloqué | job `running` après redémarrage | il est remis en file au boot ; vérifier les logs |
| `SESSION_SECRET` refusé | secret trop court ou secret de dev | générer un secret ≥ 32 caractères |

## Limites assumées

- Render free s'endort après 15 min sans requête et peut interrompre un import.
- Les limiteurs de débit sont en mémoire : mono-instance. Ne pas répliquer
  l'API sans déplacer les compteurs (PostgreSQL/Redis).
- Aucun endpoint de suppression de compte : la suppression se fait sur demande
  auprès de l'administrateur.
