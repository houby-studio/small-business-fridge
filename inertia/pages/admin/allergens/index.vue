<script setup lang="ts">
import { nextTick, ref } from 'vue'
import { Head, router } from '@inertiajs/vue3'
import AppLayout from '~/layouts/AppLayout.vue'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import ToggleSwitch from 'primevue/toggleswitch'
import Tag from 'primevue/tag'
import Dialog from 'primevue/dialog'
import { useI18n } from '~/composables/use_i18n'

interface AllergenRow {
  id: number
  name: string
  isDisabled: boolean
  hasProducts: boolean
}

const props = defineProps<{ allergens: AllergenRow[] }>()
const { t } = useI18n()

const showCreateDialog = ref(false)
const newName = ref('')
const submitting = ref(false)
const createNameInputId = 'admin-allergen-create-name'

function createAllergen() {
  if (submitting.value || !newName.value.trim()) return
  submitting.value = true
  router.post(
    '/admin/allergens',
    { name: newName.value.trim() },
    {
      onFinish: () => {
        submitting.value = false
        showCreateDialog.value = false
        newName.value = ''
      },
    }
  )
}

function toggleDisabled(allergenId: number, isDisabled: boolean) {
  router.put(`/admin/allergens/${allergenId}`, { isDisabled }, { preserveState: true })
}

const editingId = ref<number | null>(null)
const editName = ref('')

function startEdit(row: AllergenRow) {
  editingId.value = row.id
  editName.value = row.name
  nextTick(() => {
    document.getElementById(getEditNameInputId(row.id))?.focus()
  })
}

function saveEdit() {
  if (!editingId.value) return
  router.put(
    `/admin/allergens/${editingId.value}`,
    { name: editName.value },
    {
      preserveState: true,
      onFinish: () => (editingId.value = null),
    }
  )
}

function cancelEdit() {
  editingId.value = null
}

function focusCreateNameInput() {
  nextTick(() => {
    document.getElementById(createNameInputId)?.focus()
  })
}

function getEditNameInputId(allergenId: number) {
  return `admin-allergen-edit-name-${allergenId}`
}
</script>

<template>
  <AppLayout>
    <Head :title="t('admin.allergens_title')" />

    <div class="mb-6 flex items-center justify-between">
      <h1 class="text-2xl font-bold text-gray-900 dark:text-zinc-100">
        {{ t('admin.allergens_heading') }}
      </h1>
      <Button
        :label="t('admin.allergens_new')"
        icon="pi pi-plus"
        @click="showCreateDialog = true"
      />
    </div>

    <DataTable :value="allergens" stripedRows class="rounded-lg border">
      <Column header="#" headerClass="sbf-col-id" bodyClass="sbf-col-id">
        <template #body="{ data }">{{ data.id }}</template>
      </Column>
      <Column :header="t('common.name')">
        <template #body="{ data }">
          <template v-if="editingId === data.id">
            <InputText
              :id="getEditNameInputId(data.id)"
              v-model="editName"
              class="w-full"
              @keyup.enter="saveEdit"
            />
          </template>
          <template v-else>
            {{ data.name }}
          </template>
        </template>
      </Column>
      <Column :header="t('common.active')" style="width: 100px">
        <template #body="{ data }">
          <span
            v-if="!data.isDisabled && data.hasProducts"
            :title="t('messages.allergen_has_products')"
            :aria-label="t('messages.allergen_has_products')"
          >
            <Tag severity="warn" icon="pi pi-exclamation-circle" />
          </span>
          <ToggleSwitch
            v-else
            :modelValue="!data.isDisabled"
            @update:modelValue="(val: boolean) => toggleDisabled(data.id, !val)"
          />
        </template>
      </Column>
      <Column :header="t('common.actions')" style="width: 180px">
        <template #body="{ data }">
          <div class="flex gap-1">
            <template v-if="editingId === data.id">
              <Button icon="pi pi-check" size="small" severity="success" @click="saveEdit" />
              <Button
                icon="pi pi-times"
                size="small"
                severity="secondary"
                outlined
                @click="cancelEdit"
              />
            </template>
            <template v-else>
              <Button
                icon="pi pi-pencil"
                size="small"
                severity="secondary"
                text
                @click="startEdit(data)"
              />
            </template>
          </div>
        </template>
      </Column>
    </DataTable>

    <Dialog
      v-model:visible="showCreateDialog"
      :header="t('admin.allergens_new_heading')"
      :modal="true"
      :closeButtonProps="{ severity: 'secondary', text: true, rounded: true, autofocus: false }"
      style="width: 400px"
      @show="focusCreateNameInput"
    >
      <div class="flex flex-col gap-4">
        <div>
          <label class="mb-1 block text-sm font-medium text-gray-700 dark:text-zinc-300">{{
            t('common.name')
          }}</label>
          <InputText
            :id="createNameInputId"
            v-model="newName"
            class="w-full"
            :placeholder="t('admin.allergens_name_placeholder')"
            autofocus
            @keyup.enter="createAllergen"
          />
        </div>
      </div>
      <template #footer>
        <Button
          :label="t('common.cancel')"
          severity="secondary"
          outlined
          @click="showCreateDialog = false"
        />
        <Button
          :label="t('common.create')"
          icon="pi pi-check"
          :loading="submitting"
          :disabled="!newName"
          @click="createAllergen"
        />
      </template>
    </Dialog>
  </AppLayout>
</template>
