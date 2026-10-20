import type { HttpContext } from '@adonisjs/core/http'
import Category from '#models/category'
import { resolvePage } from '#helpers/pagination'
import { positiveInt } from '#helpers/query_params'
import type { InventoryScope } from '#models/inventory_count'
import InventoryService from '#services/inventory_service'
import type { InventoryErrorCode } from '#services/inventory_service'
import { isDomainError } from '#services/domain_error'
import { roundMoney } from '#services/shopping/pricing'
import Delivery from '#models/delivery'
import { FRIDGE_TIMEZONE } from '#config/fridge'
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
  ADJUSTMENT_NOT_FOUND: 'messages.write_off_not_found',
  NOT_A_WRITE_OFF: 'messages.write_off_not_found',
  ALREADY_REVERTED: 'messages.write_off_already_reverted',
  REVERT_TOO_LATE: 'messages.write_off_revert_too_late',
  DELIVERY_VOIDED: 'messages.write_off_delivery_voided',
}

/** Inventories and write-offs — where shrinkage gets recorded. */
export default class InventoryController {
  async index({ inertia, auth, request }: HttpContext) {
    const user = auth.user!
    // The whole fridge by default, like the stock and its history.
    const scope: InventoryScope = request.input('scope') === 'mine' ? 'mine' : 'all'
    const categoryId = positiveInt(request.input('categoryId'))
    // Past inventories: the user's own by default, everyone's on request.
    const who: 'mine' | 'all' = request.input('who') === 'all' ? 'all' : 'mine'
    const page = resolvePage(request.input('page', 1))
    const service = new InventoryService()
    // When the sheet's stock was read: the client sends it back with every counted product,
    // so sales between loading the sheet and counting are not taken for shrinkage.
    const stockAsOf = new Date().toISOString()

    const [products, categories, counts] = await Promise.all([
      service.getCountableProducts(user, scope, categoryId),
      Category.query().where('isDisabled', false).orderBy('name', 'asc'),
      service.listCounts(page, 10, { actorId: who === 'mine' ? user.id : undefined }),
    ])

    return inertia.render('supplier/inventory/index', {
      products,
      stockAsOf,
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
      return response.redirect('back', true)
    }
  }

  async show({ params, inertia, auth }: HttpContext) {
    const viewer = auth.user!
    const count = await new InventoryService().getCount(Number(params.id))
    const sign = (kind: string) => (kind === 'loss' ? 1 : -1)
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
          sheetQty: item.sheetQty,
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
          // A colleague's purchase prices are theirs — admins see everything.
          unitCost: viewer.role === 'admin' || a.supplierId === viewer.id ? a.unitCost : null,
          unitPrice: a.unitPrice,
        })),
        lossValue: count.adjustments.reduce(
          (s, a) => s + sign(a.kind) * a.quantity * a.unitPrice,
          0
        ),
        lossCost: roundMoney(
          count.adjustments.reduce(
            (s, a) => s + sign(a.kind) * a.quantity * (a.unitCost ?? a.unitPrice),
            0
          )
        ),
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
    return response.redirect('back', true)
  }

  async writeOff(ctx: HttpContext) {
    const { request, response, auth, session, i18n } = ctx
    const { preview, ...data } = await request.validateUsing(writeOffValidator)
    try {
      const rows = await new InventoryService().writeOff(auth.user!, data, {
        impersonatorId: ctx.impersonator?.id,
      })
      // The dialog previewed which lots the pieces come off; a sale in the meantime can move
      // them — then say where they really came from.
      const key = (lots: Array<{ deliveryId: number; quantity: number }>) =>
        lots
          .map((lot) => `${lot.deliveryId}:${lot.quantity}`)
          .sort()
          .join(',')
      const actual = rows.map((row) => ({ deliveryId: row.deliveryId, quantity: row.quantity }))
      if (preview && key(preview) !== key(actual)) {
        const lots = await Delivery.query()
          .whereIn(
            'id',
            actual.map((lot) => lot.deliveryId)
          )
          .preload('supplier')
        const byId = new Map(lots.map((lot) => [lot.id, lot]))
        session.flash('alert', {
          type: 'warn',
          message: i18n.t('messages.write_off_done_from', {
            quantity: data.quantity,
            lots: actual
              .map((lot) => {
                const delivery = byId.get(lot.deliveryId)
                const date = delivery?.createdAt.setZone(FRIDGE_TIMEZONE).toFormat('d. M.') ?? ''
                return `${date} ${delivery?.supplier?.displayName ?? ''} ${lot.quantity} ${i18n.t('common.pieces')}`.trim()
              })
              .join(', '),
          }),
        })
      } else {
        session.flash('alert', {
          type: 'success',
          message: i18n.t('messages.write_off_done', { quantity: data.quantity }),
        })
      }
    } catch (error) {
      this.flashError(error, session, i18n)
    }
    return response.redirect('back', true)
  }

  /** Takes a mistaken write-off back onto its lot. */
  async revertWriteOff({ params, response, auth, session, i18n }: HttpContext) {
    try {
      const adjustment = await new InventoryService().revertWriteOff(auth.user!, Number(params.id))
      session.flash('alert', {
        type: 'success',
        message: i18n.t('messages.write_off_reverted', { quantity: adjustment.quantity }),
      })
    } catch (error) {
      this.flashError(error, session, i18n)
    }
    return response.redirect('back', true)
  }

  private flashError(error: unknown, session: HttpContext['session'], i18n: HttpContext['i18n']) {
    if (!isDomainError<InventoryErrorCode>(error)) throw error
    session.flash('alert', { type: 'danger', message: i18n.t(ERROR_MESSAGES[error.code]) })
  }
}
