import { describe, expect, it } from 'vitest'

import { ENV_ICON_FILES, envIconPath, envTitle } from './icons'

describe('envIconPath', () => {
  it('keeps the root paths for production', () => {
    expect(envIconPath('production', 'favicon.svg')).toBe('/favicon.svg')
    expect(envIconPath('production', 'pwa-icon-192.png')).toBe('/pwa-icon-192.png')
  })

  it('gives each branded environment its own directory', () => {
    expect(envIconPath('dev', 'favicon.svg')).toBe('/env/dev/favicon.svg')
    expect(envIconPath('branch', 'apple-touch-icon.png')).toBe('/env/branch/apple-touch-icon.png')
    expect(envIconPath('local', 'pwa-icon.png')).toBe('/env/local/pwa-icon.png')
  })
})

describe('envTitle', () => {
  it('leaves production unsuffixed', () => {
    expect(envTitle('myboard', 'production')).toBe('myboard')
  })

  it('appends the label with the document-title separator', () => {
    expect(envTitle('myboard', 'dev')).toBe('myboard · dev')
    expect(envTitle('myboard — активация', 'branch')).toBe('myboard — активация · branch')
  })

  it('accepts an override separator for the PWA manifest name', () => {
    expect(envTitle('myboard', 'dev', ' ')).toBe('myboard dev')
  })
})

describe('ENV_ICON_FILES', () => {
  it('lists every file an environment ships, once', () => {
    expect([...ENV_ICON_FILES]).toEqual([
      'favicon.svg',
      'favicon.ico',
      'apple-touch-icon.png',
      'pwa-icon.svg',
      'pwa-icon.png',
      'pwa-icon-192.png',
      'pwa-icon-maskable.svg',
      'pwa-icon-maskable.png',
    ])
    expect(new Set(ENV_ICON_FILES).size).toBe(ENV_ICON_FILES.length)
  })
})
