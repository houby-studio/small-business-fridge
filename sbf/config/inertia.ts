import { defineConfig } from '@adonisjs/inertia'
import type { InferSharedProps } from '@adonisjs/inertia/types'

const inertiaConfig = defineConfig({
  /**
   * Path to the Edge view that will be used as the root view for Inertia responses
   */
  rootView: 'inertia_layout',

  /**
   * Data that should be shared with all rendered pages
   */
  sharedData: {
    user: (ctx) => ctx.inertia.always(() => {
      if (!ctx.auth?.user) return null
      return {
        id: ctx.auth.user.id,
        displayName: ctx.auth.user.displayName,
        email: ctx.auth.user.email,
        role: ctx.auth.user.role,
        isKiosk: ctx.auth.user.isKiosk,
        colorMode: ctx.auth.user.colorMode,
        keypadId: ctx.auth.user.keypadId,
      }
    }),
    flash: (ctx) => ctx.inertia.always(() => {
      return ctx.session?.flashMessages.all() ?? {}
    }),
  },

  /**
   * Options for the server-side rendering
   */
  ssr: {
    enabled: true,
    entrypoint: 'inertia/app/ssr.ts',
  },
})

export default inertiaConfig

declare module '@adonisjs/inertia/types' {
  export interface SharedProps extends InferSharedProps<typeof inertiaConfig> {}
}
