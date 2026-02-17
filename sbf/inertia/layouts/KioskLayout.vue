<script setup lang="ts">
import Toast from 'primevue/toast'
</script>

<template>
  <div class="min-h-screen bg-gray-900 text-white" data-theme="dark">
    <Toast position="top-center" />
    <slot />
  </div>
</template>
