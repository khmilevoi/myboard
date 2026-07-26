import { wrap } from '@reatom/core'
import { type CSSProperties } from 'react'
import ReactGridLayout, { useContainerWidth, verticalCompactor } from 'react-grid-layout'
import { reatomMemo } from 'widget-sdk/reatom/reatom-memo'

import { WidgetFrame } from '@/widget-host/ui/WidgetFrame'

import { isBoardInteracting } from '../model/board-interaction-model'
import {
  expandedInstanceId,
  materializeMobileLayout,
  removeInstance,
  updateLayout,
  updateMobileLayout,
} from '../model/board-model'
import { activeBoard } from '../model/board-storage'
import { resolveGridMetrics } from '../model/grid-metrics'
import { resolveBoardLayout } from '../model/mobile-layout'
import { EmptyState } from './EmptyState'

import styles from './Board.module.css'

const FALLBACK_WIDTH = 1200

export const Board = reatomMemo(() => {
  const board = activeBoard()
  const isInteracting = isBoardInteracting()
  const { width, containerRef } = useContainerWidth()
  const gridWidth = width || FALLBACK_WIDTH
  const metrics = resolveGridMetrics(gridWidth)

  return (
    <div className={styles.root} data-interacting={isInteracting} data-mobile={metrics.isMobile}>
      {/*
        This is the element useContainerWidth measures, and it must NEVER be
        rendered conditionally. The hook attaches its ResizeObserver from a
        single mount effect that bails out on a still-null ref and never
        re-runs (its `measureWidth` dependency is stable because `mounted`
        never flips). `board` is null on the first render while storage
        resolves, so putting this div behind an early empty-state return left
        the observer unattached and pinned `width` to the hook's 1280 default
        forever — the board could then never resolve mobile metrics in a real
        browser. Keep the empty state inside this div, not around it.
      */}
      <div ref={containerRef} data-testid="board-grid-container">
        {board && board.instances.length > 0 ? (
          <ReactGridLayout
            className="layout"
            width={gridWidth}
            layout={resolveBoardLayout(board, metrics.isMobile)}
            gridConfig={{
              cols: metrics.cols,
              rowHeight: metrics.rowHeight,
              margin: metrics.margin,
            }}
            dragConfig={{
              enabled: true,
              // On mobile the handle must NOT be the whole card: react-draggable
              // calls preventDefault on a touchstart that lands inside the handle
              // (Draggable.js:415, registered with { passive: false }), which would
              // block page scrolling on a board that is always taller than the
              // screen at one column.
              handle: metrics.isMobile ? '.widget-drag-grip' : '.widget-drag-handle',
              cancel: 'button,input,textarea,select,a,[data-widget-drag-cancel]',
            }}
            resizeConfig={{ enabled: true, handles: ['se'] }}
            compactor={verticalCompactor}
            onDragStart={wrap(() => {
              isBoardInteracting.setTrue()
              if (metrics.isMobile) materializeMobileLayout()
            })}
            onDragStop={wrap(() => isBoardInteracting.setFalse())}
            onResizeStart={wrap(() => {
              isBoardInteracting.setTrue()
              if (metrics.isMobile) materializeMobileLayout()
            })}
            onResizeStop={wrap(() => isBoardInteracting.setFalse())}
            onLayoutChange={wrap((next) => {
              // updateMobileLayout ignores the call until the field exists, so the
              // on-mount compaction pass cannot freeze the derived layout.
              if (metrics.isMobile) return updateMobileLayout([...next])
              updateLayout([...next])
            })}
          >
            {board.instances.map((instance, index) => (
              <div key={instance.id} data-testid="widget-card" className={styles.gridItem}>
                <div
                  className={`${styles.card} widget-drag-handle`}
                  style={{ '--i': index } as CSSProperties}
                >
                  <span
                    className={`${styles.grip} widget-drag-grip`}
                    data-testid="widget-drag-grip"
                    aria-hidden
                  />
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
        ) : (
          <EmptyState />
        )}
      </div>
    </div>
  )
}, 'Board')
