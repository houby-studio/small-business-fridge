import type { HttpContext } from '@adonisjs/core/http'
import logger from '@adonisjs/core/services/logger'
import User from '#models/user'
import AuditService from '#services/audit_service'
import type { ImpersonationData } from '#middleware/impersonation_middleware'

export default class ImpersonationController {
  /**
   * Start impersonating a user. Only admins may call this.
   * Cannot impersonate: admins, kiosk accounts, disabled accounts, or yourself.
   */
  async store({ params, auth, session, response, i18n }: HttpContext) {
    const admin = auth.user!
    const targetId = Number(params.id)

    if (targetId === admin.id) {
      session.flash('alert', { type: 'warn', message: i18n.t('messages.impersonate_self') })
      return response.redirect('/admin/users')
    }

    const target = await User.find(targetId)

    if (!target || target.isDisabled) {
      session.flash('alert', { type: 'danger', message: i18n.t('messages.not_found') })
      return response.redirect('/admin/users')
    }

    if (target.role === 'admin') {
      session.flash('alert', { type: 'danger', message: i18n.t('messages.impersonate_admin') })
      return response.redirect('/admin/users')
    }

    if (target.isKiosk) {
      session.flash('alert', { type: 'danger', message: i18n.t('messages.impersonate_kiosk') })
      return response.redirect('/admin/users')
    }

    const impersonation: ImpersonationData = {
      byId: admin.id,
      asId: target.id,
      asName: target.displayName,
    }
    session.put('__impersonation', impersonation)

    logger.info(
      { adminId: admin.id, targetId: target.id },
      `Admin started impersonating user ${target.displayName}`
    )
    AuditService.log(admin.id, 'admin.impersonate.start', 'user', target.id, target.id, {
      adminId: admin.id,
      targetName: target.displayName,
    })

    session.flash('alert', {
      type: 'info',
      message: i18n.t('messages.impersonate_started', { name: target.displayName }),
    })
    return response.redirect('/shop')
  }

  /**
   * Stop current impersonation and return to admin context.
   */
  async destroy({ session, response, i18n }: HttpContext) {
    const impersonation = session.get('__impersonation') as ImpersonationData | undefined

    if (!impersonation) {
      return response.redirect('/shop')
    }

    logger.info(
      { adminId: impersonation.byId, targetId: impersonation.asId },
      'Admin stopped impersonation'
    )
    AuditService.log(
      impersonation.byId,
      'admin.impersonate.stop',
      'user',
      impersonation.asId,
      impersonation.asId,
      {
        adminId: impersonation.byId,
        targetName: impersonation.asName,
      }
    )

    session.forget('__impersonation')

    session.flash('alert', {
      type: 'success',
      message: i18n.t('messages.impersonate_stopped'),
    })
    return response.redirect('/admin/users')
  }
}
