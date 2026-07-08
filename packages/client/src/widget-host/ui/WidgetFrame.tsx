import { useEvent } from '@khmilevoi/use-event'
import { wrap } from '@reatom/core'
import { AlertTriangle } from 'lucide-react'
import { lazy, Suspense, useMemo } from 'react'
import {
  DEFAULT_TIERS,
  resolveTier,
  WidgetRuntimeContext,
  type WidgetMode,
  type WidgetRuntimeProps,
  type WidgetTier,
} from 'widget-runtime'
import { reatomMemo } from 'widget-sdk/reatom/reatom-memo'

import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { hostRuntime } from '@/runtime'
import { useElementSize } from '@/shared/element-size/model/use-element-size'
import { resolvedTheme } from '@/theme/model/theme-model'
import { findWidgetType } from '@/widget-registry/model/registry'

import { getWidgetReloadKey, retryWidget } from '../model/widget-frame-model'
import { WidgetErrorBoundary } from './WidgetErrorBoundary'

import styles from './WidgetFrame.module.css'

export type WidgetFrameProps = {
  instanceId: string
  typeId: string
  mode: WidgetMode
  /** Forces a tier (e.g. the fullscreen overlay). Omit to measure the rendered frame size instead. */
  tier?: WidgetTier
  onRequestFullscreen?: () => void
  onRequestClose?: () => void
  onDelete?: () => void
}

export const WidgetFrame = reatomMemo<WidgetFrameProps>(
  ({ instanceId, typeId, mode, tier: tierOverride, ...callbacks }) => {
    const type = findWidgetType(typeId)
    const theme = resolvedTheme()
    const reloadKey = getWidgetReloadKey(instanceId)
    const { width, height, ref } = useElementSize()

    const onDelete = useEvent(callbacks.onDelete ?? (() => null))
    const onRequestFullscreen = useEvent(callbacks.onRequestFullscreen ?? (() => null))
    const onRequestClose = useEvent(callbacks.onRequestClose ?? (() => null))

    const tiers = type instanceof Error ? DEFAULT_TIERS : (type.tiers ?? DEFAULT_TIERS)
    const tier = tierOverride ?? resolveTier({ width, height }, tiers)

    const LazyWidget = useMemo(() => {
      if (type instanceof Error) return null
      return lazy(type.loadComponent)
      // reloadKey is unused above but must stay a dependency: lazy() caches a
      // failed import's rejected promise, so retrying requires a fresh lazy()
      // call rather than reusing the memoized component.
      // oxlint-disable-next-line react-hooks/exhaustive-deps
    }, [type, reloadKey])

    const widgetStorage = useMemo(() => {
      return hostRuntime.makeWidgetStorage({ instanceId, typeId })
    }, [instanceId, typeId])
    const widgetApi = useMemo(() => {
      return hostRuntime.makeWidgetApi({ instanceId, typeId })
    }, [instanceId, typeId])

    const context = useMemo<WidgetRuntimeProps>(() => {
      return {
        instanceId,
        typeId,
        mode,
        tier,
        theme,
        requestFullscreen: onRequestFullscreen,
        requestClose: onRequestClose,
        requestDelete: onDelete,
        reportError: (error) => console.warn(`[widget ${instanceId}] error:`, error),
        storage: widgetStorage,
        api: widgetApi,
      }
    }, [
      instanceId,
      typeId,
      mode,
      tier,
      theme,
      onRequestFullscreen,
      onRequestClose,
      onDelete,
      widgetStorage,
      widgetApi,
    ])

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
                <button className={styles.delete} aria-label="Удалить" onClick={onDelete}>
                  Удалить
                </button>
              </div>
            )}
          </div>
        </div>
      )
    }

    return (
      <div className={styles.frame} data-widget-surface ref={ref}>
        <WidgetRuntimeContext.Provider value={context}>
          <WidgetErrorBoundary
            resetKey={reloadKey}
            onError={(error) =>
              console.warn(`[widget ${instanceId}] render failed:`, error.message)
            }
            onRetry={wrap(() => retryWidget(instanceId))}
            onDelete={onDelete}
          >
            <Suspense fallback={<Skeleton className={styles.skeleton} />}>
              {LazyWidget && <LazyWidget />}
            </Suspense>
          </WidgetErrorBoundary>
        </WidgetRuntimeContext.Provider>
      </div>
    )
  },
  'WidgetFrame',
)
