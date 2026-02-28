<script setup lang="ts">
import { Head, useForm, usePage } from '@inertiajs/vue3'
import GuestLayout from '~/layouts/GuestLayout.vue'
import Card from 'primevue/card'
import InputText from 'primevue/inputtext'
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
  email: '',
})

const emailInvalid = computed(() => {
  if (form.email.length === 0) return false
  return !/.+@.+/.test(form.email.trim())
})
const flashInputErrorsBag = computed(
  () =>
    (((page.props.flash as any)?.inputErrorsBag ?? {}) as Record<string, string[] | undefined>) ||
    {}
)
const emailError = computed(() => form.errors.email || flashInputErrorsBag.value.email?.[0])
const submitDisabled = computed(
  () => form.processing || form.email.trim().length === 0 || emailInvalid.value
)

function submit() {
  form.post('/forgot-password', {
    onError: (errors) => {
      toast.add({
        severity: 'error',
        summary: errors.email || t('auth.bootstrap_invalid'),
        life: 4500,
      })
    },
  })
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

          <Message v-if="emailError" severity="error" :closable="false">
            {{ emailError }}
          </Message>

          <div class="flex flex-col gap-2">
            <label for="forgotEmail" class="text-sm font-medium text-zinc-300">
              {{ t('auth.bootstrap_email') }}
            </label>
            <InputText
              id="forgotEmail"
              v-model="form.email"
              :invalid="!!emailError || emailInvalid"
              autocomplete="email"
            />
            <small v-if="emailInvalid" class="text-red-300">
              {{ t('auth.email_invalid') }}
            </small>
          </div>

          <Button
            type="submit"
            :label="t('auth.forgot_password_submit')"
            icon="pi pi-envelope"
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
