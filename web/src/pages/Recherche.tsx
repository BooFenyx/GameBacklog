import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import CarteResultat from '../components/CarteResultat'
import VedetteResultat from '../components/VedetteResultat'
import {
  ErreurRecherche,
  LIBELLE_MODE,
  rechercherJeux,
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

function ResultatsRecherche({ q, mode }: PropsResultats) {
  const [resultats, setResultats] = useState<ResultatRecherche[]>([])
  const [total, setTotal] = useState(0)
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
          {
            q,
            mode,
            limit: LIMITE,
            offset: 0,
          },
          controller.signal,
        )
        if (!actif) return
        setResultats(reponse.results)
        setTotal(reponse.total)
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
  }, [q, mode, reessai])

  const afficherPlus = async () => {
    if (!q || chargementPlus || !hasMore) return

    plusController.current?.abort()
    const controller = new AbortController()
    plusController.current = controller
    setChargementPlus(true)
    setErreur(null)

    try {
      const reponse = await rechercherJeux(
        {
          q,
          mode,
          limit: LIMITE,
          offset: prochainOffset,
        },
        controller.signal,
      )
      if (controller.signal.aborted) return
      setResultats((actuels) => [...actuels, ...reponse.results])
      setTotal(reponse.total)
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
    setTotal(0)
    setHasMore(false)
    setDegrade(null)
    setProchainOffset(0)
    setChargement(true)
    setChargementPlus(false)
    setReessai((valeur) => valeur + 1)
  }

  return (
    <>
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
              {total} résultat{total > 1 ? 's' : ''} trouvé
              {total > 1 ? 's' : ''}
            </p>
            <VedetteResultat resultat={resultats[0]} />

            {resultats.length > 1 && (
              <>
                <h2 className="resultats-titre">Aussi dans tes résultats</h2>
                <div className="resultats">
                  {resultats.slice(1).map((resultat) => (
                    <CarteResultat key={resultat.appId} resultat={resultat} />
                  ))}
                </div>
              </>
            )}
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
    </>
  )
}

/**
 * `/recherche` — lit `q` et `mode` dans l'URL. La clé de `ResultatsRecherche`
 * remonte le composant à chaque changement, ce qui remet l'état à zéro sans
 * effet de synchronisation. Les filtres restent l'affaire de la bibliothèque.
 */
export default function Recherche() {
  const [searchParams] = useSearchParams()
  const q = (searchParams.get('q') ?? '').trim()
  const mode: ModeRecherche =
    searchParams.get('mode') === 'semantic' ? 'semantic' : 'name'

  return (
    <section className="recherche">
      <div className="recherche-tete">
        <div>
          <p className="sur-titre">{LIBELLE_MODE[mode]}</p>
          <h1>{q ? `Résultats pour « ${q} »` : 'Recherche'}</h1>
        </div>
      </div>

      <ResultatsRecherche key={`${q}|${mode}`} q={q} mode={mode} />
    </section>
  )
}
