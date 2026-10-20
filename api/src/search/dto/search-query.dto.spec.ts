import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SearchQueryDto, SEARCH_MAX_QUERY_LENGTH } from './search-query.dto.js';

async function valider(entree: Record<string, unknown>) {
  const dto = plainToInstance(SearchQueryDto, entree);
  const erreurs = await validate(dto);
  return { dto, erreurs };
}

describe('SearchQueryDto', () => {
  it('accepte une requête minimale et applique les défauts de pagination', async () => {
    const { dto, erreurs } = await valider({ q: 'portal', mode: 'name' });

    expect(erreurs).toHaveLength(0);
    expect(dto.q).toBe('portal');
    expect(dto.limit).toBe(20);
    expect(dto.offset).toBe(0);
    expect(dto.manette).toBeUndefined();
  });

  it('trime la requête et convertit les paramètres numériques', async () => {
    const { dto, erreurs } = await valider({
      q: '  the witness  ',
      mode: 'semantic',
      manette: 'full',
      limit: '5',
      offset: '10',
    });

    expect(erreurs).toHaveLength(0);
    expect(dto.q).toBe('the witness');
    expect(dto.limit).toBe(5);
    expect(dto.offset).toBe(10);
  });

  it('refuse une requête composée uniquement d’espaces', async () => {
    const { erreurs } = await valider({ q: '   ', mode: 'name' });

    expect(erreurs.some((e) => e.property === 'q')).toBe(true);
  });

  it('refuse une requête trop longue', async () => {
    const { erreurs } = await valider({
      q: 'a'.repeat(SEARCH_MAX_QUERY_LENGTH + 1),
      mode: 'name',
    });

    expect(erreurs.some((e) => e.property === 'q')).toBe(true);
  });

  it('refuse un mode inconnu', async () => {
    const { erreurs } = await valider({ q: 'portal', mode: 'auto' });

    expect(erreurs.some((e) => e.property === 'mode')).toBe(true);
  });

  it('refuse un filtre manette inconnu', async () => {
    const { erreurs } = await valider({
      q: 'portal',
      mode: 'name',
      manette: 'total',
    });

    expect(erreurs.some((e) => e.property === 'manette')).toBe(true);
  });

  it('borne la taille de page et refuse un offset négatif', async () => {
    const tropGrand = await valider({ q: 'portal', mode: 'name', limit: '51' });
    const zero = await valider({ q: 'portal', mode: 'name', limit: '0' });
    const negatif = await valider({ q: 'portal', mode: 'name', offset: '-1' });

    expect(tropGrand.erreurs.some((e) => e.property === 'limit')).toBe(true);
    expect(zero.erreurs.some((e) => e.property === 'limit')).toBe(true);
    expect(negatif.erreurs.some((e) => e.property === 'offset')).toBe(true);
  });

  it('refuse une pagination non numérique', async () => {
    const { erreurs } = await valider({
      q: 'portal',
      mode: 'name',
      limit: 'beaucoup',
    });

    expect(erreurs.some((e) => e.property === 'limit')).toBe(true);
  });
});
