import type { HttpContext } from '@adonisjs/core/http'
import { resolvePage } from '#helpers/pagination'
import { listRedirectUrl } from '#helpers/list_redirect'
import { DateTime } from 'luxon'
import AdminService, { SupplierHasOpenBusiness } from '#services/admin_service'
import InvoiceService from '#services/invoice_service'
import User from '#models/user'
import UserInvitation from '#models/user_invitation'
import { transferStockValidator, updateUserValidator } from '#validators/user'
import DeliveryService, { type TransferErrorCode } from '#services/delivery_service'
import { isDomainError } from '#services/domain_error'
import AuditService from '#services/audit_service'
import NotificationService from '#services/notification_service'
import logger from '@adonisjs/core/services/logger'
import RegistrationPolicyService from '#services/registration_policy_service'
import PasswordResetService from '#services/password_reset_service'
import InvitationService from '#services/invitation_service'

const TRANSFER_ERRORS: Record<string, string> = {
  TRANSFER_SAME_USER: 'messages.stock_transfer_same_user',
  TRANSFER_TARGET_INVALID: 'messages.stock_transfer_target_invalid',
  NOTHING_TO_TRANSFER: 'messages.stock_transfer_nothing',
}

export default class UsersController {
  async index({ inertia, request }: HttpContext) {
    const page = resolvePage(request.input('page', 1))
    const invitePage = resolvePage(request.input('invitePage', 1))
    const role = request.input('role')
    const userId = request.input('userId')
    const disabled = request.input('disabled')
    const sortBy = request.input('sortBy')
    const sortOrder = request.input('sortOrder')

    const service = new AdminService()
    const paginator = await service.getUsers(page, 20, {
      role: role || undefined,
      userId: userId ? Number(userId) : undefined,
      disabled: disabled || undefined,
      sortBy: sortBy || undefined,
      sortOrder: sortOrder || undefined,
    })

    const users = paginator.all()
    const userIds = users.map((u) => u.id)

    const invoiceService = new InvoiceService()
    const deliveryService = new DeliveryService()
    const [uninvoicedIds, unpaidIds, business, suppliers] = await Promise.all([
      invoiceService.getUninvoicedBuyerIds(userIds),
      invoiceService.getUnpaidBuyerIds(userIds),
      // What blocks switching a supplier off: their stock and their uninvoiced sales.
      Promise.all(users.map((u) => deliveryService.openBusinessOf(u.id))),
      // Who can take over a leaving supplier's stock.
      User.query()
        .whereIn('role', ['supplier', 'admin'])
        .where('isDisabled', false)
        .where('isKiosk', false)
        .select('id', 'displayName')
        .orderBy('displayName', 'asc'),
    ])

    const userOptions = await User.query().select('id', 'displayName').orderBy('displayName', 'asc')
    const invitationService = new InvitationService()
    const invites = await UserInvitation.query()
      .orderBy('createdAt', 'desc')
      .paginate(invitePage, 5)
    const policy = new RegistrationPolicyService()

    return inertia.render('admin/users/index', {
      users: {
        data: users.map((u) => ({
          id: u.id,
          displayName: u.displayName,
          email: u.email,
          role: u.role,
          isKiosk: u.isKiosk,
          isDisabled: u.isDisabled,
          keypadId: u.keypadId,
          createdAt: u.createdAt.toISO(),
          hasUninvoicedOrders: uninvoicedIds.has(u.id),
          hasUnpaidInvoices: unpaidIds.has(u.id),
          openBusiness: business[users.indexOf(u)],
        })),
        meta: paginator.getMeta(),
      },
      filters: {
        role: role || '',
        userId: userId || '',
        disabled: disabled || '',
        sortBy: sortBy || '',
        sortOrder: sortOrder || '',
      },
      userOptions: userOptions.map((u) => ({ id: u.id, displayName: u.displayName })),
      supplierOptions: suppliers.map((u) => ({ id: u.id, displayName: u.displayName })),
      invitations: {
        data: invites.all().map((invite) => ({
          id: invite.id,
          email: invite.email,
          role: invite.role,
          createdAt: invite.createdAt.toISO(),
          expiresAt: invite.expiresAt.toISO(),
          acceptedAt: invite.acceptedAt?.toISO() ?? null,
          revokedAt: invite.revokedAt?.toISO() ?? null,
          inviteUrl:
            !invite.acceptedAt && !invite.revokedAt && invite.expiresAt > DateTime.utc()
              ? invitationService.getInviteUrl(invite)
              : null,
        })),
        meta: invites.getMeta(),
      },
      registrationPolicy: {
        mode: policy.getMode(),
        allowedDomains: policy.getAllowedDomains(),
      },
      inviteFilters: {
        invitePage,
      },
    })
  }

  async update({ params, request, response, session, i18n, auth }: HttpContext) {
    const data = await request.validateUsing(updateUserValidator)

    const service = new AdminService()

    let user: User
    try {
      user = await service.updateUser(params.id, data, auth.user!.id)
    } catch (err) {
      if (err instanceof SupplierHasOpenBusiness) {
        session.flash('alert', {
          type: 'danger',
          message: i18n.t('messages.supplier_has_open_business', {
            pieces: err.business.piecesLeft,
            lots: err.business.lotsWithStock,
            orders: err.business.uninvoicedOrders,
          }),
        })
        return response.redirect(listRedirectUrl(request, '/admin/users'))
      }
      if (err instanceof Error && err.message === 'LAST_ACTIVE_ADMIN_REQUIRED') {
        session.flash('alert', {
          type: 'danger',
          message: i18n.t('messages.last_active_admin_required'),
        })
        return response.redirect(listRedirectUrl(request, '/admin/users'))
      }
      if (err instanceof Error && err.message === 'USER_HAS_UNINVOICED_ORDERS') {
        return response.redirect(listRedirectUrl(request, '/admin/users'))
      }
      if (err instanceof Error && err.message === 'KEYPAD_ID_RESERVED') {
        session.flash('alert', {
          type: 'danger',
          message: i18n.t('messages.keypad_id_reserved'),
        })
        return response.redirect(listRedirectUrl(request, '/admin/users'))
      }
      if (err instanceof Error && err.message === 'KEYPAD_ID_TAKEN') {
        session.flash('alert', {
          type: 'danger',
          message: i18n.t('messages.keypad_id_taken'),
        })
        return response.redirect(listRedirectUrl(request, '/admin/users'))
      }
      throw err
    }

    session.flash('alert', {
      type: 'success',
      message: i18n.t('messages.user_updated', { name: user.displayName }),
    })

    return response.redirect(listRedirectUrl(request, '/admin/users'))
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
    }

    return response.redirect(listRedirectUrl(request, '/admin/users'))
  }

  /**
   * Hands a leaving supplier's stock over to a colleague — the step that lets the supplier be
   * disabled afterwards. Their sales and shrinkage stay theirs.
   */
  async transferStock({ params, request, response, session, i18n, auth }: HttpContext) {
    const { toUserId } = await request.validateUsing(transferStockValidator)
    const from = await User.findOrFail(Number(params.id))
    try {
      const result = await new DeliveryService().transferStock(from.id, toUserId, auth.user!)
      const target = await User.findOrFail(toUserId)
      session.flash('alert', {
        type: 'success',
        message: i18n.t('messages.stock_transferred', {
          pieces: result.pieces,
          from: from.displayName,
          to: target.displayName,
        }),
      })
    } catch (err) {
      if (!isDomainError<TransferErrorCode>(err)) throw err
      session.flash('alert', {
        type: 'danger',
        message: i18n.t(TRANSFER_ERRORS[err.code] ?? 'messages.action_failed'),
      })
    }
    return response.redirect(listRedirectUrl(request, '/admin/users'))
  }

  async sendPasswordReset({ params, request, response, session, i18n, auth }: HttpContext) {
    const userId = Number(params.id)
    const user = await User.findOrFail(userId)

    const resetService = new PasswordResetService()
    const payload = await resetService.createToken(user.email)
    if (!payload) {
      session.flash('alert', { type: 'danger', message: i18n.t('messages.action_failed') })
      return response.redirect(listRedirectUrl(request, '/admin/users'))
    }

    const notificationService = new NotificationService()
    notificationService.sendPasswordResetEmail(payload).catch((err) => {
      logger.error({ err, userId }, 'Failed to send admin-triggered password reset email')
    })

    await AuditService.log(
      auth.user!.id,
      'user.password_reset.requested',
      'user',
      user.id,
      user.id,
      {
        via: 'admin',
      }
    )
    session.flash('alert', {
      type: 'success',
      message: i18n.t('messages.password_reset_email_sent'),
    })
    return response.redirect(listRedirectUrl(request, '/admin/users'))
  }
}
