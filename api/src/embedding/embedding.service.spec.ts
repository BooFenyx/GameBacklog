import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { vi } from 'vitest';
import { EmbeddingService } from './embedding.service.js';
import { QuotaReachedError, RateLimitService } from './rate-limiter.service.js';

describe('EmbeddingService', () => {
  let service: EmbeddingService;

  const mockConfigService = {
    get: vi.fn(),
  };

  const mockRateLimitService = {
    acquire: vi.fn().mockResolvedValue('ok'),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmbeddingService,
        { provide: ConfigService, useValue: mockConfigService },
        { provide: RateLimitService, useValue: mockRateLimitService },
      ],
    }).compile();

    service = module.get<EmbeddingService>(EmbeddingService);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('buildText', () => {
    it('devrait construire le texte avec le nom seul', () => {
      const result = service.buildText({ name: 'The Witcher 3' });
      expect(result).toBe('The Witcher 3');
    });

    it('devrait inclure la description si présente', () => {
      const result = service.buildText({
        name: 'The Witcher 3',
        shortDescription: 'Un RPG en monde ouvert',
      });
      expect(result).toBe('The Witcher 3. Un RPG en monde ouvert');
    });

    it('devrait inclure les genres si présents', () => {
      const result = service.buildText({
        name: 'The Witcher 3',
        genres: ['RPG', 'Action', 'Aventure'],
      });
      expect(result).toBe('The Witcher 3. Genres: RPG, Action, Aventure');
    });

    it('devrait inclure les catégories si présentes', () => {
      const result = service.buildText({
        name: 'The Witcher 3',
        categories: ['Solo', 'Co-op'],
      });
      expect(result).toBe('The Witcher 3. Catégories: Solo, Co-op');
    });

    it('devrait combiner tous les champs', () => {
      const result = service.buildText({
        name: 'The Witcher 3',
        shortDescription: 'Un RPG en monde ouvert',
        genres: ['RPG', 'Action'],
        categories: ['Solo'],
      });
      expect(result).toBe(
        'The Witcher 3. Un RPG en monde ouvert. Genres: RPG, Action. Catégories: Solo',
      );
    });

    it('devrait ignorer les tableaux vides', () => {
      const result = service.buildText({
        name: 'The Witcher 3',
        genres: [],
        categories: [],
      });
      expect(result).toBe('The Witcher 3');
    });

    it('devrait ajouter la description longue après la courte', () => {
      const result = service.buildText({
        name: 'Hades',
        shortDescription: 'Un rogue-like nerveux.',
        longDescription: 'Frayez-vous un chemin hors des Enfers.',
        genres: ['Action'],
      });
      expect(result).toBe(
        'Hades. Un rogue-like nerveux. Frayez-vous un chemin hors des Enfers. Genres: Action',
      );
    });

    it('ne duplique pas une description longue identique à la courte', () => {
      const result = service.buildText({
        name: 'Hades',
        shortDescription: 'Un rogue-like nerveux.',
        longDescription: 'Un rogue-like nerveux.',
      });
      expect(result).toBe('Hades. Un rogue-like nerveux.');
    });

    it('tronque la description longue et normalise les espaces', () => {
      const result = service.buildText({
        name: 'Hades',
        shortDescription: '  Un   rogue-like\n nerveux.  ',
        longDescription: 'a '.repeat(2000),
      });
      expect(result.startsWith('Hades. Un rogue-like nerveux. ')).toBe(true);
      expect(result.length).toBeLessThan(1300);
    });

    it('expose la version du texte indexé', () => {
      expect(service.textVersion).toBe(2);
    });
  });

  describe('embed', () => {
    it('devrait retourner null si EMBEDDING_API_KEY est absente', async () => {
      mockConfigService.get.mockReturnValue(undefined);
      const result = await service.embed('test');
      expect(result).toBeNull();
    });

    it('devrait appeler Gemini avec les bons paramètres', async () => {
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === 'EMBEDDING_API_KEY') return 'test-key';
        if (key === 'EMBEDDING_MODEL') return 'gemini-embedding-001';
        if (key === 'EMBEDDING_DIMENSIONS') return 1024;
        return undefined;
      });

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          embedding: { values: [0.1, 0.2, 0.3] },
        }),
      });
      global.fetch = mockFetch;

      const result = await service.embed('test text');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('generativelanguage.googleapis.com'),
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'models/gemini-embedding-001',
            content: { parts: [{ text: 'test text' }] },
            outputDimensionality: 1024,
          }),
        }),
      );
      expect(result).toEqual([0.1, 0.2, 0.3]);
    });

    it('devrait lever QuotaReachedError si Gemini répond 429', async () => {
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === 'EMBEDDING_API_KEY') return 'test-key';
        return undefined;
      });

      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
      });
      global.fetch = mockFetch;

      await expect(service.embed('test')).rejects.toThrow(QuotaReachedError);
    });

    it('devrait lever QuotaReachedError si le quota journalier est épuisé', async () => {
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === 'EMBEDDING_API_KEY') return 'test-key';
        return undefined;
      });
      mockRateLimitService.acquire.mockResolvedValueOnce('quota-journalier');

      await expect(service.embed('test')).rejects.toThrow(QuotaReachedError);
    });

    it('devrait retourner null quand la fenêtre est saturée (busy)', async () => {
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === 'EMBEDDING_API_KEY') return 'test-key';
        return undefined;
      });
      mockRateLimitService.acquire.mockResolvedValueOnce('busy');

      const result = await service.embed('test', { maxWaitMs: 1500 });

      expect(result).toBeNull();
      expect(mockRateLimitService.acquire).toHaveBeenCalledWith(
        1500,
        undefined,
        undefined,
      );
    });

    it('devrait transmettre la source import au limiteur', async () => {
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === 'EMBEDDING_API_KEY') return 'test-key';
        return undefined;
      });

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          embedding: { values: [0.1, 0.2, 0.3] },
        }),
      });
      global.fetch = mockFetch;

      await service.embed('test', { source: 'import' });

      expect(mockRateLimitService.acquire).toHaveBeenCalledWith(
        undefined,
        'import',
        undefined,
      );
    });

    it("devrait retourner null si l'embedding est vide", async () => {
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === 'EMBEDDING_API_KEY') return 'test-key';
        return undefined;
      });

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({}),
      });
      global.fetch = mockFetch;

      const result = await service.embed('test');
      expect(result).toBeNull();
    });

    it("devrait retourner null en cas d'erreur réseau", async () => {
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === 'EMBEDDING_API_KEY') return 'test-key';
        return undefined;
      });

      const mockFetch = vi.fn().mockRejectedValue(new Error('Network error'));
      global.fetch = mockFetch;

      const result = await service.embed('test');
      expect(result).toBeNull();
    });
  });

  describe('embedGame', () => {
    it('devrait construire le texte et appeler embed', async () => {
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === 'EMBEDDING_API_KEY') return 'test-key';
        return undefined;
      });

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          embedding: { values: [0.1, 0.2, 0.3] },
        }),
      });
      global.fetch = mockFetch;

      const result = await service.embedGame({
        name: 'The Witcher 3',
        shortDescription: 'Un RPG en monde ouvert',
        genres: ['RPG'],
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('generativelanguage.googleapis.com'),
        expect.objectContaining({
          body: expect.stringContaining('The Witcher 3'),
        }),
      );
      expect(result).toEqual([0.1, 0.2, 0.3]);
    });
  });
});
