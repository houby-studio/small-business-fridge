import { usePage } from '@inertiajs/vue3'
import { useToast } from 'primevue/usetoast'
import { watch, onMounted } from 'vue'
import type { SharedProps, FlashMessages } from '~/types'

export function useFlash() {
  const page = usePage<SharedProps>()
  const toast = useToast()

  function showFlash(flash: FlashMessages | undefined) {
    if (flash?.alert) {
      const severityMap: Record<string, 'success' | 'info' | 'warn' | 'error'> = {
        success: 'success',
        info: 'info',
        warn: 'warn',
        danger: 'error',
      }
      toast.add({
        severity: severityMap[flash.alert.type] || 'info',
        summary: flash.alert.message,
        life: 4000,
      })
    }

    const errorsBag = (flash as any)?.errorsBag as Record<string, string> | undefined
    if (errorsBag) {
      for (const message of Object.values(errorsBag)) {
        if (!message) continue
        toast.add({
          severity: 'error',
          summary: message,
          life: 5000,
        })
      }
    }

    const inputErrorsBag = (flash as any)?.inputErrorsBag as Record<string, string[]> | undefined
    if (inputErrorsBag) {
      for (const messages of Object.values(inputErrorsBag)) {
        if (!Array.isArray(messages)) continue
        for (const message of messages) {
          if (!message) continue
          toast.add({
            severity: 'error',
            summary: message,
            life: 5000,
          })
        }
      }
    }
  }

  // Fire on mount so the Toast component is ready to receive messages.
  // immediate: true would fire before <Toast> mounts on full page loads.
  onMounted(() => showFlash(page.props.flash))

  // Watch for flash changes from subsequent Inertia navigations.
  watch(() => page.props.flash, showFlash)
}
