import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ErreurFiche,
  chargerFicheJeu,
  chargerSuccesJeu,
} from './games'

describe('chargerFicheJeu', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renvoie la fiche JSON', async () => {
    const fiche = { appId: 620, name: 'Portal 2' }
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => fiche,
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(chargerFicheJeu(620)).resolves.toEqual(fiche)
    expect(fetchMock).toHaveBeenCalledWith('/api/games/620', {
      credentials: 'include',
      signal: undefined,
    })
  })

  it('traduit un 404 en ErreurFiche', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({ message: 'Jeu introuvable' }),
      }),
    )

    await expect(chargerFicheJeu(620)).rejects.toMatchObject({
      name: 'ErreurFiche',
      statut: 404,
      message: 'Jeu introuvable',
    })
    await expect(chargerFicheJeu(620)).rejects.toBeInstanceOf(ErreurFiche)
  })

  it('joint un tableau de messages de validation', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({ message: ['appId doit être un nombre'] }),
      }),
    )

    await expect(chargerFicheJeu('abc')).rejects.toMatchObject({
      statut: 400,
      message: 'appId doit être un nombre',
    })
  })
})

describe('chargerSuccesJeu', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('appelle l’endpoint dédié et renvoie les succès', async () => {
    const detail = {
      total: 51,
      unlocked: 12,
      list: [],
    }
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => detail,
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(chargerSuccesJeu(620)).resolves.toEqual(detail)
    expect(fetchMock).toHaveBeenCalledWith('/api/games/620/achievements', {
      credentials: 'include',
      signal: undefined,
    })
  })
})
