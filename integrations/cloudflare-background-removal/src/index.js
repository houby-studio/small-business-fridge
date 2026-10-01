/**
 * Background removal for Small Business Fridge on Cloudflare Images.
 *
 * Takes the raw image bytes in a POST body and returns a PNG with the background made
 * transparent, using `segment: 'foreground'` (BiRefNet on Workers AI).
 *
 * Guarded by a shared bearer token (`SBF_TOKEN` secret) so the endpoint is not an open
 * image service on your account. Point PRODUCT_IMAGE_CLOUDFLARE_URL/TOKEN at it.
 */

const MAX_BYTES = 15 * 1024 * 1024

function timingSafeEqual(a, b) {
  const enc = new TextEncoder()
  const x = enc.encode(a)
  const y = enc.encode(b)
  if (x.length !== y.length) return false
  return crypto.subtle.timingSafeEqual(x, y)
}

export default {
  async fetch(request, env) {
    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'POST' } })
    }
    if (!env.SBF_TOKEN) {
      return new Response('SBF_TOKEN secret is not set', { status: 500 })
    }
    const auth = request.headers.get('Authorization') ?? ''
    if (!timingSafeEqual(auth, `Bearer ${env.SBF_TOKEN}`)) {
      return new Response('Unauthorized', { status: 401 })
    }
    const length = Number(request.headers.get('Content-Length') ?? 0)
    if (length > MAX_BYTES) {
      return new Response('Payload Too Large', { status: 413 })
    }
    if (!request.body) {
      return new Response('Empty body', { status: 400 })
    }

    try {
      const result = await env.IMAGES.input(request.body)
        .transform({ segment: 'foreground' })
        .output({ format: 'image/png' })
      const response = result.response()
      return new Response(response.body, {
        headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' },
      })
    } catch (error) {
      return new Response(`Background removal failed: ${error?.message ?? error}`, {
        status: 502,
      })
    }
  },
}
