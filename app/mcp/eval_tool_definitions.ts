/**
 * OpenAI / Azure OpenAI format tool definitions for the MCP eval framework.
 * These mirror the actual MCP tool schemas so the AI model under test receives
 * the same interface it would in production.
 *
 * Format: https://platform.openai.com/docs/api-reference/chat/create#chat-create-tools
 */

import type { ChatCompletionTool } from 'openai/resources/chat/completions'

export type EvalToolDefinition = ChatCompletionTool

export const evalToolDefinitions: EvalToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'list_products',
      description:
        'List products in the fridge shop with current stock and price. ' +
        'Each product includes deliveryId — the cheapest in-stock delivery lot, ' +
        'which is what you pass to buy_product. By default only in-stock products are returned.',
      parameters: {
        type: 'object',
        properties: {
          showOutOfStock: {
            type: 'boolean',
            description: 'Set true to include products that are currently out of stock',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'buy_product',
      description:
        'Buy a product from the fridge (1-click purchase, pay later via invoice). ' +
        'Pass either deliveryId (from list_products) or productId (cheapest lot chosen ' +
        'automatically). Quantity defaults to 1 (max 10 per call).',
      parameters: {
        type: 'object',
        properties: {
          deliveryId: { type: 'number', description: 'Delivery lot to buy from (preferred)' },
          productId: { type: 'number', description: 'Product to buy (cheapest lot used)' },
          quantity: { type: 'number', description: 'Units to buy (default 1, max 10)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_my_orders',
      description: 'List your orders (purchases), newest first. Filter by invoiced status.',
      parameters: {
        type: 'object',
        properties: {
          page: { type: 'number' },
          perPage: { type: 'number' },
          invoiced: { type: 'string', enum: ['yes', 'no'] },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_my_invoices',
      description:
        'List your invoices. Status: "unpaid" = waiting for you to pay, ' +
        '"awaiting" = you reported the payment and the supplier has not confirmed yet, ' +
        '"paid" = confirmed by the supplier.',
      parameters: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['paid', 'unpaid', 'awaiting'] },
          page: { type: 'number' },
          perPage: { type: 'number' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_payment_qr',
      description:
        'Get the Czech SPD QR payment string (and bank details) for one of your invoices.',
      parameters: {
        type: 'object',
        properties: {
          invoiceId: { type: 'number', description: 'Your invoice ID' },
        },
        required: ['invoiceId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'request_payment',
      description:
        'Mark one of your invoices as paid (after sending the bank transfer). ' +
        'The supplier then confirms or rejects the payment.',
      parameters: {
        type: 'object',
        properties: {
          invoiceId: { type: 'number', description: 'Your invoice ID' },
        },
        required: ['invoiceId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_recommendations',
      description: 'Get personally recommended products based on your purchase history.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Max results (default 4)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_stock',
      description:
        'Supplier: add stock for a product — creates a new delivery lot with a unit price.',
      parameters: {
        type: 'object',
        properties: {
          productId: { type: 'number', description: 'Product to stock' },
          amount: { type: 'number', description: 'Number of units delivered' },
          price: { type: 'number', description: 'Unit price in CZK for this lot' },
        },
        required: ['productId', 'amount', 'price'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_stock',
      description:
        'Supplier: stock overview grouped by product with low-stock alerts and top movers.',
      parameters: {
        type: 'object',
        properties: {
          scope: { type: 'string', enum: ['store', 'mine'] },
          categoryId: { type: 'number' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_catalog_products',
      description:
        'Supplier: browse the shared product catalog (including out-of-stock) with search. ' +
        'Use to find productId for add_stock or update_product.',
      parameters: {
        type: 'object',
        properties: {
          search: { type: 'string', description: 'Search by name or barcode' },
          categoryId: { type: 'number' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_product',
      description:
        'Supplier: create a new product in the shared catalog (without an image). ' +
        'Idempotent by name.',
      parameters: {
        type: 'object',
        properties: {
          displayName: { type: 'string' },
          description: { type: 'string' },
          categoryId: { type: 'number' },
          barcode: { type: 'string' },
        },
        required: ['displayName', 'categoryId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'uninvoiced_summary',
      description:
        'Supplier: summary of your uninvoiced orders grouped by buyer — who owes you how much.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'generate_invoices',
      description:
        'Supplier: generate invoices for your uninvoiced orders — one per buyer, ' +
        'or only for the given buyerId.',
      parameters: {
        type: 'object',
        properties: {
          buyerId: { type: 'number', description: 'Only invoice this buyer' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_issued_invoices',
      description:
        'Supplier: list invoices you issued. Status "awaiting" = buyer reported a payment ' +
        'waiting for your confirmation.',
      parameters: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['paid', 'unpaid', 'awaiting'] },
          buyerId: { type: 'number' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'approve_payment',
      description:
        'Supplier: confirm that you received the payment for one of your issued invoices.',
      parameters: {
        type: 'object',
        properties: {
          invoiceId: { type: 'number' },
        },
        required: ['invoiceId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_users',
      description: 'Admin: list user accounts with role and status filters.',
      parameters: {
        type: 'object',
        properties: {
          role: { type: 'string', enum: ['customer', 'supplier', 'admin'] },
          disabled: { type: 'string', enum: ['enabled', 'disabled'] },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_user',
      description: 'Admin: update a user account — change role, enable/disable, keypad ID.',
      parameters: {
        type: 'object',
        properties: {
          userId: { type: 'number' },
          role: { type: 'string', enum: ['customer', 'supplier', 'admin'] },
          isDisabled: { type: 'boolean' },
          keypadId: { type: 'number' },
        },
        required: ['userId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'storno_order',
      description:
        'Admin: cancel (storno) an order — restores stock. Only for not-yet-invoiced orders.',
      parameters: {
        type: 'object',
        properties: {
          orderId: { type: 'number' },
        },
        required: ['orderId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_audit_logs',
      description:
        'Admin: query the system audit log (actions like order.created, payment.approved, user.updated).',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string' },
          entityType: { type: 'string' },
          userId: { type: 'number' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'dashboard_stats',
      description: 'Admin: global dashboard statistics (users, orders, revenue, stock).',
      parameters: { type: 'object', properties: {} },
    },
  },
]
