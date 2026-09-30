import { HttpContext } from '@adonisjs/core/http'
import logger from '@adonisjs/core/services/logger'
import AuditLog from '#models/audit_log'
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'

export default class AuditService {
  /**
   * Log an audit event. Fire-and-forget — never throws.
   *
   * Pass `client` when the audited change runs in a transaction: the entry is then written
   * in a savepoint of it, so a rollback takes the entry with it (no record of an order or
   * invoice that never existed) while a failed audit insert still cannot abort the change.
   */
  static async log(
    userId: number | null,
    action: string,
    entityType: string,
    entityId: number | null = null,
    targetUserId: number | null = null,
    metadata: Record<string, any> | null = null,
    options: { client?: TransactionClientContract } = {}
  ): Promise<void> {
    try {
      metadata = AuditService.withRequestContext(userId, metadata)

      // Use raw query builder for writes to avoid any model mapping issues
      const row = {
        user_id: userId,
        action,
        entity_type: entityType,
        entity_id: entityId,
        target_user_id: targetUserId,
        metadata,
        created_at: new Date(),
      }
      if (options.client) {
        await options.client.transaction(async (savepoint) => {
          await savepoint.table('audit_logs').insert(row)
        })
      } else {
        await db.table('audit_logs').insert(row)
      }
    } catch (err) {
      // Never block the main operation — but a lost audit entry must not go unnoticed.
      logger.error({ err, action, entityType, entityId, userId }, 'Failed to write audit log')
    }
  }

  /**
   * Record who and what really performed the action when the request says more than the
   * actor id does. Explicit metadata always wins over what is derived here.
   */
  private static withRequestContext(
    userId: number | null,
    metadata: Record<string, any> | null
  ): Record<string, any> | null {
    const ctx = HttpContext.get()
    if (!ctx) return metadata

    const extra: Record<string, unknown> = {}

    // While an admin impersonates someone, the recorded actor is the impersonated user —
    // keep the real one too, or the log would claim the user did it themselves.
    const impersonator = ctx.impersonator
    if (impersonator && impersonator.id !== userId) {
      extra.impersonatedBy = { id: impersonator.id, name: impersonator.displayName }
    }

    // Services are shared by the web UI, the MCP server and the REST API; without this an
    // action taken by an AI tool looks exactly like one clicked in the browser.
    const pattern = ctx.route?.pattern
    if (pattern === '/mcp') {
      extra.via = 'mcp'
    } else if (pattern?.startsWith('/api/v1/')) {
      extra.via = 'api'
    }

    // At a kiosk the actor is the customer who typed their keypad id; the terminal that
    // took the order is the signed-in kiosk account.
    const signedIn = ctx.auth?.user
    if (signedIn?.isKiosk && signedIn.id !== userId) {
      extra.kiosk = { id: signedIn.id, name: signedIn.displayName }
    }

    if (Object.keys(extra).length === 0) return metadata
    return { ...extra, ...metadata }
  }

  /**
   * Get audit logs for a specific user (where they are actor or target).
   */
  static async getForUser(
    userId: number,
    page: number = 1,
    perPage: number = 20,
    filters?: { action?: string; sortOrder?: 'asc' | 'desc' }
  ) {
    const sortOrder = filters?.sortOrder === 'asc' ? 'asc' : 'desc'
    const query = AuditLog.query()
      .where((q) => {
        q.where('userId', userId).orWhere('targetUserId', userId)
      })
      .preload('user')
      .preload('targetUser')
      .orderBy('createdAt', sortOrder)

    if (filters?.action) {
      query.where('action', filters.action)
    }

    return query.paginate(page, perPage)
  }

  /**
   * Get all audit logs with optional filters (admin view).
   */
  static async getAll(
    page: number = 1,
    perPage: number = 20,
    filters?: { action?: string; entityType?: string; userId?: number; sortOrder?: 'asc' | 'desc' }
  ) {
    const sortOrder = filters?.sortOrder === 'asc' ? 'asc' : 'desc'
    const query = AuditLog.query()
      .preload('user')
      .preload('targetUser')
      .orderBy('createdAt', sortOrder)

    if (filters?.action) {
      query.where('action', filters.action)
    }
    if (filters?.entityType) {
      query.where('entityType', filters.entityType)
    }
    if (filters?.userId) {
      query.where((q) => {
        q.where('userId', filters.userId!)
          .orWhere('targetUserId', filters.userId!)
          // Actions an admin took while impersonating someone belong to the admin too.
          .orWhereRaw("(metadata->'impersonatedBy'->>'id')::int = ?", [filters.userId!])
      })
    }

    return query.paginate(page, perPage)
  }
}
