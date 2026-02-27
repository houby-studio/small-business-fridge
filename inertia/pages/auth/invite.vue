<script setup lang="ts">
import { Head, useForm } from '@inertiajs/vue3'
import GuestLayout from '~/layouts/GuestLayout.vue'
import Card from 'primevue/card'
import InputText from 'primevue/inputtext'
import Password from 'primevue/password'
import Button from 'primevue/button'
import Message from 'primevue/message'
import { useI18n } from '~/composables/use_i18n'

const props = defineProps<{
  token: string
  email: string
  role: 'customer' | 'supplier' | 'admin'
}>()

const { t } = useI18n()

const form = useForm({
  displayName: '',
  username: '',
  password: '',
  passwordConfirmation: '',
})

function submit() {
  form.post(`/register/invite/${props.token}`, {
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

          <Message v-if="form.hasErrors" severity="error" :closable="false">
            {{ t('auth.bootstrap_invalid') }}
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
              :invalid="!!form.errors.displayName"
              autocomplete="name"
              :placeholder="t('auth.bootstrap_display_name_placeholder')"
            />
          </div>

          <div class="flex flex-col gap-2">
            <label for="inviteUsername" class="text-sm font-medium text-zinc-300">
              {{ t('auth.bootstrap_username') }}
            </label>
            <InputText
              id="inviteUsername"
              v-model="form.username"
              :invalid="!!form.errors.username"
              autocomplete="username"
              :placeholder="t('auth.bootstrap_username_placeholder')"
            />
          </div>

          <div class="flex flex-col gap-2">
            <label for="invitePassword" class="text-sm font-medium text-zinc-300">
              {{ t('auth.bootstrap_password') }}
            </label>
            <Password
              inputId="invitePassword"
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
            <label for="invitePasswordConfirmation" class="text-sm font-medium text-zinc-300">
              {{ t('auth.bootstrap_password_confirm') }}
            </label>
            <Password
              inputId="invitePasswordConfirmation"
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
            :label="t('auth.invite_submit')"
            icon="pi pi-user-plus"
            :loading="form.processing"
            class="w-full"
          />
        </form>
      </template>
    </Card>
  </GuestLayout>
</template>
