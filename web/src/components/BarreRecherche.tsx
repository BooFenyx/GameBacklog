import { useEffect, useId, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  rechercherJeux,
  type ModeRecherche,
  type ResultatRecherche,
} from '../search'

const ANNONCE_MODE: Record<ModeRecherche, string> = {
  name: 'Recherche par nom',
  semantic: 'Recherche par description',
}

function IconeEtiquette() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L3 13V3h10l7.59 7.59a2 2 0 0 1 0 2.82Z" />
      <circle cx="7.5" cy="7.5" r="1.5" />
    </svg>
  )
}

function IconePressePapiers() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="8" y="2" width="8" height="4" rx="1" />
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
      <path d="M9 12h6M9 16h6" />
    </svg>
  )
}

/**
 * Barre de recherche globale, affichée dans `RootLayout` quand la session est
 * ouverte. Le mode nom affiche un aperçu (SQL seul) ; le mode description
 * n'appelle l'API qu'à la validation, pour ne pas consommer de quota Gemini
 * pendant la frappe.
 */
export default function BarreRecherche() {
  const navigate = useNavigate()
  const location = useLocation()
  const listeId = useId()
  const racineRef = useRef<HTMLFormElement>(null)
  const champRef = useRef<HTMLInputElement>(null)

  const paramsInitiaux = new URLSearchParams(
    location.pathname === '/recherche' ? location.search : '',
  )

  const [requete, setRequete] = useState(() => paramsInitiaux.get('q') ?? '')
  const [mode, setMode] = useState<ModeRecherche>(() =>
    paramsInitiaux.get('mode') === 'semantic' ? 'semantic' : 'name',
  )
  const [aLeFocus, setALeFocus] = useState(false)
  const [apercu, setApercu] = useState<ResultatRecherche[] | null>(null)
  const [apercuOuvert, setApercuOuvert] = useState(false)
  const [chargementApercu, setChargementApercu] = useState(false)
  const [selection, setSelection] = useState(-1)
  const [annonceMode, setAnnonceMode] = useState<ModeRecherche | null>(null)
  const annonceTimer = useRef<number | null>(null)

  useEffect(() => {
    if (mode !== 'name' || !aLeFocus) return

    const q = requete.trim()
    if (q.length < 2) return

    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setChargementApercu(true)
      void (async () => {
        try {
          const reponse = await rechercherJeux(
            { q, mode: 'name', limit: 7 },
            controller.signal,
          )
          if (controller.signal.aborted) return
          setApercu(reponse.results)
          setApercuOuvert(true)
          setSelection(-1)
        } catch {
          if (controller.signal.aborted) return
          setApercu(null)
          setApercuOuvert(false)
        } finally {
          if (!controller.signal.aborted) setChargementApercu(false)
        }
      })()
    }, 250)

    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [aLeFocus, requete, mode])

  useEffect(() => {
    const fermer = (event: PointerEvent) => {
      if (
        racineRef.current &&
        !racineRef.current.contains(event.target as Node)
      ) {
        setApercuOuvert(false)
      }
    }
    document.addEventListener('pointerdown', fermer)
    return () => document.removeEventListener('pointerdown', fermer)
  }, [])

  useEffect(() => {
    return () => {
      if (annonceTimer.current !== null) {
        window.clearTimeout(annonceTimer.current)
      }
    }
  }, [])

  const fermerTout = () => {
    setApercuOuvert(false)
    setChargementApercu(false)
    setSelection(-1)
    champRef.current?.blur()
  }

  const soumettre = () => {
    const q = requete.trim()
    if (!q) {
      champRef.current?.focus()
      return
    }
    fermerTout()
    const params = new URLSearchParams({ q, mode })
    navigate({ pathname: '/recherche', search: params.toString() })
  }

  const basculerMode = () => {
    const suivant: ModeRecherche = mode === 'name' ? 'semantic' : 'name'
    setMode(suivant)
    setApercu(null)
    setApercuOuvert(false)
    setChargementApercu(false)
    setSelection(-1)
    setAnnonceMode(suivant)
    champRef.current?.focus()

    if (annonceTimer.current !== null) {
      window.clearTimeout(annonceTimer.current)
    }
    annonceTimer.current = window.setTimeout(() => {
      setAnnonceMode(null)
      annonceTimer.current = null
    }, 2000)
  }

  const surValidation = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    soumettre()
  }

  const surToucheChamp = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      if (apercuOuvert && apercu && apercu.length > 0) {
        event.preventDefault()
        setSelection((valeur) => (valeur + 1 >= apercu.length ? 0 : valeur + 1))
      }
      return
    }

    if (event.key === 'ArrowUp') {
      if (apercuOuvert && apercu && apercu.length > 0) {
        event.preventDefault()
        setSelection((valeur) =>
          valeur <= 0 ? apercu.length - 1 : valeur - 1,
        )
      }
      return
    }

    if (event.key === 'Enter' && apercuOuvert && apercu && selection >= 0) {
      event.preventDefault()
      const resultat = apercu[selection]
      if (resultat) {
        fermerTout()
        navigate(`/jeu/${resultat.appId}`)
      }
      return
    }

    if (event.key === 'Escape') {
      fermerTout()
    }
  }

  return (
    <form
      ref={racineRef}
      className="barre-recherche"
      role="search"
      onSubmit={surValidation}
    >
      <div className="barre-champ">
        <input
          ref={champRef}
          type="search"
          className="barre-saisie"
          placeholder="Rechercher un jeu…"
          aria-label="Rechercher dans ta bibliothèque"
          role="combobox"
          aria-expanded={apercuOuvert}
          aria-controls={listeId}
          aria-autocomplete="list"
          aria-activedescendant={
            selection >= 0 ? `${listeId}-${selection}` : undefined
          }
          autoComplete="off"
          maxLength={300}
          value={requete}
          onChange={(event) => {
            setRequete(event.target.value)
            setApercu(null)
            setApercuOuvert(false)
            setChargementApercu(false)
            setSelection(-1)
          }}
          onFocus={() => {
            setALeFocus(true)
            if (mode === 'name' && apercu !== null) {
              setApercuOuvert(true)
            }
          }}
          onBlur={() => {
            setALeFocus(false)
            setApercuOuvert(false)
            setChargementApercu(false)
          }}
          onKeyDown={surToucheChamp}
        />
        {chargementApercu && mode === 'name' && (
          <span className="barre-attente" aria-hidden="true">
            …
          </span>
        )}

        <button
          type="button"
          className="barre-mode"
          aria-label={`Mode actuel : ${ANNONCE_MODE[mode]}. Cliquer pour passer en ${
            mode === 'name' ? 'recherche par description' : 'recherche par nom'
          }.`}
          title={`Mode actuel : ${ANNONCE_MODE[mode]} — cliquer pour passer en ${
            mode === 'name' ? 'description' : 'nom'
          }`}
          onClick={basculerMode}
        >
          {mode === 'name' ? <IconeEtiquette /> : <IconePressePapiers />}
        </button>
      </div>

      {apercuOuvert && mode === 'name' && apercu !== null && (
        <div
          id={listeId}
          className="barre-apercu"
          role="listbox"
          aria-label="Aperçu des résultats"
        >
          {apercu.length === 0 ? (
            <p className="barre-apercu-vide">Aucun jeu trouvé.</p>
          ) : (
            apercu.map((resultat, index) => (
              <button
                key={resultat.appId}
                id={`${listeId}-${index}`}
                type="button"
                role="option"
                aria-selected={selection === index}
                className={
                  selection === index
                    ? 'barre-apercu-option active'
                    : 'barre-apercu-option'
                }
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  fermerTout()
                  navigate(`/jeu/${resultat.appId}`)
                }}
                onMouseEnter={() => setSelection(index)}
              >
                {resultat.headerImageUrl ? (
                  <img src={resultat.headerImageUrl} alt="" loading="lazy" />
                ) : (
                  <span className="barre-apercu-image-vide" aria-hidden="true" />
                )}
                <span className="barre-apercu-texte">
                  <strong>{resultat.name}</strong>
                  <small>
                    {resultat.genres.length > 0
                      ? resultat.genres.join(', ')
                      : 'Jeu de ta bibliothèque'}
                  </small>
                </span>
              </button>
            ))
          )}
        </div>
      )}

      {annonceMode && (
        <p className="barre-annonce" role="status" aria-live="polite">
          {ANNONCE_MODE[annonceMode]}
        </p>
      )}
    </form>
  )
}
