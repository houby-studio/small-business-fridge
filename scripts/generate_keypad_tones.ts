import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

type DtmfSpec = {
  key: string
  lowHz: number
  highHz: number
}

type TonePartSpec = {
  durationMs: number
  frequenciesHz: number[]
  amplitudeScale?: number
}

type EventToneSpec = {
  name: 'loginSuccess' | 'loginError' | 'purchaseConfirmed' | 'purchaseCancelled'
  description: string
  fileName: string
  parts: TonePartSpec[]
}

type CliOptions = {
  outDir: string
  durationMs: number
  sampleRate: number
  fadeMs: number
  amplitude: number
}

const DEFAULT_OPTIONS: CliOptions = {
  outDir: 'public/keypad',
  durationMs: 180,
  sampleRate: 8000,
  fadeMs: 8,
  amplitude: 0.45,
}

const DTMF_SPECS: DtmfSpec[] = [
  { key: '1', lowHz: 697, highHz: 1209 },
  { key: '2', lowHz: 697, highHz: 1336 },
  { key: '3', lowHz: 697, highHz: 1477 },
  { key: '4', lowHz: 770, highHz: 1209 },
  { key: '5', lowHz: 770, highHz: 1336 },
  { key: '6', lowHz: 770, highHz: 1477 },
  { key: '7', lowHz: 852, highHz: 1209 },
  { key: '8', lowHz: 852, highHz: 1336 },
  { key: '9', lowHz: 852, highHz: 1477 },
  { key: '*', lowHz: 941, highHz: 1209 },
  { key: '0', lowHz: 941, highHz: 1336 },
  { key: '#', lowHz: 941, highHz: 1477 },
]

const EVENT_TONE_SPECS: EventToneSpec[] = [
  {
    name: 'loginSuccess',
    description: 'Three ascending notes for successful keypad login',
    fileName: 'login-success.wav',
    parts: [
      { durationMs: 70, frequenciesHz: [523], amplitudeScale: 1 },
      { durationMs: 25, frequenciesHz: [], amplitudeScale: 0 },
      { durationMs: 70, frequenciesHz: [659], amplitudeScale: 1 },
      { durationMs: 25, frequenciesHz: [], amplitudeScale: 0 },
      { durationMs: 90, frequenciesHz: [784], amplitudeScale: 1 },
    ],
  },
  {
    name: 'loginError',
    description: 'Two descending notes for invalid or unavailable keypad login',
    fileName: 'login-error.wav',
    parts: [
      { durationMs: 130, frequenciesHz: [330], amplitudeScale: 1 },
      { durationMs: 35, frequenciesHz: [], amplitudeScale: 0 },
      { durationMs: 170, frequenciesHz: [220], amplitudeScale: 1 },
    ],
  },
  {
    name: 'purchaseConfirmed',
    description: 'Original three-second victory fanfare for completed kiosk purchase',
    fileName: 'purchase-confirmed.wav',
    parts: [
      { durationMs: 180, frequenciesHz: [392, 784, 1175], amplitudeScale: 0.92 },
      { durationMs: 30, frequenciesHz: [], amplitudeScale: 0 },
      { durationMs: 180, frequenciesHz: [523, 1046, 1568], amplitudeScale: 0.94 },
      { durationMs: 30, frequenciesHz: [], amplitudeScale: 0 },
      { durationMs: 210, frequenciesHz: [659, 1318, 1977], amplitudeScale: 0.98 },
      { durationMs: 45, frequenciesHz: [], amplitudeScale: 0 },
      { durationMs: 170, frequenciesHz: [523, 1046, 1568], amplitudeScale: 0.92 },
      { durationMs: 28, frequenciesHz: [], amplitudeScale: 0 },
      { durationMs: 170, frequenciesHz: [659, 1318, 1977], amplitudeScale: 0.96 },
      { durationMs: 28, frequenciesHz: [], amplitudeScale: 0 },
      { durationMs: 230, frequenciesHz: [784, 1568, 2352], amplitudeScale: 1 },
      { durationMs: 55, frequenciesHz: [], amplitudeScale: 0 },
      { durationMs: 260, frequenciesHz: [659, 988, 1318, 1977], amplitudeScale: 0.9 },
      { durationMs: 35, frequenciesHz: [], amplitudeScale: 0 },
      { durationMs: 280, frequenciesHz: [784, 1175, 1568, 2352], amplitudeScale: 0.94 },
      { durationMs: 40, frequenciesHz: [], amplitudeScale: 0 },
      { durationMs: 460, frequenciesHz: [523, 784, 1046, 1568, 2093], amplitudeScale: 1 },
    ],
  },
  {
    name: 'purchaseCancelled',
    description: 'More dramatic descending 8-bit defeat sting for cancelled kiosk purchase session',
    fileName: 'purchase-cancelled.wav',
    parts: [
      { durationMs: 78, frequenciesHz: [466, 932], amplitudeScale: 0.95 },
      { durationMs: 18, frequenciesHz: [], amplitudeScale: 0 },
      { durationMs: 82, frequenciesHz: [392, 784], amplitudeScale: 0.95 },
      { durationMs: 18, frequenciesHz: [], amplitudeScale: 0 },
      { durationMs: 92, frequenciesHz: [349, 698], amplitudeScale: 0.94 },
      { durationMs: 22, frequenciesHz: [], amplitudeScale: 0 },
      { durationMs: 104, frequenciesHz: [294, 588], amplitudeScale: 0.92 },
      { durationMs: 28, frequenciesHz: [], amplitudeScale: 0 },
      { durationMs: 170, frequenciesHz: [165, 330, 494], amplitudeScale: 1 },
    ],
  },
]

function parsePositiveNumber(input: string, optionName: string): number {
  const value = Number(input)
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${optionName} must be a positive number. Received: ${input}`)
  }
  return value
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { ...DEFAULT_OPTIONS }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const next = argv[i + 1]

    if (!arg.startsWith('--')) {
      throw new Error(`Unknown argument: ${arg}`)
    }

    if (!next) {
      throw new Error(`Missing value for ${arg}`)
    }

    switch (arg) {
      case '--out':
        options.outDir = next
        i++
        break
      case '--duration-ms':
        options.durationMs = parsePositiveNumber(next, '--duration-ms')
        i++
        break
      case '--sample-rate':
        options.sampleRate = parsePositiveNumber(next, '--sample-rate')
        i++
        break
      case '--fade-ms':
        options.fadeMs = parsePositiveNumber(next, '--fade-ms')
        i++
        break
      case '--amplitude': {
        const amplitude = parsePositiveNumber(next, '--amplitude')
        if (amplitude > 1) {
          throw new Error('--amplitude must be <= 1')
        }
        options.amplitude = amplitude
        i++
        break
      }
      default:
        throw new Error(`Unknown option: ${arg}`)
    }
  }

  return options
}

function toFileName(key: string): string {
  if (key === '*') return 'star'
  if (key === '#') return 'hash'
  return key
}

function clampSample(sample: number): number {
  if (sample > 1) return 1
  if (sample < -1) return -1
  return sample
}

function toPublicUrlPath(outDir: string, fileName: string): string {
  const normalizedOutDir = outDir.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '')

  if (normalizedOutDir === 'public') {
    return `/${fileName}`
  }

  if (normalizedOutDir.startsWith('public/')) {
    return `/${normalizedOutDir.slice('public/'.length)}/${fileName}`
  }

  if (normalizedOutDir === 'storage/uploads') {
    return `/uploads/${fileName}`
  }

  if (normalizedOutDir.startsWith('storage/uploads/')) {
    return `/uploads/${normalizedOutDir.slice('storage/uploads/'.length)}/${fileName}`
  }

  if (normalizedOutDir.startsWith('storage/')) {
    return `/${normalizedOutDir.slice('storage/'.length)}/${fileName}`
  }

  return `/${normalizedOutDir}/${fileName}`
}

function buildDtmfPcm(spec: DtmfSpec, options: CliOptions): Int16Array {
  return buildCompositePcm(
    [
      {
        durationMs: options.durationMs,
        frequenciesHz: [spec.lowHz, spec.highHz],
        amplitudeScale: 1,
      },
    ],
    options
  )
}

function buildCompositePcm(parts: TonePartSpec[], options: CliOptions): Int16Array {
  const sampleChunks: Int16Array[] = []

  for (const part of parts) {
    const totalSamples = Math.max(1, Math.round((options.sampleRate * part.durationMs) / 1000))
    const fadeSamples = Math.max(
      0,
      Math.min(
        Math.round((options.sampleRate * options.fadeMs) / 1000),
        Math.floor(totalSamples / 2)
      )
    )

    const chunk = new Int16Array(totalSamples)

    for (let i = 0; i < totalSamples; i++) {
      const t = i / options.sampleRate
      const toneSum = part.frequenciesHz.reduce(
        (sum, hz) => sum + Math.sin(2 * Math.PI * hz * t),
        0
      )
      const normalizedTone = part.frequenciesHz.length > 0 ? toneSum / part.frequenciesHz.length : 0

      let envelope = 1
      if (fadeSamples > 0) {
        if (i < fadeSamples) {
          envelope = i / fadeSamples
        } else if (i >= totalSamples - fadeSamples) {
          envelope = (totalSamples - 1 - i) / fadeSamples
        }
      }

      const scaledAmplitude = options.amplitude * (part.amplitudeScale ?? 1)
      const mixed = normalizedTone * scaledAmplitude * envelope
      const sample = clampSample(mixed)
      chunk[i] = Math.round(sample * 32767)
    }

    sampleChunks.push(chunk)
  }

  const totalLength = sampleChunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const pcm = new Int16Array(totalLength)
  let writeOffset = 0

  for (const chunk of sampleChunks) {
    pcm.set(chunk, writeOffset)
    writeOffset += chunk.length
  }

  return pcm
}

function pcmToWavBytes(pcm: Int16Array, sampleRate: number): Buffer {
  const channelCount = 1
  const bitsPerSample = 16
  const blockAlign = (channelCount * bitsPerSample) / 8
  const byteRate = sampleRate * blockAlign
  const dataSize = pcm.length * blockAlign
  const chunkSize = 36 + dataSize

  const buffer = Buffer.allocUnsafe(44 + dataSize)
  let offset = 0

  offset += buffer.write('RIFF', offset)
  buffer.writeUInt32LE(chunkSize, offset)
  offset += 4
  offset += buffer.write('WAVE', offset)

  offset += buffer.write('fmt ', offset)
  buffer.writeUInt32LE(16, offset)
  offset += 4
  buffer.writeUInt16LE(1, offset)
  offset += 2
  buffer.writeUInt16LE(channelCount, offset)
  offset += 2
  buffer.writeUInt32LE(sampleRate, offset)
  offset += 4
  buffer.writeUInt32LE(byteRate, offset)
  offset += 4
  buffer.writeUInt16LE(blockAlign, offset)
  offset += 2
  buffer.writeUInt16LE(bitsPerSample, offset)
  offset += 2

  offset += buffer.write('data', offset)
  buffer.writeUInt32LE(dataSize, offset)
  offset += 4

  for (const sample of pcm) {
    buffer.writeInt16LE(sample, offset)
    offset += 2
  }

  return buffer
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const outDir = resolve(process.cwd(), options.outDir)

  await mkdir(outDir, { recursive: true })

  const manifest = {
    generatedAt: new Date().toISOString(),
    format: 'wav/pcm16-mono',
    options,
    keys: [] as Array<{
      key: string
      lowHz: number
      highHz: number
      fileName: string
      urlPath: string
    }>,
    events: [] as Array<{
      name: EventToneSpec['name']
      description: string
      fileName: string
      urlPath: string
      parts: TonePartSpec[]
    }>,
  }

  for (const spec of DTMF_SPECS) {
    const fileName = `${toFileName(spec.key)}.wav`
    const filePath = resolve(outDir, fileName)
    const pcm = buildDtmfPcm(spec, options)
    const wav = pcmToWavBytes(pcm, options.sampleRate)

    await writeFile(filePath, wav)

    manifest.keys.push({
      key: spec.key,
      lowHz: spec.lowHz,
      highHz: spec.highHz,
      fileName,
      urlPath: toPublicUrlPath(options.outDir, fileName),
    })
  }

  for (const spec of EVENT_TONE_SPECS) {
    const filePath = resolve(outDir, spec.fileName)
    const pcm = buildCompositePcm(spec.parts, options)
    const wav = pcmToWavBytes(pcm, options.sampleRate)

    await writeFile(filePath, wav)

    manifest.events.push({
      name: spec.name,
      description: spec.description,
      fileName: spec.fileName,
      urlPath: toPublicUrlPath(options.outDir, spec.fileName),
      parts: spec.parts,
    })
  }

  await writeFile(
    resolve(outDir, 'dtmf-manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8'
  )

  console.log(
    `Generated ${DTMF_SPECS.length} keypad tones and ${EVENT_TONE_SPECS.length} event tones in ${outDir}`
  )
  console.log('Tip: files in public are available from the app root URL path.')
}

await main()
