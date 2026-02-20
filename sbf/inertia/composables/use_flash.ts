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
  }

  // Fire on mount so the Toast component is ready to receive messages.
  // immediate: true would fire before <Toast> mounts (lost on full-page loads / SSR hydration).
  onMounted(() => showFlash(page.props.flash))

  // Watch for flash changes from subsequent Inertia navigations.
  watch(() => page.props.flash, showFlash)
}
