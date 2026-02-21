<script setup lang="ts">
import { ref, computed } from 'vue'
import { Head, router, usePage } from '@inertiajs/vue3'
import AppLayout from '~/layouts/AppLayout.vue'
import InputText from 'primevue/inputtext'
import InputNumber from 'primevue/inputnumber'
import ToggleSwitch from 'primevue/toggleswitch'
import SelectButton from 'primevue/selectbutton'
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
  username: string | null
  displayName: string
  email: string
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
  createdAt: string
}

interface ApiToken {
  id: number
  name: string
  created_at: string
  last_used_at: string | null
  expires_at: string | null
}

const props = defineProps<{ user: UserData; tokens: ApiToken[] }>()
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
})

const colorModeOptions = [
  { label: t('profile.color_mode_light'), value: 'light' },
  { label: t('profile.color_mode_dark'), value: 'dark' },
]

const submitting = ref(false)

function submit() {
  if (!form.value.displayName || !form.value.email) return
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
    },
    {
      onFinish: () => (submitting.value = false),
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
  router.delete(`/profile/tokens/${tokenId}`, {}, { preserveScroll: true })
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

    <h1 class="mb-6 text-2xl font-bold text-gray-900 dark:text-zinc-100">
      {{ t('profile.heading') }}
    </h1>

    <div class="grid max-w-4xl gap-6 lg:grid-cols-2">
      <!-- Editable form -->
      <Card>
        <template #title>{{ t('profile.personal_info') }}</template>
        <template #content>
          <form @submit.prevent="submit" class="flex flex-col gap-5">
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

            <h3 class="mt-2 text-lg font-semibold text-gray-800 dark:text-zinc-200">
              {{ t('profile.preferences') }}
            </h3>

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

            <div class="pt-2">
              <Button
                type="submit"
                :label="t('profile.save')"
                icon="pi pi-check"
                :loading="submitting"
                :disabled="!form.displayName || !form.email"
              />
            </div>
          </form>
        </template>
      </Card>

      <!-- Read-only account info -->
      <Card>
        <template #title>{{ t('profile.account_info') }}</template>
        <template #content>
          <div class="flex flex-col gap-4">
            <div>
              <span class="text-sm font-medium text-gray-500 dark:text-zinc-400">{{
                t('profile.username')
              }}</span>
              <p class="text-gray-900 dark:text-zinc-100">{{ user.username ?? '—' }}</p>
            </div>
            <div>
              <span class="text-sm font-medium text-gray-500 dark:text-zinc-400">{{
                t('profile.keypad_id')
              }}</span>
              <p class="text-gray-900 dark:text-zinc-100">{{ user.keypadId }}</p>
            </div>
            <div>
              <span class="text-sm font-medium text-gray-500 dark:text-zinc-400">{{
                t('profile.card_id')
              }}</span>
              <p class="text-gray-900 dark:text-zinc-100">{{ user.cardId ?? '—' }}</p>
            </div>
            <div>
              <span class="text-sm font-medium text-gray-500 dark:text-zinc-400">{{
                t('profile.role')
              }}</span>
              <p class="text-gray-900 dark:text-zinc-100">{{ user.role }}</p>
            </div>
            <div>
              <span class="text-sm font-medium text-gray-500 dark:text-zinc-400">{{
                t('profile.created_at')
              }}</span>
              <p class="text-gray-900 dark:text-zinc-100">{{ formatDate(user.createdAt) }}</p>
            </div>
          </div>
        </template>
      </Card>

      <!-- API tokens — full width -->
      <Card class="lg:col-span-2">
        <template #title>{{ t('profile.tokens_heading') }}</template>
        <template #content>
          <div class="flex flex-col gap-6">
            <!-- Existing tokens -->
            <DataTable :value="tokens" stripedRows class="rounded-lg border">
              <Column :header="t('profile.tokens_name')">
                <template #body="{ data }">{{ data.name }}</template>
              </Column>
              <Column :header="t('profile.tokens_created')" style="width: 160px">
                <template #body="{ data }">{{ formatDate(data.created_at) }}</template>
              </Column>
              <Column :header="t('profile.tokens_last_used')" style="width: 160px">
                <template #body="{ data }">
                  {{
                    data.last_used_at
                      ? formatDate(data.last_used_at)
                      : t('profile.tokens_never_used')
                  }}
                </template>
              </Column>
              <Column :header="t('profile.tokens_expires')" style="width: 160px">
                <template #body="{ data }">
                  {{
                    data.expires_at
                      ? formatDate(data.expires_at)
                      : t('profile.tokens_never_expires')
                  }}
                </template>
              </Column>
              <Column style="width: 80px">
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

            <!-- Create new token -->
            <div class="flex flex-wrap items-end gap-3">
              <div class="flex-1">
                <label class="mb-1 block text-sm font-medium text-gray-700 dark:text-zinc-300">
                  {{ t('profile.tokens_new_name') }}
                </label>
                <InputText v-model="newTokenName" class="w-full" maxlength="100" />
              </div>
              <div class="w-56">
                <label class="mb-1 block text-sm font-medium text-gray-700 dark:text-zinc-300">
                  {{ t('profile.tokens_new_expires') }}
                </label>
                <InputNumber
                  v-model="newTokenExpiresDays"
                  :min="1"
                  :max="3650"
                  :placeholder="t('profile.tokens_never_expires')"
                  class="w-full"
                />
              </div>
              <Button
                :label="t('profile.tokens_create')"
                icon="pi pi-plus"
                :loading="creatingToken"
                :disabled="!newTokenName.trim()"
                @click="createToken"
              />
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
