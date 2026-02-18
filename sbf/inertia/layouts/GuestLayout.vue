<script setup lang="ts">
import Toast from 'primevue/toast'
import { useFlash } from '~/composables/use_flash'

useFlash()
</script>

<template>
  <div class="flex min-h-screen items-center justify-center bg-gray-100 px-4 py-12">
    <Toast position="top-right" />
    <div class="w-full max-w-md">
      <div class="mb-8 text-center">
        <h1 class="text-3xl font-bold text-gray-900">Lednice IT</h1>
        <p class="mt-2 text-sm text-gray-500">Sdílení nápojů a svačin</p>
      </div>
      <slot />
    </div>
  </div>
</template>
