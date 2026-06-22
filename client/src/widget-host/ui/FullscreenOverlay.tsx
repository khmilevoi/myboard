import { wrap } from '@reatom/core'
import { CalendarDays, Clock, Cat, X } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import { expandedInstanceId, instances, removeInstance } from '@/board/model/board-model'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { reatomMemo } from '@/shared/reatom/reatom-memo'
import { findWidgetType, type WidgetIconName } from '@/widget-registry/model/registry'

import { WidgetFrame } from './WidgetFrame'

import styles from './FullscreenOverlay.module.css'

const WIDGET_ICONS: Record<WidgetIconName, LucideIcon> = {
  Clock,
  CalendarDays,
  Cat,
}

export const FullscreenOverlay = reatomMemo(() => {
  const id = expandedInstanceId()
  if (id === null) return null

  const instance = instances().find((item) => item.id === id)
  if (!instance) return null

  const type = findWidgetType(instance.typeId)
  const title = type instanceof Error ? instance.typeId : type.title
  const description = type instanceof Error ? '' : type.description
  const Icon = type instanceof Error ? null : WIDGET_ICONS[type.icon]
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
        <div className={styles.bar}>
          <div className={styles.heading}>
            {Icon && (
              <span className={styles.tile}>
                <Icon size={18} aria-hidden />
              </span>
            )}
            <div className={styles.titleBlock}>
              <div className={styles.titleRow}>
                <DialogTitle className={styles.title}>{title}</DialogTitle>
                <Badge variant="secondary" className={styles.badge}>
                  large
                </Badge>
              </div>
              {description && <div className={styles.subtitle}>{description}</div>}
            </div>
          </div>
          <button className={styles.close} aria-label="Закрыть" onClick={close}>
            <X size={18} aria-hidden />
          </button>
        </div>
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
