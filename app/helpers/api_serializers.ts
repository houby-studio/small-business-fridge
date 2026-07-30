import type Order from '#models/order'
import type {
  OrderResponse,
  OrderWithDeliveryResponse,
  OrderDeliveryRef,
} from '#interfaces/api_responses'

/**
 * Shared order serialization for the REST API. Returning the named DTO types from
 * `#interfaces/api_responses` means any drift between the documented schema and the
 * real payload fails `tsc`.
 */
export function serializeOrder(order: Order): OrderResponse {
  return {
    id: order.id,
    buyerId: order.buyerId,
    deliveryId: order.deliveryId,
    // A freshly created order has no invoiceId column value in memory yet —
    // normalize undefined to null so the key is always present in the JSON.
    invoiceId: order.invoiceId ?? null,
    channel: order.channel,
    createdAt: order.createdAt?.toISO() ?? null,
    updatedAt: order.updatedAt?.toISO() ?? null,
  }
}

export function serializeOrderWithDelivery(order: Order): OrderWithDeliveryResponse {
  let delivery: OrderDeliveryRef | null = null
  if (order.delivery) {
    delivery = {
      id: order.delivery.id,
      supplierId: order.delivery.supplierId,
      productId: order.delivery.productId,
      amountSupplied: order.delivery.amountSupplied,
      amountLeft: order.delivery.amountLeft,
      price: order.delivery.price,
      createdAt: order.delivery.createdAt?.toISO() ?? null,
      product: order.delivery.product
        ? {
            id: order.delivery.product.id,
            displayName: order.delivery.product.displayName,
            barcode: order.delivery.product.barcode,
            imagePath: order.delivery.product.imagePath,
          }
        : null,
      supplier: order.delivery.supplier
        ? {
            id: order.delivery.supplier.id,
            displayName: order.delivery.supplier.displayName,
          }
        : null,
    }
  }

  return {
    ...serializeOrder(order),
    delivery,
  }
}
