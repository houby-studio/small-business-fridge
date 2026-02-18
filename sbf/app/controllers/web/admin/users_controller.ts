import type { HttpContext } from '@adonisjs/core/http'
import AdminService from '#services/admin_service'
import { updateUserValidator } from '#validators/user'
import AuditService from '#services/audit_service'

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

    return inertia.render('admin/users/index', {
      users: {
        data: paginator.all().map((u) => ({
          id: u.id,
          displayName: u.displayName,
          email: u.email,
          username: u.username,
          role: u.role,
          isKiosk: u.isKiosk,
          isDisabled: u.isDisabled,
          keypadId: u.keypadId,
          createdAt: u.createdAt.toISO(),
        })),
        meta: paginator.getMeta(),
      },
      filters: { search: search || '', role: role || '' },
    })
  }

  async update({ params, request, response, session, i18n, auth }: HttpContext) {
    const data = await request.validateUsing(updateUserValidator)

    const service = new AdminService()
    const user = await service.updateUser(params.id, data)

    AuditService.log(auth.user!.id, 'user.updated', 'user', user.id, user.id, {
      changes: data,
    })

    session.flash('alert', {
      type: 'success',
      message: i18n.t('messages.user_updated', { name: user.displayName }),
    })

    return response.redirect('/admin/users')
  }
}
