import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import CarteResultatRecherche from '../components/CarteResultatRecherche'
import {
  ErreurRecherche,
  LIBELLE_MODE,
  rechercherJeux,
  type FiltreManette,
  type ModeRecherche,
  type ResultatRecherche,
} from '../search'

const LIMITE = 20

type EtatErreur = {
  message: string
  statut: number | null
  retryAfterSecondes: number | null
}

type PropsResultats = {
  q: string
  mode: ModeRecherche
  manette: FiltreManette | undefined
}

function convertirErreur(error: unknown): EtatErreur {
  if (error instanceof ErreurRecherche) {
    return {
      message: error.message,
      statut: error.statut,
      retryAfterSecondes: error.retryAfterSecondes,
    }
  }
  return {
    message:
      error instanceof Error
        ? error.message
        : 'Impossible de lancer la recherche.',
    statut: null,
    retryAfterSecondes: null,
  }
}

function messageErreur(erreur: EtatErreur): string {
  if (erreur.statut === 429) {
    return erreur.retryAfterSecondes
      ? `Limite de recherche atteinte. Réessaie dans ${erreur.retryAfterSecondes} s.`
      : 'Limite de recherche atteinte. Réessaie dans un instant.'
  }
  if (erreur.statut === 401) {
    return 'Ta session a expiré. Reconnecte-toi avec Steam.'
  }
  return erreur.message
}

function ResultatsRecherche({ q, mode, manette }: PropsResultats) {
  const [, setSearchParams] = useSearchParams()
  const [resultats, setResultats] = useState<ResultatRecherche[]>([])
  const [prochainOffset, setProchainOffset] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [degrade, setDegrade] = useState<string | null>(null)
  const [chargement, setChargement] = useState(q.length > 0)
  const [chargementPlus, setChargementPlus] = useState(false)
  const [erreur, setErreur] = useState<EtatErreur | null>(null)
  const [reessai, setReessai] = useState(0)
  const plusController = useRef<AbortController | null>(null)

  useEffect(() => {
    if (!q) return

    const controller = new AbortController()
    let actif = true

    void (async () => {
      try {
        const reponse = await rechercherJeux(
          { q, mode, manette, limit: LIMITE, offset: 0 },
          controller.signal,
        )
        if (!actif) return
        setResultats(reponse.results)
        setHasMore(reponse.hasMore)
        setProchainOffset(reponse.offset + reponse.results.length)
        setDegrade(reponse.degraded ? (reponse.message ?? null) : null)
      } catch (error) {
        if (!actif || controller.signal.aborted) return
        setErreur(convertirErreur(error))
      } finally {
        if (actif) setChargement(false)
      }
    })()

    return () => {
      actif = false
      controller.abort()
      plusController.current?.abort()
    }
  }, [q, mode, manette, reessai])

  const afficherPlus = async () => {
    if (!q || chargementPlus || !hasMore) return

    plusController.current?.abort()
    const controller = new AbortController()
    plusController.current = controller
    setChargementPlus(true)
    setErreur(null)

    try {
      const reponse = await rechercherJeux(
        { q, mode, manette, limit: LIMITE, offset: prochainOffset },
        controller.signal,
      )
      if (controller.signal.aborted) return
      setResultats((actuels) => [...actuels, ...reponse.results])
      setHasMore(reponse.hasMore)
      setProchainOffset(reponse.offset + reponse.results.length)
      if (reponse.degraded) setDegrade(reponse.message ?? null)
    } catch (error) {
      if (controller.signal.aborted) return
      setErreur(convertirErreur(error))
    } finally {
      if (!controller.signal.aborted) setChargementPlus(false)
    }
  }

  const reessayer = () => {
    setErreur(null)
    setResultats([])
    setHasMore(false)
    setDegrade(null)
    setProchainOffset(0)
    setChargement(true)
    setChargementPlus(false)
    setReessai((valeur) => valeur + 1)
  }

  const changerManette = (valeur: string) => {
    const params = new URLSearchParams({ q, mode })
    if (valeur === 'full' || valeur === 'partial') {
      params.set('manette', valeur)
    }
    setSearchParams(params)
  }

  return (
    <section className="recherche">
      <div className="recherche-tete">
        <div>
          <p className="sur-titre">{LIBELLE_MODE[mode]}</p>
          <h1>{q ? `Résultats pour « ${q} »` : 'Recherche'}</h1>
        </div>
        <label className="recherche-filtre">
          Manette
          <select
            value={manette ?? ''}
            onChange={(event) => changerManette(event.target.value)}
            disabled={!q}
          >
            <option value="">Toutes</option>
            <option value="full">Complète</option>
            <option value="partial">Partielle ou complète</option>
          </select>
        </label>
      </div>

      {degrade && (
        <p className="recherche-degrade" role="status">
          {degrade}
        </p>
      )}

      {erreur && (
        <div className="recherche-erreur" role="alert">
          <p className="message-erreur">{messageErreur(erreur)}</p>
          <button type="button" className="btn" onClick={reessayer}>
            Réessayer
          </button>
        </div>
      )}

      {!q ? (
        <p className="recherche-vide">
          Saisis un nom de jeu ou une description dans la barre de recherche.
        </p>
      ) : chargement ? (
        <p className="chargement">Recherche en cours…</p>
      ) : resultats.length === 0 && !erreur ? (
        <p className="recherche-vide">
          Aucun jeu de ta bibliothèque ne correspond à cette recherche.
        </p>
      ) : (
        resultats.length > 0 && (
          <>
            <p className="recherche-compte">
              {resultats.length} résultat{resultats.length > 1 ? 's' : ''}{' '}
              affiché{resultats.length > 1 ? 's' : ''}
            </p>
            <div className="resultats">
              {resultats.map((resultat) => (
                <CarteResultatRecherche
                  key={resultat.appId}
                  resultat={resultat}
                />
              ))}
            </div>
            {hasMore && (
              <div className="recherche-plus">
                <button
                  type="button"
                  className="btn"
                  disabled={chargementPlus}
                  onClick={() => void afficherPlus()}
                >
                  {chargementPlus
                    ? 'Chargement…'
                    : 'Afficher plus de résultats'}
                </button>
              </div>
            )}
          </>
        )
      )}
    </section>
  )
}

/**
 * `/recherche` — lit `q`, `mode` et `manette` dans l'URL. La clé de
 * `ResultatsRecherche` remonte le composant à chaque changement, ce qui remet
 * l'état à zéro sans effet de synchronisation.
 */
export default function Recherche() {
  const [searchParams] = useSearchParams()
  const q = (searchParams.get('q') ?? '').trim()
  const modeParam = searchParams.get('mode')
  const mode: ModeRecherche = modeParam === 'semantic' ? 'semantic' : 'name'
  const manetteParam = searchParams.get('manette')
  const manette: FiltreManette | undefined =
    manetteParam === 'full' || manetteParam === 'partial'
      ? manetteParam
      : undefined

  return (
    <ResultatsRecherche
      key={`${q}|${mode}|${manette ?? ''}`}
      q={q}
      mode={mode}
      manette={manette}
    />
  )
}
