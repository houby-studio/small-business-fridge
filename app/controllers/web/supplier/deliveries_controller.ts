import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'
import { resolvePage } from '#helpers/pagination'
import { listRedirectUrl } from '#helpers/list_redirect'
import DeliveryService, { type StockScope } from '#services/delivery_service'
import type { DeliveryCorrectionErrorCode } from '#services/delivery_service'
import StockHistoryService, { ADJUSTMENT_REASONS } from '#services/stock_history_service'
import { isDomainError } from '#services/domain_error'
import StockDraftService from '#services/shopping/stock_draft_service'
import { correctDeliveryValidator, voidDeliveryValidator } from '#validators/delivery'
import { normalizeImagePath } from '#helpers/image_url'
import { positiveInt } from '#helpers/query_params'
import type { StockAdjustmentReason } from '#models/stock_adjustment'

const CORRECTION_ERROR_MESSAGES: Record<DeliveryCorrectionErrorCode, string> = {
  DELIVERY_NOT_FOUND: 'messages.delivery_correction_not_found',
  FORBIDDEN: 'messages.delivery_correction_forbidden',
  DELIVERY_VOIDED: 'messages.delivery_correction_voided',
  AMOUNT_BELOW_SOLD: 'messages.delivery_correction_amount_below_sold',
  AMOUNT_INCREASE_NOT_ALLOWED: 'messages.delivery_correction_amount_increase',
  NO_CHANGE: 'messages.delivery_correction_no_change',
  DELIVERY_HAS_ORDERS: 'messages.delivery_void_has_orders',
  DELIVERY_HAS_ADJUSTMENTS: 'messages.delivery_void_has_adjustments',
  DELIVERY_TRANSFERRED: 'messages.delivery_void_transferred',
}

type HistoryType = 'deliveries' | 'adjustments' | 'drafts'

const PER_PAGE = 20

/**
 * Sklad › Historie: deliveries (with their corrections) or write-offs and inventory
 * differences. Only the table that is shown is loaded; the other comes back empty.
 */
export default class DeliveriesController {
  async index({ inertia, auth, request }: HttpContext) {
    const service = new DeliveryService()
    const user = auth.user!
    const page = resolvePage(request.input('page', 1))
    const productId = positiveInt(request.input('productId'))
    const sortBy = request.input('sortBy')
    const sortOrder = request.input('sortOrder')
    const scope: StockScope = request.input('scope') === 'mine' ? 'mine' : 'all'
    const typeInput = request.input('type')
    const type: HistoryType =
      typeInput === 'adjustments' || typeInput === 'drafts' ? typeInput : 'deliveries'
    const reasonInput = request.input('reason')
    const reason = ADJUSTMENT_REASONS.find((r) => r === reasonInput) as
      | StockAdjustmentReason
      | undefined
    const listFilters = {
      productId,
      sortBy: sortBy || undefined,
      sortOrder: sortOrder || undefined,
      scope,
    }
    const empty = { data: [], meta: { total: 0, perPage: PER_PAGE, currentPage: 1, lastPage: 1 } }

    const [products, recentDeliveries, adjustments, drafts] = await Promise.all([
      service.getAllProducts(),
      type === 'deliveries'
        ? service.getRecentDeliveries(user.id, page, PER_PAGE, listFilters)
        : null,
      type === 'adjustments'
        ? new StockHistoryService().listAdjustments(user, page, PER_PAGE, {
            ...listFilters,
            reason,
          })
        : empty,
      // Stocked drafts (příjemky): a colleague's purchase totals stay hidden.
      type === 'drafts'
        ? new StockDraftService().listHistory(user, page, PER_PAGE, listFilters)
        : empty,
    ])

    const deliveryIds = recentDeliveries?.all().map((d) => d.id) ?? []
    const [orderStats, draftRows] = await Promise.all([
      service.getOrderStatsForDeliveries(deliveryIds),
      // The draft a lot was stocked from — linked only for whoever may open it.
      deliveryIds.length
        ? db
            .from('stock_draft_items')
            .join('stock_drafts', 'stock_drafts.id', 'stock_draft_items.stock_draft_id')
            .whereIn('stock_draft_items.delivery_id', deliveryIds)
            .if(user.role !== 'admin', (q) => q.where('stock_drafts.supplier_id', user.id))
            .select('stock_draft_items.delivery_id', 'stock_draft_items.stock_draft_id')
        : [],
    ])
    const draftByDelivery = new Map(
      draftRows.map((row) => [Number(row.delivery_id), Number(row.stock_draft_id)])
    )

    return inertia.render('supplier/deliveries/index', {
      products: products.map((p) => ({
        id: p.id,
        displayName: p.displayName,
        imagePath: normalizeImagePath(p.imagePath),
        category: p.category ? { name: p.category.name, color: p.category.color } : null,
      })),
      recentDeliveries: recentDeliveries
        ? {
            meta: recentDeliveries.serialize().meta,
            data: recentDeliveries.all().map((d) => {
              const stats = orderStats.get(d.id)
              // A handover is shown on its own line, not as a correction.
              const corrections = d.corrections.filter((c) => c.kind !== 'transfer')
              const lastCorrection = corrections[0]
              const handover = d.corrections.find((c) => c.kind === 'transfer')
              const handedTo = d.transferredTo[0]
              return {
                id: d.id,
                createdAt: d.createdAt.toISO(),
                amountSupplied: d.amountSupplied,
                amountLeft: d.amountLeft,
                price: d.price,
                // A colleague's purchase price is their private cost.
                purchasePrice: DeliveryService.canSeePurchasePrice(user, d.supplierId)
                  ? d.purchasePrice
                  : null,
                lostCount: d.amountLost,
                voidedAt: d.voidedAt?.toISO() ?? null,
                product: {
                  displayName: d.product?.displayName ?? '—',
                  category: d.product?.category ? { name: d.product.category.name } : undefined,
                },
                supplierName: d.supplier?.displayName ?? '—',
                // What is gone from the lot: sold, plus written off — a correction may not go below
                // it. Pieces an inventory found make the lot grow, never a negative count.
                soldCount: Math.max(0, d.amountSupplied - d.amountLeft),
                invoicedCount: stats?.invoicedCount ?? 0,
                uninvoicedCount: stats?.uninvoicedCount ?? 0,
                uninvoicedBuyerCount: stats?.uninvoicedBuyerCount ?? 0,
                correctionCount: corrections.length,
                stockDraftId: draftByDelivery.get(d.id) ?? null,
                transfer: handover
                  ? handedTo
                    ? {
                        direction: 'out' as const,
                        counterpart: handedTo.supplier?.displayName ?? '—',
                        // What the new lot got — found pieces included.
                        pieces:
                          handedTo.corrections[0]?.newAmountSupplied ?? handedTo.amountSupplied,
                        at: handover.createdAt.toISO(),
                      }
                    : {
                        direction: 'in' as const,
                        counterpart: d.transferredFrom?.supplier?.displayName ?? '—',
                        pieces: handover.newAmountSupplied,
                        at: handover.createdAt.toISO(),
                      }
                  : null,
                lastCorrection: lastCorrection
                  ? {
                      kind: lastCorrection.kind,
                      reason: lastCorrection.reason,
                      oldPrice: lastCorrection.oldPrice,
                      newPrice: lastCorrection.newPrice,
                      createdAt: lastCorrection.createdAt.toISO(),
                    }
                  : null,
                canCorrect: user.isAdmin || d.supplierId === user.id,
              }
            }),
          }
        : empty,
      adjustments,
      drafts,
      filters: {
        productId: productId ? String(productId) : '',
        sortBy: sortBy || '',
        sortOrder: sortOrder || '',
        scope,
        type,
        reason: reason ?? '',
      },
    })
  }

  async update(ctx: HttpContext) {
    const { params, request, response, auth, session, i18n } = ctx
    const data = await request.validateUsing(correctDeliveryValidator)

    try {
      // The service sends the buyer and supplier e-mails (`DeliveryService.notifyCorrection`).
      const { correction } = await new DeliveryService().correctDelivery(
        auth.user!,
        Number(params.id),
        data,
        { impersonatorId: ctx.impersonator?.id }
      )

      session.flash('alert', {
        type: 'success',
        message:
          correction.repricedOrderCount > 0
            ? i18n.t('messages.delivery_corrected_repriced', {
                count: correction.repricedOrderCount,
              })
            : i18n.t('messages.delivery_corrected'),
      })
    } catch (error) {
      this.flashCorrectionError(error, session, i18n)
    }

    return response.redirect(listRedirectUrl(request, '/supplier/deliveries'))
  }

  async destroy(ctx: HttpContext) {
    const { params, request, response, auth, session, i18n } = ctx
    const data = await request.validateUsing(voidDeliveryValidator)

    try {
      await new DeliveryService().voidDelivery(auth.user!, Number(params.id), data.reason, {
        impersonatorId: ctx.impersonator?.id,
      })
      session.flash('alert', { type: 'success', message: i18n.t('messages.delivery_voided') })
    } catch (error) {
      this.flashCorrectionError(error, session, i18n)
    }

    return response.redirect(listRedirectUrl(request, '/supplier/deliveries'))
  }

  private flashCorrectionError(
    error: unknown,
    session: HttpContext['session'],
    i18n: HttpContext['i18n']
  ) {
    if (!isDomainError<DeliveryCorrectionErrorCode>(error)) throw error
    const key = CORRECTION_ERROR_MESSAGES[error.code]
    if (!key) throw error
    session.flash('alert', { type: 'danger', message: i18n.t(key) })
  }
}
