import { wrap } from '@reatom/core'
import { ChevronLeft } from 'lucide-react'
import { reatomMemo } from 'widget-sdk/reatom/reatom-memo'

import { DialogTitle } from '@/components/ui/dialog'

import type { HardwareModel } from '../model/hardware-model'
import type { WizardModel } from '../model/wizard-model'
import { wizardHasBack, wizardTitle } from '../model/wizard-view'
import { HealthProfileForm } from './HealthProfileForm'
import {
  AttachStep,
  DoneStep,
  ProfileChoiceStep,
  ScaleSilentStep,
  WritingStep,
} from './WizardProfileSteps'
import { OfflineStep, PairingFailedStep, PairingStep, ScanStep } from './WizardSteps'

import styles from './hardware.module.css'
import wizardStyles from './wizard.module.css'

export type WizardHeaderProps = {
  wizard: WizardModel
  hardware: HardwareModel
}

/**
 * The wizard's part of the dialog header: «Назад» on pairing / health form / attach, and the
 * step's title. Rendered only inside the open dialog content (it reads the snapshot).
 */
export const WizardHeader = reatomMemo<WizardHeaderProps>(({ wizard, hardware }) => {
  const step = wizard.step()
  const offline = wizard.gatewayOffline()
  const title = wizardTitle(step, offline, hardware.snapshot.data())
  // A create/attach in flight: going back would drop its 202 (the step changed mid-POST).
  const sending =
    !wizard.create.ready() ||
    !wizard.saveHealthAndCreate.ready() ||
    !wizard.attach.ready() ||
    !wizard.retry.ready()

  return (
    <>
      {wizardHasBack(step) && !offline ? (
        <button
          type="button"
          aria-label="Назад"
          className={wizardStyles.back}
          data-testid="hardware-wizard-back"
          disabled={sending}
          onClick={wrap(() => wizard.back())}
        >
          <ChevronLeft size={16} strokeWidth={2} aria-hidden />
        </button>
      ) : null}
      <DialogTitle className={styles.title}>{title}</DialogTitle>
    </>
  )
}, 'WizardHeader')

export type WizardViewProps = {
  wizard: WizardModel
  hardware: HardwareModel
  /** §4(d2): put a weight card on the board and close the dialog. */
  onAddWeightCard: () => void
  /** «Готово»: back to the list. */
  onDone: () => void
  /** §4(e) «Закрыть»: closes the dialog. */
  onClose: () => void
}

/** §4: the add-hardware wizard; one step at a time, the gateway-offline frame over all but done. */
export const WizardView = reatomMemo<WizardViewProps>(
  ({ wizard, hardware, onAddWeightCard, onDone, onClose }) => {
    const step = wizard.step()
    if (step.kind !== 'done' && wizard.gatewayOffline()) {
      return <OfflineStep wizard={wizard} onClose={onClose} />
    }
    switch (step.kind) {
      case 'scan':
        return <ScanStep wizard={wizard} />
      case 'pairing':
        return <PairingStep wizard={wizard} />
      case 'pairingFailed':
        return <PairingFailedStep wizard={wizard} />
      case 'profileChoice':
        return <ProfileChoiceStep wizard={wizard} hardware={hardware} />
      case 'healthForm':
        return <HealthProfileForm wizard={wizard} />
      case 'attach':
        return <AttachStep wizard={wizard} hardware={hardware} />
      case 'writing':
        return <WritingStep wizard={wizard} />
      case 'scaleSilent':
        return <ScaleSilentStep wizard={wizard} />
      case 'done':
        return <DoneStep wizard={wizard} onAddWeightCard={onAddWeightCard} onDone={onDone} />
    }
  },
  'WizardView',
)
