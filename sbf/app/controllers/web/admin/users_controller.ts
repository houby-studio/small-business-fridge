import type { HttpContext, Request } from '@adonisjs/core/http'
import AdminService from '#services/admin_service'
import InvoiceService from '#services/invoice_service'
import User from '#models/user'
import { updateUserValidator } from '#validators/user'
import AuditService from '#services/audit_service'
import NotificationService from '#services/notification_service'
import logger from '@adonisjs/core/services/logger'

/**
 * Return the referer URL if it points to /admin/users (preserving search/role filters),
 * otherwise fall back to /admin/users without filters.
 */
function usersUrl(request: Request): string {
  const referer = request.header('referer') ?? ''
  try {
    const { pathname, search } = new URL(referer)
    if (pathname === '/admin/users') return pathname + search
  } catch {
    // invalid URL — use fallback
  }
  return '/admin/users'
}

export default class UsersController {
  async index({ inertia, request }: HttpContext) {
    const page = request.input('page', 1)
    const search = request.input('search')
    const role = request.input('role')

    const service = new AdminService()
    const paginator = await service.getUsers(page, 20, {
      search: search || undefined,
      role: role || undefined,
    })

    const users = paginator.all()
    const userIds = users.map((u) => u.id)

    const invoiceService = new InvoiceService()
    const [uninvoicedIds, unpaidIds] = await Promise.all([
      invoiceService.getUninvoicedBuyerIds(userIds),
      invoiceService.getUnpaidBuyerIds(userIds),
    ])

    return inertia.render('admin/users/index', {
      users: {
        data: users.map((u) => ({
          id: u.id,
          displayName: u.displayName,
          email: u.email,
          username: u.username,
          role: u.role,
          isKiosk: u.isKiosk,
          isDisabled: u.isDisabled,
          keypadId: u.keypadId,
          createdAt: u.createdAt.toISO(),
          hasUninvoicedOrders: uninvoicedIds.has(u.id),
          hasUnpaidInvoices: unpaidIds.has(u.id),
        })),
        meta: paginator.getMeta(),
      },
      filters: { search: search || '', role: role || '' },
    })
  }

  async update({ params, request, response, session, i18n, auth }: HttpContext) {
    const data = await request.validateUsing(updateUserValidator)

    const userBefore = await User.findOrFail(params.id)
    const before = {
      role: userBefore.role,
      isDisabled: userBefore.isDisabled,
      isKiosk: userBefore.isKiosk,
    }

    const service = new AdminService()

    let user: User
    try {
      user = await service.updateUser(params.id, data)
    } catch (err) {
      if (err instanceof Error && err.message === 'USER_HAS_UNINVOICED_ORDERS') {
        session.flash('alert', {
          type: 'error',
          message: i18n.t('messages.user_has_uninvoiced_orders'),
        })
        return response.redirect(usersUrl(request))
      }
      throw err
    }

    const changes: Record<string, { from: unknown; to: unknown }> = {}
    for (const key of ['role', 'isDisabled', 'isKiosk'] as const) {
      if (data[key] !== undefined && before[key] !== data[key]) {
        changes[key] = { from: before[key], to: data[key] }
      }
    }

    AuditService.log(
      auth.user!.id,
      'user.updated',
      'user',
      user.id,
      user.id,
      Object.keys(changes).length ? changes : null
    )

    session.flash('alert', {
      type: 'success',
      message: i18n.t('messages.user_updated', { name: user.displayName }),
    })

    return response.redirect(usersUrl(request))
  }

  async generateInvoice({ params, request, response, session, i18n, auth }: HttpContext) {
    const userId = Number(params.id)
    const user = await User.findOrFail(userId)

    const invoiceService = new InvoiceService()
    const invoices = await invoiceService.generateInvoicesForUser(auth.user!.id, userId)

    if (invoices.length === 0) {
      session.flash('alert', {
        type: 'info',
        message: i18n.t('messages.invoice_no_orders_for_buyer'),
      })
    } else {
      session.flash('alert', {
        type: 'success',
        message: i18n.t('messages.invoice_generated_for_user', {
          count: invoices.length,
          name: user.displayName,
        }),
      })

      const notificationService = new NotificationService()
      for (const invoice of invoices) {
        notificationService.sendInvoiceNotice(invoice).catch((err) => {
          logger.error({ err }, `Failed to send invoice notice for invoice #${invoice.id}`)
        })
      }
    }

    return response.redirect(usersUrl(request))
  }
}
