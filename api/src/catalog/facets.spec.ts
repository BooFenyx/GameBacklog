import { agregerFacettes, type FacetRow } from './facets.js';

function ligne(overrides: Partial<FacetRow> = {}): FacetRow {
  return {
    genreIds: [1],
    genres: ['Action'],
    categoryIds: [2],
    controllerSupport: 'none',
    playtimeForever: 120,
    lastActivityAt: null,
    ...overrides,
  };
}

describe('agregerFacettes', () => {
  it('signale une activité disponible dès qu’une ligne en porte une', () => {
    const facettes = agregerFacettes([
      ligne(),
      ligne({ lastActivityAt: new Date('2024-06-01T12:00:00.000Z') }),
    ]);

    expect(facettes.lastActivityDisponible).toBe(true);
  });

  it('signale l’absence d’activité quand toutes les lignes sont à null', () => {
    const facettes = agregerFacettes([ligne(), ligne()]);

    expect(facettes.lastActivityDisponible).toBe(false);
  });
});
