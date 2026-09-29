<script setup lang="ts">
import { ref, computed } from 'vue'
import { Head, router, usePage } from '@inertiajs/vue3'
import GuestLayout from '~/layouts/GuestLayout.vue'
import Card from 'primevue/card'
import Button from 'primevue/button'
import Message from 'primevue/message'
import { useI18n } from '~/composables/use_i18n'

defineProps<{
  clientName: string
  redirectHost: string
}>()

const { t } = useI18n()
const page = usePage()
const userName = computed(
  () => (page.props.user as { displayName: string } | undefined)?.displayName ?? ''
)
const submitting = ref<'approve' | 'deny' | null>(null)

function decide(decision: 'approve' | 'deny') {
  submitting.value = decision
  router.post(
    '/oauth/authorize',
    { decision },
    {
      onFinish: () => {
        submitting.value = null
      },
    }
  )
}
</script>

<template>
  <GuestLayout>
    <Head :title="t('auth.oauth_consent_title')" />

    <Card>
      <template #content>
        <div class="space-y-4" data-testid="oauth-consent">
          <h1 class="text-xl font-bold text-gray-900 dark:text-zinc-100">
            {{ t('auth.oauth_consent_title') }}
          </h1>
          <p class="text-gray-700 dark:text-zinc-300">
            {{ t('auth.oauth_consent_intro', { client: clientName, user: userName }) }}
          </p>
          <p class="text-sm text-gray-700 dark:text-zinc-300">
            {{ t('auth.oauth_consent_redirect') }}
            <strong class="break-all">{{ redirectHost }}</strong>
          </p>
          <Message severity="warn" :closable="false">
            {{ t('auth.oauth_consent_warning') }}
          </Message>
          <div class="flex justify-end gap-2">
            <Button
              :label="t('auth.oauth_consent_deny')"
              severity="secondary"
              text
              :loading="submitting === 'deny'"
              :disabled="submitting !== null"
              data-testid="oauth-deny"
              @click="decide('deny')"
            />
            <Button
              :label="t('auth.oauth_consent_approve')"
              :loading="submitting === 'approve'"
              :disabled="submitting !== null"
              data-testid="oauth-approve"
              @click="decide('approve')"
            />
          </div>
        </div>
      </template>
    </Card>
  </GuestLayout>
</template>
