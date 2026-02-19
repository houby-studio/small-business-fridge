import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

interface TestRecord {
  suiteName: string
  groupName: string | undefined
  title: string
  duration: number
  failed: boolean
  skipped: boolean
  errorMessage: string | undefined
  errorStack: string | undefined
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function resolveTitle(title: unknown): string {
  if (typeof title === 'string') return title
  if (title && typeof title === 'object') {
    const t = title as Record<string, unknown>
    return String(t.expanded ?? t.original ?? JSON.stringify(title))
  }
  return String(title)
}

/**
 * JUnit XML reporter for Japa.
 *
 * Writes a JUnit-compatible XML report to `outputFile` (relative to cwd).
 * Compatible with GitHub Actions (mikepenz/action-junit-report),
 * Azure DevOps (Publish Test Results task), and any CI that reads JUnit XML.
 *
 * Usage in tests/bootstrap.ts:
 *   import { spec } from '@japa/runner/reporters'
 *   import { junitReporter } from './reporters/junit.js'
 *   export const reporters = {
 *     activated: ['spec', 'junit'],
 *     list: [spec(), junitReporter()],
 *   }
 */
export function junitReporter(options: { outputFile?: string } = {}) {
  const outputFile = options.outputFile ?? 'test-results/junit-japa.xml'

  return {
    name: 'junit' as const,

    handler(runner: any, emitter: any) {
      const suiteTests = new Map<string, TestRecord[]>()
      let currentSuite = 'unknown'
      let currentGroup: string | undefined
      const startTime = Date.now()

      emitter.on('suite:start', (payload: any) => {
        currentSuite = payload.name
        if (!suiteTests.has(currentSuite)) {
          suiteTests.set(currentSuite, [])
        }
      })

      emitter.on('suite:end', () => {
        currentSuite = 'unknown'
      })

      emitter.on('group:start', (payload: any) => {
        currentGroup = resolveTitle(payload.title)
      })

      emitter.on('group:end', () => {
        currentGroup = undefined
      })

      emitter.on('test:end', (payload: any) => {
        const records = suiteTests.get(currentSuite) ?? []

        let errorMessage: string | undefined
        let errorStack: string | undefined

        if (payload.hasError && Array.isArray(payload.errors) && payload.errors.length > 0) {
          const err = payload.errors[0]?.error
          errorMessage = err?.message ?? 'Unknown error'
          errorStack = err?.stack ?? ''
        }

        records.push({
          suiteName: currentSuite,
          groupName: currentGroup,
          title: resolveTitle(payload.title),
          duration: typeof payload.duration === 'number' ? payload.duration : 0,
          failed: Boolean(payload.hasError),
          skipped: Boolean(payload.isSkipped),
          errorMessage,
          errorStack,
        })

        suiteTests.set(currentSuite, records)
      })

      emitter.on('runner:end', () => {
        const totalDurationSec = (Date.now() - startTime) / 1000

        let totalTests = 0
        let totalFailures = 0
        let totalSkipped = 0

        for (const records of suiteTests.values()) {
          totalTests += records.length
          totalFailures += records.filter((r) => r.failed).length
          totalSkipped += records.filter((r) => r.skipped).length
        }

        const lines: string[] = []
        lines.push('<?xml version="1.0" encoding="UTF-8"?>')
        lines.push(
          `<testsuites name="Japa" tests="${totalTests}" failures="${totalFailures}" skipped="${totalSkipped}" errors="0" time="${totalDurationSec.toFixed(3)}">`
        )

        for (const [suiteName, records] of suiteTests.entries()) {
          const suiteFailures = records.filter((r) => r.failed).length
          const suiteSkipped = records.filter((r) => r.skipped).length
          const suiteDurationSec = records.reduce((acc, r) => acc + r.duration, 0) / 1000

          lines.push(
            `  <testsuite name="${escapeXml(suiteName)}" tests="${records.length}" failures="${suiteFailures}" skipped="${suiteSkipped}" errors="0" time="${suiteDurationSec.toFixed(3)}">`
          )

          for (const rec of records) {
            const classname = rec.groupName
              ? escapeXml(`${rec.suiteName}.${rec.groupName}`)
              : escapeXml(rec.suiteName)
            const durationSec = (rec.duration / 1000).toFixed(3)

            lines.push(
              `    <testcase name="${escapeXml(rec.title)}" classname="${classname}" time="${durationSec}">`
            )

            if (rec.skipped) {
              lines.push('      <skipped/>')
            } else if (rec.failed) {
              const msg = escapeXml(rec.errorMessage ?? 'Test failed')
              const stack = escapeXml(rec.errorStack ?? '')
              lines.push(`      <failure message="${msg}" type="AssertionError">${stack}</failure>`)
            }

            lines.push('    </testcase>')
          }

          lines.push('  </testsuite>')
        }

        lines.push('</testsuites>')

        const absPath = join(process.cwd(), outputFile)
        mkdirSync(dirname(absPath), { recursive: true })
        writeFileSync(absPath, lines.join('\n') + '\n', 'utf-8')
      })
    },
  }
}
