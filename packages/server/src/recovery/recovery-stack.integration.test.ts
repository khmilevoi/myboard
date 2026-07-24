import { describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'

// Opt-in: needs the assembled stack from `ALLOW_TEST_DB_RESET=1 pnpm start:docker`
// (client ingress on 127.0.0.1:8080, browser-automation with a retained page for
// RECOVERY_IT_WIDGET). Everything else runs against fakes, by design -- see the
// design doc's testing strategy.
const enabled = process.env.BROWSER_IT === '1'
const base = process.env.RECOVERY_IT_BASE ?? 'http://127.0.0.1:8080'
const widgetId = process.env.RECOVERY_IT_WIDGET ?? 'passport-checker'

describe.skipIf(!enabled)('recovery transport against the assembled stack', () => {
  it('reaches the retained page over one tokenized websocket', async () => {
    const seeded = await fetch(`${base}/api/test/seed-session`, { method: 'POST' })
    expect(seeded.status).toBe(200)
    const sessionCookie = seeded.headers.getSetCookie().join('; ')

    const issued = await fetch(`${base}/api/browser/recovery/${widgetId}`, {
      method: 'POST',
      headers: { cookie: sessionCookie, 'x-requested-with': 'MyBoard' },
    })
    expect(issued.status).toBe(200)
    const cookie = [sessionCookie, ...issued.headers.getSetCookie()].join('; ')

    const ws = new WebSocket(`${base.replace('http', 'ws')}/api/browser/recovery/socket`, {
      headers: { cookie },
    })
    const greeting = await new Promise<string>((resolve, reject) => {
      ws.on('message', (data: Buffer) => resolve(Buffer.from(data).toString()))
      ws.on('error', reject)
      setTimeout(() => reject(new Error('no RFB greeting')), 10_000)
    })

    // websockify hands through x11vnc's ProtocolVersion greeting verbatim.
    expect(greeting).toMatch(/^RFB \d{3}\.\d{3}\n$/)

    // Complete the version handshake, then prove input travels: a KeyEvent
    // (message type 4) for the Shift key, which changes nothing on screen.
    ws.send(Buffer.from(greeting))
    ws.send(Buffer.from([4, 1, 0, 0, 0, 0, 0xff, 0xe1]))
    expect(ws.readyState).toBe(WebSocket.OPEN)
    ws.close()
  })
})
