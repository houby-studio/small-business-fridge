import { reactive, ref, watch } from 'vue'

interface SuggestibleForm {
  displayName: string
  description: string
  categoryId: number | null
  barcode: string
  allergenIds: number[]
}

export interface FoundProduct {
  name: string | null
}

function xsrfToken() {
  return decodeURIComponent(document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]*)/)?.[1] ?? '')
}

async function post<T>(body: Record<string, unknown>): Promise<T> {
  const response = await fetch('/supplier/products/suggest', {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'X-XSRF-TOKEN': xsrfToken(),
    },
    body: JSON.stringify(body),
  })
  const json = (await response.json().catch(() => null)) as
    | (T & { message?: string; errors?: { message: string }[] })
    | null
  if (!response.ok) {
    throw new Error(json?.errors?.[0]?.message ?? json?.message ?? 'failed')
  }
  return json as T
}

/**
 * What the barcode lookup and the AI fill in for the supplier. Nothing a supplier typed
 * is ever overwritten: the name is only filled while it is empty or still the previous
 * suggestion, category and allergens only while empty, and the description only on an
 * explicit "Navrhnout". Every filled field says where its value came from until edited.
 */
export function useProductSuggestions(form: SuggestibleForm, aiEnabled: boolean) {
  const hints = reactive({ category: false, allergens: false, description: false })
  const describing = ref(false)
  const descriptionError = ref('')
  let autoName: string | null = null
  // Values we set ourselves; a change to anything else is the supplier's edit.
  let filled = { categoryId: null as number | null, allergens: '', description: '' }

  watch(
    () => form.categoryId,
    (value) => {
      if (value !== filled.categoryId) hints.category = false
    }
  )
  watch(
    () => form.allergenIds.join(','),
    (value) => {
      if (value !== filled.allergens) hints.allergens = false
    }
  )
  watch(
    () => form.description,
    (value) => {
      if (value !== filled.description) hints.description = false
    }
  )

  async function onFound(found: FoundProduct) {
    if (found.name && (!form.displayName.trim() || form.displayName === autoName)) {
      form.displayName = found.name
      autoName = found.name
    }
    if (form.categoryId !== null && form.allergenIds.length > 0) return
    try {
      const result = await post<{ categoryId: number | null; allergenIds: number[] }>({
        field: 'classification',
        name: form.displayName.trim() || found.name || form.barcode,
        barcode: form.barcode.trim(),
      })
      if (form.categoryId === null && result.categoryId !== null) {
        filled.categoryId = result.categoryId
        form.categoryId = result.categoryId
        hints.category = true
      }
      if (form.allergenIds.length === 0 && result.allergenIds.length > 0) {
        filled.allergens = result.allergenIds.join(',')
        form.allergenIds = [...result.allergenIds]
        hints.allergens = true
      }
    } catch {
      // Hints are a convenience; the supplier fills the fields by hand as before.
    }
  }

  async function suggestDescription() {
    if (!aiEnabled || !form.displayName.trim()) return
    describing.value = true
    descriptionError.value = ''
    try {
      const result = await post<{ description: string }>({
        field: 'description',
        name: form.displayName.trim(),
        ...(/^\d{8,14}$/.test(form.barcode.trim()) ? { barcode: form.barcode.trim() } : {}),
        ...(form.description.trim() ? { currentDescription: form.description.trim() } : {}),
      })
      filled = { ...filled, description: result.description }
      form.description = result.description
      hints.description = true
    } catch (error) {
      descriptionError.value = (error as Error).message
    } finally {
      describing.value = false
    }
  }

  return { hints, describing, descriptionError, onFound, suggestDescription }
}
