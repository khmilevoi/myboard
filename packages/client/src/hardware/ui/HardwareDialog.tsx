import { wrap } from '@reatom/core'
import { makeHardwareBoardClient } from '@shared/hardware/board-client'
import { X } from 'lucide-react'
import { useState } from 'react'
import { cn } from 'widget-sdk/lib/utils'
import { reatomMemo } from 'widget-sdk/reatom/reatom-memo'
import { PhoneSheetHeader, phoneSheetContentClassName } from 'widget-sdk/ui/phone-sheet'

import { addInstance } from '@/board/model/board-model'
import { Dialog, DialogClose, DialogContent, DialogTitle } from 'widget-sdk/ui/dialog'
import { http } from '@/runtime'

import type { AddGatewayModel } from '../model/add-gateway-model'
import type { HardwareModel } from '../model/hardware-model'
import {
  type HardwareSession,
  makeHardwareSession,
  makeHardwareSubModels,
  WEIGHT_WIDGET_TYPE_ID,
} from '../model/hardware-session'
import type { WizardModel } from '../model/wizard-model'
import { AddGatewayView } from './AddGatewayView'
import { HardwareList } from './HardwareList'
import { WizardHeader, WizardView } from './WizardView'

import styles from './hardware.module.css'

export type HardwareDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Injectable for tests; defaults to one session (three models) per mounted dialog. */
  model?: HardwareModel
  addGatewayModel?: AddGatewayModel
  wizardModel?: WizardModel
}

// The wizard's title depends on its step (WizardHeader).
const VIEW_TITLES = {
  list: 'Оборудование',
  addGateway: 'Добавить шлюз',
} as const

/**
 * One `Dialog.Root` with a view switch (`model.view`): the steps replace each other in the same
 * sheet, never stack (docs/agent/radix-stacked-dialogs.md).
 */
export const HardwareDialog = reatomMemo<HardwareDialogProps>(
  ({ open, onOpenChange, model: modelOverride, addGatewayModel, wizardModel }) => {
    // One session per mounted dialog. The wizard is never disposed from an effect cleanup: the
    // dev StrictMode replay would deafen it for good; the sub-models are reset on close instead.
    const [session] = useState<HardwareSession>(() => {
      if (modelOverride === undefined) return makeHardwareSession()
      const subModels = makeHardwareSubModels(modelOverride, makeHardwareBoardClient(http))
      return {
        model: modelOverride,
        addGateway: addGatewayModel ?? subModels.addGateway,
        wizard: wizardModel ?? subModels.wizard,
      }
    })
    const { model, addGateway, wizard } = session

    const view = model.view()

    const changeOpen = wrap((next: boolean) => {
      if (!next) {
        model.reset()
        addGateway.reset()
        wizard.close()
      }
      onOpenChange(next)
    })
    // Read lazily: a reactive read here would keep the stream open while closed.
    const openScanOnOnlineGateway = () => {
      const onlineGatewayId = model.window()?.gateways.find((gateway) => gateway.online)?.id ?? null
      if (onlineGatewayId === null) return
      void wizard.openScan(onlineGatewayId)
      model.view.set('wizard')
    }

    return (
      <Dialog open={open} onOpenChange={changeOpen}>
        <DialogContent
          className={cn(phoneSheetContentClassName, styles.content)}
          overlayClassName={styles.overlay}
          data-testid="hardware-dialog"
          aria-describedby={undefined}
        >
          <PhoneSheetHeader>
            <div className={styles.header}>
              {view === 'wizard' ? (
                <WizardHeader wizard={wizard} hardware={model} />
              ) : (
                <DialogTitle className={styles.title}>{VIEW_TITLES[view]}</DialogTitle>
              )}
              <DialogClose asChild>
                <button type="button" aria-label="Закрыть" className={styles.close}>
                  <X size={16} strokeWidth={2} aria-hidden />
                </button>
              </DialogClose>
            </div>
          </PhoneSheetHeader>
          {view === 'list' ? (
            <HardwareList
              model={model}
              onAddGateway={() => {
                model.view.set('addGateway')
                void addGateway.start()
              }}
              onAddHardware={openScanOnOnlineGateway}
              onConnectProfile={(hardwareId) => {
                void wizard.openProfile(hardwareId)
                model.view.set('wizard')
              }}
            />
          ) : null}
          {view === 'addGateway' ? (
            <AddGatewayView
              model={addGateway}
              onAddHardware={openScanOnOnlineGateway}
              onDone={() => {
                addGateway.reset()
                model.view.set('list')
              }}
            />
          ) : null}
          {view === 'wizard' ? (
            <WizardView
              wizard={wizard}
              hardware={model}
              onAddWeightCard={() => {
                const added = addInstance(WEIGHT_WIDGET_TYPE_ID)
                if (added instanceof Error) {
                  console.warn('Adding the weight card failed:', added.message)
                  return
                }
                changeOpen(false)
              }}
              onDone={() => {
                wizard.close()
                model.view.set('list')
              }}
              onClose={() => changeOpen(false)}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    )
  },
  'HardwareDialog',
)
