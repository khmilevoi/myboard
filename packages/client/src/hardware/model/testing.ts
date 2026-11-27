import { action, atom, computed, withAsync } from '@reatom/core'
import type { HardwareSnapshot, ScanResult } from '@shared/hardware/board-api'
import { type HardwareBoardClient, makeHardwareBoardClient } from '@shared/hardware/board-client'
import type { BleAddress } from '@shared/hardware/models'
import {
  ConsentCodeSchema,
  PairingPinSchema,
  type ScaleUserIndex,
} from '@shared/hardware/spike-assumptions'
import { makeFakeOpenEventStream } from '@shared/http/test/fake-event-stream'
import { makeScriptedHttp, type ScriptedStep } from '@shared/http/test/scripted-http'
import type { Profile } from 'module-health/domain/profile'

import { makeHardwareModel } from './hardware-model'
import { EMPTY_PROFILE_FORM, type ProfileFormInput } from './profile-form'
import type { WizardModel, WizardStep } from './wizard-model'
import type { WizardFormError } from './wizard-profile'

/** Test-only fixtures for the hardware UI. Import from tests only, never from production code. */

// Local noon, so «сегодня» and «вчера» labels agree in every time zone.
export const TEST_NOW = new Date(2026, 10, 27, 12, 0, 0).getTime()
export const TEST_ADDRESS = 'AA:BB:CC:DD:EE:01' as BleAddress

type Gateway = HardwareSnapshot['gateways'][number]
type Hardware = HardwareSnapshot['hardware'][number]

export function makeGateway(over: Partial<Gateway> = {}): Gateway {
  return {
    id: 'g1',
    label: 'Raspberry Pi',
    online: true,
    lastSeenAt: TEST_NOW,
    connectedAt: null,
    adapterPowered: true,
    scan: null,
    bondedNotAdopted: [],
    ...over,
  }
}

export function makeHardware(over: Partial<Hardware> = {}): Hardware {
  return {
    id: 'h1',
    gatewayId: 'g1',
    model: 'beurer-bf950',
    address: TEST_ADDRESS,
    battery: 80,
    lastReadingAt: null,
    profiles: [],
    ...over,
  }
}

export function makeSnapshot(
  gateways: Gateway[] = [],
  hardware: Hardware[] = [],
): HardwareSnapshot {
  return { gateways, hardware }
}

/**
 * A real `HardwareModel` over a scripted HTTP double and a fake event stream. `script` adds
 * responses for the actions a test triggers, `clientOverride` replaces whole client calls; `/api/hardware` serves `snapshot` for every refetch.
 */
export function makeTestHardwareModel(
  snapshot: HardwareSnapshot,
  script: Record<string, ScriptedStep[]> = {},
  clientOverride: Partial<HardwareBoardClient> = {},
) {
  const { http, calls } = makeScriptedHttp({
    '/api/hardware': Array.from({ length: 20 }, () => ({ status: 200, body: snapshot })),
    ...script,
  })
  const { open, streams } = makeFakeOpenEventStream()
  const model = makeHardwareModel({
    client: { ...makeHardwareBoardClient(http), ...clientOverride },
    openEventStream: open,
    now: () => TEST_NOW,
  })
  return { model, calls, streams }
}

export type FakeWizardState = {
  step?: WizardStep
  gatewayId?: string | null
  gatewayOffline?: boolean
  scanning?: boolean
  results?: ScanResult[]
  nothingFound?: boolean
  pin?: string
  pinEnabled?: boolean
  actionError?: string | null
  healthProfile?: Profile | null
  profileForm?: ProfileFormInput
  formError?: WizardFormError | null
  consent?: string
  attachIndexes?: ScaleUserIndex[]
  boardNeedsWeightCard?: boolean
}

/**
 * A `WizardModel` made of plain atoms: a view test puts it in any state directly. Every command
 * is a named action that only records its call (`calls`); `hold` keeps the named async commands
 * pending so `ready()` stays false.
 */
export function makeFakeWizardModel(state: FakeWizardState = {}, hold: string[] = []) {
  const calls: Array<[name: string, args: unknown[]]> = []
  const pending = new Promise<void>(() => {})
  const command = <Args extends unknown[]>(name: string) =>
    action(async (...args: Args) => {
      calls.push([name, args])
      if (hold.includes(name)) await pending
    }, `test.fakeWizard.${name}`).extend(withAsync())
  const sync = <Args extends unknown[]>(name: string) =>
    action((...args: Args) => {
      calls.push([name, args])
    }, `test.fakeWizard.${name}`)

  const pin = atom(state.pin ?? '', 'test.fakeWizard.pin')
  const consent = atom(state.consent ?? '', 'test.fakeWizard.consent')
  const model: WizardModel = {
    step: atom<WizardStep>(state.step ?? { kind: 'scan' }, 'test.fakeWizard.step'),
    gatewayId: atom(state.gatewayId === undefined ? 'g1' : state.gatewayId, 'test.fakeWizard.gw'),
    gatewayOffline: atom(state.gatewayOffline ?? false, 'test.fakeWizard.offline'),
    scanning: atom(state.scanning ?? false, 'test.fakeWizard.scanning'),
    results: atom(state.results ?? [], 'test.fakeWizard.results'),
    nothingFound: atom(state.nothingFound ?? false, 'test.fakeWizard.nothingFound'),
    pin,
    pinValid: computed(() => PairingPinSchema.safeParse(pin()).success, 'test.fakeWizard.pinValid'),
    pinEnabled: atom(state.pinEnabled ?? false, 'test.fakeWizard.pinEnabled'),
    actionError: atom(state.actionError ?? null, 'test.fakeWizard.actionError'),
    healthProfile: atom(state.healthProfile ?? null, 'test.fakeWizard.healthProfile'),
    profileForm: atom(state.profileForm ?? EMPTY_PROFILE_FORM, 'test.fakeWizard.profileForm'),
    formError: atom(state.formError ?? null, 'test.fakeWizard.formError'),
    consent,
    consentValid: computed(
      () => ConsentCodeSchema.safeParse(consent()).success,
      'test.fakeWizard.consentValid',
    ),
    attachIndexes: atom(state.attachIndexes ?? [], 'test.fakeWizard.attachIndexes'),
    boardNeedsWeightCard: atom(state.boardNeedsWeightCard ?? false, 'test.fakeWizard.weight'),
    create: command('create'),
    saveHealthAndCreate: command('saveHealthAndCreate'),
    openAttach: sync('openAttach'),
    selectIndex: sync<[ScaleUserIndex]>('selectIndex'),
    attach: command('attach'),
    retry: command('retry'),
    openScan: command<[string]>('openScan'),
    openProfile: command<[string]>('openProfile'),
    rescan: command('rescan'),
    choose: command<[ScanResult['address']]>('choose'),
    submitPin: command('submitPin'),
    back: sync('back'),
    close: sync('close'),
    dispose: () => {
      calls.push(['dispose', []])
    },
  }
  const called = (name: string) => calls.filter(([n]) => n === name).map(([, args]) => args)
  return { model, calls, called }
}
