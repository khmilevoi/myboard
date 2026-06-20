import { wrap } from "@reatom/core";
import { lazy, Suspense, useMemo } from "react";
import { AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { reatomMemo } from "../../shared/reatom/reatom-memo";
import { resolvedTheme } from "../../theme/model/theme-model";
import { findWidgetType } from "../../widget-registry/model/registry";
import type { WidgetMode } from "../model/types";
import type { WidgetTier } from "../model/tier";
import { getWidgetReloadKey, retryWidget } from "../model/widget-frame-model";
import { WidgetErrorBoundary } from "./WidgetErrorBoundary";
import { WidgetFrameContext, widgetFrameContext } from "./WidgetFrame.context";
import styles from "./WidgetFrame.module.css";
import { createWidgetStorage } from "@/storage/model/widget-storage";

export type WidgetFrameProps = {
  instanceId: string;
  typeId: string;
  mode: WidgetMode;
  tier: WidgetTier;
  onRequestFullscreen?: () => void;
  onRequestClose?: () => void;
  onDelete?: () => void;
};

export const WidgetFrame = reatomMemo<WidgetFrameProps>(
  ({
    instanceId,
    typeId,
    mode,
    tier,
    onRequestFullscreen,
    onRequestClose,
    onDelete,
  }) => {
    const type = findWidgetType(typeId);
    const theme = resolvedTheme();
    const reloadKey = getWidgetReloadKey(instanceId);

    const LazyWidget = useMemo(() => {
      if (type instanceof Error) return null;
      return lazy(type.loadComponent);
    }, [type, reloadKey]);

    const context = useMemo<WidgetFrameContext>(() => {
      return {
        instanceId,
        typeId,
        mode,
        tier,
        theme,
        requestFullscreen: () => onRequestFullscreen?.(),
        requestClose: () => onRequestClose?.(),
        reportError: (error) =>
          console.warn(`[widget ${instanceId}] error:`, error),
        storage: createWidgetStorage({ instanceId, typeId }),
      };
    }, [
      instanceId,
      typeId,
      mode,
      tier,
      theme,
      onRequestFullscreen,
      onRequestClose,
    ]);

    if (type instanceof Error) {
      return (
        <div className={styles.frame}>
          <div className={styles.errorCard}>
            <span className={styles.errorTile}>
              <AlertTriangle size={22} aria-hidden />
            </span>
            <div className={styles.errorTitle}>Виджет не отвечает</div>
            <div className={styles.errorText}>{type.message}</div>
            <Badge variant="outline" className={styles.errorBadge}>
              {type.name}
            </Badge>
            {onDelete && (
              <div className={styles.errorActions}>
                <button
                  className={styles.delete}
                  aria-label="Удалить"
                  onClick={onDelete}
                >
                  Удалить
                </button>
              </div>
            )}
          </div>
        </div>
      );
    }

    return (
      <div className={styles.frame} data-widget-surface>
        <widgetFrameContext.Provider value={context}>
          <WidgetErrorBoundary
            resetKey={reloadKey}
            onError={(error) =>
              console.warn(
                `[widget ${instanceId}] render failed:`,
                error.message,
              )
            }
            onRetry={wrap(() => retryWidget(instanceId))}
            onDelete={onDelete}
          >
            <Suspense fallback={<Skeleton className={styles.skeleton} />}>
              {LazyWidget && (
                <LazyWidget
                  instanceId={instanceId}
                  typeId={typeId}
                  mode={mode}
                  tier={tier}
                  theme={theme}
                  requestFullscreen={context.requestFullscreen}
                  requestClose={context.requestClose}
                  reportError={context.reportError}
                  storage={context.storage}
                />
              )}
            </Suspense>
          </WidgetErrorBoundary>
        </widgetFrameContext.Provider>
      </div>
    );
  },
  "WidgetFrame",
);
