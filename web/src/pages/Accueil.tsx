import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import CategoriesAccueil from '../components/accueil/CategoriesAccueil'
import MenuSoir from '../components/accueil/MenuSoir'
import SelectionChef from '../components/accueil/SelectionChef'
import { chargerAccueil, salutation, type HomeAnchor, type HomeResponse } from '../home'
import { etatImport, messageErreurImport } from '../import'
import { chargerFacettes, type Facettes } from '../library'
import {
  estEnCours,
  libelleEtape,
  lireSync,
  relancerSync,
  type JobSync,
} from '../sync'

function messageAccueil(erreur: unknown): string {
  if (erreur instanceof Error) return messageErreurImport(erreur.message)
  return 'Impossible de charger ta sélection.'
}

/**
 * Page d'accueil : jeu du moment, sélection du chef, catégories et menu.
 *
 * Tout est calculé côté serveur à partir de la bibliothèque importée. La page
 * n’appelle ni Steam ni Gemini ; elle ne fait que lire `/api/home`.
 */
export default function Accueil() {
  const { user } = useAuth()
  const [home, setHome] = useState<HomeResponse | null>(null)
  const [facettes, setFacettes] = useState<Facettes | null>(null)
  const [ancreActive, setAncreActive] = useState<HomeAnchor | null>(null)
  const [job, setJob] = useState<JobSync | null>(null)
  const [erreur, setErreur] = useState<string | null>(null)
  const [chargement, setChargement] = useState(true)
  const [version, setVersion] = useState(0)
  const [relance, setRelance] = useState(0)

  useEffect(() => {
    const controller = new AbortController()

    void chargerAccueil(controller.signal)
      .then((reponse) => {
        if (controller.signal.aborted) return
        setHome(reponse)
        setAncreActive(reponse.selection.anchor)
        setErreur(null)
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setErreur(messageAccueil(error))
      })
      .finally(() => {
        if (!controller.signal.aborted) setChargement(false)
      })

    return () => controller.abort()
  }, [version])

  // Compteurs de genres pour le panneau « Affiner ». Un échec laisse le
  // panneau se rabattre sur les genres de l'ancre.
  useEffect(() => {
    const controller = new AbortController()
    void chargerFacettes(controller.signal)
      .then((reponse) => {
        if (!controller.signal.aborted) setFacettes(reponse)
      })
      .catch(() => {
        if (!controller.signal.aborted) setFacettes(null)
      })
    return () => controller.abort()
  }, [version])

  // Suivi de l'import : on sonde tant qu'un job tourne, puis on recharge
  // l'accueil une seule fois quand il se termine.
  useEffect(() => {
    let actif = true
    let timer: number | undefined
    let aVoirEnCours = false
    let etapeVue: JobSync['step'] | null = null

    const interroger = async (): Promise<void> => {
      try {
        const courant = await lireSync()
        if (!actif) return
        setJob(courant)

        if (estEnCours(courant)) {
          // La bibliothèque est affichable dès la fin de l'étape `library`,
          // sans attendre les fiches, succès et embeddings.
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
      } catch {
        // Statut neutre : une erreur de suivi ne doit pas bloquer l'accueil.
        if (actif) setJob(null)
      }
    }

    void interroger()
    return () => {
      actif = false
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [relance])

  if (!user) return null

  const enCours = estEnCours(job)
  const bandeau = etatImport(
    job && job.error
      ? { ...job, error: messageErreurImport(job.error) }
      : job,
  )

  let statut = 'Bibliothèque en attente d’import'
  if (job) {
    if (job.status === 'error') {
      statut = 'Import interrompu'
    } else if (job.status === 'done') {
      statut = 'Bibliothèque synchronisée'
    } else {
      statut =
        job.totalGames > 0
          ? `${libelleEtape[job.step]} — ${job.processedGames}/${job.totalGames}`
          : libelleEtape[job.step]
    }
  }

  const reessayer = (): void => {
    setErreur(null)
    setChargement(true)
    setVersion((valeur) => valeur + 1)
  }

  const relancer = async (): Promise<void> => {
    setErreur(null)
    try {
      const courant = await relancerSync()
      setJob(courant)
      setRelance((valeur) => valeur + 1)
    } catch (error) {
      setErreur(messageAccueil(error))
    }
  }

  return (
    <section className="accueil-intelligent">
      <header className="accueil-hero">
        <p className="accueil-eyebrow">Accueil</p>
        <h1>
          <span>{salutation(new Date().getHours())}</span>,{' '}
          <span className="accueil-nom">
            {user.displayName || 'Joueur Steam'}.
          </span>
        </h1>
        <p className="accueil-chapeau">
          {home?.jeuDuMoment
            ? 'Ta bibliothèque est prête. Ta sélection t’attend.'
            : 'Ta bibliothèque se prépare.'}
        </p>
        <p className="accueil-statut-sync">
          <span
            className={`accueil-point${enCours ? ' accueil-point--actif' : ''}`}
            aria-hidden="true"
          />
          {statut}
        </p>
      </header>

      {bandeau.texte && (
        <div
          className={`sync-progression${bandeau.alerte ? ' sync-progression--alerte' : ''}`}
          role={bandeau.alerte ? 'alert' : 'status'}
        >
          <p>{bandeau.texte}</p>
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

      {erreur && !home && (
        <div className="etat-erreur" role="alert">
          <p className="message-erreur">{erreur}</p>
          <button type="button" className="btn" onClick={reessayer}>
            Réessayer
          </button>
        </div>
      )}

      {erreur && home && <p className="accueil-erreur-inline">{erreur}</p>}

      {!home && !erreur && chargement && (
        <div className="accueil-squelettes" aria-hidden="true">
          {Array.from({ length: 5 }).map((_, index) => (
            <span className="accueil-squelette" key={index} />
          ))}
        </div>
      )}

      {home &&
        (home.jeuDuMoment ? (
          <>
            <SelectionChef
              key={`selection-${version}`}
              selectionInitial={home.selection}
              facettes={facettes}
              ancresRecentes={home.ancresRecentes}
              onAncreChange={setAncreActive}
            />
            <CategoriesAccueil
              categories={home.categories}
              nomAncre={home.jeuDuMoment.name}
            />
            <MenuSoir
              menuInitial={home.menu}
              anchor={ancreActive ?? home.selection.anchor}
            />
          </>
        ) : (
          <div className="accueil-vide-import">
            <h2>
              {enCours
                ? 'Import de ta bibliothèque…'
                : 'Aucun jeu importé pour le moment'}
            </h2>
            <p>
              {enCours
                ? 'Tes jeux arrivent : la sélection s’affichera dès que l’import de la bibliothèque sera terminé.'
                : 'Lance un import Steam ou vérifie que ton profil est public.'}
            </p>
            <div className="accueil-vide-actions">
              {!enCours && (
                <button
                  type="button"
                  className="btn btn-principal"
                  onClick={() => void relancer()}
                >
                  Synchroniser
                </button>
              )}
              <Link className="btn" to="/bibliotheque">
                Voir la bibliothèque
              </Link>
            </div>
          </div>
        ))}
    </section>
  )
}
