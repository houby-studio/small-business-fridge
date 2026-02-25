<script setup lang="ts">
import Button from 'primevue/button'

defineProps<{ error: any }>()
</script>

<template>
  <div
    class="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-4 text-center dark:bg-zinc-950"
  >
    <span class="pi pi-times-circle mb-6 block text-8xl text-slate-300 dark:text-zinc-700" />
    <h1 class="mb-2 text-5xl font-bold text-slate-800 dark:text-zinc-100">500</h1>
    <p class="mb-8 text-lg text-slate-500 dark:text-zinc-400">
      {{ error?.message || 'Chyba serveru.' }}
    </p>
    <Button as="a" href="/" label="Zpět na úvod" icon="pi pi-home" />
  </div>
</template>
