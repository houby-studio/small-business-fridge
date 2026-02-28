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
  username: '',
  password: '',
  passwordConfirmation: '',
})

const displayNameMissing = computed(() => form.displayName.trim().length === 0)
const emailInvalid = computed(() => {
  if (form.email.length === 0) return false
  return !/.+@.+/.test(form.email.trim())
})
const usernameTooShort = computed(() => form.username.length > 0 && form.username.trim().length < 3)
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
const getFieldError = (field: string) =>
  form.errors[field as keyof typeof form.errors] || flashInputErrorsBag.value[field]?.[0]
const getFieldInvalid = (field: string) => !!getFieldError(field)
const firstErrorMessage = computed(
  () =>
    getFieldError('displayName') ||
    getFieldError('email') ||
    getFieldError('username') ||
    getFieldError('password') ||
    getFieldError('passwordConfirmation')
)
const submitDisabled = computed(
  () =>
    form.processing ||
    displayNameMissing.value ||
    form.email.trim().length === 0 ||
    emailInvalid.value ||
    form.username.trim().length < 3 ||
    form.password.length < 8 ||
    form.passwordConfirmation.length < 8 ||
    form.password !== form.passwordConfirmation
)

function submit() {
  form.post('/setup/bootstrap', {
    onError: (errors) => {
      const firstError =
        errors.displayName ||
        errors.email ||
        errors.username ||
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
    <Head :title="t('auth.bootstrap_title')" />

    <Card>
      <template #title>
        <h2 class="text-xl font-semibold text-zinc-100">{{ t('auth.bootstrap_heading') }}</h2>
      </template>
      <template #content>
        <p class="mb-5 text-sm text-zinc-400">{{ t('auth.bootstrap_intro') }}</p>

        <form @submit.prevent="submit" class="space-y-5">
          <Message v-if="firstErrorMessage" severity="error" :closable="false">
            {{ firstErrorMessage }}
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
              :invalid="getFieldInvalid('displayName')"
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
              :invalid="getFieldInvalid('email') || emailInvalid"
              autocomplete="email"
              :placeholder="t('auth.bootstrap_email_placeholder')"
            />
            <small v-if="emailInvalid" class="text-red-300">
              {{ t('auth.email_invalid') }}
            </small>
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
              :invalid="getFieldInvalid('username') || usernameTooShort"
              autocomplete="username"
              :placeholder="t('auth.bootstrap_username_placeholder')"
            />
            <small v-if="usernameTooShort" class="text-red-300">
              {{ t('auth.username_min_length') }}
            </small>
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
              :invalid="getFieldInvalid('password')"
              :feedback="false"
              toggleMask
              autocomplete="new-password"
              :placeholder="t('auth.bootstrap_password_placeholder')"
              inputClass="w-full"
              class="w-full"
            />
            <small v-if="passwordTooShort" class="text-red-300">
              {{ t('auth.password_min_length') }}
            </small>
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
              :invalid="getFieldInvalid('passwordConfirmation')"
              :feedback="false"
              toggleMask
              autocomplete="new-password"
              :placeholder="t('auth.bootstrap_password_confirm_placeholder')"
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
            :label="t('auth.bootstrap_submit')"
            icon="pi pi-check"
            :loading="form.processing"
            :disabled="submitDisabled"
            class="w-full"
          />
        </form>
      </template>
    </Card>
  </GuestLayout>
</template>
