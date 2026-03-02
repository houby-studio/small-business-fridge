<script setup lang="ts">
import { ref, computed } from 'vue'
import { Head, router, usePage } from '@inertiajs/vue3'
import AppLayout from '~/layouts/AppLayout.vue'
import InputText from 'primevue/inputtext'
import InputNumber from 'primevue/inputnumber'
import ToggleSwitch from 'primevue/toggleswitch'
import SelectButton from 'primevue/selectbutton'
import MultiSelect from 'primevue/multiselect'
import Password from 'primevue/password'
import Button from 'primevue/button'
import Card from 'primevue/card'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import Dialog from 'primevue/dialog'
import { useI18n } from '~/composables/use_i18n'
import { formatDate } from '~/composables/use_format_date'
import type { SharedProps } from '~/types'

interface UserData {
  id: number
  displayName: string
  email: string
  pendingEmail: string | null
  emailVerifiedAt: string | null
  phone: string | null
  iban: string | null
  keypadId: number
  cardId: string | null
  role: string
  showAllProducts: boolean
  sendMailOnPurchase: boolean
  sendDailyReport: boolean
  colorMode: 'light' | 'dark'
  keypadDisabled: boolean
  excludedAllergenIds: number[]
  createdAt: string
}

interface AllergenOption {
  id: number
  name: string
}

interface ApiToken {
  id: number
  name: string
  created_at: string
  last_used_at: string | null
  expires_at: string | null
}

const props = defineProps<{
  user: UserData
  tokens: ApiToken[]
  allergens: AllergenOption[]
  externalProviders: Array<'microsoft' | 'discord'>
  linkedProviders: Array<'microsoft' | 'discord'>
}>()
const { t } = useI18n()
const page = usePage<SharedProps>()

// ─── Profile form ─────────────────────────────────────────────────────────────

const form = ref({
  displayName: props.user.displayName,
  email: props.user.email,
  phone: props.user.phone ?? '',
  iban: props.user.iban ?? '',
  showAllProducts: props.user.showAllProducts,
  sendMailOnPurchase: props.user.sendMailOnPurchase,
  sendDailyReport: props.user.sendDailyReport,
  colorMode: props.user.colorMode,
  keypadDisabled: props.user.keypadDisabled,
  excludedAllergenIds: [...(props.user.excludedAllergenIds ?? [])],
})

const colorModeOptions = [
  { label: t('profile.color_mode_light'), value: 'light' },
  { label: t('profile.color_mode_dark'), value: 'dark' },
]

const submitting = ref(false)
const changingPassword = ref(false)
const passwordForm = ref({
  currentPassword: '',
  newPassword: '',
  newPasswordConfirmation: '',
})
const profileEmailInvalid = computed(() => {
  if (form.value.email.length === 0) return false
  return !/.+@.+/.test(form.value.email.trim())
})
const canSubmitProfile = computed(
  () => !!form.value.displayName.trim() && !!form.value.email.trim() && !profileEmailInvalid.value
)
const newPasswordTooShort = computed(
  () => passwordForm.value.newPassword.length > 0 && passwordForm.value.newPassword.length < 8
)
const newPasswordConfirmationTooShort = computed(
  () =>
    passwordForm.value.newPasswordConfirmation.length > 0 &&
    passwordForm.value.newPasswordConfirmation.length < 8
)
const newPasswordsMismatch = computed(
  () =>
    passwordForm.value.newPasswordConfirmation.length > 0 &&
    passwordForm.value.newPassword !== passwordForm.value.newPasswordConfirmation
)
const canSubmitPassword = computed(
  () =>
    !!passwordForm.value.newPassword &&
    !!passwordForm.value.newPasswordConfirmation &&
    passwordForm.value.newPassword.length >= 8 &&
    passwordForm.value.newPasswordConfirmation.length >= 8 &&
    passwordForm.value.newPassword === passwordForm.value.newPasswordConfirmation
)
const emailVerified = computed(() => !!props.user.emailVerifiedAt)
const hasPendingEmail = computed(() => !!props.user.pendingEmail)
const resendingVerification = ref(false)

function providerLabel(provider: 'microsoft' | 'discord'): string {
  return provider === 'microsoft' ? 'Microsoft' : 'Discord'
}

function providerIcon(provider: 'microsoft' | 'discord'): string {
  return provider === 'microsoft' ? 'pi pi-microsoft' : 'pi pi-discord'
}

function isLinked(provider: 'microsoft' | 'discord'): boolean {
  return props.linkedProviders.includes(provider)
}

function linkProvider(provider: 'microsoft' | 'discord') {
  window.location.href = `/auth/${provider}/redirect?intent=link&userId=${props.user.id}`
}

function submit() {
  if (!form.value.displayName || !form.value.email || profileEmailInvalid.value) return
  submitting.value = true

  router.put(
    '/profile',
    {
      displayName: form.value.displayName,
      email: form.value.email,
      phone: form.value.phone || null,
      iban: form.value.iban || null,
      showAllProducts: form.value.showAllProducts,
      sendMailOnPurchase: form.value.sendMailOnPurchase,
      sendDailyReport: form.value.sendDailyReport,
      colorMode: form.value.colorMode,
      keypadDisabled: form.value.keypadDisabled,
      excludedAllergenIds: form.value.excludedAllergenIds,
    },
    {
      onFinish: () => (submitting.value = false),
    }
  )
}

function resendEmailVerification() {
  resendingVerification.value = true
  router.post(
    '/profile/email-verification/resend',
    {},
    {
      onFinish: () => {
        resendingVerification.value = false
      },
    }
  )
}

function changePassword() {
  changingPassword.value = true
  router.put(
    '/profile/password',
    {
      currentPassword: passwordForm.value.currentPassword || undefined,
      newPassword: passwordForm.value.newPassword,
      newPasswordConfirmation: passwordForm.value.newPasswordConfirmation,
    },
    {
      onFinish: () => {
        changingPassword.value = false
        passwordForm.value.currentPassword = ''
        passwordForm.value.newPassword = ''
        passwordForm.value.newPasswordConfirmation = ''
      },
    }
  )
}

// ─── API tokens ───────────────────────────────────────────────────────────────

const newTokenName = ref('')
const newTokenExpiresDays = ref<number | null>(null)
const creatingToken = ref(false)

function createToken() {
  if (!newTokenName.value.trim()) return
  creatingToken.value = true
  router.post(
    '/profile/tokens',
    { name: newTokenName.value.trim(), expiresInDays: newTokenExpiresDays.value ?? undefined },
    {
      onFinish: () => {
        creatingToken.value = false
        newTokenName.value = ''
        newTokenExpiresDays.value = null
      },
    }
  )
}

function revokeToken(tokenId: number) {
  router.delete(`/profile/tokens/${tokenId}`, { preserveScroll: true })
}

// Show-once new token dialog — driven by flash
const newTokenFlash = computed(
  () => (page.props.flash as any)?.newApiToken as { name: string; token: string } | undefined
)
const showNewTokenDialog = ref(false)
const copiedToken = ref(false)

// Watch for new token in flash and open dialog
import { watch } from 'vue'
watch(
  newTokenFlash,
  (val) => {
    if (val) {
      showNewTokenDialog.value = true
      copiedToken.value = false
    }
  },
  { immediate: true }
)

function copyToken() {
  if (!newTokenFlash.value?.token) return
  navigator.clipboard.writeText(newTokenFlash.value.token).then(() => {
    copiedToken.value = true
  })
}
</script>

<template>
  <AppLayout>
    <Head :title="t('profile.title')" />

    <section
      class="mb-6 rounded-2xl border border-gray-200/80 bg-white/80 p-5 shadow-sm backdrop-blur-sm dark:border-zinc-700/70 dark:bg-zinc-900/80"
    >
      <div class="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 class="text-2xl font-bold text-gray-900 dark:text-zinc-100">
            {{ t('profile.heading') }}
          </h1>
          <p class="mt-1 text-sm text-gray-600 dark:text-zinc-400">
            {{ user.email }}
          </p>
          <p class="mt-2 text-sm">
            <span
              v-if="emailVerified"
              class="rounded-full bg-emerald-100 px-2 py-1 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200"
            >
              {{ t('profile.email_verified') }}
            </span>
            <span
              v-else
              class="rounded-full bg-amber-100 px-2 py-1 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200"
            >
              {{ t('profile.email_unverified') }}
            </span>
          </p>
          <p v-if="hasPendingEmail" class="mt-2 text-xs text-amber-700 dark:text-amber-300">
            {{ t('profile.pending_email_notice', { email: user.pendingEmail ?? '' }) }}
          </p>
        </div>
        <div class="flex flex-wrap gap-2">
          <span
            class="rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-medium text-gray-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
          >
            {{ t('profile.keypad_id') }}: {{ user.keypadId }}
          </span>
          <span
            class="rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-medium text-gray-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
          >
            {{ t('profile.role') }}: {{ user.role }}
          </span>
        </div>
      </div>
      <div v-if="props.externalProviders.length > 0" class="mt-4 flex flex-wrap gap-2">
        <Button
          v-for="provider in props.externalProviders"
          :key="provider"
          size="small"
          severity="secondary"
          outlined
          :disabled="isLinked(provider)"
          :icon="providerIcon(provider)"
          :label="
            isLinked(provider)
              ? t('auth.provider_linked', { provider: providerLabel(provider) })
              : t('auth.link_provider', { provider: providerLabel(provider) })
          "
          @click="linkProvider(provider)"
        />
      </div>
    </section>

    <div class="grid gap-6 xl:grid-cols-12">
      <Card class="xl:col-span-7">
        <template #title>
          <div class="flex items-center gap-2">
            <span
              class="flex h-8 w-8 items-center justify-center rounded-lg bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-300"
            >
              <i class="pi pi-user text-sm" />
            </span>
            <span>{{ t('profile.personal_info') }}</span>
          </div>
        </template>
        <template #content>
          <form @submit.prevent="submit" class="flex flex-col gap-5">
            <div class="grid gap-4 sm:grid-cols-2">
              <div>
                <label class="mb-1 block text-sm font-medium text-gray-700 dark:text-zinc-300">{{
                  t('profile.display_name')
                }}</label>
                <InputText v-model="form.displayName" class="w-full" />
              </div>

              <div>
                <label class="mb-1 block text-sm font-medium text-gray-700 dark:text-zinc-300">{{
                  t('profile.email')
                }}</label>
                <InputText v-model="form.email" type="email" class="w-full" />
                <small v-if="profileEmailInvalid" class="text-red-500 dark:text-red-300">
                  {{ t('auth.email_invalid') }}
                </small>
                <div v-if="!emailVerified || hasPendingEmail" class="mt-2">
                  <Button
                    type="button"
                    size="small"
                    severity="secondary"
                    outlined
                    :label="t('profile.email_resend_verification')"
                    :loading="resendingVerification"
                    @click="resendEmailVerification"
                  />
                </div>
              </div>

              <div>
                <label class="mb-1 block text-sm font-medium text-gray-700 dark:text-zinc-300">{{
                  t('profile.phone')
                }}</label>
                <InputText v-model="form.phone" class="w-full" />
              </div>

              <div>
                <label class="mb-1 block text-sm font-medium text-gray-700 dark:text-zinc-300">{{
                  t('profile.iban')
                }}</label>
                <InputText v-model="form.iban" class="w-full" maxlength="24" />
              </div>
            </div>

            <div
              class="rounded-xl border border-gray-200 bg-gray-50/70 p-4 dark:border-zinc-700 dark:bg-zinc-800/40"
            >
              <h3
                class="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-700 dark:text-zinc-300"
              >
                {{ t('profile.preferences') }}
              </h3>
              <div class="grid gap-3">
                <div class="flex items-center justify-between">
                  <label class="text-sm text-gray-700 dark:text-zinc-300">{{
                    t('profile.show_all_products')
                  }}</label>
                  <ToggleSwitch v-model="form.showAllProducts" />
                </div>

                <div class="flex items-center justify-between">
                  <label class="text-sm text-gray-700 dark:text-zinc-300">{{
                    t('profile.send_mail_on_purchase')
                  }}</label>
                  <ToggleSwitch v-model="form.sendMailOnPurchase" />
                </div>

                <div class="flex items-center justify-between">
                  <label class="text-sm text-gray-700 dark:text-zinc-300">{{
                    t('profile.send_daily_report')
                  }}</label>
                  <ToggleSwitch v-model="form.sendDailyReport" />
                </div>

                <div class="flex items-center justify-between">
                  <label class="text-sm text-gray-700 dark:text-zinc-300">{{
                    t('profile.keypad_disabled')
                  }}</label>
                  <ToggleSwitch v-model="form.keypadDisabled" />
                </div>
              </div>
            </div>

            <div class="grid gap-4 sm:grid-cols-2">
              <div>
                <label class="mb-1 block text-sm font-medium text-gray-700 dark:text-zinc-300">{{
                  t('profile.color_mode')
                }}</label>
                <SelectButton
                  v-model="form.colorMode"
                  :options="colorModeOptions"
                  optionLabel="label"
                  optionValue="value"
                />
              </div>

              <div v-if="allergens.length">
                <label class="mb-1 block text-sm font-medium text-gray-700 dark:text-zinc-300">{{
                  t('profile.exclude_allergens')
                }}</label>
                <MultiSelect
                  v-model="form.excludedAllergenIds"
                  :options="allergens"
                  optionLabel="name"
                  optionValue="id"
                  :placeholder="t('shop.allergens_filter_placeholder')"
                  class="w-full"
                />
                <p class="mt-1 text-xs text-gray-500 dark:text-zinc-400">
                  {{ t('profile.exclude_allergens_hint') }}
                </p>
              </div>
            </div>

            <div class="pt-1">
              <Button
                type="submit"
                :label="t('profile.save')"
                icon="pi pi-check"
                :loading="submitting"
                :disabled="!canSubmitProfile"
              />
            </div>
          </form>
        </template>
      </Card>

      <div class="space-y-6 xl:col-span-5">
        <Card>
          <template #title>
            <div class="flex items-center gap-2">
              <span
                class="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-300"
              >
                <i class="pi pi-id-card text-sm" />
              </span>
              <span>{{ t('profile.account_info') }}</span>
            </div>
          </template>
          <template #content>
            <div class="grid grid-cols-2 gap-3">
              <div
                class="rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-zinc-700 dark:bg-zinc-800/60"
              >
                <span
                  class="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-zinc-400"
                  >{{ t('profile.keypad_id') }}</span
                >
                <p class="mt-1 text-base font-semibold text-gray-900 dark:text-zinc-100">
                  {{ user.keypadId }}
                </p>
              </div>
              <div
                class="rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-zinc-700 dark:bg-zinc-800/60"
              >
                <span
                  class="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-zinc-400"
                  >{{ t('profile.card_id') }}</span
                >
                <p class="mt-1 text-base font-semibold text-gray-900 dark:text-zinc-100">
                  {{ user.cardId ?? '—' }}
                </p>
              </div>
              <div
                class="rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-zinc-700 dark:bg-zinc-800/60"
              >
                <span
                  class="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-zinc-400"
                  >{{ t('profile.role') }}</span
                >
                <p class="mt-1 text-base font-semibold capitalize text-gray-900 dark:text-zinc-100">
                  {{ user.role }}
                </p>
              </div>
              <div
                class="rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-zinc-700 dark:bg-zinc-800/60"
              >
                <span
                  class="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-zinc-400"
                  >{{ t('profile.created_at') }}</span
                >
                <p class="mt-1 text-base font-semibold text-gray-900 dark:text-zinc-100">
                  {{ formatDate(user.createdAt) }}
                </p>
              </div>
            </div>
          </template>
        </Card>

        <Card>
          <template #title>
            <div class="flex items-center gap-2">
              <span
                class="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300"
              >
                <i class="pi pi-key text-sm" />
              </span>
              <span>{{ t('profile.password_heading') }}</span>
            </div>
          </template>
          <template #content>
            <form @submit.prevent="changePassword" class="flex flex-col gap-4">
              <div>
                <label class="mb-1 block text-sm font-medium text-gray-700 dark:text-zinc-300">
                  {{ t('profile.password_current') }}
                </label>
                <Password
                  inputId="profileCurrentPassword"
                  v-model="passwordForm.currentPassword"
                  :feedback="false"
                  toggleMask
                  autocomplete="current-password"
                  inputClass="w-full"
                  class="w-full"
                />
              </div>

              <div>
                <label class="mb-1 block text-sm font-medium text-gray-700 dark:text-zinc-300">
                  {{ t('profile.password_new') }}
                </label>
                <Password
                  inputId="profileNewPassword"
                  v-model="passwordForm.newPassword"
                  :feedback="false"
                  toggleMask
                  autocomplete="new-password"
                  inputClass="w-full"
                  class="w-full"
                />
                <small v-if="newPasswordTooShort" class="text-red-500 dark:text-red-300">
                  {{ t('auth.password_min_length') }}
                </small>
              </div>

              <div>
                <label class="mb-1 block text-sm font-medium text-gray-700 dark:text-zinc-300">
                  {{ t('profile.password_new_confirm') }}
                </label>
                <Password
                  inputId="profileNewPasswordConfirmation"
                  v-model="passwordForm.newPasswordConfirmation"
                  :feedback="false"
                  toggleMask
                  autocomplete="new-password"
                  inputClass="w-full"
                  class="w-full"
                />
                <small
                  v-if="newPasswordConfirmationTooShort"
                  class="block text-red-500 dark:text-red-300"
                >
                  {{ t('auth.password_min_length') }}
                </small>
                <small v-if="newPasswordsMismatch" class="block text-red-500 dark:text-red-300">
                  {{ t('auth.bootstrap_password_mismatch') }}
                </small>
              </div>

              <div>
                <Button
                  type="submit"
                  :label="t('profile.password_submit')"
                  icon="pi pi-key"
                  :loading="changingPassword"
                  :disabled="!canSubmitPassword"
                />
              </div>
            </form>
          </template>
        </Card>
      </div>

      <Card class="xl:col-span-12">
        <template #title>{{ t('profile.tokens_heading') }}</template>
        <template #content>
          <div class="flex flex-col gap-6">
            <!-- Existing tokens -->
            <DataTable :value="tokens" stripedRows class="rounded-lg border">
              <Column :header="t('profile.tokens_name')">
                <template #body="{ data }">{{ data.name }}</template>
              </Column>
              <Column
                :header="t('profile.tokens_created')"
                headerClass="sbf-col-date"
                bodyClass="sbf-col-date"
              >
                <template #body="{ data }">
                  <span class="sbf-nowrap">{{ formatDate(data.created_at) }}</span>
                </template>
              </Column>
              <Column
                :header="t('profile.tokens_last_used')"
                headerClass="sbf-col-date"
                bodyClass="sbf-col-date"
              >
                <template #body="{ data }">
                  <span class="sbf-nowrap">{{
                    data.last_used_at
                      ? formatDate(data.last_used_at)
                      : t('profile.tokens_never_used')
                  }}</span>
                </template>
              </Column>
              <Column
                :header="t('profile.tokens_expires')"
                headerClass="sbf-col-date"
                bodyClass="sbf-col-date"
              >
                <template #body="{ data }">
                  <span class="sbf-nowrap">{{
                    data.expires_at
                      ? formatDate(data.expires_at)
                      : t('profile.tokens_never_expires')
                  }}</span>
                </template>
              </Column>
              <Column
                :header="t('common.actions')"
                headerClass="sbf-col-action"
                bodyClass="sbf-col-action"
              >
                <template #body="{ data }">
                  <Button
                    :label="t('profile.tokens_revoke')"
                    severity="danger"
                    size="small"
                    text
                    @click="revokeToken(data.id)"
                  />
                </template>
              </Column>
              <template #empty>
                <div class="py-4 text-center text-gray-500 dark:text-zinc-400">
                  {{ t('profile.tokens_empty') }}
                </div>
              </template>
            </DataTable>

            <div class="border-t border-gray-200 pt-4 dark:border-zinc-700">
              <h3
                class="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-700 dark:text-zinc-300"
              >
                {{ t('profile.tokens_create') }}
              </h3>
            </div>

            <div class="grid grid-cols-1 items-end gap-2 lg:grid-cols-12">
              <div class="min-w-0 lg:col-span-6">
                <label class="mb-1 block text-sm font-medium text-gray-700 dark:text-zinc-300">
                  {{ t('profile.tokens_new_name') }}
                </label>
                <InputText v-model="newTokenName" fluid />
              </div>
              <div class="min-w-0 lg:col-span-3">
                <label class="mb-1 block text-sm font-medium text-gray-700 dark:text-zinc-300">
                  {{ t('profile.tokens_new_expires') }}
                </label>
                <InputNumber
                  v-model="newTokenExpiresDays"
                  fluid
                  :min="1"
                  :max="3650"
                  :placeholder="t('profile.tokens_never_expires')"
                />
              </div>
              <div class="lg:col-span-3 lg:flex lg:justify-end">
                <Button
                  :label="t('profile.tokens_create')"
                  fluid
                  icon="pi pi-plus"
                  :loading="creatingToken"
                  :disabled="!newTokenName.trim()"
                  @click="createToken"
                />
              </div>
            </div>
          </div>
        </template>
      </Card>
    </div>

    <!-- Show-once new token dialog -->
    <Dialog
      v-model:visible="showNewTokenDialog"
      :header="t('profile.tokens_new_value_heading')"
      :closable="true"
      :modal="true"
      style="width: 560px"
    >
      <p class="mb-4 text-sm text-gray-600 dark:text-zinc-400">
        {{ t('profile.tokens_new_value_info') }}
      </p>
      <div
        class="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 p-3 font-mono text-sm dark:border-zinc-700 dark:bg-zinc-800"
      >
        <span class="flex-1 break-all">{{ newTokenFlash?.token }}</span>
        <Button
          :icon="copiedToken ? 'pi pi-check' : 'pi pi-copy'"
          :label="copiedToken ? t('profile.tokens_copied') : t('profile.tokens_copy')"
          size="small"
          severity="secondary"
          @click="copyToken"
        />
      </div>
    </Dialog>
  </AppLayout>
</template>
