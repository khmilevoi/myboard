import { wrap } from '@reatom/core'
import type { CSSProperties } from 'react'
import ReactGridLayout, { useContainerWidth, verticalCompactor } from 'react-grid-layout'

import { reatomMemo } from 'widget-sdk/reatom/reatom-memo'
import { WidgetFrame } from '@/widget-host/ui/WidgetFrame'

import { isBoardInteracting } from '../model/board-interaction-model'
import { expandedInstanceId, removeInstance, updateLayout } from '../model/board-model'
import { activeBoard } from '../model/board-storage'
import { EmptyState } from './EmptyState'

import styles from './Board.module.css'

export const Board = reatomMemo(() => {
  const board = activeBoard()
  const isInteracting = isBoardInteracting()
  const { width, containerRef } = useContainerWidth()

  if (!board || board.instances.length === 0) {
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
          layout={board.layout}
          gridConfig={{ cols: 12, rowHeight: 30 }}
          dragConfig={{
            enabled: true,
            handle: '.widget-drag-handle',
            cancel: 'button,input,textarea,select,a,[data-widget-drag-cancel]',
          }}
          resizeConfig={{ enabled: true, handles: ['se'] }}
          compactor={verticalCompactor}
          onDragStart={wrap(() => isBoardInteracting.setTrue())}
          onDragStop={wrap(() => isBoardInteracting.setFalse())}
          onResizeStart={wrap(() => isBoardInteracting.setTrue())}
          onResizeStop={wrap(() => isBoardInteracting.setFalse())}
          onLayoutChange={wrap((next) => updateLayout([...next]))}
        >
          {board.instances.map((instance, index) => (
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
