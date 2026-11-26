import { atom, wrap } from '@reatom/core'
import { Camera, CircleAlert, LogOut, Monitor, Plus, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { cn } from 'widget-sdk/lib/utils'
import { reatomMemo } from 'widget-sdk/reatom/reatom-memo'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { hostRuntime, http } from '@/runtime'

import { type AccountModel, createAccountModel } from '../model/account-model'
import { MyDevicesDialog } from './MyDevicesDialog'

import styles from './AccountMenu.module.css'

export type AccountMenuProps = {
  /** Injectable for tests; defaults to a fresh `createAccountModel()` instance. */
  model?: AccountModel
}

/** What the avatar upload accepts — the server's AVATAR_POLICY. */
const AVATAR_ACCEPT = 'image/png,image/jpeg,image/webp'

// Standard Russian plural-form selection (one/few/many) by count, e.g.
// 1 устройство, 2 устройства, 5 устройств. Exported for reuse by
// MyDevicesDialog.tsx (Task B5), which needs the same rule for its relative
// "N дня/дней назад" / "N недели/недель назад" added-at labels -- one shared
// implementation instead of a second copy.
export function pluralize(count: number, one: string, few: string, many: string): string {
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
  // "one model instance per mounted screen" convention). MyDevicesDialog is
  // rendered below from inside this same component and reuses this instance
  // (never creates its own), so both surfaces always agree on `account`/
  // `devices`/`pending`.
  const [model] = useState(
    () =>
      modelOverride ??
      createAccountModel({ http, refreshIdentity: () => hostRuntime.identity.refresh() }),
  )
  // The picker lives outside the dropdown: the menu content unmounts on close, the input must not.
  const fileInput = useRef<HTMLInputElement>(null)
  // Local, component-scoped open state for the dropdown -- same
  // controlled-atom idiom as board/model/add-widget-menu-model.ts's
  // `isAddWidgetMenuOpen`, just instance-scoped since this menu has exactly
  // one mount point (the header).
  const [menuOpen] = useState(() => atom(false, 'accountMenu.open'))
  // The "Мои устройства" item and the pending-request row both flip this to
  // true; MyDevicesDialog (Task B5) is rendered below, controlled by this
  // atom and sharing this same `model` instance so both surfaces always
  // agree on `account`/`devices`/`pending`.
  const [myDevicesOpen] = useState(() => atom(false, 'accountMenu.myDevicesOpen'))

  useEffect(() => {
    void model.refresh()
    return model.connectEvents()
  }, [model])

  const account = model.account()
  const devices = model.devices()
  const pending = model.pending()
  const open = menuOpen()
  const avatarPending = model.avatarPending()
  const avatarError = model.avatarError()

  const name = account?.name ?? ''
  const initials = name ? initialsOf(name) : ''
  const avatarUrl = account?.avatarUrl

  const pickAvatar = wrap((event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0]
    // Reset so picking the same file again still fires change.
    event.currentTarget.value = ''
    if (file) void model.uploadAvatar(file)
  })
  const openPicker = () => fileInput.current?.click()
  const hasPending = pending.length > 0
  const deviceCountLabel = `${devices.length} ${pluralize(devices.length, 'устройство', 'устройства', 'устройств')}`
  const pendingLabel = `${pending.length} ${pluralize(pending.length, 'запрос', 'запроса', 'запросов')} на подключение`

  return (
    <>
      <DropdownMenu open={open} onOpenChange={wrap((next: boolean) => menuOpen.set(next))}>
        <DropdownMenuTrigger asChild>
          <button type="button" className={styles.trigger} aria-label={name || 'Аккаунт'}>
            {avatarUrl ? (
              <img
                className={styles.avatarImage}
                src={avatarUrl}
                alt=""
                data-testid="account-avatar-image"
              />
            ) : (
              initials
            )}
            {hasPending ? <span className={styles.badge} data-testid="account-menu-badge" /> : null}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          sideOffset={22}
          className={cn(styles.content, hasPending && styles.contentPending)}
        >
          <div className={styles.head}>
            <div className={styles.headAvatar}>
              {avatarUrl ? (
                <img
                  className={cn(styles.headAvatarFace, avatarPending && styles.headAvatarBusy)}
                  src={avatarUrl}
                  alt=""
                  data-testid="account-menu-head-avatar"
                />
              ) : (
                <span
                  className={cn(styles.headAvatarFace, avatarPending && styles.headAvatarBusy)}
                  aria-hidden
                >
                  {initials}
                </span>
              )}
              {avatarPending ? (
                <span
                  className={styles.headAvatarSpinner}
                  role="status"
                  aria-label="Загружаем фото"
                >
                  <span className={styles.spinner} aria-hidden />
                </span>
              ) : (
                // A pointer shortcut for the photo menu item below, which is the keyboard path:
                // Radix menus move focus between items only, so this stays out of the tab order.
                <button
                  type="button"
                  tabIndex={-1}
                  className={cn(styles.cameraBadge, !avatarUrl && styles.cameraBadgeEmpty)}
                  aria-label={avatarUrl ? 'Сменить фото' : 'Загрузить фото'}
                  data-testid="account-avatar-badge"
                  onClick={openPicker}
                >
                  <Camera
                    size={avatarUrl ? 11 : 10}
                    strokeWidth={avatarUrl ? 2.2 : 2.4}
                    aria-hidden
                  />
                </button>
              )}
            </div>
            <div className={styles.headText}>
              <div className={styles.name}>{name}</div>
              <div className={styles.deviceCount}>{deviceCountLabel}</div>
            </div>
          </div>

          {avatarError ? (
            <div className={styles.avatarError} role="alert" data-testid="account-avatar-error">
              <CircleAlert
                size={15}
                strokeWidth={2}
                aria-hidden
                className={styles.avatarErrorIcon}
              />
              <span>{avatarError}</span>
            </div>
          ) : null}

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
            <DropdownMenuItem
              className={styles.item}
              disabled={avatarPending}
              data-testid="account-avatar-upload"
              onSelect={(event) => {
                // Stay open: the pending state and any error show in this menu.
                event.preventDefault()
                openPicker()
              }}
            >
              <Camera size={16} strokeWidth={1.8} aria-hidden />
              <span>
                {avatarPending ? 'Загружаем фото…' : avatarUrl ? 'Сменить фото' : 'Загрузить фото'}
              </span>
            </DropdownMenuItem>
            {avatarUrl && !avatarPending ? (
              <DropdownMenuItem
                className={styles.item}
                data-testid="account-avatar-remove"
                onSelect={wrap((event: Event) => {
                  event.preventDefault()
                  void model.removeAvatar()
                })}
              >
                <Trash2 size={16} strokeWidth={1.8} aria-hidden />
                <span>Удалить фото</span>
              </DropdownMenuItem>
            ) : null}
          </div>

          <div className={styles.dividerInset} />
          <div className={styles.section}>
            <DropdownMenuItem
              className={styles.item}
              onSelect={wrap(() => myDevicesOpen.set(true))}
            >
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
      <input
        ref={fileInput}
        type="file"
        accept={AVATAR_ACCEPT}
        hidden
        data-testid="account-avatar-input"
        onChange={pickAvatar}
      />
      <MyDevicesDialog
        model={model}
        open={myDevicesOpen()}
        onOpenChange={wrap((next: boolean) => myDevicesOpen.set(next))}
      />
    </>
  )
}, 'AccountMenu')
