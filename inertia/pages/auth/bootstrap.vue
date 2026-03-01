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

const props = defineProps<{
  externalProviders?: Array<'microsoft' | 'discord'>
}>()

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
const getFieldError = (field: string) =>
  form.errors[field as keyof typeof form.errors] || flashInputErrorsBag.value[field]?.[0]
const getFieldInvalid = (field: string) => !!getFieldError(field)
const firstErrorMessage = computed(
  () =>
    getFieldError('displayName') ||
    getFieldError('email') ||
    getFieldError('password') ||
    getFieldError('passwordConfirmation')
)
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
function providerLabel(provider: 'microsoft' | 'discord'): string {
  return provider === 'microsoft' ? t('auth.sign_in_microsoft') : t('auth.sign_in_discord')
}

function providerIcon(provider: 'microsoft' | 'discord'): string {
  return provider === 'microsoft' ? 'pi pi-microsoft' : 'pi pi-discord'
}

function providerHref(provider: 'microsoft' | 'discord'): string {
  return `/auth/${provider}/redirect?intent=bootstrap`
}

function submit() {
  form.post('/setup/bootstrap', {
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

          <template v-if="(props.externalProviders?.length ?? 0) > 0">
            <div class="flex items-center gap-3 py-1">
              <div class="h-px flex-1 bg-zinc-700" />
              <span class="text-xs uppercase tracking-wide text-zinc-400">{{ t('auth.or') }}</span>
              <div class="h-px flex-1 bg-zinc-700" />
            </div>

            <a
              v-for="provider in props.externalProviders"
              :key="provider"
              :href="providerHref(provider)"
              class="inline-flex w-full items-center justify-center gap-2 rounded-md border border-zinc-600 px-4 py-2 text-sm font-medium text-zinc-100 transition hover:border-zinc-500 hover:bg-zinc-800"
            >
              <i :class="providerIcon(provider)" aria-hidden="true" />
              <span>{{
                t('auth.bootstrap_submit_oauth', { provider: providerLabel(provider) })
              }}</span>
            </a>
          </template>
        </form>
      </template>
    </Card>
  </GuestLayout>
</template>
