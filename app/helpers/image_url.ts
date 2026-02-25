/**
 * Normalize a product image path from the legacy `./images/foo.png` format
 * (used by the old MongoDB app) to the current `/uploads/products/foo.png` format.
 *
 * The old app stored images with a `./images/` prefix. When the browser resolves
 * this relative to e.g. `/supplier/products`, it becomes `/supplier/images/foo.png`
 * which 404s. Normalizing to an absolute path fixes this across all pages.
 */
export function normalizeImagePath(imagePath: string | null | undefined): string | null {
  if (!imagePath) return null

  // Legacy MongoDB format: ./images/filename.ext
  if (imagePath.startsWith('./images/')) {
    const filename = imagePath.slice('./images/'.length)
    return `/uploads/products/${filename}`
  }

  // Old default placeholder that doesn't exist in new stack
  if (imagePath === '/images/default-product.png' || imagePath === 'preview.png') {
    return null
  }

  // Already a proper absolute path
  return imagePath
}
