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
import type User from '#models/user'
import StockDraftService from '#services/shopping/stock_draft_service'
import DeliveryService from '#services/delivery_service'
import InventoryService from '#services/inventory_service'
import OrderService from '#services/order_service'
import NotificationService from '#services/notification_service'
import { assertStockInvariants } from '#tests/helpers/stock_invariants'

/**
 * F3 (PLAN2): a stocked draft can be taken back as a whole while nothing happened to its
 * pieces — no sale, no write-off, no inventory difference, no handover — and the last 30 days
 * of stocked drafts are listed under the open ones.
 */

const service = new StockDraftService()

const cleanAll = async () => {
  await db.rawQuery('TRUNCATE TABLE users, categories, product_groups CASCADE')
}

async function product() {
  const category = await CategoryFactory.create()
  return ProductFactory.merge({ categoryId: category.id }).create()
}

/** A stocked draft of `lines` (pieces each), returned with its lots in line order. */
async function stocked(owner: User, lines: Array<{ productId: number; amount: number }>) {
  const draft = await service.create(owner.id, {
    source: 'web',
    items: lines.map((l) => ({ ...l, price: 20, purchasePrice: 12.5 })),
  })
  const { deliveries } = await service.commit(owner, draft.id, { confirmWarnings: true })
  return { draft, lots: deliveries }
}

async function lotState(id: number) {
  const lot = await Delivery.findOrFail(id)
  return [lot.amountSupplied, lot.amountLeft, lot.amountLost, lot.voidedAt !== null]
}

async function draftStatus(id: number) {
  const draft = await StockDraft.findOrFail(id)
  return draft.status
}

async function listedCanVoid(owner: User, draftId: number) {
  const { data } = await service.listStocked(owner.id)
  return data.find((row) => row.id === draftId)?.canVoid
}

test.group('StockDraftService — voiding a stocked draft (F3)', (group) => {
  const sendRestockNotifications = NotificationService.prototype.sendRestockNotifications
  const notifyCorrection = DeliveryService.prototype.notifyCorrection
  group.each.setup(async () => {
    await cleanAll()
    mail.fake()
    NotificationService.prototype.sendRestockNotifications = async () => {}
    // Fired without awaiting after a void; its queries would race the next TRUNCATE.
    DeliveryService.prototype.notifyCorrection = () => {}
  })
  group.each.teardown(async () => {
    NotificationService.prototype.sendRestockNotifications = sendRestockNotifications
    DeliveryService.prototype.notifyCorrection = notifyCorrection
    mail.restore()
    await cleanAll()
  })

  // Mutations caught: voiding only some lots, a missing audit entry or wrong totals in it,
  // the draft left committed.
  test('an untouched stocked draft is voided as a whole, with one reason', async ({ assert }) => {
    const me = await UserFactory.apply('supplier').create()
    const [pepsi, cola] = [await product(), await product()]
    const { draft, lots } = await stocked(me, [
      { productId: pepsi.id, amount: 24 },
      { productId: cola.id, amount: 6 },
    ])
    assert.isTrue(await service.canVoid(draft.id))
    assert.isTrue(await listedCanVoid(me, draft.id))

    const result = await service.voidStocked(me, draft.id, 'Účtenka naskladněna dvakrát')

    assert.equal(result.voidedDeliveries, 2)
    for (const lot of lots) assert.deepEqual(await lotState(lot.id), [0, 0, 0, true])
    const voided = await StockDraft.findOrFail(draft.id)
    assert.equal(voided.status, 'voided')
    assert.equal(voided.voidReason, 'Účtenka naskladněna dvakrát')
    assert.isNotNull(voided.voidedAt)
    const log = await db.from('audit_logs').where('action', 'stock_draft.voided').firstOrFail()
    assert.deepEqual([log.user_id, log.target_user_id, log.entity_id], [me.id, null, draft.id])
    assert.deepEqual(log.metadata, {
      source: 'web',
      reason: 'Účtenka naskladněna dvakrát',
      deliveries: 2,
      pieces: 30,
    })
    // Each lot's own void is in the history as well.
    assert.lengthOf(await db.from('audit_logs').where('action', 'delivery.voided'), 2)
    const listed = await service.listStocked(me.id)
    const row = listed.data.find((r) => r.id === draft.id)!
    assert.deepEqual([row.status, row.canVoid], ['voided', false])

    await assert.rejects(() => service.voidStocked(me, draft.id, 'Znovu'), 'DRAFT_VOIDED')
    await assertStockInvariants(assert)
  })

  // One sold piece on one lot blocks the whole draft — and nothing is voided half-way.
  // Mutations caught: checking only the first lot, voiding lot by lot before checking all.
  test('a single sale on any lot blocks the void and leaves every lot as it was', async ({
    assert,
  }) => {
    const me = await UserFactory.apply('supplier').create()
    const buyer = await UserFactory.create()
    const [pepsi, cola] = [await product(), await product()]
    const { draft, lots } = await stocked(me, [
      { productId: pepsi.id, amount: 24 },
      { productId: cola.id, amount: 6 },
    ])
    await new OrderService().purchase(buyer.id, lots[1].id, 'web')

    assert.isFalse(await service.canVoid(draft.id))
    assert.isFalse(await listedCanVoid(me, draft.id))
    await assert.rejects(() => service.voidStocked(me, draft.id, 'Omyl'), 'DRAFT_HAS_SALES')
    assert.deepEqual(await lotState(lots[0].id), [24, 24, 0, false])
    assert.deepEqual(await lotState(lots[1].id), [6, 5, 0, false])
    assert.equal(await draftStatus(draft.id), 'committed')
    assert.lengthOf(await db.from('audit_logs').where('action', 'delivery.voided'), 0)
    await assertStockInvariants(assert)
  })

  // Mutation caught: looking at sales only — a write-off or a piece found by an inventory
  // also changed what the lots hold.
  test('a write-off or an inventory surplus blocks the void; a reverted write-off does not', async ({
    assert,
  }) => {
    const me = await UserFactory.apply('supplier').create()
    const [pepsi, cola] = [await product(), await product()]
    const inventory = new InventoryService()

    const written = await stocked(me, [{ productId: pepsi.id, amount: 10 }])
    const [adjustment] = await inventory.writeOff(me, {
      productId: pepsi.id,
      quantity: 2,
      reason: 'damaged',
    })
    assert.isFalse(await service.canVoid(written.draft.id))
    await assert.rejects(() => service.voidStocked(me, written.draft.id, 'Omyl'), 'DRAFT_HAS_SALES')

    // Taken back: the lot is whole again, so the draft can go.
    await inventory.revertWriteOff(me, adjustment.id)
    assert.isTrue(await service.canVoid(written.draft.id))
    await service.voidStocked(me, written.draft.id, 'Omyl')
    assert.deepEqual(await lotState(written.lots[0].id), [0, 0, 0, true])

    const found = await stocked(me, [{ productId: cola.id, amount: 6 }])
    await db
      .from('deliveries')
      .where('id', found.lots[0].id)
      .update({ amount_left: 7, amount_lost: -1 })
    assert.isFalse(await service.canVoid(found.draft.id))
    await assert.rejects(() => service.voidStocked(me, found.draft.id, 'Omyl'), 'DRAFT_HAS_SALES')
    // One piece sold and one found by an inventory: the lot holds as many as it came with,
    // but its history is not empty.
    const buyer = await UserFactory.create()
    const water = await product()
    const mixed = await stocked(me, [{ productId: water.id, amount: 6 }])
    await new OrderService().purchase(buyer.id, mixed.lots[0].id, 'web')
    await db
      .from('deliveries')
      .where('id', mixed.lots[0].id)
      .update({ amount_left: 6, amount_lost: -1 })
    assert.isFalse(await service.canVoid(mixed.draft.id))
    assert.isFalse(await listedCanVoid(me, mixed.draft.id))
    await assert.rejects(() => service.voidStocked(me, mixed.draft.id, 'Omyl'), 'DRAFT_HAS_SALES')
    await assertStockInvariants(assert, { productIds: [pepsi.id] })
  })

  // A lot voided on its own (a typo on one line) is skipped, the rest goes.
  test('a lot voided on its own before is skipped', async ({ assert }) => {
    const me = await UserFactory.apply('supplier').create()
    const [pepsi, cola] = [await product(), await product()]
    const { draft, lots } = await stocked(me, [
      { productId: pepsi.id, amount: 24 },
      { productId: cola.id, amount: 6 },
    ])
    await new DeliveryService().voidDelivery(me, lots[0].id, 'Překlep')

    const result = await service.voidStocked(me, draft.id, 'Celá účtenka byla omyl')
    assert.equal(result.voidedDeliveries, 1)
    assert.deepEqual(await lotState(lots[1].id), [0, 0, 0, true])
    const log = await db.from('audit_logs').where('action', 'stock_draft.voided').firstOrFail()
    assert.equal(log.metadata.pieces, 6)
    await assertStockInvariants(assert)
  })

  // Mutations caught: no owner check, voiding an open or discarded draft.
  test('only the owner or an admin voids, and only a stocked draft', async ({ assert }) => {
    const me = await UserFactory.apply('supplier').create()
    const colleague = await UserFactory.apply('supplier').create()
    const admin = await UserFactory.apply('admin').create()
    const pepsi = await product()
    const { draft, lots } = await stocked(me, [{ productId: pepsi.id, amount: 24 }])

    await assert.rejects(() => service.voidStocked(colleague, draft.id, 'Cizí'), 'DRAFT_NOT_FOUND')
    assert.deepEqual(await lotState(lots[0].id), [24, 24, 0, false])

    const open = await service.create(me.id, {
      source: 'web',
      items: [{ productId: pepsi.id, amount: 1, price: 20 }],
    })
    await assert.rejects(() => service.voidStocked(me, open.id, 'Omyl'), 'DRAFT_NOT_COMMITTED')

    await service.voidStocked(admin, draft.id, 'Za dodavatele')
    const log = await db.from('audit_logs').where('action', 'stock_draft.voided').firstOrFail()
    assert.deepEqual([log.user_id, log.target_user_id], [admin.id, me.id])
  })

  // Stock handed over to a colleague (F2) is real stock elsewhere now: taking the draft back
  // must be refused up front — not offered as possible and then failing with a code the page
  // does not know.
  test('a draft whose pieces were handed over cannot be voided', async ({ assert }) => {
    const me = await UserFactory.apply('supplier').create()
    const colleague = await UserFactory.apply('supplier').create()
    const admin = await UserFactory.apply('admin').create()
    const pepsi = await product()
    const { draft } = await stocked(me, [{ productId: pepsi.id, amount: 24 }])
    await new DeliveryService().transferStock(me.id, colleague.id, admin)

    assert.isFalse(await service.canVoid(draft.id))
    assert.isFalse(await listedCanVoid(me, draft.id))
    await assert.rejects(() => service.voidStocked(me, draft.id, 'Omyl'), 'DRAFT_TRANSFERRED')
    const theirs = await Delivery.query().where('supplierId', colleague.id).firstOrFail()
    assert.deepEqual([theirs.amountLeft, theirs.voidedAt], [24, null])
    await assertStockInvariants(assert)
  })

  // A void racing a purchase from one of its lots: either the sale wins and the void is
  // refused, or the void wins and the sale finds nothing — never both.
  // Mutation caught: no row locks on the lots in `voidStocked`.
  test('a void racing a purchase never voids a sold piece', async ({ assert }) => {
    const me = await UserFactory.apply('supplier').create()
    const buyer = await UserFactory.create()
    const pepsi = await product()
    for (let round = 0; round < 5; round++) {
      const { draft, lots } = await stocked(me, [{ productId: pepsi.id, amount: 1 }])
      const [voiding, buying] = await Promise.allSettled([
        service.voidStocked(me, draft.id, 'Omyl'),
        new OrderService().purchase(buyer.id, lots[0].id, 'web'),
      ])
      assert.notEqual(
        voiding.status === 'fulfilled',
        buying.status === 'fulfilled',
        `round ${round}: exactly one of them goes through`
      )
      const sold = await db.from('orders').where('delivery_id', lots[0].id)
      assert.lengthOf(sold, buying.status === 'fulfilled' ? 1 : 0)
      await assertStockInvariants(assert)
    }
  })
})

test.group('StockDraftService — stocked drafts list (F3)', (group) => {
  const sendRestockNotifications = NotificationService.prototype.sendRestockNotifications
  group.each.setup(async () => {
    await cleanAll()
    NotificationService.prototype.sendRestockNotifications = async () => {}
  })
  group.each.teardown(async () => {
    NotificationService.prototype.sendRestockNotifications = sendRestockNotifications
    await cleanAll()
  })

  // PLAN2 F3: "posledních 30 dní" — 29 days back is in, 31 is out.
  // Mutations caught: a different window, listing a colleague's or an open/discarded draft,
  // purchase total per line instead of per piece, missing page split.
  test('the last 30 days of my stocked drafts, newest first, with their totals', async ({
    assert,
  }) => {
    const me = await UserFactory.apply('supplier').create()
    const colleague = await UserFactory.apply('supplier').create()
    const pepsi = await product()
    const commitWith = async (owner: User, items: any[]) => {
      const draft = await service.create(owner.id, { source: 'mcp', items })
      await service.commit(owner, draft.id, { confirmWarnings: true })
      return draft.id
    }
    const recent = await commitWith(me, [
      { productId: pepsi.id, amount: 24, purchasePrice: 14.9, price: 20 },
      { productId: pepsi.id, amount: 6, price: 20 },
    ])
    const inside = await commitWith(me, [{ productId: pepsi.id, amount: 1, price: 20 }])
    const outside = await commitWith(me, [{ productId: pepsi.id, amount: 1, price: 20 }])
    await commitWith(colleague, [{ productId: pepsi.id, amount: 1, price: 20 }])
    await service.create(me.id, { source: 'web', items: [{ productId: pepsi.id, amount: 1 }] })
    const ago = (days: number, minutes = 0) => DateTime.now().minus({ days, minutes }).toJSDate()
    await db
      .from('stock_drafts')
      .where('id', recent)
      .update({ committed_at: ago(0, 5) })
    await db
      .from('stock_drafts')
      .where('id', inside)
      .update({ committed_at: ago(29) })
    await db
      .from('stock_drafts')
      .where('id', outside)
      .update({ committed_at: ago(31) })

    const { data, meta } = await service.listStocked(me.id)
    assert.deepEqual(
      data.map((row) => row.id),
      [recent, inside]
    )
    assert.equal(meta.total, 2)
    // 24 × 14.90 = 357.60; the second line has no purchase price.
    assert.deepInclude(data[0], {
      lines: 2,
      pieces: 30,
      purchaseTotal: 357.6,
      linesWithoutPurchase: 1,
      status: 'committed',
    })
    assert.isNull(data[1].purchaseTotal)

    const firstPage = await service.listStocked(me.id, 1, 1)
    const secondPage = await service.listStocked(me.id, 2, 1)
    assert.deepEqual(
      [firstPage.data[0].id, secondPage.data[0].id, firstPage.meta.lastPage],
      [recent, inside, 2]
    )
  })
})
