<script setup lang="ts">
import { computed } from 'vue'
import Message from 'primevue/message'
import ProgressBar from 'primevue/progressbar'
import InfoHint from '~/components/InfoHint.vue'
import { useI18n } from '~/composables/use_i18n'
import { useMoney } from '~/composables/use_pricing'

/** Mirrors `IncomeLimitStatus` in app/services/finance_service.ts. */
export interface IncomeLimitStatus {
  enabled: boolean
  limit: number
  warnPercent: number
  /** Received in the year, by payment date. */
  amount: number
  /** Still to come in (unpaid + not invoiced); null for a past year. */
  pending: number | null
  percent: number
  level: 'ok' | 'warn' | 'exceeded'
}

const props = defineProps<{
  status: IncomeLimitStatus
  /** Show the progress even while far below the limit (the finance page). */
  always?: boolean
}>()

const { t } = useI18n()
const { money, percent } = useMoney()

const visible = computed(
  () => props.status.enabled && (props.always || props.status.level !== 'ok')
)
const severity = computed(() =>
  props.status.level === 'exceeded' ? 'error' : props.status.level === 'warn' ? 'warn' : 'info'
)
const text = computed(() =>
  t(
    props.status.level === 'exceeded'
      ? 'finance.limit_exceeded'
      : props.status.level === 'warn'
        ? 'finance.limit_warn'
        : 'finance.limit_ok',
    {
      amount: money(props.status.amount),
      limit: money(props.status.limit),
      percent: percent(props.status.percent),
    }
  )
)
</script>

<template>
  <Message
    v-if="visible"
    :severity="severity"
    :closable="false"
    data-testid="income-limit-banner"
    :data-level="status.level"
  >
    <div class="flex flex-col gap-2">
      <span class="inline-flex items-center gap-1">
        {{ text }}
        <span v-if="status.pending" data-testid="income-limit-pending">{{
          t('finance.limit_pending', { amount: money(status.pending) })
        }}</span>
        <InfoHint :text="t('finance.limit_note')" test-id="income-limit-note" />
      </span>
      <ProgressBar
        :value="Math.min(100, status.percent)"
        :showValue="false"
        style="height: 0.4rem"
        :aria-label="t('finance.limit_progress')"
      />
    </div>
  </Message>
</template>
