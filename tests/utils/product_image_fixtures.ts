import http from 'node:http'
import type { AddressInfo } from 'node:net'
import sharp from 'sharp'

/**
 * A "product" (solid block) on a backdrop — the shape of a typical e-shop picture.
 * `product` is the block's size; the canvas adds `margin` on every side.
 */
export async function productOnBackdrop(options: {
  product: { width: number; height: number }
  margin?: number
  backdrop?: { r: number; g: number; b: number; alpha?: number }
  color?: { r: number; g: number; b: number }
  format?: 'png' | 'jpeg'
}): Promise<Buffer> {
  const margin = options.margin ?? 20
  const block = await sharp({
    create: {
      width: options.product.width,
      height: options.product.height,
      channels: 4,
      background: { ...(options.color ?? { r: 200, g: 30, b: 40 }), alpha: 1 },
    },
  })
    .png()
    .toBuffer()
  const canvas = sharp({
    create: {
      width: options.product.width + margin * 2,
      height: options.product.height + margin * 2,
      channels: 4,
      background: { alpha: 1, ...(options.backdrop ?? { r: 255, g: 255, b: 255 }) },
    },
  }).composite([{ input: block, left: margin, top: margin }])
  return options.format === 'jpeg'
    ? canvas.jpeg({ quality: 95 }).toBuffer()
    : canvas.png().toBuffer()
}

/** Random noise — a "photo" whose border no flood fill can call uniform. */
export async function noisyImage(width = 60, height = 80): Promise<Buffer> {
  const data = Buffer.alloc(width * height * 3)
  for (let i = 0; i < data.length; i++) data[i] = (i * 7919 + (i >> 3) * 104729) % 256
  return sharp(data, { raw: { width, height, channels: 3 } })
    .png()
    .toBuffer()
}

/** Alpha of the pixel at (x, y). */
export async function alphaAt(image: Buffer, x: number, y: number): Promise<number> {
  const { data, info } = await sharp(image)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  return data[(y * info.width + x) * 4 + 3]
}

export interface StubServer {
  url: string
  requests: { method: string; url: string; headers: http.IncomingHttpHeaders; body: Buffer }[]
  close: () => Promise<void>
}

/** A local HTTP server standing in for rembg, the Cloudflare Worker or Open Food Facts. */
export async function startStubServer(
  handler: (req: http.IncomingMessage, body: Buffer, res: http.ServerResponse) => void
): Promise<StubServer> {
  const requests: StubServer['requests'] = []
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      const body = Buffer.concat(chunks)
      requests.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers, body })
      handler(req, body, res)
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  }
}
