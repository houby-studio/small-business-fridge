import { usePage } from '@inertiajs/vue3'
import { useToast } from 'primevue/usetoast'
import { watch, onMounted } from 'vue'
import type { SharedProps, FlashMessages } from '../types'

export interface ToastFlashMessage {
  severity: 'success' | 'info' | 'warn' | 'error'
  summary: string
  life: number
}

function collectStringMessages(value: unknown): string[] {
  if (typeof value === 'string') {
    const message = value.trim()
    return message ? [message] : []
  }

  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectStringMessages(entry))
  }

  if (value && typeof value === 'object') {
    return Object.values(value).flatMap((entry) => collectStringMessages(entry))
  }

  return []
}

export function extractFlashToastMessages(flash: FlashMessages | undefined): ToastFlashMessage[] {
  const messages: ToastFlashMessage[] = []

  if (flash?.alert) {
    const severityMap: Record<string, 'success' | 'info' | 'warn' | 'error'> = {
      success: 'success',
      info: 'info',
      warn: 'warn',
      danger: 'error',
    }
    messages.push({
      severity: severityMap[flash.alert.type] || 'info',
      summary: flash.alert.message,
      life: 4000,
    })
  }

  const errorsBag = (flash as any)?.errorsBag as Record<string, unknown> | undefined
  if (errorsBag) {
    for (const message of Object.values(errorsBag).flatMap((entry) =>
      collectStringMessages(entry)
    )) {
      messages.push({
        severity: 'error',
        summary: message,
        life: 5000,
      })
    }
  }

  const inputErrorsBag = (flash as any)?.inputErrorsBag as Record<string, unknown> | undefined
  if (inputErrorsBag) {
    for (const fieldMessages of Object.values(inputErrorsBag)) {
      for (const message of collectStringMessages(fieldMessages)) {
        messages.push({
          severity: 'error',
          summary: message,
          life: 5000,
        })
      }
    }
  }

  return messages
}

export function useFlash() {
  const page = usePage<SharedProps>()
  const toast = useToast()

  function showFlash(flash: FlashMessages | undefined) {
    for (const message of extractFlashToastMessages(flash)) {
      toast.add({
        severity: message.severity,
        summary: message.summary,
        life: message.life,
      })
    }
  }

  // Fire on mount so the Toast component is ready to receive messages.
  // immediate: true would fire before <Toast> mounts on full page loads.
  onMounted(() => showFlash(page.props.flash))

  // Watch for flash changes from subsequent Inertia navigations.
  watch(() => page.props.flash, showFlash)
}
