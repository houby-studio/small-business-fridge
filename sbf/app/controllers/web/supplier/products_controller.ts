import type { HttpContext } from '@adonisjs/core/http'
import ProductService from '#services/product_service'
import { createProductValidator, updateProductValidator } from '#validators/product'
import AuditService from '#services/audit_service'

export default class ProductsController {
  async index({ inertia }: HttpContext) {
    const service = new ProductService()
    const products = await service.getAllProducts()

    return inertia.render('supplier/products/index', {
      products: products.map((p) => ({
        id: p.id,
        keypadId: p.keypadId,
        displayName: p.displayName,
        imagePath: p.imagePath,
        barcode: p.barcode,
        category: p.category ? { id: p.category.id, name: p.category.name, color: p.category.color } : null,
      })),
    })
  }

  async create({ inertia }: HttpContext) {
    const service = new ProductService()
    const categories = await service.getCategories()

    return inertia.render('supplier/products/create', {
      categories: categories.map((c) => ({ id: c.id, name: c.name, color: c.color })),
    })
  }

  async store({ request, response, session, i18n, auth }: HttpContext) {
    const data = await request.validateUsing(createProductValidator)

    const service = new ProductService()
    const product = await service.createProduct({
      displayName: data.displayName,
      description: data.description,
      categoryId: data.categoryId,
      barcode: data.barcode,
      image: data.image,
    })

    AuditService.log(auth.user!.id, 'product.created', 'product', product.id, null, {
      name: product.displayName,
    })

    session.flash('alert', {
      type: 'success',
      message: i18n.t('messages.product_created', { name: product.displayName }),
    })

    return response.redirect('/supplier/stock')
  }

  async edit({ params, inertia }: HttpContext) {
    const service = new ProductService()
    const [product, categories] = await Promise.all([
      service.getProduct(params.id),
      service.getCategories(),
    ])

    return inertia.render('supplier/products/edit', {
      product: {
        id: product.id,
        keypadId: product.keypadId,
        displayName: product.displayName,
        description: product.description,
        imagePath: product.imagePath,
        barcode: product.barcode,
        categoryId: product.categoryId,
        category: product.category
          ? { id: product.category.id, name: product.category.name }
          : null,
      },
      categories: categories.map((c) => ({ id: c.id, name: c.name, color: c.color })),
    })
  }

  async update({ params, request, response, session, i18n, auth }: HttpContext) {
    const data = await request.validateUsing(updateProductValidator)

    const service = new ProductService()
    const product = await service.updateProduct(params.id, {
      displayName: data.displayName,
      description: data.description,
      categoryId: data.categoryId,
      barcode: data.barcode,
      image: data.image,
    })

    AuditService.log(auth.user!.id, 'product.updated', 'product', product.id, null, {
      name: product.displayName,
    })

    session.flash('alert', {
      type: 'success',
      message: i18n.t('messages.product_updated', { name: product.displayName }),
    })

    return response.redirect('/supplier/stock')
  }
}
