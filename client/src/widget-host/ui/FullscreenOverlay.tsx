import { wrap } from '@reatom/core'
import { VisuallyHidden } from 'radix-ui'

import { expandedInstanceId, removeInstance } from '@/board/model/board-model'
import { activeBoard } from '@/board/model/board-storage'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { reatomMemo } from '@/shared/reatom/reatom-memo'
import { findWidgetType } from '@/widget-registry/model/registry'

import { WidgetFrame } from './WidgetFrame'

import styles from './FullscreenOverlay.module.css'

// The widget itself decides what chrome (title, badge, close button, …) to
// draw for its fullscreen content — see RichLayout's own header and Clock's
// deliberate lack of one. This dialog only provides the backdrop/panel and a
// screen-reader-only title, so there is never a second header stacked on top
// of the widget's.
export const FullscreenOverlay = reatomMemo(() => {
  const id = expandedInstanceId()
  if (id === null) return null

  const instance = activeBoard()?.instances?.find((item) => item.id === id)
  if (!instance) return null

  const type = findWidgetType(instance.typeId)
  const title = type instanceof Error ? instance.typeId : type.title
  const close = wrap(() => expandedInstanceId.set(null))

  return (
    <Dialog
      open
      onOpenChange={wrap((next: boolean) => {
        if (!next) close()
      })}
    >
      <DialogContent
        className={styles.panel}
        overlayClassName={styles.overlay}
        aria-describedby={undefined}
      >
        <VisuallyHidden.Root>
          <DialogTitle>{title}</DialogTitle>
        </VisuallyHidden.Root>
        <div className={styles.body}>
          <WidgetFrame
            instanceId={instance.id}
            typeId={instance.typeId}
            mode="large"
            tier="fullscreen"
            onRequestClose={close}
            onDelete={wrap(() => removeInstance(instance.id))}
          />
        </div>
      </DialogContent>
    </Dialog>
  )
}, 'FullscreenOverlay')
