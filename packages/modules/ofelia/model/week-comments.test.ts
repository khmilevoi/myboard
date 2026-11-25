import { atom, context, wrap } from '@reatom/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  makeStaticWidgetIdentity,
  StorageError,
  type StorageApi,
  type StorageListener,
  type WidgetIdentity,
} from 'widget-runtime'
import { createFakeStorage } from 'widget-runtime/storage/test/fakes'
import { createFakeTimer } from 'widget-runtime/timer/fakes'

import type { Comment } from '../domain/comments'
import { makeOfeliaModel, type OfeliaModuleContext } from './ofelia-model'

type SubscribeCall = {
  key: string
  listener: StorageListener<Comment[]>
  unsubscribe: ReturnType<typeof vi.fn>
}

function makeCommentsModel(identity: WidgetIdentity = makeStaticWidgetIdentity()) {
  const calls: SubscribeCall[] = []
  const subscribe = vi.fn((key: string, listener: StorageListener<Comment[]>) => {
    const unsubscribe = vi.fn()
    calls.push({ key, listener, unsubscribe })
    return unsubscribe
  }) as unknown as StorageApi['subscribe']
  const api: StorageApi = { ...createFakeStorage(), subscribe }

  const model = makeOfeliaModel({
    moduleId: 'ofelia',
    storage: { shared: { client: api, server: api } },
    api: { invoke: vi.fn(async () => ({ ok: true })) } as OfeliaModuleContext['api'],
    timer: createFakeTimer(),
    identity,
  })

  const emit = (key: string, value: Comment[] | null) => {
    for (const call of calls) {
      if (call.key === key) call.listener({ value })
    }
  }

  return { model, subscribe, calls, emit }
}

const D = (iso: string) => Temporal.PlainDate.from(iso)
const weekAtom = (iso: string | null) =>
  atom<Temporal.PlainDate | null>(iso === null ? null : D(iso), 'test.week')

const cm = (overrides: Partial<Comment> = {}): Comment => ({
  id: 'comment-1',
  ts: 1,
  author: 'Леша',
  text: 'hello',
  ...overrides,
})

const subscribedTo = (subscribe: StorageApi['subscribe'], key: string) =>
  expect(subscribe).toHaveBeenCalledWith(key, expect.any(Function), expect.anything())

afterEach(() => {
  context.reset()
})

describe('weekComments.comments', () => {
  it('defaults to an empty array', () => {
    const { model } = makeCommentsModel()

    expect(model.weekComments(weekAtom('2026-06-15')).comments()).toEqual([])
  })

  it('opens no subscription until a week is available, then subscribes', async () => {
    const { model, subscribe } = makeCommentsModel()
    const week = weekAtom(null)
    const view = model.weekComments(week)

    await context.start(async () => {
      const off = view.comments.subscribe(() => {})
      const readComments = wrap(() => view.comments())
      const setWeek = wrap((next: Temporal.PlainDate) => week.set(next))

      await vi.waitFor(() => expect(readComments()).toEqual([]))
      expect(subscribe).not.toHaveBeenCalled()

      setWeek(D('2026-06-15'))
      await vi.waitFor(() => subscribedTo(subscribe, 'duty/comments:2026-06-15'))

      off()
    })
  })

  it('re-subscribes to the new week and drops the old subscription', async () => {
    const { model, subscribe, calls } = makeCommentsModel()
    const week = weekAtom('2026-06-15')
    const view = model.weekComments(week)

    await context.start(async () => {
      const off = view.comments.subscribe(() => {})
      const setWeek = wrap((next: Temporal.PlainDate) => week.set(next))

      await vi.waitFor(() => subscribedTo(subscribe, 'duty/comments:2026-06-15'))
      setWeek(D('2026-06-22'))
      await vi.waitFor(() => subscribedTo(subscribe, 'duty/comments:2026-06-22'))
      expect(calls[0]?.unsubscribe).toHaveBeenCalled()

      off()
    })
  })

  it('follows each view’s own week atom independently', async () => {
    const { model, subscribe, emit } = makeCommentsModel()
    const weekA = weekAtom('2026-06-15')
    const weekB = weekAtom('2026-06-22')
    const a = model.weekComments(weekA)
    const b = model.weekComments(weekB)

    await context.start(async () => {
      const offs = [a.commentThread.subscribe(() => {}), b.commentThread.subscribe(() => {})]
      const readA = wrap(() => a.commentThread().map((comment) => comment.text))
      const readB = wrap(() => b.commentThread().map((comment) => comment.text))
      const setWeekA = wrap((next: Temporal.PlainDate) => weekA.set(next))

      await vi.waitFor(() => subscribedTo(subscribe, 'duty/comments:2026-06-15'))
      await vi.waitFor(() => subscribedTo(subscribe, 'duty/comments:2026-06-22'))
      emit('duty/comments:2026-06-15', [cm({ id: 'a1', text: 'week one' })])
      emit('duty/comments:2026-06-22', [cm({ id: 'b1', text: 'week two' })])

      await vi.waitFor(() => expect(readA()).toEqual(['week one']))
      await vi.waitFor(() => expect(readB()).toEqual(['week two']))

      setWeekA(D('2026-06-29'))
      await vi.waitFor(() => subscribedTo(subscribe, 'duty/comments:2026-06-29'))
      emit('duty/comments:2026-06-29', [cm({ id: 'a2', text: 'week three' })])

      await vi.waitFor(() => expect(readA()).toEqual(['week three']))
      expect(readB()).toEqual(['week two'])

      for (const off of offs) off()
    })
  })
})

describe('weekComments.commentThread', () => {
  it('resolves the author and marks the viewer', async () => {
    const { model, subscribe, emit } = makeCommentsModel(
      makeStaticWidgetIdentity({
        members: [{ accountId: 'a1', name: 'Карина' }],
        viewerAccountId: 'a1',
      }),
    )
    const view = model.weekComments(weekAtom('2026-06-15'))

    await context.start(async () => {
      const off = view.commentThread.subscribe(() => {})
      const readThread = wrap(() => view.commentThread())

      await vi.waitFor(() => subscribedTo(subscribe, 'duty/comments:2026-06-15'))
      emit('duty/comments:2026-06-15', [
        { id: 'c1', ts: 2, text: 'мой', createdBy: { accountId: 'a1', name: 'старое' } },
        { id: 'c2', ts: 1, text: 'старый', author: 'Леша' },
      ])

      await vi.waitFor(() => expect(readThread()).toHaveLength(2))
      const [first, second] = readThread()
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

  // F14: a failed read for a newly viewed week must not keep showing the
  // previous week's rows; it blocks the thread and never warns at the same time.
  it('blocks, never warns, when the new week read fails', async () => {
    const { model, subscribe, calls, emit } = makeCommentsModel()
    const week = weekAtom('2026-06-15')
    const view = model.weekComments(week)

    await context.start(async () => {
      const off = view.commentThread.subscribe(() => {})
      const readThread = wrap(() => view.commentThread())
      const readError = wrap(() => view.commentsError())
      const readBlocked = wrap(() => view.commentsBlocked())
      const readWarning = wrap(() => view.commentsWarning())
      const setWeek = wrap((next: Temporal.PlainDate) => week.set(next))

      await vi.waitFor(() => subscribedTo(subscribe, 'duty/comments:2026-06-15'))
      emit('duty/comments:2026-06-15', [cm({ id: 'c1', text: 'week one' })])
      await vi.waitFor(() => expect(readThread()).toHaveLength(1))

      setWeek(D('2026-06-22'))
      await vi.waitFor(() => subscribedTo(subscribe, 'duty/comments:2026-06-22'))
      calls.at(-1)?.listener(new StorageError({ reason: 'boom' }))

      await vi.waitFor(() => expect(readError()).not.toBeNull())
      expect(readThread()).toEqual([])
      expect(readBlocked()).toBe(true)
      expect(readWarning()).toBe(false)

      off()
    })
  })

  // F14 follow-up: a failure on the key already being viewed keeps its rows and
  // surfaces a non-destructive warning instead.
  it('keeps the thread and warns, never blocks, when the same week read fails', async () => {
    const { model, subscribe, calls, emit } = makeCommentsModel()
    const view = model.weekComments(weekAtom('2026-06-15'))

    await context.start(async () => {
      const off = view.commentThread.subscribe(() => {})
      const readThread = wrap(() => view.commentThread())
      const readError = wrap(() => view.commentsError())
      const readBlocked = wrap(() => view.commentsBlocked())
      const readWarning = wrap(() => view.commentsWarning())

      await vi.waitFor(() => subscribedTo(subscribe, 'duty/comments:2026-06-15'))
      emit('duty/comments:2026-06-15', [cm({ id: 'c1', text: 'still here' })])
      await vi.waitFor(() => expect(readThread()).toHaveLength(1))
      expect(readBlocked()).toBe(false)
      expect(readWarning()).toBe(false)

      calls.at(-1)?.listener(new StorageError({ reason: 'flaky' }))

      await vi.waitFor(() => expect(readError()).not.toBeNull())
      expect(readBlocked()).toBe(false)
      expect(readWarning()).toBe(true)
      expect(readThread().map((comment) => comment.text)).toEqual(['still here'])

      off()
    })
  })
})
