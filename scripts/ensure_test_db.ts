import { ensureTestDatabaseExists, getTestDbConfigFromEnv } from '#tests/utils/test_db'

await ensureTestDatabaseExists()

const config = getTestDbConfigFromEnv()
console.log(`Ensured test database exists: ${config.database} (${config.host}:${config.port})`)
