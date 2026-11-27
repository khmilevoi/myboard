import { defineModuleServer, type ModuleServerContext } from '@shared/modules/contracts'
import type { WidgetServerStorage } from '@shared/widgets/contracts'
import { PublicWidgetError } from '@shared/widgets/public-error'
import * as errore from 'errore'
import type { z } from 'zod'

import {
  CatProfileSchema,
  defaultCatProfile,
  type CatProfile,
  type LitterChoice,
} from './domain/cat'
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
import {
  CATS_REGISTRY_KEY,
  LITTERS_REGISTRY_KEY,
  catGoalKey,
  catProfileKey,
  catWeightKey,
  commentsKey,
  ledgerKey,
  litterSettingsKey,
} from './domain/keys'
import { LedgerEntriesSchema, resolveDays, type LedgerEntryDraft } from './domain/ledger'
import {
  CatRegistryEventsSchema,
  LitterRegistryEventsSchema,
  foldCatRegistry,
  foldLitterRegistry,
  type CatRegistry,
  type CatRegistryEventDraft,
  type LitterRegistryEventDraft,
} from './domain/registry'
import { DEFAULT_LITTER_SETTINGS, DUTY_TIME_ZONE, plainDateIn } from './domain/roster'
import { readLitterSettings } from './litter-settings'

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

  const settings = await readLitterSettings(context.api.storage.shared, litterId)
  if (settings instanceof Error) return settings

  return {
    settings,
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

/**
 * Reads an append-only registry key. The raw value is parsed here, not through `get`'s schema
 * argument, so a hand-written junk value reads as an empty log rather than as a storage failure;
 * only a storage failure is an Error.
 */
async function readEvents<T>(
  storage: WidgetServerStorage,
  key: string,
  schema: z.ZodType<T[], unknown>,
): Promise<Error | T[]> {
  const raw = await storage.get(key)
  if (raw instanceof Error) return raw
  const parsed = schema.safeParse(raw)
  return parsed.success ? parsed.data : []
}

async function readCatRegistry(storage: WidgetServerStorage): Promise<Error | CatRegistry> {
  const events = await readEvents(storage, CATS_REGISTRY_KEY, CatRegistryEventsSchema)
  if (events instanceof Error) return events
  return foldCatRegistry(events)
}

/** The registry, once `catId` is known to be in it, active or archived. */
async function readRegistryWith(
  storage: WidgetServerStorage,
  catId: string,
): Promise<Error | CatRegistry> {
  const registry = await readCatRegistry(storage)
  if (registry instanceof Error) return registry
  const known =
    registry.active.includes(catId) || registry.archived.some((cat) => cat.catId === catId)
  if (known) return registry
  return new PublicWidgetError({
    code: 'unknown_cat',
    status: 404,
    publicMessage: 'Unknown cat',
    meta: { catId },
  })
}

/**
 * The litters an active cat uses, in litter-registry order. A profile that is absent or does not
 * parse contributes nothing; only a storage failure is an Error.
 */
async function readLitterIdsInUse(storage: WidgetServerStorage): Promise<Error | string[]> {
  const cats = await readCatRegistry(storage)
  if (cats instanceof Error) return cats
  const litterEvents = await readEvents(storage, LITTERS_REGISTRY_KEY, LitterRegistryEventsSchema)
  if (litterEvents instanceof Error) return litterEvents

  const used = new Set<string>()
  for (const catId of cats.active) {
    const raw = await storage.get(catProfileKey(catId))
    if (raw instanceof Error) return raw
    const profile = CatProfileSchema.safeParse(raw)
    if (profile.success) used.add(profile.data.litterId)
  }
  return foldLitterRegistry(litterEvents).filter((litterId) => used.has(litterId))
}

/** Closes the unresolved days of one litter's ledger with system entries. */
async function closeLitterDay(
  storage: WidgetServerStorage,
  litterId: string,
  scheduledFor: number,
): Promise<Error | undefined> {
  const key = ledgerKey(litterId)
  const entries = await storage.get(key, LedgerEntriesSchema)
  if (entries instanceof Error) return entries

  // No key (or a key that resolved to nothing after filtering) means nobody has ever used this
  // litter: there is no history to auto-approve. Without this, every stack that never used it —
  // including every disposable branch deploy — would grow a ledger by one fabricated `cleaned`
  // record a night forever (F11). Returning normally still advances the cron cursor.
  if (entries === null || entries.length === 0) return

  const settings = await readLitterSettings(storage, litterId)
  if (settings instanceof Error) return settings

  // Derived from this fresh read, so a caught-up or retried run cannot duplicate a day that was
  // closed in the meantime.
  const drafts = autoApproveDrafts({ settings, entries, scheduledForMs: scheduledFor })

  for (const draft of drafts) {
    // The initial read decided WHICH days still need closing, but it is outside any lock. A manual
    // close dispatched before this specific append would otherwise be overridden by the system
    // entry for the same date (F10): `latestOutcomesByDate` resolves ties by insertion order.
    // Re-check this one day from a fresh read right before writing it.
    const fresh = await storage.get(key, LedgerEntriesSchema)
    if (fresh instanceof Error) return fresh
    if (resolveDays(fresh ?? []).get(draft.date)?.status === 'closed') continue

    const appended = await storage.append(key, draft)
    if (appended instanceof Error) return appended
  }
}

async function appendCatEvent(
  storage: WidgetServerStorage,
  event: CatRegistryEventDraft,
): Promise<Error | typeof OK> {
  const written = await storage.append(CATS_REGISTRY_KEY, event)
  if (written instanceof Error) return written
  return OK
}

/**
 * The litter id a `LitterChoice` names. An `existing` litter must be in the litter registry. A
 * `new` one is created here (registry append, then its settings set to the defaults) before the
 * caller writes the profile that points at it.
 */
async function resolveLitter(
  storage: WidgetServerStorage,
  choice: LitterChoice,
): Promise<Error | string> {
  if (choice.kind === 'existing') {
    const events = await readEvents(storage, LITTERS_REGISTRY_KEY, LitterRegistryEventsSchema)
    if (events instanceof Error) return events
    if (foldLitterRegistry(events).includes(choice.litterId)) return choice.litterId
    return new PublicWidgetError({
      code: 'unknown_litter',
      status: 404,
      publicMessage: 'Unknown litter',
      meta: { litterId: choice.litterId },
    })
  }

  const litterId = crypto.randomUUID()
  const event: LitterRegistryEventDraft = { litterId, op: 'add' }
  const registered = await storage.append(LITTERS_REGISTRY_KEY, event)
  if (registered instanceof Error) return registered
  const settled = await storage.set(litterSettingsKey(litterId), DEFAULT_LITTER_SETTINGS)
  if (settled instanceof Error) return settled
  return litterId
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

    // The profile is written before the registry `add`: a request that fails between the two
    // leaves a profile no registry entry names, which nothing reads, never a registry id with no
    // profile behind it (the model skips such ids anyway).
    addCat: async ({ name, litter, birthDate, sex }, context) => {
      const storage = context.api.storage.shared
      const litterId = await resolveLitter(storage, litter)
      if (litterId instanceof Error) return litterId

      const catId = crypto.randomUUID()
      const profile = {
        ...defaultCatProfile(name, litterId),
        ...(birthDate === undefined ? {} : { birthDate }),
        ...(sex === undefined ? {} : { sex }),
      }
      const saved = await storage.set(catProfileKey(catId), profile)
      if (saved instanceof Error) return saved

      const added = await appendCatEvent(storage, { catId, op: 'add' })
      if (added instanceof Error) return added
      return { ok: true as const, catId }
    },

    // The last-active check here only gives the common case a clear answer. Two archive requests
    // landing together both pass it; `foldCatRegistry` then ignores the second.
    archiveCat: async ({ catId }, context) => {
      const storage = context.api.storage.shared
      const registry = await readRegistryWith(storage, catId)
      if (registry instanceof Error) return registry
      if (!registry.active.includes(catId)) return OK
      if (registry.active.length > 1) return appendCatEvent(storage, { catId, op: 'archive' })
      return new PublicWidgetError({
        code: 'last_active_cat',
        status: 409,
        publicMessage: 'The last active cat cannot be archived',
        meta: { catId },
      })
    },

    restoreCat: async ({ catId }, context) => {
      const storage = context.api.storage.shared
      const registry = await readRegistryWith(storage, catId)
      if (registry instanceof Error) return registry
      if (registry.active.includes(catId)) return OK
      return appendCatEvent(storage, { catId, op: 'restore' })
    },

    saveProfile: async ({ catId, profile, litter }, context) => {
      const storage = context.api.storage.shared
      const registry = await readRegistryWith(storage, catId)
      if (registry instanceof Error) return registry

      const litterId = await resolveLitter(storage, litter)
      if (litterId instanceof Error) return litterId

      const next: CatProfile = { ...profile, litterId }
      const saved = await storage.set(catProfileKey(catId), next)
      if (saved instanceof Error) return saved
      return OK
    },

    setGoal: async ({ catId, kcal, since }, context) => {
      const storage = context.api.storage.shared
      const registry = await readRegistryWith(storage, catId)
      if (registry instanceof Error) return registry

      const written = await storage.append(catGoalKey(catId), { kcal, since })
      if (written instanceof Error) return written
      return OK
    },

    // Stamped from the caller's session, like the ledger: the author never travels in the payload.
    weigh: async ({ catId, kg, at }, context) => {
      const storage = context.api.storage.shared
      const registry = await readRegistryWith(storage, catId)
      if (registry instanceof Error) return registry

      const written = await storage.append(catWeightKey(catId), {
        at,
        kg,
        createdBy: context.viewer,
      })
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
        const storage = api.storage.shared
        const litterIds = await readLitterIdsInUse(storage)
        // An incomplete picture of the registry must not advance the cursor.
        if (litterIds instanceof Error) return litterIds

        // Attempt every litter so one failure does not starve the others, then report the first.
        let firstError: Error | undefined
        for (const litterId of litterIds) {
          const closed = await closeLitterDay(storage, litterId, scheduledFor)
          if (closed instanceof Error) firstError ??= closed
        }
        return firstError
      },
    },
  },
})

export default catsServer
