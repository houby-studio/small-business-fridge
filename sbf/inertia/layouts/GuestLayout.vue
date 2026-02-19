<script setup lang="ts">
import Toast from 'primevue/toast'
import { useFlash } from '~/composables/use_flash'

useFlash()
</script>

<template>
  <!-- Subtle gradient background — two-tone from primary tint to neutral -->
  <div
    class="sbf-guest-bg relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-12"
  >
    <Toast position="top-right" />

    <!-- Decorative blurred orbs for depth -->
    <div
      class="pointer-events-none absolute -top-32 left-1/2 h-96 w-96 -translate-x-1/2 rounded-full opacity-20 blur-3xl"
      style="background: radial-gradient(circle, #cf112a 0%, transparent 70%)"
      aria-hidden="true"
    />

    <div class="relative z-10 w-full max-w-md">
      <!-- Brand header -->
      <div class="mb-8 text-center">
        <div class="mb-3 inline-flex items-center justify-center">
          <span
            class="inline-flex h-12 w-12 items-center justify-center rounded-2xl text-white shadow-lg"
            style="background: linear-gradient(135deg, #cf112a 0%, #e8334a 100%)"
          >
            <span class="pi pi-shopping-cart text-xl" />
          </span>
        </div>
        <h1 class="text-3xl font-bold tracking-tight text-slate-900">Lednice IT</h1>
        <p class="mt-1.5 text-sm text-slate-500">Sdílení nápojů a svačin</p>
      </div>

      <!-- Card wrapper with glass effect -->
      <div
        class="rounded-2xl border border-slate-200/80 bg-white/90 p-8 shadow-xl shadow-slate-200/50 backdrop-blur-sm"
      >
        <slot />
      </div>
    </div>
  </div>
</template>
