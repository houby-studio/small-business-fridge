import sharp from 'sharp'
import type { RawImage } from '#services/product_images/flood_fill'
import type { RotateDirection } from '#config/product_images'

export type RotateMode = 'auto' | 'none' | RotateDirection

export interface NormalizeOptions {
  width: number
  height: number
  rotate: RotateMode
  rotateMinRatio: number
  autoDirection: RotateDirection
}

export interface NormalizedImage {
  buffer: Buffer
  rotated: RotateDirection | null
}

/** Alpha above this counts as content when trimming — ignores faint model noise. */
const ALPHA_CONTENT_THRESHOLD = 16

/**
 * Working resolution. The output is 450×800, so a 50 MP phone photo is shrunk right after
 * decoding — otherwise the raw buffer alone would be ~200 MB on a small server.
 */
const WORKING_MAX_SIDE = 2048

/**
 * Decodes any supported input into raw RGBA, honouring EXIF orientation (phone photos).
 */
export async function decodeToRaw(input: Buffer): Promise<RawImage> {
  const { data, info } = await sharp(input, { limitInputPixels: 100_000_000 })
    .rotate()
    .resize(WORKING_MAX_SIDE, WORKING_MAX_SIDE, { fit: 'inside', withoutEnlargement: true })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  return { data, width: info.width, height: info.height }
}

/**
 * Bounding box of the visible content; the whole image when nothing is transparent.
 */
export function contentBox(image: RawImage) {
  const { data, width, height } = image
  let left = width
  let top = height
  let right = -1
  let bottom = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > ALPHA_CONTENT_THRESHOLD) {
        if (x < left) left = x
        if (x > right) right = x
        if (y < top) top = y
        if (y > bottom) bottom = y
      }
    }
  }
  if (right < 0) return { left: 0, top: 0, width, height }
  return { left, top, width: right - left + 1, height: bottom - top + 1 }
}

/**
 * The visible content only. An image that went through the pipeline with its background
 * kept sits on a transparent canvas — the backdrop to remove starts at the content's
 * edge, not at the canvas edge.
 */
export function cropToContent(image: RawImage): RawImage {
  const box = contentBox(image)
  if (box.width === image.width && box.height === image.height) return image
  const rowBytes = box.width * 4
  const data = Buffer.alloc(rowBytes * box.height)
  for (let y = 0; y < box.height; y++) {
    const start = ((box.top + y) * image.width + box.left) * 4
    image.data.copy(data, y * rowBytes, start, start + rowBytes)
  }
  return { data, width: box.width, height: box.height }
}

export function decideRotation(
  contentWidth: number,
  contentHeight: number,
  options: Pick<NormalizeOptions, 'rotate' | 'rotateMinRatio' | 'autoDirection'>
): RotateDirection | null {
  if (options.rotate === 'none') return null
  if (options.rotate === 'cw' || options.rotate === 'ccw') return options.rotate
  return contentWidth / contentHeight >= options.rotateMinRatio ? options.autoDirection : null
}

/**
 * Trims empty space, turns wide products upright and fits the result onto a fixed
 * transparent canvas, so every product card in the shop and the kiosk looks alike.
 */
export async function normalizeProductImage(
  image: RawImage,
  options: NormalizeOptions
): Promise<NormalizedImage> {
  const box = contentBox(image)
  const rotated = decideRotation(box.width, box.height, options)

  let pipeline = sharp(image.data, {
    raw: { width: image.width, height: image.height, channels: 4 },
  }).extract(box)

  if (rotated) {
    // Materialise the crop first: sharp applies rotate before extract within one pipeline.
    const cropped = await pipeline.png().toBuffer()
    pipeline = sharp(cropped).rotate(rotated === 'cw' ? 90 : 270)
  }

  const buffer = await pipeline
    .resize(options.width, options.height, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
      kernel: 'lanczos3',
    })
    .webp({ quality: 88, alphaQuality: 100, effort: 5 })
    .toBuffer()

  return { buffer, rotated }
}
