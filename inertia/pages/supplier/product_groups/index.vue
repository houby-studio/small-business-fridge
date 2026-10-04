<script setup lang="ts">
import { computed, ref } from 'vue'
import { Head, router } from '@inertiajs/vue3'
import AppLayout from '~/layouts/AppLayout.vue'
import Button from 'primevue/button'
import Column from 'primevue/column'
import ConfirmDialog from 'primevue/confirmdialog'
import DataTable from 'primevue/datatable'
import Dialog from 'primevue/dialog'
import InputText from 'primevue/inputtext'
import MultiSelect from 'primevue/multiselect'
import Select from 'primevue/select'
import Tag from 'primevue/tag'
import Textarea from 'primevue/textarea'
import InfoHint from '~/components/InfoHint.vue'
import PageTabs from '~/components/PageTabs.vue'
import { useI18n } from '~/composables/use_i18n'
import { useAppConfirm } from '~/composables/use_app_confirm'
import {
  PRODUCT_GROUP_NAME_MAX,
  PRODUCT_GROUP_NOTE_MAX,
  nameError,
} from '~/composables/use_shopping_validation'

interface Group {
  id: number
  name: string
  note: string | null
  categoryId: number
  categoryName: string | null
  categoryColor: string | null
  productIds: number[]
  productNames: string[]
}

const props = defineProps<{
  groups: Group[]
  categories: Array<{ id: number; name: string; color: string }>
  products: Array<{
    id: number
    displayName: string
    categoryId: number
    productGroupId: number | null
  }>
}>()

const { t } = useI18n()
const confirm = useAppConfirm()

const tabs = computed(() => [
  { label: t('common.tab_products'), url: '/supplier/products', testId: 'tab-products' },
  {
    label: t('common.tab_product_groups'),
    url: '/supplier/product-groups',
    testId: 'tab-product-groups',
  },
])

const dialogVisible = ref(false)
const editing = ref<Group | null>(null)
const name = ref('')
const categoryId = ref<number | null>(null)
const note = ref('')
const productIds = ref<number[]>([])
const nameTouched = ref(false)
const submitting = ref(false)
const showAllProducts = ref(false)

const nameErrorText = computed(() => nameError(name.value, PRODUCT_GROUP_NAME_MAX, t))
const valid = computed(() => !nameErrorText.value && !!categoryId.value)

const groupNameById = computed(() => new Map(props.groups.map((g) => [g.id, g.name])))

/** Products of the chosen category first; members of another group say which one. */
const productOptions = computed(() =>
  props.products
    .filter(
      (p) =>
        showAllProducts.value ||
        p.categoryId === categoryId.value ||
        productIds.value.includes(p.id)
    )
    .map((p) => {
      const other =
        p.productGroupId && p.productGroupId !== editing.value?.id
          ? groupNameById.value.get(p.productGroupId)
          : null
      return {
        label: other
          ? `${p.displayName} (${t('shopping.groups_in_other', { name: other })})`
          : p.displayName,
        value: p.id,
      }
    })
)

function openCreate() {
  editing.value = null
  name.value = ''
  categoryId.value = props.categories[0]?.id ?? null
  note.value = ''
  productIds.value = []
  nameTouched.value = false
  showAllProducts.value = false
  dialogVisible.value = true
}

function openEdit(group: Group) {
  editing.value = group
  name.value = group.name
  categoryId.value = group.categoryId
  note.value = group.note ?? ''
  productIds.value = [...group.productIds]
  nameTouched.value = false
  showAllProducts.value = false
  dialogVisible.value = true
}

function submit() {
  nameTouched.value = true
  if (!valid.value || submitting.value) return
  submitting.value = true
  const payload = {
    name: name.value.trim(),
    categoryId: categoryId.value,
    note: note.value.trim() || null,
    productIds: productIds.value,
  }
  const options = {
    preserveScroll: true,
    onSuccess: () => {
      dialogVisible.value = false
    },
    onFinish: () => {
      submitting.value = false
    },
  }
  if (editing.value) {
    router.put(`/supplier/product-groups/${editing.value.id}`, payload, options)
  } else {
    router.post('/supplier/product-groups', payload, options)
  }
}

function remove(group: Group) {
  confirm.require({
    header: t('shopping.groups_delete_title'),
    message: t('shopping.groups_delete_message', { name: group.name }),
    acceptLabel: t('common.delete'),
    rejectLabel: t('common.cancel'),
    destructive: true,
    accept: () => router.delete(`/supplier/product-groups/${group.id}`, { preserveScroll: true }),
  })
}

function membersText(group: Group) {
  if (group.productNames.length === 0) return t('shopping.groups_no_products')
  const shown = group.productNames.slice(0, 4).join(', ')
  return group.productNames.length > 4
    ? t('shopping.groups_more', { products: shown, count: group.productNames.length - 4 })
    : shown
}
</script>

<template>
  <AppLayout>
    <Head :title="t('shopping.groups_title')" />
    <ConfirmDialog />

    <div class="mb-3 flex items-center justify-between gap-3">
      <h1 class="text-2xl font-bold text-gray-900 dark:text-zinc-100">
        {{ t('supplier.products_list_title') }}
      </h1>
      <span class="inline-flex items-center gap-1">
        <Button
          :label="t('shopping.groups_create')"
          icon="pi pi-plus"
          data-testid="group-create"
          @click="openCreate"
        />
        <InfoHint
          mode="dialog"
          :title="t('shopping.groups_title')"
          :text="t('shopping.groups_hint')"
          test-id="groups-hint"
        />
      </span>
    </div>
    <PageTabs :tabs="tabs" />

    <DataTable :value="groups" stripedRows class="rounded-lg border" dataKey="id">
      <Column :header="t('common.name')">
        <template #body="{ data }">
          <div class="font-medium">{{ data.name }}</div>
          <div v-if="data.note" class="text-xs text-gray-500 dark:text-zinc-400">
            {{ data.note }}
          </div>
        </template>
      </Column>
      <Column :header="t('common.category')" style="width: 180px">
        <template #body="{ data }">
          <Tag
            v-if="data.categoryName"
            :value="data.categoryName"
            class="text-xs"
            :style="{ backgroundColor: data.categoryColor || '#6b7280', color: '#fff' }"
          />
        </template>
      </Column>
      <Column :header="t('shopping.groups_products')">
        <template #body="{ data }">
          <span class="text-sm text-gray-700 dark:text-zinc-300">{{ membersText(data) }}</span>
        </template>
      </Column>
      <Column :header="t('common.actions')" style="width: 110px">
        <template #body="{ data }">
          <div class="flex gap-1">
            <Button
              icon="pi pi-pencil"
              severity="info"
              text
              size="small"
              :aria-label="t('common.edit')"
              :data-testid="`group-edit-${data.id}`"
              @click="openEdit(data)"
            />
            <Button
              icon="pi pi-trash"
              severity="danger"
              text
              size="small"
              :aria-label="t('common.delete')"
              :data-testid="`group-delete-${data.id}`"
              @click="remove(data)"
            />
          </div>
        </template>
      </Column>
      <template #empty>
        <div class="py-8 text-center text-gray-500 dark:text-zinc-400">
          {{ t('shopping.groups_empty') }}
        </div>
      </template>
    </DataTable>

    <Dialog
      v-model:visible="dialogVisible"
      :header="editing ? t('shopping.groups_edit_title') : t('shopping.groups_create_title')"
      style="width: 560px; max-width: calc(100vw - 2rem)"
      modal
      :draggable="false"
      data-testid="group-dialog"
    >
      <div class="space-y-4">
        <div>
          <label for="group-name" class="mb-1 block text-sm text-gray-700 dark:text-zinc-300"
            >{{ t('common.name') }} *</label
          >
          <InputText
            id="group-name"
            v-model="name"
            class="w-full"
            :maxlength="PRODUCT_GROUP_NAME_MAX"
            :placeholder="t('shopping.groups_name_placeholder')"
            :invalid="nameTouched && !!nameErrorText"
            @blur="nameTouched = true"
          />
          <small v-if="nameTouched && nameErrorText" class="text-red-500 dark:text-red-400">{{
            nameErrorText
          }}</small>
        </div>
        <div>
          <label class="mb-1 block text-sm text-gray-700 dark:text-zinc-300"
            >{{ t('common.category') }} *</label
          >
          <Select
            v-model="categoryId"
            :options="categories"
            optionLabel="name"
            optionValue="id"
            class="w-full"
            data-testid="group-category"
          />
        </div>
        <div>
          <label for="group-note" class="mb-1 block text-sm text-gray-700 dark:text-zinc-300">{{
            t('shopping.groups_note')
          }}</label>
          <Textarea
            id="group-note"
            v-model="note"
            rows="2"
            autoResize
            class="w-full"
            :maxlength="PRODUCT_GROUP_NOTE_MAX"
            :placeholder="t('shopping.groups_note_placeholder')"
          />
        </div>
        <div>
          <label class="mb-1 block text-sm text-gray-700 dark:text-zinc-300">{{
            t('shopping.groups_products')
          }}</label>
          <MultiSelect
            v-model="productIds"
            :options="productOptions"
            optionLabel="label"
            optionValue="value"
            filter
            display="chip"
            :placeholder="t('shopping.groups_products_placeholder')"
            class="w-full"
            data-testid="group-products"
          />
          <div class="mt-1 flex items-center justify-between gap-2">
            <small class="text-gray-500 dark:text-zinc-400">{{
              t('shopping.groups_products_hint')
            }}</small>
            <Button
              :label="
                showAllProducts
                  ? t('shopping.groups_products_category_only')
                  : t('shopping.groups_products_all')
              "
              severity="secondary"
              text
              size="small"
              @click="showAllProducts = !showAllProducts"
            />
          </div>
        </div>
      </div>
      <template #footer>
        <Button
          :label="t('common.cancel')"
          severity="secondary"
          text
          @click="dialogVisible = false"
        />
        <Button
          :label="t('common.save')"
          :disabled="!valid || submitting"
          :loading="submitting"
          data-testid="group-save"
          @click="submit"
        />
      </template>
    </Dialog>
  </AppLayout>
</template>
