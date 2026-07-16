<script setup lang="ts">
import { computed, ref } from 'vue'
import { Head, router } from '@inertiajs/vue3'
import AppLayout from '~/layouts/AppLayout.vue'
import Column from 'primevue/column'
import Select from 'primevue/select'
import Button from 'primevue/button'
import Dialog from 'primevue/dialog'
import Rating from 'primevue/rating'
import Textarea from 'primevue/textarea'
import Message from 'primevue/message'
import { useI18n } from '~/composables/use_i18n'
import { formatDateTime } from '~/composables/use_format_date'
import { useListFilters } from '~/composables/use_list_filters'
import {
  useRatingFormValidation,
  type RatingFormState,
  type RatingVisibility,
} from '~/composables/use_rating_form_validation'
import FilterBar from '~/components/FilterBar.vue'
import PaginatedDataTable from '~/components/PaginatedDataTable.vue'

type RatingRow = {
  id: number
  stars: number
  comment: string | null
  visibility: 'public' | 'private'
  createdAt: string | null
  updatedAt: string | null
  isEdited: boolean
  user: { id: number; displayName: string } | null
  product: { id: number; displayName: string } | null
  upvoteCount: number
  hasUpvoted: boolean
  canEdit: boolean
  canDelete: boolean
  canUpvote: boolean
}

type PaginatedRatings = {
  data: RatingRow[]
  meta: { total: number; perPage: number; currentPage: number; lastPage: number }
}

type UnratedEntry = {
  productId: number
  productName: string
  purchasedAt: string
}

const props = defineProps<{
  ratings: PaginatedRatings
  filters: {
    productId: string | number
    visibility: string
    onlyMine: boolean
    sortBy: string
    sortOrder: string
  }
  products: { id: number; displayName: string }[]
  unrated: UnratedEntry[]
  canSeePrivate: boolean
  publicFeedEnabled: boolean
}>()

const { t, tp } = useI18n()
const ALL = '__all__'
const SCOPE_MINE = 'mine'

// The "mine / all" scope filter only makes sense while the public feed is on —
// then there are other people's public ratings to scope against. With the feed
// off it adds nothing for anyone, so it's hidden for all roles.
const showScopeFilter = computed(() => props.publicFeedEnabled)

// The public/private split only carries meaning while the public feed is on.
const showVisibilityFilter = computed(() => props.canSeePrivate && props.publicFeedEnabled)
const showVisibilityColumn = computed(() => props.publicFeedEnabled)

// Upvotes are a public-feed engagement signal. With the feed off nobody can
// upvote (canUpvote is false server-side), so the whole column is hidden.
const showUpvoteColumn = computed(() => props.publicFeedEnabled)

const filterProduct = ref<number | string>(
  props.filters.productId ? Number(props.filters.productId) : ALL
)
const filterVisibility = ref<string>(props.filters.visibility || ALL)
const filterScope = ref<string>(props.filters.onlyMine ? SCOPE_MINE : ALL)
const filterSortBy = ref(props.filters.sortBy || 'createdAt')
const filterSortOrder = ref(props.filters.sortOrder || 'desc')
const sortOrderNum = computed(() => (filterSortOrder.value === 'asc' ? 1 : -1))

const productOptions = computed(() => [
  { id: ALL as string | number, displayName: t('common.all') },
  ...props.products,
])

const visibilityOptions = computed(() => [
  { label: t('common.all'), value: ALL },
  { label: t('rating.visibility_public'), value: 'public' },
  { label: t('rating.visibility_private'), value: 'private' },
])

const scopeOptions = computed(() => [
  { label: t('rating.scope_all'), value: ALL },
  { label: t('rating.scope_mine'), value: SCOPE_MINE },
])

function buildParams() {
  return {
    productId: filterProduct.value === ALL ? undefined : Number(filterProduct.value),
    visibility: filterVisibility.value === ALL ? undefined : filterVisibility.value,
    onlyMine: filterScope.value === SCOPE_MINE ? 'true' : undefined,
    sortBy: filterSortBy.value || undefined,
    sortOrder: filterSortOrder.value || undefined,
  }
}

const { applyFilters, navigateClear, onPageChange } = useListFilters({
  route: '/ratings',
  onlyProps: ['ratings', 'unrated', 'filters'],
  buildParams,
  getCurrentPage: () => props.ratings.meta.currentPage,
})

function clearFilters() {
  filterProduct.value = ALL
  filterVisibility.value = ALL
  filterScope.value = ALL
  filterSortBy.value = 'createdAt'
  filterSortOrder.value = 'desc'
  navigateClear()
}

function onSort(event: any) {
  filterSortBy.value = event.sortField
  filterSortOrder.value = event.sortOrder === 1 ? 'asc' : 'desc'
  applyFilters()
}

function toggleUpvote(row: RatingRow) {
  router.post(`/ratings/${row.id}/upvote`, {}, { preserveScroll: true, only: ['ratings', 'flash'] })
}

// ── Rate dialog (create / edit) ────────────────────────────────────────────────
const rateDialogVisible = ref(false)
const rateSubmitting = ref(false)
const rateTargetProduct = ref<{ id: number; name: string } | null>(null)
const rateEditingId = ref<number | null>(null)
const rateForm = ref<RatingFormState>({ stars: 5, comment: '', visibility: 'private' })
const { starsError, commentError, isValid } = useRatingFormValidation(rateForm)

function openRateDialog(productId: number, productName: string) {
  rateTargetProduct.value = { id: productId, name: productName }
  rateEditingId.value = null
  rateForm.value = {
    stars: 5,
    comment: '',
    visibility: props.publicFeedEnabled ? 'public' : 'private',
  }
  rateDialogVisible.value = true
}

function openEditDialog(row: RatingRow) {
  if (!row.product) return
  rateTargetProduct.value = { id: row.product.id, name: row.product.displayName }
  rateEditingId.value = row.id
  rateForm.value = {
    stars: row.stars,
    comment: row.comment ?? '',
    visibility: row.visibility as RatingVisibility,
  }
  rateDialogVisible.value = true
}

function submitRating() {
  if (!rateTargetProduct.value || !isValid.value) return
  rateSubmitting.value = true
  const payload = {
    productId: rateTargetProduct.value.id,
    stars: rateForm.value.stars,
    comment: rateForm.value.comment.trim() || null,
    visibility: rateForm.value.visibility,
  }
  const options = {
    preserveScroll: true,
    only: ['ratings', 'unrated', 'flash'],
    onFinish: () => {
      rateSubmitting.value = false
      rateDialogVisible.value = false
      rateTargetProduct.value = null
    },
  }
  if (rateEditingId.value) {
    router.put(`/ratings/${rateEditingId.value}`, payload, options)
  } else {
    router.post('/ratings', payload, options)
  }
}

// ── Delete dialog ──────────────────────────────────────────────────────────────
const deleteDialogVisible = ref(false)
const deleteTargetRating = ref<RatingRow | null>(null)
const deleteSubmitting = ref(false)

function openDeleteDialog(row: RatingRow) {
  deleteTargetRating.value = row
  deleteDialogVisible.value = true
}

function confirmDeleteRating() {
  if (!deleteTargetRating.value) return
  deleteSubmitting.value = true
  router.delete(`/ratings/${deleteTargetRating.value.id}`, {
    preserveScroll: true,
    only: ['ratings', 'unrated', 'flash'],
    onFinish: () => {
      deleteSubmitting.value = false
      deleteDialogVisible.value = false
      deleteTargetRating.value = null
    },
  })
}
</script>

<template>
  <AppLayout>
    <Head :title="t('rating.feed_title')" />

    <h1 class="mb-6 text-2xl font-bold text-gray-900 dark:text-zinc-100">
      {{ t('rating.feed_heading') }}
    </h1>

    <div
      v-if="unrated.length > 0"
      class="mb-6 rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-500/30 dark:bg-amber-900/15"
      data-testid="unrated-banner"
    >
      <p class="mb-3 text-sm font-medium text-amber-800 dark:text-amber-200">
        {{ tp('rating.banner_unrated_count', unrated.length) }}
      </p>
      <div class="flex flex-wrap gap-2">
        <Button
          v-for="entry in unrated"
          :key="entry.productId"
          :label="entry.productName"
          icon="pi pi-star"
          severity="warn"
          outlined
          size="small"
          :data-testid="`rate-product-${entry.productId}`"
          @click="openRateDialog(entry.productId, entry.productName)"
        />
      </div>
    </div>

    <FilterBar @apply="applyFilters" @clear="clearFilters">
      <div>
        <label class="mb-1 block text-sm text-gray-700 dark:text-zinc-300">{{
          t('rating.filter_product')
        }}</label>
        <Select
          v-model="filterProduct"
          :options="productOptions"
          optionLabel="displayName"
          optionValue="id"
          filter
          class="w-64"
        />
      </div>
      <div v-if="showVisibilityFilter">
        <label class="mb-1 block text-sm text-gray-700 dark:text-zinc-300">{{
          t('rating.filter_visibility')
        }}</label>
        <Select
          v-model="filterVisibility"
          :options="visibilityOptions"
          optionLabel="label"
          optionValue="value"
          class="w-48"
        />
      </div>
      <div v-if="showScopeFilter">
        <label class="mb-1 block text-sm text-gray-700 dark:text-zinc-300">{{
          t('rating.filter_scope')
        }}</label>
        <Select
          v-model="filterScope"
          :options="scopeOptions"
          optionLabel="label"
          optionValue="value"
          class="w-56"
        />
      </div>
    </FilterBar>

    <PaginatedDataTable
      :value="ratings.data"
      :meta="ratings.meta"
      :sortField="filterSortBy"
      :sortOrder="sortOrderNum"
      @page="onPageChange"
      @sort="onSort"
    >
      <Column :header="t('rating.col_date')" field="createdAt" sortable>
        <template #body="{ data }">
          <span>{{ formatDateTime(data.createdAt) }}</span>
          <span
            v-if="data.isEdited"
            class="ml-1 inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800 dark:bg-blue-900/30 dark:text-blue-200"
          >
            {{ t('rating.edited') }}
          </span>
        </template>
      </Column>

      <Column :header="t('rating.col_user')">
        <template #body="{ data }">{{ data.user?.displayName ?? '—' }}</template>
      </Column>

      <Column :header="t('rating.col_product')">
        <template #body="{ data }">{{ data.product?.displayName ?? '—' }}</template>
      </Column>

      <Column :header="t('rating.col_stars')" field="stars" sortable>
        <template #body="{ data }">
          <span class="text-amber-500">★</span> {{ data.stars }}/5
        </template>
      </Column>

      <Column :header="t('rating.col_comment')">
        <template #body="{ data }">
          <span class="text-sm">{{ data.comment ?? '—' }}</span>
        </template>
      </Column>

      <Column v-if="showVisibilityColumn" :header="t('rating.col_visibility')">
        <template #body="{ data }">
          <span
            class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
            :class="
              data.visibility === 'private'
                ? 'bg-gray-100 text-gray-800 dark:bg-zinc-700 dark:text-zinc-200'
                : 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-200'
            "
          >
            <span v-if="data.visibility === 'private'" class="pi pi-lock mr-1" aria-hidden="true" />
            {{
              data.visibility === 'private' ? t('rating.private_badge') : t('rating.public_badge')
            }}
          </span>
        </template>
      </Column>

      <Column v-if="showUpvoteColumn" :header="t('rating.col_upvotes')">
        <template #body="{ data }">
          <div class="flex items-center gap-2">
            <Button
              v-if="data.canUpvote"
              :icon="data.hasUpvoted ? 'pi pi-thumbs-up-fill' : 'pi pi-thumbs-up'"
              :severity="data.hasUpvoted ? 'success' : 'secondary'"
              text
              size="small"
              :aria-label="t('rating.upvote')"
              :data-testid="`upvote-${data.id}`"
              @click="toggleUpvote(data)"
            />
            <span class="text-sm" :data-testid="`upvote-count-${data.id}`">{{
              data.upvoteCount
            }}</span>
          </div>
        </template>
      </Column>

      <Column :header="t('rating.col_actions')">
        <template #body="{ data }">
          <div class="flex items-center gap-1">
            <Button
              v-if="data.canEdit"
              icon="pi pi-pencil"
              severity="info"
              text
              size="small"
              :aria-label="t('rating.edit')"
              :data-testid="`edit-rating-${data.id}`"
              @click="openEditDialog(data)"
            />
            <Button
              v-if="data.canDelete"
              icon="pi pi-trash"
              severity="danger"
              text
              size="small"
              :aria-label="t('rating.delete')"
              :data-testid="`delete-rating-${data.id}`"
              @click="openDeleteDialog(data)"
            />
          </div>
        </template>
      </Column>

      <template #empty>
        <div class="py-8 text-center text-gray-500 dark:text-zinc-400">
          {{ t('common.no_data') }}
        </div>
      </template>
    </PaginatedDataTable>

    <Dialog
      v-model:visible="rateDialogVisible"
      :header="
        rateTargetProduct
          ? `${t('rating.rate_dialog_title')}: ${rateTargetProduct.name}`
          : t('rating.rate_dialog_title')
      "
      :style="{ width: '28rem' }"
      modal
      :draggable="false"
    >
      <div class="space-y-4">
        <div>
          <label class="mb-1 block text-sm text-gray-700 dark:text-zinc-300">{{
            t('rating.stars')
          }}</label>
          <Rating v-model="rateForm.stars" :cancel="false" data-testid="rating-stars" />
          <small v-if="starsError" class="text-red-500 dark:text-red-400">{{ starsError }}</small>
        </div>
        <div>
          <label class="mb-1 block text-sm text-gray-700 dark:text-zinc-300">{{
            t('rating.comment_label')
          }}</label>
          <Textarea
            v-model="rateForm.comment"
            :placeholder="t('rating.comment_placeholder')"
            rows="3"
            class="w-full"
            data-testid="rating-comment"
          />
          <small v-if="commentError" class="text-red-500 dark:text-red-400">{{
            commentError
          }}</small>
        </div>
        <div v-if="publicFeedEnabled || canSeePrivate">
          <label class="mb-1 block text-sm text-gray-700 dark:text-zinc-300">{{
            t('rating.visibility')
          }}</label>
          <Select
            v-model="rateForm.visibility"
            :options="[
              { label: t('rating.visibility_public'), value: 'public' },
              { label: t('rating.visibility_private'), value: 'private' },
            ]"
            optionLabel="label"
            optionValue="value"
            class="w-full"
          />
        </div>
        <Message v-else severity="secondary" :closable="false">
          {{ t('rating.visibility_private_note') }}
        </Message>
      </div>
      <template #footer>
        <Button
          :label="t('common.cancel')"
          severity="secondary"
          text
          :disabled="rateSubmitting"
          @click="rateDialogVisible = false"
        />
        <Button
          :label="t('rating.submit')"
          :disabled="!isValid || rateSubmitting"
          :loading="rateSubmitting"
          data-testid="rating-submit"
          @click="submitRating"
        />
      </template>
    </Dialog>

    <Dialog
      v-model:visible="deleteDialogVisible"
      :header="t('rating.delete')"
      :style="{ width: '28rem' }"
      modal
      :draggable="false"
    >
      <p class="text-sm text-gray-700 dark:text-zinc-300">
        {{ t('rating.delete_confirm') }}
      </p>
      <template #footer>
        <Button
          :label="t('common.cancel')"
          severity="secondary"
          text
          :disabled="deleteSubmitting"
          @click="deleteDialogVisible = false"
        />
        <Button
          :label="t('common.confirm')"
          severity="danger"
          :loading="deleteSubmitting"
          :disabled="deleteSubmitting"
          data-testid="delete-rating-confirm"
          @click="confirmDeleteRating"
        />
      </template>
    </Dialog>
  </AppLayout>
</template>
