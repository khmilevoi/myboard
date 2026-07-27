import { action, atom, wrap } from '@reatom/core'
import * as errore from 'errore'

import type { RecoveryTransport } from './recovery-transport'
import type { MakeRfb } from './rfb'

export type RecoveryState =
  | { kind: 'issuing' }
  | { kind: 'connecting'; expiresInMs: number }
  | { kind: 'connected'; expiresInMs: number }
  | { kind: 'disconnected' }
  | { kind: 'expired' }
  | { kind: 'unavailable' }
  | { kind: 'busy' }
  | { kind: 'automationDown' }

export const RECOVERY_TICK_MS = 500

export function recoverySocketUrl(loc: { protocol: string; host: string }): string {
  const scheme = loc.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${scheme}//${loc.host}/api/browser/recovery/socket`
}

export type MakeRecoveryModelOptions = {
  widgetId: string
  transport: RecoveryTransport
  makeRfb: MakeRfb
  nowMs?: () => number
  location?: { protocol: string; host: string }
}

export type RecoveryModel = ReturnType<typeof makeRecoveryModel>

export function makeRecoveryModel({
  widgetId,
  transport,
  makeRfb,
  nowMs = () => Date.now(),
  location: loc,
}: MakeRecoveryModelOptions) {
  const state = atom<RecoveryState>({ kind: 'issuing' }, 'passportRecovery.state')
  const remainingMs = atom(0, 'passportRecovery.remainingMs')

  // Non-reactive handle for the live RFB + countdown pair. dispose is
  // idempotent, so teardown runs exactly once per connection no matter how
  // many paths (unmount, retry, expiry, supersede) race to it.
  let session: { dispose: () => void } | null = null
  let attempt = 0

  const disposeSession = () => {
    session?.dispose()
    session = null
  }

  const start = action(async (target: HTMLElement) => {
    attempt += 1
    const current = attempt
    disposeSession()
    state.set({ kind: 'issuing' })
    remainingMs.set(0)

    // Frame-bound continuations, created before the first await (repo wrap
    // rules — post-await writes would otherwise hit the global context).
    const isStale = wrap(() => current !== attempt)
    const setState = wrap((next: RecoveryState) => state.set(next))
    const tick = wrap((left: number) => {
      remainingMs.set(left)
      if (left > 0) return
      disposeSession()
      state.set({ kind: 'expired' })
    })
    const dropConnection = wrap(() => {
      disposeSession()
      state.set({ kind: 'disconnected' })
      remainingMs.set(0)
    })

    const issued = await transport.issue(widgetId)
    if (isStale()) return
    if (issued instanceof Error) {
      if (issued.code === 'recovery_busy') return setState({ kind: 'busy' })
      if (issued.code === 'recovery_unavailable') return setState({ kind: 'unavailable' })
      console.warn('recovery issue failed:', issued.message)
      return setState({ kind: 'automationDown' })
    }

    setState({ kind: 'connecting', expiresInMs: issued.expiresInMs })
    tick(issued.expiresInMs)

    const rfb = makeRfb(target, recoverySocketUrl(loc ?? window.location))
    const expiresAt = nowMs() + issued.expiresInMs

    const onConnect = () => {
      if (current !== attempt) return
      setState({ kind: 'connected', expiresInMs: issued.expiresInMs })
    }
    const onDisconnect = () => {
      if (current !== attempt) return
      dropConnection()
    }
    const onSecurityFailure = (event: Event) => {
      if (current !== attempt) return
      console.warn('recovery RFB security failure:', event)
      dropConnection()
    }
    rfb.addEventListener('connect', onConnect)
    rfb.addEventListener('disconnect', onDisconnect)
    rfb.addEventListener('securityfailure', onSecurityFailure)

    const timer = setInterval(() => {
      if (current !== attempt) return
      tick(Math.max(0, expiresAt - nowMs()))
    }, RECOVERY_TICK_MS)

    let disposed = false
    const dispose = () => {
      if (disposed) return
      disposed = true
      clearInterval(timer)
      // Listeners come off before disconnect() so the RFB's own disconnect
      // event cannot re-enter the state machine during teardown.
      rfb.removeEventListener('connect', onConnect)
      rfb.removeEventListener('disconnect', onDisconnect)
      rfb.removeEventListener('securityfailure', onSecurityFailure)
      const result = errore.try({
        try: () => rfb.disconnect(),
        catch: (cause) => new Error('rfb disconnect failed', { cause }),
      })
      if (result instanceof Error) console.warn(result.message)
    }

    // makeRfb/setInterval above run synchronously (no await between them and
    // the last isStale() check), but teardown() or a superseding start() may
    // still have landed in that window. Re-check here so a just-built
    // RFB/interval is disposed immediately instead of being handed to
    // `session`, where nothing would ever call dispose() again.
    if (isStale()) {
      dispose()
      return
    }
    session = { dispose }
  }, 'passportRecovery.start')

  const teardown = action(() => {
    // Bump `attempt` first so a start() awaiting transport.issue() sees
    // isStale() === true when it resumes and never constructs a real RFB
    // against a target that's already unmounted. Without this, disposeSession()
    // below is a no-op during the `issuing` window (session is still null —
    // it's only assigned at the very end of start()), so the pending POST
    // resolves later into an orphaned RFB + interval that nothing ever disposes.
    attempt += 1
    disposeSession()
  }, 'passportRecovery.teardown')

  return { state, remainingMs, start, teardown }
}
