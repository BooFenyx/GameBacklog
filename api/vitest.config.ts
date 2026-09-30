import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    globals: true,
    root: './',
    include: ['**/*.spec.ts'],
    exclude: [...configDefaults.exclude, '**/*.e2e-spec.ts'],
  },
});
