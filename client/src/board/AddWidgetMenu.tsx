import { reatomComponent } from '@reatom/react'
import { useRef, useState } from 'react'
import { CalendarDays, Clock, Plus } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { addInstance } from '../board-model/board-model'
import { widgetTypes, type WidgetIconName } from '../widget-registry/registry'
import styles from './AddWidgetMenu.module.css'

const WIDGET_ICONS: Record<WidgetIconName, LucideIcon> = { Clock, CalendarDays }

export const AddWidgetMenu = reatomComponent(() => {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)

  const closeMenu = () => {
    setOpen(false)
    triggerRef.current?.focus()
  }

  return (
    <div className={styles.wrap}>
      <button
        ref={triggerRef}
        type="button"
        className={styles.trigger}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          if (open) {
            closeMenu()
            return
          }

          setOpen(true)
        }}
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
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault()
                closeMenu()
              }
            }}
          >
            {widgetTypes.map((type) => {
              const Icon = WIDGET_ICONS[type.icon]
              return (
                <li key={type.id} role="none">
                  <button
                    type="button"
                    role="menuitem"
                    className={styles.item}
                    onClick={() => {
                      addInstance(type.id)
                      closeMenu()
                    }}
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
