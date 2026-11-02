import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    // Les fichiers partagent la même base : les exécuter en série évite qu'un
    // worker reprenne le job d'import d'un autre (la reprise au démarrage
    // sélectionne les jobs `pending` sans distinction d'utilisateur). Le pool
    // `threads` évite les crashes de workers fork Windows (0xC0000409) observés
    // quand plusieurs applications Nest tournent en même temps.
    pool: 'threads',
    fileParallelism: false,
    maxWorkers: 1,
  },
});
