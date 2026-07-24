import { wrap } from '@reatom/core'
import { Unlink } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { cn, reatomMemo } from 'widget-sdk'

// oxlint-disable-next-line no-restricted-imports -- ui/parts is nested two levels below the package's model/; the brief specifies this import verbatim.
import type { RecoveryState } from '../../model/recovery-model'
import { usePassportChecker } from '../passport-checker-context'

import styles from '../recovery-modal.module.css'

const FRAME_COPY: Record<RecoveryState['kind'], { title: string; hint?: string }> = {
  issuing: { title: 'Подключение…', hint: 'запрашиваем доступ к сессии' },
  connecting: { title: 'Подключение…', hint: 'устанавливаем WebSocket к noVNC' },
  connected: { title: '' },
  disconnected: { title: 'Соединение разорвано' },
  expired: { title: 'Срок доступа истёк' },
  unavailable: { title: 'Нет активной сессии для восстановления' },
  busy: { title: 'Восстановление уже идёт' },
  automationDown: { title: 'Сервис автоматизации недоступен' },
}

const RECONNECT_KINDS: ReadonlySet<RecoveryState['kind']> = new Set([
  'disconnected',
  'expired',
  'unavailable',
  'busy',
  'automationDown',
])

export const NoVncCanvas = reatomMemo(() => {
  const { recoveryModel } = usePassportChecker()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const state = recoveryModel.state()

  const start = wrap((el: HTMLElement) => {
    void recoveryModel.start(el)
  })
  const teardown = wrap(() => recoveryModel.teardown())
  const reconnect = wrap(() => {
    const el = containerRef.current
    if (el) void recoveryModel.start(el)
  })

  useEffect(() => {
    const el = containerRef.current
    if (el) start(el)
    return () => teardown()
    // Mount-once: reconnects go through the model, not remounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const spinning = state.kind === 'issuing' || state.kind === 'connecting'
  const broken = state.kind === 'disconnected' || state.kind === 'expired'

  return (
    <div className={styles.frame}>
      <div ref={containerRef} className={styles.canvas} />
      {state.kind === 'connected' && (
        <>
          <span className={styles.liveBadge}>LIVE · 1280×720</span>
          <span className={styles.scaleCaption}>масштаб по ширине</span>
        </>
      )}
      {state.kind !== 'connected' && (
        <div className={cn(styles.frameOverlay, broken && styles.frameOverlayError)} role="status">
          {spinning && <span className={styles.frameSpinner} aria-hidden />}
          {broken && <Unlink size={22} aria-hidden />}
          <div className={styles.frameTitle}>{FRAME_COPY[state.kind].title}</div>
          {FRAME_COPY[state.kind].hint && (
            <div className={styles.frameHint}>{FRAME_COPY[state.kind].hint}</div>
          )}
          {RECONNECT_KINDS.has(state.kind) && (
            <button type="button" className={styles.reconnectButton} onClick={reconnect}>
              Переподключиться
            </button>
          )}
        </div>
      )}
    </div>
  )
}, 'PassportCheckerNoVncCanvas')
