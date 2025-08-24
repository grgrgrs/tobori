// astro.config.mjs
// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';

export default defineConfig({
  integrations: [react()],
  vite: {
    server: {
      proxy: {
        // API routes that already begin with /api
        '/api': { target: 'http://127.0.0.1:8080', changeOrigin: true },

        // Non-/api endpoints your UI calls directly
        '/themes': { target: 'http://127.0.0.1:8080', changeOrigin: true },
        '/categories': { target: 'http://127.0.0.1:8080', changeOrigin: true },
        '/article_clusters': { target: 'http://127.0.0.1:8080', changeOrigin: true },


      },
    },
  },
});
