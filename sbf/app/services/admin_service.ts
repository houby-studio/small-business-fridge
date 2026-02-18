import User from '#models/user'
import Order from '#models/order'
import Invoice from '#models/invoice'
import Category from '#models/category'
import db from '@adonisjs/lucid/services/db'

export default class AdminService {
  /**
   * Dashboard statistics overview.
   */
  async getDashboardStats() {
    const [userStats, orderStats, invoiceStats, recentOrders] = await Promise.all([
      // User counts by role
      db
        .from('users')
        .select(
          db.rawQuery('COUNT(*)::int as total'),
          db.rawQuery("COUNT(*) FILTER (WHERE role = 'customer')::int as customers"),
          db.rawQuery("COUNT(*) FILTER (WHERE role = 'supplier')::int as suppliers"),
          db.rawQuery("COUNT(*) FILTER (WHERE role = 'admin')::int as admins"),
          db.rawQuery('COUNT(*) FILTER (WHERE is_disabled = true)::int as disabled')
        )
        .first(),

      // Order stats
      db
        .from('orders')
        .join('deliveries', 'orders.delivery_id', 'deliveries.id')
        .select(
          db.rawQuery('COUNT(*)::int as total_orders'),
          db.rawQuery('COALESCE(SUM(deliveries.price), 0)::numeric as total_revenue'),
          db.rawQuery(
            "COUNT(*) FILTER (WHERE orders.created_at >= NOW() - INTERVAL '7 days')::int as orders_last_week"
          ),
          db.rawQuery(
            "COUNT(*) FILTER (WHERE orders.created_at >= NOW() - INTERVAL '30 days')::int as orders_last_month"
          )
        )
        .first(),

      // Invoice stats
      db
        .from('invoices')
        .select(
          db.rawQuery('COUNT(*)::int as total_invoices'),
          db.rawQuery('COUNT(*) FILTER (WHERE is_paid = true)::int as paid'),
          db.rawQuery('COUNT(*) FILTER (WHERE is_paid = false)::int as unpaid'),
          db.rawQuery(
            'COALESCE(SUM(CASE WHEN is_paid = false THEN total_cost ELSE 0 END), 0)::numeric as unpaid_amount'
          )
        )
        .first(),

      // Recent orders (last 10)
      Order.query()
        .preload('buyer')
        .preload('delivery', (q) => {
          q.preload('product')
          q.preload('supplier')
        })
        .orderBy('createdAt', 'desc')
        .limit(10),
    ])

    return {
      users: {
        total: userStats?.total ?? 0,
        customers: userStats?.customers ?? 0,
        suppliers: userStats?.suppliers ?? 0,
        admins: userStats?.admins ?? 0,
        disabled: userStats?.disabled ?? 0,
      },
      orders: {
        total: orderStats?.total_orders ?? 0,
        totalRevenue: Number(orderStats?.total_revenue ?? 0),
        lastWeek: orderStats?.orders_last_week ?? 0,
        lastMonth: orderStats?.orders_last_month ?? 0,
      },
      invoices: {
        total: invoiceStats?.total_invoices ?? 0,
        paid: invoiceStats?.paid ?? 0,
        unpaid: invoiceStats?.unpaid ?? 0,
        unpaidAmount: Number(invoiceStats?.unpaid_amount ?? 0),
      },
      recentOrders: recentOrders.map((o) => ({
        id: o.id,
        channel: o.channel,
        createdAt: o.createdAt.toISO(),
        buyerName: o.buyer?.displayName ?? '—',
        productName: o.delivery?.product?.displayName ?? '—',
        price: o.delivery?.price ?? 0,
        supplierName: o.delivery?.supplier?.displayName ?? '—',
      })),
    }
  }

  /**
   * Get paginated users for admin management with optional search and role filter.
   */
  async getUsers(
    page: number = 1,
    perPage: number = 20,
    filters?: { search?: string; role?: string }
  ) {
    const query = User.query().orderBy('displayName', 'asc')

    if (filters?.search) {
      const term = `%${filters.search}%`
      query.where((q) => {
        q.whereRaw('display_name ILIKE ?', [term])
          .orWhereRaw('email ILIKE ?', [term])
          .orWhereRaw('username ILIKE ?', [term])
      })
    }

    if (filters?.role) {
      query.where('role', filters.role)
    }

    return query.paginate(page, perPage)
  }

  /**
   * Update user properties (role, disabled status, etc.).
   */
  async updateUser(
    userId: number,
    data: {
      role?: 'customer' | 'supplier' | 'admin'
      isDisabled?: boolean
      isKiosk?: boolean
    }
  ) {
    const user = await User.findOrFail(userId)

    if (data.role !== undefined) user.role = data.role
    if (data.isDisabled !== undefined) user.isDisabled = data.isDisabled
    if (data.isKiosk !== undefined) user.isKiosk = data.isKiosk

    await user.save()
    return user
  }

  /**
   * Get all categories for admin management.
   */
  async getCategories() {
    return Category.query().orderBy('name', 'asc')
  }

  /**
   * Create a new category.
   */
  async createCategory(name: string, color: string) {
    return Category.create({ name, color, isDisabled: false })
  }

  /**
   * Update a category.
   */
  async updateCategory(
    categoryId: number,
    data: { name?: string; color?: string; isDisabled?: boolean }
  ) {
    const category = await Category.findOrFail(categoryId)

    if (data.name !== undefined) category.name = data.name
    if (data.color !== undefined) category.color = data.color
    if (data.isDisabled !== undefined) category.isDisabled = data.isDisabled

    await category.save()
    return category
  }

  /**
   * Get all orders (admin view) with optional search, channel, invoiced and sort filters.
   */
  async getAllOrders(
    page: number = 1,
    perPage: number = 20,
    filters?: {
      search?: string
      channel?: string
      invoiced?: string
      sortBy?: string
      sortOrder?: string
    }
  ) {
    const SORT_WHITELIST = ['createdAt']
    const safeSort = SORT_WHITELIST.includes(filters?.sortBy ?? '') ? filters!.sortBy! : 'createdAt'
    const sortDir: 'asc' | 'desc' = filters?.sortOrder === 'asc' ? 'asc' : 'desc'

    const query = Order.query()
      .preload('buyer')
      .preload('delivery', (q) => {
        q.preload('product')
        q.preload('supplier')
      })
      .orderBy(safeSort, sortDir)

    if (filters?.search) {
      const term = `%${filters.search}%`
      query.whereHas('buyer', (q) => {
        q.whereRaw('display_name ILIKE ?', [term])
      })
    }

    if (filters?.channel) {
      query.where('channel', filters.channel)
    }

    if (filters?.invoiced === 'yes') {
      query.whereNotNull('invoiceId')
    } else if (filters?.invoiced === 'no') {
      query.whereNull('invoiceId')
    }

    return query.paginate(page, perPage)
  }

  /**
   * Get all invoices (admin view) with optional status and sort filters.
   */
  async getAllInvoices(
    page: number = 1,
    perPage: number = 20,
    filters?: { status?: string; sortBy?: string; sortOrder?: string }
  ) {
    const SORT_WHITELIST = ['createdAt', 'totalCost']
    const safeSort = SORT_WHITELIST.includes(filters?.sortBy ?? '') ? filters!.sortBy! : 'createdAt'
    const sortDir: 'asc' | 'desc' = filters?.sortOrder === 'asc' ? 'asc' : 'desc'

    const query = Invoice.query().preload('buyer').preload('supplier').orderBy(safeSort, sortDir)

    if (filters?.status === 'paid') {
      query.where('isPaid', true)
    } else if (filters?.status === 'unpaid') {
      query.where('isPaid', false).where('isPaymentRequested', false)
    } else if (filters?.status === 'awaiting') {
      query.where('isPaid', false).where('isPaymentRequested', true)
    }

    return query.paginate(page, perPage)
  }

  /**
   * Storno (cancel) an order — restore stock and remove the order.
   */
  async stornoOrder(orderId: number) {
    return db.transaction(async (trx) => {
      const order = await Order.query({ client: trx })
        .where('id', orderId)
        .preload('delivery')
        .forUpdate()
        .firstOrFail()

      if (order.invoiceId) {
        throw new Error('ORDER_ALREADY_INVOICED')
      }

      // Restore stock
      order.delivery.amountLeft += 1
      await order.delivery.useTransaction(trx).save()

      // Delete the order
      await order.useTransaction(trx).delete()

      return order
    })
  }
}
