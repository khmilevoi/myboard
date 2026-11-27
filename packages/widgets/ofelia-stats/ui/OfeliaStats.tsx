import { wrap } from '@reatom/core'
import { EMPTY_LITTER_TEXT } from 'module-cats/format'
import { CatCardHeader } from 'module-cats/ui/CatCardHeader'
import { LitterSwitcher } from 'module-cats/ui/LitterSwitcher'
import { useManageCats } from 'module-cats/ui/use-manage-cats'
import { useMemo, type ReactNode } from 'react'
import { useWidgetContext } from 'widget-runtime'
import { reatomMemo } from 'widget-sdk/reatom/reatom-memo'
import { useAtomValue } from 'widget-sdk/reatom/use-atom-value'
import {
  WidgetControls,
  notReadyChrome,
  useWidgetChrome,
  type WidgetChrome,
} from 'widget-sdk/ui/WidgetControls'

import { makeStatsView } from '../model/stats-view'

import styles from './ofelia-stats.module.css'

// A state that is not ready has no header row: the controls float in the corner.
function renderNotReady(chrome: WidgetChrome, children: ReactNode) {
  return (
    <div className={styles.widget}>
      <WidgetControls placement="overlay" {...notReadyChrome(chrome)} />
      {children}
    </div>
  )
}

function renderLoadError(chrome: WidgetChrome, onRetry: () => void) {
  return renderNotReady(
    chrome,
    <div className={styles.note} role="alert">
      <p>Не удалось загрузить данные</p>
      <button type="button" onClick={onRetry}>
        Повторить
      </button>
    </div>,
  )
}

export const OfeliaStats = reatomMemo(() => {
  const { modules, storage } = useWidgetContext()
  // Up here, before any early return: every branch draws the controls.
  const chrome = useWidgetChrome()
  const manage = useManageCats()
  const view = useMemo(
    () => makeStatsView({ modules, storage: storage.instance.server }),
    [modules, storage],
  )
  const onRetry = useMemo(() => wrap(() => view.retry()), [view])
  const onRetryLedger = useMemo(() => wrap(() => view.retryLedger()), [view])

  // Read unconditionally so the hook set stays fixed whichever branch returns.
  const rows = useAtomValue(view.rows)
  const error = useAtomValue(view.error)
  const loadFailed = useAtomValue(view.loadFailed)
  const empty = useAtomValue(view.empty)
  const current = useAtomValue(view.choice.current)

  // Never a hard-coded litter: with none offered the card says why (ruling 10).
  if (empty) {
    return renderNotReady(
      chrome,
      <p role="status" className={styles.empty}>
        {EMPTY_LITTER_TEXT}
      </p>,
    )
  }

  if (rows === null || current === null) {
    // A failed module chunk or a failed ledger or settings read is a real failure with a
    // way out, not an endless "Загрузка…".
    if (error) return renderLoadError(chrome, onRetry)
    if (loadFailed) return renderLoadError(chrome, onRetryLedger)
    return renderNotReady(chrome, <p className={styles.note}>Загрузка…</p>)
  }

  return (
    <div className={styles.widget}>
      <CatCardHeader
        icon={null}
        title={current.title}
        switcher={<LitterSwitcher choice={view.choice} manage={manage} variant="menu" />}
        chrome={chrome}
      />
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
            <span className={`${styles.stat} ${styles.debt}`}>
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
