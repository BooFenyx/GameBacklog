import { describe, expect, it } from 'vitest';
import { construireConditions } from './filters.js';

describe('construireConditions', () => {
  it('combine les genres en ET exclusif', () => {
    const params: unknown[] = [];

    const conditions = construireConditions({ genres: [1, 25] }, params);

    expect(conditions).toEqual(['g.genre_ids @> $1::int[]']);
    expect(params).toEqual([[1, 25]]);
  });

  it('combine les modes en ET, avec une condition par mode', () => {
    const params: unknown[] = [];

    const conditions = construireConditions(
      { modes: ['solo', 'coop'] },
      params,
    );

    expect(conditions).toEqual([
      'g.category_ids && $1::int[]',
      'g.category_ids && $2::int[]',
    ]);
    expect(params).toEqual([[2], [9, 38, 39, 48]]);
  });

  it('garde les tranches de durée en OR', () => {
    const conditions = construireConditions(
      { duree: ['0-2', '2-10'] },
      [],
    );

    expect(conditions).toHaveLength(1);
    expect(conditions[0]).toContain(' OR ');
  });
});
