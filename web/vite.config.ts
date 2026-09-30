import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Rend `web` et `api` de même origine en développement, pour que le cookie
    // de session fonctionne en `sameSite=Lax` sur http://localhost.
    // En production Render les deux sont sur des origines distinctes : le CORS
    // de `api/src/app.setup.ts` prend alors le relais.
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
})
