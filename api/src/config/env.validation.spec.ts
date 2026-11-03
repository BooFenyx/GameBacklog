import { validateEnv } from './env.validation.js';

const PROD_ENV = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgres://user:pw@host:5432/db',
  SESSION_SECRET: 'un-secret-de-production-suffisamment-long',
  FRONTEND_URL: 'https://app.test',
  STEAM_API_KEY: 'cle-steam',
};

describe('validateEnv', () => {
  it('laisse passer toute configuration hors production', () => {
    const config = { NODE_ENV: 'development', SESSION_SECRET: '' };
    expect(validateEnv(config)).toBe(config);
  });

  it('accepte une configuration de production complète', () => {
    expect(validateEnv({ ...PROD_ENV })).toEqual(PROD_ENV);
  });

  it('refuse une production sans SESSION_SECRET', () => {
    const { SESSION_SECRET: _omis, ...config } = PROD_ENV;
    expect(() => validateEnv(config)).toThrow(/SESSION_SECRET/);
  });

  it('refuse un SESSION_SECRET vide en production', () => {
    expect(() => validateEnv({ ...PROD_ENV, SESSION_SECRET: '   ' })).toThrow(
      /SESSION_SECRET/,
    );
  });

  it('refuse le secret de développement en production', () => {
    expect(() =>
      validateEnv({
        ...PROD_ENV,
        SESSION_SECRET: 'dev-insecure-session-secret',
      }),
    ).toThrow(/développement/);
  });

  it('refuse un SESSION_SECRET trop court en production', () => {
    expect(() =>
      validateEnv({ ...PROD_ENV, SESSION_SECRET: 'trop-court' }),
    ).toThrow(/32 caractères/);
  });

  it('refuse une production sans FRONTEND_URL', () => {
    const { FRONTEND_URL: _omis, ...config } = PROD_ENV;
    expect(() => validateEnv(config)).toThrow(/FRONTEND_URL/);
  });

  it('refuse une production sans DATABASE_URL', () => {
    const { DATABASE_URL: _omis, ...config } = PROD_ENV;
    expect(() => validateEnv(config)).toThrow(/DATABASE_URL/);
  });

  it('refuse une production sans STEAM_API_KEY', () => {
    const { STEAM_API_KEY: _omis, ...config } = PROD_ENV;
    expect(() => validateEnv(config)).toThrow(/STEAM_API_KEY/);
  });
});
