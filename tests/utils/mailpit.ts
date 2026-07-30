/**
 * Mailpit API client for real SMTP delivery assertions in tests.
 *
 * Set MAILPIT_API_URL (e.g. http://localhost:8025) to enable.
 * Tests that call isMailpitAvailable() guard and return early when it is unset,
 * so they pass trivially in environments without a running Mailpit instance.
 */

const BASE_URL = (process.env.MAILPIT_API_URL ?? 'http://localhost:8025').replace(/\/$/, '')

export function isMailpitAvailable(): boolean {
  return !!process.env.MAILPIT_API_URL
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MailpitAddress {
  Address: string
  Name: string
}

export interface MailpitMessageSummary {
  ID: string
  Subject: string
  From: MailpitAddress
  To: MailpitAddress[]
  Date: string
}

export interface MailpitMessage extends MailpitMessageSummary {
  HTML: string
  Text: string
  Attachments: unknown[]
}

export interface MailpitHtmlCheckTotal {
  Nodes: number
  Partial: number
  Supported: number
  Tests: number
  Unsupported: number
}

export interface MailpitHtmlCheckWarning {
  Title: string
  Category: string
  Description: string
  Slug: string
  Score: {
    Found: number
    Partial: number
    Supported: number
    Unsupported: number
  }
}

export interface MailpitHtmlCheckResult {
  Total: MailpitHtmlCheckTotal
  Warnings: MailpitHtmlCheckWarning[]
  Platforms: Record<string, string[]>
}

// ─── API helpers ──────────────────────────────────────────────────────────────

/** Delete all messages from the Mailpit inbox. */
export async function clearAll(): Promise<void> {
  await fetch(`${BASE_URL}/api/v1/messages`, { method: 'DELETE' })
}

/**
 * Poll until a message addressed to `email` appears in Mailpit, then return it.
 * Returns null if nothing arrives within `timeout` ms.
 */
export async function waitForMessageTo(
  email: string,
  opts: { timeout?: number; pollInterval?: number } = {}
): Promise<MailpitMessageSummary | null> {
  const timeout = opts.timeout ?? 5000
  const interval = opts.pollInterval ?? 150
  const deadline = Date.now() + timeout

  while (Date.now() < deadline) {
    const res = await fetch(
      `${BASE_URL}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}&limit=1`
    )
    const data = (await res.json()) as {
      messages: MailpitMessageSummary[] | null
      total: number
    }
    if (data.total > 0 && data.messages?.[0]) {
      return data.messages[0]
    }
    await new Promise<void>((resolve) => setTimeout(resolve, interval))
  }

  return null
}

/** Fetch the full message (including rendered HTML and plain-text body). */
export async function getMessage(id: string): Promise<MailpitMessage> {
  const res = await fetch(`${BASE_URL}/api/v1/message/${id}`)
  return res.json() as Promise<MailpitMessage>
}

/**
 * Fetch the Mailpit HTML compatibility check for a message.
 *
 * `Total.Unsupported` is a fraction 0–1 of checked features unsupported across
 * all tested email clients. `Warnings` lists each unsupported feature in detail.
 */
export async function getHtmlCheck(id: string): Promise<MailpitHtmlCheckResult> {
  const res = await fetch(`${BASE_URL}/api/v1/message/${id}/html-check`)
  return res.json() as Promise<MailpitHtmlCheckResult>
}
