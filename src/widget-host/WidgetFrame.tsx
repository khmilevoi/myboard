import { reatomComponent } from '@reatom/react'
import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, RotateCw } from 'lucide-react'
import { env } from '../env'
import type { WidgetMode } from '../shared/widget-bridge'
import { resolvedTheme } from '../theme/theme-model'
import { findWidgetType } from '../widget-registry/registry'
import { createWidgetConnection, type WidgetConnection } from './widget-connection'
import styles from './WidgetFrame.module.css'

export type WidgetFrameProps = {
  instanceId: string
  typeId: string
  mode: WidgetMode
  onRequestFullscreen?: () => void
  onRequestClose?: () => void
}

type Status = 'connecting' | 'ready' | 'error'

function hasLoadedExpectedDocument(iframe: HTMLIFrameElement) {
  if (iframe.contentDocument?.readyState !== 'complete') return false
  try {
    return iframe.contentWindow?.location.href === iframe.src
  } catch {
    return false
  }
}

export const WidgetFrame = reatomComponent<WidgetFrameProps>((props) => {
  const { instanceId, typeId, mode, onRequestFullscreen, onRequestClose } = props
  const type = findWidgetType(typeId)
  const theme = resolvedTheme()
  const themeRef = useRef(theme)
  themeRef.current = theme
  const connectionRef = useRef<WidgetConnection | null>(null)
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
      theme: themeRef.current,
      handlers: {
        onRequestFullscreen,
        onRequestClose,
        onWidgetError: (message) => console.warn(`[widget ${instanceId}] error:`, message.message),
      },
    })
    connectionRef.current = connection

    let cancelled = false
    let handshakeStarted = false
    const startHandshake = async () => {
      if (handshakeStarted) return
      handshakeStarted = true
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

    iframe.addEventListener('load', startHandshake)
    if (hasLoadedExpectedDocument(iframe)) {
      void startHandshake()
    }
    return () => {
      cancelled = true
      iframe.removeEventListener('load', startHandshake)
      connection.close()
      connectionRef.current = null
    }
  }, [instanceId, type, mode, reloadKey, onRequestFullscreen, onRequestClose])

  // Push live theme changes into the widget without reloading the iframe.
  useEffect(() => {
    connectionRef.current?.send({ type: 'theme-change', theme })
  }, [theme])

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
    <div className={styles.frame}>
      <iframe
        ref={iframeRef}
        key={reloadKey}
        className={styles.iframe}
        title={`${typeId} (${instanceId})`}
        src={src}
      />
      {status === 'connecting' && <div className={styles.skeleton} aria-hidden />}
      {status === 'error' && (
        <div className={styles.errorCard}>
          <AlertTriangle className={styles.errorIcon} size={22} aria-hidden />
          <div>Widget failed to load</div>
          <button
            className={styles.retry}
            aria-label="Retry"
            onClick={() => setReloadKey((key) => key + 1)}
          >
            <RotateCw size={15} aria-hidden /> Retry
          </button>
        </div>
      )}
    </div>
  )
}, 'WidgetFrame')
