import type { HttpContext } from '@adonisjs/core/http'
import type { MultipartFile } from '@adonisjs/core/bodyparser'
import logger from '@adonisjs/core/services/logger'
import { readFile } from 'node:fs/promises'
import type Product from '#models/product'
import OffContribution from '#models/off_contribution'
import OffContributionService from '#services/product_images/off_contribution_service'
import type { BackgroundMode } from '#services/product_images/product_image_service'
import { resolvePage } from '#helpers/pagination'
import ProductService from '#services/product_service'
import { createProductValidator, updateProductValidator } from '#validators/product'
import AuditService from '#services/audit_service'
import { normalizeImagePath } from '#helpers/image_url'
import { isUniqueViolation } from '#services/unique_violation'
import ProductImageService from '#services/product_images/product_image_service'
import ProductSuggestionService from '#services/product_ai/product_suggestion_service'

export default class ProductsController {
  async index({ inertia, request }: HttpContext) {
    const service = new ProductService()
    const page = resolvePage(request.input('page', 1))
    const search = request.input('search')
    const categoryId = request.input('categoryId')

    const [paginator, categories] = await Promise.all([
      service.getProductsPaginated(page, 20, {
        search: search || undefined,
        categoryId: categoryId ? Number(categoryId) : undefined,
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
        })),
        meta: paginator.getMeta(),
      },
      categories: categories.map((c) => ({ id: c.id, name: c.name, color: c.color })),
      filters: { search: search || '', categoryId: categoryId || '' },
    })
  }

  async create({ inertia }: HttpContext) {
    const service = new ProductService()
    const [categories, allergens] = await Promise.all([
      service.getCategories(),
      service.getAllergens(),
    ])

    return inertia.render('supplier/products/create', {
      categories: categories.map((c) => ({ id: c.id, name: c.name, color: c.color })),
      allergens: allergens.map((a) => ({ id: a.id, name: a.name })),
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
      })
    } catch (err) {
      if (isUniqueViolation(err, 'barcode')) {
        session.flash('alert', { type: 'danger', message: i18n.t('messages.barcode_taken') })
        return response.redirect().back()
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

    return response.redirect(`/supplier/stock?preselect=${product.id}`)
  }

  async edit({ params, inertia }: HttpContext) {
    const service = new ProductService()
    const [product, categories, allergens] = await Promise.all([
      service.getProduct(params.id),
      service.getCategories(),
      service.getAllergens(),
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
      })
    } catch (err) {
      if (isUniqueViolation(err, 'barcode')) {
        session.flash('alert', { type: 'danger', message: i18n.t('messages.barcode_taken') })
        return response.redirect().back()
      }
      throw err
    }

    await product.load('category')
    await product.load('allergens')

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

    return response.redirect('/supplier/stock')
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
