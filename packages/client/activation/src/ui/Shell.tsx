import type { ReactNode } from 'react'
import { useLayoutEffect, useRef } from 'react'
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

// Animates the card body's height to follow its content: a ResizeObserver
// reads the inner height and the outer box transitions to it (CSS `height`
// cannot transition to `auto` in every browser yet). DOM interop only. The
// first measurement is applied without animation; without ResizeObserver
// (jsdom) the box simply stays auto-sized.
function AnimatedHeight({ children }: { children: ReactNode }) {
  const outerRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const outer = outerRef.current
    const inner = innerRef.current
    if (!outer || !inner || typeof ResizeObserver === 'undefined') return
    let first = true
    const observer = new ResizeObserver(() => {
      const height = `${inner.offsetHeight}px`
      if (first) {
        first = false
        const transition = outer.style.transition
        outer.style.transition = 'none'
        outer.style.height = height
        void outer.offsetHeight
        outer.style.transition = transition
        return
      }
      outer.style.height = height
    })
    observer.observe(inner)
    return () => observer.disconnect()
  }, [])

  return (
    <div ref={outerRef} className={styles.heightBox}>
      <div ref={innerRef} className={styles.heightInner}>
        {children}
      </div>
    </div>
  )
}

export const Shell = reatomMemo<{ children: ReactNode }>(
  ({ children }) => (
    <div className={styles.page}>
      <ThemeTogglePill />
      <div className={styles.card}>
        <BrandMark />
        <AnimatedHeight>{children}</AnimatedHeight>
      </div>
    </div>
  ),
  'Shell',
)
