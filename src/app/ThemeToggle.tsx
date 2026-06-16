import { reatomComponent } from '@reatom/react'
import type { MouseEvent } from 'react'
import { Monitor, Moon, Sun } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { ThemeMode } from '../shared/theme/types'
import { themeMode } from '../theme/theme-model'
import styles from './ThemeToggle.module.css'

const OPTIONS: { mode: ThemeMode; label: string; Icon: LucideIcon }[] = [
  { mode: 'light', label: 'Light', Icon: Sun },
  { mode: 'dark', label: 'Dark', Icon: Moon },
  { mode: 'system', label: 'System theme', Icon: Monitor },
]

function setMode(mode: ThemeMode, event: MouseEvent) {
  const root = document.documentElement
  root.style.setProperty('--vt-x', `${event.clientX}px`)
  root.style.setProperty('--vt-y', `${event.clientY}px`)

  const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  const startViewTransition = (
    document as Document & { startViewTransition?: (cb: () => void) => void }
  ).startViewTransition

  if (startViewTransition && !prefersReducedMotion) {
    startViewTransition(() => themeMode.set(mode))
  } else {
    themeMode.set(mode)
  }
}

export const ThemeToggle = reatomComponent(() => {
  const current = themeMode()
  return (
    <div className={styles.group} role="group" aria-label="Theme">
      {OPTIONS.map(({ mode, label, Icon }) => (
        <button
          key={mode}
          type="button"
          className={styles.button}
          aria-label={label}
          aria-pressed={current === mode}
          data-active={current === mode}
          onClick={(event) => setMode(mode, event)}
        >
          <Icon size={16} strokeWidth={2.2} aria-hidden />
        </button>
      ))}
    </div>
  )
}, 'ThemeToggle')
