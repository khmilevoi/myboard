import type { HardwareSnapshot } from '@shared/hardware/board-api'
import { HARDWARE_MODELS } from '@shared/hardware/models'
import type { ScaleUserIndex } from '@shared/hardware/spike-assumptions'

import type { WizardStep } from './wizard-model'

/** «Поиск · Сопряжение · Профиль» (§4). */
export const WIZARD_STAGES = ['Поиск', 'Сопряжение', 'Профиль'] as const

export const WIZARD_DEFAULT_TITLE = 'Добавить оборудование'

/** The stepper's current stage (0-based), or null where the stepper is hidden (done). */
export function wizardStageIndex(step: WizardStep): number | null {
  switch (step.kind) {
    case 'scan':
      return 0
    case 'pairing':
    case 'pairingFailed':
      return 1
    case 'done':
      return null
    default:
      return 2
  }
}

/** §4: the header back button is drawn for pairing (b), the health form (c2) and attach (c3). */
export function wizardHasBack(step: WizardStep): boolean {
  return step.kind === 'pairing' || step.kind === 'healthForm' || step.kind === 'attach'
}

/** The model label of the hardware the step is about, from the snapshot record or the scan result. */
function stepHardwareLabel(step: WizardStep, snapshot: HardwareSnapshot | null): string | null {
  if (snapshot === null) return null
  if ('hardwareId' in step) {
    const record = snapshot.hardware.find((h) => h.id === step.hardwareId)
    return record === undefined ? null : HARDWARE_MODELS[record.model].label
  }
  if (step.kind !== 'pairing') return null
  const scanned = snapshot.gateways
    .flatMap((gateway) => gateway.scan?.results ?? [])
    .find((r) => r.address === step.address)
  return scanned === undefined ? null : HARDWARE_MODELS[scanned.model].label
}

/** The header title for a wizard step (§4). */
export function wizardTitle(
  step: WizardStep,
  gatewayOffline: boolean,
  snapshot: HardwareSnapshot | null,
): string {
  if (gatewayOffline || step.kind === 'scan') return WIZARD_DEFAULT_TITLE
  if (step.kind === 'healthForm') return 'Новый профиль'
  if (step.kind === 'attach') return 'Подключить профиль'
  return stepHardwareLabel(step, snapshot) ?? WIZARD_DEFAULT_TITLE
}

export type AttachOption = {
  index: ScaleUserIndex
  /** Only a profile nobody on this board is bound to can be attached. */
  selectable: boolean
  detail: string
}

const BINDING_DETAILS = {
  none: 'не привязан на этой борде',
  other: 'привязан к другому аккаунту',
  mine: 'уже привязан к вашему аккаунту',
} as const

/** §4(c3): every profile on the step's scale, in index order. */
export function attachOptions(
  hardwareId: string,
  snapshot: HardwareSnapshot | null,
): AttachOption[] {
  const record = snapshot?.hardware.find((h) => h.id === hardwareId)
  return [...(record?.profiles ?? [])]
    .sort((a, b) => a.index - b.index)
    .map((p) => ({
      index: p.index,
      selectable: p.binding === 'none',
      detail: BINDING_DETAILS[p.binding],
    }))
}
