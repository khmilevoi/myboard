/**
 * Storage keys are a persistence contract: the ofelia-to-module migration copies the old widget data to
 * `m:cats:s:duty/<relative>`, and module storage prefixes `m:cats:s:` onto what is built here.
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
