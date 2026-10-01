import productAiConfig from '#config/product_ai'
import { DomainError } from '#services/domain_error'

export type ProductAiErrorCode = 'product_ai_unavailable' | 'product_ai_failed'

export function isProductAiConfigured(): boolean {
  const c = productAiConfig
  const hasAuth =
    !!c.apiKey || (!!c.tenantId && !!c.clientId && !!c.clientSecret) || !!c.bearerToken
  return !!c.endpoint && !!c.deployment && hasAuth
}

let cachedToken: { value: string; expiresAt: number } | null = null

export function clearProductAiTokenCache() {
  cachedToken = null
}

/** Client-credentials token for the Cognitive Services scope, cached until shortly before expiry. */
async function entraToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value
  const { authorityUrl, tenantId, clientId, clientSecret } = productAiConfig
  const response = await fetch(`${authorityUrl}/${tenantId}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
      scope: 'https://cognitiveservices.azure.com/.default',
    }),
    signal: AbortSignal.timeout(15_000),
  })
  const body = (await response.json().catch(() => null)) as {
    access_token?: string
    expires_in?: number
  } | null
  if (!response.ok || !body?.access_token) throw new Error('token request failed')
  cachedToken = {
    value: body.access_token,
    expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
  }
  return cachedToken.value
}

async function authHeaders(): Promise<Record<string, string>> {
  const c = productAiConfig
  if (c.apiKey) return { 'api-key': c.apiKey }
  if (c.tenantId && c.clientId && c.clientSecret) {
    return { Authorization: `Bearer ${await entraToken()}` }
  }
  return { Authorization: `Bearer ${c.bearerToken}` }
}

/**
 * One chat completion with a strict JSON schema answer. Plain fetch against the Azure
 * OpenAI REST API — works with any Foundry chat deployment.
 */
export async function chatJson<T>(
  messages: { role: 'system' | 'user'; content: string }[],
  schema: { name: string; schema: Record<string, unknown> }
): Promise<T> {
  if (!isProductAiConfigured()) {
    throw new DomainError<ProductAiErrorCode>('product_ai_unavailable')
  }
  const { endpoint, deployment, apiVersion, timeoutMs } = productAiConfig
  const url = `${endpoint.replace(/\/+$/, '')}/openai/deployments/${encodeURIComponent(
    deployment
  )}/chat/completions?api-version=${encodeURIComponent(apiVersion)}`

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
      body: JSON.stringify({
        messages,
        // Reasoning models spend part of the budget thinking before they answer.
        max_completion_tokens: 4000,
        response_format: {
          type: 'json_schema',
          json_schema: { name: schema.name, strict: true, schema: schema.schema },
        },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    })
    const body = (await response.json().catch(() => null)) as {
      choices?: { message?: { content?: string } }[]
    } | null
    const content = body?.choices?.[0]?.message?.content
    if (!response.ok || !content) throw new Error(`status ${response.status}`)
    return JSON.parse(content) as T
  } catch {
    throw new DomainError<ProductAiErrorCode>('product_ai_failed')
  }
}
