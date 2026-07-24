import { wrap } from '@reatom/core'
import { AppWindow, Check, IdCard, RefreshCw } from 'lucide-react'
import { cn, reatomMemo } from 'widget-sdk'

import { StatusBanner } from '../parts/StatusBanner'
import { usePassportChecker } from '../passport-checker-context'

import styles from '../passport-checker.module.css'

export const StandardTier = reatomMemo(() => {
  const { checkModel } = usePassportChecker()
  const view = checkModel.viewState()
  const check = wrap(() => {
    void checkModel.checkPassport()
  })
  const openRecovery = wrap(() => checkModel.recoveryOpen.set(true))

  return (
    <div className={styles.standard}>
      <header className={styles.header}>
        <span
          className={cn(styles.iconChip, view.kind === 'invalidConfig' && styles.iconChipMuted)}
          aria-hidden
        >
          <IdCard size={16} />
        </span>
        <span className={styles.title}>Паспорт</span>
      </header>

      {view.kind === 'idle' && <p className={styles.description}>Проверка статуса паспорта</p>}
      {view.kind === 'pending' && (
        <div className={styles.pendingRow} role="status">
          <span className={styles.spinner} aria-hidden />
          Проверяем…
        </div>
      )}
      <StatusBanner view={view} />

      {(view.kind === 'idle' || view.kind === 'pending') && (
        <button
          type="button"
          className={styles.primaryButton}
          disabled={view.kind === 'pending'}
          onClick={check}
        >
          <Check size={16} aria-hidden /> Проверить
        </button>
      )}
      {view.kind === 'success' && (
        <button type="button" className={styles.secondaryButton} onClick={check}>
          <RefreshCw size={15} aria-hidden /> Проверить снова
        </button>
      )}
      {view.kind === 'retryable' && (
        <button type="button" className={styles.secondaryButton} onClick={check}>
          <RefreshCw size={15} aria-hidden /> Повторить
        </button>
      )}
      {view.kind === 'sessionRequired' && (
        <button type="button" className={styles.primaryButton} onClick={openRecovery}>
          <AppWindow size={16} aria-hidden /> Открыть восстановление
        </button>
      )}
      {view.kind === 'invalidConfig' && (
        <div className={styles.footerNote}>действие недоступно · нужна настройка на сервере</div>
      )}
    </div>
  )
}, 'PassportCheckerStandardTier')
