import { wrap } from '@reatom/core'
import { useMemo } from 'react'
import { useWidgetContext } from 'widget-runtime'
import { reatomMemo } from 'widget-sdk/reatom/reatom-memo'
import { useAtomValue } from 'widget-sdk/reatom/use-atom-value'

import { makeStatsView } from '../model/stats-view'

import styles from './ofelia-stats.module.css'

function renderLoadError(onRetry: () => void) {
  return (
    <div className={styles.widget}>
      <div className={styles.note} role="alert">
        <p>Не удалось загрузить данные</p>
        <button type="button" onClick={onRetry}>
          Повторить
        </button>
      </div>
    </div>
  )
}

export const OfeliaStats = reatomMemo(() => {
  const { modules } = useWidgetContext()
  const view = useMemo(() => makeStatsView(modules), [modules])
  const onRetry = useMemo(() => wrap(() => view.retry()), [view])
  const onRetryLedger = useMemo(() => wrap(() => view.retryLedger()), [view])

  // Read unconditionally so the hook set stays fixed whichever branch returns.
  const rows = useAtomValue(view.rows)
  const error = useAtomValue(view.error)
  const loadFailed = useAtomValue(view.loadFailed)

  if (rows === null) {
    // A failed module chunk or a failed ledger or settings read is a real failure with a
    // way out, not an endless "Загрузка…".
    if (error) return renderLoadError(onRetry)
    if (loadFailed) return renderLoadError(onRetryLedger)
    return (
      <div className={styles.widget}>
        <p className={styles.note}>Загрузка…</p>
      </div>
    )
  }

  return (
    <div className={styles.widget}>
      <ul className={styles.list}>
        {rows.map((row) => (
          <li key={row.person} className={styles.row}>
            <span className={styles.name}>{row.person}</span>
            <span className={styles.stat}>
              <span className={styles.label}>Уборок за 30 дней</span>
              <span className={styles.value} data-testid={`ofelia-stats-cleanings-${row.person}`}>
                {row.cleanings}
              </span>
            </span>
            <span className={styles.stat}>
              <span className={styles.label}>Долг</span>
              <span className={styles.value} data-testid={`ofelia-stats-debt-${row.person}`}>
                {row.debt}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}, 'OfeliaStats')
