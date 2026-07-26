import type { WidgetCronContext, WidgetCronJob } from '@shared/widgets/contracts'
import { Cron } from 'croner'

import type { BrowserAutomationClient } from '../browser/client'
import type { ValkeyOps } from '../storage/valkey'
import { makeWidgetCronApi } from './api'
import { readCronState, writeCronState } from './cron-state'
import { WidgetCronRunError } from './errors'
import type { WidgetServerRegistry } from './registry'

const DEFAULT_INTERVAL_MS = 30_000
/** Bounds catch-up work for minute-level schedules after a long outage. */
const MAX_CATCHUP_STEPS = 1000
const MAX_FAILURES = 5

export type CronSchedulerOptions = {
  registry: WidgetServerRegistry
  ops: ValkeyOps
  browserClient: BrowserAutomationClient
  now: () => number
  intervalMs?: number
}

export type CronScheduler = {
  tick(): Promise<void>
  start(): void
  stop(): Promise<void>
}

type ScheduledJob = {
  typeId: string
  name: string
  job: WidgetCronJob
  cron: Cron
}

/**
 * The most recent occurrence that is due at nowMs, or null if none is.
 * `nextRun` is strictly exclusive, so an occurrence already recorded in the
 * cursor never fires twice; missed occurrences collapse into the latest one.
 */
export function dueOccurrence(cron: Cron, cursorMs: number, nowMs: number): number | null {
  const first = cron.nextRun(new Date(cursorMs))
  if (first === null || first.getTime() > nowMs) return null

  let due = first.getTime()
  for (let step = 0; step < MAX_CATCHUP_STEPS; step += 1) {
    const next = cron.nextRun(new Date(due))
    if (next === null || next.getTime() > nowMs) return due
    due = next.getTime()
  }
  console.warn(
    `cron catch-up hit the ${MAX_CATCHUP_STEPS}-step cap; using ${new Date(due).toISOString()}`,
  )
  return due
}

export function makeCronScheduler(options: CronSchedulerOptions): CronScheduler {
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS
  const jobs: ScheduledJob[] = []
  for (const [typeId, definition] of options.registry) {
    for (const [name, job] of Object.entries(definition.crons)) {
      // Schedules were validated in createWidgetServerRegistry, so this cannot throw.
      jobs.push({ typeId, name, job, cron: new Cron(job.schedule, { timezone: job.timeZone }) })
    }
  }

  const running = new Set<string>()
  let timer: ReturnType<typeof setInterval> | null = null
  let inFlight: Promise<void> = Promise.resolve()

  async function runJob(scheduled: ScheduledJob): Promise<void> {
    const id = `${scheduled.typeId}:${scheduled.name}`
    if (running.has(id)) return
    running.add(id)
    try {
      const state = await readCronState(options.ops, scheduled.typeId, scheduled.name)
      if (state instanceof Error) {
        console.error(state)
        return
      }

      const nowMs = options.now()
      if (state === null) {
        // First sight: record where we are and do not fire, otherwise every
        // deploy would immediately run every job for the current period.
        const seeded = await writeCronState(options.ops, scheduled.typeId, scheduled.name, {
          cursorMs: nowMs,
          failures: 0,
        })
        if (seeded instanceof Error) console.error(seeded)
        return
      }

      const scheduledFor = dueOccurrence(scheduled.cron, state.cursorMs, nowMs)
      if (scheduledFor === null) return

      const context: WidgetCronContext = {
        typeId: scheduled.typeId,
        now: options.now,
        scheduledFor,
        api: makeWidgetCronApi({
          ops: options.ops,
          typeId: scheduled.typeId,
          now: options.now,
          browserClient: options.browserClient,
        }),
      }

      // Deferred through .then() so a job that throws synchronously (rather
      // than returning a rejected promise) is caught the same way as one that
      // rejects — job.run is user-authored and may not be an async function.
      const outcome = await Promise.resolve()
        .then(() => scheduled.job.run(context))
        .catch((cause: unknown) => (cause instanceof Error ? cause : new Error(String(cause))))

      if (outcome instanceof Error) {
        const failures = state.failures + 1
        console.error(
          new WidgetCronRunError({
            typeId: scheduled.typeId,
            job: scheduled.name,
            scheduledFor: new Date(scheduledFor).toISOString(),
            cause: outcome,
          }),
        )
        // Keep the cursor so the next tick retries — a blinking Valkey should
        // not cost a whole occurrence. After MAX_FAILURES, move on loudly
        // rather than hammer a permanently broken job every interval.
        const giveUp = failures >= MAX_FAILURES
        if (giveUp) {
          console.error(
            `cron ${id}: giving up on ${new Date(scheduledFor).toISOString()} after ${failures} failures`,
          )
        }
        const written = await writeCronState(options.ops, scheduled.typeId, scheduled.name, {
          cursorMs: giveUp ? scheduledFor : state.cursorMs,
          failures: giveUp ? 0 : failures,
        })
        if (written instanceof Error) console.error(written)
        return
      }

      const written = await writeCronState(options.ops, scheduled.typeId, scheduled.name, {
        cursorMs: scheduledFor,
        failures: 0,
      })
      if (written instanceof Error) console.error(written)
    } finally {
      running.delete(id)
    }
  }

  async function tick(): Promise<void> {
    // Each job is isolated: one failure must not abort the pass for the rest.
    await Promise.all(jobs.map((scheduled) => runJob(scheduled)))
  }

  return {
    tick,
    start() {
      if (timer !== null || jobs.length === 0) return
      timer = setInterval(() => {
        inFlight = tick().catch((cause: unknown) => {
          console.error('cron tick failed', cause)
        })
      }, intervalMs)
    },
    async stop() {
      if (timer !== null) {
        clearInterval(timer)
        timer = null
      }
      await inFlight
    },
  }
}
