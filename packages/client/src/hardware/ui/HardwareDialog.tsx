import { wrap } from '@reatom/core'
import { makeHardwareBoardClient } from '@shared/hardware/board-client'
import { X } from 'lucide-react'
import { useState } from 'react'
import { cn } from 'widget-sdk/lib/utils'
import { reatomMemo } from 'widget-sdk/reatom/reatom-memo'
import { PhoneSheetHeader, phoneSheetContentClassName } from 'widget-sdk/ui/phone-sheet'

import { Dialog, DialogClose, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { http } from '@/runtime'

import type { AddGatewayModel } from '../model/add-gateway-model'
import type { HardwareModel } from '../model/hardware-model'
import {
  type HardwareSession,
  makeHardwareSession,
  makeHardwareSubModels,
} from '../model/hardware-session'
import type { WizardModel } from '../model/wizard-model'
import { AddGatewayView } from './AddGatewayView'
import { HardwareList } from './HardwareList'

import styles from './hardware.module.css'

export type HardwareDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Injectable for tests; defaults to one session (three models) per mounted dialog. */
  model?: HardwareModel
  addGatewayModel?: AddGatewayModel
  wizardModel?: WizardModel
}

const VIEW_TITLES = {
  list: 'Оборудование',
  addGateway: 'Добавить шлюз',
  wizard: 'Добавить оборудование',
} as const

/**
 * One `Dialog.Root` with a view switch (`model.view`): the steps replace each other in the same
 * sheet, never stack (docs/agent/radix-stacked-dialogs.md). The list is the only view so far.
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

    return (
      <Dialog
        open={open}
        onOpenChange={wrap((next: boolean) => {
          if (!next) {
            model.reset()
            addGateway.reset()
            wizard.close()
          }
          onOpenChange(next)
        })}
      >
        <DialogContent
          className={cn(phoneSheetContentClassName, styles.content)}
          overlayClassName={styles.overlay}
          data-testid="hardware-dialog"
          aria-describedby={undefined}
        >
          <PhoneSheetHeader>
            <div className={styles.header}>
              {/* The wizard view's back button goes here (Task 14). */}
              <DialogTitle className={styles.title}>{VIEW_TITLES[view]}</DialogTitle>
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
              onAddHardware={() => model.view.set('wizard')}
              onConnectProfile={() => model.view.set('wizard')}
            />
          ) : null}
          {view === 'addGateway' ? (
            <AddGatewayView
              model={addGateway}
              onAddHardware={() => {
                // Read lazily: a reactive read here would keep the stream open while closed.
                const onlineGatewayId =
                  model.window()?.gateways.find((gateway) => gateway.online)?.id ?? null
                if (onlineGatewayId === null) return
                void wizard.openScan(onlineGatewayId)
                model.view.set('wizard')
              }}
              onDone={() => {
                addGateway.reset()
                model.view.set('list')
              }}
            />
          ) : null}
          {/* Task 14 adds the `wizard` branch here; until then it renders nothing. */}
        </DialogContent>
      </Dialog>
    )
  },
  'HardwareDialog',
)
