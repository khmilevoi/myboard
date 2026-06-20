import { wrap } from "@reatom/core";
import type { CSSProperties } from "react";
import ReactGridLayout, {
  useContainerWidth,
  verticalCompactor,
} from "react-grid-layout";
import { GripVertical, Maximize2, X } from "lucide-react";
import { reatomMemo } from "../../shared/reatom/reatom-memo";
import { WidgetFrame } from "../../widget-host/ui/WidgetFrame";
import { DEFAULT_TIERS, resolveTier } from "../../widget-host/model/tier";
import { findWidgetType } from "../../widget-registry/model/registry";
import {
  beginBoardInteraction,
  endBoardInteraction,
  isBoardInteracting,
} from "../model/board-interaction-model";
import {
  expandedInstanceId,
  instances,
  layout,
  removeInstance,
  updateLayout,
} from "../model/board-model";
import { EmptyState } from "./EmptyState";
import styles from "./Board.module.css";

export const Board = reatomMemo(() => {
  const currentInstances = instances();
  const currentLayout = layout();
  const isInteracting = isBoardInteracting();
  const { width, containerRef } = useContainerWidth();

  if (currentInstances.length === 0) {
    return (
      <div className={styles.root}>
        <EmptyState />
      </div>
    );
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
            handle: ".widget-drag-handle",
            cancel: "button,input,textarea,select,a,[data-widget-drag-cancel]",
          }}
          resizeConfig={{ enabled: true, handles: ["se"] }}
          compactor={verticalCompactor}
          onDragStart={wrap(() => beginBoardInteraction())}
          onDragStop={wrap(() => endBoardInteraction())}
          onResizeStart={wrap(() => beginBoardInteraction())}
          onResizeStop={wrap(() => endBoardInteraction())}
          onLayoutChange={wrap((next) => updateLayout([...next]))}
        >
          {currentInstances.map((instance, index) => {
            const type = findWidgetType(instance.typeId);
            const title = type instanceof Error ? instance.typeId : type.title;
            const layoutItem = currentLayout.find((item) => item.i === instance.id);
            const size = layoutItem ? { w: layoutItem.w, h: layoutItem.h } : { w: 0, h: 0 };
            const tiers = type instanceof Error ? DEFAULT_TIERS : type.tiers ?? DEFAULT_TIERS;
            const tier = resolveTier(size, tiers);
            return (
              <div
                key={instance.id}
                data-testid="widget-card"
                className={styles.gridItem}
              >
                <div
                  className={styles.card}
                  style={{ "--i": index } as CSSProperties}
                >
                  <div className={styles.header}>
                    <span className={`${styles.handle} widget-drag-handle`}>
                      <GripVertical
                        className={styles.grip}
                        size={14}
                        aria-hidden
                      />
                      {title}
                    </span>
                    <div className={styles.headerActions}>
                      <button
                        className={styles.iconButton}
                        aria-label="Развернуть"
                        onClick={wrap(() =>
                          expandedInstanceId.set(instance.id),
                        )}
                      >
                        <Maximize2 size={15} aria-hidden />
                      </button>
                      <button
                        className={styles.iconButton}
                        aria-label="Удалить"
                        onClick={wrap(() => removeInstance(instance.id))}
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
                      tier={tier}
                      onRequestFullscreen={wrap(() =>
                        expandedInstanceId.set(instance.id),
                      )}
                      onDelete={wrap(() => removeInstance(instance.id))}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </ReactGridLayout>
      </div>
    </div>
  );
}, "Board");
