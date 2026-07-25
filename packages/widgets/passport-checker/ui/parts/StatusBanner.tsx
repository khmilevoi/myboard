import { Check, CircleAlert, Settings, TriangleAlert } from 'lucide-react'
import { cn, reatomMemo } from 'widget-sdk'

// oxlint-disable-next-line no-restricted-imports -- ui/parts is nested two levels below the package's model/; the brief specifies this import verbatim.
import type { ViewState } from '../../model/check-model'

import styles from '../passport-checker.module.css'

export const StatusBanner = reatomMemo<{ view: ViewState }>(({ view }) => {
  if (view.kind === 'success') {
    return (
      <div className={cn(styles.banner, styles.bannerCentered, styles.bannerSuccess)} role="status">
        <span className={styles.successBadge} aria-hidden>
          <Check size={16} strokeWidth={2.6} />
        </span>
        <div className={styles.bannerBody}>
          <div className={styles.bannerTitle}>{view.message}</div>
          <div className={styles.bannerMeta}>
            статус {view.status} · проверено {view.checkedAtLabel}
          </div>
        </div>
      </div>
    )
  }
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
        </div>
      </div>
    )
  }
  return null
}, 'PassportCheckerStatusBanner')
