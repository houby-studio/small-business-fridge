import type { HttpContext } from '@adonisjs/core/http'
import Product from '#models/product'
import ProductGroup from '#models/product_group'
import DeliveryService from '#services/delivery_service'
import StockDraftService, {
  StockDraftNeedsConfirmation,
} from '#services/shopping/stock_draft_service'
import type { StockDraftErrorCode } from '#services/shopping/stock_draft_service'
import { isDomainError } from '#services/domain_error'
import { stockDraftStoreValidator, stockDraftValidator } from '#validators/shopping'

const ERROR_MESSAGES: Record<StockDraftErrorCode, string> = {
  DRAFT_NOT_FOUND: 'messages.stock_draft_not_found',
  DRAFT_CLOSED: 'messages.stock_draft_closed',
  DRAFT_EMPTY: 'messages.stock_draft_empty',
  DRAFT_INCOMPLETE: 'messages.stock_draft_incomplete',
  PRODUCT_NOT_FOUND: 'messages.stock_draft_product_not_found',
}

/**
 * Stocking drafts ("příjemky") — the one place stock is added on the web. A draft is
 * started by hand, by an AI assistant from a receipt or by the shopping list, reviewed
 * line by line and stocked at once.
 */
export default class StockDraftsController {
  async index({ inertia, auth }: HttpContext) {
    const drafts = await new StockDraftService().listOpen(auth.user!.id)
    return inertia.render('supplier/stock_drafts/index', { drafts })
  }

  /**
   * "Stock" opens the supplier's current web draft (creating one only when there is none);
   * with a `productId` it first appends a line for that product and focuses it.
   */
  async store({ request, response, auth, session, i18n }: HttpContext) {
    const { productId } = await request.validateUsing(stockDraftStoreValidator)
    const service = new StockDraftService()
    const user = auth.user!

    try {
      if (productId) {
        const { draft, item } = await service.appendProduct(user.id, productId)
        return response.redirect(`/supplier/stock/drafts/${draft.id}?focus=${item.id}`)
      }
      // Landing on the draft is the feedback — no toast for opening or creating it.
      const draft = await service.findOrCreateWebDraft(user.id)
      return response.redirect(`/supplier/stock/drafts/${draft.id}`)
    } catch (error) {
      this.flashError(error, session, i18n)
      return response.redirect().back()
    }
  }

  async show({ params, request, inertia, auth, response, session, i18n }: HttpContext) {
    const user = auth.user!
    let draft
    try {
      draft = await new StockDraftService().get(user, Number(params.id))
    } catch (error) {
      this.flashError(error, session, i18n)
      return response.redirect('/supplier/stock/drafts')
    }

    const [products, groups, lastPrices] = await Promise.all([
      Product.query().orderBy('displayName', 'asc').select('id', 'displayName', 'productGroupId'),
      ProductGroup.query().orderBy('name', 'asc'),
      new DeliveryService().getLastPrices(),
    ])
    const focus = Number(request.input('focus'))

    return inertia.render('supplier/stock_drafts/show', {
      draft: {
        id: draft.id,
        source: draft.source,
        note: draft.note,
        status: draft.status,
        createdAt: draft.createdAt.toISO(),
        committedAt: draft.committedAt?.toISO() ?? null,
        items: draft.items.map((item) => ({
          id: item.id,
          productId: item.productId,
          productGroupId: item.productGroupId,
          label: item.label,
          amount: item.amount,
          purchasePrice: item.purchasePrice,
          price: item.price,
          deliveryId: item.deliveryId,
        })),
      },
      products: products.map((p) => ({
        id: p.id,
        displayName: p.displayName,
        productGroupId: p.productGroupId,
        lastPrice: lastPrices.get(p.id)?.price ?? null,
        lastPurchasePrice: lastPrices.get(p.id)?.purchasePrice ?? null,
      })),
      groups: groups.map((g) => ({ id: g.id, name: g.name })),
      marginPercent: Number(user.marginPercent ?? 0),
      /** The line "Stock this product" just appended — the form focuses its amount. */
      focusItemId: Number.isInteger(focus) && focus > 0 ? focus : null,
    })
  }

  async update({ params, request, response, auth, session, i18n }: HttpContext) {
    const data = await request.validateUsing(stockDraftValidator)
    try {
      // The page saves on every change, so a successful save is silent — the footer says so.
      await new StockDraftService().update(auth.user!, Number(params.id), data)
    } catch (error) {
      this.flashError(error, session, i18n)
    }
    return response.redirect().back()
  }

  async commit({ params, request, response, auth, session, i18n }: HttpContext) {
    const data = await request.validateUsing(stockDraftValidator)
    try {
      const { deliveries } = await new StockDraftService().commit(
        auth.user!,
        Number(params.id),
        data
      )
      session.flash('alert', {
        type: 'success',
        message: i18n.t('messages.stock_draft_committed', {
          count: deliveries.length,
          pieces: deliveries.reduce((sum, d) => sum + d.amountSupplied, 0),
        }),
      })
      return response.redirect('/supplier/stock')
    } catch (error) {
      if (error instanceof StockDraftNeedsConfirmation) {
        // The lines are saved; the page shows what to check and resubmits with
        // confirmWarnings once the supplier has looked at them.
        session.flash('draftWarnings', error.warnings)
        return response.redirect().back()
      }
      this.flashError(error, session, i18n)
      return response.redirect().back()
    }
  }

  async destroy({ params, response, auth, session, i18n }: HttpContext) {
    try {
      await new StockDraftService().discard(auth.user!, Number(params.id))
      session.flash('alert', { type: 'success', message: i18n.t('messages.stock_draft_discarded') })
    } catch (error) {
      this.flashError(error, session, i18n)
    }
    return response.redirect('/supplier/stock/drafts')
  }

  private flashError(error: unknown, session: HttpContext['session'], i18n: HttpContext['i18n']) {
    if (!isDomainError<StockDraftErrorCode>(error)) throw error
    const key = ERROR_MESSAGES[error.code]
    if (!key) throw error
    session.flash('alert', { type: 'danger', message: i18n.t(key) })
  }
}
