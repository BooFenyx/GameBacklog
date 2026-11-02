import type { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service.js';

function makeService(env: Record<string, string> = {}): AuthService {
  const config = {
    get: (key: string) => env[key],
  } as unknown as ConfigService;
  return new AuthService(config);
}

describe('AuthService', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('buildSteamLoginUrl', () => {
    it("cible l'endpoint OpenID de Steam avec les bons paramètres", () => {
      const url = makeService().buildSteamLoginUrl(
        'https://app.test/api/auth/steam/return',
        'https://app.test',
      );

      expect(url).toContain('https://steamcommunity.com/openid/login?');
      const params = new URL(url).searchParams;
      expect(params.get('openid.mode')).toBe('checkid_setup');
      expect(params.get('openid.ns')).toBe('http://specs.openid.net/auth/2.0');
      expect(params.get('openid.return_to')).toBe(
        'https://app.test/api/auth/steam/return',
      );
      expect(params.get('openid.realm')).toBe('https://app.test');
    });
  });

  describe('verifySteamCallback', () => {
    it('rejette une réponse sans claimed_id', async () => {
      await expect(makeService().verifySteamCallback({})).resolves.toBeNull();
    });

    const steamId = '76561199123456789';
    const endpoint = 'https://steamcommunity.com/openid/login';

    function assertion(
      overrides: Record<string, unknown> = {},
    ): Record<string, unknown> {
      const claimedId = `https://steamcommunity.com/openid/id/${steamId}`;
      return {
        'openid.mode': 'id_res',
        'openid.claimed_id': claimedId,
        'openid.identity': claimedId,
        'openid.op_endpoint': endpoint,
        ...overrides,
      };
    }

    it('renvoie le steamId quand Steam valide la signature', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          text: async () =>
            'ns:http://specs.openid.net/auth/2.0\nis_valid:true\n',
        }),
      );

      await expect(
        makeService().verifySteamCallback(assertion()),
      ).resolves.toBe(steamId);
    });

    it('accepte un claimed_id en http comme en https', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          text: async () =>
            'ns:http://specs.openid.net/auth/2.0\nis_valid:true\n',
        }),
      );

      const httpId = `http://steamcommunity.com/openid/id/${steamId}`;
      await expect(
        makeService().verifySteamCallback(
          assertion({
            'openid.claimed_id': httpId,
            'openid.identity': httpId,
          }),
        ),
      ).resolves.toBe(steamId);
    });

    it('renvoie null quand Steam invalide la signature', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({ text: async () => 'is_valid:false\n' }),
      );

      const result = await makeService().verifySteamCallback(assertion());

      expect(result).toBeNull();
    });

    it('ignore un is_valid:true injecté dans un autre champ', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          text: async () => 'is_valid:false\nx: is_valid:true\n',
        }),
      );

      await expect(
        makeService().verifySteamCallback(assertion()),
      ).resolves.toBeNull();
    });

    it('rejette un hôte ou un op_endpoint hors Steam', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        text: async () => 'is_valid:true\n',
      });
      vi.stubGlobal('fetch', fetchMock);

      await expect(
        makeService().verifySteamCallback(
          assertion({
            'openid.claimed_id': `https://evil.example/openid/id/${steamId}`,
            'openid.identity': `https://evil.example/openid/id/${steamId}`,
          }),
        ),
      ).resolves.toBeNull();
      await expect(
        makeService().verifySteamCallback(
          assertion({ 'openid.op_endpoint': 'https://evil.example/login' }),
        ),
      ).resolves.toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('rejette un invalidate_handle ou une identity divergente', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        text: async () => 'is_valid:true\n',
      });
      vi.stubGlobal('fetch', fetchMock);

      await expect(
        makeService().verifySteamCallback(
          assertion({ 'openid.invalidate_handle': 'x' }),
        ),
      ).resolves.toBeNull();
      await expect(
        makeService().verifySteamCallback(
          assertion({
            'openid.identity': `https://steamcommunity.com/openid/id/76561199000000000`,
          }),
        ),
      ).resolves.toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
