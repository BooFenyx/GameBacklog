import type request from 'supertest';

/**
 * Ouvre une session de test en suivant le vrai flux OpenID : on appelle
 * d'abord `/api/auth/steam` pour obtenir le `state` et le cookie de session,
 * puis on rejoue le callback avec ce `state` et le `return_to` signé.
 *
 * Les e2e ne doivent pas appeler directement `/api/auth/steam/return` : le
 * contrôleur exige le jeton anti-CSRF stocké en session.
 */
export async function ouvrirSessionTest(
  agent: ReturnType<typeof request.agent>,
  frontendUrl: string,
  steamId: string,
): Promise<request.Response> {
  const login = await agent.get('/api/auth/steam').redirects(0).expect(302);
  const returnTo = new URL(login.headers.location as string).searchParams.get(
    'openid.return_to',
  );
  if (!returnTo) {
    throw new Error('return_to absent de la redirection Steam');
  }
  const state = new URL(returnTo).searchParams.get('state') ?? '';
  if (!state) {
    throw new Error('state OpenID absent de la redirection Steam');
  }

  const query = new URLSearchParams({
    'openid.ns': 'http://specs.openid.net/auth/2.0',
    'openid.mode': 'id_res',
    'openid.claimed_id': `https://steamcommunity.com/openid/id/${steamId}`,
    'openid.identity': `https://steamcommunity.com/openid/id/${steamId}`,
    'openid.return_to': returnTo,
    'openid.realm': frontendUrl,
    state,
  });

  return await agent
    .get(`/api/auth/steam/return?${query.toString()}`)
    .redirects(0);
}
