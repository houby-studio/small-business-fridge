<script setup lang="ts">
import { ref } from 'vue'
import { Head, router } from '@inertiajs/vue3'
import AppLayout from '~/layouts/AppLayout.vue'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import ToggleSwitch from 'primevue/toggleswitch'
import Tag from 'primevue/tag'
import Dialog from 'primevue/dialog'
import ConfirmDialog from 'primevue/confirmdialog'
import { useConfirm } from 'primevue/useconfirm'
import { useI18n } from '~/composables/use_i18n'
import { useInlineEdit } from '~/composables/use_inline_edit'

interface AllergenRow {
  id: number
  name: string
  isDisabled: boolean
  hasProducts: boolean
}

const props = defineProps<{ allergens: AllergenRow[] }>()
const { t } = useI18n()
const confirm = useConfirm()

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

const editName = ref('')

const { editingId, getEditInputId, startEdit, saveEdit, cancelEdit, focusCreateInput } =
  useInlineEdit({
    entityPrefix: 'admin-allergen',
    updatePath: (id) => `/admin/allergens/${id}`,
    getEditValues: () => ({ name: editName.value }),
  })

function handleStartEdit(row: AllergenRow) {
  startEdit(row.id, () => {
    editName.value = row.name
  })
}

function deleteAllergen(allergen: AllergenRow) {
  confirm.require({
    message: t('admin.allergens_delete_confirm', { name: allergen.name }),
    header: t('admin.allergens_delete_header'),
    icon: 'pi pi-exclamation-triangle',
    acceptLabel: t('admin.allergens_delete_accept'),
    rejectLabel: t('common.cancel'),
    acceptClass: 'p-button-danger',
    accept: () => {
      router.delete(`/admin/allergens/${allergen.id}`)
    },
  })
}
</script>

<template>
  <AppLayout>
    <Head :title="t('admin.allergens_title')" />
    <ConfirmDialog />

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
              :id="getEditInputId(data.id)"
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
      <Column :header="t('common.actions')" style="width: 220px">
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
                @click="handleStartEdit(data)"
              />
              <Button
                icon="pi pi-trash"
                size="small"
                severity="danger"
                text
                :disabled="data.hasProducts"
                :title="data.hasProducts ? t('messages.allergen_has_products_delete') : undefined"
                :aria-label="
                  data.hasProducts ? t('messages.allergen_has_products_delete') : t('common.delete')
                "
                @click="deleteAllergen(data)"
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
      @show="focusCreateInput(createNameInputId)"
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
