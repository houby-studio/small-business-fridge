import productImagesConfig from '#config/product_images'
import { DomainError } from '#services/domain_error'

export type BackgroundProviderErrorCode = 'image_background_provider_failed'

async function expectImage(response: Response): Promise<Buffer> {
  const type = response.headers.get('content-type') ?? ''
  if (!response.ok || !type.startsWith('image/')) {
    throw new DomainError<BackgroundProviderErrorCode>('image_background_provider_failed')
  }
  return Buffer.from(await response.arrayBuffer())
}

async function call(request: () => Promise<Response>): Promise<Buffer> {
  let response: Response
  try {
    response = await request()
  } catch {
    // Timeout, refused connection, DNS — the provider is unavailable either way.
    throw new DomainError<BackgroundProviderErrorCode>('image_background_provider_failed')
  }
  return expectImage(response)
}

export function isRembgConfigured(): boolean {
  return productImagesConfig.rembg.url.length > 0
}

export function isCloudflareConfigured(): boolean {
  return productImagesConfig.cloudflare.url.length > 0
}

/**
 * Optional rembg sidecar (`rembg s`, compose profile `bg-removal`). Runs BiRefNet or any
 * other rembg model locally; slow on CPU but nothing leaves the server.
 */
export async function removeWithRembg(input: Buffer): Promise<Buffer> {
  const { url, model, timeoutMs } = productImagesConfig.rembg
  const form = new FormData()
  form.append('file', new Blob([new Uint8Array(input)]), 'image')
  form.append('model', model)
  return call(() =>
    fetch(new URL('/api/remove', url), {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(timeoutMs),
    })
  )
}

/**
 * Cloudflare Images `segment=foreground` (BiRefNet on Workers AI) behind a tiny Worker
 * guarded by a shared bearer token — see integrations/cloudflare-background-removal.
 */
export async function removeWithCloudflare(input: Buffer): Promise<Buffer> {
  const { url, token, timeoutMs } = productImagesConfig.cloudflare
  return call(() =>
    fetch(url, {
      method: 'POST',
      body: new Uint8Array(input),
      headers: {
        'Content-Type': 'application/octet-stream',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      signal: AbortSignal.timeout(timeoutMs),
    })
  )
}
