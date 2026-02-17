/*
|--------------------------------------------------------------------------
| Routes file
|--------------------------------------------------------------------------
|
| The routes file is used for defining the HTTP routes.
|
*/

import router from '@adonisjs/core/services/router'
import { middleware } from '#start/kernel'
import app from '@adonisjs/core/services/app'

/*
|--------------------------------------------------------------------------
| Lazy-loaded controllers
|--------------------------------------------------------------------------
*/

// Web controllers
const HomeController = () => import('#controllers/web/home_controller')
const LoginController = () => import('#controllers/web/login_controller')
const OidcController = () => import('#controllers/web/oidc_controller')
const ShopController = () => import('#controllers/web/shop_controller')
const OrdersController = () => import('#controllers/web/orders_controller')
const InvoicesController = () => import('#controllers/web/invoices_controller')
const ProfileController = () => import('#controllers/web/profile_controller')
const SupplierDeliveriesController = () => import('#controllers/web/supplier/deliveries_controller')
const SupplierInvoiceController = () => import('#controllers/web/supplier/invoice_controller')
const SupplierPaymentsController = () => import('#controllers/web/supplier/payments_controller')
const SupplierStockController = () => import('#controllers/web/supplier/stock_controller')
const SupplierProductsController = () => import('#controllers/web/supplier/products_controller')
const AdminDashboardController = () => import('#controllers/web/admin/dashboard_controller')
const AdminUsersController = () => import('#controllers/web/admin/users_controller')
const AdminCategoriesController = () => import('#controllers/web/admin/categories_controller')
const AdminOrdersController = () => import('#controllers/web/admin/orders_controller')
const AdminInvoicesController = () => import('#controllers/web/admin/invoices_controller')
const AdminStornoController = () => import('#controllers/web/admin/storno_controller')
const KioskController = () => import('#controllers/web/kiosk_controller')

// API controllers
const ApiAuthController = () => import('#controllers/api/auth_controller')
const ApiProductsController = () => import('#controllers/api/products_controller')
const ApiOrdersController = () => import('#controllers/api/orders_controller')
const ApiCustomersController = () => import('#controllers/api/customers_controller')
const ApiHealthController = () => import('#controllers/api/health_controller')

/*
|--------------------------------------------------------------------------
| Public routes
|--------------------------------------------------------------------------
*/

router.get('/', [HomeController, 'index'])

// Serve uploaded files from storage
router.get('/uploads/*', async ({ request, response }) => {
  const filePath = app.makePath('storage', request.url())
  return response.download(filePath)
})

/*
|--------------------------------------------------------------------------
| Auth routes (guest only for login, any for logout)
|--------------------------------------------------------------------------
*/

router.group(() => {
  router.get('/login', [LoginController, 'show']).use(middleware.guest())
  router.post('/login', [LoginController, 'store']).use(middleware.guest())
})

router.get('/auth/oidc/redirect', [OidcController, 'redirect'])
router.get('/auth/oidc/callback', [OidcController, 'callback'])

router.post('/logout', [LoginController, 'destroy']).use(middleware.auth())

/*
|--------------------------------------------------------------------------
| Customer routes (auth required, kiosk redirect)
|--------------------------------------------------------------------------
*/

router
  .group(() => {
    // Shop
    router.get('/shop', [ShopController, 'index'])
    router.post('/shop/purchase', [ShopController, 'purchase'])

    // Orders
    router.get('/orders', [OrdersController, 'index'])

    // Invoices
    router.get('/invoices', [InvoicesController, 'index'])
    router.post('/invoices/:id/request-paid', [InvoicesController, 'requestPaid'])
    router.post('/invoices/:id/cancel-paid', [InvoicesController, 'cancelPaid'])
    router.post('/invoices/:id/qrcode', [InvoicesController, 'qrcode'])

    // Profile
    router.get('/profile', [ProfileController, 'show'])
    router.put('/profile', [ProfileController, 'update'])
    router.post('/profile/favorites/:id', [ProfileController, 'toggleFavorite'])
  })
  .use([middleware.auth(), middleware.kiosk()])

/*
|--------------------------------------------------------------------------
| Supplier routes (auth + supplier role)
|--------------------------------------------------------------------------
*/

router
  .group(() => {
    // Deliveries (add stock)
    router.get('/deliveries', [SupplierDeliveriesController, 'index'])
    router.post('/deliveries', [SupplierDeliveriesController, 'store'])

    // Invoice generation
    router.get('/invoice', [SupplierInvoiceController, 'index'])
    router.post('/invoice/generate', [SupplierInvoiceController, 'generate'])

    // Payments
    router.get('/payments', [SupplierPaymentsController, 'index'])
    router.post('/payments/:id', [SupplierPaymentsController, 'update'])

    // Stock overview
    router.get('/stock', [SupplierStockController, 'index'])

    // Product management
    router.get('/products/new', [SupplierProductsController, 'create'])
    router.post('/products', [SupplierProductsController, 'store'])
    router.get('/products/:id/edit', [SupplierProductsController, 'edit'])
    router.put('/products/:id', [SupplierProductsController, 'update'])
  })
  .prefix('/supplier')
  .use([middleware.auth(), middleware.kiosk(), middleware.role({ roles: ['supplier'] })])

/*
|--------------------------------------------------------------------------
| Admin routes (auth + admin role)
|--------------------------------------------------------------------------
*/

router
  .group(() => {
    router.get('/dashboard', [AdminDashboardController, 'index'])

    // User management
    router.get('/users', [AdminUsersController, 'index'])
    router.put('/users/:id', [AdminUsersController, 'update'])

    // Category management
    router.get('/categories', [AdminCategoriesController, 'index'])
    router.post('/categories', [AdminCategoriesController, 'store'])
    router.put('/categories/:id', [AdminCategoriesController, 'update'])

    // Orders & invoices oversight
    router.get('/orders', [AdminOrdersController, 'index'])
    router.get('/invoices', [AdminInvoicesController, 'index'])

    // Storno
    router.post('/storno/:id', [AdminStornoController, 'store'])
  })
  .prefix('/admin')
  .use([middleware.auth(), middleware.role({ roles: ['admin'] })])

/*
|--------------------------------------------------------------------------
| Kiosk routes (auth required, kiosk users only)
|--------------------------------------------------------------------------
*/

router
  .group(() => {
    router.get('/kiosk', [KioskController, 'index'])
    router.get('/kiosk/shop', [KioskController, 'shop'])
    router.post('/kiosk/purchase', [KioskController, 'purchase'])
  })
  .use(middleware.auth())

/*
|--------------------------------------------------------------------------
| API v1 routes (token auth)
|--------------------------------------------------------------------------
*/

router
  .group(() => {
    // Auth - token issuance (no auth required, stricter rate limit)
    router.post('/auth/login', [ApiAuthController, 'login']).use(middleware.throttle({ maxRequests: 10, windowMs: 60_000 }))
    router.post('/auth/token', [ApiAuthController, 'token']).use(middleware.throttle({ maxRequests: 10, windowMs: 60_000 }))

    // Health (no auth required)
    router.get('/health', [ApiHealthController, 'index'])

    // Protected API routes
    router
      .group(() => {
        // Products
        router.get('/products', [ApiProductsController, 'index'])
        router.get('/products/:barcode', [ApiProductsController, 'show'])

        // Orders
        router.post('/orders', [ApiOrdersController, 'store'])
        router.get('/orders/latest', [ApiOrdersController, 'latest'])

        // Customers
        router.get('/customers/:id', [ApiCustomersController, 'show'])
        router.get('/customers/:id/insights', [ApiCustomersController, 'insights'])
      })
      .use(middleware.auth({ guards: ['api'] }))
  })
  .prefix('/api/v1')
  .use(middleware.throttle({ maxRequests: 60, windowMs: 60_000 }))
