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

/**
 * The scope the current page shows ("Celá lednice" / "Jen moje") travels with the tabs, so
 * switching from Stav to Historie keeps the context instead of falling back to the next
 * page's own default. Pages without a scope filter (or a single-supplier fridge, where
 * the filter is hidden) link plainly.
 */
const carriedScope = computed(() => {
  if (page.props.hasOtherSuppliers === false) return null
  const filters = page.props.filters as { scope?: unknown } | undefined
  const scope = filters?.scope
  return scope === 'all' || scope === 'mine' ? scope : null
})

function href(tab: PageTab): string {
  if (!carriedScope.value || tab.url === activeUrl.value) return tab.url
  return `${tab.url}${tab.url.includes('?') ? '&' : '?'}scope=${carriedScope.value}`
}
</script>

<template>
  <!-- Links to sibling pages, not an ARIA tablist: there are no tab panels to control. -->
  <nav
    class="mb-6 flex gap-1 overflow-x-auto overflow-y-hidden border-b border-gray-200 dark:border-zinc-700"
    data-testid="page-tabs"
  >
    <Link
      v-for="tab in tabs"
      :key="tab.url"
      :href="href(tab)"
      :aria-current="tab.url === activeUrl ? 'page' : undefined"
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
