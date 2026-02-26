import { DateTime } from 'luxon'
import { BaseModel, column, manyToMany } from '@adonisjs/lucid/orm'
import type { ManyToMany } from '@adonisjs/lucid/types/relations'
import Product from '#models/product'
import User from '#models/user'

export default class Allergen extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare name: string

  @column()
  declare isDisabled: boolean

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime

  // Relationships

  @manyToMany(() => Product, {
    pivotTable: 'product_allergen',
  })
  declare products: ManyToMany<typeof Product>

  @manyToMany(() => User, {
    pivotTable: 'user_excluded_allergen',
    pivotForeignKey: 'allergen_id',
    pivotRelatedForeignKey: 'user_id',
  })
  declare excludedByUsers: ManyToMany<typeof User>
}
