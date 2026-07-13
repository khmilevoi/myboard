import { wrap } from '@reatom/core'
import { Monitor, Moon, Sun } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { reatomMemo } from 'widget-sdk/reatom/reatom-memo'

import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import type { ThemeMode } from '@/shared/theme/types'
import { themeMode } from '@/theme/model/theme-model'

import styles from './ThemeTogglePill.module.css'

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
    <ToggleGroup type="single" value={current} aria-label="Тема" className={styles.themeToggle}>
      {OPTIONS.map(({ mode, label, title, Icon }) => (
        <ToggleGroupItem
          key={mode}
          value={mode}
          title={title}
          aria-label={label}
          className={styles.themeToggleItem}
          onClick={() => setMode(mode)}
        >
          <Icon size={16} strokeWidth={2} aria-hidden />
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}, 'ThemeTogglePill')
