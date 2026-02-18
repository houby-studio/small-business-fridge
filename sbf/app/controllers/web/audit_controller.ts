import type { HttpContext } from '@adonisjs/core/http'
import AuditService from '#services/audit_service'

export default class AuditController {
  async index({ inertia, auth, request }: HttpContext) {
    const page = request.input('page', 1)
    const logs = await AuditService.getForUser(auth.user!.id, page, 20)

    return inertia.render('audit/index', {
      logs: {
        data: logs.all().map((log) => ({
          id: log.id,
          action: log.action,
          entityType: log.entityType,
          entityId: log.entityId,
          metadata: log.metadata,
          user: log.user ? { displayName: log.user.displayName } : null,
          targetUser: log.targetUser ? { displayName: log.targetUser.displayName } : null,
          createdAt: log.createdAt.toISO(),
        })),
        meta: logs.getMeta(),
      },
    })
  }
}
