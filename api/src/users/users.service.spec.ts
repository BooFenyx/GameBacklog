import { Test, TestingModule } from '@nestjs/testing';
import { vi } from 'vitest';
import { DB, type Db } from '../db/db.module.js';
import { users } from '../db/schema.js';
import { UsersService } from './users.service.js';

function fakeDb() {
  const insert = vi.fn();
  const update = vi.fn();
  const values = vi.fn();
  const onConflictDoUpdate = vi.fn();
  const returning = vi.fn();
  const setValues = vi.fn();
  const where = vi.fn();
  const select = vi.fn();
  const from = vi.fn();
  const limit = vi.fn();

  insert.mockReturnValue({ values });
  values.mockReturnValue({ onConflictDoUpdate });
  onConflictDoUpdate.mockReturnValue({ returning });
  update.mockReturnValue({ set: setValues });
  setValues.mockReturnValue({ where });
  select.mockReturnValue({ from });
  from.mockReturnValue({ where });
  where.mockReturnValue({ limit });
  limit.mockResolvedValue([]);

  return {
    db: { insert, update, select } as unknown as Db,
    insert,
    values,
    onConflictDoUpdate,
    returning,
    setValues,
    where,
  };
}

describe('UsersService', () => {
  let service: UsersService;

  beforeEach(async () => {
    const fake = fakeDb();
    const module: TestingModule = await Test.createTestingModule({
      providers: [UsersService, { provide: DB, useValue: fake.db }],
    }).compile();
    service = module.get<UsersService>(UsersService);
    // conserve le fake pour les assertions du test en cours
    (service as unknown as { __fake?: unknown }).__fake = fake;
  });

  const faireDbFake = () =>
    (service as unknown as { __fake: ReturnType<typeof fakeDb> }).__fake;

  it('upsert insère le profil avec un statut pending', async () => {
    const { values, onConflictDoUpdate, returning } = faireDbFake();
    returning.mockResolvedValue([{ id: 42 }]);

    const id = await service.upsertFromProfile({
      steamId: '76561199123456789',
      displayName: 'Test Steam',
      avatarUrl: 'https://cdn/avatar.jpg',
    });

    expect(id).toBe(42);
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        steamId: '76561199123456789',
        displayName: 'Test Steam',
        syncStatus: 'pending',
      }),
    );
    expect(onConflictDoUpdate).toHaveBeenCalledWith({
      target: users.steamId,
      set: expect.objectContaining({ displayName: 'Test Steam' }),
    });
    const conflit = onConflictDoUpdate.mock.calls[0][0] as {
      set: Record<string, unknown>;
    };
    expect(conflit.set).not.toHaveProperty('syncStatus');
  });

  it('n’anonyme pas l’avatar : null quand le profil n’en a pas', async () => {
    const { values, returning } = faireDbFake();
    returning.mockResolvedValue([{ id: 1 }]);

    await service.upsertFromProfile({
      steamId: 'x',
      displayName: 'Sans avatar',
      avatarUrl: '',
    });

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({ avatarUrl: null }),
    );
  });

  it('setStatus met à jour le statut et éventuellement lastSyncAt', async () => {
    const { setValues, where } = faireDbFake();
    where.mockResolvedValue(undefined);

    await service.setStatus(7, 'done', { lastSyncAt: new Date('2026-01-01') });

    expect(setValues).toHaveBeenCalledWith({
      syncStatus: 'done',
      lastSyncAt: new Date('2026-01-01'),
    });
  });
});
