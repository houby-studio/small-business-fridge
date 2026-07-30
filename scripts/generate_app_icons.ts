/**
 * Generates the whole favicon / app-icon set from a single source of truth.
 *
 * The artwork is a flat sticker-style fridge: dark cabinet frame, white door,
 * one bold red handle, on a transparent canvas. It is deliberately *not* a copy
 * of the boot-loader fridge — that artwork's hairlines, seam and 3D door read as
 * mush at 16px, and a filled backdrop tile looks like a black square in the tab.
 * Only the palette is shared with `#sbf-boot-loader .fridge-*`.
 *
 * Every element is sized so it survives a 16px raster: the frame is ~1px, the
 * handle ~1.5px wide at that size. Keep that in mind before making anything
 * thinner.
 *
 * Run with: npm run generate:app-icons
 */

import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from '@playwright/test'

/*
|--------------------------------------------------------------------------
| Silhouette geometry (units of the 512 canvas, before per-variant scaling)
|--------------------------------------------------------------------------
*/

const SHAPE = {
  width: 380,
  height: 500,
  radius: 74,
  /** Dark cabinet frame visible around the door — the icon's outline. */
  frame: 38,
  doorRadius: 44,
  handleWidth: 50,
  handleHeight: 150,
  /** Gap between the handle and the door's right edge. */
  handleInset: 30,
}

const CONTENT = { left: 0, top: 0, width: SHAPE.width, height: SHAPE.height }

const COLORS = {
  cabinetTop: '#1f2937',
  cabinetBottom: '#0b1220',
  doorTop: '#ffffff',
  doorBottom: '#e5e7eb',
  handleTop: '#f82843',
  handleBottom: '#c30f2b',
  backdropTop: '#ffffff',
  backdropBottom: '#eceef1',
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}

/*
|--------------------------------------------------------------------------
| SVG assembly
|--------------------------------------------------------------------------
*/

type Backdrop = 'none' | 'square'

type ArtworkOptions = {
  backdrop: Backdrop
  /** Composition height as a fraction of the canvas. */
  contentScale: number
}

function fridgeMarkup(): string {
  const door = {
    x: SHAPE.frame,
    y: SHAPE.frame,
    width: SHAPE.width - SHAPE.frame * 2,
    height: SHAPE.height - SHAPE.frame * 2,
  }
  const handle = {
    x: door.x + door.width - SHAPE.handleInset - SHAPE.handleWidth,
    y: round((SHAPE.height - SHAPE.handleHeight) / 2),
  }

  return `    <rect x="0" y="0" width="${SHAPE.width}" height="${SHAPE.height}" rx="${SHAPE.radius}" fill="url(#sbf-cabinet)" />
    <rect x="${door.x}" y="${door.y}" width="${door.width}" height="${door.height}" rx="${SHAPE.doorRadius}" fill="url(#sbf-door)" />
    <rect x="${round(handle.x)}" y="${handle.y}" width="${SHAPE.handleWidth}" height="${SHAPE.handleHeight}" rx="${round(SHAPE.handleWidth / 2)}" fill="url(#sbf-handle)" />`
}

function buildSvg({ backdrop, contentScale }: ArtworkOptions): string {
  const canvas = 512
  const scale = (canvas * contentScale) / CONTENT.height
  const offsetX = (canvas - CONTENT.width * scale) / 2
  const offsetY = (canvas - CONTENT.height * scale) / 2

  // Only home-screen icons get a backdrop: iOS composites transparency onto
  // black, and maskable icons must cover the whole canvas.
  const backdropMarkup =
    backdrop === 'none' ? '' : `  <rect width="512" height="512" fill="url(#sbf-backdrop)" />\n`

  const backdropGradient =
    backdrop === 'none'
      ? ''
      : `    <linearGradient id="sbf-backdrop" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${COLORS.backdropTop}" />
      <stop offset="1" stop-color="${COLORS.backdropBottom}" />
    </linearGradient>
`

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <title>Small Business Fridge</title>
  <defs>
${backdropGradient}    <linearGradient id="sbf-cabinet" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="${SHAPE.height}">
      <stop offset="0" stop-color="${COLORS.cabinetTop}" />
      <stop offset="1" stop-color="${COLORS.cabinetBottom}" />
    </linearGradient>
    <linearGradient id="sbf-door" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="${SHAPE.height}">
      <stop offset="0" stop-color="${COLORS.doorTop}" />
      <stop offset="1" stop-color="${COLORS.doorBottom}" />
    </linearGradient>
    <linearGradient id="sbf-handle" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="${SHAPE.height}">
      <stop offset="0" stop-color="${COLORS.handleTop}" />
      <stop offset="1" stop-color="${COLORS.handleBottom}" />
    </linearGradient>
  </defs>
${backdropMarkup}  <g transform="translate(${round(offsetX)} ${round(offsetY)}) scale(${round(scale)})">
${fridgeMarkup()}
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

/** Master artwork with a little breathing room — also usable inside the UI. */
const MASTER: ArtworkOptions = { backdrop: 'none', contentScale: 0.92 }
/** Browser tab: as large as possible, no backdrop tile. */
const TAB: ArtworkOptions = { backdrop: 'none', contentScale: 0.98 }
/** Manifest `any` icons stay transparent so launchers can place them freely. */
const TILE: ArtworkOptions = { backdrop: 'none', contentScale: 0.9 }
/** iOS composites transparency onto black, so this one needs a backdrop. */
const APPLE: ArtworkOptions = { backdrop: 'square', contentScale: 0.76 }
/** Android maskable: artwork must survive a circle covering the middle 80%. */
const MASKABLE: ArtworkOptions = { backdrop: 'square', contentScale: 0.58 }

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
