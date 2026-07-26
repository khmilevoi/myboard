import { atom, context, wrap } from '@reatom/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  makeStaticWidgetIdentity,
  type StorageApi,
  type StorageListener,
  type WidgetStorage,
} from 'widget-runtime'

import { commentsKey } from '@/domain/comments'
import type { Comment } from '@/domain/comments'
import { weekStartISO } from '@/domain/roster'

import { ofeliaCommentsModel } from './ofelia-comments'

function createStorage(overrides: Partial<StorageApi> = {}): WidgetStorage {
  const api: StorageApi = {
    get: vi.fn(async () => null),
    set: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
    has: vi.fn(async () => false),
    keys: vi.fn(async () => []),
    append: vi.fn(async () => undefined),
    subscribe: vi.fn(() => () => {}),
    ...overrides,
  }

  return {
    instance: { client: api, server: api },
    shared: { client: api, server: api },
  }
}

type SubscribeCall = {
  key: string
  listener: StorageListener<Comment[]>
  unsubscribe: ReturnType<typeof vi.fn>
}

function createCommentsStorage() {
  const calls: SubscribeCall[] = []

  const subscribe = vi.fn((key: string, listener: StorageListener<Comment[]>) => {
    const unsubscribe = vi.fn()
    calls.push({ key, listener, unsubscribe })
    return unsubscribe
  }) as unknown as StorageApi['subscribe']

  const storage = createStorage({ subscribe })

  const emit = (key: string, value: Comment[] | null) => {
    for (const call of calls) {
      if (call.key === key) call.listener({ value })
    }
  }

  return { storage, subscribe, calls, emit }
}

const D = (iso: string) => Temporal.PlainDate.from(iso)

const okInvoke = () => vi.fn(async () => ({ ok: true }))

function makeDeps(
  weekStart: Temporal.PlainDate | null = D('2026-06-15'),
  invoke: ReturnType<typeof okInvoke> = okInvoke(),
) {
  return {
    viewWeekStart: atom<Temporal.PlainDate | null>(weekStart, 'test.viewWeekStart'),
    api: { invoke } as never,
    identity: makeStaticWidgetIdentity(),
  }
}

const cm = (overrides: Partial<Comment> = {}): Comment => ({
  id: 'comment-1',
  ts: 1,
  author: 'Леша',
  text: 'hello',
  ...overrides,
})

afterEach(() => {
  context.reset()
})

describe('commentsKey', () => {
  it('keys by the Monday of the week', () => {
    expect(commentsKey(weekStartISO(D('2026-06-16')))).toBe('comments:2026-06-15')
    expect(commentsKey(weekStartISO(D('2026-06-21')))).toBe('comments:2026-06-15')
    expect(commentsKey(weekStartISO(D('2026-06-22')))).toBe('comments:2026-06-22')
  })
})

describe('ofeliaCommentsModel.comments', () => {
  it('defaults to an empty array', () => {
    const model = ofeliaCommentsModel({ storage: createStorage(), ...makeDeps() })

    expect(model.comments()).toEqual([])
  })

  it('subscribes to the viewed week key and reflects emitted comments', async () => {
    const { storage, subscribe, emit } = createCommentsStorage()
    const model = ofeliaCommentsModel({ storage, ...makeDeps(D('2026-06-15')) })

    await context.start(async () => {
      const off = model.comments.subscribe(() => {})
      // Continuations after `await` run outside the started frame; capture
      // frame-bound closures now so later reads hit this context, not the
      // global one.
      const readComments = wrap(() => model.comments())

      await vi.waitFor(() =>
        expect(subscribe).toHaveBeenCalledWith(
          'comments:2026-06-15',
          expect.any(Function),
          expect.anything(),
        ),
      )

      emit('comments:2026-06-15', [cm({ id: 'c1', text: 'hi' })])

      await vi.waitFor(() => expect(readComments()).toHaveLength(1))
      expect(readComments()[0]?.text).toBe('hi')

      off()
    })
  })

  it('re-subscribes to the new week and drops the old subscription', async () => {
    const { storage, subscribe, calls } = createCommentsStorage()
    const deps = makeDeps(D('2026-06-15'))
    const model = ofeliaCommentsModel({ storage, ...deps })

    await context.start(async () => {
      const off = model.comments.subscribe(() => {})
      const setWeek = wrap((week: Temporal.PlainDate) => deps.viewWeekStart.set(week))

      await vi.waitFor(() =>
        expect(subscribe).toHaveBeenCalledWith(
          'comments:2026-06-15',
          expect.any(Function),
          expect.anything(),
        ),
      )

      setWeek(D('2026-06-22'))

      await vi.waitFor(() =>
        expect(subscribe).toHaveBeenCalledWith(
          'comments:2026-06-22',
          expect.any(Function),
          expect.anything(),
        ),
      )
      expect(calls[0]?.unsubscribe).toHaveBeenCalled()

      off()
    })
  })

  it('opens no subscription until a week is available, then subscribes', async () => {
    const { storage, subscribe } = createCommentsStorage()
    const deps = makeDeps(null)
    const model = ofeliaCommentsModel({ storage, ...deps })

    await context.start(async () => {
      const off = model.comments.subscribe(() => {})
      const readComments = wrap(() => model.comments())
      const setWeek = wrap((week: Temporal.PlainDate) => deps.viewWeekStart.set(week))

      await vi.waitFor(() => expect(readComments()).toEqual([]))
      expect(subscribe).not.toHaveBeenCalled()

      setWeek(D('2026-06-15'))

      await vi.waitFor(() =>
        expect(subscribe).toHaveBeenCalledWith(
          'comments:2026-06-15',
          expect.any(Function),
          expect.anything(),
        ),
      )

      off()
    })
  })
})

describe('ofeliaCommentsModel.commentThread', () => {
  it('resolves the author and marks the viewer', async () => {
    const { storage, emit } = createCommentsStorage()
    const model = ofeliaCommentsModel({
      storage,
      viewWeekStart: atom(D('2026-06-15'), 'test.viewWeekStart'),
      api: { invoke: vi.fn(async () => ({ ok: true })) } as never,
      identity: makeStaticWidgetIdentity({
        members: [{ accountId: 'a1', name: 'Карина' }],
        viewerAccountId: 'a1',
      }),
    })

    const off = model.commentThread.subscribe(() => {})
    // The storage connect hook registers via Reatom's effect queue, which
    // flushes on the next microtask (see `_enqueue` in @reatom/core) rather
    // than synchronously inside `.subscribe()`. Without this tick, `emit`
    // would fire before any listener is registered and the value would be
    // lost for good (`emit` does not replay to late subscribers).
    await Promise.resolve()
    emit('comments:2026-06-15', [
      { id: 'c1', ts: 2, text: 'мой', createdBy: { accountId: 'a1', name: 'старое' } },
      { id: 'c2', ts: 1, text: 'старый', author: 'Леша' },
    ])

    await vi.waitFor(() => {
      expect(wrap(() => model.commentThread().length)()).toBe(2)
    })

    const [first, second] = wrap(() => model.commentThread())()
    expect(first).toMatchObject({
      id: 'c2',
      author: { kind: 'person', person: 'Леша' },
      isViewerComment: false,
    })
    expect(second).toMatchObject({
      id: 'c1',
      author: { kind: 'account', name: 'Карина' },
      isViewerComment: true,
    })
    off()
  })
})

describe('ofeliaCommentsModel.send', () => {
  it('invokes the comment event for the viewed week', async () => {
    const invoke = okInvoke()
    const model = ofeliaCommentsModel({
      storage: createStorage(),
      ...makeDeps(D('2026-06-15'), invoke),
    })

    await wrap(() => model.send('  Привет  '))()

    expect(invoke).toHaveBeenCalledWith('comment', {
      weekStart: '2026-06-15',
      text: '  Привет  ',
    })
  })

  it('does not write through storage any more', async () => {
    const storage = createStorage()
    const model = ofeliaCommentsModel({ storage, ...makeDeps(D('2026-06-15')) })

    await wrap(() => model.send('Привет'))()

    expect(storage.shared.server.append).not.toHaveBeenCalled()
  })

  it('ignores empty or whitespace-only text', async () => {
    const invoke = okInvoke()
    const model = ofeliaCommentsModel({
      storage: createStorage(),
      ...makeDeps(D('2026-06-15'), invoke),
    })

    await wrap(() => model.send('   '))()

    expect(invoke).not.toHaveBeenCalled()
  })

  it('is a no-op before the first sync (no viewed week)', async () => {
    const invoke = okInvoke()
    const model = ofeliaCommentsModel({ storage: createStorage(), ...makeDeps(null, invoke) })

    await wrap(() => model.send('hello'))()

    expect(invoke).not.toHaveBeenCalled()
  })

  it('writes to the currently viewed week after navigation', async () => {
    const invoke = okInvoke()
    const deps = makeDeps(D('2026-06-15'), invoke)
    const model = ofeliaCommentsModel({ storage: createStorage(), ...deps })

    deps.viewWeekStart.set(D('2026-06-22'))
    await wrap(() => model.send('next week note'))()

    expect(invoke).toHaveBeenCalledWith('comment', {
      weekStart: '2026-06-22',
      text: 'next week note',
    })
  })
})
