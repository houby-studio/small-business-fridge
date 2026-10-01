/**
 * Cheap background removal for the common case: a product shot on a plain (usually white)
 * backdrop, as e-shops publish them. No ML — a flood fill from the border.
 *
 * Works on raw RGBA pixels so it stays a pure function and is trivially testable.
 */

export interface RawImage {
  data: Buffer
  width: number
  height: number
}

export interface FloodFillOptions {
  /** Max per-channel distance from the backdrop colour that still counts as backdrop. */
  tolerance?: number
  /** Share of border pixels that must match the backdrop for the image to qualify. */
  minUniformBorder?: number
  /** Below this share of opaque pixels left, the "product" was backdrop too — bail out. */
  minForeground?: number
}

const DEFAULTS: Required<FloodFillOptions> = {
  tolerance: 24,
  minUniformBorder: 0.9,
  minForeground: 0.02,
}

function borderIndices(width: number, height: number): number[] {
  const out: number[] = []
  for (let x = 0; x < width; x++) {
    out.push(x, (height - 1) * width + x)
  }
  for (let y = 1; y < height - 1; y++) {
    out.push(y * width, y * width + width - 1)
  }
  return out
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

/**
 * True when most of the border is already transparent — the image was cut out before.
 */
export function hasTransparentBorder(image: RawImage, threshold = 0.5): boolean {
  const border = borderIndices(image.width, image.height)
  const transparent = border.filter((i) => image.data[i * 4 + 3] < 128).length
  return transparent / border.length >= threshold
}

/**
 * Makes a uniform backdrop transparent. Returns `null` when the image does not qualify
 * (busy border, already transparent, or nothing would be left) — the caller then falls
 * back to a model-based provider or keeps the image as is.
 */
export function removeUniformBackground(
  image: RawImage,
  options: FloodFillOptions = {}
): RawImage | null {
  const { tolerance, minUniformBorder, minForeground } = { ...DEFAULTS, ...options }
  const { data, width, height } = image
  if (width < 3 || height < 3) return null
  if (hasTransparentBorder(image)) return null

  const border = borderIndices(width, height)
  const bg = [0, 1, 2].map((c) => median(border.map((i) => data[i * 4 + c])))

  const matches = (pixel: number) => {
    const o = pixel * 4
    return (
      data[o + 3] > 0 &&
      Math.abs(data[o] - bg[0]) <= tolerance &&
      Math.abs(data[o + 1] - bg[1]) <= tolerance &&
      Math.abs(data[o + 2] - bg[2]) <= tolerance
    )
  }

  const uniform = border.filter(matches).length / border.length
  if (uniform < minUniformBorder) return null

  const out = Buffer.from(data)
  const visited = new Uint8Array(width * height)
  const stack: number[] = []
  for (const i of border) {
    if (!visited[i] && matches(i)) {
      visited[i] = 1
      stack.push(i)
    }
  }

  let cleared = 0
  while (stack.length > 0) {
    const p = stack.pop()!
    out[p * 4 + 3] = 0
    cleared++
    const x = p % width
    const y = (p - x) / width
    const neighbours = [
      x > 0 ? p - 1 : -1,
      x < width - 1 ? p + 1 : -1,
      y > 0 ? p - width : -1,
      y < height - 1 ? p + width : -1,
    ]
    for (const n of neighbours) {
      if (n >= 0 && !visited[n] && matches(n)) {
        visited[n] = 1
        stack.push(n)
      }
    }
  }

  const foreground = 1 - cleared / (width * height)
  if (foreground < minForeground) return null

  // Soften the cut: a pixel at the product edge that is close to the backdrop colour (an
  // anti-aliased fringe) becomes half transparent instead of leaving a white halo.
  for (let p = 0; p < width * height; p++) {
    if (out[p * 4 + 3] === 0) continue
    const x = p % width
    const y = (p - x) / width
    // `visited` marks exactly the flood-cleared pixels.
    const touchesCleared =
      (x > 0 && visited[p - 1]) ||
      (x < width - 1 && visited[p + 1]) ||
      (y > 0 && visited[p - width]) ||
      (y < height - 1 && visited[p + width])
    if (!touchesCleared) continue
    const o = p * 4
    const distance = Math.max(
      Math.abs(out[o] - bg[0]),
      Math.abs(out[o + 1] - bg[1]),
      Math.abs(out[o + 2] - bg[2])
    )
    if (distance <= tolerance * 3) {
      out[o + 3] = Math.min(out[o + 3], Math.round((255 * distance) / (tolerance * 3)))
    }
  }

  return { data: out, width, height }
}
