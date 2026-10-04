<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'
import { Head, Link, router, usePage } from '@inertiajs/vue3'
import AppLayout from '~/layouts/AppLayout.vue'
import Button from 'primevue/button'
import ConfirmDialog from 'primevue/confirmdialog'
import Dialog from 'primevue/dialog'
import InputNumber from 'primevue/inputnumber'
import InputText from 'primevue/inputtext'
import Message from 'primevue/message'
import Select from 'primevue/select'
import InfoHint from '~/components/InfoHint.vue'
import { useI18n } from '~/composables/use_i18n'
import { useAppConfirm } from '~/composables/use_app_confirm'
import { useSelectEnterKey } from '~/composables/use_select_enter_key'
import { formatDate } from '~/composables/use_format_date'
import { suggestSellingPrice, useMoney } from '~/composables/use_pricing'
import { STOCK_DRAFT_MAX_ITEMS, STOCK_DRAFT_NOTE_MAX } from '~/composables/use_shopping_validation'
import {
  DELIVERY_MAX_AMOUNT,
  DELIVERY_MAX_PRICE,
} from '~/composables/use_delivery_correction_validation'
import type { SharedProps } from '~/types'

type DraftSource = 'web' | 'mcp' | 'shopping_list'

interface DraftItem {
  id: number
  productId: number | null
  productGroupId: number | null
  label: string | null
  amount: number
  purchasePrice: number | null
  price: number | null
  deliveryId: number | null
}

interface ProductOption {
  id: number
  displayName: string
  productGroupId: number | null
  lastPrice: number | null
  lastPurchasePrice: number | null
}

/** Mirrors `DraftCommitWarning` in app/services/shopping/stock_draft_service.ts. */
interface DraftWarning {
  index: number
  productId: number
  productName: string
  duplicate: { amount: number; price: number; minutesAgo: number } | null
  unusualPrice: {
    lastPrice: number
    lastSupplierId: number
    lastSupplierName: string
    lastCreatedAt: string
  } | null
}

const props = defineProps<{
  draft: {
    id: number
    source: DraftSource
    note: string | null
    status: 'open' | 'committed' | 'discarded'
    createdAt: string
    committedAt: string | null
    items: DraftItem[]
  }
  products: ProductOption[]
  groups: Array<{ id: number; name: string }>
  marginPercent: number
  focusItemId: number | null
}>()

const { t, tp } = useI18n()
const { money } = useMoney()
const confirm = useAppConfirm()
const page = usePage<SharedProps>()
const currentUserId = computed(() => page.props.user?.id)

const SOURCE_BADGE: Record<DraftSource, string> = {
  web: 'bg-gray-100 text-gray-800 dark:bg-zinc-700 dark:text-zinc-200',
  mcp: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-200',
  shopping_list: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-200',
}

// ─── Rows ─────────────────────────────────────────────────────────────────────
interface Row {
  uid: number
  itemId: number | null
  productId: number | null
  productGroupId: number | null
  label: string | null
  amount: number | null
  purchasePrice: number | null
  price: number | null
  /** The trailing empty line: never counted, never red, waits for a product. */
  ghost: boolean
  /** Problems are only shown once the supplier has worked on the line. */
  touched: boolean
}

let nextUid = 1
const isOpen = computed(() => props.draft.status === 'open')

function ghostRow(): Row {
  return {
    uid: nextUid++,
    itemId: null,
    productId: null,
    productGroupId: null,
    label: null,
    amount: null,
    purchasePrice: null,
    price: null,
    ghost: true,
    touched: false,
  }
}

const rows = ref<Row[]>([
  ...props.draft.items.map(
    (item): Row => ({
      uid: nextUid++,
      itemId: item.id,
      productId: item.productId,
      productGroupId: item.productGroupId,
      label: item.label,
      amount: item.amount,
      purchasePrice: item.purchasePrice,
      price: item.price,
      ghost: false,
      touched: true,
    })
  ),
  ...(props.draft.status === 'open' ? [ghostRow()] : []),
])
const note = ref(props.draft.note ?? '')
const submitting = ref<'commit' | null>(null)

/** The lines that count: everything but the trailing empty one. */
const lines = computed(() => rows.value.filter((row) => !row.ghost))

const productById = computed(() => new Map(props.products.map((p) => [p.id, p])))
const groupName = computed(() => new Map(props.groups.map((g) => [g.id, g.name])))

/** For a group line the group's products come first — any of them will do. */
const allOptions = computed(() =>
  props.products.map((p) => ({ label: p.displayName, value: p.id, groupId: p.productGroupId }))
)
// One list per group, built once — every row re-renders on each keystroke.
const optionsByGroup = computed(() => {
  const byGroup = new Map<number, typeof allOptions.value>()
  for (const groupId of new Set(rows.value.map((row) => row.productGroupId))) {
    if (!groupId) continue
    const members = allOptions.value.filter((option) => option.groupId === groupId)
    const others = allOptions.value.filter((option) => option.groupId !== groupId)
    byGroup.set(groupId, [...members, ...others])
  }
  return byGroup
})

/** Flat list in display order — what the Enter key picks from. */
function optionsFor(row: Row) {
  return (row.productGroupId && optionsByGroup.value.get(row.productGroupId)) || allOptions.value
}

/**
 * What the Select shows: a group line offers the group's products under the group's name
 * and keeps everything else in a second section, so a new flavour can still be picked.
 */
function selectOptionsFor(row: Row) {
  const groupId = row.productGroupId
  if (!groupId) return allOptions.value
  const options = optionsFor(row)
  const members = options.filter((option) => option.groupId === groupId)
  const others = options.filter((option) => option.groupId !== groupId)
  return [
    { label: groupName.value.get(groupId) ?? t('shopping.kind_group'), items: members },
    { label: t('shopping.draft_other_products'), items: others },
  ]
}

/** A receipt line reads "Na účtence: …", a shopping-list line "Ze seznamu: …". */
const labelKey = computed(() =>
  props.draft.source === 'mcp' ? 'shopping.draft_label' : 'shopping.draft_label_list'
)

/**
 * The selling price offered when the supplier types none: what the product sold for last
 * time, never below the purchase price plus the margin — or that alone for a new product.
 */
function suggestedPrice(row: Row): number | null {
  const fromMargin =
    row.purchasePrice !== null && row.purchasePrice > 0
      ? suggestSellingPrice(row.purchasePrice, props.marginPercent)
      : null
  const last = (row.productId ? productById.value.get(row.productId)?.lastPrice : null) ?? null
  if (fromMargin !== null && last !== null) return Math.max(fromMargin, last)
  return fromMargin ?? last
}

function effectivePrice(row: Row): number | null {
  return row.price ?? suggestedPrice(row)
}

function rowProblem(row: Row): string {
  if (row.ghost) return ''
  if (!row.productId) return t('shopping.draft_problem_product')
  if (!row.amount || row.amount < 1) return t('shopping.draft_problem_amount')
  if (!effectivePrice(row)) return t('shopping.draft_problem_price')
  return ''
}

function rowWarning(row: Row): string {
  const price = effectivePrice(row)
  if (price && row.purchasePrice && price < row.purchasePrice) {
    return t('shopping.draft_warning_loss')
  }
  return ''
}

function lastPricesText(row: Row): string {
  const product = row.productId ? productById.value.get(row.productId) : null
  if (!product?.lastPrice) return ''
  return product.lastPurchasePrice !== null
    ? t('supplier.deliveries_last_prices', {
        purchase: money(product.lastPurchasePrice),
        price: money(product.lastPrice),
      })
    : t('supplier.deliveries_last_price', { price: money(product.lastPrice) })
}

function pricePlaceholder(row: Row): string {
  const suggested = suggestedPrice(row)
  return suggested !== null
    ? t('shopping.draft_price_suggested', { price: suggested })
    : t('common.currency')
}

const problems = computed(() => lines.value.filter((row) => rowProblem(row)).length)
const completeLines = computed(() => lines.value.filter((row) => !rowProblem(row)))
const totals = computed(() => {
  let pieces = 0
  let purchase = 0
  let selling = 0
  let purchaseKnown = true
  for (const row of lines.value) {
    const amount = row.amount ?? 0
    pieces += amount
    if (row.purchasePrice === null) purchaseKnown = false
    else purchase += row.purchasePrice * amount
    selling += (effectivePrice(row) ?? 0) * amount
  }
  return {
    pieces,
    purchase: Math.round(purchase * 100) / 100,
    selling,
    profit: purchaseKnown ? Math.round((selling - purchase) * 100) / 100 : null,
  }
})

const commitLabel = computed(() =>
  completeLines.value.length > 0
    ? tp('shopping.draft_commit_count', completeLines.value.length, { pieces: totals.value.pieces })
    : t('shopping.draft_commit')
)
const canCommit = computed(
  () => isOpen.value && submitting.value === null && problems.value === 0 && lines.value.length > 0
)

// ─── Focus plumbing ───────────────────────────────────────────────────────────
// PrimeVue components in a v-for: refs are kept per row uid, not per index, so a removed
// line never shifts focus onto its neighbour.
const selectRefs = new Map<number, any>()
const amountRefs = new Map<number, any>()
const purchaseRefs = new Map<number, any>()
const priceRefs = new Map<number, any>()

function keep(map: Map<number, any>, uid: number) {
  return (el: unknown) => {
    if (el) map.set(uid, el)
    else map.delete(uid)
  }
}

function inputOf(component: any): HTMLInputElement | null {
  const el = component?.$el as HTMLElement | undefined
  if (!el) return null
  return el instanceof HTMLInputElement ? el : el.querySelector('input')
}

/** Focus and select — twice, because PrimeVue re-renders the input right after mount. */
function focusField(map: Map<number, any>, uid: number) {
  const run = () => {
    const input = inputOf(map.get(uid))
    if (!input) return
    input.focus()
    input.select()
  }
  nextTick(run)
  window.setTimeout(run, 120)
}

function openSelectEntry(): { uid: number; instance: any } | null {
  for (const [uid, instance] of selectRefs) {
    if (instance?.overlayVisible === true) return { uid, instance }
  }
  return null
}

function rowByUid(uid: number | undefined) {
  return rows.value.find((row) => row.uid === uid) ?? null
}

// One binding for every row's Select: whichever overlay is open is "the" select.
const openSelect = {
  get value() {
    return openSelectEntry()?.instance ?? null
  },
} as Ref<any>
const { onSelectFilter } = useSelectEnterKey([
  {
    selectRef: openSelect,
    getOptions: () => {
      const row = rowByUid(openSelectEntry()?.uid)
      return row ? optionsFor(row) : allOptions.value
    },
    getLabel: (o) => o.label,
    getValue: (o) => o.value,
    onSelect: (value) => {
      const row = rowByUid(openSelectEntry()?.uid)
      if (row) pickProduct(row, Number(value))
    },
  },
])

/**
 * Focus the search of this row's own overlay. (Looking the input up in the document would
 * find the previous line's overlay while it is still fading out.)
 */
function focusOwnFilter(uid: number) {
  const input = selectRefs.get(uid)?.$refs?.filterInput?.$el as HTMLInputElement | undefined
  if (!input) return
  input.focus()
  input.select()
}

function openProductSelect(uid: number) {
  const instance = selectRefs.get(uid)
  const root = instance?.$el as HTMLElement | undefined
  const trigger = root?.querySelector('[role="combobox"]') as HTMLElement | null
  trigger?.focus()
  if (typeof instance?.show === 'function') instance.show()
  else trigger?.click()
  nextTick(() => focusOwnFilter(uid))
}

function ensureGhost() {
  if (!isOpen.value) return
  if (rows.value.some((row) => row.ghost)) return
  if (rows.value.length >= STOCK_DRAFT_MAX_ITEMS) return
  rows.value.push(ghostRow())
}

/**
 * Overlays of Selects that were just closed. PrimeVue keeps the panel in the DOM for the
 * length of its fade-out, and two panels at once confuse both the eye and the keyboard flow.
 */
let fadingOverlays: HTMLElement[] = []

function rememberFadingOverlay(uid: number) {
  const overlay = selectRefs.get(uid)?.overlay
  if (overlay instanceof HTMLElement) fadingOverlays.push(overlay)
}

/** Runs `action` once no product search is open or still fading out (at most ~2 s later). */
function whenOverlaysSettled(action: () => void, attempts = 40) {
  fadingOverlays = fadingOverlays.filter((el) => el.isConnected)
  if ((fadingOverlays.length === 0 && !openSelectEntry()) || attempts <= 0) {
    nextTick(action)
    return
  }
  window.setTimeout(() => whenOverlaysSettled(action, attempts - 1), 50)
}

/**
 * Picking a product fills the last purchase price in as a value (what you paid is a fact to
 * correct), while the selling price stays a visible suggestion until Enter or stocking
 * accepts it.
 */
function pickProduct(row: Row, productId: number) {
  rememberFadingOverlay(row.uid)
  row.productId = productId
  row.touched = true
  const product = productById.value.get(productId)
  if (product && row.purchasePrice === null && product.lastPurchasePrice !== null) {
    row.purchasePrice = product.lastPurchasePrice
  }
  if (row.ghost) {
    row.ghost = false
    row.amount = row.amount ?? 1
    ensureGhost()
  }
  focusField(amountRefs, row.uid)
}

function onProductChange(row: Row, event: { value: number | null }) {
  if (event.value) pickProduct(row, event.value)
}

/** Enter on a closed Select opens it with the search focused (an open one is handled above). */
function onProductEnter(row: Row, event: KeyboardEvent) {
  if (selectRefs.get(row.uid)?.overlayVisible === true) return
  event.preventDefault()
  openProductSelect(row.uid)
}

function onAmountEnter(row: Row) {
  row.touched = true
  focusField(purchaseRefs, row.uid)
}

function onPurchaseEnter(row: Row) {
  row.touched = true
  focusField(priceRefs, row.uid)
}

/** Leaving the selling price with Enter or Tab accepts the suggestion shown in it. */
function materializePrice(row: Row) {
  if (row.price === null) row.price = suggestedPrice(row)
}

/** Enter in the price confirms the line and moves on to the next empty one. */
function onPriceEnter(row: Row) {
  row.touched = true
  materializePrice(row)
  if (rowProblem(row)) return
  ensureGhost()
  const ghost = rows.value.find((r) => r.ghost)
  if (ghost) whenOverlaysSettled(() => openProductSelect(ghost.uid))
}

function removeRow(uid: number) {
  rows.value = rows.value.filter((row) => row.uid !== uid)
  ensureGhost()
}

// ─── Save / commit / discard ──────────────────────────────────────────────────
/** `materialize` turns the suggested selling prices into real ones — stocking needs them. */
function payload(materialize = false) {
  return {
    note: note.value.trim() || null,
    items: lines.value.map((row) => ({
      productId: row.productId,
      productGroupId: row.productGroupId,
      label: row.label,
      amount: row.amount ?? 1,
      purchasePrice: row.purchasePrice,
      price: materialize ? (row.price ?? suggestedPrice(row)) : row.price,
    })),
  }
}

/**
 * "Nový produkt" on a line: the draft is saved as it is, the product form opens with the
 * line's text prefilled, and saving the product brings the supplier back to this line.
 */
function newProductFromRow(row: Row) {
  if (submitting.value || !isOpen.value) return
  const lineIndex = row.ghost ? lines.value.length : lines.value.indexOf(row)
  const query = {
    draftId: props.draft.id,
    lineIndex,
    ...(row.label ? { name: row.label } : {}),
    ...(row.productGroupId ? { groupId: row.productGroupId } : {}),
  }
  flushSave(() => router.get('/supplier/products/new', query))
}

// ─── Autosave ─────────────────────────────────────────────────────────────────
// Every change is saved after a short pause, so nothing is lost when the supplier walks away;
// the footer says "Uloženo" / "Ukládám…". Nothing is stocked by a save.
type SaveState = 'saved' | 'pending' | 'saving' | 'error'
const saveState = ref<SaveState>('saved')
let saveTimer: ReturnType<typeof setTimeout> | null = null
let saveInFlight = false
let saveQueued = false
let lastSaved = JSON.stringify(payload())
const afterSave: Array<() => void> = []

const hasUnsavedChanges = computed(() => saveState.value !== 'saved')

function scheduleSave() {
  if (!isOpen.value || submitting.value === 'commit') return
  if (JSON.stringify(payload()) === lastSaved) {
    if (!saveInFlight && !saveTimer) saveState.value = 'saved'
    return
  }
  saveState.value = 'pending'
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => flushSave(), 700)
}

/** Saves now (a pending save first) and calls `done` once the draft is stored. */
function flushSave(done?: () => void) {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  if (done) afterSave.push(done)
  if (!isOpen.value || submitting.value === 'commit') return runAfterSave()
  const body = payload()
  const snapshot = JSON.stringify(body)
  if (snapshot === lastSaved && !saveInFlight) {
    saveState.value = 'saved'
    return runAfterSave()
  }
  if (saveInFlight) {
    saveQueued = true
    return
  }
  saveInFlight = true
  saveState.value = 'saving'
  router.put(`/supplier/stock/drafts/${props.draft.id}`, body, {
    preserveScroll: true,
    preserveState: true,
    only: ['draft'],
    onSuccess: () => {
      lastSaved = snapshot
      saveState.value = 'saved'
    },
    onError: () => {
      saveState.value = 'error'
    },
    onFinish: () => {
      saveInFlight = false
      if (saveQueued) {
        saveQueued = false
        flushSave()
      } else {
        runAfterSave()
      }
    },
  })
}

function runAfterSave() {
  while (afterSave.length) afterSave.shift()!()
}

function cancelSave() {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = null
}

watch([rows, note], scheduleSave, { deep: true })

const warnings = ref<DraftWarning[]>([])
const warningVisible = ref(false)

function commit(confirmWarnings = false) {
  if (submitting.value || !isOpen.value) return
  for (const row of lines.value) row.touched = true
  if (!canCommit.value) return
  // A product search left open (Enter in a price opens the next line's) would sit under
  // the warning dialog and swallow its Esc.
  openSelectEntry()?.instance.hide()

  cancelSave()
  submitting.value = 'commit'
  router.post(
    `/supplier/stock/drafts/${props.draft.id}/commit`,
    { ...payload(true), ...(confirmWarnings ? { confirmWarnings: true } : {}) },
    {
      preserveScroll: true,
      preserveState: true,
      onSuccess: (response) => {
        const flagged = (response.props.flash as Record<string, unknown> | undefined)
          ?.draftWarnings as DraftWarning[] | undefined
        if (flagged?.length) {
          // Nothing was stocked — the lines are saved; ask before stocking anyway.
          warnings.value = flagged
          warningVisible.value = true
        }
      },
      onFinish: () => {
        submitting.value = null
      },
    }
  )
}

function lineFor(warning: DraftWarning) {
  return lines.value[warning.index] ?? null
}

function warningSupplier(warning: DraftWarning): string {
  return warning.unusualPrice?.lastSupplierId === currentUserId.value
    ? t('supplier.warning_price_you')
    : (warning.unusualPrice?.lastSupplierName ?? '')
}

/** Cancel (or Esc) returns to the first flagged line's price, the value most likely wrong. */
function cancelWarnings() {
  const first = warnings.value[0] && lineFor(warnings.value[0])
  warningVisible.value = false
  warnings.value = []
  if (first) focusField(priceRefs, first.uid)
}

function onWarningHide() {
  if (warnings.value.length) cancelWarnings()
}

function discard() {
  confirm.require({
    header: t('shopping.draft_discard_title'),
    message: t('shopping.draft_discard_message'),
    acceptLabel: t('shopping.draft_discard'),
    rejectLabel: t('common.cancel'),
    destructive: true,
    accept: () => {
      cancelSave()
      router.delete(`/supplier/stock/drafts/${props.draft.id}`)
    },
  })
}

/** Ctrl+Enter (⌘+Enter) anywhere on the page stocks the draft. */
function onGlobalKeydown(event: KeyboardEvent) {
  if (event.key !== 'Enter' || !(event.ctrlKey || event.metaKey)) return
  event.preventDefault()
  commit()
}

/**
 * Leaving the page (Zpět, the menu, a tab) first stores a pending change — the navigation
 * is held back for the few hundred milliseconds the save takes, then replayed.
 */
let stopBeforeVisit: (() => void) | null = null
function onBeforeUnload(event: BeforeUnloadEvent) {
  if (hasUnsavedChanges.value) event.preventDefault()
}

onMounted(() => {
  stopBeforeVisit = router.on('before', (event) => {
    const visit = event.detail.visit
    if (visit.method !== 'get' || !hasUnsavedChanges.value || !isOpen.value) return
    event.preventDefault()
    flushSave(() =>
      router.visit(visit.url, { method: 'get', preserveScroll: visit.preserveScroll })
    )
  })
  window.addEventListener('beforeunload', onBeforeUnload)
  document.addEventListener('keydown', onGlobalKeydown)
  if (!isOpen.value) return
  const focused = props.focusItemId
    ? rows.value.find((row) => row.itemId === props.focusItemId)
    : null
  if (focused) {
    focusField(amountRefs, focused.uid)
    return
  }
  const ghost = rows.value.find((row) => row.ghost)
  if (!ghost) return
  // A draft built by hand starts in the product search ("Stock" brought the supplier here to
  // add something); one prepared by the list or an assistant is reviewed first.
  if (lines.value.length === 0 || props.draft.source === 'web') {
    nextTick(() => openProductSelect(ghost.uid))
  } else {
    nextTick(() => inputOf(selectRefs.get(ghost.uid))?.focus())
  }
})

onBeforeUnmount(() => {
  stopBeforeVisit?.()
  window.removeEventListener('beforeunload', onBeforeUnload)
  document.removeEventListener('keydown', onGlobalKeydown)
})
</script>

<template>
  <AppLayout>
    <Head :title="t('shopping.draft_title')" />
    <ConfirmDialog />

    <div class="mb-4 flex flex-wrap items-center justify-between gap-2">
      <div class="flex items-center gap-2">
        <Link href="/supplier/stock/drafts">
          <Button
            icon="pi pi-arrow-left"
            severity="secondary"
            text
            :aria-label="t('common.back')"
          />
        </Link>
        <h1 class="text-2xl font-bold text-gray-900 dark:text-zinc-100">
          {{ t('shopping.draft_title') }}
        </h1>
        <span
          class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
          :class="SOURCE_BADGE[draft.source]"
          >{{ t(`shopping.draft_source_${draft.source}`) }}</span
        >
      </div>
      <span class="text-sm text-gray-500 dark:text-zinc-400">{{
        formatDate(draft.createdAt)
      }}</span>
    </div>

    <Message
      v-if="!isOpen"
      severity="info"
      class="mb-4"
      :closable="false"
      data-testid="draft-closed"
    >
      {{
        draft.status === 'committed'
          ? t('shopping.draft_committed_info', {
              date: draft.committedAt ? formatDate(draft.committedAt) : '',
            })
          : t('shopping.draft_discarded_info')
      }}
    </Message>

    <!-- Column headers, once (the rows stack on small screens, so no headers there) -->
    <div
      class="mb-1 hidden grid-cols-12 gap-2 px-3 text-sm text-gray-700 md:grid dark:text-zinc-300"
    >
      <div class="col-span-5">{{ t('common.product') }}</div>
      <div class="col-span-2">{{ t('supplier.deliveries_amount') }}</div>
      <div class="col-span-2">{{ t('supplier.deliveries_purchase_price') }}</div>
      <div class="col-span-2 inline-flex items-center gap-1">
        {{ t('supplier.deliveries_price') }}
        <InfoHint
          :text="t('supplier.deliveries_margin_hint', { margin: marginPercent })"
          test-id="draft-price-hint"
        />
      </div>
    </div>

    <div class="space-y-2" data-testid="draft-rows">
      <div
        v-for="row in rows"
        :key="row.uid"
        class="grid grid-cols-[1fr_1fr_1fr_2.5rem] items-start gap-2 rounded-lg border bg-white p-3 md:grid-cols-12 dark:bg-zinc-900"
        :class="
          row.touched && rowProblem(row)
            ? 'border-amber-300 dark:border-amber-700'
            : 'border-gray-200 dark:border-zinc-700'
        "
        data-testid="draft-row"
        :data-product-id="row.productId ?? ''"
      >
        <div class="col-span-4 min-w-0 md:col-span-5">
          <Select
            :ref="keep(selectRefs, row.uid)"
            :modelValue="row.productId"
            :options="selectOptionsFor(row)"
            optionLabel="label"
            optionValue="value"
            :optionGroupLabel="row.productGroupId ? 'label' : undefined"
            :optionGroupChildren="row.productGroupId ? 'items' : undefined"
            filter
            autoOptionFocus
            fluid
            :disabled="!isOpen"
            :invalid="row.touched && !row.productId"
            :placeholder="t('shopping.draft_pick_product')"
            data-testid="draft-row-product"
            @show="nextTick(() => focusOwnFilter(row.uid))"
            @filter="onSelectFilter"
            @change="onProductChange(row, $event)"
            @keydown.enter.capture="onProductEnter(row, $event)"
          />
          <div
            v-if="row.label || row.productGroupId"
            class="mt-1 text-xs text-gray-500 dark:text-zinc-400"
          >
            <span v-if="row.label">{{ t(labelKey, { label: row.label }) }}</span>
            <span v-if="row.productGroupId && groupName.get(row.productGroupId)">
              · {{ t('shopping.draft_group', { name: groupName.get(row.productGroupId)! }) }}</span
            >
          </div>
          <Button
            v-if="isOpen && !row.productId"
            :label="t('shopping.draft_new_product')"
            icon="pi pi-plus"
            severity="secondary"
            text
            size="small"
            class="mt-1 -ml-2"
            :disabled="submitting !== null"
            data-testid="draft-row-new-product"
            @click="newProductFromRow(row)"
          />
        </div>
        <div class="md:col-span-2" @keydown.enter.prevent="onAmountEnter(row)">
          <InputNumber
            :ref="keep(amountRefs, row.uid)"
            v-model="row.amount"
            :min="1"
            :max="DELIVERY_MAX_AMOUNT"
            fluid
            highlightOnFocus
            :disabled="!isOpen"
            :invalid="row.touched && !row.ghost && (!row.amount || row.amount < 1)"
            :placeholder="t('common.pieces')"
            :pt="{ pcInputText: { root: { 'data-testid': 'draft-row-amount' } } }"
          />
        </div>
        <div class="md:col-span-2" @keydown.enter.prevent="onPurchaseEnter(row)">
          <InputNumber
            :ref="keep(purchaseRefs, row.uid)"
            v-model="row.purchasePrice"
            :min="0"
            :max="DELIVERY_MAX_PRICE"
            :minFractionDigits="2"
            :maxFractionDigits="2"
            fluid
            highlightOnFocus
            :disabled="!isOpen"
            :suffix="' ' + t('common.currency')"
            :placeholder="t('common.currency')"
            :pt="{ pcInputText: { root: { 'data-testid': 'draft-row-purchase-price' } } }"
          />
        </div>
        <div class="md:col-span-2" @keydown.enter.prevent="onPriceEnter(row)">
          <InputNumber
            :ref="keep(priceRefs, row.uid)"
            v-model="row.price"
            :min="1"
            :max="DELIVERY_MAX_PRICE"
            fluid
            highlightOnFocus
            :disabled="!isOpen"
            :invalid="row.touched && !row.ghost && !effectivePrice(row)"
            :suffix="' ' + t('common.currency')"
            :placeholder="pricePlaceholder(row)"
            :pt="{ pcInputText: { root: { 'data-testid': 'draft-row-price' } } }"
            @blur="materializePrice(row)"
          />
        </div>
        <div class="flex justify-end md:col-span-1">
          <Button
            v-if="isOpen && !row.ghost"
            icon="pi pi-times"
            severity="danger"
            text
            size="small"
            :aria-label="t('shopping.draft_remove_line')"
            data-testid="draft-row-remove"
            @click="removeRow(row.uid)"
          />
        </div>
        <div
          v-if="lastPricesText(row) || (row.touched && rowProblem(row)) || rowWarning(row)"
          class="col-span-4 flex flex-wrap gap-x-3 text-xs md:col-span-12"
        >
          <span v-if="lastPricesText(row)" class="text-gray-500 dark:text-zinc-400">{{
            lastPricesText(row)
          }}</span>
          <span
            v-if="row.touched && rowProblem(row)"
            class="text-amber-700 dark:text-amber-300"
            data-testid="draft-row-problem"
            >{{ rowProblem(row) }}</span
          >
          <span v-if="rowWarning(row)" class="text-red-600 dark:text-red-400">{{
            rowWarning(row)
          }}</span>
        </div>
      </div>
    </div>

    <div
      class="mt-4 flex flex-col gap-3 border-t border-gray-200 pt-4 md:flex-row md:items-center md:justify-between dark:border-zinc-700"
    >
      <div
        class="flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-700 dark:text-zinc-300"
        data-testid="draft-totals"
      >
        <span>{{
          t('shopping.draft_summary', { lines: lines.length, pieces: totals.pieces })
        }}</span>
        <span>{{ t('shopping.draft_total_purchase', { amount: money(totals.purchase) }) }}</span>
        <span>{{ t('shopping.draft_total_selling', { amount: money(totals.selling) }) }}</span>
        <span v-if="totals.profit !== null" class="font-semibold">{{
          t('shopping.draft_total_profit', { amount: money(totals.profit) })
        }}</span>
      </div>
      <div v-if="isOpen" class="flex flex-wrap items-center gap-2">
        <InputText
          v-model="note"
          class="w-full md:w-56"
          :maxlength="STOCK_DRAFT_NOTE_MAX"
          :placeholder="t('shopping.draft_note')"
          :aria-label="t('shopping.draft_note')"
          data-testid="draft-note"
        />
        <Button
          :label="t('shopping.draft_discard')"
          severity="danger"
          text
          data-testid="draft-discard"
          @click="discard"
        />
        <span
          class="inline-flex items-center gap-1 text-xs"
          :class="
            saveState === 'error'
              ? 'text-amber-700 dark:text-amber-300'
              : 'text-gray-500 dark:text-zinc-400'
          "
          :data-state="saveState"
          data-testid="draft-save-state"
        >
          <span
            :class="
              saveState === 'saved'
                ? 'pi pi-check'
                : saveState === 'error'
                  ? 'pi pi-exclamation-triangle'
                  : 'pi pi-spin pi-spinner'
            "
            aria-hidden="true"
          />
          {{
            saveState === 'saved'
              ? t('shopping.draft_saved')
              : saveState === 'error'
                ? t('shopping.draft_save_failed')
                : t('shopping.draft_saving')
          }}
        </span>
        <Button
          :label="commitLabel"
          icon="pi pi-check"
          :loading="submitting === 'commit'"
          :disabled="!canCommit"
          data-testid="draft-commit"
          @click="commit()"
        />
      </div>
    </div>
    <p
      v-if="isOpen && problems > 0 && lines.some((row) => row.touched)"
      class="mt-2 text-xs text-amber-700 dark:text-amber-300"
    >
      {{ t('shopping.draft_problems', { count: problems }) }}
    </p>

    <!-- Duplicate / unusual price check, done by the server at commit -->
    <Dialog
      v-model:visible="warningVisible"
      :header="t('supplier.warning_title')"
      :style="{ width: '28rem', maxWidth: 'calc(100vw - 2rem)' }"
      modal
      :draggable="false"
      data-testid="draft-warning-dialog"
      @hide="onWarningHide"
    >
      <div class="space-y-5">
        <section
          v-for="warning in warnings"
          :key="warning.index"
          class="space-y-2"
          data-testid="draft-warning-line"
        >
          <p class="text-sm font-semibold text-gray-900 dark:text-zinc-100">
            {{ warning.productName }}
            <span
              v-if="lineFor(warning)"
              class="font-normal text-gray-700 dark:text-zinc-300"
              data-testid="draft-warning-summary"
            >
              · {{ t('supplier.warning_amount', { amount: lineFor(warning)!.amount ?? 1 }) }}
              {{
                t('supplier.warning_unit_price', { price: effectivePrice(lineFor(warning)!) ?? '' })
              }}
            </span>
          </p>
          <div v-if="warning.duplicate" class="flex gap-3" data-testid="draft-warning-duplicate">
            <span
              class="pi pi-exclamation-triangle mt-0.5 text-amber-600 dark:text-amber-400"
              aria-hidden="true"
            />
            <div class="min-w-0 flex-1 text-sm">
              <p class="font-medium text-gray-900 dark:text-zinc-100">
                {{ t('supplier.warning_duplicate_title') }}
              </p>
              <p class="text-gray-700 dark:text-zinc-300">
                {{
                  t('supplier.warning_duplicate_detail', {
                    minutes: warning.duplicate.minutesAgo,
                    amount: warning.duplicate.amount,
                    price: warning.duplicate.price,
                  })
                }}
              </p>
              <p class="text-gray-500 dark:text-zinc-400">
                {{ t('supplier.warning_duplicate_hint') }}
              </p>
            </div>
          </div>
          <div v-if="warning.unusualPrice" class="flex gap-3" data-testid="draft-warning-price">
            <span
              class="pi pi-exclamation-triangle mt-0.5 text-amber-600 dark:text-amber-400"
              aria-hidden="true"
            />
            <div class="min-w-0 flex-1 text-sm">
              <p class="font-medium text-gray-900 dark:text-zinc-100">
                {{ t('supplier.warning_price_title') }}
              </p>
              <p class="text-gray-700 dark:text-zinc-300">
                {{
                  t('supplier.warning_price_detail', {
                    price: warning.unusualPrice.lastPrice,
                    supplier: warningSupplier(warning),
                    date: formatDate(warning.unusualPrice.lastCreatedAt).replace(/ /g, ' '),
                  })
                }}
              </p>
              <p class="text-gray-500 dark:text-zinc-400">{{ t('supplier.warning_price_hint') }}</p>
            </div>
          </div>
        </section>
      </div>
      <template #footer>
        <Button
          autofocus
          :label="t('common.cancel')"
          severity="secondary"
          text
          data-testid="draft-warning-cancel"
          @click="cancelWarnings"
        />
        <Button
          :label="t('supplier.warning_confirm')"
          :disabled="submitting !== null"
          :loading="submitting === 'commit'"
          data-testid="draft-warning-confirm"
          @click="commit(true)"
        />
      </template>
    </Dialog>
  </AppLayout>
</template>
