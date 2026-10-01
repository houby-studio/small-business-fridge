import sharp from 'sharp'
import productImagesConfig, { type BackgroundRemovalMethod } from '#config/product_images'
import { DomainError, isDomainError } from '#services/domain_error'
import {
  hasTransparentBorder,
  removeUniformBackground,
  type RawImage,
} from '#services/product_images/flood_fill'
import {
  decodeToRaw,
  normalizeProductImage,
  type RotateMode,
} from '#services/product_images/normalize'
import { fetchRemoteImage } from '#services/product_images/remote_image'
import {
  isCloudflareConfigured,
  isRembgConfigured,
  removeWithCloudflare,
  removeWithRembg,
} from '#services/product_images/background_providers'

export type BackgroundMode = 'auto' | BackgroundRemovalMethod

export type ProductImageErrorCode = 'image_unreadable' | 'image_background_method_unavailable'

export const BACKGROUND_MODES: BackgroundMode[] = ['auto', 'none', 'flood', 'rembg', 'cloudflare']
export const ROTATE_MODES: RotateMode[] = ['auto', 'none', 'cw', 'ccw']

export interface ProcessedProductImage {
  buffer: Buffer
  /** What actually removed the background (`none` when nothing did). */
  background: BackgroundRemovalMethod
  rotated: 'cw' | 'ccw' | null
}

export interface ProductImageCapabilities {
  backgrounds: BackgroundMode[]
  openFoodFacts: boolean
}

/** Longest side sent to a remote model — they work at ~1024px anyway. */
const PROVIDER_MAX_SIDE = 2048

/**
 * What a remote provider gets: the decoded, EXIF-oriented pixels as PNG. Sending the
 * original would lose the orientation (the cut-out PNG coming back carries no EXIF).
 */
function providerInput(raw: RawImage): Promise<Buffer> {
  return sharp(raw.data, { raw: { width: raw.width, height: raw.height, channels: 4 } })
    .resize(PROVIDER_MAX_SIDE, PROVIDER_MAX_SIDE, { fit: 'inside', withoutEnlargement: true })
    .png()
    .toBuffer()
}

const SUPPORTED_FORMATS = new Set(['jpeg', 'png', 'webp', 'gif', 'avif', 'heif', 'tiff'])

export default class ProductImageService {
  /** Methods the picker may offer on this instance. */
  static capabilities(): ProductImageCapabilities {
    const backgrounds: BackgroundMode[] = ['auto', 'none', 'flood']
    if (isRembgConfigured()) backgrounds.push('rembg')
    if (isCloudflareConfigured()) backgrounds.push('cloudflare')
    return { backgrounds, openFoodFacts: productImagesConfig.openFoodFacts.enabled }
  }

  static isAvailable(method: BackgroundMode): boolean {
    return ProductImageService.capabilities().backgrounds.includes(method)
  }

  async downloadFromUrl(url: string): Promise<Buffer> {
    return fetchRemoteImage(url, { maxBytes: productImagesConfig.maxDownloadBytes })
  }

  /**
   * The whole pipeline: remove the background, trim, rotate, fit the canvas, encode WebP.
   */
  async process(
    input: Buffer,
    options: { background: BackgroundMode; rotate: RotateMode }
  ): Promise<ProcessedProductImage> {
    if (!ProductImageService.isAvailable(options.background)) {
      throw new DomainError<ProductImageErrorCode>('image_background_method_unavailable')
    }

    let raw: RawImage
    try {
      const meta = await sharp(input).metadata()
      if (!meta.format || !SUPPORTED_FORMATS.has(meta.format)) throw new Error('format')
      raw = await decodeToRaw(input)
    } catch {
      throw new DomainError<ProductImageErrorCode>('image_unreadable')
    }

    const { raw: cutOut, method } = await this.removeBackground(raw, options.background)

    const normalized = await normalizeProductImage(cutOut, {
      width: productImagesConfig.width,
      height: productImagesConfig.height,
      rotate: options.rotate,
      rotateMinRatio: productImagesConfig.rotateMinRatio,
      autoDirection: productImagesConfig.rotateDirection,
    })

    return { buffer: normalized.buffer, background: method, rotated: normalized.rotated }
  }

  private async removeBackground(
    raw: RawImage,
    mode: BackgroundMode
  ): Promise<{ raw: RawImage; method: BackgroundRemovalMethod }> {
    if (mode === 'none') return { raw, method: 'none' }

    if (mode !== 'auto') {
      const result = await this.runMethod(mode, raw)
      return result ? { raw: result, method: mode } : { raw, method: 'none' }
    }

    // Already cut out (a transparent PNG) — nothing to do.
    if (hasTransparentBorder(raw)) return { raw, method: 'none' }

    let lastError: unknown = null
    for (const method of productImagesConfig.autoChain) {
      if (method === 'none' || !ProductImageService.isAvailable(method)) continue
      try {
        const result = await this.runMethod(method, raw)
        if (result) return { raw: result, method }
      } catch (error) {
        // A remote provider being down must not block saving — try the next one.
        if (!isDomainError(error)) throw error
        lastError = error
      }
    }
    // Every heavy provider failed: say so instead of silently keeping the background.
    if (lastError) throw lastError
    return { raw, method: 'none' }
  }

  private async runMethod(
    method: BackgroundRemovalMethod,
    raw: RawImage
  ): Promise<RawImage | null> {
    switch (method) {
      case 'none':
        return raw
      case 'flood':
        return removeUniformBackground(raw)
      case 'rembg':
        return decodeToRaw(await removeWithRembg(await providerInput(raw)))
      case 'cloudflare':
        return decodeToRaw(await removeWithCloudflare(await providerInput(raw)))
    }
  }
}
