import { usePage } from '@inertiajs/vue3'
import { useToast } from 'primevue/usetoast'
import { watch, onMounted } from 'vue'
import type { SharedProps, FlashMessages } from '../types'

export interface ToastFlashMessage {
  severity: 'success' | 'info' | 'warn' | 'error'
  summary: string
  life: number
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

  const errorsBag = (flash as any)?.errorsBag as Record<string, string> | undefined
  if (errorsBag) {
    for (const message of Object.values(errorsBag)) {
      if (!message) continue
      messages.push({
        severity: 'error',
        summary: message,
        life: 5000,
      })
    }
  }

  const inputErrorsBag = (flash as any)?.inputErrorsBag as Record<string, string[]> | undefined
  if (inputErrorsBag) {
    for (const fieldMessages of Object.values(inputErrorsBag)) {
      if (!Array.isArray(fieldMessages)) continue
      for (const message of fieldMessages) {
        if (!message) continue
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
