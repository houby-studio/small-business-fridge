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
import { definePreset } from '@primeuix/themes'
import ToastService from 'primevue/toastservice'
import ConfirmationService from 'primevue/confirmationservice'

const appName = import.meta.env.VITE_APP_NAME || 'Lednice IT'

// ─── Custom SBF theme preset ─────────────────────────────────────────────────
// Extends Aura with the Czech red (#cf112a) brand palette and refined tokens
const SBFPreset = definePreset(Aura, {
  primitive: {
    borderRadius: {
      none: '0',
      xs: '4px',
      sm: '6px',
      md: '8px',
      lg: '12px',
      xl: '16px',
    },
  },
  semantic: {
    primary: {
      50: '#fff0f1',
      100: '#ffe0e3',
      200: '#ffc5cb',
      300: '#ff9aa5',
      400: '#ff5f73',
      500: '#f82843',
      600: '#e5112d',
      700: '#cf112a',
      800: '#a80e22',
      900: '#8c1321',
      950: '#4f0611',
    },
    colorScheme: {
      light: {
        surface: {
          0: '#ffffff',
          50: '{slate.50}',
          100: '{slate.100}',
          200: '{slate.200}',
          300: '{slate.300}',
          400: '{slate.400}',
          500: '{slate.500}',
          600: '{slate.600}',
          700: '{slate.700}',
          800: '{slate.800}',
          900: '{slate.900}',
          950: '{slate.950}',
        },
      },
      dark: {
        surface: {
          0: '#ffffff',
          50: '#fafafa',
          100: '#f4f4f5',
          200: '#e4e4e7',
          300: '#d4d4d8',
          400: '#a1a1aa',
          500: '#71717a',
          600: '#52525b',
          700: '#3f3f46',
          800: '#27272a',
          900: '#18181b',
          950: '#09090b',
        },
      },
    },
  },
})

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
          preset: SBFPreset,
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
