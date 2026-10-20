import type { HttpContext } from '@adonisjs/core/http'
import type { MultipartFile } from '@adonisjs/core/bodyparser'
import logger from '@adonisjs/core/services/logger'
import { readFile } from 'node:fs/promises'
import type Product from '#models/product'
import OffContribution from '#models/off_contribution'
import OffContributionService from '#services/product_images/off_contribution_service'
import type { BackgroundMode } from '#services/product_images/product_image_service'
import { resolvePage } from '#helpers/pagination'
import { positiveInt } from '#helpers/query_params'
import { listRedirectUrl } from '#helpers/list_redirect'
import ProductService, {
  PRODUCT_STATUS_FILTERS,
  type ArchiveError,
} from '#services/product_service'
import StockDraftService from '#services/shopping/stock_draft_service'
import { createProductValidator, updateProductValidator } from '#validators/product'
import AuditService from '#services/audit_service'
import { normalizeImagePath } from '#helpers/image_url'
import { isUniqueViolation } from '#services/unique_violation'
import { isDomainError } from '#services/domain_error'
import ProductImageService from '#services/product_images/product_image_service'
import ProductSuggestionService from '#services/product_ai/product_suggestion_service'

export default class ProductsController {
  async index({ inertia, request }: HttpContext) {
    const service = new ProductService()
    const page = resolvePage(request.input('page', 1))
    const search = request.input('search')
    const categoryId = positiveInt(request.input('categoryId'))
    const { sortBy, sortOrder } = ProductService.productSort({
      sortBy: request.input('sortBy'),
      sortOrder: request.input('sortOrder'),
    })
    const status =
      PRODUCT_STATUS_FILTERS.find((value) => value === request.input('status')) ?? 'active'
    const missingPhoto = request.input('photo') === 'missing'

    const [paginator, categories] = await Promise.all([
      service.getProductsPaginated(page, 20, {
        search: search || undefined,
        categoryId,
        sortBy,
        sortOrder,
        status,
        missingPhoto,
      }),
      service.getCategories(),
    ])

    return inertia.render('supplier/products/index', {
      products: {
        data: paginator.all().map((p) => ({
          id: p.id,
          keypadId: p.keypadId,
          displayName: p.displayName,
          imagePath: normalizeImagePath(p.imagePath),
          barcode: p.barcode,
          category: p.category
            ? { id: p.category.id, name: p.category.name, color: p.category.color }
            : null,
          allergens: p.allergens.map((a) => ({ id: a.id, name: a.name })),
          productGroup: p.productGroup
            ? { id: p.productGroup.id, name: p.productGroup.name }
            : null,
          archived: p.archivedAt !== null,
        })),
        meta: paginator.getMeta(),
      },
      categories: categories.map((c) => ({ id: c.id, name: c.name, color: c.color })),
      filters: {
        search: search || '',
        categoryId: categoryId ? String(categoryId) : '',
        sortBy,
        sortOrder,
        status,
        photo: missingPhoto ? 'missing' : '',
      },
    })
  }

  /** Archive a product nobody stocks any more (see ProductService.archive for the rules). */
  async archive({ params, auth, request, response, session, i18n }: HttpContext) {
    try {
      const product = await new ProductService().archive(auth.user!.id, Number(params.id))
      session.flash('alert', {
        type: 'success',
        message: i18n.t('messages.product_archived', { name: product.displayName }),
      })
    } catch (error) {
      if (!isDomainError<ArchiveError>(error)) throw error
      if (error.code === 'PRODUCT_NOT_FOUND') return response.notFound()
      session.flash('alert', {
        type: 'danger',
        message: i18n.t(
          error.code === 'PRODUCT_HAS_STOCK'
            ? 'messages.product_archive_has_stock'
            : 'messages.product_archive_in_draft'
        ),
      })
    }
    // Back to the list with its filters and page.
    return response.redirect(listRedirectUrl(request, '/supplier/products'))
  }

  async unarchive({ params, auth, request, response, session, i18n }: HttpContext) {
    try {
      const product = await new ProductService().unarchive(auth.user!.id, Number(params.id))
      session.flash('alert', {
        type: 'success',
        message: i18n.t('messages.product_unarchived', { name: product.displayName }),
      })
    } catch (error) {
      if (isDomainError<ArchiveError>(error, 'PRODUCT_NOT_FOUND')) return response.notFound()
      throw error
    }
    return response.redirect(listRedirectUrl(request, '/supplier/products'))
  }

  async create({ inertia, request }: HttpContext) {
    const service = new ProductService()
    const [categories, allergens, groups] = await Promise.all([
      service.getCategories(),
      service.getAllergens(),
      service.getProductGroups(),
    ])

    // Coming from a stocking draft line: remember where to return and prefill the line's text.
    // positiveInt: an id beyond the int4 range would otherwise reach PostgreSQL and 500.
    const draftId = positiveInt(request.input('draftId'))
    const lineIndex = Number(request.input('lineIndex'))
    const fromDraft = draftId
      ? {
          id: draftId,
          lineIndex: Number.isInteger(lineIndex) && lineIndex >= 0 ? lineIndex : null,
          name: String(request.input('name') ?? '').slice(0, 255),
          groupId: positiveInt(request.input('groupId')) ?? null,
        }
      : null

    return inertia.render('supplier/products/create', {
      fromDraft,
      categories: categories.map((c) => ({ id: c.id, name: c.name, color: c.color })),
      allergens: allergens.map((a) => ({ id: a.id, name: a.name })),
      productGroups: groups.map((g) => ({ id: g.id, name: g.name, categoryId: g.categoryId })),
      imageCapabilities: ProductImageService.capabilities(),
      aiSuggestions: ProductSuggestionService.isAiAvailable(),
    })
  }

  async store({ request, response, session, i18n, auth }: HttpContext) {
    const data = await request.validateUsing(createProductValidator)

    const service = new ProductService()
    let product: Awaited<ReturnType<ProductService['createProduct']>>
    try {
      product = await service.createProduct({
        displayName: data.displayName,
        description: data.description,
        categoryId: data.categoryId,
        barcode: data.barcode,
        image: data.image,
        allergenIds: data.allergenIds,
        productGroupId: data.productGroupId,
      })
    } catch (err) {
      if (isUniqueViolation(err, 'barcode')) {
        session.flash('alert', { type: 'danger', message: i18n.t('messages.barcode_taken') })
        return response.redirect('back', true)
      }
      throw err
    }

    await AuditService.log(auth.user!.id, 'product.created', 'product', product.id, null, {
      name: product.displayName,
    })
    if (data.offContribute) await this.shareWithOff(product, auth.user!.id, data)

    session.flash('alert', {
      type: 'success',
      message: i18n.t('messages.product_created', { name: product.displayName }),
    })

    // Straight on to stocking it: back to the draft line the supplier came from, or onto
    // their manual draft.
    const drafts = new StockDraftService()
    const draftId = positiveInt(request.input('draftId'))
    if (draftId) {
      const lineIndex = Number(request.input('lineIndex'))
      try {
        const { draft, item } = await drafts.setLineProduct(
          auth.user!,
          draftId,
          Number.isInteger(lineIndex) && lineIndex >= 0 ? lineIndex : Number.MAX_SAFE_INTEGER,
          product.id
        )
        return response.redirect(`/supplier/stock/drafts/${draft.id}?focus=${item.id}`)
      } catch (error) {
        if (!isDomainError(error)) throw error
        // The draft is gone or closed meanwhile — fall through to the manual draft.
      }
    }
    const { draft, item } = await drafts.appendProduct(auth.user!.id, product.id)
    return response.redirect(`/supplier/stock/drafts/${draft.id}?focus=${item.id}`)
  }

  async edit({ params, inertia }: HttpContext) {
    const service = new ProductService()
    const [product, categories, allergens, groups] = await Promise.all([
      service.getProduct(params.id),
      service.getCategories(),
      service.getAllergens(),
      service.getProductGroups(),
    ])

    return inertia.render('supplier/products/edit', {
      product: {
        id: product.id,
        keypadId: product.keypadId,
        displayName: product.displayName,
        description: product.description,
        imagePath: normalizeImagePath(product.imagePath),
        barcode: product.barcode,
        categoryId: product.categoryId,
        category: product.category
          ? { id: product.category.id, name: product.category.name }
          : null,
        allergenIds: product.allergens.map((a) => a.id),
        productGroupId: product.productGroupId,
        // Name and EAN go to Open Food Facts once; after that only a new own photo is offered.
        offShared: product.barcode
          ? !!(await OffContribution.query()
              .where('barcode', product.barcode)
              .whereIn('status', ['pending', 'done'])
              .first())
          : false,
      },
      categories: categories.map((c) => ({ id: c.id, name: c.name, color: c.color })),
      allergens: allergens.map((a) => ({ id: a.id, name: a.name })),
      productGroups: groups.map((g) => ({ id: g.id, name: g.name, categoryId: g.categoryId })),
      imageCapabilities: ProductImageService.capabilities(),
      aiSuggestions: ProductSuggestionService.isAiAvailable(),
    })
  }

  async update({ params, request, response, session, i18n, auth }: HttpContext) {
    const data = await request.validateUsing(updateProductValidator)

    const service = new ProductService()
    const beforeProduct = await service.getProduct(Number(params.id))

    let product: Awaited<ReturnType<ProductService['updateProduct']>>
    try {
      product = await service.updateProduct(Number(params.id), {
        displayName: data.displayName,
        description: data.description,
        categoryId: data.categoryId,
        barcode: data.barcode,
        image: data.image,
        allergenIds: data.allergenIds,
        productGroupId: data.productGroupId,
      })
    } catch (err) {
      if (isUniqueViolation(err, 'barcode')) {
        session.flash('alert', { type: 'danger', message: i18n.t('messages.barcode_taken') })
        return response.redirect('back', true)
      }
      throw err
    }

    await product.load('category')
    await product.load('allergens')
    await product.load('productGroup')

    const changes = ProductService.auditChanges(beforeProduct, product)

    await AuditService.log(
      auth.user!.id,
      'product.updated',
      'product',
      product.id,
      null,
      Object.keys(changes).length ? changes : null
    )
    if (data.offContribute) await this.shareWithOff(product, auth.user!.id, data)

    session.flash('alert', {
      type: 'success',
      message: i18n.t('messages.product_updated', { name: product.displayName }),
    })

    return response.redirect('/supplier/products')
  }

  /**
   * Queues what the supplier agreed to send to Open Food Facts. The product is saved by
   * now, so a failure here is logged, never shown as a failed save.
   */
  private async shareWithOff(
    product: Product,
    userId: number,
    data: { offOriginal?: MultipartFile; offBackground?: BackgroundMode }
  ) {
    try {
      const file = data.offOriginal
      const original = file?.tmpPath
        ? { data: await readFile(file.tmpPath), mime: `${file.type}/${file.subtype}` }
        : null
      await new OffContributionService().queue({
        product,
        userId,
        original,
        background: data.offBackground,
      })
    } catch (err) {
      logger.error({ err, productId: product.id }, 'Failed to queue Open Food Facts contribution')
    }
  }
}
