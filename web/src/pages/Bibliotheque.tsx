import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { urlApi } from '../api'
import { estEnCours, libelleEtape, lireSync, relancerSync, type JobSync } from '../sync'

export type JeuBibliotheque = {
  appId: number
  name: string
  playtimeForever: number
  playtimeLast2Weeks: number
  lastPlayedAt: string | null
  genres: string[]
  categories: string[]
  controllerSupport: 'none' | 'partial' | 'full'
  shortDescription: string | null
  headerImageUrl: string | null
  achievementsUnlocked: number
}

function formaterDuree(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m} min`
  if (m === 0) return `${h} h`
  return `${h} h ${String(m).padStart(2, '0')}`
}

function formaterDate(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString('fr-FR')
}

/**
 * Page bibliothèque : lit `GET /api/library` depuis la base (les jeux Steam
 * sont récupérés une seule fois, à l'import). Tant que l'étape `library` du job
 * n'est pas passée, la liste est vide : on affiche la progression du sync puis
 * la liste dès que `library_entries` est remplie.
 */
export default function Bibliotheque() {
  const [jeux, setJeux] = useState<JeuBibliotheque[] | null>(null)
  const [job, setJob] = useState<JobSync | null>(null)
  const [erreur, setErreur] = useState<string | null>(null)
  const [chargement, setChargement] = useState(true)
  const [relance, setRelance] = useState(0)
  const jeuxPris = useRef(false)

  useEffect(() => {
    let actif = true
    let timer: number | undefined

    const chargerJeux = async (): Promise<void> => {
      if (jeuxPris.current) return
      const res = await fetch(urlApi('/api/library'), { credentials: 'include' })
      if (!res.ok) {
        const corps = (await res.json().catch(() => null)) as {
          message?: string
        } | null
        throw new Error(corps?.message ?? `Réponse ${res.status}`)
      }
      const liste = (await res.json()) as JeuBibliotheque[]
      if (!actif) return
      jeuxPris.current = true
      setJeux(liste)
    }

    const interroger = async (): Promise<void> => {
      try {
        const j = await lireSync()
        if (!actif) return
        setJob(j)
        // Copie non resserrée : le garde `estEnCours` ci-dessous restreint `j`
        // à `null` hors du bloc, ce qui rendrait cette lecture illisible pour TS.
        const statutJob = j

        if (estEnCours(j)) {
          // Dès que l'étape `library` est passée, la liste est affichable.
          if (j.step !== 'library') void chargerJeux()
          timer = window.setTimeout(() => void interroger(), 2000)
          return
        }

        if (statutJob && statutJob.status === 'error' && statutJob.error) {
          setErreur(
            statutJob.error.includes('quota')
              ? 'Quota d’embedding atteint (Google Gemini) : l’import reprendra plus tard.'
              : statutJob.error,
          )
        }
        await chargerJeux()
      } catch (error) {
        if (!actif) return
        setErreur(
          error instanceof Error
            ? error.message
            : 'Impossible de récupérer la bibliothèque.',
        )
      } finally {
        if (actif) setChargement(false)
      }
    }

    void interroger()
    return () => {
      actif = false
      window.clearTimeout(timer)
    }
  }, [relance])

  const relancer = async (): Promise<void> => {
    setChargement(true)
    setErreur(null)
    jeuxPris.current = false
    try {
      await relancerSync()
      setRelance((n) => n + 1)
    } catch (error) {
      setChargement(false)
      setErreur(
        error instanceof Error ? error.message : 'Échec du lancement de l’import.',
      )
    }
  }

  if (chargement && jeux === null) {
    return <p className="chargement">Import de la bibliothèque…</p>
  }

  const liste = jeux ?? []
  const enCours = estEnCours(job)
  const pourcentage =
    enCours && job.totalGames > 0
      ? Math.min(100, Math.round((job.processedGames / job.totalGames) * 100))
      : 0

  return (
    <section className="bibliotheque">
      <div className="bibliotheque-tete">
        <h1>Bibliothèque</h1>
        <p className="bibliotheque-compte">
          {liste.length} jeu{liste.length > 1 ? 'x' : ''}
        </p>
        <button type="button" className="btn" onClick={() => void relancer()}>
          Synchroniser
        </button>
      </div>

      {enCours && (
        <div className="sync-progression" role="status">
          <p>
            {libelleEtape[job.step]}
            {job.totalGames > 0 && ` — ${job.processedGames}/${job.totalGames}`}
          </p>
          <div className="sync-barre">
            <div
              className="sync-barre-remplie"
              style={{ width: `${pourcentage}%` }}
            />
          </div>
        </div>
      )}

      {erreur && (
        <p className="message-erreur">
          {erreur.includes('profil privé') || erreur.includes('privé')
            ? 'Ton profil Steam est privé. Rends-le public dans les paramètres Steam pour importer ta bibliothèque.'
            : erreur}
        </p>
      )}

      {!enCours && !erreur && liste.length === 0 && (
        <p className="bibliotheque-vide">
          Aucun jeu importé. Clique sur « Synchroniser » pour lancer l’import de
          ta bibliothèque Steam.
        </p>
      )}

      <ul className="liste-jeux">
        {liste.map((jeu) => (
          <li key={jeu.appId} className="jeu-carte">
            <Link
              to={`/jeu/${jeu.appId}`}
              className="jeu-lien"
              aria-label={`Ouvrir la fiche de ${jeu.name}`}
            ></Link>
            {jeu.headerImageUrl && (
              <img
                className="jeu-image"
                src={jeu.headerImageUrl}
                alt=""
                loading="lazy"
              />
            )}
            <div className="jeu-corps">
              <span className="jeu-nom">{jeu.name}</span>
              <span className="jeu-infos">
                {jeu.playtimeForever > 0 && formaterDuree(jeu.playtimeForever)}
                {jeu.playtimeLast2Weeks > 0 &&
                  ` • ${formaterDuree(jeu.playtimeLast2Weeks)} en 2 sem`}
                {jeu.lastPlayedAt &&
                  ` • joué le ${formaterDate(jeu.lastPlayedAt)}`}
                {jeu.genres.length > 0 && (
                  <span className="jeu-genres">
                    {' • '}
                    {jeu.genres.join(', ')}
                  </span>
                )}
                {jeu.controllerSupport !== 'none' && (
                  <span className="jeu-manette">
                    {' • '}
                    {jeu.controllerSupport === 'full'
                      ? 'manette complète'
                      : 'manette partielle'}
                  </span>
                )}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}