import { defineConfig } from 'vite'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import inertia from '@adonisjs/inertia/vite'
import vue from '@vitejs/plugin-vue'
import adonisjs from '@adonisjs/vite/client'
import tailwindcss from '@tailwindcss/vite'

const currentDir = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [
    inertia(),
    vue(),
    adonisjs({
      entrypoints: ['inertia/css/app.css', 'inertia/app/app.ts'],
      reload: ['resources/views/**/*.edge'],
    }),
    tailwindcss(),
  ],

  resolve: {
    alias: {
      '~/': `${currentDir}/inertia/`,
    },
  },

  // PrimeVue 4 ships as native ESM. Excluding it from Vite's dep optimizer
  // prevents stale shared chunks (chunk-XXXXXXXX.js) that appear when Inertia's
  // lazy-loaded pages introduce new PrimeVue imports mid-session, triggering
  // re-optimization that invalidates already-cached chunk references.
  optimizeDeps: {
    exclude: ['primevue', '@primeuix/themes', '@primeuix/styled'],
  },
})
