import { BaseCommand, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'

export default class ProductsNormalizeImages extends BaseCommand {
  static commandName = 'products:normalize-images'
  static description =
    'Run the stored product images through the image pipeline (trim, rotate, 450×800 WebP)'

  static options: CommandOptions = {
    startApp: true,
  }

  @flags.boolean({ description: 'Only report what would change; write nothing' })
  declare dryRun: boolean

  @flags.string({
    description:
      'Background removal: none (default), flood, auto, rembg, cloudflare. Anything but ' +
      'none changes how existing images look — review a --dry-run first.',
    default: 'none',
  })
  declare background: string

  @flags.string({ description: 'Comma-separated product IDs (default: all)' })
  declare ids: string | undefined

  async run() {
    const { normalizeCatalogImages } = await import('#services/product_images/catalog_normalizer')
    const { BACKGROUND_MODES } = await import('#services/product_images/product_image_service')

    const background = this.background as (typeof BACKGROUND_MODES)[number]
    if (!BACKGROUND_MODES.includes(background)) {
      this.logger.error(`Unknown --background "${this.background}"`)
      this.exitCode = 1
      return
    }
    const productIds = this.ids
      ?.split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isInteger(n) && n > 0)

    const report = await normalizeCatalogImages({
      dryRun: this.dryRun,
      background,
      productIds,
      onProgress: (line) => this.logger.info(line),
    })

    const mb = (bytes: number) => (bytes / 1024 / 1024).toFixed(1)
    this.logger.success(
      `${this.dryRun ? '[dry run] ' : ''}${report.processed} processed ` +
        `(${report.rotated} rotated), ${report.skipped} skipped, ${report.failed} failed; ` +
        `${mb(report.bytesBefore)} MB → ${mb(report.bytesAfter)} MB`
    )
    if (report.failed > 0) this.exitCode = 1
  }
}
