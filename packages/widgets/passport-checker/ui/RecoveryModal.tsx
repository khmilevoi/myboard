import { wrap } from '@reatom/core'
import { AppWindow, Check, X } from 'lucide-react'
import { useRef } from 'react'
import { createPortal } from 'react-dom'
import { reatomMemo } from 'widget-sdk'

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

export type RecoveryModalProps = { restoreFullscreen: () => void }

export const RecoveryModal = reatomMemo(({ restoreFullscreen }: RecoveryModalProps) => {
  const { checkModel, recoveryModel, recoveryFlow } = usePassportChecker()
  const rootRef = useRef<HTMLDivElement | null>(null)

  const close = wrap(() => recoveryFlow.closeRecovery({ restore: restoreFullscreen }))
  const retry = wrap(() => recoveryFlow.retryCheck({ restore: restoreFullscreen }))

  useModalIsolation(rootRef, close)

  const view = checkModel.viewState()
  const sshTarget = view.kind === 'sessionRequired' ? view.sshTarget : null
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
            <AppWindow size={16} />
          </span>
          <div className={styles.headerText}>
            <div id="passport-recovery-title" className={styles.headerTitle}>
              Восстановление сессии браузера
            </div>
            <div className={styles.headerSubtitle}>Пройдите проверку в живом окне Chromium</div>
          </div>
          <span className={styles.accessPill} aria-label="Оставшееся время доступа">
            доступ · {formatAccessCountdown(remaining)}
          </span>
          <button
            type="button"
            className={styles.closeButton}
            title="Закрыть (Esc)"
            aria-label="Закрыть"
            onClick={close}
          >
            <X size={16} aria-hidden />
          </button>
        </header>
        <div className={styles.body}>
          <NoVncCanvas />
          <SshFallback sshTarget={sshTarget} />
        </div>
        <footer className={styles.footer}>
          <button type="button" className={styles.secondaryButton} onClick={close}>
            Закрыть
          </button>
          <button type="button" className={styles.primaryButton} onClick={retry}>
            <Check size={16} aria-hidden /> Повторить проверку
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  )
}, 'PassportCheckerRecoveryModal')
