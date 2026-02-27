<script setup lang="ts">
import { Head, useForm } from '@inertiajs/vue3'
import GuestLayout from '~/layouts/GuestLayout.vue'
import Card from 'primevue/card'
import Password from 'primevue/password'
import Button from 'primevue/button'
import Message from 'primevue/message'
import { useI18n } from '~/composables/use_i18n'

const props = defineProps<{ token: string }>()
const { t } = useI18n()

const form = useForm({
  password: '',
  passwordConfirmation: '',
})

function submit() {
  form.post(`/reset-password/${props.token}`, {
    onFinish: () => form.reset('password', 'passwordConfirmation'),
  })
}
</script>

<template>
  <GuestLayout>
    <Head :title="t('auth.reset_password_title')" />

    <Card>
      <template #content>
        <form @submit.prevent="submit" class="space-y-5">
          <h2 class="text-xl font-semibold text-zinc-100">
            {{ t('auth.reset_password_heading') }}
          </h2>

          <Message v-if="form.hasErrors" severity="error" :closable="false">
            {{ t('auth.bootstrap_invalid') }}
          </Message>

          <div class="flex flex-col gap-2">
            <label for="resetPassword" class="text-sm font-medium text-zinc-300">
              {{ t('auth.bootstrap_password') }}
            </label>
            <Password
              inputId="resetPassword"
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
            <label for="resetPasswordConfirmation" class="text-sm font-medium text-zinc-300">
              {{ t('auth.bootstrap_password_confirm') }}
            </label>
            <Password
              inputId="resetPasswordConfirmation"
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
            :label="t('auth.reset_password_submit')"
            icon="pi pi-key"
            :loading="form.processing"
            class="w-full"
          />
        </form>
      </template>
    </Card>
  </GuestLayout>
</template>
