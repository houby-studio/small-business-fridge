import { writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import app from '@adonisjs/core/services/app'
import Product from '#models/product'
import AuditService from '#services/audit_service'
import ProductImageService, {
  STORED_IMAGE_PREFIX,
  type BackgroundMode,
} from '#services/product_images/product_image_service'
import type { RotateMode } from '#services/product_images/normalize'
import { isDomainError } from '#services/domain_error'

export interface CatalogNormalizeOptions {
  dryRun: boolean
  background: BackgroundMode
  rotate?: RotateMode
  productIds?: number[]
  /** Left untouched, e.g. plated food the width rule would turn on its side. */
  excludeIds?: number[]
  onProgress?: (line: string) => void
}

export interface CatalogNormalizeReport {
  processed: number
  skipped: number
  failed: number
  rotated: number
  bytesBefore: number
  bytesAfter: number
}

/**
 * Runs every stored product image through the pipeline once, so the catalogue that was
 * uploaded by hand matches what the product form produces now. Writes new files under
 * new names and leaves the old ones in place — a rollback is a database restore away.
 */
export async function normalizeCatalogImages(
  options: CatalogNormalizeOptions
): Promise<CatalogNormalizeReport> {
  const report: CatalogNormalizeReport = {
    processed: 0,
    skipped: 0,
    failed: 0,
    rotated: 0,
    bytesBefore: 0,
    bytesAfter: 0,
  }
  const log = options.onProgress ?? (() => {})
  const service = new ProductImageService()
  const directory = app.makePath('storage/uploads/products')

  const query = Product.query().whereNotNull('imagePath').orderBy('id', 'asc')
  if (options.productIds?.length) query.whereIn('id', options.productIds)
  if (options.excludeIds?.length) query.whereNotIn('id', options.excludeIds)

  for (const product of await query) {
    const imagePath = product.imagePath!
    if (!imagePath.startsWith(STORED_IMAGE_PREFIX)) {
      report.skipped++
      continue
    }

    let input: Buffer
    try {
      input = await service.readStoredImage(product.id)
    } catch {
      log(`#${product.id} ${product.displayName}: file missing, skipped`)
      report.skipped++
      continue
    }

    try {
      const result = await service.process(input, {
        background: options.background,
        rotate: options.rotate ?? 'auto',
      })
      report.processed++
      report.bytesBefore += input.length
      report.bytesAfter += result.buffer.length
      if (result.rotated) report.rotated++
      log(
        `#${product.id} ${product.displayName}: ${Math.round(input.length / 1024)} kB → ` +
          `${Math.round(result.buffer.length / 1024)} kB, background ${result.background}` +
          (result.rotated ? ', rotated' : '')
      )
      if (options.dryRun) continue

      const fileName = `${randomUUID()}.webp`
      await writeFile(path.join(directory, fileName), result.buffer)
      const newPath = `${STORED_IMAGE_PREFIX}${fileName}`
      product.imagePath = newPath
      await product.save()
      await AuditService.log(null, 'product.updated', 'product', product.id, null, {
        image: { from: imagePath, to: newPath },
        reason: 'products:normalize-images',
      })
    } catch (error) {
      if (!isDomainError(error)) throw error
      log(`#${product.id} ${product.displayName}: ${error.code}`)
      report.failed++
    }
  }

  return report
}
