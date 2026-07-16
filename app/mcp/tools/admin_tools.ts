import { z } from 'zod'
import { type McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { type CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type User from '#models/user'
import AdminService from '#services/admin_service'
import InvoiceService from '#services/invoice_service'
import AuditService from '#services/audit_service'
import { ok, fail, mapDomainError, pageMeta } from '#mcp/tools/helpers'

/**
 * Admin-only tools: user management, global order/invoice views, storno,
 * dashboard stats and audit logs.
 */
export function registerAdminTools(server: McpServer, user: User) {
  // ── dashboard_stats ─────────────────────────────────────────────────────────
  server.tool(
    'dashboard_stats',
    'Get the admin dashboard statistics (users, orders, revenue, stock overview).',
    {},
    async (): Promise<CallToolResult> => {
      try {
        const stats = await new AdminService().getDashboardStats()
        return ok(stats)
      } catch (err) {
        return fail(`Error fetching dashboard stats: ${String(err)}`)
      }
    }
  )

  // ── list_users ──────────────────────────────────────────────────────────────
  server.tool(
    'list_users',
    'List user accounts with role and status filters.',
    {
      role: z.enum(['customer', 'supplier', 'admin']).optional().describe('Filter by role'),
      disabled: z.enum(['enabled', 'disabled']).optional().describe('Filter by account status'),
      page: z.number().int().min(1).optional().describe('Page number (default 1)'),
      perPage: z.number().int().min(1).max(100).optional().describe('Items per page (default 20)'),
    },
    async ({ role, disabled, page, perPage }): Promise<CallToolResult> => {
      try {
        const users = await new AdminService().getUsers(page ?? 1, perPage ?? 20, {
          role,
          disabled,
        })
        return ok({
          meta: pageMeta(users),
          users: users.all().map((u) => ({
            userId: u.id,
            displayName: u.displayName,
            email: u.email,
            role: u.role,
            isDisabled: u.isDisabled,
            isKiosk: u.isKiosk,
            keypadId: u.keypadId,
          })),
        })
      } catch (err) {
        return fail(`Error listing users: ${String(err)}`)
      }
    }
  )

  // ── update_user ─────────────────────────────────────────────────────────────
  server.tool(
    'update_user',
    'Update a user account: change role, enable/disable, or change keypad ID. ' +
      'A user with uninvoiced orders or unpaid invoices cannot be disabled, and the ' +
      'last active admin cannot be demoted or disabled.',
    {
      userId: z.number().int().positive().describe('User to update'),
      role: z.enum(['customer', 'supplier', 'admin']).optional().describe('New role'),
      isDisabled: z.boolean().optional().describe('Disable (true) or enable (false) the account'),
      keypadId: z.number().int().positive().optional().describe('New keypad ID'),
    },
    async ({ userId, role, isDisabled, keypadId }): Promise<CallToolResult> => {
      try {
        const updated = await new AdminService().updateUser(userId, { role, isDisabled, keypadId })

        await AuditService.log(user.id, 'user.updated', 'user', updated.id, updated.id, {
          role,
          isDisabled,
          keypadId,
          via: 'mcp',
        })

        return ok({
          userId: updated.id,
          displayName: updated.displayName,
          role: updated.role,
          isDisabled: updated.isDisabled,
          keypadId: updated.keypadId,
        })
      } catch (err) {
        return mapDomainError(err, 'Updating user failed')
      }
    }
  )

  // ── list_all_orders ─────────────────────────────────────────────────────────
  server.tool(
    'list_all_orders',
    'List all orders across all users (admin view) with filters.',
    {
      buyerId: z.number().int().positive().optional().describe('Filter by buyer'),
      supplierId: z.number().int().positive().optional().describe('Filter by supplier'),
      channel: z.enum(['web', 'kiosk', 'scanner']).optional().describe('Filter by channel'),
      invoiced: z.enum(['yes', 'no']).optional().describe('Filter by invoiced status'),
      page: z.number().int().min(1).optional().describe('Page number (default 1)'),
      perPage: z.number().int().min(1).max(100).optional().describe('Items per page (default 20)'),
    },
    async ({ buyerId, supplierId, channel, invoiced, page, perPage }): Promise<CallToolResult> => {
      try {
        const orders = await new AdminService().getAllOrders(page ?? 1, perPage ?? 20, {
          buyerId,
          supplierId,
          channel,
          invoiced,
        })
        return ok({
          meta: pageMeta(orders),
          orders: orders.all().map((o) => ({
            orderId: o.id,
            buyer: o.buyer?.displayName ?? null,
            buyerId: o.buyerId,
            product: o.delivery?.product?.displayName ?? null,
            supplier: o.delivery?.supplier?.displayName ?? null,
            price: o.delivery?.price ?? null,
            channel: o.channel,
            invoiced: o.invoiceId !== null && o.invoiceId !== undefined,
            createdAt: o.createdAt?.toISO() ?? null,
          })),
        })
      } catch (err) {
        return fail(`Error listing orders: ${String(err)}`)
      }
    }
  )

  // ── list_all_invoices ───────────────────────────────────────────────────────
  server.tool(
    'list_all_invoices',
    'List all invoices across all users (admin view) with filters.',
    {
      buyerId: z.number().int().positive().optional().describe('Filter by buyer'),
      supplierId: z.number().int().positive().optional().describe('Filter by supplier'),
      status: z.enum(['paid', 'unpaid', 'awaiting']).optional().describe('Filter by status'),
      page: z.number().int().min(1).optional().describe('Page number (default 1)'),
      perPage: z.number().int().min(1).max(100).optional().describe('Items per page (default 20)'),
    },
    async ({ buyerId, supplierId, status, page, perPage }): Promise<CallToolResult> => {
      try {
        const invoices = await new AdminService().getAllInvoices(page ?? 1, perPage ?? 20, {
          buyerId,
          supplierId,
          status,
        })
        return ok({
          meta: pageMeta(invoices),
          invoices: invoices.all().map((inv) => ({
            invoiceId: inv.id,
            buyer: inv.buyer?.displayName ?? null,
            supplier: inv.supplier?.displayName ?? null,
            totalCost: inv.totalCost,
            status: inv.isPaid ? 'paid' : inv.isPaymentRequested ? 'awaiting' : 'unpaid',
            createdAt: inv.createdAt?.toISO() ?? null,
          })),
        })
      } catch (err) {
        return fail(`Error listing invoices: ${String(err)}`)
      }
    }
  )

  // ── storno_order ────────────────────────────────────────────────────────────
  server.tool(
    'storno_order',
    'Cancel (storno) an order — restores the stock and deletes the order. ' +
      'Only possible while the order is not invoiced yet.',
    {
      orderId: z.number().int().positive().describe('Order to cancel'),
    },
    async ({ orderId }): Promise<CallToolResult> => {
      try {
        const order = await new AdminService().stornoOrder(orderId)

        await AuditService.log(user.id, 'order.storno', 'order', orderId, order.buyerId, {
          deliveryId: order.deliveryId,
          via: 'mcp',
        })

        return ok({ orderId, status: 'cancelled', note: 'Stock restored.' })
      } catch (err) {
        return mapDomainError(err, 'Storno failed')
      }
    }
  )

  // ── generate_invoices_for_user ──────────────────────────────────────────────
  server.tool(
    'generate_invoices_for_user',
    'Generate invoices for ALL uninvoiced orders of a buyer, across all suppliers ' +
      '(one invoice per supplier). Useful before disabling a user account.',
    {
      buyerId: z.number().int().positive().describe('Buyer to invoice'),
    },
    async ({ buyerId }): Promise<CallToolResult> => {
      try {
        const invoices = await new InvoiceService().generateInvoicesForUser(user.id, buyerId)
        return ok({
          invoices: invoices.map((inv) => ({
            invoiceId: inv.id,
            supplierId: inv.supplierId,
            totalCost: inv.totalCost,
          })),
          note: invoices.length === 0 ? 'No uninvoiced orders for this buyer.' : undefined,
        })
      } catch (err) {
        return mapDomainError(err, 'Generating invoices failed')
      }
    }
  )

  // ── manage_categories ───────────────────────────────────────────────────────
  server.tool(
    'create_category',
    'Create a new product category.',
    {
      name: z.string().min(1).max(50).describe('Category name'),
      color: z
        .string()
        .regex(/^#[0-9a-fA-F]{6}$/)
        .describe('Hex color, e.g. #3b82f6'),
    },
    async ({ name, color }): Promise<CallToolResult> => {
      try {
        const category = await new AdminService().createCategory(name, color)
        await AuditService.log(user.id, 'category.created', 'category', category.id, null, {
          name,
          via: 'mcp',
        })
        return ok({ categoryId: category.id, name: category.name, color: category.color })
      } catch (err) {
        return mapDomainError(err, 'Creating category failed')
      }
    }
  )

  // ── get_audit_logs ──────────────────────────────────────────────────────────
  server.tool(
    'get_audit_logs',
    'Query the system audit log. Actions include: order.created, invoice.generated, ' +
      'payment.requested/approved/rejected, delivery.created, product.created/updated, ' +
      'user.updated, user.login, order.storno and more.',
    {
      action: z.string().optional().describe('Filter by exact action, e.g. "order.created"'),
      entityType: z
        .string()
        .optional()
        .describe('Filter by entity type: order, invoice, delivery, product, user, category'),
      userId: z.number().int().positive().optional().describe('Filter by actor or target user'),
      page: z.number().int().min(1).optional().describe('Page number (default 1)'),
      perPage: z.number().int().min(1).max(100).optional().describe('Items per page (default 20)'),
    },
    async ({ action, entityType, userId, page, perPage }): Promise<CallToolResult> => {
      try {
        const logs = await AuditService.getAll(page ?? 1, perPage ?? 20, {
          action,
          entityType,
          userId,
        })
        return ok({
          meta: pageMeta(logs),
          logs: logs.all().map((log) => ({
            id: log.id,
            action: log.action,
            entityType: log.entityType,
            entityId: log.entityId,
            actor: log.user?.displayName ?? null,
            targetUser: log.targetUser?.displayName ?? null,
            metadata: log.metadata,
            createdAt: log.createdAt?.toISO() ?? null,
          })),
        })
      } catch (err) {
        return fail(`Error querying audit logs: ${String(err)}`)
      }
    }
  )
}
