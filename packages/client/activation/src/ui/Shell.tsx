import type { ReactNode } from 'react'
import { reatomMemo } from 'widget-sdk/reatom/reatom-memo'

import { ThemeTogglePill } from './ThemeTogglePill'

import styles from './shell.module.css'

const BrandMark = reatomMemo(
  () => (
    <>
      <div aria-hidden className={styles.brandMark}>
        <div className={styles.brandCell} />
        <div className={styles.brandCellDim} />
        <div className={styles.brandCellDim} />
        <div className={styles.brandCell} />
      </div>
      <div className={styles.brandLabel}>myboard</div>
    </>
  ),
  'BrandMark',
)

export const Shell = reatomMemo<{ children: ReactNode }>(
  ({ children }) => (
    <div className={styles.page}>
      <ThemeTogglePill />
      <div className={styles.card}>
        <BrandMark />
        {children}
      </div>
    </div>
  ),
  'Shell',
)
