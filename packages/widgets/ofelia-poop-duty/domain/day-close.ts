import { makeCleanDraft } from './drafts'
import { resolveDays, SYSTEM_CREATED_BY, type LedgerEntry, type LedgerEntryDraft } from './ledger'
import { DUTY_TIME_ZONE, plainDateIn } from './roster'

/**
 * How far back auto-approval reaches. Bounded on purpose: without a window the
 * first deploy would retroactively close every unresolved day since the ledger
 * began, and days older than a week are not worth repairing.
 */
export const AUTO_APPROVE_WINDOW_DAYS = 7

export type AutoApproveInput = {
  entries: LedgerEntry[]
  /** The cron occurrence being handled, in epoch ms. */
  scheduledForMs: number
}

export function autoApproveDrafts({
  entries,
  scheduledForMs,
}: AutoApproveInput): LedgerEntryDraft[] {
  const today = plainDateIn(DUTY_TIME_ZONE, scheduledForMs)
  const resolution = resolveDays(entries)

  const drafts: LedgerEntryDraft[] = []
  for (let offset = AUTO_APPROVE_WINDOW_DAYS; offset >= 1; offset -= 1) {
    const target = today.subtract({ days: offset })
    // A day counts as handled only when its latest outcome closed it; a
    // deliberate `reset` leaves it open, and silence still means "cleaned".
    if (resolution.get(target.toString())?.status === 'closed') continue
    // The same builder the `clean` event handler uses, so the manual and the
    // automatic path cannot drift apart.
    drafts.push(makeCleanDraft({ entries, today, target, createdBy: SYSTEM_CREATED_BY }))
  }
  return drafts
}
