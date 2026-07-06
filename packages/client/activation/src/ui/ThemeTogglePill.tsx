import { wrap } from '@reatom/core'
import { Monitor, Moon, Sun } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { reatomMemo } from 'widget-sdk/reatom/reatom-memo'

import type { ThemeMode } from '@/shared/theme/types'
import { themeMode } from '@/theme/model/theme-model'

import styles from './ActivateScreen.module.css'

// Pixel dimensions here (34x34 items, gap 3, padding 4) come straight from
// Activate.dc.html and differ from the board host's own ThemeToggle, so this
// stays a page-scoped component rather than reusing that shared one.
const OPTIONS: { mode: ThemeMode; label: string; title: string; Icon: LucideIcon }[] = [
  { mode: 'light', label: 'Светлая тема', title: 'Светлая', Icon: Sun },
  { mode: 'dark', label: 'Тёмная тема', title: 'Тёмная', Icon: Moon },
  { mode: 'system', label: 'Как в системе', title: 'Системная', Icon: Monitor },
]

function setMode(mode: ThemeMode) {
  wrap(() => themeMode.set(mode))()
}

export const ThemeTogglePill = reatomMemo(() => {
  const current = themeMode()
  return (
    <div role="group" aria-label="Тема" className={styles.themeToggle}>
      {OPTIONS.map(({ mode, label, title, Icon }) => (
        <button
          key={mode}
          type="button"
          title={title}
          aria-label={label}
          data-state={current === mode ? 'on' : 'off'}
          className={styles.themeToggleItem}
          onClick={() => setMode(mode)}
        >
          <Icon size={16} strokeWidth={2} aria-hidden />
        </button>
      ))}
    </div>
  )
}, 'ThemeTogglePill')
