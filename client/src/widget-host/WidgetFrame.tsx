import { reatomComponent } from '@reatom/react'
import { lazy, Suspense, useMemo, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { resolvedTheme } from '../theme/theme-model'
import { findWidgetType } from '../widget-registry/registry'
import type { WidgetMode } from './types'
import { WidgetErrorBoundary } from './WidgetErrorBoundary'
import styles from './WidgetFrame.module.css'

export type WidgetFrameProps = {
  instanceId: string
  typeId: string
  mode: WidgetMode
  onRequestFullscreen?: () => void
  onRequestClose?: () => void
}

export const WidgetFrame = reatomComponent<WidgetFrameProps>((props) => {
  const { instanceId, typeId, mode, onRequestFullscreen, onRequestClose } = props
  const type = findWidgetType(typeId)
  const theme = resolvedTheme()
  const [reloadKey, setReloadKey] = useState(0)

  const LazyWidget = useMemo(() => {
    if (type instanceof Error) return null
    return lazy(type.loadComponent)
  }, [type, reloadKey])

  if (type instanceof Error) {
    return (
      <div className={styles.frame}>
        <div className={styles.errorCard}>
          <AlertTriangle className={styles.errorIcon} size={22} aria-hidden />
          <div>Widget unavailable</div>
          <small>{type.message}</small>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.frame} data-widget-surface>
      <WidgetErrorBoundary
        resetKey={reloadKey}
        onError={(error) => console.warn(`[widget ${instanceId}] render failed:`, error.message)}
        onRetry={() => setReloadKey((key) => key + 1)}
      >
        <Suspense fallback={<div className={styles.skeleton} aria-hidden />}>
          {LazyWidget && (
            <LazyWidget
              instanceId={instanceId}
              typeId={typeId}
              mode={mode}
              theme={theme}
              requestFullscreen={() => onRequestFullscreen?.()}
              requestClose={() => onRequestClose?.()}
              reportError={(error) => console.warn(`[widget ${instanceId}] error:`, error)}
            />
          )}
        </Suspense>
      </WidgetErrorBoundary>
    </div>
  )
}, 'WidgetFrame')
