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

import { formatDateShort } from '../ui/format'
import { ofeliaCommentsModel } from './ofelia-comments'
import type { CommentView } from './ofelia-comments'

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
  it('orders comments oldest-first and exposes only view fields', () => {
    const model = ofeliaCommentsModel({ storage: createStorage(), ...makeDeps() })

    model.comments.set([
      cm({ id: 'b', ts: 3, author: 'Карина', text: 'third' }),
      cm({ id: 'a', ts: 1, author: 'Леша', text: 'first' }),
      cm({ id: 'c', ts: 2, author: 'Леша', text: 'second' }),
    ])

    const thread = model.commentThread()

    expect(thread.map((entry) => entry.id)).toEqual(['a', 'c', 'b'])

    const first: CommentView | undefined = thread[0]
    expect(first).toEqual({
      id: 'a',
      author: 'Леша',
      authorName: 'Леша',
      date: formatDateShort(1),
      text: 'first',
    })
    expect(first).not.toHaveProperty('ts')
  })

  it('maps authorName and date from raw comments', () => {
    const model = ofeliaCommentsModel({ storage: createStorage(), ...makeDeps() })

    const ts = new Date(2026, 5, 10, 12, 0, 0).getTime()

    model.comments.set([cm({ id: 'c1', ts, author: 'Карина', text: 'hi' })])

    const [entry] = model.commentThread()

    expect(entry?.authorName).toBe('Карина')
    expect(entry?.date).toBe('10 июн')
  })

  it('prefers the authoring account name over the legacy signature', () => {
    const model = ofeliaCommentsModel({ storage: createStorage(), ...makeDeps() })

    model.comments.set([
      cm({ id: 'c1', author: undefined, createdBy: { accountId: 'acc-1', name: 'Карина' } }),
    ])

    const [entry] = model.commentThread()

    expect(entry?.authorName).toBe('Карина')
    expect(entry).not.toHaveProperty('author')
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
