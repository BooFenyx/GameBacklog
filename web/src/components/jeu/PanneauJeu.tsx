import {
  formaterDate,
  formaterDepuis,
  formaterDuree,
} from '../../format'
import {
  LIBELLE_MANETTE,
  LIBELLE_PLATEFORME,
  type FicheJeu,
} from '../../games'
import BarreProgression from '../ui/BarreProgression'
import Etiquette from '../ui/Etiquette'

type Props = {
  jeu: FicheJeu
}

/** Colonne latérale : informations, activité et actions. */
export default function PanneauJeu({ jeu }: Props) {
  const storeUrl = `https://store.steampowered.com/app/${jeu.appId}`
  const pourcentage =
    jeu.achievements.total > 0
      ? Math.round(
          (jeu.achievements.unlocked / jeu.achievements.total) * 100,
        )
      : 0

  return (
    <aside className="fiche-laterale" aria-label="Informations et activité">
      <section className="panneau" aria-labelledby="titre-infos">
        <h2 className="panneau-titre" id="titre-infos">
          Informations
        </h2>
        <dl className="infos-liste">
          {jeu.releaseDate && (
            <div>
              <dt>Sortie</dt>
              <dd>{formaterDate(jeu.releaseDate) ?? '—'}</dd>
            </div>
          )}
          {jeu.developers.length > 0 && (
            <div>
              <dt>Développeur</dt>
              <dd>{jeu.developers.join(', ')}</dd>
            </div>
          )}
          {jeu.publishers.length > 0 && (
            <div>
              <dt>Éditeur</dt>
              <dd>{jeu.publishers.join(', ')}</dd>
            </div>
          )}
          {jeu.genres.length > 0 && (
            <div>
              <dt>Genres</dt>
              <dd>{jeu.genres.join(', ')}</dd>
            </div>
          )}
          {jeu.categories.length > 0 && (
            <div>
              <dt>Caractéristiques</dt>
              <dd title={jeu.categories.join(', ')}>
                {jeu.categories.slice(0, 4).join(', ')}
              </dd>
            </div>
          )}
          {jeu.platforms.length > 0 && (
            <div>
              <dt>Plateformes</dt>
              <dd className="plateformes">
                {jeu.platforms.map((plateforme) => (
                  <Etiquette key={plateforme} variante="genre">
                    {LIBELLE_PLATEFORME[plateforme]}
                  </Etiquette>
                ))}
              </dd>
            </div>
          )}
          <div>
            <dt>Manette</dt>
            <dd>
              {LIBELLE_MANETTE[jeu.controllerSupport]}
              {jeu.controllerSupport === 'partial' && (
                <small className="detail-note">
                  Certaines actions peuvent nécessiter le clavier ou la souris.
                </small>
              )}
            </dd>
          </div>
          {jeu.metacriticScore !== null && (
            <div>
              <dt>Metacritic</dt>
              <dd>
                {jeu.metacriticUrl ? (
                  <a
                    className="metacritic"
                    href={jeu.metacriticUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <span className="metacritic-score">
                      {jeu.metacriticScore}
                    </span>
                    <span className="metacritic-label">Voir la fiche</span>
                  </a>
                ) : (
                  <span className="metacritic">
                    <span className="metacritic-score">
                      {jeu.metacriticScore}
                    </span>
                  </span>
                )}
              </dd>
            </div>
          )}
          {jeu.website && (
            <div>
              <dt>Site officiel</dt>
              <dd>
                <a href={jeu.website} target="_blank" rel="noreferrer">
                  {jeu.website.replace(/^https?:\/\//, '').replace(/\/$/, '')}
                </a>
              </dd>
            </div>
          )}
        </dl>
      </section>

      <section className="panneau" aria-labelledby="titre-activite">
        <h2 className="panneau-titre" id="titre-activite">
          Mon activité
        </h2>
        <div className="activite-stats">
          <div className="stat">
            <strong>
              {jeu.playtimeForever > 0
                ? formaterDuree(jeu.playtimeForever)
                : '—'}
            </strong>
            <span>temps total</span>
          </div>
          <div className="stat">
            <strong>{formaterDuree(jeu.playtimeLast2Weeks)}</strong>
            <span>2 dernières sem.</span>
          </div>
          <div className="stat">
            <strong>{formaterDepuis(jeu.lastPlayedAt) ?? 'jamais'}</strong>
            <span>dernière partie</span>
          </div>
        </div>

        {jeu.achievements.total > 0 && (
          <>
            <div className="progression-texte">
              <span>Succès</span>
              <span>
                <strong>
                  {jeu.achievements.unlocked} / {jeu.achievements.total}
                </strong>{' '}
                · {pourcentage} %
              </span>
            </div>
            <BarreProgression
              valeur={jeu.achievements.unlocked}
              max={jeu.achievements.total}
              label="Progression des succès"
            />
          </>
        )}
      </section>

      <section className="panneau" aria-labelledby="titre-actions">
        <h2 className="panneau-titre" id="titre-actions">
          Actions
        </h2>
        <div className="panneau-actions">
          <a className="btn btn-principal" href={jeu.steamUrl}>
            Lancer sur Steam
          </a>
          <a
            className="btn"
            href={storeUrl}
            target="_blank"
            rel="noreferrer"
          >
            Voir la fiche Steam
          </a>
        </div>
      </section>
    </aside>
  )
}
