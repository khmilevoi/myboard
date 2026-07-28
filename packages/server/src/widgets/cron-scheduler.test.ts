import type {
  RuntimeWidgetServerDefinition,
  WidgetCronContext,
  WidgetCronJob,
} from '@shared/widgets/contracts'
import { Cron } from 'croner'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { makeFakeBrowserAutomationClient } from '../browser/testing/fake-client'
import { createMemoryOps, createMemoryPubSub } from '../test/memory-ops'
import { dueOccurrence, makeCronScheduler } from './cron-scheduler'
import { readCronState, writeCronState } from './cron-state'
import { createWidgetServerRegistry, type WidgetServerRegistry } from './registry'

const NOON_0616 = Date.parse('2026-06-16T12:00:00+02:00')
const EVENING_0616 = Date.parse('2026-06-16T18:00:00+02:00')
const MIDNIGHT_0617 = Date.parse('2026-06-17T00:05:00+02:00')
const MORNING_0617 = Date.parse('2026-06-17T06:00:00+02:00')
const MIDNIGHT_0619 = Date.parse('2026-06-19T00:05:00+02:00')
const NOON_0619 = Date.parse('2026-06-19T12:00:00+02:00')

function makeRegistry(run: (context: WidgetCronContext) => unknown): WidgetServerRegistry {
  const definition: RuntimeWidgetServerDefinition = {
    typeId: 'test-widget',
    schemas: {},
    handlers: {},
    crons: {
      nightly: {
        schedule: '5 0 * * *',
        timeZone: 'Europe/Warsaw',
        run: run as WidgetCronJob['run'],
      },
    },
  }
  const registry = createWidgetServerRegistry([definition])
  if (registry instanceof Error) throw registry
  return registry
}

describe('dueOccurrence', () => {
  const cron = new Cron('5 0 * * *', { timezone: 'Europe/Warsaw' })

  it('returns null when the next occurrence is still in the future', () => {
    expect(dueOccurrence(cron, NOON_0616, EVENING_0616)).toBeNull()
  })

  it('returns the occurrence that just came due', () => {
    expect(dueOccurrence(cron, NOON_0616, MORNING_0617)).toBe(MIDNIGHT_0617)
  })

  it('collapses several missed occurrences into the most recent one', () => {
    expect(dueOccurrence(cron, NOON_0616, NOON_0619)).toBe(MIDNIGHT_0619)
  })

  it('never re-fires an occurrence already recorded in the cursor', () => {
    expect(dueOccurrence(cron, MIDNIGHT_0619, NOON_0619)).toBeNull()
  })
})

describe('cron scheduler', () => {
  let ops: ReturnType<typeof createMemoryOps>
  let nowMs: number

  beforeEach(() => {
    ops = createMemoryOps(createMemoryPubSub())
    nowMs = NOON_0616
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  const makeScheduler = (run: (context: WidgetCronContext) => unknown) =>
    makeCronScheduler({
      registry: makeRegistry(run),
      ops,
      browserClient: makeFakeBrowserAutomationClient().client,
      now: () => nowMs,
    })

  it('seeds the cursor on first sight without running the job', async () => {
    const run = vi.fn()
    await makeScheduler(run).tick()

    expect(run).not.toHaveBeenCalled()
    expect(await readCronState(ops, 'test-widget', 'nightly')).toEqual({
      cursorMs: NOON_0616,
      failures: 0,
    })
  })

  it('runs once when an occurrence comes due and advances the cursor', async () => {
    const run = vi.fn()
    const scheduler = makeScheduler(run)
    await scheduler.tick()

    nowMs = NOON_0619
    await scheduler.tick()

    expect(run).toHaveBeenCalledTimes(1)
    expect(run.mock.calls[0][0].scheduledFor).toBe(MIDNIGHT_0619)
    expect(await readCronState(ops, 'test-widget', 'nightly')).toEqual({
      cursorMs: MIDNIGHT_0619,
      failures: 0,
    })
  })

  it('does nothing on a tick where nothing is due', async () => {
    const run = vi.fn()
    const scheduler = makeScheduler(run)
    await scheduler.tick()
    await scheduler.tick()

    expect(run).not.toHaveBeenCalled()
  })

  it('keeps the cursor and counts a failure when the job returns an error', async () => {
    const scheduler = makeScheduler(() => new Error('boom'))
    await scheduler.tick()

    nowMs = NOON_0619
    await scheduler.tick()

    expect(await readCronState(ops, 'test-widget', 'nightly')).toEqual({
      cursorMs: NOON_0616,
      failures: 1,
    })
  })

  it('retries on the next tick after a failure', async () => {
    const run = vi.fn(() => new Error('boom'))
    const scheduler = makeScheduler(run)
    await scheduler.tick()

    nowMs = NOON_0619
    await scheduler.tick()
    await scheduler.tick()

    expect(run).toHaveBeenCalledTimes(2)
  })

  it('gives up and advances the cursor after five consecutive failures', async () => {
    const scheduler = makeScheduler(() => new Error('boom'))
    await scheduler.tick()

    nowMs = NOON_0619
    for (let attempt = 0; attempt < 5; attempt += 1) await scheduler.tick()

    expect(await readCronState(ops, 'test-widget', 'nightly')).toEqual({
      cursorMs: MIDNIGHT_0619,
      failures: 0,
    })
  })

  it('treats a thrown error like a returned one', async () => {
    const scheduler = makeScheduler(() => {
      throw new Error('boom')
    })
    await scheduler.tick()

    nowMs = NOON_0619
    await expect(scheduler.tick()).resolves.toBeUndefined()

    expect(await readCronState(ops, 'test-widget', 'nightly')).toEqual({
      cursorMs: NOON_0616,
      failures: 1,
    })
  })

  it('does not start a job that is still running from a previous tick', async () => {
    let release = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const run = vi.fn(() => gate)

    await writeCronState(ops, 'test-widget', 'nightly', { cursorMs: NOON_0616, failures: 0 })
    nowMs = NOON_0619
    const scheduler = makeScheduler(run)

    const first = scheduler.tick()
    await scheduler.tick()
    release()
    await first

    expect(run).toHaveBeenCalledTimes(1)
  })

  it('gives the job a shared storage scope and nothing else', async () => {
    let seen: WidgetCronContext | null = null
    const scheduler = makeScheduler((context) => {
      seen = context
    })
    await scheduler.tick()
    nowMs = NOON_0619
    await scheduler.tick()

    // TypeScript keeps `seen` narrowed to its initial `null` across the
    // closure that reassigns it (microsoft/TypeScript#9998); cast back to
    // the declared type rather than widen the annotation away.
    const context = seen as WidgetCronContext | null
    expect(context?.typeId).toBe('test-widget')
    expect(Object.keys(context?.api.storage ?? {})).toEqual(['shared'])
  })

  it('runs a due job on its own interval through start(), and stop() halts it', async () => {
    // In production only the setInterval inside start() ever calls tick() --
    // every test above drives tick() directly. Fake timers let the interval
    // fire deterministically without a real wall-clock wait.
    vi.useFakeTimers()
    const run = vi.fn()
    const scheduler = makeCronScheduler({
      registry: makeRegistry(run),
      ops,
      browserClient: makeFakeBrowserAutomationClient().client,
      now: () => nowMs,
      intervalMs: 50,
    })

    // Seed the cursor first, exactly like the tick()-driven tests above -- a
    // "first sight" job never runs on its own tick.
    await scheduler.tick()
    nowMs = NOON_0619

    scheduler.start()
    await vi.advanceTimersByTimeAsync(50)

    expect(run).toHaveBeenCalledTimes(1)
    expect(await readCronState(ops, 'test-widget', 'nightly')).toEqual({
      cursorMs: MIDNIGHT_0619,
      failures: 0,
    })

    await scheduler.stop()
    await vi.advanceTimersByTimeAsync(500)

    expect(run).toHaveBeenCalledTimes(1)
  })
})
