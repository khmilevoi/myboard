import {
  action,
  type Action,
  atom,
  type Atom,
  type AtomLike,
  type Computed,
  computed,
  withAbort,
  withAsync,
  wrap,
} from '@reatom/core'
import type { HardwareBoardEvent, ProfileBody } from '@shared/hardware/board-api'
import { isHardwareError } from '@shared/hardware/board-client'
import { COMMAND_FAILURE_REASONS } from '@shared/hardware/failure-reasons'
import {
  ConsentCodeSchema,
  SCALE_ANSWER_TIMEOUT_MS,
  type ScaleUserIndex,
} from '@shared/hardware/spike-assumptions'
import type { HealthModel } from 'module-health'
import type { Profile } from 'module-health/domain/profile'

import { describeHardwareError } from './hardware-copy'
import {
  EMPTY_PROFILE_FORM,
  isProfileComplete,
  parseProfileForm,
  type ProfileFormField,
  type ProfileFormInput,
  profileToForm,
} from './profile-form'
import type { WizardAsyncAction, WizardDeps, WizardStep } from './wizard-model'
import { launch, type WaitFor } from './wizard-waits'

type CommandFrame = Extract<HardwareBoardEvent, { type: 'command' }>
type WritingStep = Extract<WizardStep, { kind: 'writing' }>

/** What the profile half needs from the wizard core (wizard-model.ts). */
export type WizardProfileContext = {
  deps: WizardDeps
  step: Atom<WizardStep>
  /** Bumped by every reset: an answer that lands after the run changed is dropped. */
  session: Atom<number>
  recentEvents: AtomLike<ReadonlyArray<HardwareBoardEvent>>
  actionError: Atom<string | null>
  waitFor: WaitFor
  rereadSnapshot: () => Promise<void>
  profileChoiceFor: (hardwareId: string) => WizardStep
  /** §4(c5): the scale answered `scale_user_slots_full`; create stays unavailable this run. */
  markSlotsFull: (hardwareId: string) => void
}

export type WizardFormError = ProfileFormField | 'save'

export type WizardProfileSteps = {
  /** The account's stored health profile when `ProfileSchema` accepts it (Decision 10), else null. */
  healthProfile: Computed<Profile | null>
  profileForm: Atom<ProfileFormInput>
  formError: Atom<WizardFormError | null>
  consent: Atom<string>
  consentValid: Computed<boolean>
  /** §4(c4): the step's hardware profiles nobody is bound to — the only ones attach may pick. */
  attachIndexes: Computed<ScaleUserIndex[]>
  /** §4(d2): read at the done step from `deps.hasWeightCard`. */
  boardNeedsWeightCard: Computed<boolean>
  create: WizardAsyncAction
  saveHealthAndCreate: WizardAsyncAction
  openAttach: Action<[], void>
  selectIndex: Action<[index: ScaleUserIndex], void>
  attach: WizardAsyncAction
  retry: WizardAsyncAction
  /** Loads the health model once; a failure is logged and the server decides on create. */
  loadHealth: Action<[], Promise<HealthModel | null>>
  /** Drops the form, the consent code, the last command and aborts the command wait. */
  reset: () => void
}

type PendingCommand = {
  hardwareId: string
  body: ProfileBody
  commandId: string
  /** `mine` indexes on the hardware before the request: a create's new index is the one not here. */
  mineBefore: ScaleUserIndex[]
}

export function makeWizardProfileSteps(ctx: WizardProfileContext): WizardProfileSteps {
  const { deps, step, session, recentEvents, actionError, waitFor, rereadSnapshot } = ctx
  const { hardware, client } = deps

  const healthModel = atom<HealthModel | null>(null, 'hardware.wizard.healthModel')
  const profileForm = atom<ProfileFormInput>(EMPTY_PROFILE_FORM, 'hardware.wizard.profileForm')
  const formError = atom<WizardFormError | null>(null, 'hardware.wizard.formError')
  const consent = atom('', 'hardware.wizard.consent')
  // The body `retry` re-sends (§4(c7)).
  const lastCommand = atom<{ hardwareId: string; body: ProfileBody } | null>(
    null,
    'hardware.wizard.lastCommand',
  )
  // One profile request at a time: a double click must not create two scale users.
  const sending = atom(false, 'hardware.wizard.sending')

  const healthProfile = computed(() => {
    const model = healthModel()
    if (model === null) return null
    const stored = model.profile()
    return isProfileComplete(stored) ? stored : null
  }, 'hardware.wizard.healthProfile')

  const consentValid = computed(
    () => ConsentCodeSchema.safeParse(consent()).success,
    'hardware.wizard.consentValid',
  )

  const attachIndexes = computed(() => {
    const current = step()
    if (!('hardwareId' in current)) return []
    const record = hardware.snapshot.data()?.hardware.find((h) => h.id === current.hardwareId)
    return (record?.profiles ?? []).filter((p) => p.binding === 'none').map((p) => p.index)
  }, 'hardware.wizard.attachIndexes')

  const boardNeedsWeightCard = computed(
    () => step().kind === 'done' && !deps.hasWeightCard(),
    'hardware.wizard.boardNeedsWeightCard',
  )

  const commandAnswer = computed(() => {
    const current = step()
    if (current.kind !== 'writing') return null
    const frame = recentEvents().find(
      (event): event is CommandFrame =>
        event.type === 'command' && event.commandId === current.commandId,
    )
    return frame ?? null
  }, 'hardware.wizard.commandAnswer')

  function mineIndexes(hardwareId: string): ScaleUserIndex[] {
    const record = hardware.snapshot.data()?.hardware.find((h) => h.id === hardwareId)
    return (record?.profiles ?? []).filter((p) => p.binding === 'mine').map((p) => p.index)
  }

  /** Review Focus 3 / Decision 9: the binding this command wrote, judged from the snapshot. */
  function newMineIndex(pending: PendingCommand): ScaleUserIndex | null {
    const now = mineIndexes(pending.hardwareId).filter((i) => !pending.mineBefore.includes(i))
    if (pending.body.mode === 'attach') {
      return now.includes(pending.body.index) ? pending.body.index : null
    }
    return now[0] ?? null
  }

  function currentWriting(commandId: string): WritingStep | null {
    const current = step()
    return current.kind === 'writing' && current.commandId === commandId ? current : null
  }

  function enterHealthForm(hardwareId: string) {
    if (step().kind !== 'healthForm') {
      profileForm.set(profileToForm(healthModel()?.profile() ?? null))
    }
    formError.set(null)
    step.set({ kind: 'healthForm', hardwareId })
  }

  const loadHealth = action(async () => {
    const loaded = healthModel()
    if (loaded !== null) return loaded
    const result = await wrap(deps.health())
    if (result instanceof Error) {
      console.warn('Hardware wizard health model unavailable:', result.message)
      return null
    }
    healthModel.set(result)
    return result
  }, 'hardware.wizard.loadHealth')

  async function revealCode(hardwareId: string, index: ScaleUserIndex) {
    const result = await wrap(client.revealConsentCode(hardwareId, index))
    if (result instanceof Error) {
      // The done step still shows; the code stays revealable from the hardware row.
      console.warn('Hardware consent code reveal failed:', result.message)
      return null
    }
    return result.consentCode
  }

  async function finishDone(pending: PendingCommand, index: ScaleUserIndex) {
    const consentCode =
      pending.body.mode === 'attach'
        ? pending.body.consentCode
        : await wrap(revealCode(pending.hardwareId, index))
    if (currentWriting(pending.commandId) === null) return
    step.set({ kind: 'done', hardwareId: pending.hardwareId, index, consentCode })
  }

  function applyFailure(pending: PendingCommand, reason: string | null) {
    const { hardwareId, body } = pending
    if (body.mode === 'attach' && reason === COMMAND_FAILURE_REASONS.consentRejected) {
      consent.set('')
      step.set({ kind: 'attach', hardwareId, index: body.index, error: 'consent' })
      return
    }
    if (reason === COMMAND_FAILURE_REASONS.slotsFull) {
      ctx.markSlotsFull(hardwareId)
      step.set(ctx.profileChoiceFor(hardwareId))
      return
    }
    step.set({ kind: 'scaleSilent', hardwareId, mode: body.mode })
  }

  // Decision 9: the `command` frame, or after SCALE_ANSWER_TIMEOUT_MS whatever the snapshot shows.
  const waitCommand = action(async (pending: PendingCommand) => {
    const frame = await wrap(waitFor(commandAnswer, SCALE_ANSWER_TIMEOUT_MS))
    if (currentWriting(pending.commandId) === null) return
    if (frame !== null && !frame.ok) {
      applyFailure(pending, frame.reason)
      return
    }
    if (frame !== null && pending.body.mode === 'attach') {
      await wrap(finishDone(pending, pending.body.index))
      return
    }
    // A lost answer (Review Focus 3), or a create whose new index only the snapshot knows.
    await wrap(rereadSnapshot())
    if (currentWriting(pending.commandId) === null) return
    const index = newMineIndex(pending)
    if (index === null) {
      if (frame !== null) console.warn('Hardware create answered ok but no new binding is visible')
      step.set({ kind: 'scaleSilent', hardwareId: pending.hardwareId, mode: pending.body.mode })
      return
    }
    await wrap(finishDone(pending, index))
  }, 'hardware.wizard.waitCommand').extend(withAbort())

  /** POSTs the create/attach, then waits for its answer in the `writing` step. */
  async function sendCommand(hardwareId: string, body: ProfileBody) {
    if (sending()) return
    const run = session()
    const origin = step()
    const mineBefore = mineIndexes(hardwareId)
    lastCommand.set({ hardwareId, body })
    actionError.set(null)
    sending.set(true)
    const result = await wrap(client.requestProfile(hardwareId, body))
    if (session() !== run) return
    sending.set(false)
    if (step() !== origin) return
    if (result instanceof Error) {
      if (isHardwareError(result, 'health_profile_missing')) {
        enterHealthForm(hardwareId)
        return
      }
      if (body.mode === 'attach' && isHardwareError(result, 'scale_profile_bound')) {
        step.set({ kind: 'attach', hardwareId, index: null, error: 'bound' })
        return
      }
      console.warn('Hardware profile request failed:', result.message)
      actionError.set(describeHardwareError(result))
      return
    }
    const { commandId } = result
    step.set({ kind: 'writing', hardwareId, mode: body.mode, commandId })
    launch(waitCommand({ hardwareId, body, commandId, mineBefore }), 'command wait')
  }

  const create = action(async () => {
    const current = step()
    if (current.kind !== 'profileChoice' || current.slotsFull) return
    const run = session()
    const health = await wrap(loadHealth())
    if (session() !== run || step() !== current) return
    // No health model: the server decides (409 health_profile_missing → the form).
    if (health !== null && !isProfileComplete(health.profile())) {
      enterHealthForm(current.hardwareId)
      return
    }
    await wrap(sendCommand(current.hardwareId, { mode: 'create' }))
  }, 'hardware.wizard.create').extend(withAsync())

  const saveHealthAndCreate = action(async () => {
    const current = step()
    if (current.kind !== 'healthForm') return
    const parsed = parseProfileForm(profileForm())
    if ('field' in parsed) {
      formError.set(parsed.field)
      return
    }
    formError.set(null)
    const run = session()
    const health = await wrap(loadHealth())
    if (session() !== run || step() !== current) return
    if (health === null) {
      formError.set('save')
      return
    }
    const saved = await wrap(health.setProfile(parsed))
    if (session() !== run || step() !== current) return
    if (saved instanceof Error) {
      console.warn('Hardware wizard health profile save failed:', saved.message)
      formError.set('save')
      return
    }
    await wrap(sendCommand(current.hardwareId, { mode: 'create' }))
  }, 'hardware.wizard.saveHealthAndCreate').extend(withAsync())

  const openAttach = action(() => {
    const current = step()
    if (current.kind !== 'profileChoice') return
    consent.set('')
    step.set({ kind: 'attach', hardwareId: current.hardwareId, index: null, error: null })
  }, 'hardware.wizard.openAttach')

  const selectIndex = action((index: ScaleUserIndex) => {
    const current = step()
    if (current.kind !== 'attach' || !attachIndexes().includes(index)) return
    step.set({ ...current, index, error: null })
  }, 'hardware.wizard.selectIndex')

  const attach = action(async () => {
    const current = step()
    if (current.kind !== 'attach' || current.index === null) return
    const parsed = ConsentCodeSchema.safeParse(consent())
    if (!parsed.success) return
    await wrap(
      sendCommand(current.hardwareId, {
        mode: 'attach',
        index: current.index,
        consentCode: parsed.data,
      }),
    )
  }, 'hardware.wizard.attach').extend(withAsync())

  const retry = action(async () => {
    const current = step()
    const last = lastCommand()
    if (current.kind !== 'scaleSilent' || last === null) return
    if (last.hardwareId !== current.hardwareId) return
    await wrap(sendCommand(last.hardwareId, last.body))
  }, 'hardware.wizard.retry').extend(withAsync())

  function reset() {
    waitCommand.abort()
    profileForm.set(EMPTY_PROFILE_FORM)
    formError.set(null)
    consent.set('')
    lastCommand.set(null)
    sending.set(false)
  }

  return {
    healthProfile,
    profileForm,
    formError,
    consent,
    consentValid,
    attachIndexes,
    boardNeedsWeightCard,
    create,
    saveHealthAndCreate,
    openAttach,
    selectIndex,
    attach,
    retry,
    loadHealth,
    reset,
  }
}
