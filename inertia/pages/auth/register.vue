<script setup lang="ts">
import { Head, useForm, usePage } from '@inertiajs/vue3'
import GuestLayout from '~/layouts/GuestLayout.vue'
import Card from 'primevue/card'
import InputText from 'primevue/inputtext'
import Password from 'primevue/password'
import Button from 'primevue/button'
import Message from 'primevue/message'
import { computed } from 'vue'
import { useToast } from 'primevue/usetoast'
import { useI18n } from '~/composables/use_i18n'
import type { SharedProps } from '~/types'

const { t } = useI18n()
const toast = useToast()
const page = usePage<SharedProps>()
const form = useForm({
  displayName: '',
  email: '',
  password: '',
  passwordConfirmation: '',
})

const displayNameMissing = computed(() => form.displayName.trim().length === 0)
const emailInvalid = computed(() => {
  if (form.email.length === 0) return false
  return !/.+@.+/.test(form.email.trim())
})
const passwordTooShort = computed(() => form.password.length > 0 && form.password.length < 8)
const confirmationTooShort = computed(
  () => form.passwordConfirmation.length > 0 && form.passwordConfirmation.length < 8
)
const passwordsMismatch = computed(
  () => form.passwordConfirmation.length > 0 && form.password !== form.passwordConfirmation
)
const flashInputErrorsBag = computed(
  () =>
    (((page.props.flash as any)?.inputErrorsBag ?? {}) as Record<string, string[] | undefined>) ||
    {}
)
const getFieldError = (field: string) => {
  return form.errors[field as keyof typeof form.errors] || flashInputErrorsBag.value[field]?.[0]
}
const getFieldInvalid = (field: string) => !!getFieldError(field)
const submitDisabled = computed(
  () =>
    form.processing ||
    displayNameMissing.value ||
    form.email.trim().length === 0 ||
    emailInvalid.value ||
    form.password.length < 8 ||
    form.passwordConfirmation.length < 8 ||
    form.password !== form.passwordConfirmation
)
const firstErrorMessage = computed(
  () =>
    getFieldError('displayName') ||
    getFieldError('email') ||
    getFieldError('password') ||
    getFieldError('passwordConfirmation')
)

function submit() {
  form.post('/register', {
    onError: (errors) => {
      const firstError =
        errors.displayName ||
        errors.email ||
        errors.password ||
        errors.passwordConfirmation ||
        t('auth.bootstrap_invalid')

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
    <Head :title="t('auth.register_title')" />

    <Card>
      <template #content>
        <form @submit.prevent="submit" class="space-y-5">
          <h2 class="text-xl font-semibold text-zinc-100">{{ t('auth.register_heading') }}</h2>

          <Message v-if="firstErrorMessage" severity="error" :closable="false">
            {{ firstErrorMessage }}
          </Message>

          <div class="flex flex-col gap-2">
            <label for="registerDisplayName" class="text-sm font-medium text-zinc-300">
              {{ t('auth.bootstrap_display_name') }}
            </label>
            <InputText
              id="registerDisplayName"
              v-model="form.displayName"
              :invalid="getFieldInvalid('displayName')"
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
              :invalid="getFieldInvalid('email') || emailInvalid"
              autocomplete="email"
            />
            <small v-if="emailInvalid" class="text-red-300">
              {{ t('auth.email_invalid') }}
            </small>
          </div>

          <div class="flex flex-col gap-2">
            <label for="registerPassword" class="text-sm font-medium text-zinc-300">
              {{ t('auth.bootstrap_password') }}
            </label>
            <Password
              inputId="registerPassword"
              v-model="form.password"
              :invalid="getFieldInvalid('password')"
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
            <label for="registerPasswordConfirmation" class="text-sm font-medium text-zinc-300">
              {{ t('auth.bootstrap_password_confirm') }}
            </label>
            <Password
              inputId="registerPasswordConfirmation"
              v-model="form.passwordConfirmation"
              :invalid="getFieldInvalid('passwordConfirmation')"
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
            :label="t('auth.register_submit')"
            icon="pi pi-user-plus"
            :loading="form.processing"
            :disabled="submitDisabled"
            class="w-full"
          />

          <div class="text-sm">
            <a href="/login" class="text-zinc-300 hover:text-zinc-100">
              {{ t('auth.login_instead_link') }}
            </a>
          </div>
        </form>
      </template>
    </Card>
  </GuestLayout>
</template>
