<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'
import { Head, router, usePage } from '@inertiajs/vue3'
import AppLayout from '~/layouts/AppLayout.vue'
import Button from 'primevue/button'
import ConfirmDialog from 'primevue/confirmdialog'
import Dialog from 'primevue/dialog'
import InputNumber from '~/components/NumberInput.vue'
import InputText from 'primevue/inputtext'
import Textarea from 'primevue/textarea'
import Message from 'primevue/message'
import Select from 'primevue/select'
import InfoHint from '~/components/InfoHint.vue'
import { useI18n } from '~/composables/use_i18n'
import { useAppConfirm } from '~/composables/use_app_confirm'
import { useSelectEnterKey } from '~/composables/use_select_enter_key'
import { formatDate } from '~/composables/use_format_date'
import { suggestDraftPrice, useMoney } from '~/composables/use_pricing'
import { STOCK_DRAFT_MAX_ITEMS, STOCK_DRAFT_NOTE_MAX } from '~/composables/use_shopping_validation'
import {
  CORRECTION_REASON_MAX_LENGTH,
  CORRECTION_REASON_MIN_LENGTH,
  DELIVERY_MAX_AMOUNT,
  DELIVERY_MAX_PRICE,
} from '~/composables/use_delivery_correction_validation'
import type { SharedProps } from '~/types'

type DraftSource = 'web' | 'mcp' | 'shopping_list'
/** Who put a line on the draft — one draft collects lines from all of them. */
type LineSource = 'web' | 'shopping_list' | 'assistant'

interface DraftItem {
  id: number
  productId: number | null
  productGroupId: number | null
  label: string | null
  amount: number
  purchasePrice: number | null
  purchasePriceEstimated: boolean
  price: number | null
  source: LineSource
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
  /** The selling price the line will be stocked at. */
  price: number
  duplicate: { amount: number; price: number; minutesAgo: number } | null
  unusualPrice: {
    lastPrice: number
    lastSupplierId: number
    lastSupplierName: string
    lastCreatedAt: string
  } | null
  unusualPurchasePrice: { lastPurchasePrice: number; lastCreatedAt: string } | null
  estimatedPurchasePrice: boolean
}

type SaveErrorCode = 'DRAFT_STALE' | 'DRAFT_CLOSED' | 'DRAFT_NOT_FOUND' | string

/** A draft older than this carries a "since {date}" badge: is it really today's shopping? */
const DRAFT_OLD_HOURS = 24

const props = defineProps<{
  draft: {
    id: number
    source: DraftSource
    note: string | null
    status: 'open' | 'committed' | 'discarded' | 'voided'
    createdAt: string
    updatedAt: string
    committedAt: string | null
    voidedAt: string | null
    voidReason: string | null
    canVoid: boolean
    /** Sent back with every save; the server refuses a save over a newer draft. */
    version: number
    items: DraftItem[]
  }
  products: ProductOption[]
  groups: Array<{ id: number; name: string }>
  marginPercent: number
  focusItemId: number | null
}>()

const { t, tp } = useI18n()
const { amount: formatAmount, money } = useMoney()
const confirm = useAppConfirm()
const page = usePage<SharedProps>()
const currentUserId = computed(() => page.props.user?.id)

/** A line by hand carries no badge; one from the list or an assistant says so. */
const LINE_BADGE: Record<Exclude<LineSource, 'web'>, string> = {
  assistant: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-200',
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
  /** Still the shopping list's estimate — cleared once the supplier types a price. */
  purchasePriceEstimated: boolean
  price: number | null
  source: LineSource
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
    purchasePriceEstimated: false,
    price: null,
    source: 'web',
    ghost: true,
    touched: false,
  }
}

function rowsFromProps(): Row[] {
  return [
    ...props.draft.items.map(
      (item): Row => ({
        uid: nextUid++,
        itemId: item.id,
        productId: item.productId,
        productGroupId: item.productGroupId,
        label: item.label,
        amount: item.amount,
        purchasePrice: item.purchasePrice,
        purchasePriceEstimated: item.purchasePriceEstimated,
        price: item.price,
        source: item.source,
        ghost: false,
        touched: true,
      })
    ),
    ...(props.draft.status === 'open' ? [ghostRow()] : []),
  ]
}

const rows = ref<Row[]>(rowsFromProps())
const note = ref(props.draft.note ?? '')

/** "Rozpracováno {date}" on a draft started more than a day ago. */
const startedLongAgo = computed(
  () =>
    isOpen.value &&
    Date.now() - new Date(props.draft.createdAt).getTime() > DRAFT_OLD_HOURS * 3_600_000
)
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
function labelKey(row: Row): string {
  return row.source === 'assistant' ? 'shopping.draft_label' : 'shopping.draft_label_list'
}

/**
 * What a list line came from, once: a group line is labelled with the group's name, so
 * "Ze seznamu: Energy drink · skupina Energy drink" says it only as "skupina Energy drink".
 */
function rowOrigin(row: Row): { label: string | null; group: string | null } {
  const group = row.productGroupId ? (groupName.value.get(row.productGroupId) ?? null) : null
  const label = row.label && row.label !== group ? row.label : null
  return { label, group }
}

/**
 * The selling price offered when the supplier types none — the same rule the server applies
 * on commit (`suggestDraftPrice`): purchase price plus the owner's margin, never below what
 * the product sold for last time.
 */
function suggestedPrice(row: Row): number | null {
  const last = row.productId ? productById.value.get(row.productId)?.lastPrice : null
  return suggestDraftPrice(row.purchasePrice, props.marginPercent, last)
}

function effectivePrice(row: Row): number | null {
  return row.price ?? suggestedPrice(row)
}

function rowProblem(row: Row): string {
  if (row.ghost) return ''
  if (!row.productId) return t('shopping.draft_problem_product')
  if (!row.amount || row.amount < 1) return t('shopping.draft_problem_amount')
  // Upper bounds are checked here, not by InputNumber's max (CLAUDE.md › Number fields).
  if (row.amount > DELIVERY_MAX_AMOUNT) {
    return t('shopping.draft_problem_amount_max', { max: DELIVERY_MAX_AMOUNT })
  }
  const price = effectivePrice(row)
  if (!price) return t('shopping.draft_problem_price')
  if (price > DELIVERY_MAX_PRICE || (row.purchasePrice ?? 0) > DELIVERY_MAX_PRICE) {
    return t('shopping.draft_problem_price_max', { max: DELIVERY_MAX_PRICE })
  }
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

/** 1-based number of an earlier line with the same product, for the duplicate hint. */
function duplicateOf(row: Row): number | null {
  if (row.ghost || !row.productId) return null
  const index = lines.value.findIndex((other) => other.productId === row.productId)
  return index >= 0 && lines.value[index] !== row ? index + 1 : null
}

function pricePlaceholder(row: Row): string {
  const suggested = suggestedPrice(row)
  return suggested !== null
    ? t('shopping.draft_price_suggested', { price: suggested })
    : t('common.currency')
}

const problems = computed(() => lines.value.filter((row) => rowProblem(row)).length)
const completeLines = computed(() => lines.value.filter((row) => !rowProblem(row)))
/** The pieces the button stocks — the summary beside it counts every line. */
const completePieces = computed(() =>
  completeLines.value.reduce((sum, row) => sum + (row.amount ?? 0), 0)
)
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
    ? tp('shopping.draft_commit_count', completeLines.value.length, {
        pieces: completePieces.value,
      })
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

/**
 * Focus and select — and once more shortly after, because PrimeVue re-renders the input
 * right after mount and the focus can drop to the page. Only the newest request counts, and
 * the second pass never pulls the focus back from a field the supplier has already moved on
 * to (a quick Enter, Enter would otherwise land in the field two steps back).
 */
let focusTimer: ReturnType<typeof setTimeout> | null = null
function focusField(map: Map<number, any>, uid: number) {
  if (focusTimer) clearTimeout(focusTimer)
  let focused: HTMLInputElement | null = null
  const run = (retry: boolean) => {
    const input = inputOf(map.get(uid))
    if (!input) return
    const active = document.activeElement
    if (retry && active && active !== document.body && active !== focused) return
    if (active === input) return
    input.focus()
    input.select()
    focused = input
  }
  nextTick(() => run(false))
  focusTimer = setTimeout(() => {
    focusTimer = null
    run(true)
  }, 120)
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
  // Stocking started meanwhile (a click right after Enter): opening the next line's search
  // now would pull the focus out of the warning dialog.
  if (submitting.value !== null || warningVisible.value) return
  fadingOverlays = fadingOverlays.filter((el) => el.isConnected)
  if ((fadingOverlays.length === 0 && !openSelectEntry()) || attempts <= 0) {
    nextTick(() => {
      if (submitting.value === null && !warningVisible.value) action()
    })
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

/** Typing a purchase price replaces the shopping list's estimate. */
function onPurchaseInput(row: Row, value: number | null) {
  row.purchasePrice = value
  row.purchasePriceEstimated = false
}

// A removed line can be put back for a few seconds — one tap on a phone is easy to miss.
const removed = ref<{ row: Row; index: number } | null>(null)
let removedTimer: ReturnType<typeof setTimeout> | null = null

function removeRow(uid: number) {
  const index = rows.value.findIndex((row) => row.uid === uid)
  if (index < 0) return
  removed.value = { row: rows.value[index], index }
  rows.value = rows.value.filter((row) => row.uid !== uid)
  ensureGhost()
  if (removedTimer) clearTimeout(removedTimer)
  removedTimer = setTimeout(() => (removed.value = null), 6000)
}

function undoRemove() {
  if (!removed.value || !isOpen.value) return
  const { row, index } = removed.value
  rows.value.splice(Math.min(index, rows.value.length), 0, row)
  removed.value = null
  if (removedTimer) clearTimeout(removedTimer)
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
      purchasePriceEstimated: row.purchasePriceEstimated,
      source: row.source,
      price: materialize ? (row.price ?? suggestedPrice(row)) : row.price,
    })),
  }
}

/** The page's state is the draft as the server now has it (after a refused save). */
function resetFromProps() {
  cancelSave()
  rows.value = rowsFromProps()
  note.value = props.draft.note ?? ''
  lastSaved = JSON.stringify(payload())
  saveState.value = 'saved'
}

/** Inertia's partial reload, as a promise (the page waits for the server's draft). */
function reloadProps(only: string[]): Promise<void> {
  return new Promise((resolve) => {
    router.reload({ only, onFinish: () => resolve() })
  })
}

/**
 * A JSON request to the draft endpoint, outside the Inertia router: whatever the server
 * answers — 409, 419, 422, 500, nothing at all — the page stays and only the footer says the
 * save failed. The XSRF cookie is what Inertia's own requests send.
 */
function draftRequest(body: unknown, options: { keepalive?: boolean } = {}) {
  const token = document.cookie
    .split('; ')
    .find((part) => part.startsWith('XSRF-TOKEN='))
    ?.slice('XSRF-TOKEN='.length)
  return fetch(`/supplier/stock/drafts/${props.draft.id}`, {
    method: 'PUT',
    keepalive: options.keepalive,
    redirect: 'manual',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
      'X-Draft-Autosave': '1',
      ...(token ? { 'X-XSRF-TOKEN': decodeURIComponent(token) } : {}),
    },
    body: JSON.stringify(body),
  })
}

function saveErrorOf(response: { props: Record<string, unknown> }): SaveErrorCode | null {
  const flash = response.props.flash as Record<string, unknown> | undefined
  return (flash?.draftSaveError as SaveErrorCode | undefined) ?? null
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
// the footer says "Uloženo" / "Ukládám…". Nothing is stocked by a save. Each save carries the
// draft version the page has; a save over a newer draft (an assistant fixed a line, another
// tab) is refused and the page shows the newer draft instead of overwriting it.
type SaveState = 'saved' | 'pending' | 'saving' | 'error'
const saveState = ref<SaveState>('saved')
let saveTimer: ReturnType<typeof setTimeout> | null = null
let saveInFlight = false
let saveQueued = false
let lastSaved = JSON.stringify(payload())
/** The draft version this page edits; every save moves it on (see `draftVersion`). */
let version = props.draft.version
watch(
  () => props.draft.version,
  (next) => (version = next)
)
/** Lines the server holds — the menu badge counts drafts with at least one. */
let savedLineCount = props.draft.items.length
/** Run once the draft is stored — never after a failed save (a held navigation, a commit). */
const afterSave: Array<() => void> = []
/** Run instead when the save failed. */
const afterFailure: Array<() => void> = []

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

/**
 * Saves now (a pending save first). `done` runs once the draft is stored; `failed` runs
 * instead when the server refused the save or it never got there — the page then keeps
 * the "Uložení selhalo" state rather than pretending all is well.
 */
function flushSave(done?: () => void, failed?: () => void) {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  if (done) afterSave.push(done)
  if (failed) afterFailure.push(failed)
  if (!isOpen.value || submitting.value === 'commit') return settleSave(true)
  const body = payload()
  const snapshot = JSON.stringify(body)
  if (snapshot === lastSaved && !saveInFlight) {
    saveState.value = 'saved'
    return settleSave(true)
  }
  if (saveInFlight) {
    saveQueued = true
    return
  }
  saveInFlight = true
  saveState.value = 'saving'
  let stored = false
  draftRequest({ ...body, version })
    .then(async (response) => {
      if (response.ok) {
        const saved = (await response.json()) as { version: number; lines: number }
        stored = true
        version = saved.version
        lastSaved = snapshot
        saveState.value = 'saved'
        // The first line in (or the last one out) changes the menu badge.
        if (saved.lines > 0 !== savedLineCount > 0) reloadProps(['openDraftCount'])
        savedLineCount = saved.lines
        return
      }
      const refusal =
        response.status === 409
          ? ((await response.json().catch(() => ({}))) as { error?: SaveErrorCode }).error
          : undefined
      if (refusal === 'DRAFT_STALE' || refusal === 'DRAFT_CLOSED') {
        // The server's draft wins; the reload brings it and the flash saying why. Not a
        // success: a commit waiting for this save must not stock lines nobody has seen.
        await reloadProps(['draft', 'openDraftCount'])
        resetFromProps()
        return
      }
      if (refusal === 'DRAFT_NOT_FOUND') {
        await reloadProps(['draft'])
      }
      saveState.value = 'error'
    })
    .catch(() => {
      saveState.value = 'error'
    })
    .finally(() => {
      saveInFlight = false
      if (!stored && saveState.value !== 'saved') saveState.value = 'error'
      if (saveQueued && stored) {
        saveQueued = false
        flushSave()
        return
      }
      saveQueued = false
      settleSave(stored)
    })
}

function settleSave(ok: boolean) {
  const run = ok ? afterSave.splice(0) : afterFailure.splice(0)
  if (ok) afterFailure.length = 0
  else afterSave.length = 0
  for (const callback of run) callback()
}

function cancelSave() {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = null
}

/**
 * The last resort when the page goes away without the navigation guard (browser Back,
 * which Inertia replays without a `before` event): the unsaved lines go out in a request
 * that outlives the page.
 */
function saveOnLeave() {
  if (!isOpen.value || submitting.value === 'commit') return
  const snapshot = JSON.stringify(payload())
  if (snapshot === lastSaved) return
  lastSaved = snapshot
  draftRequest({ ...payload(), version }, { keepalive: true }).catch(() => {})
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

  // A save still on its way would move the version under the commit; let it land first.
  if (saveInFlight) {
    flushSave(() => commit(confirmWarnings))
    return
  }
  cancelSave()
  submitting.value = 'commit'
  router.post(
    `/supplier/stock/drafts/${props.draft.id}/commit`,
    {
      ...payload(true),
      version,
      ...(confirmWarnings ? { confirmWarnings: true } : {}),
    },
    {
      preserveScroll: true,
      preserveState: true,
      onSuccess: (response) => {
        const error = saveErrorOf(response)
        if (error === 'DRAFT_STALE' || error === 'DRAFT_CLOSED') {
          warningVisible.value = false
          warnings.value = []
          resetFromProps()
          return
        }
        const flagged = (response.props.flash as Record<string, unknown> | undefined)
          ?.draftWarnings as DraftWarning[] | undefined
        if (flagged?.length) {
          // The lines were saved with the commit attempt.
          lastSaved = JSON.stringify(payload())
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

/** Lines flagged only because their purchase price is still the list's estimate. */
const estimatedCount = computed(
  () => warnings.value.filter((warning) => warning.estimatedPurchasePrice).length
)
/** Lines with something besides the estimate to look at — each gets its own section. */
const detailedWarnings = computed(() =>
  warnings.value.filter(
    (warning) => warning.duplicate || warning.unusualPrice || warning.unusualPurchasePrice
  )
)

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

// ─── Void a stocked draft as a whole ──────────────────────────────────────────
const voidVisible = ref(false)
const voidReason = ref('')
const voiding = ref(false)
const voidReasonValid = computed(() => {
  const length = voidReason.value.trim().length
  return length >= CORRECTION_REASON_MIN_LENGTH && length <= CORRECTION_REASON_MAX_LENGTH
})

function openVoid() {
  voidReason.value = ''
  voidVisible.value = true
}

function focusVoidReason() {
  nextTick(() => (document.getElementById('draft-void-reason') as HTMLElement | null)?.focus())
}

function submitVoid() {
  if (!voidReasonValid.value || voiding.value) return
  voiding.value = true
  router.post(
    `/supplier/stock/drafts/${props.draft.id}/void`,
    { reason: voidReason.value.trim() },
    {
      preserveScroll: true,
      onSuccess: () => {
        if (props.draft.status === 'voided') voidVisible.value = false
      },
      onFinish: () => {
        voiding.value = false
      },
    }
  )
}

/** Ctrl+Enter (⌘+Enter) anywhere on the page stocks the draft. */
function onGlobalKeydown(event: KeyboardEvent) {
  if (event.key !== 'Enter' || !(event.ctrlKey || event.metaKey)) return
  event.preventDefault()
  commit()
}

/**
 * Leaving the page (Zpět, the menu, a tab) first stores a pending change — the navigation
 * is held back for the few hundred milliseconds the save takes, then replayed. If the save
 * fails, the supplier is asked before the changes are left behind.
 */
let stopBeforeVisit: (() => void) | null = null
let leavingAnyway = false
function onBeforeUnload(event: BeforeUnloadEvent) {
  if (hasUnsavedChanges.value) event.preventDefault()
}

function goBack() {
  router.get('/supplier/stock')
}

onMounted(() => {
  stopBeforeVisit = router.on('before', (event) => {
    const visit = event.detail.visit
    // A partial reload (the draft after a refused save, the badge) is not leaving the page.
    if (leavingAnyway || visit.method !== 'get' || !isOpen.value || visit.only.length) return
    if (!hasUnsavedChanges.value) return
    event.preventDefault()
    const replay = () =>
      router.visit(visit.url, { method: 'get', preserveScroll: visit.preserveScroll })
    flushSave(replay, () => {
      // Refused because the draft changed or closed meanwhile: the page already shows the
      // server's version, so there is nothing left to lose.
      if (!hasUnsavedChanges.value) return replay()
      confirm.require({
        header: t('shopping.draft_leave_title'),
        message: t('shopping.draft_leave_message'),
        acceptLabel: t('shopping.draft_leave_confirm'),
        rejectLabel: t('common.cancel'),
        destructive: true,
        accept: () => {
          leavingAnyway = true
          replay()
        },
      })
    })
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
  if (lines.value.every((row) => row.source === 'web')) {
    nextTick(() => openProductSelect(ghost.uid))
  } else {
    nextTick(() => inputOf(selectRefs.get(ghost.uid))?.focus())
  }
})

onBeforeUnmount(() => {
  if (!leavingAnyway) saveOnLeave()
  if (removedTimer) clearTimeout(removedTimer)
  stopBeforeVisit?.()
  window.removeEventListener('beforeunload', onBeforeUnload)
  document.removeEventListener('keydown', onGlobalKeydown)
})
</script>

<template>
  <AppLayout>
    <Head :title="t('shopping.draft_title')" />
    <ConfirmDialog />

    <!--
      Header: title and source on the left, the draft's note beside it on wide screens (it
      is the one thing worth writing about a whole draft), the date and the quiet save state
      on the right. On a phone the three stack: title, date + save state, then the note.
    -->
    <div class="mb-6 flex flex-col gap-3 lg:flex-row lg:items-end lg:gap-8">
      <div class="order-1 flex min-w-0 items-center gap-2">
        <Button
          icon="pi pi-arrow-left"
          severity="secondary"
          text
          :aria-label="t('common.back')"
          data-testid="draft-back"
          @click="goBack"
        />
        <h1 class="text-2xl font-bold text-gray-900 dark:text-zinc-100">
          {{ t('shopping.draft_title') }}
        </h1>
        <span
          v-if="startedLongAgo"
          class="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/30 dark:text-amber-200"
          data-testid="draft-in-progress"
          >{{ t('shopping.draft_in_progress', { date: formatDate(draft.createdAt) }) }}</span
        >
      </div>
      <div v-if="isOpen" class="order-3 w-full lg:order-2 lg:mr-auto lg:w-96">
        <label for="draft-note" class="mb-1 block text-sm text-gray-700 dark:text-zinc-300">{{
          t('shopping.draft_note_label')
        }}</label>
        <InputText
          id="draft-note"
          v-model="note"
          fluid
          :maxlength="STOCK_DRAFT_NOTE_MAX"
          :placeholder="t('shopping.draft_note_placeholder')"
          data-testid="draft-note"
        />
      </div>
      <p
        v-else-if="draft.note"
        class="order-3 text-sm text-gray-700 lg:order-2 lg:mr-auto lg:pb-2 dark:text-zinc-300"
      >
        {{ draft.note }}
      </p>
      <div
        class="order-2 flex items-center justify-between gap-x-4 text-sm text-gray-500 lg:order-3 lg:flex-col lg:items-end lg:gap-y-0.5 dark:text-zinc-400"
      >
        <span>{{ formatDate(draft.createdAt) }}</span>
        <span
          v-if="isOpen"
          class="inline-flex items-center gap-1 text-xs"
          :class="saveState === 'error' ? 'text-amber-700 dark:text-amber-300' : ''"
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
      </div>
    </div>

    <Message
      v-if="!isOpen"
      :severity="draft.status === 'voided' ? 'warn' : 'info'"
      class="mb-4"
      :closable="false"
      data-testid="draft-closed"
    >
      <div class="flex flex-wrap items-center justify-between gap-2">
        <span>{{
          draft.status === 'committed'
            ? t('shopping.draft_committed_info', {
                date: draft.committedAt ? formatDate(draft.committedAt) : '',
              })
            : draft.status === 'voided'
              ? t('shopping.draft_voided_info', {
                  date: draft.voidedAt ? formatDate(draft.voidedAt) : '',
                  reason: draft.voidReason ?? '',
                })
              : t('shopping.draft_discarded_info')
        }}</span>
        <span v-if="draft.status === 'committed'" class="inline-flex items-center gap-1">
          <Button
            :label="t('shopping.draft_void')"
            severity="danger"
            text
            size="small"
            :disabled="!draft.canVoid"
            data-testid="draft-void"
            @click="openVoid"
          />
          <InfoHint
            v-if="!draft.canVoid"
            :text="t('shopping.draft_void_unavailable')"
            test-id="draft-void-unavailable"
          />
        </span>
      </div>
    </Message>

    <Dialog
      v-model:visible="voidVisible"
      :header="t('shopping.draft_void')"
      :style="{ width: '28rem' }"
      modal
      :draggable="false"
      data-testid="draft-void-dialog"
      @show="focusVoidReason"
    >
      <form id="draft-void-form" class="space-y-3" @submit.prevent="submitVoid">
        <p class="text-sm text-gray-700 dark:text-zinc-300">
          {{ t('shopping.draft_void_message') }}
        </p>
        <div>
          <label for="draft-void-reason" class="mb-1 block text-sm text-gray-700 dark:text-zinc-300"
            >{{ t('supplier.void_reason') }} *</label
          >
          <Textarea
            id="draft-void-reason"
            v-model="voidReason"
            rows="2"
            class="w-full"
            autoResize
            :maxlength="CORRECTION_REASON_MAX_LENGTH"
            :placeholder="t('supplier.void_reason_placeholder')"
            data-testid="draft-void-reason"
          />
          <small
            v-if="voidReason.trim().length > 0 && !voidReasonValid"
            class="text-red-500 dark:text-red-400"
            >{{
              t('supplier.correction_reason_hint', {
                min: CORRECTION_REASON_MIN_LENGTH,
                max: CORRECTION_REASON_MAX_LENGTH,
              })
            }}</small
          >
        </div>
      </form>
      <template #footer>
        <Button
          :label="t('common.cancel')"
          severity="secondary"
          text
          @click="voidVisible = false"
        />
        <Button
          type="submit"
          form="draft-void-form"
          :label="t('shopping.draft_void_confirm')"
          severity="danger"
          :disabled="!voidReasonValid || voiding"
          :loading="voiding"
          data-testid="draft-void-confirm"
        />
      </template>
    </Dialog>

    <!-- Column headers, once; on a phone each line carries its own small labels instead -->
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

    <!--
      One card per line. On md+ a single grid row: product, amount, purchase, selling, remove.
      On a phone the same cells reflow (`order-*`, DOM and Tab order stay put): the product with
      the remove button on the first row, the three numbers side by side on the second, each
      with its own small label because the column headers are hidden there.
    -->
    <div class="space-y-2" data-testid="draft-rows">
      <div
        v-for="row in rows"
        :key="row.uid"
        class="grid grid-cols-12 items-start gap-x-2 gap-y-3 rounded-lg border bg-white p-3 md:gap-2 dark:bg-zinc-900"
        :class="
          row.touched && rowProblem(row)
            ? 'border-amber-300 dark:border-amber-700'
            : 'border-gray-200 dark:border-zinc-700'
        "
        data-testid="draft-row"
        :data-product-id="row.productId ?? ''"
      >
        <div class="order-1 col-span-10 min-w-0 md:order-none md:col-span-5">
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
            v-if="row.source !== 'web' || rowOrigin(row).label || rowOrigin(row).group"
            class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-gray-500 dark:text-zinc-400"
            data-testid="draft-row-origin"
          >
            <span
              v-if="row.source !== 'web'"
              class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
              :class="LINE_BADGE[row.source]"
              :data-source="row.source"
              data-testid="draft-row-source"
              >{{ t(`shopping.draft_line_source_${row.source}`) }}</span
            >
            <span>{{
              [
                rowOrigin(row).label ? t(labelKey(row), { label: rowOrigin(row).label! }) : null,
                rowOrigin(row).group
                  ? rowOrigin(row).label
                    ? t('shopping.draft_group', { name: rowOrigin(row).group! })
                    : t(labelKey(row), {
                        label: t('shopping.draft_group', { name: rowOrigin(row).group! }),
                      })
                  : null,
              ]
                .filter(Boolean)
                .join(' · ')
            }}</span>
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
        <div
          class="order-3 col-span-3 md:order-none md:col-span-2"
          @keydown.enter.prevent="onAmountEnter(row)"
        >
          <label
            :for="`draft-amount-${row.uid}`"
            class="mb-1 block text-xs text-gray-700 md:hidden dark:text-zinc-300"
            >{{ t('supplier.deliveries_amount') }}</label
          >
          <InputNumber
            :ref="keep(amountRefs, row.uid)"
            v-model="row.amount"
            :inputId="`draft-amount-${row.uid}`"
            :min="1"
            fluid
            highlightOnFocus
            :live="false"
            :disabled="!isOpen"
            :invalid="row.touched && !row.ghost && (!row.amount || row.amount < 1)"
            :placeholder="t('common.pieces')"
            :pt="{ pcInputText: { root: { 'data-testid': 'draft-row-amount' } } }"
          />
        </div>
        <div
          class="order-4 col-span-4 md:order-none md:col-span-2"
          @keydown.enter.prevent="onPurchaseEnter(row)"
        >
          <label
            :for="`draft-purchase-${row.uid}`"
            class="mb-1 block text-xs text-gray-700 md:hidden dark:text-zinc-300"
            >{{ t('supplier.deliveries_purchase_price') }}</label
          >
          <InputNumber
            :ref="keep(purchaseRefs, row.uid)"
            :modelValue="row.purchasePrice"
            :inputId="`draft-purchase-${row.uid}`"
            :min="0"
            :minFractionDigits="2"
            :maxFractionDigits="2"
            fluid
            highlightOnFocus
            :live="false"
            :disabled="!isOpen"
            :suffix="' ' + t('common.currency')"
            :placeholder="t('common.currency')"
            :pt="{ pcInputText: { root: { 'data-testid': 'draft-row-purchase-price' } } }"
            @update:modelValue="onPurchaseInput(row, $event)"
          />
          <div
            v-if="row.purchasePriceEstimated && row.purchasePrice !== null"
            class="mt-1 inline-flex items-center gap-1 text-xs text-amber-700 dark:text-amber-300"
            data-testid="draft-row-estimated"
          >
            <span class="h-2 w-2 rounded-full bg-amber-500" aria-hidden="true" />
            {{ t('shopping.draft_estimated_badge') }}
            <InfoHint :text="t('shopping.draft_estimated')" />
          </div>
        </div>
        <div
          class="order-5 col-span-5 md:order-none md:col-span-2"
          @keydown.enter.prevent="onPriceEnter(row)"
        >
          <label
            :for="`draft-price-${row.uid}`"
            class="mb-1 block text-xs text-gray-700 md:hidden dark:text-zinc-300"
            >{{ t('supplier.deliveries_price') }}</label
          >
          <InputNumber
            :ref="keep(priceRefs, row.uid)"
            v-model="row.price"
            :inputId="`draft-price-${row.uid}`"
            :min="1"
            fluid
            highlightOnFocus
            :live="false"
            :disabled="!isOpen"
            :invalid="row.touched && !row.ghost && !effectivePrice(row)"
            :suffix="' ' + t('common.currency')"
            :placeholder="pricePlaceholder(row)"
            :pt="{ pcInputText: { root: { 'data-testid': 'draft-row-price' } } }"
            @blur="materializePrice(row)"
          />
        </div>
        <div
          class="order-2 col-span-2 flex min-h-10 items-center justify-end md:order-none md:col-span-1"
        >
          <Button
            v-if="isOpen && !row.ghost"
            icon="pi pi-times"
            severity="secondary"
            text
            size="small"
            class="hover:!text-red-600 dark:hover:!text-red-400"
            :aria-label="t('shopping.draft_remove_line')"
            data-testid="draft-row-remove"
            @click="removeRow(row.uid)"
          />
        </div>
        <div
          v-if="
            lastPricesText(row) ||
            (row.touched && rowProblem(row)) ||
            rowWarning(row) ||
            duplicateOf(row)
          "
          class="order-6 col-span-12 flex flex-wrap gap-x-3 gap-y-0.5 text-xs md:order-none"
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
          <span
            v-if="duplicateOf(row)"
            class="text-amber-700 dark:text-amber-300"
            data-testid="draft-row-duplicate"
            >{{ t('shopping.draft_duplicate', { line: duplicateOf(row)! }) }}</span
          >
        </div>
      </div>
    </div>

    <!--
      Footer: the totals on the left, the two actions on the right — Discard as a quiet text
      button, Stock as the one filled button. On a phone the actions stack under the totals
      with Stock full width where the thumb is and Discard beneath it.
    -->
    <div
      class="sticky bottom-0 z-10 -mx-4 mt-6 border-t border-gray-200 bg-white/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur md:static md:mx-0 md:bg-transparent md:px-0 md:pt-4 md:pb-0 md:backdrop-blur-none dark:border-zinc-700 dark:bg-zinc-900/95 md:dark:bg-transparent"
      data-testid="draft-footer"
    >
      <div
        v-if="removed"
        class="mb-3 flex items-center justify-between gap-3 rounded-md bg-gray-100 px-3 py-2 text-sm text-gray-800 dark:bg-zinc-800 dark:text-zinc-200"
        role="status"
        data-testid="draft-row-removed"
      >
        {{ t('shopping.draft_removed') }}
        <Button
          :label="t('shopping.draft_undo')"
          severity="secondary"
          text
          size="small"
          data-testid="draft-row-undo"
          @click="undoRemove"
        />
      </div>
      <div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between md:gap-4">
        <div class="space-y-1">
          <div
            class="flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-700 dark:text-zinc-300"
            data-testid="draft-totals"
          >
            <span>{{
              t('shopping.draft_summary', { lines: lines.length, pieces: totals.pieces })
            }}</span>
            <span>{{
              t('shopping.draft_total_purchase', { amount: money(totals.purchase) })
            }}</span>
            <span>{{ t('shopping.draft_total_selling', { amount: money(totals.selling) }) }}</span>
            <span v-if="totals.profit !== null" class="font-semibold">{{
              t('shopping.draft_total_profit', { amount: money(totals.profit) })
            }}</span>
            <span
              v-else-if="lines.length > 0"
              class="inline-flex items-center gap-1 font-semibold"
              data-testid="draft-profit-unknown"
            >
              {{ t('shopping.draft_profit_unknown') }}
              <InfoHint :text="t('shopping.draft_profit_unknown_hint')" />
            </span>
          </div>
          <!-- Why Stock is greyed out — read before the button, on every screen size -->
          <p
            v-if="isOpen && problems > 0 && lines.some((row) => row.touched)"
            class="text-xs text-amber-700 dark:text-amber-300"
          >
            {{ t('shopping.draft_problems', { count: problems }) }}
          </p>
        </div>
        <div
          v-if="isOpen"
          class="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end"
        >
          <Button
            :label="t('shopping.draft_discard')"
            severity="danger"
            text
            class="w-full sm:w-auto"
            data-testid="draft-discard"
            @click="discard"
          />
          <Button
            :label="commitLabel"
            icon="pi pi-check"
            class="w-full sm:w-auto"
            :loading="submitting === 'commit'"
            :disabled="!canCommit"
            data-testid="draft-commit"
            @click="commit()"
          />
        </div>
      </div>
    </div>

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
        <p
          v-if="estimatedCount > 0"
          class="flex gap-3 text-sm text-gray-700 dark:text-zinc-300"
          data-testid="draft-warning-estimated"
        >
          <span
            class="pi pi-exclamation-triangle mt-0.5 text-amber-600 dark:text-amber-400"
            aria-hidden="true"
          />
          {{ tp('shopping.draft_warning_estimated', estimatedCount) }}
        </p>
        <section
          v-for="warning in detailedWarnings"
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
              {{ t('supplier.warning_unit_price', { price: formatAmount(warning.price) }) }}
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
                    price: formatAmount(warning.duplicate.price),
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
                    price: formatAmount(warning.unusualPrice.lastPrice),
                    supplier: warningSupplier(warning),
                    date: formatDate(warning.unusualPrice.lastCreatedAt).replace(/ /g, '\u00a0'),
                  })
                }}
              </p>
              <p class="text-gray-500 dark:text-zinc-400">{{ t('supplier.warning_price_hint') }}</p>
            </div>
          </div>
          <div
            v-if="warning.unusualPurchasePrice"
            class="flex gap-3"
            data-testid="draft-warning-purchase-price"
          >
            <span
              class="pi pi-exclamation-triangle mt-0.5 text-amber-600 dark:text-amber-400"
              aria-hidden="true"
            />
            <div class="min-w-0 flex-1 text-sm">
              <p class="font-medium text-gray-900 dark:text-zinc-100">
                {{ t('shopping.draft_warning_purchase_title') }}
              </p>
              <p class="text-gray-700 dark:text-zinc-300">
                {{
                  t('shopping.draft_warning_purchase_detail', {
                    price: formatAmount(lineFor(warning)?.purchasePrice ?? null),
                    last: formatAmount(warning.unusualPurchasePrice.lastPurchasePrice),
                    date: formatDate(warning.unusualPurchasePrice.lastCreatedAt).replace(
                      / /g,
                      '\u00a0'
                    ),
                  })
                }}
              </p>
              <p class="text-gray-500 dark:text-zinc-400">
                {{ t('shopping.draft_warning_purchase_hint') }}
              </p>
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
