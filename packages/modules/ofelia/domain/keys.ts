/**
 * Storage keys are a persistence contract: the ofelia migration copies the old widget data to
 * `m:ofelia:s:duty/<relative>`, and module storage prefixes `m:ofelia:s:` onto what is built here.
 * Changing any of these silently orphans existing data.
 */
export function dutyKey(relative: string): string {
  return `duty/${relative}`
}

export const LEDGER_KEY = dutyKey('ledger')

/** `weekStartIso` MUST be the output of `weekStartISO(date)`. */
export function commentsKey(weekStartIso: string): string {
  return dutyKey(`comments:${weekStartIso}`)
}
