import type { WidgetServerStorage } from '@shared/widgets/contracts'

import { litterSettingsKey } from './domain/keys'
import { DEFAULT_LITTER_SETTINGS, LitterSettingsSchema, type LitterSettings } from './domain/roster'

/**
 * A litter's duty settings, shared by the day-action handlers and the nightly cron. An absent
 * or unparseable value gives `DEFAULT_LITTER_SETTINGS`: the key is writable through the generic
 * storage endpoint, so a bad value must not block day actions or the cron. Only a storage
 * failure is an Error. The raw value is read and parsed here, not through `get`'s schema
 * argument, so a schema mismatch is never confused with a storage failure.
 */
export async function readLitterSettings(
  storage: WidgetServerStorage,
  litterId: string,
): Promise<Error | LitterSettings> {
  const raw = await storage.get(litterSettingsKey(litterId))
  if (raw instanceof Error) return raw

  const parsed = LitterSettingsSchema.safeParse(raw)
  return parsed.success ? parsed.data : DEFAULT_LITTER_SETTINGS
}
