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
  token: string
  email: string
  role: 'customer' | 'supplier' | 'admin'
}>()

const { t } = useI18n()
const toast = useToast()
const page = usePage<SharedProps>()

const form = useForm({
  displayName: '',
  password: '',
  passwordConfirmation: '',
})

const displayNameMissing = computed(() => form.displayName.trim().length === 0)
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
    getFieldError('password') ||
    getFieldError('passwordConfirmation')
)
const submitDisabled = computed(
  () =>
    form.processing ||
    displayNameMissing.value ||
    form.password.length < 8 ||
    form.passwordConfirmation.length < 8 ||
    form.password !== form.passwordConfirmation
)

function submit() {
  form.post(`/register/invite/${props.token}`, {
    onError: (errors) => {
      const firstError =
        errors.displayName ||
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
    <Head :title="t('auth.invite_title')" />

    <Card>
      <template #content>
        <form @submit.prevent="submit" class="space-y-5">
          <div class="space-y-1">
            <h2 class="text-xl font-semibold text-zinc-100">{{ t('auth.invite_heading') }}</h2>
            <p class="text-sm text-zinc-400">{{ t('auth.invite_intro') }}</p>
          </div>

          <Message v-if="firstErrorMessage" severity="error" :closable="false">
            {{ firstErrorMessage }}
          </Message>

          <div class="flex flex-col gap-2">
            <label for="inviteEmail" class="text-sm font-medium text-zinc-300">
              {{ t('auth.invite_email') }}
            </label>
            <InputText id="inviteEmail" :model-value="email" disabled />
          </div>

          <div class="flex flex-col gap-2">
            <label for="inviteRole" class="text-sm font-medium text-zinc-300">
              {{ t('auth.invite_role') }}
            </label>
            <InputText id="inviteRole" :model-value="t(`auth.invite_role_${role}`)" disabled />
          </div>

          <div class="flex flex-col gap-2">
            <label for="inviteDisplayName" class="text-sm font-medium text-zinc-300">
              {{ t('auth.bootstrap_display_name') }}
            </label>
            <InputText
              id="inviteDisplayName"
              v-model="form.displayName"
              :invalid="getFieldInvalid('displayName')"
              autocomplete="name"
              :placeholder="t('auth.bootstrap_display_name_placeholder')"
            />
          </div>

          <div class="flex flex-col gap-2">
            <label for="invitePassword" class="text-sm font-medium text-zinc-300">
              {{ t('auth.bootstrap_password') }}
            </label>
            <Password
              inputId="invitePassword"
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
            <label for="invitePasswordConfirmation" class="text-sm font-medium text-zinc-300">
              {{ t('auth.bootstrap_password_confirm') }}
            </label>
            <Password
              inputId="invitePasswordConfirmation"
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
            :label="t('auth.invite_submit')"
            icon="pi pi-user-plus"
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
