import { nextTick, ref } from 'vue'
import { router } from '@inertiajs/vue3'

/**
 * Handles the repeated inline-edit pattern in admin CRUD tables
 * (editingId, startEdit, saveEdit, cancelEdit, getEditInputId, focusCreateInput).
 *
 * Usage:
 *   const editName = ref('')
 *   const { editingId, getEditInputId, startEdit, saveEdit, cancelEdit, focusCreateInput } =
 *     useInlineEdit({
 *       entityPrefix: 'admin-allergen',
 *       updatePath: (id) => `/admin/allergens/${id}`,
 *       getEditValues: () => ({ name: editName.value }),
 *     })
 *
 *   function handleStartEdit(row: AllergenRow) {
 *     startEdit(row.id, () => { editName.value = row.name })
 *   }
 */
export function useInlineEdit({
  entityPrefix,
  updatePath,
  getEditValues,
}: {
  entityPrefix: string
  updatePath: (id: number) => string
  getEditValues: () => Record<string, string | number | boolean | null | undefined>
}) {
  const editingId = ref<number | null>(null)

  function getEditInputId(id: number) {
    return `${entityPrefix}-edit-name-${id}`
  }

  function startEdit(id: number, initState: () => void) {
    editingId.value = id
    initState()
    nextTick(() => {
      document.getElementById(getEditInputId(id))?.focus()
    })
  }

  function saveEdit() {
    if (!editingId.value) return
    router.put(updatePath(editingId.value), getEditValues(), {
      preserveState: true,
      onFinish: () => (editingId.value = null),
    })
  }

  function cancelEdit() {
    editingId.value = null
  }

  function focusCreateInput(inputId: string) {
    nextTick(() => {
      document.getElementById(inputId)?.focus()
    })
  }

  return { editingId, getEditInputId, startEdit, saveEdit, cancelEdit, focusCreateInput }
}
