import { BaseCommand, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import { runMongoToPostgresMigration } from '../scripts/migrate_from_mongodb.js'

export default class MigrationMongodb extends BaseCommand {
  static commandName = 'migration:mongodb'
  static description = 'Migrate legacy MongoDB data into PostgreSQL'
  static options: CommandOptions = {}

  @flags.string({
    flagName: 'connectionstring',
    alias: 'c',
    description: 'MongoDB connection string. Falls back to MONGO_URI env var.',
  })
  declare connectionString?: string

  async run() {
    const mongoUri = this.connectionString ?? process.env.MONGO_URI
    if (!mongoUri) {
      this.logger.error(
        'Missing MongoDB connection string. Use --connectionstring or set MONGO_URI.'
      )
      this.exitCode = 1
      return
    }

    await runMongoToPostgresMigration({ mongoUri })
  }
}
