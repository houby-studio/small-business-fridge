import env from '#start/env'

export type BackgroundRemovalMethod = 'none' | 'flood' | 'rembg' | 'cloudflare'
export type RotateDirection = 'cw' | 'ccw'

/**
 * Model-based providers come first: the flood fill cannot tell a white pack from a white
 * backdrop and eats into it, so it is only the fallback when no model is configured.
 */
const DEFAULT_AUTO_CHAIN: BackgroundRemovalMethod[] = ['cloudflare', 'rembg', 'flood']

function parseAutoChain(value: string | undefined): BackgroundRemovalMethod[] {
  if (!value) return DEFAULT_AUTO_CHAIN
  return value
    .split(',')
    .map((s) => s.trim())
    .filter((s): s is BackgroundRemovalMethod => (DEFAULT_AUTO_CHAIN as string[]).includes(s))
}

/**
 * Product image pipeline — see docs/product-images.md.
 *
 * Read at call time by the services (not destructured at import), so tests can point a
 * provider at a stub server by mutating this object.
 */
const productImagesConfig = {
  /** Output canvas. 450×800 (9:16) is what the existing catalogue converged on. */
  width: env.get('PRODUCT_IMAGE_WIDTH', 450),
  height: env.get('PRODUCT_IMAGE_HEIGHT', 800),
  /** Content wider than tall by at least this ratio is turned upright (bars, wafers). */
  rotateMinRatio: env.get('PRODUCT_IMAGE_ROTATE_MIN_RATIO', 1.8),
  /** ccw = text reads bottom-to-top, the convention the existing bar images follow. */
  rotateDirection: (env.get('PRODUCT_IMAGE_ROTATE_DIRECTION') === 'cw'
    ? 'cw'
    : 'ccw') as RotateDirection,
  /** Methods "auto" tries in order; unconfigured remote providers are skipped. */
  autoChain: parseAutoChain(env.get('PRODUCT_IMAGE_BG_AUTO')),
  /** Largest remote image we download, in bytes. */
  maxDownloadBytes: 15 * 1024 * 1024,

  rembg: {
    /** Base URL of the optional rembg sidecar, e.g. http://rembg:7000. Empty = disabled. */
    url: env.get('PRODUCT_IMAGE_REMBG_URL', ''),
    model: env.get('PRODUCT_IMAGE_REMBG_MODEL', 'birefnet-general'),
    timeoutMs: env.get('PRODUCT_IMAGE_REMBG_TIMEOUT_MS', 300_000),
  },

  cloudflare: {
    /** URL of the background-removal Worker (integrations/cloudflare-background-removal). */
    url: env.get('PRODUCT_IMAGE_CLOUDFLARE_URL', ''),
    token: env.get('PRODUCT_IMAGE_CLOUDFLARE_TOKEN', ''),
    timeoutMs: env.get('PRODUCT_IMAGE_CLOUDFLARE_TIMEOUT_MS', 60_000),
  },

  openFoodFacts: {
    enabled: env.get('PRODUCT_IMAGE_OPENFOODFACTS_ENABLED', true),
    baseUrl: env.get('PRODUCT_IMAGE_OPENFOODFACTS_URL', 'https://world.openfoodfacts.org'),
    timeoutMs: 10_000,
  },
}

export default productImagesConfig
