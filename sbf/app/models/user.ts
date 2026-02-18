import { DateTime } from 'luxon'
import hash from '@adonisjs/core/services/hash'
import { compose } from '@adonisjs/core/helpers'
import { BaseModel, column, hasMany, manyToMany } from '@adonisjs/lucid/orm'
import type { HasMany, ManyToMany } from '@adonisjs/lucid/types/relations'
import { withAuthFinder } from '@adonisjs/auth/mixins/lucid'
import { DbAccessTokensProvider } from '@adonisjs/auth/access_tokens'
import Delivery from '#models/delivery'
import Order from '#models/order'
import Invoice from '#models/invoice'
import Product from '#models/product'

const AuthFinder = withAuthFinder(() => hash.use('scrypt'), {
  uids: ['email', 'username'],
  passwordColumnName: 'password',
})

export default class User extends compose(BaseModel, AuthFinder) {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare oid: string | null

  @column()
  declare username: string | null

  @column({ serializeAs: null })
  declare password: string | null

  @column()
  declare displayName: string

  @column()
  declare email: string

  @column()
  declare phone: string | null

  @column()
  declare iban: string | null

  @column()
  declare keypadId: number

  @column()
  declare cardId: string | null

  @column()
  declare role: 'customer' | 'supplier' | 'admin'

  @column()
  declare isKiosk: boolean

  @column()
  declare isDisabled: boolean

  @column()
  declare showAllProducts: boolean

  @column()
  declare sendMailOnPurchase: boolean

  @column()
  declare sendDailyReport: boolean

  @column()
  declare colorMode: 'light' | 'dark'

  @column()
  declare keypadDisabled: boolean

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime

  // Relationships

  @hasMany(() => Delivery, { foreignKey: 'supplierId' })
  declare deliveries: HasMany<typeof Delivery>

  @hasMany(() => Order, { foreignKey: 'buyerId' })
  declare orders: HasMany<typeof Order>

  @hasMany(() => Invoice, { foreignKey: 'buyerId' })
  declare invoicesAsBuyer: HasMany<typeof Invoice>

  @hasMany(() => Invoice, { foreignKey: 'supplierId' })
  declare invoicesAsSupplier: HasMany<typeof Invoice>

  @manyToMany(() => Product, {
    pivotTable: 'user_favorites',
    pivotTimestamps: { createdAt: 'created_at', updatedAt: false },
  })
  declare favoriteProducts: ManyToMany<typeof Product>

  // Computed helpers

  get isAdmin() {
    return this.role === 'admin'
  }

  get isSupplier() {
    return this.role === 'supplier' || this.role === 'admin'
  }

  // Access tokens for API auth

  static accessTokens = DbAccessTokensProvider.forModel(User)
}
