import { wrap } from '@reatom/core'
import type { CSSProperties } from 'react'
import ReactGridLayout, { useContainerWidth, verticalCompactor } from 'react-grid-layout'

import { reatomMemo } from '@/shared/reatom/reatom-memo'
import { WidgetFrame } from '@/widget-host/ui/WidgetFrame'

import {
  beginBoardInteraction,
  endBoardInteraction,
  isBoardInteracting,
} from '../model/board-interaction-model'
import {
  expandedInstanceId,
  instances,
  layout,
  removeInstance,
  updateLayout,
} from '../model/board-model'
import { EmptyState } from './EmptyState'

import styles from './Board.module.css'

export const Board = reatomMemo(() => {
  const currentInstances = instances()
  const currentLayout = layout()
  const isInteracting = isBoardInteracting()
  const { width, containerRef } = useContainerWidth()

  if (currentInstances.length === 0) {
    return (
      <div className={styles.root}>
        <EmptyState />
      </div>
    )
  }

  return (
    <div className={styles.root} data-interacting={isInteracting}>
      <div ref={containerRef}>
        <ReactGridLayout
          className="layout"
          width={width || 1200}
          layout={currentLayout}
          gridConfig={{ cols: 12, rowHeight: 30 }}
          dragConfig={{
            enabled: true,
            handle: '.widget-drag-handle',
            cancel: 'button,input,textarea,select,a,[data-widget-drag-cancel]',
          }}
          resizeConfig={{ enabled: true, handles: ['se'] }}
          compactor={verticalCompactor}
          onDragStart={wrap(() => beginBoardInteraction())}
          onDragStop={wrap(() => endBoardInteraction())}
          onResizeStart={wrap(() => beginBoardInteraction())}
          onResizeStop={wrap(() => endBoardInteraction())}
          onLayoutChange={wrap((next) => updateLayout([...next]))}
        >
          {currentInstances.map((instance, index) => (
            <div key={instance.id} data-testid="widget-card" className={styles.gridItem}>
              <div
                className={`${styles.card} widget-drag-handle`}
                style={{ '--i': index } as CSSProperties}
              >
                <div className={styles.body}>
                  <WidgetFrame
                    instanceId={instance.id}
                    typeId={instance.typeId}
                    mode="small"
                    onRequestFullscreen={wrap(() => expandedInstanceId.set(instance.id))}
                    onDelete={wrap(() => removeInstance(instance.id))}
                  />
                </div>
              </div>
            </div>
          ))}
        </ReactGridLayout>
      </div>
    </div>
  )
}, 'Board')
