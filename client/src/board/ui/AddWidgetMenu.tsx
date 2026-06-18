import { wrap } from '@reatom/core'
import { useRef } from 'react'
import { CalendarDays, Clock, Plus } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { reatomMemo } from '../../shared/reatom/reatom-memo'
import { widgetTypes, type WidgetIconName } from '../../widget-registry/model/registry'
import {
  closeAddWidgetMenu,
  isAddWidgetMenuOpen,
  openAddWidgetMenu,
} from '../model/add-widget-menu-model'
import { addInstance } from '../model/board-model'
import styles from './AddWidgetMenu.module.css'

const WIDGET_ICONS: Record<WidgetIconName, LucideIcon> = { Clock, CalendarDays }

export const AddWidgetMenu = reatomMemo(() => {
  const open = isAddWidgetMenuOpen()
  const triggerRef = useRef<HTMLButtonElement>(null)

  const closeMenu = wrap(() => {
    closeAddWidgetMenu()
    triggerRef.current?.focus()
  })

  return (
    <div className={styles.wrap}>
      <button
        ref={triggerRef}
        type="button"
        className={styles.trigger}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={wrap(() => {
          if (open) {
            closeMenu()
            return
          }

          openAddWidgetMenu()
        })}
      >
        <Plus size={16} strokeWidth={2.4} aria-hidden />
        <span>Add widget</span>
      </button>

      {open && (
        <>
          <div className={styles.scrim} onClick={closeMenu} />
          <ul
            role="menu"
            className={styles.menu}
            onKeyDown={wrap((event) => {
              if (event.key === 'Escape') {
                event.preventDefault()
                closeMenu()
              }
            })}
          >
            {widgetTypes.map((type) => {
              const Icon = WIDGET_ICONS[type.icon]
              return (
                <li key={type.id} role="none">
                  <button
                    type="button"
                    role="menuitem"
                    className={styles.item}
                    onClick={wrap(() => {
                      const result = addInstance(type.id)
                      if (result instanceof Error) {
                        console.warn('Add widget failed:', result.message)
                        return
                      }
                      closeMenu()
                    })}
                  >
                    <Icon size={18} strokeWidth={2} aria-hidden />
                    <span>{type.title}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        </>
      )}
    </div>
  )
}, 'AddWidgetMenu')
