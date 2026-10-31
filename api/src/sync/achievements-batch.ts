/** Jeu à traiter par l'étape `achievements`. */
export interface JeuSucces {
  gameId: number;
  appId: number;
}

export interface OptionsLotsSucces {
  /** Nombre de jeux manquants au début de la passe. */
  total: number;
  /** Taille maximale d'un lot. */
  batchSize: number;
  /**
   * Sélectionne le lot suivant. `dejaTentes` contient les `gameId` déjà
   * tentés dans ce run : ils doivent être exclus de la sélection.
   */
  selectionner: (
    dejaTentes: number[],
    limite: number,
  ) => Promise<JeuSucces[]>;
  /** Traite un jeu. Une exception le laisse manquant sans interrompre le lot. */
  traiter: (jeu: JeuSucces) => Promise<void>;
  /** Appelé après chaque jeu tenté, avec le cumul de la passe. */
  onProgression?: (processed: number) => Promise<void> | void;
  /** Appelé quand `traiter` échoue (429, réseau, etc.). */
  onEchec?: (jeu: JeuSucces, error: unknown) => void;
}

export interface ResultatLotsSucces {
  /** Jeux tentés (succès ou échec). */
  processed: number;
  /** Jeux traités sans erreur. */
  reussis: number;
}

/**
 * Traite les jeux manquants par lots jusqu'à épuisement du total.
 *
 * Les `gameId` déjà tentés sont mémorisés et exclus des lots suivants : un jeu
 * en échec reste manquant en base pour un prochain sync, mais n'est pas repris
 * en boucle dans le même run. Si un lot ne progresse pas du tout, la boucle
 * s'arrête pour éviter d'enchaîner des lots voués à l'échec.
 */
export async function traiterSuccesParLots(
  options: OptionsLotsSucces,
): Promise<ResultatLotsSucces> {
  const tentes = new Set<number>();
  let processed = 0;
  let reussis = 0;

  while (processed < options.total) {
    const limite = Math.min(options.batchSize, options.total - processed);
    const rows = await options.selectionner([...tentes], limite);
    if (rows.length === 0) break;

    let progresLot = 0;

    for (const row of rows) {
      tentes.add(row.gameId);
      try {
        await options.traiter(row);
        progresLot += 1;
        reussis += 1;
      } catch (error) {
        options.onEchec?.(row, error);
      }
      processed += 1;
      await options.onProgression?.(processed);
    }

    if (progresLot === 0) break;
  }

  return { processed, reussis };
}
