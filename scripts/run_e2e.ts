import { spawn } from 'node:child_process'
import { mkdir, open, readFile, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import net from 'node:net'
import pg from 'pg'
import {
  ensureTestDatabaseExists,
  getTestDbConfigFromEnv,
  getTestRuntimeEnv,
  listOtherDatabaseConnections,
  loadTestEnvFile,
} from '#tests/utils/test_db'

const { Client } = pg

const E2E_PORT = process.env.E2E_PORT ?? '3345'
const E2E_BASE_URL = `http://localhost:${E2E_PORT}`
const LOCK_PATH = resolve(process.cwd(), '.tmp', 'playwright-e2e.lock')
const ADVISORY_LOCK_A = 125901
const ADVISORY_LOCK_B = 3345

type TestDbConfig = ReturnType<typeof getTestDbConfigFromEnv>

type LockMetadata = {
  pid: number
  startedAt: string
}

function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false

  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function isPortInUse(port: number): Promise<boolean> {
  return new Promise((resolvePortState, rejectPortState) => {
    const server = net.createServer()

    server.once('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE') {
        resolvePortState(true)
        return
      }
      rejectPortState(error)
    })

    server.once('listening', () => {
      server.close(() => resolvePortState(false))
    })

    server.listen(port, '127.0.0.1')
  })
}

async function acquireRunLock() {
  await mkdir(resolve(process.cwd(), '.tmp'), { recursive: true })

  try {
    const handle = await open(LOCK_PATH, 'wx')
    const metadata: LockMetadata = {
      pid: process.pid,
      startedAt: new Date().toISOString(),
    }
    await handle.writeFile(JSON.stringify(metadata, null, 2))
    await handle.close()
    return
  } catch (error: any) {
    if (error?.code !== 'EEXIST') throw error
  }

  let existingPid: number | null = null

  try {
    const content = await readFile(LOCK_PATH, 'utf8')
    const parsed = JSON.parse(content) as Partial<LockMetadata>
    existingPid = typeof parsed.pid === 'number' ? parsed.pid : null
  } catch {
    // Broken lock files are treated as stale and removed below.
  }

  if (existingPid && isProcessAlive(existingPid)) {
    throw new Error(
      `Refusing to start E2E run: lock file exists and process ${existingPid} is still alive (${LOCK_PATH}).`
    )
  }

  await rm(LOCK_PATH, { force: true })

  const handle = await open(LOCK_PATH, 'wx')
  const metadata: LockMetadata = {
    pid: process.pid,
    startedAt: new Date().toISOString(),
  }
  await handle.writeFile(JSON.stringify(metadata, null, 2))
  await handle.close()
}

async function releaseRunLock() {
  await rm(LOCK_PATH, { force: true })
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms))
}

async function terminateIdleConnections(config: TestDbConfig, pids: number[]): Promise<number> {
  if (pids.length === 0) return 0

  const adminClient = new Client({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: 'postgres',
  })

  await adminClient.connect()

  try {
    const result = await adminClient.query<{ terminated: boolean }>(
      `SELECT pg_terminate_backend(pid) AS terminated
       FROM pg_stat_activity
       WHERE datname = $1
         AND pid = ANY($2::int[])
         AND backend_type = 'client backend'
         AND pid <> pg_backend_pid()`,
      [config.database, pids]
    )

    return result.rows.filter((row) => row.terminated).length
  } finally {
    await adminClient.end()
  }
}

async function run() {
  loadTestEnvFile()

  process.env.NODE_ENV = 'test'
  process.env.PORT = E2E_PORT
  process.env.APP_URL = E2E_BASE_URL

  await acquireRunLock()

  let lockClient: pg.Client | null = null
  let child: ReturnType<typeof spawn> | null = null

  const teardown = async () => {
    if (child && !child.killed) {
      child.kill('SIGTERM')
    }
    if (lockClient) {
      try {
        await lockClient.query('SELECT pg_advisory_unlock($1, $2)', [
          ADVISORY_LOCK_A,
          ADVISORY_LOCK_B,
        ])
      } catch {
        // Ignore unlock errors during teardown.
      }
      await lockClient.end()
      lockClient = null
    }

    await releaseRunLock()
  }

  const onSignal = async (signal: NodeJS.Signals) => {
    await teardown()
    process.exit(signal === 'SIGINT' ? 130 : 143)
  }

  process.once('SIGINT', () => {
    void onSignal('SIGINT')
  })
  process.once('SIGTERM', () => {
    void onSignal('SIGTERM')
  })

  try {
    console.log('Building app for Playwright E2E...')
    const buildExitCode = await new Promise<number>((resolveBuildExit, rejectBuildExit) => {
      const buildProcess = spawn('npm', ['run', 'build'], {
        stdio: 'inherit',
        shell: process.platform === 'win32',
        env: getTestRuntimeEnv(),
      })
      buildProcess.once('error', rejectBuildExit)
      buildProcess.once('exit', (code, signal) => {
        if (signal) {
          rejectBuildExit(new Error(`Build process terminated by signal ${signal}`))
          return
        }
        resolveBuildExit(code ?? 1)
      })
    })
    if (buildExitCode !== 0) {
      throw new Error(`Refusing to start E2E run: build failed with exit code ${buildExitCode}.`)
    }

    const portInUse = await isPortInUse(Number(E2E_PORT))
    if (portInUse) {
      throw new Error(
        `Refusing to start E2E run: port ${E2E_PORT} is already in use. Stop the stale process and retry.`
      )
    }

    await ensureTestDatabaseExists()

    const dbConfig = getTestDbConfigFromEnv()
    lockClient = new Client(dbConfig)
    await lockClient.connect()

    const lockResult = await lockClient.query<{ locked: boolean }>(
      'SELECT pg_try_advisory_lock($1, $2) AS locked',
      [ADVISORY_LOCK_A, ADVISORY_LOCK_B]
    )
    if (!lockResult.rows[0]?.locked) {
      throw new Error(
        'Refusing to start E2E run: database lock is already held by another process.'
      )
    }

    const lockPidResult = await lockClient.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')
    const lockPid = lockPidResult.rows[0]?.pid
    if (!lockPid) {
      throw new Error('Could not determine database lock connection PID.')
    }

    let activeConnections = await listOtherDatabaseConnections(dbConfig.database)
    let externalConnections = activeConnections.filter((conn) => conn.pid !== lockPid)

    if (externalConnections.length > 0) {
      const idleExternalPids = externalConnections
        .filter((conn) => conn.state === 'idle')
        .map((conn) => conn.pid)
      const terminatedCount = await terminateIdleConnections(dbConfig, idleExternalPids)
      if (terminatedCount > 0) {
        await delay(300)
      }

      activeConnections = await listOtherDatabaseConnections(dbConfig.database)
      externalConnections = activeConnections.filter((conn) => conn.pid !== lockPid)
    }

    if (externalConnections.length > 0) {
      const connectionSummary = externalConnections
        .map(
          (conn) =>
            `pid=${conn.pid} app=${conn.applicationName ?? 'unknown'} state=${conn.state ?? 'unknown'}`
        )
        .join(', ')
      throw new Error(
        `Refusing to start E2E run: database "${dbConfig.database}" has active external connections: ${connectionSummary}`
      )
    }

    child = spawn('npx', ['playwright', 'test', ...process.argv.slice(2)], {
      stdio: 'inherit',
      shell: process.platform === 'win32',
      env: getTestRuntimeEnv({
        PORT: E2E_PORT,
        APP_URL: E2E_BASE_URL,
      }),
    })

    const exitCode = await new Promise<number>((resolveChildExit, rejectChildExit) => {
      child!.once('error', rejectChildExit)
      child!.once('exit', (code, signal) => {
        if (signal) {
          rejectChildExit(new Error(`Playwright process terminated by signal ${signal}`))
          return
        }
        resolveChildExit(code ?? 1)
      })
    })

    process.exitCode = exitCode
  } finally {
    await teardown()
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
