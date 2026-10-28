import { describe, expect, it } from 'vitest'
import {
  FILTRES_VIDES,
  compterFiltresActifs,
  ecrireFiltres,
  lireFiltres,
} from './filters'

describe('filtres — URL', () => {
  it('relit ce qui a été écrit', () => {
    const filtres = {
      ...FILTRES_VIDES,
      q: 'portal',
      genres: [25, 1],
      modes: ['coop' as const],
      manette: 'full' as const,
      etat: 'jamais' as const,
      duree: ['2-10' as const],
      tri: 'temps' as const,
    }

    const params = ecrireFiltres(filtres, { avecTri: true })
    expect(lireFiltres(params, { avecTri: true })).toEqual(filtres)
  })

  it('omet les valeurs par défaut', () => {
    const params = ecrireFiltres(FILTRES_VIDES, { avecTri: true })
    expect(params.toString()).toBe('')
  })

  it('ignore les modes, états et durées inconnus', () => {
    const params = new URLSearchParams(
      'modes=coop,inconnu&etat=parfois&duree=2-10,99&genres=25,abc,-1',
    )

    const filtres = lireFiltres(params)

    expect(filtres.modes).toEqual(['coop'])
    expect(filtres.etat).toBeNull()
    expect(filtres.duree).toEqual(['2-10'])
    expect(filtres.genres).toEqual([25])
  })

  it('dédoublonne les valeurs répétées', () => {
    const params = new URLSearchParams('genres=25,25,1&modes=coop,coop')
    const filtres = lireFiltres(params)
    expect(filtres.genres).toEqual([25, 1])
    expect(filtres.modes).toEqual(['coop'])
  })

  it('force le tri par défaut quand la valeur est inconnue', () => {
    expect(lireFiltres(new URLSearchParams('tri=aleatoire')).tri).toBe('nom')
  })

  it('compte les groupes de filtres actifs, pas le texte ni le tri', () => {
    expect(compterFiltresActifs(FILTRES_VIDES)).toBe(0)
    expect(
      compterFiltresActifs({
        ...FILTRES_VIDES,
        q: 'portal',
        genres: [25],
        modes: ['coop'],
        tri: 'temps',
      }),
    ).toBe(2)
  })
})
