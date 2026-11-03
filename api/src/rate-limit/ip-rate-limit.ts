/**
 * Limiteur de fréquence par clé (adresse IP pour les routes anonymes).
 *
 * Les routes `/api/auth/*` sont appelées avant l'ouverture de session : le
 * limiteur par `steamId` ne peut pas s'appliquer. Ce compteur en mémoire
 * arrête les boucles anonymes sans écrire en base à chaque requête.
 *
 * État par instance et perdu au redémarrage, comme les autres limiteurs : il
 * complète le quota par utilisateur, il ne le remplace pas.
 */
export class IpRateLimit {
  private readonly appels = new Map<string, number[]>();
  private decisions = 0;

  constructor(
    private readonly max: number,
    private readonly windowMs = 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * Clé de limitation pour une requête HTTP.
   *
   * Derrière Vercel → Render, `req.ip` avec `trust proxy = 1` peut désigner
   * l'IP de sortie du proxy, partagée par tous les utilisateurs. On privilégie
   * donc la première entrée de `X-Forwarded-For` (le client d'origine), avec
   * repli sur `req.ip`. La valeur reste déclarative : ce limiteur est une
   * protection de volume, pas une authentification.
   */
  static cleClient(req: {
    headers?: Record<string, string | string[] | undefined>;
    ip?: string;
    socket?: { remoteAddress?: string };
  }): string {
    const forwarded = req.headers?.['x-forwarded-for'];
    const valeur = Array.isArray(forwarded) ? forwarded[0] : forwarded;
    const premier =
      typeof valeur === 'string' ? valeur.split(',')[0]?.trim() : '';
    return premier || req.ip || req.socket?.remoteAddress || 'inconnu';
  }

  /**
   * Réserve une place pour `cle`. Renvoie 0 si la requête passe, sinon le
   * nombre de millisecondes à attendre avant la prochaine place.
   */
  retryAfterMs(cle: string): number {
    const courant = this.now();
    const recents = (this.appels.get(cle) ?? []).filter(
      (instant) => courant - instant < this.windowMs,
    );

    if (recents.length >= this.max) {
      this.appels.set(cle, recents);
      return Math.max(1, this.windowMs - (courant - recents[0]));
    }

    recents.push(courant);
    this.appels.set(cle, recents);
    this.purger(courant);
    return 0;
  }

  /** Évite qu'une clé inactive conserve ses appels indéfiniment. */
  private purger(courant: number): void {
    this.decisions += 1;
    if (this.decisions % 100 !== 0) return;

    for (const [cle, appels] of this.appels) {
      const dernier = appels[appels.length - 1] ?? 0;
      if (courant - dernier >= this.windowMs) {
        this.appels.delete(cle);
      }
    }
  }
}
