import {
  QueryEmbeddingCacheService,
  QUERY_CACHE_MAX_ENTRIES,
  QUERY_CACHE_TTL_MS,
  normalizeQuery,
} from './query-embedding-cache.service.js';

describe('QueryEmbeddingCacheService', () => {
  it('normalise la requête et ne calcule qu’une fois', async () => {
    const service = new QueryEmbeddingCacheService(() => 0);
    const compute = vi.fn().mockResolvedValue([1, 2, 3]);

    const premier = await service.getOrCompute('  The   Witness ', compute);
    const second = await service.getOrCompute('the witness', compute);

    expect(premier).toEqual([1, 2, 3]);
    expect(second).toEqual([1, 2, 3]);
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it('ne met pas en cache un échec transient (null)', async () => {
    const service = new QueryEmbeddingCacheService(() => 0);
    const compute = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce([1]);

    expect(await service.getOrCompute('portal', compute)).toBeNull();
    expect(await service.getOrCompute('portal', compute)).toEqual([1]);
    expect(compute).toHaveBeenCalledTimes(2);
  });

  it('déduplique deux appels concurrents identiques', async () => {
    const service = new QueryEmbeddingCacheService(() => 0);
    let resoudre!: (vector: number[] | null) => void;
    const compute = vi.fn(
      () =>
        new Promise<number[] | null>((resolve) => {
          resoudre = resolve;
        }),
    );

    const premier = service.getOrCompute('portal 2', compute);
    const second = service.getOrCompute('PORTAL 2', compute);
    expect(compute).toHaveBeenCalledTimes(1);

    resoudre([4, 5]);
    await expect(premier).resolves.toEqual([4, 5]);
    await expect(second).resolves.toEqual([4, 5]);
  });

  it('expire une entrée après le TTL', async () => {
    let maintenant = 0;
    const service = new QueryEmbeddingCacheService(() => maintenant);
    const compute = vi
      .fn()
      .mockResolvedValueOnce([1])
      .mockResolvedValueOnce([2]);

    await service.getOrCompute('portal', compute);
    maintenant = QUERY_CACHE_TTL_MS - 1;
    await service.getOrCompute('portal', compute);
    expect(compute).toHaveBeenCalledTimes(1);

    maintenant = QUERY_CACHE_TTL_MS;
    const apresExpiration = await service.getOrCompute('portal', compute);
    expect(apresExpiration).toEqual([2]);
    expect(compute).toHaveBeenCalledTimes(2);
  });

  it('évince l’entrée la plus ancienne quand le cache est plein', async () => {
    const service = new QueryEmbeddingCacheService(() => 0);
    let appels = 0;
    const compute = vi.fn(async () => {
      appels += 1;
      return [appels];
    });

    for (let i = 0; i < QUERY_CACHE_MAX_ENTRIES; i += 1) {
      await service.getOrCompute(`requête ${i}`, compute);
    }
    await service.getOrCompute('requête supplémentaire', compute);
    expect(compute).toHaveBeenCalledTimes(QUERY_CACHE_MAX_ENTRIES + 1);

    // La première clé a été évincée : elle est recalculée.
    await service.getOrCompute('requête 0', compute);
    expect(compute).toHaveBeenCalledTimes(QUERY_CACHE_MAX_ENTRIES + 2);
  });
});

describe('normalizeQuery', () => {
  it('trim, minuscules et espaces compactés', () => {
    expect(normalizeQuery('  The   Witcher 3 ')).toBe('the witcher 3');
  });
});
