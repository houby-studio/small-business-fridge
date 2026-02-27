<script setup lang="ts">
import { Head, useForm } from '@inertiajs/vue3'
import GuestLayout from '~/layouts/GuestLayout.vue'
import Card from 'primevue/card'
import InputText from 'primevue/inputtext'
import Password from 'primevue/password'
import Button from 'primevue/button'
import Message from 'primevue/message'
import { useI18n } from '~/composables/use_i18n'

const { t } = useI18n()

const form = useForm({
  displayName: '',
  email: '',
  username: '',
  password: '',
  passwordConfirmation: '',
})

function submit() {
  form.post('/setup/bootstrap', {
    onFinish: () => form.reset('password', 'passwordConfirmation'),
  })
}
</script>

<template>
  <GuestLayout>
    <Head :title="t('auth.bootstrap_title')" />

    <Card>
      <template #title>
        <h2 class="text-xl font-semibold text-zinc-100">{{ t('auth.bootstrap_heading') }}</h2>
      </template>
      <template #content>
        <p class="mb-5 text-sm text-zinc-400">{{ t('auth.bootstrap_intro') }}</p>

        <form @submit.prevent="submit" class="space-y-5">
          <Message v-if="Object.keys(form.errors).length > 0" severity="error" :closable="false">
            {{ t('auth.bootstrap_invalid') }}
          </Message>

          <div class="flex flex-col gap-2">
            <label
              for="bootstrapDisplayName"
              class="text-sm font-medium text-gray-700 dark:text-zinc-300"
            >
              {{ t('auth.bootstrap_display_name') }}
            </label>
            <InputText
              id="bootstrapDisplayName"
              v-model="form.displayName"
              :invalid="!!form.errors.displayName"
              autocomplete="name"
              :placeholder="t('auth.bootstrap_display_name_placeholder')"
            />
          </div>

          <div class="flex flex-col gap-2">
            <label
              for="bootstrapEmail"
              class="text-sm font-medium text-gray-700 dark:text-zinc-300"
            >
              {{ t('auth.bootstrap_email') }}
            </label>
            <InputText
              id="bootstrapEmail"
              v-model="form.email"
              :invalid="!!form.errors.email"
              autocomplete="email"
              :placeholder="t('auth.bootstrap_email_placeholder')"
            />
          </div>

          <div class="flex flex-col gap-2">
            <label
              for="bootstrapUsername"
              class="text-sm font-medium text-gray-700 dark:text-zinc-300"
            >
              {{ t('auth.bootstrap_username') }}
            </label>
            <InputText
              id="bootstrapUsername"
              v-model="form.username"
              :invalid="!!form.errors.username"
              autocomplete="username"
              :placeholder="t('auth.bootstrap_username_placeholder')"
            />
          </div>

          <div class="flex flex-col gap-2">
            <label
              for="bootstrapPassword"
              class="text-sm font-medium text-gray-700 dark:text-zinc-300"
            >
              {{ t('auth.bootstrap_password') }}
            </label>
            <Password
              inputId="bootstrapPassword"
              v-model="form.password"
              :invalid="!!form.errors.password"
              :feedback="false"
              toggleMask
              autocomplete="new-password"
              :placeholder="t('auth.bootstrap_password_placeholder')"
              inputClass="w-full"
              class="w-full"
            />
          </div>

          <div class="flex flex-col gap-2">
            <label
              for="bootstrapPasswordConfirmation"
              class="text-sm font-medium text-gray-700 dark:text-zinc-300"
            >
              {{ t('auth.bootstrap_password_confirm') }}
            </label>
            <Password
              inputId="bootstrapPasswordConfirmation"
              v-model="form.passwordConfirmation"
              :invalid="!!form.errors.passwordConfirmation"
              :feedback="false"
              toggleMask
              autocomplete="new-password"
              :placeholder="t('auth.bootstrap_password_confirm_placeholder')"
              inputClass="w-full"
              class="w-full"
            />
          </div>

          <Button
            type="submit"
            :label="t('auth.bootstrap_submit')"
            icon="pi pi-check"
            :loading="form.processing"
            class="w-full"
          />
        </form>
      </template>
    </Card>
  </GuestLayout>
</template>
