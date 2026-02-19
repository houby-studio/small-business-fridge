import { usePage } from '@inertiajs/vue3'
import { useToast } from 'primevue/usetoast'
import { watch } from 'vue'
import type { SharedProps } from '~/types'

export function useFlash() {
  const page = usePage<SharedProps>()
  const toast = useToast()

  watch(
    () => page.props.flash,
    (flash) => {
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
    },
    { immediate: true }
  )
}
