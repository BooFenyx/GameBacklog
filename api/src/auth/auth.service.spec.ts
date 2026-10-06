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

    it('renvoie le steamId quand Steam valide la signature', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          text: async () =>
            'ns:http://specs.openid.net/auth/2.0\nis_valid:true\n',
        }),
      );

      const steamId = '76561199123456789';
      const result = await makeService().verifySteamCallback({
        'openid.claimed_id': `https://steamcommunity.com/openid/id/${steamId}`,
        'openid.mode': 'id_res',
      });

      expect(result).toBe(steamId);
    });

    it('renvoie null quand Steam invalide la signature', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({ text: async () => 'is_valid:false\n' }),
      );

      const result = await makeService().verifySteamCallback({
        'openid.claimed_id':
          'https://steamcommunity.com/openid/id/76561199123456789',
      });

      expect(result).toBeNull();
    });
  });
});
