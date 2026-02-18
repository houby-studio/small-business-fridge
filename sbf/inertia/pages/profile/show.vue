<script setup lang="ts">
import { ref } from 'vue'
import { Head, router } from '@inertiajs/vue3'
import AppLayout from '~/layouts/AppLayout.vue'
import InputText from 'primevue/inputtext'
import ToggleSwitch from 'primevue/toggleswitch'
import SelectButton from 'primevue/selectbutton'
import Button from 'primevue/button'
import Card from 'primevue/card'
import { useI18n } from '~/composables/useI18n'
import { formatDate } from '~/composables/useFormatDate'

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

const props = defineProps<{ user: UserData }>()
const { t } = useI18n()

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

  router.put('/profile', {
    displayName: form.value.displayName,
    email: form.value.email,
    phone: form.value.phone || null,
    iban: form.value.iban || null,
    showAllProducts: form.value.showAllProducts,
    sendMailOnPurchase: form.value.sendMailOnPurchase,
    sendDailyReport: form.value.sendDailyReport,
    colorMode: form.value.colorMode,
    keypadDisabled: form.value.keypadDisabled,
  }, {
    onFinish: () => (submitting.value = false),
  })
}

</script>

<template>
  <AppLayout>
    <Head :title="t('profile.title')" />

    <h1 class="mb-6 text-2xl font-bold text-gray-900">{{ t('profile.heading') }}</h1>

    <div class="grid max-w-4xl gap-6 lg:grid-cols-2">
      <!-- Editable form -->
      <Card>
        <template #title>{{ t('profile.personal_info') }}</template>
        <template #content>
          <form @submit.prevent="submit" class="flex flex-col gap-5">
            <div>
              <label class="mb-1 block text-sm font-medium text-gray-700">{{ t('profile.display_name') }}</label>
              <InputText v-model="form.displayName" class="w-full" />
            </div>

            <div>
              <label class="mb-1 block text-sm font-medium text-gray-700">{{ t('profile.email') }}</label>
              <InputText v-model="form.email" type="email" class="w-full" />
            </div>

            <div>
              <label class="mb-1 block text-sm font-medium text-gray-700">{{ t('profile.phone') }}</label>
              <InputText v-model="form.phone" class="w-full" />
            </div>

            <div>
              <label class="mb-1 block text-sm font-medium text-gray-700">{{ t('profile.iban') }}</label>
              <InputText v-model="form.iban" class="w-full" maxlength="24" />
            </div>

            <h3 class="mt-2 text-lg font-semibold text-gray-800">{{ t('profile.preferences') }}</h3>

            <div class="flex items-center justify-between">
              <label class="text-sm text-gray-700">{{ t('profile.show_all_products') }}</label>
              <ToggleSwitch v-model="form.showAllProducts" />
            </div>

            <div class="flex items-center justify-between">
              <label class="text-sm text-gray-700">{{ t('profile.send_mail_on_purchase') }}</label>
              <ToggleSwitch v-model="form.sendMailOnPurchase" />
            </div>

            <div class="flex items-center justify-between">
              <label class="text-sm text-gray-700">{{ t('profile.send_daily_report') }}</label>
              <ToggleSwitch v-model="form.sendDailyReport" />
            </div>

            <div class="flex items-center justify-between">
              <label class="text-sm text-gray-700">{{ t('profile.keypad_disabled') }}</label>
              <ToggleSwitch v-model="form.keypadDisabled" />
            </div>

            <div>
              <label class="mb-1 block text-sm font-medium text-gray-700">{{ t('profile.color_mode') }}</label>
              <SelectButton v-model="form.colorMode" :options="colorModeOptions" optionLabel="label" optionValue="value" />
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
              <span class="text-sm font-medium text-gray-500">{{ t('profile.username') }}</span>
              <p class="text-gray-900">{{ user.username ?? '—' }}</p>
            </div>
            <div>
              <span class="text-sm font-medium text-gray-500">{{ t('profile.keypad_id') }}</span>
              <p class="text-gray-900">{{ user.keypadId }}</p>
            </div>
            <div>
              <span class="text-sm font-medium text-gray-500">{{ t('profile.card_id') }}</span>
              <p class="text-gray-900">{{ user.cardId ?? '—' }}</p>
            </div>
            <div>
              <span class="text-sm font-medium text-gray-500">{{ t('profile.role') }}</span>
              <p class="text-gray-900">{{ user.role }}</p>
            </div>
            <div>
              <span class="text-sm font-medium text-gray-500">{{ t('profile.created_at') }}</span>
              <p class="text-gray-900">{{ formatDate(user.createdAt) }}</p>
            </div>
          </div>
        </template>
      </Card>
    </div>
  </AppLayout>
</template>
