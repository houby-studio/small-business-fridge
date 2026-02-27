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
  form.post('/register', {
    onFinish: () => form.reset('password', 'passwordConfirmation'),
  })
}
</script>

<template>
  <GuestLayout>
    <Head :title="t('auth.register_title')" />

    <Card>
      <template #content>
        <form @submit.prevent="submit" class="space-y-5">
          <h2 class="text-xl font-semibold text-zinc-100">{{ t('auth.register_heading') }}</h2>

          <Message v-if="form.hasErrors" severity="error" :closable="false">
            {{ t('auth.bootstrap_invalid') }}
          </Message>

          <div class="flex flex-col gap-2">
            <label for="registerDisplayName" class="text-sm font-medium text-zinc-300">
              {{ t('auth.bootstrap_display_name') }}
            </label>
            <InputText
              id="registerDisplayName"
              v-model="form.displayName"
              :invalid="!!form.errors.displayName"
              autocomplete="name"
            />
          </div>

          <div class="flex flex-col gap-2">
            <label for="registerEmail" class="text-sm font-medium text-zinc-300">
              {{ t('auth.bootstrap_email') }}
            </label>
            <InputText
              id="registerEmail"
              v-model="form.email"
              :invalid="!!form.errors.email"
              autocomplete="email"
            />
          </div>

          <div class="flex flex-col gap-2">
            <label for="registerUsername" class="text-sm font-medium text-zinc-300">
              {{ t('auth.bootstrap_username') }}
            </label>
            <InputText
              id="registerUsername"
              v-model="form.username"
              :invalid="!!form.errors.username"
              autocomplete="username"
            />
          </div>

          <div class="flex flex-col gap-2">
            <label for="registerPassword" class="text-sm font-medium text-zinc-300">
              {{ t('auth.bootstrap_password') }}
            </label>
            <Password
              inputId="registerPassword"
              v-model="form.password"
              :invalid="!!form.errors.password"
              :feedback="false"
              toggleMask
              autocomplete="new-password"
              inputClass="w-full"
              class="w-full"
            />
          </div>

          <div class="flex flex-col gap-2">
            <label for="registerPasswordConfirmation" class="text-sm font-medium text-zinc-300">
              {{ t('auth.bootstrap_password_confirm') }}
            </label>
            <Password
              inputId="registerPasswordConfirmation"
              v-model="form.passwordConfirmation"
              :invalid="!!form.errors.passwordConfirmation"
              :feedback="false"
              toggleMask
              autocomplete="new-password"
              inputClass="w-full"
              class="w-full"
            />
          </div>

          <Button
            type="submit"
            :label="t('auth.register_submit')"
            icon="pi pi-user-plus"
            :loading="form.processing"
            class="w-full"
          />
        </form>
      </template>
    </Card>
  </GuestLayout>
</template>
