import { wrap } from '@reatom/core'
import { makeHardwareBoardClient } from '@shared/hardware/board-client'
import { makeEventSourceStream } from '@shared/http/event-stream'
import { X } from 'lucide-react'
import { useState } from 'react'
import { cn } from 'widget-sdk/lib/utils'
import { reatomMemo } from 'widget-sdk/reatom/reatom-memo'
import { PhoneSheetHeader, phoneSheetContentClassName } from 'widget-sdk/ui/phone-sheet'

import { Dialog, DialogClose, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { http } from '@/runtime'

import { type HardwareModel, makeHardwareModel } from '../model/hardware-model'
import { HardwareList } from './HardwareList'

import styles from './hardware.module.css'

export type HardwareDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Injectable for tests; defaults to one model per mounted dialog. */
  model?: HardwareModel
}

/**
 * One `Dialog.Root` with a view switch (`model.view`): the steps replace each other in the same
 * sheet, never stack (docs/agent/radix-stacked-dialogs.md). The list is the only view so far.
 */
export const HardwareDialog = reatomMemo<HardwareDialogProps>(
  ({ open, onOpenChange, model: modelOverride }) => {
    // One model per mounted dialog; sub-models (add-gateway, wizard) belong next to it, once.
    const [model] = useState(
      () =>
        modelOverride ??
        makeHardwareModel({
          client: makeHardwareBoardClient(http),
          openEventStream: makeEventSourceStream(),
        }),
    )

    const view = model.view()

    return (
      <Dialog
        open={open}
        onOpenChange={wrap((next: boolean) => {
          if (!next) model.reset()
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
              <DialogTitle className={styles.title}>Оборудование</DialogTitle>
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
              onAddGateway={() => model.view.set('addGateway')}
              onAddHardware={() => model.view.set('wizard')}
              onConnectProfile={() => model.view.set('wizard')}
            />
          ) : null}
          {/* Tasks 13 and 14 add the `addGateway` and `wizard` branches here. */}
        </DialogContent>
      </Dialog>
    )
  },
  'HardwareDialog',
)
