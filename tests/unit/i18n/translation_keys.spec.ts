import { test } from '@japa/runner'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = process.cwd()
const LOCALES = ['cs', 'en']
const SCANNED_DIRS = ['app', 'inertia', 'resources/views']
const EXTENSIONS = ['.ts', '.vue', '.edge']

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) return walk(path)
    return EXTENSIONS.some((ext) => path.endsWith(ext)) ? [path] : []
  })
}

function loadLocale(locale: string): Record<string, Record<string, string>> {
  const dir = join(ROOT, 'resources/lang', locale)
  return Object.fromEntries(
    readdirSync(dir)
      .filter((file) => file.endsWith('.json'))
      .map((file) => [
        file.replace('.json', ''),
        JSON.parse(readFileSync(join(dir, file), 'utf-8')),
      ])
  )
}

/**
 * Server-side translations are loaded once at boot, so a key added to the code but not to a
 * locale file only shows up as "translation missing: …" in a live email or page. Catch every
 * literal `t('namespace.key')` / `i18n.t('namespace.key')` that has no translation.
 */
test.group('Translation keys', () => {
  test('every literal t() key exists in all locales', ({ assert }) => {
    const locales = Object.fromEntries(LOCALES.map((locale) => [locale, loadLocale(locale)]))
    const namespaces = new Set(Object.keys(locales.cs))
    const pattern = /\bt\(\s*['"]([a-z_]+)\.([A-Za-z0-9_]+)['"]/g
    const missing: string[] = []

    for (const file of SCANNED_DIRS.flatMap((dir) => walk(join(ROOT, dir)))) {
      const source = readFileSync(file, 'utf-8')
      for (const [, namespace, key] of source.matchAll(pattern)) {
        if (!namespaces.has(namespace)) continue
        for (const locale of LOCALES) {
          if (locales[locale][namespace]?.[key] === undefined) {
            missing.push(`${locale}: ${namespace}.${key} (${relative(ROOT, file)})`)
          }
        }
      }
    }

    assert.deepEqual(missing, [])
  })
})
