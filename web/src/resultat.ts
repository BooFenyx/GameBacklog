import { libelleActivite } from './activite'
import { formaterDuree } from './format'
import type { ResultatRecherche } from './search'

/** Score cosinus (0–1) → « 48 % ». */
export function formaterScore(score: number): string {
  return `${Math.round(score * 100)} %`
}

/**
 * Visuel large d'un jeu, construit depuis l'`appId` : les pochettes stockées
 * (`headerImageUrl`) font 460×215 et pixelisent en fond de héros. Le CDN Steam
 * expose `library_hero` (1920 px) pour la majorité des jeux ; l'appelant doit
 * prévoir un repli sur `headerImageUrl` quand l'image n'existe pas.
 */
export function urlHeros(appId: number): string {
  return `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}/library_hero.jpg`
}

/**
 * Phrase « pourquoi ce jeu maintenant », tirée des seules données disponibles :
 * jamais lancé, activité dérivée, temps de jeu. Aucune donnée inventée.
 */
export function pourquoiMaintenant(resultat: ResultatRecherche): {
  texte: string
  jamais: boolean
} {
  if (resultat.playtimeForever === 0) {
    return {
      texte: "Jamais lancé — une découverte qui t'attend.",
      jamais: true,
    }
  }

  const activite = libelleActivite(resultat)
  const temps = formaterDuree(resultat.playtimeForever)

  if (activite) {
    return { texte: `${activite} — ${temps} au compteur.`, jamais: false }
  }
  return { texte: `${temps} au compteur.`, jamais: false }
}
