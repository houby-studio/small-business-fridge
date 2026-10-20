import db from '@adonisjs/lucid/services/db'

/**
 * Whether the "Rozsah: Celá lednice / Jen moje" filter means anything for this supplier.
 *
 * It does as soon as someone else has ever stocked the fridge (voided deliveries included,
 * the history lists them). When every delivery is the supplier's own, "mine" and "all"
 * show exactly the same rows — the usual single-supplier installation — and the filter is
 * only noise.
 */
export async function hasOtherSuppliers(userId: number): Promise<boolean> {
  const row = await db.from('deliveries').whereNot('supplier_id', userId).select('id').first()
  return row !== null
}
