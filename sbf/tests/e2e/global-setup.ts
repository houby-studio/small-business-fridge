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
 * 3. Seed categories, products, and deliveries for shop page tests
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
      [user.username, user.email, user.display_name, user.password, user.role, user.keypad_id, user.iban]
    )
  }

  // 4. Seed categories (matching dev seeder)
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

  // 5. Seed products (matching dev seeder, keypad IDs 1-5)
  const products = [
    { keypadId: 1, displayName: 'Coca-Cola 0.5L', description: 'Osvěžující nápoj', category: 'Nealko', price: 15 },
    { keypadId: 2, displayName: 'Mattoni 0.5L', description: 'Přírodní minerální voda', category: 'Nealko', price: 15 },
    { keypadId: 3, displayName: 'Plzeň 0.5L', description: 'České pivo', category: 'Alko', price: 25 },
    { keypadId: 4, displayName: 'Snickers', description: 'Čokoládová tyčinka', category: 'Sladkosti', price: 15 },
    { keypadId: 5, displayName: "Chipsy Lay's", description: 'Bramborové lupínky', category: 'Jídlo', price: 15 },
  ]

  const productIds: number[] = []
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
    productIds.push(result.rows[0].id)
  }

  // 6. Get supplier ID
  const supplierResult = await client.query('SELECT id FROM users WHERE username = $1', ['supplier'])
  const supplierId = supplierResult.rows[0].id

  // 7. Ensure each product has stock:
  //    Delete orders referencing these deliveries, then delete/re-create deliveries
  //    so each product has a known amount_left = 10 for fresh test runs.
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

  for (let i = 0; i < products.length; i++) {
    await client.query(
      `INSERT INTO deliveries (supplier_id, product_id, amount_supplied, amount_left, price, created_at, updated_at)
       VALUES ($1, $2, 10, 10, $3, NOW(), NOW())`,
      [supplierId, productIds[i], products[i].price]
    )
  }

  await client.end()
}
