import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import BarreFiltres from '../components/filtres/BarreFiltres'
import {
  cleFiltres,
  ecrireFiltres,
  lireFiltres,
  type Filtres,
} from '../filters'
import { formaterDepuis, formaterDuree } from '../format'
import {
  chargerBibliotheque,
  chargerFacettes,
  type Facettes,
  type JeuBibliotheque,
  type ReponseBibliotheque,
} from '../library'
import {
  estEnCours,
  libelleEtape,
  lireSync,
  relancerSync,
  type JobSync,
} from '../sync'

/** Message d'erreur lisible, avec l'aide dédiée au profil Steam privé. */
function messageErreur(erreur: unknown): string {
  const texte =
    erreur instanceof Error
      ? erreur.message
      : 'Impossible de récupérer la bibliothèque.'
  if (texte.includes('profil privé') || texte.includes('privé')) {
    return 'Ton profil Steam est privé. Rends-le public dans les paramètres Steam pour importer ta bibliothèque.'
  }
  if (texte.includes('quota')) {
    return 'Quota d’embedding atteint (Google Gemini) : l’import reprendra plus tard.'
  }
  return texte
}

/** Informations compactes affichées sous le titre d'une carte. */
function infosJeu(jeu: JeuBibliotheque): string {
  return [
    jeu.playtimeForever === 0
      ? 'Jamais lancé'
      : formaterDuree(jeu.playtimeForever),
    jeu.playtimeLast2Weeks > 0
      ? `${formaterDuree(jeu.playtimeLast2Weeks)} en 2 sem`
      : null,
    jeu.lastPlayedAt ? `joué ${formaterDepuis(jeu.lastPlayedAt)}` : null,
    jeu.genres.length > 0 ? jeu.genres.join(', ') : null,
    jeu.controllerSupport === 'full'
      ? 'manette complète'
      : null,
    jeu.achievementsUnlocked > 0
      ? `${jeu.achievementsUnlocked} succès`
      : null,
  ]
    .filter((valeur): valeur is string => Boolean(valeur))
    .join(' • ')
}

/**
 * Page bibliothèque : liste paginée et filtrable, lue depuis la base.
 *
 * L'URL porte les filtres (`/bibliotheque?genres=25&modes=coop&tri=temps`), ce
 * qui rend la vue partageable et le bouton retour fonctionnel. Les compteurs
 * viennent de `/api/library/facets` ; la liste de `/api/library`.
 */
export default function Bibliotheque() {
  const [searchParams, setSearchParams] = useSearchParams()
  const filtres = useMemo(
    () => lireFiltres(searchParams, { avecTri: true }),
    [searchParams],
  )

  const [facettes, setFacettes] = useState<Facettes | null>(null)
  const [donnees, setDonnees] = useState<{
    cle: string
    page: ReponseBibliotheque
  } | null>(null)
  const [erreurListe, setErreurListe] = useState<{
    cle: string
    message: string
  } | null>(null)
  const [chargementPlus, setChargementPlus] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)
  const [job, setJob] = useState<JobSync | null>(null)
  const [version, setVersion] = useState(0)
  const [relance, setRelance] = useState(0)
  const plusController = useRef<AbortController | null>(null)

  // La clé identifie un couple (filtres, version d'import) : une réponse
  // arrivée pour une autre clé est ignorée à l'affichage, ce qui évite de
  // remettre l'état à zéro de façon synchrone dans l'effet.
  const cleListe = useMemo(
    () => `${cleFiltres(filtres)}|${version}`,
    [filtres, version],
  )
  const page = donnees?.cle === cleListe ? donnees.page : null
  const erreurCourante =
    erreurListe?.cle === cleListe ? erreurListe.message : null
  const chargement = page === null && erreurCourante === null

  // Compteurs des filtres : rechargés au montage et après un import.
  useEffect(() => {
    const controller = new AbortController()
    void chargerFacettes(controller.signal)
      .then((reponse) => {
        if (!controller.signal.aborted) setFacettes(reponse)
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setErreur(
            error instanceof Error
              ? error.message
              : 'Impossible de charger les filtres.',
          )
        }
      })
    return () => controller.abort()
  }, [version])

  // Liste : une requête par changement de filtres ou après un import.
  useEffect(() => {
    const controller = new AbortController()

    void chargerBibliotheque(filtres, 0, controller.signal)
      .then((reponse) => {
        if (controller.signal.aborted) return
        setDonnees({ cle: cleListe, page: reponse })
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setErreurListe({ cle: cleListe, message: messageErreur(error) })
      })

    return () => controller.abort()
  }, [filtres, cleListe])

  // Suivi de l'import : on sonde tant qu'un job tourne, puis on rafraîchit la
  // page et les facettes une seule fois quand il se termine.
  useEffect(() => {
    let actif = true
    let timer: number | undefined
    let aVoirEnCours = false

    const interroger = async (): Promise<void> => {
      try {
        const courant = await lireSync()
        if (!actif) return
        setJob(courant)

        if (estEnCours(courant)) {
          aVoirEnCours = true
          timer = window.setTimeout(() => void interroger(), 2000)
          return
        }

        if (aVoirEnCours) {
          aVoirEnCours = false
          setVersion((valeur) => valeur + 1)
        }
      } catch (error) {
        if (!actif) return
        setErreur(messageErreur(error))
      }
    }

    void interroger()
    return () => {
      actif = false
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [relance])

  useEffect(() => {
    return () => plusController.current?.abort()
  }, [])

  const changerFiltres = useCallback(
    (suivants: Filtres, remplacer = false) => {
      setSearchParams(ecrireFiltres(suivants, { avecTri: true }), {
        replace: remplacer,
      })
      if (!remplacer) window.scrollTo({ top: 0 })
    },
    [setSearchParams],
  )

  const effacerFiltres = useCallback(() => {
    setSearchParams(new URLSearchParams(), { replace: false })
    window.scrollTo({ top: 0 })
  }, [setSearchParams])

  const relancer = async (): Promise<void> => {
    setErreur(null)
    try {
      const courant = await relancerSync()
      setJob(courant)
      setRelance((valeur) => valeur + 1)
    } catch (error) {
      setErreur(messageErreur(error))
    }
  }

  const afficherPlus = async (): Promise<void> => {
    if (!page || chargementPlus || !page.hasMore) return

    plusController.current?.abort()
    const controller = new AbortController()
    plusController.current = controller
    setChargementPlus(true)

    try {
      const suivante = await chargerBibliotheque(
        filtres,
        page.items.length,
        controller.signal,
      )
      if (controller.signal.aborted) return
      setDonnees({
        cle: cleListe,
        page: {
          ...suivante,
          items: [...page.items, ...suivante.items],
        },
      })
    } catch (error) {
      if (!controller.signal.aborted) setErreur(messageErreur(error))
    } finally {
      if (!controller.signal.aborted) setChargementPlus(false)
    }
  }

  const enCours = estEnCours(job)
  const pourcentage =
    enCours && job.totalGames > 0
      ? Math.min(100, Math.round((job.processedGames / job.totalGames) * 100))
      : 0
  const total = page?.total ?? 0
  const jamaisLances =
    facettes?.etats.find((etat) => etat.value === 'jamais')?.count ?? 0
  const aDesFiltres =
    filtres.genres.length > 0 ||
    filtres.modes.length > 0 ||
    filtres.manette !== null ||
    filtres.etat !== null ||
    filtres.duree.length > 0 ||
    filtres.q.length > 0

  return (
    <section className="bibliotheque">
      <div className="bibliotheque-tete">
        <div>
          <h1>Bibliothèque</h1>
          <p className="bibliotheque-resume">
            {facettes
              ? `${facettes.total} jeu${facettes.total > 1 ? 'x' : ''} · ${jamaisLances} jamais lancé${jamaisLances > 1 ? 's' : ''}`
              : 'Chargement de ta bibliothèque…'}
          </p>
        </div>
        <button
          type="button"
          className="btn"
          disabled={enCours}
          onClick={() => void relancer()}
        >
          {enCours ? 'Synchronisation…' : 'Synchroniser'}
        </button>
      </div>

      <BarreFiltres
        filtres={filtres}
        facettes={facettes}
        total={total}
        chargement={chargement}
        placeholderRecherche="Filtrer par nom…"
        libelleRecherche="Filtrer la bibliothèque par nom"
        onChanger={changerFiltres}
        onEffacer={effacerFiltres}
      />

      {enCours && (
        <div className="sync-progression" role="status">
          <p>
            {libelleEtape[job.step]}
            {job.totalGames > 0 &&
              ` — ${job.processedGames}/${job.totalGames}`}
          </p>
          <div className="sync-barre">
            <div
              className="sync-barre-remplie"
              style={{ width: `${pourcentage}%` }}
            />
          </div>
        </div>
      )}

      {(erreurCourante || erreur) && (
        <p className="message-erreur">{erreurCourante ?? erreur}</p>
      )}

      {chargement && (
        <p className="chargement">Chargement de la bibliothèque…</p>
      )}

      {!chargement && page && total === 0 && (
        <div className="bibliotheque-vide">
          {aDesFiltres ? (
            <>
              <p>Aucun jeu ne correspond à ces filtres.</p>
              <button type="button" className="btn" onClick={effacerFiltres}>
                Effacer les filtres
              </button>
            </>
          ) : (
            <p>
              Aucun jeu importé. Clique sur « Synchroniser » pour lancer
              l’import de ta bibliothèque Steam.
            </p>
          )}
        </div>
      )}

      {page && page.items.length > 0 && (
        <>
          <ul className="liste-jeux">
            {page.items.map((jeu) => (
              <li key={jeu.appId} className="jeu-carte">
                <Link
                  to={`/jeu/${jeu.appId}`}
                  className="jeu-lien"
                  aria-label={`Ouvrir la fiche de ${jeu.name}`}
                />
                {jeu.headerImageUrl && (
                  <img
                    className="jeu-image"
                    src={jeu.headerImageUrl}
                    alt=""
                    width="460"
                    height="215"
                    loading="lazy"
                    decoding="async"
                  />
                )}
                <div className="jeu-corps">
                  <span className="jeu-nom">{jeu.name}</span>
                  <span className="jeu-infos">{infosJeu(jeu)}</span>
                </div>
              </li>
            ))}
          </ul>

          {page.hasMore && (
            <div className="biblio-plus">
              <button
                type="button"
                className="btn"
                disabled={chargementPlus}
                onClick={() => void afficherPlus()}
              >
                {chargementPlus
                  ? 'Chargement…'
                  : `Afficher plus (${Math.max(0, page.total - page.items.length)} restants)`}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  )
}
