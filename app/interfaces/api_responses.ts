/**
 * Named response DTOs for the REST API. These describe the EXACT serialized shapes
 * the API returns (camelCase, flattened relations) — NOT the raw Lucid models.
 *
 * They are:
 *  - referenced from controller `@responseBody 200 - <XxxResponse>` annotations so
 *    autoswagger emits them as named, reusable schemas (visible in Scalar), and
 *  - used as the return types of the serializers in `#helpers/*`, so a drift between
 *    the documented schema and the real serializer output fails `tsc`.
 *
 * Keep these self-contained (no imports) — autoswagger's InterfaceParser reads the
 * source textually.
 */

export interface CategoryRef {
  id: number
  name: string
  color: string
}

export interface AllergenRef {
  id: number
  name: string
}

export interface ProductResponse {
  id: number
  keypadId: number
  displayName: string
  description: string | null
  imagePath: string | null
  barcode: string | null
  category: CategoryRef
  allergens: AllergenRef[]
  stockSum: number
  isFavorite: boolean
  price: number | null
  deliveryId: number | null
}

export interface ProductListResponse {
  data: ProductResponse[]
}

/** Product detail returned by the barcode lookup — category is flattened to its name. */
export interface ProductBarcodeDetail {
  id: number
  keypadId: number
  displayName: string
  barcode: string | null
  category: string
  allergens: AllergenRef[]
  stockSum: number
  price: number | null
  deliveryId: number | null
}

export interface ProductBarcodeResponse {
  data: ProductBarcodeDetail
}

export interface OrderResponse {
  id: number
  buyerId: number
  deliveryId: number
  invoiceId: number | null
  channel: string
  createdAt: string | null
  updatedAt: string | null
}

export interface OrderCreatedResponse {
  data: OrderResponse
}

export interface OrderProductRef {
  id: number
  displayName: string
  barcode: string | null
  imagePath: string | null
}

export interface OrderSupplierRef {
  id: number
  displayName: string
}

export interface OrderDeliveryRef {
  id: number
  supplierId: number
  productId: number
  amountSupplied: number
  amountLeft: number
  price: number
  createdAt: string | null
  product: OrderProductRef | null
  supplier: OrderSupplierRef | null
}

export interface OrderWithDeliveryResponse {
  id: number
  buyerId: number
  deliveryId: number
  invoiceId: number | null
  channel: string
  createdAt: string | null
  updatedAt: string | null
  delivery: OrderDeliveryRef | null
}

/** Pagination envelope used by list endpoints. */
export interface ApiPaginationMeta {
  total: number
  perPage: number
  currentPage: number
  lastPage: number
}

export interface OrderPage {
  meta: ApiPaginationMeta
  data: OrderWithDeliveryResponse[]
}

export interface OrderListResponse {
  data: OrderPage
}

export interface CustomerRef {
  id: number
  displayName: string
  role: string
}

export interface CustomerResponse {
  data: CustomerRef
}

export interface CustomerInsights {
  orderCount: number
  totalSpend: number
  uninvoicedSpend: number
  invoiceCount: number
  unpaidInvoiceCount: number
  pendingApprovalInvoiceCount: number
  lastOrderAt: string | null
}

export interface CustomerInsightsResponse {
  data: CustomerInsights
}

export interface AuthUserRef {
  id: number
  displayName: string
  email: string
  role: string
}

export interface TokenResponse {
  token: string
  user: AuthUserRef
}

export interface KioskUserRef {
  id: number
  displayName: string
  keypadId: number | null
  role: string
}

export interface KioskTokenResponse {
  token: string
  user: KioskUserRef
}

export interface ApiErrorResponse {
  error: string
}
