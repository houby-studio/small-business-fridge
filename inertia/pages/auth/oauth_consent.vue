<script setup lang="ts">
import { ref, computed } from 'vue'
import { Head, router } from '@inertiajs/vue3'
import GuestLayout from '~/layouts/GuestLayout.vue'
import Button from 'primevue/button'
import { useI18n } from '~/composables/use_i18n'

const props = defineProps<{
  blocked?: 'impersonating'
  clientName?: string
  redirectHost?: string
  role?: 'customer' | 'supplier' | 'admin'
  account?: { displayName: string; email: string | null }
}>()

const { t } = useI18n()
const submitting = ref<'approve' | 'deny' | 'stop' | null>(null)

// What the tool will be able to do — concrete, by role, so the user knows what they grant.
const capabilities = computed(() => {
  const items = [
    t('auth.oauth_consent_can_buy'),
    t('auth.oauth_consent_can_read'),
    t('auth.oauth_consent_can_browse'),
  ]
  if (props.role === 'supplier' || props.role === 'admin') {
    items.push(t('auth.oauth_consent_can_supply'))
  }
  if (props.role === 'admin') {
    items.push(t('auth.oauth_consent_can_admin'))
  }
  return items
})

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

function stopImpersonation() {
  submitting.value = 'stop'
  router.post('/impersonate/stop', {}, { onFinish: () => (submitting.value = null) })
}
</script>

<template>
  <GuestLayout>
    <Head :title="t('auth.oauth_consent_title')" />

    <div v-if="blocked" class="space-y-4" data-testid="oauth-consent-blocked">
      <h2 class="text-xl font-bold text-zinc-100">{{ t('auth.oauth_consent_title') }}</h2>
      <p class="text-zinc-300">{{ t('auth.oauth_consent_blocked_impersonating') }}</p>
      <div class="flex justify-end">
        <Button
          :label="t('auth.oauth_consent_stop_impersonation')"
          :loading="submitting === 'stop'"
          :disabled="submitting !== null"
          @click="stopImpersonation"
        />
      </div>
    </div>

    <div v-else class="space-y-5" data-testid="oauth-consent">
      <h2 tabindex="-1" class="text-xl font-bold text-zinc-100">
        {{ t('auth.oauth_consent_title') }}
      </h2>

      <div class="space-y-1">
        <p class="text-zinc-300">
          {{ t('auth.oauth_consent_intro_before') }}
          <strong class="text-zinc-100">{{ clientName }}</strong>
          {{ t('auth.oauth_consent_intro_after') }}
          <strong class="text-zinc-100">{{ account?.displayName }}</strong
          ><template v-if="account?.email"> ({{ account.email }})</template>.
        </p>
        <p class="text-xs text-zinc-400">
          {{ t('auth.oauth_consent_client_note', { client: clientName ?? '' }) }}
        </p>
      </div>

      <div>
        <p class="mb-2 text-sm font-semibold text-zinc-200">
          {{ t('auth.oauth_consent_can_heading') }}
        </p>
        <ul class="space-y-1.5 text-sm text-zinc-300" data-testid="oauth-consent-capabilities">
          <li v-for="item in capabilities" :key="item" class="flex gap-2">
            <span class="pi pi-check mt-0.5 text-xs text-zinc-400" aria-hidden="true" />
            <span>{{ item }}</span>
          </li>
        </ul>
      </div>

      <p
        class="rounded-lg border border-amber-800/50 bg-amber-900/30 px-3 py-2 text-sm text-amber-200"
      >
        <strong>{{ t('auth.oauth_consent_permanent') }}</strong>
        {{ t('auth.oauth_consent_revoke', { client: clientName ?? '' }) }}
      </p>

      <p class="text-sm text-zinc-300">
        {{ t('auth.oauth_consent_redirect') }}
        <span
          class="ml-1 inline-flex whitespace-nowrap rounded bg-zinc-800 px-2 py-0.5 font-mono text-xs text-zinc-100"
          data-testid="oauth-consent-host"
          >{{ redirectHost }}</span
        >
      </p>

      <div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
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
  </GuestLayout>
</template>
