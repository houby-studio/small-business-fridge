import logger from '@adonisjs/core/services/logger'

/**
 * Work that runs after the answer instead of delaying it — e-mails above all. A failure is
 * logged and never undoes what triggered it. Each task is tracked until it settles, so a
 * test can wait for exactly these instead of polling with a timeout.
 */
const pending = new Set<Promise<void>>()
const failures: Array<{ label: string; error: unknown }> = []

export function runAfterResponse(task: () => Promise<unknown>, label: string): void {
  const settled: Promise<void> = Promise.resolve()
    .then(task)
    .then(
      () => undefined,
      (error: unknown) => {
        failures.push({ label, error })
        logger.error({ err: error }, `Failed: ${label}`)
      }
    )
    .finally(() => {
      pending.delete(settled)
    })
  pending.add(settled)
}

/**
 * Waits until every tracked task has settled, including tasks started meanwhile, and
 * returns (and forgets) the ones that failed. For tests.
 */
export async function settleSideEffects(): Promise<Array<{ label: string; error: unknown }>> {
  while (pending.size > 0) await Promise.all([...pending])
  return failures.splice(0)
}
