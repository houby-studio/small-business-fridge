/// <reference path="../../adonisrc.ts" />
/// <reference path="../../config/inertia.ts" />

import '../css/app.css'
import 'primeicons/primeicons.css'
import { createSSRApp, h } from 'vue'
import type { DefineComponent } from 'vue'
import { createInertiaApp } from '@inertiajs/vue3'
import { resolvePageComponent } from '@adonisjs/inertia/helpers'
import PrimeVue from 'primevue/config'
import Aura from '@primeuix/themes/aura'
import ToastService from 'primevue/toastservice'
import ConfirmationService from 'primevue/confirmationservice'

const appName = import.meta.env.VITE_APP_NAME || 'Lednice IT'

createInertiaApp({
  progress: { color: '#cf112a' },

  title: (title) => (title ? `${title} | ${appName}` : appName),

  resolve: (name) => {
    return resolvePageComponent(
      `../pages/${name}.vue`,
      import.meta.glob<DefineComponent>('../pages/**/*.vue')
    )
  },

  setup({ el, App, props, plugin }) {
    createSSRApp({ render: () => h(App, props) })
      .use(plugin)
      .use(PrimeVue, {
        theme: {
          preset: Aura,
          options: {
            prefix: 'p',
            darkModeSelector: '[data-theme="dark"]',
            cssLayer: false,
          },
        },
      })
      .use(ToastService)
      .use(ConfirmationService)
      .mount(el)
  },
})