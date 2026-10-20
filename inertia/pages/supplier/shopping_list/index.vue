<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue'
import { Head, router, usePage } from '@inertiajs/vue3'
import type { SharedProps } from '~/types'
import AppLayout from '~/layouts/AppLayout.vue'
import Button from 'primevue/button'
import Card from 'primevue/card'
import Checkbox from 'primevue/checkbox'
import ConfirmDialog from 'primevue/confirmdialog'
import Dialog from 'primevue/dialog'
import InputNumber from '~/components/NumberInput.vue'
import InputText from 'primevue/inputtext'
import MultiSelect from 'primevue/multiselect'
import Select from 'primevue/select'
import SelectButton from 'primevue/selectbutton'
import Slider from 'primevue/slider'
import InfoHint from '~/components/InfoHint.vue'
import { useSelectEnterKey } from '~/composables/use_select_enter_key'
import { useI18n } from '~/composables/use_i18n'
import { useMoney } from '~/composables/use_pricing'
import { useAppConfirm } from '~/composables/use_app_confirm'
import { DELIVERY_MAX_PRICE } from '~/composables/use_delivery_correction_validation'
import {
  MAX_HORIZON_DAYS,
  MIN_HORIZON_DAYS,
  SHOPPING_LABEL_MAX,
  SHOPPING_MAX_QUANTITY,
  SHOPPING_NOTE_MAX,
  nameError,
} from '~/composables/use_shopping_validation'

interface Hint {
  productId: number
  name: string
  stock: number
  sold: number
  favorites: number
}

interface Line {
  key: string
  kind: 'group' | 'product' | 'custom'
  groupId: number | null
  productId: number | null
  name: string
  categoryName: string | null
  categoryColor: string | null
  note: string | null
  stock: number | null
  weeklyRate: number | null
  daysOfCover: number | null
  stockoutRisk: number | null
  suggestedQuantity: number
  quantity: number
  isOverridden: boolean
  packSize: number
  packSample: number[]
  unitCost: number | null
  costSource: 'purchase' | 'selling' | 'manual' | null
  goodPrice: number | null
  sellingPrice: number | null
  lineTotal: number | null
  isChecked: boolean
  isRemoved: boolean
  hints: Hint[]
  reasons: Array<'out_of_stock' | 'runs_out' | 'added'>
}

interface ShoppingListView {
  settings: {
    horizonDays: number
    autoHorizonDays: number
    horizonIsAuto: boolean
    scope: 'mine' | 'all'
    categoryIds: number[]
  }
  openDaysInHorizon: number
  lines: Line[]
  covered: Line[]
  removed: Line[]
  totals: { lines: number; pieces: number; cost: number; checked: number; linesWithoutCost: number }
  marginPercent: number
}

const props = defineProps<{
  list: ShoppingListView
  categories: Array<{ id: number; name: string; color: string }>
  products: Array<{ id: number; displayName: string }>
}>()

const { t, tp, locale } = useI18n()
const { money } = useMoney()
const decimal = (value: number) =>
  new Intl.NumberFormat(locale.value === 'cs' ? 'cs-CZ' : 'en-US', {
    maximumFractionDigits: 1,
  }).format(value)
const confirm = useAppConfirm()
const page = usePage<SharedProps>()

const visitOptions = {
  preserveScroll: true,
  preserveState: true,
  only: ['list'],
  // Edits are independent of each other — one must not cancel another one in flight.
  async: true,
}

// ─── Planning settings ─────────────────────────────────────────────────────────
const horizon = ref(props.list.settings.horizonDays)
const scope = ref(props.list.settings.scope)
const categoryIds = ref<number[]>([...props.list.settings.categoryIds])
const scopeOptions = computed(() => [
  { label: t('common.scope_all'), value: 'all' },
  { label: t('common.scope_mine'), value: 'mine' },
])

let horizonTimer: ReturnType<typeof setTimeout> | null = null

watch(
  () => props.list.settings,
  (settings) => {
    // Keep a value the supplier is still dragging; otherwise follow what the server planned.
    if (!horizonTimer) horizon.value = settings.horizonDays
    scope.value = settings.scope
    categoryIds.value = [...settings.categoryIds]
  }
)

function saveSettings(patch: {
  horizonDays?: number | null
  scope?: 'mine' | 'all'
  categoryIds?: number[]
}) {
  router.put('/supplier/shopping-list', patch, {
    preserveScroll: true,
    preserveState: true,
    only: ['list'],
  })
}

// Debounced: dragging the slider fires on every step, the list is recomputed once it rests.
watch(horizon, (value) => {
  if (horizonTimer) clearTimeout(horizonTimer)
  horizonTimer = setTimeout(() => {
    horizonTimer = null
    if (value !== props.list.settings.horizonDays) saveSettings({ horizonDays: value })
  }, 450)
})

function resetHorizon() {
  if (horizonTimer) clearTimeout(horizonTimer)
  horizonTimer = null
  horizon.value = props.list.settings.autoHorizonDays
  saveSettings({ horizonDays: null })
}

function onScopeChange() {
  saveSettings({ scope: scope.value })
}

function onCategoriesChange() {
  saveSettings({ categoryIds: categoryIds.value })
}

// ─── Lines ─────────────────────────────────────────────────────────────────────
// The last action on a line wins. Every edit of a line (quantity, back to the suggestion,
// tick, remove, restore) goes through one queue per line: a newer action drops a quantity
// still waiting for its debounce, and while a request of that line is under way the newest
// action waits for it and is sent next — anything older that was queued is dropped. Requests
// of one line never overlap, so the server applies them in the order they were made (merely
// cancelling the browser's request would not stop the server from applying it late). Until
// the line's last action is answered, the page shows that action's value, not what an
// earlier response said; once nothing is in flight after edits overlapped, the list is
// reloaded once, so no response that arrived out of order is left on screen.
type LineAction = {
  method: 'put' | 'delete'
  data: Record<string, number | boolean | null>
}
interface LineQueue {
  seq: number
  busy: boolean
  next: { action: LineAction; seq: number } | null
}

const pendingQuantity = reactive<Record<string, number>>({})
const pendingChecked = reactive<Record<string, boolean>>({})
const quantityTimers = new Map<string, ReturnType<typeof setTimeout>>()
const queues = new Map<string, LineQueue>()
let inFlight = 0
let overlapped = false

function lineUrl(key: string) {
  return `/supplier/shopping-list/lines/${key}`
}

function quantityOf(line: Line) {
  return pendingQuantity[line.key] ?? line.quantity
}

function checkedOf(line: Line) {
  return pendingChecked[line.key] ?? line.isChecked
}

function queueOf(key: string): LineQueue {
  let queue = queues.get(key)
  if (!queue) {
    queue = { seq: 0, busy: false, next: null }
    queues.set(key, queue)
  }
  return queue
}

/** A newer action supersedes a quantity still waiting to be sent. */
function dropScheduled(key: string) {
  const timer = quantityTimers.get(key)
  if (timer) clearTimeout(timer)
  quantityTimers.delete(key)
}

function lineAction(key: string, action: LineAction) {
  const queue = queueOf(key)
  queue.seq++
  if (queue.busy) {
    queue.next = { action, seq: queue.seq }
    return
  }
  send(key, action, queue.seq)
}

function send(key: string, action: LineAction, seq: number) {
  const queue = queueOf(key)
  queue.busy = true
  if (inFlight > 0) overlapped = true
  inFlight++
  router.visit(lineUrl(key), {
    method: action.method,
    data: action.data,
    ...visitOptions,
    onFinish: () => {
      inFlight--
      queue.busy = false
      const next = queue.next
      if (next) {
        queue.next = null
        send(key, next.action, next.seq)
        return
      }
      if (queue.seq === seq) settle(key)
      if (inFlight === 0 && overlapped) {
        overlapped = false
        router.reload({ only: ['list'] })
      }
    },
  })
}

/** The line's last action is answered: show what the server says again. */
function settle(key: string) {
  if (quantityTimers.has(key)) return
  delete pendingQuantity[key]
  delete pendingChecked[key]
}

function onQuantity(line: Line, value: number | null) {
  // The field has no max (CLAUDE.md › Number fields); the server bound is applied here.
  const quantity = Math.min(SHOPPING_MAX_QUANTITY, Math.max(0, Math.floor(value ?? 0)))
  pendingQuantity[line.key] = quantity
  dropScheduled(line.key)
  // Typing counts as the newest action right away — a request already queued is dropped.
  const queue = queueOf(line.key)
  queue.seq++
  queue.next = null
  quantityTimers.set(
    line.key,
    setTimeout(() => {
      quantityTimers.delete(line.key)
      lineAction(line.key, { method: 'put', data: { quantity } })
    }, 500)
  )
}

function onChecked(line: Line, value: boolean) {
  pendingChecked[line.key] = value
  lineAction(line.key, { method: 'put', data: { isChecked: value } })
}

function resetQuantity(line: Line) {
  dropScheduled(line.key)
  pendingQuantity[line.key] = line.suggestedQuantity
  lineAction(line.key, { method: 'put', data: { quantity: null } })
}

/** A suggestion is dismissed (can be restored); an own line is deleted outright. */
function removeLine(line: Line) {
  dropScheduled(line.key)
  if (line.kind === 'custom' || line.reasons.includes('added')) {
    lineAction(line.key, { method: 'delete', data: {} })
  } else {
    lineAction(line.key, { method: 'put', data: { isRemoved: true } })
  }
}

function restoreLine(line: Line) {
  lineAction(line.key, { method: 'put', data: { isRemoved: false } })
}

function addCovered(line: Line) {
  lineAction(line.key, { method: 'put', data: { quantity: Math.max(1, line.packSize) } })
}

const showCovered = ref(false)
const showRemoved = ref(false)

function reasonBadge(line: Line) {
  if (line.reasons.includes('out_of_stock')) {
    return { text: t('shopping.reason_out_of_stock'), class: BADGE.danger }
  }
  if (line.reasons.includes('runs_out') && line.daysOfCover !== null) {
    return {
      text: tp('shopping.reason_runs_out', Math.max(0, Math.round(line.daysOfCover))),
      class: BADGE.warning,
    }
  }
  return null
}

const BADGE = {
  info: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-200',
  warning: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200',
  danger: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  neutral: 'bg-gray-100 text-gray-800 dark:bg-zinc-700 dark:text-zinc-200',
  success: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-200',
}

function hintText(line: Line) {
  return line.hints
    .map((h) => (h.stock > 0 ? `${h.name} (${h.stock} ${t('common.pieces')})` : h.name))
    .join(' · ')
}

/** Stock, pace and cover — the cover only when no "runs out in N days" badge says it already. */
function statsText(line: Line) {
  const parts: string[] = []
  if (line.stock !== null) parts.push(t('shopping.stat_stock', { count: line.stock }))
  if (line.weeklyRate) parts.push(t('shopping.stat_weekly', { count: decimal(line.weeklyRate) }))
  if (line.daysOfCover !== null && line.stock && !reasonBadge(line)) {
    parts.push(tp('shopping.stat_cover', Math.round(line.daysOfCover)))
  }
  return parts.join(' · ')
}

const checkedTotal = computed(
  () => props.list.lines.filter((line) => checkedOf(line) && quantityOf(line) > 0).length
)

// ─── Add a line ────────────────────────────────────────────────────────────────
const addVisible = ref(false)
const addMode = ref<'catalog' | 'custom'>('catalog')
const addProductId = ref<number | null>(null)
const addLabel = ref('')
const addQuantity = ref<number | null>(1)
const addUnitCost = ref<number | null>(null)
const addNote = ref('')
const addSubmitting = ref(false)
const addModeOptions = computed(() => [
  { label: t('shopping.add_mode_catalog'), value: 'catalog' },
  { label: t('shopping.add_mode_custom'), value: 'custom' },
])
const productOptions = computed(() =>
  props.products.map((p) => ({ label: p.displayName, value: p.id }))
)
const addLabelError = computed(() =>
  addMode.value === 'custom' ? nameError(addLabel.value, SHOPPING_LABEL_MAX, t) : ''
)
const addQuantityError = computed(() =>
  !addQuantity.value || addQuantity.value < 1
    ? t('shopping.validation_quantity_min')
    : addQuantity.value > SHOPPING_MAX_QUANTITY
      ? t('shopping.validation_quantity_max', { max: SHOPPING_MAX_QUANTITY })
      : ''
)
// Mirrors shoppingLineCreateValidator.unitCost (0 … DELIVERY_MAX_PRICE, optional).
const addUnitCostError = computed(() =>
  addUnitCost.value !== null && (addUnitCost.value < 0 || addUnitCost.value > DELIVERY_MAX_PRICE)
    ? t('shopping.validation_unit_cost_max', { max: DELIVERY_MAX_PRICE })
    : ''
)
const addValid = computed(
  () =>
    !addQuantityError.value &&
    !addUnitCostError.value &&
    (addMode.value === 'catalog' ? !!addProductId.value : !addLabelError.value)
)

// Keyboard flow like the stocking draft: the product search opens with the dialog, the
// first match is highlighted (ArrowDown goes to the second), Enter picks it and moves on —
// product → quantity → note → Add.
const addProductSelect = ref()
const { onSelectShow: onAddProductShow, onSelectFilter: onAddProductFilter } = useSelectEnterKey([
  {
    selectRef: addProductSelect,
    getOptions: () => productOptions.value,
    getLabel: (option) => option.label,
    getValue: (option) => option.value,
    onSelect: (value) => {
      addProductId.value = Number(value)
      nextTick(() => focusInput('shopping-add-quantity'))
    },
  },
])

function focusInput(id: string) {
  const input = document.getElementById(id) as HTMLInputElement | null
  input?.focus()
  input?.select()
}

function openProductSearch() {
  const instance = addProductSelect.value
  const trigger = (instance?.$el as HTMLElement | undefined)?.querySelector<HTMLElement>(
    '[role="combobox"]'
  )
  trigger?.focus()
  if (typeof instance?.show === 'function') instance.show()
  else trigger?.click()
}

/** The dialog opens with the first field focused, so typing starts right away. */
function focusAddField() {
  if (addMode.value === 'catalog') openProductSearch()
  else focusInput('shopping-add-label')
}

/** A product picked with the mouse moves on to the quantity too. */
function onAddProductChange() {
  if (addProductId.value) nextTick(() => focusInput('shopping-add-quantity'))
}

watch(addMode, () => nextTick(focusAddField))

function openAdd() {
  addMode.value = 'catalog'
  addProductId.value = null
  addLabel.value = ''
  addQuantity.value = 1
  addUnitCost.value = null
  addNote.value = ''
  addVisible.value = true
}

function submitAdd() {
  if (!addValid.value || addSubmitting.value) return
  addSubmitting.value = true
  router.post(
    '/supplier/shopping-list/lines',
    {
      ...(addMode.value === 'catalog'
        ? { productId: addProductId.value }
        : { label: addLabel.value.trim() }),
      quantity: addQuantity.value,
      ...(addUnitCost.value !== null ? { unitCost: addUnitCost.value } : {}),
      ...(addNote.value.trim() ? { note: addNote.value.trim() } : {}),
    },
    {
      preserveScroll: true,
      preserveState: true,
      only: ['list'],
      onSuccess: () => {
        addVisible.value = false
      },
      onFinish: () => {
        addSubmitting.value = false
      },
    }
  )
}

// ─── Finish shopping ───────────────────────────────────────────────────────────
function completeList() {
  confirm.require({
    header: t('shopping.complete_title'),
    message:
      checkedTotal.value > 0
        ? t('shopping.complete_message_checked', { count: checkedTotal.value })
        : t('shopping.complete_message_all', { count: props.list.totals.lines }),
    acceptLabel: t('shopping.complete_confirm'),
    rejectLabel: t('common.cancel'),
    accept: () => router.post('/supplier/shopping-list/complete'),
  })
}
</script>

<template>
  <AppLayout>
    <Head :title="t('shopping.title')" />
    <ConfirmDialog />

    <div class="mb-6 flex flex-wrap items-center justify-between gap-2">
      <h1
        class="inline-flex items-center gap-1 text-2xl font-bold text-gray-900 dark:text-zinc-100"
      >
        {{ t('shopping.heading') }}
        <InfoHint
          mode="dialog"
          :title="t('shopping.heading')"
          :text="t('shopping.list_hint')"
          test-id="shopping-list-hint"
        />
      </h1>
      <div class="flex flex-wrap gap-2">
        <Button
          :label="t('shopping.add_line')"
          icon="pi pi-plus"
          severity="secondary"
          data-testid="shopping-add-line"
          @click="openAdd"
        />
        <Button
          :label="t('shopping.complete')"
          icon="pi pi-check"
          :disabled="list.totals.lines === 0"
          data-testid="shopping-complete"
          @click="completeList"
        />
      </div>
    </div>

    <Card class="mb-4">
      <template #content>
        <div class="grid gap-5 lg:grid-cols-3">
          <div class="lg:col-span-2">
            <div class="mb-2 flex flex-wrap items-baseline justify-between gap-2">
              <label
                for="shopping-horizon"
                class="mb-1 block text-sm text-gray-700 dark:text-zinc-300"
                data-testid="shopping-horizon-label"
                >{{ tp('shopping.horizon_label', horizon) }}</label
              >
              <span
                class="text-xs text-gray-500 dark:text-zinc-400"
                data-testid="shopping-horizon-usual"
              >
                {{ tp('shopping.horizon_usual', list.settings.autoHorizonDays) }}
                <Button
                  v-if="!list.settings.horizonIsAuto"
                  :label="t('shopping.horizon_reset')"
                  severity="secondary"
                  text
                  size="small"
                  data-testid="shopping-horizon-reset"
                  @click="resetHorizon"
                />
              </span>
            </div>
            <Slider
              id="shopping-horizon"
              v-model="horizon"
              :min="MIN_HORIZON_DAYS"
              :max="MAX_HORIZON_DAYS"
              :step="1"
              :aria-label="t('shopping.horizon_aria')"
              data-testid="shopping-horizon"
            />
            <div class="mt-2 flex justify-between text-xs text-gray-400 dark:text-zinc-500">
              <span>{{ tp('shopping.days', MIN_HORIZON_DAYS) }}</span>
              <span>{{ tp('shopping.days', MAX_HORIZON_DAYS) }}</span>
            </div>
          </div>
          <div class="grid gap-3">
            <div v-if="page.props.hasOtherSuppliers !== false">
              <label class="mb-1 block text-sm text-gray-700 dark:text-zinc-300">{{
                t('common.scope')
              }}</label>
              <Select
                v-model="scope"
                :options="scopeOptions"
                optionLabel="label"
                optionValue="value"
                class="w-full"
                data-testid="shopping-scope"
                @change="onScopeChange"
              />
            </div>
            <div>
              <label class="mb-1 block text-sm text-gray-700 dark:text-zinc-300">{{
                t('common.category')
              }}</label>
              <MultiSelect
                v-model="categoryIds"
                :options="categories"
                optionLabel="name"
                optionValue="id"
                :placeholder="t('shopping.categories_all')"
                class="w-full"
                data-testid="shopping-categories"
                @change="onCategoriesChange"
              />
            </div>
          </div>
        </div>
      </template>
    </Card>

    <div
      class="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-700 dark:text-zinc-300"
      data-testid="shopping-totals"
    >
      <span class="font-semibold">{{ tp('shopping.total_lines', list.totals.lines) }}</span>
      <span>{{ t('shopping.total_pieces', { count: list.totals.pieces }) }}</span>
      <span>{{ t('shopping.total_cost', { cost: money(list.totals.cost) }) }}</span>
      <span v-if="checkedTotal > 0" class="text-green-700 dark:text-green-300">{{
        t('shopping.total_checked', { count: checkedTotal, total: list.totals.lines })
      }}</span>
    </div>
    <p
      v-if="list.totals.linesWithoutCost > 0"
      class="mb-3 inline-flex items-center gap-1 text-xs text-gray-500 dark:text-zinc-400"
      data-testid="shopping-lines-without-cost"
    >
      {{ tp('shopping.lines_without_cost', list.totals.linesWithoutCost) }}
      <InfoHint :text="t('shopping.lines_without_cost_hint')" />
    </p>

    <div class="space-y-2" data-testid="shopping-lines">
      <div
        v-for="line in list.lines"
        :key="line.key"
        class="flex flex-col gap-3 rounded-lg border border-gray-200 bg-white p-3 sm:flex-row sm:items-center dark:border-zinc-700 dark:bg-zinc-900"
        :class="{ 'opacity-70': checkedOf(line) }"
        :data-testid="`shopping-line-${line.key}`"
      >
        <div class="flex min-w-0 flex-1 items-start gap-3">
          <Checkbox
            :modelValue="checkedOf(line)"
            binary
            :inputId="`shopping-check-${line.key}`"
            :aria-label="t('shopping.mark_bought', { name: line.name })"
            class="mt-1"
            @update:modelValue="(value: boolean) => onChecked(line, value)"
          />
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2">
              <label
                :for="`shopping-check-${line.key}`"
                class="inline-flex items-center gap-1.5 font-medium text-gray-900 dark:text-zinc-100"
                :class="{ 'line-through': checkedOf(line) }"
                ><span
                  v-if="line.categoryName"
                  class="inline-block h-2 w-2 shrink-0 rounded-full"
                  :style="{ backgroundColor: line.categoryColor || '#6b7280' }"
                  :title="line.categoryName"
                  aria-hidden="true"
                />{{ line.name }}</label
              >
              <span
                v-if="line.kind === 'group'"
                class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
                :class="BADGE.info"
                >{{ t('shopping.kind_group') }}</span
              >
              <span
                v-if="line.reasons.includes('added')"
                class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
                :class="BADGE.neutral"
                >{{ t('shopping.reason_added') }}</span
              >
              <span
                v-if="reasonBadge(line)"
                class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
                :class="reasonBadge(line)!.class"
                >{{ reasonBadge(line)!.text }}</span
              >
            </div>
            <p v-if="line.hints.length" class="mt-0.5 text-xs text-gray-500 dark:text-zinc-400">
              {{ t('shopping.hints', { products: hintText(line) }) }}
            </p>
            <p v-if="line.note" class="mt-0.5 text-xs text-gray-500 italic dark:text-zinc-400">
              {{ line.note }}
            </p>
            <!-- One line of metadata: price first, then stock and pace. -->
            <p
              v-if="line.unitCost !== null || statsText(line)"
              class="mt-0.5 text-xs text-gray-500 dark:text-zinc-400"
              :data-testid="`shopping-meta-${line.key}`"
            >
              <template v-if="line.unitCost !== null">
                <span class="text-gray-600 dark:text-zinc-300">{{
                  t('shopping.price_per_piece', { price: money(line.unitCost) })
                }}</span>
                <span v-if="line.costSource === 'selling'">
                  ({{ t('shopping.price_from_selling') }})</span
                >
                <span v-if="line.goodPrice !== null" class="text-green-700 dark:text-green-300">
                  · {{ t('shopping.good_price', { price: money(line.goodPrice) }) }}</span
                >
                <span v-if="line.sellingPrice !== null && line.costSource !== 'selling'">
                  · {{ t('shopping.selling_price', { price: money(line.sellingPrice) }) }}</span
                >
                <span v-if="statsText(line)"> · </span>
              </template>
              <span>{{ statsText(line) }}</span>
            </p>
          </div>
        </div>

        <div class="flex items-center justify-between gap-3 sm:justify-end">
          <div class="flex flex-col items-end">
            <InputNumber
              :modelValue="quantityOf(line)"
              :min="0"
              showButtons
              buttonLayout="horizontal"
              :step="1"
              :inputId="`shopping-qty-${line.key}`"
              :aria-label="t('shopping.quantity_for', { name: line.name })"
              inputClass="w-20 text-center"
              :suffix="` ${t('common.pieces')}`"
              :data-testid="`shopping-qty-${line.key}`"
              @update:modelValue="(value: number | null) => onQuantity(line, value)"
            />
            <div class="mt-1 flex items-center gap-1 text-xs text-gray-500 dark:text-zinc-400">
              <template
                v-if="
                  line.isOverridden && line.kind !== 'custom' && !line.reasons.includes('added')
                "
              >
                <span>{{ t('shopping.suggested', { count: line.suggestedQuantity }) }}</span>
                <Button
                  icon="pi pi-undo"
                  severity="secondary"
                  text
                  size="small"
                  :aria-label="t('shopping.reset_quantity')"
                  :data-testid="`shopping-reset-${line.key}`"
                  @click="resetQuantity(line)"
                />
              </template>
              <span v-else-if="line.packSize > 1" class="inline-flex items-center gap-1"
                >{{ t('shopping.pack', { count: line.packSize }) }}
                <InfoHint
                  :text="t('shopping.pack_hint', { amounts: line.packSample.join(', ') })"
                  :test-id="`shopping-pack-hint-${line.key}`"
              /></span>
            </div>
          </div>
          <div class="w-24 text-right text-sm font-semibold text-gray-900 dark:text-zinc-100">
            {{ line.lineTotal !== null ? money(line.lineTotal) : '—' }}
          </div>
          <Button
            icon="pi pi-times"
            severity="danger"
            text
            size="small"
            :aria-label="t('shopping.remove_line', { name: line.name })"
            :data-testid="`shopping-remove-${line.key}`"
            @click="removeLine(line)"
          />
        </div>
      </div>

      <div
        v-if="list.lines.length === 0"
        class="rounded-lg border border-dashed border-gray-300 py-8 text-center text-gray-500 dark:border-zinc-700 dark:text-zinc-400"
        data-testid="shopping-empty"
      >
        {{ t('shopping.empty') }}
      </div>
    </div>

    <div v-if="list.covered.length" class="mt-6">
      <Button
        :label="tp('shopping.covered_toggle', list.covered.length)"
        :icon="showCovered ? 'pi pi-chevron-up' : 'pi pi-chevron-down'"
        severity="secondary"
        text
        size="small"
        data-testid="shopping-covered-toggle"
        @click="showCovered = !showCovered"
      />
      <div v-if="showCovered" class="mt-2 space-y-1" data-testid="shopping-covered">
        <div
          v-for="line in list.covered"
          :key="line.key"
          class="flex items-center justify-between gap-3 rounded-md px-3 py-2 text-sm odd:bg-gray-50 dark:odd:bg-zinc-800/50"
        >
          <span class="min-w-0 truncate text-gray-800 dark:text-zinc-200">
            {{ line.name }}
            <span class="text-xs text-gray-500 dark:text-zinc-400">· {{ statsText(line) }}</span>
          </span>
          <Button
            icon="pi pi-plus"
            severity="secondary"
            text
            size="small"
            :aria-label="t('shopping.add_covered', { name: line.name })"
            :data-testid="`shopping-add-${line.key}`"
            @click="addCovered(line)"
          />
        </div>
      </div>
    </div>

    <div v-if="list.removed.length" class="mt-4">
      <Button
        :label="tp('shopping.removed_toggle', list.removed.length)"
        :icon="showRemoved ? 'pi pi-chevron-up' : 'pi pi-chevron-down'"
        severity="secondary"
        text
        size="small"
        data-testid="shopping-removed-toggle"
        @click="showRemoved = !showRemoved"
      />
      <div v-if="showRemoved" class="mt-2 space-y-1" data-testid="shopping-removed">
        <div
          v-for="line in list.removed"
          :key="line.key"
          class="flex items-center justify-between gap-3 rounded-md px-3 py-2 text-sm odd:bg-gray-50 dark:odd:bg-zinc-800/50"
        >
          <span class="text-gray-800 dark:text-zinc-200">{{ line.name }}</span>
          <Button
            :label="t('shopping.restore')"
            icon="pi pi-replay"
            severity="secondary"
            text
            size="small"
            :data-testid="`shopping-restore-${line.key}`"
            @click="restoreLine(line)"
          />
        </div>
      </div>
    </div>

    <Dialog
      v-model:visible="addVisible"
      :header="t('shopping.add_title')"
      style="width: 560px; max-width: calc(100vw - 2rem)"
      modal
      :draggable="false"
      data-testid="shopping-add-dialog"
      @show="focusAddField"
    >
      <form id="shopping-add-form" class="space-y-4" @submit.prevent="submitAdd">
        <SelectButton
          v-model="addMode"
          :options="addModeOptions"
          optionLabel="label"
          optionValue="value"
          :allowEmpty="false"
          :aria-label="t('shopping.add_mode')"
          data-testid="shopping-add-mode"
        />
        <div v-if="addMode === 'catalog'">
          <label class="mb-1 block text-sm text-gray-700 dark:text-zinc-300"
            >{{ t('common.product') }} *</label
          >
          <Select
            ref="addProductSelect"
            v-model="addProductId"
            :options="productOptions"
            optionLabel="label"
            optionValue="value"
            filter
            autoFilterFocus
            appendTo="self"
            :placeholder="t('shopping.add_product_placeholder')"
            class="w-full"
            data-testid="shopping-add-product"
            @show="onAddProductShow"
            @filter="onAddProductFilter"
            @change="onAddProductChange"
          />
        </div>
        <div v-else>
          <label
            for="shopping-add-label"
            class="mb-1 block text-sm text-gray-700 dark:text-zinc-300"
            >{{ t('shopping.add_label') }} *</label
          >
          <InputText
            id="shopping-add-label"
            v-model="addLabel"
            class="w-full"
            :maxlength="SHOPPING_LABEL_MAX"
            :invalid="!!addLabelError && addLabel.length > 0"
            :placeholder="t('shopping.add_label_placeholder')"
            @keydown.enter.prevent="focusInput('shopping-add-quantity')"
          />
          <small
            v-if="addLabelError && addLabel.length > 0"
            class="text-red-500 dark:text-red-400"
            >{{ addLabelError }}</small
          >
        </div>
        <div class="grid gap-4 sm:grid-cols-2">
          <div>
            <label class="mb-1 block text-sm text-gray-700 dark:text-zinc-300"
              >{{ t('shopping.add_quantity') }} *</label
            >
            <InputNumber
              v-model="addQuantity"
              inputId="shopping-add-quantity"
              :min="1"
              fluid
              :invalid="!!addQuantityError"
              @keydown.enter.prevent="focusInput('shopping-add-note')"
            />
            <small v-if="addQuantityError" class="text-red-500 dark:text-red-400">{{
              addQuantityError
            }}</small>
          </div>
          <div>
            <label class="mb-1 block text-sm text-gray-700 dark:text-zinc-300">{{
              t('shopping.add_unit_cost')
            }}</label>
            <InputNumber
              v-model="addUnitCost"
              inputId="shopping-add-cost"
              :min="0"
              :minFractionDigits="2"
              :maxFractionDigits="2"
              :suffix="' ' + t('common.currency')"
              fluid
              :invalid="!!addUnitCostError"
            />
            <small v-if="addUnitCostError" class="text-red-500 dark:text-red-400">{{
              addUnitCostError
            }}</small>
          </div>
        </div>
        <div>
          <label
            for="shopping-add-note"
            class="mb-1 block text-sm text-gray-700 dark:text-zinc-300"
            >{{ t('shopping.add_note') }}</label
          >
          <InputText
            id="shopping-add-note"
            v-model="addNote"
            class="w-full"
            :maxlength="SHOPPING_NOTE_MAX"
            :placeholder="t('shopping.add_note_placeholder')"
          />
        </div>
      </form>
      <template #footer>
        <Button :label="t('common.cancel')" severity="secondary" text @click="addVisible = false" />
        <Button
          type="submit"
          form="shopping-add-form"
          :label="t('shopping.add_submit')"
          :disabled="!addValid || addSubmitting"
          :loading="addSubmitting"
          data-testid="shopping-add-submit"
        />
      </template>
    </Dialog>
  </AppLayout>
</template>
