<script setup lang="ts">
import { Head, useForm } from '@inertiajs/vue3'
import GuestLayout from '~/layouts/GuestLayout.vue'
import Card from 'primevue/card'
import InputText from 'primevue/inputtext'
import Password from 'primevue/password'
import Button from 'primevue/button'
import Checkbox from 'primevue/checkbox'
import Divider from 'primevue/divider'
import Message from 'primevue/message'
import { useI18n } from '~/composables/use_i18n'

defineProps<{
  externalProviders?: Array<'microsoft' | 'discord'>
  allowLocalRegistration?: boolean
  localEnabled?: boolean
}>()

const { t } = useI18n()

const form = useForm({
  email: '',
  password: '',
  rememberMe: false,
})

function submit() {
  form.post('/login', {
    onFinish: () => form.reset('password'),
  })
}
function providerLabel(provider: 'microsoft' | 'discord'): string {
  return provider === 'microsoft' ? t('auth.sign_in_microsoft') : t('auth.sign_in_discord')
}

function providerIcon(provider: 'microsoft' | 'discord'): string {
  return provider === 'microsoft' ? 'pi pi-microsoft' : 'pi pi-discord'
}

function providerHref(provider: 'microsoft' | 'discord'): string {
  return `/auth/${provider}/redirect`
}
</script>

<template>
  <GuestLayout>
    <Head :title="t('auth.title')" />

    <Card>
      <template #content>
        <form @submit.prevent="submit" class="space-y-5">
          <Message
            v-if="form.errors.email || form.errors.password"
            severity="error"
            :closable="false"
          >
            {{ form.errors.email || form.errors.password }}
          </Message>

          <div class="flex flex-col gap-2">
            <label for="email" class="text-sm font-medium text-gray-700 dark:text-zinc-300">
              {{ t('auth.bootstrap_email') }}
            </label>
            <InputText
              id="email"
              v-model="form.email"
              :invalid="!!form.errors.email"
              autocomplete="email"
              autofocus
              :placeholder="t('auth.bootstrap_email_placeholder')"
            />
          </div>

          <div class="flex flex-col gap-2">
            <label for="password" class="text-sm font-medium text-gray-700 dark:text-zinc-300">
              {{ t('auth.password') }}
            </label>
            <Password
              inputId="password"
              v-model="form.password"
              :invalid="!!form.errors.password"
              :feedback="false"
              toggleMask
              autocomplete="current-password"
              :placeholder="t('auth.password_placeholder')"
              inputClass="w-full"
              class="w-full"
            />
          </div>

          <div class="flex items-center gap-2">
            <Checkbox inputId="rememberMe" v-model="form.rememberMe" :binary="true" />
            <label for="rememberMe" class="cursor-pointer text-sm text-gray-700 dark:text-zinc-300">
              {{ t('auth.remember_me') }}
            </label>
          </div>

          <div v-if="localEnabled !== false" class="flex items-center justify-between text-sm">
            <a href="/forgot-password" class="text-zinc-300 hover:text-zinc-100">
              {{ t('auth.forgot_password_link') }}
            </a>
            <a
              v-if="allowLocalRegistration"
              href="/register"
              class="text-zinc-300 hover:text-zinc-100"
            >
              {{ t('auth.register_link') }}
            </a>
          </div>

          <Button
            v-if="localEnabled !== false"
            type="submit"
            :label="t('auth.submit')"
            icon="pi pi-sign-in"
            :loading="form.processing"
            :disabled="form.processing || !form.email.trim() || !form.password"
            class="w-full"
          />

          <template v-if="(externalProviders?.length ?? 0) > 0">
            <Divider class="text-gray-400 dark:text-zinc-500" align="center">
              <span
                class="text-sm text-gray-400 dark:text-zinc-500 bg-zinc-900/90 px-1 shadow-zinc-950/80 backdrop-blur-sm"
                >{{ t('auth.or') }}</span
              >
            </Divider>

            <Button
              v-for="provider in externalProviders"
              :key="provider"
              as="a"
              :href="providerHref(provider)"
              :label="providerLabel(provider)"
              :icon="providerIcon(provider)"
              severity="secondary"
              outlined
              class="w-full"
            />
          </template>
        </form>
      </template>
    </Card>
  </GuestLayout>
</template>
