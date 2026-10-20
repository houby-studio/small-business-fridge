// Mirrors app/services/stock_fifo.ts — change both together. No Vue, no i18n here:
// tests/unit/services/stock_fifo_rules.spec.ts imports this file to compare the two.

export interface FifoLot {
  id: number
  amountLeft: number
}

/** The lots a loss of `quantity` pieces comes off, oldest first; `lots` in FIFO order. */
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
