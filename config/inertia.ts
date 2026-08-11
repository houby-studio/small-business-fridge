import { defineConfig } from '@adonisjs/inertia'
import env from '#start/env'

const inertiaConfig = defineConfig({
  /**
   * Path to the Edge view that will be used as the root view for Inertia responses
   */
  rootView: 'inertia_layout',

  /**
   * Left undefined by default so the version is hashed from the Vite manifest and a
   * deploy pushes clients onto the new bundle. Set ASSETS_VERSION to pin it — useful in
   * CI, where a stale `public/assets` manifest can otherwise be picked up by test runs.
   */
  assetsVersion: env.get('ASSETS_VERSION') || undefined,
})

export default inertiaConfig
