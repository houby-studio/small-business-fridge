import sharp from 'sharp'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import app from '@adonisjs/core/services/app'
import Product from '#models/product'
import productImagesConfig, { type BackgroundRemovalMethod } from '#config/product_images'
import { DomainError, isDomainError } from '#services/domain_error'
import {
  hasTransparentBorder,
  removeUniformBackground,
  type RawImage,
} from '#services/product_images/flood_fill'
import {
  cropToContent,
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

export type ProductImageErrorCode =
  | 'image_unreadable'
  | 'image_background_method_unavailable'
  | 'image_stored_missing'

export const BACKGROUND_MODES: BackgroundMode[] = ['auto', 'none', 'flood', 'rembg', 'cloudflare']
export const ROTATE_MODES: RotateMode[] = ['auto', 'none', 'cw', 'ccw']

export interface ProcessedProductImage {
  buffer: Buffer
  /** What actually removed the background (`none` when nothing did). */
  background: BackgroundRemovalMethod
  rotated: 'cw' | 'ccw' | null
  /** Set when "auto" left the background alone because the image is already cut out. */
  note: 'already_transparent' | null
}

export interface ProductImageCapabilities {
  backgrounds: BackgroundMode[]
  openFoodFacts: boolean
  /** Suppliers may contribute EAN, name and photos back to Open Food Facts. */
  openFoodFactsContribute: boolean
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

export const STORED_IMAGE_PREFIX = '/uploads/products/'

const SUPPORTED_FORMATS = new Set(['jpeg', 'png', 'webp', 'gif', 'avif', 'heif', 'tiff'])

export default class ProductImageService {
  /** Methods the picker may offer on this instance. */
  static capabilities(): ProductImageCapabilities {
    const backgrounds: BackgroundMode[] = ['auto', 'none', 'flood']
    if (isRembgConfigured()) backgrounds.push('rembg')
    if (isCloudflareConfigured()) backgrounds.push('cloudflare')
    const off = productImagesConfig.openFoodFacts
    return {
      backgrounds,
      openFoodFacts: off.enabled,
      openFoodFactsContribute: off.enabled && !!off.userId && !!off.password,
    }
  }

  static isAvailable(method: BackgroundMode): boolean {
    return ProductImageService.capabilities().backgrounds.includes(method)
  }

  /**
   * The image a product already has, straight from storage — for "process the existing
   * image" in the edit form and for the catalogue command.
   */
  async readStoredImage(productId: number): Promise<Buffer> {
    const product = await Product.find(productId)
    const imagePath = product?.imagePath
    if (!imagePath?.startsWith(STORED_IMAGE_PREFIX)) {
      throw new DomainError<ProductImageErrorCode>('image_stored_missing')
    }
    try {
      // basename(): the stored path never gets to pick a directory.
      return await readFile(
        path.join(app.makePath('storage/uploads/products'), path.basename(imagePath))
      )
    } catch {
      throw new DomainError<ProductImageErrorCode>('image_stored_missing')
    }
  }

  async downloadFromUrl(url: string): Promise<Buffer> {
    return fetchRemoteImage(url, { maxBytes: productImagesConfig.maxDownloadBytes })
  }

  /**
   * The whole pipeline: remove the background, trim, rotate, fit the canvas, encode WebP.
   */
  async process(
    input: Buffer,
    options: { background: BackgroundMode; rotate: RotateMode; turn?: number }
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

    const { raw: cutOut, method, note } = await this.removeBackground(raw, options.background)

    const normalized = await normalizeProductImage(cutOut, {
      width: productImagesConfig.width,
      height: productImagesConfig.height,
      rotate: options.rotate,
      turn: options.turn,
      rotateMinRatio: productImagesConfig.rotateMinRatio,
      autoDirection: productImagesConfig.rotateDirection,
    })

    return { buffer: normalized.buffer, background: method, rotated: normalized.rotated, note }
  }

  /**
   * The photo without its background, as taken (no trimming to the 9:16 canvas, no
   * rotation) and at working resolution, flattened on white as JPEG — the cut-out that goes
   * to Open Food Facts next to the original. `null` when the background stays or nothing
   * was removed: the original then says it all.
   */
  async cutOut(input: Buffer, background: BackgroundMode): Promise<Buffer | null> {
    if (background === 'none') return null
    // The instance may have lost a provider since the preview — "auto" still does its best.
    const mode = ProductImageService.isAvailable(background) ? background : 'auto'

    let raw: RawImage
    try {
      raw = await decodeToRaw(input)
    } catch {
      throw new DomainError<ProductImageErrorCode>('image_unreadable')
    }

    const { raw: cut, method } = await this.removeBackground(raw, mode)
    if (method === 'none') return null
    const content = cropToContent(cut)
    return sharp(content.data, {
      raw: { width: content.width, height: content.height, channels: 4 },
    })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 92 })
      .toBuffer()
  }

  private async removeBackground(
    raw: RawImage,
    mode: BackgroundMode
  ): Promise<{
    raw: RawImage
    method: BackgroundRemovalMethod
    note: ProcessedProductImage['note']
  }> {
    if (mode === 'none') return { raw, method: 'none', note: null }

    // Methods work on the visible content, so a backdrop kept inside a transparent
    // canvas (an earlier "keep background" result) can still be removed.
    const content = cropToContent(raw)

    if (mode !== 'auto') {
      const result = await this.runMethod(mode, content)
      return result
        ? { raw: result, method: mode, note: null }
        : { raw: content, method: 'none', note: null }
    }

    // Already cut out: transparency reaches the product itself. Judged on the content,
    // not the canvas — a backdrop kept on a transparent canvas is an opaque rectangle and
    // still gets removed. Running a model on a cut-out would only cost a call and risk
    // nibbling at the product; an explicit method choice still forces it.
    if (hasTransparentBorder(content)) {
      return { raw, method: 'none', note: 'already_transparent' }
    }

    let lastError: unknown = null
    for (const method of productImagesConfig.autoChain) {
      if (method === 'none' || !ProductImageService.isAvailable(method)) continue
      try {
        const result = await this.runMethod(method, content)
        if (result) return { raw: result, method, note: null }
      } catch (error) {
        // A remote provider being down must not block saving — try the next one.
        if (!isDomainError(error)) throw error
        lastError = error
      }
    }
    // Every heavy provider failed: say so instead of silently keeping the background.
    if (lastError) throw lastError
    return { raw, method: 'none', note: null }
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
