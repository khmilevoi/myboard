import { defineModuleServer, type ModuleServerContext } from '@shared/modules/contracts'
import * as errore from 'errore'

import { catsContract } from './domain/contract'
import { autoApproveDrafts } from './domain/day-close'
import {
  makeCleanDraft,
  makeCommentDraft,
  makeDebtDraft,
  makeForgiveDraft,
  makeUndoDraft,
  type DraftInput,
} from './domain/drafts'
import { OFELIA_ID } from './domain/ids'
import { commentsKey, ledgerKey } from './domain/keys'
import { LedgerEntriesSchema, resolveDays, type LedgerEntryDraft } from './domain/ledger'
import { DUTY_TIME_ZONE, plainDateIn } from './domain/roster'

const OK = { ok: true } as const

type DayPayload = { litterId: string; date: string }

async function readDraftInput(
  context: ModuleServerContext<'shared'>,
  { litterId, date }: DayPayload,
): Promise<Error | DraftInput> {
  const entries = await context.api.storage.shared.get(ledgerKey(litterId), LedgerEntriesSchema)
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
  context: ModuleServerContext<'shared'>,
  litterId: string,
  draft: LedgerEntryDraft | null,
): Promise<Error | typeof OK> {
  if (draft === null) return OK
  const written = await context.api.storage.shared.append(ledgerKey(litterId), draft)
  if (written instanceof Error) return written
  return OK
}

// Every key is built from `payload.litterId`. Day actions do not check that the
// litter exists: the id's schema is the guard, and an unknown litter's ledger is
// never offered by a switcher nor closed by the cron.
const catsServer = defineModuleServer(catsContract, {
  handlers: {
    clean: async (payload, context) => {
      const input = await readDraftInput(context, payload)
      if (input instanceof Error) return input
      return appendLedger(context, payload.litterId, makeCleanDraft(input))
    },

    debt: async (payload, context) => {
      const input = await readDraftInput(context, payload)
      if (input instanceof Error) return input
      return appendLedger(context, payload.litterId, makeDebtDraft(input))
    },

    forgive: async (payload, context) => {
      const input = await readDraftInput(context, payload)
      if (input instanceof Error) return input
      return appendLedger(context, payload.litterId, makeForgiveDraft(input))
    },

    undo: async (payload, context) => {
      const input = await readDraftInput(context, payload)
      if (input instanceof Error) return input
      return appendLedger(context, payload.litterId, makeUndoDraft(input))
    },

    comment: async ({ litterId, weekStart, text }, context) => {
      const draft = makeCommentDraft({ text, createdBy: context.viewer })
      if (draft === null) return OK

      const written = await context.api.storage.shared.append(
        commentsKey(litterId, weekStart),
        draft,
      )
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
        // Only Ofelia's litter is closed until the cron iterates the litter registry.
        const key = ledgerKey(OFELIA_ID)
        const entries = await api.storage.shared.get(key, LedgerEntriesSchema)
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
          const fresh = await api.storage.shared.get(key, LedgerEntriesSchema)
          if (fresh instanceof Error) return fresh
          if (resolveDays(fresh ?? []).get(draft.date)?.status === 'closed') continue

          const appended = await api.storage.shared.append(key, draft)
          if (appended instanceof Error) return appended
        }
      },
    },
  },
})

export default catsServer
