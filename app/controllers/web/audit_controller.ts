import type { HttpContext } from '@adonisjs/core/http'
import { resolvePage } from '#helpers/pagination'
import AuditService from '#services/audit_service'

export default class AuditController {
  async index({ inertia, auth, request }: HttpContext) {
    const page = resolvePage(request.input('page', 1))
    const action = request.input('action')
    const sortOrder = request.input('sortOrder')

    const logs = await AuditService.getForUser(auth.user!.id, page, 20, {
      action: action || undefined,
      sortOrder: sortOrder === 'asc' ? 'asc' : 'desc',
    })

    return inertia.render('audit/index', {
      logs: {
        data: logs.all().map((log) => {
          const me = auth.user!.id
          // The start and end of an admin impersonating *this* user read as one plain
          // sentence ("X vás zastupoval"), not as the raw admin/target ids.
          const impersonatedMe =
            log.targetUserId === me && IMPERSONATION_ACTIONS.has(log.action) && log.userId !== me
          return {
            id: log.id,
            action: log.action,
            entityType: log.entityType,
            entityId: log.entityId,
            // impersonatedBy is only this user's business — other parties listed on the
            // entry (e.g. the supplier of an order) must not learn about the impersonation.
            metadata: impersonatedMe ? null : withoutImpersonation(log.metadata),
            impersonation: impersonatedMe
              ? {
                  phase: log.action === 'admin.impersonate.start' ? 'start' : 'stop',
                  reason: (log.metadata?.reason as string | undefined) ?? null,
                }
              : null,
            user: log.user ? { displayName: log.user.displayName } : null,
            // Entries where someone else acted on this user's records (e.g. an admin
            // correcting their delivery) must say who did it.
            actorIsMe: log.userId === auth.user!.id,
            // Set when an admin acted while impersonating this user.
            impersonatedBy: impersonatedMe
              ? (log.user?.displayName ?? null)
              : log.userId === me
                ? (log.metadata?.impersonatedBy?.name ?? null)
                : null,
            targetUser: log.targetUser ? { displayName: log.targetUser.displayName } : null,
            createdAt: log.createdAt.toISO(),
          }
        }),
        meta: logs.getMeta(),
      },
      filters: { action: action || '', sortOrder: sortOrder || 'desc' },
    })
  }
}

const IMPERSONATION_ACTIONS = new Set(['admin.impersonate.start', 'admin.impersonate.stop'])

function withoutImpersonation(metadata: Record<string, any> | null) {
  if (!metadata || !('impersonatedBy' in metadata)) return metadata
  const rest = { ...metadata }
  delete rest.impersonatedBy
  return rest
}
