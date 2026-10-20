import '#tests/test_context'
import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import mail from '@adonisjs/mail/services/main'
import { UserFactory } from '#database/factories/user_factory'
import { ProductFactory } from '#database/factories/product_factory'
import { CategoryFactory } from '#database/factories/category_factory'
import Delivery from '#models/delivery'
import StockDraft from '#models/stock_draft'
import StockDraftItem from '#models/stock_draft_item'
import type User from '#models/user'
import StockDraftService, {
  StockDraftNeedsConfirmation,
  type DraftCommitWarning,
  type StockDraftItemInput,
} from '#services/shopping/stock_draft_service'
import DeliveryService from '#services/delivery_service'
import NotificationService from '#services/notification_service'
import { assertStockInvariants } from '#tests/helpers/stock_invariants'

/**
 * Edge cases of stocking drafts: who may touch a draft, which draft "Stock" lands on at the
 * edges of its reuse window, what a commit stocks under failure and concurrency, and the
 * exact thresholds of its warnings. Expected values are worked out from the rules in
 * docs/shopping-list.md and PLAN.md, not read off the code.
 */

const service = new StockDraftService()

const cleanAll = async () => {
  await db.rawQuery('TRUNCATE TABLE users, categories, product_groups CASCADE')
}

async function supplier(margin = 0) {
  const user = await UserFactory.apply('supplier').create()
  if (margin) {
    user.marginPercent = margin
    await user.save()
  }
  return user
}

async function product() {
  const category = await CategoryFactory.create()
  return ProductFactory.merge({ categoryId: category.id }).create()
}

/** A lot stocked `minutesAgo` minutes ago — far enough back that it is no double submit. */
async function lot(
  supplierId: number,
  productId: number,
  options: {
    amount?: number
    left?: number
    price?: number
    purchasePrice?: number | null
    minutesAgo?: number
  } = {}
) {
  const amount = options.amount ?? 10
  return Delivery.create({
    supplierId,
    productId,
    amountSupplied: amount,
    amountLeft: options.left ?? amount,
    amountLost: 0,
    price: options.price ?? 20,
    purchasePrice: options.purchasePrice ?? null,
    createdAt: DateTime.now().minus({ minutes: options.minutesAgo ?? 120 }),
  })
}

async function draftField(id: number, field: 'status' | 'note') {
  const draft = await StockDraft.findOrFail(id)
  return draft[field]
}

async function linesOf(draftId: number) {
  const items = await StockDraftItem.query()
    .where('stockDraftId', draftId)
    .orderBy('sortOrder', 'asc')
  return items.map((i) => [i.productId, i.amount, i.purchasePrice, i.price])
}

async function auditCount(action: string) {
  const rows = await db.from('audit_logs').where('action', action)
  return rows.length
}

/** The warnings a commit stops with, or null when it stocked the draft. */
async function commitWarnings(
  actor: User,
  items: StockDraftItemInput[]
): Promise<DraftCommitWarning[] | null> {
  const draft = await service.create(actor.id, { source: 'web', items: [] })
  try {
    await service.commit(actor, draft.id, { items })
    return null
  } catch (error) {
    if (error instanceof StockDraftNeedsConfirmation) return error.warnings
    throw error
  }
}

test.group('StockDraftService — edges', (group) => {
  const sendRestockNotifications = NotificationService.prototype.sendRestockNotifications
  const addStock = DeliveryService.prototype.addStock

  group.each.setup(async () => {
    await cleanAll()
    mail.fake()
    // The commit fires restock e-mails without awaiting them; their queries would race the
    // TRUNCATE of the next test. The restock test below restores the real method.
    NotificationService.prototype.sendRestockNotifications = async () => {}
  })
  group.each.teardown(async () => {
    NotificationService.prototype.sendRestockNotifications = sendRestockNotifications
    DeliveryService.prototype.addStock = addStock
    mail.restore()
    await cleanAll()
  })

  // Mutation caught: dropping the owner check in `lockOpen` (update, discard and
  // setLineProduct all go through it) lets a colleague rewrite and then stock my lines.
  test('a colleague can neither rewrite, discard nor fill my draft; an admin can', async ({
    assert,
  }) => {
    const owner = await supplier()
    const colleague = await supplier()
    const admin = await UserFactory.apply('admin').create()
    const pepsi = await product()
    const draft = await service.create(owner.id, {
      source: 'mcp',
      items: [{ label: 'PEPSI', amount: 24, purchasePrice: 14.9 }],
    })
    const before = await linesOf(draft.id)

    await assert.rejects(
      () => service.update(colleague, draft.id, { items: [{ productId: pepsi.id, amount: 1 }] }),
      'DRAFT_NOT_FOUND'
    )
    await assert.rejects(
      () => service.setLineProduct(colleague, draft.id, 0, pepsi.id),
      'DRAFT_NOT_FOUND'
    )
    await assert.rejects(() => service.discard(colleague, draft.id), 'DRAFT_NOT_FOUND')
    assert.deepEqual(await linesOf(draft.id), before)
    assert.equal(await draftField(draft.id, 'status'), 'open')

    await service.setLineProduct(admin, draft.id, 0, pepsi.id)
    assert.deepEqual(await linesOf(draft.id), [[pepsi.id, 24, 14.9, null]])
    await service.discard(admin, draft.id)
    assert.equal(await draftField(draft.id, 'status'), 'discarded')
    // The admin's discard names the owner as the one it was done for.
    const log = await db.from('audit_logs').where('action', 'stock_draft.discarded').firstOrFail()
    assert.deepEqual([log.user_id, log.target_user_id], [admin.id, owner.id])
  })

  // Mutation caught: removing `.forUpdate()` from `lockOpen` lets both commits read an open
  // draft and stock every line twice.
  test('two commits at once: one stocks every line, the other finds the draft closed', async ({
    assert,
  }) => {
    const owner = await supplier()
    const [pepsi, cola] = [await product(), await product()]
    const draft = await service.create(owner.id, {
      source: 'web',
      items: [
        { productId: pepsi.id, amount: 3, price: 10 },
        { productId: cola.id, amount: 4, price: 12 },
      ],
    })

    const results = await Promise.allSettled([
      service.commit(owner, draft.id, { confirmWarnings: true }),
      service.commit(owner, draft.id, { confirmWarnings: true }),
      service.commit(owner, draft.id, { confirmWarnings: true }),
    ])

    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1)
    for (const result of results) {
      if (result.status === 'rejected') assert.equal(result.reason.code, 'DRAFT_CLOSED')
    }
    const lots = await Delivery.query().orderBy('productId', 'asc')
    assert.deepEqual(
      lots.map((l) => [l.productId, l.amountSupplied]),
      [
        [pepsi.id, 3],
        [cola.id, 4],
      ].sort((a, b) => a[0] - b[0])
    )
    assert.equal(await auditCount('stock_draft.committed'), 1)
    assert.equal(await auditCount('delivery.created'), 2)
    await assertStockInvariants(assert)
  })

  // Mutation caught: dropping `client: trx` from the commit's `addStock` call leaves the
  // first lot (and its audit entry) behind while the draft stays open — a retry stocks it
  // twice.
  test('a failing line leaves no lot, no audit entry and no line link; a retry stocks once', async ({
    assert,
  }) => {
    const owner = await supplier()
    const products = [await product(), await product(), await product()]
    const draft = await service.create(owner.id, {
      source: 'web',
      items: products.map((p) => ({ productId: p.id, amount: 2, price: 10 })),
    })
    let calls = 0
    DeliveryService.prototype.addStock = async function (...args) {
      if (++calls === 3) throw new Error('database hiccup on the last line')
      return addStock.apply(this, args)
    }

    await assert.rejects(
      () => service.commit(owner, draft.id, { confirmWarnings: true }),
      'database hiccup on the last line'
    )
    assert.lengthOf(await Delivery.all(), 0)
    assert.equal(await auditCount('delivery.created'), 0)
    assert.equal(await auditCount('stock_draft.committed'), 0)
    const items = await StockDraftItem.query().where('stockDraftId', draft.id)
    assert.deepEqual(
      items.map((i) => i.deliveryId),
      [null, null, null]
    )
    assert.equal(await draftField(draft.id, 'status'), 'open')

    DeliveryService.prototype.addStock = addStock
    await service.commit(owner, draft.id, { confirmWarnings: true })
    assert.lengthOf(await Delivery.all(), 3)
    assert.equal(await auditCount('delivery.created'), 3)
    await assertStockInvariants(assert)
  })

  // Mutation caught: dropping the supplier filter in `countOpen` or `listOpen` puts a
  // colleague's draft into my badge and my list.
  test("counts and lists only the supplier's own draft", async ({ assert }) => {
    const me = await supplier()
    const colleague = await supplier()
    const loner = await supplier()
    const pepsi = await product()
    const line = [{ productId: pepsi.id, amount: 1, price: 10 }]
    const mine = await service.create(me.id, { source: 'web', items: line })
    await service.create(colleague.id, { source: 'mcp', items: line })
    await service.create(colleague.id, { source: 'shopping_list', items: line })
    // An empty draft is no badge.
    await service.findOrCreateOpenDraft(loner.id)

    assert.equal(await service.countOpen(me.id), 1)
    assert.equal(await service.countOpen(colleague.id), 1)
    assert.equal(await service.countOpen(loner.id), 0)
    assert.deepEqual(await service.listOpen(me.id).then((list) => list.map((d) => d.id)), [mine.id])
    assert.deepEqual(await service.openSummary(me.id), { id: mine.id, lines: 1, pieces: 1 })
    assert.equal(await service.openSummary(colleague.id).then((summary) => summary?.lines), 2)
    assert.isNull(await service.openSummary(loner.id))
  })

  // PLAN4 P7: a supplier has at most one open draft. Whatever adds lines — the web, the
  // shopping list, an assistant — adds them to it, each line remembering where it came from;
  // only once it is stocked or discarded does the next one start.
  // Mutations caught: `appendLines` creating a draft per call, the line source not stored or
  // mapped wrongly (`mcp` → `assistant`), the shopping list's estimate flag lost when it joins
  // a hand-made draft, the note duplicated or replaced.
  test('every source adds its lines to the one open draft and marks them', async ({ assert }) => {
    const me = await supplier()
    const [pepsi, cola, water] = [await product(), await product(), await product()]
    // Sold before, so the hand-added line gets a selling price and the draft can be stocked.
    await lot(me.id, pepsi.id, { price: 20 })

    const byHand = await service.appendProduct(me.id, pepsi.id)
    const fromList = await service.appendLines(me.id, {
      source: 'shopping_list',
      note: 'Nákupní seznam 5. 10.',
      items: [{ productId: cola.id, amount: 12, purchasePrice: 19.9 }],
    })
    const fromAssistant = await service.appendLines(me.id, {
      source: 'mcp',
      note: 'Lidl účtenka',
      items: [{ productId: water.id, amount: 6, purchasePrice: 9.9 }],
    })
    const again = await service.appendLines(me.id, {
      source: 'mcp',
      note: 'Lidl účtenka',
      items: [],
    })

    assert.deepEqual(
      [fromList.created, fromAssistant.created, fromList.added, fromAssistant.added, again.added],
      [false, false, 1, 1, 0]
    )
    for (const result of [fromList, fromAssistant, again]) {
      assert.equal(result.draft.id, byHand.draft.id)
    }
    const items = await StockDraftItem.query()
      .where('stockDraftId', byHand.draft.id)
      .orderBy('sortOrder', 'asc')
    assert.deepEqual(
      items.map((i) => [i.productId, i.sortOrder, i.source, i.purchasePriceEstimated]),
      [
        [pepsi.id, 0, 'web', false],
        [cola.id, 1, 'shopping_list', true],
        [water.id, 2, 'assistant', false],
      ]
    )
    assert.equal(await draftField(byHand.draft.id, 'note'), 'Nákupní seznam 5. 10. · Lidl účtenka')
    assert.lengthOf(await StockDraft.query().where('supplierId', me.id), 1)
    // Adding to an existing draft is logged as such, not as a new draft.
    assert.equal(await auditCount('stock_draft.lines_added'), 2)
    assert.equal(await auditCount('stock_draft.created'), 0)

    // Stocked: the next line starts a new draft.
    await service.commit(me, byHand.draft.id, { confirmWarnings: true })
    const next = await service.appendLines(me.id, {
      source: 'mcp',
      items: [{ productId: pepsi.id, amount: 1, price: 20 }],
    })
    assert.isTrue(next.created)
    assert.notEqual(next.draft.id, byHand.draft.id)
    assert.equal(await auditCount('stock_draft.created'), 1)
  })

  // The database itself refuses a second open draft, whatever code path tries it.
  // Mutation caught: dropping the partial unique index.
  test('the database refuses a second open draft, not a closed one', async ({ assert }) => {
    const me = await supplier()
    const colleague = await supplier()
    const open = await service.findOrCreateOpenDraft(me.id)

    await assert.rejects(() =>
      StockDraft.create({ supplierId: me.id, source: 'web', status: 'open' })
    )
    await StockDraft.create({ supplierId: colleague.id, source: 'web', status: 'open' })
    await service.discard(me, open.id)
    const next = await service.findOrCreateOpenDraft(me.id)
    assert.notEqual(next.id, open.id)
    assert.lengthOf(await StockDraft.query().where('supplierId', me.id).where('status', 'open'), 1)
  })

  // Mutation caught: no lock around "find or create" — three sources at once open three
  // drafts (or one of them fails on the unique index).
  test('lines from three sources at once land in one draft', async ({ assert }) => {
    const me = await supplier()
    const [pepsi, cola, water] = [await product(), await product(), await product()]

    const results = await Promise.allSettled([
      service.appendLines(me.id, { source: 'web', items: [{ productId: pepsi.id, amount: 1 }] }),
      service.appendLines(me.id, {
        source: 'shopping_list',
        items: [{ productId: cola.id, amount: 2 }],
      }),
      service.appendLines(me.id, { source: 'mcp', items: [{ productId: water.id, amount: 3 }] }),
    ])

    assert.deepEqual(
      results.map((r) => r.status),
      ['fulfilled', 'fulfilled', 'fulfilled']
    )
    const drafts = await StockDraft.query().where('supplierId', me.id)
    assert.lengthOf(drafts, 1)
    const items = await StockDraftItem.query().where('stockDraftId', drafts[0].id)
    assert.sameMembers(
      items.map((i) => i.sortOrder),
      [0, 1, 2]
    )
    assert.equal(results.filter((r) => r.status === 'fulfilled' && r.value.created).length, 1)
  })

  // Mutation caught: removing the advisory lock — two clicks on two different products
  // each create a draft of their own.
  test('two products appended at once land in one draft at distinct positions', async ({
    assert,
  }) => {
    const me = await supplier()
    const products = [await product(), await product(), await product()]

    const results = await Promise.all(products.map((p) => service.appendProduct(me.id, p.id)))

    assert.lengthOf(new Set(results.map((r) => r.draft.id)), 1)
    assert.lengthOf(await StockDraft.query().where('supplierId', me.id), 1)
    const items = await StockDraftItem.query().where('stockDraftId', results[0].draft.id)
    assert.sameMembers(
      items.map((i) => i.sortOrder),
      [0, 1, 2]
    )
    assert.sameMembers(
      items.map((i) => i.productId!),
      products.map((p) => p.id)
    )
  })

  // Mutation caught: rounding pieces up (2.7 → 3 invents a piece), keeping a negative
  // amount, or keeping a zero selling price instead of deriving one.
  test('lines are normalised without inventing pieces or prices', async ({ assert }) => {
    const me = await supplier()
    const pepsi = await product()
    const draft = await service.create(me.id, {
      source: 'mcp',
      items: [
        { productId: pepsi.id, amount: -3, price: 10 },
        { productId: pepsi.id, amount: 2.7, purchasePrice: 14.904, price: 0 },
        { label: `  ${'x'.repeat(300)}  `, amount: 1, purchasePriceEstimated: true },
        { label: '   ', productId: pepsi.id, amount: 5, purchasePrice: 9.996 },
      ],
    })

    const items = await StockDraftItem.query().where('stockDraftId', draft.id).orderBy('sortOrder')
    assert.deepEqual(
      items.map((i) => [i.productId, i.amount, i.purchasePrice, i.price, i.purchasePriceEstimated]),
      [
        [pepsi.id, 2, 14.9, null, false],
        // An estimate flag without a price means nothing.
        [null, 1, null, null, false],
        [pepsi.id, 5, 10, null, false],
      ]
    )
    assert.equal(items[1].label, 'x'.repeat(255))
    assert.isNull(items[2].label)
  })

  // Mutation caught: checking a line against the lots the same commit is about to create
  // (two lines of one product would warn about each other).
  test('two lines of one product are checked against the stock, not against each other', async ({
    assert,
  }) => {
    const me = await supplier()
    const pepsi = await product()

    const firstTime = await commitWarnings(me, [
      { productId: pepsi.id, amount: 6, price: 15 },
      { productId: pepsi.id, amount: 6, price: 15 },
    ])
    assert.isNull(firstTime)
    assert.lengthOf(await Delivery.all(), 2)

    // Right after it, the same again is a double submit — for both lines.
    const secondTime = await commitWarnings(me, [
      { productId: pepsi.id, amount: 6, price: 15 },
      { productId: pepsi.id, amount: 6, price: 15 },
    ])
    assert.deepEqual(
      secondTime!.map((w) => [w.index, w.duplicate?.amount, w.unusualPrice]),
      [
        [0, 6, null],
        [1, 6, null],
      ]
    )
    assert.lengthOf(await Delivery.all(), 2)
  })

  // Thresholds: a price is unusual at ≥ 1.5× (or ≤ 1/1.5×) the last lot AND more than
  // 5 CZK away from it; a double submit is an own lot of the product from the last 30 min.
  const priceCases: Array<[string, number, number, boolean]> = [
    // [case, last selling price, line price, warned]
    ['exactly 1.5× and 10 CZK up', 20, 30, true],
    ['just under 1.5× up', 20, 29, false],
    ['1.5× up but only 5 CZK apart', 10, 15, false],
    ['1.6× up and 6 CZK apart', 10, 16, true],
    ['exactly 1/1.5 down and 10 CZK apart', 30, 20, true],
    ['just above 1/1.5 down', 30, 21, false],
  ]
  for (const [name, last, price, warned] of priceCases) {
    // Mutations caught: `>=` → `>` on the ratio, `>` → `>=` on the difference, a ratio of
    // 1.4 or 1.6, dropping the downward check.
    test(`unusual selling price: ${name}`, async ({ assert }) => {
      const me = await supplier()
      const colleague = await supplier()
      const pepsi = await product()
      // The last lot is a colleague's: the price check compares with anyone's lot.
      await lot(colleague.id, pepsi.id, { price: last })

      const warnings = await commitWarnings(me, [{ productId: pepsi.id, amount: 1, price }])
      if (warned) {
        assert.lengthOf(warnings!, 1)
        assert.deepInclude(warnings![0], { index: 0, price, duplicate: null })
        assert.equal(warnings![0].unusualPrice?.lastPrice, last)
        assert.equal(warnings![0].unusualPrice?.lastSupplierId, colleague.id)
      } else {
        assert.isNull(warnings)
      }
    })
  }

  const duplicateCases: Array<[string, number, 'own' | 'colleague' | 'voided', boolean]> = [
    ['an own lot 29 minutes ago', 29, 'own', true],
    ['an own lot 31 minutes ago', 31, 'own', false],
    ["a colleague's lot 5 minutes ago", 5, 'colleague', false],
    ['an own voided lot 5 minutes ago', 5, 'voided', false],
  ]
  for (const [name, minutesAgo, whose, warned] of duplicateCases) {
    // Mutations caught: a longer or shorter window, a duplicate check across suppliers,
    // a voided lot counted as stocked.
    test(`double submit: ${name}`, async ({ assert }) => {
      const me = await supplier()
      const colleague = await supplier()
      const pepsi = await product()
      const earlier = await lot(whose === 'colleague' ? colleague.id : me.id, pepsi.id, {
        amount: 12,
        price: 20,
        minutesAgo,
      })
      if (whose === 'voided') await new DeliveryService().voidDelivery(me, earlier.id, 'Překlep')

      const warnings = await commitWarnings(me, [{ productId: pepsi.id, amount: 12, price: 20 }])
      if (warned) {
        assert.lengthOf(warnings!, 1)
        assert.equal(warnings![0].duplicate?.amount, 12)
        assert.equal(warnings![0].duplicate?.minutesAgo, minutesAgo)
        assert.isNull(warnings![0].unusualPrice)
      } else {
        assert.isNull(warnings)
      }
    })
  }

  // Mutations caught: comparing with a colleague's purchase price (private, and not this
  // supplier's cost), or the same 1.5× / 5 CZK thresholds getting out of step.
  test('an unusual purchase price is judged against my own last purchase only', async ({
    assert,
  }) => {
    const me = await supplier()
    const colleague = await supplier()
    const [fine, flaggedProduct, theirs] = [await product(), await product(), await product()]
    // My older lot paid 12, my newest 10 — the newest is what counts.
    await lot(me.id, fine.id, { price: 20, purchasePrice: 12, minutesAgo: 300 })
    await lot(me.id, fine.id, { price: 20, purchasePrice: 10 })
    await lot(me.id, flaggedProduct.id, { price: 20, purchasePrice: 10 })
    await lot(colleague.id, theirs.id, { price: 20, purchasePrice: 10 })
    // A colleague's newer lot of my product paid much less — not my cost, not compared.
    await lot(colleague.id, flaggedProduct.id, { price: 20, purchasePrice: 2, minutesAgo: 60 })

    // 15 against 10 is 1.5× but only 5 CZK more: fine.
    assert.isNull(
      await commitWarnings(me, [{ productId: fine.id, amount: 1, purchasePrice: 15, price: 20 }])
    )
    // 16 against 10 is both.
    const flagged = await commitWarnings(me, [
      { productId: flaggedProduct.id, amount: 1, purchasePrice: 16, price: 20 },
    ])
    assert.lengthOf(flagged!, 1)
    assert.equal(flagged![0].unusualPurchasePrice?.lastPurchasePrice, 10)
    assert.isNull(flagged![0].unusualPrice)
    assert.isNull(flagged![0].duplicate)

    // Only a colleague paid for this one before: there is nothing of mine to compare with.
    assert.isNull(
      await commitWarnings(me, [{ productId: theirs.id, amount: 1, purchasePrice: 30, price: 20 }])
    )
  })

  // Mutation caught: warning about the typed price (null here) instead of the price the line
  // will really get — purchase price plus margin, never below the last selling price.
  test('warnings judge the price the line will really be stocked at', async ({ assert }) => {
    const me = await supplier()
    const pepsi = await product()
    await lot(me.id, pepsi.id, { price: 10, purchasePrice: 8 })

    // 19.90 at 0 % → 20, above the last selling price of 10: 2× and 10 CZK up.
    const warnings = await commitWarnings(me, [
      { productId: pepsi.id, amount: 1, purchasePrice: 19.9 },
    ])
    assert.lengthOf(warnings!, 1)
    assert.equal(warnings![0].price, 20)
    assert.equal(warnings![0].unusualPrice?.lastPrice, 10)
    // 19.90 against the 8 I paid last time is unusual too.
    assert.equal(warnings![0].unusualPurchasePrice?.lastPurchasePrice, 8)
  })

  // Mutation caught: dropping `voided_at IS NULL` from `lastPrices` — a lot cancelled as a
  // typo would set the price floor of the next stocking.
  test('a voided lot sets neither the price floor nor blocks the default price', async ({
    assert,
  }) => {
    const me = await supplier()
    const pepsi = await product()
    await lot(me.id, pepsi.id, { price: 15, minutesAgo: 180 })
    const typo = await lot(me.id, pepsi.id, { price: 99, minutesAgo: 120 })
    await new DeliveryService().voidDelivery(me, typo.id, 'Překlep v ceně')

    const draft = await service.create(me.id, {
      source: 'mcp',
      items: [{ productId: pepsi.id, amount: 6, purchasePrice: 10 }],
    })
    const { deliveries } = await service.commit(me, draft.id)
    // max(ceil(10.00 × 1.00), 15) = 15 — the voided 99 does not count.
    assert.equal(deliveries[0].price, 15)
    await assertStockInvariants(assert)
  })

  // Mutation caught: a draft line without any price on a product whose only lot was voided
  // being stocked at the voided price instead of being reported as incomplete.
  test('a product whose only lot was voided has no price to fall back on', async ({ assert }) => {
    const me = await supplier()
    const pepsi = await product()
    const typo = await lot(me.id, pepsi.id, { price: 25 })
    await new DeliveryService().voidDelivery(me, typo.id, 'Omyl')
    const draft = await service.create(me.id, {
      source: 'mcp',
      items: [{ productId: pepsi.id, amount: 6 }],
    })
    await assert.rejects(
      () => service.commit(me, draft.id, { confirmWarnings: true }),
      'DRAFT_INCOMPLETE'
    )
    assert.lengthOf(await Delivery.query().whereNull('voidedAt'), 0)
  })

  // Mutations caught: summing the purchase price per line instead of per piece, counting
  // lines as pieces, or a line without a purchase price breaking the total.
  test('the commit audit carries pieces and the purchase total', async ({ assert }) => {
    const me = await supplier()
    const [pepsi, bar] = [await product(), await product()]
    const draft = await service.create(me.id, {
      source: 'web',
      items: [
        { productId: pepsi.id, amount: 24, purchasePrice: 14.9 },
        { productId: bar.id, amount: 10, price: 18 },
      ],
    })
    await service.commit(me, draft.id)

    const log = await db.from('audit_logs').where('action', 'stock_draft.committed').firstOrFail()
    // 24 × 14.90 = 357.60; the bar has no purchase price.
    assert.deepEqual(log.metadata, {
      source: 'web',
      deliveries: 2,
      pieces: 34,
      purchaseTotal: 357.6,
    })
  })

  // Mutation caught: the margin of the admin who commits instead of the owner's — a
  // different admin margin must not change what customers pay.
  test("an admin's own margin never prices a supplier's lot", async ({ assert }) => {
    const owner = await supplier(10)
    const admin = await UserFactory.apply('admin').create()
    admin.marginPercent = 50
    await admin.save()
    const pepsi = await product()
    const draft = await service.create(owner.id, {
      source: 'mcp',
      items: [{ productId: pepsi.id, amount: 6, purchasePrice: 14.2 }],
    })
    const { deliveries } = await service.commit(admin, draft.id)
    // ceil(14.20 × 1.10 = 15.62) = 16; with the admin's 50 % it would be 22.
    assert.equal(deliveries[0].price, 16)
    assert.equal(deliveries[0].supplierId, owner.id)
  })

  // Mutations caught: computing the stock before the commit per supplier (a colleague's
  // pieces still on the shelf make it no news), or mailing a disabled account.
  test("restock e-mails: a colleague's pieces on the shelf count, disabled fans get none", async ({
    assert,
  }) => {
    NotificationService.prototype.sendRestockNotifications = sendRestockNotifications
    const fakeMailer = mail.fake()
    const me = await supplier()
    const colleague = await supplier()
    const stillThere = await product()
    const soldOut = await product()
    await lot(colleague.id, stillThere.id, { amount: 10, left: 2 })
    await lot(colleague.id, soldOut.id, { amount: 10, left: 0 })
    const fan = await UserFactory.create()
    const leaver = await UserFactory.merge({ isDisabled: true }).create()
    const now = new Date()
    await db.table('user_favorites').multiInsert([
      { user_id: fan.id, product_id: stillThere.id, created_at: now },
      { user_id: fan.id, product_id: soldOut.id, created_at: now },
      { user_id: leaver.id, product_id: soldOut.id, created_at: now },
    ])

    const draft = await service.create(me.id, {
      source: 'web',
      items: [
        { productId: stillThere.id, amount: 6, price: 20 },
        { productId: soldOut.id, amount: 6, price: 20 },
      ],
    })
    await service.commit(me, draft.id)

    const until = Date.now() + 3000
    while (fakeMailer.messages.sent().length < 1 && Date.now() < until) {
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    // Give a wrong second e-mail the chance to show up.
    await new Promise((resolve) => setTimeout(resolve, 150))
    const sent = fakeMailer.messages.sent()
    assert.lengthOf(sent, 1)
    assert.isTrue(sent[0].hasTo(fan.email))
    const html = String(sent[0].toJSON().message.html ?? '')
    assert.include(html, soldOut.displayName)
    assert.notInclude(html, stillThere.displayName)
  })
})
