import { describe, expect, it, vi } from 'vitest';
import {
  traiterSuccesParLots,
  type JeuSucces,
} from './achievements-batch.js';

function creerPool(taille: number): JeuSucces[] {
  return Array.from({ length: taille }, (_, index) => ({
    gameId: index + 1,
    appId: 940000 + index,
  }));
}

function selectionneur(pool: JeuSucces[]) {
  return async (dejaTentes: number[], limite: number): Promise<JeuSucces[]> =>
    pool
      .filter((jeu) => !dejaTentes.includes(jeu.gameId))
      .slice(0, limite);
}

describe('traiterSuccesParLots', () => {
  it('traite 250 jeux en deux lots sans plafond à 200', async () => {
    const pool = creerPool(250);
    const selectionner = vi.fn(selectionneur(pool));
    const traiter = vi.fn(async () => {});
    const progressions: number[] = [];

    const resultat = await traiterSuccesParLots({
      total: 250,
      batchSize: 200,
      selectionner,
      traiter,
      onProgression: (processed) => progressions.push(processed),
    });

    expect(selectionner).toHaveBeenCalledTimes(2);
    expect(traiter).toHaveBeenCalledTimes(250);
    expect(resultat).toEqual({ processed: 250, reussis: 250, paused: false });
    expect(progressions.at(-1)).toBe(250);
  });

  it('traite 500 jeux en trois lots', async () => {
    const pool = creerPool(500);
    const selectionner = vi.fn(selectionneur(pool));
    const traiter = vi.fn(async () => {});

    const resultat = await traiterSuccesParLots({
      total: 500,
      batchSize: 200,
      selectionner,
      traiter,
    });

    expect(selectionner).toHaveBeenCalledTimes(3);
    expect(traiter).toHaveBeenCalledTimes(500);
    expect(resultat).toEqual({ processed: 500, reussis: 500, paused: false });
  });

  it('traite 1 000 jeux en cinq lots', async () => {
    const pool = creerPool(1000);
    const selectionner = vi.fn(selectionneur(pool));
    const traiter = vi.fn(async () => {});

    const resultat = await traiterSuccesParLots({
      total: 1000,
      batchSize: 200,
      selectionner,
      traiter,
    });

    expect(selectionner).toHaveBeenCalledTimes(5);
    expect(traiter).toHaveBeenCalledTimes(1000);
    expect(resultat).toEqual({ processed: 1000, reussis: 1000, paused: false });
  });

  it('ne reprend pas un jeu en échec dans le même run', async () => {
    const pool = creerPool(250);
    const selectionner = vi.fn(selectionneur(pool));
    const traiter = vi.fn(async (jeu: JeuSucces) => {
      if (jeu.gameId === 42) throw new Error('429');
    });
    const echecs: number[] = [];

    const resultat = await traiterSuccesParLots({
      total: 250,
      batchSize: 200,
      selectionner,
      traiter,
      onEchec: (jeu) => echecs.push(jeu.gameId),
    });

    expect(resultat).toEqual({ processed: 250, reussis: 249, paused: false });
    expect(echecs).toEqual([42]);
    expect(
      traiter.mock.calls.filter(([jeu]) => jeu.gameId === 42),
    ).toHaveLength(1);
  });

  it('s’arrête après un lot sans aucun progrès', async () => {
    const pool = creerPool(1000);
    const selectionner = vi.fn(selectionneur(pool));
    const traiter = vi.fn(async () => {
      throw new Error('429');
    });

    const resultat = await traiterSuccesParLots({
      total: 1000,
      batchSize: 200,
      selectionner,
      traiter,
    });

    expect(selectionner).toHaveBeenCalledTimes(1);
    expect(traiter).toHaveBeenCalledTimes(200);
    expect(resultat).toEqual({ processed: 200, reussis: 0, paused: false });
  });

  it('ne sélectionne rien quand aucun jeu ne manque', async () => {
    const selectionner = vi.fn(selectionneur([]));
    const traiter = vi.fn(async () => {});

    const resultat = await traiterSuccesParLots({
      total: 0,
      batchSize: 200,
      selectionner,
      traiter,
    });

    expect(selectionner).not.toHaveBeenCalled();
    expect(traiter).not.toHaveBeenCalled();
    expect(resultat).toEqual({ processed: 0, reussis: 0, paused: false });
  });

  it('met la passe en pause quand le budget est atteint après du progrès', async () => {
    const pool = creerPool(500);
    const selectionner = vi.fn(selectionneur(pool));
    const traiter = vi.fn(async () => {});
    let verifications = 0;

    const resultat = await traiterSuccesParLots({
      total: 500,
      batchSize: 200,
      selectionner,
      traiter,
      doitPause: () => {
        verifications += 1;
        return verifications > 3;
      },
    });

    expect(resultat).toEqual({ processed: 3, reussis: 3, paused: true });
    expect(traiter).toHaveBeenCalledTimes(3);
  });

  it('ne met pas en pause quand le budget est atteint sans progrès', async () => {
    const selectionner = vi.fn(selectionneur(creerPool(10)));
    const traiter = vi.fn(async () => {});

    const resultat = await traiterSuccesParLots({
      total: 10,
      batchSize: 200,
      selectionner,
      traiter,
      doitPause: () => true,
    });

    expect(resultat).toEqual({ processed: 0, reussis: 0, paused: false });
    expect(traiter).not.toHaveBeenCalled();
  });
});
