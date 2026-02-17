<script setup lang="ts">
import { Head } from '@inertiajs/vue3'
import GuestLayout from '~/layouts/GuestLayout.vue'
import Button from 'primevue/button'
</script>

<template>
  <GuestLayout>
    <Head title="Vítejte" />

    <div class="text-center">
      <Button
        as="a"
        href="/login"
        label="Přihlásit se"
        icon="pi pi-sign-in"
        class="w-full"
      />
    </div>
  </GuestLayout>
</template>
