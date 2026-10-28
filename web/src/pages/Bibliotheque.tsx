import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import BarreFiltres from '../components/filtres/BarreFiltres'
import SidebarFiltres from '../components/filtres/SidebarFiltres'
import {
  MODES,
  cleFiltres,
  compterFiltresActifs,
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

/** Nombre de genres affichés sur une carte avant le « +N ». */
const GENRES_VISIBLES = 2

type EtatCarte = { label: string; recent: boolean }

/** Badge d'état affiché sur l'image : jamais lancé, récent ou joué. */
function etatJeu(jeu: JeuBibliotheque): EtatCarte {
  if (jeu.playtimeForever === 0) {
    return { label: 'Jamais lancé', recent: false }
  }
  if (jeu.playtimeLast2Weeks > 0) {
    return { label: 'Joué cette semaine', recent: true }
  }
  return { label: 'Joué', recent: false }
}

/** Ligne compacte sous le titre : temps de jeu, dernière partie, succès. */
function metaJeu(jeu: JeuBibliotheque): string {
  const morceaux = [
    jeu.playtimeForever > 0
      ? `${formaterDuree(jeu.playtimeForever)} de jeu`
      : null,
    jeu.lastPlayedAt ? `joué ${formaterDepuis(jeu.lastPlayedAt)}` : null,
    jeu.achievementsUnlocked > 0 ? `${jeu.achievementsUnlocked} succès` : null,
  ].filter((valeur): valeur is string => Boolean(valeur))

  return morceaux.length > 0 ? morceaux.join(' · ') : 'Jamais lancé'
}

/** Libellé lisible d'un mode de jeu, tel qu'affiché dans les filtres. */
function libelleMode(valeur: string): string {
  return MODES.find((mode) => mode.value === valeur)?.label ?? valeur
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
  const [filtresOuverts, setFiltresOuverts] = useState(true)
  const [ongletVisible, setOngletVisible] = useState(false)
  const plusController = useRef<AbortController | null>(null)
  const layoutRef = useRef<HTMLDivElement>(null)
  const ongletRef = useRef<HTMLButtonElement>(null)
  const timerOnglet = useRef<number | null>(null)
  const filtresRef = useRef(filtres)

  // La clé identifie un couple (filtres, version d'import) : une réponse
  // arrivée pour une autre clé est ignorée à l'affichage, ce qui évite de
  // remettre l'état à zéro de façon synchrone dans l'effet.
  const cleListe = useMemo(
    () => `${cleFiltres(filtres)}|${version}`,
    [filtres, version],
  )
  const pageAJour = donnees?.cle === cleListe ? donnees.page : null
  // Pendant un rechargement, on garde la dernière liste connue : la grille ne
  // disparaît plus (et ne « recharge » plus visuellement) à chaque filtre.
  const page = pageAJour ?? donnees?.page ?? null
  const enRafraichissement = pageAJour === null && page !== null
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
    filtresRef.current = filtres
  }, [filtres])

  useEffect(() => {
    const controller = new AbortController()

    void chargerBibliotheque(filtresRef.current, 0, controller.signal)
      .then((reponse) => {
        if (controller.signal.aborted) return
        setDonnees({ cle: cleListe, page: reponse })
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setErreurListe({ cle: cleListe, message: messageErreur(error) })
      })

    return () => controller.abort()
  }, [cleListe])

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

  const placerOnglet = useCallback(() => {
    const top = layoutRef.current?.getBoundingClientRect().top ?? 0
    if (ongletRef.current) {
      ongletRef.current.style.top = `${Math.max(0, top)}px`
    }
  }, [])

  useEffect(() => {
    placerOnglet()
    window.addEventListener('resize', placerOnglet)
    window.addEventListener('scroll', placerOnglet, { passive: true })
    return () => {
      window.removeEventListener('resize', placerOnglet)
      window.removeEventListener('scroll', placerOnglet)
      if (timerOnglet.current !== null) {
        window.clearTimeout(timerOnglet.current)
      }
    }
  }, [placerOnglet])

  const fermerFiltres = useCallback(() => {
    setFiltresOuverts(false)
    setOngletVisible(false)
    if (timerOnglet.current !== null) {
      window.clearTimeout(timerOnglet.current)
    }
    timerOnglet.current = window.setTimeout(() => {
      placerOnglet()
      setOngletVisible(true)
      timerOnglet.current = null
    }, 320)
  }, [placerOnglet])

  const ouvrirFiltres = useCallback(() => {
    if (timerOnglet.current !== null) {
      window.clearTimeout(timerOnglet.current)
      timerOnglet.current = null
    }
    setOngletVisible(false)
    setFiltresOuverts(true)
  }, [])

  const changerFiltres = useCallback(
    (suivants: Filtres, remplacer = false) => {
      setSearchParams(ecrireFiltres(suivants, { avecTri: true }), {
        replace: remplacer,
      })
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
    if (!pageAJour || chargementPlus || !pageAJour.hasMore) return

    plusController.current?.abort()
    const controller = new AbortController()
    plusController.current = controller
    setChargementPlus(true)

    try {
      const suivante = await chargerBibliotheque(
        filtres,
        pageAJour.items.length,
        controller.signal,
      )
      if (controller.signal.aborted) return
      setDonnees({
        cle: cleListe,
        page: {
          ...suivante,
          items: [...pageAJour.items, ...suivante.items],
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
  const nombreFiltres = compterFiltresActifs(filtres)

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

      <div
        ref={layoutRef}
        className={`biblio-layout${filtresOuverts ? '' : ' filtres-fermes'}`}
      >
        <SidebarFiltres
          filtres={filtres}
          facettes={facettes}
          onChanger={changerFiltres}
          onEffacer={effacerFiltres}
          onFermer={fermerFiltres}
        />

        <div
          className={`biblio-resultats${enRafraichissement ? ' biblio-resultats--maj' : ''}`}
          aria-busy={enRafraichissement}
        >
          <BarreFiltres
            filtres={filtres}
            facettes={facettes}
            total={total}
            chargement={chargement}
            placeholderRecherche="Filtrer par nom…"
            libelleRecherche="Filtrer la bibliothèque par nom"
            filtresEnSidebar
            afficherCompte={false}
            afficherToutEffacer={false}
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

          {page && (
            <p className="biblio-resultats-compte" aria-live="polite">
              {total} résultat{total > 1 ? 's' : ''}
            </p>
          )}

          {!chargement && !enRafraichissement && page && total === 0 && (
            <div className="bibliotheque-vide">
              {aDesFiltres ? (
                <>
                  <p>Aucun jeu ne correspond à ces filtres.</p>
                  <button
                    type="button"
                    className="btn"
                    onClick={effacerFiltres}
                  >
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
                {page.items.map((jeu) => {
                  const etat = etatJeu(jeu)
                  const genresVus = jeu.genres.slice(0, GENRES_VISIBLES)
                  const genresRestants =
                    jeu.genres.length - genresVus.length

                  return (
                    <li key={jeu.appId} className="jeu-carte">
                      <Link
                        to={`/jeu/${jeu.appId}`}
                        className="jeu-lien"
                        aria-label={`Ouvrir la fiche de ${jeu.name} — ${etat.label}`}
                      />
                      <div className="jeu-media">
                        {jeu.headerImageUrl ? (
                          <img
                            className="jeu-image"
                            src={jeu.headerImageUrl}
                            alt=""
                            width="460"
                            height="215"
                            loading="lazy"
                            decoding="async"
                          />
                        ) : (
                          <span
                            className="jeu-image jeu-image-vide"
                            aria-hidden="true"
                          >
                            {jeu.name.slice(0, 1).toUpperCase()}
                          </span>
                        )}
                        <span
                          className={`jeu-etat${etat.recent ? ' jeu-etat-recent' : ''}`}
                        >
                          {etat.label}
                        </span>
                      </div>
                      <div className="jeu-corps">
                        <span className="jeu-nom">{jeu.name}</span>
                        {genresVus.length > 0 && (
                          <span className="jeu-genres">
                            {genresVus.map((genre) => (
                              <span key={genre} className="jeu-genre">
                                {genre}
                              </span>
                            ))}
                            {genresRestants > 0 && (
                              <span className="jeu-genre jeu-genre-plus">
                                +{genresRestants}
                              </span>
                            )}
                          </span>
                        )}
                        <span className="jeu-meta">{metaJeu(jeu)}</span>
                        {(jeu.modes.length > 0 ||
                          jeu.controllerSupport === 'full') && (
                          <span className="jeu-badges">
                            {jeu.modes.map((mode) => (
                              <span
                                key={mode}
                                className={`jeu-badge${mode === 'solo' ? ' jeu-badge-solo' : ''}`}
                              >
                                {libelleMode(mode)}
                              </span>
                            ))}
                            {jeu.controllerSupport === 'full' && (
                              <span className="jeu-badge jeu-badge-manette">
                                Manette
                              </span>
                            )}
                          </span>
                        )}
                      </div>
                    </li>
                  )
                })}
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
        </div>
      </div>

      <button
        ref={ongletRef}
        type="button"
        className="onglet-filtres"
        hidden={!ongletVisible}
        onClick={ouvrirFiltres}
        aria-label="Afficher les filtres"
      >
        <span className="onglet-filtres-chevron" aria-hidden="true">
          ›
        </span>
        <span className="onglet-filtres-texte">Filtres</span>
        {nombreFiltres > 0 && (
          <span className="onglet-filtres-badge">{nombreFiltres}</span>
        )}
      </button>
    </section>
  )
}
