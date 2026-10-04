import type { HttpContext } from '@adonisjs/core/http'
import Category from '#models/category'
import { resolvePage } from '#helpers/pagination'
import type { InventoryScope } from '#models/inventory_count'
import InventoryService from '#services/inventory_service'
import type { InventoryErrorCode } from '#services/inventory_service'
import { isDomainError } from '#services/domain_error'
import {
  inventoryCountValidator,
  reclassifyLossValidator,
  writeOffValidator,
} from '#validators/inventory'

const ERROR_MESSAGES: Record<InventoryErrorCode, string> = {
  PRODUCT_NOT_FOUND: 'messages.inventory_product_not_found',
  NOT_ENOUGH_STOCK: 'messages.inventory_not_enough_stock',
  NOTHING_COUNTED: 'messages.inventory_nothing_counted',
  NOTHING_TO_CLASSIFY: 'messages.inventory_nothing_to_classify',
  FORBIDDEN: 'messages.forbidden',
}

/** Inventories and write-offs — where shrinkage gets recorded. */
export default class InventoryController {
  async index({ inertia, auth, request }: HttpContext) {
    const user = auth.user!
    const scope: InventoryScope = request.input('scope') === 'all' ? 'all' : 'mine'
    const categoryId = request.input('categoryId') ? Number(request.input('categoryId')) : undefined
    // Past inventories: the user's own by default, everyone's on request.
    const who: 'mine' | 'all' = request.input('who') === 'all' ? 'all' : 'mine'
    const page = resolvePage(request.input('page', 1))
    const service = new InventoryService()

    const [products, categories, counts] = await Promise.all([
      service.getCountableProducts(user, scope, categoryId),
      Category.query().where('isDisabled', false).orderBy('name', 'asc'),
      service.listCounts(page, 10, { actorId: who === 'mine' ? user.id : undefined }),
    ])

    return inertia.render('supplier/inventory/index', {
      products,
      categories: categories.map((c) => ({ id: c.id, name: c.name, color: c.color })),
      counts,
      filters: { scope, categoryId: categoryId ? String(categoryId) : '', who },
    })
  }

  async store(ctx: HttpContext) {
    const { request, response, auth, session, i18n } = ctx
    const data = await request.validateUsing(inventoryCountValidator)
    try {
      const count = await new InventoryService().commitCount(auth.user!, data, {
        impersonatorId: ctx.impersonator?.id,
      })
      session.flash('alert', {
        type: 'success',
        message: i18n.t('messages.inventory_committed', { count: data.items.length }),
      })
      return response.redirect(`/supplier/inventory/${count.id}`)
    } catch (error) {
      this.flashError(error, session, i18n)
      return response.redirect().back()
    }
  }

  async show({ params, inertia }: HttpContext) {
    const count = await new InventoryService().getCount(Number(params.id))
    return inertia.render('supplier/inventory/show', {
      count: {
        id: count.id,
        createdAt: count.createdAt.toISO(),
        actorName: count.actor?.displayName ?? '—',
        scope: count.scope,
        note: count.note,
        items: count.items.map((item) => ({
          productId: item.productId,
          productName: item.product?.displayName ?? '—',
          expectedQty: item.expectedQty,
          countedQty: item.countedQty,
          appliedQty: item.appliedQty,
        })),
        adjustments: count.adjustments.map((a) => ({
          id: a.id,
          productId: a.productId,
          supplierName: a.supplier?.displayName ?? '—',
          kind: a.kind,
          reason: a.reason,
          quantity: a.quantity,
          unitCost: a.unitCost,
          unitPrice: a.unitPrice,
        })),
      },
    })
  }

  /** Gives the shortfall an inventory found on one product a reason. */
  async reclassify({ params, request, response, auth, session, i18n }: HttpContext) {
    const { reason } = await request.validateUsing(reclassifyLossValidator)
    try {
      const result = await new InventoryService().reclassifyCountLoss(
        auth.user!,
        Number(params.id),
        Number(params.productId),
        reason
      )
      session.flash('alert', {
        type: 'success',
        message: i18n.t('messages.inventory_reason_saved', {
          product: result.productName ?? '—',
          reason: i18n.t(`inventory.reason_${reason}`),
        }),
      })
    } catch (error) {
      this.flashError(error, session, i18n)
    }
    return response.redirect().back()
  }

  async writeOff(ctx: HttpContext) {
    const { request, response, auth, session, i18n } = ctx
    const data = await request.validateUsing(writeOffValidator)
    try {
      await new InventoryService().writeOff(auth.user!, data, {
        impersonatorId: ctx.impersonator?.id,
      })
      session.flash('alert', {
        type: 'success',
        message: i18n.t('messages.write_off_done', { quantity: data.quantity }),
      })
    } catch (error) {
      this.flashError(error, session, i18n)
    }
    return response.redirect().back()
  }

  private flashError(error: unknown, session: HttpContext['session'], i18n: HttpContext['i18n']) {
    if (!isDomainError<InventoryErrorCode>(error)) throw error
    session.flash('alert', { type: 'danger', message: i18n.t(ERROR_MESSAGES[error.code]) })
  }
}
