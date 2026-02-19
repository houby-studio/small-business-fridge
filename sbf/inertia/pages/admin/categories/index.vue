<script setup lang="ts">
import { ref } from 'vue'
import { Head, router } from '@inertiajs/vue3'
import AppLayout from '~/layouts/AppLayout.vue'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import Tag from 'primevue/tag'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import ColorPicker from 'primevue/colorpicker'
import ToggleSwitch from 'primevue/toggleswitch'
import Dialog from 'primevue/dialog'
import { useI18n } from '~/composables/use_i18n'

interface CategoryRow {
  id: number
  name: string
  color: string
  isDisabled: boolean
}

const props = defineProps<{ categories: CategoryRow[] }>()
const { t } = useI18n()

const showCreateDialog = ref(false)
const newName = ref('')
const newColor = ref('2196F3')
const submitting = ref(false)

function createCategory() {
  submitting.value = true
  router.post(
    '/admin/categories',
    { name: newName.value, color: `#${newColor.value}` },
    {
      onFinish: () => {
        submitting.value = false
        showCreateDialog.value = false
        newName.value = ''
        newColor.value = '2196F3'
      },
    }
  )
}

function toggleDisabled(categoryId: number, isDisabled: boolean) {
  router.put(`/admin/categories/${categoryId}`, { isDisabled }, { preserveState: true })
}

// Inline editing
const editingId = ref<number | null>(null)
const editName = ref('')
const editColor = ref('')

function startEdit(cat: CategoryRow) {
  editingId.value = cat.id
  editName.value = cat.name
  editColor.value = cat.color.replace('#', '')
}

function saveEdit() {
  if (!editingId.value) return
  router.put(
    `/admin/categories/${editingId.value}`,
    { name: editName.value, color: `#${editColor.value}` },
    {
      preserveState: true,
      onFinish: () => (editingId.value = null),
    }
  )
}

function cancelEdit() {
  editingId.value = null
}
</script>

<template>
  <AppLayout>
    <Head :title="t('admin.categories_title')" />

    <div class="mb-6 flex items-center justify-between">
      <h1 class="text-2xl font-bold text-gray-900">{{ t('admin.categories_heading') }}</h1>
      <Button
        :label="t('admin.categories_new')"
        icon="pi pi-plus"
        @click="showCreateDialog = true"
      />
    </div>

    <DataTable :value="categories" stripedRows class="rounded-lg border">
      <Column :header="t('admin.categories_color')" style="width: 80px">
        <template #body="{ data }">
          <template v-if="editingId === data.id">
            <ColorPicker v-model="editColor" />
          </template>
          <template v-else>
            <div class="h-6 w-6 rounded-full border" :style="{ backgroundColor: data.color }" />
          </template>
        </template>
      </Column>
      <Column :header="t('common.name')">
        <template #body="{ data }">
          <template v-if="editingId === data.id">
            <InputText v-model="editName" class="w-full" @keyup.enter="saveEdit" />
          </template>
          <template v-else>
            {{ data.name }}
          </template>
        </template>
      </Column>
      <Column :header="t('common.active')" style="width: 100px">
        <template #body="{ data }">
          <ToggleSwitch
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

    <!-- Create dialog -->
    <Dialog
      v-model:visible="showCreateDialog"
      :header="t('admin.categories_new_heading')"
      :modal="true"
      style="width: 400px"
    >
      <div class="flex flex-col gap-4">
        <div>
          <label class="mb-1 block text-sm font-medium text-gray-700">{{ t('common.name') }}</label>
          <InputText
            v-model="newName"
            class="w-full"
            :placeholder="t('admin.categories_name_placeholder')"
          />
        </div>
        <div>
          <label class="mb-1 block text-sm font-medium text-gray-700">{{
            t('admin.categories_color')
          }}</label>
          <ColorPicker v-model="newColor" />
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
          @click="createCategory"
        />
      </template>
    </Dialog>
  </AppLayout>
</template>
