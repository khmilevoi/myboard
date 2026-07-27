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

  const drafts: LedgerEntryDraft[] = []
  // The window is walked oldest-first, and each generated draft is folded
  // into a local, synthetic copy of the ledger before the next iteration
  // reads it — the same way a sequence of manual closes would leave each one
  // visible to the next (F1). Without this, a debt settled on the earliest
  // open day would still look outstanding to every later day in this same
  // run, and makeCleanDraft would independently rediscover and re-settle it
  // once per day instead of once total.
  let workingEntries = entries
  for (let offset = AUTO_APPROVE_WINDOW_DAYS; offset >= 1; offset -= 1) {
    const target = today.subtract({ days: offset })
    const resolution = resolveDays(workingEntries)
    // A day counts as handled only when its latest outcome closed it; a
    // deliberate `reset` leaves it open, and silence still means "cleaned".
    if (resolution.get(target.toString())?.status === 'closed') continue
    // The same builder the `clean` event handler uses, fed the
    // progressively-updated ledger this loop maintains, so the manual and
    // the automatic path see identical debt state and cannot drift apart.
    const draft = makeCleanDraft({
      entries: workingEntries,
      today,
      target,
      createdBy: SYSTEM_CREATED_BY,
      // Only the cron may look for a debt day before `today` (F1) — see the
      // field doc on DraftInput in drafts.ts for why the interactive
      // handlers must never set this.
      allowPastDebtDays: true,
    })
    drafts.push(draft)
    workingEntries = [
      ...workingEntries,
      { ...draft, id: `auto:${target.toString()}`, ts: scheduledForMs },
    ]
  }
  return drafts
}
