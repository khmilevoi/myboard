import { atom, wrap } from '@reatom/core'
import { LogOut, Monitor, Plus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { cn } from 'widget-sdk/lib/utils'
import { reatomMemo } from 'widget-sdk/reatom/reatom-memo'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

import { type AccountModel, createAccountModel } from '../model/account-model'

import styles from './AccountMenu.module.css'

export type AccountMenuProps = {
  /** Injectable for tests; defaults to a fresh `createAccountModel()` instance. */
  model?: AccountModel
}

// Standard Russian plural-form selection (one/few/many) by count, e.g.
// 1 устройство, 2 устройства, 5 устройств.
function pluralize(count: number, one: string, few: string, many: string): string {
  const mod10 = count % 10
  const mod100 = count % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few
  return many
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return ''
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return (parts[0]![0] + parts[1]![0]).toUpperCase()
}

export const AccountMenu = reatomMemo<AccountMenuProps>(({ model: modelOverride }) => {
  // One model instance per mounted menu -- this is the sole owner/consumer of
  // account-model.ts in the board client (mirrors ActivateScreen's identical
  // "one model instance per mounted screen" convention). A future
  // MyDevicesDialog (Task B5) is rendered from inside this same component and
  // reuses this instance, so both surfaces always agree on `account`/
  // `devices`/`pending`.
  const [model] = useState(() => modelOverride ?? createAccountModel())
  // Local, component-scoped open state for the dropdown -- same
  // controlled-atom idiom as board/model/add-widget-menu-model.ts's
  // `isAddWidgetMenuOpen`, just instance-scoped since this menu has exactly
  // one mount point (the header).
  const [menuOpen] = useState(() => atom(false, 'accountMenu.open'))
  // Reserved for Task B5: the "Мои устройства" item flips this to true; once
  // MyDevicesDialog exists it will be rendered here, controlled by this atom.
  const [myDevicesOpen] = useState(() => atom(false, 'accountMenu.myDevicesOpen'))

  useEffect(() => {
    void model.refresh()
    return model.connectEvents()
  }, [model])

  const account = model.account()
  const devices = model.devices()
  const pending = model.pending()
  const open = menuOpen()

  const name = account?.name ?? ''
  const initials = name ? initialsOf(name) : ''
  const hasPending = pending.length > 0
  const deviceCountLabel = `${devices.length} ${pluralize(devices.length, 'устройство', 'устройства', 'устройств')}`
  const pendingLabel = `${pending.length} ${pluralize(pending.length, 'запрос', 'запроса', 'запросов')} на подключение`

  return (
    <DropdownMenu open={open} onOpenChange={wrap((next: boolean) => menuOpen.set(next))}>
      <DropdownMenuTrigger asChild>
        <button type="button" className={styles.trigger} aria-label={name || 'Аккаунт'}>
          {initials}
          {hasPending ? <span className={styles.badge} data-testid="account-menu-badge" /> : null}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={22}
        className={cn(styles.content, hasPending && styles.contentPending)}
      >
        <div className={styles.head}>
          <div className={styles.name}>{name}</div>
          <div className={styles.deviceCount}>{deviceCountLabel}</div>
        </div>

        {hasPending ? (
          <div className={styles.pendingSection}>
            <DropdownMenuItem
              className={styles.pendingItem}
              onSelect={wrap(() => myDevicesOpen.set(true))}
            >
              <span className={styles.pendingIcon}>
                <Plus size={13} strokeWidth={2.4} aria-hidden />
              </span>
              <span className={styles.pendingLabel}>{pendingLabel}</span>
            </DropdownMenuItem>
          </div>
        ) : null}

        <div className={styles.divider} />
        <div className={styles.section}>
          <DropdownMenuItem className={styles.item} onSelect={wrap(() => myDevicesOpen.set(true))}>
            <Monitor size={16} strokeWidth={1.8} aria-hidden />
            <span>Мои устройства</span>
          </DropdownMenuItem>
        </div>

        <div className={styles.dividerInset} />
        <div className={styles.section}>
          <DropdownMenuItem
            className={cn(styles.item, styles.itemDestructive)}
            onSelect={wrap(() => {
              void model.logout()
            })}
          >
            <LogOut size={16} strokeWidth={1.8} aria-hidden />
            <span>Выйти</span>
          </DropdownMenuItem>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}, 'AccountMenu')
