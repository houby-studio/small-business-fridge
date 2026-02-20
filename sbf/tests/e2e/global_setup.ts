import { execSync } from 'node:child_process'
import { Scrypt } from '@adonisjs/hash/drivers/scrypt'
import pg from 'pg'

const { Client } = pg

const DB_CONFIG = {
  host: '127.0.0.1',
  port: 5433,
  user: 'sbf',
  password: 'sbf',
  database: 'sbf_test',
}

const SCRYPT_CONFIG = {
  cost: 16384,
  blockSize: 8,
  parallelization: 1,
  saltSize: 16,
  keyLength: 64,
  maxMemory: 33554432,
}

const TEST_ENV = {
  ...process.env,
  NODE_ENV: 'test',
  PORT: '3334',
  HOST: 'localhost',
  SESSION_DRIVER: 'memory',
  LOG_LEVEL: 'silent',
  APP_KEY: 'test-app-key-for-testing-only-123',
  DB_HOST: '127.0.0.1',
  DB_PORT: '5433',
  DB_USER: 'sbf',
  DB_PASSWORD: 'sbf',
  DB_DATABASE: 'sbf_test',
  OIDC_ENABLED: 'false',
  API_SECRET: 'test-api-secret',
  APP_URL: 'http://localhost:3334',
}

/**
 * Playwright global setup:
 * 1. Run DB migrations on the test DB
 * 2. Seed E2E test users (admin, supplier, customer, kiosk)
 *    We insert users directly via SQL because the dev seeder skips non-dev environments.
 * 3. Seed categories, products, deliveries, orders, and invoices
 *    so the UI has enough data to render lists, pagination, and charts.
 */
export default async function globalSetup() {
  // 1. Run migrations
  execSync('node ace migration:run --force', { env: TEST_ENV, stdio: 'pipe' })

  // 2. Hash passwords using AdonisJS scrypt driver
  const scrypt = new Scrypt(SCRYPT_CONFIG)

  const users = [
    {
      username: 'admin',
      email: 'admin@localhost',
      display_name: 'Admin User',
      password: await scrypt.make('admin123'),
      role: 'admin',
      keypad_id: 89990,
      iban: 'CZ6508000000192000145399',
    },
    {
      username: 'supplier',
      email: 'supplier@localhost',
      display_name: 'Supplier User',
      password: await scrypt.make('supplier123'),
      role: 'supplier',
      keypad_id: 89991,
      iban: 'CZ6508000000192000145399',
    },
    {
      username: 'customer',
      email: 'customer@localhost',
      display_name: 'Customer User',
      password: await scrypt.make('customer123'),
      role: 'customer',
      keypad_id: 89992,
      iban: null,
    },
    {
      username: 'customer2',
      email: 'customer2@localhost',
      display_name: 'Second Customer',
      password: await scrypt.make('customer123'),
      role: 'customer',
      keypad_id: 89994,
      iban: null,
    },
    {
      username: 'kiosk',
      email: 'kiosk@localhost',
      display_name: 'Kiosk Device',
      password: await scrypt.make('kiosk123'),
      role: 'customer',
      keypad_id: 89993,
      iban: null,
    },
  ]

  // 3. Insert/upsert users into the test DB
  const client = new Client(DB_CONFIG)
  await client.connect()

  for (const user of users) {
    await client.query(
      `
      INSERT INTO users (
        username, email, display_name, password, role, keypad_id, iban,
        is_kiosk, is_disabled, show_all_products, send_mail_on_purchase,
        send_daily_report, color_mode, keypad_disabled,
        created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7,
        false, false, false, true,
        true, 'dark', false,
        NOW(), NOW()
      )
      ON CONFLICT (username) DO UPDATE SET
        email = EXCLUDED.email,
        display_name = EXCLUDED.display_name,
        password = EXCLUDED.password,
        role = EXCLUDED.role
    `,
      [
        user.username,
        user.email,
        user.display_name,
        user.password,
        user.role,
        user.keypad_id,
        user.iban,
      ]
    )
  }

  // 4. Seed categories
  const categories = [
    { name: 'Nealko', color: '#2196F3' },
    { name: 'Alko', color: '#F44336' },
    { name: 'Jídlo', color: '#4CAF50' },
    { name: 'Sladkosti', color: '#FF9800' },
  ]

  const categoryIds: Record<string, number> = {}
  for (const cat of categories) {
    const result = await client.query(
      `INSERT INTO categories (name, color, is_disabled, created_at, updated_at)
       VALUES ($1, $2, false, NOW(), NOW())
       ON CONFLICT (name) DO UPDATE SET color = EXCLUDED.color
       RETURNING id`,
      [cat.name, cat.color]
    )
    categoryIds[cat.name] = result.rows[0].id
  }

  // 5. Seed 15 products across all categories
  const products = [
    // Nealko (6 products)
    {
      keypadId: 1,
      displayName: 'Coca-Cola 0.5L',
      description: 'Osvěžující nápoj',
      category: 'Nealko',
      price: 15,
    },
    {
      keypadId: 2,
      displayName: 'Mattoni 0.5L',
      description: 'Přírodní minerální voda',
      category: 'Nealko',
      price: 12,
    },
    {
      keypadId: 6,
      displayName: 'Sprite 0.5L',
      description: 'Citronová limonáda',
      category: 'Nealko',
      price: 15,
    },
    {
      keypadId: 7,
      displayName: 'Fanta 0.5L',
      description: 'Pomerančová limonáda',
      category: 'Nealko',
      price: 15,
    },
    {
      keypadId: 8,
      displayName: 'Red Bull 0.25L',
      description: 'Energetický nápoj',
      category: 'Nealko',
      price: 45,
    },
    {
      keypadId: 9,
      displayName: 'Džus pomeranč 0.33L',
      description: '100% pomerančový džus',
      category: 'Nealko',
      price: 20,
    },
    // Alko (3 products)
    {
      keypadId: 3,
      displayName: 'Plzeň 0.5L',
      description: 'České pivo',
      category: 'Alko',
      price: 25,
    },
    {
      keypadId: 10,
      displayName: 'Kozel 0.5L',
      description: 'Tmavé pivo',
      category: 'Alko',
      price: 25,
    },
    {
      keypadId: 11,
      displayName: 'Heineken 0.33L',
      description: 'Holandské pivo',
      category: 'Alko',
      price: 30,
    },
    // Sladkosti (3 products)
    {
      keypadId: 4,
      displayName: 'Snickers',
      description: 'Čokoládová tyčinka',
      category: 'Sladkosti',
      price: 18,
    },
    {
      keypadId: 12,
      displayName: 'Mars',
      description: 'Čokoládová tyčinka',
      category: 'Sladkosti',
      price: 18,
    },
    {
      keypadId: 13,
      displayName: 'Haribo 100g',
      description: 'Gumové medvídky',
      category: 'Sladkosti',
      price: 20,
    },
    // Jídlo (3 products)
    {
      keypadId: 5,
      displayName: "Chipsy Lay's",
      description: 'Bramborové lupínky',
      category: 'Jídlo',
      price: 30,
    },
    {
      keypadId: 14,
      displayName: 'Müsli tyčinka',
      description: 'Zdravá svačina',
      category: 'Jídlo',
      price: 15,
    },
    {
      keypadId: 15,
      displayName: 'Krekry 100g',
      description: 'Slané krekry',
      category: 'Jídlo',
      price: 20,
    },
  ]

  const productIds: Record<number, number> = {}
  for (const prod of products) {
    const result = await client.query(
      `INSERT INTO products (keypad_id, display_name, description, image_path, category_id, created_at, updated_at)
       VALUES ($1, $2, $3, '', $4, NOW(), NOW())
       ON CONFLICT (keypad_id) DO UPDATE SET
         display_name = EXCLUDED.display_name,
         category_id = EXCLUDED.category_id
       RETURNING id`,
      [prod.keypadId, prod.displayName, prod.description, categoryIds[prod.category]]
    )
    productIds[prod.keypadId] = result.rows[0].id
  }

  // 6. Get user IDs
  const supplierResult = await client.query('SELECT id FROM users WHERE username = $1', [
    'supplier',
  ])
  const supplierId = supplierResult.rows[0].id

  const customerResult = await client.query('SELECT id FROM users WHERE username = $1', [
    'customer',
  ])
  const customerId = customerResult.rows[0].id

  const customer2Result = await client.query('SELECT id FROM users WHERE username = $1', [
    'customer2',
  ])
  const customer2Id = customer2Result.rows[0].id

  // 7. Reset and recreate deliveries for all test products
  const testKeypadIds = products.map((p) => p.keypadId)

  await client.query(
    `DELETE FROM orders
     WHERE delivery_id IN (
       SELECT d.id FROM deliveries d
       INNER JOIN products p ON p.id = d.product_id
       WHERE p.keypad_id = ANY($1::int[])
     )`,
    [testKeypadIds]
  )

  await client.query(
    `DELETE FROM deliveries
     WHERE product_id IN (
       SELECT id FROM products WHERE keypad_id = ANY($1::int[])
     )`,
    [testKeypadIds]
  )

  // Create deliveries with generous stock
  const deliveryIds: Record<number, number> = {}
  for (const prod of products) {
    const result = await client.query(
      `INSERT INTO deliveries (supplier_id, product_id, amount_supplied, amount_left, price, created_at, updated_at)
       VALUES ($1, $2, 50, 50, $3, NOW() - interval '30 days', NOW())
       RETURNING id`,
      [supplierId, productIds[prod.keypadId], prod.price]
    )
    deliveryIds[prod.keypadId] = result.rows[0].id
  }

  // 8. Delete existing invoices (they reference orders)
  await client.query(`DELETE FROM invoices WHERE supplier_id = $1`, [supplierId])

  // 9. Seed 35 orders for customer spread across products and time
  //    Each order decrements stock from the delivery
  const orderItems = [
    // Orders 1-10: various products, older dates, will become invoiced
    { buyerId: customerId, keypadId: 1, daysAgo: 28, channel: 'web' },
    { buyerId: customerId, keypadId: 2, daysAgo: 27, channel: 'web' },
    { buyerId: customerId, keypadId: 3, daysAgo: 26, channel: 'kiosk' },
    { buyerId: customerId, keypadId: 4, daysAgo: 25, channel: 'web' },
    { buyerId: customerId, keypadId: 5, daysAgo: 24, channel: 'web' },
    { buyerId: customerId, keypadId: 1, daysAgo: 23, channel: 'web' },
    { buyerId: customerId, keypadId: 6, daysAgo: 22, channel: 'scanner' },
    { buyerId: customerId, keypadId: 7, daysAgo: 21, channel: 'web' },
    { buyerId: customerId, keypadId: 8, daysAgo: 20, channel: 'web' },
    { buyerId: customerId, keypadId: 2, daysAgo: 19, channel: 'web' },
    // Orders 11-20: mid-range, also invoiced
    { buyerId: customerId, keypadId: 9, daysAgo: 18, channel: 'web' },
    { buyerId: customerId, keypadId: 10, daysAgo: 17, channel: 'web' },
    { buyerId: customerId, keypadId: 11, daysAgo: 16, channel: 'web' },
    { buyerId: customerId, keypadId: 12, daysAgo: 15, channel: 'web' },
    { buyerId: customerId, keypadId: 3, daysAgo: 14, channel: 'kiosk' },
    { buyerId: customerId, keypadId: 13, daysAgo: 13, channel: 'web' },
    { buyerId: customerId, keypadId: 14, daysAgo: 12, channel: 'web' },
    { buyerId: customerId, keypadId: 1, daysAgo: 11, channel: 'web' },
    { buyerId: customerId, keypadId: 15, daysAgo: 10, channel: 'web' },
    { buyerId: customerId, keypadId: 5, daysAgo: 9, channel: 'web' },
    // Orders 21-25: recent, uninvoiced
    { buyerId: customerId, keypadId: 1, daysAgo: 4, channel: 'web' },
    { buyerId: customerId, keypadId: 2, daysAgo: 3, channel: 'web' },
    { buyerId: customerId, keypadId: 8, daysAgo: 2, channel: 'web' },
    { buyerId: customerId, keypadId: 3, daysAgo: 1, channel: 'kiosk' },
    { buyerId: customerId, keypadId: 4, daysAgo: 0, channel: 'web' },
    // Orders 26-35: customer2 orders (for supplier view diversity)
    { buyerId: customer2Id, keypadId: 1, daysAgo: 20, channel: 'web' },
    { buyerId: customer2Id, keypadId: 3, daysAgo: 18, channel: 'web' },
    { buyerId: customer2Id, keypadId: 5, daysAgo: 15, channel: 'web' },
    { buyerId: customer2Id, keypadId: 6, daysAgo: 10, channel: 'web' },
    { buyerId: customer2Id, keypadId: 8, daysAgo: 5, channel: 'web' },
    { buyerId: customer2Id, keypadId: 1, daysAgo: 3, channel: 'web' },
    { buyerId: customer2Id, keypadId: 2, daysAgo: 2, channel: 'web' },
    { buyerId: customer2Id, keypadId: 4, daysAgo: 1, channel: 'web' },
  ]

  const orderIds: number[] = []
  for (const item of orderItems) {
    const deliveryId = deliveryIds[item.keypadId]
    const createdAt = `NOW() - interval '${item.daysAgo} days'`

    // Decrement delivery stock
    await client.query(`UPDATE deliveries SET amount_left = amount_left - 1 WHERE id = $1`, [
      deliveryId,
    ])

    const result = await client.query(
      `INSERT INTO orders (buyer_id, delivery_id, channel, created_at, updated_at)
       VALUES ($1, $2, $3, ${createdAt}, ${createdAt})
       RETURNING id`,
      [item.buyerId, deliveryId, item.channel]
    )
    orderIds.push(result.rows[0].id)
  }

  // 10. Create invoices in three states for customer:
  //     - Invoice 1 (oldest, orders 1-10): PAID
  //     - Invoice 2 (mid, orders 11-20): payment requested (awaiting approval)
  //     - Orders 21-25 remain uninvoiced

  // Invoice 1: paid (orders 1-10, customer)
  const inv1Cost = orderItems.slice(0, 10).reduce((acc, item) => {
    const prod = products.find((p) => p.keypadId === item.keypadId)!
    return acc + prod.price
  }, 0)

  const inv1Result = await client.query(
    `INSERT INTO invoices (supplier_id, buyer_id, total_cost, is_paid, is_payment_requested,
       auto_reminder_count, manual_reminder_count, created_at, updated_at)
     VALUES ($1, $2, $3, true, true, 0, 0, NOW() - interval '18 days', NOW() - interval '15 days')
     RETURNING id`,
    [supplierId, customerId, inv1Cost]
  )
  const inv1Id = inv1Result.rows[0].id

  // Link orders 1-10 to invoice 1
  for (let i = 0; i < 10; i++) {
    await client.query(`UPDATE orders SET invoice_id = $1 WHERE id = $2`, [inv1Id, orderIds[i]])
  }

  // Invoice 2: payment requested (orders 11-20, customer)
  const inv2Cost = orderItems.slice(10, 20).reduce((acc, item) => {
    const prod = products.find((p) => p.keypadId === item.keypadId)!
    return acc + prod.price
  }, 0)

  const inv2Result = await client.query(
    `INSERT INTO invoices (supplier_id, buyer_id, total_cost, is_paid, is_payment_requested,
       auto_reminder_count, manual_reminder_count, created_at, updated_at)
     VALUES ($1, $2, $3, false, true, 0, 1, NOW() - interval '7 days', NOW() - interval '3 days')
     RETURNING id`,
    [supplierId, customerId, inv2Cost]
  )
  const inv2Id = inv2Result.rows[0].id

  // Link orders 11-20 to invoice 2
  for (let i = 10; i < 20; i++) {
    await client.query(`UPDATE orders SET invoice_id = $1 WHERE id = $2`, [inv2Id, orderIds[i]])
  }

  // Invoice 3: unpaid (no payment requested) for customer2 — orders 26-33
  const inv3Cost = orderItems.slice(25, 33).reduce((acc, item) => {
    const prod = products.find((p) => p.keypadId === item.keypadId)!
    return acc + prod.price
  }, 0)

  const inv3Result = await client.query(
    `INSERT INTO invoices (supplier_id, buyer_id, total_cost, is_paid, is_payment_requested,
       auto_reminder_count, manual_reminder_count, created_at, updated_at)
     VALUES ($1, $2, $3, false, false, 1, 0, NOW() - interval '5 days', NOW() - interval '5 days')
     RETURNING id`,
    [supplierId, customer2Id, inv3Cost]
  )
  const inv3Id = inv3Result.rows[0].id

  // Link orders 26-33 to invoice 3
  for (let i = 25; i < 33; i++) {
    await client.query(`UPDATE orders SET invoice_id = $1 WHERE id = $2`, [inv3Id, orderIds[i]])
  }

  await client.end()
}
