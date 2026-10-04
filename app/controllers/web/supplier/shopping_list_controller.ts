import type { HttpContext } from '@adonisjs/core/http'
import { DateTime } from 'luxon'
import Category from '#models/category'
import Product from '#models/product'
import { FRIDGE_TIMEZONE } from '#config/fridge'
import ShoppingListService from '#services/shopping/shopping_list_service'
import type { ShoppingListErrorCode } from '#services/shopping/shopping_list_service'
import { isDomainError } from '#services/domain_error'
import {
  shoppingLineCreateValidator,
  shoppingLineValidator,
  shoppingListSettingsValidator,
} from '#validators/shopping'

const ERROR_MESSAGES: Record<ShoppingListErrorCode, string> = {
  LINE_NOT_FOUND: 'messages.shopping_line_not_found',
  PRODUCT_NOT_FOUND: 'messages.shopping_line_not_found',
  GROUP_NOT_FOUND: 'messages.shopping_line_not_found',
  LIST_EMPTY: 'messages.shopping_list_empty',
}

export default class ShoppingListController {
  async index({ inertia, auth }: HttpContext) {
    const user = auth.user!
    const [list, categories, products] = await Promise.all([
      new ShoppingListService().getView(user),
      Category.query().where('isDisabled', false).orderBy('name', 'asc'),
      Product.query().orderBy('displayName', 'asc').select('id', 'displayName'),
    ])

    return inertia.render('supplier/shopping_list/index', {
      list,
      categories: categories.map((c) => ({ id: c.id, name: c.name, color: c.color })),
      products: products.map((p) => ({ id: p.id, displayName: p.displayName })),
    })
  }

  async updateSettings({ request, response, auth }: HttpContext) {
    const data = await request.validateUsing(shoppingListSettingsValidator)
    await new ShoppingListService().updateSettings(auth.user!.id, data)
    return response.redirect().back()
  }

  async addLine({ request, response, auth, session, i18n }: HttpContext) {
    const data = await request.validateUsing(shoppingLineCreateValidator)
    try {
      await new ShoppingListService().addLine(auth.user!.id, data)
    } catch (error) {
      this.flashError(error, session, i18n)
    }
    return response.redirect().back()
  }

  async updateLine({ params, request, response, auth, session, i18n }: HttpContext) {
    const data = await request.validateUsing(shoppingLineValidator)
    try {
      await new ShoppingListService().updateLine(auth.user!.id, String(params.key), data)
    } catch (error) {
      this.flashError(error, session, i18n)
    }
    return response.redirect().back()
  }

  async resetLine({ params, response, auth, session, i18n }: HttpContext) {
    try {
      await new ShoppingListService().resetLine(auth.user!.id, String(params.key))
    } catch (error) {
      this.flashError(error, session, i18n)
    }
    return response.redirect().back()
  }

  /**
   * Turns the list into a stocking draft — the lines ticked as bought, or all of them —
   * and starts a fresh list. The supplier then fixes what they really bought and stocks it.
   */
  async complete({ response, auth, session, i18n }: HttpContext) {
    const date = DateTime.now().setZone(FRIDGE_TIMEZONE).toFormat('d. M. yyyy')
    try {
      const { draft, lines } = await new ShoppingListService().completeIntoDraft(auth.user!, {
        note: i18n.t('shopping.draft_note_from_list', { date }),
        extrasNote: (items) => i18n.t('shopping.draft_note_extras', { items }),
      })
      session.flash('alert', {
        type: 'success',
        message: i18n.t('messages.shopping_list_completed', { count: lines }),
      })
      return response.redirect(`/supplier/stock/drafts/${draft.id}`)
    } catch (error) {
      if (!isDomainError<ShoppingListErrorCode>(error, 'LIST_EMPTY')) throw error
      session.flash('alert', { type: 'warn', message: i18n.t('messages.shopping_list_empty') })
      return response.redirect('/supplier/shopping-list')
    }
  }

  private flashError(error: unknown, session: HttpContext['session'], i18n: HttpContext['i18n']) {
    if (!isDomainError<ShoppingListErrorCode>(error)) throw error
    session.flash('alert', { type: 'danger', message: i18n.t(ERROR_MESSAGES[error.code]) })
  }
}
