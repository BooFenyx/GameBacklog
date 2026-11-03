import { Component, type ErrorInfo, type ReactNode } from 'react'

type Props = { children: ReactNode }
type State = { erreur: Error | null }

/**
 * Filet de sécurité du rendu : une donnée API inattendue ne doit pas laisser
 * un écran blanc en production. On journalise l'erreur et on propose un
 * rechargement complet, qui récupère l'état serveur.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { erreur: null }

  static getDerivedStateFromError(erreur: Error): State {
    return { erreur }
  }

  componentDidCatch(erreur: Error, info: ErrorInfo): void {
    console.error('Erreur de rendu GameBacklog', erreur, info)
  }

  render() {
    if (this.state.erreur) {
      return (
        <section className="chargement" role="alert">
          <p>Une erreur inattendue est survenue.</p>
          <button
            type="button"
            className="btn btn-principal"
            onClick={() => window.location.reload()}
          >
            Recharger la page
          </button>
        </section>
      )
    }

    return this.props.children
  }
}
