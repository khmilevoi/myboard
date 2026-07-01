import { readFileSync } from 'node:fs'

export type WidgetPorts = Record<string, number>

type WidgetRemotesOptions = {
  command: 'build' | 'serve'
  portsFile: string
}

function readWidgetPorts(portsFile: string): WidgetPorts {
  return JSON.parse(readFileSync(portsFile, 'utf8')) as WidgetPorts
}

export function readWidgetPort(id: string, portsFile: string) {
  const port = readWidgetPorts(portsFile)[id]
  if (port == null) throw new Error(`Unknown widget port for ${id}`)
  return port
}

export function widgetRemotes({ command, portsFile }: WidgetRemotesOptions) {
  const ports = readWidgetPorts(portsFile)

  return Object.fromEntries(
    Object.entries(ports).map(([id, port]) => [
      id,
      {
        type: 'module',
        name: id,
        entry:
          command === 'build'
            ? `/widgets/${id}/remoteEntry.js`
            : `http://localhost:${port}/remoteEntry.js`,
        entryGlobalName: id,
      },
    ]),
  )
}

export function previewWidgetsProxy(portsFile: string) {
  const ports = readWidgetPorts(portsFile)

  return Object.fromEntries(
    Object.entries(ports).map(([id, port]) => [
      `/widgets/${id}`,
      {
        target: `http://localhost:${port}`,
        changeOrigin: false,
      },
    ]),
  )
}
