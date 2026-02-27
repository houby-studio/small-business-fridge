import '@adonisjs/inertia/types'

import type { VNodeProps, AllowedComponentProps, ComponentInstance } from 'vue'

type ExtractProps<T> = Omit<
  ComponentInstance<T>['$props'],
  keyof VNodeProps | keyof AllowedComponentProps
>

declare module '@adonisjs/inertia/types' {
  export interface InertiaPages {
    'admin/allergens/index': ExtractProps<(typeof import('../../inertia/pages/admin/allergens/index.vue'))['default']>
    'admin/audit/index': ExtractProps<(typeof import('../../inertia/pages/admin/audit/index.vue'))['default']>
    'admin/categories/index': ExtractProps<(typeof import('../../inertia/pages/admin/categories/index.vue'))['default']>
    'admin/dashboard': ExtractProps<(typeof import('../../inertia/pages/admin/dashboard.vue'))['default']>
    'admin/invoices/index': ExtractProps<(typeof import('../../inertia/pages/admin/invoices/index.vue'))['default']>
    'admin/music/index': ExtractProps<(typeof import('../../inertia/pages/admin/music/index.vue'))['default']>
    'admin/orders/index': ExtractProps<(typeof import('../../inertia/pages/admin/orders/index.vue'))['default']>
    'admin/users/index': ExtractProps<(typeof import('../../inertia/pages/admin/users/index.vue'))['default']>
    'audit/index': ExtractProps<(typeof import('../../inertia/pages/audit/index.vue'))['default']>
    'auth/bootstrap': ExtractProps<(typeof import('../../inertia/pages/auth/bootstrap.vue'))['default']>
    'auth/login': ExtractProps<(typeof import('../../inertia/pages/auth/login.vue'))['default']>
    'errors/not_found': ExtractProps<(typeof import('../../inertia/pages/errors/not_found.vue'))['default']>
    'errors/server_error': ExtractProps<(typeof import('../../inertia/pages/errors/server_error.vue'))['default']>
    'home': ExtractProps<(typeof import('../../inertia/pages/home.vue'))['default']>
    'invoices/index': ExtractProps<(typeof import('../../inertia/pages/invoices/index.vue'))['default']>
    'kiosk/index': ExtractProps<(typeof import('../../inertia/pages/kiosk/index.vue'))['default']>
    'kiosk/shop': ExtractProps<(typeof import('../../inertia/pages/kiosk/shop.vue'))['default']>
    'orders/index': ExtractProps<(typeof import('../../inertia/pages/orders/index.vue'))['default']>
    'profile/show': ExtractProps<(typeof import('../../inertia/pages/profile/show.vue'))['default']>
    'shop/index': ExtractProps<(typeof import('../../inertia/pages/shop/index.vue'))['default']>
    'supplier/deliveries/index': ExtractProps<(typeof import('../../inertia/pages/supplier/deliveries/index.vue'))['default']>
    'supplier/invoice/index': ExtractProps<(typeof import('../../inertia/pages/supplier/invoice/index.vue'))['default']>
    'supplier/payments/index': ExtractProps<(typeof import('../../inertia/pages/supplier/payments/index.vue'))['default']>
    'supplier/products/create': ExtractProps<(typeof import('../../inertia/pages/supplier/products/create.vue'))['default']>
    'supplier/products/edit': ExtractProps<(typeof import('../../inertia/pages/supplier/products/edit.vue'))['default']>
    'supplier/products/index': ExtractProps<(typeof import('../../inertia/pages/supplier/products/index.vue'))['default']>
    'supplier/stock/index': ExtractProps<(typeof import('../../inertia/pages/supplier/stock/index.vue'))['default']>
  }
}
