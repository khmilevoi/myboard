import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { previewWidgetsProxy, readWidgetPort, widgetRemotes } from './widget-remotes'

function portsFileWith(json: Record<string, number>) {
  const dir = mkdtempSync(join(tmpdir(), 'ports-'))
  const file = join(dir, '.ports.json')
  writeFileSync(file, JSON.stringify(json))
  return file
}

describe('widget-remotes', () => {
  const file = portsFileWith({ clock: 5180, 'ofelia-poop-duty': 5181 })

  it('reads a widget port', () => {
    expect(readWidgetPort('ofelia-poop-duty', file)).toBe(5181)
  })

  it('serves dev remotes from localhost ports', () => {
    expect(widgetRemotes({ command: 'serve', portsFile: file }).clock).toEqual({
      type: 'module',
      name: 'clock',
      entry: 'http://localhost:5180/remoteEntry.js',
      entryGlobalName: 'clock',
    })
  })

  it('builds prod remotes from same-origin paths', () => {
    expect(widgetRemotes({ command: 'build', portsFile: file }).clock.entry).toBe(
      '/widgets/clock/remoteEntry.js',
    )
  })

  it('maps each widget id to a preview proxy target', () => {
    expect(previewWidgetsProxy(file)['/widgets/ofelia-poop-duty']).toEqual({
      target: 'http://localhost:5181',
      changeOrigin: false,
    })
  })
})
