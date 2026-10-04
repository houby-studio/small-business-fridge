import { z } from 'zod'
import { type McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type User from '#models/user'
import AdminService from '#services/admin_service'
import InvoiceService from '#services/invoice_service'
import AuditService from '#services/audit_service'
import {
  ok,
  mapDomainError,
  pageMeta,
  readOnly,
  destructive,
  idempotentWrite,
} from '#mcp/tools/helpers'

const page = () => z.number().int().min(1).optional().describe('Page number (default 1)')
const perPage = () =>
  z.number().int().min(1).max(100).optional().describe('Items per page (default 20)')

/**
 * Admin-only tools: user management, global order/invoice views, storno,
 * dashboard stats and audit logs.
 */
export function registerAdminTools(server: McpServer, user: User) {
  // ── dashboard_stats ─────────────────────────────────────────────────────────
  server.tool(
    'dashboard_stats',
    'The admin dashboard in numbers: users, orders, revenue and stock across the whole ' +
      'instance. For your own earnings as a supplier use get_finance_summary.',
    {},
    readOnly('Dashboard statistics'),
    async () => {
      try {
        const stats = await new AdminService().getDashboardStats()
        return ok(stats)
      } catch (err) {
        return mapDomainError(err, 'Fetching dashboard stats failed')
      }
    }
  )

  // ── list_users ──────────────────────────────────────────────────────────────
  server.tool(
    'list_users',
    'User accounts with role, status and keypad ID — the way to get a userId for ' +
      'update_user or a buyerId for generate_invoices_for_user.',
    {
      role: z.enum(['customer', 'supplier', 'admin']).optional().describe('Filter by role'),
      disabled: z.enum(['enabled', 'disabled']).optional().describe('Filter by account status'),
      page: page(),
      perPage: perPage(),
    },
    readOnly('Users'),
    async ({ role, disabled, page: pageNo, perPage: size }) => {
      try {
        const users = await new AdminService().getUsers(pageNo ?? 1, size ?? 20, {
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
        return mapDomainError(err, 'Listing users failed')
      }
    }
  )

  // ── update_user ─────────────────────────────────────────────────────────────
  server.tool(
    'update_user',
    'Change a user account: role, enabled/disabled, keypad ID. Only the fields you pass ' +
      'change. A user with uninvoiced orders or unpaid invoices cannot be disabled ' +
      '(generate_invoices_for_user first), and the last active admin cannot be demoted or ' +
      'disabled.',
    {
      userId: z.number().int().positive().describe('User to update (list_users)'),
      role: z.enum(['customer', 'supplier', 'admin']).optional().describe('New role'),
      isDisabled: z.boolean().optional().describe('Disable (true) or enable (false) the account'),
      keypadId: z.number().int().positive().optional().describe('New keypad ID'),
    },
    idempotentWrite('Update user'),
    async ({ userId, role, isDisabled, keypadId }) => {
      try {
        const updated = await new AdminService().updateUser(
          userId,
          { role, isDisabled, keypadId },
          user.id
        )

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
    "Every user's purchases across the instance (admin view), newest first, with filters. " +
      'For your own purchases use get_my_orders.',
    {
      buyerId: z.number().int().positive().optional().describe('Filter by buyer'),
      supplierId: z.number().int().positive().optional().describe('Filter by supplier'),
      channel: z.enum(['web', 'kiosk', 'scanner']).optional().describe('Filter by channel'),
      invoiced: z.enum(['yes', 'no']).optional().describe('Filter by invoiced status'),
      page: page(),
      perPage: perPage(),
    },
    readOnly('All orders'),
    async ({ buyerId, supplierId, channel, invoiced, page: pageNo, perPage: size }) => {
      try {
        const orders = await new AdminService().getAllOrders(pageNo ?? 1, size ?? 20, {
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
            price: o.unitPrice,
            channel: o.channel,
            invoiced: o.invoiceId !== null && o.invoiceId !== undefined,
            createdAt: o.createdAt?.toISO() ?? null,
          })),
        })
      } catch (err) {
        return mapDomainError(err, 'Listing orders failed')
      }
    }
  )

  // ── list_all_invoices ───────────────────────────────────────────────────────
  server.tool(
    'list_all_invoices',
    'Every invoice across the instance (admin view), newest first, with filters. For ' +
      'invoices you issued use list_issued_invoices, for ones you received get_my_invoices.',
    {
      buyerId: z.number().int().positive().optional().describe('Filter by buyer'),
      supplierId: z.number().int().positive().optional().describe('Filter by supplier'),
      status: z.enum(['paid', 'unpaid', 'awaiting']).optional().describe('Filter by status'),
      page: page(),
      perPage: perPage(),
    },
    readOnly('All invoices'),
    async ({ buyerId, supplierId, status, page: pageNo, perPage: size }) => {
      try {
        const invoices = await new AdminService().getAllInvoices(pageNo ?? 1, size ?? 20, {
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
        return mapDomainError(err, 'Listing invoices failed')
      }
    }
  )

  // ── storno_order ────────────────────────────────────────────────────────────
  server.tool(
    'storno_order',
    "Cancel (storno) a purchase — the piece returns to its lot's stock and the order is " +
      'deleted. Only while the order is not invoiced yet; find orderId with list_all_orders. ' +
      'For a wrongly stocked lot use void_delivery instead.',
    {
      orderId: z.number().int().positive().describe('Order to cancel (list_all_orders)'),
    },
    destructive('Storno order'),
    async ({ orderId }) => {
      try {
        await new AdminService().stornoOrder(orderId, user.id)

        return ok({ orderId, status: 'cancelled', note: 'Stock restored.' })
      } catch (err) {
        return mapDomainError(err, 'Storno failed')
      }
    }
  )

  // ── generate_invoices_for_user ──────────────────────────────────────────────
  server.tool(
    'generate_invoices_for_user',
    'Invoice ALL uninvoiced orders of one buyer across every supplier (one invoice per ' +
      'supplier) — typically before disabling their account. This e-mails the buyer and ' +
      'cannot be undone. For your own sales use generate_invoices(buyerId).',
    {
      buyerId: z.number().int().positive().describe('Buyer to invoice (list_users)'),
    },
    destructive('Invoice one buyer everywhere'),
    async ({ buyerId }) => {
      try {
        const invoices = await new InvoiceService().generateInvoicesForUser(user.id, buyerId)
        return ok({
          invoices: invoices.map((inv) => ({
            invoiceId: inv.id,
            supplierId: inv.supplierId,
            totalCost: inv.totalCost,
          })),
          note:
            invoices.length === 0
              ? 'No uninvoiced orders for this buyer.'
              : `${invoices.length} invoice(s) issued; the buyer was e-mailed.`,
        })
      } catch (err) {
        return mapDomainError(err, 'Generating invoices failed')
      }
    }
  )

  // ── create_category ─────────────────────────────────────────────────────────
  server.tool(
    'create_category',
    'Create a product category — only when list_categories has no fitting one. Products ' +
      'and purchase groups then reference it by categoryId.',
    {
      name: z.string().min(1).max(50).describe('Category name'),
      color: z
        .string()
        .regex(/^#[0-9a-fA-F]{6}$/)
        .describe('Hex color, e.g. #3b82f6'),
    },
    idempotentWrite('Create category'),
    async ({ name, color }) => {
      try {
        const category = await new AdminService().createCategory(name, color, user.id)
        return ok({ categoryId: category.id, name: category.name, color: category.color })
      } catch (err) {
        return mapDomainError(err, 'Creating category failed')
      }
    }
  )

  // ── get_audit_logs ──────────────────────────────────────────────────────────
  server.tool(
    'get_audit_logs',
    'Who did what and when — the system audit log. Actions include order.created, ' +
      'invoice.generated, payment.requested/approved/rejected, delivery.created/corrected/' +
      'voided, stock_draft.*, stock.written_off, inventory.committed, product.created/' +
      'updated, user.updated, user.login, order.storno. Filter by action, entity or user.',
    {
      action: z.string().optional().describe('Filter by exact action, e.g. "order.created"'),
      entityType: z
        .string()
        .optional()
        .describe(
          'Filter by entity type: order, invoice, delivery, product, user, category, stock_draft, inventory_count'
        ),
      userId: z.number().int().positive().optional().describe('Filter by actor or target user'),
      page: page(),
      perPage: perPage(),
    },
    readOnly('Audit log'),
    async ({ action, entityType, userId, page: pageNo, perPage: size }) => {
      try {
        const logs = await AuditService.getAll(pageNo ?? 1, size ?? 20, {
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
        return mapDomainError(err, 'Querying audit logs failed')
      }
    }
  )
}
