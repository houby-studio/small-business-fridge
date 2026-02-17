/**
 * MongoDB → PostgreSQL Migration Script
 *
 * One-time migration script to transfer all data from the old MongoDB-based
 * Small Business Fridge application to the new PostgreSQL-based AdonisJS app.
 *
 * Usage:
 *   node ace migration:run          # ensure PG tables exist
 *   npx tsx scripts/migrate_from_mongodb.ts
 *
 * Environment variables needed (add to .env or pass inline):
 *   MONGO_URI=mongodb://user:pass@host:port/dbname?authSource=admin
 *
 * The script is idempotent — it truncates target tables before inserting.
 */

import { MongoClient, ObjectId, Db } from 'mongodb'
import pg from 'pg'
import dotenv from 'dotenv'
import { resolve } from 'node:path'

dotenv.config({ path: resolve(import.meta.dirname, '../.env') })

// ── Config ──────────────────────────────────────────────────────────────────

const MONGO_URI = process.env.MONGO_URI
if (!MONGO_URI) {
  console.error('❌ MONGO_URI environment variable is required.')
  console.error('   Example: MONGO_URI=mongodb://sbf-app:password@localhost:27017/sbf-prod?authSource=admin')
  process.exit(1)
}

const PG_CONFIG = {
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT ?? 5433),
  database: process.env.DB_DATABASE ?? 'sbf_dev',
  user: process.env.DB_USER ?? 'sbf_dev',
  password: process.env.DB_PASSWORD ?? 'sbf_dev_password',
}

// ── ID Mapping ──────────────────────────────────────────────────────────────

/** Maps MongoDB ObjectId strings to PostgreSQL integer IDs */
const idMap = {
  users: new Map<string, number>(),
  products: new Map<string, number>(),
  categories: new Map<string, number>(),
  deliveries: new Map<string, number>(),
  orders: new Map<string, number>(),
  invoices: new Map<string, number>(),
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function oid(value: unknown): string | null {
  if (!value) return null
  if (value instanceof ObjectId) return value.toHexString()
  if (typeof value === 'string') return value
  return String(value)
}

function toDate(value: unknown): Date | null {
  if (!value) return null
  if (value instanceof Date) return value
  return new Date(value as string)
}

function deriveRole(doc: any): 'admin' | 'supplier' | 'customer' {
  if (doc.admin === true) return 'admin'
  if (doc.supplier === true) return 'supplier'
  return 'customer'
}

function deriveChannel(doc: any): 'web' | 'keypad' | 'scanner' {
  if (doc.scannerOrder === true) return 'scanner'
  if (doc.keypadOrder === true) return 'keypad'
  return 'web'
}

function log(emoji: string, msg: string) {
  console.log(`${emoji}  ${msg}`)
}

// ── Migration Functions ─────────────────────────────────────────────────────

async function migrateCategories(mongo: Db, pg: pg.Client) {
  const docs = await mongo.collection('categories').find().toArray()
  log('📦', `Found ${docs.length} categories in MongoDB`)

  for (const doc of docs) {
    const mongoId = oid(doc._id)!
    const result = await pg.query(
      `INSERT INTO categories (name, color, is_disabled, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())
       RETURNING id`,
      [doc.name, doc.color, doc.disabled ?? false]
    )
    idMap.categories.set(mongoId, result.rows[0].id)
  }

  log('✅', `Migrated ${idMap.categories.size} categories`)
}

async function migrateUsers(mongo: Db, pg: pg.Client) {
  const docs = await mongo.collection('users').find().toArray()
  log('📦', `Found ${docs.length} users in MongoDB`)

  for (const doc of docs) {
    const mongoId = oid(doc._id)!
    const role = deriveRole(doc)

    const result = await pg.query(
      `INSERT INTO users (
        oid, username, password, display_name, email, phone, iban,
        keypad_id, card_id, role, is_kiosk, is_disabled,
        show_all_products, send_mail_on_purchase, send_daily_report,
        color_mode, keypad_disabled, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, NOW(), NOW())
       RETURNING id`,
      [
        doc.oid ?? null,                              // oid
        null,                                         // username (OIDC users don't have one)
        null,                                         // password (OIDC users don't have one)
        doc.displayName,                              // display_name
        doc.email,                                    // email
        doc.phone ?? null,                            // phone
        doc.IBAN ?? null,                             // iban
        doc.keypadId,                                 // keypad_id
        doc.card ?? null,                             // card_id
        role,                                         // role
        doc.kiosk ?? false,                           // is_kiosk
        doc.disabled ?? false,                        // is_disabled
        doc.showAllProducts ?? false,                 // show_all_products
        doc.sendMailOnEshopPurchase ?? true,           // send_mail_on_purchase
        doc.sendDailyReport ?? true,                  // send_daily_report
        doc.colorMode ?? 'dark',                      // color_mode
        doc.keypadDisabled ?? false,                  // keypad_disabled
      ]
    )
    idMap.users.set(mongoId, result.rows[0].id)
  }

  log('✅', `Migrated ${idMap.users.size} users`)
}

async function migrateProducts(mongo: Db, pg: pg.Client) {
  const docs = await mongo.collection('products').find().toArray()
  log('📦', `Found ${docs.length} products in MongoDB`)

  for (const doc of docs) {
    const mongoId = oid(doc._id)!
    const categoryMongoId = oid(doc.category)
    const categoryId = categoryMongoId ? idMap.categories.get(categoryMongoId) ?? null : null

    const result = await pg.query(
      `INSERT INTO products (keypad_id, display_name, description, image_path, category_id, barcode, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
       RETURNING id`,
      [
        doc.keypadId,
        doc.displayName,
        doc.description ?? null,
        doc.imagePath ?? null,
        categoryId,
        doc.code ?? null,    // old field "code" → new field "barcode"
      ]
    )
    idMap.products.set(mongoId, result.rows[0].id)
  }

  log('✅', `Migrated ${idMap.products.size} products`)
}

async function migrateFavorites(mongo: Db, pg: pg.Client) {
  const docs = await mongo.collection('users').find({ favorites: { $exists: true, $ne: [] } }).toArray()
  let count = 0

  for (const doc of docs) {
    const userId = idMap.users.get(oid(doc._id)!)
    if (!userId) continue

    const favorites: unknown[] = doc.favorites ?? []
    for (const fav of favorites) {
      const productId = idMap.products.get(oid(fav)!)
      if (!productId) continue

      await pg.query(
        `INSERT INTO user_favorites (user_id, product_id, created_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (user_id, product_id) DO NOTHING`,
        [userId, productId]
      )
      count++
    }
  }

  log('✅', `Migrated ${count} user favorite entries`)
}

async function migrateDeliveries(mongo: Db, pg: pg.Client) {
  const docs = await mongo.collection('deliveries').find().sort({ created_on: 1 }).toArray()
  log('📦', `Found ${docs.length} deliveries in MongoDB`)

  for (const doc of docs) {
    const mongoId = oid(doc._id)!
    const supplierId = idMap.users.get(oid(doc.supplierId)!)
    const productId = idMap.products.get(oid(doc.productId)!)

    if (!supplierId || !productId) {
      log('⚠️', `Skipping delivery ${mongoId}: missing supplier (${oid(doc.supplierId)}) or product (${oid(doc.productId)})`)
      continue
    }

    const createdAt = toDate(doc.created_on) ?? new Date()

    const result = await pg.query(
      `INSERT INTO deliveries (supplier_id, product_id, amount_supplied, amount_left, price, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $6)
       RETURNING id`,
      [supplierId, productId, doc.amount_supplied, doc.amount_left, doc.price, createdAt]
    )
    idMap.deliveries.set(mongoId, result.rows[0].id)
  }

  log('✅', `Migrated ${idMap.deliveries.size} deliveries`)
}

async function migrateInvoices(mongo: Db, pg: pg.Client) {
  const docs = await mongo.collection('invoices').find().sort({ invoiceDate: 1 }).toArray()
  log('📦', `Found ${docs.length} invoices in MongoDB`)

  for (const doc of docs) {
    const mongoId = oid(doc._id)!
    const buyerId = idMap.users.get(oid(doc.buyerId)!)
    const supplierId = idMap.users.get(oid(doc.supplierId)!)

    if (!buyerId || !supplierId) {
      log('⚠️', `Skipping invoice ${mongoId}: missing buyer (${oid(doc.buyerId)}) or supplier (${oid(doc.supplierId)})`)
      continue
    }

    const createdAt = toDate(doc.invoiceDate) ?? new Date()

    const result = await pg.query(
      `INSERT INTO invoices (buyer_id, supplier_id, total_cost, is_paid, is_payment_requested, auto_reminder_count, manual_reminder_count, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
       RETURNING id`,
      [
        buyerId,
        supplierId,
        doc.totalCost,
        doc.paid ?? false,
        doc.requestPaid ?? false,
        doc.autoReminderCount ?? 0,
        doc.manualReminderCount ?? 0,
        createdAt,
      ]
    )
    idMap.invoices.set(mongoId, result.rows[0].id)
  }

  log('✅', `Migrated ${idMap.invoices.size} invoices`)
}

async function migrateOrders(mongo: Db, pg: pg.Client) {
  const docs = await mongo.collection('orders').find().sort({ order_date: 1 }).toArray()
  log('📦', `Found ${docs.length} orders in MongoDB`)

  let migrated = 0
  let skipped = 0

  for (const doc of docs) {
    const mongoId = oid(doc._id)!
    const buyerId = idMap.users.get(oid(doc.buyerId)!)
    const deliveryId = idMap.deliveries.get(oid(doc.deliveryId)!)

    if (!buyerId || !deliveryId) {
      log('⚠️', `Skipping order ${mongoId}: missing buyer (${oid(doc.buyerId)}) or delivery (${oid(doc.deliveryId)})`)
      skipped++
      continue
    }

    // Resolve invoice ID: either from the explicit invoiceId field, or look up via old Invoice.ordersId array
    let invoiceId: number | null = null
    const invoiceMongoId = oid(doc.invoiceId)
    if (invoiceMongoId) {
      invoiceId = idMap.invoices.get(invoiceMongoId) ?? null
    }

    const channel = deriveChannel(doc)
    const createdAt = toDate(doc.order_date) ?? new Date()

    const result = await pg.query(
      `INSERT INTO orders (buyer_id, delivery_id, invoice_id, channel, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $5)
       RETURNING id`,
      [buyerId, deliveryId, invoiceId, channel, createdAt]
    )
    idMap.orders.set(mongoId, result.rows[0].id)
    migrated++
  }

  log('✅', `Migrated ${migrated} orders (${skipped} skipped)`)
}

async function linkOrdersFromInvoices(mongo: Db, pgClient: pg.Client) {
  /**
   * The old schema stores order references in Invoice.ordersId[].
   * Some orders might not have invoiceId set, but the invoice references them.
   * This step ensures all order-invoice links are established.
   */
  const docs = await mongo.collection('invoices').find().toArray()
  let linked = 0

  for (const doc of docs) {
    const invoiceMongoId = oid(doc._id)!
    const invoiceId = idMap.invoices.get(invoiceMongoId)
    if (!invoiceId) continue

    const orderIds: unknown[] = doc.ordersId ?? []
    for (const orderMongoRef of orderIds) {
      const orderId = idMap.orders.get(oid(orderMongoRef)!)
      if (!orderId) continue

      const result = await pgClient.query(
        `UPDATE orders SET invoice_id = $1 WHERE id = $2 AND invoice_id IS NULL`,
        [invoiceId, orderId]
      )
      if (result.rowCount && result.rowCount > 0) linked++
    }
  }

  if (linked > 0) {
    log('🔗', `Linked ${linked} additional orders to invoices via Invoice.ordersId[]`)
  }
}

// ── Verification ────────────────────────────────────────────────────────────

async function verify(mongo: Db, pgClient: pg.Client) {
  log('🔍', 'Verifying migration counts...')

  const checks = [
    { collection: 'categories', table: 'categories' },
    { collection: 'users', table: 'users' },
    { collection: 'products', table: 'products' },
    { collection: 'deliveries', table: 'deliveries' },
    { collection: 'invoices', table: 'invoices' },
    { collection: 'orders', table: 'orders' },
  ]

  let allMatch = true
  for (const { collection, table } of checks) {
    const mongoCount = await mongo.collection(collection).countDocuments()
    const pgResult = await pgClient.query(`SELECT count(*)::int AS count FROM ${table}`)
    const pgCount = pgResult.rows[0].count
    const match = mongoCount === pgCount ? '✅' : '❌'
    if (mongoCount !== pgCount) allMatch = false
    console.log(`   ${match} ${collection}: MongoDB=${mongoCount} → PostgreSQL=${pgCount}`)
  }

  // Check favorites
  const usersWithFavs = await mongo.collection('users').find({ favorites: { $exists: true, $ne: [] } }).toArray()
  const totalFavs = usersWithFavs.reduce((sum, u) => sum + ((u.favorites as unknown[])?.length ?? 0), 0)
  const pgFavs = await pgClient.query(`SELECT count(*)::int AS count FROM user_favorites`)
  const favMatch = totalFavs === pgFavs.rows[0].count ? '✅' : '⚠️'
  console.log(`   ${favMatch} favorites: MongoDB=${totalFavs} → PostgreSQL=${pgFavs.rows[0].count}`)

  // Check invoice-order links
  const pgLinked = await pgClient.query(`SELECT count(*)::int AS count FROM orders WHERE invoice_id IS NOT NULL`)
  const mongoLinked = await mongo.collection('orders').countDocuments({ $or: [{ invoice: true }, { invoiceId: { $ne: null } }] })
  const linkMatch = mongoLinked === pgLinked.rows[0].count ? '✅' : '⚠️'
  console.log(`   ${linkMatch} invoiced orders: MongoDB=${mongoLinked} → PostgreSQL=${pgLinked.rows[0].count}`)

  return allMatch
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('═══════════════════════════════════════════════════════')
  console.log('  Small Business Fridge — MongoDB → PostgreSQL Migration')
  console.log('═══════════════════════════════════════════════════════')
  console.log()

  // Connect to MongoDB
  log('🔌', `Connecting to MongoDB: ${MONGO_URI!.replace(/:([^@]+)@/, ':***@')}`)
  const mongoClient = new MongoClient(MONGO_URI!)
  await mongoClient.connect()
  const mongoDB = mongoClient.db()
  log('✅', `Connected to MongoDB database: ${mongoDB.databaseName}`)

  // Connect to PostgreSQL
  log('🔌', `Connecting to PostgreSQL: ${PG_CONFIG.host}:${PG_CONFIG.port}/${PG_CONFIG.database}`)
  const pgClient = new pg.Client(PG_CONFIG)
  await pgClient.connect()
  log('✅', 'Connected to PostgreSQL')

  console.log()
  log('🗑️', 'Truncating PostgreSQL tables...')

  // Truncate in reverse dependency order
  await pgClient.query(`
    TRUNCATE TABLE user_favorites, orders, invoices, deliveries, products, categories, users
    RESTART IDENTITY CASCADE
  `)
  log('✅', 'Tables truncated')

  console.log()
  log('🚀', 'Starting migration...')
  console.log()

  const startTime = Date.now()

  // Migrate in dependency order
  await migrateCategories(mongoDB, pgClient)
  await migrateUsers(mongoDB, pgClient)
  await migrateProducts(mongoDB, pgClient)
  await migrateFavorites(mongoDB, pgClient)
  await migrateDeliveries(mongoDB, pgClient)
  await migrateInvoices(mongoDB, pgClient)
  await migrateOrders(mongoDB, pgClient)
  await linkOrdersFromInvoices(mongoDB, pgClient)

  // Reset sequences to max ID + 1
  log('🔧', 'Resetting PostgreSQL sequences...')
  const tables = ['users', 'categories', 'products', 'deliveries', 'invoices', 'orders']
  for (const table of tables) {
    await pgClient.query(`SELECT setval(pg_get_serial_sequence('${table}', 'id'), COALESCE(MAX(id), 0) + 1, false) FROM ${table}`)
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
  console.log()
  log('⏱️', `Migration completed in ${elapsed}s`)
  console.log()

  // Verify
  const allMatch = await verify(mongoDB, pgClient)
  console.log()

  if (allMatch) {
    log('🎉', 'Migration successful! All counts match.')
  } else {
    log('⚠️', 'Migration completed with count mismatches. Review skipped records above.')
  }

  // Print summary
  console.log()
  console.log('── Summary ────────────────────────────────────────────')
  console.log(`   Users:      ${idMap.users.size}`)
  console.log(`   Categories: ${idMap.categories.size}`)
  console.log(`   Products:   ${idMap.products.size}`)
  console.log(`   Deliveries: ${idMap.deliveries.size}`)
  console.log(`   Invoices:   ${idMap.invoices.size}`)
  console.log(`   Orders:     ${idMap.orders.size}`)
  console.log('══════════════════════════════════════════════════════')

  await pgClient.end()
  await mongoClient.close()
}

main().catch((err) => {
  console.error('❌ Migration failed:', err)
  process.exit(1)
})
