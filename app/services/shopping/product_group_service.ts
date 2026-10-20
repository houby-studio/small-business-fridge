import db from '@adonisjs/lucid/services/db'
import ProductGroup from '#models/product_group'
import Product from '#models/product'
import Category from '#models/category'
import AuditService from '#services/audit_service'
import { DomainError } from '#services/domain_error'
import { isUniqueViolation } from '#services/unique_violation'

export type ProductGroupErrorCode = 'GROUP_NOT_FOUND' | 'GROUP_NAME_TAKEN' | 'CATEGORY_NOT_FOUND'

export interface ProductGroupInput {
  name: string
  categoryId: number
  note?: string | null
  /** The complete membership — products not listed leave the group. Omit to keep it. */
  productIds?: number[]
}

export interface ProductGroupSummary {
  id: number
  name: string
  note: string | null
  categoryId: number
  categoryName: string | null
  categoryColor: string | null
  productIds: number[]
  productNames: string[]
}

/**
 * Purchase groups: interchangeable products the shopping list plans as one line. Shared
 * by all suppliers, like the catalogue itself.
 */
export default class ProductGroupService {
  async list(): Promise<ProductGroupSummary[]> {
    const groups = await ProductGroup.query()
      .preload('category')
      .preload('products', (q) => q.orderBy('displayName', 'asc'))
      .orderBy('name', 'asc')

    return groups.map((group) => ({
      id: group.id,
      name: group.name,
      note: group.note,
      categoryId: group.categoryId,
      categoryName: group.category?.name ?? null,
      categoryColor: group.category?.color ?? null,
      productIds: group.products.map((p) => p.id),
      productNames: group.products.map((p) => p.displayName),
    }))
  }

  async create(actorId: number, input: ProductGroupInput): Promise<ProductGroup> {
    await this.assertCategory(input.categoryId)
    let group: ProductGroup
    try {
      group = await db.transaction(async (trx) => {
        const created = await ProductGroup.create(
          {
            name: input.name.trim(),
            categoryId: input.categoryId,
            note: input.note?.trim() || null,
          },
          { client: trx }
        )
        // Products taken over from another group leave a trace for that group too.
        const movedFrom = input.productIds?.length
          ? await Product.query({ client: trx })
              .whereIn('id', input.productIds)
              .whereNotNull('productGroupId')
              .distinct('productGroupId')
          : []
        if (input.productIds?.length) {
          await Product.query({ client: trx })
            .whereIn('id', input.productIds)
            .update({ productGroupId: created.id })
        }
        await AuditService.log(
          actorId,
          'product_group.created',
          'product_group',
          created.id,
          null,
          {
            name: created.name,
            productCount: input.productIds?.length ?? 0,
            ...(movedFrom.length && {
              movedFromGroupIds: movedFrom.map((p) => p.productGroupId),
            }),
          },
          { client: trx }
        )
        return created
      })
    } catch (err) {
      if (isUniqueViolation(err, 'product_groups_name')) {
        throw new DomainError<ProductGroupErrorCode>('GROUP_NAME_TAKEN')
      }
      throw err
    }
    return group
  }

  async update(actorId: number, groupId: number, input: ProductGroupInput): Promise<ProductGroup> {
    const group = await ProductGroup.find(groupId)
    if (!group) throw new DomainError<ProductGroupErrorCode>('GROUP_NOT_FOUND')
    await this.assertCategory(input.categoryId)

    const before = { name: group.name, categoryId: group.categoryId, note: group.note }
    const members = await Product.query().where('productGroupId', group.id).select('id')
    const beforeIds = new Set(members.map((p) => p.id))

    try {
      await db.transaction(async (trx) => {
        group.useTransaction(trx)
        group.name = input.name.trim()
        group.categoryId = input.categoryId
        group.note = input.note?.trim() || null
        await group.save()

        let movedFrom: number[] = []
        if (input.productIds !== undefined) {
          const wanted = new Set(input.productIds)
          const previous = await Product.query({ client: trx })
            .whereIn('id', [...wanted])
            .whereNotNull('productGroupId')
            .whereNot('productGroupId', group.id)
            .distinct('productGroupId')
          movedFrom = previous.map((p) => p.productGroupId!)
          const leaving = [...beforeIds].filter((id) => !wanted.has(id))
          if (leaving.length) {
            await Product.query({ client: trx })
              .whereIn('id', leaving)
              .update({ productGroupId: null })
          }
          if (wanted.size) {
            await Product.query({ client: trx })
              .whereIn('id', [...wanted])
              .update({ productGroupId: group.id })
          }
        }

        const changes: Record<string, unknown> = {}
        if (before.name !== group.name) changes.name = { from: before.name, to: group.name }
        if (before.categoryId !== group.categoryId) {
          changes.categoryId = { from: before.categoryId, to: group.categoryId }
        }
        if ((before.note ?? '') !== (group.note ?? '')) {
          changes.note = { from: before.note ?? '—', to: group.note ?? '—' }
        }
        if (input.productIds !== undefined) {
          const after = new Set(input.productIds)
          const added = [...after].filter((id) => !beforeIds.has(id))
          const removed = [...beforeIds].filter((id) => !after.has(id))
          if (added.length) changes.addedProductIds = added
          if (removed.length) changes.removedProductIds = removed
          if (movedFrom.length) changes.movedFromGroupIds = movedFrom
        }
        await AuditService.log(
          actorId,
          'product_group.updated',
          'product_group',
          group.id,
          null,
          { name: group.name, ...changes },
          { client: trx }
        )
      })
    } catch (err) {
      if (isUniqueViolation(err, 'product_groups_name')) {
        throw new DomainError<ProductGroupErrorCode>('GROUP_NAME_TAKEN')
      }
      throw err
    }

    return group
  }

  async delete(actorId: number, groupId: number): Promise<void> {
    const group = await ProductGroup.find(groupId)
    if (!group) throw new DomainError<ProductGroupErrorCode>('GROUP_NOT_FOUND')
    // products.product_group_id is ON DELETE SET NULL — the products simply stand alone again.
    await db.transaction(async (trx) => {
      await group.useTransaction(trx).delete()
      await AuditService.log(
        actorId,
        'product_group.deleted',
        'product_group',
        groupId,
        null,
        { name: group.name },
        { client: trx }
      )
    })
  }

  private async assertCategory(categoryId: number) {
    if (!(await Category.find(categoryId))) {
      throw new DomainError<ProductGroupErrorCode>('CATEGORY_NOT_FOUND')
    }
  }
}
