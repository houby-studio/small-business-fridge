import productImagesConfig from '#config/product_images'

export interface ImageCandidate {
  /** Full-resolution image, fed to the processing endpoint. */
  url: string
  /** Small variant for the picker grid. */
  thumbUrl: string
  source: 'openfoodfacts'
}

export interface CandidateLookup {
  productName: string | null
  candidates: ImageCandidate[]
}

const MAX_CANDIDATES = 12

interface OffSelectedImages {
  [kind: string]: { display?: Record<string, string>; small?: Record<string, string> }
}

interface OffProduct {
  code?: string
  product_name?: string
  product_name_cs?: string
  brands?: string
  quantity?: string
  selected_images?: OffSelectedImages
  images?: Record<string, unknown>
}

/** OFF splits long barcodes into a folder path: 8594001025411 → 859/400/102/5411. */
export function offImageFolder(code: string): string {
  if (code.length <= 8) return code
  return code.replace(/^(\d{3})(\d{3})(\d{3})(\d+)$/, '$1/$2/$3/$4')
}

export function parseOffProduct(product: OffProduct, imagesBaseUrl: string): CandidateLookup {
  const seen = new Set<string>()
  const candidates: ImageCandidate[] = []
  const add = (url: string, thumbUrl: string) => {
    if (seen.has(url) || candidates.length >= MAX_CANDIDATES) return
    seen.add(url)
    candidates.push({ url, thumbUrl, source: 'openfoodfacts' })
  }

  // Curated pictures first: the front of the pack in every language it was uploaded in.
  for (const kind of ['front', 'packaging', 'ingredients']) {
    const variants = product.selected_images?.[kind]
    for (const display of Object.values(variants?.display ?? {})) {
      // `….400.jpg` is a 400px rendition; the `full` one is the original upload.
      add(display.replace(/\.\d+\.jpg$/, '.full.jpg'), display)
    }
  }

  // Then every raw upload (numeric keys) — often a better photo than the selected one.
  if (product.code) {
    const folder = `${imagesBaseUrl}/images/products/${offImageFolder(product.code)}`
    const rawIds = Object.keys(product.images ?? {})
      .filter((k) => /^\d+$/.test(k))
      .sort((a, b) => Number(b) - Number(a))
    for (const id of rawIds) {
      add(`${folder}/${id}.jpg`, `${folder}/${id}.400.jpg`)
    }
  }

  return { productName: offProductName(product), candidates }
}

/**
 * A name in the catalogue's style — "Snickers 50 g". `brands` is free text on OFF and
 * often holds the manufacturer's legal name ("MARS POLSKA SPÓŁKA Z OGRANICZONĄ…"), so a
 * brand is only prefixed when it is short and not already part of the name.
 */
export function offProductName(product: OffProduct): string | null {
  const base = (product.product_name_cs || product.product_name || '').trim()
  const brand = product.brands?.split(',')[0]?.trim() ?? ''
  const shortBrand = brand.length > 0 && brand.length <= 20 && brand.split(/\s+/).length <= 2
  let name = base
  if (shortBrand && !base.toLowerCase().includes(brand.toLowerCase())) {
    name = base ? `${brand} ${base}` : brand
  }
  const quantity = product.quantity?.trim()
  if (name && quantity && !name.toLowerCase().includes(quantity.toLowerCase())) {
    name = `${name} ${quantity}`
  }
  if (!name) return null
  // Crowd-sourced names are sometimes all lower case ("snickers 75g").
  return name.charAt(0).toLocaleUpperCase('cs') + name.slice(1)
}

/**
 * Candidate pictures for a barcode from Open Food Facts. Quality varies a lot (phone
 * photos), so they are offered next to manual sources, never applied automatically.
 */
export async function lookupOpenFoodFacts(barcode: string): Promise<CandidateLookup> {
  const empty: CandidateLookup = { productName: null, candidates: [] }
  const { enabled, baseUrl, timeoutMs } = productImagesConfig.openFoodFacts
  if (!enabled || !/^\d{8,14}$/.test(barcode)) return empty

  let response: Response
  try {
    response = await fetch(
      `${baseUrl}/api/v2/product/${barcode}.json?fields=code,product_name,product_name_cs,brands,quantity,selected_images,images`,
      {
        // OFF asks API clients to identify themselves.
        headers: {
          'User-Agent':
            'SmallBusinessFridge/3 (+https://github.com/houby-studio/small-business-fridge)',
        },
        signal: AbortSignal.timeout(timeoutMs),
      }
    )
  } catch {
    return empty
  }
  if (!response.ok) return empty

  const body = (await response.json().catch(() => null)) as {
    status?: number
    product?: OffProduct
  } | null
  if (!body || body.status !== 1 || !body.product) return empty

  const imagesBaseUrl = baseUrl.includes('openfoodfacts.org')
    ? 'https://images.openfoodfacts.org'
    : baseUrl
  return parseOffProduct({ code: barcode, ...body.product }, imagesBaseUrl)
}
