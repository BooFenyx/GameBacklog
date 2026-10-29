import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import BarreFiltres from '../components/filtres/BarreFiltres'
import CarteResultatRecherche from '../components/CarteResultatRecherche'
import {
  cleFiltres,
  ecrireFiltres,
  lireFiltres,
  type Filtres,
} from '../filters'
import { chargerFacettes, type Facettes } from '../library'
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
  filtres: Filtres
  onTotal: (total: number) => void
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

function ResultatsRecherche({
  q,
  mode,
  filtres,
  onTotal,
}: PropsResultats) {
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
            genres: filtres.genres,
            modes: filtres.modes,
            manette: filtres.manette ?? undefined,
            etat: filtres.etat ?? undefined,
            duree: filtres.duree,
            limit: LIMITE,
            offset: 0,
          },
          controller.signal,
        )
        if (!actif) return
        setResultats(reponse.results)
        setTotal(reponse.total)
        onTotal(reponse.total)
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
  }, [q, mode, filtres, reessai, onTotal])

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
          genres: filtres.genres,
          modes: filtres.modes,
          manette: filtres.manette ?? undefined,
          etat: filtres.etat ?? undefined,
          duree: filtres.duree,
          limit: LIMITE,
          offset: prochainOffset,
        },
        controller.signal,
      )
      if (controller.signal.aborted) return
      setResultats((actuels) => [...actuels, ...reponse.results])
      setTotal(reponse.total)
      onTotal(reponse.total)
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
    onTotal(0)
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
              {total} résultat{total > 1 ? 's' : ''} affiché
              {total > 1 ? 's' : ''}
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
    </>
  )
}

/**
 * `/recherche` — lit `q`, `mode` et les filtres dans l'URL. La clé de
 * `ResultatsRecherche` remonte le composant à chaque changement, ce qui remet
 * l'état à zéro sans effet de synchronisation.
 */
export default function Recherche() {
  const [searchParams, setSearchParams] = useSearchParams()
  const filtres = useMemo(
    () => lireFiltres(searchParams, { avecTri: false }),
    [searchParams],
  )
  const q = filtres.q
  const mode: ModeRecherche =
    searchParams.get('mode') === 'semantic' ? 'semantic' : 'name'

  const [facettes, setFacettes] = useState<Facettes | null>(null)
  const [total, setTotal] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    void chargerFacettes(controller.signal)
      .then((reponse) => {
        if (!controller.signal.aborted) setFacettes(reponse)
      })
      .catch(() => {
        // Le panneau affichera « Chargement des genres… » ; la recherche reste
        // utilisable sans facettes.
      })
    return () => controller.abort()
  }, [])

  const changerFiltres = useCallback(
    (suivants: Filtres, remplacer = false) => {
      const params = ecrireFiltres(suivants, { avecTri: false })
      params.set('mode', mode)
      setSearchParams(params, { replace: remplacer })
      setTotal(0)
      if (!remplacer) window.scrollTo({ top: 0 })
    },
    [mode, setSearchParams],
  )

  const effacerFiltres = useCallback(() => {
    const params = new URLSearchParams({ mode })
    setSearchParams(params, { replace: false })
    setTotal(0)
    window.scrollTo({ top: 0 })
  }, [mode, setSearchParams])
  return (
    <section className="recherche">
      <div className="recherche-tete">
        <div>
          <p className="sur-titre">{LIBELLE_MODE[mode]}</p>
          <h1>{q ? `Résultats pour « ${q} »` : 'Recherche'}</h1>
        </div>
      </div>

      <BarreFiltres
        filtres={filtres}
        facettes={facettes}
        total={total}
        chargement={false}
        avecTri={false}
        afficherCompte={false}
        maxLength={300}
        onChanger={changerFiltres}
        onEffacer={effacerFiltres}
      />

      <ResultatsRecherche
        key={`${q}|${mode}|${cleFiltres(filtres)}`}
        q={q}
        mode={mode}
        filtres={filtres}
        onTotal={setTotal}
      />
    </section>
  )
}
