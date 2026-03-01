import '#tests/test_context'
import { test } from '@japa/runner'
import {
  clearDynamicImportRecoveryReloadAttempt,
  markDynamicImportRecoveryReloadAttempt,
  shouldRecoverFromDynamicImportError,
} from '../../inertia/app/dynamic_import_recovery.ts'

class MemoryStorage implements Storage {
  #store = new Map<string, string>()

  get length() {
    return this.#store.size
  }

  clear() {
    this.#store.clear()
  }

  getItem(key: string) {
    return this.#store.get(key) ?? null
  }

  key(index: number) {
    return Array.from(this.#store.keys())[index] ?? null
  }

  removeItem(key: string) {
    this.#store.delete(key)
  }

  setItem(key: string, value: string) {
    this.#store.set(key, value)
  }
}

test.group('Dynamic import recovery', () => {
  test('detects dynamic import/preload errors that should trigger recovery', ({ assert }) => {
    assert.isTrue(
      shouldRecoverFromDynamicImportError(
        new Error(
          'Failed to fetch dynamically imported module: http://localhost:3000/inertia/pages/orders/index.vue'
        )
      )
    )
    assert.isTrue(
      shouldRecoverFromDynamicImportError(
        new Error(
          'GET /node_modules/.vite/deps/chunk-ZRDVSBV7.js net::ERR_ABORTED 504 (Outdated Optimize Dep)'
        )
      )
    )
    assert.isTrue(
      shouldRecoverFromDynamicImportError(new Error('TypeError: Importing a module script failed.'))
    )
    assert.isFalse(shouldRecoverFromDynamicImportError(new Error('Random runtime error')))
    assert.isFalse(shouldRecoverFromDynamicImportError(null))
  })

  test('allows only one forced reload per session until app boots successfully', ({ assert }) => {
    const storage = new MemoryStorage()

    assert.isTrue(markDynamicImportRecoveryReloadAttempt(storage))
    assert.isFalse(markDynamicImportRecoveryReloadAttempt(storage))

    clearDynamicImportRecoveryReloadAttempt(storage)

    assert.isTrue(markDynamicImportRecoveryReloadAttempt(storage))
  })
})
