export interface User {
  id: number
  displayName: string
  email: string
  role: 'customer' | 'supplier' | 'admin'
  isKiosk: boolean
  colorMode: 'light' | 'dark'
  keypadId: number
}

export interface FlashMessages {
  alert?: {
    type: 'success' | 'info' | 'warn' | 'danger'
    message: string
  }
  errors?: Record<string, string[]>
  [key: string]: unknown
}

export interface SharedProps {
  user: User | null
  flash: FlashMessages
}

export interface Category {
  id: number
  name: string
  color: string
  isDisabled: boolean
}

export interface Product {
  id: number
  keypadId: number
  displayName: string
  description: string | null
  imagePath: string | null
  barcode: string | null
  categoryId: number
  category?: Category
}

export interface Delivery {
  id: number
  supplierId: number
  productId: number
  amountSupplied: number
  amountLeft: number
  price: number
  createdAt: string
  product?: Product
}

export interface Order {
  id: number
  buyerId: number
  deliveryId: number
  invoiceId: number | null
  channel: 'web' | 'keypad' | 'scanner'
  createdAt: string
  delivery?: Delivery
}

export interface Invoice {
  id: number
  buyerId: number
  supplierId: number
  totalCost: number
  isPaid: boolean
  isPaymentRequested: boolean
  createdAt: string
  orders?: Order[]
}
