/**
 * Verify that every HTTP call the frontend makes matches a registered route — same verb,
 * same path.
 *
 * This exists because a product-edit form once posted `_method: 'PUT'` in the request body,
 * a Laravel idiom that AdonisJS does not honour (the bodyparser is router middleware, so it
 * runs after routing). Routes are indexed by method, and a verb miss answers 404 rather than
 * 405 Method Not Allowed — so it looked like a wrong URL and shipped to production.
 *
 * The route table comes from `node ace list:routes --json`, not from parsing routes.ts, so
 * group prefixes and named middleware cannot skew it.
 *
 * Usage: npm run check:routes
 */

import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))

type Route = { methods: string[]; pattern: string; matcher: RegExp }
type Call = { file: string; line: number; method: string; url: string; source: string }

function loadRoutes(): Route[] {
  const raw = execFileSync('node', ['ace', 'list:routes', '--json'], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, NODE_ENV: process.env.NODE_ENV ?? 'test' },
    maxBuffer: 32 * 1024 * 1024,
  })

  const domains = JSON.parse(raw) as Array<{
    routes: Array<{ methods: string[]; pattern: string }>
  }>

  return domains
    .flatMap((domain) => domain.routes)
    .map((route) => ({
      methods: route.methods,
      pattern: route.pattern,
      matcher: patternToRegex(route.pattern),
    }))
}

function patternToRegex(pattern: string): RegExp {
  const source = pattern
    .split('/')
    .map((segment) => {
      if (segment.startsWith('*')) return '.*'
      if (segment.startsWith(':')) return '[^/]+'
      return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    })
    .join('/')

  return new RegExp(`^${stripTrailingSlash(source)}$`)
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '') || '/'
}

/** `${...}` becomes a param placeholder; the query string is irrelevant to routing. */
function normalizeUrl(url: string): string {
  return stripTrailingSlash(url.replace(/\$\{[^}]*\}/g, ':param').replace(/\?.*$/, ''))
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) walk(path, out)
    else if (/\.(vue|ts|js)$/.test(entry)) out.push(path)
  }
  return out
}

const CALL_PATTERN = /\.(get|post|put|patch|delete)\(\s*[`'"](\/[^`'"]*)[`'"]/g
const GOTO_PATTERN = /\.goto\(\s*[`'"](\/[^`'"]*)[`'"]/g
const FORM_COMPONENT_PATTERN =
  /<Form\b[^>]*?\bmethod=["']([a-z]+)["'][^>]*?\baction=["'](\/[^"']*)["']/gs

function collectCalls(files: string[]): Call[] {
  const calls: Call[] = []

  for (const file of files) {
    const source = readFileSync(file, 'utf8')
    const lines = source.split('\n')
    const lineOf = (index: number) => source.slice(0, index).split('\n').length

    const push = (index: number, method: string, url: string, label?: string) => {
      const line = lineOf(index)
      calls.push({
        file,
        line,
        method: method.toUpperCase(),
        url,
        source: label ?? lines[line - 1]?.trim() ?? '',
      })
    }

    for (const match of source.matchAll(CALL_PATTERN)) push(match.index!, match[1], match[2])
    for (const match of source.matchAll(GOTO_PATTERN)) push(match.index!, 'GET', match[1], 'goto()')
    for (const match of source.matchAll(FORM_COMPONENT_PATTERN)) {
      push(match.index!, match[1], match[2], '<Form>')
    }
  }

  return calls
}

const routes = loadRoutes()
const files = [...walk(join(repoRoot, 'inertia')), ...walk(join(repoRoot, 'tests/e2e'))]
const calls = collectCalls(files)

const problems: string[] = []

for (const call of calls) {
  const url = normalizeUrl(call.url)
  const pathMatches = routes.filter((route) => route.matcher.test(url))

  if (pathMatches.length === 0) {
    problems.push(
      `${relative(repoRoot, call.file)}:${call.line}  ${call.method} ${url}\n` +
        `    no route matches this path        ${call.source}`
    )
    continue
  }

  if (!pathMatches.some((route) => route.methods.includes(call.method))) {
    const allowed = [...new Set(pathMatches.flatMap((route) => route.methods))].join(', ')
    problems.push(
      `${relative(repoRoot, call.file)}:${call.line}  ${call.method} ${url}\n` +
        `    route ${pathMatches[0].pattern} only accepts ${allowed}   ${call.source}`
    )
  }
}

console.log(`Route table: ${routes.length} routes`)
console.log(`Frontend + e2e calls checked: ${calls.length}`)

if (problems.length > 0) {
  console.error(`\n${problems.length} call(s) cannot reach a route:\n`)
  for (const problem of problems) console.error(`  ${problem}\n`)
  console.error('A verb mismatch answers 404, not 405 — fix the call or the route.')
  process.exit(1)
}

console.log('All calls match a registered route.')
