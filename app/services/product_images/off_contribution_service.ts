import { createHmac } from 'node:crypto'
import { DateTime } from 'luxon'
import logger from '@adonisjs/core/services/logger'
import env from '#start/env'
import productImagesConfig from '#config/product_images'
import buildInfo from '#services/build_info'
import AuditService from '#services/audit_service'
import OffContribution, { type OffContributionResult } from '#models/off_contribution'
import type Product from '#models/product'
import ProductImageService, {
  type BackgroundMode,
} from '#services/product_images/product_image_service'
import { isPublicGtin } from '#services/product_images/gtin'
import { offHeaders } from '#services/product_images/open_food_facts'

/** After this many failed rounds a contribution is given up (and its photo dropped). */
export const MAX_ATTEMPTS = 6
/** Rounds per scheduler tick — every one may run a background-removal model. */
const BATCH_SIZE = 5
const ERROR_MAX_LENGTH = 1000

class OffRequestError extends Error {}

interface OffState {
  exists: boolean
  hasName: boolean
  hasFront: boolean
}

/** OFF's imgid for an upload it rejected: -3 it has this file, -4 too small, -5 unreadable. */
const IMAGE_DUPLICATE = -3
const IMAGE_REJECTED = new Set([-4, -5])

/**
 * Sends what suppliers agreed to share to Open Food Facts: the EAN and the name of a
 * product OFF does not know, and their own photo twice — as taken and with the background
 * removed. Queued on save, sent by the scheduler (see docs/product-images.md).
 *
 * Nothing that is already on OFF is overwritten: the name only goes to a product without
 * one, and a photo only becomes the front image of a product that has none.
 */
export default class OffContributionService {
  static isEnabled(): boolean {
    return ProductImageService.capabilities().openFoodFactsContribute
  }

  /**
   * Records the supplier's consent. Returns `null` when there is nothing to send: the
   * feature is off, the barcode is no public EAN (in-store codes name nothing outside the
   * shop) or, without a new photo, the barcode was contributed already.
   */
  async queue(input: {
    product: Product
    userId: number
    original?: { data: Buffer; mime: string } | null
    background?: BackgroundMode
  }): Promise<OffContribution | null> {
    if (!OffContributionService.isEnabled()) return null
    const barcode = input.product.barcode?.trim() ?? ''
    if (!isPublicGtin(barcode)) return null

    if (!input.original) {
      const earlier = await OffContribution.query()
        .where('barcode', barcode)
        .whereIn('status', ['pending', 'done'])
        .first()
      if (earlier) return null
    }

    const contribution = await OffContribution.create({
      productId: input.product.id,
      userId: input.userId,
      barcode,
      productName: input.product.displayName,
      originalImage: input.original?.data ?? null,
      originalMime: input.original?.mime ?? null,
      background: input.background ?? 'auto',
      status: 'pending',
      attempts: 0,
      nextAttemptAt: DateTime.now(),
    })

    await AuditService.log(input.userId, 'product.off_shared', 'product', input.product.id, null, {
      name: input.product.displayName,
      barcode,
      photo: !!input.original,
    })

    return contribution
  }

  /** One scheduler tick: sends the contributions that are due. */
  async processDue(): Promise<number> {
    const due = await OffContribution.query()
      .where('status', 'pending')
      .where('nextAttemptAt', '<=', DateTime.now().toSQL()!)
      .orderBy('id', 'asc')
      .limit(BATCH_SIZE)
    for (const contribution of due) {
      await this.send(contribution)
    }
    return due.length
  }

  async send(contribution: OffContribution): Promise<void> {
    contribution.attempts += 1
    try {
      await this.contribute(contribution)
      contribution.status = 'done'
      contribution.completedAt = DateTime.now()
      contribution.lastError = null
      contribution.originalImage = null
      await contribution.save()
      await AuditService.log(
        null,
        'product.off_contributed',
        'product',
        contribution.productId,
        contribution.userId,
        { barcode: contribution.barcode, ...contribution.result }
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      contribution.lastError = message.slice(0, ERROR_MAX_LENGTH)
      if (contribution.attempts >= MAX_ATTEMPTS) {
        contribution.status = 'failed'
        contribution.completedAt = DateTime.now()
        contribution.originalImage = null
      } else {
        // 5, 10, 20, 40, 80 minutes — OFF being down for an evening must not lose it.
        contribution.nextAttemptAt = DateTime.now().plus({
          minutes: 5 * 2 ** (contribution.attempts - 1),
        })
      }
      await contribution.save()
      logger.warn(
        { err: error, contributionId: contribution.id, attempts: contribution.attempts },
        'Open Food Facts contribution failed'
      )
      if (contribution.status === 'failed') {
        await AuditService.log(
          null,
          'product.off_contribution_failed',
          'product',
          contribution.productId,
          contribution.userId,
          { barcode: contribution.barcode, error: contribution.lastError }
        )
      }
    }
  }

  /**
   * The steps, each recorded in `result` as soon as it is done — a retry continues where
   * the last round stopped instead of uploading (or cutting out) the photo again.
   */
  private async contribute(contribution: OffContribution): Promise<void> {
    const result: OffContributionResult = contribution.result ?? {
      productCreated: false,
      nameSent: false,
      images: [],
    }
    const persist = async () => {
      contribution.result = { ...result, images: [...result.images] }
      await contribution.save()
    }

    const state = await this.fetchState(contribution.barcode)

    if (!state.hasName && !result.nameSent) {
      await this.saveProduct(contribution, state.exists)
      result.productCreated = !state.exists
      result.nameSent = true
      await persist()
    }

    const original = contribution.originalImage
    if (!original) return

    let hasFront = state.hasFront || result.images.some((i) => i.imagefield === 'front_cs')
    const upload = async (kind: 'cutout' | 'original', image: Buffer, mime: string) => {
      const imagefield = hasFront ? 'other' : 'front_cs'
      const outcome = await this.uploadImage(contribution, imagefield, image, mime)
      result.images.push({ kind, imagefield, ...outcome })
      if (outcome.imgid !== null && imagefield === 'front_cs') hasFront = true
      await persist()
    }

    // The cut-out first: it is the one worth showing as the front of the pack.
    if (!result.images.some((i) => i.kind === 'cutout')) {
      const cutOut = await new ProductImageService().cutOut(original, contribution.background)
      if (cutOut) {
        await upload('cutout', cutOut, 'image/jpeg')
      } else {
        result.images.push({ kind: 'cutout', imagefield: null, imgid: null, skipped: 'no_cutout' })
        await persist()
      }
    }
    if (!result.images.some((i) => i.kind === 'original')) {
      await upload('original', original, contribution.originalMime ?? 'image/jpeg')
    }
  }

  private async fetchState(barcode: string): Promise<OffState> {
    const fields = 'product_name,product_name_cs,selected_images'
    const response = await this.request(
      `/api/v2/product/${barcode}.json?fields=${fields}`,
      { method: 'GET' },
      productImagesConfig.openFoodFacts.timeoutMs
    )
    const body = (await response.json().catch(() => null)) as {
      status?: number
      product?: {
        product_name?: string
        product_name_cs?: string
        selected_images?: { front?: { display?: Record<string, string> } }
      }
    } | null
    // v2 answers an unknown barcode with 404 and `status: 0`.
    if (body?.status === 0) return { exists: false, hasName: false, hasFront: false }
    if (!response.ok || body?.status !== 1 || !body.product) {
      throw new OffRequestError(`product lookup failed (HTTP ${response.status})`)
    }
    const { product } = body
    return {
      exists: true,
      hasName: !!(product.product_name?.trim() || product.product_name_cs?.trim()),
      hasFront: Object.keys(product.selected_images?.front?.display ?? {}).length > 0,
    }
  }

  private async saveProduct(contribution: OffContribution, exists: boolean): Promise<void> {
    const form = this.credentials(contribution)
    form.set('product_name_cs', contribution.productName)
    // The main language only for a product we create — an existing one already has it.
    if (!exists) form.set('lang', 'cs')

    const response = await this.request(
      '/cgi/product_jqm2.pl',
      { method: 'POST', body: form },
      productImagesConfig.openFoodFacts.timeoutMs
    )
    const body = (await response.json().catch(() => null)) as {
      status?: number
      status_verbose?: string
    } | null
    if (!response.ok || body?.status !== 1) {
      throw new OffRequestError(
        `saving the product failed: ${body?.status_verbose ?? `HTTP ${response.status}`}`
      )
    }
  }

  private async uploadImage(
    contribution: OffContribution,
    imagefield: string,
    image: Buffer,
    mime: string
  ): Promise<{ imgid: number | null; skipped?: string }> {
    const form = this.credentials(contribution)
    form.set('imagefield', imagefield)
    const extension = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg'
    form.set(
      `imgupload_${imagefield}`,
      new Blob([new Uint8Array(image)], { type: mime }),
      `${contribution.barcode}.${extension}`
    )

    const response = await this.request(
      '/cgi/product_image_upload.pl',
      { method: 'POST', body: form },
      productImagesConfig.openFoodFacts.uploadTimeoutMs
    )
    const body = (await response.json().catch(() => null)) as {
      status?: string
      imgid?: number | string
      image?: { imgid?: number | string }
      error?: string
    } | null
    if (response.ok && body?.status === 'status ok') {
      return { imgid: Number(body.image?.imgid ?? body.imgid) || null }
    }
    const code = Number(body?.imgid)
    if (code === IMAGE_DUPLICATE) return { imgid: null, skipped: 'duplicate' }
    // Too small or unreadable will not get better on a retry — skip the image, not the rest.
    if (IMAGE_REJECTED.has(code)) return { imgid: null, skipped: body?.error ?? `rejected ${code}` }
    throw new OffRequestError(
      `uploading the photo failed: ${body?.error ?? `HTTP ${response.status}`}`
    )
  }

  /**
   * The instance's account plus the app attribution OFF asks for. `app_uuid` is a salted
   * per-supplier id, so OFF can moderate one contributor without banning the whole app.
   */
  private credentials(contribution: OffContribution): FormData {
    const { userId, password } = productImagesConfig.openFoodFacts
    const form = new FormData()
    form.set('code', contribution.barcode)
    form.set('user_id', userId)
    form.set('password', password)
    form.set('app_name', 'Fridgora')
    form.set('app_version', buildInfo.version)
    form.set('app_uuid', contributorUuid(contribution.userId))
    form.set('comment', 'Fridgora: shared by a supplier of an office snack shop')
    return form
  }

  private async request(path: string, init: RequestInit, timeoutMs: number): Promise<Response> {
    const { baseUrl } = productImagesConfig.openFoodFacts
    try {
      return await fetch(`${baseUrl}${path}`, {
        ...init,
        headers: offHeaders(baseUrl),
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (error) {
      throw new OffRequestError(`Open Food Facts unreachable: ${(error as Error).message}`)
    }
  }
}

/** Stable per supplier and instance, but says nothing about who they are. */
export function contributorUuid(userId: number | null): string {
  const hex = createHmac('sha256', env.get('APP_KEY'))
    .update(`off-contributor:${userId ?? 'system'}`)
    .digest('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}
