import { wrap } from '@reatom/core'
import { Monitor, Moon, Sun } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { MouseEvent } from 'react'
import { reatomMemo } from 'widget-sdk/reatom/reatom-memo'

import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import type { ThemeMode } from '@/shared/theme/types'

import { cycleThemeMode, THEME_MODE_ORDER, themeMode } from '../model/theme-model'

import styles from './ThemeToggle.module.css'

const ICONS: Record<ThemeMode, LucideIcon> = { light: Sun, dark: Moon, system: Monitor }
const LABELS: Record<ThemeMode, string> = {
  light: 'Светлая тема',
  dark: 'Тёмная тема',
  system: 'Системная тема',
}

// The wide ToggleGroup's item order mirrors the model's cycle order so the
// compact button (narrow) advances through the same sequence it displays.
const OPTIONS = THEME_MODE_ORDER.map((mode) => ({ mode, label: LABELS[mode], Icon: ICONS[mode] }))

// Shared DOM interop for both controls: stamp the click coordinates the
// view-transition circle expands from, then run the model mutation inside
// (or outside, if unsupported/reduced-motion) startViewTransition. `wrap` is
// created fresh on every call -- this function itself only runs from inside
// a per-click JSX handler, never hoisted to module scope, so it never
// outlives a context.reset().
function applyWithViewTransition(event: MouseEvent, apply: () => void) {
  const root = document.documentElement
  root.style.setProperty('--vt-x', `${event.clientX}px`)
  root.style.setProperty('--vt-y', `${event.clientY}px`)

  const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  const startViewTransition = (
    document as Document & { startViewTransition?: (cb: () => void) => void }
  ).startViewTransition
  const runApply = wrap(apply)

  if (startViewTransition && !prefersReducedMotion) {
    startViewTransition.call(document, runApply)
  } else {
    runApply()
  }
}

/**
 * Renders both the wide three-item group and the narrow single cycling
 * button; ThemeToggle.module.css shows exactly one of them per viewport via
 * media queries (no matchMedia/resize listener/atom -- same approach the
 * rest of the header's responsiveness uses). display: none also removes the
 * hidden control from the accessibility tree, so nothing is announced twice.
 */
export const ThemeToggle = reatomMemo(() => {
  const current = themeMode()
  const CurrentIcon = ICONS[current]

  return (
    <>
      <ToggleGroup type="single" value={current} aria-label="Тема" className={styles.group}>
        {OPTIONS.map(({ mode, label, Icon }) => (
          <ToggleGroupItem
            key={mode}
            value={mode}
            className={styles.item}
            aria-label={label}
            aria-pressed={current === mode}
            onClick={wrap((event: MouseEvent) =>
              applyWithViewTransition(event, () => themeMode.set(mode)),
            )}
          >
            <Icon size={16} strokeWidth={2.2} aria-hidden />
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <button
        type="button"
        className={styles.cycleButton}
        aria-label="Сменить тему"
        title={LABELS[current]}
        onClick={wrap((event: MouseEvent) =>
          applyWithViewTransition(event, () => cycleThemeMode()),
        )}
      >
        <CurrentIcon size={16} strokeWidth={2.2} aria-hidden />
      </button>
    </>
  )
}, 'ThemeToggle')
