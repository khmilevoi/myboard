import { describe, expect, it } from 'vitest'

import { makeRecoveryCapabilityStore, RecoveryCapabilityError } from './capability'

function makeStore(startMs = 1_000) {
  let nowMs = startMs
  const store = makeRecoveryCapabilityStore({ now: () => nowMs, tokenTtlMs: 60_000 })
  return { store, advance: (ms: number) => (nowMs += ms) }
}

describe('makeRecoveryCapabilityStore', () => {
  it('issues a token that can be consumed exactly once', () => {
    const { store } = makeStore()
    const { token, expiresInMs } = store.issue({ widgetId: 'passport-checker', sessionId: 's-1' })

    expect(expiresInMs).toBe(60_000)
    expect(store.consume({ token, sessionId: 's-1' })).toEqual({ widgetId: 'passport-checker' })
    expect(store.consume({ token, sessionId: 's-1' })).toBeInstanceOf(RecoveryCapabilityError)
  })

  it('rejects a missing, expired, or foreign-session token', () => {
    const { store, advance } = makeStore()

    expect(store.consume({ token: undefined, sessionId: 's-1' })).toBeInstanceOf(
      RecoveryCapabilityError,
    )

    const expired = store.issue({ widgetId: 'passport-checker', sessionId: 's-1' })
    advance(60_001)
    expect(store.consume({ token: expired.token, sessionId: 's-1' })).toBeInstanceOf(
      RecoveryCapabilityError,
    )

    const foreign = store.issue({ widgetId: 'passport-checker', sessionId: 's-1' })
    expect(store.consume({ token: foreign.token, sessionId: 's-2' })).toBeInstanceOf(
      RecoveryCapabilityError,
    )
    // A token seen by another session is treated as compromised, not retryable.
    expect(store.consume({ token: foreign.token, sessionId: 's-1' })).toBeInstanceOf(
      RecoveryCapabilityError,
    )
  })

  it('keeps only the newest token per widget', () => {
    const { store } = makeStore()
    const first = store.issue({ widgetId: 'passport-checker', sessionId: 's-1' })
    const second = store.issue({ widgetId: 'passport-checker', sessionId: 's-1' })

    expect(store.consume({ token: first.token, sessionId: 's-1' })).toBeInstanceOf(
      RecoveryCapabilityError,
    )
    expect(store.consume({ token: second.token, sessionId: 's-1' })).toEqual({
      widgetId: 'passport-checker',
    })
  })

  it('tracks one active connection and revokes it per widget', () => {
    const { store } = makeStore()
    let destroyed = 0
    const connection = { widgetId: 'passport-checker', destroy: () => (destroyed += 1) }

    expect(store.isBusy()).toBe(false)
    store.attach(connection)
    expect(store.isBusy()).toBe(true)

    store.revoke('other-widget')
    expect(destroyed).toBe(0)

    store.revoke('passport-checker')
    expect(destroyed).toBe(1)
    expect(store.isBusy()).toBe(false)
  })

  it('drops every token and connection on revokeAll', () => {
    const { store } = makeStore()
    let destroyed = 0
    const { token } = store.issue({ widgetId: 'passport-checker', sessionId: 's-1' })
    store.attach({ widgetId: 'passport-checker', destroy: () => (destroyed += 1) })

    store.revokeAll()

    expect(destroyed).toBe(1)
    expect(store.isBusy()).toBe(false)
    expect(store.consume({ token, sessionId: 's-1' })).toBeInstanceOf(RecoveryCapabilityError)
  })

  it('detaches only the connection that is still active', () => {
    const { store } = makeStore()
    const first = { widgetId: 'a', destroy: () => {} }
    const second = { widgetId: 'b', destroy: () => {} }

    store.attach(first)
    store.detach(second)
    expect(store.isBusy()).toBe(true)

    store.detach(first)
    expect(store.isBusy()).toBe(false)
  })
})
