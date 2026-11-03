import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  appelApi,
  ErreurApi,
  EVENEMENT_SESSION_EXPIREE,
  surSessionExpiree,
} from './http'

function reponse(init: {
  ok: boolean
  status: number
  body?: unknown
  headers?: Record<string, string>
}) {
  return {
    ok: init.ok,
    status: init.status,
    headers: { get: (cle: string) => init.headers?.[cle] ?? null },
    json: async () => init.body,
    text: async () =>
      init.body === undefined ? '' : JSON.stringify(init.body),
  }
}

describe('appelApi', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renvoie le JSON quand la réponse est OK', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(reponse({ ok: true, status: 200, body: { a: 1 } }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(appelApi<{ a: number }>('/api/test')).resolves.toEqual({
      a: 1,
    })
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/test',
      expect.objectContaining({ credentials: 'include' }),
    )
  })

  it('traduit une erreur HTTP en ErreurApi avec statut et Retry-After', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        reponse({
          ok: false,
          status: 429,
          body: { message: ['Trop de requêtes'] },
          headers: { 'Retry-After': '12' },
        }),
      ),
    )

    await expect(appelApi('/api/test')).rejects.toMatchObject({
      name: 'ErreurApi',
      statut: 429,
      message: 'Trop de requêtes',
      retryAfterSecondes: 12,
    })
  })

  it('émet l’événement de session expirée sur 401', async () => {
    const dispatchEvent = vi.fn()
    vi.stubGlobal('window', {
      dispatchEvent,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        reponse({
          ok: false,
          status: 401,
          body: { message: 'Session Steam requise' },
        }),
      ),
    )

    await expect(appelApi('/api/test')).rejects.toBeInstanceOf(ErreurApi)
    expect(dispatchEvent).toHaveBeenCalledTimes(1)
    expect(dispatchEvent.mock.calls[0][0]).toBeInstanceOf(Event)
    expect((dispatchEvent.mock.calls[0][0] as Event).type).toBe(
      EVENEMENT_SESSION_EXPIREE,
    )
  })

  it('renvoie undefined sur 204', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(reponse({ ok: true, status: 204 })),
    )

    await expect(appelApi('/api/test', { method: 'POST' })).resolves.toBe(
      undefined,
    )
  })

  it('renvoie null sur un 200 vide quand allowEmpty est demandé', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(reponse({ ok: true, status: 200 })),
    )

    await expect(
      appelApi('/api/sync', { allowEmpty: true }),
    ).resolves.toBeNull()
  })

  it('refuse un 200 vide sans allowEmpty', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(reponse({ ok: true, status: 200 })),
    )

    await expect(appelApi('/api/test')).rejects.toMatchObject({
      name: 'ErreurApi',
      message: 'Réponse vide du serveur.',
    })
  })

  it('convertit un abandon en ErreurApi réseau', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new DOMException('Aborted', 'AbortError')),
    )

    await expect(appelApi('/api/test', { timeoutMs: 1 })).rejects.toMatchObject({
      name: 'ErreurApi',
      statut: 0,
    })
  })
})

describe('surSessionExpiree', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('abonne et désabonne le rappel', () => {
    const addEventListener = vi.fn()
    const removeEventListener = vi.fn()
    vi.stubGlobal('window', { addEventListener, removeEventListener })

    const rappel = vi.fn()
    const off = surSessionExpiree(rappel)
    expect(addEventListener).toHaveBeenCalledWith(
      EVENEMENT_SESSION_EXPIREE,
      rappel,
    )
    off()
    expect(removeEventListener).toHaveBeenCalledWith(
      EVENEMENT_SESSION_EXPIREE,
      rappel,
    )
  })
})
