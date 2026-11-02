import { useMemo, useState } from 'react'
import { formaterDate } from '../../format'
import type { Succes } from '../../games'
import { IconeTrophee } from '../ui/Icones'
import BarreProgression from '../ui/BarreProgression'

type FiltreSucces = 'tous' | 'debloque' | 'verrouille'

type Props = {
  succes: {
    total: number
    unlocked: number
    list: Succes[]
  }
}

const LIMITE_INITIALE = 12

function carteSucces(succes: Succes) {
  const debloque = Boolean(succes.unlockedAt)
  const date = formaterDate(succes.unlockedAt)
  return (
    <li
      key={succes.apiName}
      className={debloque ? 'succes-carte' : 'succes-carte verrouille'}
    >
      <span className="succes-icone" aria-hidden="true">
        {succes.iconUrl ? (
          <img src={succes.iconUrl} alt="" width="48" height="48" loading="lazy" />
        ) : (
          <IconeTrophee />
        )}
      </span>
      <div className="succes-texte">
        <strong>{succes.displayName}</strong>
        {succes.description && <p>{succes.description}</p>}
        <small>
          {debloque && date ? `Débloqué le ${date}` : 'Verrouillé'}
        </small>
      </div>
    </li>
  )
}

/** Section des succès : progression, filtres et liste plafonnée. */
export default function SuccesJeu({ succes }: Props) {
  const [filtre, setFiltre] = useState<FiltreSucces>('tous')
  const [toutAfficher, setToutAfficher] = useState(false)

  const verrouilles = Math.max(0, succes.total - succes.unlocked)
  const pourcentage =
    succes.total > 0
      ? Math.round((succes.unlocked / succes.total) * 100)
      : 0
  const complet = succes.total > 0 && succes.unlocked === succes.total

  const visibles = useMemo(() => {
    if (filtre === 'debloque') {
      return succes.list.filter((item) => Boolean(item.unlockedAt))
    }
    if (filtre === 'verrouille') {
      return succes.list.filter((item) => !item.unlockedAt)
    }
    return succes.list
  }, [filtre, succes.list])

  const affiches = toutAfficher
    ? visibles
    : visibles.slice(0, LIMITE_INITIALE)

  const changerFiltre = (suivant: FiltreSucces) => {
    setFiltre(suivant)
    setToutAfficher(false)
  }

  return (
    <section className="fiche-section" aria-labelledby="titre-succes">
      <div className="succes-entete">
        <h2 className="titre-section" id="titre-succes">
          Succès
        </h2>
        {succes.total > 0 && (
          <div className="succes-progression">
            <BarreProgression
              valeur={succes.unlocked}
              max={succes.total}
              label="Progression des succès"
              className={
                complet ? 'barre-progression--complete' : undefined
              }
            />
            <span className="texte-doux">
              {succes.unlocked} sur {succes.total} · {pourcentage} %
            </span>
          </div>
        )}
      </div>

      {succes.list.length === 0 ? (
        <p className="succes-vide">
          Aucun succès disponible pour ce jeu (jeu sans succès ou profil Steam
          privé).
        </p>
      ) : (
        <>
          <div className="succes-filtres" role="group" aria-label="Filtrer les succès">
            <button
              type="button"
              aria-pressed={filtre === 'tous'}
              onClick={() => changerFiltre('tous')}
            >
              Tous <span>{succes.total}</span>
            </button>
            <button
              type="button"
              aria-pressed={filtre === 'debloque'}
              onClick={() => changerFiltre('debloque')}
            >
              Débloqués <span>{succes.unlocked}</span>
            </button>
            <button
              type="button"
              aria-pressed={filtre === 'verrouille'}
              onClick={() => changerFiltre('verrouille')}
            >
              Verrouillés <span>{verrouilles}</span>
            </button>
          </div>

          <ul className="succes-grille">
            {affiches.map((item) => carteSucces(item))}
          </ul>

          {visibles.length > LIMITE_INITIALE && (
            <div className="succes-plus">
              <button
                type="button"
                className="btn"
                aria-expanded={toutAfficher}
                onClick={() => setToutAfficher((valeur) => !valeur)}
              >
                {toutAfficher
                  ? 'Réduire la liste'
                  : `Afficher tous les succès (${visibles.length})`}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  )
}
