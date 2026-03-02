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
import env from '#start/env'
import { extname } from 'node:path'

/*
|--------------------------------------------------------------------------
| Lazy-loaded controllers
|--------------------------------------------------------------------------
*/

// Web controllers
const HomeController = () => import('#controllers/web/home_controller')
const LoginController = () => import('#controllers/web/login_controller')
const BootstrapController = () => import('#controllers/web/bootstrap_controller')
const RegisterController = () => import('#controllers/web/register_controller')
const PasswordResetController = () => import('#controllers/web/password_reset_controller')
const InviteRegistrationController = () => import('#controllers/web/invite_registration_controller')
const OidcController = () => import('#controllers/web/oidc_controller')
const EmailVerificationController = () => import('#controllers/web/email_verification_controller')
const IbanChangeController = () => import('#controllers/web/iban_change_controller')
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
const AdminInvitationsController = () => import('#controllers/web/admin/invitations_controller')
const AdminCategoriesController = () => import('#controllers/web/admin/categories_controller')
const AdminAllergensController = () => import('#controllers/web/admin/allergens_controller')
const AdminMusicTracksController = () => import('#controllers/web/admin/music_tracks_controller')
const AdminOrdersController = () => import('#controllers/web/admin/orders_controller')
const AdminInvoicesController = () => import('#controllers/web/admin/invoices_controller')
const AdminStornoController = () => import('#controllers/web/admin/storno_controller')
const AdminImpersonationController = () => import('#controllers/web/admin/impersonation_controller')
const AuditController = () => import('#controllers/web/audit_controller')
const AdminAuditController = () => import('#controllers/web/admin/audit_controller')
const KioskController = () => import('#controllers/web/kiosk_controller')

// API controllers
const ApiAuthController = () => import('#controllers/api/auth_controller')
const ApiProductsController = () => import('#controllers/api/products_controller')
const ApiOrdersController = () => import('#controllers/api/orders_controller')
const ApiCustomersController = () => import('#controllers/api/customers_controller')
const ApiHealthController = () => import('#controllers/api/health_controller')
const authThrottleLimit = process.env.NODE_ENV === 'test' ? 1000 : 10

/*
|--------------------------------------------------------------------------
| Public routes
|--------------------------------------------------------------------------
*/

router.get('/', [HomeController, 'index'])

// Serve uploaded files from storage
router.get('/uploads/*', async ({ request, response }) => {
  const immutableExtensions = new Set([
    '.avif',
    '.gif',
    '.ico',
    '.jpg',
    '.jpeg',
    '.m4a',
    '.mp3',
    '.ogg',
    '.png',
    '.svg',
    '.wav',
    '.webp',
  ])
  const extension = extname(request.url().split('?')[0] ?? '').toLowerCase()
  const useImmutableCache = immutableExtensions.has(extension)

  response.header(
    'Cache-Control',
    useImmutableCache ? 'public, max-age=31536000, immutable' : 'public, max-age=3600'
  )

  const filePath = app.makePath('storage', request.url())
  return response.download(filePath)
})

/*
|--------------------------------------------------------------------------
| Auth routes (guest only for login, any for logout)
|--------------------------------------------------------------------------
*/

router.group(() => {
  router.get('/setup/bootstrap', [BootstrapController, 'show']).use(middleware.guest())
  router
    .post('/setup/bootstrap', [BootstrapController, 'store'])
    .use([
      middleware.guest(),
      middleware.throttle({ maxRequests: authThrottleLimit, windowMs: 60_000 }),
    ])

  router.get('/login', [LoginController, 'show']).use(middleware.guest())
  router
    .post('/login', [LoginController, 'store'])
    .use([
      middleware.guest(),
      middleware.throttle({ maxRequests: authThrottleLimit, windowMs: 60_000 }),
    ])

  router.get('/register', [RegisterController, 'show']).use(middleware.guest())
  router
    .post('/register', [RegisterController, 'store'])
    .use([
      middleware.guest(),
      middleware.throttle({ maxRequests: authThrottleLimit, windowMs: 60_000 }),
    ])

  router.get('/forgot-password', [PasswordResetController, 'showForgot']).use(middleware.guest())
  router
    .post('/forgot-password', [PasswordResetController, 'sendReset'])
    .use([
      middleware.guest(),
      middleware.throttle({ maxRequests: authThrottleLimit, windowMs: 60_000 }),
    ])
  router
    .get('/reset-password/:token', [PasswordResetController, 'showReset'])
    .use(middleware.guest())
  router
    .post('/reset-password/:token', [PasswordResetController, 'reset'])
    .use([
      middleware.guest(),
      middleware.throttle({ maxRequests: authThrottleLimit, windowMs: 60_000 }),
    ])

  router
    .get('/register/invite/:token', [InviteRegistrationController, 'show'])
    .use(middleware.guest())
  router
    .post('/register/invite/:token', [InviteRegistrationController, 'store'])
    .use([
      middleware.guest(),
      middleware.throttle({ maxRequests: authThrottleLimit, windowMs: 60_000 }),
    ])
})

router.get('/auth/:provider/redirect', [OidcController, 'redirect'])
router.get('/auth/:provider/callback', [OidcController, 'callback'])
router.get('/email/verify/:token', [EmailVerificationController, 'verify'])
router.get('/profile/iban/verify/:token', [IbanChangeController, 'verify'])

router.get('/logout', [LoginController, 'destroy']).use(middleware.auth()).as('logout.get')
router.post('/logout', [LoginController, 'destroy']).use(middleware.auth()).as('logout.post')

// Stop impersonation — requires auth only (impersonation middleware has already run)
router.post('/impersonate/stop', [AdminImpersonationController, 'destroy']).use(middleware.auth())

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
    router.put('/profile/excluded-allergens', [ProfileController, 'updateExcludedAllergens'])
    router.post('/profile/color-mode', [ProfileController, 'toggleColorMode'])
    router.post('/profile/favorites/:id', [ProfileController, 'toggleFavorite'])

    // Personal API tokens
    router.post('/profile/tokens', [ProfileController, 'createToken'])
    router.delete('/profile/tokens/:id', [ProfileController, 'revokeToken'])
    router.put('/profile/password', [PasswordResetController, 'changeAuthenticated'])
    router.post('/profile/reauth', [ProfileController, 'reauthSensitive'])
    router.post('/profile/oidc-link', [ProfileController, 'startOidcLink'])
    router.post('/profile/email-verification/resend', [EmailVerificationController, 'resend'])
    router.post('/profile/iban-verification/resend', [IbanChangeController, 'resend'])

    // Audit log (customer view)
    router.get('/audit', [AuditController, 'index'])
  })
  .use([middleware.auth(), middleware.kiosk(), middleware.emailVerified()])

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
    router.post('/invoice/generate/:buyerId', [SupplierInvoiceController, 'generateForBuyer'])

    // Payments
    router.get('/payments', [SupplierPaymentsController, 'index'])
    router.post('/payments/:id', [SupplierPaymentsController, 'update'])

    // Stock overview
    router.get('/stock', [SupplierStockController, 'index'])

    // Product management
    router.get('/products', [SupplierProductsController, 'index'])
    router.get('/products/new', [SupplierProductsController, 'create'])
    router.post('/products', [SupplierProductsController, 'store'])
    router.get('/products/:id/edit', [SupplierProductsController, 'edit'])
    router.put('/products/:id', [SupplierProductsController, 'update'])
  })
  .prefix('/supplier')
  .use([
    middleware.auth(),
    middleware.kiosk(),
    middleware.emailVerified(),
    middleware.role({ roles: ['supplier'] }),
  ])

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
    router.post('/invitations', [AdminInvitationsController, 'store'])
    router.post('/invitations/:id/revoke', [AdminInvitationsController, 'revoke'])

    // Category management
    router.get('/categories', [AdminCategoriesController, 'index'])
    router.post('/categories', [AdminCategoriesController, 'store'])
    router.put('/categories/:id', [AdminCategoriesController, 'update'])
    router.delete('/categories/:id', [AdminCategoriesController, 'destroy'])

    // Allergen management
    router.get('/allergens', [AdminAllergensController, 'index'])
    router.post('/allergens', [AdminAllergensController, 'store'])
    router.put('/allergens/:id', [AdminAllergensController, 'update'])
    router.delete('/allergens/:id', [AdminAllergensController, 'destroy'])

    // Music tracks management
    router.get('/music', [AdminMusicTracksController, 'index'])
    router.post('/music', [AdminMusicTracksController, 'store'])
    router.put('/music/:id', [AdminMusicTracksController, 'update'])
    router.delete('/music/:id', [AdminMusicTracksController, 'destroy'])

    // Orders & invoices oversight
    router.get('/orders', [AdminOrdersController, 'index'])
    router.get('/invoices', [AdminInvoicesController, 'index'])

    // Storno
    router.post('/storno/:id', [AdminStornoController, 'store'])

    // Audit log
    router.get('/audit', [AdminAuditController, 'index'])

    // Impersonation
    router.post('/users/:id/impersonate', [AdminImpersonationController, 'store'])

    // Generate invoice for a user (across all suppliers)
    router.post('/users/:id/generate-invoice', [AdminUsersController, 'generateInvoice'])
    router.post('/users/:id/send-password-reset', [AdminUsersController, 'sendPasswordReset'])
  })
  .prefix('/admin')
  .use([middleware.auth(), middleware.emailVerified(), middleware.role({ roles: ['admin'] })])

/*
|--------------------------------------------------------------------------
| Kiosk routes (auth required, kiosk users only)
|--------------------------------------------------------------------------
*/

router
  .group(() => {
    router.get('/kiosk', [KioskController, 'index'])
    router.get('/kiosk/customer', [KioskController, 'identify'])
    router.post('/kiosk/purchase-basket', [KioskController, 'purchaseBasket'])
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
    router
      .post('/auth/login', [ApiAuthController, 'login'])
      .use(middleware.throttle({ maxRequests: authThrottleLimit, windowMs: 60_000 }))
    router
      .post('/auth/token', [ApiAuthController, 'token'])
      .use(middleware.throttle({ maxRequests: authThrottleLimit, windowMs: 60_000 }))

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

/*
|--------------------------------------------------------------------------
| Swagger UI (only when SWAGGER_ENABLED=true)
|--------------------------------------------------------------------------
*/

if (env.get('SWAGGER_ENABLED')) {
  const autoswagger = await import('adonis-autoswagger')
  const swagger = autoswagger.default.default
  const swaggerModule = await import('../config/swagger.js')
  const swaggerConfig = swaggerModule.default
  const keepOnlyApiV1 = (spec: any) => {
    spec.paths = Object.fromEntries(
      Object.entries(spec.paths ?? {}).filter(([path]) => path.startsWith('/api/v1'))
    )

    const usedTags = new Set<string>()
    const operations: any[] = Object.values(spec.paths ?? {}).flatMap((pathItem: any) =>
      Object.values((pathItem ?? {}) as Record<string, any>)
    )
    for (const operation of operations) {
      for (const tag of operation?.tags ?? []) {
        if (typeof tag === 'string') usedTags.add(tag)
      }
    }

    spec.tags = (spec.tags ?? []).filter((tag: any) => usedTags.has(tag?.name))
  }

  router.get('/swagger', async ({ response }) => {
    const routes = router.toJSON() as any
    const flattenedRoutes = Array.isArray(routes)
      ? routes
      : Object.values(routes).flatMap((domainRoutes: any) =>
          Array.isArray(domainRoutes) ? domainRoutes : []
        )
    const normalizedRoutes = { root: flattenedRoutes }
    try {
      const spec = await swagger.json(normalizedRoutes, swaggerConfig)
      keepOnlyApiV1(spec)
      return response.json(spec)
    } catch (error: any) {
      // In production, adonis-autoswagger reads a pre-generated swagger.json.
      // If the file is missing in the image, generate docs at runtime as fallback.
      if (error?.code === 'ENOENT') {
        const runtimeSwagger = swagger as any
        const spec = await runtimeSwagger.generate(normalizedRoutes, swaggerConfig)
        keepOnlyApiV1(spec)
        return response.json(spec)
      }
      throw error
    }
  })

  router.get('/docs', async ({ response }) => {
    return response.header('Content-Type', 'text/html').send(swagger.ui('/swagger', swaggerConfig))
  })
}
