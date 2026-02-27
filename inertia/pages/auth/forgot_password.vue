<script setup lang="ts">
import { Head, useForm } from '@inertiajs/vue3'
import GuestLayout from '~/layouts/GuestLayout.vue'
import Card from 'primevue/card'
import InputText from 'primevue/inputtext'
import Button from 'primevue/button'
import Message from 'primevue/message'
import { useI18n } from '~/composables/use_i18n'

const { t } = useI18n()
const form = useForm({
  email: '',
})

function submit() {
  form.post('/forgot-password')
}
</script>

<template>
  <GuestLayout>
    <Head :title="t('auth.forgot_password_title')" />

    <Card>
      <template #content>
        <form @submit.prevent="submit" class="space-y-5">
          <h2 class="text-xl font-semibold text-zinc-100">
            {{ t('auth.forgot_password_heading') }}
          </h2>
          <p class="text-sm text-zinc-400">{{ t('auth.forgot_password_intro') }}</p>

          <Message v-if="form.errors.email" severity="error" :closable="false">
            {{ form.errors.email }}
          </Message>

          <div class="flex flex-col gap-2">
            <label for="forgotEmail" class="text-sm font-medium text-zinc-300">
              {{ t('auth.bootstrap_email') }}
            </label>
            <InputText
              id="forgotEmail"
              v-model="form.email"
              :invalid="!!form.errors.email"
              autocomplete="email"
            />
          </div>

          <Button
            type="submit"
            :label="t('auth.forgot_password_submit')"
            icon="pi pi-envelope"
            :loading="form.processing"
            class="w-full"
          />
        </form>
      </template>
    </Card>
  </GuestLayout>
</template>
