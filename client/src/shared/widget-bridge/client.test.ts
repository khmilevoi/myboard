// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { createWidgetClient } from './client'
import { HandshakeTimeoutError } from './errors'
import type { ResolvedTheme } from '../theme/types'
import type { WidgetMessage } from './messages'

function sendInit(instanceId: string, mode: 'small' | 'large', theme: ResolvedTheme = 'light') {
  const channel = new MessageChannel()
  const received: WidgetMessage[] = []
  channel.port1.onmessage = (e) => received.push(e.data as WidgetMessage)
  channel.port1.start()
  window.dispatchEvent(
    new MessageEvent('message', {
      data: { type: 'init', instanceId, mode, theme },
      ports: [channel.port2],
    }),
  )
  return { hostPort: channel.port1, received }
}

describe('createWidgetClient', () => {
  it('resolves with instanceId, mode and theme from init and replies ready', async () => {
    const clientPromise = createWidgetClient()
    const { received } = sendInit('inst-1', 'small', 'dark')

    const client = await clientPromise
    if (client instanceof Error) throw client

    expect(client.instanceId).toBe('inst-1')
    expect(client.mode).toBe('small')
    expect(client.theme).toBe('dark')
    await vi.waitFor(() => expect(received).toContainEqual({ type: 'ready', instanceId: 'inst-1' }))
  })

  it('requestFullscreen posts a request-fullscreen message over the port', async () => {
    const clientPromise = createWidgetClient()
    const { received } = sendInit('inst-2', 'small')
    const client = await clientPromise
    if (client instanceof Error) throw client

    client.requestFullscreen()
    await vi.waitFor(() =>
      expect(received).toContainEqual({ type: 'request-fullscreen', instanceId: 'inst-2' }),
    )
  })

  it('notifies onThemeChange subscribers when the host pushes a theme-change', async () => {
    const clientPromise = createWidgetClient()
    const { hostPort } = sendInit('inst-3', 'small', 'light')
    const client = await clientPromise
    if (client instanceof Error) throw client

    const seen: ResolvedTheme[] = []
    client.onThemeChange((theme) => seen.push(theme))
    hostPort.postMessage({ type: 'theme-change', theme: 'dark' })

    await vi.waitFor(() => expect(seen).toContain('dark'))
  })

  it('times out when no init arrives', async () => {
    const result = await createWidgetClient({ timeoutMs: 20 })
    expect(result).toBeInstanceOf(HandshakeTimeoutError)
  })
})
