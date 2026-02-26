<script setup lang="ts">
import { ref } from 'vue'
import { Head, router, useForm } from '@inertiajs/vue3'
import AppLayout from '~/layouts/AppLayout.vue'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import ToggleSwitch from 'primevue/toggleswitch'
import Select from 'primevue/select'
import Dialog from 'primevue/dialog'
import ConfirmDialog from 'primevue/confirmdialog'
import { useConfirm } from 'primevue/useconfirm'
import { useI18n } from '~/composables/use_i18n'
import { useInlineEdit } from '~/composables/use_inline_edit'

interface TrackRow {
  id: number
  name: string
  filePath: string
  mimeType: string
  accessLevel: 'public' | 'premium'
  isDisabled: boolean
}

const props = defineProps<{ tracks: TrackRow[] }>()
const { t } = useI18n()
const confirm = useConfirm()

const accessLevelOptions = [
  { label: t('admin.music_access_public'), value: 'public' },
  { label: t('admin.music_access_premium'), value: 'premium' },
]

const showCreateDialog = ref(false)
const createNameInputId = 'admin-music-create-name'
const createForm = useForm({
  name: '',
  accessLevel: 'public' as 'public' | 'premium',
  file: null as File | null,
})

function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  createForm.file = input.files?.[0] ?? null
  if (createForm.file) {
    createForm.clearErrors('file')
  }
}

function createTrack() {
  if (createForm.processing || !createForm.name.trim() || !createForm.file) return
  createForm.post('/admin/music', {
    forceFormData: true,
    onSuccess: () => {
      showCreateDialog.value = false
      createForm.reset()
      createForm.accessLevel = 'public'
    },
  })
}

function toggleDisabled(trackId: number, isDisabled: boolean) {
  router.put(`/admin/music/${trackId}`, { isDisabled }, { preserveState: true })
}

function updateAccessLevel(trackId: number, accessLevel: 'public' | 'premium') {
  router.put(`/admin/music/${trackId}`, { accessLevel }, { preserveState: true })
}

const editName = ref('')

const { editingId, getEditInputId, startEdit, saveEdit, cancelEdit, focusCreateInput } =
  useInlineEdit({
    entityPrefix: 'admin-music',
    updatePath: (id) => `/admin/music/${id}`,
    getEditValues: () => ({ name: editName.value }),
  })

function handleStartEdit(row: TrackRow) {
  startEdit(row.id, () => {
    editName.value = row.name
  })
}

function deleteTrack(track: TrackRow) {
  confirm.require({
    message: t('admin.music_delete_confirm', { name: track.name }),
    header: t('admin.music_delete_header'),
    icon: 'pi pi-exclamation-triangle',
    acceptLabel: t('admin.music_delete_accept'),
    rejectLabel: t('common.cancel'),
    acceptClass: 'p-button-danger',
    accept: () => {
      router.delete(`/admin/music/${track.id}`)
    },
  })
}
</script>

<template>
  <AppLayout>
    <Head :title="t('admin.music_title')" />
    <ConfirmDialog />

    <div class="mb-6 flex items-center justify-between">
      <h1 class="text-2xl font-bold text-gray-900 dark:text-zinc-100">
        {{ t('admin.music_heading') }}
      </h1>
      <Button :label="t('admin.music_new')" icon="pi pi-plus" @click="showCreateDialog = true" />
    </div>

    <DataTable :value="tracks" stripedRows class="rounded-lg border">
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
      <Column :header="t('admin.music_access')" style="width: 180px">
        <template #body="{ data }">
          <Select
            :modelValue="data.accessLevel"
            :options="accessLevelOptions"
            optionLabel="label"
            optionValue="value"
            class="w-full"
            @update:modelValue="(val: 'public' | 'premium') => updateAccessLevel(data.id, val)"
          />
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
                :aria-label="t('common.delete')"
                @click="deleteTrack(data)"
              />
            </template>
          </div>
        </template>
      </Column>
    </DataTable>

    <Dialog
      v-model:visible="showCreateDialog"
      :header="t('admin.music_new_heading')"
      :modal="true"
      :closeButtonProps="{ severity: 'secondary', text: true, rounded: true, autofocus: false }"
      style="width: 460px"
      @show="focusCreateInput(createNameInputId)"
    >
      <div class="flex flex-col gap-4">
        <div>
          <label class="mb-1 block text-sm font-medium text-gray-700 dark:text-zinc-300">{{
            t('common.name')
          }}</label>
          <InputText
            :id="createNameInputId"
            v-model="createForm.name"
            class="w-full"
            :placeholder="t('admin.music_name_placeholder')"
            :invalid="!!createForm.errors.name"
            autofocus
            @keyup.enter="createTrack"
          />
          <small v-if="createForm.errors.name" class="text-red-600 dark:text-red-400">{{
            createForm.errors.name
          }}</small>
        </div>

        <div>
          <label class="mb-1 block text-sm font-medium text-gray-700 dark:text-zinc-300">{{
            t('admin.music_access')
          }}</label>
          <Select
            v-model="createForm.accessLevel"
            :options="accessLevelOptions"
            optionLabel="label"
            optionValue="value"
            class="w-full"
          />
        </div>

        <div>
          <label class="mb-1 block text-sm font-medium text-gray-700 dark:text-zinc-300">{{
            t('admin.music_file')
          }}</label>
          <input
            type="file"
            accept=".mp3,.ogg,.wav,.m4a,audio/*"
            class="block w-full text-sm text-gray-900 file:mr-4 file:rounded-md file:border-0 file:bg-gray-100 file:px-3 file:py-2 file:text-sm file:font-medium dark:text-zinc-100 dark:file:bg-zinc-700"
            @change="onFileChange"
          />
          <small v-if="createForm.errors.file" class="text-red-600 dark:text-red-400">{{
            createForm.errors.file
          }}</small>
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
          :loading="createForm.processing"
          :disabled="!createForm.name || !createForm.file"
          @click="createTrack"
        />
      </template>
    </Dialog>
  </AppLayout>
</template>
