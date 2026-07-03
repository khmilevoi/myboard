import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  copyWidgetBuilds,
  MissingWidgetBuildError,
  WidgetAssetsIoError,
} from './widget-build-assets'

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'widget-build-assets-'))
  const widgetsDir = join(root, 'widgets')
  const outDir = join(root, 'client-dist')

  mkdirSync(join(widgetsDir, 'clock', 'dist', 'assets'), { recursive: true })
  mkdirSync(join(widgetsDir, 'ofelia-poop-duty', 'dist'), { recursive: true })
  writeFileSync(join(widgetsDir, 'clock', 'package.json'), '{}')
  writeFileSync(join(widgetsDir, 'ofelia-poop-duty', 'package.json'), '{}')
  writeFileSync(join(widgetsDir, 'clock', 'dist', 'remoteEntry.js'), 'clock-entry')
  writeFileSync(join(widgetsDir, 'clock', 'dist', 'assets', 'clock.js'), 'clock-chunk')
  writeFileSync(join(widgetsDir, 'ofelia-poop-duty', 'dist', 'remoteEntry.js'), 'ofelia-entry')

  return { root, widgetsDir, outDir }
}

describe('copyWidgetBuilds', () => {
  it('copies every complete widget dist tree and removes stale staged files', () => {
    const { widgetsDir, outDir } = fixture()
    mkdirSync(join(outDir, 'widgets', 'removed-widget'), { recursive: true })
    writeFileSync(join(outDir, 'widgets', 'removed-widget', 'remoteEntry.js'), 'stale')

    const result = copyWidgetBuilds({ widgetsDir, outDir })

    expect(result).toEqual(['clock', 'ofelia-poop-duty'])
    expect(readFileSync(join(outDir, 'widgets', 'clock', 'remoteEntry.js'), 'utf8')).toBe(
      'clock-entry',
    )
    expect(readFileSync(join(outDir, 'widgets', 'clock', 'assets', 'clock.js'), 'utf8')).toBe(
      'clock-chunk',
    )
    expect(() =>
      readFileSync(join(outDir, 'widgets', 'removed-widget', 'remoteEntry.js'), 'utf8'),
    ).toThrow()
  })

  it('returns a tagged error when the widgets directory cannot be read', () => {
    const { root, outDir } = fixture()

    expect(copyWidgetBuilds({ widgetsDir: join(root, 'missing-widgets'), outDir })).toBeInstanceOf(
      WidgetAssetsIoError,
    )
  })

  it('returns a tagged error when a discovered widget has not been built', () => {
    const { widgetsDir, outDir } = fixture()
    mkdirSync(join(widgetsDir, 'missing'), { recursive: true })
    writeFileSync(join(widgetsDir, 'missing', 'package.json'), '{}')

    const result = copyWidgetBuilds({ widgetsDir, outDir })

    expect(result).toBeInstanceOf(MissingWidgetBuildError)
    expect(result).toMatchObject({ widgetId: 'missing' })
  })
})
