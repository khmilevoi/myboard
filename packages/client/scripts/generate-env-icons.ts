import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium, type Browser } from '@playwright/test'

import { oklchToHex } from '../src/shared/app-env/oklch'
import { ACCENT_C, ACCENT_L, APP_ENVS, type AppEnvName } from '../src/shared/app-env/registry'

const clientRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const publicDir = resolve(clientRoot, 'public')
const envRoot = resolve(publicDir, 'env')
const lockFile = resolve(clientRoot, 'icons.lock.json')

/** The production fill every committed SVG carries; replaced with the env accent. */
const PRODUCTION_FILL = oklchToHex(ACCENT_L, ACCENT_C, APP_ENVS.production.hue)

/**
 * Which SVG feeds which raster, and at what size. Read off the committed
 * production files rather than guessed: apple-touch-icon.png, pwa-icon-192.png
 * and pwa-icon.png all have a fully transparent corner pixel and so come from
 * the rounded pwa-icon.svg (rx=112); only pwa-icon-maskable.png is opaque at
 * the corner, because iOS and Android composite their own mask over a
 * full-bleed source.
 */
const RASTERS = [
  { out: 'apple-touch-icon.png', source: 'pwa-icon.svg', size: 180 },
  { out: 'pwa-icon-192.png', source: 'pwa-icon.svg', size: 192 },
  { out: 'pwa-icon.png', source: 'pwa-icon.svg', size: 512 },
  { out: 'pwa-icon-maskable.png', source: 'pwa-icon-maskable.svg', size: 512 },
] as const

const SVG_SOURCES = ['favicon.svg', 'pwa-icon.svg', 'pwa-icon-maskable.svg'] as const

/**
 * Rasterise through the Chromium that Playwright already installs on this
 * machine. No new dependency, and nothing Chromium-related enters the Docker
 * build or `pnpm check` -- this script is run by hand, and its output is
 * committed.
 */
async function rasterise(browser: Browser, svg: string, size: number): Promise<Buffer> {
  const page = await browser.newPage({ viewport: { width: size, height: size } })
  const dataUri = `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`
  await page.setContent(
    `<!doctype html><html><head><style>
       html,body{margin:0;padding:0;background:transparent}
       img{display:block;width:${size}px;height:${size}px}
     </style></head><body><img src="${dataUri}"></body></html>`,
    // 'load' waits for the <img>, so no page.evaluate and no DOM lib needed.
    { waitUntil: 'load' },
  )
  const png = await page.screenshot({ omitBackground: true, type: 'png' })
  await page.close()
  return png
}

/**
 * ICONDIR (6 bytes) + one ICONDIRENTRY (16 bytes) + the PNG payload. The
 * committed production favicon.ico uses the same 22-byte header over a
 * BITMAPINFOHEADER payload instead; PNG-in-ICO is supported by every current
 * browser and is a fraction of the code, and the two files are independent.
 */
function wrapPngInIco(png: Buffer, size: number): Buffer {
  const header = Buffer.alloc(22)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(1, 4) // image count
  header.writeUInt8(size === 256 ? 0 : size, 6) // width (0 means 256)
  header.writeUInt8(size === 256 ? 0 : size, 7) // height
  header.writeUInt8(0, 8) // palette size
  header.writeUInt8(0, 9) // reserved
  header.writeUInt16LE(1, 10) // colour planes
  header.writeUInt16LE(32, 12) // bits per pixel
  header.writeUInt32LE(png.length, 14) // payload bytes
  header.writeUInt32LE(22, 18) // payload offset
  return Buffer.concat([header, png])
}

async function main(): Promise<void> {
  const sources = new Map<string, string>()
  for (const file of SVG_SOURCES) {
    sources.set(file, await readFile(resolve(publicDir, file), 'utf8'))
  }

  const branded = (Object.keys(APP_ENVS) as AppEnvName[]).filter(
    (name) => APP_ENVS[name].label !== null,
  )

  // Regenerate from scratch: a removed registry entry must not leave its
  // directory behind, where nothing would ever notice it again.
  await rm(envRoot, { recursive: true, force: true })

  const browser = await chromium.launch()
  const lock: Record<string, { hue: number; hex: string }> = {}

  try {
    for (const name of branded) {
      const { hue } = APP_ENVS[name]
      const hex = oklchToHex(ACCENT_L, ACCENT_C, hue)
      const outDir = resolve(envRoot, name)
      await mkdir(outDir, { recursive: true })

      const tinted = new Map<string, string>()
      for (const [file, svg] of sources) {
        const recoloured = svg.replaceAll(PRODUCTION_FILL, hex)
        if (recoloured === svg) {
          throw new Error(`${file} no longer contains ${PRODUCTION_FILL}; update PRODUCTION_FILL`)
        }
        tinted.set(file, recoloured)
        await writeFile(resolve(outDir, file), recoloured, 'utf8')
      }

      for (const { out, source, size } of RASTERS) {
        await writeFile(resolve(outDir, out), await rasterise(browser, tinted.get(source)!, size))
      }

      const favicon = await rasterise(browser, tinted.get('favicon.svg')!, 32)
      await writeFile(resolve(outDir, 'favicon.ico'), wrapPngInIco(favicon, 32))

      lock[name] = { hue, hex }
      console.log(
        `${name.padEnd(8)} hue ${String(hue).padStart(3)}  ${hex}  -> public/env/${name}/`,
      )
    }
  } finally {
    await browser.close()
  }

  await writeFile(lockFile, `${JSON.stringify(lock, null, 2)}\n`, 'utf8')
  console.log(`\nWrote icons.lock.json. Commit public/env/** and icons.lock.json together.`)
}

await main()
