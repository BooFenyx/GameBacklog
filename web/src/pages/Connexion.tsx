import { useAuth } from '../auth/AuthContext'

/** Écran d'accueil de l'application pour un visiteur non connecté. */
export default function Connexion() {
  const { login } = useAuth()

  return (
    <section className="connexion">
      <p className="sur-titre">Ton backlog, enfin utile</p>
      <h1>GameBacklog</h1>
      <p className="pitch">
        Des centaines de jeux, dont beaucoup jamais lancés. Arrête de parcourir
        ta bibliothèque à la main : dis ce que tu as envie de jouer, et
        retrouve-le dans tes propres jeux.
      </p>

      <button type="button" className="btn btn-principal btn-grand" onClick={login}>
        Se connecter avec Steam
      </button>

      <p className="aide">
        Connexion gérée par OpenID : aucun mot de passe, et seul ton profil
        public Steam (pseudo, avatar) est lu.
      </p>

      <ol className="etapes">
        <li>
          <strong>Connexion</strong> via Steam
        </li>
        <li>
          <strong>Import</strong> de ta bibliothèque
        </li>
        <li>
          <strong>Recherche</strong> selon tes envies
        </li>
      </ol>
    </section>
  )
}
