import { test } from '@japa/runner'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { Validator } from 'jsonschema'

/**
 * `@adonisjs/ace` validates the metadata of every command in `commands/` with
 * `jsonschema` against a schema that uses `$ref: '#/definitions/CommandMetaData'`.
 * jsonschema 1.5.0 resolves that ref with `new URL(ref, 'thismessage::/')`, which
 * spec-conformant WHATWG URL parsers reject (ada >= 4.0.0, shipped in Node 24.20+
 * and Node 26). That made `node ace docs:generate` crash in the Docker build with
 * "Invalid command exported from docs_generate.js. Invalid URL".
 *
 * The fix is the upstream PR tdegrunt/jsonschema#424, applied via patch-package
 * (`patches/jsonschema+1.5.0.patch`). Remove the patch and this test once a
 * jsonschema release ships the fix.
 */
test.group('patches/jsonschema fragment $ref (tdegrunt/jsonschema#423)', () => {
  const schema = {
    $ref: '#/definitions/X',
    definitions: { X: { type: 'object', required: ['commandName'] } },
  }

  test('resolves a local $ref on a schema without $id', ({ assert }) => {
    const validator = new Validator()

    assert.doesNotThrow(() =>
      validator.validate({ commandName: 'docs:generate' }, schema, { throwError: true })
    )
    assert.isFalse(validator.validate({}, schema).valid)
    assert.isFalse(validator.validate(1, schema).valid)
  })

  test('still reports an unknown document as SchemaError', ({ assert }) => {
    assert.throws(
      () => new Validator().validate({}, { $ref: 'missing.json#/definitions/X' }),
      /no such schema/
    )
  })

  test('installed copy carries the patch-package fix', async ({ assert }) => {
    const require = createRequire(import.meta.url)
    const source = await readFile(require.resolve('jsonschema/lib/validator.js'), 'utf8')

    assert.notInclude(source, "new URL(switchSchema,'thismessage::/')")
  })
})
