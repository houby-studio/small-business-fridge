/**
 * Generates the whole favicon / app-icon set from a single source of truth.
 *
 * The artwork is a vector copy of the boot-loader fridge (see the
 * `#sbf-boot-loader .fridge-*` rules in `inertia/css/app.css`), captured at the
 * end of its door-opening animation — a favicon cannot animate, so the icon
 * shows the door already swung open.
 *
 * The door is a flat element rotated in 3D by CSS, so its outline here is the
 * same perspective projection the browser performs: rotateY around the left
 * edge, then translateX, then the wrapper's `perspective` divide.
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
const PERSPECTIVE = 780
const DOOR_WIDTH = WRAP_WIDTH * 0.92
const DOOR_ANGLE_DEG = -62
const DOOR_SHIFT_X = -15

/** Bounding box of the whole composition (cabinet + swung-open door). */
const CONTENT = {
  left: DOOR_SHIFT_X,
  top: -12.1,
  width: WRAP_WIDTH - DOOR_SHIFT_X,
  height: WRAP_HEIGHT + 12.1 * 2,
}

const COLORS = {
  cabinetTop: '#2d3440',
  cabinetMid: '#1f2937',
  cabinetBottom: '#111827',
  cabinetBorder: 'rgba(255,255,255,0.16)',
  doorTop: '#f3f4f6',
  doorMid: '#e5e7eb',
  doorBottom: '#d1d5db',
  doorBorder: 'rgba(0,0,0,0.28)',
  doorHighlight: 'rgba(255,255,255,0.55)',
  handle: 'rgba(31,41,55,0.65)',
  shelf: 'rgba(255,255,255,0.18)',
  bottleTop: '#f82843',
  bottleMid: '#ef1c37',
  bottleBottom: '#d0112b',
  bottleBorder: '#8c1321',
  backdropTop: '#1c1c20',
  backdropBottom: '#09090b',
}

/**
 * Projects a point of the door element into wrapper coordinates, reproducing
 * `transform: translateX(...) rotateY(...)` under the wrapper's perspective.
 */
function projectDoorPoint(u: number, v: number): { x: number; y: number } {
  const theta = (DOOR_ANGLE_DEG * Math.PI) / 180
  const originY = WRAP_HEIGHT / 2
  const perspectiveOrigin = { x: WRAP_WIDTH / 2, y: WRAP_HEIGHT / 2 }

  const x = u * Math.cos(theta) + DOOR_SHIFT_X
  const z = -u * Math.sin(theta)
  const y = v
  const scale = PERSPECTIVE / (PERSPECTIVE - z)

  return {
    x: perspectiveOrigin.x + (x - perspectiveOrigin.x) * scale,
    y: originY + (y - originY) * scale,
  }
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}

type Point = { x: number; y: number }

function subtract(a: Point, b: Point): Point {
  return { x: a.x - b.x, y: a.y - b.y }
}

function unit(vector: Point): Point {
  const length = Math.hypot(vector.x, vector.y)
  return { x: vector.x / length, y: vector.y / length }
}

/**
 * Outline of the open door: a trapezoid whose corners keep the CSS
 * `border-radius: 21px 18px 18px 21px`. The rounding is drawn as quadratic
 * curves with the corner as control point — elliptical arcs would need radii
 * that no longer fit once perspective has skewed the edges.
 */
function doorPath(): string {
  const topLeft = projectDoorPoint(0, 0)
  const topRight = projectDoorPoint(DOOR_WIDTH, 0)
  const bottomRight = projectDoorPoint(DOOR_WIDTH, WRAP_HEIGHT)
  const bottomLeft = projectDoorPoint(0, WRAP_HEIGHT)

  // Radii along the horizontal edges shrink with the rotation; along the
  // vertical edges they grow with the perspective scale of that edge.
  const cos = Math.abs(Math.cos((DOOR_ANGLE_DEG * Math.PI) / 180))
  const rightScale = (bottomRight.y - topRight.y) / WRAP_HEIGHT
  const corners = [
    { at: topLeft, from: bottomLeft, to: topRight, inset: 21, outset: 21 * cos },
    { at: topRight, from: topLeft, to: bottomRight, inset: 18 * cos, outset: 18 * rightScale },
    { at: bottomRight, from: topRight, to: bottomLeft, inset: 18 * rightScale, outset: 18 * cos },
    { at: bottomLeft, from: bottomRight, to: topLeft, inset: 21 * cos, outset: 21 },
  ]

  const segments: string[] = []

  corners.forEach((corner, index) => {
    const incoming = unit(subtract(corner.at, corner.from))
    const outgoing = unit(subtract(corner.to, corner.at))
    const start = {
      x: corner.at.x - incoming.x * corner.inset,
      y: corner.at.y - incoming.y * corner.inset,
    }
    const end = {
      x: corner.at.x + outgoing.x * corner.outset,
      y: corner.at.y + outgoing.y * corner.outset,
    }

    segments.push(
      `${index === 0 ? 'M' : 'L'}${round(start.x)} ${round(start.y)}`,
      `Q${round(corner.at.x)} ${round(corner.at.y)} ${round(end.x)} ${round(end.y)}`
    )
  })

  return `${segments.join('')}Z`
}

/** The door handle (`.fridge-door::before`), projected the same way. */
function handleMarkup(): string {
  const topLeft = projectDoorPoint(DOOR_WIDTH - 16, 36)
  const bottomRight = projectDoorPoint(DOOR_WIDTH - 10, 72)
  const width = round(bottomRight.x - topLeft.x)
  const height = round(bottomRight.y - topLeft.y)

  return `<rect x="${round(topLeft.x)}" y="${round(topLeft.y)}" width="${width}" height="${height}" rx="${round(width / 2)}" fill="${COLORS.handle}" />`
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

function fridgeMarkup(detail: Detail): string {
  const bottle = [
    `<rect x="54" y="6" width="12" height="6" rx="3" fill="url(#sbf-bottle)" />`,
    `<rect x="53" y="12" width="14" height="18" rx="6" fill="url(#sbf-bottle)" />`,
    `<path fill="url(#sbf-bottle)" d="M45 48A13 20 0 0 1 58 28h4a13 20 0 0 1 13 20v24a10 12 0 0 1-10 12H55a10 12 0 0 1-10-12Z" />`,
  ].join('\n    ')

  const cabinetBorder =
    detail === 'full' ? ` stroke="${COLORS.cabinetBorder}" stroke-width="1"` : ''
  const shelf =
    detail === 'full'
      ? `\n    <rect x="10" y="84" width="100" height="2" fill="${COLORS.shelf}" />\n    `
      : '\n    '
  // Stands in for the open door's drop shadow falling into the cabinet.
  const doorShadow =
    detail === 'full'
      ? `\n    <rect x="0" y="0" width="${WRAP_WIDTH}" height="${WRAP_HEIGHT}" rx="21" fill="url(#sbf-door-shadow)" />`
      : ''

  // The door border and its inset highlight are stroked inside the clip, which
  // keeps both hairlines within the door outline (as CSS border/inset shadow do).
  const doorEdges =
    detail === 'full'
      ? `
    <g clip-path="url(#sbf-door-clip)" fill="none">
      <path d="${doorPath()}" stroke="${COLORS.doorHighlight}" stroke-width="4" />
      <path d="${doorPath()}" stroke="${COLORS.doorBorder}" stroke-width="2" />
    </g>
    ${handleMarkup()}`
      : ''

  return `    <rect x="0" y="0" width="${WRAP_WIDTH}" height="${WRAP_HEIGHT}" rx="21" fill="url(#sbf-cabinet)"${cabinetBorder} />${shelf}${bottle}${doorShadow}
    <path d="${doorPath()}" fill="url(#sbf-door)" />${doorEdges}`
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

  // Only the detailed artwork uses the door shadow and the inset-hairline clip.
  const detailDefs =
    detail === 'full'
      ? `    <linearGradient id="sbf-door-shadow" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="${round(WRAP_WIDTH * 0.55)}" y2="0">
      <stop offset="0" stop-color="#000000" stop-opacity="0.42" />
      <stop offset="0.55" stop-color="#000000" stop-opacity="0.14" />
      <stop offset="1" stop-color="#000000" stop-opacity="0" />
    </linearGradient>
    <clipPath id="sbf-door-clip">
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
    <linearGradient id="sbf-bottle" gradientUnits="userSpaceOnUse" x1="0" y1="6" x2="0" y2="84">
      <stop offset="0" stop-color="${COLORS.bottleTop}" />
      <stop offset="0.28" stop-color="${COLORS.bottleMid}" />
      <stop offset="1" stop-color="${COLORS.bottleBottom}" />
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
