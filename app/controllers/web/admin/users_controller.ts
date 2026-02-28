import type { HttpContext } from '@adonisjs/core/http'
import { DateTime } from 'luxon'
import AdminService from '#services/admin_service'
import InvoiceService from '#services/invoice_service'
import User from '#models/user'
import UserInvitation from '#models/user_invitation'
import { updateUserValidator } from '#validators/user'
import AuditService from '#services/audit_service'
import NotificationService from '#services/notification_service'
import logger from '@adonisjs/core/services/logger'
import RegistrationPolicyService from '#services/registration_policy_service'
import PasswordResetService from '#services/password_reset_service'
import InvitationService from '#services/invitation_service'

/**
 * Return the referer URL if it points to /admin/users (preserving active filters),
 * otherwise fall back to /admin/users without filters.
 */
function usersUrl(request: HttpContext['request']): string {
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
    const invitePage = Number(request.input('invitePage', 1))
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
    const [uninvoicedIds, unpaidIds] = await Promise.all([
      invoiceService.getUninvoicedBuyerIds(userIds),
      invoiceService.getUnpaidBuyerIds(userIds),
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
      filters: {
        role: role || '',
        userId: userId || '',
        disabled: disabled || '',
        sortBy: sortBy || '',
        sortOrder: sortOrder || '',
      },
      userOptions: userOptions.map((u) => ({ id: u.id, displayName: u.displayName })),
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
            !invite.acceptedAt && !invite.revokedAt && invite.expiresAt > DateTime.now()
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
      if (err instanceof Error && err.message === 'LAST_ACTIVE_ADMIN_REQUIRED') {
        session.flash('alert', {
          type: 'danger',
          message: i18n.t('messages.last_active_admin_required'),
        })
        return response.redirect(usersUrl(request))
      }
      if (err instanceof Error && err.message === 'USER_HAS_UNINVOICED_ORDERS') {
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

    await AuditService.log(
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

  async sendPasswordReset({ params, request, response, session, i18n, auth }: HttpContext) {
    const userId = Number(params.id)
    const user = await User.findOrFail(userId)

    const resetService = new PasswordResetService()
    const payload = await resetService.createToken(user.email)
    if (!payload) {
      session.flash('alert', { type: 'danger', message: i18n.t('messages.action_failed') })
      return response.redirect(usersUrl(request))
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
    return response.redirect(usersUrl(request))
  }
}
