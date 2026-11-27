import { cn } from 'widget-sdk/lib/utils'
import { reatomMemo } from 'widget-sdk/reatom/reatom-memo'

import styles from './PassportFacts.module.css'

export type PassportFactsProps = {
  bodyCondition: number | null
  goalToday: number | null
  className?: string
}

/** The passport's "Упитанность" and "Цель в сутки"; each only when the cat has it. */
export const PassportFacts = reatomMemo<PassportFactsProps>(
  ({ bodyCondition, goalToday, className }) => (
    <div className={cn(styles.facts, className)}>
      {bodyCondition !== null && (
        <div>
          <span className={styles.label}>Упитанность</span>
          <p className={styles.fact}>{`${bodyCondition} / 9`}</p>
        </div>
      )}
      {goalToday !== null && (
        <div>
          <span className={styles.label}>Цель в сутки</span>
          <p className={styles.factLine}>
            <span className={styles.fact}>{goalToday}</span>{' '}
            <span className={styles.unit}>ккал</span>
          </p>
        </div>
      )}
    </div>
  ),
  'CatsPassportFacts',
)
