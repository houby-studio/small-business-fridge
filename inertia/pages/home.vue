<script setup lang="ts">
import { Head } from '@inertiajs/vue3'
import GuestLayout from '~/layouts/GuestLayout.vue'
import Button from 'primevue/button'
import { useI18n } from '~/composables/use_i18n'

const { t } = useI18n()
</script>

<template>
  <GuestLayout>
    <Head :title="t('common.welcome')" />

    <div class="text-center">
      <Button
        as="a"
        href="/login"
        :label="t('common.sign_in')"
        icon="pi pi-sign-in"
        class="w-full"
      />
    </div>
  </GuestLayout>
</template>
