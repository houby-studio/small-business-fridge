<script setup lang="ts">
import { computed } from 'vue'
import { Link, usePage } from '@inertiajs/vue3'

export interface PageTab {
  label: string
  url: string
  testId?: string
}

const props = defineProps<{ tabs: PageTab[] }>()

const page = usePage()

/**
 * Route-based tabs: each tab is its own Inertia page, so URLs stay bookmarkable and no tab
 * state lives in the SPA. The active tab is the longest URL prefix that matches the current
 * path, so `/supplier/stock` does not swallow `/supplier/stock/drafts`-style siblings.
 */
const activeUrl = computed(() => {
  const path = page.url.split('?')[0]
  let best: PageTab | null = null
  for (const tab of props.tabs) {
    const matches = path === tab.url || path.startsWith(tab.url.replace(/\/$/, '') + '/')
    if (matches && (!best || tab.url.length > best.url.length)) best = tab
  }
  return best?.url ?? null
})
</script>

<template>
  <nav
    class="mb-6 flex gap-1 overflow-x-auto border-b border-gray-200 dark:border-zinc-700"
    role="tablist"
  >
    <Link
      v-for="tab in tabs"
      :key="tab.url"
      :href="tab.url"
      role="tab"
      :aria-selected="tab.url === activeUrl"
      :data-testid="tab.testId"
      class="-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm transition-colors"
      :class="
        tab.url === activeUrl
          ? 'border-red-600 font-medium text-red-600 dark:border-red-400 dark:text-red-400'
          : 'border-transparent text-gray-600 hover:border-gray-300 hover:text-gray-900 dark:text-zinc-400 dark:hover:border-zinc-600 dark:hover:text-zinc-100'
      "
    >
      {{ tab.label }}
    </Link>
  </nav>
</template>
