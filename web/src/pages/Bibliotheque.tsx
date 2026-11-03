import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import BasculeVue from '../components/bibliotheque/BasculeVue'
import CarteJeu from '../components/bibliotheque/CarteJeu'
import LigneJeu from '../components/bibliotheque/LigneJeu'
import SqueletteCarte from '../components/bibliotheque/SqueletteCarte'
import { useVueBibliotheque } from '../components/bibliotheque/useVueBibliotheque'
import BarreFiltres from '../components/filtres/BarreFiltres'
import SidebarFiltres from '../components/filtres/SidebarFiltres'
import { IconeAlerte, IconeBoite } from '../components/ui/Icones'
import {
  cleFiltres,
  compterFiltresActifs,
  ecrireFiltres,
  lireFiltres,
  type Filtres,
} from '../filters'
import { etatImport, messageErreurImport } from '../import'
import {
  chargerBibliotheque,
  chargerFacettes,
  type Facettes,
  type ReponseBibliotheque,
} from '../library'
import {
  estEnCours,
  lireSync,
  relancerSync,
  type JobSync,
} from '../sync'

/** Message d'erreur lisible, avec l'aide dédiée au profil Steam privé. */
function messageErreur(erreur: unknown): string {
  if (erreur instanceof Error) return messageErreurImport(erreur.message)
  return 'Impossible de récupérer la bibliothèque.'
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
  const [erreurRelance, setErreurRelance] = useState<string | null>(null)
  const [job, setJob] = useState<JobSync | null>(null)
  const [version, setVersion] = useState(0)
  const [relance, setRelance] = useState(0)
  const [recharger, setRecharger] = useState(0)
  const [vue, changerVue] = useVueBibliotheque()
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
  const erreurCourante =
    erreurListe?.cle === cleListe ? erreurListe.message : null
  const enRafraichissement =
    pageAJour === null && page !== null && erreurCourante === null
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
  }, [version, recharger])

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
        setErreurListe((actuelle) =>
          actuelle && actuelle.cle === cleListe ? null : actuelle,
        )
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setErreurListe({ cle: cleListe, message: messageErreur(error) })
      })

    return () => {
      controller.abort()
      plusController.current?.abort()
    }
  }, [cleListe, recharger])

  // Suivi de l'import : on sonde tant qu'un job tourne, puis on rafraîchit la
  // page et les facettes une seule fois quand il se termine.
  useEffect(() => {
    let actif = true
    let timer: number | undefined
    let aVoirEnCours = false
    let etapeVue: JobSync['step'] | null = null
    let tentatives = 0

    const interroger = async (): Promise<void> => {
      try {
        const courant = await lireSync()
        if (!actif) return
        setJob(courant)
        // La lecture a réussi : l'erreur transitoire précédente est périmée.
        tentatives = 0
        setErreur(null)

        if (estEnCours(courant)) {
          // La bibliothèque est affichable dès la fin de `library` : sans ce
          // rechargement, elle resterait vide pendant les étapes details /
          // succès / embeddings alors que les jeux sont déjà en base.
          if (etapeVue === 'library' && courant.step !== 'library') {
            setVersion((valeur) => valeur + 1)
          }
          etapeVue = courant.step
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
        // Une erreur transitoire ne doit pas tuer le suivi, mais on borne les
        // relances : une API durablement indisponible ne doit pas être
        // martelée toutes les 5 s par un onglet resté ouvert.
        tentatives += 1
        if (tentatives < 6) {
          timer = window.setTimeout(() => void interroger(), 5000)
        }
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
      window.requestAnimationFrame(() => ongletRef.current?.focus())
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

  // Un lien `?tri=recent` peut arriver sur un compte sans activité dérivée :
  // on retombe silencieusement sur le tri par nom, l'option étant masquée.
  useEffect(() => {
    if (
      facettes &&
      facettes.lastActivityDisponible === false &&
      filtres.tri === 'recent'
    ) {
      changerFiltres({ ...filtres, tri: 'nom' }, true)
    }
  }, [facettes, filtres, changerFiltres])

  const reessayerListe = useCallback(() => {
    setErreurListe(null)
    setErreur(null)
    setErreurRelance(null)
    setRecharger((valeur) => valeur + 1)
    // Relance aussi le suivi d'import : après six échecs, le polling s'est
    // arrêté et le bandeau resterait figé sans cela.
    setRelance((valeur) => valeur + 1)
  }, [])

  const relancer = async (): Promise<void> => {
    setErreur(null)
    setErreurRelance(null)
    try {
      const courant = await relancerSync()
      setJob(courant)
      setRelance((valeur) => valeur + 1)
    } catch (error) {
      setErreurRelance(messageErreur(error))
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
      // Remettre l'état même après une annulation de filtre : sinon le bouton
      // « Afficher plus » resterait désactivé pour la nouvelle liste.
      setChargementPlus(false)
    }
  }

  const enCours = estEnCours(job)
  const bandeau = etatImport(
    job && job.error
      ? { ...job, error: messageErreurImport(job.error) }
      : job,
  )
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
          ouvert={filtresOuverts}
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
            activiteDisponible={facettes?.lastActivityDisponible ?? true}
            actions={<BasculeVue vue={vue} onChanger={changerVue} />}
            onChanger={changerFiltres}
            onEffacer={effacerFiltres}
          />

          {bandeau.texte && (
            <div
              className={`sync-progression${bandeau.alerte ? ' sync-progression--alerte' : ''}`}
              role={bandeau.alerte ? 'alert' : 'status'}
            >
              <p>{bandeau.texte}</p>
              {enCours && job.totalGames > 0 && (
                <div
                  className="sync-barre"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={pourcentage}
                  aria-label={`Progression de l'import : ${pourcentage} %`}
                >
                  <div
                    className="sync-barre-remplie"
                    style={{ width: `${pourcentage}%` }}
                  />
                </div>
              )}
              {bandeau.action !== 'aucune' && (
                <button
                  type="button"
                  className="btn"
                  disabled={enCours}
                  onClick={() => void relancer()}
                >
                  {bandeau.action === 'relancer' ? 'Relancer' : 'Reprendre'}
                </button>
              )}
            </div>
          )}

          {erreurCourante && (
            <div className="etat-erreur" role="alert">
              <p className="message-erreur">{erreurCourante}</p>
              <button
                type="button"
                className="btn"
                onClick={reessayerListe}
              >
                Réessayer
              </button>
            </div>
          )}

          {!erreurCourante && (erreurRelance || erreur) && (
            <div className="etat-erreur" role="alert">
              <p className="message-erreur">{erreurRelance ?? erreur}</p>
              <button type="button" className="btn" onClick={reessayerListe}>
                Réessayer
              </button>
            </div>
          )}

          {chargement && (
            <>
              <p className="sr-only" role="status">
                Chargement de la bibliothèque…
              </p>
              <ul
                className={
                  vue === 'grille' ? 'biblio-grille' : 'biblio-liste'
                }
              >
                {Array.from({
                  length: vue === 'grille' ? 6 : 5,
                }).map((_, index) => (
                  <SqueletteCarte key={index} variante={vue} />
                ))}
              </ul>
            </>
          )}

          {page && (
            <p className="biblio-resultats-compte" aria-live="polite">
              {total} résultat{total > 1 ? 's' : ''}
            </p>
          )}

          {!chargement && !enRafraichissement && page && total === 0 && (
            <div className="etat-biblio">
              <span className="etat-biblio__icone" aria-hidden="true">
                {aDesFiltres ? <IconeAlerte /> : <IconeBoite />}
              </span>
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
                <>
                  <p>
                    Aucun jeu importé. Lance un import Steam pour commencer.
                  </p>
                  <button
                    type="button"
                    className="btn btn-principal"
                    disabled={enCours}
                    onClick={() => void relancer()}
                  >
                    {enCours ? 'Synchronisation…' : 'Synchroniser'}
                  </button>
                </>
              )}
            </div>
          )}

          {page && page.items.length > 0 && (
            <>
              {vue === 'grille' ? (
                <ul className="biblio-grille">
                  {page.items.map((jeu) => (
                    <CarteJeu key={jeu.appId} jeu={jeu} />
                  ))}
                </ul>
              ) : (
                <ul className="biblio-liste">
                  {page.items.map((jeu) => (
                    <LigneJeu key={jeu.appId} jeu={jeu} />
                  ))}
                </ul>
              )}

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
