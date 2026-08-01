import { wrap } from '@reatom/core'
import { Check, Monitor, X } from 'lucide-react'
import { useRef } from 'react'
import { createPortal } from 'react-dom'
import { reatomMemo } from 'widget-sdk'
import { useOverlayBackDismiss } from 'widget-sdk/hooks/use-overlay-back-dismiss'

import { NoVncCanvas } from './parts/NoVncCanvas'
import { SshFallback } from './parts/SshFallback'
import { usePassportChecker } from './passport-checker-context'
import { useModalIsolation } from './use-modal-isolation'

import styles from './recovery-modal.module.css'

export function formatAccessCountdown(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = String(totalSeconds % 60).padStart(2, '0')
  return `${minutes}:${seconds}`
}

export const RecoveryModal = reatomMemo(() => {
  const { checkModel, recoveryModel, recoveryFlow } = usePassportChecker()
  const rootRef = useRef<HTMLDivElement | null>(null)

  const close = wrap(() => recoveryFlow.closeRecovery())
  const retry = wrap(() => recoveryFlow.retryCheck())

  // The modal only mounts while recovery is open, so `open` is literally true.
  // `retry` deliberately does NOT go through here: it closes the modal by
  // transitioning the flow, and the effect cleanup hands the history entry back
  // on unmount.
  const requestDismiss = useOverlayBackDismiss(true, close)

  useModalIsolation(rootRef, requestDismiss)

  const view = checkModel.viewState()
  const sshTarget = view.kind === 'sessionRequired' ? view.sshTarget : null
  // Only read when sshTarget is non-null (i.e. view.kind is actually
  // 'sessionRequired' — the check-model already defaults this field), so the
  // fallback below never actually surfaces; it just satisfies the type when
  // view is some other kind.
  const novncPort = view.kind === 'sessionRequired' ? view.novncPort : 6080
  const remaining = recoveryModel.remainingMs()

  return createPortal(
    <div ref={rootRef} className={styles.overlay}>
      <div
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="passport-recovery-title"
      >
        <header className={styles.header}>
          <span className={styles.headerChip} aria-hidden>
            <Monitor size={16} />
          </span>
          <div className={styles.headerText}>
            <div id="passport-recovery-title" className={styles.headerTitle}>
              Восстановление сессии браузера
            </div>
            <div className={styles.headerSubtitle}>Пройдите проверку в живом окне Chromium</div>
          </div>
          <span className={styles.accessPill} aria-label="Оставшееся время доступа">
            <span className={styles.accessDot} aria-hidden />
            доступ · {formatAccessCountdown(remaining)}
          </span>
          <button
            type="button"
            className={styles.closeButton}
            title="Закрыть (Esc)"
            aria-label="Закрыть"
            onClick={requestDismiss}
          >
            <X size={15} aria-hidden />
          </button>
        </header>
        <div className={styles.body}>
          <NoVncCanvas />
          <SshFallback sshTarget={sshTarget} novncPort={novncPort} />
        </div>
        <footer className={styles.footer}>
          <button type="button" className={styles.secondaryButton} onClick={requestDismiss}>
            Закрыть
          </button>
          <button type="button" className={styles.primaryButton} onClick={retry}>
            <Check size={15} strokeWidth={2.2} aria-hidden /> Повторить проверку
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  )
}, 'PassportCheckerRecoveryModal')
