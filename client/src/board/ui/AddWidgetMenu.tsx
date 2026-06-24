import { wrap } from '@reatom/core'
import { CalendarDays, Clock, Lock, Plus, Cat, X } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverArrow, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { reatomMemo } from '@/shared/reatom/reatom-memo'
import type { WidgetIconName } from '@/widget-registry/model/registry'

import {
  catalogQuery,
  closeAddWidgetMenu,
  filteredWidgetTypes,
  isAddWidgetMenuOpen,
  openAddWidgetMenu,
} from '../model/add-widget-menu-model'
import { addInstance } from '../model/board-model'

import styles from './AddWidgetMenu.module.css'

const WIDGET_ICONS: Record<WidgetIconName, LucideIcon> = {
  Clock,
  CalendarDays,
  Cat,
}

export const AddWidgetMenu = reatomMemo(() => {
  const open = isAddWidgetMenuOpen()
  const query = catalogQuery()
  const types = filteredWidgetTypes()

  return (
    <Popover
      open={open}
      onOpenChange={wrap((next: boolean) => (next ? openAddWidgetMenu() : closeAddWidgetMenu()))}
    >
      <PopoverTrigger asChild>
        <Button className={styles.trigger} aria-label="Добавить виджет">
          <Plus size={16} strokeWidth={2.4} aria-hidden />
          <span className={styles.triggerLabel}>Добавить виджет</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={10}
        className={styles.panel}
        onOpenAutoFocus={wrap((event: Event) => event.preventDefault())}
      >
        <div className={styles.head}>
          <span className={styles.headTitle}>Каталог виджетов</span>
          <button
            type="button"
            className={styles.close}
            aria-label="Закрыть"
            onClick={wrap(() => closeAddWidgetMenu())}
          >
            <X size={16} aria-hidden />
          </button>
        </div>

        <search className={styles.search}>
          <Input
            value={query}
            placeholder="Поиск виджетов"
            onChange={wrap((event) => catalogQuery.set(event.target.value))}
          />
        </search>

        <div className={styles.count}>Доступные · {types.length}</div>

        <ul className={styles.list}>
          {types.map((type) => {
            const Icon = WIDGET_ICONS[type.icon]
            return (
              <li key={type.id} className={styles.row}>
                <span className={styles.tile}>
                  <Icon size={18} strokeWidth={2} aria-hidden />
                </span>
                <span className={styles.meta}>
                  <span className={styles.title}>{type.title}</span>
                  <span className={styles.desc}>{type.description}</span>
                </span>
                <button
                  type="button"
                  className={styles.add}
                  aria-label={`Добавить: ${type.title}`}
                  onClick={wrap(() => {
                    const result = addInstance(type.id)
                    if (result instanceof Error) {
                      console.warn('Add widget failed:', result.message)
                      return
                    }
                    closeAddWidgetMenu()
                  })}
                >
                  <Plus size={16} strokeWidth={2.4} aria-hidden />
                </button>
              </li>
            )
          })}
        </ul>

        <div className={styles.footer}>
          <Lock size={13} aria-hidden />
          Каждый виджет работает изолированно
        </div>
        <PopoverArrow className={styles.arrow} />
      </PopoverContent>
    </Popover>
  )
}, 'AddWidgetMenu')
