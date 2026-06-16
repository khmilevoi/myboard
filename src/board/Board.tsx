import { reatomComponent } from '@reatom/react'
import type { CSSProperties } from 'react'
import ReactGridLayout, { useContainerWidth, verticalCompactor } from 'react-grid-layout'
import { GripVertical, Maximize2, X } from 'lucide-react'
import {
  expandedInstanceId,
  instances,
  layout,
  removeInstance,
  updateLayout,
} from '../board-model/board-model'
import { WidgetFrame } from '../widget-host/WidgetFrame'
import { findWidgetType } from '../widget-registry/registry'
import { EmptyState } from './EmptyState'
import styles from './Board.module.css'

export const Board = reatomComponent(() => {
  const currentInstances = instances()
  const currentLayout = layout()
  const { width, containerRef } = useContainerWidth()

  if (currentInstances.length === 0) {
    return (
      <div className={styles.root}>
        <EmptyState />
      </div>
    )
  }

  return (
    <div className={styles.root}>
      <div ref={containerRef}>
        <ReactGridLayout
          className="layout"
          width={width || 1200}
          layout={currentLayout}
          gridConfig={{ cols: 12, rowHeight: 30 }}
          dragConfig={{ enabled: true, handle: '.widget-drag-handle', cancel: 'button,iframe' }}
          resizeConfig={{ enabled: true, handles: ['se'] }}
          compactor={verticalCompactor}
          onLayoutChange={(next) => updateLayout([...next])}
        >
          {currentInstances.map((instance, index) => {
            const type = findWidgetType(instance.typeId)
            const title = type instanceof Error ? instance.typeId : type.title
            return (
              <div key={instance.id} data-testid="widget-card" className={styles.gridItem}>
                <div className={styles.card} style={{ '--i': index } as CSSProperties}>
                  <div className={styles.header}>
                    <span className={`${styles.handle} widget-drag-handle`}>
                      <GripVertical className={styles.grip} size={14} aria-hidden />
                      {title}
                    </span>
                    <div className={styles.headerActions}>
                      <button
                        className={styles.iconButton}
                        aria-label="Expand"
                        onClick={() => expandedInstanceId.set(instance.id)}
                      >
                        <Maximize2 size={15} aria-hidden />
                      </button>
                      <button
                        className={styles.iconButton}
                        aria-label="Remove"
                        onClick={() => removeInstance(instance.id)}
                      >
                        <X size={15} aria-hidden />
                      </button>
                    </div>
                  </div>
                  <div className={styles.body}>
                    <WidgetFrame
                      instanceId={instance.id}
                      typeId={instance.typeId}
                      mode="small"
                      onRequestFullscreen={() => expandedInstanceId.set(instance.id)}
                    />
                  </div>
                </div>
              </div>
            )
          })}
        </ReactGridLayout>
      </div>
    </div>
  )
}, 'Board')
