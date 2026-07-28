import { z } from 'zod'

export const DUTY_TIME_ZONE = 'Europe/Warsaw' as const
/**
 * Kept as an ISO string rather than a Temporal.PlainDate so this module can be
 * imported before the browser Temporal polyfill has been installed — Temporal
 * is only touched inside function bodies.
 */
export const BASE_DUTY_DATE_ISO = '2026-06-16' as const
export const DUTY_ROTATION = ['Леша', 'Карина'] as const

export type DutyPerson = (typeof DUTY_ROTATION)[number]
export type Person = DutyPerson

export const PersonSchema = z.enum(DUTY_ROTATION)
export const IsoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'expected an ISO calendar date')

export function plainDateIn(timeZone: string, epochMs: number): Temporal.PlainDate {
  return Temporal.Instant.fromEpochMilliseconds(epochMs).toZonedDateTimeISO(timeZone).toPlainDate()
}

export function getOfeliaDutyByDate(date: Temporal.PlainDate): DutyPerson {
  const base = Temporal.PlainDate.from(BASE_DUTY_DATE_ISO)
  const diffDays = base.until(date, { largestUnit: 'day' }).days
  return DUTY_ROTATION[positiveModulo(diffDays, DUTY_ROTATION.length)]
}

export function otherPerson(person: Person): Person {
  return DUTY_ROTATION.find((candidate) => candidate !== person) ?? person
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
