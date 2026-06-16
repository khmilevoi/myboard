import { reatomComponent } from '@reatom/react'
import { useEffect, useRef, useState } from 'react'
import { env } from '../env'
import { resolvedTheme } from '../theme/theme-model'
import type { WidgetMode } from '../shared/widget-bridge'
import { findWidgetType } from '../widget-registry/registry'
import { createWidgetConnection } from './widget-connection'
import styles from './WidgetFrame.module.css'

export type WidgetFrameProps = {
  instanceId: string
  typeId: string
  mode: WidgetMode
  onRequestFullscreen?: () => void
  onRequestClose?: () => void
}

type Status = 'connecting' | 'ready' | 'error'

export const WidgetFrame = reatomComponent((props: WidgetFrameProps) => {
  const { instanceId, typeId, mode, onRequestFullscreen, onRequestClose } = props
  const theme = resolvedTheme()
  const type = findWidgetType(typeId)
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const [status, setStatus] = useState<Status>('connecting')
  const [reloadKey, setReloadKey] = useState(0)

  const src =
    type instanceof Error
      ? ''
      : `${type.entry}?mode=${mode}&instanceId=${encodeURIComponent(instanceId)}`

  useEffect(() => {
    if (type instanceof Error) return
    const iframe = iframeRef.current
    if (!iframe) return
    setStatus('connecting')

    const connection = createWidgetConnection({
      instanceId,
      mode,
      targetOrigin: window.location.origin,
      theme,
      handlers: {
        onRequestFullscreen,
        onRequestClose,
        onWidgetError: (message) => console.warn(`[widget ${instanceId}] error:`, message.message),
      },
    })

    let cancelled = false
    const onLoad = async () => {
      const win = iframe.contentWindow
      if (!win) {
        setStatus('error')
        return
      }
      const result = await connection.handshake(win, env.VITE_WIDGET_HANDSHAKE_TIMEOUT_MS)
      if (cancelled) return
      setStatus(result instanceof Error ? 'error' : 'ready')
      if (result instanceof Error) {
        console.warn(`[widget ${instanceId}] handshake failed:`, result.message)
      }
    }

    iframe.addEventListener('load', onLoad)
    return () => {
      cancelled = true
      iframe.removeEventListener('load', onLoad)
      connection.close()
    }
  }, [instanceId, type, mode, theme, reloadKey, onRequestFullscreen, onRequestClose])

  if (type instanceof Error) {
    return (
      <div className={styles.frame}>
        <div className={styles.errorCard}>
          <div>Widget unavailable</div>
          <small>{type.message}</small>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.frame}>
      <iframe
        ref={iframeRef}
        key={reloadKey}
        className={styles.iframe}
        title={`${typeId} (${instanceId})`}
        src={src}
      />
      {status === 'error' && (
        <div className={styles.errorCard}>
          <div>Widget failed to load</div>
          <button className={styles.retry} onClick={() => setReloadKey((key) => key + 1)}>
            Retry
          </button>
        </div>
      )}
    </div>
  )
}, 'WidgetFrame')
