/**
 * Évaluation manuelle des embeddings (hors CI).
 *
 * Usage, depuis `api/` :
 *   npm run eval:embeddings            # évalue les embeddings stockés
 *   npm run eval:embeddings:backfill   # réindexe la version courante puis évalue
 *
 * Le script utilise le vrai Gemini (`EMBEDDING_API_KEY`) et la base locale
 * (`DATABASE_URL`). Il ne démarre pas l'API et ne déclenche aucun import.
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EvaluationModule } from '../dist/embedding/evaluation.module.js';
import { DB } from '../dist/db/db.module.js';
import { EmbeddingService } from '../dist/embedding/embedding.service.js';
import { GamesService } from '../dist/games/games.service.js';

const args = process.argv.slice(2);
const backfill = args.includes('--backfill');
const limitArg = args.find((arg) => arg.startsWith('--limit='));
const limite = limitArg ? Number(limitArg.split('=')[1]) : null;

const dossier = dirname(fileURLToPath(import.meta.url));

function log(message) {
  console.log(message);
}

async function reindexer(db, embedding, games) {
  const version = embedding.textVersion;
  const { rows } = await db.$client.query(
    `
      SELECT g.app_id
      FROM games g
      JOIN library_entries le ON le.game_id = g.id
      WHERE g.embedding IS NULL OR g.embedding_text_version < $1
      GROUP BY g.app_id
      ORDER BY g.app_id
    `,
    [version],
  );

  const appIds = limite ? rows.slice(0, limite) : rows;
  log(`Backfill v${version} : ${appIds.length} jeu(x) à réindexer.`);

  let maj = 0;
  let ignores = 0;
  let echecs = 0;

  for (let index = 0; index < appIds.length; index += 1) {
    const appId = appIds[index].app_id;
    const input = await games.embeddingInputFor(appId);
    if (!input) {
      ignores += 1;
      continue;
    }

    try {
      const vecteur = await embedding.embedGame(input, { source: 'import' });
      if (!vecteur) {
        echecs += 1;
        continue;
      }
      await db.$client.query(
        `
          UPDATE games
          SET embedding = $1::vector,
              embedding_model = $2,
              embedding_text_version = $3
          WHERE app_id = $4
        `,
        [JSON.stringify(vecteur), embedding.modelName, version, appId],
      );
      maj += 1;
    } catch (error) {
      if (error?.name === 'QuotaReachedError') {
        log('Quota Gemini atteint : arrêt du backfill, reliquat conservé.');
        break;
      }
      throw error;
    }

    if ((index + 1) % 10 === 0 || index === appIds.length - 1) {
      log(
        `  ${index + 1}/${appIds.length} — ${maj} mis à jour, ${ignores} ignorés, ${echecs} échecs`,
      );
    }
  }

  log(
    `Backfill terminé : ${maj} embeddings v${version}, ${ignores} sans texte, ${echecs} échecs.`,
  );
}

async function evaluer(db, embedding) {
  const fixture = JSON.parse(
    await readFile(join(dossier, 'eval-embeddings.json'), 'utf8'),
  );
  const resultats = [];

  for (const requete of fixture.queries) {
    const vecteur = await embedding.embed(requete.texte, {
      source: 'search',
    });
    if (!vecteur) {
      log(`⚠️  Embedding indisponible pour « ${requete.texte} »`);
      continue;
    }

    const { rows } = await db.$client.query(
      `
        SELECT g.app_id, g.name, 1 - (g.embedding <=> $1::vector) AS score
        FROM games g
        JOIN library_entries le ON le.game_id = g.id
        WHERE g.embedding IS NOT NULL
        GROUP BY g.app_id, g.name, g.embedding
        ORDER BY g.embedding <=> $1::vector
        LIMIT 10
      `,
      [JSON.stringify(vecteur)],
    );

    const attendus = new Set(requete.attendus);
    const { rows: lignesPresents } = await db.$client.query(
      `
        SELECT DISTINCT g.app_id
        FROM games g
        JOIN library_entries le ON le.game_id = g.id
        WHERE g.app_id = ANY($1::int[])
      `,
      [[...attendus]],
    );
    const attendusPresents = lignesPresents.map((row) => row.app_id);

    const precision = (k) => {
      if (attendusPresents.length === 0) return 0;
      const topK = rows.slice(0, k).map((row) => row.app_id);
      const trouves = topK.filter((appId) =>
        attendusPresents.includes(appId),
      );
      return trouves.length / attendusPresents.length;
    };

    const rang = rows.findIndex((row) => attendus.has(row.app_id));
    const mrr = rang >= 0 ? 1 / (rang + 1) : 0;

    resultats.push({
      texte: requete.texte,
      p5: precision(5),
      p10: precision(10),
      mrr,
      attendusPresents: attendusPresents.length,
      top: rows.slice(0, 5).map((row) => row.name),
    });
  }

  log('\nÉvaluation des embeddings');
  log('─'.repeat(80));
  for (const resultat of resultats) {
    log(
      `P@5 ${resultat.p5.toFixed(2)} · P@10 ${resultat.p10.toFixed(2)} · MRR ${resultat.mrr.toFixed(2)} — ${resultat.texte}`,
    );
    log(`   top 5 : ${resultat.top.join(' | ')}`);
    if (resultat.attendusPresents === 0) {
      log('   ⚠️  aucun jeu attendu présent dans la bibliothèque');
    }
  }

  if (resultats.length > 0) {
    const moyenne = (cle) =>
      resultats.reduce((total, resultat) => total + resultat[cle], 0) /
      resultats.length;
    log('─'.repeat(80));
    log(
      `Moyenne : P@5 ${moyenne('p5').toFixed(3)} · P@10 ${moyenne('p10').toFixed(3)} · MRR ${moyenne('mrr').toFixed(3)}`,
    );
  }
}

const app = await NestFactory.createApplicationContext(EvaluationModule, {
  logger: ['error', 'warn'],
});

try {
  const db = app.get(DB);
  const embedding = app.get(EmbeddingService);
  const games = app.get(GamesService);

  if (backfill) await reindexer(db, embedding, games);
  await evaluer(db, embedding);
} finally {
  await app.close();
}
