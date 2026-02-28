<script setup lang="ts">
import { Head, useForm } from '@inertiajs/vue3'
import GuestLayout from '~/layouts/GuestLayout.vue'
import Card from 'primevue/card'
import Password from 'primevue/password'
import Button from 'primevue/button'
import Message from 'primevue/message'
import { computed } from 'vue'
import { useToast } from 'primevue/usetoast'
import { useI18n } from '~/composables/use_i18n'

const props = defineProps<{ token: string }>()
const { t } = useI18n()
const toast = useToast()

const form = useForm({
  password: '',
  passwordConfirmation: '',
})

const passwordTooShort = computed(() => form.password.length > 0 && form.password.length < 8)
const confirmationTooShort = computed(
  () => form.passwordConfirmation.length > 0 && form.passwordConfirmation.length < 8
)
const passwordsMismatch = computed(
  () => form.passwordConfirmation.length > 0 && form.password !== form.passwordConfirmation
)
const submitDisabled = computed(
  () =>
    form.processing ||
    form.password.length < 8 ||
    form.passwordConfirmation.length < 8 ||
    form.password !== form.passwordConfirmation
)

const firstErrorMessage = computed(() => form.errors.password || form.errors.passwordConfirmation)

function submit() {
  form.post(`/reset-password/${props.token}`, {
    onError: (errors) => {
      const firstError =
        errors.password || errors.passwordConfirmation || t('auth.bootstrap_invalid')
      toast.add({
        severity: 'error',
        summary: firstError,
        life: 4500,
      })
    },
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

          <Message v-if="firstErrorMessage" severity="error" :closable="false">
            {{ firstErrorMessage }}
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
            <small v-if="passwordTooShort" class="text-red-300">
              {{ t('auth.password_min_length') }}
            </small>
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
            <small v-if="confirmationTooShort" class="text-red-300">
              {{ t('auth.password_min_length') }}
            </small>
            <small v-if="passwordsMismatch" class="text-red-300">
              {{ t('auth.bootstrap_password_mismatch') }}
            </small>
          </div>

          <Button
            type="submit"
            :label="t('auth.reset_password_submit')"
            icon="pi pi-key"
            :loading="form.processing"
            :disabled="submitDisabled"
            class="w-full"
          />

          <div class="text-sm">
            <a href="/login" class="text-zinc-300 hover:text-zinc-100">
              {{ t('auth.back_to_login_link') }}
            </a>
          </div>
        </form>
      </template>
    </Card>
  </GuestLayout>
</template>
