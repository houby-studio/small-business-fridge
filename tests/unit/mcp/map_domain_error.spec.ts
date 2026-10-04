import '#tests/test_context'
import { test } from '@japa/runner'
import { DomainError } from '#services/domain_error'
import {
  ERROR_HINTS,
  describeError,
  failWithCode,
  mapDomainError,
  readOnly,
  destructive,
  idempotentWrite,
  additiveWrite,
} from '#mcp/tools/helpers'

function text(result: ReturnType<typeof mapDomainError>): string {
  const block = result.content[0]
  return block.type === 'text' ? block.text : ''
}

test.group('MCP helpers — mapDomainError', () => {
  test('a DomainError keeps its code and gets the hint', ({ assert }) => {
    const result = mapDomainError(new DomainError('DRAFT_CLOSED'), 'Stocking the draft failed')
    assert.isTrue(result.isError)
    assert.equal(
      text(result),
      `Stocking the draft failed (error code: DRAFT_CLOSED). ${ERROR_HINTS.DRAFT_CLOSED}`
    )
  })

  test('a DomainError with an unknown code still reports the code', ({ assert }) => {
    const result = mapDomainError(new DomainError('SOMETHING_NEW'), 'Doing it failed')
    assert.isTrue(result.isError)
    assert.equal(text(result), 'Doing it failed (error code: SOMETHING_NEW).')
  })

  test('plain Errors whose message is a known code are mapped like domain errors', ({ assert }) => {
    const result = mapDomainError(new Error('OUT_OF_STOCK'), 'Purchase failed')
    assert.include(text(result), '(error code: OUT_OF_STOCK)')
    assert.include(text(result), ERROR_HINTS.OUT_OF_STOCK)
  })

  test('a longer code wins over a code it contains', ({ assert }) => {
    const result = mapDomainError(new Error('PRODUCT_NOT_FOUND'), 'Writing off stock failed')
    assert.include(text(result), '(error code: PRODUCT_NOT_FOUND)')
    assert.notInclude(text(result), '(error code: NOT_FOUND)')
  })

  test('Lucid row-not-found errors become NOT_FOUND', ({ assert }) => {
    const result = mapDomainError(new Error('E_ROW_NOT_FOUND: Row not found'), 'Updating failed')
    assert.include(text(result), '(error code: NOT_FOUND)')
  })

  test('unknown errors never leak their message — they become INTERNAL', ({ assert }) => {
    const pg = new Error(
      'insert into "products" ("category_id") values (999) - violates foreign key constraint "products_category_id_foreign"'
    )
    const result = mapDomainError(pg, 'Creating product failed')
    assert.isTrue(result.isError)
    assert.equal(text(result), describeError('INTERNAL', 'Creating product failed'))
    assert.notInclude(text(result), 'foreign key')
    assert.notInclude(text(result), 'insert into')
  })

  test('non-Error throwables are handled too', ({ assert }) => {
    const result = mapDomainError('boom', 'Something failed')
    assert.include(text(result), '(error code: INTERNAL)')
  })

  test('failWithCode builds the same message as a thrown DomainError', ({ assert }) => {
    assert.deepEqual(
      failWithCode('CATEGORY_NOT_FOUND', 'Creating product failed'),
      mapDomainError(new DomainError('CATEGORY_NOT_FOUND'), 'Creating product failed')
    )
  })

  test('every hint ends the sentence it adds', ({ assert }) => {
    for (const [code, hint] of Object.entries(ERROR_HINTS)) {
      assert.match(hint, /[.!?]$/, `${code}: hint should end with punctuation`)
    }
  })
})

test.group('MCP helpers — annotations', () => {
  test('every annotation helper states all hints and closes the world', ({ assert }) => {
    for (const annotations of [
      readOnly('Read'),
      destructive('Destroy'),
      destructive('Destroy twice', true),
      idempotentWrite('Upsert'),
      additiveWrite('Append'),
    ]) {
      assert.isString(annotations.title)
      assert.isBoolean(annotations.readOnlyHint)
      assert.isBoolean(annotations.destructiveHint)
      assert.isBoolean(annotations.idempotentHint)
      assert.isFalse(annotations.openWorldHint)
    }
  })

  test('the helpers encode the four behaviours distinctly', ({ assert }) => {
    assert.include(readOnly('r'), { readOnlyHint: true, destructiveHint: false })
    assert.include(destructive('d'), {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
    })
    assert.include(destructive('d', true), { destructiveHint: true, idempotentHint: true })
    assert.include(idempotentWrite('i'), {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
    })
    assert.include(additiveWrite('a'), {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
    })
  })
})
