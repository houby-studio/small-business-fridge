/**
 * Which lots a loss of `quantity` pieces comes off: the oldest first, across every
 * supplier — the order the fridge sells in. Mirrored for the live preview of the write-off
 * dialog in inertia/composables/stock_fifo_rules.ts — change both; the parity test in
 * tests/unit/services/stock_fifo_rules.spec.ts compares them.
 */

export interface FifoLot {
  id: number
  amountLeft: number
}

/**
 * `lots` must already be in FIFO order (`created_at`, then `id`). Returns the lots that
 * give pieces, with how many each gives; takes as much as there is when `quantity` is more
 * than the stock.
 */
export function planFifoTake(
  lots: readonly FifoLot[],
  quantity: number
): Array<{ id: number; take: number }> {
  const plan: Array<{ id: number; take: number }> = []
  let remaining = Math.max(0, Math.floor(quantity))
  for (const lot of lots) {
    if (remaining === 0) break
    const take = Math.min(Math.max(0, lot.amountLeft), remaining)
    if (take <= 0) continue
    plan.push({ id: lot.id, take })
    remaining -= take
  }
  return plan
}
