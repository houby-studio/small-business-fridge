/**
 * Generates the whole favicon / app-icon set from a single source of truth.
 *
 * The artwork is a vector copy of the boot-loader fridge (see the
 * `#sbf-boot-loader .fridge-*` rules in `inertia/css/app.css`) in its *first*
 * animation frame — doors shut. A favicon cannot animate, and the swung-open
 * frame is unreadable at 16px, so the closed silhouette is what ships.
 *
 * Two deliberate departures from the CSS, both needed for legibility once the
 * artwork is 16px wide: the door seam is drawn dark (the CSS uses a white 18%
 * line, invisible against the white door) and the handles are brand red rather
 * than slate. Small sizes additionally thicken the seam and handles — see
 * `SIZING`, without it both vanish below ~48px.
 *
 * Run with: npm run generate:app-icons
 */

import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from '@playwright/test'

/*
|--------------------------------------------------------------------------
| Boot-loader geometry (CSS pixels, mirrors inertia/css/app.css)
|--------------------------------------------------------------------------
*/

const WRAP_WIDTH = 120
const WRAP_HEIGHT = 168
const CABINET_RADIUS = 21
/** `.fridge-door`: 92% wide, so the cabinet stays visible down its right edge. */
const DOOR_WIDTH = WRAP_WIDTH * 0.92
const DOOR_RADIUS_RIGHT = 18
/** `.fridge-seam`: sits at 50% height. */
const SEAM_Y = WRAP_HEIGHT / 2

/** Bounding box of the composition — the cabinet, doors shut. */
const CONTENT = { left: 0, top: 0, width: WRAP_WIDTH, height: WRAP_HEIGHT }

const COLORS = {
  cabinetTop: '#2d3440',
  cabinetMid: '#1f2937',
  cabinetBottom: '#111827',
  cabinetBorder: 'rgba(255,255,255,0.16)',
  doorTop: '#f3f4f6',
  doorMid: '#e5e7eb',
  doorBottom: '#d1d5db',
  doorBorder: 'rgba(0,0,0,0.28)',
  doorHighlight: 'rgba(255,255,255,0.62)',
  seam: 'rgba(17,24,39,0.5)',
  handleTop: '#f82843',
  handleBottom: '#c30f2b',
  backdropTop: '#1c1c20',
  backdropBottom: '#09090b',
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}

/**
 * The shut door: `border-radius: 21px 18px 18px 21px`, its left corners
 * following the cabinet's own rounding.
 */
function doorPath(): string {
  const right = DOOR_WIDTH
  const bottom = WRAP_HEIGHT

  return [
    `M${CABINET_RADIUS} 0`,
    `H${round(right - DOOR_RADIUS_RIGHT)}`,
    `a${DOOR_RADIUS_RIGHT} ${DOOR_RADIUS_RIGHT} 0 0 1 ${DOOR_RADIUS_RIGHT} ${DOOR_RADIUS_RIGHT}`,
    `V${round(bottom - DOOR_RADIUS_RIGHT)}`,
    `a${DOOR_RADIUS_RIGHT} ${DOOR_RADIUS_RIGHT} 0 0 1 -${DOOR_RADIUS_RIGHT} ${DOOR_RADIUS_RIGHT}`,
    `H${CABINET_RADIUS}`,
    `a${CABINET_RADIUS} ${CABINET_RADIUS} 0 0 1 -${CABINET_RADIUS} -${CABINET_RADIUS}`,
    `V${CABINET_RADIUS}`,
    `a${CABINET_RADIUS} ${CABINET_RADIUS} 0 0 1 ${CABINET_RADIUS} -${CABINET_RADIUS}`,
    'Z',
  ].join('')
}

/*
|--------------------------------------------------------------------------
| SVG assembly
|--------------------------------------------------------------------------
*/

type Detail = 'full' | 'simple'
type Backdrop = 'none' | 'rounded' | 'square'

type ArtworkOptions = {
  /** `simple` drops hairlines that turn to mush below ~32px. */
  detail: Detail
  backdrop: Backdrop
  /** Composition height as a fraction of the canvas. */
  contentScale: number
}

/**
 * Optical corrections: the seam and handles are hairlines in the CSS, so at tab
 * sizes they have to grow to survive rasterising at all.
 */
const SIZING: Record<Detail, { seam: number; handleWidth: number; handleHeight: number }> = {
  full: { seam: 3, handleWidth: 7, handleHeight: 34 },
  simple: { seam: 6, handleWidth: 10, handleHeight: 38 },
}

function fridgeMarkup(detail: Detail): string {
  const { seam, handleWidth, handleHeight } = SIZING[detail]

  // Freezer handle above the seam, fridge handle below — the pair is what makes
  // the silhouette read as a fridge rather than a plain rounded rectangle.
  const handleX = round(DOOR_WIDTH - 10 - handleWidth)
  const handleGap = 12
  const handles = [
    `<rect x="${handleX}" y="${round(SEAM_Y - handleGap - handleHeight)}" width="${handleWidth}" height="${handleHeight}" rx="${round(handleWidth / 2)}" fill="url(#sbf-handle)" />`,
    `<rect x="${handleX}" y="${round(SEAM_Y + handleGap)}" width="${handleWidth}" height="${handleHeight}" rx="${round(handleWidth / 2)}" fill="url(#sbf-handle)" />`,
  ].join('\n    ')

  const cabinetBorder =
    detail === 'full' ? ` stroke="${COLORS.cabinetBorder}" stroke-width="1"` : ''

  // Border and inset highlight are stroked inside the clip, so both hairlines
  // stay within the door outline (as the CSS border/inset shadow do).
  const doorEdges =
    detail === 'full'
      ? `
    <g clip-path="url(#sbf-door-clip)" fill="none">
      <path d="${doorPath()}" stroke="${COLORS.doorHighlight}" stroke-width="4" />
      <path d="${doorPath()}" stroke="${COLORS.doorBorder}" stroke-width="2" />
    </g>`
      : ''

  return `    <rect x="0" y="0" width="${WRAP_WIDTH}" height="${WRAP_HEIGHT}" rx="${CABINET_RADIUS}" fill="url(#sbf-cabinet)"${cabinetBorder} />
    <path d="${doorPath()}" fill="url(#sbf-door)" />${doorEdges}
    <rect x="0" y="${round(SEAM_Y - seam / 2)}" width="${round(DOOR_WIDTH)}" height="${seam}" fill="${COLORS.seam}" />
    ${handles}`
}

function buildSvg({ detail, backdrop, contentScale }: ArtworkOptions): string {
  const canvas = 512
  const scale = (canvas * contentScale) / CONTENT.height
  const offsetX = (canvas - CONTENT.width * scale) / 2
  const offsetY = (canvas - CONTENT.height * scale) / 2

  const backdropMarkup =
    backdrop === 'none'
      ? ''
      : backdrop === 'rounded'
        ? `  <rect x="0.75" y="0.75" width="510.5" height="510.5" rx="101" fill="url(#sbf-backdrop)" stroke="rgba(255,255,255,0.09)" stroke-width="1.5" />\n`
        : `  <rect width="512" height="512" fill="url(#sbf-backdrop)" />\n`

  const backdropGradient =
    backdrop === 'none'
      ? ''
      : `    <linearGradient id="sbf-backdrop" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${COLORS.backdropTop}" />
      <stop offset="1" stop-color="${COLORS.backdropBottom}" />
    </linearGradient>
`

  // Only the detailed artwork strokes hairlines inside the door outline.
  const detailDefs =
    detail === 'full'
      ? `    <clipPath id="sbf-door-clip">
      <path d="${doorPath()}" />
    </clipPath>
`
      : ''

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <title>Small Business Fridge</title>
  <defs>
${backdropGradient}    <linearGradient id="sbf-cabinet" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="${WRAP_HEIGHT}">
      <stop offset="0" stop-color="${COLORS.cabinetTop}" />
      <stop offset="0.45" stop-color="${COLORS.cabinetMid}" />
      <stop offset="1" stop-color="${COLORS.cabinetBottom}" />
    </linearGradient>
    <linearGradient id="sbf-door" gradientUnits="userSpaceOnUse" x1="0" y1="${round(CONTENT.top)}" x2="0" y2="${round(CONTENT.top + CONTENT.height)}">
      <stop offset="0" stop-color="${COLORS.doorTop}" />
      <stop offset="0.55" stop-color="${COLORS.doorMid}" />
      <stop offset="1" stop-color="${COLORS.doorBottom}" />
    </linearGradient>
    <linearGradient id="sbf-handle" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="${WRAP_HEIGHT}">
      <stop offset="0" stop-color="${COLORS.handleTop}" />
      <stop offset="1" stop-color="${COLORS.handleBottom}" />
    </linearGradient>
${detailDefs}  </defs>
${backdropMarkup}  <g transform="translate(${round(offsetX)} ${round(offsetY)}) scale(${round(scale)}) translate(${round(-CONTENT.left)} ${round(-CONTENT.top)})">
${fridgeMarkup(detail)}
  </g>
</svg>
`
}

/*
|--------------------------------------------------------------------------
| Rasterising and ICO packing
|--------------------------------------------------------------------------
*/

type Rasterizer = (svg: string, size: number) => Promise<Buffer>

/** Minimal ICO container holding PNG frames (supported since Windows Vista). */
function packIco(frames: { size: number; data: Buffer }[]): Buffer {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(frames.length, 4)

  let offset = header.length + frames.length * 16
  const directory: Buffer[] = []

  for (const frame of frames) {
    const entry = Buffer.alloc(16)
    entry.writeUInt8(frame.size >= 256 ? 0 : frame.size, 0)
    entry.writeUInt8(frame.size >= 256 ? 0 : frame.size, 1)
    entry.writeUInt8(0, 2) // palette size
    entry.writeUInt8(0, 3) // reserved
    entry.writeUInt16LE(1, 4) // colour planes
    entry.writeUInt16LE(32, 6) // bits per pixel
    entry.writeUInt32LE(frame.data.length, 8)
    entry.writeUInt32LE(offset, 12)
    directory.push(entry)
    offset += frame.data.length
  }

  return Buffer.concat([header, ...directory, ...frames.map((frame) => frame.data)])
}

/*
|--------------------------------------------------------------------------
| Output set
|--------------------------------------------------------------------------
*/

const PUBLIC_DIR = resolve(import.meta.dirname, '..', 'public')

/** Transparent artwork, also usable inside the UI. */
const MASTER: ArtworkOptions = { detail: 'full', backdrop: 'none', contentScale: 0.94 }
/** App-icon look: dark rounded tile, matching the boot screen. */
const TILE: ArtworkOptions = { detail: 'full', backdrop: 'rounded', contentScale: 0.78 }
/** Browser-tab sizes: hairlines removed so 16px stays legible. */
const TAB: ArtworkOptions = { detail: 'simple', backdrop: 'rounded', contentScale: 0.8 }
/** iOS applies its own mask, so the backdrop must reach the edges. */
const APPLE: ArtworkOptions = { detail: 'full', backdrop: 'square', contentScale: 0.72 }
/** Android maskable: artwork must survive a circle covering the middle 80%. */
const MASKABLE: ArtworkOptions = { detail: 'full', backdrop: 'square', contentScale: 0.6 }

async function generate(rasterize: Rasterizer) {
  const written: string[] = []

  const write = async (name: string, data: Buffer | string) => {
    await writeFile(resolve(PUBLIC_DIR, name), data)
    written.push(name)
  }

  await write('icon.svg', buildSvg(MASTER))
  await write('favicon.svg', buildSvg(TAB))

  const tabSvg = buildSvg(TAB)
  const tileSvg = buildSvg(TILE)

  const icoFrames = await Promise.all(
    [16, 32, 48].map(async (size) => ({ size, data: await rasterize(tabSvg, size) }))
  )
  await write('favicon.ico', packIco(icoFrames))
  await write('favicon-96x96.png', await rasterize(tabSvg, 96))
  await write('apple-touch-icon.png', await rasterize(buildSvg(APPLE), 180))
  await write('icon-192.png', await rasterize(tileSvg, 192))
  await write('icon-512.png', await rasterize(tileSvg, 512))
  await write('icon-maskable-512.png', await rasterize(buildSvg(MASKABLE), 512))

  return written
}

const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 512, height: 512 } })

  const rasterize: Rasterizer = async (svg, size) => {
    const dataUri = `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`
    await page.setViewportSize({ width: size, height: size })
    await page.setContent(
      `<style>html,body{margin:0;padding:0;background:transparent}` +
        `img{display:block;width:${size}px;height:${size}px}</style>` +
        `<img src="${dataUri}">`
    )
    await page.locator('img').waitFor()
    return page.screenshot({ omitBackground: true })
  }

  const written = await generate(rasterize)
  console.log(`[app-icons] wrote ${written.length} files to public/:`)
  for (const name of written) console.log(`  - ${name}`)
} finally {
  await browser.close()
}
