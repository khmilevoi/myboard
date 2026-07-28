import { defineWidgetServer, type WidgetServerContext } from '@shared/widgets/contracts'
import * as errore from 'errore'

import { commentsKey } from './domain/comments'
import { autoApproveDrafts } from './domain/day-close'
import {
  makeCleanDraft,
  makeCommentDraft,
  makeDebtDraft,
  makeForgiveDraft,
  makeUndoDraft,
  type DraftInput,
} from './domain/drafts'
import { ofeliaEventSchemas } from './domain/events'
import {
  LEDGER_KEY,
  LedgerEntriesSchema,
  resolveDays,
  type LedgerEntryDraft,
} from './domain/ledger'
import { DUTY_TIME_ZONE, plainDateIn } from './domain/roster'

const OK = { ok: true } as const

async function readDraftInput(
  context: WidgetServerContext,
  date: string,
): Promise<Error | DraftInput> {
  const entries = await context.api.storage.shared.get(LEDGER_KEY, LedgerEntriesSchema)
  if (entries instanceof Error) return entries

  const target = errore.try(() => Temporal.PlainDate.from(date))
  if (target instanceof Error) return target

  return {
    entries: entries ?? [],
    today: plainDateIn(DUTY_TIME_ZONE, context.now()),
    target,
    createdBy: context.viewer,
  }
}

/**
 * A null draft is a "not applicable" case (forgiving a day with no debt,
 * undoing an open day) and stays a silent success — it mirrors the early
 * returns these actions had while they lived on the client.
 */
async function appendLedger(
  context: WidgetServerContext,
  draft: LedgerEntryDraft | null,
): Promise<Error | typeof OK> {
  if (draft === null) return OK
  const written = await context.api.storage.shared.append(LEDGER_KEY, draft)
  if (written instanceof Error) return written
  return OK
}

const ofeliaServer = defineWidgetServer({
  schemas: ofeliaEventSchemas,
  handlers: {
    clean: async ({ date }, context) => {
      const input = await readDraftInput(context, date)
      if (input instanceof Error) return input
      return appendLedger(context, makeCleanDraft(input))
    },

    debt: async ({ date }, context) => {
      const input = await readDraftInput(context, date)
      if (input instanceof Error) return input
      return appendLedger(context, makeDebtDraft(input))
    },

    forgive: async ({ date }, context) => {
      const input = await readDraftInput(context, date)
      if (input instanceof Error) return input
      return appendLedger(context, makeForgiveDraft(input))
    },

    undo: async ({ date }, context) => {
      const input = await readDraftInput(context, date)
      if (input instanceof Error) return input
      return appendLedger(context, makeUndoDraft(input))
    },

    comment: async ({ weekStart, text }, context) => {
      const draft = makeCommentDraft({ text, createdBy: context.viewer })
      if (draft === null) return OK

      const written = await context.api.storage.shared.append(commentsKey(weekStart), draft)
      if (written instanceof Error) return written
      return OK
    },
  },

  crons: {
    // 00:05 rather than midnight: clear of the day boundary and of DST shifts.
    autoApproveDay: {
      schedule: '5 0 * * *',
      timeZone: DUTY_TIME_ZONE,
      run: async ({ scheduledFor, api }) => {
        const entries = await api.storage.shared.get(LEDGER_KEY, LedgerEntriesSchema)
        if (entries instanceof Error) return entries

        // No key (or a key that resolved to nothing after filtering) means
        // nobody has ever used this widget on this stack: there is no history
        // to auto-approve. Without this, every stack that has never even
        // placed the widget — including every disposable branch deploy —
        // would still grow a ledger by one fabricated `cleaned` record a
        // night forever (F11). Returning normally (not an Error) still
        // advances the cron cursor, so this is a real no-op, not a retry.
        if (entries === null || entries.length === 0) return

        // Derived from this fresh read, so a caught-up or retried run cannot
        // duplicate a day that was closed in the meantime.
        const drafts = autoApproveDrafts({ entries, scheduledForMs: scheduledFor })

        for (const draft of drafts) {
          // The initial read above decided WHICH days still need closing, but
          // that read is outside any lock. A manual close dispatched between
          // it and this specific append is invisible to `drafts`, and would
          // otherwise be silently overridden by this job's own system entry
          // for the same date (F10) — `latestOutcomesByDate` resolves ties by
          // insertion order, so the later-appended system entry wins. Re-check
          // this one day from a fresh read right before writing it.
          const fresh = await api.storage.shared.get(LEDGER_KEY, LedgerEntriesSchema)
          if (fresh instanceof Error) return fresh
          if (resolveDays(fresh ?? []).get(draft.date)?.status === 'closed') continue

          const appended = await api.storage.shared.append(LEDGER_KEY, draft)
          if (appended instanceof Error) return appended
        }
      },
    },
  },
})

export default ofeliaServer
