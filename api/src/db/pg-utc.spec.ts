import { types } from 'pg';
import { describe, expect, it } from 'vitest';
import { enregistrerParseurUtc, parseTimestampUtc } from './pg-utc.js';

describe('parseTimestampUtc', () => {
  it('lit un timestamp sans fuseau comme un instant UTC', () => {
    expect(parseTimestampUtc('2024-06-04 21:01:28')).toEqual(
      new Date('2024-06-04T21:01:28.000Z'),
    );
  });

  it('accepte les secondes fractionnaires', () => {
    expect(parseTimestampUtc('2024-01-15 23:30:00.500')).toEqual(
      new Date('2024-01-15T23:30:00.500Z'),
    );
  });
});

describe('enregistrerParseurUtc', () => {
  it('remplace le parseur de l’OID 1114', () => {
    enregistrerParseurUtc();
    expect(types.getTypeParser(1114)('2024-06-04 21:01:28')).toEqual(
      new Date('2024-06-04T21:01:28.000Z'),
    );
  });
});
