import { defineWidgetServer, type WidgetServerContext } from '@shared/widgets/contracts'
import * as errore from 'errore'

import { commentsKey } from './domain/comments'
import {
  makeCleanDraft,
  makeCommentDraft,
  makeDebtDraft,
  makeForgiveDraft,
  makeUndoDraft,
  type DraftInput,
} from './domain/drafts'
import { ofeliaEventSchemas } from './domain/events'
import { LEDGER_KEY, LedgerEntriesSchema, type LedgerEntryDraft } from './domain/ledger'
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
})

export default ofeliaServer
