import { wrap } from '@reatom/core'
import type { MouseEvent } from 'react'
import { Monitor, Moon, Sun } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { reatomMemo } from '../../shared/reatom/reatom-memo'
import type { ThemeMode } from '../../shared/theme/types'
import { themeMode } from '../model/theme-model'
import styles from './ThemeToggle.module.css'

const OPTIONS: { mode: ThemeMode; label: string; Icon: LucideIcon }[] = [
  { mode: 'light', label: 'Светлая тема', Icon: Sun },
  { mode: 'dark', label: 'Тёмная тема', Icon: Moon },
  { mode: 'system', label: 'Системная тема', Icon: Monitor },
]

function setMode(mode: ThemeMode, event: MouseEvent) {
  const root = document.documentElement
  root.style.setProperty('--vt-x', `${event.clientX}px`)
  root.style.setProperty('--vt-y', `${event.clientY}px`)

  const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  const startViewTransition = (
    document as Document & { startViewTransition?: (cb: () => void) => void }
  ).startViewTransition
  const applyMode = wrap(() => themeMode.set(mode))

  if (startViewTransition && !prefersReducedMotion) {
    startViewTransition.call(document, applyMode)
  } else {
    applyMode()
  }
}

export const ThemeToggle = reatomMemo(() => {
  const current = themeMode()
  return (
    <ToggleGroup
      type="single"
      value={current}
      aria-label="Тема"
      className={styles.group}
    >
      {OPTIONS.map(({ mode, label, Icon }) => (
        <ToggleGroupItem
          key={mode}
          value={mode}
          className={styles.item}
          aria-label={label}
          aria-pressed={current === mode}
          onClick={wrap((event: MouseEvent) => setMode(mode, event))}
        >
          <Icon size={16} strokeWidth={2.2} aria-hidden />
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}, 'ThemeToggle')
