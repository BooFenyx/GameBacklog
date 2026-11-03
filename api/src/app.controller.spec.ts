import { Test, TestingModule } from '@nestjs/testing';
import { ServiceUnavailableException } from '@nestjs/common';
import { vi } from 'vitest';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { DB } from './db/db.module.js';

describe('AppController', () => {
  let appController: AppController;
  const query = vi.fn().mockResolvedValue({ rows: [] });

  beforeEach(async () => {
    query.mockClear();
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        AppService,
        { provide: DB, useValue: { $client: { query } } },
      ],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    it('should return "Hello World!"', () => {
      expect(appController.getHello()).toBe('Hello World!');
    });
  });

  describe('health', () => {
    it('vérifie la base et renvoie ok', async () => {
      await expect(appController.health()).resolves.toEqual({ status: 'ok' });
      expect(query).toHaveBeenCalledWith('SELECT 1');
    });

    it('renvoie 503 quand la base est injoignable', async () => {
      query.mockRejectedValueOnce(new Error('connexion perdue'));
      await expect(appController.health()).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
    });
  });
});
