import { atom, context } from '@reatom/core'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { WidgetStorage } from '@/storage/model/storage'
import type { StorageApi, StorageListener } from '@/storage/model/types'

import { formatDateShort } from '../ui/format'
import { commentsKey, ofeliaCommentsModel } from './ofelia-comments'
import type { Comment, CommentView } from './ofelia-comments'
import { IP_TAIL_LENGTH } from './ofelia-duty'
import type { Person } from './ofelia-duty'

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

function makeDeps(weekStart: Temporal.PlainDate | null = D('2026-06-15'), user: Person = 'Леша') {
  return {
    viewWeekStart: atom<Temporal.PlainDate | null>(weekStart, 'test.viewWeekStart'),
    currentUser: atom<Person>(user, 'test.currentUser'),
  }
}

const cm = (overrides: Partial<Comment> = {}): Comment => ({
  id: 'comment-1',
  ts: 1,
  ip: '127.0.0.1',
  author: 'Леша',
  text: 'hello',
  ...overrides,
})

afterEach(() => {
  context.reset()
})

describe('commentsKey', () => {
  it('keys by the Monday of the week', () => {
    expect(commentsKey(D('2026-06-16'))).toBe('comments:2026-06-15')
    expect(commentsKey(D('2026-06-21'))).toBe('comments:2026-06-15')
    expect(commentsKey(D('2026-06-22'))).toBe('comments:2026-06-22')
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

      await vi.waitFor(() =>
        expect(subscribe).toHaveBeenCalledWith(
          'comments:2026-06-15',
          expect.any(Function),
          expect.anything(),
        ),
      )

      emit('comments:2026-06-15', [cm({ id: 'c1', text: 'hi' })])

      await vi.waitFor(() => expect(model.comments()).toHaveLength(1))
      expect(model.comments()[0]?.text).toBe('hi')

      off()
    })
  })

  it('re-subscribes to the new week and drops the old subscription', async () => {
    const { storage, subscribe, calls } = createCommentsStorage()
    const deps = makeDeps(D('2026-06-15'))
    const model = ofeliaCommentsModel({ storage, ...deps })

    await context.start(async () => {
      const off = model.comments.subscribe(() => {})

      await vi.waitFor(() =>
        expect(subscribe).toHaveBeenCalledWith(
          'comments:2026-06-15',
          expect.any(Function),
          expect.anything(),
        ),
      )

      deps.viewWeekStart.set(D('2026-06-22'))

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

      await vi.waitFor(() => expect(model.comments()).toEqual([]))
      expect(subscribe).not.toHaveBeenCalled()

      deps.viewWeekStart.set(D('2026-06-15'))

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
      ipTail: '127.0.0.1'.slice(-IP_TAIL_LENGTH),
      text: 'first',
    })
    expect(first).not.toHaveProperty('ts')
    expect(first).not.toHaveProperty('ip')
  })

  it('maps authorName, date, and ipTail from raw comments', () => {
    const model = ofeliaCommentsModel({ storage: createStorage(), ...makeDeps() })

    const ip = '203.0.113.55'
    const ts = new Date(2026, 5, 10, 12, 0, 0).getTime()

    model.comments.set([cm({ id: 'c1', ts, ip, author: 'Карина', text: 'hi' })])

    const [entry] = model.commentThread()

    expect(entry?.authorName).toBe('Карина')
    expect(entry?.date).toBe('10 июн')
    expect(entry?.ipTail).toBe(ip.slice(-IP_TAIL_LENGTH))
    expect(entry?.ipTail).toBe('13.55')
  })

  it('uses an empty ipTail when the raw comment has no ip', () => {
    const model = ofeliaCommentsModel({ storage: createStorage(), ...makeDeps() })

    model.comments.set([cm({ id: 'c1', ip: undefined })])

    const [entry] = model.commentThread()

    expect(entry?.ipTail).toBe('')
  })
})

describe('ofeliaCommentsModel.send', () => {
  it('appends a trimmed comment authored by the current user to the viewed week', async () => {
    const storage = createStorage()
    const model = ofeliaCommentsModel({ storage, ...makeDeps(D('2026-06-15'), 'Карина') })

    await model.send('  Привет  ')

    expect(storage.shared.server.append).toHaveBeenCalledWith('comments:2026-06-15', {
      author: 'Карина',
      text: 'Привет',
    })
  })

  it('ignores empty or whitespace-only text', async () => {
    const storage = createStorage()
    const model = ofeliaCommentsModel({ storage, ...makeDeps(D('2026-06-15')) })

    await model.send('   ')

    expect(storage.shared.server.append).not.toHaveBeenCalled()
  })

  it('is a no-op before the first sync (no viewed week)', async () => {
    const storage = createStorage()
    const model = ofeliaCommentsModel({ storage, ...makeDeps(null) })

    await model.send('hello')

    expect(storage.shared.server.append).not.toHaveBeenCalled()
  })

  it('writes to the currently viewed week after navigation', async () => {
    const storage = createStorage()
    const deps = makeDeps(D('2026-06-15'), 'Леша')
    const model = ofeliaCommentsModel({ storage, ...deps })

    deps.viewWeekStart.set(D('2026-06-22'))
    await model.send('next week note')

    expect(storage.shared.server.append).toHaveBeenCalledWith('comments:2026-06-22', {
      author: 'Леша',
      text: 'next week note',
    })
  })
})
