import { useConfirm } from 'primevue/useconfirm'
import type { ConfirmationOptions } from 'primevue/confirmationoptions'

export interface AppConfirmationOptions extends ConfirmationOptions {
  /** Destructive or irreversible action — the accept button turns red (danger). */
  destructive?: boolean
}

/**
 * `useConfirm()` with the app's dialog button standard (CLAUDE.md): Cancel is a quiet
 * secondary text button, the action is the only filled one. PrimeVue's ConfirmDialog
 * otherwise renders both buttons filled in the primary colour, so Cancel looks as loud as
 * the irreversible action next to it.
 *
 * Not used by the kiosk, whose touch UI deliberately keeps both buttons large and filled.
 */
export function useAppConfirm() {
  const confirm = useConfirm()

  return {
    require(options: AppConfirmationOptions) {
      const { destructive, ...rest } = options
      confirm.require({
        ...rest,
        rejectProps: { severity: 'secondary', text: true, ...rest.rejectProps },
        acceptProps: destructive ? { severity: 'danger', ...rest.acceptProps } : rest.acceptProps,
      })
    },
    close: () => confirm.close(),
  }
}
