import { Link } from 'react-router-dom'

/** Page publique d'information sur les données lues et conservées. */
export default function Confidentialite() {
  return (
    <section className="confidentialite">
      <p className="sur-titre">Données personnelles</p>
      <h1>Confidentialité</h1>

      <p>
        GameBacklog est un projet étudiant. Cette page décrit les données
        réellement lues par l’application, leur usage et les services tiers
        sollicités.
      </p>

      <h2>Connexion Steam</h2>
      <p>
        La connexion utilise OpenID 2.0 : aucun mot de passe Steam ne transite
        par GameBacklog. Steam confirme ton identité et nous transmet ton
        SteamID64, ton pseudo, ton avatar et l’URL de ton profil public. Un
        cookie de session strictement nécessaire est posé pour sept jours
        (<code>httpOnly</code>, <code>SameSite=Lax</code>, <code>Secure</code>{' '}
        en production). Aucun cookie publicitaire ni traceur n’est utilisé.
      </p>

      <h2>Bibliothèque et succès</h2>
      <p>
        Avec ton accord (connexion), l’API Steam nous permet de lire la liste de
        tes jeux, ton temps de jeu, la fenêtre d’activité des deux dernières
        semaines, les fiches publiques des jeux et tes succès. Ces données sont
        stockées dans une base PostgreSQL hébergée par Neon, sur nos serveurs,
        pour afficher ta bibliothèque, calculer les recommandations et la
        recherche.
      </p>

      <h2>Recherche et indexation</h2>
      <p>
        Les fiches de jeux (nom, description, genres, catégories) sont envoyées
        à Google Gemini pour produire des embeddings. En mode « description »,
        le texte de ta recherche est également envoyé à Gemini pour être
        comparé aux jeux ; il n’est pas conservé par l’application. Aucune
        donnée de ta bibliothèque n’est envoyée à Gemini pour la recherche.
      </p>

      <h2>Hébergement et sous-traitants</h2>
      <ul>
        <li>Vercel : hébergement du front.</li>
        <li>Render : hébergement de l’API.</li>
        <li>Neon : base PostgreSQL.</li>
        <li>Steam : authentification OpenID et données publiques du compte.</li>
        <li>Google Gemini : calcul des embeddings de jeux et de requêtes.</li>
      </ul>

      <h2>Conservation et droits</h2>
      <p>
        Les données de bibliothèque sont conservées tant que le compte existe
        afin de garder l’historique et les recommandations. La session expire
        après sept jours. Pour demander l’accès, la rectification ou la
        suppression de tes données, contacte l’administrateur du site. Les
        données Steam restent également soumises à la politique de
        confidentialité de Steam.
      </p>

      <p className="aide">
        <Link to="/">Retour à l’accueil</Link>
      </p>
    </section>
  )
}
