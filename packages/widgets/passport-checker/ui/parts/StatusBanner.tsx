import { Check, CircleAlert, IdCard, Settings, TriangleAlert } from 'lucide-react'
import { cn, reatomMemo } from 'widget-sdk'

// oxlint-disable-next-line no-restricted-imports -- ui/parts is nested two levels below the package's model/; the brief specifies this import verbatim.
import type { DocumentView, ResultsViewState, ViewState } from '../../model/check-model'

import styles from '../passport-checker.module.css'

export function getResultsActionLabel(view: ResultsViewState) {
  if (view.idCard.kind === 'retryable' || view.internationalPassport.kind === 'retryable') {
    return 'Повторить'
  }
  if (view.idCard.kind === 'unchecked' || view.internationalPassport.kind === 'unchecked') {
    return 'Проверить'
  }
  return 'Проверить снова'
}

export const StatusBanner = reatomMemo<{ label: string; view: DocumentView }>(({ label, view }) => {
  const role = view.kind === 'retryable' ? 'alert' : 'status'
  const modifier =
    view.kind === 'success'
      ? styles.bannerSuccess
      : view.kind === 'retryable'
        ? styles.bannerError
        : styles.bannerNeutral

  return (
    <div className={cn(styles.banner, modifier)} role={role}>
      {view.kind === 'success' ? (
        <span className={styles.successBadge} aria-hidden>
          <Check size={16} strokeWidth={2.6} />
        </span>
      ) : view.kind === 'retryable' ? (
        <CircleAlert className={styles.bannerIcon} size={18} aria-hidden />
      ) : (
        <IdCard className={styles.bannerIcon} size={18} aria-hidden />
      )}
      <div className={styles.bannerBody}>
        <div className={styles.bannerLabel}>{label}</div>
        <div className={styles.bannerTitle}>
          {view.kind === 'unchecked' ? 'Запустите общую проверку.' : view.message}
        </div>
        <div className={styles.bannerMeta}>
          {view.kind === 'success'
            ? `статус ${view.status} · проверено ${view.checkedAtLabel}`
            : view.kind === 'retryable'
              ? 'техническая ошибка'
              : 'ещё не проверен'}
        </div>
      </div>
    </div>
  )
}, 'PassportCheckerStatusBanner')

export const GlobalStatusBanner = reatomMemo<{ view: ViewState }>(({ view }) => {
  if (view.kind === 'retryable') {
    return (
      <div className={cn(styles.banner, styles.bannerError)} role="alert">
        <CircleAlert className={styles.bannerIcon} size={18} aria-hidden />
        <div className={styles.bannerBody}>
          <div className={styles.bannerTitle}>{view.message}</div>
          <div className={styles.bannerHint}>Попробуйте ещё раз.</div>
        </div>
      </div>
    )
  }
  if (view.kind === 'invalidConfig') {
    return (
      <div className={cn(styles.banner, styles.bannerMuted)} role="status">
        <Settings className={styles.bannerIcon} size={18} aria-hidden />
        <div className={styles.bannerBody}>
          <div className={styles.bannerTitle}>Паспорт-чекер не настроен</div>
          <div className={styles.bannerHint}>Обратитесь к администратору.</div>
        </div>
      </div>
    )
  }
  if (view.kind === 'sessionRequired') {
    return (
      <div className={cn(styles.banner, styles.bannerCentered, styles.bannerWarning)} role="status">
        <TriangleAlert className={styles.bannerIcon} size={19} aria-hidden />
        <div className={styles.bannerBody}>
          <div className={styles.bannerTitle}>Требуется вход в браузер</div>
          <div className={styles.bannerHint}>Автоматика уткнулась в капчу/вход</div>
        </div>
      </div>
    )
  }
  return null
}, 'PassportCheckerGlobalStatusBanner')
