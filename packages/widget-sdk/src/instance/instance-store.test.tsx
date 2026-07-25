import { reatomComponent } from '@reatom/react'
import { render, screen, waitFor } from '@testing-library/react'

import { makeWidgetInstanceStore } from './instance-store'

type Value = { id: number }

/** Disconnection is not synchronous with unmount; let Reatom's queue drain. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 50))

function setup() {
  let built = 0
  const disposed: Array<[Value, string]> = []
  const store = makeWidgetInstanceStore<Value>({
    name: 'probe.instance',
    dispose: (value, key) => disposed.push([value, key]),
  })
  const make = () => {
    built += 1
    return { id: built }
  }

  const Probe = reatomComponent(
    ({ instanceKey, testId }: { instanceKey: string; testId: string }) => (
      <span data-testid={testId}>{store(instanceKey, make)().id}</span>
    ),
    'Probe',
  )

  return { store, make, Probe, stats: () => ({ built, disposed }) }
}

describe('makeWidgetInstanceStore', () => {
  it('returns the same atom for the same key and builds the value once', () => {
    const { store, make } = setup()

    expect(store('a', make)).toBe(store('a', make))
    expect(store('a', make)).not.toBe(store('b', make))
  })

  it('never shares a key between two stores', () => {
    const one = makeWidgetInstanceStore<Value>({ name: 'one' })
    const other = makeWidgetInstanceStore<Value>({ name: 'other' })

    expect(one('same', () => ({ id: 1 }))).not.toBe(other('same', () => ({ id: 2 })))
  })

  it('gives both mounts of one key the same value', () => {
    const { Probe, stats } = setup()

    render(
      <>
        <Probe instanceKey="a" testId="one" />
        <Probe instanceKey="a" testId="two" />
      </>,
    )

    expect(screen.getByTestId('one')).toHaveTextContent('1')
    expect(screen.getByTestId('two')).toHaveTextContent('1')
    expect(stats().built).toBe(1)
  })

  it('disposes only after the last mount is gone', async () => {
    const { Probe, stats } = setup()

    const view = render(
      <>
        <Probe instanceKey="a" testId="one" />
        <Probe instanceKey="a" testId="two" />
      </>,
    )

    view.rerender(
      <>
        <Probe instanceKey="a" testId="one" />
      </>,
    )
    await settle()
    expect(stats().disposed).toEqual([])

    view.unmount()
    await settle()
    expect(stats().disposed).toEqual([[{ id: 1 }, 'a']])
  })

  it('builds a fresh value on the next mount instead of resurrecting the disposed one', async () => {
    const { Probe, stats } = setup()

    const first = render(<Probe instanceKey="a" testId="one" />)
    first.unmount()
    await settle()

    render(<Probe instanceKey="a" testId="two" />)
    await waitFor(() => expect(screen.getByTestId('two')).toBeInTheDocument())

    // A computed's cache survives disconnection, so this only holds because the
    // disconnect hook drops the handle and the next read builds a new atom.
    expect(screen.getByTestId('two')).toHaveTextContent('2')
    expect(stats().built).toBe(2)
  })

  it('does not dispose a value that a same-tick resubscribe is still holding onto', async () => {
    const { store, make, stats } = setup()

    const handle = store('a', make)
    const unsubscribeFirst = handle.subscribe(() => {})
    await settle()
    expect(stats().built).toBe(1)

    // Unsubscribe and resubscribe the SAME key before the deferred disconnect
    // cleanup ever runs, in one synchronous flush — this is what React
    // StrictMode's double-invoked effects (and any same-commit unmount +
    // remount) do on every widget mount.
    unsubscribeFirst()
    const unsubscribeSecond = store('a', make).subscribe(() => {})
    await settle()

    // The value the still-connected second subscriber holds must survive,
    // and the map entry must still point at the live handle.
    expect(stats().disposed).toEqual([])
    expect(store('a', make)).toBe(handle)

    unsubscribeSecond()
    await settle()
    expect(stats().disposed).toEqual([[{ id: 1 }, 'a']])
  })

  it('disposes a value read outside any subscription instead of leaking it forever', async () => {
    const { store, make, stats } = setup()

    // A bare read with no component ever mounting: nothing ever subscribes.
    const handle = store('a', make)
    handle()

    await settle()

    expect(stats().built).toBe(1)
    expect(stats().disposed).toEqual([[{ id: 1 }, 'a']])

    // The evicted handle must not be handed out again — a later lookup for
    // the same key builds a fresh value instead of resurrecting the leaked
    // one.
    const next = store('a', make)
    expect(next).not.toBe(handle)
    expect(next()).toEqual({ id: 2 })
  })

  it('does not let a stale reconnect of an already-disposed handle poison future lookups', async () => {
    const { store, make, stats } = setup()

    const handle = store('a', make)
    const unsubscribeFirst = handle.subscribe(() => {})
    await settle()
    expect(stats().built).toBe(1)

    unsubscribeFirst()
    await settle()
    expect(stats().disposed).toEqual([[{ id: 1 }, 'a']])

    // A stale reference to the now-disposed handle gets reconnected directly
    // (e.g. a Suspense boundary re-showing without the component ever going
    // back through `store()`), bypassing the map entirely.
    const staleResubscribe = handle.subscribe(() => {})

    // A brand-new lookup for the same key must not observe that stale
    // reconnection — it gets its own fresh handle and value.
    const fresh = store('a', make)
    expect(fresh).not.toBe(handle)
    expect(fresh()).not.toEqual(handle())

    staleResubscribe()
    await settle()
  })
})
