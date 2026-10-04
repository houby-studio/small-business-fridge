<script setup lang="ts">
import { Head, Link, router } from '@inertiajs/vue3'
import AppLayout from '~/layouts/AppLayout.vue'
import Button from 'primevue/button'
import Card from 'primevue/card'
import { useI18n } from '~/composables/use_i18n'
import { formatDate } from '~/composables/use_format_date'

type DraftSource = 'web' | 'mcp' | 'shopping_list'

interface Draft {
  id: number
  source: DraftSource
  note: string | null
  createdAt: string
  lines: number
  pieces: number
  unmatched: number
  isEmpty: boolean
}

defineProps<{ drafts: Draft[] }>()

const { t } = useI18n()

const SOURCE_BADGE: Record<DraftSource, string> = {
  web: 'bg-gray-100 text-gray-800 dark:bg-zinc-700 dark:text-zinc-200',
  mcp: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-200',
  shopping_list: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-200',
}

function createDraft() {
  router.post('/supplier/stock/drafts')
}
</script>

<template>
  <AppLayout>
    <Head :title="t('shopping.drafts_title')" />

    <div class="mb-6 flex items-center justify-between">
      <h1 class="text-2xl font-bold text-gray-900 dark:text-zinc-100">
        {{ t('shopping.drafts_title') }}
      </h1>
      <Button
        :label="t('shopping.drafts_create')"
        icon="pi pi-plus"
        data-testid="draft-create"
        @click="createDraft"
      />
    </div>

    <div class="space-y-3">
      <Link
        v-for="draft in drafts"
        :key="draft.id"
        :href="`/supplier/stock/drafts/${draft.id}`"
        class="block"
        :data-testid="`draft-${draft.id}`"
      >
        <Card class="transition hover:shadow-md">
          <template #content>
            <div class="flex flex-wrap items-center justify-between gap-2">
              <div class="flex flex-wrap items-center gap-2">
                <span
                  class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
                  :class="SOURCE_BADGE[draft.source]"
                  >{{ t(`shopping.draft_source_${draft.source}`) }}</span
                >
                <span class="text-sm text-gray-700 dark:text-zinc-300">{{
                  formatDate(draft.createdAt)
                }}</span>
                <span v-if="draft.note" class="text-sm text-gray-500 dark:text-zinc-400">
                  · {{ draft.note }}
                </span>
              </div>
              <div class="flex items-center gap-2 text-sm text-gray-700 dark:text-zinc-300">
                <span v-if="draft.isEmpty" class="text-gray-500 dark:text-zinc-400">{{
                  t('shopping.draft_empty')
                }}</span>
                <span v-else>{{
                  t('shopping.draft_summary', { lines: draft.lines, pieces: draft.pieces })
                }}</span>
                <span
                  v-if="draft.unmatched > 0"
                  class="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/30 dark:text-amber-200"
                  >{{ t('shopping.draft_unmatched', { count: draft.unmatched }) }}</span
                >
                <span class="pi pi-chevron-right text-gray-400" />
              </div>
            </div>
          </template>
        </Card>
      </Link>
      <div
        v-if="drafts.length === 0"
        class="rounded-lg border border-dashed border-gray-300 px-4 py-8 text-center text-gray-500 dark:border-zinc-700 dark:text-zinc-400"
        data-testid="drafts-empty"
      >
        {{ t('shopping.drafts_empty') }}
      </div>
    </div>
  </AppLayout>
</template>
