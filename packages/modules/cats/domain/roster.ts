import { z } from 'zod'

export const DUTY_TIME_ZONE = 'Europe/Warsaw' as const
/**
 * The household members a ledger row can name. Fixed on purpose: ledger rows keep
 * validating against this enum whatever a litter's rotation says.
 */
export const MEMBERS = ['Леша', 'Карина'] as const

export type Person = (typeof MEMBERS)[number]

export const PersonSchema = z.enum(MEMBERS)
/**
 * Shape only. Request payloads use this: a date that parses as a shape but not
 * as a day is caught downstream by `errore.try` in the server's
 * `readDraftInput`, which answers with an Error value rather than a rejection.
 */
export const IsoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'expected an ISO calendar date')
/**
 * Shape *and* existence — `IsoDateSchema` accepts `2026-13-45` and
 * `2026-02-30`; only Temporal knows whether the components spell a real day.
 *
 * For stored rows the distinction matters, because every consumer of a stored
 * date parses it (`foldDebt`, `toHistoryGroups`, the draft builders, the
 * nightly cron) and `Temporal.PlainDate.from` reports a bad string by throwing
 * rather than by returning a value. There is no `errore.try` between the store
 * and those readers, so an unparseable date has to be rejected at the parse
 * boundary: `LedgerEntriesSchema` then drops that one element, which is its
 * documented contract, instead of a single row hand-written through the generic
 * storage endpoint throwing out of the balance computation and blanking the
 * widget for everyone.
 *
 * Temporal is touched inside the refinement body only, so this module stays
 * importable before the browser polyfill is installed.
 */
export const CalendarDateSchema = IsoDateSchema.refine((value) => {
  try {
    Temporal.PlainDate.from(value)
    return true
  } catch {
    return false
  }
}, 'expected a calendar date that exists')

/**
 * One litter's duty rotation. `rotation` lists every member exactly once, in duty order;
 * `baseDate` is the day the first member is on duty. Stored under `litterSettingsKey`.
 */
export const LitterSettingsSchema = z.object({
  rotation: z
    .array(PersonSchema)
    .length(MEMBERS.length)
    .refine((rotation) => new Set(rotation).size === rotation.length, 'expected no duplicates'),
  baseDate: CalendarDateSchema,
})
export type LitterSettings = z.infer<typeof LitterSettingsSchema>

/** Applied to a litter whose settings key is absent or does not parse. */
export const DEFAULT_LITTER_SETTINGS: LitterSettings = {
  rotation: ['Леша', 'Карина'],
  baseDate: '2026-06-16',
}

export function plainDateIn(timeZone: string, epochMs: number): Temporal.PlainDate {
  return Temporal.Instant.fromEpochMilliseconds(epochMs).toZonedDateTimeISO(timeZone).toPlainDate()
}

export function dutyByDate(settings: LitterSettings, date: Temporal.PlainDate): Person {
  const base = Temporal.PlainDate.from(settings.baseDate)
  const diffDays = base.until(date, { largestUnit: 'day' }).days
  return settings.rotation[positiveModulo(diffDays, settings.rotation.length)]
}

export function otherPerson(settings: LitterSettings, person: Person): Person {
  return settings.rotation.find((candidate) => candidate !== person) ?? person
}

export function getStartOfWeek(date: Temporal.PlainDate): Temporal.PlainDate {
  return date.subtract({ days: date.dayOfWeek - 1 })
}

export function weekStartISO(date: Temporal.PlainDate): string {
  return getStartOfWeek(date).toString()
}

function positiveModulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor
}
