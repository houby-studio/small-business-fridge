/**
 * Writes the closing summary of a CI run to the GitHub job summary.
 *
 * It merges two sources into one page:
 *   - the run's own jobs and steps (Actions API) — what ran, what was skipped, how long it took
 *   - every JUnit XML report the test jobs uploaded — test counts, failures, slowest tests
 *
 * Runs with plain `node` (Node 24 strips the types), so the summary job needs no `npm ci`.
 * Only `node:` builtins may be imported here for that reason.
 *
 * Env: GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_RUN_ID, GITHUB_RUN_ATTEMPT, GITHUB_SERVER_URL,
 *      GITHUB_STEP_SUMMARY, JUNIT_DIR (where the reports were downloaded), SUMMARY_JOB_NAME
 *      (this job, excluded from its own table), CI_CONTEXT (JSON with event/ref/sha/actor).
 */
import { appendFileSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'

interface ApiStep {
  name: string
  conclusion: string | null
  started_at: string | null
  completed_at: string | null
}

interface ApiJob {
  name: string
  conclusion: string | null
  status: string
  started_at: string | null
  completed_at: string | null
  html_url: string
  steps?: ApiStep[]
}

interface TestCase {
  suite: string
  name: string
  seconds: number
  failed: boolean
  skipped: boolean
  message: string
}

interface SuiteReport {
  label: string
  cases: TestCase[]
}

interface CiContext {
  event: string
  ref: string
  sha: string
  actor: string
  prNumber?: string
  imageWillBuild: boolean
}

/** Pretty names for the report files the test jobs write (see playwright*.config.ts, tests/bootstrap.ts). */
const SUITE_LABELS: Record<string, string> = {
  'junit-japa.xml': 'Japa — unit & functional',
  'junit-e2e.xml': 'Playwright — E2E',
  'junit-e2e-auth-matrix.xml': 'Playwright — auth matrix',
}

const RESULT_ICON: Record<string, string> = {
  success: '✅',
  failure: '❌',
  cancelled: '⛔',
  skipped: '⏭️',
  timed_out: '⏱️',
}

function env(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Missing env ${name}`)
  return value
}

function seconds(from: string | null, to: string | null): number | null {
  if (!from || !to) return null
  return Math.max(0, (Date.parse(to) - Date.parse(from)) / 1000)
}

function formatDuration(totalSeconds: number | null): string {
  if (totalSeconds === null) return '—'
  if (totalSeconds < 60) return `${totalSeconds.toFixed(totalSeconds < 10 ? 1 : 0)} s`
  const minutes = Math.floor(totalSeconds / 60)
  return `${minutes} min ${Math.round(totalSeconds % 60)} s`
}

function icon(conclusion: string | null): string {
  return RESULT_ICON[conclusion ?? ''] ?? '⏳'
}

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

function attr(tag: string, name: string): string {
  const match = tag.match(new RegExp(`\\s${name}="([^"]*)"`))
  return match ? decodeXml(match[1]) : ''
}

/**
 * Markdown table cells must stay on one line and must not open a new column. Truncate before
 * escaping, so the cut never lands inside an escape, and escape backslashes first, so a trailing
 * `\` in an error message cannot swallow the pipe that closes the cell.
 */
function cell(value: string, max = 140): string {
  const flat = value.replace(/\s+/g, ' ').trim()
  const short = flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
  return short.replace(/\\/g, '\\\\').replace(/\|/g, '\\|')
}

/**
 * Reads testcases straight from the XML. Counting cases (instead of trusting the root
 * attributes) gives the same numbers for both reporters, which disagree on what goes there.
 */
function parseJunit(xml: string): TestCase[] {
  const cases: TestCase[] = []
  const pattern = /<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g
  for (const match of xml.matchAll(pattern)) {
    const head = `<testcase${match[1]}>`
    const body = match[2] ?? ''
    const failure = body.match(/<(failure|error)\b([^>]*)>/)
    cases.push({
      suite: attr(head, 'classname'),
      name: attr(head, 'name'),
      seconds: Number.parseFloat(attr(head, 'time')) || 0,
      failed: Boolean(failure),
      skipped: /<skipped\b/.test(body),
      message: failure ? attr(`<x${failure[2]}>`, 'message') : '',
    })
  }
  return cases
}

/** Finds report files anywhere under the download dir (each artifact lands in its own folder). */
function findReports(dir: string): string[] {
  let found: string[] = []
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return found
  }
  for (const entry of entries) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) found = found.concat(findReports(path))
    else if (/^junit-.*\.xml$/.test(entry)) found.push(path)
  }
  return found
}

async function fetchJobs(): Promise<ApiJob[]> {
  const url =
    `https://api.github.com/repos/${env('GITHUB_REPOSITORY')}/actions/runs/${env('GITHUB_RUN_ID')}` +
    `/attempts/${env('GITHUB_RUN_ATTEMPT')}/jobs?per_page=100`
  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${env('GITHUB_TOKEN')}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  })
  if (!response.ok) throw new Error(`Actions API answered ${response.status}`)
  const body = (await response.json()) as { jobs: ApiJob[] }
  return body.jobs
}

function renderContext(context: CiContext, serverUrl: string, repo: string): string[] {
  const commitUrl = `${serverUrl}/${repo}/commit/${context.sha}`
  const trigger =
    context.event === 'pull_request' && context.prNumber
      ? `pull request [#${context.prNumber}](${serverUrl}/${repo}/pull/${context.prNumber})`
      : `\`${context.event}\` to \`${context.ref}\``
  return [
    '# CI summary',
    '',
    `Triggered by ${trigger} · commit [\`${context.sha.slice(0, 7)}\`](${commitUrl}) · by @${context.actor}`,
    '',
  ]
}

function renderJobs(jobs: ApiJob[]): string[] {
  const lines = ['## Jobs', '', '| | Job | Duration |', '| :-: | --- | --: |']
  for (const job of jobs) {
    lines.push(
      `| ${icon(job.conclusion)} | [${cell(job.name)}](${job.html_url}) | ${formatDuration(seconds(job.started_at, job.completed_at))} |`
    )
  }
  lines.push('')

  for (const job of jobs) {
    // Runner bookkeeping (job setup/teardown, post-action cleanup) only adds noise.
    const steps = (job.steps ?? []).filter(
      (step) => !/^(Set up job|Complete job|Post )/.test(step.name)
    )
    if (steps.length === 0) continue
    lines.push(`<details><summary>${icon(job.conclusion)} ${cell(job.name)} — steps</summary>`, '')
    lines.push('| | Step | Duration |', '| :-: | --- | --: |')
    for (const step of steps) {
      lines.push(
        `| ${icon(step.conclusion)} | ${cell(step.name)} | ${formatDuration(seconds(step.started_at, step.completed_at))} |`
      )
    }
    lines.push('', '</details>', '')
  }
  return lines
}

function renderTests(reports: SuiteReport[]): string[] {
  if (reports.length === 0) {
    return [
      '## Tests',
      '',
      '> No JUnit report was uploaded — the test jobs did not get far enough.',
      '',
    ]
  }

  const lines = [
    '## Tests',
    '',
    '| Suite | Tests | ✅ Passed | ❌ Failed | ⏭️ Skipped | Test time (sum) |',
    '| --- | --: | --: | --: | --: | --: |',
  ]
  const total = { tests: 0, passed: 0, failed: 0, skipped: 0, seconds: 0 }
  for (const report of reports) {
    const failed = report.cases.filter((c) => c.failed).length
    const skipped = report.cases.filter((c) => c.skipped).length
    const passed = report.cases.length - failed - skipped
    const time = report.cases.reduce((sum, c) => sum + c.seconds, 0)
    total.tests += report.cases.length
    total.passed += passed
    total.failed += failed
    total.skipped += skipped
    total.seconds += time
    lines.push(
      `| ${report.label} | ${report.cases.length} | ${passed} | ${failed} | ${skipped} | ${formatDuration(time)} |`
    )
  }
  lines.push(
    `| **Total** | **${total.tests}** | **${total.passed}** | **${total.failed}** | **${total.skipped}** | **${formatDuration(total.seconds)}** |`,
    ''
  )

  // Mermaid renders natively in job summaries. A slice with value 0 only adds a stray legend entry.
  const slices: Array<[string, number]> = [
    ['Passed', total.passed],
    ['Failed', total.failed],
    ['Skipped', total.skipped],
  ]
  lines.push('```mermaid', `pie showData title ${total.tests} tests`)
  for (const [label, value] of slices) if (value > 0) lines.push(`  "${label}" : ${value}`)
  lines.push('```', '')

  const all = reports.flatMap((report) => report.cases.map((c) => ({ ...c, label: report.label })))
  const failures = all.filter((c) => c.failed)
  if (failures.length > 0) {
    lines.push('### ❌ Failed tests', '', '| Suite | Test | Message |', '| --- | --- | --- |')
    for (const c of failures.slice(0, 30)) {
      lines.push(`| ${c.label} | ${cell(`${c.suite} › ${c.name}`)} | ${cell(c.message || '—')} |`)
    }
    if (failures.length > 30) lines.push('', `…and ${failures.length - 30} more.`)
    lines.push('')
  }

  const slowest = [...all].sort((a, b) => b.seconds - a.seconds).slice(0, 10)
  lines.push(
    '<details><summary>🐢 10 slowest tests</summary>',
    '',
    '| Suite | Test | Time |',
    '| --- | --- | --: |'
  )
  for (const c of slowest) {
    lines.push(`| ${c.label} | ${cell(`${c.suite} › ${c.name}`)} | ${formatDuration(c.seconds)} |`)
  }
  lines.push('', '</details>', '')
  return lines
}

function renderNext(context: CiContext, jobs: ApiJob[]): string[] {
  const allGreen = jobs.every((job) => job.conclusion === 'success' || job.conclusion === 'skipped')
  if (!context.imageWillBuild) {
    return [
      '## Next',
      '',
      'No Docker image for this run (only pushes to `master`, tags and same-repo PRs build one).',
      '',
    ]
  }
  return [
    '## Next',
    '',
    allGreen
      ? '🐳 CI is green, so the **Release · Docker image** workflow builds and pushes the image for this commit now.'
      : '🛑 CI failed, so **no Docker image** is built for this commit.',
    '',
  ]
}

async function main() {
  const repo = env('GITHUB_REPOSITORY')
  const serverUrl = process.env.GITHUB_SERVER_URL ?? 'https://github.com'
  const context = JSON.parse(env('CI_CONTEXT')) as CiContext
  const ownName = process.env.SUMMARY_JOB_NAME ?? ''

  let jobs: ApiJob[] = []
  let jobsError = ''
  try {
    const runJobs = await fetchJobs()
    // The API lists jobs in completion order; by name keeps the shards 1/6 … 6/6 together.
    jobs = runJobs
      .filter((job) => job.name !== ownName)
      .sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }))
  } catch (error) {
    jobsError = error instanceof Error ? error.message : String(error)
  }

  // The e2e shards each upload a partial junit-e2e.xml under the same name: one row per suite.
  const bySuite = new Map<string, TestCase[]>()
  for (const path of findReports(process.env.JUNIT_DIR ?? 'reports')) {
    const label = SUITE_LABELS[basename(path)] ?? basename(path)
    bySuite.set(label, [...(bySuite.get(label) ?? []), ...parseJunit(readFileSync(path, 'utf8'))])
  }
  const reports: SuiteReport[] = [...bySuite.entries()]
    .map(([label, cases]) => ({ label, cases }))
    .sort((a, b) => a.label.localeCompare(b.label))

  const lines = [
    ...renderContext(context, serverUrl, repo),
    ...(jobsError
      ? ['## Jobs', '', `> Could not read the job list: ${jobsError}`, '']
      : renderJobs(jobs)),
    ...renderTests(reports),
    ...renderNext(context, jobs),
  ]
  appendFileSync(env('GITHUB_STEP_SUMMARY'), lines.join('\n') + '\n')
}

await main()
