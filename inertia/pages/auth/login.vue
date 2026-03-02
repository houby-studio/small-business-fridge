<script setup lang="ts">
import { Head, useForm, usePage } from '@inertiajs/vue3'
import GuestLayout from '~/layouts/GuestLayout.vue'
import Card from 'primevue/card'
import InputText from 'primevue/inputtext'
import Password from 'primevue/password'
import Button from 'primevue/button'
import Checkbox from 'primevue/checkbox'
import Divider from 'primevue/divider'
import Message from 'primevue/message'
import { computed } from 'vue'
import { useI18n } from '~/composables/use_i18n'
import type { SharedProps } from '~/types'

defineProps<{
  externalProviders?: Array<'microsoft' | 'discord'>
  allowLocalRegistration?: boolean
  localEnabled?: boolean
}>()

const { t } = useI18n()
const page = usePage<SharedProps>()

const form = useForm({
  email: '',
  password: '',
  rememberMe: false,
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
const passwordError = computed(
  () => form.errors.password || flashInputErrorsBag.value.password?.[0]
)
const firstErrorMessage = computed(() => emailError.value || passwordError.value)
const submitDisabled = computed(
  () =>
    form.processing ||
    form.email.trim().length === 0 ||
    emailInvalid.value ||
    form.password.length === 0
)

function submit() {
  form.post('/login', {
    onFinish: () => form.reset('password'),
  })
}
function providerLabel(provider: 'microsoft' | 'discord'): string {
  return provider === 'microsoft' ? 'Microsoft' : 'Discord'
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
          <Message v-if="firstErrorMessage" severity="error" :closable="false">
            {{ firstErrorMessage }}
          </Message>

          <template v-if="localEnabled !== false">
            <div class="flex flex-col gap-2">
              <label for="email" class="text-sm font-medium text-gray-700 dark:text-zinc-300">
                {{ t('auth.bootstrap_email') }}
              </label>
              <InputText
                id="email"
                v-model="form.email"
                :invalid="!!emailError || emailInvalid"
                autocomplete="email"
                autofocus
                :placeholder="t('auth.bootstrap_email_placeholder')"
              />
              <small v-if="emailInvalid" class="text-red-300">
                {{ t('auth.email_invalid') }}
              </small>
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
              <label
                for="rememberMe"
                class="cursor-pointer text-sm text-gray-700 dark:text-zinc-300"
              >
                {{ t('auth.remember_me') }}
              </label>
            </div>

            <div class="flex items-center justify-between text-sm">
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
              type="submit"
              :label="t('auth.submit')"
              icon="pi pi-sign-in"
              :loading="form.processing"
              :disabled="submitDisabled"
              class="w-full"
            />
          </template>

          <template v-if="(externalProviders?.length ?? 0) > 0">
            <Divider
              v-if="localEnabled !== false"
              class="text-gray-400 dark:text-zinc-500"
              align="center"
            >
              <span
                class="text-sm text-gray-400 dark:text-zinc-500 bg-zinc-900/90 px-1 shadow-zinc-950/80 backdrop-blur-sm"
                >{{ t('auth.or') }}</span
              >
            </Divider>

            <p class="text-sm text-center text-gray-400 dark:text-zinc-400">
              {{ t('auth.sign_in_via') }}
            </p>

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
