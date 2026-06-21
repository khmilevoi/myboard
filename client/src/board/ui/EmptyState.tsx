import { wrap } from '@reatom/core'
import { Plus } from 'lucide-react'

import { reatomMemo } from '@/shared/reatom/reatom-memo'

import { openAddWidgetMenu } from '../model/add-widget-menu-model'

import styles from './EmptyState.module.css'

export const EmptyState = reatomMemo(() => {
  const open = wrap(() => openAddWidgetMenu())
  return (
    <div className={styles.empty}>
      <span className={styles.icon}>
        <Plus size={30} strokeWidth={2} aria-hidden />
      </span>
      <h2 className={styles.title}>Начните с первого виджета</h2>
      <p className={styles.hint}>
        Добавляйте виджеты из каталога, свободно перемещайте их и меняйте размер. Раскладка
        сохранится на этом устройстве.
      </p>
      <div className={styles.actions}>
        <button type="button" className={styles.primary} onClick={open}>
          <Plus size={16} strokeWidth={2.4} aria-hidden />
          Добавить виджет
        </button>
      </div>
    </div>
  )
}, 'EmptyState')
