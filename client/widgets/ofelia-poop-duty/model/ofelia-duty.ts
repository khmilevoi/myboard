import {
  action,
  atom,
  computed,
  withAsyncData,
  withChangeHook,
  withConnectHook,
  wrap,
} from '@reatom/core'
import z from 'zod'

import { ServerTime } from '@/shared/timer/model/server-time'
import { withStorageKeyReadonly } from '@/storage/model/reatom/reatom-storage'
import { WidgetStorage } from '@/storage/model/storage'

export const DUTY_TIME_ZONE = 'Europe/Warsaw' as const
export const BASE_DUTY_DATE = Temporal.PlainDate.from({
  year: 2026,
  month: 6,
  day: 16,
})
export const DUTY_ROTATION = ['Леша', 'Карина'] as const

export type DutyPerson = (typeof DUTY_ROTATION)[number]
export type Person = DutyPerson

export const DEBT_WARNING_THRESHOLD = 7
export const IP_TAIL_LENGTH = 5

export type HistoryEntryView = {
  id: string
  date: string
  type: LedgerType
  actor: Person
  onBehalfOf?: Person
  by: Person
  ipTail: string
}

export interface OfeliaDutyModelProps {
  storage: WidgetStorage
  timer: ServerTime
}

// z.object with explicit keys (vs z.record) enables .partial(), which tolerates
// legacy/partial storage records where some rotation keys may be absent.
const NumberOfDebtsSchema = z
  .object({
    // Keep in sync with DUTY_ROTATION tuple.
    Леша: z.int().nonnegative(),
    Карина: z.int().nonnegative(),
  })
  .partial()
const PersonSchema = z.enum(DUTY_ROTATION)
type NumberOfDebts = z.infer<typeof NumberOfDebtsSchema>

export const LEDGER_KEY = 'ledger'

const LedgerTypeSchema = z.enum(['cleaned', 'went_into_debt', 'reset', 'forgiven'])
export type LedgerType = z.infer<typeof LedgerTypeSchema>

const LedgerEntrySchema = z.object({
  id: z.string(),
  ts: z.number(),
  ip: z.string(),
  date: z.string(),
  type: LedgerTypeSchema,
  actor: PersonSchema,
  onBehalfOf: PersonSchema.optional(),
  by: PersonSchema,
})

export type LedgerEntry = z.infer<typeof LedgerEntrySchema>
export type LedgerEntryDraft = Omit<LedgerEntry, 'id' | 'ts' | 'ip'>
export const LedgerEntriesSchema = z.array(LedgerEntrySchema)

const DAY_OUTCOME_TYPES: ReadonlySet<LedgerType> = new Set(['cleaned', 'went_into_debt', 'reset'])

export function latestOutcomesByDate(entries: LedgerEntry[]): Map<string, LedgerEntry> {
  const latest = new Map<string, LedgerEntry>()
  for (const entry of entries) {
    if (!DAY_OUTCOME_TYPES.has(entry.type)) continue
    const prev = latest.get(entry.date)
    if (!prev || entry.ts > prev.ts) latest.set(entry.date, entry)
  }
  return latest
}

export function foldDebt(entries: LedgerEntry[]): NumberOfDebts {
  const debt: Partial<NumberOfDebts> = {}

  for (const entry of latestOutcomesByDate(entries).values()) {
    if (entry.type === 'went_into_debt' && entry.onBehalfOf) {
      debt[entry.onBehalfOf] = (debt[entry.onBehalfOf] ?? 0) + 1
    } else if (entry.type === 'cleaned' && entry.onBehalfOf) {
      debt[entry.actor] = (debt[entry.actor] ?? 0) - 1
    }
  }

  for (const entry of entries) {
    if (entry.type === 'forgiven' && entry.onBehalfOf) {
      debt[entry.onBehalfOf] = (debt[entry.onBehalfOf] ?? 0) - 1
    }
  }

  return normalizeDebts(debt)
}

export type DayResolution = {
  status: 'closed' | 'pending'
  type: LedgerType
  actor: Person
  onBehalfOf?: Person
}

export function resolveDays(entries: LedgerEntry[]): Map<string, DayResolution> {
  const out = new Map<string, DayResolution>()
  for (const [date, entry] of latestOutcomesByDate(entries)) {
    out.set(date, {
      status: entry.type === 'reset' ? 'pending' : 'closed',
      type: entry.type,
      actor: entry.actor,
      ...(entry.onBehalfOf ? { onBehalfOf: entry.onBehalfOf } : {}),
    })
  }
  return out
}

function getStartOfWeek(date: Temporal.PlainDate): Temporal.PlainDate {
  return date.subtract({
    days: date.dayOfWeek - 1,
  })
}

export const ofeliaDutyModel = ({ storage, timer }: OfeliaDutyModelProps) => {
  // Reactive mirror of the append-only, server-owned ledger key. null is the
  // "not loaded yet" sentinel the computeds below branch on. The connect hook
  // lives on the atom itself: Reatom's dependency graph connects `ledger` when
  // any derived computed gains a subscriber and disconnects (auto-unsubscribing
  // the SSE listener) when the last one goes away — no manual ref-counting.
  const ledger = atom<LedgerEntry[] | null>(null, 'ofeliaDuty.ledger').extend(
    withStorageKeyReadonly({
      api: storage.shared.server,
      key: LEDGER_KEY,
      schema: LedgerEntriesSchema,
      fallback: [],
    }),
  )

  const numberOfDebts = computed(() => {
    const entries = ledger()
    return entries === null ? null : foldDebt(entries)
  }, 'ofeliaDuty.numberOfDebts')
  const dayResolution = computed(() => {
    const entries = ledger()
    return entries === null ? new Map<string, DayResolution>() : resolveDays(entries)
  }, 'ofeliaDuty.dayResolution')

  const currentUser = atom<Person>(DUTY_ROTATION[0], 'ofeliaDuty.currentUser').extend(
    withConnectHook(() => {
      void wrap(storage.shared.client.get('currentUser', PersonSchema)).then((storedUser) => {
        if (storedUser instanceof Error || storedUser === null) return
        currentUser.set(storedUser)
      })
    }),
    withChangeHook((state) => {
      void wrap(storage.shared.client.set('currentUser', state))
    }),
  )

  const today = computed(() => timer.today(DUTY_TIME_ZONE), 'today')

  const startOfWeekOverride = atom<Temporal.PlainDate | null>(
    null,
    'ofeliaDuty.startOfWeekOverride',
  )

  const viewWeekStart = computed<Temporal.PlainDate | null>(() => {
    const override = startOfWeekOverride()
    if (override) return override
    const currentToday = today()
    return currentToday ? getStartOfWeek(currentToday) : null
  }, 'ofeliaDuty.viewWeekStart')

  const goToNextWeek = action(() => {
    const base = viewWeekStart()
    if (!base) return
    startOfWeekOverride.set(base.add({ days: 7 }))
  }, 'ofeliaDuty.goToNextWeek')

  const goToPrevWeek = action(() => {
    const base = viewWeekStart()
    if (!base) return
    startOfWeekOverride.set(base.subtract({ days: 7 }))
  }, 'ofeliaDuty.goToPrevWeek')

  const goToCurrentWeek = action(() => {
    startOfWeekOverride.set(null)
  }, 'ofeliaDuty.goToCurrentWeek')

  const selectedDate = atom<Temporal.PlainDate | null>(null, 'ofeliaDuty.selectedDate')

  const historyView = computed<HistoryEntryView[]>(() => {
    const week = viewWeekStart()
    if (!week) return []
    const entries = ledger()
    if (entries === null) return []
    const weekIso = week.toString()
    return entries
      .filter((entry) => weekStartISO(Temporal.PlainDate.from(entry.date)) === weekIso)
      .toSorted((a, b) => b.ts - a.ts)
      .map((entry) => ({
        id: entry.id,
        date: entry.date,
        type: entry.type,
        actor: entry.actor,
        ...(entry.onBehalfOf ? { onBehalfOf: entry.onBehalfOf } : {}),
        by: entry.by,
        ipTail: entry.ip.slice(-IP_TAIL_LENGTH),
      }))
  }, 'ofeliaDuty.historyView')

  const undoAvailable = computed(() => {
    const day = selectedDate() ?? today()
    if (day == null) return false
    return dayResolution().get(day.toString())?.status === 'closed'
  }, 'ofeliaDuty.undoAvailable')

  const debtDays = computed(() => {
    const currentToday = today()
    const debts = numberOfDebts()
    if (!currentToday || debts === null) return null
    return getDebtDays(debts, currentToday).reduce((acc, debtDay) => {
      acc.set(debtDay.date.toString(), debtDay)
      return acc
    }, new Map<string, DebtDay>())
  }, 'ofeliaDuty.debtDays')

  const currentWeek = computed(() => {
    const currentToday = today()
    const weekStart = viewWeekStart()
    const days = debtDays()
    const resolution = dayResolution()

    if (!currentToday || !weekStart || days === null) {
      return null
    }

    return Array.from({ length: 7 }, (_, dayOffset) => {
      const date = weekStart.add({ days: dayOffset })
      const iso = date.toString()
      const duty = getOfeliaDutyByDate(date)
      const debt = days?.get(iso) ?? null
      const resolved = resolution.get(iso)

      return {
        date,
        isToday: date.equals(currentToday),
        day: date.day,
        duty,
        debt: debt?.person ?? null,
        resolvedActor: resolved?.status === 'closed' ? resolved.actor : null,
      }
    })
  }, 'ofeliaDuty.currentWeek')

  const confirmClean = action(async (date?: Temporal.PlainDate) => {
    const currentToday = today()
    const debts = numberOfDebts()
    if (currentToday == null || debts === null) return
    const target = date ?? selectedDate() ?? currentToday
    const debtDay = getDebtDays(debts, currentToday).find((day) => day.date.equals(target))
    const actor = debtDay?.person ?? getOfeliaDutyByDate(target)

    const draft: LedgerEntryDraft = {
      date: target.toString(),
      type: 'cleaned',
      actor,
      by: currentUser(),
      ...(debtDay ? { onBehalfOf: getOfeliaDutyByDate(target) } : {}),
    }
    const result = await wrap(storage.shared.server.append(LEDGER_KEY, draft))
    if (result instanceof Error) throw result
  }, 'ofeliaDuty.confirmClean').extend(withAsyncData({ status: true }))

  const goIntoDebt = action(async (date?: Temporal.PlainDate) => {
    const currentToday = today()
    if (currentToday == null || ledger() === null) return
    const target = date ?? selectedDate() ?? currentToday
    const duty = getOfeliaDutyByDate(target)

    const draft: LedgerEntryDraft = {
      date: target.toString(),
      type: 'went_into_debt',
      actor: otherPerson(duty),
      onBehalfOf: duty,
      by: currentUser(),
    }
    const result = await wrap(storage.shared.server.append(LEDGER_KEY, draft))
    if (result instanceof Error) throw result
  }, 'ofeliaDuty.goIntoDebt').extend(withAsyncData({ status: true }))

  const forgive = action(async (date?: Temporal.PlainDate) => {
    const currentToday = today()
    if (currentToday == null) return
    const target = date ?? selectedDate() ?? currentToday
    const debts = numberOfDebts()
    if (debts === null) return
    const debtor = DUTY_ROTATION.find((person) => (debts[person] ?? 0) > 0)
    if (!debtor) return

    const draft: LedgerEntryDraft = {
      date: target.toString(),
      type: 'forgiven',
      actor: otherPerson(debtor),
      onBehalfOf: debtor,
      by: currentUser(),
    }
    const result = await wrap(storage.shared.server.append(LEDGER_KEY, draft))
    if (result instanceof Error) throw result
  }, 'ofeliaDuty.forgive').extend(withAsyncData({ status: true }))
  const forgivePending = computed(() => forgive.pending() > 0, 'ofeliaDuty.forgivePending')

  const undo = action(async (date?: Temporal.PlainDate) => {
    const target = date ?? selectedDate() ?? today()
    if (target == null || ledger() === null) return
    const resolution = dayResolution().get(target.toString())
    if (resolution?.status !== 'closed') return

    const draft: LedgerEntryDraft = {
      date: target.toString(),
      type: 'reset',
      actor: resolution.actor,
      by: currentUser(),
    }
    const result = await wrap(storage.shared.server.append(LEDGER_KEY, draft))
    if (result instanceof Error) throw result
  }, 'ofeliaDuty.undo').extend(withAsyncData({ status: true }))

  return {
    today,
    startOfWeekOverride,
    viewWeekStart,
    goToNextWeek,
    goToPrevWeek,
    goToCurrentWeek,
    selectedDate,
    currentUser,
    numberOfDebts,
    debtDays,
    currentWeek,
    dayResolution,
    historyView,
    undoAvailable,
    forgivePending,
    confirmClean,
    goIntoDebt,
    forgive,
    undo,
  }
}

type DebtDay = {
  date: Temporal.PlainDate
  person: DutyPerson
}

function getDebtDays(debts: Partial<NumberOfDebts>, startDate: Temporal.PlainDate): DebtDay[] {
  if (DUTY_ROTATION.length < 2) {
    return []
  }

  const days: DebtDay[] = []
  let currentDate = startDate

  for (const person of DUTY_ROTATION) {
    let remainingDebt = debts[person] ?? 0

    while (remainingDebt > 0) {
      const plannedDuty = getOfeliaDutyByDate(currentDate)

      if (plannedDuty !== person) {
        days.push({
          date: currentDate,
          person,
        })

        remainingDebt -= 1
      }

      currentDate = currentDate.add({ days: 1 })
    }
  }

  return days
}

export function normalizeDebts(debts: Partial<NumberOfDebts>): NumberOfDebts {
  const values = DUTY_ROTATION.map((person) => debts[person] ?? 0)

  const minDebt = Math.min(...values)

  return DUTY_ROTATION.reduce<NumberOfDebts>(
    (normalized, person) => ({
      ...normalized,
      [person]: (debts[person] ?? 0) - minDebt,
    }),
    {} as NumberOfDebts,
  )
}

export function getOfeliaDutyByDate(date: Temporal.PlainDate): DutyPerson {
  const diffDays = BASE_DUTY_DATE.until(date, { largestUnit: 'day' }).days
  const rotationIndex = positiveModulo(diffDays, DUTY_ROTATION.length)

  return DUTY_ROTATION[rotationIndex]
}

export function weekStartISO(date: Temporal.PlainDate): string {
  return getStartOfWeek(date).toString()
}

export function otherPerson(person: Person): Person {
  return DUTY_ROTATION.find((candidate) => candidate !== person) ?? person
}

export function effectiveDuty(
  date: Temporal.PlainDate,
  debts: Partial<NumberOfDebts>,
  today: Temporal.PlainDate,
): Person {
  const debtDay = getDebtDays(debts, today).find((day) => day.date.equals(date))
  return debtDay?.person ?? getOfeliaDutyByDate(date)
}

export function isDebtDay(
  date: Temporal.PlainDate,
  debts: Partial<NumberOfDebts>,
  today: Temporal.PlainDate,
): boolean {
  return getDebtDays(debts, today).some((day) => day.date.equals(date))
}

export function isOverDebtWarning(debts: Partial<NumberOfDebts>, person: Person): boolean {
  return (debts[person] ?? 0) > DEBT_WARNING_THRESHOLD
}

function positiveModulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor
}
