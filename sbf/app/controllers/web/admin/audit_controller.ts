import type { HttpContext } from '@adonisjs/core/http'
import AuditService from '#services/audit_service'

export default class AdminAuditController {
  async index({ inertia, request }: HttpContext) {
    const page = request.input('page', 1)
    const action = request.input('action')
    const entityType = request.input('entityType')
    const userId = request.input('userId')

    const logs = await AuditService.getAll(page, 20, {
      action: action || undefined,
      entityType: entityType || undefined,
      userId: userId ? Number(userId) : undefined,
    })

    return inertia.render('admin/audit/index', {
      logs: {
        data: logs.all().map((log) => ({
          id: log.id,
          action: log.action,
          entityType: log.entityType,
          entityId: log.entityId,
          metadata: log.metadata,
          user: log.user ? { id: log.user.id, displayName: log.user.displayName } : null,
          targetUser: log.targetUser
            ? { id: log.targetUser.id, displayName: log.targetUser.displayName }
            : null,
          createdAt: log.createdAt.toISO(),
        })),
        meta: logs.getMeta(),
      },
      filters: { action: action || '', entityType: entityType || '', userId: userId || '' },
    })
  }
}
