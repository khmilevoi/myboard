import { wrap } from '@reatom/core'
import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { expandedInstanceId, instances } from '../../board/model/board-model'
import { reatomMemo } from '../../shared/reatom/reatom-memo'
import { findWidgetType } from '../../widget-registry/model/registry'
import { WidgetFrame } from './WidgetFrame'
import styles from './FullscreenOverlay.module.css'

export const FullscreenOverlay = reatomMemo(() => {
  const id = expandedInstanceId()
  const closeRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (id === null) return
    const previouslyFocused = document.activeElement as HTMLElement | null
    closeRef.current?.focus()

    const onKeyDown = wrap((event: KeyboardEvent) => {
      if (event.key === 'Escape') expandedInstanceId.set(null)
    })
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      previouslyFocused?.focus?.()
    }
  }, [id])

  if (id === null) return null

  const instance = instances().find((item) => item.id === id)
  if (!instance) return null

  const type = findWidgetType(instance.typeId)
  const title = type instanceof Error ? instance.typeId : type.title
  const close = wrap(() => expandedInstanceId.set(null))

  return (
    <div className={styles.backdrop} role="dialog" aria-modal="true" aria-label={title}>
      <div className={styles.bar}>
        <span className={styles.title}>{title}</span>
        <button ref={closeRef} className={styles.close} aria-label="Close" onClick={close}>
          <X size={18} aria-hidden />
        </button>
      </div>
      <div className={styles.body}>
        <WidgetFrame
          instanceId={instance.id}
          typeId={instance.typeId}
          mode="large"
          onRequestClose={close}
        />
      </div>
    </div>
  )
}, 'FullscreenOverlay')
