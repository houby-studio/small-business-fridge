import AuditLog from '#models/audit_log'

export default class AuditService {
  /**
   * Log an audit event. Fire-and-forget — never throws.
   */
  static async log(
    userId: number | null,
    action: string,
    entityType: string,
    entityId: number | null = null,
    targetUserId: number | null = null,
    metadata: Record<string, any> | null = null
  ): Promise<void> {
    try {
      await AuditLog.create({
        userId,
        action,
        entityType,
        entityId,
        targetUserId,
        metadata,
      })
    } catch {
      // Never block the main operation
    }
  }

  /**
   * Get audit logs for a specific user (where they are actor or target).
   */
  static async getForUser(userId: number, page: number = 1, perPage: number = 20) {
    return AuditLog.query()
      .where('userId', userId)
      .orWhere('targetUserId', userId)
      .preload('user')
      .preload('targetUser')
      .orderBy('createdAt', 'desc')
      .paginate(page, perPage)
  }

  /**
   * Get all audit logs with optional filters (admin view).
   */
  static async getAll(
    page: number = 1,
    perPage: number = 20,
    filters?: { action?: string; entityType?: string; userId?: number }
  ) {
    const query = AuditLog.query()
      .preload('user')
      .preload('targetUser')
      .orderBy('createdAt', 'desc')

    if (filters?.action) {
      query.where('action', filters.action)
    }
    if (filters?.entityType) {
      query.where('entityType', filters.entityType)
    }
    if (filters?.userId) {
      query.where((q) => {
        q.where('userId', filters.userId!).orWhere('targetUserId', filters.userId!)
      })
    }

    return query.paginate(page, perPage)
  }
}
