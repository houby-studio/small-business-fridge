import type { HttpContext } from '@adonisjs/core/http'
import logger from '@adonisjs/core/services/logger'
import Product from '#models/product'
import ProductGroup from '#models/product_group'
import User from '#models/user'
import StockDraftService, {
  StockDraftNeedsConfirmation,
  draftVersion,
} from '#services/shopping/stock_draft_service'
import type { StockDraftErrorCode } from '#services/shopping/stock_draft_service'
import { isDomainError } from '#services/domain_error'
import { positiveInt } from '#helpers/query_params'
import { stockDraftStoreValidator, stockDraftValidator } from '#validators/shopping'
import { voidDeliveryValidator } from '#validators/delivery'

const ERROR_MESSAGES: Record<StockDraftErrorCode, string> = {
  DRAFT_NOT_FOUND: 'messages.stock_draft_not_found',
  DRAFT_CLOSED: 'messages.stock_draft_closed',
  DRAFT_EMPTY: 'messages.stock_draft_empty',
  DRAFT_INCOMPLETE: 'messages.stock_draft_incomplete',
  DRAFT_STALE: 'messages.stock_draft_stale',
  PRODUCT_NOT_FOUND: 'messages.stock_draft_product_not_found',
  GROUP_NOT_FOUND: 'messages.product_group_not_found',
  DRAFT_NOT_COMMITTED: 'messages.stock_draft_not_committed',
  DRAFT_VOIDED: 'messages.stock_draft_already_voided',
  DRAFT_HAS_SALES: 'messages.stock_draft_has_sales',
  DRAFT_TRANSFERRED: 'messages.stock_draft_transferred',
}

/**
 * Stocking drafts ("příjemky") — the one place stock is added on the web. A draft is
 * started by hand, by an AI assistant from a receipt or by the shopping list, reviewed
 * line by line and stocked at once.
 */
export default class StockDraftsController {
  /** Open drafts on top; below them the drafts stocked in the last 30 days, paginated. */
  /**
   * The old "Naskladnění" page is gone — a supplier has one open draft at most, and the stocked
   * ones live in Sklad › Historie › Příjemky. Bookmarks land on the open draft, or the stock.
   */
  async index({ auth, response }: HttpContext) {
    const [open] = await new StockDraftService().listOpen(auth.user!.id)
    return response.redirect(open ? `/supplier/stock/drafts/${open.id}` : '/supplier/stock')
  }

  /**
   * "Stock" opens the supplier's current draft (see `findOrCreateOpenDraft`); with a
   * `productId` it first adds that product — or finds its line — and focuses it.
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
      const draft = await service.findOrCreateOpenDraft(user.id)
      return response.redirect(`/supplier/stock/drafts/${draft.id}`)
    } catch (error) {
      this.flashError(error, session, i18n)
      return response.redirect('back', true)
    }
  }

  async show({ params, request, inertia, auth, response, session, i18n }: HttpContext) {
    const user = auth.user!
    let draft
    try {
      draft = await new StockDraftService().get(user, Number(params.id))
    } catch (error) {
      this.flashError(error, session, i18n)
      return response.redirect('/supplier/stock')
    }

    const service = new StockDraftService()
    // The owner's margin: an admin reviewing a supplier's draft sees the prices it will get.
    const owner = draft.supplierId === user.id ? user : await User.findOrFail(draft.supplierId)
    const focus = positiveInt(request.input('focus'))

    return inertia.render('supplier/stock_drafts/show', {
      draft: {
        id: draft.id,
        source: draft.source,
        note: draft.note,
        status: draft.status,
        createdAt: draft.createdAt.toISO(),
        updatedAt: draft.updatedAt.toISO(),
        committedAt: draft.committedAt?.toISO() ?? null,
        voidedAt: draft.voidedAt?.toISO() ?? null,
        voidReason: draft.voidReason,
        /** A stocked draft nothing was sold from yet can still be voided as a whole. */
        canVoid: draft.status === 'committed' && (await service.canVoid(draft.id)),
        /** Sent back with every save; a save over a newer draft is refused. */
        version: draftVersion(draft),
        items: draft.items.map((item) => ({
          id: item.id,
          productId: item.productId,
          productGroupId: item.productGroupId,
          label: item.label,
          amount: item.amount,
          purchasePrice: item.purchasePrice,
          purchasePriceEstimated: item.purchasePriceEstimated,
          source: item.source,
          price: item.price,
          deliveryId: item.deliveryId,
        })),
      },
      // Functions, so the autosave's partial reload (`only: ['draft']`) skips the catalogue.
      products: async () => {
        const [products, lastPrices] = await Promise.all([
          // Archived products are not offered — unless a line of this draft already has one.
          Product.query()
            .where((query) => {
              query.whereNull('archivedAt')
              const onLines = draft.items.map((item) => item.productId).filter(Boolean)
              if (onLines.length) query.orWhereIn('id', onLines as number[])
            })
            .orderBy('displayName', 'asc')
            .select('id', 'displayName', 'productGroupId'),
          service.lastPrices(draft.supplierId),
        ])
        return products.map((p) => ({
          id: p.id,
          displayName: p.displayName,
          productGroupId: p.productGroupId,
          lastPrice: lastPrices.get(p.id)?.price ?? null,
          lastPurchasePrice: lastPrices.get(p.id)?.purchasePrice ?? null,
        }))
      },
      groups: async () => {
        const groups = await ProductGroup.query().orderBy('name', 'asc')
        return groups.map((g) => ({ id: g.id, name: g.name }))
      },
      marginPercent: Number(owner.marginPercent ?? 0),
      /** The line "Stock this product" just appended (or found) — the form focuses it. */
      focusItemId: focus ?? null,
    })
  }

  /**
   * The page saves on every change, so a successful save is silent — the footer says so. A
   * refused one flashes `draftSaveError` with its code besides the alert: to Inertia the
   * redirect is a success, and the page must not report "Saved" (or leave) after it.
   */
  async update({ params, request, response, auth, session, i18n }: HttpContext) {
    const data = await request.validateUsing(stockDraftValidator)
    // The review page autosaves with a plain JSON request (`X-Draft-Autosave`), outside the
    // Inertia router: a failed save must never swap the page for an error page or modal.
    const autosave = request.header('x-draft-autosave') === '1'
    try {
      const draft = await new StockDraftService().update(auth.user!, Number(params.id), data)
      if (autosave) {
        return response.json({ version: draftVersion(draft), lines: draft.items.length })
      }
    } catch (error) {
      this.flashError(error, session, i18n)
      if (autosave && isDomainError(error)) {
        // The alert is flashed for the reload the page does next.
        return response.status(409).json({ error: error.code })
      }
    }
    return response.redirect('back', true)
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
        return response.redirect('back', true)
      }
      this.flashError(error, session, i18n)
      return response.redirect('back', true)
    }
  }

  /** Voids a stocked draft as a whole — every lot, one reason (see `voidStocked`). */
  async void(ctx: HttpContext) {
    const { params, request, response, auth, session, i18n } = ctx
    const { reason } = await request.validateUsing(voidDeliveryValidator)
    try {
      const { voidedDeliveries } = await new StockDraftService().voidStocked(
        auth.user!,
        Number(params.id),
        reason,
        { impersonatorId: ctx.impersonator?.id }
      )
      session.flash('alert', {
        type: 'success',
        message: i18n.t('messages.stock_draft_voided', { count: voidedDeliveries }),
      })
    } catch (error) {
      this.flashError(error, session, i18n)
    }
    return response.redirect('back', true)
  }

  async destroy({ params, response, auth, session, i18n }: HttpContext) {
    try {
      await new StockDraftService().discard(auth.user!, Number(params.id))
      session.flash('alert', { type: 'success', message: i18n.t('messages.stock_draft_discarded') })
    } catch (error) {
      this.flashError(error, session, i18n)
    }
    return response.redirect('/supplier/stock')
  }

  private flashError(error: unknown, session: HttpContext['session'], i18n: HttpContext['i18n']) {
    if (!isDomainError<StockDraftErrorCode>(error)) throw error
    const key = ERROR_MESSAGES[error.code] ?? 'messages.stock_draft_action_failed'
    // A refusal nobody mapped yet (a new rule in a service underneath) is still a refusal,
    // not a crash: the supplier gets a plain message, the log gets the code.
    if (!ERROR_MESSAGES[error.code]) {
      logger.warn({ code: error.code }, 'Unmapped domain error on a stocking draft')
    }
    // A newer version is no failure of the supplier's: the page reloads it and says so.
    session.flash('alert', {
      type: error.code === 'DRAFT_STALE' ? 'warn' : 'danger',
      message: i18n.t(key),
    })
    session.flash('draftSaveError', error.code)
  }
}
