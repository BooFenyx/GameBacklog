import { Link } from 'react-router-dom'

export default function NotFound() {
  return (
    <section className="introuvable">
      <h1>Page introuvable</h1>
      <p>Cette route n’existe pas encore.</p>
      <p>
        <Link to="/accueil">Retour à l’accueil</Link>
      </p>
    </section>
  )
}
