<script setup lang="ts">
import { Head } from '@inertiajs/vue3'
import AppLayout from '~/layouts/AppLayout.vue'
import { useI18n } from '~/composables/useI18n'

const { t } = useI18n()
</script>

<template>
  <AppLayout>
    <Head :title="t('profile.title')" />
    <h1 class="text-2xl font-bold text-gray-900">{{ t('profile.heading') }}</h1>
    <p class="mt-2 text-gray-500">{{ t('profile.placeholder') }}</p>
  </AppLayout>
</template>
